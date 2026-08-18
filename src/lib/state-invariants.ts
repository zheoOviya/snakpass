import { db } from './db'
import { reportInvariantViolation } from './invariant-checker'
import { fireAlert } from './alerting'
import { isFeatureEnabled } from './deployment'
import { info as logInfo, warn as logWarn, error as logError, newTraceId } from './logger'

// P0-06 Wave-6 — State-invariant detectors M18-M21 (detection-only — additive)
//
// These detectors are READ-DETECT-AND-REPORT functions that check parallel-state
// combinations across Order / Payment / Fulfilment. They are ADDITIVE to the
// existing P0-03 Wave-5 5B reconciliation detectors (M1-M17) and DO NOT modify
// reconciliation.ts (5B detection-only boundary preserved).
//
// SAFETY CONTRACT (Orchestrator hard boundary):
//   - M19/M20/M21 are detection-only — they NEVER write to Payment, Refund,
//     LedgerEntry, Outbox, WebhookEvent, IdempotencyKey, AuditLog.
//   - M18 is the ONLY detector that performs an action: an HTTP fetch to the
//     EXISTING /api/payments/refund route. It reuses the existing refund
//     pathway (Wave-5 5A infrastructure) — NO new financial mutation logic.
//   - All detectors route findings to ExceptionQueue via the EXISTING
//     reportInvariantViolation() function (P0-28 pathway — unchanged).
//   - All detectors fire the EXISTING fireAlert('inconsistent-combo', ...)
//     alert rule (additively added to alerting.ts — Wave-6).
//
// The M18 auto-refund is gated by:
//   1. The `invariantChecker` feature flag (default OFF) — checked by
//      isStateInvariantCheckerEnabled() in the mini-service caller.
//   2. The `STATE_INVARIANT_AUTO_REFUND` env var (default ON when flag is ON).
//      Set to 'false' to disable the auto-refund action while keeping
//      detection + ExceptionQueue + alert active.
//
// M18 reasoning: when an Order is CANCELLED but its Payment is still CAPTURED,
// the customer was charged for an order they will not receive. Per I-01
// (Payment Integrity — money-state violation), forceFreezeLevel=3 is applied
// (system-level freeze halts ALL new orders platform-wide — per Q18 escalation
// policy for I-01 violations). The auto-refund attempts to make the customer
// whole via the existing refund route (HTTP fetch — same authentication
// boundary as a manual admin refund).

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type StateInvariantClass =
  | 'M18_ORDER_CANCELLED_PAYMENT_CAPTURED'
  | 'M19_ORDER_PAID_PAYMENT_REFUNDED'
  | 'M20_FULFILMENT_PICKED_UP_PAYMENT_NOT_CAPTURED'
  | 'M21_ORDER_FROZEN_STALE'

export type StateInvariantSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM'

export interface StateInvariantFinding {
  mismatchClass: StateInvariantClass
  severity: StateInvariantSeverity
  invariantCode: string // I-01, I-02, I-08, etc. — used by reportInvariantViolation
  entityType: 'Order' | 'Payment' | 'Fulfilment'
  entityId: string
  description: string
  stateSnapshot: Record<string, unknown>
  forceFreezeLevel?: 1 | 2 | 3
}

export interface StateInvariantCheckResult {
  findings: StateInvariantFinding[]
  m18AutoRefundsTriggered: number
  m18AutoRefundErrors: number
  startedAt: Date
  completedAt: Date | null
  trigger: 'cron' | 'manual' | 'evidence'
}

// ----------------------------------------------------------------------------
// Feature flag + auto-refund guards
// ----------------------------------------------------------------------------

/**
 * Returns true iff the invariantChecker feature flag is ON.
 * Default OFF (per Wave-6 deployment class — additive, default-OFF).
 *
 * The mini-service caller uses this to gate its poll loop. The library
 * functions below do NOT consult this flag — they always run when invoked,
 * so a manual POST /trigger can run them even if the flag is OFF (useful for
 * evidence collection / ad-hoc runs).
 */
