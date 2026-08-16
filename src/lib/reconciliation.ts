import { db, withTransaction } from './db'
import { reportInvariantViolation } from './invariant-checker'
import { isFeatureEnabled } from './deployment'
import { info as logInfo, warn as logWarn, error as logError, newTraceId } from './logger'

// P0-03 Wave-5 Sub-Wave 5b — Reconciliation detection library (READ-ONLY)
//
// Implements the 17 mismatch classes (M1-M17) defined in
// WAVE5_5B_GATE_REVIEW.md §2 D4. Each detector is a pure READ function — it
// performs only SELECT/COUNT/SUM queries against the database. It NEVER writes
// to Payment, Refund, LedgerEntry, Outbox, WebhookEvent, IdempotencyKey, or
// AuditLog.
//
// SAFETY CONTRACT (Orchestrator hard boundary):
//   - Reconciliation NEVER writes to money-state tables.
//   - Reconciliation NEVER makes external Razorpay API calls.
//   - Reconciliation NEVER triggers capture / refund / outbox enqueue.
//   - Reconciliation NEVER performs automatic financial correction.
//   - Its job is: detect → classify → record → report. Repair is a separate
//     authorization boundary (5C or dedicated Orchestrator directive).
//
// The only permitted writes are:
//   - ReconciliationRun (run lifecycle + summary counts)
//   - ReconciliationFinding (mismatch audit trail, idempotent)
//   - ExceptionQueue (via reportInvariantViolation() for CRITICAL/HIGH findings)

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM'

export interface MismatchFinding {
  mismatchClass: string
  severity: Severity
  entityType: 'Payment' | 'Refund' | 'Outbox' | 'WebhookEvent'
  entityId: string
  stateSnapshot: Record<string, unknown>
  description: string
  recommendedRemediation?: string
}

export interface ReconciliationRunResult {
  runId: string
  triggerType: string
  status: 'COMPLETED' | 'FAILED'
  startedAt: Date
  completedAt: Date | null
  paymentsChecked: number
  refundsChecked: number
  outboxChecked: number
  webhooksChecked: number
  findingsCount: number
  mismatchCount: number
  findings: MismatchFinding[]
  lastError?: string
}

// Age thresholds (how old before a pending state is considered "stuck").
// Tunable; conservative defaults chosen so in-flight txns are not flagged.
const STUCK_CAPTURE_PENDING_AGE_MS = 30 * 60 * 1000 // 30 min
const STUCK_REFUND_PENDING_AGE_MS = 30 * 60 * 1000 // 30 min
const UNPROCESSED_WEBHOOK_AGE_MS = 10 * 60 * 1000 // 10 min
const ORPHAN_OUTBOX_AGE_MS = 30 * 60 * 1000 // 30 min

// ----------------------------------------------------------------------------
// Detectors M1-M17
// ----------------------------------------------------------------------------
// Each detector returns an array of MismatchFinding (empty if none found).
// All detectors are READ-ONLY — they use db.$queryRaw or Prisma findMany.
// ----------------------------------------------------------------------------

// M1 — Ledger imbalance (I-06 violation): Dr sum !== Cr sum per payment
async function detectM1LedgerImbalance(): Promise<MismatchFinding[]> {
  // Group LedgerEntry by paymentId, sum DEBIT and CREDIT separately.
  // A balanced ledger has Dr sum === Cr sum per payment (I-06 invariant).
  const rows = await db.$queryRaw<
    Array<{ paymentId: string; dr: bigint; cr: bigint }>
  >`
    SELECT "paymentId",
           COALESCE(SUM(CASE WHEN "entryType" = 'DEBIT'  THEN "amount" ELSE 0 END), 0) AS dr,
           COALESCE(SUM(CASE WHEN "entryType" = 'CREDIT' THEN "amount" ELSE 0 END), 0) AS cr
    FROM "LedgerEntry"
    GROUP BY "paymentId"
    HAVING COALESCE(SUM(CASE WHEN "entryType" = 'DEBIT'  THEN "amount" ELSE 0 END), 0)
        <> COALESCE(SUM(CASE WHEN "entryType" = 'CREDIT' THEN "amount" ELSE 0 END), 0)
  `
  return rows.map((r) => ({
    mismatchClass: 'M1_LEDGER_IMBALANCE',
    severity: 'CRITICAL' as Severity,
    entityType: 'Payment' as const,
    entityId: r.paymentId,
    stateSnapshot: { paymentId: r.paymentId, drSum: Number(r.dr), crSum: Number(r.cr) },
    description: `Ledger imbalance for payment ${r.paymentId}: Dr=${Number(r.dr)} Cr=${Number(r.cr)} (I-06 violation)`,
    recommendedRemediation: 'Manual ledger review — identify the missing/reversed entry. DO NOT auto-repair (separate authorization boundary).',
  }))
}

// M2 — Missing capture ledger pair: Payment.status='CAPTURED' but ledger Dr/Cr pair missing
async function detectM2MissingCaptureLedger(): Promise<MismatchFinding[]> {
  const payments = await db.payment.findMany({
    where: { status: 'CAPTURED' },
    select: { id: true, amount: true, orderId: true },
  })
  if (payments.length === 0) return []
  // Batch-load all ledger entries for all CAPTURED payments in one query
  const paymentIds = payments.map((p) => p.id)
  const allEntries = await db.ledgerEntry.findMany({
    where: { paymentId: { in: paymentIds } },
    select: { paymentId: true, entryType: true, accountType: true },
  })
  // Group by paymentId in memory
  const entriesByPayment = new Map<string, typeof allEntries>()
  for (const e of allEntries) {
    if (!entriesByPayment.has(e.paymentId)) entriesByPayment.set(e.paymentId, [])
    entriesByPayment.get(e.paymentId)!.push(e)
  }
  const findings: MismatchFinding[] = []
  for (const p of payments) {
    const entries = entriesByPayment.get(p.id) ?? []
    const hasDr = entries.some((e) => e.entryType === 'DEBIT' && e.accountType === 'GATEWAY_RECEIVABLE')
    const hasCr = entries.some((e) => e.entryType === 'CREDIT' && e.accountType === 'CONSUMER_REVENUE')
    if (!hasDr || !hasCr) {
      findings.push({
        mismatchClass: 'M2_MISSING_CAPTURE_LEDGER',
        severity: 'CRITICAL',
        entityType: 'Payment',
        entityId: p.id,
        stateSnapshot: { paymentId: p.id, orderId: p.orderId, amount: p.amount, ledgerEntries: entries.length, hasDr, hasCr },
        description: `Payment ${p.id} is CAPTURED but missing capture ledger pair (Dr GATEWAY_RECEIVABLE=${hasDr}, Cr CONSUMER_REVENUE=${hasCr})`,
        recommendedRemediation: 'Manual review — capture txn may have partially committed (should be impossible by atomicity). DO NOT auto-create ledger entries.',
      })
    }
  }
  return findings
}

// M3 — Missing capture status: ledger has capture pair but Payment still CAPTURE_PENDING past publisher retry window
async function detectM3MissingCaptureStatus(): Promise<MismatchFinding[]> {
  const cutoff = new Date(Date.now() - STUCK_CAPTURE_PENDING_AGE_MS)
  const stuckPayments = await db.payment.findMany({
    where: { status: 'CAPTURE_PENDING', createdAt: { lt: cutoff } },
    select: { id: true, amount: true, orderId: true, createdAt: true, gatewayPaymentId: true },
  })
  if (stuckPayments.length === 0) return []
  // Batch-load ledger entries + outbox for all stuck payments
  const paymentIds = stuckPayments.map((p) => p.id)
  const allEntries = await db.ledgerEntry.findMany({
    where: { paymentId: { in: paymentIds } },
    select: { paymentId: true, entryType: true, accountType: true },
  })
  const allOutbox = await db.outbox.findMany({
    where: { aggregateType: 'Payment', aggregateId: { in: paymentIds } },
    select: { aggregateId: true, status: true, id: true },
  })
  const outboxByPayment = new Map(allOutbox.map((o) => [o.aggregateId, o]))
  const findings: MismatchFinding[] = []
  for (const p of stuckPayments) {
    const entries = allEntries.filter((e) => e.paymentId === p.id)
    const hasCapturePair = entries.some((e) => e.entryType === 'DEBIT' && e.accountType === 'GATEWAY_RECEIVABLE')
      && entries.some((e) => e.entryType === 'CREDIT' && e.accountType === 'CONSUMER_REVENUE')
    if (hasCapturePair) {
      const outbox = outboxByPayment.get(p.id)
      findings.push({
        mismatchClass: 'M3_MISSING_CAPTURE_STATUS',
        severity: 'HIGH',
        entityType: 'Payment',
        entityId: p.id,
        stateSnapshot: {
          paymentId: p.id, orderId: p.orderId, status: 'CAPTURE_PENDING', amount: p.amount,
          createdAt: p.createdAt, ageMs: Date.now() - p.createdAt.getTime(),
          gatewayPaymentId: p.gatewayPaymentId, hasCaptureLedger: true,
          pendingOutbox: outbox ? outbox.status : null,
        },
        description: `Payment ${p.id} has capture ledger pair but status is still CAPTURE_PENDING (publisher may have failed to capture at gateway). Age: ${Math.floor((Date.now() - p.createdAt.getTime()) / 1000)}s.`,
        recommendedRemediation: 'Manual gateway check — verify capture status at Razorpay. If captured, the publisher may need a retry or manual Payment.status update (separate authorization).',
      })
    }
  }
  return findings
}

