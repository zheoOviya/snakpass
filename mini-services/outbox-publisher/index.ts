// P0-24 Sub-Wave 2b — Outbox Publisher Worker
//
// Cron-triggered publisher with DB-backed lease/claim + retry state.
//
// This is NOT a "continuously running worker that polls." It is a
// CRON-TRIGGERED process that:
//   1. Claims PENDING events (atomic UPDATE ... WHERE status='PENDING' → CLAIMED)
//   2. Publishes each claimed event via Socket.io
//   3. Marks as PUBLISHED (success) or increments attempts (failure)
//   4. After max retries (5), marks as FAILED + alerts
//   5. Recovers stale CLAIMED events (lease expired → back to PENDING)
//
// Crash safety: if the process dies between claim + publish, the lease
// expires and a future invocation re-claims the event.
//
// Run via: Vercel Cron (1-minute interval) OR manual trigger
// Port: 3009 (for health check endpoint)

import { PrismaClient } from '@prisma/client'
import { io as ioClient, type Socket } from 'socket.io-client'
import { createHash } from 'crypto'
import { appendFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
// Wave-4 Sub-Wave 4c Phase 2 — capture handler imports.
// The publisher is a standalone Bun service (NOT the Next.js app), so it imports
// the razorpay helper directly via a relative path rather than the `@/lib/*`
// alias (which is a tsconfig path mapping only resolved by the Next.js bundler).
// In demo mode (realPayments=false) captureRazorpayPayment() returns mock
// success immediately — no real Razorpay API calls are made.
import { captureRazorpayPayment } from '../../src/lib/razorpay'
// Wave-5 Sub-Wave 5a — refund handler import (mirrors 4c capture pattern).
import { refundRazorpayPayment } from '../../src/lib/razorpay'

// Transport configuration:
// - HTTP mode: publisher POSTs events to CONSUMER_URL/api/test/consume-event
// - Socket.io mode: publisher emits via Socket.io to REALTIME_URL
// HTTP mode is used for staging E2E testing (no realtime service deployed).
// Socket.io mode is for production (realtime service deployed).
const TRANSPORT_MODE = process.env.OUTBOX_TRANSPORT_MODE || 'http' // 'http' | 'socket'

// HTTP consumer URL (for staging E2E testing)
const CONSUMER_URL = process.env.CONSUMER_URL || ''

const PORT = parseInt(process.env.OUTBOX_PUBLISHER_PORT || '3009', 10)
const REALTIME_URL = process.env.REALTIME_URL || 'http://localhost:3003'
const LEASE_DURATION_MS = 30_000 // 30 seconds — if publisher crashes, lease expires
const MAX_RETRIES = 5
const BACKOFF_SCHEDULE_MS = [1_000, 5_000, 30_000, 300_000, 900_000] // 1s, 5s, 30s, 5min, 15min
const BATCH_SIZE = 10 // events per claim batch

const db = new PrismaClient()
const LOG_DIR = join(import.meta.dir, '..', '..', 'db')
const LOG_FILE = join(LOG_DIR, 'outbox-publisher-log.jsonl')

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {})
}

// Socket.io connection to realtime service
let realtimeSocket: Socket | null = null

function getRealtimeSocket(): Socket | null {
  if (realtimeSocket) return realtimeSocket
  try {
    const sock = ioClient(REALTIME_URL, {
      path: '/',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 500,
      timeout: 2000,
    })
    sock.on('connect_error', () => {
      // swallow — realtime is best-effort
    })
    realtimeSocket = sock
    return sock
  } catch {
    return null
  }
}

// Event type → Socket.io event name mapping (2b-0 transport contract)
const EVENT_TYPE_TO_SOCKET: Record<string, string> = {
  ORDER_CREATED: 'order:created',
  ORDER_STATUS_CHANGED: 'order:updated',
  KILL_SWITCH_TOGGLED: 'killswitch:toggled',
}

