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
//   - q:  search query (name OR phone, contains match).
//
// S4B Privacy/Abuse Repair-03:
//   - P1-A: Response MINIMIZED — returns only { id, name, avatarColor }.
//     NO phone field exposed (prevents PII disclosure). The server may still
//     match by phone internally, but never echoes the stored phone back.
//   - P1-B: Enumeration resistance — digit-only queries require min 4 chars,
//     all other queries require min 3 chars. Prevents 2-char broad enumeration.
//   - P4-B: Route-local per-user rate limit (20/min/user). The middleware
//     applies an IP-based 30/min fail-closed bucket (P4-C); this route adds a
//     per-USER dimension so rotating IP/XFF cannot escape the user quota.
//   - MAX_RESULTS = 20 retained (no pagination added in S4B).
//
// Response shape:
//   { users: [{ id, name, avatarColor }] }
//
// Errors: 400 (invalid query) / 401 (no session) / 429 (rate limited) / 500.
// ----------------------------------------------------------------------------

const MAX_RESULTS = 20
const MIN_NAME_QUERY_LENGTH = 3
const MIN_DIGIT_QUERY_LENGTH = 4

// S4B P4-B: Route-local per-user rate limiter (in-memory, fail-closed).
// 20 searches per minute per authenticated user. This is SEPARATE from the
// middleware IP-based bucket (30/min/IP fail-closed) — both must pass.
// Rotating XFF or IP cannot reset this per-user quota.
const SEARCH_USER_LIMIT = 20
const SEARCH_USER_WINDOW_MS = 60_000
const searchUserStore = new Map<string, { count: number; windowStart: number }>()

function checkSearchUserLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = searchUserStore.get(userId)
  if (!entry || now - entry.windowStart > SEARCH_USER_WINDOW_MS) {
    searchUserStore.set(userId, { count: 1, windowStart: now })
    return { allowed: true, remaining: SEARCH_USER_LIMIT - 1 }
  }
  if (entry.count >= SEARCH_USER_LIMIT) {
    return { allowed: false, remaining: 0 }
  }
  entry.count++
  return { allowed: true, remaining: SEARCH_USER_LIMIT - entry.count }
}

function isDigitOnly(s: string): boolean {
  return /^\d+$/.test(s)
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

    // S4B P4-B: Per-user rate limit (fail-closed). This is independent of the
    // middleware IP-based bucket. Rotating XFF or source IP does NOT reset
    // this per-user quota.
    const userLimit = checkSearchUserLimit(session.userId)
    if (!userLimit.allowed) {
      return apiError(
        'RATE_LIMITED',
        'Too many search requests. Please slow down.',
        429,
        { retryAfter: 60, remaining: 0, scope: 'per-user' },
        traceId,
      ) as unknown as NextResponse
    }

    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()

    // S4B P1-B: Enumeration resistance.
    // Digit-only queries (phone fragments) require min 4 chars.
    // All other queries (names) require min 3 chars.
    const minLen = isDigitOnly(q) ? MIN_DIGIT_QUERY_LENGTH : MIN_NAME_QUERY_LENGTH
    if (q.length < minLen) {
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
    //
    // S4B P1-A: The `phone` field is used ONLY for matching — it is NOT included
    // in the response projection. This prevents PII disclosure while still
    // allowing phone-based discovery.
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
      },
      take: MAX_RESULTS,
      orderBy: { createdAt: 'desc' },
    })

    // S4B P1-A: Response MINIMIZED — only { id, name, avatarColor }.
    // NO phone field. UI renders "SnakZap user" as a neutral label.
    const result = users.map((u) => ({
      id: u.id,
      name: u.name ?? 'Unknown',
      avatarColor: avatarColorForUserId(u.id),
    }))

    return NextResponse.json({ users: result })
  })
