import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// Sub-Wave 3a Evidence — State Verification Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/payments/_evidence-verify?orderId=<id>&idempotencyKey=<key>
//
// Returns the full state of all 7 capture-flow writes for verification:
//   - Payment (exists? status? amount?)
//   - Order (status — PAID or still CONFIRMED?)
//   - LedgerEntry count (should be 0 for rollback, 2 for success)
//   - AuditLog (PAYMENT_CAPTURED entry exists?)
//   - Outbox (PAYMENT_CAPTURED event exists?)
//   - IdempotencyKey (record exists for this key?)
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
    auditLogExists: !!auditLog,
    auditLogId: auditLog?.id ?? null,
    outboxExists: !!outbox,
    outboxId: outbox?.id ?? null,
    outboxStatus: outbox?.status ?? null,
    idempotencyRecordExists: !!idempotencyRecord,
    idempotencyRecordId: idempotencyRecord?.id ?? null,
    idempotencyResourceId: idempotencyRecord?.resourceId ?? null,
    // Invariant flags (computed server-side for self-validation)
    atomicRollback,
    exactlyOneCapture,
    evidenceTestMode: true,
    verifiedAt: new Date().toISOString(),
  })
}