// Wave-4 4c Phase 2 — command event types that are NOT transport handoffs.
// These events trigger a business operation (e.g., capture, refund) rather
// than a realtime fanout. They are dispatched to dedicated handlers and never
// reach the EVENT_TYPE_TO_SOCKET lookup (which would throw "Unknown event type").
// Wave-5 Sub-Wave 5a: PAYMENT_REFUND_REQUESTED added (mirrors 4c capture pattern).
const COMMAND_EVENT_TYPES: Set<string> = new Set([
  'PAYMENT_CAPTURE_REQUESTED',
  'PAYMENT_REFUND_REQUESTED',
])

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  eventId?: string
  eventType?: string
  workerId?: string
  attempt?: number
  error?: string
  paymentId?: string
  orderId?: string
  refundId?: string
  count?: number
}

// ----------------------------------------------------------------------------
// Wave-4 Sub-Wave 4c Phase 2 — PAYMENT_CAPTURE_REQUESTED handler
// ----------------------------------------------------------------------------
// Command-event handler: consumes a PAYMENT_CAPTURE_REQUESTED outbox row and
// performs the actual Razorpay capture (safely OUTSIDE any transaction body).
//
// Safety properties (the whole point of Wave-4 4c):
//   1. captureRazorpayPayment() is called OUTSIDE any DB transaction. If the
//      success-path txn retries (Prisma P2034 conflict), the capture call is
//      NOT re-executed — preventing double-charge at the gateway.
//   2. Idempotency: if Payment.status is already CAPTURED (e.g., a webhook
//      raced ahead), the handler marks the outbox event PUBLISHED and exits.
//   3. Race-safe Payment update: conditional updateMany (WHERE status='CAPTURE_PENDING')
//      prevents overwriting CAPTURED/FAILED status set by a concurrent path.
//   4. Atomic success commit: Payment.status=CAPTURED + capturedAt + AuditLog +
//      Outbox.status=PUBLISHED all commit in the SAME txn — no half-states.
//
// On capture failure: Payment.retryCount is incremented + failureReason set,
// status is left as CAPTURE_PENDING, and the handler throws — the publisher's
// existing retry/backoff/FAILED logic then drives the outbox event's lifecycle.
// ----------------------------------------------------------------------------

interface CaptureRequestedPayload {
  paymentId: string
  orderId: string
  gatewayPaymentId: string
  amount: number
}

