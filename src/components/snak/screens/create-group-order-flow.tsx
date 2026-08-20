'use client'

// src/components/snak/screens/create-group-order-flow.tsx
//
// Create-group-order multi-step flow (blueprint §20 GROUP ORDERING +
// DESIGN_SYSTEM.md §5.2.6 Group order bubble + §5.8.7 Group rose CTA).
// Bottom sheet on mobile, centered modal on desktop.
//
// Flow:
//   Step 1 — Select restaurant     (searchable list from GET /api/restaurants)
//   Step 2 — Optional name          (text input "Group order name")
//   Step 3 — Success                (share code + copy link + open group order)
//
// On success:
//   - Calls POST /api/group-orders { restaurantId, name? }
//   - Response shape: { groupOrder: { id, shareCode, ... } }
//   - Shows success screen with the shareCode + a "Copy link" button that
//     copies `${origin}/group/${shareCode}` to the clipboard.
//   - "Open Group Order" button → onCreated(groupOrderId, shareCode) + onClose.
//
// Preselected values:
//   - preselectedRestaurantId  → skip step 1 (jumps straight to step 2)
//
// Governance (Task 7B):
//   - DOES NOT touch any API route — uses GET /api/restaurants (Task 2C owns)
//     and POST /api/group-orders (Task 7A owns — implements the new contract).
//   - DOES NOT touch group-order-store.ts (Task 1C owns) — calls the API
//     directly via csrfFetch. The store uses an older contract shape; the
//     new contract returns `{ groupOrder: { id, shareCode, ... } }` from POST.
//   - DOES NOT touch types.ts (Task 1B owns) — uses a local additive cast
//     `GroupOrderWithShareCode` for the `shareCode` field (server-returned,
//     not yet in the Wave-1B GroupOrder interface).
//   - DOES NOT touch consumer-view.tsx (Task 3A owns) — communicates via the
//     onCreated prop the parent passes in. The parent (HomeScreen /
//     RestaurantDetailScreen) decides what to do with the new groupOrderId +
//     shareCode (typically: close the modal + toast the user).
//
// All preselects reset when the sheet closes (onClose).

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  Users,
  Search,
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  Loader2,
  ChevronRight,
  Copy,
  Link2,
  Store,
  PartyPopper,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { inr } from '@/lib/snack'
import { useToast } from '@/hooks/use-toast'
import { useIsMobile } from '@/hooks/use-mobile'
import { csrfFetch } from '@/lib/csrf-client'
import type { Restaurant } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateGroupOrderFlowProps {
  open: boolean
  onClose: () => void
  /** Restaurant to preselect (skips step 1). */
  preselectedRestaurantId?: string
  /**
   * Called after the user taps "Open Group Order" on the success screen.
   * The parent decides what to do (typically: navigate to the group order
   * screen + close this modal).
   */
  onCreated?: (groupOrderId: string, shareCode: string) => void
}

type Step = 1 | 2 | 3

// Local additive shape — Task 7A's POST /api/group-orders returns a GroupOrder
// object that includes the `shareCode` field (server-side generated). The
// Wave-1B GroupOrder interface doesn't include it yet; we cast to read it.
type GroupOrderWithShareCode = {
  id: string
  shareCode: string
  restaurantId?: string
  restaurantName?: string
  status?: string
}

interface CreateResponse {
  groupOrder: GroupOrderWithShareCode
}

