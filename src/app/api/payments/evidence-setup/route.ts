import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'
import { apiError } from '@/lib/errors'
import { cookies } from 'next/headers'

// ----------------------------------------------------------------------------
// Sub-Wave 3a Evidence — Test Setup Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/payments/_evidence-setup?scenario=<name>
//
// Creates a test user + session + order for evidence test scenarios.
// This endpoint is ONLY accessible when:
//   1. NODE_ENV !== 'production'
//   2. EVIDENCE_TEST_MODE === 'true'
//
// Returns: { sessionToken, csrfToken, orderId, menuItemId, restaurantId }
// The evidence script uses these to call POST /api/payments with auth.
//
// Scenarios:
//   - "rollback"     — fresh order for rollback test (CONFIRMED status, no payment)
//   - "replay"       — fresh order for replay test
//   - "conflict"     — fresh order for conflict test (will be captured once first)
//   - "concurrent"   — fresh order for concurrent test
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900001'

export async function GET(req: Request) {
  // Production guard
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403)
  }
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'rollback'
  const amount = url.searchParams.get('amount') // optional override for conflict test

  // Find or create the evidence test user
  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({
      data: {
        phone: EVIDENCE_PHONE,
        name: 'Evidence Test User',
        role: 'CONSUMER',
        spiceTolerance: 3,
        walletBalance: 100000,
      },
    })
  }

  // Find a restaurant + menu item for the order
  const restaurant = await db.restaurant.findFirst({ where: { isActive: true } })
  if (!restaurant) {
    return apiError('INTERNAL_ERROR', 'No active restaurant found for test', 500)
  }
  const menuItem = await db.menuItem.findFirst({ where: { restaurantId: restaurant.id, isAvailable: true } })
  if (!menuItem) {
    return apiError('INTERNAL_ERROR', 'No available menu item found for test', 500)
  }

  // Compute total amount (override if provided for conflict test)
  const totalAmount = amount ? parseInt(amount, 10) : menuItem.price

  // Create a fresh order in CONFIRMED status (not PAID)
  const order = await db.order.create({
    data: {
      userId: user.id,
      restaurantId: restaurant.id,
      status: 'CONFIRMED',
      totalAmount,
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

  // Create a session for the test user
  const sessionToken = await createSession(user.id, 'CONSUMER')
  const csrfToken = await setSessionCookie(sessionToken)

  // The session cookie is set on the response via setSessionCookie (httpOnly).
  // We also need to return it so the evidence script can send it manually
  // (Node.js fetch doesn't automatically use Set-Cookie from the setup response
  // on subsequent requests to a different URL — we need to pass it explicitly).
  const store = await cookies()
  const sessionCookieValue = store.get('snakzap_session')?.value ?? sessionToken

  return NextResponse.json({
    scenario,
    sessionToken: sessionCookieValue,
    csrfToken,
    userId: user.id,
    orderId: order.id,
    orderStatus: order.status,
    orderAmount: order.totalAmount,
    restaurantId: restaurant.id,
    menuItemId: menuItem.id,
    menuItemName: menuItem.name,
    menuItemPrice: menuItem.price,
    evidenceTestMode: true,
  })
}
