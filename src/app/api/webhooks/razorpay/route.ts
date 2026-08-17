import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { withErrorHandler, apiError } from '@/lib/errors'
import { info as logInfo, warn as logWarn, newTraceId } from '@/lib/logger'
import { verifyWebhookSignature } from '@/lib/razorpay'
import { isFeatureEnabled } from '@/lib/deployment'
import { processWebhookEvent } from '@/lib/webhook-processor'
import { createHash } from 'crypto'

// P0-05 Wave-4 Sub-Wave 4a — Razorpay Webhook Handler
//
// POST /api/webhooks/razorpay
//
// Receives Razorpay webhook events, verifies HMAC signature, deduplicates via
// WebhookEvent.eventId unique constraint, and processes the event idempotently.
//
// Feature flag: webhookHandler (default OFF)
// When OFF: returns 503 (handler not enabled)
// When ON:  processes webhooks normally
//
// In demo mode (realPayments=false):
//   - HMAC verification accepts any non-empty signature
//   - Evidence tests can simulate webhook events with test payloads
//   - X-Evidence-Skip-Verify header (only when EVIDENCE_TEST_MODE=true) skips HMAC
//     verification entirely (for testing signature-mismatch scenarios)
//
// In real mode (realPayments=true):
//   - HMAC verification uses RAZORPAY_WEBHOOK_SECRET
//   - Real Razorpay webhook payloads are expected

const EVIDENCE_TEST_MODE = process.env.EVIDENCE_TEST_MODE === 'true'

