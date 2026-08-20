'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Plus, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inr, pointsEarnedFor } from '@/lib/snack'
import { VegBadge, SpiceDots, RewardBadge, cuisineGradient } from './bits'
import type { MenuItem } from '@/lib/types'

/**
 * Premium menu item card v2 — single dish row in restaurant menu.
 *
 * Per DESIGN_SYSTEM.md §5.2.2:
 * - Horizontal row, p-3, rounded-xl.
 * - Left: 80×80 image (rounded-lg, object-cover). Top-left = veg/non-veg badge.
 *   Top-right = spice dots.
 * - Middle: name + description (2-line clamp) + price + reward points.
 * - Right: add button (default = "+" in 36px teal-outlined circle).
 *   When quantity > 0 = quantity stepper (- [qty] +) in teal-filled pill.
 *
 * States:
 * - Default
 * - Added to cart (qty > 0) — stepper replaces add button (spring swap).
 * - Sold out — image grayscale, strikethrough, "Sold out" badge.
 *
 * Motion:
 * - Add button → stepper: spring scale swap.
 * - Quantity change: number briefly scales (150ms).
 *
 * Accessibility:
 * - Add button aria-label="Add [item name] to cart".
 * - Stepper +/- have proper labels.
 * - Veg badge has aria-label.
 * - Whole row tappable to open item detail (via onPress).
 *
 * Dark mode: cuisine gradients stay vibrant. Other tokens auto-flip.
 */

export interface MenuItemCardV2Props {
  item: MenuItem
  /** Current quantity in cart (0 = show add button). */
  quantity?: number
  /** Called when the "+" button is tapped. */
  onAdd?: (item: MenuItem) => void
  /** Called when the stepper "+" is tapped. */
  onIncrement?: (item: MenuItem) => void
  /** Called when the stepper "-" is tapped. When qty === 1, this should remove. */
  onDecrement?: (item: MenuItem) => void
  /** Called when the row (not the buttons) is tapped — opens item detail. */
  onPress?: (item: MenuItem) => void
  /** Optional reward multiplier (e.g., 2 for "2× pts"). Default 1. */
  rewardMultiplier?: number
  /** Override the reward points display. If absent, computed from price. */
  rewardPoints?: number
  className?: string
}

export function MenuItemCardV2({
  item,
  quantity = 0,
  onAdd,
  onIncrement,
  onDecrement,
  onPress,
  rewardMultiplier = 1,
  rewardPoints,
  className,
}: MenuItemCardV2Props) {
  const prefersReduced = useReducedMotion()
  const m = item
  const isSoldOut = !m.isAvailable
  const hasQty = quantity > 0
  const pts = rewardPoints ?? pointsEarnedFor(m.price / 100, rewardMultiplier)

  return (
    <motion.div
      role="article"
      aria-label={`${m.name}, ${inr(m.price)}${isSoldOut ? ', sold out' : ''}`}
      onClick={() => onPress?.(m)}
      tabIndex={onPress ? 0 : undefined}
      onKeyDown={
        onPress
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPress?.(m)
              }
            }
          : undefined
      }
      whileHover={!prefersReduced && onPress ? { backgroundColor: 'var(--accent)' } : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl p-3 transition-colors',
        'snak-focus-ring',
        onPress && 'cursor-pointer',
        className,
      )}
      style={onPress ? undefined : undefined}
    >
      {/* Left — image with veg + spice overlays */}
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {m.image ? (
          <img
            src={m.image}
            alt={m.name}
            className={cn(
              'h-full w-full object-cover',
              isSoldOut && 'grayscale',
            )}
            loading="lazy"
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center bg-gradient-to-br text-2xl',
              cuisineGradient('Default'),
              isSoldOut && 'grayscale',
            )}
            aria-hidden="true"
          >
            🍽
          </div>
        )}

        {/* Veg badge — top-left */}
        <div className="absolute left-1 top-1 rounded bg-background/85 p-0.5 backdrop-blur-sm">
          <VegBadge veg={m.isVeg} />
        </div>

        {/* Spice dots — top-right */}
        {m.spiceLevel > 0 && (
          <div className="absolute right-1 top-1 rounded bg-background/85 px-1 py-0.5 backdrop-blur-sm">
            <SpiceDots level={m.spiceLevel} />
          </div>
        )}

        {/* Sold-out overlay */}
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Sold out
            </span>
          </div>
        )}
      </div>

      {/* Middle — text */}
      <div className="min-w-0 flex-1">
        <h4
          className={cn(
            'truncate text-sm font-medium text-foreground',
            isSoldOut && 'text-muted-foreground line-through',
          )}
        >
          {m.name}
        </h4>
        {m.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'font-mono text-sm font-semibold',
              isSoldOut ? 'text-muted-foreground line-through' : 'text-foreground',
            )}
          >
            {inr(m.price)}
          </span>
          {!isSoldOut && pts > 0 && (
            <RewardBadge>
              +{pts}
            </RewardBadge>
          )}
        </div>
      </div>

      {/* Right — add button or quantity stepper */}
      <div className="shrink-0">
        {isSoldOut ? (
          <span className="text-xs font-medium text-muted-foreground">—</span>
        ) : hasQty ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key="stepper"
              initial={prefersReduced ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 180, damping: 14, mass: 1 }}
              className="flex items-center gap-1 rounded-full bg-primary px-1.5 py-1 text-primary-foreground"
              role="group"
              aria-label={`Quantity ${quantity}`}
            >
              <StepperButton
                label={`Decrease ${m.name} quantity`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDecrement?.(m)
                }}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </StepperButton>
              <motion.span
                key={quantity}
                initial={prefersReduced ? false : { scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.15 }}
                className="min-w-[20px] text-center font-mono text-sm font-bold tabular-nums"
              >
                {quantity}
              </motion.span>
              <StepperButton
                label={`Increase ${m.name} quantity`}
                onClick={(e) => {
                  e.stopPropagation()
                  onIncrement?.(m)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </StepperButton>
            </motion.div>
          </AnimatePresence>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.button
              key="add"
              type="button"
              aria-label={`Add ${m.name} to cart`}
              onClick={(e) => {
                e.stopPropagation()
                onAdd?.(m)
              }}
              initial={prefersReduced ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
              transition={{ type: 'spring', stiffness: 180, damping: 14, mass: 1 }}
              className="snak-focus-ring flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary bg-background text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </motion.button>
          </AnimatePresence>
        )}
      </div>
    </motion.div>
  )
}

function StepperButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  const prefersReduced = useReducedMotion()
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
      transition={{ duration: 0.08 }}
      className="snak-focus-ring flex h-7 w-7 items-center justify-center rounded-full hover:bg-primary-foreground/15"
    >
      {children}
    </motion.button>
  )
}

export default MenuItemCardV2
