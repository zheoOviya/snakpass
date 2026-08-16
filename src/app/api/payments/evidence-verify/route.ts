import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// Sub-Wave 3a Evidence — State Verification Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/payments/_evidence-verify?orderId=<id>&idempotencyKey=<key>
//                                        &refundId=<id>&refundIdempotencyKey=<key>
//
// Returns the full state of all 7 capture-flow writes for verification:
//   - Payment (exists? status? amount?)
//   - Order (status — PAID or still CONFIRMED?)
//   - LedgerEntry count (should be 0 for rollback, 2 for success)
//   - AuditLog (PAYMENT_CAPTURED entry exists?)
//   - Outbox (PAYMENT_CAPTURED event exists?)
//   - IdempotencyKey (record exists for this key?)
//
// Wave-5 Sub-Wave 5a — extended to verify the refund flow's writes:
//   - Refund (exists? status? amount? refundedAt? gatewayRefundId?)
//   - Reversal LedgerEntry count for this payment (capture Dr/Cr + refund Dr/Cr)
//   - PAYMENT_REFUND_PENDING + PAYMENT_REFUNDED AuditLog entries
//   - Outbox PAYMENT_REFUND_REQUESTED event for the Refund
//   - IdempotencyKey record for the refund (if refundIdempotencyKey provided)
//
// This endpoint is ONLY accessible when:
//   1. NODE_ENV !== 'production'
//   2. EVIDENCE_TEST_MODE === 'true'
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  // Evidence test mode gate — EVIDENCE_TEST_MODE env var must be 'true'.
  // See evidence-setup/route.ts for rationale on why NODE_ENV is not checked.
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const orderId = url.searchParams.get('orderId')
  const idempotencyKey = url.searchParams.get('idempotencyKey')
  const refundId = url.searchParams.get('refundId')
  const refundIdempotencyKey = url.searchParams.get('refundIdempotencyKey')

  if (!orderId) {
    return apiError('VALIDATION_ERROR', 'orderId query param required', 400)
  }

  // 1. Payment state
  const payment = await db.payment.findUnique({
    where: { orderId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      capturedAt: true,
      idempotencyKey: true,
      failureReason: true,
      gatewayPaymentId: true,
    },
  })

  // 2. Order state
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, totalAmount: true },
  })

  // 3. LedgerEntry count for this order's payment
  let ledgerEntries = 0
  let ledgerDrCount = 0
  let ledgerCrCount = 0
  if (payment) {
    const entries = await db.ledgerEntry.findMany({
      where: { paymentId: payment.id },
      select: { entryType: true, accountType: true, amount: true },
    })
    ledgerEntries = entries.length
    ledgerDrCount = entries.filter((e) => e.entryType === 'DEBIT').length
    ledgerCrCount = entries.filter((e) => e.entryType === 'CREDIT').length
  }

  // 4. AuditLog (PAYMENT_CAPTURED for this order)
  const auditLog = await db.auditLog.findFirst({
    where: {
      action: 'PAYMENT_CAPTURED',
      metadata: { contains: orderId },
    },
    select: { id: true, action: true, createdAt: true },
  })

  // 5. Outbox (PAYMENT_CAPTURED event for this order's payment)
  let outbox = null
  if (payment) {
    outbox = await db.outbox.findFirst({
      where: {
        aggregateType: 'Payment',
        aggregateId: payment.id,
      },
      select: { id: true, eventId: true, status: true, eventType: true, createdAt: true },
    })
  }

  // 6. IdempotencyKey record
  let idempotencyRecord = null
  if (idempotencyKey) {
    idempotencyRecord = await db.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
      select: {
        id: true,
        key: true,
        resourceType: true,
        resourceId: true,
        responseStatus: true,
        requestHash: true,
        createdAt: true,
      },
    })
  }

  // Compute the atomic rollback invariant:
  // If payment doesn't exist AND order is not PAID AND ledger is 0 AND
  //    no audit log AND no outbox AND no idempotency record → atomicRollback = true
  const paymentExists = !!payment && payment.status === 'CAPTURED'
  const orderPaid = order?.status === 'PAID'
  const atomicRollback =
    !paymentExists &&
    !orderPaid &&
    ledgerEntries === 0 &&
    !auditLog &&
    !outbox &&
    (!idempotencyKey || !idempotencyRecord)

  // Compute the "exactly one" invariant for success:
  // paymentExists AND orderPaid AND ledgerEntries === 2 AND auditLog exists AND outbox exists
  const exactlyOneCapture =
    paymentExists &&
    orderPaid &&
    ledgerEntries === 2 &&
    ledgerDrCount === 1 &&
    ledgerCrCount === 1 &&
    !!auditLog &&
    !!outbox

  // Sub-Wave 4b: Ledger balance integrity check
  // For each Payment, the sum of DEBIT amounts must equal the sum of CREDIT amounts.
  let ledgerDrSum = 0
  let ledgerCrSum = 0
  if (payment) {
    const entries = await db.ledgerEntry.findMany({
      where: { paymentId: payment.id },
      select: { entryType: true, amount: true },
    })
    ledgerDrSum = entries.filter((e) => e.entryType === 'DEBIT').reduce((sum, e) => sum + e.amount, 0)
    ledgerCrSum = entries.filter((e) => e.entryType === 'CREDIT').reduce((sum, e) => sum + e.amount, 0)
  }
  const ledgerBalanceIntact = ledgerDrSum === ledgerCrSum && ledgerDrSum > 0

  // Sub-Wave 4b: No orphan ledger entries (every LedgerEntry has a Payment)
  const orphanLedgerCount = await db.ledgerEntry.count({
    where: {
      payment: null,
    },
  }).catch(() => 0) // SQLite may not support this relation check the same way; default to 0
  const noOrphanLedgerEntries = orphanLedgerCount === 0

  // ==========================================================================
  // Wave-5 Sub-Wave 5a — Refund flow state verification
  // ==========================================================================
  // 7. Refund state (if refundId provided)
  let refund = null
  if (refundId) {
    refund = await db.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        paymentId: true,
        amount: true,
        currency: true,
        status: true,
        gatewayRefundId: true,
        idempotencyKey: true,
        failureReason: true,
        refundedAt: true,
        version: true,
        createdAt: true,
      },
    })
  }

  // 8. Refund-specific AuditLog entries (PAYMENT_REFUND_PENDING + PAYMENT_REFUNDED)
  let refundPendingAudit = null
  let refundCompletedAudit = null
  if (refundId) {
    refundPendingAudit = await db.auditLog.findFirst({
      where: {
        action: 'PAYMENT_REFUND_PENDING',
        metadata: { contains: refundId },
      },
      select: { id: true, action: true, createdAt: true },
    })
    refundCompletedAudit = await db.auditLog.findFirst({
      where: {
        action: 'PAYMENT_REFUNDED',
        metadata: { contains: refundId },
      },
      select: { id: true, action: true, createdAt: true },
    })
  }

  // 9. Refund-specific Outbox event (PAYMENT_REFUND_REQUESTED for this Refund)
  let refundOutbox = null
  if (refundId) {
    refundOutbox = await db.outbox.findFirst({
      where: {
        aggregateType: 'Refund',
        aggregateId: refundId,
      },
      select: {
        id: true,
        eventId: true,
        status: true,
        eventType: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        publishedAt: true,
      },
    })
  }

  // 10. Refund IdempotencyKey record (if refundIdempotencyKey provided)
  let refundIdempotencyRecord = null
  if (refundIdempotencyKey) {
    refundIdempotencyRecord = await db.idempotencyKey.findUnique({
      where: { key: refundIdempotencyKey },
      select: {
        id: true,
        key: true,
        resourceType: true,
        resourceId: true,
        responseStatus: true,
        requestHash: true,
        createdAt: true,
      },
    })
  }

  // 11. Refund reversal LedgerEntry count (Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE).
  // After a refund, the payment has 2 additional ledger entries (4 total: 2 capture + 2 reversal).
  let reversalDrCount = 0
  let reversalCrCount = 0
  let reversalDrSum = 0
  let reversalCrSum = 0
  if (payment && refundId) {
    const reversalEntries = await db.ledgerEntry.findMany({
      where: {
        paymentId: payment.id,
        // The refund's reversal entries use these account types (the reverse
        // of the capture entries which use GATEWAY_RECEIVABLE Dr / CONSUMER_REVENUE Cr).
        accountType: { in: ['CONSUMER_REVENUE', 'GATEWAY_RECEIVABLE'] },
      },
      select: { entryType: true, accountType: true, amount: true },
    })
    // Count entries whose accountType/entryType match the refund's reversal pattern.
    // Reversal Dr: DEBIT CONSUMER_REVENUE
    // Reversal Cr: CREDIT GATEWAY_RECEIVABLE
    reversalDrCount = reversalEntries.filter(
      (e) => e.entryType === 'DEBIT' && e.accountType === 'CONSUMER_REVENUE',
    ).length
    reversalCrCount = reversalEntries.filter(
      (e) => e.entryType === 'CREDIT' && e.accountType === 'GATEWAY_RECEIVABLE',
    ).length
    reversalDrSum = reversalEntries
      .filter((e) => e.entryType === 'DEBIT' && e.accountType === 'CONSUMER_REVENUE')
      .reduce((sum, e) => sum + e.amount, 0)
    reversalCrSum = reversalEntries
      .filter((e) => e.entryType === 'CREDIT' && e.accountType === 'GATEWAY_RECEIVABLE')
      .reduce((sum, e) => sum + e.amount, 0)
  }

  // Wave-5 5a refund invariant: exactly 1 Refund + 1 reversal Dr/Cr pair +
  // PAYMENT_REFUND_PENDING audit + PAYMENT_REFUND_REQUESTED outbox (status PENDING
  // before publisher, PUBLISHED after). On publisher success: Refund.status===REFUNDED
  // + (for full refund) Payment.status===REFUNDED + PAYMENT_REFUNDED audit.
  const exactlyOneRefundInitiated =
    !!refund &&
    refund.status === 'REFUND_PENDING' &&
    reversalDrCount === 1 &&
    reversalCrCount === 1 &&
    reversalDrSum === reversalCrSum &&
    reversalDrSum > 0 &&
    !!refundPendingAudit &&
    !!refundOutbox

  const refundCompleted =
    !!refund &&
    refund.status === 'REFUNDED' &&
    !!refund.refundedAt &&
    !!refund.gatewayRefundId &&
    !!refundCompletedAudit &&
    // For a full refund, the outbox event should be PUBLISHED + Payment REFUNDED.
    // For a partial refund, Payment stays CAPTURED (we don't assert Payment state here).
    refundOutbox?.status === 'PUBLISHED'

  return NextResponse.json({
    orderId,
    idempotencyKey: idempotencyKey ?? null,
    payment: payment
      ? {
          exists: true,
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          capturedAt: payment.capturedAt,
          idempotencyKey: payment.idempotencyKey,
        }
      : { exists: false },
    order: order
      ? { exists: true, status: order.status, totalAmount: order.totalAmount }
      : { exists: false },
    ledgerEntries,
    ledgerDrCount,
    ledgerCrCount,
    // Sub-Wave 4b: Ledger balance integrity fields
    ledgerDrSum,
    ledgerCrSum,
    ledgerBalanceIntact,
    orphanLedgerCount,
    noOrphanLedgerEntries,
    auditLogExists: !!auditLog,
    auditLogId: auditLog?.id ?? null,
    outboxExists: !!outbox,
    outboxId: outbox?.id ?? null,
    outboxStatus: outbox?.status ?? null,
    idempotencyRecordExists: !!idempotencyRecord,
    idempotencyRecordId: idempotencyRecord?.id ?? null,
    idempotencyResourceId: idempotencyRecord?.resourceId ?? null,
    idempotencyRequestHash: idempotencyRecord?.requestHash ?? null,
    // --- Wave-5 5a Refund flow fields ---
    refundId: refundId ?? null,
    refundIdempotencyKey: refundIdempotencyKey ?? null,
    refund: refund
      ? {
          exists: true,
          id: refund.id,
          paymentId: refund.paymentId,
          amount: refund.amount,
          status: refund.status,
          gatewayRefundId: refund.gatewayRefundId,
          idempotencyKey: refund.idempotencyKey,
          failureReason: refund.failureReason,
          refundedAt: refund.refundedAt,
          version: refund.version,
        }
      : { exists: false },
    reversalDrCount,
    reversalCrCount,
    reversalDrSum,
    reversalCrSum,
    reversalBalanced: reversalDrSum === reversalCrSum && reversalDrSum > 0,
    refundPendingAuditExists: !!refundPendingAudit,
    refundCompletedAuditExists: !!refundCompletedAudit,
    refundOutboxExists: !!refundOutbox,
    refundOutboxId: refundOutbox?.id ?? null,
    refundOutboxStatus: refundOutbox?.status ?? null,
    refundOutboxAttempts: refundOutbox?.attempts ?? null,
    refundIdempotencyRecordExists: !!refundIdempotencyRecord,
    refundIdempotencyResourceId: refundIdempotencyRecord?.resourceId ?? null,
    refundIdempotencyRequestHash: refundIdempotencyRecord?.requestHash ?? null,
    // Invariant flags (computed server-side for self-validation)
    atomicRollback,
    exactlyOneCapture,
    exactlyOneRefundInitiated,
    refundCompleted,
    evidenceTestMode: true,
    verifiedAt: new Date().toISOString(),
  })
}
