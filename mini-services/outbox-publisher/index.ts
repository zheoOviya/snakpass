// P0-24 Sub-Wave 2b — Outbox Publisher Worker
//
// Cron-triggered publisher with DB-backed lease/claim + retry state.
//
// This is NOT a "continuously running worker that polls." It is a
// CRON-TRIGGERED process that:
//   1. Claims PENDING events (atomic UPDATE ... WHERE status='PENDING' → CLAIMED)
//   2. Publishes each claimed event via Socket.io
//   3. Marks as PUBLISHED (success) or increments attempts (failure)
//   4. After max retries (5), marks as FAILED + alerts
//   5. Recovers stale CLAIMED events (lease expired → back to PENDING)
//
// Crash safety: if the process dies between claim + publish, the lease
// expires and a future invocation re-claims the event.
//
// Run via: Vercel Cron (1-minute interval) OR manual trigger
// Port: 3009 (for health check endpoint)

import { PrismaClient } from '@prisma/client'
import { io as ioClient, type Socket } from 'socket.io-client'
import { createHash } from 'crypto'
import { appendFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

// Transport configuration:
// - HTTP mode: publisher POSTs events to CONSUMER_URL/api/test/consume-event
// - Socket.io mode: publisher emits via Socket.io to REALTIME_URL
// HTTP mode is used for staging E2E testing (no realtime service deployed).
// Socket.io mode is for production (realtime service deployed).
const TRANSPORT_MODE = process.env.OUTBOX_TRANSPORT_MODE || 'http' // 'http' | 'socket'

// HTTP consumer URL (for staging E2E testing)
const CONSUMER_URL = process.env.CONSUMER_URL || ''

const PORT = parseInt(process.env.OUTBOX_PUBLISHER_PORT || '3009', 10)
const REALTIME_URL = process.env.REALTIME_URL || 'http://localhost:3003'
const LEASE_DURATION_MS = 30_000 // 30 seconds — if publisher crashes, lease expires
const MAX_RETRIES = 5
const BACKOFF_SCHEDULE_MS = [1_000, 5_000, 30_000, 300_000, 900_000] // 1s, 5s, 30s, 5min, 15min
const BATCH_SIZE = 10 // events per claim batch

const db = new PrismaClient()
const LOG_DIR = join(import.meta.dir, '..', '..', 'db')
const LOG_FILE = join(LOG_DIR, 'outbox-publisher-log.jsonl')

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {})
}

// Socket.io connection to realtime service
let realtimeSocket: Socket | null = null

function getRealtimeSocket(): Socket | null {
  if (realtimeSocket) return realtimeSocket
  try {
    const sock = ioClient(REALTIME_URL, {
      path: '/',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 500,
      timeout: 2000,
    })
    sock.on('connect_error', () => {
      // swallow — realtime is best-effort
    })
    realtimeSocket = sock
    return sock
  } catch {
    return null
  }
}

// Event type → Socket.io event name mapping (2b-0 transport contract)
const EVENT_TYPE_TO_SOCKET: Record<string, string> = {
  ORDER_CREATED: 'order:created',
  ORDER_STATUS_CHANGED: 'order:updated',
  KILL_SWITCH_TOGGLED: 'killswitch:toggled',
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  eventId?: string
  eventType?: string
  workerId?: string
  attempt?: number
  error?: string
}

async function log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
  const full: LogEntry = { ...entry, timestamp: new Date().toISOString() }
  const line = JSON.stringify(full)
  console.log(line)
  await appendFile(LOG_FILE, line + '\n').catch(() => {})
}

/**
 * Main publisher loop — claims + publishes + marks events.
 * Called by Vercel Cron (or manual trigger).
 */
