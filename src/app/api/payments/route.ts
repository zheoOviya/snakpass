import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError, AppError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { getIdempotencyKey, getCachedResponse, storeIdempotencyRecord, parseCachedResponse } from '@/lib/idempotency'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { createRazorpayOrder, verifyRazorpaySignature, captureRazorpayPayment } from '@/lib/razorpay'
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
//   "capture"     — fail after captureRazorpayPayment() (before any DB write)
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

  // Evidence failure-injection header (ignored unless EVIDENCE_TEST_MODE=true)
  const evidenceFailAfterStep = EVIDENCE_TEST_MODE
    ? req.headers.get('x-evidence-fail-after')
    : null

  const session = await getSessionUser()
  if (!session) {
    return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
  }

  try {
    const result = await withTransaction(async (tx) => {
      // P0-17: Check idempotency cache FIRST (inside txn)
      if (idempotencyKey) {
        const cached = await getCachedResponse(tx, idempotencyKey)
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
        const razorpayOrder = await createRazorpayOrder(order.totalAmount, 'INR')
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

      // Capture payment (gateway call — outside txn if real, mock if demo)
      const captureResult = await captureRazorpayPayment(body.razorpayPaymentId, order.totalAmount, 'INR')

      if (!captureResult.captured) {
        return {
          type: 'error' as const,
          status: 502,
          body: { error: { code: 'CAPTURE_FAILED', message: 'Razorpay capture failed', traceId } },
        }
      }

      // === EVIDENCE CHECKPOINT: capture ===
      evidenceFailAfter('capture', evidenceFailAfterStep)

      // Create Payment record (CAPTURED status)
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          userId: session.userId,
          gatewayOrderId,
          gatewayPaymentId: body.razorpayPaymentId,
          gatewaySignature: body.razorpaySignature,
          amount: order.totalAmount,
          currency: 'INR',
          status: 'CAPTURED',
          capturedAt: new Date(),
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

      // Audit log
      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          actorRole: session.role,
          action: 'PAYMENT_CAPTURED',
          metadata: JSON.stringify({ orderId: order.id, paymentId: payment.id, amount: order.totalAmount }),
        },
      })

      // === EVIDENCE CHECKPOINT: audit ===
      evidenceFailAfter('audit', evidenceFailAfterStep)

      // Outbox event (atomic with payment)
      await enqueueOutboxEvent(tx, {
        eventType: 'PAYMENT_CAPTURED',
        aggregateType: 'Payment',
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          orderId: order.id,
          amount: order.totalAmount,
          status: 'CAPTURED',
        },
      })

      // === EVIDENCE CHECKPOINT: outbox ===
      evidenceFailAfter('outbox', evidenceFailAfterStep)

      // Build response body
      const responseBody = {
        payment: {
          id: payment.id,
          orderId: order.id,
          status: 'CAPTURED',
          amount: payment.amount,
          currency: payment.currency,
          gatewayPaymentId: payment.gatewayPaymentId,
          capturedAt: payment.capturedAt,
        },
      }

      // Store idempotency record
      if (idempotencyKey) {
        await storeIdempotencyRecord(tx, idempotencyKey, 'Payment', payment.id, 200, JSON.stringify(responseBody))
        logInfo('payment-idempotency-key-stored', { key: idempotencyKey, paymentId: payment.id }, traceId)
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

    logInfo('payment-captured', { orderId: body.orderId, paymentId: result.payment.id }, traceId)
    return NextResponse.json(result.body)
  } catch (error) {
    if (error instanceof TransactionConflictError) {
      logInfo('payment-capture-conflict', { attempts: error.attempts }, traceId)
      return apiError('CONFLICT', 'Payment capture conflicted with a concurrent request. Please retry.', 409, undefined, traceId)
    }
    // Evidence failure-injection errors are AppError(INTERNAL_ERROR) — rethrow
    // so withErrorHandler returns a 500 with the evidence details.
    throw error
  }
})
