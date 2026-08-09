import { io, type Socket } from 'socket.io-client'

// Server-side singleton socket.io client used by Next.js API route handlers
// to broadcast order/killswitch events to the realtime service (port 3003).
// The realtime service then fans the event out to subscribed browser clients.

const REALTIME_URL = 'http://localhost:3003'

const globalForRealtime = globalThis as unknown as { __realtimeSocket?: Socket }

function getSocket(): Socket | null {
  if (globalForRealtime.__realtimeSocket) return globalForRealtime.__realtimeSocket
  try {
    const sock = io(REALTIME_URL, {
      path: '/',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      timeout: 2000,
    })
    sock.on('connect', () => {
      // register as a server-side emitter so the realtime service rebroadcasts
      // our events instead of echoing to us only.
    })
    sock.on('connect_error', () => {
      // swallow — realtime is best-effort; API must still succeed
    })
    globalForRealtime.__realtimeSocket = sock
    return sock
  } catch {
    return null
  }
}

export interface OrderEventPayload {
  orderId: string
  restaurantId: string
  status: string
  totalAmount: number
  updatedAt: string
  pickupOtp?: string
}

export function emitOrderCreated(p: OrderEventPayload) {
  const s = getSocket()
  if (s && s.connected) s.emit('order:created', p)
  else if (s) s.on('connect', () => s.emit('order:created', p))
}

export function emitOrderUpdated(p: OrderEventPayload) {
  const s = getSocket()
  if (s && s.connected) s.emit('order:updated', p)
  else if (s) s.on('connect', () => s.emit('order:updated', p))
}

export function emitKillSwitchToggled(p: { key: string; enabled: boolean }) {
  const s = getSocket()
  if (s && s.connected) s.emit('killswitch:toggled', p)
  else if (s) s.on('connect', () => s.emit('killswitch:toggled', p))
}
