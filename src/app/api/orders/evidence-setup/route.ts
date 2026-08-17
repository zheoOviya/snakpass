import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'
import { apiError } from '@/lib/errors'
import { cookies } from 'next/headers'

// ----------------------------------------------------------------------------
// Sub-Wave 3b Evidence — Test Setup Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/orders/evidence-setup?scenario=<name>
//
// Creates a test user + session for Order POST evidence test scenarios.
// Unlike the 3a payments evidence-setup (which creates a pre-existing order),
// this endpoint creates ONLY the user + session + provides restaurant/menuItem
// info — the Order POST itself is what the evidence tests exercise.
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
//
// Returns: { sessionToken, csrfToken, userId, restaurantId, menuItemId, menuItemName, menuItemPrice, scenario }
//
// Scenarios:
//   - "replay"       — standard scenario for replay test
//   - "conflict"     — scenario for materially-different-request test
//   - "concurrent"   — scenario for 5-concurrent test
//   - "phantom-block" — scenario for failed-txn + retry test (sets up an
//                       unavailable menu item + a valid alternative)
//   - "rollback"     — scenario for rollback test (uses X-Evidence-Fail-After
//                       header on the POST, not this setup)
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900002' // different from 3a's phone to avoid session conflicts

export async function GET(req: Request) {
  // Evidence test mode gate — EVIDENCE_TEST_MODE env var must be 'true'.
  // See payments/evidence-setup/route.ts for rationale on why NODE_ENV is not checked.
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'replay'

  // Find or create the evidence test user
  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({
      data: {
        phone: EVIDENCE_PHONE,
        name: 'Order Evidence Test User',
        role: 'CONSUMER',
        spiceTolerance: 3,
        walletBalance: 100000,
      },
    })
  }

  // Find a restaurant + menu item for the order
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

  // For the phantom-block scenario, find a SECOND menu item (a valid alternative
  // for the retry-after-failure leg of the test). This is the item the client
  // will use when retrying after the first order failed on an unavailable item.
  let altMenuItem = null
  if (scenario === 'phantom-block') {
    altMenuItem = await db.menuItem.findFirst({
      where: {
        restaurantId: restaurant.id,
        isAvailable: true,
        id: { not: menuItem.id },
      },
    })
    if (!altMenuItem) {
      return apiError('INTERNAL_ERROR', 'No alternative menu item found for phantom-block test', 500)
    }
  }

  // Sub-Wave 3c E3/E4: For null-hash backward-compat tests, create a PRE-EXISTING
  // IdempotencyKey record with requestHash=null (simulating a pre-3c record).
  // The test then sends a request with the SAME key + flag ON, and verifies
  // that the hash check is skipped (backward-compatible behavior).
  let preExistingIdempotencyKey = null
  let preExistingResourceId = null
  let preExistingResponseBody = null
  if (scenario === 'null-hash-backward-compat') {
    // Create a real Order (so the cached response is valid)
    const total = menuItem.price
    const otp = String(Math.floor(100000 + Math.random() * 900000))
    const now = new Date().toISOString()
    const preExistingOrder = await db.order.create({
      data: {
        userId: user.id,
        restaurantId: restaurant.id,
        status: 'CONFIRMED',
        totalAmount: total,
        pickupOtp: otp,
        isCatering: false,
        itemsCount: 1,
        statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: now }]),
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
    preExistingResourceId = preExistingOrder.id

    // Build the cached response body (matching what orders/route.ts would return)
    preExistingResponseBody = JSON.stringify({
      order: {
        id: preExistingOrder.id,
        status: 'CONFIRMED',
        totalAmount: total,
        pickupOtp: otp,
        isCatering: false,
        headcount: null,
        itemsCount: 1,
        note: null,
        createdAt: preExistingOrder.createdAt,
        updatedAt: preExistingOrder.updatedAt,
        statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: now }]),
        restaurant: { id: restaurant.id, name: restaurant.name },
        items: [{
          id: 'pre-existing-item-id',
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          subtotal: menuItem.price,
        }],
      },
    })

    // Create the IdempotencyKey record with requestHash=NULL (simulating pre-3c)
    preExistingIdempotencyKey = `ev-3c-nullhash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.idempotencyKey.create({
      data: {
        key: preExistingIdempotencyKey,
        resourceType: 'Order',
        resourceId: preExistingOrder.id,
        responseStatus: 200,
        responseBody: preExistingResponseBody,
        requestHash: null, // ← KEY: null hash (pre-3c record)
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
  }

  // Create a session for the test user
  const sessionToken = await createSession(user.id, 'CONSUMER')
  const csrfToken = await setSessionCookie(sessionToken)

  const store = await cookies()
  const sessionCookieValue = store.get('snakzap_session')?.value ?? sessionToken

  return NextResponse.json({
    scenario,
    sessionToken: sessionCookieValue,
    csrfToken,
    userId: user.id,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    menuItemId: menuItem.id,
    menuItemName: menuItem.name,
    menuItemPrice: menuItem.price,
    altMenuItemId: altMenuItem?.id ?? null,
    altMenuItemName: altMenuItem?.name ?? null,
    altMenuItemPrice: altMenuItem?.price ?? null,
    // Sub-Wave 3c E3/E4: pre-existing null-hash record info
    preExistingIdempotencyKey,
    preExistingOrderId: preExistingResourceId,
    preExistingResponseBody,
    evidenceTestMode: true,
  })
}
