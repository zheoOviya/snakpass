'use client'

import { Sparkles, Gift, Users, MapPin, Clock, DoorOpen, DoorClosed, Zap } from 'lucide-react'
import { spiceLabel } from '@/lib/snack'

// Veg / non-veg square indicator
export function VegBadge({ veg, className = '' }: { veg: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-sm ${veg ? 'veg-dot' : 'nonveg-dot'} ${className}`}
      title={veg ? 'Vegetarian' : 'Non-vegetarian'}
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
    >
      <span className={`h-2 w-2 rounded-full ${veg ? 'bg-emerald-600' : 'bg-red-600'}`} />
    </span>
  )
}

export function SpiceDots({ level }: { level: number }) {
  if (level === 0) return null
  const { label, emoji } = spiceLabel(level)
  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400" title={label}>
      <span className="text-[10px]">{emoji}</span>
    </span>
  )
}

export function StarRating({ rating, className = '' }: { rating: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${className}`}>
      <span className="text-amber-500">★</span>
      <span>{rating.toFixed(1)}</span>
    </span>
  )
}

// Cuisine -> emoji
export function CuisineIcon({ cuisine, className = '' }: { cuisine: string; className?: string }) {
  const map: Record<string, string> = {
    'North Indian': '🍛',
    'South Indian': '🥞',
    'Indo-Chinese': '🥡',
    Desserts: '🍰',
  }
  return <span className={className}>{map[cuisine] ?? '🍽️'}</span>
}

// Deterministic gradient for a restaurant/dish card image placeholder
export function cuisineGradient(cuisine: string): string {
  const map: Record<string, string> = {
    'North Indian': 'from-amber-400 via-orange-500 to-red-500',
    'South Indian': 'from-yellow-300 via-amber-400 to-orange-400',
    'Indo-Chinese': 'from-red-500 via-rose-500 to-orange-500',
    Desserts: 'from-pink-400 via-fuchsia-400 to-purple-400',
  }
  return map[cuisine] ?? 'from-teal-400 via-emerald-500 to-green-500'
}

// ════════════════════════════════════════════════════════════════════════════
//  PREMIUM UI BADGES — Wave 1B additions (additive — preserve existing above)
//  Reference: DESIGN_SYSTEM.md §5.2.1 Restaurant card, §5.2.4 Reward,
//             §5.2.5 Gift, §5.2.6 Group, §5.2.7 Social feed.
//  All badges use CSS variables (no hardcoded colors) so dark mode works.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Reward points badge — gold accent. Used by menu item cards (+12 pts),
 * restaurant cards (2× pts multiplier), reward ledger entries.
 */
export function RewardBadge({
  children,
  className = '',
  multiplier = false,
}: {
  children: React.ReactNode
  className?: string
  /** When true, renders as "2× pts" multiplier pill instead of point count. */
  multiplier?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[11px] font-semibold text-reward-foreground dark:bg-gold-950/60 dark:text-gold-300 ${className}`}
      aria-label={multiplier ? `Reward multiplier ${children}` : `Reward ${children}`}
    >
      <Sparkles className="h-3 w-3 text-gold-600 dark:text-gold-400" aria-hidden="true" />
      <span className="font-mono tabular-nums">{children}</span>
      <span className="font-sans">pts</span>
    </span>
  )
}

/**
 * Gift icon — used in gift cards, "send gift" CTAs, gift-received toasts.
 * Inline SVG-style with violet accent. Not a button — purely decorative.
 */
export function GiftIcon({ className = '', size = 16 }: { className?: string; size?: number }) {
  return (
    <Gift
      className={`text-violet-600 dark:text-violet-400 ${className}`}
      size={size}
      aria-hidden="true"
    />
  )
}

/**
 * Group icon — used in group order bubbles, "start group" CTAs.
 * Rose accent. Decorative.
 */
export function GroupIcon({ className = '', size = 16 }: { className?: string; size?: number }) {
  return (
    <Users
      className={`text-rose-600 dark:text-rose-400 ${className}`}
      size={size}
      aria-hidden="true"
    />
  )
}

/**
 * Campus badge — small pill showing the campus name + pin icon.
 * Used in the app bar campus-selector chip + restaurant card campus label.
 */
export function CampusBadge({
  name,
  className = '',
  showIcon = true,
}: {
  name: string
  className?: string
  showIcon?: boolean
}) {
  return (
    <span
      className={`inline-flex max-w-[180px] items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground ${className}`}
    >
      {showIcon && <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * Open / Closed pill for restaurant cards. Shows a green "Open" or muted "Closed".
 */
export function OpenClosedBadge({
  isOpen,
  className = '',
}: {
  isOpen: boolean
  className?: string
}) {
  if (isOpen) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-950/60 dark:text-success-300 ${className}`}
        aria-label="Restaurant is open now"
      >
        <DoorOpen className="h-3 w-3" aria-hidden="true" />
        Open
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ${className}`}
      aria-label="Restaurant is currently closed"
    >
      <DoorClosed className="h-3 w-3" aria-hidden="true" />
      Closed
    </span>
  )
}

/**
 * Distance badge — "1.2 km". Used in restaurant card row 2.
 */
export function DistanceBadge({
  km,
  className = '',
}: {
  km: number
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}
      aria-label={`${km} kilometres away`}
    >
      <MapPin className="h-3 w-3" aria-hidden="true" />
      <span className="font-mono tabular-nums">{km.toFixed(1)} km</span>
    </span>
  )
}

/**
 * Prep time badge — "15 min". Used in restaurant card row 2.
 */
export function PrepTimeBadge({
  minutes,
  className = '',
}: {
  minutes: number
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}
      aria-label={`Ready in about ${minutes} minutes`}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      <span className="font-mono tabular-nums">{minutes} min</span>
    </span>
  )
}

/**
 * Deal / discount badge — amber "20% off" pill. Used in restaurant cards
 * when an active deal applies. Distinct from RewardBadge (gold).
 */
export function DealBadge({
  label,
  className = '',
}: {
  label: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 ${className}`}
      aria-label={`Special deal: ${label}`}
    >
      <Zap className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}