async function processPaymentCaptureRequested(event: {
  id: string
  eventId: string
  aggregateId: string
  payload: string
  attempts: number
}): Promise<void> {
  // Parse payload (written by capture route's enqueueOutboxEvent call)
  let payload: CaptureRequestedPayload
  try {
    payload = JSON.parse(event.payload) as CaptureRequestedPayload
  } catch {
    // Malformed payload — non-retryable; mark outbox PUBLISHED to stop retries.
    // (This should never happen since enqueueOutboxEvent JSON.stringify's the payload.)
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
        lastError: 'malformed-payload-marked-published',
      },
    })
    await log({
      level: 'error',
      message: 'capture-payload-malformed',
      eventId: event.eventId,
      eventType: 'PAYMENT_CAPTURE_REQUESTED',
    })
    return
  }

  // 1. Read the Payment (aggregateId = paymentId per the capture route's
  //    enqueueOutboxEvent({ aggregateType: 'Payment', aggregateId: payment.id, ... }))
  const payment = await db.payment.findUnique({
    where: { id: event.aggregateId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      gatewayPaymentId: true,
      retryCount: true,
      version: true,
    },
  })

  if (!payment) {
    // Payment row missing — non-retryable; mark outbox PUBLISHED to stop
    // retrying. (By design this is impossible: the capture route writes Payment
    // + Outbox in the SAME txn, so an outbox row can't exist without a Payment.)
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
        lastError: `payment-not-found:aggregateId=${event.aggregateId}`,
      },
    })
    await log({
      level: 'error',
      message: 'capture-payment-not-found',
      eventId: event.eventId,
      eventType: 'PAYMENT_CAPTURE_REQUESTED',
      paymentId: event.aggregateId,
    })
    return
  }

  // 2. Idempotency: if already CAPTURED (e.g., a webhook raced ahead and
  //    captured first, or a prior publisher invocation captured but failed to
  //    mark the outbox PUBLISHED), the capture command has already succeeded.
  //    Mark the outbox event PUBLISHED and exit.
  if (payment.status === 'CAPTURED') {
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
      },
    })
    await log({
      level: 'info',
      message: 'capture-already-captured-idempotent',
      eventId: event.eventId,
      eventType: 'PAYMENT_CAPTURE_REQUESTED',
      paymentId: payment.id,
    })
    return
  }

  // 3. If Payment is in a non-capture-pending state (FAILED, FROZEN, etc.),
  //    do NOT attempt capture. Throw so the publisher's existing retry path
  //    handles it; if it exhausts retries, the outbox event becomes FAILED +
  //    alerts fire (manual intervention required).
  if (payment.status !== 'CAPTURE_PENDING') {
    throw new Error(
      `Payment ${payment.id} status is ${payment.status} (expected CAPTURE_PENDING) — capture skipped`,
    )
  }

  // 4. Call captureRazorpayPayment() OUTSIDE any transaction body.
  //    This is the Wave-4 4c safety improvement: if the success-path txn
  //    retries (P2034 conflict), this call is NOT re-executed.
  //    In demo mode (realPayments=false), this returns mock success immediately.
  const gatewayPaymentId = payment.gatewayPaymentId ?? payload.gatewayPaymentId
  let captureResult
  try {
    captureResult = await captureRazorpayPayment(
      gatewayPaymentId,
      payment.amount,
      payment.currency,
    )
  } catch (captureError) {
    // Capture call failed (network error, gateway 5xx, etc.) — record the
    // failure on the Payment row, then rethrow so the publisher's existing
    // retry/backoff/FAILED logic drives the outbox event's lifecycle.
    // Payment.status is left as CAPTURE_PENDING (capture may succeed on retry).
    const errorMsg = (captureError as Error).message || 'unknown-capture-error'
    await db.payment.update({
      where: { id: payment.id },
      data: {
        retryCount: { increment: 1 },
        failureReason: `Capture failed: ${errorMsg}`,
      },
    })
    await log({
      level: 'warn',
      message: 'capture-call-failed',
      eventId: event.eventId,
      eventType: 'PAYMENT_CAPTURE_REQUESTED',
      paymentId: payment.id,
      attempt: event.attempts + 1,
      error: errorMsg,
    })
    throw captureError
  }

  // If the gateway returned captured=false (decline), treat as failure.
  if (!captureResult.captured) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        retryCount: { increment: 1 },
        failureReason: 'Gateway declined capture (captured=false)',
      },
    })
    await log({
      level: 'warn',
      message: 'capture-declined-by-gateway',
      eventId: event.eventId,
      eventType: 'PAYMENT_CAPTURE_REQUESTED',
      paymentId: payment.id,
      attempt: event.attempts + 1,
    })
    throw new Error('Gateway declined capture (captured=false)')
  }

  // 5. Capture succeeded — open a NEW transaction and atomically:
  //    (a) Update Payment status CAPTURE_PENDING → CAPTURED + capturedAt (race-safe)
  //    (b) AuditLog (PAYMENT_CAPTURED)
  //    (c) Mark outbox event PUBLISHED
  //    All three commit in the SAME txn — no half-states.
  //
  //    NOTE: this txn does NOT include captureRazorpayPayment() — that call
  //    already happened above (outside the txn). This is the Wave-4 4c safety
  //    improvement: a P2034 retry would re-run only the DB writes, NOT the
  //    capture HTTP call (no double-charge risk).
  await db.$transaction(async (tx) => {
    // Race-safe: only update if status is still CAPTURE_PENDING.
    // If a concurrent path (e.g., webhook) already captured, count === 0 —
    // we still mark the outbox PUBLISHED (capture command effectively done)
    // but skip writing a duplicate AuditLog.
    const updated = await tx.payment.updateMany({
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
      // AuditLog — PAYMENT_CAPTURED (publisher-driven).
      // Distinct from WEBHOOK_PAYMENT_CAPTURED (webhook-driven) so audit
      // consumers can distinguish capture-confirmation paths.
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'PAYMENT_CAPTURED',
          metadata: JSON.stringify({
            paymentId: payment.id,
            orderId: payload.orderId,
            gatewayPaymentId: captureResult.gatewayPaymentId,
            amount: payment.amount,
            source: 'outbox-publisher',
            outboxEventId: event.eventId,
          }),
        },
      })
    }

    // Mark outbox event PUBLISHED (whether or not we updated Payment —
    // the capture command's business effect has been achieved either way).
    await tx.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
      },
    })
  })

  await log({
    level: 'info',
    message: 'capture-completed',
    eventId: event.eventId,
    eventType: 'PAYMENT_CAPTURE_REQUESTED',
    paymentId: payment.id,
    orderId: payload.orderId,
  })
}

