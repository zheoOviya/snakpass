'use client'

import * as React from 'react'
import { motion, useReducedMotion, animate, useMotionValue } from 'framer-motion'
import { cn } from '@/lib/utils'
import { inr } from '@/lib/snack'

/**
 * Transparent pricing breakdown — blueprint §12 P4 "Transparent pricing".
 *
 * Per DESIGN_SYSTEM.md §5.3 + blueprint §12:
 *
 *   Food subtotal
 *   + tax
 *   + platform fee (if any)
 *   - discount
 *   - reward
 *   = final amount
 *
 * "Never surprise the user at payment." (blueprint §12)
 *
 * Anatomy:
 * - Vertical list of rows: label (left) + amount (right, mono).
 * - Additions render in foreground; subtractions in success/danger accent.
 * - Total row is bold + larger + has top divider.
 * - Each row animates its value on change (count-up via framer-motion).
 *
 * Accessibility:
 * - role="group" with aria-label "Price breakdown".
 * - Total row has aria-live="polite" so screen readers announce changes.
 *
 * Dark mode: uses CSS variables (success-* + danger-* + foreground).
 */

export type PricingRowKind = 'add' | 'sub' | 'total' | 'info'

export interface PricingRow {
  /** Stable key — used for React keys + framer-motion layout. */
  key: string
  /** Row label — e.g., "Subtotal", "GST (5%)", "Platform fee", "Discount", "Reward discount". */
  label: string
  /** Amount in paise (negative for subtractions, or use `kind: 'sub'` for visual cue). */
  amountPaise: number
  /** Visual kind — drives sign prefix and color. */
  kind?: PricingRowKind
  /** Optional helper text below the label (e.g., "Applied 200 pts = ₹20 off"). */
  hint?: string
}

export interface PricingBreakdownProps {
  rows: PricingRow[]
  /** Optional title shown above the breakdown. */
  title?: string
  className?: string
}

export function PricingBreakdown({ rows, title, className }: PricingBreakdownProps) {
  const prefersReduced = useReducedMotion()
  const totalRow = rows.find((r) => r.kind === 'total')
  const totalPaise = totalRow?.amountPaise ?? 0

  return (
    <div
      role="group"
      aria-label={title ?? 'Price breakdown'}
      className={cn('space-y-1.5', className)}
    >
      {title && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      )}

      {rows
        .filter((r) => r.kind !== 'total')
        .map((row) => (
          <PricingRowItem key={row.key} row={row} prefersReduced={!!prefersReduced} />
        ))}

      {/* Total row — separated + emphasised */}
      <div className="!mt-3 flex items-center justify-between border-t pt-2.5">
        <span className="text-sm font-semibold text-foreground">
          {totalRow?.label ?? 'Total'}
        </span>
        <AnimatedAmount
          paise={totalPaise}
          className="font-mono text-base font-bold text-foreground"
          prefersReduced={!!prefersReduced}
          ariaLive="polite"
        />
      </div>
    </div>
  )
}

function PricingRowItem({
  row,
  prefersReduced,
}: {
  row: PricingRow
  prefersReduced: boolean
}) {
  const kind = row.kind ?? (row.amountPaise < 0 ? 'sub' : 'add')
  const isSub = kind === 'sub'
  const isInfo = kind === 'info'

  const sign = isSub ? '−' : '+'

  return (
    <motion.div
      layout={!prefersReduced}
      initial={prefersReduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
      className="flex items-baseline justify-between gap-3"
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm',
            isInfo ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {row.label}
        </p>
        {row.hint && (
          <p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p>
        )}
      </div>
      <AnimatedAmount
        paise={row.amountPaise}
        sign={isSub ? '−' : kind === 'add' ? '+' : undefined}
        className={cn(
          'font-mono text-sm tabular-nums',
          isSub && 'text-success-700 dark:text-success-400',
          isInfo && 'text-muted-foreground',
          !isSub && !isInfo && 'text-foreground',
        )}
        prefersReduced={prefersReduced}
      />
    </motion.div>
  )
}

/**
 * Animated paise amount — count-up when the value changes.
 * Renders the ₹ + rupee value (and optional +/- sign).
 */
function AnimatedAmount({
  paise,
  sign,
  className,
  prefersReduced,
  ariaLive,
}: {
  paise: number
  sign?: '+' | '−'
  className?: string
  prefersReduced: boolean
  ariaLive?: 'polite' | 'assertive' | 'off'
}) {
  const [display, setDisplay] = React.useState(paise)
  const mv = useMotionValue(paise)

  React.useEffect(() => {
    if (prefersReduced) {
      setDisplay(paise)
      return
    }
    mv.set(display)
    const controls = animate(mv, paise, {
      duration: 0.3,
      ease: [0.3, 0, 0, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [paise, prefersReduced])

  const formatted = inr(Math.abs(display))

  return (
    <span
      className={cn(className)}
      aria-live={ariaLive}
      aria-label={`${sign ? sign + ' ' : ''}${inr(Math.abs(paise))}`}
    >
      {sign && <span aria-hidden="true">{sign} </span>}
      {formatted}
    </span>
  )
}

export default PricingBreakdown
