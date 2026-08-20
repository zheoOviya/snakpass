import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import {
  redeemReward,
  type RewardTx,
  type RewardRedemptionRow,
} from '@/lib/rewards-engine'

// ----------------------------------------------------------------------------
// Wave 5 Task 5A — POST /api/rewards/redeem
// ----------------------------------------------------------------------------
// Redeem reward points for a discount code. The caller is the CONSUMER
// themselves (no vendor / admin redemption in this wave — vendor-issued
// discounts go through the existing deals API).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: CONSUMER only. VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN →
//       403 (vendors + admins have vendor-side identities; redemption is a
//       consumer-side action — they'd need to switch to a consumer account).
//
// Body: { points: number, rewardType: 'PERCENT_DISCOUNT'|'FIXED_DISCOUNT'|
//   'FREE_ITEM'|'VENDOR_SPECIFIC', discountValue: number|string, orderId? }
//
//   - points: positive integer (1+). The number of points to redeem.
//   - rewardType: PERCENT_DISCOUNT (discountValue = percent 0..100),
//                 FIXED_DISCOUNT (discountValue = paise amount),
//                 FREE_ITEM (discountValue = menuItemId),
//                 VENDOR_SPECIFIC (discountValue = dealId).
//   - discountValue: stored as STRING on RewardRedemption (per Task 1A
//     schema — type-tagged via rewardType). We accept number OR string here
//     to be lenient about client serialization.
//   - orderId?: optional — set when redeemed against a specific order.
//
// Idempotency:
//   - The client MUST send an `Idempotency-Key` header (recommended) for
//     safe retry semantics. If absent, we generate one server-side from the
//     request body (less robust — a body change would defeat dedup).
//   - The RewardLedgerEntry.idempotencyKey is constructed by redeemReward()
//     as `REDEEM:user:${userId}:${timestamp}:${random}` (per
//     rewards-engine.ts) — unique per call. So redemption is NOT naturally
//     idempotent like issuance; the Idempotency-Key HEADER is the primary
//     dedup mechanism.
//
// Side effects (inside withTransaction):
//   - Load RewardAccount (if missing → 400 NO_ACCOUNT — user hasn't earned
//     any points yet).
//   - Check balance: if points > account.balance → 400 INSUFFICIENT_POINTS.
//   - Call redeemReward(tx, { userId, points, rewardType, discountValue,
//     orderId }):
//       * Create RewardLedgerEntry (type='REDEEM', points=-points).
//       * Create RewardRedemption (1:1 with the ledger entry; single-use
//         redemptionCode 'SNZ-RWD-XXXXXX').
//       * Decrement account.balance + increment account.lifetimeRedeemed.
//   - Audit log: action='REWARD_REDEEMED', metadata={ points, rewardType,
//     discountValue, redemptionCode, orderId }.
//
// Response: 200 { redemption: { id, redemptionCode, points, discountValue,
//   rewardType, createdAt, newBalance } }
// Errors: 400 (VALIDATION_ERROR / NO_ACCOUNT / INSUFFICIENT_POINTS) /
//         401 (no session) / 403 (RBAC) / 409 (transaction conflict) /
//         422 (Idempotency-Key reuse).
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'RewardRedeem'

const VALID_REWARD_TYPES = new Set([
  'PERCENT_DISCOUNT',
  'FIXED_DISCOUNT',
  'FREE_ITEM',
  'VENDOR_SPECIFIC',
])

interface RedeemRequestBody {
  points?: unknown
  rewardType?: unknown
  discountValue?: unknown
  orderId?: unknown
}

