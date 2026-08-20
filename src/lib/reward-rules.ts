// src/lib/reward-rules.ts
//
// Pure reward-rule definitions + idempotency-key construction helpers.
// PURE — no DB access, no side effects, no I/O, no `'use server'` directive
// (it must be importable from both client and server code, including
// cart-store.ts which is client-side).
//
// Imported by:
//   - src/lib/rewards-engine.ts (transactional issuance + redemption)
//   - src/app/api/rewards/** (API routes — Task 5A)
//   - src/lib/cart-store.ts (client-side pricing helper — constants only)
//
// Governance (blueprint §17 REWARDS ENGINE + plan §1.D):
//   - Earn rate: 1 pt per ₹10 spent (REWARD_POINTS_PER_RUPEE = 0.1)
//   - Redemption rate: 100 pts = ₹10 discount (REWARD_REDEMPTION_RATE = 0.1 ₹/pt)
//   - Ledger-based balance; immutable history; idempotent issuance
//   - Earn fires on PICKED_UP only (prevents cancellation farming)
//   - 365-day expiry (lazy in MVP — see rewards-engine.expireStaleRewards)

// ---------------------------------------------------------------------------
// Reward constants — single source of truth
// ---------------------------------------------------------------------------

/** Earn rate: points earned per rupee spent. 0.1 = 1 point per ₹10. */
export const REWARD_POINTS_PER_RUPEE = 0.1

/**
 * Redemption rate: rupee discount per point redeemed. 0.1 = ₹0.10 per point,
 * i.e. 100 points = ₹10 discount.
 *
 * For PAISE conversion (used by cart pricing), use the `rewardDiscountPaise`
 * helper to avoid unit confusion:
 *   rewardDiscountPaise(100) === 1000  (1000 paise = ₹10)
 */
export const REWARD_REDEMPTION_RATE = 0.1

/** Default gift expiry in days (blueprint §19). */
export const GIFT_EXPIRY_DAYS = 30

/** Default group order auto-close window in hours (blueprint §20). */
export const GROUP_ORDER_CLOSES_HOURS = 24

/** Default reward expiry window for EARN entries, in days (blueprint §17 — 365-day expiry). */
export const REWARD_EXPIRY_DAYS = 365

// ---------------------------------------------------------------------------
// Reward rule catalog (blueprint §17, plan §1.D)
// ---------------------------------------------------------------------------

export type RewardRuleKey =
  | 'EARN_BASE'
  | 'FIRST_ORDER'
  | 'SECOND_ORDER'
  | 'STREAK_3'
  | 'STREAK_7'
  | 'REFERRAL'
  | 'OFF_PEAK'
  | 'GROUP_ORDER'
  | 'GIFT_SENT'
  | 'GIFT_RECEIVED'
  | 'CAMPUS_EVENT'

/**
 * Points-formula spec — interpreted by `computeOrderPoints` + rewards-engine.
 *   - { type: 'perRupee', rate: 0.1 }   → 1 pt per ₹10 spent (rate = pts/rupee)
 *   - { type: 'fixed', points: 50 }     → flat 50 points (independent of spend)
 *   - { type: 'multiplier', multiplier: 2 } → multiplies the base EARN_BASE points
 *
 * This type mirrors the JSON stored in RewardRule.pointsFormula (Task 1A schema).
 */
export interface PointsFormula {
  type: 'perRupee' | 'fixed' | 'multiplier'
  rate?: number
  points?: number
  multiplier?: number
}

export interface RewardRuleDef {
  name: string
  description: string
  pointsFormula: PointsFormula
}

/**
 * Static reward-rule definitions — the source of truth for the rule catalog.
 * The `RewardRule` Prisma table (Task 1A schema) mirrors these definitions
 * for runtime configurability; this map serves as the fallback default + the
 * catalog used by `buildIdempotencyKey` and `computeOrderPoints`.
 *
 * Adding a new rule: add a key to `RewardRuleKey` + an entry here. The seed
 * (Task 1A) mirrors this map into the DB so admins can tune points without
 * code changes.
 */
