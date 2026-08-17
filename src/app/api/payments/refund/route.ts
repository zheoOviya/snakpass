import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { getIdempotencyKey, getCachedResponse, storeIdempotencyRecord, parseCachedResponse, computeRequestHash } from '@/lib/idempotency'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { randomUUID } from 'crypto'
import { z } from 'zod'

// ----------------------------------------------------------------------------
// P0-04 Wave-5 Sub-Wave 5a — Refund route (mirrors 4c capture architecture)
// ----------------------------------------------------------------------------
// POST /api/payments/refund
//
// Body: { paymentId: string, amount?: number }
//   - paymentId: an existing CAPTURED Payment to refund
//   - amount (optional): refund amount in paise. Defaults to Payment.amount (full
//     refund). For a partial refund, must be 0 < amount < Payment.amount.
//
// Header: Idempotency-Key (optional but strongly recommended — same key on retry
//         returns the cached Refund instead of creating a duplicate).
//
// Transaction body (atomic — ALL succeed or ALL roll back):
//   1. Idempotency cache check (getCachedResponse)
//   2. Read Payment; assert status === 'CAPTURED' (can only refund captured)
//   3. Assert Payment.frozen === false (frozen payments cannot be refunded)
//   4. Compute refund amount (default: full; partial if amount provided)
//   5. Create Refund record (status='REFUND_PENDING')
//   6. Create reversal LedgerEntry pair:
//        DEBIT  CONSUMER_REVENUE    (reverses the original capture credit)
//        CREDIT GATEWAY_RECEIVABLE  (reverses the original capture debit)
//      Dr/Cr are reversed relative to the capture flow — the ledger remains
//      balanced (I-06 invariant): every credit has a matching debit.
//   7. AuditLog (PAYMENT_REFUND_PENDING)
//   8. Outbox event PAYMENT_REFUND_REQUESTED (publisher calls refundRazorpayPayment)
//   9. Store IdempotencyKey record
//
// Per Wave-4 4c TRANSACTION_RETRY_INVARIANT:
//   - refundRazorpayPayment() is NOT called here. It's deferred to the publisher
//     via PAYMENT_REFUND_REQUESTED. This guarantees the external HTTP call is
//     never re-executed on a P2034 retry of this transaction.
//   - Refund.status starts as REFUND_PENDING. The publisher transitions it to
//     REFUNDED (and Payment.status to REFUNDED for a full refund) in a new
//     transaction after the gateway confirms.
// ----------------------------------------------------------------------------

const refundBodySchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().int().positive().optional(),
})

