import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — M16 Evidence Setup Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/m16-evidence-setup?scenario=<name>
//
// Creates synthetic outbox state for M16 remediation evidence scenarios.
// EVIDENCE_TEST_MODE must be 'true'. Also requires FEATURE_RECONCILIATION_AUTO_REPAIR=true
// for scenarios that test remediation (E1, E2, E3, E4, E8).
//
// Scenarios:
//   - "lag-exceeded"       — Create an old PENDING outbox event (> 5 min) → M16 finding.
//   - "lag-exceeded-stale" — Create an old PENDING outbox event, then simulate the
//                            publisher catching up (mark it PUBLISHED) before remediation.
//                            Tests SI-1 (re-validation before repair → skip stale finding).
//   - "healthy-outbox"     — Create a recent PENDING outbox event (< 5 min) → NO M16 finding.
//                            Tests E5 (healthy outbox entries are not modified).
//   - "class-e-finding"    — Create a CLASS E finding (M1 ledger imbalance) + verify
//                            remediation does NOT touch it (E6).
//   - "clean"              — Empty outbox → NO M16 finding.
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900003' // distinct from 5a/5b evidence users

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const traceId = newTraceId()
  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'lag-exceeded'

  // Find or create the evidence test user
  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({
      data: { phone: EVIDENCE_PHONE, name: '5C M16 Evidence User', role: 'CONSUMER', spiceTolerance: 3, walletBalance: 100000 },
    })
  }

  const restaurant = await db.restaurant.findFirst({ where: { isActive: true } })
  if (!restaurant) return apiError('INTERNAL_ERROR', 'No active restaurant found', 500)
  const menuItem = await db.menuItem.findFirst({ where: { restaurantId: restaurant.id, isAvailable: true } })
  if (!menuItem) return apiError('INTERNAL_ERROR', 'No available menu item found', 500)

  let scenarioData: Record<string, unknown> = {}

  try {
    if (scenario === 'lag-exceeded') {
      // Create an old PENDING outbox event (> 5 min) → M16 finding will be created.
      const oldDate = new Date(Date.now() - 10 * 60 * 1000) // 10 min ago (> 5 min SLA)
      const outbox = await db.outbox.create({
        data: {
          eventId: `ev-5c-m16-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'ORDER_CREATED',
          aggregateType: 'Order',
          aggregateId: `fake_order_5c_${Date.now()}`,
          payload: JSON.stringify({ orderId: `fake_order_5c_${Date.now()}` }),
          status: 'PENDING',
          createdAt: oldDate,
        },
      })
      scenarioData = { outboxId: outbox.id, eventId: outbox.eventId, ageMs: 10 * 60 * 1000 }
    } else if (scenario === 'lag-exceeded-stale') {
      // Create an old PENDING outbox event, then simulate the publisher catching up
      // (mark it PUBLISHED) before remediation runs. Tests SI-1 (re-validation).
      const oldDate = new Date(Date.now() - 10 * 60 * 1000)
      const outbox = await db.outbox.create({
        data: {
          eventId: `ev-5c-m16-stale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'ORDER_CREATED',
          aggregateType: 'Order',
          aggregateId: `fake_order_5c_stale_${Date.now()}`,
          payload: JSON.stringify({ orderId: `fake_order_5c_stale_${Date.now()}` }),
          status: 'PENDING',
          createdAt: oldDate,
        },
      })
      // Now simulate the publisher catching up — mark it PUBLISHED
      await db.outbox.update({
        where: { id: outbox.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      })
      scenarioData = { outboxId: outbox.id, eventId: outbox.eventId, note: 'Outbox event marked PUBLISHED (simulating publisher catch-up) before remediation runs.' }
    } else if (scenario === 'healthy-outbox') {
      // Create a recent PENDING outbox event (< 5 min) → NO M16 finding.
      const outbox = await db.outbox.create({
        data: {
          eventId: `ev-5c-m16-healthy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'ORDER_CREATED',
          aggregateType: 'Order',
          aggregateId: `fake_order_5c_healthy_${Date.now()}`,
          payload: JSON.stringify({ orderId: `fake_order_5c_healthy_${Date.now()}` }),
          status: 'PENDING',
          createdAt: new Date(), // recent
        },
      })
      scenarioData = { outboxId: outbox.id, eventId: outbox.eventId, note: 'Recent PENDING outbox event (under 5 min SLA) — should NOT trigger M16 finding.' }
    } else if (scenario === 'class-e-finding') {
      // Create a CLASS E finding (M1 ledger imbalance) to verify remediation does NOT touch it (E6).
      const order = await db.order.create({
        data: {
          userId: user.id,
          restaurantId: restaurant.id,
          status: 'PAID',
          totalAmount: 2000,
          pickupOtp: '000000',
          isCatering: false,
          itemsCount: 1,
          statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: new Date().toISOString() }]),
          orderItems: { create: [{ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1, subtotal: 2000 }] },
        },
      })
      const payment = await db.payment.create({
        data: {
          orderId: order.id,
          userId: user.id,
          gatewayOrderId: `order_ev_5c_${Date.now()}`,
          gatewayPaymentId: `pay_ev_5c_${Date.now()}`,
          gatewaySignature: `sig_ev_5c`,
          amount: 2000,
          currency: 'INR',
          status: 'CAPTURED',
          capturedAt: new Date(),
          idempotencyKey: null,
          version: 1,
        },
      })
      // Create an imbalanced ledger: Dr=2000, Cr=0 (missing Cr)
      await db.ledgerEntry.create({
        data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'GATEWAY_RECEIVABLE', amount: 2000, traceId },
      })
      // NO Cr entry — this creates an M1 finding (CLASS E — never repaired)
      scenarioData = { paymentId: payment.id, orderId: order.id, note: 'Imbalanced ledger (Dr=2000, Cr=0) → M1 CLASS E finding. Remediation must NOT touch this.' }
    } else if (scenario === 'clean') {
      // Empty scenario — no outbox events. NO M16 finding.
      scenarioData = { note: 'Clean state — no outbox events.' }
    } else {
      return apiError('VALIDATION_ERROR', `Unknown scenario: ${scenario}`, 400)
    }

    // Money-state snapshot for E7 (remediation disabled when flag OFF) + E4 (no money-state mutation)
    const moneyStateSnapshot = {
      paymentCount: await db.payment.count(),
      refundCount: await db.refund.count(),
      ledgerEntryCount: await db.ledgerEntry.count(),
      outboxCount: await db.outbox.count(),
      webhookEventCount: await db.webhookEvent.count(),
      idempotencyKeyCount: await db.idempotencyKey.count(),
      auditLogCount: await db.auditLog.count(),
    }

    logInfo('m16-evidence-setup', { scenario, traceId }, traceId)

    return NextResponse.json({
      scenario,
      traceId,
      scenarioData,
      moneyStateSnapshotBefore: moneyStateSnapshot,
      evidenceTestMode: true,
    })
  } catch (err) {
    return apiError('INTERNAL_ERROR', `Setup failed: ${(err as Error).message}`, 500)
  }
}