export const REWARD_RULES: Record<RewardRuleKey, RewardRuleDef> = {
  EARN_BASE: {
    name: 'Base Earn',
    description: 'Earn 1 point per ₹10 spent on every order (fires on PICKED_UP).',
    pointsFormula: { type: 'perRupee', rate: REWARD_POINTS_PER_RUPEE },
  },
  FIRST_ORDER: {
    name: 'First Order Bonus',
    description: 'Flat +50 points on your first completed order.',
    pointsFormula: { type: 'fixed', points: 50 },
  },
  SECOND_ORDER: {
    name: 'Second Order Bonus',
    description: 'Flat +25 points on your second completed order.',
    pointsFormula: { type: 'fixed', points: 25 },
  },
  STREAK_3: {
    name: '3-Day Streak',
    description: 'Flat +20 points for ordering 3 days in a row.',
    pointsFormula: { type: 'fixed', points: 20 },
  },
  STREAK_7: {
    name: '7-Day Streak',
    description: 'Flat +100 points for ordering 7 days in a row.',
    pointsFormula: { type: 'fixed', points: 100 },
  },
  REFERRAL: {
    name: 'Referral Bonus',
    description: 'Flat +100 points when a referred user completes their first order.',
    pointsFormula: { type: 'fixed', points: 100 },
  },
  OFF_PEAK: {
    name: 'Off-Peak Order',
    description: 'Flat +10 points for ordering during off-peak hours.',
    pointsFormula: { type: 'fixed', points: 10 },
  },
  GROUP_ORDER: {
    name: 'Group Order Bonus',
    description: 'Flat +25 points for hosting or joining a group order.',
    pointsFormula: { type: 'fixed', points: 25 },
  },
  GIFT_SENT: {
    name: 'Gift Sent',
    description: 'Flat +5 points for sending a food gift to a friend.',
    pointsFormula: { type: 'fixed', points: 5 },
  },
  GIFT_RECEIVED: {
    name: 'Gift Received',
    description: 'Flat +5 points for receiving a food gift.',
    pointsFormula: { type: 'fixed', points: 5 },
  },
  CAMPUS_EVENT: {
    name: 'Campus Event Bonus',
    description: 'Flat +50 points during campus promo events.',
    pointsFormula: { type: 'fixed', points: 50 },
  },
}

/** List of all known rule keys (convenience for seeding + iteration). */
export const REWARD_RULE_KEYS = Object.keys(REWARD_RULES) as RewardRuleKey[]

// ---------------------------------------------------------------------------
// Pure compute helpers
// ---------------------------------------------------------------------------

/**
 * Context bag passed to `computeOrderPoints` for bonus rules.
 *   - orderAmountPaise: optional explicit override of the order total in PAISE
 *   - multiplier: optional multiplier on the EARN_BASE rate (e.g., 2.0 = double points during a deal)
 *   - extraContext: arbitrary metadata for future rules (e.g., baseEarnPoints for `multiplier` type)
 */
export interface ComputeOrderPointsContext {
  orderAmountPaise?: number
  multiplier?: number
  extraContext?: Record<string, unknown>
}

/**
 * Compute the points to issue for an order + rule. PURE — no DB, no side effects.
 *
 *   - For `perRupee` rules (e.g., EARN_BASE): floor(orderAmountRupees × rate × multiplier)
 *   - For `fixed` rules (e.g., FIRST_ORDER, STREAK_*): returns the configured points (ignores amount)
 *   - For `multiplier` rules: returns floor(baseEarnPoints × multiplier); caller must
 *     supply baseEarnPoints via context.extraContext.baseEarnPoints
 *
 * Returns 0 if the rule is unknown or the formula yields a non-positive integer
 * (reward issuance is non-negative only — negative adjustments go through a
 * separate ADJUST ledger entry, not via this helper).
 *
 * @param orderAmountPaise  Order total in PAISE (1 ₹ = 100 paise)
 * @param ruleKey           Rule key (must be a key of REWARD_RULES)
 * @param context           Optional context bag (multiplier, baseEarnPoints, etc.)
 */
