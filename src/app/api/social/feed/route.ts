import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { avatarColorForUserId, sanitizeActivityMetadata } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 6 Task 6A — GET /api/social/feed
// ----------------------------------------------------------------------------
// S4D Repair-03: Cursor/keyset pagination (replaces offset pagination).
//
// Returns paginated activities from the current user's ACCEPTED friends.
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role.
//
// Query params:
//   - limit:  page size. Default 30. Min 1. Max 100.
//   - cursor: opaque base64 cursor for next page. Omit for first page.
//
// Response shape:
//   {
//     activities: [...],
//     nextCursor: string | null,
//     hasMore: boolean
//   }
//
// S4D Cursor contract:
//   Canonical ordering: (createdAt DESC, id DESC)
//   Cursor encodes: { createdAt, id } of the last item in the current page.
//   Next-page predicate:
//     createdAt < cursor.createdAt
//     OR (createdAt = cursor.createdAt AND id < cursor.id)
//
//   hasMore is determined via take = limit + 1 (no separate count query).
//
// CRITICAL PRIVACY (blueprint §18 + §6 P2):
//   NEVER expose payment amounts. The metadata field is sanitized server-side
//   on READ (defense-in-depth).
//
// Errors: 400 (invalid cursor/limit) / 401 (no session) / 500 (internal).
// ----------------------------------------------------------------------------

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

interface FeedCursor {
  createdAt: string
  id: string
}

function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string): FeedCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as { createdAt?: unknown; id?: unknown }
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      return null
    }
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
}

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
    const limitRaw = searchParams.get('limit') ?? String(DEFAULT_LIMIT)
    const cursorRaw = searchParams.get('cursor')

    const limitParsed = Number.parseInt(limitRaw, 10) || DEFAULT_LIMIT
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitParsed))

    // Decode cursor if present
    let cursor: FeedCursor | null = null
    if (cursorRaw) {
      cursor = decodeCursor(cursorRaw)
      if (!cursor) {
        return apiError(
          'VALIDATION_ERROR',
          'Invalid cursor format',
          400,
          { field: 'cursor' },
          traceId,
        ) as unknown as NextResponse
      }
    }

    // -------------------------------------------------------------------------
    // Step 1 — fetch the user's ACCEPTED friends.
    // -------------------------------------------------------------------------
    const friendEdges = await db.socialConnection.findMany({
      where: {
        followerId: session.userId,
        status: 'ACCEPTED',
      },
      select: { followeeId: true },
    })
    const friendIds = friendEdges.map((e) => e.followeeId)

    // No friends → empty feed (early return).
    if (friendIds.length === 0) {
      return NextResponse.json({
        activities: [],
        nextCursor: null,
        hasMore: false,
      })
    }

    // -------------------------------------------------------------------------
    // Step 2 — cursor-based SocialActivity query.
    //   - actorId ∈ friendIds (only friends' activities)
    //   - visibility ∈ ['FRIENDS', 'PUBLIC'] (exclude PRIVATE)
    //   - S4D: cursor predicate replaces offset (skip)
    //   - take = limit + 1 to determine hasMore without a count query
    // -------------------------------------------------------------------------
    const baseWhere = {
      actorId: { in: friendIds },
      visibility: { in: ['FRIENDS', 'PUBLIC'] as const },
    }

    // S4D: cursor predicate — (createdAt DESC, id DESC) keyset
    // WHERE createdAt < cursor.createdAt
    //    OR (createdAt = cursor.createdAt AND id < cursor.id)
    const where = cursor
      ? {
          ...baseWhere,
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : baseWhere

    // take = limit + 1: if we get limit+1 rows, there's a next page
    const rows = await db.socialActivity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows

    // Build nextCursor from the last item in the page
    let nextCursor: string | null = null
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]
      nextCursor = encodeCursor({
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      })
    }

    // -------------------------------------------------------------------------
    // Step 3 — batch-fetch actor profiles.
    // -------------------------------------------------------------------------
    const actorIds = Array.from(new Set(pageRows.map((r) => r.actorId)))
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
    // S2: batch-fetch likeCount + likedByMe for all feed activities
    const activityIds = pageRows.map((r) => r.id)
    let likeCountMap = new Map<string, number>()
    let likedByMeSet = new Set<string>()
    if (activityIds.length > 0) {
      const allLikes = await db.like.findMany({
        where: { activityId: { in: activityIds } },
        select: { activityId: true, userId: true },
      })
      for (const like of allLikes) {
        likeCountMap.set(like.activityId, (likeCountMap.get(like.activityId) ?? 0) + 1)
        if (like.userId === session.userId) {
          likedByMeSet.add(like.activityId)
        }
      }
    }

    const activities = pageRows.map((r) => {
      const actor = actorMap.get(r.actorId)
      let parsedMetadata: unknown = {}
      try {
        parsedMetadata = JSON.parse(r.metadata)
      } catch {
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
        restaurantName: typeof sanitizedMetadata.restaurantName === 'string' ? sanitizedMetadata.restaurantName : undefined,
        restaurantId: typeof sanitizedMetadata.restaurantId === 'string' ? sanitizedMetadata.restaurantId : undefined,
        dishName: typeof sanitizedMetadata.dishName === 'string' ? sanitizedMetadata.dishName : undefined,
        targetUserName: typeof sanitizedMetadata.targetUserName === 'string' ? sanitizedMetadata.targetUserName : undefined,
        metadata: sanitizedMetadata,
        visibility: r.visibility,
        likeCount: likeCountMap.get(r.id) ?? 0,
        likedByMe: likedByMeSet.has(r.id),
        createdAt: r.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      activities,
      nextCursor,
      hasMore,
    })
  })
