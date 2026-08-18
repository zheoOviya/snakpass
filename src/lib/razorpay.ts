import Razorpay from 'razorpay'
import crypto from 'crypto'
import { isFeatureEnabled } from './deployment'

// P0-01 Wave-3 — Razorpay integration (test-mode by default)
//
// When realPayments feature flag is OFF (default):
//   - Capture returns a simulated success response
//   - No real Razorpay API calls are made
//   - Signature verification uses a mock signature
//
// When realPayments feature flag is ON:
//   - Real Razorpay test API is called
//   - Real signature verification (HMAC-SHA256)
//   - Requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET env vars

let razorpayInstance: Razorpay | null = null

function getRazorpayInstance(): Razorpay | null {
  if (!isFeatureEnabled('realPayments')) {
    return null // demo mode
  }
  if (razorpayInstance) return razorpayInstance
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET required when realPayments is enabled')
  }
  razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret })
  return razorpayInstance
}

export interface RazorpayOrderResponse {
  razorpayOrderId: string
  amount: number
  currency: string
}

export interface RazorpayCaptureResponse {
  captured: boolean
  gatewayPaymentId: string
  signature: string
}

/**
 * Create a Razorpay order (gateway-side).
 * In demo mode, returns a mock order ID.
 */
export async function createRazorpayOrder(
  amount: number,
  currency: string = 'INR',
  idempotencyKey?: string,
): Promise<RazorpayOrderResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: return mock order. The idempotencyKey is accepted but not sent to a real gateway.
    return {
      razorpayOrderId: `order_demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
      currency,
    }
  }

  const instance = getRazorpayInstance()!
  // Pass the idempotency key as a header if provided (Razorpay X-Idempotency-Key).
  const options = idempotencyKey
    ? { headers: { 'X-Idempotency-Key': idempotencyKey } }
    : undefined
  const order = await instance.orders.create({
    amount,
    currency,
  }, options)

  return {
    razorpayOrderId: order.id,
    amount: order.amount,
    currency: order.currency,
  }
}

/**
 * Verify Razorpay payment signature (HMAC-SHA256).
 * In demo mode, accepts any non-empty signature.
 */
export function verifyRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): boolean {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: accept any non-empty signature
    return razorpaySignature.length > 0
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET!
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')

  // Constant-time comparison
  if (expectedSignature.length !== razorpaySignature.length) return false
  let match = true
  for (let i = 0; i < expectedSignature.length; i++) {
    if (expectedSignature[i] !== razorpaySignature[i]) match = false
  }
  return match
}

/**
 * Capture a Razorpay payment.
 * In demo mode, returns a simulated capture response.
 */
export async function captureRazorpayPayment(
  razorpayPaymentId: string,
  amount: number,
  currency: string = 'INR',
  idempotencyKey?: string,
): Promise<RazorpayCaptureResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: simulate successful capture. The idempotencyKey is accepted but not sent to a real gateway.
    return {
      captured: true,
      gatewayPaymentId: razorpayPaymentId,
      signature: `sig_demo_${Date.now()}`,
    }
  }

  const instance = getRazorpayInstance()!
  // Pass the idempotency key as a header if provided (Razorpay X-Idempotency-Key).
  const options = idempotencyKey
    ? { headers: { 'X-Idempotency-Key': idempotencyKey } }
    : undefined
  const capture = await instance.payments.capture(razorpayPaymentId, amount, currency, options)

  return {
    captured: capture.captured === true,
    gatewayPaymentId: razorpayPaymentId,
    signature: capture.id, // Razorpay returns capture ID, not signature — signature is from webhook
  }
}

export function isRazorpayConfigured(): boolean {
  return isFeatureEnabled('realPayments') &&
    !!process.env.RAZORPAY_KEY_ID &&
    !!process.env.RAZORPAY_KEY_SECRET
}

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — Razorpay payment status fetch (READ-ONLY)
// ----------------------------------------------------------------------------
// fetchRazorpayPaymentStatus() is a READ-ONLY gateway query used by the M3
// remediation handler to verify whether a capture actually succeeded at the
// gateway before flipping Payment.status from CAPTURE_PENDING to CAPTURED.
//
// SAFETY CONTRACT (Orchestrator hard boundary for 5C-M3):
//   - This function is FETCH ONLY. It MUST NOT capture, refund, or mutate
//     any gateway state.
//   - It MUST be called OUTSIDE any withTransaction() body (TRANSACTION_RETRY_INVARIANT).
//   - In demo mode (realPayments=false), it returns a mock status for evidence testing.
//   - In real mode (realPayments=true), it calls instance.payments.fetch().
//
// The returned status is used by the M3 handler to decide:
//   'captured'    → proceed with Payment.status flip (CAPTURE_PENDING → CAPTURED)
//   'authorized'  → DO NOT flip (capture didn't happen — escalate)
//   'failed'      → DO NOT flip (payment failed — escalate)
//   'refunded'    → DO NOT flip (multi-state drift — escalate)
//   error/timeout → DO NOT flip (ambiguous — abort + retry later)

export type RazorpayPaymentStatus =
  | 'captured'
  | 'authorized'
  | 'failed'
  | 'refunded'
  | 'unknown'

export interface RazorpayPaymentStatusResponse {
  status: RazorpayPaymentStatus
  gatewayPaymentId: string
  amount: number // paise
  currency: string
  captured: boolean // Razorpay's captured flag
  raw?: unknown // raw response for audit (real mode only)
}

/**
 * Fetch the current status of a Razorpay payment.
 *
 * This is a READ-ONLY gateway query. It does NOT capture, refund, or mutate
 * any gateway state. It MUST be called OUTSIDE any withTransaction() body
 * (TRANSACTION_RETRY_INVARIANT — mirrors the capture/refund external-call pattern).
 *
 * In demo mode (realPayments=false): returns a mock status based on the
 * EVIDENCE_TEST_MODE flag + optional EVIDENCE_GATEWAY_STATUS env var (for
 * M3 evidence scenarios that need to simulate different gateway responses).
 *
 * In real mode (realPayments=true): calls instance.payments.fetch(razorpayPaymentId)
 * + maps the Razorpay status to our internal RazorpayPaymentStatus type.
 *
 * @param razorpayPaymentId - The Razorpay payment ID (pay_*)
 * @returns RazorpayPaymentStatusResponse — the authoritative gateway truth
 */
export async function fetchRazorpayPaymentStatus(
  razorpayPaymentId: string,
): Promise<RazorpayPaymentStatusResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: return mock status for evidence testing.
    // EVIDENCE_GATEWAY_STATUS env var controls the mock response (default: 'captured').
    // This lets evidence scenarios simulate 'authorized', 'failed', 'error', etc.
    const mockStatus = (process.env.EVIDENCE_GATEWAY_STATUS as RazorpayPaymentStatus) ?? 'captured'
    return {
      status: mockStatus,
      gatewayPaymentId: razorpayPaymentId,
      amount: 0, // unknown in mock mode — M3 handler doesn't use this
      currency: 'INR',
      captured: mockStatus === 'captured',
    }
  }

  const instance = getRazorpayInstance()!
  const payment = await instance.payments.fetch(razorpayPaymentId)

  // Map Razorpay's status field to our internal type.
  // Razorpay payment statuses: 'created', 'authorized', 'captured', 'failed',
  // 'refunded'. We map 'created' → 'unknown' (shouldn't happen for a
  // CAPTURE_PENDING payment).
  const razorpayStatus = payment.status ?? 'unknown'
  let status: RazorpayPaymentStatus
  switch (razorpayStatus) {
    case 'captured':
      status = 'captured'
      break
    case 'authorized':
      status = 'authorized'
      break
    case 'failed':
      status = 'failed'
      break
    case 'refunded':
      status = 'refunded'
      break
    default:
      status = 'unknown'
      break
  }

  return {
    status,
    gatewayPaymentId: razorpayPaymentId,
    amount: payment.amount ?? 0,
    currency: payment.currency ?? 'INR',
    captured: payment.captured ?? false,
    raw: payment,
  }
}

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — Razorpay refund status fetch (READ-ONLY)
// ----------------------------------------------------------------------------
// fetchRazorpayRefundStatus() is a READ-ONLY gateway query used by the M10
// remediation handler to verify whether a refund actually occurred at the
// gateway before flipping Refund.status from REFUND_PENDING to REFUNDED.
//
// SAFETY CONTRACT (Orchestrator hard boundary for 5C-M10):
//   - This function is FETCH ONLY. It MUST NOT initiate, retry, or mutate
//     any refund at the gateway.
//   - It MUST be called OUTSIDE any withTransaction() body (TRANSACTION_RETRY_INVARIANT).
//   - In demo mode (realPayments=false), it returns a mock status for evidence testing.
//   - In real mode (realPayments=true), it calls instance.refunds.fetch(refundId).
//
// The returned status is used by the M10 handler to decide:
//   'processed' → proceed with Refund.status flip (REFUND_PENDING → REFUNDED)
//   'pending'    → DO NOT flip (refund not yet confirmed — escalate)
//   'failed'     → DO NOT flip (refund failed — escalate)
//   error/timeout → DO NOT flip (ambiguous — abort + retry later)

export type RazorpayRefundStatus =
  | 'processed'
  | 'pending'
  | 'failed'
  | 'unknown'

export interface RazorpayRefundStatusResponse {
  status: RazorpayRefundStatus
  refundId: string
  amount: number // paise
  currency: string
  raw?: unknown // raw response for audit (real mode only)
}

/**
 * Fetch the current status of a Razorpay refund.
 *
 * This is a READ-ONLY gateway query. It does NOT initiate, retry, or mutate
 * any refund at the gateway. It MUST be called OUTSIDE any withTransaction()
 * body (TRANSACTION_RETRY_INVARIANT — mirrors fetchRazorpayPaymentStatus pattern).
 *
 * In demo mode (realPayments=false): returns a mock status based on the
 * EVIDENCE_GATEWAY_REFUND_STATUS env var (default: 'processed').
 *
 * In real mode (realPayments=true): calls instance.refunds.fetch(refundId)
 * + maps the Razorpay refund status to our internal type.
 *
 * @param refundId - The Razorpay refund ID (rpf_*) OR the internal Refund.gatewayRefundId
 * @returns RazorpayRefundStatusResponse — the authoritative gateway truth for the refund
 */
export async function fetchRazorpayRefundStatus(
  refundId: string,
): Promise<RazorpayRefundStatusResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: return mock status for evidence testing.
    const mockStatus = (process.env.EVIDENCE_GATEWAY_REFUND_STATUS as RazorpayRefundStatus) ?? 'processed'
    return {
      status: mockStatus,
      refundId,
      amount: 0,
      currency: 'INR',
    }
  }

  const instance = getRazorpayInstance()!
  const refund = await instance.refunds.fetch(refundId)

  // Map Razorpay refund status to our internal type.
  // Razorpay refund statuses: 'pending' | 'processed' | 'failed'.
  const razorpayStatus = refund.status ?? 'unknown'
  let status: RazorpayRefundStatus
  switch (razorpayStatus) {
    case 'processed':
      status = 'processed'
      break
    case 'pending':
      status = 'pending'
      break
    case 'failed':
      status = 'failed'
      break
    default:
      status = 'unknown'
      break
  }

  return {
    status,
    refundId,
    amount: refund.amount ?? 0,
    currency: refund.currency ?? 'INR',
    raw: refund,
  }
}

// ----------------------------------------------------------------------------
// P0-04 Wave-5 Sub-Wave 5a — Razorpay refund (mirrors 4c capture pattern)
// ----------------------------------------------------------------------------

export interface RazorpayRefundResponse {
  refunded: boolean
  gatewayRefundId: string // Razorpay refund ID (rpf_*)
  amount: number // paise actually refunded
  currency: string
}

/**
 * Refund a Razorpay payment (full or partial).
 *
 * In demo mode (realPayments=false): returns a simulated success response —
 * no real Razorpay API call is made. This is the SAME safety contract as
 * `captureRazorpayPayment()` (Wave-4 4c): the call is performed by the outbox
 * publisher OUTSIDE any DB transaction body, so a P2034 retry of the success
 * txn does NOT re-execute the refund HTTP call (no double-refund risk).
 *
 * In real mode: calls `instance.payments.refund(razorpayPaymentId, { amount,
 * currency })`. Razorpay returns a refund object whose `id` is `rpf_*` and
 * whose `status` is `pending`/`processed`/`failed`. We treat `processed` +
 * `pending` as success (the gateway has accepted the refund request — final
 * settlement is async and confirmed via webhook).
 *
 * @param razorpayPaymentId - The Razorpay payment ID (pay_*)
 * @param amount - Refund amount in paise (must be > 0; for full refund, equals Payment.amount)
 * @param currency - ISO 4217 currency code (default INR)
 * @returns RazorpayRefundResponse — refunded=true on success
 */
export async function refundRazorpayPayment(
  razorpayPaymentId: string,
  amount: number,
  currency: string = 'INR',
  idempotencyKey?: string,
): Promise<RazorpayRefundResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: simulate successful refund. The idempotencyKey is accepted but not sent to a real gateway.
    return {
      refunded: true,
      gatewayRefundId: `rpf_demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
      currency,
    }
  }

  const instance = getRazorpayInstance()!
  // Pass the idempotency key in the refund request body if provided (Razorpay idempotency_key).
  const refundParams: Record<string, unknown> = { amount, currency }
  if (idempotencyKey) {
    refundParams.idempotency_key = idempotencyKey
  }
  const refund = await instance.payments.refund(razorpayPaymentId, refundParams)

  // Razorpay refund statuses: 'pending' | 'processed' | 'failed'.
  // 'pending' means the refund request is accepted and queued for processing
  // (bank settlement is async). Treat both 'pending' and 'processed' as success.
  const acceptedStatuses = ['pending', 'processed']
  return {
    refunded: acceptedStatuses.includes(refund.status ?? ''),
    gatewayRefundId: refund.id,
    amount: refund.amount ?? amount,
    currency: refund.currency ?? currency,
  }
}

