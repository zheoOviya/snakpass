import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { avatarColorForUserId, sanitizeActivityMetadata } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 6 Task 6A — GET /api/social/feed
// ----------------------------------------------------------------------------
// Returns paginated activities from the current user's ACCEPTED friends.
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role.
//
// Query params:
//   - page:  page number (1-indexed). Default 1. Min 1.
//   - limit: page size. Default 20. Min 1. Max 100.
//
// Response shape (per task spec):
//   {
//     activities: [{
//       id, actorId, actorName, actorAvatarColor, verb, objectType, objectId,
//       metadata, visibility, createdAt
//     }],
//     total, page, limit, hasMore
//   }
//
// CRITICAL PRIVACY (blueprint §18 + §6 P2):
//   NEVER expose payment amounts. The metadata field is sanitized server-side
//   on READ (defense-in-depth — the recording side also strips on WRITE via
//   `recordActivity`/`sanitizeActivityMetadata`, but legacy rows or rows
//   written by other code paths may have leaked sensitive keys).
//
// Feed composition:
//   1. Query: SocialActivity rows where actorId ∈ (my accepted friends set)
//      AND visibility ∈ ['FRIENDS', 'PUBLIC'] (PRIVATE activities are excluded).
//   2. Paginate by createdAt DESC.
//   3. Join with User (by actorId) to populate actorName + actorAvatarColor.
//
// Errors: 400 (invalid pagination) / 401 (no session) / 500 (internal).
// ----------------------------------------------------------------------------

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

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

    // -------------------------------------------------------------------------
    // Parse + validate query params.
    // -------------------------------------------------------------------------
    const { searchParams } = new URL(req.url)
    const pageRaw = searchParams.get('page') ?? String(DEFAULT_PAGE)
    const limitRaw = searchParams.get('limit') ?? String(DEFAULT_LIMIT)

    const page = Math.max(1, Number.parseInt(pageRaw, 10) || DEFAULT_PAGE)
    const limitParsed = Number.parseInt(limitRaw, 10) || DEFAULT_LIMIT
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitParsed))

    // -------------------------------------------------------------------------
    // Step 1 — fetch the user's ACCEPTED friends (the people whose activities
    // they're allowed to see). This is a single round-trip via the
    // SocialConnection table.
    //
    // Note: a friend "follows me" (followeeId=me, status=ACCEPTED). Since
    // friendship is bidirectional (2 rows per pair), we could equivalently
    // query for "I follow them" (followerId=me, status=ACCEPTED). Use the
    // followerId=me query because that's the edge this user controls.
    // -------------------------------------------------------------------------
    const friendEdges = await db.socialConnection.findMany({
      where: {
        followerId: session.userId,
        status: 'ACCEPTED',
      },
      select: { followeeId: true },
    })
    const friendIds = friendEdges.map((e) => e.followeeId)

    // No friends → empty feed (early return avoids an empty IN-clause query).
    if (friendIds.length === 0) {
      return NextResponse.json({
        activities: [],
        total: 0,
        page,
        limit,
        hasMore: false,
      })
    }

    // -------------------------------------------------------------------------
    // Step 2 — paginated SocialActivity query. Filter:
    //   - actorId ∈ friendIds (only friends' activities)
    //   - visibility ∈ ['FRIENDS', 'PUBLIC'] (exclude PRIVATE)
    // -------------------------------------------------------------------------
    const where = {
      actorId: { in: friendIds },
      visibility: { in: ['FRIENDS', 'PUBLIC'] },
    }

    const [total, rows] = await Promise.all([
      db.socialActivity.count({ where }),
      db.socialActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    // -------------------------------------------------------------------------
    // Step 3 — batch-fetch actor profiles to populate actorName + avatarColor.
    // (No Prisma relation between SocialActivity.actorId → User; manual join.)
    // -------------------------------------------------------------------------
    const actorIds = Array.from(new Set(rows.map((r) => r.actorId)))
    const actorUsers = actorIds.length
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : []
    const actorMap = new Map(actorUsers.map((u) => [u.id, u]))

    // -------------------------------------------------------------------------
    // Step 4 — compose + sanitize each activity row.
    // -------------------------------------------------------------------------
    const activities = rows.map((r) => {
      const actor = actorMap.get(r.actorId)
      // Parse the stored metadata JSON, then re-sanitize on READ (defense-in-depth).
      let parsedMetadata: unknown = {}
      try {
        parsedMetadata = JSON.parse(r.metadata)
      } catch {
        // Corrupt JSON → treat as empty (don't fail the whole feed).
        parsedMetadata = {}
      }
      const sanitizedMetadata = sanitizeActivityMetadata(parsedMetadata)

      return {
        id: r.id,
        actorId: r.actorId,
        actorName: actor?.name ?? 'Unknown user',
        actorAvatarColor: avatarColorForUserId(r.actorId),
        verb: r.verb,
        objectType: r.objectType,
        objectId: r.objectId,
        metadata: sanitizedMetadata,
        visibility: r.visibility,
        createdAt: r.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      activities,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    })
  })
