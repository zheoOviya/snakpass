import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { avatarColorForUserId } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// S5H1: GET /api/restaurants/[id]/social-proof
// ----------------------------------------------------------------------------
// Returns "Friends Ordered Here" social proof for a restaurant.
//
// TRUST CHAIN (all server-verified):
//   1. REAL ORDER: SocialActivity.sourceOrderId IS NOT NULL + INNER JOIN Order
//      with status in QUALIFYING_ORDER_STATUSES (verifies economic truth)
//   2. AUTHORIZED SHARE: SocialActivity.visibility IN ('FRIENDS', 'PUBLIC')
//      (PRIVATE excluded — user chose not to share)
//   3. CURRENT VIEWER AUTHORIZATION: SocialConnection status='ACCEPTED'
//      (bidirectional — current friendship, no block)
//
// Response: { friendOrderCount, friends: [{name, avatarColor}], hasMore }
//
// Privacy:
//   - Max 3 friend profiles (LIMIT 3)
//   - No userId, phone, email, orderId, paymentId, amount, timestamp
//   - friendOrderCount = UNIQUE friends (not order/activity count)
//   - hasMore = true if friendOrderCount > 3
//
// Failure behavior: returns 0 friends on any error (no fake social proof)
// ----------------------------------------------------------------------------

const QUALIFYING_ORDER_STATUSES = [
  'CONFIRMED',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'PAID',
]

const MAX_PROFILES = 3

export const GET = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: restaurantId } = await params

    const session = await getSessionUser()
    if (!session) {
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // Verify restaurant exists
    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true },
    })
    if (!restaurant) {
      return apiError(
        'NOT_FOUND',
        'Restaurant not found',
        404,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // Step 1: Get viewer's accepted friends (bidirectional, excludes BLOCKED)
    const friendEdges = await db.socialConnection.findMany({
      where: {
        OR: [
          { followerId: session.userId, status: 'ACCEPTED' },
          { followeeId: session.userId, status: 'ACCEPTED' },
        ],
      },
      select: {
        followerId: true,
        followeeId: true,
      },
    })

    // Build unique set of friend IDs (exclude self)
    const friendIds = new Set<string>()
    for (const edge of friendEdges) {
      if (edge.followerId !== session.userId) friendIds.add(edge.followerId)
      if (edge.followeeId !== session.userId) friendIds.add(edge.followeeId)
    }

    // No friends → no social proof
    if (friendIds.size === 0) {
      return NextResponse.json({
        friendOrderCount: 0,
        friends: [],
        hasMore: false,
      })
    }

    // Step 2: Get distinct friends who have qualifying shared ORDERED activities
    // for this restaurant (with authoritative sourceOrderId link)
    const friendIdArray = Array.from(friendIds)

    // Query: SocialActivity with sourceOrderId (authoritative) + INNER JOIN Order
    // (qualifying status) + visibility FRIENDS/PUBLIC + actorId in friends
    const qualifyingActivities = await db.socialActivity.findMany({
      where: {
        verb: 'ORDERED',
        objectType: 'Restaurant',
        objectId: restaurantId,
        visibility: { in: ['FRIENDS', 'PUBLIC'] },
        sourceOrderId: { not: null },
        actorId: { in: friendIdArray },
        sourceOrder: {
          status: { in: QUALIFYING_ORDER_STATUSES },
        },
      },
      select: {
        actorId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { actorId: 'asc' }],
    })

    // Deduplicate by actorId (one friend counts once regardless of order count)
    const uniqueFriendIds: string[] = []
    const seen = new Set<string>()
    for (const act of qualifyingActivities) {
      if (!seen.has(act.actorId)) {
        seen.add(act.actorId)
        uniqueFriendIds.push(act.actorId)
      }
    }

    const friendOrderCount = uniqueFriendIds.length

    // Step 3: Project max 3 friend profiles (name + avatarColor only)
    const profileIds = uniqueFriendIds.slice(0, MAX_PROFILES)
    const profiles = profileIds.length
      ? await db.user.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, name: true },
        })
      : []

    // Build profile list in deterministic order (matching uniqueFriendIds order)
    const profileMap = new Map(profiles.map((p) => [p.id, p]))
    const friends = profileIds.map((id) => {
      const user = profileMap.get(id)
      return {
        name: user?.name ?? 'SnakZap user',
        avatarColor: avatarColorForUserId(id),
      }
    })

    const hasMore = friendOrderCount > MAX_PROFILES

    return NextResponse.json({
      friendOrderCount,
      friends,
      hasMore,
    })
  })
