import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody, giftRedeemSchema } from '@/lib/validation'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import { redeemGift } from '@/lib/gift-service'

// ----------------------------------------------------------------------------
// Wave 6 Task 6C — POST /api/gifts/[id]/redeem — recipient redeems a gift
// ----------------------------------------------------------------------------
// Recipient redeems an AVAILABLE gift. Creates a NEW zero-amount Order for
// the recipient (userId=recipientId, totalAmount=0,
// note=`GIFT_FROM:${senderId}:${giftId}`) + transitions Gift.status → REDEEMED
// + recipientOrderId + redeemedAt.
//
// Auth: getSessionUser() required (401 if no session).
// Authorization: caller must be the gift.recipientId (403 otherwise).
// Validation: gift must be status=AVAILABLE (409 if not — already redeemed,
//             expired, cancelled). Body's redemptionCode must match the
//             gift's stored code (extra fraud control — 403 on mismatch).
//
// Idempotent: if the gift is already REDEEMED, returns the existing
// recipientOrderId without creating a duplicate Order.
//
// Body: { redemptionCode: string } — the single-use code from the gift.
//
// Returns: { order: { id, status, totalAmount, pickupOtp, note }, gift: {...} }
//
// The recipient then picks up this zero-amount order normally (via the
// existing /api/orders/[id]/pickup/verify endpoint — no payment needed).
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'GiftRedeem'

export const POST = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: giftId } = await params

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
    // Validate body
    // -------------------------------------------------------------------------
    const body = await validateBody(req, giftRedeemSchema)
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash({ ...body, giftId }) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'gift-redeem-idempotency-dedup-hit',
              { key: idempotencyKey, giftId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Authorization check (BEFORE calling redeemGift — the service
        // function trusts the caller's authorization + recipientId).
        // Load the gift + verify session.userId === gift.recipientId.
        // -------------------------------------------------------------------
        const gift = await tx.gift.findUnique({
          where: { id: giftId },
          select: {
            id: true,
            recipientId: true,
            senderId: true,
            status: true,
            redemptionCode: true,
          },
        })
        if (!gift) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: `Gift ${giftId} not found`,
                traceId,
              },
            },
          }
        }
        if (gift.recipientId !== session.userId) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'Only the gift recipient can redeem this gift',
                traceId,
                details: { giftId, userId: session.userId },
              },
            },
          }
        }
        // Extra fraud control: verify the submitted redemptionCode matches.
        // The redemptionCode is the single-use credential — recipient must
        // have it to redeem (prevents unauthorized redemption if the gift
        // somehow leaks).
        if (gift.redemptionCode !== body.redemptionCode) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'Invalid redemption code',
                traceId,
                details: { giftId },
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // Delegate to gift-service.redeemGift for the atomic mutation.
        // Throws AppError on:
        //   - NOT_FOUND: gift doesn't exist (already checked above — defensive)
        //   - CONFLICT: gift is not in AVAILABLE status (already redeemed,
        //     expired, cancelled) — returns 409
        //   - INTERNAL_ERROR: order creation failed (very rare)
        // -------------------------------------------------------------------
        let redeemed
        try {
          redeemed = await redeemGift(tx, {
            giftId,
            recipientId: session.userId,
            recipientRole: session.role,
            traceId,
          })
        } catch (err) {
          // Map AppError to the route's error envelope.
          if (err instanceof AppError) {
            return {
              type: 'error' as const,
              status: err.statusCode,
              body: {
                error: {
                  code: err.code,
                  message: err.message,
                  traceId,
                  details: err.details,
                },
              },
            }
          }
          throw err
        }

        const responseBody = {
          order: {
            id: redeemed.order.id,
            status: redeemed.order.status,
            totalAmount: redeemed.order.totalAmount,
            pickupOtp: redeemed.order.pickupOtp,
            note: redeemed.order.note,
          },
          gift: {
            id: redeemed.gift.id,
            status: redeemed.gift.status,
            recipientOrderId: redeemed.gift.recipientOrderId,
            redeemedAt: redeemed.gift.redeemedAt?.toISOString() ?? null,
          },
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            redeemed.order.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'gift-redeem-idempotency-key-stored',
            { key: idempotencyKey, giftId, orderId: redeemed.order.id },
            traceId,
          )
        }

        return { type: 'redeemed' as const, status: 200, body: responseBody, orderId: redeemed.order.id }
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
        case 'redeemed': {
          logInfo(
            'gift-redeem-success',
            { giftId, orderId: result.orderId, recipientId: session.userId },
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
      // Sub-Wave 3c: IdempotencyKeyReuseError — same key + different body.
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'gift-redeem-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'gift-redeem-conflict',
          { attempts: error.attempts, code: error.code, giftId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Gift redemption conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
