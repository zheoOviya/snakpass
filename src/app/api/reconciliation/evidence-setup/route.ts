import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5b Evidence — Setup Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/evidence-setup?scenario=<name>
//
// Creates synthetic anomalies (mismatches) in the database so the
// reconciliation detectors can find them. This endpoint is ONLY accessible
// when EVIDENCE_TEST_MODE === 'true'. It writes synthetic rows to money-state
// tables to create the anomalies — but ONLY for evidence purposes. The
// verify endpoint will confirm that reconciliation itself does NOT mutate
// these rows (E4 safety property).
//
// Scenarios:
//   - "ledger-imbalance"     — Insert a DEBIT without a matching CREDIT
//                              (M1 detector should find it).
//   - "stuck-capture-pending"— Create a Payment CAPTURE_PENDING with old
//                              createdAt + no PENDING outbox (M9 detector).
//   - "stuck-refund-pending" — Create a Refund REFUND_PENDING with old
//                              createdAt + no PENDING outbox (M10 detector).
//   - "orphan-outbox"        — Create an Outbox row with aggregateType=Payment
//                              but a non-existent aggregateId (M12 detector).
//   - "clean"                — Create a healthy Payment + capture ledger pair
//                              + CAPTURED status (should produce NO findings).
//   - "scale"                — Create N healthy payments + M anomalies for
//                              the E6 scale test (query: ?count=1000).
//
// Returns: { scenario, seededAnomalies[], moneyStateSnapshot (for E4 before/after) }
// ----------------------------------------------------------------------------

