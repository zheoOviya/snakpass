'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_META, statusHistoryArray, timeAgo, inr } from '@/lib/snack'
import type { Order } from '@/lib/types'

/**
 * Premium order tracking timeline v2.
 *
 * Per DESIGN_SYSTEM.md §5.6.1 + blueprint §15:
 * - Vertical timeline with hero header (order #, restaurant, current status badge).
 * - Each step = icon circle (32px) + step label + timestamp.
 * - Connecting line: success-400 if both steps done, muted otherwise.
 * - Active step: snak-live-dot pulse + text-primary label.
 * - Done steps: success-500 filled circle with checkmark.
 * - Future steps: muted circle, muted label.
 *
 * Status flow (canonical — preserve consumer simplification):
 *   CONFIRMED → PAID → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP
 *
 * Motion:
 * - Step completion: circle fills + checkmark scales in (spring).
 * - Active pulse continuous (snak-live-dot from globals.css).
 * - Ready-for-pickup: snak-pulse-ring around active step.
 *
 * Accessibility:
 * - role="region" aria-label "Order tracking timeline for order #X".
 * - Status summary region has aria-live="polite".
 * - Each step has aria-current="step" when active.
 *
 * Dark mode: uses CSS variables (success-* + primary + muted-foreground).
 */

const FLOW = [
  'CONFIRMED',
  'PAID',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
] as const

export interface OrderTimelineV2Props {
  order: Order
  /** ISO date string — estimated ready time. Drives the "Ready ~" copy. */
  estimatedReadyAt?: string
  /** Optional className for the outer card. */
  className?: string
}

export function OrderTimelineV2({
  order,
  estimatedReadyAt,
  className,
}: OrderTimelineV2Props) {
  const prefersReduced = useReducedMotion()
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED!
  const currentStep = FLOW.indexOf(order.status as (typeof FLOW)[number])
  const history = statusHistoryArray(order.statusHistory)
  const isReady = order.status === 'READY_FOR_PICKUP'
  const isPickedUp = order.status === 'PICKED_UP'
  const isCancelled = order.status === 'CANCELLED'

  // Estimate display string
  const readyEstimate = estimatedReadyAt
    ? new Date(estimatedReadyAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <Card
      role="region"
      aria-label={`Order tracking timeline for order #${order.id.slice(-6).toUpperCase()}`}
      className={cn(
        'overflow-hidden p-0 rounded-2xl',
        isReady && 'border-2 border-success-300 dark:border-success-700',
        isCancelled && 'border-2 border-danger-300 dark:border-danger-700',
        className,
      )}
    >
      {/* Hero header — gradient + status pill */}
      <div
        className={cn(
          'snak-gradient-primary px-5 py-4 text-white',
          isCancelled && 'snak-gradient-mesh !bg-muted',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-white/80">Pickup Order</p>
            <h3 className="truncate text-lg font-bold">{order.restaurant.name}</h3>
            {order.restaurant.address && (
              <p className="mt-0.5 truncate text-sm text-white/90">{order.restaurant.address}</p>
            )}
          </div>
          <Badge className="bg-white/20 text-white hover:bg-white/30">{meta.short}</Badge>
        </div>

        {/* Status announcement (polite) */}
        <div aria-live="polite" className="sr-only">
          Order status: {meta.label}.
          {isReady && ' Your order is ready for pickup.'}
          {isPickedUp && ' Your order has been picked up.'}
          {isCancelled && ' Your order was cancelled.'}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Estimated ready time */}
        {readyEstimate && !isPickedUp && !isCancelled && (
          <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {isReady ? 'Ready since' : 'Estimated ready'}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {readyEstimate}
            </span>
          </div>
        )}

        {/* Timeline */}
        <ol className="relative">
          {FLOW.map((status, i) => {
            const m = STATUS_META[status] ?? STATUS_META.CONFIRMED!
            const done = i < currentStep || isPickedUp
            const active = i === currentStep && !isPickedUp && !isCancelled
            const future = i > currentStep && !isCancelled
            const cancelledStep = isCancelled && i === currentStep
            const historyEntry = history.find((h) => h.status === status)

            return (
              <li
                key={status}
                aria-current={active ? 'step' : undefined}
                className="relative flex items-start gap-3 pb-4 last:pb-0"
              >
                {/* Icon circle + connector */}
                <div className="relative flex flex-col items-center">
                  <motion.div
                    initial={false}
                    animate={false}
                    className={cn(
                      'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                      done && 'bg-success-500 text-white',
                      active && 'bg-primary text-primary-foreground',
                      future && 'bg-muted text-muted-foreground',
                      cancelledStep && 'bg-danger-500 text-white',
                      active && isReady && 'snak-pulse-ring',
                      active && !isReady && 'snak-live-dot',
                    )}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {done ? (
                        <motion.span
                          key="done"
                          initial={prefersReduced ? false : { scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </motion.span>
                      ) : active ? (
                        <motion.span
                          key="active"
                          initial={prefersReduced ? false : { scale: 0.6 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
                          className="h-2 w-2 rounded-full bg-current"
                          aria-hidden="true"
                        />
                      ) : (
                        <motion.span
                          key="future"
                          initial={false}
                          className="text-muted-foreground"
                          aria-hidden="true"
                        >
                          {i + 1}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  {/* Connector line */}
                  {i < FLOW.length - 1 && (
                    <span
                      className={cn(
                        'absolute left-1/2 top-8 h-[calc(100%-1.5rem)] w-0.5 -translate-x-1/2',
                        done ? 'bg-success-400' : 'bg-border',
                      )}
                      aria-hidden="true"
                    />
                  )}
                </div>

                {/* Label + timestamp */}
                <div className="min-w-0 flex-1 pt-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      active && 'text-primary',
                      done && 'text-foreground',
                      future && 'text-muted-foreground',
                      cancelledStep && 'text-danger-700 dark:text-danger-400',
                    )}
                  >
                    {m.label}
                  </p>
                  {active && !isReady && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      In progress…
                    </p>
                  )}
                  {active && isReady && (
                    <p className="mt-0.5 text-xs font-medium text-success-700 dark:text-success-400">
                      Show pickup code at counter
                    </p>
                  )}
                  {done && historyEntry && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {timeAgo(historyEntry.at)}
                    </p>
                  )}
                  {future && (
                    <p className="mt-0.5 text-xs text-muted-foreground">Pending</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {/* Pickup OTP */}
        {!isPickedUp && !isCancelled && (
          <div className="mt-4 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pickup OTP
            </p>
            <p
              className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-primary"
              aria-label={`Pickup code ${order.pickupOtp}`}
            >
              {order.pickupOtp}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isReady
                ? 'Show this code at the counter to collect your order.'
                : 'Code activates when your order is ready.'}
            </p>
          </div>
        )}

        {/* Items summary */}
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {order.itemsCount} item{order.itemsCount !== 1 ? 's' : ''}
          </p>
          {order.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="truncate text-muted-foreground">
                <span className="font-medium text-foreground">{it.quantity}×</span> {it.name}
              </span>
              <span className="ml-2 shrink-0 font-medium text-foreground">{inr(it.subtotal)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold">
            <span>Total Paid</span>
            <span>{inr(order.totalAmount)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Order placed {timeAgo(order.createdAt)} · #{order.id.slice(-6).toUpperCase()}
        </p>
      </div>
    </Card>
  )
}

export default OrderTimelineV2
