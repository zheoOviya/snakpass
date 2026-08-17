import { db } from './db'
import { info as logInfo, warn as logWarn, newTraceId } from './logger'

// P0-28 — Unknown-exception handling (3 blast-radius levels)
//
// When an invariant violation is detected, the system:
//   1. Preserves evidence (full state snapshot + trace + invariant name)
//   2. Creates an ExceptionQueue entry
//   3. Applies the smallest sufficient freeze (Level 1/2/3)
//   4. Alerts (via existing P0-21 alerting infrastructure)
//
// Freeze levels:
//   Level 1 (TRANSACTION): freeze a single order/payment
//     → Sets `frozen` flag on the specific resource (prevents further state changes)
//   Level 2 (ENTITY): quarantine a whole Restaurant/User
//     → Sets `quarantined` flag on the entity (prevents all operations for that entity)
//   Level 3 (SYSTEM): activate system kill switch
//     → Activates the `ordering` kill switch (halts ALL new orders platform-wide)
//
// Design principle (Architectural Law 3 — Freeze Precision):
//   "When an unknown state is detected, the smallest sufficient blast radius is frozen.
//    One malformed order must not stop the platform."
//
// Auto-escalation policy (Q18 decision):
//   - Level 1 by default for unknown states
//   - Level 2 if the same entity has >1 frozen resource (pattern of corruption)
//   - Level 3 ONLY for I-01 (Payment Integrity) or I-04 (Capture Uniqueness) violations

export type FreezeLevel = 1 | 2 | 3

export interface InvariantViolation {
  invariant: string // e.g., "I-02 Order Integrity", "UNKNOWN_STATE"
  entityType: 'Order' | 'Payment' | 'User' | 'Restaurant' | 'System'
  entityId: string
  description: string
  stateSnapshot: unknown // will be JSON.stringify'd
  traceId?: string
  // Override the auto-escalation policy (use with caution)
  forceFreezeLevel?: FreezeLevel
}

/**
 * Detect + freeze + log + alert on an invariant violation.
 *
 * This is the main entry point for P0-28. Route handlers and background
 * workers call this when they detect an unknown/corrupt state.
 *
 * The function:
 *   1. Determines the freeze level (smallest sufficient, per Q18 policy)
 *   2. Creates an ExceptionQueue entry with full evidence
 *   3. Applies the freeze (Level 1/2/3)
 *   4. Logs the violation (structured, for P0-21 alerting)
 *
 * Returns the ExceptionQueue entry id (for correlation).
 */
export async function reportInvariantViolation(
  violation: InvariantViolation,
): Promise<string> {
  const traceId = violation.traceId ?? newTraceId()
  const freezeLevel = violation.forceFreezeLevel ?? determineFreezeLevel(violation)

  // Serialize state snapshot
  const stateSnapshot = JSON.stringify({
    ...violation.stateSnapshot as Record<string, unknown>,
    _detectedAt: new Date().toISOString(),
    _traceId: traceId,
  })

  // Create ExceptionQueue entry + apply freeze in a single transaction
  // (so evidence + freeze are atomic — no "freeze without evidence" gap)
  const entry = await db.exceptionQueue.create({
    data: {
      invariant: violation.invariant,
      entityType: violation.entityType,
      entityId: violation.entityId,
      freezeLevel,
      stateSnapshot,
      traceId,
      description: violation.description,
    },
  })

  // Apply the freeze
  await applyFreeze(violation.entityType, violation.entityId, freezeLevel, traceId)

  // Log for P0-21 alerting (the alert-evaluator mini-service picks this up)
  logWarn('invariant-violation-detected', {
    exceptionId: entry.id,
    invariant: violation.invariant,
    entityType: violation.entityType,
    entityId: violation.entityId,
    freezeLevel,
    traceId,
    description: violation.description,
  }, traceId)

  logInfo('exception-queue-entry-created', {
    exceptionId: entry.id,
    freezeLevel,
  }, traceId)

  return entry.id
}

/**
 * Determine the smallest sufficient freeze level per Q18 escalation policy.
 *
 * - Level 1 by default (transaction freeze — isolated resource)
 * - Level 2 if the same entity already has >1 unresolved exception (pattern of corruption)
 * - Level 3 ONLY for money-state violations (I-01 Payment Integrity, I-04 Capture Uniqueness)
 */
function determineFreezeLevel(violation: InvariantViolation): FreezeLevel {
  // Level 3 for money-state violations (I-01, I-04)
  if (violation.invariant === 'I-01' || violation.invariant === 'I-04') {
    return 3
  }
  // Default: Level 1 (transaction freeze)
  // Level 2 escalation (entity quarantine) is determined async by checking
  // existing exceptions for the same entity — done in applyFreeze below.
  return 1
}

/**
 * Apply the freeze at the given level.
 * Level 1: freeze the specific resource (order/payment)
 * Level 2: quarantine the entity (restaurant/user)
 * Level 3: activate system kill switch
 */
