import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// M10 Evidence Setup — creates synthetic M10 conditions.
// Scenarios:
//   "m10-processed-full"   — REFUND_PENDING + old createdAt + outbox FAILED + full refund → gateway returns 'processed'
//   "m10-processed-partial"— REFUND_PENDING + old createdAt + outbox FAILED + partial refund → gateway returns 'processed'
//   "m10-pending"          — same setup → gateway returns 'pending' → escalate
//   "m10-gateway-error"    — same setup → gateway returns 'unknown' → escalate
//   "m10-stale"            — Refund already REFUNDED → re-validation should skip
//   "clean"                — no M10 condition

const EVIDENCE_PHONE = '+919999900006'

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  const traceId = newTraceId()
  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'm10-processed-full'

  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) user = await db.user.create({ data: { phone: EVIDENCE_PHONE, name: '5C M10 Evidence User', role: 'CONSUMER', spiceTolerance: 3, walletBalance: 100000 } })
  const restaurant = await db.restaurant.findFirst({ where: { isActive: true } })
  if (!restaurant) return apiError('INTERNAL_ERROR', 'No active restaurant', 500)
  const menuItem = await db.menuItem.findFirst({ where: { restaurantId: restaurant.id, isAvailable: true } })
  if (!menuItem) return apiError('INTERNAL_ERROR', 'No menu item', 500)

  let scenarioData: Record<string, unknown> = {}

  try {
    if (scenario === 'clean') {
      scenarioData = { note: 'Clean state — no M10 condition.' }
    } else {
      const oldDate = new Date(Date.now() - 45 * 60 * 1000)
      const isFullRefund = scenario === 'm10-processed-full' || scenario === 'm10-pending' || scenario === 'm10-gateway-error' || scenario === 'm10-stale'
      const paymentAmount = 4000
      const refundAmount = isFullRefund ? paymentAmount : 2000 // partial = 2000 (half)
      const refundStatus = scenario === 'm10-stale' ? 'REFUNDED' : 'REFUND_PENDING'
      const gatewayPaymentId = `pay_ev_m10_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      const order = await db.order.create({
        data: {
          userId: user.id, restaurantId: restaurant.id, status: 'PAID', totalAmount: paymentAmount,
          pickupOtp: '000000', isCatering: false, itemsCount: 1,
          statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: oldDate.toISOString() }]),
          createdAt: oldDate,
          orderItems: { create: [{ menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1, subtotal: paymentAmount }] },
        },
      })

      const payment = await db.payment.create({
        data: {
          orderId: order.id, userId: user.id,
          gatewayOrderId: `order_ev_m10_${Date.now()}`,
          gatewayPaymentId, gatewaySignature: `sig_ev_m10`,
          amount: paymentAmount, currency: 'INR', status: 'CAPTURED',
          capturedAt: new Date(), idempotencyKey: null, version: 1, createdAt: oldDate,
        },
      })

      // Capture ledger pair
      await db.ledgerEntry.create({ data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'GATEWAY_RECEIVABLE', amount: paymentAmount, traceId } })
      await db.ledgerEntry.create({ data: { paymentId: payment.id, entryType: 'CREDIT', accountType: 'CONSUMER_REVENUE', amount: paymentAmount, traceId } })

      const refund = await db.refund.create({
        data: {
          paymentId: payment.id, amount: refundAmount, currency: 'INR', status: refundStatus,
          idempotencyKey: `ev-m10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          gatewayRefundId: scenario === 'm10-stale' ? `rpf_demo_${Date.now()}` : null,
          refundedAt: scenario === 'm10-stale' ? new Date() : null,
          createdAt: oldDate, updatedAt: oldDate,
        },
      })

      // Reversal ledger pair (5A Option A — written at REFUND_PENDING time)
      if (refundStatus === 'REFUND_PENDING') {
        await db.ledgerEntry.create({ data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'CONSUMER_REVENUE', amount: refundAmount, traceId } })
        await db.ledgerEntry.create({ data: { paymentId: payment.id, entryType: 'CREDIT', accountType: 'GATEWAY_RECEIVABLE', amount: refundAmount, traceId } })
      }

      // Outbox FAILED
      await db.outbox.create({
        data: {
          eventId: `ev-m10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'PAYMENT_REFUND_REQUESTED', aggregateType: 'Refund', aggregateId: refund.id,
          payload: JSON.stringify({ refundId: refund.id, paymentId: payment.id, amount: refundAmount, fullRefund: isFullRefund }),
          status: 'FAILED', attempts: 5, lastError: 'max retries exhausted', createdAt: oldDate,
        },
      })

      scenarioData = {
        refundId: refund.id, paymentId: payment.id, orderId: order.id,
        gatewayPaymentId, refundAmount, paymentAmount,
        isFullRefund, refundStatus,
        note: scenario === 'm10-stale'
          ? 'Refund already REFUNDED — re-validation should skip'
          : `Refund REFUND_PENDING + outbox FAILED — gateway returns '${url.searchParams.get('gatewayStatus') ?? 'processed'}', fullRefund=${isFullRefund}`,
      }
    }

    const moneyStateSnapshot = {
      paymentCount: await db.payment.count(), refundCount: await db.refund.count(),
      ledgerEntryCount: await db.ledgerEntry.count(), outboxCount: await db.outbox.count(),
      webhookEventCount: await db.webhookEvent.count(), idempotencyKeyCount: await db.idempotencyKey.count(),
      auditLogCount: await db.auditLog.count(),
    }
    logInfo('m10-evidence-setup', { scenario, traceId }, traceId)
    return NextResponse.json({ scenario, traceId, scenarioData, moneyStateSnapshotBefore: moneyStateSnapshot, evidenceTestMode: true })
  } catch (err) {
    return apiError('INTERNAL_ERROR', `Setup failed: ${(err as Error).message}`, 500)
  }
}
