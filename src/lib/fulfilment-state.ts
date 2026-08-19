// P0-06 Wave-6 — Fulfilment state machine (parallel to Order.status — additive-only)
//
// This module defines the parallel Fulfilment state machine (NEXT_FULFILMENT_STATUS).
// It does NOT modify `NEXT_STATUS` from `./snack` — Order.status keeps its own
// machine (CONFIRMED → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP).
//
// Why a parallel machine?
//   - P0-06 separates "fulfilment" (kitchen-side lifecycle) from "order" (the
//     purchase record). Order.status captures financial intent (PAID, CANCELLED,
//     PAYMENT_PENDING, FROZEN) plus a coarse fulfilment stage. Fulfilment.status
//     captures ONLY the kitchen-side stage with its own optimistic-lock + history.
//   - This allows the kitchen to transition Fulfilment without writing to Order
//     (no Payment/Refund/LedgerEntry impact), and vice versa for the order side.
//
// Lifecycle:
//   PREPARING        (default — lazy-created on first access)
//     → ALMOST_READY
//     → READY_FOR_PICKUP
//     → PICKED_UP    (terminal)

export const FULFILMENT_STATUSES = [
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
] as const

export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number]

// Parallel state machine — does NOT modify NEXT_STATUS in snack.ts.
// PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP → null (terminal)
export const NEXT_FULFILMENT_STATUS: Record<string, string | null> = {
  PREPARING: 'ALMOST_READY',
  ALMOST_READY: 'READY_FOR_PICKUP',
  READY_FOR_PICKUP: 'PICKED_UP',
  PICKED_UP: null,
}

/**
 * Validate a Fulfilment state transition.
 *
 * Idempotent: same → same returns true (no-op write still succeeds).
 * Otherwise checks NEXT_FULFILMENT_STATUS[from] === to.
 *
 * Examples:
 *   isValidFulfilmentTransition('PREPARING', 'PREPARING')  → true (idempotent)
 *   isValidFulfilmentTransition('PREPARING', 'ALMOST_READY') → true
 *   isValidFulfilmentTransition('PREPARING', 'PICKED_UP')   → false (skips stages)
 *   isValidFulfilmentTransition('PICKED_UP', 'PREPARING')   → false (terminal)
 */
export function isValidFulfilmentTransition(from: string, to: string): boolean {
  // Idempotent — same → same is always allowed (caller should detect + return 200 with idempotent: true)
  if (from === to) return true
  const allowed = NEXT_FULFILMENT_STATUS[from]
  return allowed === to
}

/**
 * Derive the Fulfilment.status from an Order.status for backfill.
 *
 * Used by the P0-06 migration to seed Fulfilment rows for existing Orders.
 * Mapping (per task spec):
 *   CONFIRMED, PREPARING, CANCELLED, PAID, PAYMENT_PENDING, FROZEN → PREPARING
 *   ALMOST_READY       → ALMOST_READY
 *   READY_FOR_PICKUP   → READY_FOR_PICKUP
 *   PICKED_UP          → PICKED_UP
 *
 * Rationale: cancelled/paid/pending/frozen orders have no kitchen-side progress
 * (no PREPARING → ALMOST_READY transition was ever recorded for them); defaulting
 * to PREPARING is the safe additive starting point.
 */
export function deriveFulfilmentStatusFromOrder(orderStatus: string): string {
  switch (orderStatus) {
    case 'ALMOST_READY':
      return 'ALMOST_READY'
    case 'READY_FOR_PICKUP':
      return 'READY_FOR_PICKUP'
    case 'PICKED_UP':
      return 'PICKED_UP'
    case 'CONFIRMED':
    case 'PREPARING':
    case 'CANCELLED':
    case 'PAID':
    case 'PAYMENT_PENDING':
    case 'FROZEN':
    default:
      return 'PREPARING'
  }
}

// UI metadata for Fulfilment statuses (parallel to STATUS_META in snack.ts).
// Tone classes follow the same Tailwind pattern as snack.ts STATUS_META.
export const FULFILMENT_STATUS_META: Record<
  string,
  { label: string; short: string; tone: string; step: number; emoji: string }
> = {
  PREPARING: {
    label: 'Preparing in Kitchen',
    short: 'Preparing',
    tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    step: 1,
    emoji: '👨‍🍳',
  },
  ALMOST_READY: {
    label: 'Almost Ready',
    short: 'Almost Ready',
    tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    step: 2,
    emoji: '⏱️',
  },
  READY_FOR_PICKUP: {
    label: 'Ready for Pickup',
    short: 'Ready',
    tone: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    step: 3,
    emoji: '🔔',
  },
  PICKED_UP: {
    label: 'Picked Up',
    short: 'Picked Up',
    tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    step: 4,
    emoji: '🎉',
  },
}