export function computeOrderPoints(
  orderAmountPaise: number,
  ruleKey: string,
  context: ComputeOrderPointsContext = {},
): number {
  const rule = REWARD_RULES[ruleKey as RewardRuleKey]
  if (!rule) return 0

  const formula = rule.pointsFormula
  // Prefer explicit context override; fall back to the function arg.
  const paise = context.orderAmountPaise ?? orderAmountPaise ?? 0
  const orderAmountRupees = paise / 100

  switch (formula.type) {
    case 'perRupee': {
      const rate = formula.rate ?? REWARD_POINTS_PER_RUPEE
      const mult = context.multiplier ?? 1
      const pts = Math.floor(orderAmountRupees * rate * mult)
      return pts > 0 ? pts : 0
    }
    case 'fixed': {
      const pts = formula.points ?? 0
      return pts > 0 ? pts : 0
    }
    case 'multiplier': {
      const mult = formula.multiplier ?? 1
      const basePts =
        (context.extraContext?.baseEarnPoints as number | undefined) ??
        Math.floor(orderAmountRupees * REWARD_POINTS_PER_RUPEE)
      const pts = Math.floor(basePts * mult)
      return pts > 0 ? pts : 0
    }
    default:
      return 0
  }
}

/**
 * Construct a deterministic idempotency key for reward issuance.
 *
 * Format:
 *   - With orderId:   `${ruleKey}:order:${orderId}`
 *   - Without orderId: `${ruleKey}:user:${userId}:${nonce}`  (or `${ruleKey}:user:${userId}` if no nonce)
 *
 * The key is stored on `RewardLedgerEntry.idempotencyKey` (UNIQUE constraint,
 * Task 1A schema) so re-running the same issuance (e.g., on retry or duplicate
 * webhook) is a no-op — the unique constraint rejects the duplicate insert
 * and `rewards-engine.issueReward` returns the existing ledger entry instead
 * of issuing duplicate points.
 *
 * PURE — no DB access. The UNIQUE constraint enforcement happens at the DB
 * layer (see rewards-engine.issueReward).
 *
 * @param userId    The user receiving the reward
 * @param ruleKey   Rule key (e.g., 'EARN_BASE', 'FIRST_ORDER')
 * @param orderId   Optional order ID — when present, scopes the key to one issuance per order
 * @param nonce     Optional nonce for non-order-scoped rules (e.g., a referral event ID)
 */
export function buildIdempotencyKey(
  userId: string,
  ruleKey: string,
  orderId?: string,
  nonce?: string,
): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '')
  const safeRuleKey = ruleKey.replace(/[^a-zA-Z0-9_-]/g, '')
  if (orderId) {
    const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '')
    return `${safeRuleKey}:order:${safeOrderId}`
  }
  if (nonce) {
    const safeNonce = nonce.replace(/[^a-zA-Z0-9_-]/g, '')
    return `${safeRuleKey}:user:${safeUserId}:${safeNonce}`
  }
  return `${safeRuleKey}:user:${safeUserId}`
}

// ---------------------------------------------------------------------------
// Paise-conversion helpers (used by cart-store pricing + checkout)
// ---------------------------------------------------------------------------

/**
 * Convert reward points to a PAISE discount amount.
 *
 *   100 points × REWARD_REDEMPTION_RATE (0.1 ₹/pt) = ₹10 = 1000 paise
 *
 * Floors to a whole paise (the smallest currency unit). Clamps to non-negative.
 *
 * Use this in cart pricing instead of `points × REWARD_REDEMPTION_RATE`
 * directly — that product is in RUPEES, not paise (a common unit-confusion bug).
 */
export function rewardDiscountPaise(points: number): number {
  const paise = Math.floor((points ?? 0) * REWARD_REDEMPTION_RATE * 100)
  return paise > 0 ? paise : 0
}

/**
 * Convert a PAISE amount to reward points (rounded down).
 * Inverse of `rewardDiscountPaise`. Used for "apply max available points" UX
 * where the cart has a max-discount cap (e.g., discount cannot exceed 50% of subtotal).
 */
export function paiseToRewardPoints(paise: number): number {
  if (!paise || paise <= 0) return 0
  const pts = Math.floor(paise / (REWARD_REDEMPTION_RATE * 100))
  return pts > 0 ? pts : 0
}
