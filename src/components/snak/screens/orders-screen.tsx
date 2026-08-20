'use client'

// src/components/snak/screens/orders-screen.tsx
//
// Orders tab — refactored from the legacy consumer-view.tsx "My Orders" view.
//
// Two sections:
//  - Active orders (status !== PICKED_UP && status !== CANCELLED)
//  - History    (status === PICKED_UP || status === CANCELLED)
//
// Tapping an order opens the OrderTracking component as a full-screen overlay
// (managed by the consumer-view host via ui-store.openTracking). This screen
// just renders the lists — the overlay is rendered at the host level so it can
// overlay any active tab, not just this one.
//
// Governance (Task 2B):
//  - Uses existing GET /api/orders?role=consumer endpoint (read-only).
//  - Does NOT touch order/payment/fulfilment APIs.
//  - Uses Task 1B components: EmptyState, SkeletonLoader's OrderCardSkeleton.

import * as React from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { inr, STATUS_META, timeAgo } from '@/lib/snack'
import { useUI } from '@/lib/ui-store'
import type { Order } from '@/lib/types'

import { EmptyState } from '@/components/snak/empty-state'
import { OrderCardSkeleton } from '@/components/snak/skeleton-loader'

// ─────────────────────────────────────────────────────────────────────────────
// Motion presets
// ─────────────────────────────────────────────────────────────────────────────

const LIST_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } },
}
const LIST_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.3, 0, 0, 1] },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// OrdersScreen
// ─────────────────────────────────────────────────────────────────────────────

export interface OrdersScreenProps {
  /** Pre-loaded orders, if the host already fetched them. */
  orders?: Order[]
  /** Whether the host is currently fetching. */
  loading?: boolean
  /** Called when this screen mounts and the host should re-fetch orders. */
  onMount?: () => void
}

export function OrdersScreen({ orders, loading, onMount }: OrdersScreenProps) {
  const prefersReduced = useReducedMotion()
  const openTracking = useUI((s) => s.openTracking)

  React.useEffect(() => {
    onMount?.()
  }, [onMount])

  const safeOrders = orders ?? []
  const active = safeOrders.filter((o) => o.status !== 'PICKED_UP' && o.status !== 'CANCELLED')
  const past = safeOrders.filter((o) => o.status === 'PICKED_UP' || o.status === 'CANCELLED')

  function handleOpen(order: Order) {
    openTracking(order.id)
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">My Orders</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Track active orders and revisit past pickups.
        </p>
      </header>

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading orders">
          <span className="sr-only">Loading your orders…</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      ) : safeOrders.length === 0 ? (
        <EmptyState
          variant="no-orders"
          className="py-12"
          actionLabel="Browse restaurants"
          onAction={() => useUI.getState().setActiveTab('explore')}
        />
      ) : (
        <motion.div
          variants={LIST_CONTAINER}
          initial={prefersReduced ? false : 'hidden'}
          animate="show"
          className="space-y-6"
        >
          {active.length > 0 && (
            <section aria-labelledby="orders-active">
              <h2
                id="orders-active"
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Active ({active.length})
              </h2>
              <div className="space-y-2">
                {active.map((o) => (
                  <motion.div key={o.id} variants={LIST_ITEM}>
                    <OrderListItem order={o} onOpen={() => handleOpen(o)} />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section aria-labelledby="orders-history">
              <h2
                id="orders-history"
                className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                History ({past.length})
              </h2>
              <div className="space-y-2">
                {past.map((o) => (
                  <motion.div key={o.id} variants={LIST_ITEM}>
                    <OrderListItem order={o} onOpen={() => handleOpen(o)} />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {active.length === 0 && past.length === 0 && (
            <EmptyState variant="no-orders" className="py-12" />
          )}
        </motion.div>
      )}

      {/* Soft-fail notice — surface silently via aria-live so screen readers know. */}
      {safeOrders.length === 0 && !loading && (
        <p className="sr-only" aria-live="polite">
          You have no orders yet.
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// OrderListItem — preserved from the legacy consumer-view (single source).
// ═══════════════════════════════════════════════════════════════════════════

function OrderListItem({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED
  const isActive = order.status !== 'PICKED_UP' && order.status !== 'CANCELLED'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open order from ${order.restaurant.name}, ${order.itemsCount} items, ${meta.short}`}
      className="snak-focus-ring flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:shadow-md"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-500 text-xl">
        🍽
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{order.restaurant.name}</span>
          <Badge className={`text-[10px] ${meta.tone}`}>{meta.short}</Badge>
          {order.isCatering && (
            <Badge variant="secondary" className="text-[10px]">
              Catering
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {order.itemsCount} items · #{order.id.slice(-6).toUpperCase()} · {timeAgo(order.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold text-foreground">{inr(order.totalAmount)}</p>
        {isActive && (
          <p className="font-mono text-xs text-teal-600 dark:text-teal-300">OTP {order.pickupOtp}</p>
        )}
      </div>
    </button>
  )
}

export default OrdersScreen
