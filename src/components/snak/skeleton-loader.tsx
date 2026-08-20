'use client'

import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Per-component skeleton loaders — shimmer placeholders for premium UI.
 *
 * Per DESIGN_SYSTEM.md §5.4.2:
 * - Use `snak-shimmer` (defined in design-tokens.css) — left-to-right gradient sweep, 1.6s loop.
 * - Each skeleton mirrors the layout of its real component so layout doesn't shift on load.
 * - aria-hidden="true" on skeletons, container has role="status" aria-label="Loading".
 *
 * Variants:
 * - RestaurantCardSkeleton — 4:3 hero block + 3 lines (40%, 70%, 50%).
 * - MenuItemSkeleton — 80×80 square + 2 lines + small chip.
 * - OrderCardSkeleton — header row + 3 lines + button block.
 * - SocialFeedSkeleton — avatar circle + 2 lines + 60×60 square.
 * - RewardRingSkeleton — 80px circle + 2 lines beside.
 *
 * Dark mode: snak-shimmer uses --muted which auto-flips in dark mode.
 */

/** A single shimmer block — combines the .snak-shimmer keyframe animation
 * (gradient sweep) with a fixed muted background. Pass className for size. */
function Shimmer({ className }: { className?: string }) {
  return <div className={cn('snak-shimmer', className)} aria-hidden="true" />
}

/** Wraps multiple skeleton items in a status region — use for lists. */
export function SkeletonGroup({
  children,
  label = 'Loading',
  className,
}: {
  children: React.ReactNode
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-label={label} className={cn('space-y-3', className)}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  )
}

/**
 * Restaurant card skeleton — mirrors RestaurantCardV2 layout.
 */
export function RestaurantCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading restaurant"
      className={cn('snak-card overflow-hidden rounded-2xl p-0', className)}
    >
      <Shimmer className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <Shimmer className="h-4 w-2/3 rounded" />
          <Shimmer className="h-4 w-10 rounded" />
        </div>
        <Shimmer className="h-3 w-3/4 rounded" />
        <Shimmer className="h-3 w-1/2 rounded" />
      </div>
    </div>
  )
}

/**
 * Menu item skeleton — mirrors MenuItemCardV2 layout (horizontal row).
 */
export function MenuItemSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading menu item"
      className={cn('flex items-center gap-3 rounded-xl p-3', className)}
    >
      <Shimmer className="h-20 w-20 shrink-0 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Shimmer className="h-4 w-3/4 rounded" />
        <Shimmer className="h-3 w-full rounded" />
        <Shimmer className="h-3 w-1/3 rounded" />
      </div>
      <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
    </div>
  )
}

/**
 * Order card skeleton — header + 3 lines + button block.
 */
export function OrderCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading order"
      className={cn('snak-card space-y-3 rounded-2xl p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Shimmer className="h-5 w-2/3 rounded" />
        <Shimmer className="h-5 w-16 rounded-full" />
      </div>
      <Shimmer className="h-3 w-1/2 rounded" />
      <Shimmer className="h-3 w-3/4 rounded" />
      <Shimmer className="h-3 w-2/3 rounded" />
      <div className="flex gap-2 pt-1">
        <Shimmer className="h-8 w-24 rounded-md" />
        <Shimmer className="h-8 w-20 rounded-md" />
      </div>
    </div>
  )
}

/**
 * Social feed skeleton — avatar circle + 2 lines + 60×60 thumbnail.
 */
export function SocialFeedSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading social feed"
      className={cn('rounded-xl border border-border p-4', className)}
    >
      <div className="flex items-start gap-3">
        <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-3 w-3/4 rounded" />
          <Shimmer className="h-3 w-1/2 rounded" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted/40 p-2">
        <Shimmer className="h-12 w-12 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Shimmer className="h-3 w-2/3 rounded" />
          <Shimmer className="h-3 w-1/2 rounded" />
        </div>
      </div>
    </div>
  )
}

/**
 * Reward ring skeleton — 80px circle + 2 lines beside.
 */
export function RewardRingSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading rewards"
      className={cn('flex items-center gap-4', className)}
    >
      <Shimmer className="h-20 w-20 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Shimmer className="h-4 w-1/3 rounded" />
        <Shimmer className="h-3 w-1/2 rounded" />
      </div>
    </div>
  )
}

/** Generic skeleton line — used for ad-hoc placeholders. */
export function SkeletonLine({
  width = '100%',
  className,
}: {
  width?: string | number
  className?: string
}) {
  return (
    <Shimmer
      className={cn('h-3 rounded', className)}
    />
  )
}

export { Skeleton }

const SkeletonLoaders = {
  RestaurantCardSkeleton,
  MenuItemSkeleton,
  OrderCardSkeleton,
  SocialFeedSkeleton,
  RewardRingSkeleton,
  SkeletonGroup,
  SkeletonLine,
}

export default SkeletonLoaders
