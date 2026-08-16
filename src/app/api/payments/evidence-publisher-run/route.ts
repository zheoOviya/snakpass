import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { captureRazorpayPayment } from '@/lib/razorpay'
import { info as logInfo } from '@/lib/logger'
import { isFeatureEnabled } from '@/lib/deployment'

// ----------------------------------------------------------------------------
// Sub-Wave 4c Evidence — Publisher Run Simulator (DEV-ONLY)
// ----------------------------------------------------------------------------
// POST /api/payments/evidence-publisher-run?paymentId=<id>
//
// Simulates the outbox publisher's processPaymentCaptureRequested() handler
// WITHOUT starting the full publisher service. This allows deterministic E5
// testing of the retry/duplicate-capture-prevention invariant.
//
// The handler:
//   1. Finds the Payment by paymentId
//   2. Checks if already CAPTURED (idempotency — skip if yes)
//   3. Calls captureRazorpayPayment() (OUTSIDE any txn — the 4c safety improvement)
//   4. On success: updates Payment to CAPTURED in a new txn
//   5. Returns the result including captureCalled (for E5 verification)
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
// ----------------------------------------------------------------------------

export async function POST(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const paymentId = url.searchParams.get('paymentId')

  if (!paymentId) {
    return apiError('VALIDATION_ERROR', 'paymentId query param required', 400)
  }

  // Read the Payment
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      gatewayPaymentId: true,
      retryCount: true,
      version: true,
      orderId: true,
    },
  })

  if (!payment) {
    return apiError('NOT_FOUND', `Payment ${paymentId} not found`, 404)
  }

  const traceId = `evidence-pub-${Date.now()}`
  const result = {
    paymentId: payment.id,
    statusBefore: payment.status,
    captureCalled: false,
    statusAfter: payment.status,
    capturedAt: null as string | null,
    idempotencySkipped: false,
    retryCountAfter: payment.retryCount,
    error: null as string | null,
    traceId,
  }

  // 2. Idempotency: if already CAPTURED, skip capture call
  if (payment.status === 'CAPTURED') {
    result.idempotencySkipped = true
    logInfo('evidence-publisher-idempotent-skip', {
      paymentId: payment.id,
      status: payment.status,
      traceId,
    }, traceId)
    return NextResponse.json(result)
  }

  // 3. If not CAPTURE_PENDING, don't attempt capture
  if (payment.status !== 'CAPTURE_PENDING') {
    result.error = `Payment status is ${payment.status} (expected CAPTURE_PENDING)`
    return NextResponse.json(result)
  }

  // 4. Call captureRazorpayPayment() OUTSIDE any transaction body
  //    (This is the Wave-4 4c safety improvement)
  const gatewayPaymentId = payment.gatewayPaymentId ?? `pay_evidence_${Date.now()}`
  result.captureCalled = true

  let captureResult
  try {
    captureResult = await captureRazorpayPayment(
      gatewayPaymentId,
      payment.amount,
      payment.currency,
    )
  } catch (captureError) {
    result.error = (captureError as Error).message || 'capture-error'
    result.retryCountAfter = payment.retryCount + 1
    // Update retry count
    await db.payment.update({
      where: { id: payment.id },
      data: {
        retryCount: { increment: 1 },
        failureReason: `Capture failed: ${result.error}`,
      },
    })
    return NextResponse.json(result)
  }

  if (!captureResult.captured) {
    result.error = 'Gateway declined capture (captured=false)'
    result.retryCountAfter = payment.retryCount + 1
    await db.payment.update({
      where: { id: payment.id },
      data: {
        retryCount: { increment: 1 },
        failureReason: 'Gateway declined capture',
      },
    })
    return NextResponse.json(result)
  }

  // 5. Capture succeeded — update Payment to CAPTURED in a new txn
  //    Race-safe: conditional updateMany (WHERE status='CAPTURE_PENDING')
  const updated = await db.payment.updateMany({
    where: {
      id: payment.id,
      status: 'CAPTURE_PENDING',
    },
    data: {
      status: 'CAPTURED',
      capturedAt: new Date(),
      version: { increment: 1 },
    },
  })

  if (updated.count > 0) {
    result.statusAfter = 'CAPTURED'
    result.capturedAt = new Date().toISOString()

    // AuditLog
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'PAYMENT_CAPTURED',
        metadata: JSON.stringify({
          paymentId: payment.id,
          orderId: payment.orderId,
          gatewayPaymentId: captureResult.gatewayPaymentId,
          amount: payment.amount,
          source: 'evidence-publisher-run',
          traceId,
        }),
      },
    })
  } else {
    // Another concurrent path already captured
    result.statusAfter = 'CAPTURED'
    result.idempotencySkipped = true
    result.capturedAt = 'set by concurrent path'
  }

  return NextResponse.json(result)
}
