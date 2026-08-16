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
): Promise<RazorpayOrderResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: return mock order
    return {
      razorpayOrderId: `order_demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
      currency,
    }
  }

  const instance = getRazorpayInstance()!
  const order = await instance.orders.create({
    amount,
    currency,
  })

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
): Promise<RazorpayCaptureResponse> {
  if (!isFeatureEnabled('realPayments')) {
    // Demo mode: simulate successful capture
    return {
      captured: true,
      gatewayPaymentId: razorpayPaymentId,
      signature: `sig_demo_${Date.now()}`,
    }
  }

  const instance = getRazorpayInstance()!
  const capture = await instance.payments.capture(razorpayPaymentId, amount, currency)

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
