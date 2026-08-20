import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import { cancelGift } from '@/lib/gift-service'

// ----------------------------------------------------------------------------
// Wave 6 Task 6C — POST /api/gifts/[id]/cancel — sender cancels a gift
// ----------------------------------------------------------------------------
// Sender cancels an unclaimed gift. If the gift was PAID (ghost order has a
// Payment), triggers a refund inline (mirrors /api/payments/refund POST logic
// but direct — additive only — preserves refund route governance).
//
// Auth: getSessionUser() required (401 if no session).
// Authorization: caller must be the gift.senderId (403 otherwise).
// Validation: gift must be status=CREATED | PAID | AVAILABLE (409 otherwise —
//              can't cancel REDEEMED / EXPIRED / CANCELLED / REFUNDED).
//
// Idempotent: if already CANCELLED or REFUNDED, returns the existing gift
// state without re-processing the refund.
//
// Body: {} (no body required — giftId comes from the URL)
//
// Returns: { gift: { id, status, cancelledAt, refundedAt }, refund: { id,
//           status, amount } | null }
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'GiftCancel'

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
    // Compute idempotency hash BEFORE the transaction (deterministic — same on retry).
    // The body is empty (giftId comes from URL) — we hash the giftId so a
    // cancel-then-cancel-again with the same key returns the cached response.
    // -------------------------------------------------------------------------
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash({ giftId }) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'gift-cancel-idempotency-dedup-hit',
              { key: idempotencyKey, giftId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Authorization check (BEFORE calling cancelGift — the service
        // function trusts the caller's authorization + senderId).
        // Load the gift + verify session.userId === gift.senderId.
        // ADMIN + SUPER_ADMIN may also cancel (read-only audit support —
        // operational override for fraud/incident response).
        // -------------------------------------------------------------------
        const gift = await tx.gift.findUnique({
          where: { id: giftId },
          select: {
            id: true,
            senderId: true,
            recipientId: true,
            status: true,
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
        const isSender = gift.senderId === session.userId
        const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
        if (!isSender && !isAdmin) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'Only the gift sender can cancel this gift',
                traceId,
                details: { giftId, userId: session.userId },
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // Delegate to gift-service.cancelGift for the atomic mutation.
        // Throws AppError on:
        //   - NOT_FOUND: gift doesn't exist (already checked above — defensive)
        //   - CONFLICT: gift is in REDEEMED / EXPIRED / CANCELLED status —
        //     returns 409
        //   - INTERNAL_ERROR: refund/payment mismatch
        // -------------------------------------------------------------------
        let cancelled
        try {
          cancelled = await cancelGift(tx, {
            giftId,
            senderId: session.userId,
            senderRole: session.role,
            traceId,
          })
        } catch (err) {
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
          gift: {
            id: cancelled.gift.id,
            status: cancelled.gift.status,
            cancelledAt: cancelled.gift.cancelledAt?.toISOString() ?? null,
            refundedAt: cancelled.gift.refundedAt?.toISOString() ?? null,
          },
          refund: cancelled.refund.id
            ? {
                id: cancelled.refund.id,
                status: cancelled.refund.status,
                amount: cancelled.refund.amount,
              }
            : null,
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            cancelled.gift.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'gift-cancel-idempotency-key-stored',
            { key: idempotencyKey, giftId },
            traceId,
          )
        }

        return { type: 'cancelled' as const, status: 200, body: responseBody }
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
        case 'cancelled': {
          logInfo(
            'gift-cancel-success',
            { giftId, senderId: session.userId, status: result.body.gift.status },
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
          'gift-cancel-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'gift-cancel-conflict',
          { attempts: error.attempts, code: error.code, giftId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Gift cancellation conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
