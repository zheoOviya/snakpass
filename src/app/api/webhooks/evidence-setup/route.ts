import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'
import { apiError } from '@/lib/errors'
import { cookies } from 'next/headers'

// ----------------------------------------------------------------------------
// Sub-Wave 4a Evidence — Webhook Test Setup Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/webhooks/evidence-setup?scenario=<name>
//
// Creates a test user + session + Payment (in PAYMENT_PENDING status) for
// webhook evidence test scenarios. The webhook handler will update this Payment.
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
//
// Returns: { sessionToken, csrfToken, userId, paymentId, gatewayPaymentId, gatewayOrderId }
//
// Scenarios:
//   - "dedup"          — fresh Payment for dedup test
//   - "signature"      — fresh Payment for signature mismatch test
//   - "out-of-order"   — fresh Payment for out-of-order test
//   - "concurrent"     — fresh Payment for 5-concurrent test
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900003' // different from 3a/3b test users

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'dedup'

  // Find or create the evidence test user
  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({
      data: {
        phone: EVIDENCE_PHONE,
        name: 'Webhook Evidence Test User',
        role: 'CONSUMER',
        spiceTolerance: 3,
        walletBalance: 100000,
      },
    })
  }

  // Find a restaurant + menu item
  const restaurant = await db.restaurant.findFirst({ where: { isActive: true, isSuspended: false } })
  if (!restaurant) {
    return apiError('INTERNAL_ERROR', 'No active restaurant found for test', 500)
  }
  const menuItem = await db.menuItem.findFirst({
    where: { restaurantId: restaurant.id, isAvailable: true },
  })
  if (!menuItem) {
    return apiError('INTERNAL_ERROR', 'No available menu item found for test', 500)
  }

  // Create an Order + Payment (in PAYMENT_PENDING status) for the webhook to update
  const order = await db.order.create({
    data: {
      userId: user.id,
      restaurantId: restaurant.id,
      status: 'CONFIRMED',
      totalAmount: menuItem.price,
      pickupOtp: String(Math.floor(100000 + Math.random() * 900000)),
      isCatering: false,
      itemsCount: 1,
      statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: new Date().toISOString() }]),
      orderItems: {
        create: [{
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          subtotal: menuItem.price,
        }],
      },
    },
  })

  // Create a Payment in PAYMENT_PENDING status (the webhook will update it to CAPTURED)
  const gatewayPaymentId = `pay_evidence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const gatewayOrderId = `order_evidence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      userId: user.id,
      gatewayOrderId,
      gatewayPaymentId,
      amount: menuItem.price,
      currency: 'INR',
      status: 'PAYMENT_PENDING',
    },
  })

  // Create a session
  const sessionToken = await createSession(user.id, 'CONSUMER')
  const csrfToken = await setSessionCookie(sessionToken)

  const store = await cookies()
  const sessionCookieValue = store.get('snakzap_session')?.value ?? sessionToken

  return NextResponse.json({
    scenario,
    sessionToken: sessionCookieValue,
    csrfToken,
    userId: user.id,
    orderId: order.id,
    paymentId: payment.id,
    gatewayPaymentId,
    gatewayOrderId,
    amount: menuItem.price,
    restaurantId: restaurant.id,
    menuItemId: menuItem.id,
    evidenceTestMode: true,
  })
}
