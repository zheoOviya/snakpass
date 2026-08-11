import { db } from './db'
import { audit } from './audit'
import { warn as logWarn, info as logInfo } from './logger'

// P0-23 — Kill switch fail-safe behaviour
// Direct Protector of I-09 (Kill-Switch Monotonicity).
// Acceptance: kill switch defaults to SAFE state on failure; toggles audited.
//
// GOVERNANCE DECISION (P0-23 re-verification):
// The previous design used per-key fail-open/fail-closed semantics (ordering
// failed-open for "revenue protection", new_vendors failed-closed). This is
// incompatible with the P0-23 PASS criterion:
//   "kill-switch state unavailable होने पर system fail-open नहीं करता।"
// When the kill-switch store is unavailable, we have NO reliable signal of the
// intended state — the conservative, governance-correct choice is to fail CLOSED
// for every protected operation. A false "active" verdict only causes a
// temporary service outage; a false "inactive" verdict lets unsafe operations
// through silently. The asymmetry favours fail-closed.
//
// Safe default for ALL keys: enabled = true (block the protected operation).
// This is logged + audited so operators can observe fail-safe events and
// distinguish them from intentional toggles.

const SAFE_DEFAULT_ENABLED = true // fail-closed for every key

export function getSafeDefault(_key: string): boolean {
  // All unknown + known switches default to ENABLED (fail-closed) when the
  // kill-switch store cannot be read.
  return SAFE_DEFAULT_ENABLED
}

// Testability hook: a `globalThis`-stored flag (toggled via /api/p0-23-test)
// to simulate DB-read failure at runtime WITHOUT being reset by Next.js dev
// server hot-reloads. Module-level `let` variables are re-initialised on every
// module re-evaluation; `globalThis` survives because it lives on the global
// object, not the module scope. This is the same pattern Prisma uses
// (globalForPrisma in src/lib/db.ts) to keep its client alive across reloads.
//
// In production, this flag is never set; real DB errors trigger the same path
// via the try/catch below.
const globalForKillSwitch = globalThis as unknown as {
  __p0_23_simulate_db_failure?: boolean
}

/** @internal Toggle the simulated DB-failure flag (P0-23 test fixture only). */
export function _setSimulateDbFailure(value: boolean): void {
  globalForKillSwitch.__p0_23_simulate_db_failure = value
}

/** @internal Read the simulated DB-failure flag. */
export function _getSimulateDbFailure(): boolean {
  return !!globalForKillSwitch.__p0_23_simulate_db_failure
}

// Read a kill switch with fail-safe fallback.
// On DB query failure OR missing row, returns the safe default (fail-closed)
// AND emits a structured warn log + an audit entry so the fail-safe event is
// observable in the P0-22 audit chain.
//
// Testability hook: set env var `KILLSWITCH_DB_SIMULATE_FAILURE=1` OR call
// `_setSimulateDbFailure(true)` to force the DB-read path to throw — used by
// the P0-23 fail-safe test fixture to prove the system does NOT fail-open on
// dependency failure. This hook is for testing only; it has no production
// effect when the flag/env var is unset.
export async function getKillSwitchState(
  key: string,
  traceId?: string,
): Promise<{ key: string; enabled: boolean; source: 'db' | 'safe-default'; reason?: string }> {
  // P0-23 test hook: simulate DB read failure at runtime.
  if (_getSimulateDbFailure() || process.env.KILLSWITCH_DB_SIMULATE_FAILURE === '1') {
    const simulatedError = new Error('simulated: kill-switch store unreachable (P0-23 fail-safe test)')
    const reason = 'db-read-error'
    await emitFailSafeEvent(key, reason, traceId, simulatedError.message)
    return { key, enabled: getSafeDefault(key), source: 'safe-default', reason }
  }
  try {
    const ks = await db.killSwitch.findUnique({ where: { key } })
    if (ks) {
      return { key, enabled: ks.enabled, source: 'db' }
    }
    // Row missing — fail-closed.
    const reason = 'row-missing'
    await emitFailSafeEvent(key, reason, traceId)
    return { key, enabled: getSafeDefault(key), source: 'safe-default', reason }
  } catch (err) {
    // DB query failed — fail-closed.
    const reason = 'db-read-error'
    await emitFailSafeEvent(key, reason, traceId, (err as Error)?.message)
    return { key, enabled: getSafeDefault(key), source: 'safe-default', reason }
  }
}

// Check if a kill switch is active (enabled). Fail-closed on DB error.
export async function isKillSwitchActive(key: string, traceId?: string): Promise<boolean> {
  const state = await getKillSwitchState(key, traceId)
  return state.enabled
}

// Batch check multiple kill switches (for order creation which checks
// ordering + catering). Returns each switch's state + source.
export async function checkKillSwitches(
  keys: string[],
  traceId?: string,
): Promise<Record<string, { enabled: boolean; source: string; reason?: string }>> {
  const results: Record<string, { enabled: boolean; source: string; reason?: string }> = {}
  for (const key of keys) {
    const state = await getKillSwitchState(key, traceId)
    results[key] = { enabled: state.enabled, source: state.source, reason: state.reason }
  }
  return results
}

// Emit a structured warn log + audit entry when the fail-safe default is used.
// This makes "fail-closed" events OBSERVABLE in the audit chain (P0-22) and in
// the structured log stream (P0-19) so operators can detect dependency failures.
async function emitFailSafeEvent(
  key: string,
  reason: 'row-missing' | 'db-read-error',
  traceId?: string,
  errorMessage?: string,
): Promise<void> {
  logWarn('kill-switch.failsafe-engaged', {
    key,
    reason,
    safeDefault: SAFE_DEFAULT_ENABLED,
    errorMessage,
  }, traceId)

  // Audit the fail-safe event so it appears in the P0-22 audit chain.
  // Audit failures must NOT propagate (we're already in a fail-safe path).
  try {
    await audit(
      'KILL_SWITCH_FAILSAFE_ENGAGED',
      {
        key,
        reason,
        safeDefault: SAFE_DEFAULT_ENABLED,
        traceId,
        errorMessage: errorMessage ?? null,
        timestamp: new Date().toISOString(),
      },
      undefined,
      'SYSTEM',
    )
    logInfo('kill-switch.failsafe-audited', { key, reason }, traceId)
  } catch (auditErr) {
    // If audit itself fails (e.g. DB completely down), we still proceed with
    // the fail-closed return — safety over audit completeness.
    logWarn('kill-switch.failsafe-audit-failed', {
      key,
      reason,
      auditError: (auditErr as Error)?.message,
    }, traceId)
  }
}