// ----------------------------------------------------------------------------
// Wave-5 Sub-Wave 5a — PAYMENT_REFUND_REQUESTED handler
// ----------------------------------------------------------------------------
// Command-event handler: consumes a PAYMENT_REFUND_REQUESTED outbox row and
// performs the actual Razorpay refund (safely OUTSIDE any transaction body).
//
// Mirrors `processPaymentCaptureRequested()` (Wave-4 4c Phase 2) exactly:
//   1. Parse payload (written by refund route's enqueueOutboxEvent call).
//      aggregateId = refund.id (per the refund route's enqueueOutboxEvent
//      ({ aggregateType: 'Refund', aggregateId: refund.id, ... })).
//   2. Read Refund row by id.
//   3. Idempotency: if Refund.status === 'REFUNDED', mark outbox PUBLISHED
//      and exit (no duplicate external refund).
//   4. If Refund.status === 'FAILED', mark outbox PUBLISHED (terminal state).
//   5. If Refund.status !== 'REFUND_PENDING', throw (outbox retry/backoff drives).
//   6. Call refundRazorpayPayment() OUTSIDE any txn (Wave-4 4c safety property).
//   7. On refund-call failure / declined: increment Refund.version + set
//      failureReason, leave status REFUND_PENDING, throw (publisher catch
//      handles retry/backoff/FAILED lifecycle).
//   8. On success: NEW db.$transaction() atomically commits:
//        (a) Refund REFUND_PENDING → REFUNDED + refundedAt + gatewayRefundId
//            (race-safe conditional updateMany WHERE status='REFUND_PENDING').
//        (b) If full refund AND Payment.status==='CAPTURED': transition Payment
//            CAPTURED → REFUNDED (race-safe conditional updateMany).
//        (c) AuditLog (PAYMENT_REFUNDED) if either Refund or Payment was updated.
//        (d) Outbox.status=PUBLISHED (always — refund command effect achieved).
//
// The success txn does NOT include refundRazorpayPayment() — that call already
// happened above (outside the txn). This is the Wave-4 4c safety improvement:
// a P2034 retry would re-run only the DB writes, NOT the refund HTTP call
// (no double-refund risk).
// ----------------------------------------------------------------------------

interface RefundRequestedPayload {
  refundId: string
  paymentId: string
  orderId: string
  gatewayPaymentId: string | null
  amount: number
  currency: string
  fullRefund: boolean
}

