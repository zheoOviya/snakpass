import { Prisma } from '@prisma/client'
import { info as logInfo, error as logError } from './logger'
import { enqueueOutboxEvent } from './outbox'

// P0-05 Wave-4 Sub-Wave 4a — Webhook event processor
//
// Routes webhook event types to handlers:
//   - payment.captured → idempotent Payment update (status=CAPTURED, capturedAt)
//   - payment.failed   → Payment status update + exception queue entry
//   - refund.processed → log + defer to Wave-5
//
// All processing happens INSIDE a withTransaction() call (passed by the route handler)
// to ensure atomicity: WebhookEvent + Payment update + AuditLog + Outbox are committed
// in the same transaction.

export interface WebhookProcessingResult {
  processed: boolean
  paymentId: string | null
  notes: string
}

/**
 * Process a verified webhook event.
 *
 * MUST be called inside a withTransaction() block.
 * The `tx` parameter is the Prisma transaction client.
 *
 * @param tx - The Prisma transaction client
 * @param webhookEventId - The WebhookEvent.id (already created by the route handler)
 * @param eventType - The webhook event type (e.g. "payment.captured")
 * @param payload - The parsed webhook payload
 * @param traceId - For logging correlation
 * @returns Processing result (processed, paymentId, notes)
 */
export async function processWebhookEvent(
  tx: Prisma.TransactionClient,
  webhookEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  traceId: string,
): Promise<WebhookProcessingResult> {
  logInfo('webhook-processing-start', { webhookEventId, eventType, traceId }, traceId)

  let result: WebhookProcessingResult

  switch (eventType) {
    case 'payment.captured':
      result = await handlePaymentCaptured(tx, webhookEventId, payload, traceId)
      break

    case 'payment.failed':
      result = await handlePaymentFailed(tx, webhookEventId, payload, traceId)
      break

    case 'refund.processed':
      // Wave-5 scope — record but don't process
      result = await handleRefundProcessed(tx, webhookEventId, payload, traceId)
      break

    default:
      // Unknown event type — mark as processed with note
      result = {
        processed: true,
        paymentId: null,
        notes: `Unknown event type '${eventType}' — recorded but not processed`,
      }
  }

  // Update the WebhookEvent with processing result
  await tx.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      processed: result.processed,
      processedAt: new Date(),
      processedBy: 'webhook-handler-4a',
      processingNotes: result.notes,
      paymentId: result.paymentId,
    },
  })

  logInfo('webhook-processing-complete', {
    webhookEventId,
    eventType,
    processed: result.processed,
    paymentId: result.paymentId,
    notes: result.notes,
    traceId,
  }, traceId)

  return result
}

/**
 * Handle payment.captured webhook event.
 *
 * Updates the Payment record to CAPTURED status (if not already captured).
 * Uses optimistic-lock version field to prevent race conditions.
 *
 * If the Payment is already CAPTURED (e.g., capture route already processed it),
 * this is a no-op — the webhook just confirms the capture.
 */
async function handlePaymentCaptured(
  tx: Prisma.TransactionClient,
  webhookEventId: string,
  payload: Record<string, unknown>,
  traceId: string,
): Promise<WebhookProcessingResult> {
  // Extract payment ID from payload
  // Razorpay webhook payload structure: { entity: { event: "payment.captured", payload: { payment: { entity: { id: "pay_xxx", order_id: "order_xxx", amount: 6000, ... } } } } }
  // For demo/evidence mode, we accept a simpler structure: { paymentId, orderId, amount }
  const gatewayPaymentId = (payload.paymentId ?? payload.entity?.id ?? payload.payload?.payment?.entity?.id) as string | undefined
  const gatewayOrderId = (payload.orderId ?? payload.entity?.order_id ?? payload.payload?.payment?.entity?.order_id) as string | undefined
  const amount = (payload.amount ?? payload.entity?.amount ?? payload.payload?.payment?.entity?.amount) as number | undefined

  if (!gatewayPaymentId) {
    return {
      processed: false,
      paymentId: null,
      notes: 'payment.captured: missing gatewayPaymentId in payload',
    }
  }

  // Find the Payment by gatewayPaymentId
  const payment = await tx.payment.findFirst({
    where: { gatewayPaymentId },
    select: { id: true, status: true, version: true, orderId: true, amount: true },
  })

  if (!payment) {
    return {
      processed: false,
      paymentId: null,
      notes: `payment.captured: Payment not found for gatewayPaymentId=${gatewayPaymentId}`,
    }
  }

  // If already captured, this is a confirmation webhook — no-op
  if (payment.status === 'CAPTURED') {
    return {
      processed: true,
      paymentId: payment.id,
      notes: `payment.captured: Payment ${payment.id} already CAPTURED — confirmation webhook (no-op)`,
    }
  }

  // Update Payment to CAPTURED using optimistic-lock (version field)
  // This handles the race where the capture route AND the webhook both try to update
  const updated = await tx.payment.updateMany({
    where: {
      id: payment.id,
      version: payment.version,
      status: { not: 'CAPTURED' }, // Don't update if already captured
    },
    data: {
      status: 'CAPTURED',
      capturedAt: new Date(),
      gatewayPaymentId,
      ...(gatewayOrderId ? { gatewayOrderId } : {}),
      version: { increment: 1 },
    },
  })

  if (updated.count === 0) {
    // Another concurrent transaction already captured — this is fine (idempotent)
    return {
      processed: true,
      paymentId: payment.id,
      notes: `payment.captured: Payment ${payment.id} was captured by concurrent transaction — webhook is confirmation (no-op)`,
    }
  }

  // Audit log
  await tx.auditLog.create({
    data: {
      actorId: null, // System (webhook)
      actorRole: 'SYSTEM',
      action: 'WEBHOOK_PAYMENT_CAPTURED',
      metadata: JSON.stringify({
        webhookEventId,
        paymentId: payment.id,
        gatewayPaymentId,
        amount: amount ?? payment.amount,
      }),
    },
  })

  // Outbox event for downstream consumers
  await enqueueOutboxEvent(tx, {
    eventType: 'PAYMENT_CAPTURE_CONFIRMED',
    aggregateType: 'Payment',
    aggregateId: payment.id,
    payload: {
      paymentId: payment.id,
      orderId: payment.orderId,
      gatewayPaymentId,
      amount: amount ?? payment.amount,
      source: 'webhook',
    },
  })

  logInfo('webhook-payment-captured', {
    webhookEventId,
    paymentId: payment.id,
    gatewayPaymentId,
    traceId,
  }, traceId)

  return {
    processed: true,
    paymentId: payment.id,
    notes: `payment.captured: Payment ${payment.id} updated to CAPTURED`,
  }
}