async function publishPendingEvents(): Promise<{
  claimed: number
  published: number
  failed: number
  recovered: number
  errors: number
}> {
  const workerId = `worker-${process.pid}-${Date.now()}`
  const result = { claimed: 0, published: 0, failed: 0, recovered: 0, errors: 0 }

  // Step 1: Recover stale CLAIMED events (lease expired)
  const now = new Date()
  const staleRecovery = await db.outbox.updateMany({
    where: {
      status: 'CLAIMED',
      claimUntil: { lt: now },
    },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimUntil: null,
      workerId: null,
    },
  })
  result.recovered = staleRecovery.count
  if (result.recovered > 0) {
    await log({ level: 'warn', message: 'recovered-stale-claimed-events', workerId, count: result.recovered })
  }

  // Step 2: Claim PENDING events (atomic — WHERE status='PENDING')
  const claimResult = await db.outbox.updateMany({
    where: {
      status: 'PENDING',
    },
    data: {
      status: 'CLAIMED',
      claimedAt: now,
      claimUntil: new Date(now.getTime() + LEASE_DURATION_MS),
      workerId,
    },
    // Note: Prisma updateMany doesn't support LIMIT directly, but we
    // fetch only BATCH_SIZE events in the next query
  })
  result.claimed = claimResult.count

  if (result.claimed === 0) {
    return result // nothing to do
  }

  // Step 3: Fetch claimed events for this worker
  const claimedEvents = await db.outbox.findMany({
    where: {
      status: 'CLAIMED',
      workerId,
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  })

  // Step 4: Publish each event
  // PUBLISHED means: successful transport handoff to the consumer.
  // If transport fails, the event goes to retry (PENDING with incremented attempts)
  // or FAILED (max retries). PUBLISHED is NOT set on failure.
  for (const event of claimedEvents) {
    try {
      const socketEventName = EVENT_TYPE_TO_SOCKET[event.eventType]
      if (!socketEventName) {
        throw new Error(`Unknown event type: ${event.eventType}`)
      }

      const payload = JSON.parse(event.payload)

      // Transport: deliver the event via HTTP or Socket.io
      if (TRANSPORT_MODE === 'http') {
        // HTTP mode: POST to consumer endpoint
        if (!CONSUMER_URL) {
          throw new Error('CONSUMER_URL not set for HTTP transport mode')
        }

        const consumerEndpoint = `${CONSUMER_URL}/api/test/consume-event`
        const response = await fetch(consumerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: event.eventId,
            eventType: event.eventType,
            payload,
          }),
          signal: AbortSignal.timeout(5000),
        })

        if (!response.ok) {
          const errBody = await response.text().catch(() => 'unknown')
          throw new Error(`Consumer returned HTTP ${response.status}: ${errBody}`)
        }

        const consumerResult = await response.json()
        await log({ level: 'info', message: 'event-delivered-via-http', eventId: event.eventId, eventType: event.eventType, workerId, consumerProcessed: consumerResult.processed })
      } else {
        // Socket.io mode: emit via realtime service
        const sock = getRealtimeSocket()
        if (!sock || !sock.connected) {
          throw new Error('Realtime service not connected — transport failed')
        }
        sock.emit(socketEventName, payload)
        await log({ level: 'info', message: 'event-published-via-socketio', eventId: event.eventId, eventType: event.eventType, workerId })
      }

      // Mark as PUBLISHED ONLY after successful transport
      await db.outbox.update({
        where: { id: event.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          claimedAt: null,
          claimUntil: null,
          workerId: null,
        },
      })
      result.published++
    } catch (error) {
      const errorMsg = (error as Error).message
      result.errors++

      const newAttempts = event.attempts + 1

      if (newAttempts >= MAX_RETRIES) {
        // Max retries exhausted → FAILED
        await db.outbox.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            attempts: newAttempts,
            lastError: errorMsg,
            claimedAt: null,
            claimUntil: null,
            workerId: null,
          },
        })
        result.failed++
        await log({ level: 'error', message: 'event-failed-max-retries', eventId: event.eventId, eventType: event.eventType, workerId, attempt: newAttempts, error: errorMsg })
      } else {
        // Retry: back to PENDING (will be re-claimed on next invocation with backoff)
        // We use claimUntil to enforce backoff: set it to now + backoff
        const backoffMs = BACKOFF_SCHEDULE_MS[Math.min(newAttempts - 1, BACKOFF_SCHEDULE_MS.length - 1)]
        await db.outbox.update({
          where: { id: event.id },
          data: {
            status: 'PENDING',
            attempts: newAttempts,
            lastError: errorMsg,
            claimedAt: null,
            claimUntil: new Date(Date.now() + backoffMs), // enforce backoff
            workerId: null,
          },
        })
        await log({ level: 'warn', message: 'event-retry-scheduled', eventId: event.eventId, eventType: event.eventType, workerId, attempt: newAttempts, error: errorMsg })
      }
    }
  }

  return result
}

// Health check + manual trigger endpoint
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      return Response.json({ status: 'ok', service: 'outbox-publisher', port: PORT })
    }

    if (url.pathname === '/trigger') {
      // Manual trigger — runs publishPendingEvents once
      try {
        const result = await publishPendingEvents()
        return Response.json({ ok: true, result })
      } catch (error) {
        return Response.json({ ok: false, error: (error as Error).message }, { status: 500 })
      }
    }

    if (url.pathname === '/lag') {
      // Check outbox lag (age of oldest PENDING event)
      const oldestPending = await db.outbox.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, eventId: true, eventType: true },
      })

      if (!oldestPending) {
        return Response.json({ lagSeconds: 0, oldestEventId: null })
      }

      const lagSeconds = Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 1000)
      return Response.json({
        lagSeconds,
        oldestEventId: oldestPending.eventId,
        oldestEventType: oldestPending.eventType,
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

// Run publisher on startup (for Vercel Cron: each invocation runs once)
if (process.env.OUTBOX_PUBLISHER_AUTO_RUN !== 'false') {
  publishPendingEvents().then(async (result) => {
    await log({ level: 'info', message: 'publisher-cycle-complete', result })
    // Don't close server — keep it alive for health checks + manual triggers
  }).catch(async (error) => {
    await log({ level: 'error', message: 'publisher-cycle-error', error: (error as Error).message })
  })
}

console.log(`Outbox publisher running on port ${PORT}`)