export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const traceId = newTraceId()

  // Feature flag check
  if (!isFeatureEnabled('webhookHandler')) {
    return apiError('KILL_SWITCH_ACTIVE', 'Webhook handler is not enabled (feature flag off)', 503, undefined, traceId)
  }

  // Read raw body (needed for HMAC verification — must be the exact bytes received)
  const rawBody = await req.text()

  // Extract headers
  const eventId = req.headers.get('x-razorpay-event-id')
  const eventType = req.headers.get('x-razorpay-event') ?? (req.headers.get('x-razorpay-event-type') ?? '')
  const signature = req.headers.get('x-razorpay-signature') ?? ''

  // Evidence test mode: allow skipping HMAC verification for testing signature-mismatch scenarios
  const skipVerify = EVIDENCE_TEST_MODE && req.headers.get('x-evidence-skip-verify') === 'true'

  if (!eventId) {
    logWarn('webhook-missing-event-id', { traceId }, traceId)
    return apiError('VALIDATION_ERROR', 'Missing X-Razorpay-Event-Id header', 400, undefined, traceId)
  }

  if (!eventType) {
    logWarn('webhook-missing-event-type', { eventId, traceId }, traceId)
    return apiError('VALIDATION_ERROR', 'Missing X-Razorpay-Event header', 400, undefined, traceId)
  }

  // Compute payload hash (for integrity verification / tamper detection)
  const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex')

  // Parse payload
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    logWarn('webhook-invalid-json', { eventId, traceId }, traceId)
    return apiError('VALIDATION_ERROR', 'Invalid JSON payload', 400, undefined, traceId)
  }

  // HMAC signature verification
  let verified = false
  if (skipVerify) {
    // Evidence test mode — skip verification
    verified = true
    logInfo('webhook-verify-skipped', { eventId, evidenceTestMode: true, traceId }, traceId)
  } else {
    verified = verifyWebhookSignature(rawBody, signature)
    if (!verified) {
      logWarn('webhook-signature-mismatch', { eventId, eventType, traceId }, traceId)

      // Record the failed verification attempt (for audit trail)
      try {
        await db.webhookEvent.create({
          data: {
            eventId,
            eventType,
            payload: rawBody,
            payloadHash,
            signature,
            verified: false,
            processed: false,
            processingNotes: 'HMAC signature verification failed',
          },
        })
      } catch {
        // P2002 — eventId already exists (duplicate webhook with bad signature)
        // Just log it, don't fail
      }

      // Audit log
      await db.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'WEBHOOK_REJECTED',
          metadata: JSON.stringify({ eventId, eventType, reason: 'SIGNATURE_MISMATCH', traceId }),
        },
      })

      return apiError('AUTHORIZATION_DENIED', 'Webhook signature verification failed', 403, { eventId, eventType }, traceId)
    }
  }

  logInfo('webhook-received', { eventId, eventType, verified, traceId }, traceId)

  try {
    const result = await withTransaction(async (tx) => {
      // Dedup: Check if this eventId already exists
      // If it does, the webhook was already received — return 200 (idempotent)
      const existing = await tx.webhookEvent.findUnique({
        where: { eventId },
        select: { id: true, processed: true, paymentId: true, processingNotes: true },
      })

      if (existing) {
        logInfo('webhook-dedup-hit', { eventId, alreadyProcessed: existing.processed, traceId }, traceId)
        return {
          type: 'deduped' as const,
          webhookEventId: existing.id,
          alreadyProcessed: existing.processed,
          paymentId: existing.paymentId,
          notes: existing.processingNotes,
        }
      }

      // Create the WebhookEvent record (dedup via unique constraint on eventId)
      const webhookEvent = await tx.webhookEvent.create({
        data: {
          eventId,
          eventType,
          payload: rawBody,
          payloadHash,
          signature,
          verified,
        },
      })

      // Audit log: webhook received + verified
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'WEBHOOK_RECEIVED',
          metadata: JSON.stringify({
            webhookEventId: webhookEvent.id,
            eventId,
            eventType,
            verified,
            traceId,
          }),
        },
      })

      // Only process if verified
      if (!verified) {
        return {
          type: 'unverified' as const,
          webhookEventId: webhookEvent.id,
          alreadyProcessed: false,
          paymentId: null,
          notes: 'Webhook not verified — recorded but not processed',
        }
      }

      // Process the webhook event (updates Payment, AuditLog, Outbox)
      const processingResult = await processWebhookEvent(
        tx,
        webhookEvent.id,
        eventType,
        payload,
        traceId,
      )

      return {
        type: 'processed' as const,
        webhookEventId: webhookEvent.id,
        alreadyProcessed: false,
        paymentId: processingResult.paymentId,
        notes: processingResult.notes,
        processingResult,
      }
    })

    // Handle result
    if (result.type === 'deduped') {
      logInfo('webhook-dedup-returned', { eventId, alreadyProcessed: result.alreadyProcessed, traceId }, traceId)
      return NextResponse.json({
        ok: true,
        eventId,
        status: 'duplicate',
        alreadyProcessed: result.alreadyProcessed,
        paymentId: result.paymentId,
        notes: result.notes,
        traceId,
      })
    }

    if (result.type === 'unverified') {
      logWarn('webhook-unverified-returned', { eventId, traceId }, traceId)
      return NextResponse.json({
        ok: true,
        eventId,
        status: 'unverified',
        verified: false,
        notes: result.notes,
        traceId,
      }, { status: 200 }) // Return 200 so Razorpay doesn't retry
    }

    // result.type === 'processed'
    logInfo('webhook-processed', { eventId, paymentId: result.paymentId, traceId }, traceId)
    return NextResponse.json({
      ok: true,
      eventId,
      status: 'processed',
      verified: true,
      paymentId: result.paymentId,
      notes: result.notes,
      traceId,
    })
  } catch (error) {
    if (error instanceof TransactionConflictError) {
      logInfo('webhook-conflict', { eventId, attempts: error.attempts, code: error.code, traceId }, traceId)
      // Return 200 so Razorpay doesn't retry (the webhook will be deduped on next delivery)
      return NextResponse.json({
        ok: true,
        eventId,
        status: 'conflict-resolved',
        notes: 'Concurrent webhook processing — will be deduped on retry',
        traceId,
      })
    }
    throw error
  }
})
