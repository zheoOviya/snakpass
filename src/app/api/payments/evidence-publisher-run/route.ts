import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { captureRazorpayPayment, refundRazorpayPayment } from '@/lib/razorpay'
import { info as logInfo } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Sub-Wave 4c Evidence — Publisher Run Simulator (DEV-ONLY)
// ----------------------------------------------------------------------------
// POST /api/payments/evidence-publisher-run?paymentId=<id>
// POST /api/payments/evidence-publisher-run?refundId=<id>&mode=refund
//
// Simulates the outbox publisher's command-event handler WITHOUT starting the
// full publisher service. This allows deterministic E5 testing of the
// retry / duplicate-prevention invariant for BOTH:
//   - capture (Wave-4 4c): processPaymentCaptureRequested()
//   - refund   (Wave-5 5a): processPaymentRefundRequested()
//
// Mode = capture (default, ?paymentId=<id>):
//   1. Finds the Payment by paymentId
//   2. Checks if already CAPTURED (idempotency — skip if yes)
//   3. Calls captureRazorpayPayment() (OUTSIDE any txn — the 4c safety improvement)
//   4. On success: updates Payment to CAPTURED in a new txn
//   5. Returns the result including captureCalled (for E5 verification)
//
// Mode = refund (?refundId=<id>&mode=refund):
//   1. Finds the Refund by refundId
//   2. Checks if already REFUNDED (idempotency — skip if yes)
//   3. Calls refundRazorpayPayment() (OUTSIDE any txn — the 5a safety improvement)
//   4. On success: updates Refund to REFUNDED + Payment to REFUNDED (full
//      refund only) in a new txn + AuditLog (PAYMENT_REFUNDED)
//   5. Returns the result including refundCalled (for 5a-E5 verification)
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
// ----------------------------------------------------------------------------

