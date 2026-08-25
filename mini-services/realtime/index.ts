// mini-services/realtime/index.ts
//
// SnakZap real-time service (S5A: Secure Socket Authentication).
//
// S5A Repair: Added session-based authentication.
//   - Unauthenticated sockets → rejected (disconnect)
//   - Authenticated sockets → server resolves userId from session cookie
//   - Socket auto-joins user:{userId} room (private channel for social events)
//   - Client cannot subscribe to another user's private channel
//   - Public channels (restaurant:{id}, order:{id}, vendor:all, etc.) remain
//     accessible to any authenticated user (backward compatible)
//
// Path MUST be "/" so Caddy can forward via ?XTransformPort=3003 and the
// frontend can connect with io("/?XTransformPort=3003").

import { createServer } from 'http'
import { Server } from 'socket.io'
import { Database } from 'bun:sqlite'

// --- Database access for session validation ---
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || '/home/z/my-project/db/custom.db'
const db = new Database(DB_PATH, { readonly: true })

interface SessionRow {
  token: string
  userId: string
  role: string
  expiresAt: number
}

function validateSession(token: string | undefined): { userId: string; role: string } | null {
  if (!token) return null
  try {
    const row = db.prepare(
      'SELECT token, userId, role, expiresAt FROM Session WHERE token = ?'
    ).get(token) as SessionRow | null
    if (!row) return null
    // Check expiry (expiresAt stored as epoch ms)
    const now = Date.now()
    const expiresAt = typeof row.expiresAt === 'number' ? row.expiresAt : new Date(row.expiresAt as unknown as string).getTime()
    if (expiresAt < now) return null
    return { userId: row.userId, role: row.role }
  } catch {
    return null
  }
}

// --- Event types ---
interface OrderEvent {
  orderId: string
  restaurantId: string
  status: string
  totalAmount: number
  updatedAt: string
  pickupOtp?: string
}

// S5A: Social realtime event envelope
interface SocialRealtimeEvent {
  eventId: string
  type: string
  occurredAt: string
  entityId?: string
}

// S5B: Outbox payload shape = { targetUserId, envelope }. The publisher emits
// this shape via 'social:event'. (S5A originally used `event` as the field name
// in the handler, but the outbox/enqueueSocialEvent canonical type uses
// `envelope` — the field-name mismatch caused events to be silently dropped.)
interface SocialOutboxPayload {
  targetUserId: string
  envelope: SocialRealtimeEvent
}

// S5A: Social event types (for publisher routing)
const SOCIAL_EVENT_TYPES = new Set([
  'SOCIAL_FRIEND_REQUEST',
  'SOCIAL_FRIEND_ACCEPTED',
  'SOCIAL_FRIEND_REMOVED',
  'SOCIAL_USER_BLOCKED',
  'SOCIAL_USER_UNBLOCKED',
  'SOCIAL_ACTIVITY_CREATED',
  'SOCIAL_ACTIVITY_LIKED',
  'SOCIAL_ACTIVITY_UNLIKED',
  'SOCIAL_NOTIFICATION_CREATED',
  'SOCIAL_NOTIFICATION_READ',
])

// --- HTTP server (health check + socket.io) ---
const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, service: 'snakzap-realtime', connections: io.engine.clientsCount }))
})

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// --- S5A: Authentication middleware (S5B: + service-token bypass) ---
// Two authentication paths:
//
//   1. SERVICE connection (outbox-publisher, internal services):
//      handshake.auth.serviceToken === process.env.REALTIME_SERVICE_TOKEN
//      → admitted as a "service" identity (no user channel, can emit 'social:event'
//        to route events to user channels, cannot subscribe to user channels)
//
//   2. USER connection (browser clients):
//      snakzap_session cookie validated against Session table
//      → admitted as a user, auto-joins user:{userId} private channel
//
// S5B Phase 1 runtime precheck discovered that S5A's middleware rejected the
// publisher (a service with no session cookie), so social events could never
// be delivered. The service-token path closes this gap without weakening user
// auth: a random/unknown serviceToken is rejected exactly like an unknown
// session.
const SERVICE_TOKEN = process.env.REALTIME_SERVICE_TOKEN || ''