export function isStateInvariantCheckerEnabled(): boolean {
  return isFeatureEnabled('invariantChecker')
}

/**
 * Returns true iff the M18 auto-refund action is permitted.
 * Two gates:
 *   1. invariantChecker flag is ON (caller responsibility — checked here as a
 *      defense-in-depth guard).
 *   2. STATE_INVARIANT_AUTO_REFUND env var is NOT 'false' (default ON when
 *      the flag is ON).
 */
function isM18AutoRefundPermitted(): boolean {
  if (!isStateInvariantCheckerEnabled()) return false
  return process.env.STATE_INVARIANT_AUTO_REFUND !== 'false'
}

// ----------------------------------------------------------------------------
// M18 — Order CANCELLED + Payment CAPTURED (I-01 money-state violation)
// ----------------------------------------------------------------------------
// When an order is CANCELLED but its Payment is still CAPTURED, the customer
// was charged for a cancelled order. This is a CRITICAL money-state violation
// (I-01 Payment Integrity).
//
// Per Q18 escalation policy, I-01 violations force forceFreezeLevel=3
// (system-level freeze — halts ALL new orders platform-wide).
//
// M18 is the ONLY detector that performs an automatic action: an HTTP fetch
// to the EXISTING /api/payments/refund route (no new financial mutation
// logic — Wave-5 5A infrastructure is reused as-is).
//
// The auto-refund is gated by:
//   - invariantChecker flag is ON (defense-in-depth)
//   - STATE_INVARIANT_AUTO_REFUND !== 'false'
//
// Routes to ExceptionQueue via reportInvariantViolation(forceFreezeLevel=3).
// Fires fireAlert('inconsistent-combo', ...).
// ----------------------------------------------------------------------------

