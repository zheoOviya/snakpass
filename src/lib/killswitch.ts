import { db } from './db'

// P0-23 — Kill switch fail-safe behaviour
// Kill switch defaults to safe state on failure; toggles audited.
// Direct Protector of I-09 (Kill-Switch Monotonicity).
// Acceptance: kill switch defaults to safe state on failure; toggles audited.

// "Safe default" semantics per kill-switch key:
// - ordering: safe = OFF (ordering allowed). On failure, default to safe = allow ordering.
//   Rationale: if kill-switch store is down, blocking all orders is more harmful than
//   allowing them (revenue loss). The kill switch is an emergency brake, not a gate.
//   EXCEPTION: if the failure is detected during a known-attack scenario, admin can
//   manually trigger a code-level kill (separate mechanism).
// - payments: safe = OFF (payments allowed). Same rationale.
// - catering: safe = OFF.
// - new_vendors: safe = ON (block new vendor signups). Conservative — safer to pause onboarding.
// - wallet_cashback: safe = ON (suspend cashback). Conservative.
const SAFE_DEFAULTS: Record<string, boolean> = {
  ordering: false, // allow ordering on failure
  payments: false, // allow payments on failure
  catering: false, // allow catering on failure
  new_vendors: true, // block new vendors on failure (conservative)
  wallet_cashback: true, // suspend cashback on failure (conservative)
}

export function getSafeDefault(key: string): boolean {
  return SAFE_DEFAULTS[key] ?? true // unknown switches default to ON (conservative)
}

// Read a kill switch with fail-safe fallback.
// If the DB query fails, return the safe default for that key.
export async function getKillSwitchState(key: string): Promise<{ key: string; enabled: boolean; source: 'db' | 'safe-default' }> {
  try {
    const ks = await db.killSwitch.findUnique({ where: { key } })
    if (ks) {
      return { key, enabled: ks.enabled, source: 'db' }
    }
    // Key doesn't exist in DB — use safe default.
    return { key, enabled: getSafeDefault(key), source: 'safe-default' }
  } catch {
    // DB query failed — use safe default.
    return { key, enabled: getSafeDefault(key), source: 'safe-default' }
  }
}

// Check if a kill switch is active (enabled). Fail-safe: on DB error, returns safe default.
export async function isKillSwitchActive(key: string): Promise<boolean> {
  const state = await getKillSwitchState(key)
  return state.enabled
}

// Batch check multiple kill switches (for order creation which checks ordering + catering).
export async function checkKillSwitches(keys: string[]): Promise<Record<string, { enabled: boolean; source: string }>> {
  const results: Record<string, { enabled: boolean; source: string }> = {}
  for (const key of keys) {
    const state = await getKillSwitchState(key)
    results[key] = { enabled: state.enabled, source: state.source }
  }
  return results
}