// ----------------------------------------------------------------------------
// Sub-Wave 4a: Webhook signature verification (P0-05)
// ----------------------------------------------------------------------------

/**
 * Verify a Razorpay webhook signature (HMAC-SHA256).
 *
 * Razorpay sends webhooks with an `X-Razorpay-Signature` header containing
 * the HMAC-SHA256 of the raw request body, using the webhook secret.
 *
 * In demo mode (realPayments=false), accepts any non-empty signature so that
 * evidence tests can run without real Razorpay credentials.
 *
 * In real mode (realPayments=true), computes HMAC-SHA256 of the payload using
 * RAZORPAY_WEBHOOK_SECRET and compares in constant time.
 *
 * @param payload - The raw request body (as a string)
 * @param signature - The X-Razorpay-Signature header value
 * @param secret - The RAZORPAY_WEBHOOK_SECRET env var (or a test secret)
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string | undefined = process.env.RAZORPAY_WEBHOOK_SECRET,
): boolean {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: accept any non-empty signature
    // Evidence tests use X-Evidence-Skip-Verify header for HMAC tests
    return signature.length > 0
  }

  if (!secret) {
    // No webhook secret configured — reject all webhooks
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')

  // Constant-time comparison (prevents timing attacks)
  if (expectedSignature.length !== signature.length) return false
  let match = true
  for (let i = 0; i < expectedSignature.length; i++) {
    if (expectedSignature[i] !== signature[i]) match = false
  }
  return match
}

/**
 * Check if webhook signature verification is configured (real mode only).
 * In demo mode, verification is always "configured" (accepts any non-empty signature).
 */
export function isWebhookConfigured(): boolean {
  if (!isFeatureEnabled('realPayments')) {
    return true // demo mode — always "configured"
  }
  return !!process.env.RAZORPAY_WEBHOOK_SECRET
}
