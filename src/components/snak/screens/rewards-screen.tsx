'use client'

// =============================================================================
//  SnakZap — Rewards screen (full implementation — Wave 5 Task 5B)
// -----------------------------------------------------------------------------
//  Reference: blueprint §17 REWARDS ENGINE, DESIGN_SYSTEM.md §5.2.4 Rewards +
//  §5.6.2 Reward progress ring, PRODUCT_IMPLEMENTATION_PLAN.md Task 5B scope
//  (lines 1663-1685).
//
//  Sections (mobile-first, gold accent for rewards per DESIGN_SYSTEM.md §5.2.4):
//    1. Header (title + subtitle)
//    2. Hero card — RewardProgressRing (size=140) + tier label + "X pts to next"
//    3. Stats row — 3 mini-cards: Lifetime Earned / Lifetime Redeemed / This Month
//    4. "How to earn" — Collapsible card listing all active RewardRules
//    5. "Recent activity" — Paginated ledger list with "Load more" button
//    6. Redeem CTA — Prominent gold button → opens Sheet with redemption options
//       (PERCENT_DISCOUNT / FIXED_DISCOUNT / FREE_ITEM) → on success: code + copy
//    7. Empty state — "No rewards yet — place your first order to start earning!"
//
//  Governance (Task 5B):
//    - Uses Task 1B components: RewardProgressRing, EmptyState, RewardRingSkeleton.
//    - Uses Task 1C store: useRewards (read-only for refresh + redeem action).
//    - Uses Task 1C reward-rules.ts (READ-ONLY import — does not modify it).
//    - Does NOT touch rewards API routes (Task 5A owns them).
//    - Does NOT touch rewards-engine.ts (Task 5A owns it).
//    - framer-motion ring animation + list stagger per DESIGN_SYSTEM.md §6.4.
//    - Pull-to-refresh (rubber-band + 70px threshold) — same pattern as Home.
// =============================================================================

import * as React from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  Sparkles,
  Gift,
  Users,
  Star,
  Clock,
  TrendingUp,
  UserPlus,
  Coins,
  PartyPopper,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Minus,
  Percent,
  IndianRupee,
  Coffee,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { useRewards, type RewardRedemption } from '@/lib/rewards-store'
import { useUI } from '@/lib/ui-store'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { inr, timeAgo, pointsToDiscountRupees } from '@/lib/snack'
import { REWARD_RULES, type RewardRuleKey } from '@/lib/reward-rules'
import type { RewardLedgerEntry } from '@/lib/types'

import { RewardProgressRing } from '@/components/snak/reward-progress-ring'
import { EmptyState } from '@/components/snak/empty-state'
import { RewardRingSkeleton, SkeletonLine } from '@/components/snak/skeleton-loader'

// -----------------------------------------------------------------------------
//  Reward rule iconography — maps each rule key to a Lucide icon for the
//  "How to earn" section. Falls back to Sparkles when unmapped.
// -----------------------------------------------------------------------------

const RULE_ICONS: Partial<Record<RewardRuleKey, LucideIcon>> = {
  EARN_BASE: Coins,
  FIRST_ORDER: Sparkles,
  SECOND_ORDER: Star,
  STREAK_3: TrendingUp,
  STREAK_7: TrendingUp,
  REFERRAL: UserPlus,
  OFF_PEAK: Clock,
  GROUP_ORDER: Users,
  GIFT_SENT: Gift,
  GIFT_RECEIVED: Gift,
  CAMPUS_EVENT: PartyPopper,
}

function ruleIcon(key: RewardRuleKey): LucideIcon {
  return RULE_ICONS[key] ?? Sparkles
}

/**
 * Render the points value for a rule based on its formula type:
 *   - perRupee → "1 pt per ₹10 spent" (uses the rate to derive the rupee-per-point)
 *   - fixed    → "+N pts"
 *   - multiplier → "N× pts" (rare for end-users — surfaced as "×N multiplier")
 */
