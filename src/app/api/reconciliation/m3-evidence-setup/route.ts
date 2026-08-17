import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — M3 Evidence Setup Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/m3-evidence-setup?scenario=<name>
//
// Creates synthetic M3 conditions for evidence scenarios.
// EVIDENCE_TEST_MODE must be 'true'.
//
// Scenarios:
//   - "m3-captured"       — CAPTURE_PENDING Payment + capture ledger pair + old createdAt +
//                            PUBLISHED outbox. Gateway will return 'captured' → repair should flip.
//   - "m3-authorized"     — Same setup, but gateway will return 'authorized' → repair should escalate.
//   - "m3-failed"         — Same setup, but gateway will return 'failed' → repair should escalate.
//   - "m3-gateway-error"  — Same setup, but gateway will throw error → repair should abort.
//   - "m3-stale"          — CAPTURE_PENDING Payment, but status already flipped to CAPTURED
//                            before remediation → re-validation should skip.
//   - "clean"             — No M3 condition → no finding.
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900004'

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const traceId = newTraceId()
  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'm3-captured'
  const gatewayStatus = url.searchParams.get('gatewayStatus') ?? 'captured'

  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({
      data: { phone: EVIDENCE_PHONE, name: '5C M3 Evidence User', role: 'CONSUMER', spiceTolerance: 3, walletBalance: 100000 },
    })
  }

  const restaurant = await db.restaurant.findFirst({ where: { isActive: true } })
  if (!restaurant) return apiError('INTERNAL_ERROR', 'No active restaurant found', 500)
  const menuItem = await db.menuItem.findFirst({ where: { restaurantId: restaurant.id, isAvailable: true } })
  if (!menuItem) return apiError('INTERNAL_ERROR', 'No available menu item found', 500)

  let scenarioData: Record<string, unknown> = {}

  try {
    if (scenario === 'clean') {
      scenarioData = { note: 'Clean state — no M3 condition.' }
    } else {
      // All M3 scenarios create a CAPTURE_PENDING Payment with capture ledger pair + old createdAt + PUBLISHED outbox
      const oldDate = new Date(Date.now() - 45 * 60 * 1000) // 45 min ago (> 30 min threshold)
      const gatewayPaymentId = `pay_ev_m3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      const order = await db.order.create({
        data: {
          userId: user.id,
          restaurantId: restaurant.id,
          status: 'PAID',
          totalAmount: 3000,
          pickupOtp: '000000',
          isCatering: false,
          itemsCount: 1,
          statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: oldDate.toISOString() }]),
          createdAt: oldDate,
          orderItems: { create: [{ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1, subtotal: 3000 }] },
        },
      })

      const paymentStatus = scenario === 'm3-stale' ? 'CAPTURED' : 'CAPTURE_PENDING'
      const payment = await db.payment.create({
        data: {
          orderId: order.id,
          userId: user.id,
          gatewayOrderId: `order_ev_m3_${Date.now()}`,
          gatewayPaymentId,
          gatewaySignature: `sig_ev_m3`,
          amount: 3000,
          currency: 'INR',
          status: paymentStatus,
          capturedAt: scenario === 'm3-stale' ? new Date() : null,
          idempotencyKey: null,
          version: 1,
          createdAt: oldDate,
        },
      })

      // Capture ledger pair (Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE)
      await db.ledgerEntry.create({
        data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'GATEWAY_RECEIVABLE', amount: 3000, traceId },
      })
      await db.ledgerEntry.create({
        data: { paymentId: payment.id, entryType: 'CREDIT', accountType: 'CONSUMER_REVENUE', amount: 3000, traceId },
      })

      // PUBLISHED outbox (simulates publisher processed it but status wasn't flipped)
      await db.outbox.create({
        data: {
          eventId: `ev-m3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'PAYMENT_CAPTURE_REQUESTED',
          aggregateType: 'Payment',
          aggregateId: payment.id,
          payload: JSON.stringify({ paymentId: payment.id, amount: 3000 }),
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdAt: oldDate,
        },
      })

      scenarioData = {
        paymentId: payment.id,
        orderId: order.id,
        gatewayPaymentId,
        gatewayStatus: scenario === 'm3-stale' ? null : gatewayStatus,
        paymentStatus,
        note: scenario === 'm3-stale'
          ? 'Payment already CAPTURED — re-validation should skip remediation'
          : `Payment CAPTURE_PENDING — gateway will return '${gatewayStatus}'`,
      }
    }

    // Money-state snapshot for E4 (no money-state mutation outside the authorized M3 transition)
    const moneyStateSnapshot = {
      paymentCount: await db.payment.count(),
      refundCount: await db.refund.count(),
      ledgerEntryCount: await db.ledgerEntry.count(),
      outboxCount: await db.outbox.count(),
      webhookEventCount: await db.webhookEvent.count(),
      idempotencyKeyCount: await db.idempotencyKey.count(),
      auditLogCount: await db.auditLog.count(),
    }

    logInfo('m3-evidence-setup', { scenario, traceId }, traceId)

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
