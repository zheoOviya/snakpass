import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'

// P0-24 Sub-Wave 2b — Consumer-side idempotency
//
// processEvent() ensures that a given event is processed EXACTLY ONCE,
// even if the outbox publisher delivers it multiple times (at-least-once
// delivery + exactly-once business effect).
//
// The dedup record (ProcessedEvent) and the protected business effect
// must be in the same transaction (atomic dedup).
//
// Usage:
//   import { processEvent } from '@/lib/event-consumer'
//   import { withTransaction } from '@/lib/db'
//
//   await withTransaction(async (tx) => {
//     await processEvent(tx, eventId, eventType, async (tx2) => {
//       // business effect here (e.g., update a counter, send a notification)
//       // this runs ONLY if the event hasn't been processed before
//     })
//   })

export interface ProcessEventResult {
  processed: boolean // true = business effect executed; false = already processed (dedup)
  eventId: string
  eventType: string
  consumerId: string
}

/**
 * Process an event with exactly-once business effect semantics.
 *
 * MUST be called inside a `withTransaction(async (tx) => { ... })` block.
 *
 * Behavior:
 *   - First delivery: ProcessedEvent absent → execute handler → insert ProcessedEvent
 *   - Duplicate delivery: ProcessedEvent exists → skip handler → return { processed: false }
 *
 * The handler receives the same `tx` so its writes are atomic with the
 * ProcessedEvent insert. If either fails, both roll back.
 *
 * @param tx Prisma transaction client
 * @param eventId The unique event ID (from Outbox.eventId)
 * @param eventType The event type (from Outbox.eventType)
 * @param handler The business effect to execute (only runs if not already processed)
 * @param consumerId Optional consumer identity (defaults to "default")
 * @param payload Optional payload for hash verification
 */
export async function processEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
  eventType: string,
  handler: (tx: Prisma.TransactionClient) => Promise<void>,
  consumerId: string = 'default',
  payload?: unknown,
): Promise<ProcessEventResult> {
  // Check if this event has already been processed
  const existing = await tx.processedEvent.findUnique({
    where: { eventId },
    select: { eventId: true },
  })

  if (existing) {
    // Duplicate delivery — skip the business effect
    return {
      processed: false,
      eventId,
      eventType,
      consumerId,
    }
  }

  // First delivery — execute the business effect
  await handler(tx)

  // Record that this event has been processed (in the same transaction)
  const payloadHash = payload
    ? createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
    : null

  await tx.processedEvent.create({
    data: {
      eventId,
      eventType,
      consumerId,
      payloadHash,
    },
  })

  return {
    processed: true,
    eventId,
    eventType,
    consumerId,
  }
}
