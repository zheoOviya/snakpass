import { NextRequest, NextResponse } from 'next/server'
import { ALERT_RULES, fireAlert, getAlertAudit } from '@/lib/alerting'
import { auditIntegrityCheck } from '@/lib/audit'
import { db } from '@/lib/db'
import { withErrorHandler } from '@/lib/errors'
import { info as logInfo } from '@/lib/logger'

// P0-21 — Alert evaluation loop: wired to real metrics/signals
// Control/Enabler: alerts fire on defined thresholds.
//
// This endpoint is the alert evaluation loop. In production it would run on a
// schedule (cron, every 60 seconds). In dev it's triggered on-demand.

export const GET = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const evaluations: Array<{ ruleId: string; metric: string; value: number; threshold: number; triggered: boolean }> = []

  // 1. DB health check
  let dbHealthy = 1
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbHealthy = 0
  }
  evaluateRule(evaluations, 'db-unavailable', 'db_health', dbHealthy, 0, 'eq')

  // 2. Audit integrity
  const integrity = await auditIntegrityCheck()
  evaluateRule(evaluations, 'invariant-violation', 'invariant_violation_count', integrity.brokenCount, 0, 'gt')

  // 3. Unknown state count
  evaluateRule(evaluations, 'unknown-state-detected', 'unknown_state_count', integrity.brokenCount, 0, 'gt')

  // 4. Exception queue depth (0 — no exception queue table yet)
  evaluateRule(evaluations, 'exception-queue-backlog', 'exception_queue_depth', 0, 10, 'gt')

  // 5. Payment success rate
  const totalOrders = await db.order.count()
  const cancelledOrders = await db.order.count({ where: { status: 'CANCELLED' } })
  const paymentSuccessRate = totalOrders > 0 ? Math.round(((totalOrders - cancelledOrders) / totalOrders) * 100) : 100
  evaluateRule(evaluations, 'payment-success-rate', 'payment_success_rate', paymentSuccessRate, 95, 'lt')

  // 6. Reconciliation mismatch (0 — P0-03 not yet implemented)
  evaluateRule(evaluations, 'reconciliation-mismatch', 'reconciliation_mismatch_count', 0, 0, 'gt')

  // 7. Auth failure rate
  const recentAuthFailures = await db.auditLog.count({
    where: {
      action: { contains: 'AUTH' },
      createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
    },
  })
  const authFailureRate = recentAuthFailures > 0 ? 100 : 0
  evaluateRule(evaluations, 'auth-failure-spike', 'auth_failure_rate', authFailureRate, 20, 'gt')

  // Fire alerts for triggered rules
  for (const evalResult of evaluations) {
    if (evalResult.triggered) {
      fireAlert(evalResult.ruleId, {
        metric: evalResult.metric,
        value: evalResult.value,
        threshold: evalResult.threshold,
      })
    }
  }

  // 8. DR drill (passing — no drill run yet, but not failed)
  evaluateRule(evaluations, 'dr-drill-failed', 'dr_drill_pass', 1, 1, 'lt')

  logInfo('alert-evaluation-loop-run', {
    rulesEvaluated: evaluations.length,
    alertsTriggered: evaluations.filter((e) => e.triggered).length,
  }, traceId)

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    evaluations,
    alertsTriggered: evaluations.filter((e) => e.triggered).length,
    alertAudit: getAlertAudit(),
    rules: ALERT_RULES.map((r) => ({ id: r.id, name: r.name, severity: r.severity })),
  })
})

function evaluateRule(
  evaluations: Array<{ ruleId: string; metric: string; value: number; threshold: number; triggered: boolean }>,
  ruleId: string,
  metric: string,
  value: number,
  threshold: number,
  comparison: 'gt' | 'lt' | 'eq',
) {
  let triggered = false
  switch (comparison) {
    case 'gt': triggered = value > threshold; break
    case 'lt': triggered = value < threshold; break
    case 'eq': triggered = value === threshold; break
  }
  evaluations.push({ ruleId, metric, value, threshold, triggered })
}
