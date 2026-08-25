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

// --- S5A: Authentication middleware ---
// Socket.io handshake includes cookies. We read the snakzap_session cookie
// and validate it against the Session table.
io.use((socket, next) => {
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
  // Publisher emits 'social:event' with { targetUserId, event: SocialRealtimeEvent }
  socket.on('social:event', (data: { targetUserId: string; event: SocialRealtimeEvent }) => {
    if (!data?.targetUserId || !data?.event?.eventId) return
    // Emit to the target user's private channel only
    io.to(`user:${data.targetUserId}`).emit('social:event', data.event)
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