async function detectM18OrderCancelledPaymentCaptured(
  traceId: string,
): Promise<{ findings: StateInvariantFinding[]; autoRefundsTriggered: number; autoRefundErrors: number }> {
  const findings: StateInvariantFinding[] = []
  let autoRefundsTriggered = 0
  let autoRefundErrors = 0

  // Find all Orders in CANCELLED status whose Payment is CAPTURED.
  // (1:1 Order → Payment relation — Prisma relation filter.)
  const cancelledOrdersWithCapturedPayment = await db.order.findMany({
    where: {
      status: 'CANCELLED',
      payment: { status: 'CAPTURED' },
    },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      userId: true,
      restaurantId: true,
      updatedAt: true,
      payment: {
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          gatewayPaymentId: true,
          frozen: true,
        },
      },
    },
  })

  for (const order of cancelledOrdersWithCapturedPayment) {
    const payment = order.payment
    if (!payment) continue // defensive — the relation filter guarantees non-null

    const finding: StateInvariantFinding = {
      mismatchClass: 'M18_ORDER_CANCELLED_PAYMENT_CAPTURED',
      severity: 'CRITICAL',
      invariantCode: 'I-01', // Payment Integrity — money-state violation
      entityType: 'Order',
      entityId: order.id,
      description: `Order ${order.id} is CANCELLED but Payment ${payment.id} is still CAPTURED (amount ${payment.amount} ${payment.currency}). Customer charged for a cancelled order.`,
      stateSnapshot: {
        orderId: order.id,
        orderStatus: order.status,
        orderTotalAmount: order.totalAmount,
        paymentId: payment.id,
        paymentStatus: payment.status,
        paymentAmount: payment.amount,
        paymentCurrency: payment.currency,
        paymentFrozen: payment.frozen,
        gatewayPaymentId: payment.gatewayPaymentId,
        detectedAt: new Date().toISOString(),
      },
      forceFreezeLevel: 3, // I-01 money-state → system freeze per Q18 policy
    }
    findings.push(finding)

    // Route to ExceptionQueue + freeze + log (existing P0-28 pathway).
    try {
      await reportInvariantViolation({
        invariant: 'I-01',
        entityType: 'Order',
        entityId: order.id,
        description: finding.description,
        stateSnapshot: finding.stateSnapshot,
        forceFreezeLevel: 3,
        traceId,
      })
    } catch (err) {
      // reportInvariantViolation may throw if the DB write fails. Log + continue.
      logError(
        'm18-report-invariant-violation-failed',
        { orderId: order.id, paymentId: payment.id, error: (err as Error).message },
        traceId,
      )
    }

    // Fire alert (additive 'inconsistent-combo' rule in alerting.ts).
    fireAlert('inconsistent-combo', {
      mismatchClass: finding.mismatchClass,
      severity: finding.severity,
      invariant: finding.invariantCode,
      orderId: order.id,
      paymentId: payment.id,
      paymentAmount: payment.amount,
      paymentCurrency: payment.currency,
      autoRefundEligible: true,
      traceId,
    })

    logWarn(
      'm18-inconsistent-combo-detected',
      {
        mismatchClass: finding.mismatchClass,
        orderId: order.id,
        paymentId: payment.id,
        paymentAmount: payment.amount,
        paymentStatus: payment.status,
        autoRefundWillRun: isM18AutoRefundPermitted(),
      },
      traceId,
    )

    // M18 auto-refund (gated) — HTTP fetch to existing refund route.
    if (isM18AutoRefundPermitted() && !payment.frozen) {
      const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000'
      try {
        // Reuse the EXISTING refund route — no new financial mutation logic.
        // The route creates a Refund + reversal LedgerEntry pair + outbox
        // event (PAYMENT_REFUND_REQUESTED) inside its own transaction; the
        // publisher then calls refundRazorpayPayment() OUTSIDE any txn
        // (Wave-4 4c pattern — safe by Option C of the transaction retry
        // invariant).
        const resp = await fetch(`${baseUrl}/api/payments/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Internal-call idempotency key (per-call deterministic-ish).
            // The route's getCachedResponse will dedup retries within TTL.
            'Idempotency-Key': `m18-autorefund-${payment.id}-${Date.now()}`,
          },
          body: JSON.stringify({
            paymentId: payment.id,
            amount: payment.amount, // full refund — customer made whole
          }),
        })
        if (resp.ok) {
          autoRefundsTriggered += 1
          logInfo(
            'm18-auto-refund-triggered',
            { orderId: order.id, paymentId: payment.id, amount: payment.amount, httpStatus: resp.status },
            traceId,
          )
        } else {
          autoRefundErrors += 1
          const respBody = await resp.text().catch(() => '<unreadable>')
          logError(
            'm18-auto-refund-http-error',
            { orderId: order.id, paymentId: payment.id, httpStatus: resp.status, body: respBody.slice(0, 300) },
            traceId,
          )
        }
      } catch (err) {
        autoRefundErrors += 1
        logError(
          'm18-auto-refund-fetch-exception',
          { orderId: order.id, paymentId: payment.id, error: (err as Error).message },
          traceId,
        )
      }
    } else if (isM18AutoRefundPermitted() && payment.frozen) {
      // Frozen payment — refund route will reject with 409. Skip the fetch.
      logWarn(
        'm18-auto-refund-skipped-payment-frozen',
        { orderId: order.id, paymentId: payment.id },
        traceId,
      )
    }
  }

  return { findings, autoRefundsTriggered, autoRefundErrors }
}

// ----------------------------------------------------------------------------
// M19 — Order PAID + Payment REFUNDED (I-02 Order Integrity)
// ----------------------------------------------------------------------------
// When an Order is in PAID status but its Payment has been REFUNDED, the order
// state is inconsistent with the money state. Per I-02 (Order Integrity), this
// is a HIGH severity finding.
//
// Detection-only → ExceptionQueue + alert. No auto-action.
// ----------------------------------------------------------------------------

async function detectM19OrderPaidPaymentRefunded(traceId: string): Promise<StateInvariantFinding[]> {
  const findings: StateInvariantFinding[] = []

  const paidOrdersWithRefundedPayment = await db.order.findMany({
    where: {
      status: 'PAID',
      payment: { status: 'REFUNDED' },
    },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      userId: true,
      updatedAt: true,
      payment: {
        select: {
          id: true,
          status: true,
          amount: true,
        },
      },
    },
  })

  for (const order of paidOrdersWithRefundedPayment) {
    const payment = order.payment
    if (!payment) continue

    const finding: StateInvariantFinding = {
      mismatchClass: 'M19_ORDER_PAID_PAYMENT_REFUNDED',
      severity: 'HIGH',
      invariantCode: 'I-02', // Order Integrity
      entityType: 'Order',
      entityId: order.id,
      description: `Order ${order.id} is PAID but Payment ${payment.id} is REFUNDED — order state inconsistent with money state.`,
      stateSnapshot: {
        orderId: order.id,
        orderStatus: order.status,
        orderTotalAmount: order.totalAmount,
        paymentId: payment.id,
        paymentStatus: payment.status,
        paymentAmount: payment.amount,
        detectedAt: new Date().toISOString(),
      },
      // No forceFreezeLevel — let determineFreezeLevel() default to Level 1
      // (transaction freeze) per Q18 policy for non-money-state violations.
    }
    findings.push(finding)

    try {
      await reportInvariantViolation({
        invariant: 'I-02',
        entityType: 'Order',
        entityId: order.id,
        description: finding.description,
        stateSnapshot: finding.stateSnapshot,
        traceId,
      })
    } catch (err) {
      logError(
        'm19-report-invariant-violation-failed',
        { orderId: order.id, error: (err as Error).message },
        traceId,
      )
    }

    fireAlert('inconsistent-combo', {
      mismatchClass: finding.mismatchClass,
      severity: finding.severity,
      invariant: finding.invariantCode,
      orderId: order.id,
      paymentId: payment.id,
      traceId,
    })

    logWarn(
      'm19-inconsistent-combo-detected',
      {
        mismatchClass: finding.mismatchClass,
        orderId: order.id,
        paymentId: payment.id,
        paymentStatus: payment.status,
      },
      traceId,
    )
  }

  return findings
}

// ----------------------------------------------------------------------------
// M20 — Fulfilment PICKED_UP + Payment NOT CAPTURED (I-08 Fulfilment Integrity)
// ----------------------------------------------------------------------------
// When a Fulfilment is PICKED_UP but its Payment is NOT in CAPTURED status,
// the customer received their order without a valid captured payment. Per I-08
// (Fulfilment Integrity — additive, parallel machine), this is a CRITICAL
// finding.
//
// Detection-only → ExceptionQueue + alert. No auto-action (P0-06 Wave-6 boundary
// — auto-capture is a separate Orchestrator directive, NOT part of state
// separation).
// ----------------------------------------------------------------------------

async function detectM20FulfilmentPickedUpPaymentNotCaptured(
  traceId: string,
): Promise<StateInvariantFinding[]> {
  const findings: StateInvariantFinding[] = []

  // Find Fulfilment rows in PICKED_UP status whose Order's Payment is NOT CAPTURED.
  // (1:1 Fulfilment → Order → Payment.)
  const pickedUpFulfilments = await db.fulfilment.findMany({
    where: { status: 'PICKED_UP' },
    select: {
      id: true,
      orderId: true,
      status: true,
      version: true,
      pickupVerifiedAt: true,
      updatedAt: true,
      order: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              frozen: true,
            },
          },
        },
      },
    },
  })

  for (const f of pickedUpFulfilments) {
    const payment = f.order?.payment
    // Missing Payment OR Payment status !== 'CAPTURED' → finding.
    if (payment && payment.status === 'CAPTURED') continue

    const finding: StateInvariantFinding = {
      mismatchClass: 'M20_FULFILMENT_PICKED_UP_PAYMENT_NOT_CAPTURED',
      severity: 'CRITICAL',
      invariantCode: 'I-08', // Fulfilment Integrity (P0-06 additive)
      entityType: 'Fulfilment',
      entityId: f.id,
      description: payment
        ? `Fulfilment ${f.id} is PICKED_UP but Payment ${payment.id} status is ${payment.status} (not CAPTURED). Customer received order without captured payment.`
        : `Fulfilment ${f.id} is PICKED_UP but Order ${f.orderId} has no Payment. Customer received order without payment.`,
      stateSnapshot: {
        fulfilmentId: f.id,
        fulfilmentStatus: f.status,
        fulfilmentVersion: f.version,
        orderId: f.orderId,
        orderStatus: f.order?.status,
        orderTotalAmount: f.order?.totalAmount,
        paymentId: payment?.id ?? null,
        paymentStatus: payment?.status ?? 'MISSING',
        paymentAmount: payment?.amount ?? null,
        paymentFrozen: payment?.frozen ?? null,
        detectedAt: new Date().toISOString(),
      },
      // I-08 — money-state-adjacent → default Level 1 freeze. The Q18 escalation
      // policy reserves Level 3 for I-01/I-04 only. We do NOT force Level 3 here.
    }
    findings.push(finding)

    try {
      await reportInvariantViolation({
        invariant: 'I-08',
        entityType: 'Fulfilment',
        entityId: f.id,
        description: finding.description,
        stateSnapshot: finding.stateSnapshot,
        traceId,
      })
    } catch (err) {
      logError(
        'm20-report-invariant-violation-failed',
        { fulfilmentId: f.id, error: (err as Error).message },
        traceId,
      )
    }

    fireAlert('inconsistent-combo', {
      mismatchClass: finding.mismatchClass,
      severity: finding.severity,
      invariant: finding.invariantCode,
      fulfilmentId: f.id,
      orderId: f.orderId,
      paymentId: payment?.id ?? null,
      paymentStatus: payment?.status ?? 'MISSING',
      traceId,
    })

    logWarn(
      'm20-inconsistent-combo-detected',
      {
        mismatchClass: finding.mismatchClass,
        fulfilmentId: f.id,
        orderId: f.orderId,
        paymentId: payment?.id ?? null,
        paymentStatus: payment?.status ?? 'MISSING',
      },
      traceId,
    )
  }

  return findings
}

// ----------------------------------------------------------------------------
// M21 — Order FROZEN + no unresolved ExceptionQueue (stale freeze)
// ----------------------------------------------------------------------------
// When an Order is FROZEN but has no unresolved ExceptionQueue entry, the freeze
// is "stale" — there's no longer a reason for it. This is a MEDIUM finding
// (operational, not money-state).
//
// Detection-only → alert. No ExceptionQueue routing (no invariant violation —
// this is a hygiene/operational finding).
// ----------------------------------------------------------------------------

async function detectM21OrderFrozenStale(traceId: string): Promise<StateInvariantFinding[]> {
  const findings: StateInvariantFinding[] = []

  // Find FROZEN orders that have no unresolved ExceptionQueue entries.
  const frozenOrders = await db.order.findMany({
    where: { status: 'FROZEN' },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      userId: true,
      restaurantId: true,
      updatedAt: true,
    },
  })

  for (const order of frozenOrders) {
    // Check if there's any unresolved ExceptionQueue entry for this order.
    const unresolvedCount = await db.exceptionQueue.count({
      where: {
        entityType: 'Order',
        entityId: order.id,
        resolvedAt: null,
      },
    })

    if (unresolvedCount > 0) {
      // Not stale — has a reason to be frozen.
      continue
    }

    const finding: StateInvariantFinding = {
      mismatchClass: 'M21_ORDER_FROZEN_STALE',
      severity: 'MEDIUM',
      invariantCode: 'I-09', // Operational hygiene (additive — P0-06)
      entityType: 'Order',
      entityId: order.id,
      description: `Order ${order.id} is FROZEN but has no unresolved ExceptionQueue entries. The freeze may be stale — admin review recommended.`,
      stateSnapshot: {
        orderId: order.id,
        orderStatus: order.status,
        orderTotalAmount: order.totalAmount,
        orderUpdatedAt: order.updatedAt,
        unresolvedExceptionCount: unresolvedCount,
        detectedAt: new Date().toISOString(),
      },
      // No freeze — already frozen. No ExceptionQueue routing (no violation).
    }
    findings.push(finding)

    // M21 is operational — no ExceptionQueue routing (no invariant violation).
    // Fire alert only.
    fireAlert('inconsistent-combo', {
      mismatchClass: finding.mismatchClass,
      severity: finding.severity,
      invariant: finding.invariantCode,
      orderId: order.id,
      orderStatus: order.status,
      traceId,
    })

    logInfo(
      'm21-stale-frozen-detected',
      {
        mismatchClass: finding.mismatchClass,
        orderId: order.id,
        orderUpdatedAt: order.updatedAt,
      },
      traceId,
    )
  }

  return findings
}

// ----------------------------------------------------------------------------
// Orchestrator — run all 4 detectors
// ----------------------------------------------------------------------------

/**
 * Run all 4 state-invariant detectors (M18-M21).
 *
 * @param trigger — 'cron' | 'manual' | 'evidence'
 * @returns StateInvariantCheckResult — findings + m18AutoRefundsTriggered count
 *
 * SAFETY: This function does NOT consult the invariantChecker feature flag.
 * The mini-service caller is responsible for gating cron polling on
 * isStateInvariantCheckerEnabled(). Manual POST /trigger can run detectors
 * regardless of flag state (useful for evidence collection / ad-hoc runs).
 *
 * The M18 auto-refund action IS internally gated by isM18AutoRefundPermitted()
 * (flag + env var) — so a manual run on a flag-OFF deployment will detect +
 * report + alert, but will NOT auto-refund.
 */
export async function runStateInvariantCheck(
  trigger: 'cron' | 'manual' | 'evidence' = 'cron',
): Promise<StateInvariantCheckResult> {
  const traceId = newTraceId()
  const startedAt = new Date()

  logInfo('state-invariant-check-start', { trigger, flagEnabled: isStateInvariantCheckerEnabled() }, traceId)

  let allFindings: StateInvariantFinding[] = []
  let m18AutoRefundsTriggered = 0
  let m18AutoRefundErrors = 0

  try {
    // M18 — must run first (auto-refund mutates Payment; subsequent detectors
    // would otherwise see a stale CAPTURED status and double-report).
    const m18 = await detectM18OrderCancelledPaymentCaptured(traceId)
    allFindings = allFindings.concat(m18.findings)
    m18AutoRefundsTriggered = m18.autoRefundsTriggered
    m18AutoRefundErrors = m18.autoRefundErrors

    // M19
    const m19 = await detectM19OrderPaidPaymentRefunded(traceId)
    allFindings = allFindings.concat(m19)

    // M20
    const m20 = await detectM20FulfilmentPickedUpPaymentNotCaptured(traceId)
    allFindings = allFindings.concat(m20)

    // M21
    const m21 = await detectM21OrderFrozenStale(traceId)
    allFindings = allFindings.concat(m21)

    const completedAt = new Date()
    logInfo(
      'state-invariant-check-complete',
      {
        trigger,
        findingsCount: allFindings.length,
        m18AutoRefundsTriggered,
        m18AutoRefundErrors,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      traceId,
    )

    return {
      findings: allFindings,
      m18AutoRefundsTriggered,
      m18AutoRefundErrors,
      startedAt,
      completedAt,
      trigger,
    }
  } catch (err) {
    const completedAt = new Date()
    logError(
      'state-invariant-check-error',
      { trigger, error: (err as Error).message, findingsSoFar: allFindings.length },
      traceId,
    )
    return {
      findings: allFindings,
      m18AutoRefundsTriggered,
      m18AutoRefundErrors,
      startedAt,
      completedAt,
      trigger,
    }
  }
}
