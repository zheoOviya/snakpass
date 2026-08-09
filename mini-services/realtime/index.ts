import { createServer } from 'http'
import { Server } from 'socket.io'

// SnakZap real-time service.
// Path MUST be "/" so Caddy can forward via ?XTransformPort=3003 and the
// frontend can connect with io("/?XTransformPort=3003").
// Next.js API routes emit events by connecting as a socket.io client
// (see src/lib/realtime.ts).

interface OrderEvent {
  orderId: string
  restaurantId: string
  status: string
  totalAmount: number
  updatedAt: string
  pickupOtp?: string
}

const httpServer = createServer((req, res) => {
  // socket.io intercepts engine.io handshakes at path "/" automatically.
  // Any other request falls through here.
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true, service: 'snakzap-realtime', connections: io.engine.clientsCount }))
})

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`[realtime] +client ${socket.id} (total ${io.engine.clientsCount})`)

  socket.on('subscribe', (channel: string) => {
    if (typeof channel === 'string' && channel.length > 0) {
      socket.join(channel)
    }
  })

  socket.on('unsubscribe', (channel: string) => {
    if (typeof channel === 'string') socket.leave(channel)
  })

  // Server-side clients (from Next.js API) emit these; we rebroadcast to rooms.
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

  socket.on('disconnect', () => {
    console.log(`[realtime] -client ${socket.id} (total ${io.engine.clientsCount})`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[snakzap-realtime] listening on port ${PORT}`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
process.on('SIGINT', () => httpServer.close(() => process.exit(0)))
