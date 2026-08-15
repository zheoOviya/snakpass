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
