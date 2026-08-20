'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Star, ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { inr } from '@/lib/snack'
import {
  CuisineIcon,
  cuisineGradient,
  OpenClosedBadge,
  DistanceBadge,
  PrepTimeBadge,
  RewardBadge,
  DealBadge,
  StarRating,
} from './bits'
import type { Restaurant } from '@/lib/types'

// Hoist motion(Card) to module level — creating it during render would
// reset component state each render (react-hooks/static-components rule).
const MotionCard = motion(Card)

/**
 * Premium restaurant card v2 — primary discovery surface.
 *
 * Per DESIGN_SYSTEM.md §5.2.1:
 * - Vertical card, rounded-2xl, snak-card shadow.
 * - Top: 4:3 hero image (cuisine gradient placeholder) + overlays
 *   (open/closed pill, reward multiplier badge, deal badge).
 * - Body:
 *   - Row 1: name + star rating
 *   - Row 2: cuisine + distance + prep time
 *   - Row 3 (optional): price-for-two
 *
 * States:
 * - Open — full color, full opacity.
 * - Closed — desaturated hero (40% opacity) + "Closed" pill, card still tappable.
 * - Hover (desktop) — lift 2px + image scales 1.03.
 * - Pressed (mobile) — scale 0.98.
 *
 * Motion: entrance stagger (handled by parent), hover lift, press scale.
 *
 * Accessibility:
 * - Whole card is a button (or <a> via asChild). Internal badges aria-hidden.
 * - Star rating has aria-label.
 * - Image alt = restaurant name.
 *
 * Dark mode: cuisine gradients stay vibrant (per §9.2). Other tokens auto-flip.
 */

export interface RestaurantCardV2Props {
  restaurant: Restaurant
  /** Distance from user in km. Optional — hidden if absent. */
  distanceKm?: number
  /** Open / closed state. If absent, assumes open. */
  isOpen?: boolean
  /** Reward multiplier (e.g., 2 for "2× pts"). Hidden if 1 or absent. */
  rewardMultiplier?: number
  /** Optional active deal label (e.g., "20% off first order"). */
  dealLabel?: string
  /** Called when the card is tapped. */
  onPress?: (r: Restaurant) => void
  /** Optional className. */
  className?: string
  /** Disable press scale animation (for nested buttons). */
  disablePressScale?: boolean
}

export function RestaurantCardV2({
  restaurant,
  distanceKm,
  isOpen = true,
  rewardMultiplier,
  dealLabel,
  onPress,
  className,
  disablePressScale = false,
}: RestaurantCardV2Props) {
  const prefersReduced = useReducedMotion()
  const r = restaurant
  const showRewardMultiplier = rewardMultiplier && rewardMultiplier > 1
  const showDeal = !!dealLabel

  return (
    <MotionCard
      role="button"
      tabIndex={0}
      aria-label={`${r.name}, ${r.cuisine}${distanceKm ? `, ${distanceKm} km away` : ''}${!isOpen ? ', closed' : ''}`}
      onClick={() => onPress?.(r)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPress?.(r)
        }
      }}
      whileHover={!prefersReduced && !disablePressScale ? { y: -2 } : undefined}
      whileTap={!prefersReduced && !disablePressScale ? { scale: 0.98 } : undefined}
      transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
      className={cn(
        'group snak-card relative cursor-pointer overflow-hidden p-0',
        'rounded-2xl',
        'snak-focus-ring',
        className,
      )}
    >
      {/* Hero image — 4:3 with cuisine gradient fallback */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {r.image ? (
          <img
            src={r.image}
            alt={r.name}
            className={cn(
              'h-full w-full object-cover transition-transform duration-300',
              !prefersReduced && 'group-hover:scale-105',
              !isOpen && 'opacity-40',
            )}
            loading="lazy"
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center bg-gradient-to-br',
              cuisineGradient(r.cuisine),
              !isOpen && 'opacity-40',
            )}
            aria-hidden="true"
          >
            <CuisineIcon cuisine={r.cuisine} className="text-5xl opacity-90" />
          </div>
        )}

        {/* Top-left: open/closed pill */}
        <div className="absolute left-3 top-3">
          <OpenClosedBadge isOpen={isOpen} />
        </div>

        {/* Top-right: reward multiplier + deal badges */}
        {(showRewardMultiplier || showDeal) && (
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
            {showRewardMultiplier && (
              <RewardBadge multiplier>
                {rewardMultiplier}×
              </RewardBadge>
            )}
            {showDeal && dealLabel && <DealBadge label={dealLabel} />}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="space-y-1.5 p-4">
        {/* Row 1 — name + rating */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-base font-semibold text-foreground">{r.name}</h3>
          <StarRating rating={r.rating} />
        </div>

        {/* Row 2 — cuisine + distance + prep time */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CuisineIcon cuisine={r.cuisine} className="text-sm" />
            <span className="truncate">{r.cuisine}</span>
          </span>
          {typeof distanceKm === 'number' && (
            <>
              <span aria-hidden="true">·</span>
              <DistanceBadge km={distanceKm} />
            </>
          )}
          <span aria-hidden="true">·</span>
          <PrepTimeBadge minutes={r.prepTimeMins} />
        </div>

        {/* Row 3 — price for two */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            <Star className="hidden" aria-hidden="true" />
            <span className="inline-flex items-center gap-1">
              <span className="font-mono tabular-nums text-foreground">{inr(r.priceForTwo)}</span>
              <span>for two</span>
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
      </div>
    </MotionCard>
  )
}

export default RestaurantCardV2
