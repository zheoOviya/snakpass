import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// Sub-Wave 4a Evidence — Webhook State Verification Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/webhooks/evidence-verify?eventId=<id>&paymentId=<id>
//
// Returns the full state of webhook-related writes for verification:
//   - WebhookEvent (exists? verified? processed? paymentId?)
//   - Payment (status? capturedAt? version?)
//   - AuditLog (WEBHOOK_RECEIVED / WEBHOOK_REJECTED / WEBHOOK_PROCESSED entries)
//   - Outbox (PAYMENT_CAPTURE_CONFIRMED event exists?)
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const eventId = url.searchParams.get('eventId')
  const paymentId = url.searchParams.get('paymentId')

  if (!eventId && !paymentId) {
    return apiError('VALIDATION_ERROR', 'eventId or paymentId query param required', 400)
  }

  // 1. WebhookEvent state
  let webhookEvent = null
  if (eventId) {
    webhookEvent = await db.webhookEvent.findUnique({
      where: { eventId },
      select: {
        id: true,
        eventId: true,
        eventType: true,
        paymentId: true,
        verified: true,
        processed: true,
        processedAt: true,
        processedBy: true,
        processingNotes: true,
        receivedAt: true,
      },
    })
  }

  // 2. Payment state
  let payment = null
  if (paymentId) {
    payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        capturedAt: true,
        gatewayPaymentId: true,
        version: true,
        failureReason: true,
        retryCount: true,
      },
    })
  }

  // 3. AuditLog (webhook-related entries for this paymentId or eventId)
  // Query by paymentId OR by webhookEventId (which is in the metadata of WEBHOOK_RECEIVED)
  let auditLogs: { id: string; action: string; createdAt: Date }[] = []
  if (paymentId || eventId) {
    const searchTerms = [paymentId, eventId].filter(Boolean) as string[]
    const orConditions = searchTerms.map((term) => ({
      action: { startsWith: 'WEBHOOK_' },
      metadata: { contains: term },
    }))
    auditLogs = await db.auditLog.findMany({
      where: { OR: orConditions },
      select: { id: true, action: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  // 4. Outbox (PAYMENT_CAPTURE_CONFIRMED for this payment)
  let outbox = null
  if (paymentId) {
    outbox = await db.outbox.findFirst({
      where: {
        aggregateType: 'Payment',
        aggregateId: paymentId,
        eventType: 'PAYMENT_CAPTURE_CONFIRMED',
      },
      select: { id: true, eventId: true, status: true, eventType: true, createdAt: true },
    })
  }

  // 5. Count all WebhookEvents with this eventId (for concurrent test — should be 1)
  let webhookEventCount = null
  if (eventId) {
    webhookEventCount = await db.webhookEvent.count({
      where: { eventId },
    })
  }

  // Compute invariants:
  // exactlyOneWebhookProcessed: webhookEvent exists + verified + processed + payment CAPTURED
  const webhookEventExists = !!webhookEvent
  const webhookVerified = webhookEvent?.verified === true
  const webhookProcessed = webhookEvent?.processed === true
  const paymentCaptured = payment?.status === 'CAPTURED'
  const exactlyOneWebhookProcessed =
    webhookEventExists &&
    webhookVerified &&
    webhookProcessed &&
    paymentCaptured

  // webhookRejected: webhookEvent exists + verified=false (signature mismatch)
  const webhookRejected = webhookEventExists && !webhookVerified

  // webhookDeduped: eventId was received but no new WebhookEvent created (count = 1 from first delivery)
  // This is verified by the route returning status='duplicate'

  return NextResponse.json({
    eventId,
    paymentId,
    webhookEvent: webhookEvent
      ? {
          exists: true,
          id: webhookEvent.id,
          eventType: webhookEvent.eventType,
          verified: webhookEvent.verified,
          processed: webhookEvent.processed,
          processedAt: webhookEvent.processedAt,
          processedBy: webhookEvent.processedBy,
          processingNotes: webhookEvent.processingNotes,
          paymentId: webhookEvent.paymentId,
        }
      : { exists: false },
    payment: payment
      ? {
          exists: true,
          id: payment.id,
          status: payment.status,
          capturedAt: payment.capturedAt,
          gatewayPaymentId: payment.gatewayPaymentId,
          version: payment.version,
          failureReason: payment.failureReason,
          retryCount: payment.retryCount,
        }
      : { exists: false },
    auditLogCount: auditLogs.length,
    auditLogActions: auditLogs.map((a) => a.action),
    outboxExists: !!outbox,
    outboxStatus: outbox?.status ?? null,
    webhookEventCount,
    // Invariant flags (computed server-side for self-validation)
    exactlyOneWebhookProcessed,
    webhookRejected,
    evidenceTestMode: true,
    verifiedAt: new Date().toISOString(),
  })
}
