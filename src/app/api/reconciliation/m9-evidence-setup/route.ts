import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// M9 Evidence Setup — creates synthetic M9 conditions.
// Scenarios:
//   "m9-captured"     — CAPTURE_PENDING + old createdAt + outbox FAILED → gateway returns 'captured'
//   "m9-authorized"   — same setup → gateway returns 'authorized' → escalate
//   "m9-gateway-error"— same setup → gateway returns 'unknown' → escalate
//   "m9-stale"        — Payment already CAPTURED → re-validation should skip
//   "clean"           — no M9 condition

const EVIDENCE_PHONE = '+919999900005'

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }
  const traceId = newTraceId()
  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'm9-captured'

  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({ data: { phone: EVIDENCE_PHONE, name: '5C M9 Evidence User', role: 'CONSUMER', spiceTolerance: 3, walletBalance: 100000 } })
  }
  const restaurant = await db.restaurant.findFirst({ where: { isActive: true } })
  if (!restaurant) return apiError('INTERNAL_ERROR', 'No active restaurant', 500)
  const menuItem = await db.menuItem.findFirst({ where: { restaurantId: restaurant.id, isAvailable: true } })
  if (!menuItem) return apiError('INTERNAL_ERROR', 'No menu item', 500)

  let scenarioData: Record<string, unknown> = {}

  try {
    if (scenario === 'clean') {
      scenarioData = { note: 'Clean state — no M9 condition.' }
    } else {
      const oldDate = new Date(Date.now() - 45 * 60 * 1000)
      const gatewayPaymentId = `pay_ev_m9_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const outboxStatus = scenario === 'm9-captured' ? 'FAILED' : 'FAILED'

      const order = await db.order.create({
        data: {
          userId: user.id, restaurantId: restaurant.id, status: 'PAID', totalAmount: 3000,
          pickupOtp: '000000', isCatering: false, itemsCount: 1,
          statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: oldDate.toISOString() }]),
          createdAt: oldDate,
          orderItems: { create: [{ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1, subtotal: 3000 }] },
        },
      })

      const paymentStatus = scenario === 'm9-stale' ? 'CAPTURED' : 'CAPTURE_PENDING'
      const payment = await db.payment.create({
        data: {
          orderId: order.id, userId: user.id,
          gatewayOrderId: `order_ev_m9_${Date.now()}`,
          gatewayPaymentId, gatewaySignature: `sig_ev_m9`,
          amount: 3000, currency: 'INR', status: paymentStatus,
          capturedAt: scenario === 'm9-stale' ? new Date() : null,
          idempotencyKey: null, version: 1, createdAt: oldDate,
        },
      })

      // Outbox FAILED (publisher exhausted retries)
      await db.outbox.create({
        data: {
          eventId: `ev-m9-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'PAYMENT_CAPTURE_REQUESTED', aggregateType: 'Payment', aggregateId: payment.id,
          payload: JSON.stringify({ paymentId: payment.id, amount: 3000 }),
          status: outboxStatus, attempts: 5, lastError: 'max retries exhausted',
          createdAt: oldDate,
        },
      })

      scenarioData = {
        paymentId: payment.id, orderId: order.id, gatewayPaymentId,
        paymentStatus, outboxStatus,
        note: scenario === 'm9-stale'
          ? 'Payment already CAPTURED — re-validation should skip'
          : `Payment CAPTURE_PENDING + outbox FAILED — gateway will return '${url.searchParams.get('gatewayStatus') ?? 'captured'}'`,
      }
    }

    const moneyStateSnapshot = {
      paymentCount: await db.payment.count(),
      refundCount: await db.refund.count(),
      ledgerEntryCount: await db.ledgerEntry.count(),
      outboxCount: await db.outbox.count(),
      webhookEventCount: await db.webhookEvent.count(),
      idempotencyKeyCount: await db.idempotencyKey.count(),
      auditLogCount: await db.auditLog.count(),
    }

    logInfo('m9-evidence-setup', { scenario, traceId }, traceId)
    return NextResponse.json({ scenario, traceId, scenarioData, moneyStateSnapshotBefore: moneyStateSnapshot, evidenceTestMode: true })
  } catch (err) {
    return apiError('INTERNAL_ERROR', `Setup failed: ${(err as Error).message}`, 500)
  }
}
