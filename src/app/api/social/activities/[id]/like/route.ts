import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'
import { enqueueSocialEvent } from '@/lib/social-realtime'

// ----------------------------------------------------------------------------
// GJ-02 S2: Persistent Likes — POST/DELETE /api/social/activities/[id]/like
// ----------------------------------------------------------------------------
// POST   — Like an activity (idempotent: if already liked, returns existing state)
// DELETE — Unlike an activity (idempotent: if not liked, returns unliked state)
//
// Auth: getSessionUser() required (401 if no session).
// Authorization (visibility):
//   - PUBLIC activity: any authenticated user may like
//   - FRIENDS activity: only accepted friends of the actor may like
//   - PRIVATE activity: nobody may like through social surface (403)
//
// Self-like: the actor CAN like their own activity (unless PRIVATE).
// This is consistent with social platforms where users can like their own posts.
//
// Response shape (both POST and DELETE):
//   { liked: boolean, likeCount: number }
// ----------------------------------------------------------------------------

async function checkVisibility(session: { userId: string }, activity: { actorId: string; visibility: string }): Promise<boolean> {
  // PRIVATE — nobody can like through social surface (not even the actor)
  if (activity.visibility === 'PRIVATE') return false

  // PUBLIC — any authenticated user may like
  if (activity.visibility === 'PUBLIC') return true

  // FRIENDS — only accepted friends of the actor may like
  // (bidirectional: either A→B or B→A with status=ACCEPTED)
  const conn = await db.socialConnection.findFirst({
    where: {
      OR: [
        { followerId: session.userId, followeeId: activity.actorId, status: 'ACCEPTED' },
        { followerId: activity.actorId, followeeId: session.userId, status: 'ACCEPTED' },
      ],
    },
  })
  return !!conn
}

// POST /api/social/activities/[id]/like
export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id: activityId } = await params
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    // Load activity
    const activity = await db.socialActivity.findUnique({
      where: { id: activityId },
      select: { id: true, actorId: true, visibility: true },
    })
    if (!activity) {
      return apiError('NOT_FOUND', 'Activity not found', 404, undefined, traceId) as unknown as NextResponse
    }

    // Authorization: check visibility
    const canLike = await checkVisibility(session, activity)
    if (!canLike) {
      return apiError('AUTHORIZATION_DENIED', 'You cannot like this activity', 403, undefined, traceId) as unknown as NextResponse
    }

    // S4C C1 Repair: Like + SOCIAL_ACTIVITY_LIKED notification are now ATOMIC.
    // Both writes happen inside a single withTransaction(). If the notification
    // fails (non-P2002), the Like is also rolled back — no orphan Likes without
    // notifications. P2002 on notification (dedupKey conflict from a previous
    // like cycle) is caught internally and does NOT abort the transaction.
    //
    // Idempotency preserved:
    //   - findUnique first to check existing like (avoids P2002 on create)
    //   - If concurrent insert wins, P2002 on create → withTransaction retries
    //     → findUnique finds existing → returns isNewLike=false (idempotent)
    //   - Notification dedupKey P2002 caught internally (idempotent)
    //   - Self-like: no notification created (documented branch, not a gap)
    let isNewLike = false
    try {
      const result = await withTransaction(async (tx) => {
        // Check if like already exists (idempotent read)
        const existing = await tx.like.findUnique({
          where: { userId_activityId: { userId: session.userId, activityId } },
          select: { id: true },
        })

        if (existing) {
          return { isNewLike: false }
        }

        // Create the Like
        await tx.like.create({
          data: { userId: session.userId, activityId },
        })

        // Create notification IF needed (same transaction — atomic with Like)
        // Self-like policy: the actor does NOT receive a notification for
        // liking their own activity. This is an intentional product decision,
        // not an atomicity gap — the Like commits without a notification by
        // design.
        let likeNotifId: string | null = null
        if (activity.actorId !== session.userId) {
          const dedupKey = `SOCIAL_ACTIVITY_LIKED:${activityId}:${session.userId}`
          try {
            const notif = await tx.notification.create({
              data: {
                userId: activity.actorId,
                type: 'SOCIAL_ACTIVITY_LIKED',
                title: 'Someone liked your activity',
                body: 'Your activity received a new like',
                data: JSON.stringify({ activityId, likerId: session.userId }),
                dedupKey,
              },
              select: { id: true },
            })
            likeNotifId = notif.id
          } catch (e: unknown) {
            // P2002 = notification already exists from a previous like cycle.
            // This is idempotent — the Like still commits. NOT an atomicity gap.
            if (e !== null && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
              logInfo('social-like-notification-already-exists', { activityId, likerId: session.userId }, traceId)
            } else {
              throw e // Non-P2002 → transaction rolls back (Like also rolled back)
            }
          }
        }

        // S5C: Dedicated notification realtime event for the activity owner
        // (actor). Only enqueued when a NEW notification row was created
        // (likeNotifId !== null). On duplicate Like (idempotent), no new row
        // → no event → no duplicate bell increment. entityId = notificationId.
        if (likeNotifId) {
          await enqueueSocialEvent(tx, {
            type: 'SOCIAL_NOTIFICATION_CREATED',
            targetUserId: activity.actorId,
            entityId: likeNotifId,
          })
        }

        return { isNewLike: true }
      })
      isNewLike = result.isNewLike
      if (isNewLike) {
        logInfo('social-like-created', { activityId, userId: session.userId }, traceId)
      } else {
        logInfo('social-like-already-exists', { activityId, userId: session.userId }, traceId)
      }
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Like conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        ) as unknown as NextResponse
      }
      throw error
    }

    // Count likes for this activity (authoritative DB count)
    const likeCount = await db.like.count({ where: { activityId } })

    return NextResponse.json({ liked: true, likeCount }) as unknown as NextResponse
  })

// DELETE /api/social/activities/[id]/like
export const DELETE = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id: activityId } = await params
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    // Idempotent Unlike: delete if exists (no visibility check needed for unlike —
    // the user can only delete their OWN like, which was already authorized at POST time)
    await db.like.deleteMany({
      where: { userId: session.userId, activityId },
    })
    logInfo('social-like-removed', { activityId, userId: session.userId }, traceId)

    // Count remaining likes
    const likeCount = await db.like.count({ where: { activityId } })

    return NextResponse.json({ liked: false, likeCount }) as unknown as NextResponse
  })