io.use((socket, next) => {
  // S5B: Service-token bypass for internal services (publisher).
  // The token is a shared secret provisioned via env. An empty token on the
  // server disables the service path entirely (fail-closed).
  const auth = (socket.handshake.auth || {}) as { serviceToken?: unknown }
  if (typeof auth.serviceToken === 'string' && SERVICE_TOKEN.length > 0 && auth.serviceToken === SERVICE_TOKEN) {
    socket.data.isService = true
    socket.data.userId = null
    socket.data.role = 'service'
    // Services do NOT join any user channel — they emit 'social:event' with
    // an explicit targetUserId, and the handler routes to that user's channel.
    return next()
  }

  // User auth: session cookie
  const cookieHeader = socket.handshake.headers.cookie || ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [key, ...val] = c.trim().split('=')
      return [key, val.join('=')]
    })
  )
  const session = validateSession(cookies['snakzap_session'])
  if (!session) {
    return next(new Error('UNAUTHORIZED'))
  }
  // Store authenticated identity on socket
  socket.data.userId = session.userId
  socket.data.role = session.role
  socket.data.isService = false
  // S5A: Auto-join user's private channel
  socket.join(`user:${session.userId}`)
  next()
})

io.on('connection', (socket) => {
  const userId = socket.data.userId
  console.log(`[realtime] +client ${socket.id} user=${userId?.substring(0, 8)}.. (total ${io.engine.clientsCount})`)

  // S5A: Channel subscription with authorization
  socket.on('subscribe', (channel: string) => {
    if (typeof channel !== 'string' || channel.length === 0) return

    // S5A: Private user channels — can only subscribe to OWN channel
    // (already auto-joined on connection, but explicit subscribe also allowed for own channel)
    if (channel.startsWith('user:')) {
      if (channel === `user:${userId}`) {
        socket.join(channel) // Already joined, but explicit is fine
      }
      // Silently ignore attempts to subscribe to other users' channels
      return
    }

    // Public channels (backward compatible with existing order/vendor/admin)
    socket.join(channel)
  })

  socket.on('unsubscribe', (channel: string) => {
    if (typeof channel === 'string') {
      // Don't allow unsubscribing from own user channel
      if (channel === `user:${userId}`) return
      socket.leave(channel)
    }
  })

  // --- Existing order/killswitch event handlers (backward compatible) ---
  socket.on('order:updated', (payload: OrderEvent) => {
    io.to(`restaurant:${payload.restaurantId}`).emit('order:updated', payload)
    io.to(`order:${payload.orderId}`).emit('order:updated', payload)
    io.to('vendor:all').emit('order:updated', payload)
    io.to('admin:all').emit('order:updated', payload)
    io.to('consumer:all').emit('order:updated', payload)
  })

  socket.on('order:created', (payload: OrderEvent) => {
    io.to(`restaurant:${payload.restaurantId}`).emit('order:created', payload)
    io.to('vendor:all').emit('order:created', payload)
    io.to('admin:all').emit('order:created', payload)
  })

  socket.on('killswitch:toggled', (payload: { key: string; enabled: boolean }) => {
    io.to('admin:all').emit('killswitch:toggled', payload)
    io.to('consumer:all').emit('killswitch:toggled', payload)
  })

  // --- S5A: Social event handler (from outbox publisher) ---
  // S5B: ONLY service connections (publisher) may emit 'social:event'.
  // A regular user socket MUST NOT be able to forge social events to other
  // users — that would let any authenticated user push arbitrary invalidation
  // signals to any other user. The publisher authenticates via service token.
  // S5B fix: field name is `envelope` (matching enqueueSocialEvent's outbox
  // payload type), NOT `event`. The envelope is emitted to the client as-is.
  socket.on('social:event', (data: SocialOutboxPayload) => {
    if (!socket.data.isService) return // silently reject — non-service cannot forge
    if (!data?.targetUserId || !data?.envelope?.eventId) return
    // Emit the envelope to the target user's private channel only
    io.to(`user:${data.targetUserId}`).emit('social:event', data.envelope)
  })

  socket.on('disconnect', () => {
    console.log(`[realtime] -client ${socket.id} (total ${io.engine.clientsCount})`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[snakzap-realtime] listening on port ${PORT} (auth: session-based)`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
process.on('SIGINT', () => httpServer.close(() => process.exit(0)))
