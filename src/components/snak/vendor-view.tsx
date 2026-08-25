'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion, useReducedMotion } from 'framer-motion'
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
  ShieldCheck,
  Inbox,
  PackageCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp'
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

// Lazy-load the Vendor Analytics Widget (Task 4C) + Vendor Menu Manager (Task 4B).
const VendorAnalyticsWidget = dynamic(
  () => import('./vendor-analytics-widget').then((m) => m.VendorAnalyticsWidget),
  { ssr: false, loading: () => <Skeleton className="h-40 w-full rounded-xl" /> },
)
const VendorMenuManager = dynamic(
  () => import('./vendor-menu-manager').then((m) => m.VendorMenuManager),
  { ssr: false, loading: () => <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div> },
)

// Vendor-facing order shape: the base Order from /api/orders plus cached
// P0-06 fulfilment state (status + pickupOtp) fetched via GET /fulfilment AND
// the additive `acceptedAt` timestamp (Task 3C) fetched via
// GET /api/orders/[id]/accepted.
//
// V2 additions:
//   - `pickupOtpId`: the OtpRequest record ID returned by the fulfilment PATCH
//     when transitioning to READY_FOR_PICKUP. The vendor UI stores this + uses
//     it to call POST /api/orders/[id]/pickup/verify. The OTP CODE itself is
//     NEVER shown to the vendor (only the customer receives it).
//   - `pickupOtpId` is undefined while no OTP has been issued or if the
//     fulfilment fetch hasn't landed yet.
type VendorOrder = Order & {
  fulfilmentStatus?: string
  fulfilmentOtp?: string
  acceptedAt?: string | null
  prepTimeMins?: number
  pickupOtpId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 — Queue model (Phase 2)
// Maps canonical statuses into mutually exclusive Vendor queues.
// An order appears in EXACTLY ONE queue (no double-counting).
//
//   NEW       → acceptedAt === null (order awaiting vendor acceptance)
//   PREPARING → acceptedAt set + fulfilmentStatus in {PREPARING, ALMOST_READY}
//   READY     → fulfilmentStatus === READY_FOR_PICKUP
//   COMPLETED → fulfilmentStatus === PICKED_UP (or order.status === PICKED_UP)
//   CANCELLED → order.status === CANCELLED (read-only history)
//
// Invariant: one order must not appear in two incompatible active queues.
// ─────────────────────────────────────────────────────────────────────────────
type QueueKey = 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled'

function queueForOrder(o: VendorOrder): QueueKey {
  if (o.status === 'CANCELLED') return 'cancelled'
  if (o.status === 'PICKED_UP' || o.fulfilmentStatus === 'PICKED_UP') return 'completed'
  if (o.fulfilmentStatus === 'READY_FOR_PICKUP') return 'ready'
  if (o.acceptedAt === null || o.acceptedAt === undefined) return 'new'
  return 'preparing'
}

const QUEUE_META: Record<QueueKey, { label: string; icon: typeof Inbox; empty: string }> = {
  new: { label: 'New', icon: Inbox, empty: 'No new orders awaiting acceptance' },
  preparing: { label: 'Preparing', icon: ChefHat, empty: 'Nothing currently preparing' },
  ready: { label: 'Ready', icon: Bell, empty: 'No orders ready for pickup' },
  completed: { label: 'Completed', icon: CheckCircle2, empty: 'No completed orders yet' },
  cancelled: { label: 'Cancelled', icon: X, empty: 'No cancelled orders' },
}

export function VendorView() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [orders, setOrders] = useState<VendorOrder[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  // V2: per-order prep-time input (Task 4A MVP — client-only)
  const [prepTimeDrafts, setPrepTimeDrafts] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'orders' | 'menu'>('orders')
  // V2: active queue tab (NEW / PREPARING / READY / COMPLETED / CANCELLED)
  const [queueTab, setQueueTab] = useState<QueueKey>('new')
  // V2: pickup-verify modal state
  const [verifyOrderId, setVerifyOrderId] = useState<string | null>(null)
  const [verifyOtpCode, setVerifyOtpCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const { connected } = useRealtime(['vendor:all'])
  const { toast } = useToast()

  // load restaurants — V2 (Phase 16): role=vendor filter ensures the vendor
  // only sees restaurants they own (cross-vendor UI isolation).
  useEffect(() => {
    fetch('/api/restaurants?role=vendor')
      .then((r) => r.json())
      .then((d) => {
        setRestaurants(d.restaurants ?? [])
        if (d.restaurants?.[0]) setActiveId(d.restaurants[0].id)
      })
  }, [])

  // Fetch fulfilment status for every active order.
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
      const fulfilmentById = new Map<string, { status: string; pickupOtp?: string; pickupVerifiedAt?: string | null }>()
      activeOrders.forEach((o, i) => {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value?.fulfilment) {
          fulfilmentById.set(o.id, {
            status: r.value.fulfilment.status as string,
            pickupOtp: r.value.fulfilment.pickupOtp as string | undefined,
            pickupVerifiedAt: r.value.fulfilment.pickupVerifiedAt ?? null,
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

  // V2 (Phase 9) — Realtime queue reconciliation.
  // Reuse existing `order:updated` realtime invalidation. The socket payload
  // is an invalidation SIGNAL, NOT final status truth. On event: vendor
  // refetches authoritative order data → correct queue updates.
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

  // ─────────────────────────────────────────────────────────────────────
  // V2 (Phase 3/5) — Fulfilment transition actions.
  // Reuse hardened V1 canonical fulfilment route. Server-authoritative only.
  // The UI NEVER optimistically sets order.status before server success.
  // After server 2xx: updates local state FROM THE SERVER RESPONSE (not
  // a fabricated value), then triggers an authoritative refresh.
  // ─────────────────────────────────────────────────────────────────────
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
          body: JSON.stringify({ status: next }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          const msg =
            data?.error?.message ||
            data?.error ||
            `Failed to advance fulfilment (${res.status})`
          throw new Error(typeof msg === 'string' ? msg : 'Update failed')
        }
        // V2 (Phase 8) — Server truth only: update local state FROM the
        // server response (not a fabricated value). The server response is
        // authoritative; local state is a cache, never the source of truth.
        const newStatus: string = data?.fulfilment?.status ?? next
        const newOtp: string | undefined =
          data?.fulfilment?.pickupOtp ?? order.fulfilmentOtp ?? order.pickupOtp
        // V2: capture pickupOtpId when transitioning to READY_FOR_PICKUP.
        // This is the OtpRequest record ID (NOT the code) needed by
        // pickup-verify. The code is sent to the customer's phone.
        const newOtpId: string | undefined = data?.pickupOtpId ?? order.pickupOtpId
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, fulfilmentStatus: newStatus, fulfilmentOtp: newOtp, pickupOtpId: newOtpId }
              : o,
          ),
        )
        const shortLabel = FULFILMENT_STATUS_META[next]?.short ?? next
        toast({ title: `Order #${order.id.slice(-6).toUpperCase()} → ${shortLabel}` })

        // V2 (Phase 5) — Queue relocation: if the order moved to a different
        // queue, switch the active queue tab so the vendor sees it.
        const updatedOrder: VendorOrder = { ...order, fulfilmentStatus: newStatus, fulfilmentOtp: newOtp, pickupOtpId: newOtpId }
        const newQueue = queueForOrder(updatedOrder)
        setQueueTab(newQueue)

        // Task 5A — ADDITIVE reward issuance (fire-and-forget, non-blocking).
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

        // Authoritative refresh (fetches full order list + fulfilment state)
        refreshOrders()
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
    [refreshOrders, toast],
  )

  // ─────────────────────────────────────────────────────────────────────
  // V2 (Phase 4) — Accept action.
  // Reuse existing authoritative Vendor accept endpoint.
  // Server-authoritative only. No optimistic state mutation before success.
  // ─────────────────────────────────────────────────────────────────────
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
        // V2 (Phase 8) — Server truth only: update acceptedAt FROM the server
        // response (not a fabricated value). This is a post-success cache
        // update, NOT an optimistic mutation.
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
            : `Order #${order.id.slice(-6).toUpperCase()} accepted. Starting prep.`,
        })
        // V2 (Phase 4) — queue relocation: order moves from NEW to PREPARING
        const updatedOrder: VendorOrder = { ...order, acceptedAt: acceptedAtIso ?? null }
        setQueueTab(queueForOrder(updatedOrder))
        // Authoritative refresh
        refreshOrders()
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
    [refreshOrders, toast],
  )

  // setPrepTime: Task 4A MVP — client-only update.
  const setPrepTime = useCallback(
    (order: VendorOrder, minutes: number) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, prepTimeMins: minutes } : o,
        ),
      )
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

  // cancel: uses the legacy /status route with CANCELLED (Order.status path).
  const cancel = useCallback(
    async (order: VendorOrder) => {
      setBusyOrderId(order.id)
      try {
        const res = await csrfFetch(`/api/orders/${order.id}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED' }),
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

  // ─────────────────────────────────────────────────────────────────────
  // V2 (Phase 6-7) — Pickup verification.
  // Uses the existing canonical POST /api/orders/[id]/pickup/verify endpoint.
  // The vendor enters the 6-digit OTP code that the customer received.
  // The otpId + qrToken are resolved from the order's cached state
  // (otpId from the fulfilment PATCH response, qrToken reconstructed from
  // orderId + pickupOtp). The OTP code is NEVER displayed to the vendor.
  // ─────────────────────────────────────────────────────────────────────
  const openVerifyModal = useCallback((order: VendorOrder) => {
    setVerifyOrderId(order.id)
    setVerifyOtpCode('')
    setVerifyError(null)
  }, [])

  const closeVerifyModal = useCallback(() => {
    setVerifyOrderId(null)
    setVerifyOtpCode('')
    setVerifyError(null)
    setVerifying(false)
  }, [])

  const verifyPickup = useCallback(
    async (order: VendorOrder) => {
      // V2 — resolve otpId + qrToken from the order's cached state.
      // The otpId was captured from the fulfilment PATCH response when the
      // order transitioned to READY_FOR_PICKUP. If it's missing (e.g., the
      // order was loaded after the transition and the PATCH response wasn't
      // captured), we cannot proceed — the vendor must refresh.
      const otpId = order.pickupOtpId
      if (!otpId) {
        setVerifyError(
          'Pickup OTP record not found. Please refresh the order list and try again.',
        )
        return
      }
      if (verifyOtpCode.length !== 6) {
        setVerifyError('Please enter the 6-digit code.')
        return
      }
      // V2 — reconstruct the qrToken from orderId + pickupOtp.
      // Format: snakzap:pickup:${orderId}:otp:${pickupOtp}
      // The pickupOtp is the Order's pickup code (available to the vendor
      // via the fulfilment GET — but the vendor does NOT show it to the
      // customer; the customer receives it via SMS).
      const pickupOtp = order.fulfilmentOtp ?? order.pickupOtp
      if (!pickupOtp || pickupOtp === '000000') {
        setVerifyError(
          'No pickup OTP has been issued for this order. Ensure the order reached Ready for Pickup.',
        )
        return
      }
      const qrToken = `snakzap:pickup:${order.id}:otp:${pickupOtp}`

      setVerifying(true)
      setVerifyError(null)
      try {
        const res = await csrfFetch(`/api/orders/${order.id}/pickup/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ otpId, code: verifyOtpCode, qrToken }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          // V2 (Phase 7) — Wrong OTP: controlled error, status remains
          // READY_FOR_PICKUP, modal remains truthful (stays open).
          const msg =
            data?.error?.message ||
            data?.error?.details?.reason ||
            `Verification failed (${res.status})`
          throw new Error(typeof msg === 'string' ? msg : 'Verification failed')
        }
        // V2 — Success: PICKED_UP. Close modal + authoritative refresh.
        toast({
          title: 'Pickup verified!',
          description: `Order #${order.id.slice(-6).toUpperCase()} → Picked Up`,
        })
        closeVerifyModal()
        // Queue relocation: order moves to COMPLETED
        setQueueTab('completed')
        refreshOrders()
      } catch (e) {
        setVerifyError((e as Error).message)
      } finally {
        setVerifying(false)
      }
    },
    [closeVerifyModal, refreshOrders, toast, verifyOtpCode],
  )

  const active = restaurants.find((r) => r.id === activeId)

  // V2 (Phase 2) — Queue separation. Orders are partitioned into mutually
  // exclusive queues. An order appears in EXACTLY ONE queue.
  const queueOrders = useMemo(() => {
    const buckets: Record<QueueKey, VendorOrder[]> = {
      new: [],
      preparing: [],
      ready: [],
      completed: [],
      cancelled: [],
    }
    for (const o of orders) {
      buckets[queueForOrder(o)].push(o)
    }
    return buckets
  }, [orders])

  // V2 — queue counts for the tab badges
  const queueCounts = useMemo(() => {
    const counts: Record<QueueKey, number> = {
      new: queueOrders.new.length,
      preparing: queueOrders.preparing.length,
      ready: queueOrders.ready.length,
      completed: queueOrders.completed.length,
      cancelled: queueOrders.cancelled.length,
    }
    return counts
  }, [queueOrders])

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
          ) : (
            <>
              {/* V2 (Phase 2) — Queue tabs */}
              <Tabs value={queueTab} onValueChange={(v) => setQueueTab(v as QueueKey)} className="mb-4">
                <TabsList className="flex h-auto flex-wrap gap-1">
                  {(Object.keys(QUEUE_META) as QueueKey[]).map((qk) => {
                    const meta = QUEUE_META[qk]
                    const Icon = meta.icon
                    const count = queueCounts[qk]
                    return (
                      <TabsTrigger key={qk} value={qk} className="gap-1.5 text-xs">
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                        {count > 0 && (
                          <span className="ml-0.5 rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {count}
                          </span>
                        )}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
              </Tabs>

              {/* V2 (Phase 12) — Per-queue empty state */}
              {queueOrders[queueTab].length === 0 ? (
                <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
                  {(() => {
                    const meta = QUEUE_META[queueTab]
                    const Icon = meta.icon
                    return <><Icon className="mx-auto mb-2 h-8 w-8" /> {meta.empty}</>
                  })()}
                </div>
              ) : (
                <div className="space-y-3">
                  {queueOrders[queueTab].map((o) => (
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
                      onVerifyPickup={() => openVerifyModal(o)}
                    />
                  ))}
                </div>
              )}
            </>
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

      {/* V2 (Phase 6-7) — Pickup verification modal */}
      <PickupVerifyDialog
        order={orders.find((o) => o.id === verifyOrderId) ?? null}
        open={verifyOrderId !== null}
        code={verifyOtpCode}
        onCodeChange={setVerifyOtpCode}
        verifying={verifying}
        error={verifyError}
        onVerify={() => {
          const o = orders.find((x) => x.id === verifyOrderId)
          if (o) verifyPickup(o)
        }}
        onClose={closeVerifyModal}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 (Phase 6-7) — Pickup Verify Dialog
// Minimal OTP verification UI. Shows only the order reference + OTP input.
// Does NOT expose the stored OTP, qrToken, or otpId.
// ─────────────────────────────────────────────────────────────────────────────
function PickupVerifyDialog({
  order,
  open,
  code,
  onCodeChange,
  verifying,
  error,
  onVerify,
  onClose,
}: {
  order: VendorOrder | null
  open: boolean
  code: string
  onCodeChange: (v: string) => void
  verifying: boolean
  error: string | null
  onVerify: () => void
  onClose: () => void
}) {
  if (!order) return null
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal-600" />
            Verify Pickup
          </DialogTitle>
          <DialogDescription>
            Order <span className="font-mono font-semibold">#{order.id.slice(-6).toUpperCase()}</span>
            {' '}&middot; {order.restaurant.name}
            <br />
            Ask the customer for the 6-digit code they received, then enter it below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {/* V2 (Phase 13) — Order reference + customer-safe context only.
              No OTP, no qrToken, no payment secrets shown. */}
          <div className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items</span>
              <span className="font-medium">{order.itemsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-medium">{inr(order.totalAmount)}</span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <label htmlFor="pickup-otp" className="text-sm font-medium text-muted-foreground">
              Pickup code
            </label>
            <InputOTP
              id="pickup-otp"
              maxLength={6}
              value={code}
              onChange={onCodeChange}
              disabled={verifying}
              aria-label="6-digit pickup code"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && (
            <p className="text-center text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={verifying}>
            Cancel
          </Button>
          <Button
            onClick={onVerify}
            disabled={verifying || code.length !== 6}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {verifying ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <ShieldCheck className="mr-1 h-4 w-4" />
                Verify & Complete
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VendorOrderCard — single order in the queue.
// V2 changes:
//   - REMOVED plaintext OTP display (Phase 13/23: no OTP secret rendered)
//   - Action matrix (Phase 3): explicit labels per state, no generic "Next"
//   - "Verify Pickup" button replaces "Mark Picked Up" at READY_FOR_PICKUP
//   - Read-only at PICKED_UP
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
  onVerifyPickup,
}: {
  order: VendorOrder
  busy: boolean
  restaurantPrepTimeMins: number
  prepTimeDraft: string | undefined
  onPrepTimeDraftChange: (value: string) => void
  onAccept: () => void
  onSetPrepTime: (minutes: number) => void
  onAdvance: () => void
  onCancel: () => void
  onVerifyPickup: () => void
}) {
  const prefersReduced = useReducedMotion()
  const fulfilmentStatus = order.fulfilmentStatus ?? 'PREPARING'
  const meta = FULFILMENT_STATUS_META[fulfilmentStatus] ?? FULFILMENT_STATUS_META.PREPARING
  const next = NEXT_FULFILMENT_STATUS[fulfilmentStatus]
  const isReady = fulfilmentStatus === 'READY_FOR_PICKUP'
  const isTerminal = !next

  const acceptedAt = order.acceptedAt
  const showAcceptButton = acceptedAt === null
  const isAccepted = typeof acceptedAt === 'string' && acceptedAt.length > 0

  const effectivePrepMins = order.prepTimeMins ?? restaurantPrepTimeMins
  const estReadyAt = useMemo(() => {
    const created = new Date(order.createdAt)
    const ready = new Date(created.getTime() + effectivePrepMins * 60_000)
    return ready.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }, [order.createdAt, effectivePrepMins])

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

          {/* V2 — REMOVED plaintext OTP display (Phase 13/23: no OTP secret rendered).
              The OTP is sent to the customer's phone. The vendor enters it via
              the Verify Pickup modal — never displayed on the card. */}

          {/* V2 (Phase 3) — Action matrix.
              Only transitions legal from current server state are exposed.
              Explicit labels — no generic "Next" button.
              PICKED_UP → read-only (no action buttons). */}
          <div className="mt-3 space-y-2">
            {/* NEW queue: Accept button */}
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
              {/* PREPARING → Mark Almost Ready */}
              {next === 'ALMOST_READY' && (
                <Button
                  onClick={onAdvance}
                  disabled={busy}
                  className="flex-1 bg-amber-500 hover:bg-amber-600"
                  aria-label="Mark order as almost ready"
                >
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {!busy && <Clock className="mr-1 h-4 w-4" />}
                  Mark Almost Ready
                </Button>
              )}

              {/* ALMOST_READY → Mark Ready for Pickup */}
              {next === 'READY_FOR_PICKUP' && (
                <Button
                  onClick={onAdvance}
                  disabled={busy}
                  className="flex-1 bg-teal-600 hover:bg-teal-700"
                  aria-label="Mark order as ready for pickup"
                >
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {!busy && <Bell className="mr-1 h-4 w-4" />}
                  Mark Ready for Pickup
                </Button>
              )}

              {/* READY_FOR_PICKUP → Verify Pickup (opens modal, NOT a direct transition) */}
              {isReady && (
                <Button
                  onClick={onVerifyPickup}
                  disabled={busy}
                  className="flex-1 bg-teal-600 hover:bg-teal-700"
                  aria-label={`Verify pickup for order ${order.id.slice(-6).toUpperCase()}`}
                >
                  {busy ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1 h-4 w-4" />
                  )}
                  Verify Pickup
                </Button>
              )}

              {/* PICKED_UP — terminal read-only confirmation */}
              {isTerminal && (
                <div className="flex-1 rounded-md bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="mr-1 inline h-3 w-3" /> Handed off to customer
                </div>
              )}

              {/* Cancel button (not for terminal/cancelled orders) */}
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
