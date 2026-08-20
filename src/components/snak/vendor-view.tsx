'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, useReducedMotion } from 'framer-motion'

// Lazy-load the Vendor Analytics Widget (Task 4C) + Vendor Menu Manager (Task 4B).
// Dynamic imports keep vendor-view.tsx resilient if either component is mid-refactor.
const VendorAnalyticsWidget = dynamic(
  () => import('./vendor-analytics-widget').then((m) => m.VendorAnalyticsWidget),
  { ssr: false, loading: () => <Skeleton className="h-40 w-full rounded-xl" /> },
)
const VendorMenuManager = dynamic(
  () => import('./vendor-menu-manager').then((m) => m.VendorMenuManager),
  { ssr: false, loading: () => <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div> },
)
import {
  Store,
  Clock,
  CheckCircle2,
  ChefHat,
  Bell,
  X,
  UtensilsCrossed,
  Loader2,
  Check,
  Timer,
  AlarmClockCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { csrfFetch } from '@/lib/csrf-client'
import { inr, timeAgo } from '@/lib/snack'
import {
  FULFILMENT_STATUS_META,
  NEXT_FULFILMENT_STATUS,
} from '@/lib/fulfilment-state'
import type { MenuItem, Order, Restaurant } from '@/lib/types'
import { VegBadge, SpiceDots } from './bits'

// Vendor-facing order shape: the base Order from /api/orders plus cached
// P0-06 fulfilment state (status + pickupOtp) fetched via GET /fulfilment AND
// the additive `acceptedAt` timestamp (Task 3C) fetched via
// GET /api/orders/[id]/accepted.
//   - `fulfilmentStatus` is undefined while the fulfilment fetch is in flight
//     or if it failed; the card treats undefined as PREPARING (the lazy-create
//     baseline).
//   - `acceptedAt` is undefined while the accepted fetch is in flight, or null
//     once the fetch resolves + the order has NOT been accepted yet. The card
//     shows the Accept button only when `acceptedAt === null` (i.e. the fetch
//     resolved + acceptedAt is null).
//   - `prepTimeMins` is a client-side override (Task 4A MVP — no API yet).
type VendorOrder = Order & {
  fulfilmentStatus?: string
  fulfilmentOtp?: string
  acceptedAt?: string | null
  prepTimeMins?: number
}

export function VendorView() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [orders, setOrders] = useState<VendorOrder[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  // Per-order prep-time input (Task 4A MVP — client-only). Keyed by orderId;
  // value is the vendor-entered minutes (or undefined = use restaurant default).
  // Future: a PATCH endpoint will persist this server-side.
  const [prepTimeDrafts, setPrepTimeDrafts] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'orders' | 'menu'>('orders')
  const { connected } = useRealtime(['vendor:all'])
  const { toast } = useToast()

  // load restaurants
  useEffect(() => {
    fetch('/api/restaurants')
      .then((r) => r.json())
      .then((d) => {
        setRestaurants(d.restaurants ?? [])
        if (d.restaurants?.[0]) setActiveId(d.restaurants[0].id)
      })
  }, [])

  // Fetch fulfilment status for every active order (Option A from the task spec).
  // GET /api/orders/[id]/fulfilment lazy-creates a Fulfilment row at PREPARING if
  // none exists yet — so newly-confirmed orders surface with `fulfilmentStatus`
  // = 'PREPARING' after the first load.
  const fetchFulfilmentForOrders = useCallback(
    async (orderList: VendorOrder[]): Promise<VendorOrder[]> => {
      const activeOrders = orderList.filter(
        (o) => o.status !== 'PICKED_UP' && o.status !== 'CANCELLED',
      )
      if (activeOrders.length === 0) return orderList
      const results = await Promise.allSettled(
        activeOrders.map(async (o) => {
          const r = await fetch(`/api/orders/${o.id}/fulfilment`)
          if (!r.ok) return null
          return r.json()
        }),
      )
      const fulfilmentById = new Map<string, { status: string; pickupOtp?: string }>()
      activeOrders.forEach((o, i) => {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value?.fulfilment) {
          fulfilmentById.set(o.id, {
            status: r.value.fulfilment.status as string,
            pickupOtp: r.value.fulfilment.pickupOtp as string | undefined,
          })
        }
      })
      return orderList.map((o) => {
        const f = fulfilmentById.get(o.id)
        if (!f) return o
        return {
          ...o,
          fulfilmentStatus: f.status,
          fulfilmentOtp: f.pickupOtp ?? o.pickupOtp,
        }
      })
    },
    [],
  )

  // Fetch the additive `acceptedAt` timestamp (Task 3C) for every active order.
  // Uses the additive GET /api/orders/[id]/accepted endpoint (Task 3C owns it).
  // Only fetches for non-terminal orders to minimize requests — acceptedAt is
  // meaningless for PICKED_UP / CANCELLED orders (no Accept button shows then).
  const fetchAcceptedForOrders = useCallback(
    async (orderList: VendorOrder[]): Promise<VendorOrder[]> => {
      const activeOrders = orderList.filter(
        (o) => o.status !== 'PICKED_UP' && o.status !== 'CANCELLED',
      )
      if (activeOrders.length === 0) return orderList
      const results = await Promise.allSettled(
        activeOrders.map(async (o) => {
          const r = await fetch(`/api/orders/${o.id}/accepted`)
          if (!r.ok) return null
          return r.json()
        }),
      )
      const acceptedByOrderId = new Map<string, string | null>()
      activeOrders.forEach((o, i) => {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value) {
          acceptedByOrderId.set(o.id, (r.value.acceptedAt as string | null) ?? null)
        }
      })
      return orderList.map((o) => {
        if (!acceptedByOrderId.has(o.id)) return o
        return { ...o, acceptedAt: acceptedByOrderId.get(o.id) ?? null }
      })
    },
    [],
  )

  const refreshOrders = useCallback(async () => {
    if (!activeId) return
    const res = await fetch(`/api/orders?role=vendor&restaurantId=${activeId}&limit=50`)
    const data = await res.json()
    const baseOrders: VendorOrder[] = (data.orders ?? []) as VendorOrder[]
    const withFulfilment = await fetchFulfilmentForOrders(baseOrders)
    const withAccepted = await fetchAcceptedForOrders(withFulfilment)
    setOrders(withAccepted)
  }, [activeId, fetchAcceptedForOrders, fetchFulfilmentForOrders])

  const refreshMenu = useCallback(async () => {
    if (!activeId) return
    const res = await fetch(`/api/restaurants/${activeId}/menu`)
    const data = await res.json()
    setMenu(data.items ?? [])
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    setLoading(true)
    Promise.all([refreshOrders(), refreshMenu()]).finally(() => setLoading(false))
  }, [activeId, refreshOrders, refreshMenu])

  // realtime updates — refresh both orders and their fulfilment state
  useEffect(() => {
    const sock = realtimeSocket()
    const handler = (p: { restaurantId: string; orderId: string }) => {
      if (p.restaurantId === activeId) refreshOrders()
    }
    sock.on('order:updated', handler)
    sock.on('order:created', handler)
    return () => {
      sock.off('order:updated', handler)
      sock.off('order:created', handler)
    }
  }, [activeId, refreshOrders])

  // advance: PATCH /api/orders/[id]/fulfilment — P0-06 parallel state machine.
  // csrfFetch auto-injects both the X-CSRF-Token and an Idempotency-Key header
  // (UUID v4) for PATCH requests, so retries from a network blip or a double
  // click are deduped server-side.
  //
  // Wave 5 Task 5A — ADDITIVE reward issuance:
  //   When the PATCH transitions to PICKED_UP, ALSO fire-and-forget a call to
  //   POST /api/rewards/on-picked-up { orderId }. Reward issuance is fully
  //   idempotent server-side (RewardLedgerEntry.idempotencyKey unique on
  //   `ORDER_PICKED_UP:${orderId}:${ruleKey}` per rule), so a duplicate call
  //   (network retry, double-tap) is a no-op returning the existing ledger
  //   entries. Reward issuance failure does NOT block the vendor flow — the
  //   call is awaited via .catch(() => {}) to swallow any errors silently.
  //   On success, an optional non-blocking toast shows the points earned.
  const advance = useCallback(
    async (order: VendorOrder) => {
      const current = order.fulfilmentStatus ?? 'PREPARING'
      const next = NEXT_FULFILMENT_STATUS[current]
      if (!next) return
      setBusyOrderId(order.id)
      try {
        const res = await csrfFetch(`/api/orders/${order.id}/fulfilment`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: next, actorRole: 'VENDOR_OWNER' }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          const msg =
            data?.error?.message ||
            data?.error ||
            `Failed to advance fulfilment (${res.status})`
          throw new Error(typeof msg === 'string' ? msg : 'Update failed')
        }
        const newStatus: string = data?.fulfilment?.status ?? next
        const newOtp: string | undefined =
          data?.fulfilment?.pickupOtp ?? order.fulfilmentOtp ?? order.pickupOtp
        // Optimistically update local state from the API response so the card
        // re-renders immediately (e.g. PREPARING → ALMOST_READY) without
        // waiting for the full list refresh.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, fulfilmentStatus: newStatus, fulfilmentOtp: newOtp }
              : o,
          ),
        )
        const shortLabel = FULFILMENT_STATUS_META[next]?.short ?? next
        toast({ title: `${order.restaurant.name} → ${shortLabel}` })

        // -------------------------------------------------------------------
        // Task 5A — ADDITIVE reward issuance (fire-and-forget, non-blocking).
        // Fires ONLY when the transition was to PICKED_UP. Uses a deterministic
        // Idempotency-Key header (ORDER_PICKED_UP-${orderId}) — dashes instead
        // of colons because the regex on the server (/^[a-zA-Z0-9_-]{8,128}$/)
        // rejects colons. The server's inherent idempotency via ledger-entry
        // keys (which DO use colons — those are stored in a DB column, not
        // validated by the header regex) is the primary dedup mechanism.
        // -------------------------------------------------------------------
        if (newStatus === 'PICKED_UP') {
          void csrfFetch(`/api/rewards/on-picked-up`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'Idempotency-Key': `ORDER_PICKED_UP-${order.id}`,
            },
            body: JSON.stringify({ orderId: order.id }),
          })
            .then((rewardRes) => rewardRes.json().catch(() => null))
            .then((rewardData: { totalPointsIssued?: number; alreadyIssued?: boolean } | null) => {
              if (
                rewardData &&
                typeof rewardData.totalPointsIssued === 'number' &&
                rewardData.totalPointsIssued > 0 &&
                !rewardData.alreadyIssued
              ) {
                toast({
                  title: `Customer earned ${rewardData.totalPointsIssued} reward points! 🎉`,
                })
              }
            })
            .catch(() => {
              // Swallow — reward issuance failure must NOT block the vendor flow.
            })
        }
      } catch (e) {
        toast({
          title: 'Update failed',
          description: (e as Error).message,
          variant: 'destructive',
        })
      } finally {
        setBusyOrderId(null)
      }
    },
    [toast],
  )

  // accept: POST /api/vendor/orders/[id]/accept — Task 3C endpoint that records
  // Fulfilment.acceptedAt (additive nullable column — does NOT touch the P0-06
  // state machine). Idempotent server-side (returns 200 with alreadyAccepted:
  // true if already accepted), so retries from a network blip or a double click
  // are safe. csrfFetch auto-injects the X-CSRF-Token + Idempotency-Key.
  const accept = useCallback(
    async (order: VendorOrder) => {
      setBusyOrderId(order.id)
      try {
        const res = await csrfFetch(`/api/vendor/orders/${order.id}/accept`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          const msg =
            data?.error?.message ||
            data?.error ||
            `Accept failed (${res.status})`
          throw new Error(typeof msg === 'string' ? msg : 'Accept failed')
        }
        const acceptedAtIso: string | undefined = data?.acceptedAt
        const alreadyAccepted: boolean = data?.alreadyAccepted === true
        // Optimistically update local state — the Accept button disappears and
        // the "Accepted ✓" badge appears immediately (no full list refresh
        // needed).
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, acceptedAt: acceptedAtIso ?? o.acceptedAt ?? null }
              : o,
          ),
        )
        toast({
          title: alreadyAccepted ? 'Already accepted' : 'Order accepted!',
          description: alreadyAccepted
            ? 'This order was already accepted.'
            : `${order.restaurant.name} accepted. Starting prep.`,
        })
      } catch (e) {
        toast({
          title: 'Accept failed',
          description: (e as Error).message,
          variant: 'destructive',
        })
      } finally {
        setBusyOrderId(null)
      }
    },
    [toast],
  )

  // setPrepTime: Task 4A MVP — client-only update. Persists the vendor-entered
  // prep time on the order's local state + toast confirmation. Shows "Est.
  // ready: {createdAt + prepTime}" on the card. Future: a PATCH endpoint will
  // persist this server-side (the API does NOT exist yet — per task spec).
  const setPrepTime = useCallback(
    (order: VendorOrder, minutes: number) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, prepTimeMins: minutes } : o,
        ),
      )
      // Clear the draft so the input shows the persisted value (mirroring the
      // order.prepTimeMins that was just set).
      setPrepTimeDrafts((prev) => {
        const next = { ...prev }
        delete next[order.id]
        return next
      })
      toast({
        title: 'Prep time set',
        description: `Estimated ${minutes} min. Customer will be notified via realtime.`,
      })
    },
    [toast],
  )

  // cancel: still uses the legacy /status route with CANCELLED — this is the
  // Order.status path (not the fulfilment path) per the task spec.
  const cancel = useCallback(
    async (order: VendorOrder) => {
      setBusyOrderId(order.id)
      try {
        const res = await csrfFetch(`/api/orders/${order.id}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED', actorRole: 'VENDOR_OWNER' }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          const msg =
            data?.error?.message ||
            data?.error ||
            `Cancel failed (${res.status})`
          throw new Error(typeof msg === 'string' ? msg : 'Cancel failed')
        }
        toast({ title: 'Order cancelled' })
        refreshOrders()
      } catch (e) {
        toast({
          title: 'Cancel failed',
          description: (e as Error).message,
          variant: 'destructive',
        })
      } finally {
        setBusyOrderId(null)
      }
    },
    [refreshOrders, toast],
  )

  const toggleAvailability = useCallback(
    async (item: MenuItem) => {
      const next = !item.isAvailable
      setMenu((m) => m.map((x) => (x.id === item.id ? { ...x, isAvailable: next } : x)))
      try {
        await csrfFetch(`/api/menu/${item.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isAvailable: next }),
        })
        toast({ title: `${item.name} ${next ? 'available' : 'unavailable'}` })
      } catch (e) {
        setMenu((m) => m.map((x) => (x.id === item.id ? { ...x, isAvailable: !next } : x)))
        toast({ title: 'Update failed', variant: 'destructive' })
      }
    },
    [toast],
  )

  const active = restaurants.find((r) => r.id === activeId)
  // Active = not cancelled, not picked-up on either the order or fulfilment side.
  // Completed = picked up on either side (covers legacy /status PICKED_UP and
  // new /fulfilment PICKED_UP).
  const activeOrders = orders.filter(
    (o) =>
      o.status !== 'CANCELLED' &&
      o.status !== 'PICKED_UP' &&
      o.fulfilmentStatus !== 'PICKED_UP',
  )
  const completed = orders.filter(
    (o) => o.status === 'PICKED_UP' || o.fulfilmentStatus === 'PICKED_UP',
  )

  return (
    <div className="px-4 py-6">
      {/* Restaurant selector */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-teal-600" />
          <h2 className="text-lg font-semibold">Vendor Console</h2>
          <span className={`ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${connected ? 'snak-live-dot' : ''}`} /> {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'orders' | 'menu')}>
          <TabsList>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="menu">Menu</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {restaurants.length > 1 && (
        <Tabs value={activeId} onValueChange={setActiveId}>
          <TabsList className="mb-4 flex h-auto flex-wrap">
            {restaurants.map((r) => (
              <TabsTrigger key={r.id} value={r.id} className="text-xs">
                {r.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {tab === 'orders' ? (
        <>
          {activeId && <VendorAnalyticsWidget restaurantId={activeId} />}

          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>
          ) : activeOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
              <ChefHat className="mx-auto mb-2 h-8 w-8" /> No active orders right now.
            </div>
          ) : (
            <div className="space-y-3">
              {activeOrders.map((o) => (
                <VendorOrderCard
                  key={o.id}
                  order={o}
                  busy={busyOrderId === o.id}
                  restaurantPrepTimeMins={active?.prepTimeMins ?? 20}
                  prepTimeDraft={prepTimeDrafts[o.id]}
                  onPrepTimeDraftChange={(v) =>
                    setPrepTimeDrafts((prev) => ({ ...prev, [o.id]: v }))
                  }
                  onAccept={() => accept(o)}
                  onSetPrepTime={(mins) => setPrepTime(o, mins)}
                  onAdvance={() => advance(o)}
                  onCancel={() => cancel(o)}
                />
              ))}
              {completed.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed today ({completed.length})</h3>
                  <div className="space-y-2">
                    {completed.slice(0, 5).map((o) => (
                      <div key={o.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">#{o.id.slice(-6).toUpperCase()} · {o.itemsCount} items</span>
                        <span className="font-medium">{inr(o.totalAmount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        // Menu management — Task 4B VendorMenuManager (full CRUD)
        activeId ? (
          <VendorMenuManager restaurantId={activeId} />
        ) : (
          <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            <UtensilsCrossed className="mx-auto mb-2 h-8 w-8" /> Select a restaurant to manage its menu.
          </div>
        )
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VendorOrderCard — single order in the queue.
// Task 4A enhancements (additive — preserves existing Advance + Cancel + OTP):
//   - Accept button: shown ONLY when acceptedAt === null (the additive GET
//     /api/orders/[id]/accepted endpoint resolved + the timestamp is null).
//     Calls POST /api/vendor/orders/[id]/accept (Task 3C endpoint) — idempotent
//     server-side. On success: optimistic local state update + "Order accepted!"
//     toast. framer-motion press feedback (tap-scale).
//   - Accepted ✓ sub-badge: shown when acceptedAt is set (replaces the Accept
//     button — Accept is inherently idempotent so the button disappears).
//   - Prep-time setter: number input (minutes) + Save button. Placeholder =
//     restaurant.prepTimeMins. On save: client-only update (Task 4A MVP —
//     no API yet) + "Prep time set to X min" toast + "Est. ready: {time}"
//     display below the setter.
//   - Better visual hierarchy: order # prominent, status + Accepted badge row,
//     items list, total + time ago on the right.
// ─────────────────────────────────────────────────────────────────────────────
function VendorOrderCard({
  order,
  busy,
  restaurantPrepTimeMins,
  prepTimeDraft,
  onPrepTimeDraftChange,
  onAccept,
  onSetPrepTime,
  onAdvance,
  onCancel,
}: {
  order: VendorOrder
  busy: boolean
  /** Restaurant-level default prep time (placeholder for the input). */
  restaurantPrepTimeMins: number
  /** Current draft value for the prep-time input (string for controlled input). */
  prepTimeDraft: string | undefined
  /** Update the draft when the vendor types. */
  onPrepTimeDraftChange: (value: string) => void
  /** Accept the order — POST /api/vendor/orders/[id]/accept (Task 3C). */
  onAccept: () => void
  /** Save the prep time (Task 4A MVP — client-only). */
  onSetPrepTime: (minutes: number) => void
  onAdvance: () => void
  onCancel: () => void
}) {
  const prefersReduced = useReducedMotion()
  // The fulfilment state is the source of truth for the vendor card. If the
  // fetch hasn't landed yet (or failed), default to PREPARING — the lazy-create
  // baseline — so the card always renders a sensible next-step button.
  const fulfilmentStatus = order.fulfilmentStatus ?? 'PREPARING'
  const meta = FULFILMENT_STATUS_META[fulfilmentStatus] ?? FULFILMENT_STATUS_META.PREPARING
  const next = NEXT_FULFILMENT_STATUS[fulfilmentStatus]
  const nextMeta = next ? FULFILMENT_STATUS_META[next] : null
  const isReady = fulfilmentStatus === 'READY_FOR_PICKUP'
  // Prefer the fulfilment OTP (lazy-copied from Order.pickupOtp) but fall back
  // to the order OTP if the fulfilment field is missing.
  const pickupOtp = order.fulfilmentOtp ?? order.pickupOtp
  const isTerminal = !next

  // Accept button visibility: only when the additive acceptedAt fetch has
  // resolved AND the value is null (i.e. vendor hasn't accepted yet).
  // undefined (still loading) → hide the button (don't flash the button then
  // hide it). null → show Accept. string (set) → show Accepted ✓ badge.
  const acceptedAt = order.acceptedAt
  const showAcceptButton = acceptedAt === null
  const isAccepted = typeof acceptedAt === 'string' && acceptedAt.length > 0

  // Prep time: vendor override (order.prepTimeMins) or restaurant default.
  const effectivePrepMins = order.prepTimeMins ?? restaurantPrepTimeMins
  // Est. ready = createdAt + effectivePrepMins (minutes). Format as HH:MM.
  const estReadyAt = useMemo(() => {
    const created = new Date(order.createdAt)
    const ready = new Date(created.getTime() + effectivePrepMins * 60_000)
    return ready.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }, [order.createdAt, effectivePrepMins])

  // Prep-time draft handling: the input shows the draft if the vendor is
  // typing, otherwise the effective prep time (so the saved value is shown).
  const draftValue = prepTimeDraft ?? String(effectivePrepMins)
  const draftMinutes = Number(draftValue)
  const isDraftValid =
    Number.isFinite(draftMinutes) && draftMinutes > 0 && draftMinutes <= 180
  const isDraftDirty = prepTimeDraft !== undefined && prepTimeDraft !== String(effectivePrepMins)

  const handleSavePrepTime = () => {
    if (!isDraftValid) return
    onSetPrepTime(draftMinutes)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : undefined}
    >
      <Card className={isReady ? 'border-teal-400 shadow-md' : ''}>
        <CardContent className="p-4">
          {/* Header: order # + status badges */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold tracking-wide text-foreground">
                  #{order.id.slice(-6).toUpperCase()}
                </span>
                {order.isCatering && (
                  <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-950 dark:text-purple-300">
                    Catering
                  </Badge>
                )}
                <Badge className={meta.tone} title={meta.label}>
                  {meta.emoji} {meta.short}
                </Badge>
                {isAccepted && (
                  <Badge
                    className="border-transparent bg-emerald-500/15 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    title={`Accepted ${timeAgo(acceptedAt as string)}`}
                  >
                    <Check className="h-3 w-3" /> Accepted
                  </Badge>
                )}
              </div>
              {order.isCatering && order.headcount && (
                <p className="mt-1 text-xs text-purple-600 dark:text-purple-400">
                  👥 Headcount: {order.headcount} · {order.note}
                </p>
              )}
              <div className="mt-2 space-y-0.5">
                {order.items.map((it, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{it.quantity}×</span> {it.name}
                  </div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{inr(order.totalAmount)}</p>
              <p className="text-xs text-muted-foreground">
                <Clock className="mr-1 inline h-3 w-3" />
                {timeAgo(order.createdAt)}
              </p>
            </div>
          </div>

          {/* Prep-time setter — Task 4A MVP (client-only). */}
          <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <label
                htmlFor={`prep-${order.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Prep time
              </label>
              <Input
                id={`prep-${order.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={180}
                step={1}
                value={draftValue}
                onChange={(e) => onPrepTimeDraftChange(e.target.value)}
                className="h-8 w-20"
                aria-label={`Prep time in minutes for order ${order.id.slice(-6).toUpperCase()}`}
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">min</span>
              <Button
                type="button"
                size="sm"
                variant={isDraftDirty ? 'default' : 'outline'}
                onClick={handleSavePrepTime}
                disabled={busy || !isDraftValid || !isDraftDirty}
                className="ml-auto h-8"
                aria-label={`Save prep time for order ${order.id.slice(-6).toUpperCase()}`}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </Button>
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              <AlarmClockCheck className="h-3 w-3 text-teal-600 dark:text-teal-400" aria-hidden />
              <span>
                Est. ready: <span className="font-medium text-foreground">{estReadyAt}</span>
              </span>
            </div>
          </div>

          {/* Pickup OTP — shown when status is READY_FOR_PICKUP */}
          {isReady && pickupOtp && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-teal-50 px-3 py-2 dark:bg-teal-950/40">
              <span className="text-xs text-muted-foreground">Pickup OTP</span>
              <span className="font-mono text-xl font-bold tracking-[0.25em] text-teal-700 dark:text-teal-300">
                {pickupOtp}
              </span>
            </div>
          )}

          {/* Action row: Accept (when not yet accepted) + Advance + Cancel */}
          <div className="mt-3 space-y-2">
            {showAcceptButton && (
              <motion.div
                whileTap={prefersReduced ? undefined : { scale: 0.97 }}
                transition={prefersReduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }}
              >
                <Button
                  onClick={onAccept}
                  disabled={busy}
                  className="w-full bg-gradient-to-r from-teal-500 to-amber-500 text-white shadow-md hover:from-teal-600 hover:to-amber-600"
                  aria-label={`Accept order ${order.id.slice(-6).toUpperCase()}`}
                >
                  {busy ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Accept order
                </Button>
              </motion.div>
            )}

            <div className="flex items-center gap-2">
              {next && (
                <Button
                  onClick={onAdvance}
                  disabled={busy}
                  className="flex-1 bg-teal-600 hover:bg-teal-700"
                >
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {!busy && next === 'ALMOST_READY' && <Clock className="mr-1 h-4 w-4" />}
                  {!busy && next === 'READY_FOR_PICKUP' && <Bell className="mr-1 h-4 w-4" />}
                  {!busy && next === 'PICKED_UP' && <CheckCircle2 className="mr-1 h-4 w-4" />}
                  Mark {nextMeta?.short ?? next}
                </Button>
              )}
              {isTerminal && (
                // PICKED_UP — terminal handoff confirmation chip.
                <div className="flex-1 rounded-md bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="mr-1 inline h-3 w-3" /> Handed off to customer
                </div>
              )}
              {order.status !== 'CANCELLED' && order.status !== 'PICKED_UP' && !isTerminal && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onCancel}
                  disabled={busy}
                  title="Cancel order"
                  aria-label={`Cancel order ${order.id.slice(-6).toUpperCase()}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
