import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { avatarColorForUserId } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// S5H3: GET /api/social/friend-seed
// ----------------------------------------------------------------------------
// New-user friend seed for social cold-start users (<=2 accepted friends).
// Returns up to 3 safe friend candidates from friends-of-friends + campus fallback.
//
// PRIVACY:
//   - No mutual friend identities exposed (only bucketed count)
//   - No graph path revealed
//   - No phone/email/blockedBy/order history
//   - Block isolation: traversal only through ACCEPTED non-blocked edges
//
// Auth: getSessionUser() required (401 if no session).
// ----------------------------------------------------------------------------

const MAX_CANDIDATES = 3
const ELIGIBILITY_THRESHOLD = 2 // <=2 friends = eligible
const EXIT_THRESHOLD = 3 // >=3 friends = not eligible

export const GET = (_req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    // Step 1: Check eligibility — viewer must have <=2 accepted friends
    const acceptedFriendsOut = await db.socialConnection.findMany({
      where: { followerId: session.userId, status: 'ACCEPTED' },
      select: { followeeId: true },
    })
    const acceptedFriendsIn = await db.socialConnection.findMany({
      where: { followeeId: session.userId, status: 'ACCEPTED' },
      select: { followerId: true },
    })

    // Build unique friend set (bidirectional)
    const friendIds = new Set<string>()
    for (const e of acceptedFriendsOut) friendIds.add(e.followeeId)
    for (const e of acceptedFriendsIn) friendIds.add(e.followerId)

    // Check eligibility
    if (friendIds.size >= EXIT_THRESHOLD) {
      return NextResponse.json({ eligible: false, candidates: [] })
    }

    // Step 2: Build exclusion set (ALL existing connections — any status)
    const allConnectionsOut = await db.socialConnection.findMany({
      where: { followerId: session.userId },
      select: { followeeId: true },
    })
    const allConnectionsIn = await db.socialConnection.findMany({
      where: { followeeId: session.userId },
      select: { followerId: true },
    })

    const exclusionSet = new Set<string>([session.userId]) // self
    for (const e of allConnectionsOut) exclusionSet.add(e.followeeId)
    for (const e of allConnectionsIn) exclusionSet.add(e.followerId)

    // Step 3: Traverse friends-of-friends
    // For each accepted friend B, get B's accepted friends C
    const friendArray = Array.from(friendIds)

    if (friendArray.length === 0) {
      // Zero friends → no mutual candidates, go straight to campus fallback
      return await campusFallback(session, exclusionSet, [])
    }

    // Get fof edges: friends' accepted connections
    const fofEdges = await db.socialConnection.findMany({
      where: {
        followerId: { in: friendArray },
        status: 'ACCEPTED',
      },
      select: { followerId: true, followeeId: true },
    })

    // Also check reverse edges (followee→follower direction)
    const fofEdgesReverse = await db.socialConnection.findMany({
      where: {
        followeeId: { in: friendArray },
        status: 'ACCEPTED',
      },
      select: { followerId: true, followeeId: true },
    })

    // Combine: for each fof, track which friends connect to them
    // fofMap: candidateId → Set of connectorIds (mutual friends)
    const fofMap = new Map<string, Set<string>>()

    for (const edge of fofEdges) {
      // edge.followerId is a friend, edge.followeeId is the candidate
      const candidate = edge.followeeId
      const connector = edge.followerId
      if (exclusionSet.has(candidate)) continue
      if (!fofMap.has(candidate)) fofMap.set(candidate, new Set())
      fofMap.get(candidate)!.add(connector)
    }

    for (const edge of fofEdgesReverse) {
      // edge.followeeId is a friend, edge.followerId is the candidate
      const candidate = edge.followerId
      const connector = edge.followeeId
      if (exclusionSet.has(candidate)) continue
      if (!fofMap.has(candidate)) fofMap.set(candidate, new Set())
      fofMap.get(candidate)!.add(connector)
    }

    // Step 4: Rank mutual candidates
    const mutualCandidates = Array.from(fofMap.entries())
      .map(([candidateId, connectors]) => ({
        candidateId,
        mutualCount: connectors.size,
      }))
      .sort((a, b) => {
        if (b.mutualCount !== a.mutualCount) return b.mutualCount - a.mutualCount
        return a.candidateId.localeCompare(b.candidateId) // deterministic tie-breaker
      })

    // Fetch candidate profiles for mutual candidates (up to MAX_CANDIDATES)
    const mutualIds = mutualCandidates.slice(0, MAX_CANDIDATES).map(c => c.candidateId)
    const mutualProfiles = mutualIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: mutualIds } },
          select: { id: true, name: true, createdAt: true },
        })
      : []

    // Build candidate list (preserve ranking order)
    const profileMap = new Map(mutualProfiles.map(p => [p.id, p]))
    const candidates: any[] = []

    for (const mc of mutualCandidates.slice(0, MAX_CANDIDATES)) {
      const profile = profileMap.get(mc.candidateId)
      if (!profile) continue // inactive/deleted user
      const bucket = mc.mutualCount >= 3 ? '3+' : String(mc.mutualCount) as '1' | '2'
      candidates.push({
        id: profile.id,
        name: profile.name ?? 'SnakZap user',
        avatarColor: avatarColorForUserId(profile.id),
        reason: 'MUTUAL' as const,
        mutualCountBucket: bucket,
      })
    }

    // Step 5: Campus fallback if < MAX_CANDIDATES
    if (candidates.length < MAX_CANDIDATES) {
      // Get viewer's campus
      const viewer = await db.user.findUnique({
        where: { id: session.userId },
        select: { campusId: true },
      })

      if (viewer?.campusId) {
        const slotsRemaining = MAX_CANDIDATES - candidates.length
        const alreadyInList = new Set(candidates.map(c => c.id))

        // Find same-campus users with >=1 accepted connection, not in exclusion set
        // Use a two-step approach since User model doesn't have a named socialConnections relation:
        // 1. Find same-campus users
        // 2. Filter to those with >=1 accepted connection
        const campusUsersRaw = await db.user.findMany({
          where: {
            campusId: viewer.campusId,
            id: { notIn: Array.from(exclusionSet) },
          },
          select: { id: true, name: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20, // fetch enough to find >=1 with accepted connections
        })

        // Filter to users with >=1 accepted connection
        const campusUserIds = campusUsersRaw.map(u => u.id)
        const usersWithConnections = campusUserIds.length > 0
          ? await db.socialConnection.findMany({
              where: { followerId: { in: campusUserIds }, status: 'ACCEPTED' },
              select: { followerId: true },
              distinct: ['followerId'],
            })
          : []
        const usersWithConnSet = new Set(usersWithConnections.map(u => u.followerId))
        const campusUsers = campusUsersRaw.filter(u => usersWithConnSet.has(u.id)).slice(0, slotsRemaining)

        for (const cu of campusUsers) {
          if (candidates.length >= MAX_CANDIDATES) break
          if (alreadyInList.has(cu.id)) continue
          candidates.push({
            id: cu.id,
            name: cu.name ?? 'SnakZap user',
            avatarColor: avatarColorForUserId(cu.id),
            reason: 'CAMPUS' as const,
            mutualCountBucket: '0' as const,
          })
          alreadyInList.add(cu.id)
        }
      }
    }

    return NextResponse.json({
      eligible: true,
      candidates,
    })
  })

