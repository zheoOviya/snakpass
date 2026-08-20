'use client'

// src/components/snak/order-tracking.tsx
//
// Wave 3 Task 3C — Premium order tracking timeline (rewritten in-place).
//
// Preserves the existing `OrderTracking` export name + `{ order: Order }` prop
// signature so existing imports (consumer-view.tsx, etc.) keep working.
//
// What's new vs the legacy component:
//   1. Hero header — gradient (teal/emerald) with restaurant name, address,
//      status badge, and an sr-only status announcement (aria-live).
//   2. Vertical timeline — up to 7 steps. The new "Restaurant Accepted" step
//      is rendered ONLY when the vendor has accepted (Fulfilment.acceptedAt
//      is set) — drives the timeline from 6 steps to 7.
//   3. Estimated ready time — `createdAt + prepTimeMins` countdown shown
//      while PREPARING / ALMOST_READY, hidden once READY_FOR_PICKUP.
//   4. Restaurant contact button — tel: link to call the restaurant.
//   5. Pickup instructions card — large QR + 6-digit OTP + Share button
//      (copies to clipboard + toast). Shown when status >= READY_FOR_PICKUP.
//   6. Receipt download placeholder — button → toast "Receipt coming soon".
//   7. framer-motion step transitions (checkmark spring, active pulse).
//   8. Realtime — subscribes to `order:updated` socket → refetches the
//      acceptedAt timestamp from /api/orders/[id]/accepted.
//
// Governance:
//   - Does NOT touch src/app/api/orders/[id]/fulfilment/route.ts (P0-06).
//   - Does NOT touch src/lib/fulfilment-state.ts (P0-06 state machine).
//   - Reads Fulfilment.acceptedAt via the new additive
//     GET /api/orders/[id]/accepted endpoint (created in this same task —
//     small purely-additive route that exposes ONLY acceptedAt, since the
//     P0-06 GET /fulfilment endpoint predates the acceptedAt column and
//     does not include it in its response).

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import {
  Check,
  Loader2,
  Phone,
  Receipt,
  Share2,
  Clock,
  ChefHat,
  Bell,
  PartyPopper,
  ShoppingBag,
  CreditCard,
  Utensils,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { realtimeSocket } from '@/hooks/use-realtime'
import { cn } from '@/lib/utils'
import {
  STATUS_META,
  inr,
  statusHistoryArray,
  timeAgo,
  formatCountdown,
} from '@/lib/snack'
import type { Order } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Placeholder phone for the "Call restaurant" button. The Restaurant model
 * has no phone column (only address), so we use a dummy Indian toll-free
 * number as a stand-in until a phone column is added in a future wave.
 */
const RESTAURANT_PHONE_PLACEHOLDER = '+918000000000'

/**
 * Internal timeline step keys. The PREPARING / ALMOST_READY / READY_FOR_PICKUP
 * / PICKED_UP values mirror Order.status (the consumer-visible canonical flow).
 *
 * The "ACCEPTED" step is special — it is NOT an Order.status value. It is
 * driven by the additive Fulfilment.acceptedAt column (set by the new
 * POST /api/vendor/orders/[id]/accept endpoint) and inserted between
 * PAYMENT_CONFIRMED and PREPARING only when acceptedAt is set.
 */
type StepKey =
  | 'ORDER_PLACED'
  | 'PAYMENT_CONFIRMED'
  | 'RESTAURANT_ACCEPTED'
  | 'PREPARING'
  | 'ALMOST_READY'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'

interface TimelineStep {
  key: StepKey
  label: string
  /** Short helper copy shown under the label when active/done. */
  helper?: string
  /** lucide icon for the step circle (when not done). */
  Icon: React.ComponentType<{ className?: string }>
  /** ISO timestamp when this step was completed (from statusHistory or acceptedAt). */
  timestamp?: string
  /** 'done' | 'active' | 'future' */
  state: 'done' | 'active' | 'future'
}

// ─────────────────────────────────────────────────────────────────────────────
// AcceptedState — fetched from /api/orders/[id]/accepted
// ─────────────────────────────────────────────────────────────────────────────

interface AcceptedState {
  orderId: string
  fulfilmentId: string
  acceptedAt: string | null
  accepted: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function OrderTracking({ order }: { order: Order }) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()

  // ── acceptedAt fetch (mounted + on realtime update) ──────────────────────
  const [accepted, setAccepted] = React.useState<AcceptedState | null>(null)
  const [acceptedLoading, setAcceptedLoading] = React.useState(true)

  const fetchAccepted = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${order.id}/accepted`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json().catch(() => null)) as AcceptedState | null
      if (data) setAccepted(data)
    } catch {
      /* best-effort — UI still renders without acceptedAt */
    } finally {
      setAcceptedLoading(false)
    }
  }, [order.id])

  React.useEffect(() => {
    void fetchAccepted()
  }, [fetchAccepted])

  // ── Realtime: re-fetch acceptedAt when the order is updated ──────────────
  React.useEffect(() => {
    const sock = realtimeSocket()
    const handler = (p: { orderId?: string }) => {
      if (!p?.orderId || p.orderId === order.id) {
        void fetchAccepted()
      }
    }
    sock.on('order:updated', handler)
    return () => {
      sock.off('order:updated', handler)
    }
  }, [order.id, fetchAccepted])

  // ── Countdown to estimated ready time ────────────────────────────────────
  const prepTimeMins = order.restaurant.prepTimeMins ?? 20
  const estimatedReadyAt = React.useMemo(() => {
    return new Date(new Date(order.createdAt).getTime() + prepTimeMins * 60 * 1000)
  }, [order.createdAt, prepTimeMins])

  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    // Only tick while we're in PREPARING / ALMOST_READY (no need to keep
    // ticking after the order is ready / picked up).
    if (order.status !== 'PREPARING' && order.status !== 'ALMOST_READY') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [order.status])

  const showCountdown =
    (order.status === 'PREPARING' || order.status === 'ALMOST_READY') &&
    estimatedReadyAt.getTime() > now

  const countdownLabel = showCountdown
    ? formatCountdown(estimatedReadyAt.getTime() - now)
    : null

  // ── Build the timeline steps ─────────────────────────────────────────────
  const history = statusHistoryArray(order.statusHistory)
  const isPickedUp = order.status === 'PICKED_UP'
  const isCancelled = order.status === 'CANCELLED'
  const isReady = order.status === 'READY_FOR_PICKUP'

  // Find a status timestamp from the order's statusHistory.
  const tsFor = (status: string): string | undefined =>
    history.find((h) => h.status === status)?.at

  // Determine which steps are done / active / future.
  // The canonical Order.status flow is:
  //   CONFIRMED → PAID → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP
  // (CANCELLED is terminal.)
  const orderStatusRank: Record<string, number> = {
    CONFIRMED: 0,
    PAID: 1,
    PREPARING: 2,
    ALMOST_READY: 3,
    READY_FOR_PICKUP: 4,
    PICKED_UP: 5,
    CANCELLED: -1,
  }
  const currentRank = orderStatusRank[order.status] ?? 0

  // Build the ordered step list (conditionally inserting RESTAURANT_ACCEPTED).
  const steps: TimelineStep[] = []

  steps.push({
    key: 'ORDER_PLACED',
    label: 'Order Placed',
    Icon: ShoppingBag,
    timestamp: order.createdAt,
    state: 'done',
  })

  steps.push({
    key: 'PAYMENT_CONFIRMED',
    label: 'Payment Confirmed',
    Icon: CreditCard,
    timestamp: tsFor('PAID'),
    state:
      currentRank >= 1
        ? 'done'
        : currentRank === 0
          ? 'active'
          : 'future',
    helper: currentRank === 0 ? 'Waiting for payment…' : undefined,
  })

  // ← NEW: insert the RESTAURANT_ACCEPTED step ONLY when acceptedAt is set.
  if (accepted?.acceptedAt) {
    steps.push({
      key: 'RESTAURANT_ACCEPTED',
      label: 'Restaurant Accepted',
      Icon: Utensils,
      timestamp: accepted.acceptedAt,
      state: 'done',
      helper: `${order.restaurant.name} is starting your order`,
    })
  }

  steps.push({
    key: 'PREPARING',
    label: 'Preparing in Kitchen',
    Icon: ChefHat,
    timestamp: tsFor('PREPARING'),
    state:
      currentRank > 2
        ? 'done'
        : currentRank === 2
          ? 'active'
          : 'future',
    helper: currentRank === 2 ? 'In the kitchen…' : undefined,
  })

  steps.push({
    key: 'ALMOST_READY',
    label: 'Almost Ready',
    Icon: Clock,
    timestamp: tsFor('ALMOST_READY'),
    state:
      currentRank > 3
        ? 'done'
        : currentRank === 3
          ? 'active'
          : 'future',
    helper: currentRank === 3 ? 'Just a few minutes…' : undefined,
  })

  steps.push({
    key: 'READY_FOR_PICKUP',
    label: 'Ready for Pickup',
    Icon: Bell,
    timestamp: tsFor('READY_FOR_PICKUP'),
    state:
      currentRank > 4
        ? 'done'
        : currentRank === 4
          ? 'active'
          : 'future',
    helper: currentRank === 4 ? 'Show pickup code at counter' : undefined,
  })

  steps.push({
    key: 'PICKED_UP',
    label: 'Picked Up',
    Icon: PartyPopper,
    timestamp: tsFor('PICKED_UP'),
    state: isPickedUp ? 'done' : 'future',
    helper: isPickedUp ? 'Enjoy your meal! 🎉' : undefined,
  })

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSharePickupCode = React.useCallback(async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(order.pickupOtp)
      }
      toast({
        title: 'Pickup code copied',
        description: `Code ${order.pickupOtp} ready to paste.`,
      })
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Copy the code manually instead.',
        variant: 'destructive',
      })
    }
  }, [order.pickupOtp, toast])

  const handleReceipt = React.useCallback(() => {
    toast({ title: 'Receipt coming soon', description: 'We are working on it.' })
  }, [toast])

  // ── Render ────────────────────────────────────────────────────────────────
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED!

  return (
    <Card
      role="region"
      aria-label={`Order tracking timeline for order #${order.id.slice(-6).toUpperCase()}`}
      className={cn(
        'overflow-hidden rounded-2xl p-0',
        isReady && 'border-2 border-teal-300 dark:border-teal-700',
        isCancelled && 'border-2 border-red-300 dark:border-red-700',
      )}
    >
      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          'bg-gradient-to-br from-teal-500 to-emerald-600 px-5 py-4 text-white',
          isCancelled && 'from-muted to-muted text-foreground',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-teal-50/80">
              Pickup Order
            </p>
            <h3 className="truncate text-lg font-bold">{order.restaurant.name}</h3>
            {order.restaurant.address && (
              <p className="mt-0.5 truncate text-sm text-teal-50/90">
                {order.restaurant.address}
              </p>
            )}
          </div>
          <Badge className="bg-white/20 text-white hover:bg-white/30">
            {meta.short}
          </Badge>
        </div>

        {/* sr-only status announcement (polite) */}
        <div aria-live="polite" className="sr-only">
          Order status: {meta.label}.
          {isReady && ' Your order is ready for pickup.'}
          {isPickedUp && ' Your order has been picked up.'}
          {isCancelled && ' Your order was cancelled.'}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* ── Estimated ready time countdown ──────────────────────────────── */}
        {showCountdown && countdownLabel && (
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-center justify-between rounded-xl bg-amber-500/10 px-3 py-2"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Ready in ~
            </span>
            <span className="font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">
              {countdownLabel}
            </span>
          </motion.div>
        )}

        {/* ── Timeline (vertical) ────────────────────────────────────────── */}
        <ol className="relative">
          {steps.map((step, i) => {
            const done = step.state === 'done'
            const active = step.state === 'active'
            const future = step.state === 'future'
            const { Icon } = step

            return (
              <li
                key={step.key}
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
                      done && 'bg-emerald-500 text-white',
                      active && 'bg-teal-500 text-white',
                      active && !isReady && 'snak-live-dot',
                      active && isReady && 'snak-pulse-ring',
                      future && 'bg-muted text-muted-foreground',
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
                          className="flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <Icon className="h-4 w-4" />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="future"
                          initial={false}
                          className="text-muted-foreground"
                          aria-hidden="true"
                        >
                          <Icon className="h-4 w-4" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  {/* Connector line */}
                  {i < steps.length - 1 && (
                    <span
                      className={cn(
                        'absolute left-1/2 top-8 h-[calc(100%-1.5rem)] w-0.5 -translate-x-1/2',
                        done ? 'bg-emerald-400' : 'bg-border',
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
                      active && 'text-teal-700 dark:text-teal-300',
                      done && 'text-foreground',
                      future && 'text-muted-foreground',
                    )}
                  >
                    {step.label}
                  </p>
                  {active && step.helper && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      {step.helper}
                    </p>
                  )}
                  {active && !step.helper && (
                    <p className="mt-0.5 text-xs text-muted-foreground">In progress…</p>
                  )}
                  {done && step.helper && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.helper}</p>
                  )}
                  {done && step.timestamp && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {timeAgo(step.timestamp)}
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

        {/* ── Accepted loading shimmer (while we fetch acceptedAt) ────────── */}
        {acceptedLoading && !isPickedUp && !isCancelled && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
        )}

        {/* ── Restaurant contact ──────────────────────────────────────────── */}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="w-full justify-center"
        >
          <a href={`tel:${RESTAURANT_PHONE_PLACEHOLDER}`} aria-label={`Call ${order.restaurant.name}`}>
            <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Call restaurant
          </a>
        </Button>

        {/* ── Pickup instructions (when status >= READY_FOR_PICKUP) ────────── */}
        {(isReady || isPickedUp) && !isCancelled && (
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            className="rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/50 p-4 dark:border-teal-800 dark:bg-teal-950/30"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isReady ? 'Show this code at the counter' : 'Pickup code'}
            </p>

            <div className="mt-3 flex items-center gap-4">
              <div className="rounded-lg bg-white p-2 shadow-sm dark:bg-background">
                <QRCodeSVG
                  value={`snakzap:pickup:${order.id}:otp:${order.pickupOtp}`}
                  size={96}
                  level="M"
                  aria-label="QR code for pickup verification"
                />
              </div>
              <div className="flex-1">
                <p className="font-mono text-3xl font-bold tracking-[0.3em] text-teal-700 dark:text-teal-300">
                  {order.pickupOtp}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isReady
                    ? 'Show this code at the counter to collect your order.'
                    : 'Order picked up. Code archived for your records.'}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full justify-center"
              onClick={handleSharePickupCode}
            >
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Share pickup code
            </Button>
          </motion.div>
        )}

        {/* ── Items summary ───────────────────────────────────────────────── */}
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {order.itemsCount} item{order.itemsCount !== 1 ? 's' : ''}
          </p>
          {order.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="truncate text-muted-foreground">
                <span className="font-medium text-foreground">{it.quantity}×</span> {it.name}
              </span>
              <span className="ml-2 shrink-0 font-medium text-foreground">
                {inr(it.subtotal)}
              </span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold">
            <span>Total Paid</span>
            <span>{inr(order.totalAmount)}</span>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={handleReceipt}
          >
            <Receipt className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Download receipt
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Order placed {timeAgo(order.createdAt)} · #{order.id.slice(-6).toUpperCase()}
          </p>
        </div>
      </div>
    </Card>
  )
}

export default OrderTracking