// M4 — Duplicate capture ledger pair: more than one Dr GATEWAY_RECEIVABLE per payment
async function detectM4DuplicateCaptureLedger(): Promise<MismatchFinding[]> {
  const rows = await db.$queryRaw<Array<{ paymentId: string; cnt: bigint }>>`
    SELECT "paymentId", COUNT(*) AS cnt
    FROM "LedgerEntry"
    WHERE "entryType" = 'DEBIT' AND "accountType" = 'GATEWAY_RECEIVABLE'
    GROUP BY "paymentId"
    HAVING COUNT(*) > 1
  `
  return rows.map((r) => ({
    mismatchClass: 'M4_DUPLICATE_CAPTURE_LEDGER',
    severity: 'CRITICAL',
    entityType: 'Payment',
    entityId: r.paymentId,
    stateSnapshot: { paymentId: r.paymentId, duplicateDrCount: Number(r.cnt) },
    description: `Payment ${r.paymentId} has ${Number(r.cnt)} DEBIT GATEWAY_RECEIVABLE entries (should be exactly 1 — I-04 violation)`,
    recommendedRemediation: 'Manual review — duplicate capture ledger indicates a retry-invariant violation. DO NOT auto-reverse (separate authorization).',
  }))
}

// M5 — Duplicate Refund per payment+idempotencyKey (schema-enforced, but check anyway)
async function detectM5DuplicateRefundPerKey(): Promise<MismatchFinding[]> {
  const rows = await db.$queryRaw<Array<{ paymentId: string; idempotencyKey: string; cnt: bigint }>>`
    SELECT "paymentId", "idempotencyKey", COUNT(*) AS cnt
    FROM "Refund"
    WHERE "idempotencyKey" IS NOT NULL
    GROUP BY "paymentId", "idempotencyKey"
    HAVING COUNT(*) > 1
  `
  return rows.map((r) => ({
    mismatchClass: 'M5_DUPLICATE_REFUND_PER_KEY',
    severity: 'CRITICAL',
    entityType: 'Refund',
    entityId: r.idempotencyKey,
    stateSnapshot: { paymentId: r.paymentId, idempotencyKey: r.idempotencyKey, duplicateCount: Number(r.cnt) },
    description: `Payment ${r.paymentId} has ${Number(r.cnt)} Refunds with the same idempotencyKey ${r.idempotencyKey} (I-04 violation — unique constraint should prevent this)`,
    recommendedRemediation: 'Manual review — unique constraint on Refund.idempotencyKey should prevent this. Indicates schema drift or manual DB edit.',
  }))
}

// M6 — Refund total exceeds payment amount (I-03 violation)
async function detectM6RefundExceedsPayment(): Promise<MismatchFinding[]> {
  const rows = await db.$queryRaw<
    Array<{ paymentId: string; paymentAmount: bigint; refundTotal: bigint }>
  >`
    SELECT p."id" AS "paymentId", p."amount" AS "paymentAmount",
           COALESCE(SUM(r."amount"), 0) AS "refundTotal"
    FROM "Payment" p
    LEFT JOIN "Refund" r ON r."paymentId" = p."id" AND r."status" IN ('REFUND_PENDING', 'REFUNDED')
    GROUP BY p."id", p."amount"
    HAVING COALESCE(SUM(r."amount"), 0) > p."amount"
  `
  return rows.map((r) => ({
    mismatchClass: 'M6_REFUND_EXCEEDS_PAYMENT',
    severity: 'HIGH',
    entityType: 'Payment',
    entityId: r.paymentId,
    stateSnapshot: { paymentId: r.paymentId, paymentAmount: Number(r.paymentAmount), refundTotal: Number(r.refundTotal) },
    description: `Payment ${r.paymentId} amount=${Number(r.paymentAmount)} but refunds sum to ${Number(r.refundTotal)} (I-03 violation — refund-total exceeds payment)`,
    recommendedRemediation: 'Manual review — refund-route validation should prevent this. May indicate a race or validation gap.',
  }))
}

// M7 — Refund marked REFUNDED but no matching reversal ledger pair
async function detectM7RefundWithoutReversal(): Promise<MismatchFinding[]> {
  const refunds = await db.refund.findMany({
    where: { status: 'REFUNDED' },
    select: { id: true, paymentId: true, amount: true },
  })
  if (refunds.length === 0) return []
  // Batch-load all ledger entries for the payments that have REFUNDED refunds
  const paymentIds = [...new Set(refunds.map((r) => r.paymentId))]
  const allEntries = await db.ledgerEntry.findMany({
    where: { paymentId: { in: paymentIds } },
    select: { paymentId: true, entryType: true, accountType: true, amount: true },
  })
  const entriesByPayment = new Map<string, typeof allEntries>()
  for (const e of allEntries) {
    if (!entriesByPayment.has(e.paymentId)) entriesByPayment.set(e.paymentId, [])
    entriesByPayment.get(e.paymentId)!.push(e)
  }
  const findings: MismatchFinding[] = []
  for (const ref of refunds) {
    const entries = entriesByPayment.get(ref.paymentId) ?? []
    const hasReversalDr = entries.some((e) => e.entryType === 'DEBIT' && e.accountType === 'CONSUMER_REVENUE' && e.amount === ref.amount)
    const hasReversalCr = entries.some((e) => e.entryType === 'CREDIT' && e.accountType === 'GATEWAY_RECEIVABLE' && e.amount === ref.amount)
    if (!hasReversalDr || !hasReversalCr) {
      findings.push({
        mismatchClass: 'M7_REFUND_WITHOUT_REVERSAL_LEDGER',
        severity: 'HIGH',
        entityType: 'Refund',
        entityId: ref.id,
        stateSnapshot: { refundId: ref.id, paymentId: ref.paymentId, amount: ref.amount, hasReversalDr, hasReversalCr },
        description: `Refund ${ref.id} (REFUNDED, amount=${ref.amount}) has no matching reversal ledger pair (Dr CONSUMER_REVENUE=${hasReversalDr}, Cr GATEWAY_RECEIVABLE=${hasReversalCr})`,
        recommendedRemediation: 'Manual review — refund txn should have written reversal entries atomically. Indicates corruption (should be impossible by atomicity).',
      })
    }
  }
  return findings
}

// M8 — Reversal ledger pair without matching Refund row
async function detectM8ReversalWithoutRefund(): Promise<MismatchFinding[]> {
  // Find payments that have a Dr CONSUMER_REVENUE entry (reversal marker) but no Refund row
  const rows = await db.$queryRaw<Array<{ paymentId: string; reversalDrCount: bigint }>>`
    SELECT le."paymentId", COUNT(*) AS "reversalDrCount"
    FROM "LedgerEntry" le
    LEFT JOIN "Refund" r ON r."paymentId" = le."paymentId"
    WHERE le."entryType" = 'DEBIT' AND le."accountType" = 'CONSUMER_REVENUE'
      AND r."id" IS NULL
    GROUP BY le."paymentId"
  `
  return rows.map((r) => ({
    mismatchClass: 'M8_REVERSAL_WITHOUT_REFUND',
    severity: 'HIGH',
    entityType: 'Payment',
    entityId: r.paymentId,
    stateSnapshot: { paymentId: r.paymentId, reversalDrCount: Number(r.reversalDrCount) },
    description: `Payment ${r.paymentId} has ${Number(r.reversalDrCount)} reversal DEBIT CONSUMER_REVENUE entries but no Refund row (orphan reversal)`,
    recommendedRemediation: 'Manual review — reversal entries without a Refund indicate corruption (should be impossible by atomicity).',
  }))
}

// M9 — Stuck CAPTURE_PENDING (publisher lag): CAPTURE_PENDING older than threshold with no PENDING/CLAIMED outbox
async function detectM9StuckCapturePending(): Promise<MismatchFinding[]> {
  const cutoff = new Date(Date.now() - STUCK_CAPTURE_PENDING_AGE_MS)
  const stuckPayments = await db.payment.findMany({
    where: { status: 'CAPTURE_PENDING', createdAt: { lt: cutoff } },
    select: { id: true, amount: true, orderId: true, createdAt: true, gatewayPaymentId: true },
  })
  if (stuckPayments.length === 0) return []
  // Batch-load outbox entries for all stuck payments
  const paymentIds = stuckPayments.map((p) => p.id)
  const allOutbox = await db.outbox.findMany({
    where: { aggregateType: 'Payment', aggregateId: { in: paymentIds } },
    select: { aggregateId: true, status: true, id: true, eventId: true, eventType: true },
  })
  const outboxByPayment = new Map(allOutbox.map((o) => [o.aggregateId, o]))
  const findings: MismatchFinding[] = []
  for (const p of stuckPayments) {
    const outbox = outboxByPayment.get(p.id)
    // Only flag if there is NO PENDING/CLAIMED outbox event (meaning publisher
    // exhausted retries or the event is FAILED). If outbox is still PENDING,
    // that's M11's concern (orphan outbox), not M9.
    const outboxStuck = outbox === undefined || outbox.status === 'FAILED' || outbox.status === 'PUBLISHED'
    if (outboxStuck) {
      findings.push({
        mismatchClass: 'M9_STUCK_CAPTURE_PENDING',
        severity: 'HIGH',
        entityType: 'Payment',
        entityId: p.id,
        stateSnapshot: {
          paymentId: p.id, orderId: p.orderId, status: 'CAPTURE_PENDING', amount: p.amount,
          createdAt: p.createdAt, ageMs: Date.now() - p.createdAt.getTime(),
          gatewayPaymentId: p.gatewayPaymentId, outboxStatus: outbox?.status ?? 'MISSING',
        },
        description: `Payment ${p.id} stuck in CAPTURE_PENDING for ${Math.floor((Date.now() - p.createdAt.getTime()) / 1000)}s (outbox status: ${outbox?.status ?? 'MISSING'})`,
        recommendedRemediation: 'Manual gateway check — verify capture status at Razorpay. If captured, update Payment.status manually (separate authorization).',
      })
    }
  }
  return findings
}