const EVIDENCE_PHONE = '+919999900002' // distinct from 5a's evidence user

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const traceId = newTraceId()
  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') ?? 'ledger-imbalance'
  const scaleCount = parseInt(url.searchParams.get('count') ?? '100', 10)

  // Find or create the evidence test user
  let user = await db.user.findUnique({ where: { phone: EVIDENCE_PHONE } })
  if (!user) {
    user = await db.user.create({
      data: { phone: EVIDENCE_PHONE, name: '5b Evidence User', role: 'CONSUMER', spiceTolerance: 3, walletBalance: 100000 },
    })
  }

  const restaurant = await db.restaurant.findFirst({ where: { isActive: true } })
  if (!restaurant) return apiError('INTERNAL_ERROR', 'No active restaurant found', 500)
  const menuItem = await db.menuItem.findFirst({ where: { restaurantId: restaurant.id, isAvailable: true } })
  if (!menuItem) return apiError('INTERNAL_ERROR', 'No available menu item found', 500)

  const seededAnomalies: Array<{ class: string; entityId: string; description: string }> = []

  // Helper: create a payment with capture ledger pair + AuditLog
  async function createCapturedPayment(amount: number, status: string = 'CAPTURED', createdAt: Date = new Date()) {
    const order = await db.order.create({
      data: {
        userId: user!.id,
        restaurantId: restaurant!.id,
        status: status === 'CAPTURED' ? 'PAID' : 'CONFIRMED',
        totalAmount: amount,
        pickupOtp: String(Math.floor(100000 + Math.random() * 900000)),
        isCatering: false,
        itemsCount: 1,
        statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: createdAt.toISOString() }]),
        createdAt,
        orderItems: {
          create: [{
            menuItemId: menuItem!.id, name: menuItem!.name, price: menuItem!.price,
            quantity: 1, subtotal: amount,
          }],
        },
      },
    })
    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        userId: user!.id,
        gatewayOrderId: `order_ev_5b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        gatewayPaymentId: `pay_ev_5b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        gatewaySignature: `sig_ev_5b`,
        amount,
        currency: 'INR',
        status,
        capturedAt: status === 'CAPTURED' ? createdAt : null,
        idempotencyKey: null,
        version: 1,
        createdAt,
      },
    })
    // Capture ledger pair
    await db.ledgerEntry.create({
      data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'GATEWAY_RECEIVABLE', amount, traceId },
    })
    await db.ledgerEntry.create({
      data: { paymentId: payment.id, entryType: 'CREDIT', accountType: 'CONSUMER_REVENUE', amount, traceId },
    })
    return { order, payment }
  }

  // Take a money-state snapshot for E4 (before reconciliation)
  async function moneyStateSnapshot() {
    return {
      paymentCount: await db.payment.count(),
      refundCount: await db.refund.count(),
      ledgerEntryCount: await db.ledgerEntry.count(),
      outboxCount: await db.outbox.count(),
      webhookEventCount: await db.webhookEvent.count(),
      idempotencyKeyCount: await db.idempotencyKey.count(),
      auditLogCount: await db.auditLog.count(),
      // Hash of all money-state row ids (for E4 diff detection)
      paymentIds: (await db.payment.findMany({ select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } })),
      refundIds: (await db.refund.findMany({ select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } })),
      ledgerEntryIds: (await db.ledgerEntry.findMany({ select: { id: true, entryType: true, accountType: true, amount: true }, orderBy: { id: 'asc' } })),
    }
  }

  let scenarioData: Record<string, unknown> = {}

  try {
    if (scenario === 'ledger-imbalance') {
      // Create a payment + capture ledger pair, then INSERT an extra DEBIT
      // without a matching CREDIT (M1 detector should find Dr !== Cr).
      const { payment } = await createCapturedPayment(5000)
      await db.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'DEBIT',
          accountType: 'GATEWAY_RECEIVABLE',
          amount: 1500, // extra debit — creates imbalance
          traceId,
        },
      })
      seededAnomalies.push({
        class: 'M1_LEDGER_IMBALANCE',
        entityId: payment.id,
        description: `Payment ${payment.id} has extra DEBIT 1500 (Dr=6500, Cr=5000 — imbalance)`,
      })
      scenarioData = { paymentId: payment.id, expectedDr: 6500, expectedCr: 5000 }
    } else if (scenario === 'stuck-capture-pending') {
      // Create a Payment CAPTURE_PENDING with old createdAt + no PENDING outbox
      const oldDate = new Date(Date.now() - 45 * 60 * 1000) // 45 min ago (> 30 min threshold)
      const { payment } = await createCapturedPayment(3000, 'CAPTURE_PENDING', oldDate)
      // Create the capture ledger pair (so it looks like the capture txn committed)
      // (already done in createCapturedPayment)
      // Create a PUBLISHED outbox (so M9 sees "outbox PUBLISHED but Payment still CAPTURE_PENDING")
      await db.outbox.create({
        data: {
          eventId: `ev-5b-m9-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'PAYMENT_CAPTURE_REQUESTED',
          aggregateType: 'Payment',
          aggregateId: payment.id,
          payload: JSON.stringify({ paymentId: payment.id, amount: 3000 }),
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdAt: oldDate,
        },
      })
      seededAnomalies.push({
        class: 'M9_STUCK_CAPTURE_PENDING',
        entityId: payment.id,
        description: `Payment ${payment.id} CAPTURE_PENDING for 45 min (outbox PUBLISHED — publisher may have failed to capture)`,
      })
      scenarioData = { paymentId: payment.id, ageMs: 45 * 60 * 1000 }
    } else if (scenario === 'stuck-refund-pending') {
      // Create a CAPTURED payment, then a REFUND_PENDING refund with old createdAt
      const { payment } = await createCapturedPayment(4000)
      const oldDate = new Date(Date.now() - 45 * 60 * 1000)
      // Update the refund's createdAt via direct create (can't override default easily, so use $executeRaw)
      const refund = await db.refund.create({
        data: {
          paymentId: payment.id,
          amount: 4000,
          currency: 'INR',
          status: 'REFUND_PENDING',
          idempotencyKey: `ev-5b-m10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: oldDate,
          updatedAt: oldDate,
        },
      })
      // Reversal ledger pair (5A Option A — pending reservation)
      await db.ledgerEntry.create({
        data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'CONSUMER_REVENUE', amount: 4000, traceId },
      })
      await db.ledgerEntry.create({
        data: { paymentId: payment.id, entryType: 'CREDIT', accountType: 'GATEWAY_RECEIVABLE', amount: 4000, traceId },
      })
      seededAnomalies.push({
        class: 'M10_STUCK_REFUND_PENDING',
        entityId: refund.id,
        description: `Refund ${refund.id} REFUND_PENDING for 45 min (publisher may have failed to refund)`,
      })
      scenarioData = { paymentId: payment.id, refundId: refund.id, ageMs: 45 * 60 * 1000 }
    } else if (scenario === 'orphan-outbox') {
      // Create an Outbox row referencing a non-existent Payment
      const fakePaymentId = `fake_payment_5b_${Date.now()}`
      const outbox = await db.outbox.create({
        data: {
          eventId: `ev-5b-m12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: 'PAYMENT_CAPTURE_REQUESTED',
          aggregateType: 'Payment',
          aggregateId: fakePaymentId,
          payload: JSON.stringify({ paymentId: fakePaymentId, amount: 1000 }),
          status: 'PENDING',
        },
      })
      seededAnomalies.push({
        class: 'M12_ORPHAN_OUTBOX_AGGREGATE_MISSING',
        entityId: outbox.id,
        description: `Outbox ${outbox.id} references Payment ${fakePaymentId} which does not exist`,
      })
      scenarioData = { outboxId: outbox.id, fakePaymentId }
    } else if (scenario === 'clean') {
      // Create a healthy Payment + capture ledger pair + CAPTURED status (no anomalies)
      const { payment } = await createCapturedPayment(2000, 'CAPTURED')
      scenarioData = { paymentId: payment.id, expectedFindings: 0 }
    } else if (scenario === 'scale') {
      // Create N healthy payments + a few anomalies for E6
      const count = scaleCount
      const healthyPaymentIds: string[] = []
      let anomalyCount = 0
      for (let i = 0; i < count; i++) {
        const { payment } = await createCapturedPayment(1000 + (i % 10) * 100, 'CAPTURED')
        healthyPaymentIds.push(payment.id)
      }
      // Seed 3 anomalies
      for (let i = 0; i < 3; i++) {
        const { payment } = await createCapturedPayment(5000)
        await db.ledgerEntry.create({
          data: { paymentId: payment.id, entryType: 'DEBIT', accountType: 'GATEWAY_RECEIVABLE', amount: 1500, traceId },
        })
        anomalyCount++
        seededAnomalies.push({
          class: 'M1_LEDGER_IMBALANCE',
          entityId: payment.id,
          description: `Scale anomaly ${i + 1}: Payment ${payment.id} has extra DEBIT 1500`,
        })
      }
      scenarioData = { healthyCount: healthyPaymentIds.length, anomalyCount, totalSeeded: count + 3, healthyPaymentIds }
    } else {
      return apiError('VALIDATION_ERROR', `Unknown scenario: ${scenario}`, 400)
    }

    const snapshot = await moneyStateSnapshot()

    logInfo('reconciliation-evidence-setup', { scenario, seededAnomalies: seededAnomalies.length, traceId }, traceId)

    return NextResponse.json({
      scenario,
      traceId,
      seededAnomalies,
      scenarioData,
      moneyStateSnapshotBefore: snapshot,
      evidenceTestMode: true,
    })
  } catch (err) {
    return apiError('INTERNAL_ERROR', `Setup failed: ${(err as Error).message}`, 500)
  }
}
