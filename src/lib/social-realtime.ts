// src/lib/social-realtime.ts
//
// S5A Realtime Foundation — Social event envelope + outbox integration.
//
// This module centralizes:
//   - Social realtime event types
//   - Event envelope creation (minimal payload, no PII)
//   - Outbox event construction (transactional publish boundary)
//
// CANONICAL CONTRACT:
//   Database = source of truth
//   Realtime = invalidation/delivery layer only
//   Events are enqueued INSIDE the business transaction (commit-before-publish)
//   Client receives event → refetches REST → REST is authoritative
//
// PAYLOAD RULES:
//   Payload contains: eventId, type, occurredAt, entityId
//   Payload does NOT contain: phone, blockedBy, tokens, PII, full entities
//   Client action: invalidate/refetch REST resource

import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { enqueueOutboxEvent } from './outbox'

// ----------------------------------------------------------------------------
// Event types
// ----------------------------------------------------------------------------

export const SOCIAL_REALTIME_EVENT_TYPES = [
  'SOCIAL_FRIEND_REQUEST',
  'SOCIAL_FRIEND_ACCEPTED',
  'SOCIAL_FRIEND_REMOVED',
  'SOCIAL_USER_BLOCKED',
  'SOCIAL_USER_UNBLOCKED',
  'SOCIAL_ACTIVITY_CREATED',
  'SOCIAL_ACTIVITY_LIKED',
  'SOCIAL_ACTIVITY_UNLIKED',
  'SOCIAL_NOTIFICATION_CREATED',
] as const

export type SocialRealtimeEventType = (typeof SOCIAL_REALTIME_EVENT_TYPES)[number]

// ----------------------------------------------------------------------------
// Event envelope (what the client receives)
// ----------------------------------------------------------------------------

export interface SocialRealtimeEnvelope {
  /** UUID for client-side dedup (at-least-once delivery) */
  eventId: string
  /** Event type (client uses this to determine which REST resource to invalidate) */
  type: SocialRealtimeEventType
  /** ISO timestamp of when the event was enqueued */
  occurredAt: string
  /** Optional entity ID (connectionId, activityId, notificationId) */
  entityId?: string
}

// ----------------------------------------------------------------------------
// Outbox payload (what the publisher uses to route the event)
// ----------------------------------------------------------------------------

interface SocialOutboxPayload {
  /** Target user who should receive this event */
  targetUserId: string
  /** The event envelope (delivered to client as-is) */
  envelope: SocialRealtimeEnvelope
}

// ----------------------------------------------------------------------------
// Canonical enqueue function
// ----------------------------------------------------------------------------

/**
 * S5A: Enqueue a social realtime event inside a database transaction.
 *
 * This MUST be called inside a `withTransaction(async (tx) => { ... })` block,
 * alongside the business mutation. If the transaction rolls back, the event
 * is NOT enqueued (commit-before-publish invariant).
 *
 * The outbox publisher will eventually deliver the event to the target user's
 * private socket.io channel (user:{targetUserId}).
 *
 * Usage:
 *   await withTransaction(async (tx) => {
 *     await tx.socialConnection.create({ ... })
 *     await enqueueSocialEvent(tx, {
 *       type: 'SOCIAL_FRIEND_REQUEST',
 *       targetUserId: followeeId,
 *       entityId: connection.id,
 *     })
 *   })
 */
export async function enqueueSocialEvent(
  tx: Prisma.TransactionClient,
  params: {
    type: SocialRealtimeEventType
    targetUserId: string
    entityId?: string
  },
): Promise<{ eventId: string }> {
  const eventId = randomUUID()
  const envelope: SocialRealtimeEnvelope = {
    eventId,
    type: params.type,
    occurredAt: new Date().toISOString(),
    entityId: params.entityId,
  }
  const payload: SocialOutboxPayload = {
    targetUserId: params.targetUserId,
    envelope,
  }

  await enqueueOutboxEvent(tx, {
    eventType: params.type,
    aggregateType: 'Social',
    aggregateId: params.entityId ?? eventId,
    payload,
  })

  return { eventId }
}

// ----------------------------------------------------------------------------
// Event type → client invalidation hint
// ----------------------------------------------------------------------------

/**
 * Maps social event types to the REST resources that should be invalidated.
 * The client hook uses this to determine which stores to refresh.
 */
export const EVENT_INVALIDATION_MAP: Record<SocialRealtimeEventType, {
  connections?: boolean
  feed?: boolean
  notifications?: boolean
}> = {
  SOCIAL_FRIEND_REQUEST:     { connections: true, notifications: true },
  SOCIAL_FRIEND_ACCEPTED:     { connections: true, feed: true },
  SOCIAL_FRIEND_REMOVED:      { connections: true, feed: true },
  SOCIAL_USER_BLOCKED:        { connections: true, feed: true },
  SOCIAL_USER_UNBLOCKED:      { connections: true },
  SOCIAL_ACTIVITY_CREATED:    { feed: true },
  SOCIAL_ACTIVITY_LIKED:       { feed: true, notifications: true },
  SOCIAL_ACTIVITY_UNLIKED:     { feed: true },
  SOCIAL_NOTIFICATION_CREATED: { notifications: true },
}