// M10 — Stuck REFUND_PENDING (publisher lag): REFUND_PENDING older than threshold
async function detectM10StuckRefundPending(): Promise<MismatchFinding[]> {
  const cutoff = new Date(Date.now() - STUCK_REFUND_PENDING_AGE_MS)
  const stuckRefunds = await db.refund.findMany({
    where: { status: 'REFUND_PENDING', createdAt: { lt: cutoff } },
    select: { id: true, paymentId: true, amount: true, createdAt: true },
  })
  if (stuckRefunds.length === 0) return []
  // Batch-load outbox entries for all stuck refunds
  const refundIds = stuckRefunds.map((r) => r.id)
  const allOutbox = await db.outbox.findMany({
    where: { aggregateType: 'Refund', aggregateId: { in: refundIds } },
    select: { aggregateId: true, status: true, id: true, eventId: true, eventType: true },
  })
  const outboxByRefund = new Map(allOutbox.map((o) => [o.aggregateId, o]))
  const findings: MismatchFinding[] = []
  for (const ref of stuckRefunds) {
    const outbox = outboxByRefund.get(ref.id)
    const outboxStuck = outbox === undefined || outbox.status === 'FAILED' || outbox.status === 'PUBLISHED'
    if (outboxStuck) {
      findings.push({
        mismatchClass: 'M10_STUCK_REFUND_PENDING',
        severity: 'HIGH',
        entityType: 'Refund',
        entityId: ref.id,
        stateSnapshot: {
          refundId: ref.id, paymentId: ref.paymentId, amount: ref.amount,
          createdAt: ref.createdAt, ageMs: Date.now() - ref.createdAt.getTime(),
          outboxStatus: outbox?.status ?? 'MISSING',
        },
        description: `Refund ${ref.id} stuck in REFUND_PENDING for ${Math.floor((Date.now() - ref.createdAt.getTime()) / 1000)}s (outbox status: ${outbox?.status ?? 'MISSING'})`,
        recommendedRemediation: 'Manual gateway check — verify refund status at Razorpay. If refunded, update Refund.status manually (separate authorization). Note: the 5A Option A pending ledger reservation persists until resolved.',
      })
    }
  }
  return findings
}

// M11 — Orphan outbox (PENDING/CLAIMED past TTL or FAILED)
async function detectM11OrphanOutbox(): Promise<MismatchFinding[]> {
  const cutoff = new Date(Date.now() - ORPHAN_OUTBOX_AGE_MS)
  const orphanOutbox = await db.outbox.findMany({
    where: {
      OR: [
        { status: 'PENDING', createdAt: { lt: cutoff } },
        { status: 'CLAIMED', createdAt: { lt: cutoff } },
        { status: 'FAILED' },
      ],
    },
    select: { id: true, eventId: true, eventType: true, aggregateType: true, aggregateId: true, status: true, createdAt: true, attempts: true },
  })
  return orphanOutbox.map((o) => ({
    mismatchClass: 'M11_ORPHAN_OUTBOX',
    severity: 'HIGH',
    entityType: 'Outbox' as const,
    entityId: o.id,
    stateSnapshot: {
      outboxId: o.id, eventId: o.eventId, eventType: o.eventType,
      aggregateType: o.aggregateType, aggregateId: o.aggregateId,
      status: o.status, createdAt: o.createdAt, attempts: o.attempts,
      ageMs: Date.now() - o.createdAt.getTime(),
    },
    description: `Outbox event ${o.eventId} (type=${o.eventType}, status=${o.status}) is orphaned — age ${Math.floor((Date.now() - o.createdAt.getTime()) / 1000)}s, attempts=${o.attempts}`,
    recommendedRemediation: 'Manual review — publisher may have crashed or exhausted retries. Check publisher logs. DO NOT auto-republish (separate authorization).',
  }))
}

// M12 — Orphan outbox (aggregate missing): Outbox references a Payment/Refund that doesn't exist
async function detectM12OrphanOutboxAggregateMissing(): Promise<MismatchFinding[]> {
  const outboxRows = await db.outbox.findMany({
    where: { aggregateType: { in: ['Payment', 'Refund'] } },
    select: { id: true, eventId: true, aggregateType: true, aggregateId: true, status: true },
  })
  if (outboxRows.length === 0) return []
  // Batch-load all referenced payments + refunds
  const paymentIds = outboxRows.filter((o) => o.aggregateType === 'Payment').map((o) => o.aggregateId)
  const refundIds = outboxRows.filter((o) => o.aggregateType === 'Refund').map((o) => o.aggregateId)
  const [existingPayments, existingRefunds] = await Promise.all([
    paymentIds.length > 0 ? db.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true } }) : [],
    refundIds.length > 0 ? db.refund.findMany({ where: { id: { in: refundIds } }, select: { id: true } }) : [],
  ])
  const existingPaymentIds = new Set(existingPayments.map((p) => p.id))
  const existingRefundIds = new Set(existingRefunds.map((r) => r.id))
  const findings: MismatchFinding[] = []
  for (const o of outboxRows) {
    let exists = false
    if (o.aggregateType === 'Payment') exists = existingPaymentIds.has(o.aggregateId)
    else if (o.aggregateType === 'Refund') exists = existingRefundIds.has(o.aggregateId)
    if (!exists) {
      findings.push({
        mismatchClass: 'M12_ORPHAN_OUTBOX_AGGREGATE_MISSING',
        severity: 'CRITICAL',
        entityType: 'Outbox',
        entityId: o.id,
        stateSnapshot: { outboxId: o.id, eventId: o.eventId, aggregateType: o.aggregateType, aggregateId: o.aggregateId, status: o.status },
        description: `Outbox event ${o.eventId} references ${o.aggregateType} ${o.aggregateId} which does not exist (impossible by atomicity — indicates manual DB delete)`,
        recommendedRemediation: 'Manual review — outbox + business row commit in same txn. Missing aggregate indicates manual DB edit.',
      })
    }
  }
  return findings
}

// M13 — Unprocessed WebhookEvent past threshold
async function detectM13UnprocessedWebhook(): Promise<MismatchFinding[]> {
  const cutoff = new Date(Date.now() - UNPROCESSED_WEBHOOK_AGE_MS)
  const unprocessed = await db.webhookEvent.findMany({
    where: { verified: true, processed: false, receivedAt: { lt: cutoff } },
    select: { id: true, eventId: true, eventType: true, receivedAt: true },
  })
  return unprocessed.map((w) => ({
    mismatchClass: 'M13_UNPROCESSED_WEBHOOK',
    severity: 'MEDIUM',
    entityType: 'WebhookEvent' as const,
    entityId: w.id,
    stateSnapshot: { webhookEventId: w.id, eventId: w.eventId, eventType: w.eventType, receivedAt: w.receivedAt, ageMs: Date.now() - w.receivedAt.getTime() },
    description: `WebhookEvent ${w.eventId} (type=${w.eventType}) verified but unprocessed for ${Math.floor((Date.now() - w.receivedAt.getTime()) / 1000)}s`,
    recommendedRemediation: 'Manual review — webhook handler may have crashed mid-processing. Re-process manually (separate authorization).',
  }))
}

// M14 — WebhookEvent references missing Payment
async function detectM14WebhookMissingPayment(): Promise<MismatchFinding[]> {
  const webhooks = await db.webhookEvent.findMany({
    where: { paymentId: { not: null } },
    select: { id: true, eventId: true, eventType: true, paymentId: true },
  })
  if (webhooks.length === 0) return []
  // Batch-load all referenced payments
  const paymentIds = [...new Set(webhooks.map((w) => w.paymentId!).filter(Boolean))]
  if (paymentIds.length === 0) return []
  const existingPayments = await db.payment.findMany({
    where: { id: { in: paymentIds } },
    select: { id: true },
  })
  const existingIds = new Set(existingPayments.map((p) => p.id))
  const findings: MismatchFinding[] = []
  for (const w of webhooks) {
    if (!w.paymentId) continue
    if (!existingIds.has(w.paymentId)) {
      findings.push({
        mismatchClass: 'M14_WEBHOOK_MISSING_PAYMENT',
        severity: 'MEDIUM',
        entityType: 'WebhookEvent',
        entityId: w.id,
        stateSnapshot: { webhookEventId: w.id, eventId: w.eventId, eventType: w.eventType, paymentId: w.paymentId },
        description: `WebhookEvent ${w.eventId} references Payment ${w.paymentId} which does not exist`,
        recommendedRemediation: 'Manual review — webhook for a payment we do not have (race or stale webhook).',
      })
    }
  }
  return findings
}

// M15 — Payment status vs ledger state consistency: REFUNDED but refunds don't sum to amount
async function detectM15StatusLedgerInconsistency(): Promise<MismatchFinding[]> {
  const refundedPayments = await db.payment.findMany({
    where: { status: 'REFUNDED' },
    select: { id: true, amount: true, orderId: true },
  })
  const findings: MismatchFinding[] = []
  for (const p of refundedPayments) {
    const refundSum = await db.refund.aggregate({
      where: { paymentId: p.id, status: 'REFUNDED' },
      _sum: { amount: true },
    })
    const totalRefunded = refundSum._sum.amount ?? 0
    if (totalRefunded !== p.amount) {
      findings.push({
        mismatchClass: 'M15_STATUS_LEDGER_INCONSISTENCY',
        severity: 'HIGH',
        entityType: 'Payment',
        entityId: p.id,
        stateSnapshot: { paymentId: p.id, orderId: p.orderId, paymentStatus: 'REFUNDED', paymentAmount: p.amount, refundedTotal: totalRefunded },
        description: `Payment ${p.id} is REFUNDED but refunds sum to ${totalRefunded} (expected ${p.amount} for full refund)`,
        recommendedRemediation: 'Manual review — partial-refund + full-refund-status mismatch. May indicate a refund-route validation gap.',
      })
    }
  }
  return findings
}