export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
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

    // -------------------------------------------------------------------------
    // RBAC — CONSUMER only.
    // -------------------------------------------------------------------------
    if (session.role !== 'CONSUMER') {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only consumers can redeem their own reward points',
        403,
        { requiredRoles: ['CONSUMER'], actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse + validate body.
    // -------------------------------------------------------------------------
    let body: RedeemRequestBody = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as RedeemRequestBody
      }
    } catch {
      // ignore — falls through to validation below
    }

    const pointsRaw = body.points
    const rewardTypeRaw = body.rewardType
    const discountValueRaw = body.discountValue
    const orderIdRaw = body.orderId

    if (typeof pointsRaw !== 'number' || !Number.isInteger(pointsRaw) || pointsRaw <= 0) {
      return apiError(
        'VALIDATION_ERROR',
        'points must be a positive integer',
        400,
        { field: 'points', received: pointsRaw },
        traceId,
      ) as unknown as NextResponse
    }
    const points = pointsRaw

    if (typeof rewardTypeRaw !== 'string' || !VALID_REWARD_TYPES.has(rewardTypeRaw)) {
      return apiError(
        'VALIDATION_ERROR',
        `Invalid rewardType '${String(rewardTypeRaw)}'`,
        400,
        { field: 'rewardType', allowed: Array.from(VALID_REWARD_TYPES) },
        traceId,
      ) as unknown as NextResponse
    }
    const rewardType = rewardTypeRaw as
      | 'PERCENT_DISCOUNT'
      | 'FIXED_DISCOUNT'
      | 'FREE_ITEM'
      | 'VENDOR_SPECIFIC'

    // discountValue can be number (percent / paise) or string (menuItemId /
    // dealId). Normalize to string for storage (RewardRedemption.discountValue
    // is String per Task 1A schema).
    if (
      discountValueRaw === null ||
      discountValueRaw === undefined ||
      (typeof discountValueRaw !== 'number' && typeof discountValueRaw !== 'string')
    ) {
      return apiError(
        'VALIDATION_ERROR',
        'discountValue is required (number or string)',
        400,
        { field: 'discountValue', received: discountValueRaw },
        traceId,
      ) as unknown as NextResponse
    }
    const discountValue = String(discountValueRaw)

    // PERCENT_DISCOUNT: validate 0..100 range.
    if (rewardType === 'PERCENT_DISCOUNT') {
      const percent = Number(discountValue)
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return apiError(
          'VALIDATION_ERROR',
          'PERCENT_DISCOUNT discountValue must be 0..100',
          400,
          { field: 'discountValue', received: discountValue },
          traceId,
        ) as unknown as NextResponse
      }
    }
    // FIXED_DISCOUNT: validate non-negative integer paise.
    if (rewardType === 'FIXED_DISCOUNT') {
      const paise = Number(discountValue)
      if (!Number.isFinite(paise) || paise < 0 || !Number.isInteger(paise)) {
        return apiError(
          'VALIDATION_ERROR',
          'FIXED_DISCOUNT discountValue must be a non-negative integer (paise)',
          400,
          { field: 'discountValue', received: discountValue },
          traceId,
        ) as unknown as NextResponse
      }
    }

    const orderId =
      typeof orderIdRaw === 'string' && orderIdRaw.trim().length > 0
        ? orderIdRaw.trim()
        : undefined

    // -------------------------------------------------------------------------
    // Idempotency-Key header (STRONGLY recommended). The client should send
    // one for retry safety. If absent, we generate one server-side.
    // -------------------------------------------------------------------------
    let idempotencyKey = getIdempotencyKey(req)
    if (!idempotencyKey) {
      // Generate a deterministic key from the request body (less robust than
      // a client-provided UUID — a body change defeats dedup — but better
      // than nothing for clients that don't send the header).
      idempotencyKey = `REDEEM-${session.userId}-${computeRequestHash(body).slice(0, 16)}`
    }
    const requestHash = computeRequestHash(body)

    try {
      const result = await withTransaction(async (tx) => {
        const rtx = tx as unknown as RewardTx

        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        const cached = await getCachedResponse(tx, idempotencyKey as string, requestHash)
        if (cached) {
          logInfo(
            'rewards-redeem-idempotency-dedup-hit',
            { key: idempotencyKey, userId: session.userId },
            traceId,
          )
          return { type: 'cached' as const, status: cached.status, body: cached.body }
        }

        // -------------------------------------------------------------------
        // Pre-check: account must exist.
        // -------------------------------------------------------------------
        const account = await rtx.rewardAccount.findUnique({
          where: { userId: session.userId },
        })
        if (!account) {
          return {
            type: 'error' as const,
            status: 400,
            body: {
              error: {
                code: 'NO_ACCOUNT',
                message: 'No reward account found — place an order to start earning points.',
                traceId,
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // Pre-check: balance must be sufficient. (redeemReward also checks
        // inside its own transaction, but pre-checking here lets us return
        // a cleaner 400 INSUFFICIENT_POINTS before any writes happen.)
        // -------------------------------------------------------------------
        if (account.balance < points) {
          return {
            type: 'error' as const,
            status: 400,
            body: {
              error: {
                code: 'INSUFFICIENT_POINTS',
                message: `Insufficient reward points (have ${account.balance}, need ${points}).`,
                traceId,
                details: { balance: account.balance, requested: points },
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // Delegate to rewards-engine.redeemReward for the atomic ledger +
        // redemption write. Throws Error on insufficient balance (already
        // pre-checked above) — the throw propagates + rolls back.
        // -------------------------------------------------------------------
        let redemption: RewardRedemptionRow
        let newBalance: number
        try {
          const r = await redeemReward(rtx, {
            userId: session.userId,
            points,
            rewardType,
            discountValue,
            orderId,
          })
          redemption = r.redemption
          newBalance = r.newBalance
        } catch (err) {
          const msg = (err as Error).message ?? ''
          if (msg.includes('insufficient balance')) {
            return {
              type: 'error' as const,
              status: 400,
              body: {
                error: {
                  code: 'INSUFFICIENT_POINTS',
                  message: 'Insufficient reward points.',
                  traceId,
                  details: { balance: account.balance, requested: points },
                },
              },
            }
          }
          throw err
        }

        // -------------------------------------------------------------------
        // Audit log — REWARD_REDEEMED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'REWARD_REDEEMED',
            metadata: JSON.stringify({
              userId: session.userId,
              points,
              rewardType,
              discountValue,
              redemptionCode: redemption.redemptionCode,
              redemptionId: redemption.id,
              orderId: orderId ?? null,
              newBalance,
            }),
          },
        })

        const responseBody = {
          redemption: {
            id: redemption.id,
            redemptionCode: redemption.redemptionCode,
            points,
            discountValue,
            rewardType,
            orderId: redemption.orderId,
            createdAt: redemption.redeemedAt.toISOString(),
            newBalance,
          },
        }

        await storeIdempotencyRecord(
          tx,
          idempotencyKey as string,
          IDEMPOTENCY_RESOURCE_TYPE,
          redemption.id,
          200,
          JSON.stringify(responseBody),
          requestHash,
        )

        return { type: 'success' as const, status: 200, body: responseBody }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'success': {
          logInfo(
            'rewards-redeem-success',
            {
              userId: session.userId,
              points,
              rewardType,
              redemptionCode: result.body.redemption.redemptionCode,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          // Exhaustiveness guard
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'rewards-redeem-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        logInfo(
          'rewards-redeem-conflict',
          { attempts: error.attempts, code: error.code, userId: session.userId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Redemption conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