function rulePointsLabel(ruleKey: RewardRuleKey): string {
  const rule = REWARD_RULES[ruleKey]
  if (!rule) return ''
  const f = rule.pointsFormula
  if (f.type === 'perRupee') {
    const rate = f.rate ?? 0.1
    // rate = pts per rupee → rupees per pt = 1 / rate
    const rupeesPerPt = Math.round(1 / rate)
    return `1 pt per ₹${rupeesPerPt} spent`
  }
  if (f.type === 'fixed') {
    return `+${f.points ?? 0} pts`
  }
  if (f.type === 'multiplier') {
    return `×${f.multiplier ?? 1} pts`
  }
  return ''
}

// -----------------------------------------------------------------------------
//  Redemption options — UI catalog of available rewards the user can redeem.
//
//  The store's redeem API is `redeem(points, orderId?)` — we pass the option's
//  `pointsCost` and the server (Task 5A's /api/rewards/redeem) creates the
//  RewardRedemption row with the appropriate rewardType (PERCENT_DISCOUNT /
//  FIXED_DISCOUNT / FREE_ITEM) encoded by the points amount for MVP. The
//  rewardType shown here is a UI label only.
// -----------------------------------------------------------------------------

interface RedemptionOption {
  key: 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT' | 'FREE_ITEM'
  name: string
  description: string
  pointsCost: number
  /** Human-readable value (e.g., "₹50 off", "10% off", "Free coffee"). */
  valueLabel: string
  Icon: LucideIcon
}

const REDEMPTION_OPTIONS: RedemptionOption[] = [
  {
    key: 'PERCENT_DISCOUNT',
    name: '10% off next order',
    description: 'A 10% discount on your next order — applies at checkout.',
    pointsCost: 100,
    valueLabel: '10% off',
    Icon: Percent,
  },
  {
    key: 'FIXED_DISCOUNT',
    name: '₹50 off',
    description: 'Flat ₹50 off your next order.',
    pointsCost: 500,
    valueLabel: '₹50 off',
    Icon: IndianRupee,
  },
  {
    key: 'FREE_ITEM',
    name: 'Free coffee',
    description: 'A free coffee at participating campus cafes.',
    pointsCost: 300,
    valueLabel: 'Free coffee',
    Icon: Coffee,
  },
]

// =============================================================================
//  Motion presets — section entrance stagger per DESIGN_SYSTEM.md §6.4
// =============================================================================

const SECTION_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } },
}
const SECTION_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.3, 0, 0, 1] },
  },
}

// Ledger list stagger (slightly faster — entries are short rows)
const LEDGER_LIST: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
}
const LEDGER_ITEM: Variants = {
  hidden: { opacity: 0, x: -6 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease: [0.3, 0, 0, 1] },
  },
}

// =============================================================================
//  PullToRefresh — minimal touch-based pull-to-refresh (same pattern as Home).
//  We use a simple threshold-based pull on touchstart/touchmove/touchend. The
//  page doesn't scroll mid-pull (we only engage when scrollTop === 0). When
//  the threshold (70px) is exceeded, onRefresh fires after release.
// =============================================================================

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
            className={`h-5 w-5 text-gold-600 dark:text-gold-400 ${refreshing ? 'animate-spin' : ''}`}
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

// ═══════════════════════════════════════════════════════════════════════════
//  RewardsScreen
// ═══════════════════════════════════════════════════════════════════════════

export interface RewardsScreenProps {
  /**
   * Optional callback when the user taps "Redeem Points" and wants to apply
   * their points to a checkout flow. If absent, the Redeem CTA opens the
   * in-screen redemption Sheet instead.
   */
  onRedeemAtCheckout?: () => void
}