// M16 — Outbox lag exceeding SLA
async function detectM16OutboxLag(): Promise<MismatchFinding[]> {
  const oldestPending = await db.outbox.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, eventId: true, eventType: true, createdAt: true },
  })
  if (!oldestPending) return []
  const ageMs = Date.now() - oldestPending.createdAt.getTime()
  const lagThresholdMs = 5 * 60 * 1000 // 5 min SLA
  if (ageMs <= lagThresholdMs) return []
  return [{
    mismatchClass: 'M16_OUTBOX_LAG_EXCEEDED',
    severity: 'MEDIUM',
    entityType: 'Outbox',
    entityId: oldestPending.id,
    stateSnapshot: { outboxId: oldestPending.id, eventId: oldestPending.eventId, eventType: oldestPending.eventType, createdAt: oldestPending.createdAt, ageMs },
    description: `Outbox lag ${Math.floor(ageMs / 1000)}s exceeds SLA (5 min) — oldest PENDING event: ${oldestPending.eventId}`,
    recommendedRemediation: 'Operational — publisher may be stalled or crashed. Check publisher health. (Not a money-state violation.)',
  }]
}

// M17 — AuditLog hash-chain break (P0-22 concern; reconciliation surfaces it)
async function detectM17AuditChainBreak(): Promise<MismatchFinding[]> {
  const { createHash } = await import('crypto')
  const entries = await db.auditLog.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, actorId: true, actorRole: true, action: true, metadata: true, createdAt: true, prevHash: true, hash: true },
  })
  const findings: MismatchFinding[] = []
  let prevHash = 'GENESIS'
  for (const entry of entries) {
    const data = `${entry.prevHash}|${entry.id}|${entry.actorId ?? 'null'}|${entry.actorRole}|${entry.action}|${entry.metadata}|${entry.createdAt.toISOString()}`
    const recomputedHash = createHash('sha256').update(data).digest('hex')
    if (entry.prevHash !== prevHash || entry.hash !== recomputedHash) {
      findings.push({
        mismatchClass: 'M17_AUDIT_CHAIN_BREAK',
        severity: 'MEDIUM',
        entityType: 'WebhookEvent', // closest fit — AuditLog has no direct entityType in our enum; use a neutral one
        entityId: entry.id,
        stateSnapshot: { auditLogId: entry.id, storedPrevHash: entry.prevHash, expectedPrevHash: prevHash, storedHash: entry.hash, recomputedHash },
        description: `AuditLog entry ${entry.id} hash-chain break (prevHash mismatch or hash recomputation failure)`,
        recommendedRemediation: 'Manual review — audit log tamper-evidence check failed. May indicate manual DB edit or storage corruption. (P0-22 concern — true WORM needs production storage.)',
      })
    }
    prevHash = entry.hash
  }
  return findings
}

// ----------------------------------------------------------------------------
// Detector registry
// ----------------------------------------------------------------------------

interface Detector {
  class: string
  fn: () => Promise<MismatchFinding[]>
}

const DETECTORS: Detector[] = [
  { class: 'M1_LEDGER_IMBALANCE', fn: detectM1LedgerImbalance },
  { class: 'M2_MISSING_CAPTURE_LEDGER', fn: detectM2MissingCaptureLedger },
  { class: 'M3_MISSING_CAPTURE_STATUS', fn: detectM3MissingCaptureStatus },
  { class: 'M4_DUPLICATE_CAPTURE_LEDGER', fn: detectM4DuplicateCaptureLedger },
  { class: 'M5_DUPLICATE_REFUND_PER_KEY', fn: detectM5DuplicateRefundPerKey },
  { class: 'M6_REFUND_EXCEEDS_PAYMENT', fn: detectM6RefundExceedsPayment },
  { class: 'M7_REFUND_WITHOUT_REVERSAL_LEDGER', fn: detectM7RefundWithoutReversal },
  { class: 'M8_REVERSAL_WITHOUT_REFUND', fn: detectM8ReversalWithoutRefund },
  { class: 'M9_STUCK_CAPTURE_PENDING', fn: detectM9StuckCapturePending },
  { class: 'M10_STUCK_REFUND_PENDING', fn: detectM10StuckRefundPending },
  { class: 'M11_ORPHAN_OUTBOX', fn: detectM11OrphanOutbox },
  { class: 'M12_ORPHAN_OUTBOX_AGGREGATE_MISSING', fn: detectM12OrphanOutboxAggregateMissing },
  { class: 'M13_UNPROCESSED_WEBHOOK', fn: detectM13UnprocessedWebhook },
  { class: 'M14_WEBHOOK_MISSING_PAYMENT', fn: detectM14WebhookMissingPayment },
  { class: 'M15_STATUS_LEDGER_INCONSISTENCY', fn: detectM15StatusLedgerInconsistency },
  { class: 'M16_OUTBOX_LAG_EXCEEDED', fn: detectM16OutboxLag },
  { class: 'M17_AUDIT_CHAIN_BREAK', fn: detectM17AuditChainBreak },
]

// ----------------------------------------------------------------------------
// Run reconciliation
// ----------------------------------------------------------------------------

/**
 * Run a full reconciliation cycle.
 *
 * This is the main entry point for P0-03. It:
 *   1. Creates a ReconciliationRun row (status=RUNNING).
 *   2. Runs all 17 detectors (M1-M17) — READ-ONLY.
 *   3. For each finding: dedupes via (mismatchClass, entityId) — if an
 *      unresolved finding exists, updates lastSeenAt; else inserts a new row.
 *   4. For CRITICAL/HIGH findings: routes through reportInvariantViolation()
 *      (P0-28 path) → ExceptionQueue entry + freeze.
 *   5. Emits the reconciliation_mismatch_count metric (via fireAlert path).
 *   6. Updates the ReconciliationRun row (status=COMPLETED, counts).
 *
 * SAFETY: This function NEVER writes to Payment, Refund, LedgerEntry, Outbox,
 * WebhookEvent, IdempotencyKey, or AuditLog. Its only writes are to
 * ReconciliationRun, ReconciliationFinding, and ExceptionQueue (via
 * reportInvariantViolation).
 *
 * @param triggerType - What triggered this run: 'cron' | 'manual' | 'evidence'
 * @returns The ReconciliationRunResult (summary + findings list)
 */
export async function runReconciliation(
  triggerType: 'cron' | 'manual' | 'evidence' = 'cron',
): Promise<ReconciliationRunResult> {
  const traceId = newTraceId()
  logInfo('reconciliation-run-start', { triggerType, traceId }, traceId)

  // 1. Create the ReconciliationRun row
  const run = await db.reconciliationRun.create({
    data: { triggerType, status: 'RUNNING' },
  })

  const findings: MismatchFinding[] = []
  let lastError: string | undefined

  try {
    // 2. Run all detectors (READ-ONLY — no writes to money-state tables)
    for (const detector of DETECTORS) {
      try {
        const detectorFindings = await detector.fn()
        findings.push(...detectorFindings)
      } catch (err) {
        // A single detector failure should NOT abort the whole run.
        logError('reconciliation-detector-error', { detectorClass: detector.class, error: (err as Error).message, traceId }, traceId)
      }
    }

    // 3. Compute summary counts
    const paymentsChecked = await db.payment.count()
    const refundsChecked = await db.refund.count()
    const outboxChecked = await db.outbox.count()
    const webhooksChecked = await db.webhookEvent.count()

    // 4. Persist findings (idempotent dedup via (mismatchClass, entityId, resolvedAt))
    //    + route CRITICAL/HIGH findings through reportInvariantViolation().
    for (const finding of findings) {
      try {
        await persistFinding(finding, run.id, traceId)
      } catch (err) {
        logError('reconciliation-finding-persist-error', { mismatchClass: finding.mismatchClass, entityId: finding.entityId, error: (err as Error).message, traceId }, traceId)
      }
    }

    // 5. Update the run row (status=COMPLETED + counts)
    const mismatchCount = findings.length
    await db.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        paymentsChecked,
        refundsChecked,
        outboxChecked,
        webhooksChecked,
        findingsCount: findings.length,
        mismatchCount,
      },
    })

    // 6. Emit the mismatch_count metric via the alert system.
    //    The alert-evaluator mini-service will read the actual count from
    //    ReconciliationFinding on its next cycle. We also fire the alert
    //    directly here for immediate visibility.
    if (mismatchCount > 0) {
      const { fireAlert } = await import('./alerting')
      fireAlert('reconciliation-mismatch', {
        runId: run.id,
        mismatchCount,
        findings: findings.map((f) => ({ class: f.mismatchClass, severity: f.severity, entityId: f.entityId })),
        traceId,
      })
    }

    logInfo('reconciliation-run-complete', {
      runId: run.id, triggerType, findingsCount: findings.length, mismatchCount,
      paymentsChecked, refundsChecked, outboxChecked, webhooksChecked, traceId,
    }, traceId)

    return {
      runId: run.id,
      triggerType,
      status: 'COMPLETED',
      startedAt: run.startedAt,
      completedAt: new Date(),
      paymentsChecked,
      refundsChecked,
      outboxChecked,
      webhooksChecked,
      findingsCount: findings.length,
      mismatchCount,
      findings,
    }
  } catch (err) {
    lastError = (err as Error).message
    logError('reconciliation-run-failed', { runId: run.id, error: lastError, traceId }, traceId)
    await db.reconciliationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', completedAt: new Date(), lastError },
    }).catch(() => {})
    return {
      runId: run.id,
      triggerType,
      status: 'FAILED',
      startedAt: run.startedAt,
      completedAt: new Date(),
      paymentsChecked: 0,
      refundsChecked: 0,
      outboxChecked: 0,
      webhooksChecked: 0,
      findingsCount: findings.length,
      mismatchCount: findings.length,
      findings,
      lastError,
    }
  }
}

