'use client'

// src/components/snak/screens/my-orders-screen.tsx
//
// Wave 3 — Task 3D: My Orders screen (active + history) with reorder.
//
// Replaces the legacy `OrdersScreen` (Task 2B) for the Orders tab. Upgrades:
//  • Active + History sections with distinct card styling per DESIGN_SYSTEM.md §5.2.3.
//  • Live status badge (animated `snak-live-dot` / `snak-pulse-ring`) on active orders.
//  • Pickup OTP visually emphasized on READY_FOR_PICKUP cards.
//  • Reorder CTA on history cards → confirm dialog → cart.clear() (if switching
//    restaurants) → cart.add for each item → toast → onReorder(restaurantId).
//  • Pull-to-refresh.
//  • Realtime: subscribes to `order:updated` + `order:created` socket events
//    → silently refetches the orders list. Uses the singleton `realtimeSocket()`
//    from `@/hooks/use-realtime` (does NOT register a new connection).
//  • framer-motion stagger on list mount + AnimatePresence for add/remove.
//  • Loading skeleton list (OrderCardSkeleton, Task 1B).
//  • Empty state with illustration + "Browse restaurants" CTA.
//
// Governance (Task 3D):
//  - Does NOT touch any API route (read-only GET /api/orders?role=consumer).
//  - Does NOT touch consumer-view.tsx, orders-screen.tsx, order-tracking.tsx,
//    cart-store.ts, payment/fulfilment/pickup governance files, or prisma schema.
//  - Uses Task 1B outputs (EmptyState, OrderCardSkeleton), Task 1C cart store
//    (calls cart.add / cart.clear — additive consumer only).
//
// IMPORTANT: The GET /api/orders response's `items` array does NOT include
// `menuItemId` (only `id`, `name`, `price`, `quantity`, `subtotal`). The
// OrderItem type marks `menuItemId` as optional. When constructing the MenuItem
// payload for cart.add, we fall back to the OrderItem's `id` (or a synthetic
// derived id) so reorder always works end-to-end. `isVeg` defaults to false
// per the task spec — the cart bar / detail screen will show the proper veg
// badge once the user lands on the restaurant-detail screen.

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCart } from '@/lib/cart-store'
import { realtimeSocket } from '@/hooks/use-realtime'
import { inr, STATUS_META, timeAgo } from '@/lib/snack'
import { toast } from '@/components/snak/premium-toast'
import type { Order, OrderItem, MenuItem } from '@/lib/types'
import { cn } from '@/lib/utils'

import { EmptyState } from '@/components/snak/empty-state'
import { OrderCardSkeleton } from '@/components/snak/skeleton-loader'

// ════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

/** Orders whose status matches one of these are considered "history" (terminal). */
const HISTORY_STATUSES = new Set(['PICKED_UP', 'CANCELLED'])

/** Active statuses that should pulse (live). */
const LIVE_PULSING_STATUSES = new Set([
  'CONFIRMED',
  'PAID',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
])

/** The status that warrants the strongest "ready" emphasis. */
const READY_FOR_PICKUP = 'READY_FOR_PICKUP'

/** Pull-to-refresh gesture threshold (px) — past this on release triggers refetch. */
const PULL_THRESHOLD = 70
/** Max pull distance rendered (rubber-banded). */
const PULL_MAX = 100

// ════════════════════════════════════════════════════════════════════════════
//  PROPS
// ════════════════════════════════════════════════════════════════════════════

export interface MyOrdersScreenProps {
  /** Called when the user taps any order card (active or history). */
  onOpenOrder: (order: Order) => void
  /** Called after a successful reorder — parent navigates to restaurant detail. */
  onReorder: (restaurantId: string) => void
  /** Called when the empty-state "Browse restaurants" CTA is tapped. */
  onBrowseRestaurants: () => void
}

// ════════════════════════════════════════════════════════════════════════════
//  MOTION PRESETS (DESIGN_SYSTEM.md §6.4 — stagger pattern)
// ════════════════════════════════════════════════════════════════════════════

const SECTION_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } },
}

const CARD_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.3, 0, 0, 1] },
  },
}

