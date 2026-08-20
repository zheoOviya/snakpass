import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { avatarColorForUserId } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 6 Task 6A — GET /api/social/search
// ----------------------------------------------------------------------------
// Search for users by name OR phone (contains match). Excludes self + users
// with whom the current user already has a SocialConnection (any status).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role.
//
// Query params:
//   - q:  search query (name OR phone, contains match). Required, min length 2.
//
// Response shape (per task spec):
//   { users: [{ id, name, phone, avatarColor }] }
//
// Privacy:
//   - NEVER expose email (per task spec).
//   - Phone is included because the user explicitly searched by it (the user
//     already knows the phone they're searching for).
//   - Results are capped at 20 (prevents trivial data exfiltration).
//
// Errors: 400 (invalid query) / 401 (no session) / 500 (internal).
// ----------------------------------------------------------------------------

const MAX_RESULTS = 20
const MIN_QUERY_LENGTH = 2

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

    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()

    if (q.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ users: [] })
    }

    // -------------------------------------------------------------------------
    // Step 1 — find all SocialConnection peer user IDs for the current user.
    // (Either direction — sent OR received. We exclude ALL of them from search
    // results so the user doesn't see people they're already connected with,
    // even if the connection is PENDING/REJECTED/BLOCKED.)
    // -------------------------------------------------------------------------
    const conns = await db.socialConnection.findMany({
      where: {
        OR: [
          { followerId: session.userId },
          { followeeId: session.userId },
        ],
      },
      select: {
        followerId: true,
        followeeId: true,
      },
    })

    const excludedIds = new Set<string>([session.userId])
    for (const c of conns) {
      excludedIds.add(c.followerId)
      excludedIds.add(c.followeeId)
    }

    // -------------------------------------------------------------------------
    // Step 2 — search users by name OR phone (contains match, case-insensitive).
    //
    // Note: SQLite's `contains` is case-insensitive for ASCII by default. For
    // phone-number search, this is also a contains match (e.g. "9876" matches
    // "+919876500001"). For Indian phone numbers, users typically search by
    // last 4-10 digits.
    // -------------------------------------------------------------------------
    const users = await db.user.findMany({
      where: {
        AND: [
          {
            id: { notIn: Array.from(excludedIds) },
          },
          {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
      take: MAX_RESULTS,
      orderBy: { createdAt: 'desc' },
    })

    const result = users.map((u) => ({
      id: u.id,
      name: u.name ?? 'Unknown',
      phone: u.phone,
      avatarColor: avatarColorForUserId(u.id),
    }))

    return NextResponse.json({ users: result })
  })
