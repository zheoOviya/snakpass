import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 5 Task 5A — GET /api/rewards/ledger
// ----------------------------------------------------------------------------
// Returns paginated RewardLedgerEntry rows for the current user, newest first.
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role.
//
// Query params:
//   - page:  page number (1-indexed). Default 1. Min 1.
//   - limit: page size. Default 20. Min 1. Max 100 (caps large queries).
//   - type:  optional filter — 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST'.
//
// Response: 200 { entries: [...], total, page, limit, hasMore }
//
// Each entry includes:
//   - id, type, points (signed: + for EARN, - for REDEEM/EXPIRE)
//   - orderId?, ruleId?
//   - idempotencyKey (truncated for display — full key kept for forensics)
//   - createdAt (ISO string)
//   - rule?: { key, name } — joined from RewardRule when ruleId is set
//
// Errors: 400 (invalid pagination params) / 401 (no session).
// ----------------------------------------------------------------------------

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const VALID_TYPES = new Set(['EARN', 'REDEEM', 'EXPIRE', 'ADJUST'])

export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      // Cast to NextResponse<unknown> so the success-path return type unifies
      // (apiError returns NextResponse<ApiError>; without the cast, TS can't
      // infer a single T for withErrorHandler<T>). Same pattern as
      // src/app/api/orders/[id]/accepted/route.ts.
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
    const typeFilter = searchParams.get('type')

    const page = Math.max(1, Number.parseInt(pageRaw, 10) || DEFAULT_PAGE)
    const limitParsed = Number.parseInt(limitRaw, 10) || DEFAULT_LIMIT
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitParsed))

    if (typeFilter !== null && !VALID_TYPES.has(typeFilter)) {
      return apiError(
        'VALIDATION_ERROR',
        `Invalid type filter '${typeFilter}'`,
        400,
        { field: 'type', allowed: Array.from(VALID_TYPES) },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Build the where clause.
    // -------------------------------------------------------------------------
    const where: { userId: string; type?: string } = { userId: session.userId }
    if (typeFilter) {
      where.type = typeFilter
    }

    // -------------------------------------------------------------------------
    // Run count + page in parallel for efficiency.
    // -------------------------------------------------------------------------
    const [total, rows] = await Promise.all([
      db.rewardLedgerEntry.count({ where }),
      db.rewardLedgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          rule: {
            select: { key: true, name: true },
          },
        },
      }),
    ])

    const entries = rows.map((r) => ({
      id: r.id,
      type: r.type,
      points: r.points,
      orderId: r.orderId,
      ruleId: r.ruleId,
      rule: r.rule
        ? { key: r.rule.key, name: r.rule.name }
        : null,
      idempotencyKey: r.idempotencyKey,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }))

    return NextResponse.json({
      entries,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    })
  })
