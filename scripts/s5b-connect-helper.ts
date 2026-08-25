// Helper: connect a socket and resolve when connected (handles already-connected case)
import { io, type Socket } from 'socket.io-client'

export function connectSocket(sessionToken: string): { socket: Socket; connected: Promise<boolean> } {
  const socket = io('http://localhost:3003', {
    path: '/',
    transports: ['websocket'],
    reconnection: false,
    timeout: 4000,
    extraHeaders: { cookie: `snakzap_session=${sessionToken}` },
  })
  const connected = new Promise<boolean>((resolve) => {
    if (socket.connected) return resolve(true)
    socket.on('connect', () => resolve(true))
    socket.on('connect_error', (err) => resolve(false))
    setTimeout(() => resolve(socket.connected), 5000)
  })
  return { socket, connected }
}

export function connectService(): { socket: Socket; connected: Promise<boolean> } {
  const socket = io('http://localhost:3003', {
    path: '/',
    transports: ['websocket'],
    reconnection: false,
    timeout: 4000,
    auth: { serviceToken: 'snakzap-dev-service-token-s5b' },
  })
  const connected = new Promise<boolean>((resolve) => {
    if (socket.connected) return resolve(true)
    socket.on('connect', () => resolve(true))
    socket.on('connect_error', () => resolve(false))
    setTimeout(() => resolve(socket.connected), 5000)
  })
  return { socket, connected }
}
