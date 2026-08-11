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
  // Payment (P0-01 — not yet implemented; flag for when it is)
  realPayments: { key: 'real-payments', enabled: getFlag('real-payments', false), description: 'Enable real Razorpay payments (vs demo)' },

  // Pickup attribution enforcement (P0-07 — not yet implemented)
  pickupAttributionEnforcement: { key: 'pickup-attribution-enforcement', enabled: getFlag('pickup-attribution-enforcement', false), description: 'Enforce QR+OTP pickup attribution (P0-07 8 conditions)' },

  // DR drill (P0-26 — not yet implemented)
  drDrillMode: { key: 'dr-drill-mode', enabled: getFlag('dr-drill-mode', false), description: 'Run in DR drill mode (simulates restore)' },

  // Outbox publisher (P0-24 — not yet implemented)
  outboxPublisher: { key: 'outbox-publisher', enabled: getFlag('outbox-publisher', false), description: 'Enable outbox event publisher worker' },

  // Concurrency control (P0-25 — not yet implemented)
  concurrencyControl: { key: 'concurrency-control', enabled: getFlag('concurrency-control', false), description: 'Enable optimistic locking on critical writes' },
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
