import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — GET /api/admin/rewards/ledger
// ----------------------------------------------------------------------------
// Admin-scoped paginated view of ALL RewardLedgerEntry rows across ALL users.
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: ADMIN + SUPER_ADMIN only (403 otherwise).
//
// Query params:
//   - page:      page number (1-indexed). Default 1. Min 1.
//   - limit:     page size. Default 20. Min 1. Max 100.
//   - userId?:   exact-match user filter.
//   - type?:     'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST'.
//   - from?:     ISO date — createdAt >= from (inclusive).
//   - to?:       ISO date — createdAt <= to (inclusive).
//
// Response: 200 { entries: [...], total, page, limit, hasMore }
//
// Each entry includes: id, userId, type, points (signed), orderId, ruleId,
// rule (key, name), idempotencyKey (truncated), expiresAt, createdAt.
//
// Governance: additive route (NEW file — does NOT modify the existing
// /api/rewards/ledger user-scoped endpoint or any governance-protected file).
// ----------------------------------------------------------------------------

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const VALID_TYPES = new Set(['EARN', 'REDEEM', 'EXPIRE', 'ADJUST'])

export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN + RBAC — ADMIN + SUPER_ADMIN only.
    // -------------------------------------------------------------------------
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
    if (!['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only admins can view the full reward ledger',
        403,
        { requiredRoles: ['ADMIN', 'SUPER_ADMIN'], actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse + validate query params.
    // -------------------------------------------------------------------------
    const { searchParams } = new URL(req.url)
    const pageRaw = searchParams.get('page') ?? String(DEFAULT_PAGE)
    const limitRaw = searchParams.get('limit') ?? String(DEFAULT_LIMIT)
    const userIdFilter = searchParams.get('userId')?.trim() || null
    const typeFilter = searchParams.get('type')?.trim().toUpperCase() || null
    const fromRaw = searchParams.get('from')?.trim() || null
    const toRaw = searchParams.get('to')?.trim() || null

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

    // Validate date range if provided.
    let fromDate: Date | null = null
    let toDate: Date | null = null
    if (fromRaw) {
      const d = new Date(fromRaw)
      if (Number.isNaN(d.getTime())) {
        return apiError(
          'VALIDATION_ERROR',
          `Invalid 'from' date — must be ISO 8601`,
          400,
          { field: 'from', received: fromRaw },
          traceId,
        ) as unknown as NextResponse
      }
      fromDate = d
    }
    if (toRaw) {
      const d = new Date(toRaw)
      if (Number.isNaN(d.getTime())) {
        return apiError(
          'VALIDATION_ERROR',
          `Invalid 'to' date — must be ISO 8601`,
          400,
          { field: 'to', received: toRaw },
          traceId,
        ) as unknown as NextResponse
      }
      toDate = d
    }

    // -------------------------------------------------------------------------
    // Build the where clause.
    // -------------------------------------------------------------------------
    type Where = {
      userId?: string
      type?: string
      createdAt?: { gte?: Date; lte?: Date }
    }
    const where: Where = {}
    if (userIdFilter) where.userId = userIdFilter
    if (typeFilter) where.type = typeFilter
    if (fromDate || toDate) {
      where.createdAt = {}
      if (fromDate) where.createdAt.gte = fromDate
      if (toDate) where.createdAt.lte = toDate
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
      userId: r.userId,
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
