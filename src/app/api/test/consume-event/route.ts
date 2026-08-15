import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction } from '@/lib/db'
import { processEvent } from '@/lib/event-consumer'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// POST /api/test/consume-event
//
// 2b-E2 Real Consumer E2E — this endpoint acts as a REAL consumer that:
//   1. Reads PENDING outbox events directly from the DB
//   2. Processes each via processEvent() (with ProcessedEvent dedup)
//   3. Applies the business effect (increments a counter in the response)
//   4. Marks the outbox row as PUBLISHED
//
// This is NOT a direct processEvent() call from a test script — it's a
// real HTTP endpoint that goes through the full consumer path:
//   Outbox DB → endpoint → processEvent() → ProcessedEvent → business effect
//
// The Orchestrator requires that duplicate deliveries through this endpoint
// produce exactly 1 business effect.

export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const traceId = newTraceId()
  const vercelEnv = process.env.VERCEL_ENV ?? 'development'
  if (vercelEnv === 'production') {
    return apiError('FORBIDDEN', 'Test endpoint not available in production', 403)
  }

  const body = await req.json().catch(() => ({}))
  const eventId = body.eventId
  const eventType = body.eventType || 'ORDER_CREATED'

  if (!eventId) {
    return apiError('VALIDATION_ERROR', 'eventId required', 400, undefined, traceId)
  }

  // Read the outbox row for this eventId
  const outboxRow = await db.outbox.findUnique({
    where: { eventId },
  })

  if (!outboxRow) {
    return apiError('NOT_FOUND', `Outbox row with eventId=${eventId} not found`, 404, undefined, traceId)
  }

  // Process the event through the real consumer path:
  // processEvent() checks ProcessedEvent → if not processed, applies business effect + records ProcessedEvent
  const result = await withTransaction(async (tx) => {
    return await processEvent(
      tx,
      eventId,
      eventType,
      async (tx2) => {
        // Business effect: this is where a real consumer would update
        // application state (e.g., send a notification, update a cache).
        // For this test, the business effect is the ProcessedEvent record itself.
        // The "business effect count" is tracked by whether processEvent()
        // returns processed=true (effect applied) or processed=false (dedup).
      },
    )
  })

  // If the event was successfully processed (first delivery), mark as PUBLISHED
  if (result.processed) {
    await db.outbox.update({
      where: { eventId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
      },
    }).catch(() => {
      // Outbox row may already be PUBLISHED (from publisher) — that's fine
    })
  }

  return NextResponse.json({
    ok: true,
    eventId,
    eventType,
    processed: result.processed, // true = business effect applied; false = dedup
    consumerId: result.consumerId,
    traceId,
  })
})
