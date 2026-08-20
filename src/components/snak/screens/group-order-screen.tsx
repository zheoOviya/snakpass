'use client'

// src/components/snak/screens/group-order-screen.tsx
//
// Group order detail screen (blueprint §20 GROUP ORDERING + DESIGN_SYSTEM.md
// §5.2.6 Group order bubble + §5.6.3 Group order progress + §5.8.7 Group
// rose CTA). Full-screen surface that renders once the user has created OR
// joined a group order.
//
// Layout (mobile-first, scrollable):
//   1. Header — restaurant banner + "Group Order" badge + share code +
//      "Copy link" + "Share" buttons.
//   2. Members list — avatar stack + names + "Host" badge on host.
//      "Join" button if the current user isn't a member yet.
//   3. My items — list of items with quantity steppers + remove. "Add Items"
//      button opens a quick-add modal with the menu.
//   4. All members' items — grouped by member, each member's items + subtotal.
//      Grand total at the bottom.
//   5. Host controls — "Confirm & Pay" (creates a single merged Order) +
//      "Cancel Group Order" (confirm dialog).
//   6. Member controls — "Leave group" (removes self as member).
//
// API contracts (Task 7A — implemented in parallel):
//   - GET    /api/group-orders/[id]              → { groupOrder, members, myItems, allItems }
//   - POST   /api/group-orders/[id]/join         → { groupOrder }
//   - POST   /api/group-orders/[id]/items        { menuItemId, quantity } → { item }
//   - PATCH  /api/group-orders/[id]/items/[itemId] { quantity } → { item }  (increment/decrement)
//   - DELETE /api/group-orders/[id]/items/[itemId]                       → { ok }
//   - POST   /api/group-orders/[id]/confirm     → { order, groupOrder }
//   - POST   /api/group-orders/[id]/cancel      → { groupOrder }
//
// Governance (Task 7B):
//   - DOES NOT touch any API route.
//   - DOES NOT touch group-order-store.ts (Task 1C owns) — calls the API
//     directly via csrfFetch. The store uses an older contract shape (queries
//     by shareCode rather than id); this screen uses the new id-based
//     contract per the task brief.
//   - DOES NOT touch consumer-view.tsx / app-shell.tsx / bottom-nav.tsx
//     (Tasks 2B/1B own). The parent renders this screen + wires onBack /
//     onConfirmSuccess.
//   - DOES NOT touch types.ts (Task 1B owns) — uses a local additive cast
//     `GroupOrderDetail` for the `shareCode` field (server-returned, not yet
//     in the Wave-1B GroupOrder interface).
//
// Realtime: per task brief, refresh on `group-order:updated` socket event
// (if the realtime service emits it) — else poll every 10s. We do BOTH: a
// 10s poll as a baseline (covers the no-realtime case) + a socket listener
// (covers the realtime case). The socket listener is best-effort — if the
// realtime service doesn't emit `group-order:updated`, the listener is a
// no-op and the poll alone keeps the screen fresh.

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  ArrowLeft,
  Users,
  Crown,
  Copy,
  Share2,
  Check,
  Plus,
  Minus,
  Trash2,
  Loader2,
  RefreshCw,
  Lock,
  Check as CheckIcon,
  X,
  ShoppingCart,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { inr, formatCountdown, timeAgo } from '@/lib/snack'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { useAuth } from '@/hooks/use-auth'
import { csrfFetch } from '@/lib/csrf-client'
import { realtimeSocket } from '@/hooks/use-realtime'
import type {
  GroupOrder,
  GroupOrderMember,
  GroupOrderItem,
  MenuItem,
  Restaurant,
  Order,
} from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Local additive types — server-returned fields not in Wave-1B types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Additive GroupOrder shape — Task 7A's GET /api/group-orders/[id] returns
 * the standard GroupOrder fields PLUS a `shareCode` (the deep-link id used
 * in the share URL `/group/${shareCode}`). We cast to read it without
 * modifying the Wave-1B interface.
 */
type GroupOrderDetail = GroupOrder & {
  shareCode?: string
  /** Optional host-set name ("Lunch with friends"). */
  name?: string | null
  /** Optional restaurant image URL for the banner. */
  restaurantImage?: string | null
}

