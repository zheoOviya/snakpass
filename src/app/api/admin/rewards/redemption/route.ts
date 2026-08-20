import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — GET /api/admin/rewards/redemption?code=SNZ-RWD-XXXXXX
// ----------------------------------------------------------------------------
// Admin lookup of a RewardRedemption by its single-use code. Used by the
// Rewards admin module to inspect / debug redemptions (status, points,
// reward type, discount value, order context).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: ADMIN + SUPER_ADMIN only (403 otherwise).
//
// Query params:
//   - code: the redemption code (e.g., "SNZ-RWD-AB12CD"). Required.
//
// Response: 200 { redemption: {...}, ledgerEntry: {...} } on found.
// Errors:
//   - 400 VALIDATION_ERROR (missing code)
//   - 401 AUTHENTICATION_REQUIRED
//   - 403 AUTHORIZATION_DENIED
//   - 404 NOT_FOUND (no redemption with that code)
//
// Governance: additive route (NEW file — no modification to existing
// /api/rewards/redeem POST endpoint or any governance-protected file).
// ----------------------------------------------------------------------------

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
        'Only admins can look up redemptions',
        403,
        { requiredRoles: ['ADMIN', 'SUPER_ADMIN'], actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse + validate query params.
    // -------------------------------------------------------------------------
    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')?.trim() || ''

    if (!code) {
      return apiError(
        'VALIDATION_ERROR',
        'code query param is required',
        400,
        { field: 'code' },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Look up the redemption + its 1:1 ledger entry.
    // -------------------------------------------------------------------------
    const redemption = await db.rewardRedemption.findUnique({
      where: { redemptionCode: code },
      include: {
        ledgerEntry: {
          include: {
            rule: {
              select: { key: true, name: true },
            },
          },
        },
      },
    })

    if (!redemption) {
      return apiError(
        'NOT_FOUND',
        `No redemption found for code '${code}'`,
        404,
        { code },
        traceId,
      ) as unknown as NextResponse
    }

    return NextResponse.json({
      redemption: {
        id: redemption.id,
        userId: redemption.userId,
        ledgerEntryId: redemption.ledgerEntryId,
        rewardType: redemption.rewardType,
        discountValue: redemption.discountValue,
        orderId: redemption.orderId,
        redemptionCode: redemption.redemptionCode,
        redeemedAt: redemption.redeemedAt.toISOString(),
        ruleRuleId: redemption.ruleRuleId,
      },
      ledgerEntry: redemption.ledgerEntry
        ? {
            id: redemption.ledgerEntry.id,
            userId: redemption.ledgerEntry.userId,
            type: redemption.ledgerEntry.type,
            points: redemption.ledgerEntry.points,
            orderId: redemption.ledgerEntry.orderId,
            ruleId: redemption.ledgerEntry.ruleId,
            rule: redemption.ledgerEntry.rule
              ? {
                  key: redemption.ledgerEntry.rule.key,
                  name: redemption.ledgerEntry.rule.name,
                }
              : null,
            idempotencyKey: redemption.ledgerEntry.idempotencyKey,
            expiresAt: redemption.ledgerEntry.expiresAt
              ? redemption.ledgerEntry.expiresAt.toISOString()
              : null,
            createdAt: redemption.ledgerEntry.createdAt.toISOString(),
          }
        : null,
    })
  })