// Helper: campus fallback for zero-friend users
async function campusFallback(
  session: { userId: string },
  exclusionSet: Set<string>,
  existingCandidates: any[],
): Promise<NextResponse> {
  const viewer = await db.user.findUnique({
    where: { id: session.userId },
    select: { campusId: true },
  })

  if (!viewer?.campusId) {
    return NextResponse.json({ eligible: true, candidates: [] })
  }

  const slotsRemaining = MAX_CANDIDATES - existingCandidates.length
  const campusUsersRaw = await db.user.findMany({
    where: {
      campusId: viewer.campusId,
      id: { notIn: Array.from(exclusionSet) },
    },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const campusUserIds = campusUsersRaw.map(u => u.id)
  const usersWithConnections = campusUserIds.length > 0
    ? await db.socialConnection.findMany({
        where: { followerId: { in: campusUserIds }, status: 'ACCEPTED' },
        select: { followerId: true },
        distinct: ['followerId'],
      })
    : []
  const usersWithConnSet = new Set(usersWithConnections.map(u => u.followerId))
  const campusUsers = campusUsersRaw.filter(u => usersWithConnSet.has(u.id)).slice(0, slotsRemaining)

  const candidates = campusUsers.map(u => ({
    id: u.id,
    name: u.name ?? 'SnakZap user',
    avatarColor: avatarColorForUserId(u.id),
    reason: 'CAMPUS' as const,
    mutualCountBucket: '0' as const,
  }))

  return NextResponse.json({
    eligible: true,
    candidates,
  })
}
