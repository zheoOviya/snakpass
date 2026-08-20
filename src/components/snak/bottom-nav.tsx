'use client'

import * as React from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { Home, Compass, Users, Receipt, Sparkles, User, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * SnakZap premium bottom navigation — 6-tab bar (Home, Explore, Social, Orders,
 * Rewards, Profile).
 *
 * Wave 6 expansion (Task 6B): the Social tab now hosts the real social feed
 * (Task 6B's SocialScreen); Profile is split into its own 6th tab so the bar
 * grows to 6 items per DESIGN_SYSTEM.md §7 IA (Social as optional 6th tab).
 *
 * Per DESIGN_SYSTEM.md §5.1.1:
 * - Mobile-only (hidden md+). 64px tall + safe-area inset.
 * - Active indicator = 4px pill behind icon (teal-tinted), spring-slides on tab change.
 * - Each tab is a `<button>` with `aria-current="page"` when active.
 * - Touch target ≥ 44px (we use 64px tall; flex-1 keeps each tab ≥ ~53px
 *   wide even on the smallest 320px viewport, comfortably above the 44px
 *   minimum).
 * - Inactive icon = muted-foreground; active = text-primary (teal-600).
 * - Optional social activity dot (violet) + active orders badge (primary count).
 * - On very narrow screens (<360px) labels collapse to icon-only so all 6 tabs
 *   keep a comfortable touch target.
 *
 * Accessibility:
 * - role="tablist" container with role="tab" children.
 * - Each tab has aria-label + aria-selected.
 * - Focus ring on the button, not the icon (uses .snak-focus-ring).
 *
 * Dark mode: uses CSS variables (--primary, --muted-foreground, --background) — no
 * hardcoded colors.
 */

export type BottomNavTab =
  | 'home'
  | 'explore'
  | 'social'
  | 'orders'
  | 'rewards'
  | 'profile'

export interface BottomNavProps {
  /** Currently-active tab. */
  active: BottomNavTab
  /** Called when a tab is tapped. */
  onChange: (tab: BottomNavTab) => void
  /** Show a violet dot on the Social tab when new activity is available. */
  socialActivity?: boolean
  /** Active orders count — shown as a primary pill on the Orders tab. */
  activeOrderCount?: number
  /** Disable the social tab (e.g., before login). */
  socialDisabled?: boolean
  /** Optional aria-label for the nav element. */
  ariaLabel?: string
  className?: string
}

interface TabConfig {
  id: BottomNavTab
  label: string
  Icon: LucideIcon
}

const TABS: readonly TabConfig[] = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'social', label: 'Social', Icon: Users },
  { id: 'orders', label: 'Orders', Icon: Receipt },
  { id: 'rewards', label: 'Rewards', Icon: Sparkles },
  // Wave 6 (Task 6B): Profile is split out from the Social tab. The Social tab
  // now hosts the real social feed (SocialScreen); Profile hosts the user's
  // own profile screen (ProfileScreen — Task 2B owns the file).
  { id: 'profile', label: 'Profile', Icon: User },
] as const

const ACTIVE_PILL_VARIANTS: Variants = {
  // The pill is absolutely positioned within the active tab's button.
  // We animate opacity + scale on mount/unmount via AnimatePresence.
  enter: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
}

export function BottomNav({
  active,
  onChange,
  socialActivity = false,
  activeOrderCount = 0,
  socialDisabled = false,
  ariaLabel = 'Primary',
  className,
}: BottomNavProps) {
  const prefersReduced = useReducedMotion()

  return (
    <nav
      aria-label={ariaLabel}
      role="tablist"
      className={cn(
        'snak-glass fixed inset-x-0 bottom-0 z-nav border-t border-border',
        'flex items-stretch',
        'h-[var(--height-bottom-nav-safe)]',
        'pb-[env(safe-area-inset-bottom,0px)]',
        'md:hidden', // mobile-only per design system §5.1.1
        className,
      )}
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id
        const isSocial = tab.id === 'social'
        const isOrders = tab.id === 'orders'
        const isDisabled = isSocial && socialDisabled
        const { Icon } = tab

        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            aria-disabled={isDisabled || undefined}
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(tab.id)}
            className={cn(
              'snak-focus-ring group relative flex flex-1 flex-col items-center justify-center gap-1',
              'min-h-[44px] py-2',
              'transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
              isDisabled && 'opacity-40',
            )}
          >
            {/* Active pill — slides in/out behind icon. Wave 6 (Task 6B):
                pill width shrinks slightly on very narrow screens so it fits
                cleanly within the 6-tab layout. */}
            {isActive && !prefersReduced && (
              <motion.span
                aria-hidden="true"
                variants={ACTIVE_PILL_VARIANTS}
                initial="exit"
                animate="enter"
                exit="exit"
                transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
                className="absolute top-1.5 h-8 w-12 rounded-full bg-primary/15 max-[359px]:w-10"
              />
            )}
            {isActive && prefersReduced && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 h-8 w-12 rounded-full bg-primary/15 max-[359px]:w-10"
              />
            )}

            <span className="relative flex items-center justify-center">
              <Icon
                className={cn(
                  'h-6 w-6 transition-transform',
                  // Tap feedback — scale down on active-press
                  isActive && 'scale-110',
                )}
                aria-hidden="true"
              />
              {/* Social activity violet dot */}
              {isSocial && socialActivity && !isDisabled && (
                <motion.span
                  aria-label="New social activity"
                  className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-violet-500"
                  initial={prefersReduced ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 14, mass: 1 }}
                />
              )}
              {/* Active orders count badge */}
              {isOrders && activeOrderCount > 0 && (
                <motion.span
                  aria-label={`${activeOrderCount} active order${activeOrderCount > 1 ? 's' : ''}`}
                  className="absolute -right-2 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground"
                  initial={prefersReduced ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
                >
                  {activeOrderCount > 9 ? '9+' : activeOrderCount}
                </motion.span>
              )}
            </span>

            {/* Wave 6 (Task 6B): with 6 tabs, narrow screens (<360px) collapse
                labels to icon-only so each tab keeps a comfortable touch
                target. The label still exists for screen readers via
                aria-label on the button. */}
            <span
              className={cn(
                'text-[11px] leading-none',
                'max-[359px]:hidden',
                isActive ? 'font-semibold' : 'font-medium',
              )}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export default BottomNav
