// Shared SnakZap helpers: currency, status config, dietary labels.

export const ORDER_STATUSES = [
  'CONFIRMED',
  'PAID',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'CANCELLED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

// Status -> next allowed status (fulfillment state machine)
// PAID is set by POST /api/payments after a successful capture; the vendor
// advances either a CONFIRMED (legacy unpaid) or PAID order to PREPARING once
// the kitchen starts the order.
export const NEXT_STATUS: Record<string, string | null> = {
  CONFIRMED: 'PREPARING',
  PAID: 'PREPARING',
  PREPARING: 'ALMOST_READY',
  ALMOST_READY: 'READY_FOR_PICKUP',
  READY_FOR_PICKUP: 'PICKED_UP',
  PICKED_UP: null,
  CANCELLED: null,
}

export const STATUS_META: Record<
  string,
  { label: string; short: string; tone: string; step: number; emoji: string }
> = {
  CONFIRMED: { label: 'Order Confirmed', short: 'Confirmed', tone: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', step: 1, emoji: '✓' },
  PAID: { label: 'Payment Confirmed', short: 'Paid', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', step: 2, emoji: '💳' },
  PREPARING: { label: 'Preparing in Kitchen', short: 'Preparing', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', step: 3, emoji: '👨‍🍳' },
  ALMOST_READY: { label: 'Almost Ready', short: 'Almost Ready', tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', step: 4, emoji: '⏱️' },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', short: 'Ready', tone: 'bg-teal-500/15 text-teal-700 dark:text-teal-300', step: 5, emoji: '🔔' },
  PICKED_UP: { label: 'Picked Up', short: 'Picked Up', tone: 'bg-green-500/15 text-green-700 dark:text-green-300', step: 6, emoji: '🎉' },
  CANCELLED: { label: 'Cancelled', short: 'Cancelled', tone: 'bg-red-500/15 text-red-700 dark:text-red-300', step: 0, emoji: '✕' },
}

// Paise -> ₹ string
export function inr(paise: number): string {
  const rupees = paise / 100
  return '₹' + rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 100 === 0 ? 0 : 2 })
}

export function spiceLabel(level: number): { label: string; emoji: string } {
  switch (level) {
    case 0:
      return { label: 'Mild', emoji: '🍃' }
    case 1:
      return { label: 'Medium', emoji: '🌶' }
    case 2:
      return { label: 'Hot', emoji: '🌶🌶' }
    default:
      return { label: 'Extra Hot', emoji: '🌶🌶🌶' }
  }
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function statusHistoryArray(raw: string | null): { status: string; at: string }[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr
  } catch {
    /* ignore */
  }
  return []
}

// ════════════════════════════════════════════════════════════════════════════
//  PREMIUM UI CONSTANTS — Wave 1B additions (additive, preserved existing exports)
//  Reference: DESIGN_SYSTEM.md §5.2.4 Rewards, §5.2.5 Gift, §5.2.6 Group,
//             blueprint §17 Rewards Engine, §19 Food Gifting, §20 Group Ordering.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Default reward multiplier applied to an order's base points when no
 * promotional override is active (e.g., a "2× pts weekend" deal).
 * Used by RestaurantCardV2's reward multiplier badge.
 */
export const REWARD_MULTIPLIER_DEFAULT = 1

/**
 * Number of days a received gift stays redeemable before it expires.
 * Matches DESIGN_SYSTEM.md §5.2.5 "expires in 4h 12m" pattern (countdown UI).
 */
export const GIFT_EXPIRY_DAYS = 30

/**
 * Number of hours after a group order is created during which it stays
 * open for new members to join. After this window the host must checkout
 * or close the order.
 */
export const GROUP_ORDER_CLOSES_HOURS = 24

/**
 * Reward earn rate — points awarded per rupee spent.
 * 0.1 means 1 point per ₹10. Used by MenuItemCardV2 (+N pts preview)
 * and PricingBreakdown (reward preview).
 */
export const REWARD_POINTS_PER_RUPEE = 0.1

/**
 * Reward redemption rate — discount (in rupees) granted per point redeemed.
 * 0.1 means 100 points = ₹10 off. Used by PricingBreakdown (reward discount row)
 * and the rewards redemption selector.
 */
export const REWARD_REDEMPTION_RATE = 0.1

/**
 * Reward tier thresholds (points balance → tier name).
 * Drives the RewardProgressRing's "X pts to next tier" copy.
 * Keep in sync with backend rule definitions in `src/lib/reward-rules.ts`
 * (Task 1C) — these are the UI mirror.
 */
export const REWARD_TIERS = [
  { name: 'Bronze', minPoints: 0 },
  { name: 'Silver', minPoints: 250 },
  { name: 'Gold', minPoints: 750 },
  { name: 'Platinum', minPoints: 2000 },
  { name: 'Diamond', minPoints: 5000 },
] as const

export type RewardTierName = (typeof REWARD_TIERS)[number]['name']

/**
 * Given a points balance, return the current tier + the next tier +
 * the points remaining to reach the next tier. Returns null nextTier
 * if the user is already at the highest tier.
 */
export function getRewardTier(points: number): {
  current: { name: RewardTierName; minPoints: number }
  next: { name: RewardTierName; minPoints: number } | null
  pointsToNextTier: number
  progress: number // 0..1 within current tier band
} {
  type Tier = (typeof REWARD_TIERS)[number]
  let current: Tier = REWARD_TIERS[0]!
  let next: Tier | null = null
  for (let i = 0; i < REWARD_TIERS.length; i++) {
    const t = REWARD_TIERS[i]!
    if (points >= t.minPoints) {
      current = t
      next = REWARD_TIERS[i + 1] ?? null
    }
  }
  if (!next) {
    return { current, next: null, pointsToNextTier: 0, progress: 1 }
  }
  const span = next.minPoints - current.minPoints
  const into = points - current.minPoints
  return {
    current,
    next,
    pointsToNextTier: next.minPoints - points,
    progress: span > 0 ? Math.min(1, into / span) : 0,
  }
}

/**
 * Convert a rupee amount (number) to the reward points that would be earned
 * at the default earn rate, optionally scaled by a multiplier.
 */
export function pointsEarnedFor(rupees: number, multiplier = REWARD_MULTIPLIER_DEFAULT): number {
  return Math.round(rupees * REWARD_POINTS_PER_RUPEE * multiplier)
}

/**
 * Convert a points balance to the discount (in rupees) it can be redeemed for.
 */
export function pointsToDiscountRupees(points: number): number {
  return Math.round(points * REWARD_REDEMPTION_RATE * 100) / 100
}

/**
 * Format a countdown (ms remaining) as "4h 12m" or "12m 30s" or "< 1m".
 * Used by GiftCard expiry + GroupOrderBubble auto-close countdown.
 */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'Expired'
  const totalSec = Math.floor(msRemaining / 1000)
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return '< 1m'
}
