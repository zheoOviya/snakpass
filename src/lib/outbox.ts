import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'

// P0-24 — Transactional outbox helper
//
// This library provides the `enqueueOutboxEvent()` function that writes an
// outbox event row INSIDE the same database transaction as the business
// mutation. This ensures:
//
//   1. If the business mutation succeeds + outbox INSERT fails → entire txn rolls back
//      (no orphan business entity without an event)
//   2. If the outbox INSERT succeeds + business mutation fails → entire txn rolls back
//      (no phantom event without a business entity)
//   3. If both succeed + the process crashes before commit → entire txn rolls back
//      (no partial commit)
//   4. If both succeed + commit succeeds + publisher crashes → event row persists
//      (publisher will pick it up on restart — at-least-once delivery)
//
// CRITICAL INVARIANT (Orchestrator constraint):
//   enqueueOutboxEvent() MUST be called INSIDE a withTransaction() block.
//   Calling it outside a transaction defeats the entire purpose of P0-24.
//
// Usage:
//   import { withTransaction } from '@/lib/db'
//   import { enqueueOutboxEvent } from '@/lib/outbox'
//
//   await withTransaction(async (tx) => {
//     const order = await tx.order.create({ ... })
//     await enqueueOutboxEvent(tx, {
//       eventType: 'ORDER_CREATED',
//       aggregateType: 'Order',
//       aggregateId: order.id,
//       payload: { orderId: order.id, status: order.status, totalAmount: order.totalAmount },
//     })
//   })

export interface OutboxEventInput {
  eventType: string // e.g., "ORDER_CREATED", "ORDER_STATUS_CHANGED"
  aggregateType: string // e.g., "Order", "KillSwitch"
  aggregateId: string // e.g., order.id, kill-switch key
  payload: unknown // will be JSON.stringify'd
}

/**
 * Write an outbox event row INSIDE the current transaction.
 *
 * MUST be called inside a `withTransaction(async (tx) => { ... })` block.
 * The `tx` parameter is the Prisma transaction client.
 *
 * The event is committed atomically with the business mutation. If either
 * fails, both roll back (no orphan entities, no phantom events).
 *
 * Returns the created Outbox row (including the eventId for correlation).
 */
export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  event: OutboxEventInput,
): Promise<{ id: string; eventId: string }> {
  const eventId = randomUUID()
  const row = await tx.outbox.create({
    data: {
      eventId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: JSON.stringify(event.payload),
      status: 'PENDING',
    },
    select: { id: true, eventId: true },
  })
  return row
}

/**
 * Build the realtime event payload from an outbox row.
 * Used by the publisher (Sub-Wave 2b) to deliver the event via Socket.io.
 */
export function parseOutboxPayload<T = unknown>(payload: string): T {
  try {
    return JSON.parse(payload) as T
  } catch {
    return {} as T
  }
}

/**
 * Map outbox event types to Socket.io event names.
 * The publisher uses this to route events to the correct Socket.io channel.
 *
 * 2b-0 TRANSPORT CONTRACT FIX:
 * These names MUST match exactly what the realtime mini-service listens for
 * (mini-services/realtime/index.ts). The previous mapping used hyphens
 * (order-created) but the realtime service expects colons (order:created).
 * This mismatch would cause the publisher to emit events that the realtime
 * service never receives — false-positive PUBLISHED status with no actual
 * delivery.
 *
 * Verified mapping (from mini-services/realtime/index.ts):
 *   socket.on('order:created', ...)      ← line 55
 *   socket.on('order:updated', ...)      ← line 47
 *   socket.on('killswitch:toggled', ...) ← line 61
 */
export const EVENT_TYPE_TO_SOCKET_EVENT: Record<string, string> = {
  ORDER_CREATED: 'order:created',
  ORDER_STATUS_CHANGED: 'order:updated',
  KILL_SWITCH_TOGGLED: 'killswitch:toggled',
}
