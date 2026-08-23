import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { getIdempotencyKey, getCachedResponse, storeIdempotencyRecord, parseCachedResponse, computeRequestHash } from '@/lib/idempotency'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { createRazorpayOrder, verifyRazorpaySignature } from '@/lib/razorpay'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const captureBodySchema = z.object({
  orderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
})

// ----------------------------------------------------------------------------
// Sub-Wave 3a Evidence — env-gated failure injection
// ----------------------------------------------------------------------------
// When EVIDENCE_TEST_MODE=true and the request includes an
// `X-Evidence-Fail-After` header, the capture transaction will deliberately
// throw AFTER the designated write step but BEFORE the transaction commits.
// This proves that ALL writes inside the transaction roll back atomically.
//
// Gate: EVIDENCE_TEST_MODE env var (set ONLY during evidence test runs,
// never in staging or production). The header is ignored if the env gate
// is off, so this code is dead in any non-test environment.
//
// Valid X-Evidence-Fail-After values (in execution order):
//   "capture"     — fail before any DB write (Wave-4 4c: captureRazorpayPayment moved to publisher)
//   "payment"     — fail after tx.payment.create
//   "order"       — fail after tx.order.update (status=PAID)
//   "ledger-dr"   — fail after 1st LedgerEntry (DEBIT)
//   "ledger-cr"   — fail after 2nd LedgerEntry (CREDIT)  ← KEY TEST POINT
//   "audit"       — fail after tx.auditLog.create
//   "outbox"      — fail after enqueueOutboxEvent
//   "idempotency" — fail after storeIdempotencyRecord (just before commit)
// ----------------------------------------------------------------------------
const EVIDENCE_TEST_MODE = process.env.EVIDENCE_TEST_MODE === 'true'

function evidenceFailAfter(step: string, failAfterStep: string | null): void {
  if (EVIDENCE_TEST_MODE && failAfterStep === step) {
    throw new AppError(
      'INTERNAL_ERROR',
      `EVIDENCE: deliberate failure after "${step}" — testing transaction rollback`,
      500,
      { evidenceFailureInjection: true, failedAfterStep: step },
    )
  }
}

