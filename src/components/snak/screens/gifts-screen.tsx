'use client'

// src/components/snak/screens/gifts-screen.tsx
//
// Gifts screen — Received + Sent tabs (blueprint §19 FOOD GIFTING +
// DESIGN_SYSTEM.md §5.2.5 Gift card).
//
// Layout:
//   - 2 sub-tabs (Received | Sent) with a pill toggle.
//   - Received: list of GiftCard components (Task 1B). AVAILABLE → Redeem button
//     (calls gift-store.redeemGift → toast + onOpenOrder for order tracking).
//     REDEEMED → "Redeemed ✓" + "View order" button. EXPIRED → "Expired" badge.
//   - Sent: list of sent gifts with recipient avatar, menu item image,
//     message, status badge, expiry countdown. AVAILABLE → "Cancel" button
//     (confirm dialog → toast).
//   - Empty states for both tabs.
//   - Pull-to-refresh.
//   - framer-motion stagger + AnimatePresence on tab switch + card mount.
//
// Governance (Task 6D):
//   - DOES NOT touch any API route — uses GET /api/gifts (via gift-store.refresh).
//   - DOES NOT touch gift-store.ts (Task 1C owns it) — CALLs refresh + redeemGift
//     + cancelGift only.
//   - DOES NOT touch consumer-view.tsx (Task 3A owns it) — communicates via the
//     onOpenOrder prop the parent passes in.
//   - DOES NOT touch types.ts (Task 1B owns it) — uses local additive casts for
//     the gift's redeemedOrderId field (server-returned, not yet in Wave-1B Gift).

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  Gift as GiftIcon,
  RefreshCw,
  Send,
  Inbox,
  Check,
  Clock,
  Ban,
  Loader2,
  ArrowRight,
  UserCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { inr, timeAgo, formatCountdown } from '@/lib/snack'
import { useToast } from '@/hooks/use-toast'
import { useGifts, type GiftStatus } from '@/lib/gift-store'
import { GiftCard } from '@/components/snak/gift-card'
import { EmptyState } from '@/components/snak/empty-state'
import type { Gift, Order } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GiftsScreenProps {
  /** Called when the user redeems a gift — parent opens order tracking. */
  onOpenOrder: (order: Order) => void
}

type Tab = 'received' | 'sent'

// Local additive shape — Task 6C's GET /api/gifts + POST /api/gifts/[id]/redeem
// both return server-side fields that aren't yet on the Wave-1B Gift interface:
//   - redemptionCode: the single-use code (8-char hex) the recipient must submit
//     to redeem. The gift-store.redeemGift(giftId, redemptionCode) signature
//     requires this; we read it from the gift object fetched via GET /api/gifts.
//   - recipientOrderId: the zero-amount Order id created on redemption. We use
//     this to drive onOpenOrder(order) right after a successful redeem.
// We read both via cast (without modifying the Wave-1B Gift interface).
type GiftWithOrder = Gift & {
  orderId?: string
  redeemedOrderId?: string
  recipientOrderId?: string | null
  redemptionCode?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TAB_LABELS: Array<{ key: Tab; label: string; icon: typeof Inbox }> = [
  { key: 'received', label: 'Received', icon: Inbox },
  { key: 'sent', label: 'Sent', icon: Send },
]

// ─────────────────────────────────────────────────────────────────────────────
// Motion variants
// ─────────────────────────────────────────────────────────────────────────────

const LIST_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
}

const LIST_ITEM: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: [0.3, 0, 0, 1] },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A gift is "available" (redeemable) if its status indicates it's paid +
 *  ready to claim. The Gift.status field is a string; we accept both the
 *  Wave-1B 'PENDING' value and the blueprint §19 'AVAILABLE' value. */
function isAvailable(status: string): boolean {
  return status === 'AVAILABLE' || status === 'PENDING' || status === 'PAID'
}

function isRedeemed(status: string): boolean {
  return status === 'REDEEMED'
}