/**
 * Handle payment.failed webhook event.
 *
 * Updates the Payment record to FAILED status.
 */
async function handlePaymentFailed(
  tx: Prisma.TransactionClient,
  webhookEventId: string,
  payload: Record<string, unknown>,
  traceId: string,
): Promise<WebhookProcessingResult> {
  const gatewayPaymentId = (payload.paymentId ?? payload.entity?.id) as string | undefined
  const failureReason = (payload.error_description ?? payload.error ?? payload.entity?.error_description ?? 'Unknown failure') as string

  if (!gatewayPaymentId) {
    return {
      processed: false,
      paymentId: null,
      notes: 'payment.failed: missing gatewayPaymentId in payload',
    }
  }

  const payment = await tx.payment.findFirst({
    where: { gatewayPaymentId },
    select: { id: true, status: true, version: true },
  })

  if (!payment) {
    return {
      processed: false,
      paymentId: null,
      notes: `payment.failed: Payment not found for gatewayPaymentId=${gatewayPaymentId}`,
    }
  }

  if (payment.status === 'FAILED') {
    return {
      processed: true,
      paymentId: payment.id,
      notes: `payment.failed: Payment ${payment.id} already FAILED — duplicate webhook (no-op)`,
    }
  }

  // Update Payment to FAILED using optimistic-lock
  const updated = await tx.payment.updateMany({
    where: {
      id: payment.id,
      version: payment.version,
      status: { notIn: ['FAILED', 'CAPTURED'] }, // Don't override CAPTURED or already-FAILED
    },
    data: {
      status: 'FAILED',
      failureReason: `Webhook: ${failureReason}`,
      version: { increment: 1 },
    },
  })

  if (updated.count === 0) {
    return {
      processed: true,
      paymentId: payment.id,
      notes: `payment.failed: Payment ${payment.id} status was ${payment.status} — not updated (concurrent capture may have won)`,
    }
  }

  // P2-REPAIR-38: Converge Order status from PAID → CANCELLED on terminal payment failure.
  // Previously: Payment was set to FAILED but Order stayed PAID (false paid state).
  // Now: Order converges to CANCELLED, providing truthful customer-visible state.
  await tx.order.updateMany({
    where: { id: payment.orderId, status: 'PAID' },
    data: { status: 'CANCELLED' },
  })

  // Audit log
  await tx.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'SYSTEM',
      action: 'WEBHOOK_PAYMENT_FAILED',
      metadata: JSON.stringify({
        webhookEventId,
        paymentId: payment.id,
        orderId: payment.orderId,
        gatewayPaymentId,
        failureReason,
        orderConverged: 'PAID → CANCELLED',
      }),
    },
  })

  logError('webhook-payment-failed', {
    webhookEventId,
    paymentId: payment.id,
    gatewayPaymentId,
    failureReason,
    traceId,
  }, traceId)

  return {
    processed: true,
    paymentId: payment.id,
    notes: `payment.failed: Payment ${payment.id} updated to FAILED (${failureReason})`,
  }
}

/**
 * Handle refund.processed webhook event.
 *
 * Wave-5 scope — recorded but not processed.
 */
async function handleRefundProcessed(
  tx: Prisma.TransactionClient,
  webhookEventId: string,
  payload: Record<string, unknown>,
  traceId: string,
): Promise<WebhookProcessingResult> {
  const gatewayPaymentId = (payload.paymentId ?? payload.entity?.payment_id) as string | undefined

  // Audit log (record that we received the webhook)
  await tx.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'SYSTEM',
      action: 'WEBHOOK_REFUND_RECEIVED',
      metadata: JSON.stringify({
        webhookEventId,
        gatewayPaymentId,
        note: 'refund.processed received but NOT processed (Wave-5 scope)',
      }),
    },
  })

  logInfo('webhook-refund-deferred', {
    webhookEventId,
    gatewayPaymentId,
    traceId,
    note: 'Deferred to Wave-5',
  }, traceId)

  return {
    processed: true,
    paymentId: null,
    notes: `refund.processed: Recorded but NOT processed (Wave-5 scope). gatewayPaymentId=${gatewayPaymentId ?? 'N/A'}`,
  }
}
