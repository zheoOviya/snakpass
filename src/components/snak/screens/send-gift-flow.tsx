'use client'

// src/components/snak/screens/send-gift-flow.tsx
//
// Send-gift multi-step flow (blueprint §19 FOOD GIFTING + DESIGN_SYSTEM.md §5.3.6
// Gift compose). Bottom sheet on mobile, centered modal on desktop.
//
// Flow:
//   Step 1 — Select friend     (search + friends list)
//   Step 2 — Select menu item   (restaurant picker → menu browser)
//   Step 3 — Add message + pay (textarea + price + send CTA)
//
// On success: confetti burst + "Gift sent!" toast + onSent(giftId) + onClose.
// Errors: toast + stay on the current step.
//
// Governance (Task 6D):
//   - DOES NOT touch any API route — uses GET /api/social/search|connections,
//     GET /api/restaurants, GET /api/restaurants/[id]/menu, and POST /api/gifts
//     (the latter via gift-store.createGift).
//   - DOES NOT touch gift-store.ts (Task 1C owns it) — CALLs createGift only.
//   - DOES NOT touch types.ts (Task 1B owns it) — uses local additive casts for
//     the gift response (orderId/redeemedOrderId are server-returned fields not
//     yet in the Wave-1B Gift interface; we read them via runtime cast).
//
// Preselected values:
//   - preselectedFriendId       → skip step 1
//   - preselectedRestaurantId   → start step 2 with the restaurant pinned
//   - preselectedMenuItemId      → skip step 2 (requires restaurant too)
//
// All preselects reset when the sheet closes (onClose).

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  Gift,
  Search,
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  Utensils,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { inr } from '@/lib/snack'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { useGifts } from '@/lib/gift-store'
import type { MenuItem, Restaurant, SocialConnection } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SendGiftFlowProps {
  open: boolean
  onClose: () => void
  /** Friend to preselect (skips step 1). */
  preselectedFriendId?: string
  /** Menu item to preselect (skips step 2 — requires preselectedRestaurantId). */
  preselectedMenuItemId?: string
  /** Restaurant to preselect in step 2. */
  preselectedRestaurantId?: string
  /** Called with the new gift ID on successful send. */
  onSent?: (giftId: string) => void
}

type Step = 1 | 2 | 3

// Local additive shape for the server's gift response — Task 6C's POST /api/gifts
// returns `{ gift, orderId? }`. We cast through this to read orderId at runtime
// without modifying the Wave-1B Gift interface.
type GiftResponse = { gift: { id: string }; orderId?: string }

// Additive fields the social search endpoint may return — Task 6B's contract.
interface SocialSearchResult {
  id: string
  name: string
  avatarUrl?: string
  campusName?: string
}

// Additive shape — Task 2C may return `image` as an empty string for items
// without an image; we fall back to a gradient placeholder.

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_MESSAGE_LEN = 200
const STEP_LABELS = ['Friend', 'Item', 'Message'] as const

// ─────────────────────────────────────────────────────────────────────────────
// Motion variants
// ─────────────────────────────────────────────────────────────────────────────

const STEP_VARIANTS: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 60 : -60,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({
    x: dir > 0 ? -60 : 60,
    opacity: 0,
  }),
}

const CONFETTI_COLORS = ['#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f59e0b', '#10b981']

// ─────────────────────────────────────────────────────────────────────────────
// SendGiftFlow — main export
// ─────────────────────────────────────────────────────────────────────────────

