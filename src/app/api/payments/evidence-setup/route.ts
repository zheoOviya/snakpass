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
//   - "refund-full"  — fresh order + CAPTURED Payment (Wave-5 5a full-refund test)
//                      Returns paymentId for use by the refund route + publisher.
//   - "refund-partial" — fresh order + CAPTURED Payment (Wave-5 5a partial-refund test)
//                        Returns paymentId for use by the refund route + publisher.
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900001'

export async function GET(req: Request) {
  // Evidence test mode gate — EVIDENCE_TEST_MODE env var must be 'true'.
  // This is set ONLY during evidence test runs via the staging workflow
  // (never in production, never by default). NODE_ENV is intentionally NOT
  // checked because Vercel preview deployments set NODE_ENV=production, which
  // would block evidence tests on the staging deployment. The EVIDENCE_TEST_MODE
  // flag is sufficient — it defaults to undefined/false everywhere.
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

  // Wave-5 Sub-Wave 5a: For refund scenarios, also create a CAPTURED Payment
  // (the refund route requires Payment.status === 'CAPTURED'). We bypass the
  // capture API and write the Payment directly as CAPTURED, simulating the
  // state AFTER the publisher has processed a successful capture. This lets
  // the evidence runner focus on testing the refund flow specifically.
  //
  // We also write the original capture Dr/Cr LedgerEntry pair + AuditLog so the
  // ledger balance is intact when the refund's reversal pair is written.
  // Capture Dr: DEBIT GATEWAY_RECEIVABLE   (we are owed money by gateway)
  // Capture Cr: CREDIT CONSUMER_REVENUE   (we recognized revenue)
  // Refund reversal Dr: DEBIT CONSUMER_REVENUE   (reverse revenue)
  // Refund reversal Cr: CREDIT GATEWAY_RECEIVABLE (reverse receivable)
  // Net: ledger still balances (I-06 invariant preserved).
  let paymentId: string | null = null
  let paymentStatus: string | null = null
  let paymentAmount: number | null = null
  let gatewayPaymentId: string | null = null
  if (scenario === 'refund-full' || scenario === 'refund-partial') {
    const traceId = `evidence-setup-${Date.now()}`
    gatewayPaymentId = `pay_evidence_${scenario}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        userId: user.id,
        gatewayOrderId: `order_evidence_${scenario}_${Date.now()}`,
        gatewayPaymentId,
        gatewaySignature: `sig_evidence_${scenario}`,
        amount: order.totalAmount,
        currency: 'INR',
        status: 'CAPTURED',
        capturedAt: new Date(),
        idempotencyKey: null, // capture-side key, intentionally null for evidence
        version: 1, // bumped once for the capture transition
      },
    })
    paymentId = payment.id
    paymentStatus = payment.status
    paymentAmount = payment.amount

    // Capture Dr/Cr pair (mirrors src/app/api/payments/route.ts:193-216)
    await db.ledgerEntry.create({
      data: {
        paymentId: payment.id,
        entryType: 'DEBIT',
        accountType: 'GATEWAY_RECEIVABLE',
        amount: order.totalAmount,
        traceId,
      },
    })
    await db.ledgerEntry.create({
      data: {
        paymentId: payment.id,
        entryType: 'CREDIT',
        accountType: 'CONSUMER_REVENUE',
        amount: order.totalAmount,
        traceId,
      },
    })

    // AuditLog — PAYMENT_CAPTURED (source: evidence-setup, simulating publisher)
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'PAYMENT_CAPTURED',
        metadata: JSON.stringify({
          paymentId: payment.id,
          orderId: order.id,
          gatewayPaymentId,
          amount: payment.amount,
          source: 'evidence-setup',
          note: `Simulated CAPTURED state for refund-${scenario} evidence`,
          traceId,
        }),
      },
    })
  }

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
    // Wave-5 5a refund scenarios: pre-created CAPTURED Payment
    paymentId,
    paymentStatus,
    paymentAmount,
    gatewayPaymentId,
    evidenceTestMode: true,
  })
}