/**
 * Persist a single finding with idempotent dedup.
 *
 * If an unresolved finding exists for (mismatchClass, entityId), update its
 * lastSeenAt + stateSnapshot. Otherwise insert a new row.
 *
 * For CRITICAL/HIGH findings, route through reportInvariantViolation() (P0-28)
 * to create an ExceptionQueue entry + apply a freeze. Store the exceptionId
 * on the finding row for correlation.
 *
 * This function uses withTransaction() for the dedup check + insert/update so
 * that concurrent reconciliation runs cannot create duplicate findings.
 */
async function persistFinding(
  finding: MismatchFinding,
  runId: string,
  traceId: string,
): Promise<void> {
  // Step 1: Dedup check + insert/update the finding INSIDE a transaction.
  // This is the idempotency-protected write. reportInvariantViolation() is
  // called OUTSIDE this transaction (Step 2) because it does its own DB
  // writes (ExceptionQueue.create + freeze) which would deadlock on SQLite
  // if called inside this transaction (only one writer at a time on SQLite).
  // This mirrors the TRANSACTION_RETRY_INVARIANT: external side-effects
  // (even DB writes to adjacent tables) belong OUTSIDE the retryable body.
  const result = await withTransaction(async (tx) => {
    // Idempotency check: look for an existing unresolved finding for this
    // (mismatchClass, entityId) pair. resolvedAt IS NULL means unresolved.
    const existing = await tx.reconciliationFinding.findFirst({
      where: {
        mismatchClass: finding.mismatchClass,
        entityId: finding.entityId,
        resolvedAt: null,
      },
      select: { id: true, exceptionId: true },
    })

    if (existing) {
      // Update lastSeenAt + stateSnapshot (NO new row — dedup)
      await tx.reconciliationFinding.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          stateSnapshot: JSON.stringify(finding.stateSnapshot),
          runId, // associate with the latest run that re-detected it
        },
      })
      return { isNew: false, findingId: existing.id, existingExceptionId: existing.exceptionId }
    }

    // Insert a new finding row (exceptionId will be set in Step 2 if needed)
    const newFinding = await tx.reconciliationFinding.create({
      data: {
        runId,
        mismatchClass: finding.mismatchClass,
        severity: finding.severity,
        entityType: finding.entityType,
        entityId: finding.entityId,
        stateSnapshot: JSON.stringify(finding.stateSnapshot),
        description: finding.description,
        recommendedRemediation: finding.recommendedRemediation ?? null,
        exceptionId: null,
      },
    })
    return { isNew: true, findingId: newFinding.id, existingExceptionId: null }
  })

  // Step 2: Route CRITICAL/HIGH NEW findings through reportInvariantViolation()
  // (P0-28 path) — creates ExceptionQueue entry + applies freeze. This is the
  // ONLY permitted write to a CLOSED-wave-adjacent table (ExceptionQueue).
  // Called OUTSIDE the txn to avoid SQLite write-lock deadlock.
  if (result.isNew && (finding.severity === 'CRITICAL' || finding.severity === 'HIGH')) {
    try {
      const exceptionId = await reportInvariantViolation({
        invariant: finding.mismatchClass,
        entityType: finding.entityType === 'Payment' ? 'Payment' : finding.entityType === 'Refund' ? 'Payment' : 'Order',
        entityId: finding.entityId,
        description: finding.description,
        stateSnapshot: finding.stateSnapshot,
        traceId,
      })
      // Step 3: Update the finding row with the exceptionId (separate txn).
      if (exceptionId) {
        await db.reconciliationFinding.update({
          where: { id: result.findingId },
          data: { exceptionId },
        }).catch((err: Error) => {
          logWarn('reconciliation-finding-exceptionid-update-failed', { findingId: result.findingId, error: err.message, traceId }, traceId)
        })
      }
    } catch (err) {
      // reportInvariantViolation failure does NOT block the finding — it's
      // already persisted. The finding will have exceptionId=null, which
      // means "not routed to ExceptionQueue" (admin can still see it in /findings).
      logWarn('reconciliation-invariant-report-failed', { mismatchClass: finding.mismatchClass, entityId: finding.entityId, error: (err as Error).message, traceId }, traceId)
    }
  }
}

// ----------------------------------------------------------------------------
// Query helpers (for the mini-service endpoints)
// ----------------------------------------------------------------------------

/**
 * List recent reconciliation runs (for the /runs endpoint).
 */
export async function listRecentRuns(limit = 20): Promise<Array<{
  id: string
  triggerType: string
  status: string
  startedAt: Date
  completedAt: Date | null
  findingsCount: number
  mismatchCount: number
}>> {
  return db.reconciliationRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true, triggerType: true, status: true, startedAt: true,
      completedAt: true, findingsCount: true, mismatchCount: true,
    },
  })
}

/**
 * List recent findings (for the /findings endpoint).
 * Defaults to unresolved findings only.
 */
export async function listFindings(opts: { unresolvedOnly?: boolean; limit?: number } = {}): Promise<Array<{
  id: string
  mismatchClass: string
  severity: string
  entityType: string
  entityId: string
  description: string
  firstSeenAt: Date
  lastSeenAt: Date
  resolvedAt: Date | null
}>> {
  const where = opts.unresolvedOnly === false ? {} : { resolvedAt: null }
  return db.reconciliationFinding.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    take: opts.limit ?? 50,
    select: {
      id: true, mismatchClass: true, severity: true, entityType: true, entityId: true,
      description: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true,
    },
  })
}

/**
 * Get the current reconciliation_mismatch_count (unresolved findings).
 * Used by the alert-evaluator mini-service to emit the metric.
 */
export async function getMismatchCount(): Promise<number> {
  return db.reconciliationFinding.count({ where: { resolvedAt: null } })
}

// ============================================================================
// P0-03 Wave-5 Sub-Wave 5C — M16 Remediation Handler (M16-ONLY)
// ============================================================================
// Orchestrator Directive WAVE5-5C-P0-03-IMPLEMENT-M16-FIRST:
//   ONLY M16 (outbox lag — operational, non-financial) remediation is authorized.
//   M3/M9/M10 (CLASS C — status mutation) + CLASS B/D/E are NOT authorized.
//
// SAFETY CONTRACT (Orchestrator hard boundary for 5C-M16):
//   - M16 remediation NEVER writes to Payment, Refund, LedgerEntry, Outbox,
//     WebhookEvent, IdempotencyKey, or AuditLog.
//   - M16 remediation NEVER makes external Razorpay API calls.
//   - M16 remediation's only "external" action is an HTTP call to the outbox
//     publisher's /trigger endpoint (operational restart — no financial mutation).
//   - M16 remediation's only DB writes are to RemediationAction +
//     ReconciliationFinding (resolves the finding).
//
// Safety Invariants satisfied (per WAVE5_5C_REMEDIATION_GATE_REVIEW.md §4):
//   SI-1: Re-validation before repair (re-check M16 finding is still present).
//   SI-2: Repair idempotency (RemediationAction unique constraint on findingId+repairType).
//   SI-4: Conditional updates (updateMany WHERE resolvedAt IS NULL).
//   SI-6: Every repair writes a RemediationAction audit record.
//   SI-8: Post-repair verification (re-run M16 detector to confirm resolution).
//   SI-12: Feature-flagged (reconciliationAutoRepair, default OFF).
// ============================================================================

/**
 * M16 remediation result.
 */
export interface M16RemediationResult {
  findingId: string
  repairType: string
  status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' | 'DISABLED'
  reason: string
  lagBeforeSeconds: number | null
  lagAfterSeconds: number | null
  publisherTriggerCalled: boolean
  remediationActionId: string | null
}

/**
 * Re-validate the M16 finding: re-read the CURRENT state of the specific outbox
 * event referenced by the finding. If the event is still PENDING + still older
 * than the SLA threshold, the finding is still valid (SI-1).
 *
 * NOTE: This does NOT re-run the detector (which only returns the single oldest
 * PENDING event). Instead, it checks the specific outbox event by ID — because
 * the finding may reference an event that is no longer the oldest (a newer old
 * event may have been created after it). The finding is "stale" only if the
 * specific event is no longer PENDING OR is no longer older than the SLA.
 *
 * @param findingId The ReconciliationFinding id to re-validate.
 * @returns The current M16 finding data if still present, else null (stale).
 */
async function revalidateM16Finding(
  findingId: string,
): Promise<{ outboxId: string; eventId: string; ageMs: number } | null> {
  // Read the finding row
  const finding = await db.reconciliationFinding.findUnique({
    where: { id: findingId },
    select: { mismatchClass: true, entityId: true, resolvedAt: true, stateSnapshot: true },
  })
  if (!finding || finding.mismatchClass !== 'M16_OUTBOX_LAG_EXCEEDED' || finding.resolvedAt !== null) {
    return null // finding doesn't exist, is not M16, or is already resolved
  }
  // Re-read the CURRENT state of the specific outbox event (by entityId = outbox id)
  const outboxEvent = await db.outbox.findUnique({
    where: { id: finding.entityId },
    select: { id: true, eventId: true, status: true, createdAt: true },
  })
  if (!outboxEvent) {
    return null // the outbox event was deleted — finding is stale
  }
  // If the event is no longer PENDING, it was published (publisher caught up) — finding is stale
  if (outboxEvent.status !== 'PENDING') {
    return null
  }
  // If the event is still PENDING but is now under the SLA threshold (shouldn't happen —
  // createdAt doesn't change — but check defensively), the finding is stale
  const ageMs = Date.now() - outboxEvent.createdAt.getTime()
  const lagThresholdMs = 5 * 60 * 1000 // 5 min SLA (matches M16 detector)
  if (ageMs <= lagThresholdMs) {
    return null // event is now under the SLA (impossible unless createdAt was edited) — stale
  }
  // The finding is still valid — return the current data
  return {
    outboxId: outboxEvent.id,
    eventId: outboxEvent.eventId,
    ageMs,
  }
}