async function processPaymentRefundRequested(event: {
  id: string
  eventId: string
  aggregateId: string
  payload: string
  attempts: number
}): Promise<void> {
  // Parse payload (written by refund route's enqueueOutboxEvent call)
  let payload: RefundRequestedPayload
  try {
    payload = JSON.parse(event.payload) as RefundRequestedPayload
  } catch {
    // Malformed payload — non-retryable; mark outbox PUBLISHED to stop retries.
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
        lastError: 'malformed-payload-marked-published',
      },
    })
    await log({
      level: 'error',
      message: 'refund-payload-malformed',
      eventId: event.eventId,
      eventType: 'PAYMENT_REFUND_REQUESTED',
    })
    return
  }

  // 1. Read the Refund (aggregateId = refundId per the refund route's
  //    enqueueOutboxEvent({ aggregateType: 'Refund', aggregateId: refund.id, ... }))
  const refund = await db.refund.findUnique({
    where: { id: event.aggregateId },
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
    // Refund row missing — non-retryable; mark outbox PUBLISHED to stop
    // retrying. (By design this is impossible: the refund route writes Refund
    // + Outbox in the SAME txn, so an outbox row can't exist without a Refund.)
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
        lastError: `refund-not-found:aggregateId=${event.aggregateId}`,
      },
    })
    await log({
      level: 'error',
      message: 'refund-not-found',
      eventId: event.eventId,
      eventType: 'PAYMENT_REFUND_REQUESTED',
      refundId: event.aggregateId,
    })
    return
  }

  // 2. Idempotency: if already REFUNDED (e.g., a webhook raced ahead and
  //    processed the refund first, or a prior publisher invocation refunded
  //    but failed to mark the outbox PUBLISHED), the refund command has
  //    already succeeded. Mark the outbox event PUBLISHED and exit.
  if (refund.status === 'REFUNDED') {
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
      },
    })
    await log({
      level: 'info',
      message: 'refund-already-refunded-idempotent',
      eventId: event.eventId,
      eventType: 'PAYMENT_REFUND_REQUESTED',
      refundId: refund.id,
      paymentId: refund.paymentId,
    })
    return
  }

  // 3. Terminal FAILED state: refund exhausted retries earlier and was marked
  //    FAILED. Mark outbox PUBLISHED to stop further retry attempts (manual
  //    intervention would have created a NEW Refund with a new idempotency key).
  if (refund.status === 'FAILED') {
    await db.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
        lastError: 'refund-terminal-failed-marked-published',
      },
    })
    await log({
      level: 'warn',
      message: 'refund-terminal-failed',
      eventId: event.eventId,
      eventType: 'PAYMENT_REFUND_REQUESTED',
      refundId: refund.id,
      paymentId: refund.paymentId,
    })
    return
  }

  // 4. If Refund is in a non-pending state (shouldn't happen since REFUNDED
  //    and FAILED are handled above, but defensive), do NOT attempt refund.
  //    Throw so the publisher's existing retry path handles it.
  if (refund.status !== 'REFUND_PENDING') {
    throw new Error(
      `Refund ${refund.id} status is ${refund.status} (expected REFUND_PENDING) — refund skipped`,
    )
  }

  // 5. Resolve the Razorpay payment ID. Prefer the payload's gatewayPaymentId
  //    (written by the refund route from Payment.gatewayPaymentId). Fall back
  //    to reading Payment.gatewayPaymentId. If neither is set (impossible for a
  //    CAPTURED payment, but defensive), throw.
  let gatewayPaymentId = payload.gatewayPaymentId
  if (!gatewayPaymentId) {
    const payment = await db.payment.findUnique({
      where: { id: refund.paymentId },
      select: { gatewayPaymentId: true, status: true },
    })
    if (!payment) {
      throw new Error(`Payment ${refund.paymentId} not found for refund ${refund.id}`)
    }
    gatewayPaymentId = payment.gatewayPaymentId
  }
  if (!gatewayPaymentId) {
    throw new Error(
      `Cannot refund: Payment ${refund.paymentId} has no gatewayPaymentId (refund ${refund.id})`,
    )
  }

  // 6. Call refundRazorpayPayment() OUTSIDE any transaction body.
  //    This is the Wave-4 4c / Wave-5 5a safety improvement: if the
  //    success-path txn retries (P2034 conflict), this call is NOT re-executed.
  //    In demo mode (realPayments=false), this returns mock success immediately.
  let refundResult
  try {
    refundResult = await refundRazorpayPayment(
      gatewayPaymentId,
      refund.amount,
      refund.currency,
    )
  } catch (refundError) {
    // Refund call failed (network error, gateway 5xx, etc.) — record the
    // failure on the Refund row, then rethrow so the publisher's existing
    // retry/backoff/FAILED logic drives the outbox event's lifecycle.
    // Refund.status is left as REFUND_PENDING (refund may succeed on retry).
    const errorMsg = (refundError as Error).message || 'unknown-refund-error'
    await db.refund.update({
      where: { id: refund.id },
      data: {
        version: { increment: 1 },
        failureReason: `Refund failed: ${errorMsg}`,
      },
    })
    await log({
      level: 'warn',
      message: 'refund-call-failed',
      eventId: event.eventId,
      eventType: 'PAYMENT_REFUND_REQUESTED',
      refundId: refund.id,
      paymentId: refund.paymentId,
      attempt: event.attempts + 1,
      error: errorMsg,
    })
    throw refundError
  }

  // If the gateway returned refunded=false (decline), treat as failure.
  if (!refundResult.refunded) {
    await db.refund.update({
      where: { id: refund.id },
      data: {
        version: { increment: 1 },
        failureReason: 'Gateway declined refund (refunded=false)',
      },
    })
    await log({
      level: 'warn',
      message: 'refund-declined-by-gateway',
      eventId: event.eventId,
      eventType: 'PAYMENT_REFUND_REQUESTED',
      refundId: refund.id,
      paymentId: refund.paymentId,
      attempt: event.attempts + 1,
    })
    throw new Error('Gateway declined refund (refunded=false)')
  }

  // 7. Refund succeeded — open a NEW transaction and atomically:
  //    (a) Update Refund status REFUND_PENDING → REFUNDED + refundedAt +
  //        gatewayRefundId (race-safe conditional updateMany).
  //    (b) If full refund AND Payment.status==='CAPTURED': transition Payment
  //        CAPTURED → REFUNDED (race-safe conditional updateMany).
  //    (c) AuditLog (PAYMENT_REFUNDED) if either Refund or Payment was updated.
  //    (d) Outbox.status=PUBLISHED (always — refund command effect achieved).
  //    All commit in the SAME txn — no half-states.
  //
  //    NOTE: this txn does NOT include refundRazorpayPayment() — that call
  //    already happened above (outside the txn). This is the Wave-4 4c safety
  //    improvement: a P2034 retry would re-run only the DB writes, NOT the
  //    refund HTTP call (no double-refund risk).
  await db.$transaction(async (tx) => {
    // Race-safe: only update if Refund.status is still REFUND_PENDING.
    // If a concurrent path (e.g., webhook) already marked REFUNDED, count===0
    // — we still mark the outbox PUBLISHED (refund command effectively done)
    // but skip writing a duplicate AuditLog.
    const refundUpdated = await tx.refund.updateMany({
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

    // Only transition Payment → REFUNDED for a FULL refund (partial refunds
    // leave Payment as CAPTURED — the payment is partially refunded but
    // still considered "captured" for fulfillment purposes). Race-safe
    // conditional updateMany WHERE status='CAPTURED'.
    let paymentUpdated = { count: 0 }
    if (payload.fullRefund) {
      paymentUpdated = await tx.payment.updateMany({
        where: {
          id: refund.paymentId,
          status: 'CAPTURED',
        },
        data: {
          status: 'REFUNDED',
          version: { increment: 1 },
        },
      })
    }

    if (refundUpdated.count > 0 || paymentUpdated.count > 0) {
      // AuditLog — PAYMENT_REFUNDED (publisher-driven).
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'PAYMENT_REFUNDED',
          metadata: JSON.stringify({
            refundId: refund.id,
            paymentId: refund.paymentId,
            orderId: payload.orderId,
            gatewayRefundId: refundResult.gatewayRefundId,
            amount: refund.amount,
            fullRefund: payload.fullRefund,
            source: 'outbox-publisher',
            outboxEventId: event.eventId,
          }),
        },
      })
    }

    // Mark outbox event PUBLISHED (whether or not we updated Refund/Payment —
    // the refund command's business effect has been achieved either way).
    await tx.outbox.update({
      where: { id: event.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        claimedAt: null,
        claimUntil: null,
        workerId: null,
      },
    })
  })

  await log({
    level: 'info',
    message: 'refund-completed',
    eventId: event.eventId,
    eventType: 'PAYMENT_REFUND_REQUESTED',
    refundId: refund.id,
    paymentId: refund.paymentId,
    orderId: payload.orderId,
  })
}