export function SendGiftFlow({
  open,
  onClose,
  preselectedFriendId,
  preselectedMenuItemId,
  preselectedRestaurantId,
  onSent,
}: SendGiftFlowProps) {
  const prefersReduced = useReducedMotion()
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const createGift = useGifts((s) => s.createGift)

  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = React.useState<Step>(1)
  const [direction, setDirection] = React.useState<1 | -1>(1)

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedFriend, setSelectedFriend] = React.useState<SocialSearchResult | null>(null)
  const [selectedRestaurant, setSelectedRestaurant] = React.useState<Restaurant | null>(null)
  const [selectedMenuItem, setSelectedMenuItem] = React.useState<MenuItem | null>(null)
  const [message, setMessage] = React.useState('')

  // ── Sending + success state ─────────────────────────────────────────────────
  const [sending, setSending] = React.useState(false)
  const [celebrate, setCelebrate] = React.useState(false)

  // ── Reset state when the sheet closes ───────────────────────────────────────
  // When `open` transitions from true → false, reset everything to step 1 with
  // no preselects. The next open() call will re-apply preselects via the effect
  // below.
  React.useEffect(() => {
    if (!open) {
      // Slight delay so the closing animation doesn't show the reset content.
      const t = setTimeout(() => {
        setStep(1)
        setDirection(1)
        setSelectedFriend(null)
        setSelectedRestaurant(null)
        setSelectedMenuItem(null)
        setMessage('')
        setSending(false)
        setCelebrate(false)
      }, 250)
      return () => clearTimeout(t)
    }
  }, [open])

  // ── Apply preselects on open ─────────────────────────────────────────────────
  // We fetch the preselected friend/restaurant/menu-item async, then jump to
  // the appropriate step.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false

    async function applyPreselects() {
      // Local accumulators — we read these AFTER all fetches complete so we
      // can decide the landing step based on what actually loaded (rather than
      // reading stale state from refs).
      let loadedFriend: SocialSearchResult | null = null
      let loadedRestaurant: Restaurant | null = null
      let loadedMenuItem: MenuItem | null = null

      // Friend preselect → fetch + skip step 1.
      if (preselectedFriendId) {
        // Try fetching the friend's profile via the social search endpoint.
        // Falls back to reading from the connections list.
        try {
          const [searchRes, connRes] = await Promise.all([
            fetch(`/api/social/search?q=${encodeURIComponent(preselectedFriendId)}`, {
              headers: { 'Content-Type': 'application/json' },
            }).catch(() => null),
            fetch('/api/social/connections', {
              headers: { 'Content-Type': 'application/json' },
            }).catch(() => null),
          ])

          // Search results first (server-validated search).
          if (searchRes?.ok) {
            const data = (await searchRes.json().catch(() => ({}))) as {
              results?: SocialSearchResult[]
              users?: SocialSearchResult[]
            }
            const results = data.results ?? data.users ?? []
            loadedFriend = results.find((u) => u.id === preselectedFriendId) ?? null
          }

          // Fallback: look up in connections.
          if (!loadedFriend && connRes?.ok) {
            const data = (await connRes.json().catch(() => ({}))) as {
              connections?: SocialConnection[]
            }
            const conn = (data.connections ?? []).find(
              (c) => c.userId === preselectedFriendId && c.status === 'ACCEPTED',
            )
            if (conn) {
              loadedFriend = {
                id: conn.userId,
                name: conn.name,
                avatarUrl: undefined,
                campusName: undefined,
              }
            }
          }
        } catch {
          // best-effort — the user can still pick a friend manually.
        }
      }

      // Restaurant + menu item preselects → skip step 2.
      if (preselectedRestaurantId) {
        try {
          const rRes = await fetch(`/api/restaurants/${preselectedRestaurantId}`, {
            cache: 'no-store',
          })
          if (rRes.ok) {
            const rData = (await rRes.json().catch(() => ({}))) as {
              restaurant?: Restaurant
            }
            if (rData.restaurant) {
              loadedRestaurant = rData.restaurant
            }
          }
        } catch {
          /* best-effort */
        }

        if (preselectedMenuItemId) {
          try {
            const mRes = await fetch(
              `/api/restaurants/${preselectedRestaurantId}/menu`,
              { cache: 'no-store' },
            )
            if (mRes.ok) {
              const mData = (await mRes.json().catch(() => ({}))) as {
                items?: MenuItem[]
              }
              const item = (mData.items ?? []).find((m) => m.id === preselectedMenuItemId)
              if (item) {
                loadedMenuItem = item
              }
            }
          } catch {
            /* best-effort */
          }
        }
      }

      if (cancelled) return

      // Commit the loaded preselects to React state.
      if (loadedFriend) setSelectedFriend(loadedFriend)
      if (loadedRestaurant) setSelectedRestaurant(loadedRestaurant)
      if (loadedMenuItem) setSelectedMenuItem(loadedMenuItem)

      // Decide which step to land on — based on what actually loaded.
      // - menu item + restaurant loaded → step 3 (message + pay)
      // - friend OR restaurant loaded (no item) → step 2 (pick item)
      // - nothing loaded → step 1 (pick friend)
      if (loadedMenuItem && loadedRestaurant) {
        setStep(3)
        setDirection(1)
      } else if (loadedFriend || loadedRestaurant) {
        setStep(2)
        setDirection(1)
      } else {
        setStep(1)
        setDirection(1)
      }
    }

    void applyPreselects()

    return () => {
      cancelled = true
    }
  }, [open, preselectedFriendId, preselectedMenuItemId, preselectedRestaurantId])

  // ── Step navigation ────────────────────────────────────────────────────────
  function goNext() {
    setDirection(1)
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s))
  }
  function goBack() {
    setDirection(-1)
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s))
  }

  // ── Send (Step 3 CTA) ─────────────────────────────────────────────────────────
  async function handleSend() {
    if (!selectedFriend || !selectedMenuItem) return
    setSending(true)
    try {
      const gift = await createGift({
        recipientId: selectedFriend.id,
        menuItemId: selectedMenuItem.id,
        message: message.trim() || undefined,
      })
      // Trigger the confetti burst.
      setCelebrate(true)
      toast({
        title: 'Gift sent! 🎁',
        description: `${selectedFriend.name} will be notified.`,
      })
      // Fire the onSent callback with the new gift id.
      onSent?.(gift.id)
      // Auto-close after the celebration animation (1.2s).
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send gift'
      toast({
        title: 'Could not send gift',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const canProceedStep1 = !!selectedFriend
  const canProceedStep2 = !!selectedMenuItem
  const canSend = !!selectedFriend && !!selectedMenuItem && !sending

  const ctaPriceLabel = selectedMenuItem ? inr(selectedMenuItem.price) : ''

  // ── Common content (used by both Sheet + Dialog) ─────────────────────────────
  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Step indicator */}
      <StepIndicator currentStep={step} />

      {/* Step body — slides horizontally */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            variants={STEP_VARIANTS}
            initial={prefersReduced ? false : 'enter'}
            animate="center"
            exit={prefersReduced ? undefined : 'exit'}
            transition={{
              x: { type: 'spring', stiffness: 320, damping: 32, mass: 0.8 },
              opacity: { duration: 0.2 },
            }}
          >
            {step === 1 && (
              <FriendPickerStep
                selected={selectedFriend}
                onSelect={(f) => setSelectedFriend(f)}
              />
            )}
            {step === 2 && (
              <MenuItemPickerStep
                restaurant={selectedRestaurant}
                onRestaurantChange={(r) => {
                  setSelectedRestaurant(r)
                  // Always clear the selected menu item when the restaurant
                  // changes — the item belongs to the previous restaurant's
                  // menu and isn't valid in the new one.
                  setSelectedMenuItem(null)
                }}
                selected={selectedMenuItem}
                onSelect={(m) => setSelectedMenuItem(m)}
              />
            )}
            {step === 3 && (
              <MessagePayStep
                friend={selectedFriend}
                restaurant={selectedRestaurant}
                menuItem={selectedMenuItem}
                message={message}
                onMessageChange={setMessage}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer — back + next/send */}
      <div className="flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={sending}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        )}
        <div className="flex-1" />
        {step < 3 ? (
          <Button
            type="button"
            onClick={goNext}
            disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
            className="snak-gradient-social gap-1 text-social-foreground hover:opacity-90"
          >
            Next
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="snak-gradient-social gap-2 text-social-foreground hover:opacity-90"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : (
              <>
                <Gift className="h-4 w-4" aria-hidden="true" />
                Send Gift{ctaPriceLabel ? ` · ${ctaPriceLabel}` : ''}
              </>
            )}
          </Button>
        )}
      </div>

      {/* Confetti overlay — fires on successful send */}
      <AnimatePresence>
        {celebrate && <ConfettiBurst key="confetti" />}
      </AnimatePresence>
    </div>
  )

  const header = (
    <SheetHeader className="px-4 pb-2 pt-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-white">
          <Gift className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base">Send a gift</SheetTitle>
          <SheetDescription className="text-xs">
            Surprise a friend with their favourite snack.
          </SheetDescription>
        </div>
      </div>
    </SheetHeader>
  )

  // ── Mobile: bottom Sheet ─────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          className="flex h-[88vh] max-h-[88vh] flex-col gap-0 p-0"
          aria-describedby={undefined}
        >
          {header}
          {body}
        </SheetContent>
      </Sheet>
    )
  }

  // ── Desktop: centered Dialog ─────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-4 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-white">
              <Gift className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Send a gift</DialogTitle>
              <DialogDescription className="text-xs">
                Surprise a friend with their favourite snack.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// StepIndicator — 1 → 2 → 3 with checkmarks for completed steps
// ═══════════════════════════════════════════════════════════════════════════

function StepIndicator({ currentStep }: { currentStep: Step }) {
  return (
    <ol
      className="flex items-center justify-center gap-2 border-b bg-muted/30 px-4 py-2.5"
      aria-label="Gift flow progress"
    >
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step
        const isCurrent = n === currentStep
        const isComplete = n < currentStep
        return (
          <li key={label} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                isComplete && 'bg-violet-500 text-white',
                isCurrent && 'bg-violet-600 text-white ring-2 ring-violet-200 dark:ring-violet-900',
                !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isComplete ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                n
              )}
            </div>
            <span
              className={cn(
                'text-[11px] font-medium',
                isCurrent ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <ChevronRight
                className="h-3 w-3 text-muted-foreground/60"
                aria-hidden="true"
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — Friend picker (search + connections list)
// ═══════════════════════════════════════════════════════════════════════════

interface FriendPickerStepProps {
  selected: SocialSearchResult | null
  onSelect: (friend: SocialSearchResult) => void
}

function FriendPickerStep({ selected, onSelect }: FriendPickerStepProps) {
  const [query, setQuery] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState<SocialSearchResult[]>([])
  const [connections, setConnections] = React.useState<SocialConnection[]>([])
  const [loadingConns, setLoadingConns] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Load the user's accepted-friends connections on mount.
  React.useEffect(() => {
    let cancelled = false
    setLoadingConns(true)
    fetch('/api/social/connections', {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((r) => r.json())
      .then((data: { connections?: SocialConnection[] }) => {
        if (cancelled) return
        const accepted = (data.connections ?? []).filter((c) => c.status === 'ACCEPTED')
        setConnections(accepted)
        setLoadingConns(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not load your friends list.')
        setLoadingConns(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced search — only fires when query is non-empty.
  React.useEffect(() => {
    const q = query.trim()
    if (!q) {
      setSearchResults([])
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    setError(null)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/social/search?q=${encodeURIComponent(q)}`, {
          headers: { 'Content-Type': 'application/json' },
        })
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`)
        }
        const data = (await res.json().catch(() => ({}))) as {
          results?: SocialSearchResult[]
          users?: SocialSearchResult[]
        }
        setSearchResults(data.results ?? data.users ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const showSearchResults = query.trim().length > 0
  const list = showSearchResults ? searchResults : connections.map((c) => ({
    id: c.userId,
    name: c.name,
    avatarUrl: undefined,
    campusName: undefined,
  }))

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
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone…"
          aria-label="Search for a friend"
          className="h-10 rounded-xl border-border/80 pl-9 pr-4 text-sm"
        />
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {showSearchResults ? 'Search results' : 'Your friends'}
        </h3>
        {showSearchResults && searching && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-md bg-danger-50 p-2 text-xs text-danger-700 dark:bg-danger-950/40 dark:text-danger-300">
          {error}
        </p>
      )}

      {/* List */}
      <div
        className="snak-scroll max-h-[42vh] space-y-1 overflow-y-auto pr-1"
        role="listbox"
        aria-label="Friends list"
      >
        {loadingConns && !showSearchResults ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {showSearchResults
                ? 'No users found — try a different search.'
                : 'You haven’t added any friends yet. Try searching for them by name.'}
            </p>
          </div>
        ) : (
          list.map((friend) => {
            const isSelected = selected?.id === friend.id
            return (
              <button
                key={friend.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(friend)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 p-2 text-left transition-colors',
                  isSelected
                    ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40'
                    : 'border-transparent hover:bg-muted/60',
                )}
              >
                <Avatar className="h-10 w-10 ring-2 ring-violet-200 dark:ring-violet-900">
                  {friend.avatarUrl && <AvatarImage src={friend.avatarUrl} alt="" />}
                  <AvatarFallback className="bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                    {initials(friend.name) || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{friend.name}</p>
                  {friend.campusName && (
                    <p className="truncate text-xs text-muted-foreground">{friend.campusName}</p>
                  )}
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — Menu item picker (restaurant selector → menu browser)
// ═══════════════════════════════════════════════════════════════════════════

interface MenuItemPickerStepProps {
  restaurant: Restaurant | null
  onRestaurantChange: (r: Restaurant | null) => void
  selected: MenuItem | null
  onSelect: (m: MenuItem) => void
}

function MenuItemPickerStep({
  restaurant,
  onRestaurantChange,
  selected,
  onSelect,
}: MenuItemPickerStepProps) {
  const [restaurants, setRestaurants] = React.useState<Restaurant[]>([])
  const [restaurantsLoading, setRestaurantsLoading] = React.useState(false)
  const [menuItems, setMenuItems] = React.useState<MenuItem[]>([])
  const [menuLoading, setMenuLoading] = React.useState(false)
  const [menuError, setMenuError] = React.useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = React.useState<string>('All')

  // Load restaurant list on mount (only if no preselected restaurant).
  React.useEffect(() => {
    if (restaurant) return // already have one
    let cancelled = false
    setRestaurantsLoading(true)
    fetch('/api/restaurants', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { restaurants?: Restaurant[] }) => {
        if (cancelled) return
        setRestaurants(data.restaurants ?? [])
        setRestaurantsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setRestaurantsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [restaurant])

  // Load menu when restaurant changes.
  React.useEffect(() => {
    if (!restaurant) {
      setMenuItems([])
      return
    }
    let cancelled = false
    setMenuLoading(true)
    setMenuError(null)
    fetch(`/api/restaurants/${restaurant.id}/menu`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Menu load failed (${r.status})`)
        return r.json()
      })
      .then((data: { items?: MenuItem[] }) => {
        if (cancelled) return
        setMenuItems(data.items ?? [])
        setMenuLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setMenuError(e instanceof Error ? e.message : 'Could not load the menu.')
        setMenuLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [restaurant])

  const categories = React.useMemo(() => {
    const set = new Set<string>()
    for (const m of menuItems) if (m.category) set.add(m.category)
    return ['All', ...Array.from(set).sort()]
  }, [menuItems])

  const filteredItems = React.useMemo(() => {
    if (categoryFilter === 'All') return menuItems
    return menuItems.filter((m) => m.category === categoryFilter)
  }, [menuItems, categoryFilter])

  // ── Restaurant picker (only if no restaurant selected yet) ─────────────────
  if (!restaurant) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pick a restaurant
        </h3>
        {restaurantsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : restaurants.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No restaurants available right now.
          </p>
        ) : (
          <div className="snak-scroll max-h-[44vh] space-y-1 overflow-y-auto pr-1">
            {restaurants.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onRestaurantChange(r)}
                className="flex w-full items-center gap-3 rounded-xl border-2 border-transparent p-2 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {r.image ? (
                    <img
                      src={r.image}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Utensils className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.cuisine}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Menu browser ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Restaurant header + change CTA */}
      <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{restaurant.name}</p>
          <p className="truncate text-xs text-muted-foreground">{restaurant.cuisine}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => {
            onRestaurantChange(null)
          }}
        >
          Change
        </Button>
      </div>

      {/* Category filter */}
      {categories.length > 2 && (
        <div className="snak-scroll flex gap-1.5 overflow-x-auto pb-1" role="tablist">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={cat === categoryFilter}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                cat === categoryFilter
                  ? 'bg-violet-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Items */}
      {menuLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg p-2">
              <Skeleton className="h-14 w-14 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 w-48" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : menuError ? (
        <p className="rounded-md bg-danger-50 p-3 text-xs text-danger-700 dark:bg-danger-950/40 dark:text-danger-300">
          {menuError}
        </p>
      ) : filteredItems.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No items available.
        </p>
      ) : (
        <div className="snak-scroll max-h-[44vh] space-y-1.5 overflow-y-auto pr-1">
          {filteredItems.map((item) => {
            const isSelected = selected?.id === item.id
            const soldOut = !item.isAvailable
            return (
              <button
                key={item.id}
                type="button"
                disabled={soldOut}
                onClick={() => onSelect(item)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  isSelected
                    ? 'border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40'
                    : 'border-transparent hover:bg-muted/60',
                )}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className={cn('h-full w-full object-cover', soldOut && 'grayscale')}
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-400 to-fuchsia-600 text-xl">
                      🍽
                    </div>
                  )}
                  {soldOut && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                        Sold out
                      </span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-sm font-medium text-foreground',
                      soldOut && 'text-muted-foreground line-through',
                    )}
                  >
                    {item.name}
                  </p>
                  {item.description && (
                    <p className="line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
                  )}
                  <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">
                    {inr(item.price)}
                  </p>
                </div>
                {isSelected && (
                  <Check className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — Message + Pay (textarea + item preview + send CTA)
// ═══════════════════════════════════════════════════════════════════════════

interface MessagePayStepProps {
  friend: SocialSearchResult | null
  restaurant: Restaurant | null
  menuItem: MenuItem | null
  message: string
  onMessageChange: (s: string) => void
}

function MessagePayStep({
  friend,
  restaurant,
  menuItem,
  message,
  onMessageChange,
}: MessagePayStepProps) {
  if (!friend || !menuItem) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Pick a friend and an item first.
      </div>
    )
  }

  const remaining = MAX_MESSAGE_LEN - message.length

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
    <div className="space-y-4">
      {/* Recipient + item preview card */}
      <div className="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-3 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-fuchsia-950/20">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-violet-500 ring-offset-2 ring-offset-background">
            {friend.avatarUrl && <AvatarImage src={friend.avatarUrl} alt="" />}
            <AvatarFallback className="bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              {initials(friend.name) || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Sending to</p>
            <p className="truncate text-sm font-semibold text-foreground">{friend.name}</p>
          </div>
          <Gift className="h-5 w-5 text-violet-500" aria-hidden="true" />
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-xl bg-background/70 p-2">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
            {menuItem.image ? (
              <img
                src={menuItem.image}
                alt={menuItem.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-400 to-fuchsia-600 text-lg">
                🍽
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{menuItem.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {restaurant?.name ?? 'Restaurant'}
            </p>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
            {inr(menuItem.price)}
          </span>
        </div>
      </div>

      {/* Message textarea */}
      <div>
        <label htmlFor="gift-message" className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add a note (optional)
          </span>
          <span
            className={cn(
              'text-[11px] tabular-nums',
              remaining < 20 ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {remaining}
          </span>
        </label>
        <Textarea
          id="gift-message"
          value={message}
          onChange={(e) => onMessageChange(e.target.value.slice(0, MAX_MESSAGE_LEN))}
          placeholder="Happy birthday! Enjoy 🎂"
          maxLength={MAX_MESSAGE_LEN}
          rows={3}
          className="resize-none rounded-xl text-sm"
        />
      </div>

      {/* Payment summary */}
      <div className="rounded-xl border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">You pay</span>
          <span className="font-mono font-semibold text-foreground">{inr(menuItem.price)}</span>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Charged to your default payment method. Recipient picks up at the restaurant.
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ConfettiBurst — sparkle particles on successful send
// ═══════════════════════════════════════════════════════════════════════════

function ConfettiBurst() {
  const prefersReduced = useReducedMotion()
  // Pre-generated particle specs — keep stable across re-renders.
  const particles = React.useMemo(
    () =>
      Array.from({ length: 24 }).map((_, i) => ({
        id: i,
        angle: (i / 24) * Math.PI * 2 + Math.random() * 0.4,
        distance: 80 + Math.random() * 100,
        size: 6 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.05,
      })),
    [],
  )

  if (prefersReduced) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden="true"
      >
        <Sparkles className="h-12 w-12 text-violet-500" />
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center overflow-hidden"
      aria-hidden="true"
    >
      {/* Backdrop dim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.2 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-violet-900"
      />
      {/* Gift icon center */}
      <motion.div
        initial={{ scale: 0, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        exit={{ scale: 0.6, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 18, mass: 0.8 }}
        className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-violet-500 text-white shadow-lg"
      >
        <Gift className="h-10 w-10" aria-hidden="true" />
      </motion.div>
      {/* Particle burst */}
      {particles.map((p) => {
        const dx = Math.cos(p.angle) * p.distance
        const dy = Math.sin(p.angle) * p.distance
        return (
          <motion.div
            key={p.id}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: dx,
              y: dy,
              opacity: 0,
              scale: 0.4,
              rotate: Math.random() * 360,
            }}
            transition={{
              duration: 0.9 + Math.random() * 0.3,
              delay: p.delay,
              ease: [0.2, 0.6, 0.3, 1],
            }}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: '2px',
            }}
          />
        )
      })}
    </motion.div>
  )
}

export default SendGiftFlow
