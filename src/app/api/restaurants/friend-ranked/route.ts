import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// S5H2: GET /api/restaurants/friend-ranked
// ----------------------------------------------------------------------------
// Friend-ranked restaurant discovery. Ranks restaurants by unique friend count,
// not raw order/activity/Like volume.
//
// RANKING FORMULA (deterministic lexicographic):
//   1. uniqueFriendCount DESC (more unique friends = higher rank)
//   2. mostRecentShareAt DESC (fresher social proof ranks higher in ties)
//   3. restaurantId ASC (deterministic tie-breaker)
//
// TRUST CHAIN (reuses S5H1):
//   - Real qualifying Order (via sourceOrderId FK + status allowlist)
//   - Authorized share (SocialActivity visibility FRIENDS/PUBLIC)
//   - Current viewer authorization (SocialConnection ACCEPTED, bidirectional)
//
// PRIVACY:
//   - friendCount + friendCountBucket only (no friend identities)
//   - Max 5 results (LIMIT 5)
//   - hasSocialSignal = false when 0 eligible restaurants
//
// Auth: getSessionUser() required (401 if no session).
// ----------------------------------------------------------------------------

const QUALIFYING_ORDER_STATUSES = [
  'CONFIRMED',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'PAID',
]

const MAX_RESULTS = 5

export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

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

    const campusId = req.nextUrl.searchParams.get('campusId')?.trim() ?? ''

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

    const friendIds = new Set<string>()
    for (const edge of friendEdges) {
      if (edge.followerId !== session.userId) friendIds.add(edge.followerId)
      if (edge.followeeId !== session.userId) friendIds.add(edge.followeeId)
    }

    // No friends → no social signal
    if (friendIds.size === 0) {
      return NextResponse.json({
        restaurants: [],
        hasSocialSignal: false,
      })
    }

    const friendIdArray = Array.from(friendIds)

    // Step 2: Get qualifying shared activities grouped by restaurant
    // Query: SocialActivity with sourceOrderId (authoritative) + INNER JOIN Order
    // (qualifying status) + visibility FRIENDS/PUBLIC + actorId in friends
    const qualifyingActivities = await db.socialActivity.findMany({
      where: {
        verb: 'ORDERED',
        objectType: 'Restaurant',
        visibility: { in: ['FRIENDS', 'PUBLIC'] },
        sourceOrderId: { not: null },
        actorId: { in: friendIdArray },
        sourceOrder: {
          status: { in: QUALIFYING_ORDER_STATUSES },
        },
      },
      select: {
        actorId: true,
        objectId: true,
        createdAt: true,
        sourceOrder: {
          select: { createdAt: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { actorId: 'asc' }],
    })

    // Step 3: Group by restaurantId, count DISTINCT actorId, find MAX sourceOrder.createdAt
    // S5H2: Use sourceOrder.createdAt (when the order was placed) for recency,
    // NOT SocialActivity.createdAt (when the share was created). This ensures
    // ranking reflects actual order recency, not share action recency.
    const restaurantMap = new Map<string, { uniqueFriends: Set<string>; mostRecentShareAt: Date }>()

    for (const act of qualifyingActivities) {
      const restId = act.objectId
      // Use sourceOrder.createdAt (actual order time) for recency
      const orderCreatedAt = act.sourceOrder?.createdAt ?? act.createdAt
      if (!restaurantMap.has(restId)) {
        restaurantMap.set(restId, { uniqueFriends: new Set(), mostRecentShareAt: orderCreatedAt })
      }
      const entry = restaurantMap.get(restId)!
      entry.uniqueFriends.add(act.actorId)
      if (orderCreatedAt > entry.mostRecentShareAt) {
        entry.mostRecentShareAt = orderCreatedAt
      }
    }

    // Step 4: Sort by ranking formula
    const rankedRestaurants = Array.from(restaurantMap.entries())
      .map(([restaurantId, data]) => ({
        restaurantId,
        uniqueFriendCount: data.uniqueFriends.size,
        mostRecentShareAt: data.mostRecentShareAt,
      }))
      .sort((a, b) => {
        // PRIMARY: uniqueFriendCount DESC
        if (b.uniqueFriendCount !== a.uniqueFriendCount) {
          return b.uniqueFriendCount - a.uniqueFriendCount
        }
        // SECONDARY: mostRecentShareAt DESC
        const timeDiff = b.mostRecentShareAt.getTime() - a.mostRecentShareAt.getTime()
        if (timeDiff !== 0) return timeDiff
        // TERTIARY: restaurantId ASC (deterministic tie-breaker)
        return a.restaurantId.localeCompare(b.restaurantId)
      })
      .slice(0, MAX_RESULTS)

    // No qualifying restaurants → no social signal
    if (rankedRestaurants.length === 0) {
      return NextResponse.json({
        restaurants: [],
        hasSocialSignal: false,
      })
    }

    // Step 5: Fetch restaurant details for ranked restaurantIds
    // Note: No campusId filter here — the ranking is already scoped by
    // the viewer's friends' activities. If a friend ordered at a restaurant,
    // it's relevant regardless of campus junction.
    const restaurantIds = rankedRestaurants.map(r => r.restaurantId)
    const restaurants = await db.restaurant.findMany({
      where: {
        id: { in: restaurantIds },
        isActive: true,
        isSuspended: false,
      },
      select: {
        id: true,
        name: true,
        cuisine: true,
        description: true,
        image: true,
        rating: true,
        prepTimeMins: true,
        priceForTwo: true,
        address: true,
      },
    })

    // Map restaurant details to ranked order (preserve ranking order)
    const restaurantMap2 = new Map(restaurants.map(r => [r.id, r]))
    const resultList = rankedRestaurants
      .filter(r => restaurantMap2.has(r.restaurantId))
      .map((r, idx) => {
        const rest = restaurantMap2.get(r.restaurantId)!
        const friendCount = r.uniqueFriendCount
        const friendCountBucket: '1' | '2' | '3+' = friendCount >= 3 ? '3+' : String(friendCount) as '1' | '2'

        return {
          id: rest.id,
          name: rest.name,
          cuisine: rest.cuisine,
          description: rest.description,
          image: rest.image,
          rating: rest.rating,
          prepTimeMins: rest.prepTimeMins,
          priceForTwo: rest.priceForTwo,
          address: rest.address,
          isOpen: true, // derived (no hours model yet)
          deal: rest.priceForTwo < 30000 ? { title: 'Great value', description: 'Under ₹300 for two' } : null,
          friendCount,
          friendCountBucket,
          rankPosition: idx + 1,
        }
      })

    return NextResponse.json({
      restaurants: resultList,
      hasSocialSignal: resultList.length > 0,
    })
  })
