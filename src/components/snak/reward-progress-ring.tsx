'use client'

import * as React from 'react'
import { motion, useReducedMotion, animate, useMotionValue, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'
import { getRewardTier } from '@/lib/snack'

/**
 * Reward progress ring — SVG circle showing points balance + progress to next tier.
 *
 * Per DESIGN_SYSTEM.md §5.6.2:
 * - 80px default (120px on rewards tab — pass `size={120}`).
 * - 8px stroke. Background track muted. Foreground = gold gradient.
 * - Animated count-up on mount + when points change.
 * - Shows "X pts to {nextTier}" below the ring.
 *
 * States:
 * - Static — ring at current progress.
 * - Earning (points prop changes) — arc extends smoothly + number count-up.
 * - Tier reached (progress === 1) — full gold ring.
 *
 * Accessibility:
 * - role="progressbar" with aria-valuenow/min/max.
 * - Text equivalent visible alongside (the number itself).
 *
 * Dark mode: uses CSS variables (gold-* ramp auto-flips in dark mode).
 */

export interface RewardProgressRingProps {
  /** Current points balance. */
  points: number
  /** Optional tier name override. If omitted, computed from points via REWARD_TIERS. */
  tierName?: string
  /** Override the points needed to reach the next tier. If omitted, computed. */
  pointsToNextTier?: number
  /** Override the progress 0..1. If omitted, computed. */
  progress?: number
  /** Optional earn-rate copy ("You earn 2× pts on every order"). */
  earnRate?: string
  /** Ring diameter in pixels. Default 80. */
  size?: number
  /** Stroke width. Default 8. */
  strokeWidth?: number
  className?: string
}

export function RewardProgressRing({
  points,
  tierName,
  pointsToNextTier,
  progress,
  earnRate,
  size = 80,
  strokeWidth = 8,
  className,
}: RewardProgressRingProps) {
  const prefersReduced = useReducedMotion()
  const computed = React.useMemo(() => getRewardTier(points), [points])

  const effectiveTier = tierName ?? computed.current.name
  const effectivePtsToNext = pointsToNextTier ?? computed.pointsToNextTier
  const effectiveProgress = progress ?? computed.progress
  const nextTierName = computed.next?.name ?? null

  // SVG geometry
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const targetOffset = circumference * (1 - Math.min(1, Math.max(0, effectiveProgress)))

  // Animated stroke-dashoffset
  const dashOffset = useMotionValue(circumference)
  React.useEffect(() => {
    if (prefersReduced) {
      dashOffset.set(targetOffset)
      return
    }
    const controls = animate(dashOffset, targetOffset, {
      duration: 0.6,
      ease: [0.3, 0, 0, 1],
    })
    return () => controls.stop()
  }, [targetOffset, dashOffset, prefersReduced])

  // Count-up for the points number
  const motionPoints = useMotionValue(0)
  const [displayPoints, setDisplayPoints] = React.useState(prefersReduced ? points : 0)
  React.useEffect(() => {
    if (prefersReduced) {
      setDisplayPoints(points)
      return
    }
    motionPoints.set(displayPoints)
    const controls = animate(motionPoints, points, {
      duration: 0.6,
      ease: [0.3, 0, 0, 1],
      onUpdate: (v) => setDisplayPoints(Math.round(v)),
    })
    return () => controls.stop()
  }, [points, prefersReduced])

  const goldGradientId = React.useId()
  const center = size / 2

  return (
    <div
      className={cn('flex items-center gap-4', className)}
      role="group"
      aria-label={`Reward progress, ${effectiveTier} tier`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="progressbar"
          aria-valuenow={points}
          aria-valuemin={0}
          aria-valuemax={points + Math.max(0, effectivePtsToNext)}
          aria-label={`Reward progress: ${points} points, ${effectiveTier} tier`}
        >
          {/* Gold gradient definition */}
          <defs>
            <linearGradient id={goldGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--gold-300)" />
              <stop offset="50%" stopColor="var(--gold-500)" />
              <stop offset="100%" stopColor="var(--gold-600)" />
            </linearGradient>
          </defs>

          {/* Background track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={strokeWidth}
            opacity={0.5}
          />

          {/* Foreground arc */}
          <motion.circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`url(#${goldGradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: dashOffset, transform: 'rotate(-90deg)', transformOrigin: 'center' }}
          />
        </svg>

        {/* Center content — points balance */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className={cn('font-mono font-bold leading-none text-foreground', size >= 120 ? 'text-3xl' : 'text-xl')}
            aria-hidden="true"
          >
            {displayPoints.toLocaleString('en-IN')}
          </motion.span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            pts
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {effectiveTier} <span className="text-muted-foreground">tier</span>
        </p>
        {nextTierName ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-gold-700 dark:text-gold-400">
              {effectivePtsToNext.toLocaleString('en-IN')} pts
            </span>{' '}
            to {nextTierName}
          </p>
        ) : (
          <p className="mt-0.5 text-xs font-medium text-gold-700 dark:text-gold-400">
            Highest tier reached
          </p>
        )}
        {earnRate && (
          <p className="mt-1 text-xs text-muted-foreground">{earnRate}</p>
        )}
      </div>
    </div>
  )
}

export default RewardProgressRing