function isExpired(gift: Gift, now: number): boolean {
  if (gift.status === 'EXPIRED') return true
  // Defensive — if the server hasn't flipped the status yet, treat gifts past
  // their expiry as expired locally so the UI is correct.
  return new Date(gift.expiresAt).getTime() < now
}

function isCancelled(status: string): boolean {
  return status === 'CANCELLED' || status === 'REFUNDED'
}

// ─────────────────────────────────────────────────────────────────────────────
// GiftsScreen — main export
// ─────────────────────────────────────────────────────────────────────────────

export function GiftsScreen({ onOpenOrder }: GiftsScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()
  const {
    sentGifts,
    receivedGifts,
    isLoading,
    refresh,
    redeemGift,
    cancelGift,
  } = useGifts()

  const [tab, setTab] = React.useState<Tab>('received')
  const [refreshing, setRefreshing] = React.useState(false)
  const [redeemingId, setRedeemingId] = React.useState<string | null>(null)
  const [cancellingGift, setCancellingGift] = React.useState<Gift | null>(null)
  const [cancelling, setCancelling] = React.useState(false)

  // ── Initial load + pull-to-refresh ──────────────────────────────────────────
  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // ── Redeem handler ──────────────────────────────────────────────────────────
  // Calls gift-store.redeemGift(giftId, redemptionCode). The redemptionCode is
  // the single-use 8-char hex code stored on the Gift row (Task 6C's
  // generateRedemptionCode in gift-service.ts). The server validates that the
  // submitted code matches the stored code AND that the caller is the gift's
  // recipient — passing the wrong code returns 403 AUTHORIZATION_DENIED.
  //
  // After success, the gift object returned by the store carries
  // `recipientOrderId` (the zero-amount Order created for pickup). We read it
  // via cast and navigate to order tracking by constructing a minimal Order
  // stub — the consumer-view's tracking overlay fetches the real order via
  // /api/orders/[id] for full detail.
  async function handleRedeem(gift: Gift) {
    const giftExt = gift as GiftWithOrder
    const code = giftExt.redemptionCode
    if (!code) {
      toast({
        title: 'Cannot redeem gift',
        description: 'Redemption code missing. Pull to refresh and try again.',
        variant: 'destructive',
      })
      return
    }
    setRedeemingId(gift.id)
    try {
      const updated = (await redeemGift(gift.id, code)) as GiftWithOrder
      const orderId = updated.recipientOrderId ?? updated.orderId ?? updated.redeemedOrderId
      toast({
        title: 'Gift redeemed! 🎁',
        description: `Pickup at ${gift.restaurantName}.`,
      })
      if (orderId) {
        // Construct a minimal Order stub so the consumer-view's tracking overlay
        // can fetch the real order via /api/orders/[id].
        const stub: Order = {
          id: orderId,
          status: 'CREATED',
          totalAmount: 0,
          pickupOtp: '',
          isCatering: false,
          headcount: null,
          itemsCount: 1,
          note: `Gift redemption: ${gift.itemName}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          statusHistory: '[]',
          restaurant: {
            id: gift.restaurantId,
            name: gift.restaurantName,
          },
          items: [
            {
              name: gift.itemName,
              price: gift.valuePaise,
              quantity: 1,
              subtotal: gift.valuePaise,
              menuItemId: gift.menuItemId,
            },
          ],
        }
        onOpenOrder(stub)
      } else {
        // No order id returned — guide the user to the orders tab.
        toast({
          title: 'Pickup ready',
          description: 'Check your Orders tab for pickup details.',
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not redeem gift'
      toast({
        title: 'Redemption failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setRedeemingId(null)
    }
  }

  // ── Cancel handler (with confirm dialog) ────────────────────────────────────
  async function handleConfirmCancel() {
    if (!cancellingGift) return
    setCancelling(true)
    try {
      await cancelGift(cancellingGift.id)
      toast({
        title: 'Gift cancelled',
        description: `Gift to ${cancellingGift.recipientName} was cancelled.`,
      })
      setCancellingGift(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not cancel gift'
      toast({
        title: 'Cancel failed',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setCancelling(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <PullToRefresh onRefresh={handleRefresh} refreshing={refreshing}>
      <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-24">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 text-white">
            <GiftIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Gifts</h1>
            <p className="text-xs text-muted-foreground">
              Send and receive food gifts with friends.
            </p>
          </div>
        </header>

        {/* ── Tab toggle ─────────────────────────────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Gifts tabs"
          className="mb-5 inline-flex w-full rounded-full bg-muted p-1"
        >
          {TAB_LABELS.map(({ key, label, icon: Icon }) => {
            const isActive = tab === key
            const count = key === 'received' ? receivedGifts.length : sentGifts.length
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(key)}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {count > 0 && (
                  <span
                    className={cn(
                      'ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                      isActive ? 'bg-white/20 text-white' : 'bg-muted-foreground/15 text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Content ───────────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={prefersReduced ? false : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, x: -8 }}
            transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
          >
            {tab === 'received' ? (
              <ReceivedTab
                gifts={receivedGifts}
                loading={isLoading && receivedGifts.length === 0}
                refreshing={refreshing}
                redeemingId={redeemingId}
                onRedeem={handleRedeem}
                onOpenOrder={onOpenOrder}
              />
            ) : (
              <SentTab
                gifts={sentGifts}
                loading={isLoading && sentGifts.length === 0}
                refreshing={refreshing}
                onCancel={setCancellingGift}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Cancel confirm dialog ──────────────────────────────────────────────── */}
      <AlertDialog
        open={!!cancellingGift}
        onOpenChange={(o) => !o && setCancellingGift(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this gift?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancellingGift ? (
                <>
                  The gift of <span className="font-medium">{cancellingGift.itemName}</span> to{' '}
                  <span className="font-medium">{cancellingGift.recipientName}</span> will be
                  cancelled. If payment has settled, a refund will be issued automatically.
                </>
              ) : (
                'The gift will be cancelled.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep gift</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={cancelling}
              className="bg-danger-600 text-white hover:bg-danger-700"
            >
              {cancelling ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                  Cancelling…
                </>
              ) : (
                'Cancel gift'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PullToRefresh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ReceivedTab — list of GiftCard components with redeem CTA
// ═══════════════════════════════════════════════════════════════════════════

interface ReceivedTabProps {
  gifts: Gift[]
  loading: boolean
  refreshing: boolean
  redeemingId: string | null
  onRedeem: (gift: Gift) => void
  onOpenOrder: (order: Order) => void
}

function ReceivedTab({
  gifts,
  loading,
  redeemingId,
  onRedeem,
  onOpenOrder,
}: ReceivedTabProps) {
  const prefersReduced = useReducedMotion()
  const [now, setNow] = React.useState(() => Date.now())

  // Tick every minute so the expiry countdown stays fresh.
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border">
            <Skeleton className="aspect-[16/9] w-full rounded-none" />
            <div className="space-y-2 p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-16" />
                </div>
              </div>
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (gifts.length === 0) {
    return (
      <EmptyState
        variant="no-orders"
        title="No gifts received yet"
        description="Ask a friend to send you one! Gifts appear here the moment they're sent."
        className="py-12"
      />
    )
  }

  // Sort: redeemable first, then redeemed, then expired.
  const sorted = [...gifts].sort((a, b) => {
    const rank = (g: Gift) => {
      if (isAvailable(g.status)) return 0
      if (isRedeemed(g.status)) return 1
      if (isExpired(g, now)) return 2
      return 3
    }
    return rank(a) - rank(b) || +new Date(b.createdAt) - +new Date(a.createdAt)
  })

  return (
    <motion.div
      variants={LIST_CONTAINER}
      initial={prefersReduced ? false : 'hidden'}
      animate="show"
      className="space-y-3"
    >
      {sorted.map((gift) => (
        <motion.div key={gift.id} variants={LIST_ITEM}>
          <ReceivedGiftRow
            gift={gift}
            now={now}
            redeeming={redeemingId === gift.id}
            onRedeem={onRedeem}
            onOpenOrder={onOpenOrder}
          />
        </motion.div>
      ))}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ReceivedGiftRow — wraps GiftCard with state-aware footer
// ─────────────────────────────────────────────────────────────────────────────

interface ReceivedGiftRowProps {
  gift: Gift
  now: number
  redeeming: boolean
  onRedeem: (gift: Gift) => void
  onOpenOrder: (order: Order) => void
}

function ReceivedGiftRow({ gift, now, redeeming, onRedeem, onOpenOrder }: ReceivedGiftRowProps) {
  const available = isAvailable(gift.status) && !isExpired(gift, now)
  const redeemed = isRedeemed(gift.status)
  const expired = isExpired(gift, now)

  // The Wave-1B GiftCard only renders the Redeem button + ticking countdown
  // when `gift.status === 'PENDING'`. Task 6C's GET /api/gifts returns the
  // proper §19 lifecycle status (AVAILABLE for paid+ready-to-redeem gifts),
  // which GiftCard would treat as "other" (no button, no countdown). To make
  // the existing GiftCard work without modifying it, we remap the gift's
  // status to 'PENDING' when it's actually AVAILABLE/PAID — preserving the
  // original status for the badge overlay below.
  const giftForCard: Gift = available
    ? { ...gift, status: 'PENDING' }
    : gift

  // For REDEEMED gifts, the recipientOrderId is the zero-amount Order id
  // created at redeem time. We read it via cast (server returns it; Wave-1B
  // Gift type doesn't include it yet).
  const giftExt = gift as GiftWithOrder
  const redeemedOrderId =
    giftExt.recipientOrderId ?? giftExt.orderId ?? giftExt.redeemedOrderId

  // The GiftCard already renders the Redeem button + status pill. We delegate
  // to it for AVAILABLE gifts; for REDEEMED / EXPIRED we render the card with
  // a disabled state and overlay a "View order" CTA when redeemed.
  return (
    <div className="relative">
      <GiftCard
        gift={giftForCard}
        onRedeem={(g) => onRedeem(g)}
        redeeming={redeeming}
        redeemLabel="Redeem gift"
      />
      {/* Additional footer for REDEEMED — show "View order" CTA.
          GiftCard already shows "Redeemed ✓" in its footer, so we add a small
          action button below the card for navigation. */}
      {redeemed && redeemedOrderId && (
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => {
              // Construct a minimal Order stub — the consumer-view's tracking
              // overlay will fetch the real order via /api/orders/[id].
              const stub: Order = {
                id: redeemedOrderId,
                status: 'CREATED',
                totalAmount: 0,
                pickupOtp: '',
                isCatering: false,
                headcount: null,
                itemsCount: 1,
                note: `Gift redemption: ${gift.itemName}`,
                createdAt: gift.redeemedAt ?? gift.createdAt,
                updatedAt: gift.redeemedAt ?? gift.createdAt,
                statusHistory: '[]',
                restaurant: {
                  id: gift.restaurantId,
                  name: gift.restaurantName,
                },
                items: [
                  {
                    name: gift.itemName,
                    price: gift.valuePaise,
                    quantity: 1,
                    subtotal: gift.valuePaise,
                    menuItemId: gift.menuItemId,
                  },
                ],
              }
              onOpenOrder(stub)
            }}
          >
            View order
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      )}
      {expired && !redeemed && (
        <div className="mt-2 flex justify-end">
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-semibold text-danger-700 dark:bg-danger-950/50 dark:text-danger-300">
            <Ban className="h-3 w-3" aria-hidden="true" />
            Expired
          </span>
        </div>
      )}
      {/* Hidden screen-reader hint for the gift status */}
      <span className="sr-only">
        {available
          ? 'Available to redeem.'
          : redeemed
            ? 'Already redeemed.'
            : expired
              ? 'Expired.'
              : 'Cancelled.'}
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SentTab — list of sent gifts with recipient avatar + cancel CTA
// ═══════════════════════════════════════════════════════════════════════════

interface SentTabProps {
  gifts: Gift[]
  loading: boolean
  refreshing: boolean
  onCancel: (gift: Gift) => void
}

function SentTab({ gifts, loading, onCancel }: SentTabProps) {
  const prefersReduced = useReducedMotion()
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 w-20" />
              </div>
            </div>
            <Skeleton className="mt-3 h-20 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (gifts.length === 0) {
    return (
      <EmptyState
        variant="no-orders"
        title="No gifts sent yet"
        description="Gift a friend from their profile or a restaurant menu!"
        className="py-12"
      />
    )
  }

  // Sort: available (cancellable) first, then redeemed, then expired/cancelled.
  const sorted = [...gifts].sort((a, b) => {
    const rank = (g: Gift) => {
      if (isAvailable(g.status) && !isExpired(g, now)) return 0
      if (isRedeemed(g.status)) return 1
      if (isExpired(g, now)) return 2
      return 3
    }
    return rank(a) - rank(b) || +new Date(b.createdAt) - +new Date(a.createdAt)
  })

  return (
    <motion.div
      variants={LIST_CONTAINER}
      initial={prefersReduced ? false : 'hidden'}
      animate="show"
      className="space-y-3"
    >
      {sorted.map((gift) => (
        <motion.div key={gift.id} variants={LIST_ITEM}>
          <SentGiftRow gift={gift} now={now} onCancel={onCancel} />
        </motion.div>
      ))}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SentGiftRow — recipient + menu item + message + status + cancel CTA
// ─────────────────────────────────────────────────────────────────────────────

interface SentGiftRowProps {
  gift: Gift
  now: number
  onCancel: (gift: Gift) => void
}

function SentGiftRow({ gift, now, onCancel }: SentGiftRowProps) {
  const available = isAvailable(gift.status) && !isExpired(gift, now)
  const redeemed = isRedeemed(gift.status)
  const expired = isExpired(gift, now)
  const cancelled = isCancelled(gift.status)

  const msRemaining = new Date(gift.expiresAt).getTime() - now
  const expiringSoon = available && msRemaining < 2 * 60 * 60 * 1000 && msRemaining > 0

  function initials(name: string) {
    return name
      .split(' ')
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-card shadow-sm',
        available && 'border-violet-200 dark:border-violet-900/60',
        (redeemed || cancelled) && 'opacity-80',
        expired && 'border-danger-200 dark:border-danger-900/60',
      )}
      aria-label={`Gift sent to ${gift.recipientName}`}
    >
      {/* Recipient header */}
      <div className="flex items-center gap-3 p-3">
        <Avatar className="h-9 w-9 ring-2 ring-violet-300 dark:ring-violet-800">
          {/* Sent gifts carry the recipient's avatar in senderAvatarUrl field
              (per Wave-1B Gift shape — there's no recipientAvatarUrl). */}
          {gift.senderAvatarUrl && <AvatarImage src={gift.senderAvatarUrl} alt="" />}
          <AvatarFallback className="bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            {initials(gift.recipientName) || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            To <span className="font-semibold">{gift.recipientName}</span>
          </p>
          <p className="text-xs text-muted-foreground">{timeAgo(gift.createdAt)}</p>
        </div>
        <StatusBadge
          status={gift.status as GiftStatus}
          available={available}
          redeemed={redeemed}
          expired={expired}
          cancelled={cancelled}
        />
      </div>

      {/* Item preview */}
      <div className="flex items-center gap-3 bg-muted/40 px-3 py-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {gift.itemImageUrl ? (
            <img
              src={gift.itemImageUrl}
              alt={gift.itemName}
              className={cn(
                'h-full w-full object-cover',
                (redeemed || expired || cancelled) && 'grayscale',
              )}
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-400 to-fuchsia-600 text-lg">
              🍽
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{gift.itemName}</p>
          <p className="truncate text-xs text-muted-foreground">{gift.restaurantName}</p>
        </div>
        <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
          {inr(gift.valuePaise)}
        </span>
      </div>

      {/* Message */}
      {gift.message && (
        <p className="line-clamp-3 border-l-2 border-violet-300 px-3 py-2 text-sm italic text-foreground dark:border-violet-800">
          &ldquo;{gift.message}&rdquo;
        </p>
      )}

      {/* Footer — expiry countdown + cancel */}
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        {available ? (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                expiringSoon ? 'font-semibold text-warning' : 'text-muted-foreground',
              )}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {expiringSoon ? 'Expires in ' : ''}
              {formatCountdown(msRemaining)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-danger-600 hover:bg-danger-50 hover:text-danger-700 dark:text-danger-400 dark:hover:bg-danger-950/40"
              onClick={() => onCancel(gift)}
            >
              <Ban className="h-3 w-3" aria-hidden="true" />
              Cancel gift
            </Button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {redeemed && (
                <>
                  <Check className="h-3 w-3 text-success-600 dark:text-success-400" aria-hidden="true" />
                  Redeemed {gift.redeemedAt ? `· ${timeAgo(gift.redeemedAt)}` : ''}
                </>
              )}
              {expired && !redeemed && (
                <>
                  <Ban className="h-3 w-3" aria-hidden="true" />
                  Expired
                </>
              )}
              {cancelled && (
                <>
                  <Ban className="h-3 w-3" aria-hidden="true" />
                  {gift.status === 'REFUNDED' ? 'Refunded' : 'Cancelled'}
                </>
              )}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <UserCircle2 className="h-3 w-3" aria-hidden="true" />
              {gift.recipientName}
            </span>
          </>
        )}
      </div>
    </article>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// StatusBadge — pill indicator for sent gifts
// ═══════════════════════════════════════════════════════════════════════════

interface StatusBadgeProps {
  status: GiftStatus
  available: boolean
  redeemed: boolean
  expired: boolean
  cancelled: boolean
}

function StatusBadge({ available, redeemed, expired, cancelled }: StatusBadgeProps) {
  if (available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
        <GiftIcon className="h-3 w-3" aria-hidden="true" />
        Available
      </span>
    )
  }
  if (redeemed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-950/50 dark:text-success-300">
        <Check className="h-3 w-3" aria-hidden="true" />
        Redeemed
      </span>
    )
  }
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-semibold text-danger-700 dark:bg-danger-950/50 dark:text-danger-300">
        <Ban className="h-3 w-3" aria-hidden="true" />
        Expired
      </span>
    )
  }
  if (cancelled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
        <Ban className="h-3 w-3" aria-hidden="true" />
        Cancelled
      </span>
    )
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// PullToRefresh — touch-based pull-to-refresh (same pattern as Home/Rewards).
// ═══════════════════════════════════════════════════════════════════════════

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  refreshing: boolean
  children: React.ReactNode
}

const PULL_THRESHOLD = 70

function PullToRefresh({ onRefresh, refreshing, children }: PullToRefreshProps) {
  const startY = React.useRef<number | null>(null)
  const [pull, setPull] = React.useState(0)
  const [isPulling, setIsPulling] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    const target = containerRef.current
    if (!target || target.scrollTop > 0) {
      startY.current = null
      setIsPulling(false)
      return
    }
    startY.current = e.touches[0]?.clientY ?? null
    setIsPulling(true)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null || refreshing) return
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current
    if (dy > 0) {
      const dampened = Math.min(120, dy * 0.5)
      setPull(dampened)
    }
  }

  function onTouchEnd() {
    if (startY.current === null) return
    startY.current = null
    setIsPulling(false)
    if (pull >= PULL_THRESHOLD && !refreshing) {
      void onRefresh()
    }
    setPull(0)
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="relative"
    >
      {(pull > 4 || refreshing) && (
        <div
          className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2"
          aria-hidden="true"
        >
          <RefreshCw
            className={`h-5 w-5 text-violet-600 dark:text-violet-400 ${refreshing ? 'animate-spin' : ''}`}
            style={{ transform: `rotate(${Math.min(180, pull * 2)}deg)` }}
          />
        </div>
      )}
      <div
        style={{
          transform: `translateY(${refreshing ? 24 : pull}px)`,
          transition: isPulling ? 'none' : 'transform 200ms ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default GiftsScreen
