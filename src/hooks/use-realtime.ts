'use client'

/* eslint-disable react-hooks/set-state-in-effect -- this hook synchronizes React state
   with an external socket.io connection; calling setState from connect/disconnect
   callbacks and on initial mount is the intended pattern. */

import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

// Connects to the SnakZap realtime service (port 3003) via Caddy gateway.
// Frontend MUST use io("/?XTransformPort=3003") — never a direct localhost URL.

let socket: Socket | null = null

function getSocket(): Socket {
  if (socket) return socket
  socket = io('/?XTransformPort=3003', {
    path: '/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  })
  return socket
}

export function useRealtime(channels: string[]) {
  const [connected, setConnected] = useState(false)
  const channelKey = channels.join('|')

  useEffect(() => {
    const s = getSocket()

    const onConnect = () => {
      setConnected(true)
      for (const c of channels) s.emit('subscribe', c)
    }
    const onDisconnect = () => setConnected(false)

    if (s.connected) {
      setConnected(true)
      for (const c of channels) s.emit('subscribe', c)
    }
    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      for (const c of channels) s.emit('unsubscribe', c)
    }
  }, [channelKey])

  return { socket: getSocket(), connected }
}

export function realtimeSocket(): Socket {
  return getSocket()
}