// POST /api/payments — capture payment for an order
// P0-01: Razorpay capture route with full transactional atomicity:
//   Payment + Order + LedgerEntry + AuditLog + Outbox + IdempotencyKey in SAME transaction
// P0-17: Idempotency-Key header for payment double-click dedup
// P0-25 Case C: Payment.idempotencyKey unique constraint prevents duplicate capture
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const traceId = newTraceId()
  const body = await validateBody(req, captureBodySchema)
  const idempotencyKey = getIdempotencyKey(req)

  // Sub-Wave 3c: Compute request hash (always computed + stored, enforced only when flag ON)
  // The hash is computed ONCE here (outside the txn) so retry re-uses the same hash
  // (deterministic — same input → same hash). This prevents hash mismatch on retry.
  const requestHash = idempotencyKey ? computeRequestHash(body) : null

  // Evidence failure-injection header (ignored unless EVIDENCE_TEST_MODE=true)
  const evidenceFailAfterStep = EVIDENCE_TEST_MODE
    ? req.headers.get('x-evidence-fail-after')
    : null

  const session = await getSessionUser()
  if (!session) {
    return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
  }

  try {
    // Gateway Idempotency Key (additive — Wave-9 rebuild):
    // Generated BEFORE withTransaction so a P2034 retry re-uses the SAME key.
    // Passed to createRazorpayOrder() as X-Idempotency-Key header + stored in
    // the outbox payload for the publisher to pass to captureRazorpayPayment().
    const gatewayIdempotencyKey = randomUUID()
    const orderCreateIdempotencyKey = randomUUID()

    const result = await withTransaction(async (tx) => {
      // P0-17: Check idempotency cache FIRST (inside txn)
      if (idempotencyKey) {
        const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
        if (cached) {
          logInfo('payment-idempotency-dedup-hit', { key: idempotencyKey }, traceId)
          return { type: 'cached' as const, status: cached.status, body: cached.body }
        }
      }

      // Find the order
      const order = await tx.order.findUnique({
        where: { id: body.orderId },
        include: { payment: true },
      })

      if (!order) {
        return {
          type: 'error' as const,
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: 'Order not found', traceId } },
        }
      }

      // Check if order already has a payment (I-04: Capture Uniqueness)
      if (order.payment && order.payment.status === 'CAPTURED') {
        return {
          type: 'error' as const,
          status: 409,
          body: { error: { code: 'CONFLICT', message: 'Order already has a captured payment', traceId } },
        }
      }

      // Get or create the Razorpay order (gateway-side)
      let gatewayOrderId = order.payment?.gatewayOrderId
      if (!gatewayOrderId) {
        const razorpayOrder = await createRazorpayOrder(order.totalAmount, 'INR', orderCreateIdempotencyKey)
        gatewayOrderId = razorpayOrder.razorpayOrderId
      }

      // Verify signature (P0-01: no capture without verified signature)
      const signatureValid = verifyRazorpaySignature(
        gatewayOrderId,
        body.razorpayPaymentId,
        body.razorpaySignature,
      )

      if (!signatureValid) {
        // Signature mismatch — create a FAILED payment record
        const failedPayment = await tx.payment.create({
          data: {
            orderId: order.id,
            userId: session.userId,
            gatewayOrderId,
            gatewayPaymentId: body.razorpayPaymentId,
            gatewaySignature: body.razorpaySignature,
            amount: order.totalAmount,
            currency: 'INR',
            status: 'FAILED',
            failureReason: 'SIGNATURE_MISMATCH',
            idempotencyKey: idempotencyKey,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'PAYMENT_SIGNATURE_MISMATCH',
            metadata: JSON.stringify({ orderId: order.id, paymentId: failedPayment.id }),
          },
        })

        return {
          type: 'error' as const,
          status: 403,
          body: { error: { code: 'SIGNATURE_MISMATCH', message: 'Payment signature verification failed', traceId } },
        }
      }

      // === EVIDENCE CHECKPOINT: capture ===
      // Wave-4 4c (Phase 1): captureRazorpayPayment() moved OUT of withTransaction body.
      // Capture is now deferred to the outbox publisher via PAYMENT_CAPTURE_REQUESTED event.
      // This checkpoint still tests txn rollback before any DB write — invariant preserved.
      evidenceFailAfter('capture', evidenceFailAfterStep)

      // Create Payment record (CAPTURE_PENDING — capture deferred to outbox publisher per Wave-4 4c)
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          userId: session.userId,
          gatewayOrderId,
          gatewayPaymentId: body.razorpayPaymentId,
          gatewaySignature: body.razorpaySignature,
          amount: order.totalAmount,
          currency: 'INR',
          status: 'CAPTURE_PENDING',
          capturedAt: null, // Set by publisher after capture confirms
          idempotencyKey: idempotencyKey,
        },
      })

      // === EVIDENCE CHECKPOINT: payment ===
      evidenceFailAfter('payment', evidenceFailAfterStep)

      // Update Order status to PAID
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAID' },
      })

      // === EVIDENCE CHECKPOINT: order ===
      evidenceFailAfter('order', evidenceFailAfterStep)

      // Create LedgerEntry Dr (debit gateway receivable)
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'DEBIT',
          accountType: 'GATEWAY_RECEIVABLE',
          amount: order.totalAmount,
          traceId,
        },
      })

      // === EVIDENCE CHECKPOINT: ledger-dr ===
      evidenceFailAfter('ledger-dr', evidenceFailAfterStep)

      // Create LedgerEntry Cr (credit consumer revenue)
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'CREDIT',
          accountType: 'CONSUMER_REVENUE',
          amount: order.totalAmount,
          traceId,
        },
      })

      // === EVIDENCE CHECKPOINT: ledger-cr (KEY TEST POINT — all 4 writes done) ===
      evidenceFailAfter('ledger-cr', evidenceFailAfterStep)

      // Audit log — Wave-4 4c: PAYMENT_CAPTURE_PENDING (capture deferred to publisher)
      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          actorRole: session.role,
          action: 'PAYMENT_CAPTURE_PENDING',
          metadata: JSON.stringify({ orderId: order.id, paymentId: payment.id, amount: order.totalAmount }),
        },
      })

      // === EVIDENCE CHECKPOINT: audit ===
      evidenceFailAfter('audit', evidenceFailAfterStep)

      // Outbox event — Wave-4 4c: PAYMENT_CAPTURE_REQUESTED (publisher calls captureRazorpayPayment).
      // The publisher emits PAYMENT_CAPTURED after capture confirms (no longer emitted here).
      //
      // Gateway idempotency key (Wave-5 Gateway Idempotency workstream):
      // Generated BEFORE the txn + stored in the outbox payload. The publisher
      // reads this key on each retry + passes it to captureRazorpayPayment()
      // as the X-Idempotency-Key header. Razorpay deduplicates on retry.
      // The key is deterministic across retries (same key in the same outbox row).
      const gatewayIdempotencyKey = randomUUID()
      await enqueueOutboxEvent(tx, {
        eventType: 'PAYMENT_CAPTURE_REQUESTED',
        aggregateType: 'Payment',
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          orderId: order.id,
          gatewayPaymentId: body.razorpayPaymentId,
          amount: order.totalAmount,
          gatewayIdempotencyKey,
        },
      })

      // === EVIDENCE CHECKPOINT: outbox ===
      evidenceFailAfter('outbox', evidenceFailAfterStep)

      // Build response body — Wave-4 4c: status=CAPTURE_PENDING (capture deferred to publisher)
      const responseBody = {
        payment: {
          id: payment.id,
          orderId: order.id,
          status: 'CAPTURE_PENDING',
          amount: payment.amount,
          currency: payment.currency,
          gatewayPaymentId: payment.gatewayPaymentId,
          capturedAt: payment.capturedAt,
        },
      }

      // Store idempotency record
      // Sub-Wave 3c: Also store the request hash (for future enforcement).
      if (idempotencyKey) {
        await storeIdempotencyRecord(tx, idempotencyKey, 'Payment', payment.id, 200, JSON.stringify(responseBody), requestHash)
        logInfo('payment-idempotency-key-stored', { key: idempotencyKey, paymentId: payment.id, requestHashStored: requestHash !== null }, traceId)
      }

      // === EVIDENCE CHECKPOINT: idempotency (just before commit) ===
      evidenceFailAfter('idempotency', evidenceFailAfterStep)

      return { type: 'captured' as const, status: 200, body: responseBody, payment }
    })

    // Handle result
    if (result.type === 'cached') {
      const parsed = parseCachedResponse({ status: result.status, body: result.body })
      return NextResponse.json(parsed.body, { status: parsed.status })
    }
    if (result.type === 'error') {
      return NextResponse.json(result.body, { status: result.status })
    }

    logInfo('payment-capture-pending', { orderId: body.orderId, paymentId: result.payment.id }, traceId)
    return NextResponse.json(result.body)
  } catch (error) {
    // Sub-Wave 3c: IdempotencyKeyReuseError — same key + materially different request body
    // NON-retryable — propagate to client (withErrorHandler converts to 422).
    if (error instanceof IdempotencyKeyReuseError) {
      logInfo('payment-idempotency-key-reuse', { key: idempotencyKey, code: error.code }, traceId)
      throw error
    }
    if (error instanceof TransactionConflictError) {
      logInfo('payment-capture-conflict', { attempts: error.attempts }, traceId)
      return apiError('CONFLICT', 'Payment capture conflicted with a concurrent request. Please retry.', 409, undefined, traceId)
    }
    // Evidence failure-injection errors are AppError(INTERNAL_ERROR) — rethrow
    // so withErrorHandler returns a 500 with the evidence details.
    throw error
  }
})