// Restaurants list endpoint returns { restaurants: Restaurant[] }.
interface RestaurantsResponse {
  restaurants?: Restaurant[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME_LEN = 80
const STEP_LABELS = ['Restaurant', 'Name', 'Done'] as const

// ─────────────────────────────────────────────────────────────────────────────
// Motion variants — horizontal slide between steps (matches SendGiftFlow)
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

// ═══════════════════════════════════════════════════════════════════════════
// CreateGroupOrderFlow — main export
// ═══════════════════════════════════════════════════════════════════════════

export function CreateGroupOrderFlow({
  open,
  onClose,
  preselectedRestaurantId,
  onCreated,
}: CreateGroupOrderFlowProps) {
  const prefersReduced = useReducedMotion()
  const isMobile = useIsMobile()
  const { toast } = useToast()

  // ── Step state ────────────────────────────────────────────────────────────
  const [step, setStep] = React.useState<Step>(1)
  const [direction, setDirection] = React.useState<1 | -1>(1)

  // ── Selection + form state ──────────────────────────────────────────────────
  const [selectedRestaurant, setSelectedRestaurant] = React.useState<Restaurant | null>(null)
  const [name, setName] = React.useState('')

  // ── Creating + success state ────────────────────────────────────────────────
  const [creating, setCreating] = React.useState(false)
  const [createdGroup, setCreatedGroup] = React.useState<GroupOrderWithShareCode | null>(null)
  const [copied, setCopied] = React.useState(false)

  // ── Reset state when the sheet closes ───────────────────────────────────────
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep(1)
        setDirection(1)
        setSelectedRestaurant(null)
        setName('')
        setCreating(false)
        setCreatedGroup(null)
        setCopied(false)
      }, 250)
      return () => clearTimeout(t)
    }
  }, [open])

  // ── Apply preselect on open ─────────────────────────────────────────────────
  // If a preselectedRestaurantId is provided, fetch the restaurant by id
  // and jump straight to step 2 (name).
  React.useEffect(() => {
    if (!open || !preselectedRestaurantId) return
    const restaurantId = preselectedRestaurantId
    let cancelled = false

    async function loadRestaurant() {
      try {
        const res = await fetch(
          `/api/restaurants/${encodeURIComponent(restaurantId)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = (await res.json().catch(() => ({}))) as { restaurant?: Restaurant }
        if (cancelled || !data.restaurant) return
        setSelectedRestaurant(data.restaurant)
        setStep(2)
        setDirection(1)
      } catch {
        // Soft-fail — user can still pick from the list manually.
      }
    }
    void loadRestaurant()
    return () => {
      cancelled = true
    }
  }, [open, preselectedRestaurantId])

  // ── Step navigation ─────────────────────────────────────────────────────────
  function goNext() {
    setDirection(1)
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s))
  }
  function goBack() {
    setDirection(-1)
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s))
  }

  // ── Create (Step 2 CTA) ───────────────────────────────────────────────────
  async function handleCreate() {
    if (!selectedRestaurant) return
    setCreating(true)
    try {
      const res = await csrfFetch('/api/group-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: selectedRestaurant.id,
          ...(name.trim() ? { name: name.trim().slice(0, MAX_NAME_LEN) } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body?.error || body?.message || `Failed (${res.status})`)
      }
      const data = (await res.json()) as CreateResponse
      if (!data.groupOrder?.shareCode) {
        throw new Error('Server response missing shareCode')
      }
      setCreatedGroup(data.groupOrder)
      setDirection(1)
      setStep(3)
      toast({
        title: 'Group order started! 🎉',
        description: 'Share the link with friends to invite them.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create group order'
      toast({
        title: 'Could not start group order',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  // ── Copy share link ──────────────────────────────────────────────────────────
  async function handleCopyLink() {
    if (!createdGroup) return
    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/group/${createdGroup.shareCode}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link)
      } else {
        // Legacy fallback for browsers without the async clipboard API.
        const ta = document.createElement('textarea')
        ta.value = link
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
        description: 'Copy this manually: ' + link,
        variant: 'destructive',
      })
    }
  }

  // ── Share via Web Share API (mobile) ──────────────────────────────────────
  async function handleShare() {
    if (!createdGroup) return
    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/group/${createdGroup.shareCode}`
    const shareData = {
      title: 'Join my group order on SnakZap',
      text: `Join my group order${selectedRestaurant ? ` at ${selectedRestaurant.name}` : ''}!`,
      url: link,
    }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
      } else {
        // Fallback to copy if Web Share API unavailable (desktop browsers).
        await handleCopyLink()
      }
    } catch {
      // User cancelled share — no toast, just silent.
    }
  }

  // ── Open group order (Step 3 CTA) ─────────────────────────────────────────
  function handleOpenGroupOrder() {
    if (!createdGroup) return
    onCreated?.(createdGroup.id, createdGroup.shareCode)
    onClose()
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const canProceedStep1 = !!selectedRestaurant
  const canCreate = !!selectedRestaurant && !creating
  const ctaDisabled = step === 1 ? !canProceedStep1 : step === 2 ? !canCreate : false

  // ── Common body (used by both Sheet + Dialog) ─────────────────────────────
  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Step indicator — hidden on the success step */}
      {step < 3 && <StepIndicator currentStep={step} />}

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
              <RestaurantPickerStep
                selected={selectedRestaurant}
                onSelect={(r) => {
                  setSelectedRestaurant(r)
                  // Auto-advance to step 2 once a restaurant is picked — feels snappy.
                  setDirection(1)
                  setStep(2)
                }}
              />
            )}
            {step === 2 && (
              <NameStep
                restaurant={selectedRestaurant}
                name={name}
                onNameChange={setName}
              />
            )}
            {step === 3 && createdGroup && (
              <SuccessStep
                groupOrder={createdGroup}
                restaurant={selectedRestaurant}
                copied={copied}
                onCopyLink={handleCopyLink}
                onShare={handleShare}
                onOpenGroupOrder={handleOpenGroupOrder}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer — back + next/create (hidden on success step) */}
      {step < 3 && (
        <div className="flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={creating}
              className="gap-1"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          {step === 1 ? (
            <Button
              type="button"
              onClick={goNext}
              disabled={!canProceedStep1}
              className="snak-gradient-group gap-1 text-group-foreground hover:opacity-90"
            >
              Next
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              className="snak-gradient-group gap-2 text-group-foreground hover:opacity-90"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Creating…
                </>
              ) : (
                <>
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Start group order
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Success-step footer — single primary CTA */}
      {step === 3 && createdGroup && (
        <div className="flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex-1" />
          <Button
            type="button"
            onClick={handleOpenGroupOrder}
            className="snak-gradient-group gap-2 text-group-foreground hover:opacity-90"
          >
            Open Group Order
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )

  const header = (
    <SheetHeader className="px-4 pb-2 pt-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white">
          <Users className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base">Start a group order</SheetTitle>
          <SheetDescription className="text-xs">
            Order together — one pickup, one payment.
          </SheetDescription>
        </div>
      </div>
    </SheetHeader>
  )

  const dialogHeader = (
    <DialogHeader className="px-4 pb-2 pt-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white">
          <Users className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Start a group order</DialogTitle>
          <DialogDescription className="text-xs">
            Order together — one pickup, one payment.
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )

  // ── Mobile: bottom Sheet ──────────────────────────────────────────────────
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

  // ── Desktop: centered Dialog ────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        {dialogHeader}
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
      aria-label="Create group order progress"
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
                isComplete && 'bg-rose-500 text-white',
                isCurrent && 'bg-rose-600 text-white ring-2 ring-rose-200 dark:ring-rose-900',
                !isComplete && !isCurrent && 'bg-muted text-muted-foreground',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isComplete ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
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
              <ChevronRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — Restaurant picker (searchable list)
// ═══════════════════════════════════════════════════════════════════════════

interface RestaurantPickerStepProps {
  selected: Restaurant | null
  onSelect: (r: Restaurant) => void
}

function RestaurantPickerStep({ selected, onSelect }: RestaurantPickerStepProps) {
  const [query, setQuery] = React.useState('')
  const [restaurants, setRestaurants] = React.useState<Restaurant[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/restaurants', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed (${r.status})`)
        return r.json()
      })
      .then((data: RestaurantsResponse) => {
        if (cancelled) return
        setRestaurants(data.restaurants ?? [])
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load restaurants')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return restaurants
    return restaurants.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    )
  }, [restaurants, query])

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Pick a restaurant</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Everyone in the group will order from here.
        </p>
      </div>

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
          placeholder="Search restaurants…"
          aria-label="Search restaurants"
          className="h-10 rounded-xl border-border/80 bg-card pl-10 pr-3 text-sm"
        />
      </div>

      {/* Restaurant list — max-height with custom scrollbar per project rules */}
      {loading ? (
        <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border p-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Store className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-foreground">No restaurants found</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {query ? `Try a different search.` : 'Check back later.'}
          </p>
        </div>
      ) : (
        <div
          className="snak-scroll max-h-[40vh] space-y-2 overflow-y-auto pr-1"
          role="listbox"
          aria-label="Restaurant options"
        >
          {filtered.map((r) => {
            const isSelected = selected?.id === r.id
            return (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelect(r)}
                className={cn(
                  'snak-focus-ring flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                  isSelected
                    ? 'border-rose-500 bg-rose-50 dark:border-rose-400 dark:bg-rose-950/40'
                    : 'border-border bg-card hover:border-rose-300 hover:bg-rose-50/50 dark:hover:border-rose-900 dark:hover:bg-rose-950/20',
                )}
              >
                <Avatar className="h-10 w-10 shrink-0 rounded-lg">
                  {r.image ? <AvatarImage src={r.image} alt="" /> : null}
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-rose-400 to-amber-500 text-xs font-bold text-white">
                    {r.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.cuisine} · {r.prepTimeMins} min
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-foreground">{inr(r.priceForTwo)}</p>
                  <p className="text-[10px] text-muted-foreground">for two</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — Optional name input
// ═══════════════════════════════════════════════════════════════════════════

interface NameStepProps {
  restaurant: Restaurant | null
  name: string
  onNameChange: (v: string) => void
}

function NameStep({ restaurant, name, onNameChange }: NameStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Name your group order</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Optional — friends will see this name.</p>
      </div>

      {/* Restaurant summary card */}
      {restaurant && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
          <Avatar className="h-10 w-10 shrink-0 rounded-lg">
            {restaurant.image ? <AvatarImage src={restaurant.image} alt="" /> : null}
            <AvatarFallback className="rounded-lg bg-gradient-to-br from-rose-400 to-amber-500 text-xs font-bold text-white">
              {restaurant.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{restaurant.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {restaurant.cuisine} · {restaurant.prepTimeMins} min
            </p>
          </div>
        </div>
      )}

      {/* Name input */}
      <div className="space-y-1.5">
        <label htmlFor="group-name" className="text-xs font-medium text-foreground">
          Group order name
        </label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value.slice(0, MAX_NAME_LEN))}
          placeholder="e.g., Lunch with friends"
          maxLength={MAX_NAME_LEN}
          aria-describedby="group-name-help"
          className="h-11 rounded-xl"
        />
        <p id="group-name-help" className="text-[11px] text-muted-foreground">
          {name.length}/{MAX_NAME_LEN} characters · leave blank for no name
        </p>
      </div>

      {/* Info card */}
      <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          After you start, you'll get a share link. Friends can join and add their own
          items — you confirm + pay when everyone's ready.
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — Success screen (share code + copy link + open group order)
// ═══════════════════════════════════════════════════════════════════════════

interface SuccessStepProps {
  groupOrder: GroupOrderWithShareCode
  restaurant: Restaurant | null
  copied: boolean
  onCopyLink: () => void
  onShare: () => void
  onOpenGroupOrder: () => void
}

function SuccessStep({
  groupOrder,
  restaurant,
  copied,
  onCopyLink,
  onShare,
}: SuccessStepProps) {
  const link =
    `${typeof window !== 'undefined' ? window.location.origin : ''}/group/${groupOrder.shareCode}`

  return (
    <div className="space-y-5">
      {/* Celebration header */}
      <div className="flex flex-col items-center text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 18, mass: 0.8 }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-lg"
        >
          <PartyPopper className="h-7 w-7" aria-hidden="true" />
        </motion.div>
        <h3 className="mt-3 text-base font-bold text-foreground">Group order started!</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {restaurant ? `Ordering from ${restaurant.name}` : 'Share the link to invite friends.'}
        </p>
      </div>

      {/* Share code */}
      <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Share code
        </p>
        <p className="mt-1 font-mono text-lg font-bold tracking-wider text-foreground">
          {groupOrder.shareCode}
        </p>
      </div>

      {/* Link preview */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">Share link</p>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{link}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={onShare}
          className="snak-gradient-group gap-2 text-group-foreground hover:opacity-90"
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          Share with friends
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCopyLink}
          className="gap-2"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy link
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

export default CreateGroupOrderFlow