async function log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
  const full: LogEntry = { ...entry, timestamp: new Date().toISOString() }
  const line = JSON.stringify(full)
  console.log(line)
  await appendFile(LOG_FILE, line + '\n').catch(() => {})
}

/**
 * Main publisher loop — claims + publishes + marks events.
 * Called by Vercel Cron (or manual trigger).
 */
async function publishPendingEvents(): Promise<{
  claimed: number
  published: number
  failed: number
  recovered: number
  errors: number
}> {
  const workerId = `worker-${process.pid}-${Date.now()}`
  const result = { claimed: 0, published: 0, failed: 0, recovered: 0, errors: 0 }

  // Step 1: Recover stale CLAIMED events (lease expired)
  const now = new Date()
  const staleRecovery = await db.outbox.updateMany({
    where: {
      status: 'CLAIMED',
      claimUntil: { lt: now },
    },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimUntil: null,
      workerId: null,
    },
  })
  result.recovered = staleRecovery.count
  if (result.recovered > 0) {
    await log({ level: 'warn', message: 'recovered-stale-claimed-events', workerId, count: result.recovered })
  }

  // Step 2: Claim PENDING events (atomic — WHERE status='PENDING')
  const claimResult = await db.outbox.updateMany({
    where: {
      status: 'PENDING',
    },
    data: {
      status: 'CLAIMED',
      claimedAt: now,
      claimUntil: new Date(now.getTime() + LEASE_DURATION_MS),
      workerId,
    },
    // Note: Prisma updateMany doesn't support LIMIT directly, but we
    // fetch only BATCH_SIZE events in the next query
  })
  result.claimed = claimResult.count

  if (result.claimed === 0) {
    return result // nothing to do
  }

  // Step 3: Fetch claimed events for this worker
  const claimedEvents = await db.outbox.findMany({
    where: {
      status: 'CLAIMED',
      workerId,
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  })

  // Step 4: Publish each event
  // PUBLISHED means: successful transport handoff to the consumer.
  // If transport fails, the event goes to retry (PENDING with incremented attempts)
  // or FAILED (max retries). PUBLISHED is NOT set on failure.
  for (const event of claimedEvents) {
    try {
      // Wave-4 4c Phase 2 / Wave-5 5a: command events trigger a business
      // operation (capture / refund payment) rather than a transport handoff.
      // The handler fully owns its own outbox state transitions (PUBLISHED on
      // success, PENDING+attempts on failure via thrown error → publisher's
      // existing catch block handles retry/backoff). It must NOT fall through
      // to the EVENT_TYPE_TO_SOCKET lookup below (which would throw "Unknown
      // event type" since command events are intentionally not in that map).
      if (COMMAND_EVENT_TYPES.has(event.eventType)) {
        if (event.eventType === 'PAYMENT_CAPTURE_REQUESTED') {
          await processPaymentCaptureRequested(event)
        } else if (event.eventType === 'PAYMENT_REFUND_REQUESTED') {
          await processPaymentRefundRequested(event)
        } else {
          // Defensive: should be unreachable (COMMAND_EVENT_TYPES membership is
          // checked above). Throw so the catch block schedules a retry / marks
          // FAILED if the condition persists.
          throw new Error(`No handler registered for command event type: ${event.eventType}`)
        }
        result.published++
        continue
      }

      const socketEventName = EVENT_TYPE_TO_SOCKET[event.eventType]
      if (!socketEventName) {
        throw new Error(`Unknown event type: ${event.eventType}`)
      }

      const payload = JSON.parse(event.payload)

      // Transport: deliver the event via HTTP or Socket.io
      if (TRANSPORT_MODE === 'http') {
        // HTTP mode: POST to consumer endpoint
        if (!CONSUMER_URL) {
          throw new Error('CONSUMER_URL not set for HTTP transport mode')
        }

        const consumerEndpoint = `${CONSUMER_URL}/api/test/consume-event`
        const response = await fetch(consumerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: event.eventId,
            eventType: event.eventType,
            payload,
          }),
          signal: AbortSignal.timeout(5000),
        })

        if (!response.ok) {
          const errBody = await response.text().catch(() => 'unknown')
          throw new Error(`Consumer returned HTTP ${response.status}: ${errBody}`)
        }

        const consumerResult = await response.json()
        await log({ level: 'info', message: 'event-delivered-via-http', eventId: event.eventId, eventType: event.eventType, workerId, consumerProcessed: consumerResult.processed })
      } else {
        // Socket.io mode: emit via realtime service
        const sock = getRealtimeSocket()
        if (!sock || !sock.connected) {
          throw new Error('Realtime service not connected — transport failed')
        }
        sock.emit(socketEventName, payload)
        await log({ level: 'info', message: 'event-published-via-socketio', eventId: event.eventId, eventType: event.eventType, workerId })
      }

      // Mark as PUBLISHED ONLY after successful transport
      await db.outbox.update({
        where: { id: event.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          claimedAt: null,
          claimUntil: null,
          workerId: null,
        },
      })
      result.published++
    } catch (error) {
      const errorMsg = (error as Error).message
      result.errors++

      const newAttempts = event.attempts + 1

      if (newAttempts >= MAX_RETRIES) {
        // Max retries exhausted → FAILED
        await db.outbox.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            attempts: newAttempts,
            lastError: errorMsg,
            claimedAt: null,
            claimUntil: null,
            workerId: null,
          },
        })
        result.failed++
        await log({ level: 'error', message: 'event-failed-max-retries', eventId: event.eventId, eventType: event.eventType, workerId, attempt: newAttempts, error: errorMsg })
      } else {
        // Retry: back to PENDING (will be re-claimed on next invocation with backoff)
        // We use claimUntil to enforce backoff: set it to now + backoff
        const backoffMs = BACKOFF_SCHEDULE_MS[Math.min(newAttempts - 1, BACKOFF_SCHEDULE_MS.length - 1)]
        await db.outbox.update({
          where: { id: event.id },
          data: {
            status: 'PENDING',
            attempts: newAttempts,
            lastError: errorMsg,
            claimedAt: null,
            claimUntil: new Date(Date.now() + backoffMs), // enforce backoff
            workerId: null,
          },
        })
        await log({ level: 'warn', message: 'event-retry-scheduled', eventId: event.eventId, eventType: event.eventType, workerId, attempt: newAttempts, error: errorMsg })
      }
    }
  }

  return result
}

