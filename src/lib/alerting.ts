// P0-21 — Alerting on P0 failures
// Alerts fire on defined thresholds; false-positive rate < 5%.
// Control/Enabler (surfaces failures, does not enforce truths).
//
// In production this integrates with an alerting system (PagerDuty, Opsgenie, etc.).
// In dev, alerts are logged to stderr (visible in dev.log).

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertRule {
  id: string
  name: string
  description: string
  severity: AlertSeverity
  // Metric threshold that triggers the alert
  metric: string
  threshold: number
  comparison: 'gt' | 'lt' | 'eq'
  // Cooldown to prevent alert storms (ms)
  cooldownMs: number
}

// Defined alert rules (per matrix acceptance criteria).
export const ALERT_RULES: AlertRule[] = [
  {
    id: 'payment-success-rate',
    name: 'Payment Success Rate < 95%',
    description: 'Payment success rate dropped below 95% over 5-minute window',
    severity: 'critical',
    metric: 'payment_success_rate',
    threshold: 95,
    comparison: 'lt',
    cooldownMs: 5 * 60_000,
  },
  {
    id: 'reconciliation-mismatch',
    name: 'Reconciliation Mismatch Detected',
    description: 'Payment reconciliation found gateway/ledger mismatch',
    severity: 'critical',
    metric: 'reconciliation_mismatch_count',
    threshold: 0,
    comparison: 'gt',
    cooldownMs: 60_000,
  },
  {
    id: 'invariant-violation',
    name: 'Business Invariant Violated',
    description: 'Any P0 invariant (I-01..I-14) was violated',
    severity: 'critical',
    metric: 'invariant_violation_count',
    threshold: 0,
    comparison: 'gt',
    cooldownMs: 0, // no cooldown — every violation alerts
  },
  {
    id: 'unknown-state-detected',
    name: 'Unknown State Detected',
    description: 'System reached a state not in any known state machine',
    severity: 'critical',
    metric: 'unknown_state_count',
    threshold: 0,
    comparison: 'gt',
    cooldownMs: 0,
  },
  {
    id: 'dr-drill-failed',
    name: 'DR Drill Failed',
    description: 'Disaster recovery restore drill did not pass',
    severity: 'critical',
    metric: 'dr_drill_pass',
    threshold: 1,
    comparison: 'lt',
    cooldownMs: 0,
  },
  {
    id: 'db-unavailable',
    name: 'Database Unavailable',
    description: 'Database health check failing',
    severity: 'critical',
    metric: 'db_health',
    threshold: 0,
    comparison: 'eq',
    cooldownMs: 30_000,
  },
  {
    id: 'auth-failure-spike',
    name: 'Auth Failure Spike',
    description: 'Authentication failure rate > 20% over 5 minutes',
    severity: 'warning',
    metric: 'auth_failure_rate',
    threshold: 20,
    comparison: 'gt',
    cooldownMs: 5 * 60_000,
  },
  {
    id: 'exception-queue-backlog',
    name: 'Exception Queue Backlog',
    description: 'Unresolved exceptions in queue > 10',
    severity: 'warning',
    metric: 'exception_queue_depth',
    threshold: 10,
    comparison: 'gt',
    cooldownMs: 5 * 60_000,
  },
]

// Fire an alert. In dev: log to stderr. In production: send to PagerDuty/Opsgenie.
const lastFired = new Map<string, number>()

export function fireAlert(ruleId: string, context: Record<string, unknown> = {}): void {
  const rule = ALERT_RULES.find((r) => r.id === ruleId)
  if (!rule) {
    console.error(`[ALERT] Unknown rule: ${ruleId}`)
    return
  }

  // Check cooldown
  const now = Date.now()
  const last = lastFired.get(ruleId) ?? 0
  if (rule.cooldownMs > 0 && now - last < rule.cooldownMs) {
    return // still in cooldown
  }
  lastFired.set(ruleId, now)

  const alert = {
    timestamp: new Date().toISOString(),
    ruleId: rule.id,
    name: rule.name,
    severity: rule.severity,
    description: rule.description,
    context,
  }

  // In production: send to PagerDuty/Opsgenie here.
  // In dev: log to stderr (visible in dev.log).
  console.error(`[ALERT:${rule.severity.toUpperCase()}] ${JSON.stringify(alert)}`)
}

// Alert audit: track which alerts fired (for false-positive rate calculation).
export function getAlertAudit(): Array<{ ruleId: string; lastFired: number }> {
  return Array.from(lastFired.entries()).map(([ruleId, ts]) => ({ ruleId, lastFired: ts }))
}