export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const traceId = newTraceId()
  const body = await validateBody(req, refundBodySchema)
  const idempotencyKey = getIdempotencyKey(req)

  // Sub-Wave 3c: compute request hash (always computed + stored, enforced only
  // when requestHashEnforcement flag is ON). Computed ONCE here (outside txn)
  // so retry re-uses the same hash (deterministic).
  const requestHash = idempotencyKey ? computeRequestHash(body) : null

  const session = await getSessionUser()
  if (!session) {
    return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
  }

  try {
    const result = await withTransaction(async (tx) => {
      // P0-17: Check idempotency cache FIRST (inside txn)
      if (idempotencyKey) {
        const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
        if (cached) {
          logInfo('refund-idempotency-dedup-hit', { key: idempotencyKey }, traceId)
          return { type: 'cached' as const, status: cached.status, body: cached.body }
        }
      }

      // Find the Payment
      const payment = await tx.payment.findUnique({
        where: { id: body.paymentId },
        select: {
          id: true,
          orderId: true,
          userId: true,
          amount: true,
          currency: true,
          status: true,
          frozen: true,
          gatewayPaymentId: true,
          capturedAt: true,
          version: true,
        },
      })

      if (!payment) {
        return {
          type: 'error' as const,
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: 'Payment not found', traceId } },
        }
      }

      // Authorization: only the payment owner or an ADMIN can refund.
      if (payment.userId !== session.userId && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN') {
        return {
          type: 'error' as const,
          status: 403,
          body: { error: { code: 'AUTHORIZATION_DENIED', message: 'Not authorized to refund this payment', traceId } },
        }
      }

      // I-04 / P0-04 invariant: can only refund CAPTURED payments.
      if (payment.status !== 'CAPTURED') {
        return {
          type: 'error' as const,
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: `Payment status is ${payment.status} — only CAPTURED payments can be refunded`,
              traceId,
            },
          },
        }
      }

      // P0-28: frozen payments cannot be refunded (admin must unfreeze first).
      if (payment.frozen) {
        return {
          type: 'error' as const,
          status: 409,
          body: { error: { code: 'CONFLICT', message: 'Payment is frozen — refund blocked', traceId } },
        }
      }

      // Compute refund amount (default: full refund).
      const refundAmount = body.amount ?? payment.amount

      // Sanity: refund amount cannot exceed the payment amount.
      if (refundAmount > payment.amount) {
        return {
          type: 'error' as const,
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: `Refund amount (${refundAmount}) exceeds payment amount (${payment.amount})`,
              traceId,
            },
          },
        }
      }

      // Create Refund record (status='REFUND_PENDING').
      // The publisher will transition it to REFUNDED after refundRazorpayPayment
      // confirms (outside any txn — Wave-4 4c pattern).
      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: refundAmount,
          currency: payment.currency,
          status: 'REFUND_PENDING',
          idempotencyKey: idempotencyKey,
        },
      })

      // Reversal LedgerEntry: DEBIT CONSUMER_REVENUE
      // (Reverses the original capture flow's CREDIT CONSUMER_REVENUE entry.)
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'DEBIT',
          accountType: 'CONSUMER_REVENUE',
          amount: refundAmount,
          traceId,
        },
      })

      // Reversal LedgerEntry: CREDIT GATEWAY_RECEIVABLE
      // (Reverses the original capture flow's DEBIT GATEWAY_RECEIVABLE entry.)
      // Dr/Cr balanced: sum(DEBIT) === sum(CREDIT) per Payment (I-06 invariant
      // remains intact — reversal Dr/Cr pair matches in magnitude).
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'CREDIT',
          accountType: 'GATEWAY_RECEIVABLE',
          amount: refundAmount,
          traceId,
        },
      })

      // AuditLog — PAYMENT_REFUND_PENDING (refund deferred to publisher per 4c).
      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          actorRole: session.role,
          action: 'PAYMENT_REFUND_PENDING',
          metadata: JSON.stringify({
            paymentId: payment.id,
            orderId: payment.orderId,
            refundId: refund.id,
            amount: refundAmount,
            fullRefund: refundAmount === payment.amount,
          }),
        },
      })

      // Outbox event — PAYMENT_REFUND_REQUESTED (publisher calls
      // refundRazorpayPayment). The publisher emits PAYMENT_REFUNDED after the
      // gateway confirms (not emitted here — same as 4c capture pattern).
      //
      // Gateway idempotency key (Wave-5 Gateway Idempotency workstream):
      // Generated BEFORE the txn + stored in the outbox payload. The publisher
      // reads this key on each retry + passes it to refundRazorpayPayment()
      // as the X-Idempotency-Key header. Razorpay deduplicates on retry.
      const gatewayIdempotencyKey = randomUUID()
      await enqueueOutboxEvent(tx, {
        eventType: 'PAYMENT_REFUND_REQUESTED',
        aggregateType: 'Refund',
        aggregateId: refund.id,
        payload: {
          refundId: refund.id,
          paymentId: payment.id,
          orderId: payment.orderId,
          gatewayPaymentId: payment.gatewayPaymentId,
          amount: refundAmount,
          currency: payment.currency,
          fullRefund: refundAmount === payment.amount,
          gatewayIdempotencyKey,
        },
      })

      // Build response body — status=REFUND_PENDING (refund deferred to publisher)
      const responseBody = {
        refund: {
          id: refund.id,
          paymentId: payment.id,
          status: 'REFUND_PENDING',
          amount: refund.amount,
          currency: refund.currency,
          fullRefund: refundAmount === payment.amount,
        },
      }

      // Store idempotency record (Sub-Wave 3c: also stores request hash).
      if (idempotencyKey) {
        await storeIdempotencyRecord(tx, idempotencyKey, 'Refund', refund.id, 200, JSON.stringify(responseBody), requestHash)
        logInfo('refund-idempotency-key-stored', { key: idempotencyKey, refundId: refund.id, requestHashStored: requestHash !== null }, traceId)
      }

      return { type: 'created' as const, status: 200, body: responseBody, refund }
    })

    // Handle result
    if (result.type === 'cached') {
      const parsed = parseCachedResponse({ status: result.status, body: result.body })
      return NextResponse.json(parsed.body, { status: parsed.status })
    }
    if (result.type === 'error') {
      return NextResponse.json(result.body, { status: result.status })
    }

    logInfo('refund-pending', { paymentId: body.paymentId, refundId: result.refund.id }, traceId)
    return NextResponse.json(result.body)
  } catch (error) {
    // Sub-Wave 3c: IdempotencyKeyReuseError — same key + materially different request body
    if (error instanceof IdempotencyKeyReuseError) {
      logInfo('refund-idempotency-key-reuse', { key: idempotencyKey, code: error.code }, traceId)
      throw error
    }
    if (error instanceof TransactionConflictError) {
      logInfo('refund-conflict', { attempts: error.attempts }, traceId)
      return apiError('CONFLICT', 'Refund conflicted with a concurrent request. Please retry.', 409, undefined, traceId)
    }
    // Evidence failure-injection errors (if we add them later) would be AppError
    // (INTERNAL_ERROR) — rethrow so withErrorHandler returns 500 with details.
    if (error instanceof AppError) throw error
    throw error
  }
})