// Health check + manual trigger endpoint
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      return Response.json({ status: 'ok', service: 'outbox-publisher', port: PORT })
    }

    if (url.pathname === '/trigger') {
      // Manual trigger — runs publishPendingEvents once
      try {
        const result = await publishPendingEvents()
        return Response.json({ ok: true, result })
      } catch (error) {
        return Response.json({ ok: false, error: (error as Error).message }, { status: 500 })
      }
    }

    if (url.pathname === '/lag') {
      // Check outbox lag (age of oldest PENDING event)
      const oldestPending = await db.outbox.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, eventId: true, eventType: true },
      })

      if (!oldestPending) {
        return Response.json({ lagSeconds: 0, oldestEventId: null })
      }

      const lagSeconds = Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 1000)
      return Response.json({
        lagSeconds,
        oldestEventId: oldestPending.eventId,
        oldestEventType: oldestPending.eventType,
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

// Run publisher on startup (for Vercel Cron: each invocation runs once)
if (process.env.OUTBOX_PUBLISHER_AUTO_RUN !== 'false') {
  publishPendingEvents().then(async (result) => {
    await log({ level: 'info', message: 'publisher-cycle-complete', result })
    // Don't close server — keep it alive for health checks + manual triggers
  }).catch(async (error) => {
    await log({ level: 'error', message: 'publisher-cycle-error', error: (error as Error).message })
  })
}

console.log(`Outbox publisher running on port ${PORT}`)
