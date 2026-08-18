// P0-27 — Deployment & rollback (3 deployment classes)
// Control/Enabler (preserves operability, not a business truth).
//
// Feature flags gate new code paths. In dev: env-based. In production: would use
// LaunchDarkly or similar. The 3 deployment classes (backward-compatible /
// expand-migrate-contract / breaking) are documented in matrix P0-27 detailed breakdown.

// Feature flag interface.
export type FeatureFlag = {
  key: string
  enabled: boolean
  description: string
}

// Env-based feature flags (dev). Production: LaunchDarkly or similar.
function getFlag(key: string, defaultValue: boolean): boolean {
  const envKey = `FEATURE_${key.toUpperCase().replace(/-/g, '_')}`
  const envVal = process.env[envKey]
  if (envVal === 'true') return true
  if (envVal === 'false') return false
  return defaultValue
}

// Defined feature flags. New features default to OFF and are gated until tested.
export const FEATURE_FLAGS = {
  // Payment (P0-01 — Wave-3a S5 PASS / CLOSED)
  realPayments: { key: 'real-payments', enabled: getFlag('real-payments', false), description: 'Enable real Razorpay payments (vs demo)' },

  // Pickup attribution enforcement (P0-07 — not yet implemented)
  pickupAttributionEnforcement: { key: 'pickup-attribution-enforcement', enabled: getFlag('pickup-attribution-enforcement', false), description: 'Enforce QR+OTP pickup attribution (P0-07 8 conditions)' },

  // DR drill (P0-26 — not yet implemented)
  drDrillMode: { key: 'dr-drill-mode', enabled: getFlag('dr-drill-mode', false), description: 'Run in DR drill mode (simulates restore)' },

  // Outbox publisher (P0-24 — Wave-2b S5 PASS)
  outboxPublisher: { key: 'outbox-publisher', enabled: getFlag('outbox-publisher', false), description: 'Enable outbox event publisher worker' },

  // Concurrency control (P0-25 — Wave-1 S5 PASS)
  concurrencyControl: { key: 'concurrency-control', enabled: getFlag('concurrency-control', false), description: 'Enable optimistic locking on critical writes' },

  // Sub-Wave 3c: Request hash enforcement (default OFF — backward-compatible)
  // When OFF: IdempotencyKey.requestHash is computed + stored, but NOT enforced
  //           (null-hash records + non-null-hash records both return cached response).
  // When ON:  If stored requestHash is non-null AND differs from incoming hash,
  //           throw IdempotencyKeyReuseError (HTTP 422).
  // Production enablement requires separate Orchestrator authorization.
  requestHashEnforcement: { key: 'request-hash-enforcement', enabled: getFlag('request-hash-enforcement', false), description: 'Enforce request body hash match on idempotency key reuse (422 on mismatch)' },

  // Sub-Wave 4a: Webhook handler (default OFF — feature-flagged for safe rollout)
  // When OFF: POST /api/webhooks/razorpay returns 503 (handler not enabled).
  // When ON:  Handler processes incoming Razorpay webhooks (HMAC verify + dedup + idempotent processing).
  // Production enablement requires separate Orchestrator authorization.
  webhookHandler: { key: 'webhook-handler', enabled: getFlag('webhook-handler', false), description: 'Enable Razorpay webhook handler endpoint (P0-05)' },

  // Sub-Wave 5C: Reconciliation auto-repair (default OFF — narrowly scoped)
  // When OFF: ReconciliationFinding rows are created for detected mismatches, but NO
  //           remediation/repair action is attempted. Findings are escalated to
  //           ExceptionQueue for CRITICAL/HIGH severity (existing 5B behavior).
  // When ON:  ONLY M16 (outbox lag — operational, non-financial) remediation is active.
  //           M16 remediation triggers the outbox publisher's /trigger endpoint (operational
  //           restart) — it does NOT mutate any money-state table (Payment, Refund,
  //           LedgerEntry, Outbox, WebhookEvent, IdempotencyKey, AuditLog).
  //           M3/M9/M10 (CLASS C — status mutation) are NOT authorized by this flag;
  //           they require separate Orchestrator authorization.
  //           CLASS B/D/E mismatches are NEVER automatically repaired (regardless of flag).
  // Production enablement requires separate Orchestrator authorization.
  reconciliationAutoRepair: { key: 'reconciliation-auto-repair', enabled: getFlag('reconciliation-auto-repair', false), description: 'Enable M16-only reconciliation auto-repair (operational, non-financial)' },

  // P0-06 Wave-6: State-invariant checker (default OFF — additive, parallel detector)
  // When OFF: The invariant-checker mini-service starts but does NOT run M18-M21
  //           detectors. The state-invariants library functions are still callable
  //           (e.g., via manual POST /trigger on the mini-service) but the cron
  //           poll loop is inert. The P0-28 invariant-checker pathway remains
  //           unchanged (existing reportInvariantViolation() callers — routes,
  //           reconciliation 5B detectors — continue to work independently).
  // When ON:  The mini-service's setInterval poll runs runStateInvariantCheck()
  //           on a 1-hour cadence (configurable via INVARIANT_CHECKER_POLL_INTERVAL_MS).
  //           M18 (Order CANCELLED + Payment CAPTURED → auto-refund) — the only
  //           detector that performs an automatic action — reuses the existing
  //           refund route via HTTP fetch (NO new financial mutation logic).
  //           M19/M20/M21 are detection-only → ExceptionQueue + alert.
  // Production enablement requires separate Orchestrator authorization.
  invariantChecker: { key: 'invariant-checker', enabled: getFlag('invariant-checker', false), description: 'Enable P0-06 state-invariant checker (M18-M21 detectors — M18 auto-refund reuses existing refund route)' },
} as const

export function isFeatureEnabled(key: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[key].enabled
}

// Deployment class classifier (per P0-27 3-class model).
export type DeploymentClass = 'backward-compatible' | 'expand-migrate-contract' | 'breaking'

export function classifyDeployment(changes: {
  schemaBreaking?: boolean
  apiBreaking?: boolean
  hasMigration?: boolean
}): DeploymentClass {
  if (changes.schemaBreaking || changes.apiBreaking) {
    return 'breaking'
  }
  if (changes.hasMigration) {
    return 'expand-migrate-contract'
  }
  return 'backward-compatible'
}

// Rollback procedure per class.
export function getRollbackProcedure(cls: DeploymentClass): {
  maxRollbackTime: string
  procedure: string
  safeByDefault: boolean
} {
  switch (cls) {
    case 'backward-compatible':
      return {
        maxRollbackTime: '10 min',
        procedure: 'Traffic rollback to previous version. No DB rollback needed.',
        safeByDefault: true,
      }
    case 'expand-migrate-contract':
      return {
        maxRollbackTime: '15 min',
        procedure: 'Rollback to previous migration phase. Schema remains compatible.',
        safeByDefault: true,
      }
    case 'breaking':
      return {
        maxRollbackTime: 'variable',
        procedure: 'Forward-fix only. DB rollback may be unsafe. Requires explicit sign-off.',
        safeByDefault: false,
      }
  }
}