/**
 * Compute the current outbox lag in seconds (for pre/post comparison).
 */
async function computeOutboxLagSeconds(): Promise<number> {
  const oldestPending = await db.outbox.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })
  if (!oldestPending) return 0
  return Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 1000)
}

/**
 * Trigger the outbox publisher's /trigger endpoint (operational restart).
 *
 * This is the ONLY "external" action M16 remediation takes. It does NOT
 * mutate any money-state table — it just nudges the publisher to process
 * pending events. If the publisher is unreachable, the repair fails gracefully
 * (the finding remains open + is escalated via alert).
 *
 * OUTBOX_PUBLISHER_URL env var configures the publisher URL. If not set,
 * the trigger is skipped (repair status = SKIPPED, reason = "publisher URL not configured").
 */
async function triggerOutboxPublisher(): Promise<{ called: boolean; ok: boolean; error?: string }> {
  const publisherUrl = process.env.OUTBOX_PUBLISHER_URL
  if (!publisherUrl) {
    return { called: false, ok: false, error: 'OUTBOX_PUBLISHER_URL not configured' }
  }
  try {
    const response = await fetch(`${publisherUrl.replace(/\/$/, '')}/trigger`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      return { called: true, ok: false, error: `Publisher returned HTTP ${response.status}` }
    }
    return { called: true, ok: true }
  } catch (err) {
    return { called: true, ok: false, error: (err as Error).message }
  }
}

/**
 * Attempt to repair a single M16 finding.
 *
 * Flow (per WAVE5_5C_REMEDIATION_GATE_REVIEW.md §3.1):
 *   1. Check feature flag (reconciliationAutoRepair). If OFF → return DISABLED.
 *   2. Re-validate the finding (SI-1). If stale → mark resolved + return SKIPPED.
 *   3. Create a RemediationAction row (idempotent via unique constraint — SI-2).
 *      If a repair action already exists → return SKIPPED (idempotent dedup).
 *   4. Trigger the outbox publisher's /trigger endpoint (operational).
 *   5. Post-repair verification (SI-8): re-compute outbox lag.
 *   6. If lag decreased below threshold → mark finding resolved + action SUCCEEDED.
 *      Else → action SUCCEEDED (trigger was called) but finding stays open
 *      (the publisher may be permanently down — escalate via alert).
 *   7. Update the RemediationAction row with the result.
 *
 * SAFETY: This function NEVER writes to Payment, Refund, LedgerEntry, Outbox,
 * WebhookEvent, IdempotencyKey, or AuditLog. Its only DB writes are to
 * RemediationAction + ReconciliationFinding.
 *
 * @param findingId The ReconciliationFinding id to repair.
 * @returns The M16RemediationResult.
 */
export async function remediateM16OutboxLag(findingId: string): Promise<M16RemediationResult> {
  const traceId = newTraceId()

  // 1. Feature flag check (SI-12)
  if (!isFeatureEnabled('reconciliationAutoRepair')) {
    logInfo('m16-remediation-disabled-flag-off', { findingId, traceId }, traceId)
    return {
      findingId,
      repairType: 'M16_PUBLISHER_TRIGGER',
      status: 'DISABLED',
      reason: 'reconciliationAutoRepair feature flag is OFF',
      lagBeforeSeconds: null,
      lagAfterSeconds: null,
      publisherTriggerCalled: false,
      remediationActionId: null,
    }
  }

  // 2. Re-validate the finding (SI-1)
  const current = await revalidateM16Finding(findingId)
  const lagBefore = await computeOutboxLagSeconds()
  if (!current) {
    // Finding is stale — the lag has resolved (publisher caught up). Mark resolved.
    logInfo('m16-remediation-stale-finding-auto-resolved', { findingId, traceId }, traceId)
    await db.reconciliationFinding.update({
      where: { id: findingId },
      data: {
        resolvedAt: new Date(),
        resolutionNote: 'Stale finding — outbox lag resolved by external action (publisher caught up).',
      },
    }).catch(() => {})
    return {
      findingId,
      repairType: 'M16_PUBLISHER_TRIGGER',
      status: 'SKIPPED',
      reason: 'Stale finding — outbox lag already resolved (re-validation passed)',
      lagBeforeSeconds: lagBefore,
      lagAfterSeconds: lagBefore,
      publisherTriggerCalled: false,
      remediationActionId: null,
    }
  }

  // 3. Create RemediationAction row (idempotent via unique constraint — SI-2)
  let remediationActionId: string | null = null
  try {
    const action = await db.remediationAction.create({
      data: {
        findingId,
        repairType: 'M16_PUBLISHER_TRIGGER',
        status: 'ATTEMPTED',
        actionSnapshot: JSON.stringify({
          lagBeforeSeconds: lagBefore,
          outboxId: current.outboxId,
          eventId: current.eventId,
          ageMs: current.ageMs,
        }),
      },
    })
    remediationActionId = action.id
  } catch (err) {
    // P2002 — unique constraint violation → a repair action already exists for
    // this findingId + repairType. This is the idempotency dedup (SI-2).
    logInfo('m16-remediation-idempotent-skip', { findingId, traceId, error: (err as Error).message }, traceId)
    return {
      findingId,
      repairType: 'M16_PUBLISHER_TRIGGER',
      status: 'SKIPPED',
      reason: 'Idempotent skip — a repair action already exists for this finding',
      lagBeforeSeconds: lagBefore,
      lagAfterSeconds: lagBefore,
      publisherTriggerCalled: false,
      remediationActionId: null,
    }
  }

  // 4. Trigger the outbox publisher (operational — no financial mutation)
  const triggerResult = await triggerOutboxPublisher()

  // 5. Post-repair verification (SI-8): re-compute outbox lag
  const lagAfter = await computeOutboxLagSeconds()
  const lagThresholdSeconds = 5 * 60 // 5 min SLA (matches M16 detector)

  // 6. Determine repair outcome
  let actionStatus: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED'
  let findingResolved = false
  let reason: string

  if (!triggerResult.called) {
    // Publisher URL not configured — repair couldn't trigger. Mark action FAILED.
    actionStatus = 'FAILED'
    reason = `Publisher trigger skipped: ${triggerResult.error}`
  } else if (!triggerResult.ok) {
    // Publisher trigger failed (HTTP error or network error).
    actionStatus = 'FAILED'
    reason = `Publisher trigger failed: ${triggerResult.error}`
  } else if (lagAfter <= lagThresholdSeconds) {
    // Lag decreased below threshold → finding resolved.
    findingResolved = true
    reason = `Outbox lag decreased from ${lagBefore}s to ${lagAfter}s (below ${lagThresholdSeconds}s SLA).`
  } else {
    // Trigger succeeded but lag is still above threshold. The publisher may be
    // permanently down or overwhelmed. The finding stays open — the next
    // reconciliation run will re-detect it + the alert will fire.
    findingResolved = false
    reason = `Publisher trigger succeeded but lag still above SLA (${lagAfter}s > ${lagThresholdSeconds}s). Finding stays open for escalation.`
  }

  // 7. Update the RemediationAction row with the result
  await db.remediationAction.update({
    where: { id: remediationActionId },
    data: {
      status: actionStatus,
      completedAt: new Date(),
      actionSnapshot: JSON.stringify({
        lagBeforeSeconds: lagBefore,
        lagAfterSeconds: lagAfter,
        outboxId: current.outboxId,
        eventId: current.eventId,
        ageMs: current.ageMs,
        publisherTriggerCalled: triggerResult.called,
        publisherTriggerOk: triggerResult.ok,
        publisherError: triggerResult.error,
        findingResolved,
      }),
      error: actionStatus === 'FAILED' ? triggerResult.error : null,
    },
  }).catch((err: Error) => {
    logWarn('m16-remediation-action-update-failed', { remediationActionId, error: err.message, traceId }, traceId)
  })

  // 8. Resolve the finding if the lag is now below threshold
  if (findingResolved) {
    await db.reconciliationFinding.update({
      where: { id: findingId },
      data: {
        resolvedAt: new Date(),
        resolutionNote: `M16 remediation: ${reason} (action ${remediationActionId})`,
      },
    }).catch((err: Error) => {
      logWarn('m16-remediation-finding-resolve-failed', { findingId, error: err.message, traceId }, traceId)
    })
  }

  logInfo('m16-remediation-complete', {
    findingId, remediationActionId, actionStatus, findingResolved,
    lagBefore, lagAfter, publisherTriggerCalled: triggerResult.called,
    publisherTriggerOk: triggerResult.ok, traceId,
  }, traceId)

  return {
    findingId,
    repairType: 'M16_PUBLISHER_TRIGGER',
    status: actionStatus === 'SUCCEEDED' ? (findingResolved ? 'SUCCEEDED' : 'SUCCEEDED') : 'FAILED',
    reason,
    lagBeforeSeconds: lagBefore,
    lagAfterSeconds: lagAfter,
    publisherTriggerCalled: triggerResult.called,
    remediationActionId,
  }
}

/**
 * Process all unresolved M16 findings (called by the remediation worker or
 * the reconciliation mini-service's /trigger-remediation endpoint).
 *
 * Only processes M16_OUTBOX_LAG_EXCEEDED findings. CLASS B/C/D/E findings are
 * NEVER processed by this function (they require separate authorization).
 *
 * @returns Array of M16RemediationResult for each finding processed.
 */