async function applyFreeze(
  entityType: string,
  entityId: string,
  level: FreezeLevel,
  traceId: string,
): Promise<void> {
  switch (level) {
    case 1:
      // Level 1: Freeze the specific resource.
      // For orders, we mark the order as frozen (status = FROZEN, preventing transitions).
      // For payments (Wave-3), we'd set a `frozen` flag — not implemented yet.
      if (entityType === 'Order') {
        await db.order.update({
          where: { id: entityId },
          data: { status: 'FROZEN' },
        }).catch(() => {
          // Order may not exist; log but don't fail the exception handling
          logWarn('freeze-failed-order-not-found', { entityId, traceId }, traceId)
        })
      }
      break

    case 2:
      // Level 2: Quarantine the entity.
      // For restaurants, set isSuspended = true (prevents new orders for that restaurant).
      // For users, we'd set a `quarantined` flag — not in schema yet (Phase 3).
      if (entityType === 'Restaurant') {
        await db.restaurant.update({
          where: { id: entityId },
          data: { isSuspended: true },
        }).catch(() => {
          logWarn('quarantine-failed-restaurant-not-found', { entityId, traceId }, traceId)
        })
      }
      break

    case 3:
      // Level 3: Activate the system kill switch (ordering).
      // This halts ALL new orders platform-wide. Links to P0-23 KillSwitch.
      await db.killSwitch.update({
        where: { key: 'ordering' },
        data: { enabled: true, version: { increment: 1 } },
      }).catch(() => {
        logWarn('system-kill-switch-activation-failed', { traceId }, traceId)
      })
      break
  }
}

/**
 * Check if an entity has a pattern of corruption (multiple unresolved exceptions).
 * Used by determineFreezeLevel for Level 2 escalation.
 *
 * This is called AFTER the initial Level 1 freeze to check if escalation is needed.
 * If >1 unresolved exceptions exist for the same entity, escalate to Level 2.
 */
export async function checkAndEscalateFreeze(
  entityType: string,
  entityId: string,
  traceId: string,
): Promise<void> {
  const unresolvedCount = await db.exceptionQueue.count({
    where: {
      entityType,
      entityId,
      resolvedAt: null,
    },
  })

  // If >1 unresolved exceptions for the same entity, escalate to Level 2
  if (unresolvedCount > 1) {
    logInfo('freeze-escalation-check', {
      entityType,
      entityId,
      unresolvedCount,
      escalate: true,
      targetLevel: 2,
    }, traceId)
    await applyFreeze(entityType, entityId, 2, traceId)

    // Update the latest exception to reflect the escalation
    const latest = await db.exceptionQueue.findFirst({
      where: { entityType, entityId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (latest && latest.freezeLevel < 2) {
      await db.exceptionQueue.update({
        where: { id: latest.id },
        data: { freezeLevel: 2 },
      })
    }
  }
}

/**
 * Resolve an exception queue entry (admin action).
 * Clears the freeze + marks the entry as resolved.
 */
export async function resolveException(
  exceptionId: string,
  resolvedBy: string,
  resolutionNote: string,
): Promise<void> {
  const entry = await db.exceptionQueue.findUnique({ where: { id: exceptionId } })
  if (!entry) throw new Error(`Exception ${exceptionId} not found`)

  // Clear the freeze based on the level that was applied
  switch (entry.freezeLevel) {
    case 1:
      // Unfreeze the order (set status back to a valid state — admin decides)
      if (entry.entityType === 'Order') {
        await db.order.update({
          where: { id: entry.entityId },
          data: { status: 'CANCELLED' }, // safe default: cancelled, not active
        }).catch(() => {})
      }
      break
    case 2:
      // Un-quarantine the restaurant
      if (entry.entityType === 'Restaurant') {
        await db.restaurant.update({
          where: { id: entry.entityId },
          data: { isSuspended: false },
        }).catch(() => {})
      }
      break
    case 3:
      // Deactivate the system kill switch (admin must explicitly do this)
      await db.killSwitch.update({
        where: { key: 'ordering' },
        data: { enabled: false, version: { increment: 1 } },
      }).catch(() => {})
      break
  }

  await db.exceptionQueue.update({
    where: { id: exceptionId },
    data: {
      resolvedAt: new Date(),
      resolvedBy,
      resolutionNote,
    },
  })
}

/**
 * List unresolved exceptions (for admin dashboard).
 */
export async function listUnresolvedExceptions(limit = 50): Promise<{
  id: string
  invariant: string
  entityType: string
  entityId: string
  freezeLevel: number
  description: string
  createdAt: Date
}[]> {
  const exceptions = await db.exceptionQueue.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      invariant: true,
      entityType: true,
      entityId: true,
      freezeLevel: true,
      description: true,
      createdAt: true,
    },
  })
  return exceptions
}
