import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'

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

    // Idempotent Like: create if not exists
    let isNewLike = false
    try {
      await db.like.create({
        data: {
          userId: session.userId,
          activityId,
        },
      })
      isNewLike = true
      logInfo('social-like-created', { activityId, userId: session.userId }, traceId)
    } catch (e: unknown) {
      // P2002 = unique constraint violation → already liked (idempotent)
      if (e !== null && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
        logInfo('social-like-already-exists', { activityId, userId: session.userId }, traceId)
      } else {
        throw e
      }
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