export async function processM16Remediations(): Promise<M16RemediationResult[]> {
  const traceId = newTraceId()

  // Feature flag check (SI-12)
  if (!isFeatureEnabled('reconciliationAutoRepair')) {
    logInfo('m16-remediation-batch-disabled', { reason: 'flag OFF', traceId }, traceId)
    return []
  }

  // Find all unresolved M16 findings
  const m16Findings = await db.reconciliationFinding.findMany({
    where: {
      mismatchClass: 'M16_OUTBOX_LAG_EXCEEDED',
      resolvedAt: null,
    },
    select: { id: true },
  })

  logInfo('m16-remediation-batch-start', { count: m16Findings.length, traceId }, traceId)

  const results: M16RemediationResult[] = []
  for (const finding of m16Findings) {
    try {
      const result = await remediateM16OutboxLag(finding.id)
      results.push(result)
    } catch (err) {
      logError('m16-remediation-batch-item-error', { findingId: finding.id, error: (err as Error).message, traceId }, traceId)
      results.push({
        findingId: finding.id,
        repairType: 'M16_PUBLISHER_TRIGGER',
        status: 'FAILED',
        reason: `Unexpected error: ${(err as Error).message}`,
        lagBeforeSeconds: null,
        lagAfterSeconds: null,
        publisherTriggerCalled: false,
        remediationActionId: null,
      })
    }
  }

  logInfo('m16-remediation-batch-complete', {
    count: results.length,
    succeeded: results.filter((r) => r.status === 'SUCCEEDED').length,
    skipped: results.filter((r) => r.status === 'SKIPPED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    disabled: results.filter((r) => r.status === 'DISABLED').length,
    traceId,
  }, traceId)

  return results
}

// ============================================================================
// P0-03 Wave-5 Sub-Wave 5C — M3 Remediation Handler (M3-ONLY)
// ============================================================================
// Orchestrator Directive WAVE5-5C-M3-IMPLEMENT-01:
//   ONLY M3 (missing capture status — gateway-verified status flip) is authorized.
//   M9/M10 + CLASS B/D/E are NOT authorized.
//
// SAFETY CONTRACT (Orchestrator hard boundary for 5C-M3):
//   - M3 remediation ONLY mutates Payment.status (CAPTURE_PENDING → CAPTURED).
//   - M3 remediation NEVER mutates Refund, LedgerEntry, Outbox, WebhookEvent,
//     IdempotencyKey.
//   - M3 remediation NEVER captures, refunds, or mutates gateway state.
//   - M3 remediation calls fetchRazorpayPaymentStatus() OUTSIDE any txn body
//     (TRANSACTION_RETRY_INVARIANT).
//   - M3 remediation ONLY proceeds if the gateway returns 'captured'.
//   - Any other gateway status (authorized/failed/refunded/unknown/error) →
//     escalate to ExceptionQueue, NO Payment mutation.
//
// Safety Invariants satisfied (per WAVE5_5C_M3_GATE_REVIEW.md §M):
//   M3-SI-1: Re-validation before repair (re-read Payment.status; if not CAPTURE_PENDING → skip)
//   M3-SI-2: Repair idempotency (RemediationAction unique constraint)
//   M3-SI-3: Gateway ambiguity = no repair (non-captured → escalate)
//   M3-SI-4: Conditional updateMany (WHERE status=CAPTURE_PENDING — race-safe)
//   M3-SI-5: Gateway-fetch OUTSIDE txn body (TRANSACTION_RETRY_INVARIANT)
//   M3-SI-6: RemediationAction audit record created
//   M3-SI-7: AuditLog entry created (RECONCILIATION_REPAIR_M3_CAPTURE_STATUS_FLIPPED)
//   M3-SI-8: Post-repair verification (re-read Payment.status to confirm CAPTURED)
//   M3-SI-9: Feature-flagged (reconciliationAutoRepair, default OFF)
//   M3-SI-10: NO LedgerEntry mutation
//   M3-SI-11: NO Outbox enqueue
//   M3-SI-12: NO Razorpay capture/refund call (only FETCH)
//   M3-SI-13: Escalate on any non-captured gateway status
// ============================================================================

/**
 * M3 remediation result.
 */
export interface M3RemediationResult {
  findingId: string
  repairType: string
  status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' | 'DISABLED' | 'ESCALATED'
  reason: string
  gatewayStatus: string | null
  paymentStatusBefore: string | null
  paymentStatusAfter: string | null
  remediationActionId: string | null
}

/**
 * Re-validate the M3 finding: re-read the current Payment state.
 * If the Payment is no longer CAPTURE_PENDING, the finding is stale (SI-1).
 *
 * @param findingId The ReconciliationFinding id to re-validate.
 * @returns The current Payment data if still CAPTURE_PENDING, else null (stale).
 */
async function revalidateM3Finding(
  findingId: string,
): Promise<{ paymentId: string; gatewayPaymentId: string | null; amount: number } | null> {
  const finding = await db.reconciliationFinding.findUnique({
    where: { id: findingId },
    select: { mismatchClass: true, entityId: true, resolvedAt: true },
  })
  if (!finding || finding.mismatchClass !== 'M3_MISSING_CAPTURE_STATUS' || finding.resolvedAt !== null) {
    return null
  }
  // Re-read the CURRENT Payment state (not the finding snapshot)
  const payment = await db.payment.findUnique({
    where: { id: finding.entityId },
    select: { id: true, status: true, gatewayPaymentId: true, amount: true },
  })
  if (!payment || payment.status !== 'CAPTURE_PENDING') {
    return null // stale — status was already flipped by webhook/publisher/another M3 run
  }
  return {
    paymentId: payment.id,
    gatewayPaymentId: payment.gatewayPaymentId,
    amount: payment.amount,
  }
}

/**
 * Attempt to repair a single M3 finding.
 *
 * Flow (per WAVE5_5C_M3_GATE_REVIEW.md §D + §G):
 *   1. Check feature flag (SI-9). If OFF → return DISABLED.
 *   2. Re-validate the finding (SI-1). If stale → mark resolved + return SKIPPED.
 *   3. Create a RemediationAction row (idempotent via unique constraint — SI-2).
 *      If a repair action already exists → return SKIPPED.
 *   4. [OUTSIDE txn] Call fetchRazorpayPaymentStatus() (SI-5, SI-12).
 *   5. If gateway says 'captured' → proceed to step 6.
 *      If gateway says anything else → escalate (SI-3, SI-13) + return ESCALATED.
 *      If gateway call throws → abort + return FAILED (SI-3).
 *   6. [INSIDE txn] Conditional updateMany WHERE status=CAPTURE_PENDING → CAPTURED
 *      (SI-4) + RemediationAction update + AuditLog (SI-7) + ReconciliationFinding
 *      resolution.
 *   7. [OUTSIDE txn] Post-repair verification (SI-8): re-read Payment.status.
 *
 * SAFETY: This function NEVER writes to Refund, LedgerEntry, Outbox,
 * WebhookEvent, or IdempotencyKey. It only writes to Payment.status (conditional
 * updateMany) + RemediationAction + AuditLog + ReconciliationFinding.
 *
 * @param findingId The ReconciliationFinding id to repair.
 * @returns The M3RemediationResult.
 */
export async function remediateM3MissingCaptureStatus(findingId: string): Promise<M3RemediationResult> {
  const traceId = newTraceId()

  // 1. Feature flag check (SI-9)
  if (!isFeatureEnabled('reconciliationAutoRepair')) {
    logInfo('m3-remediation-disabled-flag-off', { findingId, traceId }, traceId)
    return {
      findingId,
      repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
      status: 'DISABLED',
      reason: 'reconciliationAutoRepair feature flag is OFF',
      gatewayStatus: null,
      paymentStatusBefore: null,
      paymentStatusAfter: null,
      remediationActionId: null,
    }
  }

  // 2. Re-validate the finding (SI-1)
  const current = await revalidateM3Finding(findingId)
  if (!current) {
    logInfo('m3-remediation-stale-finding-auto-resolved', { findingId, traceId }, traceId)
    await db.reconciliationFinding.update({
      where: { id: findingId },
      data: {
        resolvedAt: new Date(),
        resolutionNote: 'Stale finding — Payment.status already changed (webhook/publisher/another M3 run).',
      },
    }).catch(() => {})
    return {
      findingId,
      repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
      status: 'SKIPPED',
      reason: 'Stale finding — Payment.status already changed (re-validation passed)',
      gatewayStatus: null,
      paymentStatusBefore: null,
      paymentStatusAfter: null,
      remediationActionId: null,
    }
  }

  // Check: gatewayPaymentId must be non-null to fetch gateway state
  if (!current.gatewayPaymentId) {
    logWarn('m3-remediation-no-gateway-payment-id', { findingId, paymentId: current.paymentId, traceId }, traceId)
    // Escalate — cannot verify gateway state without a gatewayPaymentId
    const exceptionId = await reportInvariantViolation({
      invariant: 'M3_MISSING_CAPTURE_STATUS',
      entityType: 'Payment',
      entityId: current.paymentId,
      description: `M3 remediation: cannot verify gateway state — gatewayPaymentId is null for payment ${current.paymentId}`,
      stateSnapshot: { paymentId: current.paymentId, reason: 'null gatewayPaymentId' },
      traceId,
    }).catch(() => null)
    return {
      findingId,
      repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
      status: 'ESCALATED',
      reason: 'Cannot verify gateway state — gatewayPaymentId is null',
      gatewayStatus: null,
      paymentStatusBefore: 'CAPTURE_PENDING',
      paymentStatusAfter: 'CAPTURE_PENDING',
      remediationActionId: null,
    }
  }

  // 3. Create RemediationAction row (idempotent via unique constraint — SI-2)
  let remediationActionId: string | null = null
  try {
    const action = await db.remediationAction.create({
      data: {
        findingId,
        repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
        status: 'ATTEMPTED',
        actionSnapshot: JSON.stringify({
          paymentId: current.paymentId,
          paymentStatusBefore: 'CAPTURE_PENDING',
          gatewayPaymentId: current.gatewayPaymentId,
        }),
      },
    })
    remediationActionId = action.id
  } catch (err) {
    // P2002 — unique constraint violation → a repair action already exists (SI-2)
    logInfo('m3-remediation-idempotent-skip', { findingId, traceId, error: (err as Error).message }, traceId)
    return {
      findingId,
      repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
      status: 'SKIPPED',
      reason: 'Idempotent skip — a repair action already exists for this finding',
      gatewayStatus: null,
      paymentStatusBefore: 'CAPTURE_PENDING',
      paymentStatusAfter: 'CAPTURE_PENDING',
      remediationActionId: null,
    }
  }

  // 4. [OUTSIDE txn] Call fetchRazorpayPaymentStatus() (SI-5, SI-12)
  // This is the AUTHORITATIVE gateway truth. It MUST be outside any txn body.
  let gatewayResult: { status: string; captured: boolean }
  try {
    // Dynamic import to avoid circular dependency issues in the standalone mini-service
    const { fetchRazorpayPaymentStatus } = await import('./razorpay')
    const response = await fetchRazorpayPaymentStatus(current.gatewayPaymentId)
    gatewayResult = { status: response.status, captured: response.captured }
  } catch (err) {
    // Gateway call failed (network error, timeout, etc.) — SI-3: abort, do NOT flip
    logWarn('m3-remediation-gateway-fetch-failed', { findingId, paymentId: current.paymentId, error: (err as Error).message, traceId }, traceId)
    await db.remediationAction.update({
      where: { id: remediationActionId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: `Gateway fetch failed: ${(err as Error).message}`,
        actionSnapshot: JSON.stringify({
          paymentId: current.paymentId,
          paymentStatusBefore: 'CAPTURE_PENDING',
          gatewayPaymentId: current.gatewayPaymentId,
          gatewayError: (err as Error).message,
        }),
      },
    }).catch(() => {})
    return {
      findingId,
      repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
      status: 'FAILED',
      reason: `Gateway fetch failed: ${(err as Error).message}`,
      gatewayStatus: null,
      paymentStatusBefore: 'CAPTURE_PENDING',
      paymentStatusAfter: 'CAPTURE_PENDING',
      remediationActionId,
    }
  }

  // 5. Check gateway status — ONLY 'captured' permits the repair (SI-3, SI-13)
  if (gatewayResult.status !== 'captured') {
    // Non-captured gateway status → escalate, do NOT flip (SI-3, SI-13)
    logWarn('m3-remediation-gateway-not-captured', {
      findingId, paymentId: current.paymentId, gatewayStatus: gatewayResult.status, traceId,
    }, traceId)
    // Update RemediationAction with the gateway result
    await db.remediationAction.update({
      where: { id: remediationActionId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: `Gateway status is ${gatewayResult.status} (not captured) — escalated`,
        actionSnapshot: JSON.stringify({
          paymentId: current.paymentId,
          paymentStatusBefore: 'CAPTURE_PENDING',
          gatewayPaymentId: current.gatewayPaymentId,
          gatewayStatus: gatewayResult.status,
          gatewayCaptured: gatewayResult.captured,
          escalated: true,
        }),
      },
    }).catch(() => {})
    // Escalate to ExceptionQueue
    await reportInvariantViolation({
      invariant: 'M3_MISSING_CAPTURE_STATUS',
      entityType: 'Payment',
      entityId: current.paymentId,
      description: `M3 remediation: gateway status is '${gatewayResult.status}' (not captured). Payment ${current.paymentId} should NOT be flipped to CAPTURED. Escalating for manual review.`,
      stateSnapshot: { paymentId: current.paymentId, gatewayStatus: gatewayResult.status, findingId },
      traceId,
    }).catch(() => null)
    return {
      findingId,
      repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
      status: 'ESCALATED',
      reason: `Gateway status is ${gatewayResult.status} (not captured) — escalated`,
      gatewayStatus: gatewayResult.status,
      paymentStatusBefore: 'CAPTURE_PENDING',
      paymentStatusAfter: 'CAPTURE_PENDING',
      remediationActionId,
    }
  }

  // 6. [INSIDE txn] Conditional updateMany WHERE status=CAPTURE_PENDING → CAPTURED (SI-4)
  //    + RemediationAction update + AuditLog (SI-7) + ReconciliationFinding resolution.
  //    This txn does NOT include the gateway-fetch call — that already happened above (SI-5).
  await db.$transaction(async (tx) => {
    // Race-safe: only update if status is still CAPTURE_PENDING (SI-4)
    const updated = await tx.payment.updateMany({
      where: {
        id: current.paymentId,
        status: 'CAPTURE_PENDING',
      },
      data: {
        status: 'CAPTURED',
        capturedAt: new Date(),
        version: { increment: 1 },
      },
    })

    if (updated.count > 0) {
      // AuditLog — RECONCILIATION_REPAIR_M3_CAPTURE_STATUS_FLIPPED (SI-7)
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: 'SYSTEM',
          action: 'RECONCILIATION_REPAIR_M3_CAPTURE_STATUS_FLIPPED',
          metadata: JSON.stringify({
            paymentId: current.paymentId,
            findingId,
            remediationActionId,
            gatewayStatus: gatewayResult.status,
            gatewayPaymentId: current.gatewayPaymentId,
            source: 'm3-remediation',
          }),
        },
      })
    }

    // Update RemediationAction with success
    await tx.remediationAction.update({
      where: { id: remediationActionId },
      data: {
        status: updated.count > 0 ? 'SUCCEEDED' : 'SKIPPED',
        completedAt: new Date(),
        actionSnapshot: JSON.stringify({
          paymentId: current.paymentId,
          paymentStatusBefore: 'CAPTURE_PENDING',
          paymentStatusAfter: updated.count > 0 ? 'CAPTURED' : 'CAPTURE_PENDING (already changed)',
          gatewayPaymentId: current.gatewayPaymentId,
          gatewayStatus: gatewayResult.status,
          gatewayCaptured: gatewayResult.captured,
          rowsUpdated: updated.count,
          findingResolved: updated.count > 0,
        }),
        error: updated.count > 0 ? null : 'Payment.status was already changed by a concurrent path (conditional updateMany returned 0 rows)',
      },
    })

    // Resolve the finding if the status was flipped
    if (updated.count > 0) {
      await tx.reconciliationFinding.update({
        where: { id: findingId },
        data: {
          resolvedAt: new Date(),
          resolutionNote: `M3 remediation: gateway confirmed 'captured'. Payment.status flipped CAPTURE_PENDING → CAPTURED (action ${remediationActionId}).`,
        },
      })
    }
  })

  // 7. [OUTSIDE txn] Post-repair verification (SI-8): re-read Payment.status
  const afterPayment = await db.payment.findUnique({
    where: { id: current.paymentId },
    select: { status: true },
  }).catch(() => null)
  const paymentStatusAfter = afterPayment?.status ?? 'UNKNOWN'

  logInfo('m3-remediation-complete', {
    findingId, remediationActionId, paymentId: current.paymentId,
    gatewayStatus: gatewayResult.status, paymentStatusAfter, traceId,
  }, traceId)

  return {
    findingId,
    repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
    status: paymentStatusAfter === 'CAPTURED' ? 'SUCCEEDED' : 'SKIPPED',
    reason: paymentStatusAfter === 'CAPTURED'
      ? `Gateway confirmed 'captured'. Payment.status flipped to CAPTURED.`
      : `Gateway confirmed 'captured' but Payment.status is ${paymentStatusAfter} (concurrent path won the race).`,
    gatewayStatus: gatewayResult.status,
    paymentStatusBefore: 'CAPTURE_PENDING',
    paymentStatusAfter,
    remediationActionId,
  }
}