export function RewardsScreen({ onRedeemAtCheckout }: RewardsScreenProps) {
  const prefersReduced = useReducedMotion()
  const { user } = useAuth()
  const { toast } = useToast()
  const account = useRewards((s) => s.account)
  const ledger = useRewards((s) => s.recentLedger)
  const isLoading = useRewards((s) => s.isLoading)
  const error = useRewards((s) => s.error)
  const refresh = useRewards((s) => s.refresh)
  const redeem = useRewards((s) => s.redeem)
  const setActiveTab = useUI((s) => s.setActiveTab)
  const openCart = useUI((s) => s.openCart)

  // ── Sheet + redemption state ───────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [redeemingKey, setRedeemingKey] = React.useState<string | null>(null)
  const [lastRedemption, setLastRedemption] = React.useState<RewardRedemption | null>(null)
  const [copied, setCopied] = React.useState(false)

  // ── Ledger pagination (client-side slice over the cached recentLedger) ────
  // The store already fetches limit=20. "Load more" expands the visible slice;
  // a follow-up /api/rewards/ledger?offset=…&limit=… call would refresh the
  // full list (deferred — Task 5A can add an offset param when wired up).
  const PAGE_SIZE = 5
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [ledger.length])

  // ── Auto-refresh on mount + when the user becomes available ────────────────
  React.useEffect(() => {
    if (user?.userId) {
      refresh(user.userId).catch(() => {
        /* best-effort — error state surfaces in the UI */
      })
    }
  }, [user?.userId, refresh])

  // ── Derived stats ───────────────────────────────────────────────────────────
  const stats = React.useMemo(() => {
    const lifetimeEarned = account?.lifetimePoints ?? 0
    // Lifetime redeemed ≈ lifetimeEarned − currentBalance (assumes no expiry in MVP).
    const lifetimeRedeemed = account
      ? Math.max(0, account.lifetimePoints - account.pointsBalance)
      : 0
    // "This month" — sum EARN points from the loaded ledger slice (UI approximation).
    const now = new Date()
    const thisMonth = ledger
      .filter((e) => {
        if (e.type !== 'EARN') return false
        const d = new Date(e.createdAt)
        return (
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        )
      })
      .reduce((sum, e) => sum + Math.max(0, e.points), 0)
    return { lifetimeEarned, lifetimeRedeemed, thisMonth }
  }, [account, ledger])

  const hasAccount = !!account
  const hasAnyLedger = ledger.length > 0
  const isEmpty = !hasAccount && !hasAnyLedger && !isLoading
  const visibleLedger = ledger.slice(0, visibleCount)
  const hasMore = visibleCount < ledger.length

  // ── Refresh handler (pull-to-refresh + manual button) ─────────────────────
  const handleRefresh = React.useCallback(async () => {
    if (!user?.userId) return
    try {
      await refresh(user.userId)
    } catch {
      /* swallow — error state already set in store */
    }
  }, [user?.userId, refresh])

  // ── Redeem handler — single option from the Sheet ─────────────────────────
  const handleRedeem = React.useCallback(
    async (option: RedemptionOption) => {
      if (!account || account.pointsBalance < option.pointsCost) {
        toast({
          title: 'Not enough points',
          description: `You need ${option.pointsCost} pts to redeem ${option.name}.`,
          variant: 'destructive',
        })
        return
      }
      setRedeemingKey(option.key)
      setCopied(false)
      try {
        // The store API is redeem(points, orderId?) — we pass the option's
        // pointsCost. The server (Task 5A) creates a RewardRedemption row
        // with a single-use code; the rewardType is encoded by the points
        // amount for MVP (the UI label here is informational only).
        const redemption = await redeem(option.pointsCost)
        setLastRedemption(redemption)
        toast({
          title: 'Redemption code created!',
          description: `${option.name} · ${option.pointsCost} pts redeemed.`,
        })
      } catch (e) {
        toast({
          title: 'Redemption failed',
          description: (e as Error).message ?? 'Please try again.',
          variant: 'destructive',
        })
      } finally {
        setRedeemingKey(null)
      }
    },
    [account, redeem, toast],
  )

  const handleCopyCode = React.useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast({ title: 'Code copied', description: code })
      // Reset the copied indicator after 2s so the user can copy again later.
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Tap and hold the code to copy it manually.',
        variant: 'destructive',
      })
    }
  }, [toast])

  const handleSheetOpenChange = React.useCallback((open: boolean) => {
    setSheetOpen(open)
    if (!open) {
      // Reset transient sheet state when closing — keep lastRedemption so a
      // re-open shows the most recent code if the user dismissed it.
      setRedeemingKey(null)
      setCopied(false)
    }
  }, [])

  // ───────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ───────────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Rewards
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Earn points on every order and redeem them for discounts.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Refresh rewards"
          onClick={() => void handleRefresh()}
          disabled={isLoading}
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <p className="font-medium">Couldn&apos;t load rewards</p>
          <p className="mt-0.5 text-xs">{error}</p>
        </div>
      )}

      <PullToRefresh onRefresh={handleRefresh} refreshing={isLoading}>
        {isLoading && !account ? (
          <RewardsScreenSkeleton />
        ) : isEmpty ? (
          <EmptyState
            variant="no-rewards"
            title="No rewards yet"
            description="Place your first order to start earning points — every ₹10 spent earns 1 pt."
            actionLabel="Browse restaurants"
            onAction={() => setActiveTab('explore')}
            className="py-12"
          />
        ) : (
          <motion.div
            variants={SECTION_CONTAINER}
            initial={prefersReduced ? false : 'hidden'}
            animate="show"
            className="space-y-5"
          >
            {/* ── 1. Hero card — RewardProgressRing (large) + tier + progress ── */}
            <motion.div variants={SECTION_ITEM}>
              <Card className="overflow-hidden border-gold-200 bg-gradient-to-br from-gold-50 to-amber-50 dark:border-gold-900/40 dark:from-gold-950/30 dark:to-amber-950/20">
                <CardContent className="p-5">
                  <RewardProgressRing
                    points={account?.pointsBalance ?? 0}
                    size={140}
                    strokeWidth={10}
                    earnRate="1 pt per ₹10 spent · 100 pts = ₹10 off"
                  />
                </CardContent>
              </Card>
            </motion.div>

            {/* ── 2. Stats row — Lifetime Earned / Redeemed / This Month ─────── */}
            <motion.div variants={SECTION_ITEM}>
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  label="Lifetime earned"
                  value={stats.lifetimeEarned.toLocaleString('en-IN')}
                  hint="pts"
                  tone="gold"
                />
                <StatCard
                  label="Redeemed"
                  value={stats.lifetimeRedeemed.toLocaleString('en-IN')}
                  hint="pts"
                  tone="rose"
                />
                <StatCard
                  label="This month"
                  value={stats.thisMonth.toLocaleString('en-IN')}
                  hint="pts"
                  tone="teal"
                />
              </div>
            </motion.div>

            {/* ── 3. How to earn — Collapsible card listing all active rules ── */}
            <motion.div variants={SECTION_ITEM}>
              <HowToEarnCard />
            </motion.div>

            {/* ── 4. Recent activity — Paginated ledger list ─────────────────── */}
            <motion.div variants={SECTION_ITEM}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent activity
              </h2>
              {!hasAnyLedger ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No reward activity yet. Place an order to start earning!
                </div>
              ) : (
                <>
                  <motion.ul
                    variants={LEDGER_LIST}
                    initial={prefersReduced ? false : 'hidden'}
                    animate="show"
                    className="space-y-2"
                  >
                    {visibleLedger.map((entry) => (
                      <motion.li key={entry.id} variants={LEDGER_ITEM}>
                        <LedgerRow entry={entry} />
                      </motion.li>
                    ))}
                  </motion.ul>
                  {hasMore && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() =>
                        setVisibleCount((c) => c + PAGE_SIZE)
                      }
                    >
                      Load more
                      <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </>
              )}
            </motion.div>

            {/* ── 5. Redeem CTA — Prominent gold button → opens Sheet ─────────── */}
            <motion.div variants={SECTION_ITEM}>
              <Card className="overflow-hidden border-gold-300 bg-gradient-to-br from-gold-100 to-amber-100 dark:border-gold-800/60 dark:from-gold-950/40 dark:to-amber-950/30">
                <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-500/20 text-gold-700 dark:text-gold-300">
                    <Gift className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      Redeem your points
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {account && account.pointsBalance > 0
                        ? `You have ${account.pointsBalance.toLocaleString('en-IN')} pts ready to redeem.`
                        : 'Earn 100 pts to unlock your first discount.'}
                    </p>
                  </div>
                  <div className="flex w-full flex-wrap items-center justify-center gap-2">
                    <Button
                      className="flex-1 bg-gold-600 font-semibold text-white hover:bg-gold-700"
                      onClick={() => setSheetOpen(true)}
                      disabled={!account || account.pointsBalance <= 0}
                    >
                      <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
                      Redeem points
                    </Button>
                    {onRedeemAtCheckout && (
                      <Button
                        variant="outline"
                        className="border-gold-300 text-gold-700 hover:bg-gold-100 dark:border-gold-800 dark:text-gold-300 dark:hover:bg-gold-950/40"
                        onClick={() => {
                          setSheetOpen(false)
                          onRedeemAtCheckout()
                        }}
                      >
                        Apply at checkout
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* ── Convenience link — open cart if there's anything to checkout ─ */}
            {onRedeemAtCheckout && (
              <motion.div variants={SECTION_ITEM} className="text-center">
                <Button
                  variant="link"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => openCart()}
                >
                  Go to cart →
                </Button>
              </motion.div>
            )}
          </motion.div>
        )}
      </PullToRefresh>

      {/* ─────────────────────────────────────────────────────────────────────
          6. Redeem Sheet — bottom sheet with the 3 redemption options.
          On successful redeem, swaps to a code+copy success view.
         ───────────────────────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[85vh] w-full max-w-2xl overflow-y-auto p-0"
        >
          <SheetHeader className="border-b bg-gradient-to-r from-gold-50 to-amber-50 px-4 py-3 dark:from-gold-950/30 dark:to-amber-950/20">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Gift className="h-4 w-4 text-gold-600 dark:text-gold-400" aria-hidden="true" />
              Redeem your points
            </SheetTitle>
            <SheetDescription>
              {account
                ? `Balance: ${account.pointsBalance.toLocaleString('en-IN')} pts available.`
                : 'Loading your balance…'}
            </SheetDescription>
          </SheetHeader>

          <div className="p-4">
            {lastRedemption ? (
              <RedemptionSuccessView
                redemption={lastRedemption}
                copied={copied}
                onCopy={() => void handleCopyCode(lastRedemption.redemptionCode)}
                onDismiss={() => {
                  setLastRedemption(null)
                  setSheetOpen(false)
                }}
                onRedeemAnother={() => setLastRedemption(null)}
              />
            ) : (
              <div className="space-y-3">
                {REDEMPTION_OPTIONS.map((option) => {
                  const affordable =
                    !!account && account.pointsBalance >= option.pointsCost
                  const isRedeeming = redeemingKey === option.key
                  const Icon = option.Icon
                  return (
                    <div
                      key={option.key}
                      className={[
                        'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                        affordable
                          ? 'border-gold-200 bg-gold-50/40 dark:border-gold-900/40 dark:bg-gold-950/20'
                          : 'border-border bg-muted/30 opacity-70',
                      ].join(' ')}
                    >
                      <div
                        className={[
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                          affordable
                            ? 'bg-gold-500/15 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300'
                            : 'bg-muted text-muted-foreground',
                        ].join(' ')}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {option.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {option.description}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge
                            className="bg-gold-100 text-[10px] text-gold-700 dark:bg-gold-950/60 dark:text-gold-300"
                            variant="secondary"
                          >
                            {option.pointsCost} pts
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            ≈ {option.valueLabel}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-50"
                        disabled={!affordable || isRedeeming}
                        onClick={() => void handleRedeem(option)}
                      >
                        {isRedeeming ? (
                          <>
                            <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            Redeeming
                          </>
                        ) : (
                          'Redeem'
                        )}
                      </Button>
                    </div>
                  )
                })}
                {!account && (
                  <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Loading your rewards balance…
                  </p>
                )}
                {account && account.pointsBalance < 100 && (
                  <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    You need at least 100 pts to redeem. Place an order to earn more!
                  </p>
                )}
              </div>
            )}
          </div>

          <SheetFooter className="border-t px-4 py-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSheetOpen(false)}
              disabled={!!redeemingKey}
            >
              {lastRedemption ? 'Done' : 'Cancel'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// =============================================================================
//  RewardsScreenSkeleton — loading state for the full screen
// =============================================================================

function RewardsScreenSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <RewardRingSkeleton />
        <div className="grid grid-cols-3 gap-2">
          <SkeletonLine className="h-16 rounded-xl" />
          <SkeletonLine className="h-16 rounded-xl" />
          <SkeletonLine className="h-16 rounded-xl" />
        </div>
        <SkeletonLine className="h-32 rounded-xl" />
        <div className="space-y-2">
          <SkeletonLine className="h-12 rounded-xl" />
          <SkeletonLine className="h-12 rounded-xl" />
          <SkeletonLine className="h-12 rounded-xl" />
        </div>
      </CardContent>
    </Card>
  )
}

// =============================================================================
//  StatCard — small stat tile in the stats row
// =============================================================================

interface StatCardProps {
  label: string
  value: string
  hint: string
  tone: 'gold' | 'rose' | 'teal'
}

function StatCard({ label, value, hint, tone }: StatCardProps) {
  const toneClass = {
    gold:
      'border-gold-200 bg-gold-50/60 dark:border-gold-900/40 dark:bg-gold-950/20',
    rose:
      'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20',
    teal:
      'border-teal-200 bg-teal-50/60 dark:border-teal-900/40 dark:bg-teal-950/20',
  }[tone]
  const valueTone = {
    gold: 'text-gold-700 dark:text-gold-300',
    rose: 'text-rose-700 dark:text-rose-300',
    teal: 'text-teal-700 dark:text-teal-300',
  }[tone]
  return (
    <div
      className={`rounded-xl border p-3 ${toneClass}`}
    >
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg font-bold leading-tight tabular-nums ${valueTone}`}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  )
}

// =============================================================================
//  HowToEarnCard — Collapsible card listing all active reward rules
// =============================================================================

function HowToEarnCard() {
  const [open, setOpen] = React.useState(true)
  // Active rules = all REWARD_RULES entries (Task 1A seeds them all active).
  // Sort: EARN_BASE first (the base earn rate), then by ordinal insertion order.
  const ruleKeys = Object.keys(REWARD_RULES) as RewardRuleKey[]
  const orderedKeys: RewardRuleKey[] = [
    'EARN_BASE',
    ...ruleKeys.filter((k) => k !== 'EARN_BASE'),
  ]
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left snak-focus-ring rounded-md"
              aria-expanded={open}
              aria-controls="how-to-earn-content"
            >
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-gold-600 dark:text-gold-400" aria-hidden="true" />
                How to earn
              </CardTitle>
              {open ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent id="how-to-earn-content">
          <CardContent className="space-y-2 pt-0">
            {orderedKeys.map((key) => {
              const rule = REWARD_RULES[key]
              if (!rule) return null
              const Icon = ruleIcon(key)
              const pointsLabel = rulePointsLabel(key)
              return (
                <div
                  key={key}
                  className="flex items-start gap-3 rounded-xl bg-muted/40 p-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-100 text-gold-700 dark:bg-gold-950/60 dark:text-gold-300">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{rule.name}</p>
                      {pointsLabel && (
                        <Badge className="bg-gold-100 text-[10px] text-gold-700 dark:bg-gold-950/60 dark:text-gold-300">
                          {pointsLabel}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {rule.description}
                    </p>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

// =============================================================================
//  LedgerRow — a single recent-activity entry
// =============================================================================

function LedgerRow({ entry }: { entry: RewardLedgerEntry }) {
  const isEarn = entry.type === 'EARN'
  const isRedeem = entry.type === 'REDEEM'
  const isExpire = entry.type === 'EXPIRE'
  const isAdjust = entry.type === 'ADJUST'

  // Icon + tone by entry type.
  let Icon: LucideIcon = Sparkles
  let tone = 'gold'
  if (isEarn) {
    Icon = ArrowUp
    tone = 'gold'
  } else if (isRedeem) {
    Icon = ArrowDown
    tone = 'rose'
  } else if (isExpire) {
    Icon = Minus
    tone = 'muted'
  } else if (isAdjust) {
    Icon = Minus
    tone = 'muted'
  }
  const toneBg = {
    gold: 'bg-gold-100 text-gold-700 dark:bg-gold-950/60 dark:text-gold-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    muted: 'bg-muted text-muted-foreground',
  }[tone] ?? 'bg-muted text-muted-foreground'
  const valueTone = {
    gold: 'text-gold-700 dark:text-gold-400',
    rose: 'text-rose-700 dark:text-rose-400',
    muted: 'text-muted-foreground',
  }[tone] ?? 'text-muted-foreground'

  // Sign for the points value: EARN is +, REDEEM/EXPIRE is −, ADJUST shows the raw.
  let sign = ''
  if (isEarn) sign = '+'
  else if (isRedeem || isExpire) sign = entry.points < 0 ? '' : '−' // REDEEM usually stores negatives

  // Description: human-readable. The `reason` field is a structured string like
  // "order:SNZ-12345", "redemption:checkout", "expiry:30d", "admin:adjust".
  // We render the type + a friendly summary derived from the reason.
  const description = formatLedgerDescription(entry)

  return (
    <article className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneBg}`}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {description}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {entry.type} · {timeAgo(entry.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p
          className={`font-mono text-sm font-semibold tabular-nums ${valueTone}`}
        >
          {sign}
          {Math.abs(entry.points)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          balance {entry.balanceAfter}
        </p>
      </div>
    </article>
  )
}

/**
 * Format a friendly description from the ledger entry's `reason` field.
 *   - "order:SNZ-12345"        → "Earned from order SNZ-12345"
 *   - "redemption:checkout"    → "Redeemed at checkout"
 *   - "redemption:order:SNZ-X" → "Redeemed on order SNZ-X"
 *   - "expiry:30d"             → "Expired (30d window)"
 *   - "admin:adjust"           → "Admin adjustment"
 * Falls back to the raw reason if it doesn't match a known pattern.
 */
function formatLedgerDescription(entry: RewardLedgerEntry): string {
  const r = entry.reason ?? ''
  if (entry.type === 'EARN') {
    const m = r.match(/^order:(.+)$/)
    if (m) return `Earned from order ${m[1]}`
    if (r.startsWith('rule:')) return `Earned ${r.slice(5)} bonus`
    return r ? `Earned · ${r}` : 'Earned'
  }
  if (entry.type === 'REDEEM') {
    const m = r.match(/^redemption:order:(.+)$/)
    if (m) return `Redeemed on order ${m[1]}`
    if (r === 'redemption:checkout') return 'Redeemed at checkout'
    return r ? `Redeemed · ${r}` : 'Redeemed'
  }
  if (entry.type === 'EXPIRE') {
    return r ? `Expired · ${r}` : 'Expired'
  }
  if (entry.type === 'ADJUST') {
    return r ? `Adjusted · ${r}` : 'Admin adjustment'
  }
  return r || entry.type
}

// =============================================================================
//  RedemptionSuccessView — code + copy view shown after a successful redeem
// =============================================================================

interface RedemptionSuccessViewProps {
  redemption: RewardRedemption
  copied: boolean
  onCopy: () => void
  onDismiss: () => void
  onRedeemAnother: () => void
}

function RedemptionSuccessView({
  redemption,
  copied,
  onCopy,
  onDismiss,
  onRedeemAnother,
}: RedemptionSuccessViewProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
        <Check className="h-7 w-7" aria-hidden="true" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">
          Redemption code created!
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Show this code at checkout to apply your discount. Single-use only.
        </p>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="group flex w-full items-center justify-between gap-3 rounded-xl border-2 border-dashed border-gold-300 bg-gold-50/60 px-4 py-3 text-left transition-colors hover:border-gold-400 hover:bg-gold-50 dark:border-gold-800/60 dark:bg-gold-950/30 dark:hover:bg-gold-950/40 snak-focus-ring"
        aria-label={`Redemption code ${redemption.redemptionCode}. Tap to copy.`}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Your code
          </p>
          <p className="mt-0.5 truncate font-mono text-lg font-bold tracking-wider text-gold-700 dark:text-gold-300">
            {redemption.redemptionCode}
          </p>
        </div>
        <div
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            copied
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-gold-500/15 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300',
          ].join(' ')}
          aria-hidden="true"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </div>
      </button>
      <p className="text-xs text-muted-foreground">
        {copied ? 'Copied to clipboard.' : 'Tap the code to copy.'}
      </p>
      <div className="flex w-full items-center gap-2 pt-1">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onRedeemAnother}
        >
          Redeem another
        </Button>
        <Button
          className="flex-1 bg-gold-600 text-white hover:bg-gold-700"
          onClick={onDismiss}
        >
          Done
        </Button>
      </div>
    </div>
  )
}

// =============================================================================
//  End of file
// =============================================================================

export default RewardsScreen
