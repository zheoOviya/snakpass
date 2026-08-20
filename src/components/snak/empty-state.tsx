'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Receipt,
  Users,
  Sparkles,
  Store,
  Gift,
  BellOff,
  SearchX,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Reusable empty state — icon + title + description + optional CTA.
 * Per DESIGN_SYSTEM.md §5.4.3.
 *
 * Six built-in variants — each configures the icon, title, description, and
 * default CTA label. Callers can override any field for custom variants.
 *
 * "Never show a blank screen with no explanation." (UX quality gate §45)
 *
 * Accessibility:
 * - role="region" with aria-label = title.
 * - Icon is aria-hidden (decorative).
 *
 * Motion:
 * - Icon + title + description + button stagger-fade in on mount.
 *
 * Dark mode: uses CSS variables (muted, muted-foreground, primary).
 */

export type EmptyStateVariant =
  | 'no-orders'
  | 'no-friends'
  | 'no-rewards'
  | 'no-restaurants'
  | 'no-gifts'
  | 'no-notifications'

interface VariantConfig {
  Icon: LucideIcon
  title: string
  description: string
  defaultActionLabel: string
  /** Accent color for the icon circle. */
  accent: 'teal' | 'violet' | 'gold' | 'rose' | 'danger'
}

const VARIANTS: Record<EmptyStateVariant, VariantConfig> = {
  'no-orders': {
    Icon: Receipt,
    title: 'No orders yet',
    description: 'Your past orders will appear here. Browse restaurants to place your first order.',
    defaultActionLabel: 'Browse restaurants',
    accent: 'teal',
  },
  'no-friends': {
    Icon: Users,
    title: 'No friends yet',
    description: 'Add friends to see what they’re ordering and send gifts.',
    defaultActionLabel: 'Find friends',
    accent: 'violet',
  },
  'no-rewards': {
    Icon: Sparkles,
    title: 'No rewards yet',
    description: 'Earn points on every order and redeem them for discounts.',
    defaultActionLabel: 'Browse restaurants',
    accent: 'gold',
  },
  'no-restaurants': {
    Icon: Store,
    title: 'No restaurants near this campus yet',
    description: 'Try switching to a different campus, or browse all restaurants.',
    defaultActionLabel: 'Switch campus',
    accent: 'teal',
  },
  'no-gifts': {
    Icon: Gift,
    title: 'No gifts yet',
    description: 'Gifts you receive from friends will show up here.',
    defaultActionLabel: 'Send a gift',
    accent: 'violet',
  },
  'no-notifications': {
    Icon: BellOff,
    title: 'You’re all caught up',
    description: 'New activity — order updates, gifts, friend requests — will appear here.',
    defaultActionLabel: '',
    accent: 'rose',
  },
}

const ACCENT_BG: Record<VariantConfig['accent'], string> = {
  teal: 'bg-primary/10 text-primary',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  gold: 'bg-gold-100 text-gold-700 dark:bg-gold-950/60 dark:text-gold-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  danger: 'bg-danger-100 text-danger-700 dark:bg-danger-950/60 dark:text-danger-300',
}

export interface EmptyStateProps {
  variant: EmptyStateVariant
  /** Override the title. */
  title?: string
  /** Override the description. */
  description?: string
  /** Override the icon (lucide component). */
  Icon?: LucideIcon
  /** Override the CTA button label. */
  actionLabel?: string
  /** Called when the primary CTA is tapped. If absent, no CTA renders. */
  onAction?: () => void
  /** Optional secondary action. */
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  className?: string
}

export function EmptyState({
  variant,
  title,
  description,
  Icon,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className,
}: EmptyStateProps) {
  const prefersReduced = useReducedMotion()
  const cfg = VARIANTS[variant]
  const TheIcon = Icon ?? cfg.Icon
  const theTitle = title ?? cfg.title
  const theDesc = description ?? cfg.description
  const theActionLabel = actionLabel ?? cfg.defaultActionLabel

  // Stagger pattern per DESIGN_SYSTEM.md §6.4
  const container = {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.06, delayChildren: 0.05 },
    },
  }
  const item = prefersReduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.3, 0, 0, 1] as const } },
      }

  return (
    <motion.div
      role="region"
      aria-label={theTitle}
      variants={container}
      initial="hidden"
      animate="show"
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      {/* Icon in soft circular backdrop */}
      <motion.div
        variants={item}
        className={cn(
          'mb-5 flex h-[120px] w-[120px] items-center justify-center rounded-full',
          ACCENT_BG[cfg.accent],
        )}
      >
        <TheIcon className="h-12 w-12" aria-hidden="true" />
      </motion.div>

      <motion.h3
        variants={item}
        className="text-lg font-semibold text-foreground"
      >
        {theTitle}
      </motion.h3>

      <motion.p
        variants={item}
        className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground"
      >
        {theDesc}
      </motion.p>

      {(onAction || theActionLabel) && theActionLabel && (
        <motion.div variants={item} className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onAction && (
            <Button
              type="button"
              onClick={onAction}
              className="snak-focus-ring"
            >
              {theActionLabel}
            </Button>
          )}
          {onSecondaryAction && secondaryActionLabel && (
            <Button
              type="button"
              variant="outline"
              onClick={onSecondaryAction}
              className="snak-focus-ring"
            >
              {secondaryActionLabel}
            </Button>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

export default EmptyState