/**
 * Process all unresolved M3 findings (called by the remediation worker or
 * the reconciliation mini-service's /trigger-remediation endpoint).
 *
 * Only processes M3_MISSING_CAPTURE_STATUS findings. CLASS B/D/E + M9/M10
 * findings are NEVER processed by this function.
 *
 * @returns Array of M3RemediationResult for each finding processed.
 */
export async function processM3Remediations(): Promise<M3RemediationResult[]> {
  const traceId = newTraceId()

  // Feature flag check (SI-9)
  if (!isFeatureEnabled('reconciliationAutoRepair')) {
    logInfo('m3-remediation-batch-disabled', { reason: 'flag OFF', traceId }, traceId)
    return []
  }

  // Find all unresolved M3 findings
  const m3Findings = await db.reconciliationFinding.findMany({
    where: {
      mismatchClass: 'M3_MISSING_CAPTURE_STATUS',
      resolvedAt: null,
    },
    select: { id: true },
  })

  logInfo('m3-remediation-batch-start', { count: m3Findings.length, traceId }, traceId)

  const results: M3RemediationResult[] = []
  for (const finding of m3Findings) {
    try {
      const result = await remediateM3MissingCaptureStatus(finding.id)
      results.push(result)
    } catch (err) {
      logError('m3-remediation-batch-item-error', { findingId: finding.id, error: (err as Error).message, traceId }, traceId)
      results.push({
        findingId: finding.id,
        repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP',
        status: 'FAILED',
        reason: `Unexpected error: ${(err as Error).message}`,
        gatewayStatus: null,
        paymentStatusBefore: null,
        paymentStatusAfter: null,
        remediationActionId: null,
      })
    }
  }

  logInfo('m3-remediation-batch-complete', {
    count: results.length,
    succeeded: results.filter((r) => r.status === 'SUCCEEDED').length,
    skipped: results.filter((r) => r.status === 'SKIPPED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    escalated: results.filter((r) => r.status === 'ESCALATED').length,
    disabled: results.filter((r) => r.status === 'DISABLED').length,
    traceId,
  }, traceId)

  return results
}