/**
 * GET /api/group-orders/[id] response. The task brief says the response
 * nests members/myItems/allItems INSIDE the groupOrder object:
 *   `{ groupOrder: { ..., members, myItems, allItems } }`
 *
 * But the existing store reads them as top-level fields. To be defensive,
 * we read both shapes (nested first, fall back to top-level).
 */
interface GroupOrderDetailResponse {
  groupOrder: GroupOrderDetail & {
    members?: GroupOrderMember[]
    myItems?: GroupOrderItem[]
    allItems?: GroupOrderItem[]
  }
  // Fallback shape (older contract — used by Wave-1C store).
  members?: GroupOrderMember[]
  myItems?: GroupOrderItem[]
  allItems?: GroupOrderItem[]
}

interface JoinResponse {
  groupOrder: GroupOrderDetail
}

interface AddItemResponse {
  item: GroupOrderItem
}

interface UpdateItemResponse {
  item: GroupOrderItem
}

interface ConfirmResponse {
  order: Order
  groupOrder: GroupOrderDetail
}

interface CancelResponse {
  groupOrder: GroupOrderDetail
}

interface MenuResponse {
  items?: MenuItem[]
}

interface RestaurantResponse {
  restaurant?: Restaurant
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion presets
// ─────────────────────────────────────────────────────────────────────────────

const LIST_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
}

const LIST_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.3, 0, 0, 1] } },
}

const POLL_INTERVAL_MS = 10_000

// ═══════════════════════════════════════════════════════════════════════════
// GroupOrderScreen — main export
// ═══════════════════════════════════════════════════════════════════════════

export interface GroupOrderScreenProps {
  groupOrderId: string
  /** Called after the host successfully confirms + the merged Order is created. */
  onConfirmSuccess: (order: Order) => void
  /** Tap the back button. */
  onBack: () => void
}

