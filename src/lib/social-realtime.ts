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
  // S5C: notification read-state invalidation for cross-tab consistency.
  // When user marks a notification read in one tab, other tabs refresh their
  // authoritative unread count from REST. The event carries no read-state —
  // the client refetches GET /api/notifications.
  'SOCIAL_NOTIFICATION_READ',
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
// S5D: Activity feed fanout — emit SOCIAL_ACTIVITY_CREATED to all accepted
// friends of the actor. Recipients are server-derived from committed DB truth
// (SocialConnection rows where followerId=actorId, status=ACCEPTED).
//
// SECURITY (S4A/S4B):
//   - Blocked users are NOT friends (BLOCKED != ACCEPTED) → excluded from fanout.
//   - Former friends (REMOVED/none) → excluded.
//   - Non-friends → excluded.
//   - The realtime event is an INVALIDATION SIGNAL only — the client refetches
//     GET /api/social/feed which re-checks friend status + visibility. If auth
//     changes between event emission and REST refetch, the feed correctly
//     excludes the activity (REST is authoritative, not the event).
//
// VISIBILITY POLICY:
//   - FRIENDS activity: fanout to accepted friends only (default feed audience).
//   - PUBLIC activity: same fanout (current feed only shows friends' activities;
//     there is no global broadcast architecture — see S5D Phase 11 trace).
//   - PRIVATE activity: NO fanout (actor-only, excluded from feed).
//
// PAYLOAD: minimal envelope { eventId, type, occurredAt, entityId=activityId }.
//   No full activity object, no metadata, no phone, no blockedBy, no user object.
// ----------------------------------------------------------------------------
export async function enqueueActivityFeedFanout(
  tx: Prisma.TransactionClient,
  params: {
    actorId: string
    activityId: string
    visibility: string // 'FRIENDS' | 'PUBLIC' | 'PRIVATE'
  },
): Promise<{ recipientCount: number }> {
  // PRIVATE: no fanout (actor-only, excluded from feed)
  if (params.visibility === 'PRIVATE') {
    return { recipientCount: 0 }
  }

  // FRIENDS + PUBLIC: fanout to accepted friends (server-derived)
  const friends = await tx.socialConnection.findMany({
    where: { followerId: params.actorId, status: 'ACCEPTED' },
    select: { followeeId: true },
  })

  for (const edge of friends) {
    await enqueueSocialEvent(tx, {
      type: 'SOCIAL_ACTIVITY_CREATED',
      targetUserId: edge.followeeId,
      entityId: params.activityId,
    })
  }

  return { recipientCount: friends.length }
}

// ----------------------------------------------------------------------------
// S5E: Like/Unlike fanout — emit SOCIAL_ACTIVITY_LIKED / SOCIAL_ACTIVITY_UNLIKED
// to the activity actor AND all accepted friends who may have the activity
// visible in their feed.
//
// Recipient model (Phase 4):
//   - Activity actor: always receives the event (they own the activity)
//   - Accepted friends: receive the event if they can see the activity in their feed
//     (FRIENDS/PUBLIC visibility only — PRIVATE activities are not in any feed)
//   - Blocked users: excluded (BLOCKED != ACCEPTED)
//   - Non-friends: excluded
//
// The realtime event is an INVALIDATION SIGNAL only — the client refetches
// GET /api/social/feed which returns authoritative likeCount + likedByMe.
// Socket payload does NOT carry count.
//
// PAYLOAD: minimal envelope { eventId, type, occurredAt, entityId=activityId }.
// ----------------------------------------------------------------------------
export async function enqueueLikeFanout(
  tx: Prisma.TransactionClient,
  params: {
    activityId: string
    actorId: string
    visibility: string // 'FRIENDS' | 'PUBLIC' | 'PRIVATE'
    eventType: 'SOCIAL_ACTIVITY_LIKED' | 'SOCIAL_ACTIVITY_UNLIKED'
  },
): Promise<{ recipientCount: number }> {
  // Always send to the actor (they own the activity)
  const recipients = new Set<string>([params.actorId])

  // FRIENDS/PUBLIC: also fanout to accepted friends who may have the activity
  // in their feed. PRIVATE: actor only (activity not in any feed).
  if (params.visibility !== 'PRIVATE') {
    const friends = await tx.socialConnection.findMany({
      where: { followerId: params.actorId, status: 'ACCEPTED' },
      select: { followeeId: true },
    })
    for (const edge of friends) {
      recipients.add(edge.followeeId)
    }
  }

  for (const targetUserId of recipients) {
    await enqueueSocialEvent(tx, {
      type: params.eventType,
      targetUserId,
      entityId: params.activityId,
    })
  }

  return { recipientCount: recipients.size }
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
  // S5B: ACCEPTED also refreshes notifications — the accept flow creates a
  // FRIEND_REQUEST_ACCEPTED notification for the original requester. Rather
  // than emitting a separate SOCIAL_NOTIFICATION_CREATED event, the ACCEPTED
  // event itself signals notification invalidation.
  SOCIAL_FRIEND_ACCEPTED:     { connections: true, feed: true, notifications: true },
  SOCIAL_FRIEND_REMOVED:      { connections: true, feed: true },
  SOCIAL_USER_BLOCKED:        { connections: true, feed: true },
  SOCIAL_USER_UNBLOCKED:      { connections: true },
  SOCIAL_ACTIVITY_CREATED:    { feed: true },
  SOCIAL_ACTIVITY_LIKED:       { feed: true, notifications: true },
  SOCIAL_ACTIVITY_UNLIKED:     { feed: true },
  SOCIAL_NOTIFICATION_CREATED: { notifications: true },
  // S5C: read-state change → refresh notifications (authoritative unread count).
  SOCIAL_NOTIFICATION_READ:    { notifications: true },
}