const CARD_EXIT: Variants = {
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.18, ease: [0.3, 0, 0, 1] },
  },
}

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Last 6 chars of the order id, uppercased — short human-readable order #. */
function orderShortId(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`
}

/**
 * Format the order's createdAt as a date label.
 * - Same day → "Today, 2:15 PM"
 * - Yesterday → "Yesterday, 2:15 PM"
 * - Within 7 days → "Mon, 2:15 PM"
 * - Older → "12 Mar, 2:15 PM"
 */
function formatHistoryDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((dayStart(now) - dayStart(d)) / 86400_000)

  if (dayDiff <= 0) return `Today, ${time}`
  if (dayDiff === 1) return `Yesterday, ${time}`
  if (dayDiff < 7) {
    const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' })
    return `${weekday}, ${time}`
  }
  const day = d.getDate()
  const month = d.toLocaleDateString('en-IN', { month: 'short' })
  return `${day} ${month}, ${time}`
}

/** Build a MenuItem-shaped object from an OrderItem so cart.add accepts it.
 *  Falls back gracefully when the API omits `menuItemId` (the GET /api/orders
 *  response currently does — see file header note). */
function orderItemToMenuItem(item: OrderItem): MenuItem {
  const id = item.menuItemId ?? item.id ?? `oi-${item.name}`
  return {
    id,
    name: item.name,
    description: '',
    price: item.price,
    image: '',
    spiceLevel: 0,
    isVeg: false, // Task 3D spec: default false; real badge shown after navigation
    isAvailable: true,
    category: 'Reorder',
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  MyOrdersScreen
// ════════════════════════════════════════════════════════════════════════════

export function MyOrdersScreen({
  onOpenOrder,
  onReorder,
  onBrowseRestaurants,
}: MyOrdersScreenProps) {
  const prefersReduced = useReducedMotion()
  const cart = useCart()

  // ── Orders state ───────────────────────────────────────────────────────────
  const [orders, setOrders] = React.useState<Order[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // ── Reorder confirm dialog state ────────────────────────────────────────────
  // The "primary" confirm ("Add all N items from {restaurant} to your cart?").
  const [reorderTarget, setReorderTarget] = React.useState<Order | null>(null)
  // The "secondary" confirm ("This will clear your current cart. Continue?"),
  // shown only if cart has items from a DIFFERENT restaurant.
  const [switchConfirmOpen, setSwitchConfirmOpen] = React.useState(false)

  // ── Pull-to-refresh state ────────────────────────────────────────────────────
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const startYRef = React.useRef<number | null>(null)
  const [pullDistance, setPullDistance] = React.useState(0)
  const [pullActive, setPullActive] = React.useState(false)

  // ── Fetch orders (GET /api/orders?role=consumer) ─────────────────────────────
  const fetchOrders = React.useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    if (!silent) {
      setLoading(true)
      setError(null)
    } else {
      setRefreshing(true)
    }
    try {
      const res = await fetch('/api/orders?role=consumer&limit=50', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json().catch(() => ({}))) as { orders?: Order[] }
      setOrders(data.orders ?? [])
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load orders'
      if (!silent) {
        setError(msg)
      } else {
        toast.error("Couldn't refresh orders", {
          description: msg,
        })
      }
    } finally {
      if (!silent) setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  // Initial load
  React.useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  // ── Realtime subscription (order:updated + order:created) ─────────────────────
  React.useEffect(() => {
    const sock = realtimeSocket()
    const refresh = () => void fetchOrders({ silent: true })
    sock.on('order:updated', refresh)
    sock.on('order:created', refresh)
    return () => {
      sock.off('order:updated', refresh)
      sock.off('order:created', refresh)
    }
  }, [fetchOrders])

  // ── Auto-refresh "time ago" labels every 30s while mounted ───────────────────
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Partition into Active + History ────────────────────────────────────────
  const active = orders.filter((o) => !HISTORY_STATUSES.has(o.status))
  const history = orders.filter((o) => HISTORY_STATUSES.has(o.status))

  // ── Reorder handler ─────────────────────────────────────────────────────────
  const performReorder = React.useCallback(
    (order: Order) => {
      const restaurantId = order.restaurant.id
      const restaurantName = order.restaurant.name
      const items = order.items ?? []

      // If cart currently has items from a different restaurant, clear first.
      // (The cart.add() implementation ALSO clears automatically when the
      // restaurant changes — but we explicitly clear here so the user's
      // intent is unambiguous + the toast copy is accurate.)
      if (
        cart.restaurantId &&
        cart.restaurantId !== restaurantId &&
        cart.count() > 0
      ) {
        cart.clear()
      }

      // cart.add() only increments by 1 — call once per unit of quantity.
      let addedCount = 0
      for (const item of items) {
        const menuItem = orderItemToMenuItem(item)
        for (let i = 0; i < Math.max(1, item.quantity); i++) {
          cart.add(menuItem, restaurantId, restaurantName)
          addedCount++
        }
      }

      toast.success(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} to cart`, {
        description: `From ${restaurantName}`,
      })

      // Hand off to parent for navigation.
      onReorder(restaurantId)
    },
    [cart, onReorder],
  )

  /** User tapped "Reorder" on a history card → show primary confirm dialog. */
  const handleReorderTap = React.useCallback((order: Order) => {
    setReorderTarget(order)
  }, [])

  /** Primary confirm dialog → either proceed directly or show secondary
   *  confirm if cart has items from a different restaurant. */
  const handlePrimaryConfirm = React.useCallback(() => {
    if (!reorderTarget) return
    const targetRestaurantId = reorderTarget.restaurant.id
    const cartHasDifferentRestaurant =
      cart.restaurantId &&
      cart.restaurantId !== targetRestaurantId &&
      cart.count() > 0

    setReorderTarget(null)
    if (cartHasDifferentRestaurant) {
      // Show the secondary confirm — wait for user's "Continue" before clearing.
      setSwitchConfirmOpen(true)
    } else {
      // No conflict — proceed immediately.
      performReorder(reorderTarget)
    }
  }, [reorderTarget, cart, performReorder])

  /** Secondary confirm (cart switch) → user accepted clearing → proceed. */
  const handleSwitchConfirm = React.useCallback(() => {
    setSwitchConfirmOpen(false)
    if (reorderTarget) {
      performReorder(reorderTarget)
    }
  }, [reorderTarget, performReorder])

  // ── Pull-to-refresh handlers ────────────────────────────────────────────────
  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    const el = scrollRef.current
    if (!el || el.scrollTop > 0) return
    startYRef.current = e.touches[0]?.clientY ?? null
    setPullActive(true)
  }, [])

  const onTouchMove = React.useCallback(
    (e: React.TouchEvent) => {
      if (startYRef.current === null) return
      const el = scrollRef.current
      if (!el || el.scrollTop > 0) {
        // user scrolled back down — cancel pull
        startYRef.current = null
        setPullDistance(0)
        setPullActive(false)
        return
      }
      const deltaY = e.touches[0]?.clientY - startYRef.current
      if (deltaY <= 0) {
        setPullDistance(0)
        return
      }
      // Rubber-band: diminishing returns as user pulls further.
      const eased = Math.min(PULL_MAX, deltaY * 0.5)
      setPullDistance(eased)
    },
    [],
  )

  const onTouchEnd = React.useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD) {
      void fetchOrders({ silent: true })
    }
    startYRef.current = null
    setPullDistance(0)
    setPullActive(false)
  }, [pullDistance, fetchOrders])

  // ── Render ─────────────────────────────────────────────────────────────────
  const pullProgress = Math.min(1, pullDistance / PULL_THRESHOLD)
  const pullRotation = prefersReduced ? 0 : pullProgress * 360

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            My Orders
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Track active orders and reorder from past pickups.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void fetchOrders({ silent: false })}
          disabled={loading || refreshing}
          aria-label="Refresh orders"
        >
          <RefreshCw
            className={cn('h-4 w-4', (loading || refreshing) && 'animate-spin')}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </header>

      {/* ── Pull-to-refresh indicator (decorative) ─────────────────────────── */}
      {pullActive && (
        <div
          className="pointer-events-none mb-2 flex items-center justify-center"
          style={{ height: pullDistance }}
          aria-hidden="true"
        >
          <RefreshCw
            className="h-5 w-5 text-primary"
            style={{
              transform: `rotate(${pullRotation}deg)`,
              transition: prefersReduced ? 'none' : 'transform 0.1s linear',
            }}
          />
          <span className="ml-2 text-xs text-muted-foreground">
            {pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="min-h-0"
      >
        {/* Error state — inline retry card */}
        {error && !loading && (
          <ErrorCard
            message={error}
            onRetry={() => void fetchOrders()}
            className="mb-4"
          />
        )}

        {/* Loading state */}
        {loading && (
          <div className="space-y-3" role="status" aria-label="Loading orders">
            <span className="sr-only">Loading your orders…</span>
            {Array.from({ length: 4 }).map((_, i) => (
              <OrderCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Empty state — no orders at all */}
        {!loading && !error && orders.length === 0 && (
          <EmptyState
            variant="no-orders"
            className="py-12"
            actionLabel="Browse restaurants"
            onAction={onBrowseRestaurants}
          />
        )}

        {/* Orders list */}
        {!loading && !error && orders.length > 0 && (
          <motion.div
            variants={SECTION_CONTAINER}
            initial={prefersReduced ? false : 'hidden'}
            animate="show"
            className="space-y-6"
          >
            {/* ── ACTIVE section ───────────────────────────────────────────── */}
            {active.length > 0 && (
              <section aria-labelledby="my-orders-active-heading">
                <h2
                  id="my-orders-active-heading"
                  className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full bg-emerald-500',
                      !prefersReduced && 'snak-live-dot',
                    )}
                    aria-hidden="true"
                  />
                  Active ({active.length})
                </h2>
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {active.map((order) => (
                      <motion.div
                        key={order.id}
                        variants={CARD_ITEM}
                        initial={prefersReduced ? false : 'hidden'}
                        animate="show"
                        exit="exit"
                        layout={!prefersReduced}
                      >
                        <ActiveOrderCard
                          order={order}
                          onOpen={() => onOpenOrder(order)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            {/* ── HISTORY section ──────────────────────────────────────────── */}
            {history.length > 0 && (
              <section aria-labelledby="my-orders-history-heading">
                <h2
                  id="my-orders-history-heading"
                  className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  History ({history.length})
                </h2>
                <div className="space-y-2">
                  <AnimatePresence initial={false}>
                    {history.map((order) => (
                      <motion.div
                        key={order.id}
                        variants={CARD_ITEM}
                        initial={prefersReduced ? false : 'hidden'}
                        animate="show"
                        exit="exit"
                        layout={!prefersReduced}
                      >
                        <HistoryOrderCard
                          order={order}
                          onOpen={() => onOpenOrder(order)}
                          onReorderTap={() => handleReorderTap(order)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}
          </motion.div>
        )}
      </div>

      {/* ── Reorder primary confirm dialog ─────────────────────────────────── */}
      <AlertDialog
        open={reorderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReorderTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add items to cart?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <span>
                Add all{' '}
                <strong className="font-semibold text-foreground">
                  {reorderTarget?.itemsCount ?? 0} item
                  {(reorderTarget?.itemsCount ?? 0) === 1 ? '' : 's'}
                </strong>{' '}
                from{' '}
                <strong className="font-semibold text-foreground">
                  {reorderTarget?.restaurant.name ?? 'this restaurant'}
                </strong>{' '}
                to your cart?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-teal-600 hover:bg-teal-700"
              onClick={handlePrimaryConfirm}
            >
              <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
              Add to cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reorder secondary confirm (cart switch) ───────────────────────── */}
      <AlertDialog
        open={switchConfirmOpen}
        onOpenChange={setSwitchConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace cart items?</AlertDialogTitle>
            <AlertDialogDescription>
              Your cart already has items from a different restaurant. Adding
              these items will clear your current cart. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-teal-600 hover:bg-teal-700"
              onClick={handleSwitchConfirm}
            >
              Clear &amp; add
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  ActiveOrderCard
//  Per DESIGN_SYSTEM.md §5.2.3 — rounded-2xl, border-2 teal, live status pill.
// ════════════════════════════════════════════════════════════════════════════

interface ActiveOrderCardProps {
  order: Order
  onOpen: () => void
}

function ActiveOrderCard({ order, onOpen }: ActiveOrderCardProps) {
  const prefersReduced = useReducedMotion()
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED
  const isLive = LIVE_PULSING_STATUSES.has(order.status)
  const isReady = order.status === READY_FOR_PICKUP

  // Live status pill — pulses for active statuses, success-green for READY.
  const statusPillClass = isReady
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    : meta.tone

  // Card border — teal-300 for active, emerald-500 for READY (per spec).
  const cardBorderClass = isReady
    ? 'border-emerald-400 dark:border-emerald-700'
    : 'border-teal-300 dark:border-teal-700'

  const cardPulseClass = isReady && !prefersReduced ? 'snak-pulse-ring' : ''

  const itemsLabel = `${order.itemsCount} item${order.itemsCount === 1 ? '' : 's'}`

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open active order from ${order.restaurant.name}, status ${meta.short}, ${order.itemsCount} items, total ${inr(order.totalAmount)}`}
      className={cn(
        'snak-focus-ring relative flex w-full items-start gap-3 rounded-2xl border-2 bg-card p-4 text-left transition hover:shadow-md',
        cardBorderClass,
        cardPulseClass,
      )}
    >
      {/* Restaurant thumbnail */}
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-500 text-xl"
        aria-hidden="true"
      >
        🍽
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-foreground">
              {order.restaurant.name}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {orderShortId(order.id)} · {itemsLabel} · {timeAgo(order.createdAt)}
            </p>
          </div>
          <LiveStatusBadge
            label={meta.short}
            tone={statusPillClass}
            live={isLive}
          />
        </div>

        {/* Pickup OTP — emphasized when READY_FOR_PICKUP */}
        {isReady && (
          <div
            className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-500/10 p-3"
            aria-label={`Pickup code ${order.pickupOtp}`}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Pickup code
            </span>
            <span className="font-mono text-2xl font-bold tracking-[0.3em] text-emerald-700 dark:text-emerald-300">
              {order.pickupOtp}
            </span>
          </div>
        )}

        {/* Footer: total + chevron */}
        <div className="mt-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-semibold text-foreground">{inr(order.totalAmount)}</p>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-300">
            Track
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  HistoryOrderCard
//  Per DESIGN_SYSTEM.md §5.2.3 — rounded-xl, default border, completed/
//  cancelled badge + reorder CTA.
// ════════════════════════════════════════════════════════════════════════════

interface HistoryOrderCardProps {
  order: Order
  onOpen: () => void
  onReorderTap: () => void
}

function HistoryOrderCard({ order, onOpen, onReorderTap }: HistoryOrderCardProps) {
  const isCancelled = order.status === 'CANCELLED'
  const meta = STATUS_META[order.status] ?? STATUS_META.PICKED_UP

  // Completed (green) vs Cancelled (red) status badge.
  const StatusIcon: LucideIcon = isCancelled ? XCircle : CheckCircle2
  const statusBadgeClass = isCancelled
    ? 'bg-red-500/15 text-red-700 dark:text-red-300'
    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'

  const itemsLabel = `${order.itemsCount} item${order.itemsCount === 1 ? '' : 's'}`
  const itemsPreview =
    order.items?.slice(0, 2).map((i) => i.name).join(', ') +
    (order.items && order.items.length > 2 ? ` +${order.items.length - 2}` : '')

  const cardClass = cn(
    'snak-card relative flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition',
    isCancelled ? 'opacity-75' : 'hover:shadow-md',
  )

  return (
    <div className={cardClass}>
      {/* Whole card tap → onOpen (separate from the Reorder button below). */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open past order from ${order.restaurant.name}, ${order.itemsCount} items, total ${inr(order.totalAmount)}, placed ${formatHistoryDate(order.createdAt)}`}
        className="snak-focus-ring flex flex-1 items-start gap-3 text-left"
      >
        {/* Thumbnail */}
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-xl',
            isCancelled
              ? 'bg-muted text-muted-foreground'
              : 'bg-gradient-to-br from-teal-400 to-emerald-500',
          )}
          aria-hidden="true"
        >
          {isCancelled ? '✕' : '🍽'}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-semibold text-foreground">
              {order.restaurant.name}
            </p>
            <Badge className={cn('gap-1 text-[10px]', statusBadgeClass)}>
              <StatusIcon className="h-3 w-3" aria-hidden="true" />
              {meta.short}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {orderShortId(order.id)} · {itemsLabel} · {formatHistoryDate(order.createdAt)}
          </p>
          {itemsPreview && (
            <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">
              {itemsPreview}
            </p>
          )}
          <p
            className={cn(
              'mt-2 font-semibold text-foreground',
              isCancelled && 'line-through',
            )}
          >
            {inr(order.totalAmount)}
          </p>
        </div>
      </button>

      {/* Reorder CTA — separate hit area, calls onReorderTap (does NOT open). */}
      {!isCancelled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onReorderTap()
          }}
          className="ml-2 shrink-0 self-end border-teal-300 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-950/40"
          aria-label={`Reorder from ${order.restaurant.name}`}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Reorder
        </Button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  LiveStatusBadge — animated dot + label
// ════════════════════════════════════════════════════════════════════════════

function LiveStatusBadge({
  label,
  tone,
  live,
}: {
  label: string
  tone: string
  live: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        tone,
      )}
      aria-live="polite"
      aria-atomic="true"
    >
      {live && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full bg-current snak-live-dot')}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  ErrorCard — inline retry
// ════════════════════════════════════════════════════════════════════════════

function ErrorCard({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40',
        className,
      )}
    >
      <AlertTriangle
        className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-red-900 dark:text-red-100">
          Couldn&apos;t load your orders
        </p>
        <p className="mt-0.5 truncate text-xs text-red-700 dark:text-red-300">
          {message}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="shrink-0"
      >
        <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  Default export — convenience for dynamic import callers that prefer it.
// ════════════════════════════════════════════════════════════════════════════

export default MyOrdersScreen