export function GroupOrderScreen({
  groupOrderId,
  onConfirmSuccess,
  onBack,
}: GroupOrderScreenProps) {
  const prefersReduced = useReducedMotion()
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const { user } = useAuth()

  // ── Data state ────────────────────────────────────────────────────────────
  const [groupOrder, setGroupOrder] = React.useState<GroupOrderDetail | null>(null)
  const [members, setMembers] = React.useState<GroupOrderMember[]>([])
  const [myItems, setMyItems] = React.useState<GroupOrderItem[]>([])
  const [allItems, setAllItems] = React.useState<GroupOrderItem[]>([])

  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // ── Action state ──────────────────────────────────────────────────────────
  const [joining, setJoining] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false)
  const [addItemsOpen, setAddItemsOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [busyItemId, setBusyItemId] = React.useState<string | null>(null)

  // ── Fetch the group order ──────────────────────────────────────────────────
  const fetchGroupOrder = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setRefreshing(true)
      try {
        const res = await fetch(
          `/api/group-orders/${encodeURIComponent(groupOrderId)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
          throw new Error(body?.error || body?.message || `Failed (${res.status})`)
        }
        const data = (await res.json()) as GroupOrderDetailResponse
        const g = data.groupOrder
        // Read members/myItems/allItems — try nested first, fall back to top-level.
        const nested = g as GroupOrderDetailResponse['groupOrder']
        setGroupOrder(g)
        setMembers(nested.members ?? data.members ?? [])
        setMyItems(nested.myItems ?? data.myItems ?? [])
        setAllItems(nested.allItems ?? data.allItems ?? [])
        setError(null)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not load group order'
        setError(msg)
        if (!opts?.silent) {
          toast({
            title: 'Could not load group order',
            description: msg,
            variant: 'destructive',
          })
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [groupOrderId, toast],
  )

  // ── Initial load ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    void fetchGroupOrder()
  }, [fetchGroupOrder])

  // ── Polling + realtime refresh ────────────────────────────────────────────
  // Poll every 10s as a baseline (covers no-realtime). Also subscribe to the
  // `group-order:updated` socket event (best-effort — if the realtime service
  // doesn't emit it, the listener is a silent no-op).
  React.useEffect(() => {
    const interval = setInterval(() => {
      void fetchGroupOrder({ silent: true })
    }, POLL_INTERVAL_MS)

    let socket: ReturnType<typeof realtimeSocket> | null = null
    let handler: ((payload: unknown) => void) | null = null
    try {
      socket = realtimeSocket()
      handler = (payload: unknown) => {
        const p = (payload ?? {}) as { groupOrderId?: string }
        if (p.groupOrderId === groupOrderId) {
          void fetchGroupOrder({ silent: true })
        }
      }
      socket.on('group-order:updated', handler)
    } catch {
      // Realtime unavailable — polling alone keeps the screen fresh.
    }

    return () => {
      clearInterval(interval)
      if (socket && handler) {
        try {
          socket.off('group-order:updated', handler)
        } catch {
          // ignore
        }
      }
    }
  }, [fetchGroupOrder, groupOrderId])

  // ── Derived state ──────────────────────────────────────────────────────────
  const isHost = !!user && !!groupOrder && user.userId === groupOrder.hostId
  const hasJoined = !!user && (
    isHost ||
    members.some((m) => m.userId === user.userId && m.status !== 'LEFT')
  )
  const isLocked = groupOrder?.status === 'LOCKED'
  const isPlaced = groupOrder?.status === 'PLACED'
  const isCancelled = groupOrder?.status === 'CANCELLED'
  const isOpen = groupOrder?.status === 'OPEN'
  const shareCode = groupOrder?.shareCode
  const shareLink = shareCode
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/group/${shareCode}`
    : null

  const myItemsSubtotal = myItems.reduce((sum, i) => sum + i.subtotalPaise, 0)
  const grandTotal = allItems.reduce((sum, i) => sum + i.subtotalPaise, 0)
  const totalItems = allItems.reduce((sum, i) => sum + i.quantity, 0)

  // Group allItems by memberId so we can render "all members' items".
  const itemsByMember = React.useMemo(() => {
    const map = new Map<string, GroupOrderItem[]>()
    for (const it of allItems) {
      const arr = map.get(it.memberId) ?? []
      arr.push(it)
      map.set(it.memberId, arr)
    }
    return map
  }, [allItems])

  // Resolve a memberId → display info. The host is the implicit member with
  // id === groupOrder.hostId (GroupOrderMember type covers non-host members).
  function resolveMember(memberId: string): {
    name: string
    avatarUrl?: string
    isHost: boolean
    isMe: boolean
  } {
    if (groupOrder && memberId === groupOrder.hostId) {
      return {
        name: groupOrder.hostName + (groupOrder.name ? ` · ${groupOrder.name}` : ''),
        avatarUrl: groupOrder.hostAvatarUrl,
        isHost: true,
        isMe: !!user && user.userId === groupOrder.hostId,
      }
    }
    const m = members.find((mm) => mm.userId === memberId)
    return {
      name: m?.userName ?? 'Unknown member',
      avatarUrl: m?.userAvatarUrl,
      isHost: false,
      isMe: !!user && !!m && m.userId === user.userId,
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleJoin() {
    setJoining(true)
    try {
      const res = await csrfFetch(
        `/api/group-orders/${encodeURIComponent(groupOrderId)}/join`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
      toast({
        title: 'Joined! 🎉',
        description: groupOrder ? `You're in for ${groupOrder.restaurantName}.` : 'Welcome to the group.',
      })
      await fetchGroupOrder({ silent: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not join'
      toast({
        title: 'Join failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setJoining(false)
    }
  }

  async function handleCopyLink() {
    if (!shareLink) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink)
      } else {
        const ta = document.createElement('textarea')
        ta.value = shareLink
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      toast({ title: 'Link copied!', description: 'Send it to your friends.' })
      setTimeout(() => setCopied(false), 2200)
    } catch {
      toast({
        title: 'Could not copy',
        description: shareLink,
        variant: 'destructive',
      })
    }
  }

  async function handleShare() {
    if (!shareLink || !groupOrder) return
    const shareData = {
      title: 'Join my group order on SnakZap',
      text: `Join my group order at ${groupOrder.restaurantName}!`,
      url: shareLink,
    }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
      } else {
        await handleCopyLink()
      }
    } catch {
      // User cancelled share — silent.
    }
  }

  // ── My items quantity stepper ─────────────────────────────────────────────
  async function handleQuantityChange(item: GroupOrderItem, delta: number) {
    if (busyItemId) return
    const newQty = item.quantity + delta
    if (newQty <= 0) {
      // Remove the item entirely.
      await handleRemoveItem(item)
      return
    }
    setBusyItemId(item.id)
    try {
      const res = await csrfFetch(
        `/api/group-orders/${encodeURIComponent(groupOrderId)}/items/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: newQty }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
      const data = (await res.json()) as UpdateItemResponse
      setMyItems((items) =>
        items.map((i) => (i.id === data.item.id ? data.item : i)),
      )
      setAllItems((items) =>
        items.map((i) => (i.id === data.item.id ? data.item : i)),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update item'
      toast({
        title: 'Update failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleRemoveItem(item: GroupOrderItem) {
    if (busyItemId) return
    setBusyItemId(item.id)
    // Optimistic: remove locally first.
    const prevMy = myItems
    const prevAll = allItems
    setMyItems((items) => items.filter((i) => i.id !== item.id))
    setAllItems((items) => items.filter((i) => i.id !== item.id))
    try {
      const res = await csrfFetch(
        `/api/group-orders/${encodeURIComponent(groupOrderId)}/items/${encodeURIComponent(item.id)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
    } catch (e) {
      // Rollback.
      setMyItems(prevMy)
      setAllItems(prevAll)
      const msg = e instanceof Error ? e.message : 'Could not remove item'
      toast({
        title: 'Remove failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setBusyItemId(null)
    }
  }

  // ── Add items via the quick-add sheet ─────────────────────────────────────
  async function handleQuickAdd(item: MenuItem, quantity: number) {
    if (!groupOrder) return
    const res = await csrfFetch(
      `/api/group-orders/${encodeURIComponent(groupOrderId)}/items`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuItemId: item.id, quantity }),
      },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      throw new Error(body?.error || body?.message || `Failed (${res.status})`)
    }
    const data = (await res.json()) as AddItemResponse
    // Optimistic merge — if the item already exists in my cart, increment;
    // otherwise append.
    setMyItems((items) => {
      const existing = items.find((i) => i.menuItemId === item.id)
      if (existing) {
        return items.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                quantity: i.quantity + quantity,
                subtotalPaise: i.pricePaise * (i.quantity + quantity),
              }
            : i,
        )
      }
      return [...items, data.item]
    })
    setAllItems((items) => {
      const existing = items.find((i) => i.menuItemId === item.id && i.memberId === data.item.memberId)
      if (existing) {
        return items.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                quantity: i.quantity + quantity,
                subtotalPaise: i.pricePaise * (i.quantity + quantity),
              }
            : i,
        )
      }
      return [...items, data.item]
    })
  }

  // ── Host: confirm + pay ──────────────────────────────────────────────────
  async function handleConfirm() {
    if (!groupOrder) return
    setConfirming(true)
    try {
      const res = await csrfFetch(
        `/api/group-orders/${encodeURIComponent(groupOrderId)}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
      const data = (await res.json()) as ConfirmResponse
      toast({
        title: 'Order confirmed! 🎉',
        description: `Proceeding to checkout — ${data.order.itemsCount} items.`,
      })
      // Update local state so a back-nav shows the PLACED status.
      setGroupOrder(data.groupOrder)
      onConfirmSuccess(data.order)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not confirm'
      toast({
        title: 'Confirm failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setConfirming(false)
    }
  }

  // ── Host: cancel group order ─────────────────────────────────────────────
  async function handleCancel() {
    if (!groupOrder) return
    setCancelling(true)
    setCancelDialogOpen(false)
    try {
      const res = await csrfFetch(
        `/api/group-orders/${encodeURIComponent(groupOrderId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
      const data = (await res.json()) as CancelResponse
      setGroupOrder(data.groupOrder)
      toast({
        title: 'Group order cancelled',
        description: 'Members will be notified.',
      })
      onBack()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not cancel'
      toast({
        title: 'Cancel failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setCancelling(false)
    }
  }

  // ── Member: leave group ────────────────────────────────────────────────────
  async function handleLeave() {
    // Member "leave" uses the cancel endpoint (per the existing store's
    // `leave()` method which calls /cancel — the server detects whether the
    // caller is the host or a member and acts accordingly).
    if (!groupOrder) return
    setCancelling(true)
    try {
      const res = await csrfFetch(
        `/api/group-orders/${encodeURIComponent(groupOrderId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
      toast({ title: 'Left group order' })
      onBack()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not leave'
      toast({
        title: 'Leave failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setCancelling(false)
    }
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-24">
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error && !groupOrder) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-24">
        <BackButton onClick={onBack} />
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Could not load group order</p>
          <p className="max-w-md text-xs text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => fetchGroupOrder()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!groupOrder) {
    // Defensive — should not happen (loading handles the no-data case).
    return null
  }

  // Status badge label
  const statusBadge =
    isOpen
      ? { label: 'Open', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' }
      : isLocked
        ? { label: 'Locked', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' }
        : isPlaced
          ? { label: 'Order placed', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' }
          : { label: 'Cancelled', tone: 'bg-muted text-muted-foreground' }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-32">
      {/* ─── Back button + title ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <BackButton onClick={onBack} />
        <h1 className="flex-1 truncate text-base font-semibold text-foreground">
          {groupOrder.name?.trim() || `Group order at ${groupOrder.restaurantName}`}
        </h1>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => fetchGroupOrder()}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      <motion.div
        variants={LIST_CONTAINER}
        initial={prefersReduced ? false : 'hidden'}
        animate="show"
        className="mt-3 space-y-4"
      >
        {/* ─── Header: restaurant banner + status + share code ─────────────── */}
        <motion.section variants={LIST_ITEM} aria-label="Group order summary">
          <div className="relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 dark:border-rose-900/50 dark:from-rose-950/30 dark:to-pink-950/20">
            {/* Banner strip with rose accent + restaurant image/initial */}
            <div className="relative h-20 bg-gradient-to-br from-rose-400 to-rose-600">
              <div className="absolute inset-0 flex items-center justify-between px-4 text-white">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold backdrop-blur-md">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    Group Order
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', statusBadge.tone)}>
                    {statusBadge.label}
                  </span>
                </div>
                {groupOrder.closesAt && isOpen && (
                  <ClosesAtPill closesAt={groupOrder.closesAt} />
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 p-4">
              <Avatar className="h-12 w-12 shrink-0 rounded-xl ring-2 ring-rose-500/30">
                {groupOrder.restaurantImage ? (
                  <AvatarImage src={groupOrder.restaurantImage} alt="" />
                ) : null}
                <AvatarFallback className="rounded-xl bg-gradient-to-br from-rose-400 to-amber-500 text-sm font-bold text-white">
                  {groupOrder.restaurantName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">
                  {groupOrder.restaurantName}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Crown className="h-3 w-3 text-amber-500" aria-hidden="true" />
                  Hosted by <span className="font-medium text-foreground">{groupOrder.hostName}</span>
                </p>
                {groupOrder.createdAt && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Started {timeAgo(groupOrder.createdAt)}
                  </p>
                )}
              </div>
            </div>

            {/* Share code + actions */}
            {shareCode && (
              <div className="flex flex-wrap items-center gap-2 border-t border-rose-200/50 px-4 py-3 dark:border-rose-900/40">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Code
                  </span>
                  <code className="truncate rounded-md bg-white/70 px-2 py-0.5 font-mono text-xs font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    {shareCode}
                  </code>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-rose-300 px-3 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  onClick={handleCopyLink}
                  disabled={!shareLink}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy link
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-rose-300 px-3 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  onClick={handleShare}
                  disabled={!shareLink}
                >
                  <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Share
                </Button>
              </div>
            )}
          </div>
        </motion.section>

        {/* ─── Members list ──────────────────────────────────────────────── */}
        <motion.section variants={LIST_ITEM} aria-label="Members">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Members
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ({members.length + 1})
              </span>
            </h2>
            {isOpen && !hasJoined && (
              <Button
                type="button"
                size="sm"
                onClick={handleJoin}
                disabled={joining}
                className="snak-gradient-group h-8 gap-1.5 px-3 text-xs text-group-foreground hover:opacity-90"
              >
                {joining ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Join
              </Button>
            )}
          </div>

          {/* Avatar stack + names — host first, then members */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MemberChip
              name={groupOrder.hostName}
              avatarUrl={groupOrder.hostAvatarUrl}
              isHost
              isMe={!!user && user.userId === groupOrder.hostId}
            />
            {members.map((m) => (
              <MemberChip
                key={m.id}
                name={m.userName}
                avatarUrl={m.userAvatarUrl}
                isMe={!!user && m.userId === user.userId}
                status={m.status}
              />
            ))}
            {members.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Just you for now — invite friends with the share link above.
              </p>
            )}
          </div>
        </motion.section>

        {/* ─── My items ──────────────────────────────────────────────────── */}
        {hasJoined && (
          <motion.section variants={LIST_ITEM} aria-label="My items">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Your items
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({myItems.reduce((s, i) => s + i.quantity, 0)})
                </span>
              </h2>
              {isOpen && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-rose-300 px-3 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  onClick={() => setAddItemsOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add items
                </Button>
              )}
            </div>

            {myItems.length === 0 ? (
              <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
                <ShoppingCart className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">No items yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {isOpen
                    ? 'Tap "Add items" to pick from the menu.'
                    : 'This group order is locked.'}
                </p>
                {isOpen && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setAddItemsOpen(true)}
                    className="snak-gradient-group mt-1 gap-1.5 text-group-foreground hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add items
                  </Button>
                )}
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                <AnimatePresence initial={false}>
                  {myItems.map((item) => (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.18 }}
                    >
                      <MyItemRow
                        item={item}
                        disabled={busyItemId !== null || !isOpen}
                        onDec={() => handleQuantityChange(item, -1)}
                        onInc={() => handleQuantityChange(item, +1)}
                        onRemove={() => handleRemoveItem(item)}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}

            {myItems.length > 0 && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                <span className="text-xs text-muted-foreground">Your subtotal</span>
                <span className="text-sm font-semibold text-foreground">{inr(myItemsSubtotal)}</span>
              </div>
            )}
          </motion.section>
        )}

        {/* ─── All members' items ───────────────────────────────────────── */}
        <motion.section variants={LIST_ITEM} aria-label="All members' items">
          <h2 className="text-sm font-semibold text-foreground">
            Everyone's order
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({totalItems} {totalItems === 1 ? 'item' : 'items'})
            </span>
          </h2>

          {allItems.length === 0 ? (
            <div className="mt-2 flex flex-col items-center gap-1 rounded-xl border border-dashed p-6 text-center">
              <Users className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">No items in the cart yet</p>
              <p className="text-xs text-muted-foreground">
                Once members add items, they'll appear here.
              </p>
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              {Array.from(itemsByMember.entries()).map(([memberId, items]) => {
                const m = resolveMember(memberId)
                const subtotal = items.reduce((s, i) => s + i.subtotalPaise, 0)
                return (
                  <div
                    key={memberId}
                    className={cn(
                      'rounded-xl border bg-card p-3',
                      m.isHost && 'border-rose-200 dark:border-rose-900/50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                        <AvatarFallback className="bg-muted text-[10px] font-bold text-foreground">
                          {m.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                        {m.name}
                        {m.isMe && <span className="ml-1 text-muted-foreground">(you)</span>}
                      </p>
                      {m.isHost && (
                        <Badge className="bg-rose-100 text-[10px] text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                          Host
                        </Badge>
                      )}
                      <span className="text-xs font-semibold text-foreground">{inr(subtotal)}</span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {items.map((i) => (
                        <li
                          key={i.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {i.quantity}×
                            </span>{' '}
                            {i.name}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {inr(i.subtotalPaise)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}

              {/* Grand total */}
              <div className="flex items-center justify-between rounded-xl bg-rose-50 px-3 py-2.5 dark:bg-rose-950/30">
                <span className="text-sm font-semibold text-foreground">Grand total</span>
                <span className="text-base font-bold text-rose-700 dark:text-rose-300">
                  {inr(grandTotal)}
                </span>
              </div>
            </div>
          )}
        </motion.section>

        {/* ─── Locked / placed / cancelled notice ───────────────────────── */}
        {isLocked && (
          <motion.section variants={LIST_ITEM}>
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                The host is checking out — items are locked for new changes.
              </p>
            </div>
          </motion.section>
        )}
        {isPlaced && (
          <motion.section variants={LIST_ITEM}>
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                Order placed — pickup details are in your Orders tab.
              </p>
            </div>
          </motion.section>
        )}
        {isCancelled && (
          <motion.section variants={LIST_ITEM}>
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                This group order was cancelled.
              </p>
            </div>
          </motion.section>
        )}
      </motion.div>

      {/* ─── Sticky bottom action bar ───────────────────────────────────── */}
      {(isOpen || isLocked) && hasJoined && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            {isHost ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={cancelling || confirming}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </Button>
                <div className="flex-1" />
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={confirming || allItems.length === 0}
                  className="snak-gradient-group gap-2 text-group-foreground hover:opacity-90"
                >
                  {confirming ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Confirming…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Confirm & Pay · {inr(grandTotal)}
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleLeave}
                  disabled={cancelling}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Leave group
                </Button>
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  disabled
                  className="gap-1.5 text-muted-foreground"
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Waiting for host
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Cancel confirmation dialog ─────────────────────────────────── */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this group order?</AlertDialogTitle>
            <AlertDialogDescription>
              All members will be notified and their items will be discarded. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={cancelling}
              className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4" aria-hidden="true" />
              )}
              Cancel group order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Quick-add items sheet (menu browser) ─────────────────────────── */}
      <QuickAddSheet
        open={addItemsOpen}
        onClose={() => setAddItemsOpen(false)}
        restaurantId={groupOrder.restaurantId}
        onAdd={async (item, qty) => {
          try {
            await handleQuickAdd(item, qty)
            toast({
              title: 'Added to group',
              description: `${qty}× ${item.name}`,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Could not add item'
            toast({
              title: 'Add failed',
              description: msg,
              variant: 'destructive',
            })
          }
        }}
        isMobile={isMobile}
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper sub-components
// ═══════════════════════════════════════════════════════════════════════════

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-9 w-9 shrink-0"
      onClick={onClick}
      aria-label="Back"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
    </Button>
  )
}

function ClosesAtPill({ closesAt }: { closesAt: string }) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const ms = new Date(closesAt).getTime() - now
  const label = ms > 0 ? `Closes in ${formatCountdown(ms)}` : 'Closing soon'
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium backdrop-blur-md">
      <Lock className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}

interface MemberChipProps {
  name: string
  avatarUrl?: string
  isHost?: boolean
  isMe?: boolean
  status?: string
}

function MemberChip({ name, avatarUrl, isHost, isMe, status }: MemberChipProps) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2',
        isHost
          ? 'border-rose-300 dark:border-rose-900/60'
          : status === 'LEFT'
            ? 'border-border opacity-60'
            : 'border-border',
      )}
      title={isHost ? `${name} (host)` : isMe ? `${name} (you)` : name}
    >
      <Avatar className="h-6 w-6">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback
          className={cn(
            'text-[10px] font-bold',
            isHost
              ? 'bg-rose-500 text-white'
              : 'bg-muted text-foreground',
          )}
        >
          {initials || '?'}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[100px] truncate text-xs font-medium text-foreground">
        {name}
        {isMe && <span className="text-muted-foreground"> (you)</span>}
      </span>
      {isHost && (
        <Crown
          className="h-3 w-3 text-amber-500"
          aria-label="Host"
        />
      )}
    </div>
  )
}

interface MyItemRowProps {
  item: GroupOrderItem
  disabled: boolean
  onDec: () => void
  onInc: () => void
  onRemove: () => void
}

function MyItemRow({ item, disabled, onDec, onInc, onRemove }: MyItemRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {inr(item.pricePaise)} each · {inr(item.subtotalPaise)} total
        </p>
      </div>

      {/* Quantity stepper */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={onDec}
          disabled={disabled}
          aria-label={`Decrease ${item.name} quantity`}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <span
          className="min-w-[2ch] text-center font-mono text-sm font-semibold tabular-nums text-foreground"
          aria-live="polite"
        >
          {item.quantity}
        </span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={onInc}
          disabled={disabled}
          aria-label={`Increase ${item.name} quantity`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${item.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// QuickAddSheet — bottom sheet / dialog menu browser for fast item add
// ═══════════════════════════════════════════════════════════════════════════

interface QuickAddSheetProps {
  open: boolean
  onClose: () => void
  restaurantId: string
  onAdd: (item: MenuItem, quantity: number) => Promise<void>
  isMobile: boolean
}

function QuickAddSheet({ open, onClose, restaurantId, onAdd, isMobile }: QuickAddSheetProps) {
  const [menu, setMenu] = React.useState<MenuItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  // Per-item add loading state — keyed by menuItemId.
  const [addingId, setAddingId] = React.useState<string | null>(null)

  // Fetch menu when the sheet opens.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/restaurants/${encodeURIComponent(restaurantId)}/menu`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed (${r.status})`)
        return r.json()
      })
      .then((data: MenuResponse) => {
        if (cancelled) return
        setMenu(data.items ?? [])
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load menu')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, restaurantId])

  // Reset search when sheet closes.
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setQuery(''), 200)
      return () => clearTimeout(t)
    }
  }, [open])

  const grouped = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? menu.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.description.toLowerCase().includes(q) ||
            m.category.toLowerCase().includes(q),
        )
      : menu
    const map = new Map<string, MenuItem[]>()
    for (const m of filtered) {
      if (!m.isAvailable) continue
      const arr = map.get(m.category) ?? []
      arr.push(m)
      map.set(m.category, arr)
    }
    return Array.from(map.entries())
  }, [menu, query])

  async function handleAdd(item: MenuItem) {
    if (addingId) return
    setAddingId(item.id)
    try {
      await onAdd(item, 1)
    } finally {
      setAddingId(null)
    }
  }

  const content = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Search bar */}
      <div className="border-b px-4 py-3">
        <div className="relative">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu…"
            aria-label="Search menu items"
            className="h-10 rounded-xl pl-3 pr-3 text-sm"
          />
        </div>
      </div>

      {/* Menu list */}
      <div className="snak-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm font-medium text-foreground">No items found</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {query ? 'Try a different search.' : 'The menu is empty.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </h3>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3"
                    >
                      <Avatar className="h-10 w-10 shrink-0 rounded-lg">
                        {item.image ? <AvatarImage src={item.image} alt="" /> : null}
                        <AvatarFallback className="rounded-lg bg-muted text-xs font-bold text-foreground">
                          {item.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.name}
                          {item.isVeg && (
                            <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {inr(item.price)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAdd(item)}
                        disabled={addingId !== null}
                        className="snak-gradient-group h-8 gap-1 px-3 text-xs text-group-foreground hover:opacity-90"
                      >
                        {addingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer — done button */}
      <div className="flex items-center justify-end border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )

  const header = (
    <SheetHeader className="px-4 pb-2 pt-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base">Add items to group</SheetTitle>
          <SheetDescription className="text-xs">
            Quick-add from the menu — your cart updates live.
          </SheetDescription>
        </div>
      </div>
    </SheetHeader>
  )

  const dialogHeaderEl = (
    <DialogHeader className="px-4 pb-2 pt-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Add items to group</DialogTitle>
          <DialogDescription className="text-xs">
            Quick-add from the menu — your cart updates live.
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          className="flex h-[88vh] max-h-[88vh] flex-col gap-0 p-0"
          aria-describedby={undefined}
        >
          {header}
          {content}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        {dialogHeaderEl}
        {content}
      </DialogContent>
    </Dialog>
  )
}

export default GroupOrderScreen