export async function POST(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const paymentId = url.searchParams.get('paymentId')
  const refundId = url.searchParams.get('refundId')
  const mode = url.searchParams.get('mode') ?? 'capture'

  // --- Refund mode (Wave-5 5a) ---
  if (mode === 'refund') {
    return runRefundPublisher(refundId)
  }

  // --- Capture mode (Wave-4 4c, default) ---
  if (!paymentId) {
    return apiError('VALIDATION_ERROR', 'paymentId query param required (or refundId+mode=refund)', 400)
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

// ----------------------------------------------------------------------------
// Wave-5 Sub-Wave 5a — refund publisher simulator (mirrors capture simulator)
// ----------------------------------------------------------------------------

async function runRefundPublisher(refundId: string | null) {
  if (!refundId) {
    return apiError('VALIDATION_ERROR', 'refundId query param required when mode=refund', 400)
  }

  // Read the Refund + its Payment
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      paymentId: true,
      amount: true,
      currency: true,
      status: true,
      version: true,
    },
  })

  if (!refund) {
    return apiError('NOT_FOUND', `Refund ${refundId} not found`, 404)
  }

  const payment = await db.payment.findUnique({
    where: { id: refund.paymentId },
    select: {
      id: true,
      orderId: true,
      status: true,
      amount: true,
      currency: true,
      gatewayPaymentId: true,
      version: true,
    },
  })

  if (!payment) {
    return apiError('NOT_FOUND', `Payment ${refund.paymentId} for refund ${refundId} not found`, 404)
  }

  const traceId = `evidence-refund-pub-${Date.now()}`
  // Resolve the gatewayPaymentId. The refund route stored it in the outbox
  // payload; here we read it from Payment.gatewayPaymentId directly.
  const gatewayPaymentId = payment.gatewayPaymentId ?? `pay_evidence_refund_${Date.now()}`

  const result = {
    mode: 'refund' as const,
    refundId: refund.id,
    paymentId: payment.id,
    statusBefore: refund.status,
    refundCalled: false,
    statusAfter: refund.status,
    refundedAt: null as string | null,
    gatewayRefundId: null as string | null,
    paymentStatusBefore: payment.status,
    paymentStatusAfter: payment.status,
    idempotencySkipped: false,
    versionAfter: refund.version,
    error: null as string | null,
    traceId,
  }

  // 1. Idempotency: if already REFUNDED, skip refund call
  if (refund.status === 'REFUNDED') {
    result.idempotencySkipped = true
    logInfo('evidence-publisher-refund-idempotent-skip', {
      refundId: refund.id,
      status: refund.status,
      traceId,
    }, traceId)
    return NextResponse.json(result)
  }

  // 2. If FAILED, terminal — skip
  if (refund.status === 'FAILED') {
    result.error = 'Refund is in terminal FAILED state'
    return NextResponse.json(result)
  }

  // 3. If not REFUND_PENDING, don't attempt refund
  if (refund.status !== 'REFUND_PENDING') {
    result.error = `Refund status is ${refund.status} (expected REFUND_PENDING)`
    return NextResponse.json(result)
  }

  // 4. Call refundRazorpayPayment() OUTSIDE any transaction body
  //    (Wave-5 5a safety improvement — mirrors Wave-4 4c capture pattern)
  result.refundCalled = true

  let refundResult
  try {
    refundResult = await refundRazorpayPayment(
      gatewayPaymentId,
      refund.amount,
      refund.currency,
    )
  } catch (refundError) {
    result.error = (refundError as Error).message || 'refund-error'
    result.versionAfter = refund.version + 1
    await db.refund.update({
      where: { id: refund.id },
      data: {
        version: { increment: 1 },
        failureReason: `Refund failed: ${result.error}`,
      },
    })
    return NextResponse.json(result)
  }

  if (!refundResult.refunded) {
    result.error = 'Gateway declined refund (refunded=false)'
    result.versionAfter = refund.version + 1
    await db.refund.update({
      where: { id: refund.id },
      data: {
        version: { increment: 1 },
        failureReason: 'Gateway declined refund',
      },
    })
    return NextResponse.json(result)
  }

  // 5. Refund succeeded — update Refund + Payment in a new txn.
  //    Race-safe: conditional updateMany (WHERE status='REFUND_PENDING').
  //    For a FULL refund (refund.amount === payment.amount), also transition
  //    Payment CAPTURED → REFUNDED. For a partial refund, leave Payment CAPTURED.
  const fullRefund = refund.amount === payment.amount

  const refundUpdated = await db.refund.updateMany({
    where: {
      id: refund.id,
      status: 'REFUND_PENDING',
    },
    data: {
      status: 'REFUNDED',
      refundedAt: new Date(),
      gatewayRefundId: refundResult.gatewayRefundId,
      version: { increment: 1 },
    },
  })

  let paymentUpdated = { count: 0 }
  if (fullRefund) {
    paymentUpdated = await db.payment.updateMany({
      where: {
        id: payment.id,
        status: 'CAPTURED',
      },
      data: {
        status: 'REFUNDED',
        version: { increment: 1 },
      },
    })
  }

  if (refundUpdated.count > 0) {
    result.statusAfter = 'REFUNDED'
    result.refundedAt = new Date().toISOString()
    result.gatewayRefundId = refundResult.gatewayRefundId
    result.versionAfter = refund.version + 1
  } else {
    result.idempotencySkipped = true
    result.statusAfter = 'REFUNDED'
    result.refundedAt = 'set by concurrent path'
  }

  if (fullRefund && paymentUpdated.count > 0) {
    result.paymentStatusAfter = 'REFUNDED'
  } else if (fullRefund) {
    result.paymentStatusAfter = payment.status === 'REFUNDED' ? 'REFUNDED' : payment.status
  } else {
    result.paymentStatusAfter = payment.status // partial refund — Payment stays CAPTURED
  }

  // AuditLog (only if Refund was transitioned or Payment was transitioned)
  if (refundUpdated.count > 0 || paymentUpdated.count > 0) {
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'PAYMENT_REFUNDED',
        metadata: JSON.stringify({
          refundId: refund.id,
          paymentId: payment.id,
          orderId: payment.orderId,
          gatewayRefundId: refundResult.gatewayRefundId,
          amount: refund.amount,
          fullRefund,
          source: 'evidence-publisher-run',
          traceId,
        }),
      },
    })
  }

  // Mark the outbox event PUBLISHED (simulating the publisher's success path).
  // Look up by aggregateType='Refund' + aggregateId=refund.id.
  if (refundUpdated.count > 0) {
    await db.outbox.updateMany({
      where: {
        aggregateType: 'Refund',
        aggregateId: refund.id,
        status: { in: ['PENDING', 'CLAIMED'] },
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
      },
    })
  }

  return NextResponse.json(result)
}
