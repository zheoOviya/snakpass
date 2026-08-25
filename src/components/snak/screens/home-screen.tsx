'use client'

// src/components/snak/screens/home-screen.tsx
//
// Home screen — premium consumer landing surface per blueprint §9.
//
// Sections (in render order, mobile-first):
//  1. Campus context bar        — shows selected campus + "Change" affordance
//  2. Search bar                — inline filter that scopes the Popular grid
//  3. Quick Reorder             — horizontal carousel of recently ordered restaurants
//  4. Open Now                  — horizontal carousel of isOpen===true restaurants
//  5. Popular Near You          — 2-col grid of RestaurantCardV2 (top 6 by rating)
//  6. Deals                     — horizontal carousel of restaurants with `deal` label
//  7. Rewards Progress          — RewardProgressRing + "View rewards" CTA
//  8. Friends Ordering Nearby   — SocialFeedCard list (last 3 ordered_from activities)
//  9. Gift a Friend CTA         — violet accent card
// 10. Start Group Order CTA     — rose accent card
// 11. Recently Ordered          — vertical list of last 3 orders
//
// Governance (Task 2B):
//  - Does NOT touch any API route — uses existing GET /api/restaurants,
//    GET /api/orders?role=consumer, GET /api/social/feed, GET /api/rewards/account.
//  - Uses Task 1B components: RestaurantCardV2, RewardProgressRing, EmptyState,
//    SkeletonLoader, SocialFeedCard.
//  - Uses Task 1C stores: useCampus, useSocial, useRewards.
//  - Tapping a restaurant → ui-store.openRestaurant(id) — ConsumerView wires
//    the actual restaurant-detail overlay (Task 2D's screen via dynamic import).

import * as React from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  Search,
  RefreshCw,
  ChevronRight,
  Gift,
  Users,
  Sparkles,
  ArrowRight,
  MapPin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { inr, timeAgo, STATUS_META } from '@/lib/snack'
import { useCampus } from '@/lib/campus-store'
import { useSocial } from '@/lib/social-store'
import { useRewards } from '@/lib/rewards-store'
import { useUI } from '@/lib/ui-store'
import { useAuth } from '@/hooks/use-auth'
import type { Order, Restaurant, SocialActivity } from '@/lib/types'

import { RestaurantCardV2 } from '@/components/snak/restaurant-card-v2'
import { RewardProgressRing } from '@/components/snak/reward-progress-ring'
import { EmptyState } from '@/components/snak/empty-state'
import {
  RestaurantCardSkeleton,
  OrderCardSkeleton,
  SocialFeedSkeleton,
  RewardRingSkeleton,
} from '@/components/snak/skeleton-loader'
import { SocialFeedCard } from '@/components/snak/social-feed-card'
import { CampusBadge } from '@/components/snak/bits'
import { FriendRankedSection } from '@/components/snak/friend-ranked-section'
import { SendGiftFlow } from '@/components/snak/screens/send-gift-flow'
import { CreateGroupOrderFlow } from '@/components/snak/screens/create-group-order-flow'

// ─────────────────────────────────────────────────────────────────────────────
// Local types — additive Wave 2C fields on Restaurant (Task 2C owns types.ts
// extension; we declare a local additive interface here so the file compiles
// even before 2C lands).
// ─────────────────────────────────────────────────────────────────────────────

type RestaurantWithExtras = Restaurant & {
  /** Wave 2C additive — reward multiplier (default 1). */
  rewardMultiplier?: number
  /** Wave 2C additive — derived open/closed state. */
  isOpen?: boolean
  /** Wave 2C additive — derived "Great value" deal label, if any. */
  deal?: string | null
}

type RestaurantFetchState = {
  data: RestaurantWithExtras[]
  loading: boolean
  error: string | null
}

type OrdersFetchState = {
  data: Order[]
  loading: boolean
  error: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion presets — stagger pattern per DESIGN_SYSTEM.md §6.4
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_CONTAINER: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.03, delayChildren: 0.04 },
  },
}

const SECTION_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.3, 0, 0, 1] },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// HomeScreen — public surface
// ─────────────────────────────────────────────────────────────────────────────

export interface HomeScreenProps {
  /** Called when the user pulls to refresh. Defaults to a no-op. */
  onRefresh?: () => Promise<void> | void
}

export function HomeScreen({ onRefresh }: HomeScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()
  const { user } = useAuth()
  const openRestaurant = useUI((s) => s.openRestaurant)
  const setActiveTab = useUI((s) => s.setActiveTab)

  // ── Send-gift flow (Task 6D — modal triggered by the "Gift a Friend" CTA) ──
  const [sendGiftOpen, setSendGiftOpen] = React.useState(false)

  // ── Create-group-order flow (Task 7B — modal triggered by the
  // "Start Group Order" CTA on the rose CTACard). ──
  const [createGroupOpen, setCreateGroupOpen] = React.useState(false)

  const selectedCampusId = useCampus((s) => s.selectedCampusId)
  const selectedCampusName = useCampus((s) => s.selectedCampusName)

  // ── Restaurants ──────────────────────────────────────────────────────────
  // Fetched once on mount, scoped by campus when selected. We do NOT
  // re-fetch on inline search — that's a client-side filter for snappy UX.
  const [restaurants, setRestaurants] = React.useState<RestaurantFetchState>({
    data: [],
    loading: true,
    error: null,
  })
  const [q, setQ] = React.useState('')

  const fetchRestaurants = React.useCallback(async () => {
    setRestaurants((s) => ({ ...s, loading: true, error: null }))
    try {
      const url = selectedCampusId
        ? `/api/campuses/${encodeURIComponent(selectedCampusId)}/restaurants`
        : '/api/restaurants'
      const res = await fetch(url, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as {
        restaurants?: RestaurantWithExtras[]
        error?: { message?: string }
      }
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Failed (${res.status})`)
      }
      setRestaurants({ data: data.restaurants ?? [], loading: false, error: null })
    } catch (e) {
      const msg = (e as Error).message
      setRestaurants({ data: [], loading: false, error: msg })
      toast({
        title: 'Could not load restaurants',
        description: msg,
        variant: 'destructive',
      })
    }
  }, [selectedCampusId, toast])

  // ── My orders (recent) ────────────────────────────────────────────────────
  const [orders, setOrders] = React.useState<OrdersFetchState>({
    data: [],
    loading: true,
    error: null,
  })

  const fetchOrders = React.useCallback(async () => {
    setOrders((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch('/api/orders?role=consumer&limit=10', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as {
        orders?: Order[]
        error?: { message?: string }
      }
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Failed (${res.status})`)
      }
      setOrders({ data: data.orders ?? [], loading: false, error: null })
    } catch {
      // Soft-fail — Home should still render even if /api/orders 401s (e.g.,
      // a stale session that's about to refresh). Empty state will surface.
      setOrders({ data: [], loading: false, error: 'unavailable' })
    }
  }, [])

  // ── Social feed (Friends Ordering Nearby) ────────────────────────────────
  // We use the social-store's `feed` slice — Task 1C's useSocial already
  // fetches /api/social/feed on consumer-view mount. We just read + filter it.
  const socialFeed = useSocial((s) => s.feed)
  const socialConnections = useSocial((s) => s.connections)
  const socialLoading = useSocial((s) => s.isLoading)
  const refreshSocial = useSocial((s) => s.refresh)

  // ── Rewards ──────────────────────────────────────────────────────────────
  const rewardsAccount = useRewards((s) => s.account)
  const rewardsLoading = useRewards((s) => s.isLoading)
  const refreshRewards = useRewards((s) => s.refresh)

  // ── Initial load + whenever the campus changes ───────────────────────────
  React.useEffect(() => {
    fetchRestaurants()
    fetchOrders()
    refreshSocial().catch(() => {
      /* best-effort */
    })
    if (user?.userId) {
      refreshRewards(user.userId).catch(() => {
        /* best-effort */
      })
    }
  }, [fetchRestaurants, fetchOrders, refreshSocial, refreshRewards, user?.userId])

  // ── Pull-to-refresh handler ──────────────────────────────────────────────
  const [refreshing, setRefreshing] = React.useState(false)
  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        fetchRestaurants(),
        fetchOrders(),
        refreshSocial(),
        user?.userId ? refreshRewards(user.userId) : Promise.resolve(),
      ])
      await onRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }, [
    fetchRestaurants,
    fetchOrders,
    refreshSocial,
    refreshRewards,
    onRefresh,
    user?.userId,
  ])

  // ── Derived section data ─────────────────────────────────────────────────
  // Restaurants matching the inline search query (client-side filter — snappy).
  const filteredRestaurants = React.useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return restaurants.data
    return restaurants.data.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.cuisine.toLowerCase().includes(query) ||
        r.description.toLowerCase().includes(query),
    )
  }, [restaurants.data, q])

  // Quick Reorder: unique restaurant ids from the user's recent orders, capped
  // at 5. We show their cards as a horizontal carousel so the user can jump
  // straight back into their favourites.
  const quickReorderRestaurants = React.useMemo(() => {
    const seen = new Set<string>()
    const out: RestaurantWithExtras[] = []
    for (const o of orders.data) {
      const rid = o.restaurant.id
      if (seen.has(rid)) continue
      const match = restaurants.data.find((r) => r.id === rid)
      if (match) {
        seen.add(rid)
        out.push(match)
      }
      if (out.length >= 5) break
    }
    return out
  }, [orders.data, restaurants.data])

  const openNowRestaurants = React.useMemo(
    () => filteredRestaurants.filter((r) => r.isOpen !== false).slice(0, 8),
    [filteredRestaurants],
  )

  const popularRestaurants = React.useMemo(
    () => filteredRestaurants.slice(0, 6),
    [filteredRestaurants],
  )

  const dealsRestaurants = React.useMemo(
    () => filteredRestaurants.filter((r) => !!r.deal).slice(0, 8),
    [filteredRestaurants],
  )

  const friendsOrdering = React.useMemo<SocialActivity[]>(
    () =>
      socialFeed
        .filter((a) => a.verb === 'ordered_from')
        .slice(0, 3),
    [socialFeed],
  )

  const recentOrders = React.useMemo(() => orders.data.slice(0, 3), [orders.data])

  const hasFriends = socialConnections.length > 0
  const hasRewardsAccount = !!rewardsAccount

  // ── Render helpers ────────────────────────────────────────────────────────
  function handleRestaurantTap(r: Restaurant) {
    openRestaurant(r.id)
  }

  function handleReorderTap(r: Restaurant) {
    openRestaurant(r.id)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
    <PullToRefresh onRefresh={handleRefresh} refreshing={refreshing}>
      <motion.div
        variants={SECTION_CONTAINER}
        initial={prefersReduced ? false : 'hidden'}
        animate="show"
        className="mx-auto w-full max-w-6xl space-y-8 px-4 py-5 pb-24"
      >
        {/* ────────────────────────────────────────────────────────────────────
            1. Campus context bar
            ──────────────────────────────────────────────────────────────────── */}
        <motion.section variants={SECTION_ITEM} aria-label="Campus context">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {selectedCampusName ? (
                <CampusBadge name={selectedCampusName} />
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                  <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  All campuses
                </span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => setActiveTab('explore')}
            >
              Change
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </motion.section>

        {/* ────────────────────────────────────────────────────────────────────
            2. Search bar — inline filter
            ──────────────────────────────────────────────────────────────────── */}
        <motion.section variants={SECTION_ITEM} aria-label="Search">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search restaurants, cuisines…"
              aria-label="Search restaurants and cuisines"
              className="h-11 rounded-2xl border-border/80 bg-card pl-10 pr-10 text-sm shadow-sm"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </motion.section>

        {/* ────────────────────────────────────────────────────────────────────
            3. Quick Reorder — horizontal carousel of recently ordered restaurants
            ──────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="home-quick-reorder">
          <SectionHeader id="home-quick-reorder" title="Quick Reorder" icon="🔄" />
          {orders.loading ? (
            <HorizontalScroll>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="w-64 shrink-0">
                  <RestaurantCardSkeleton />
                </div>
              ))}
            </HorizontalScroll>
          ) : quickReorderRestaurants.length === 0 ? (
            <EmptyState
              variant="no-orders"
              title="No recent orders yet"
              description="Your favourite restaurants will appear here for one-tap reorder."
              className="py-8"
            />
          ) : (
            <HorizontalScroll>
              {quickReorderRestaurants.map((r) => (
                <div key={r.id} className="w-64 shrink-0">
                  <RestaurantCardV2
                    restaurant={r}
                    isOpen={r.isOpen !== false}
                    rewardMultiplier={r.rewardMultiplier}
                    dealLabel={r.deal ?? undefined}
                    onPress={handleReorderTap}
                  />
                </div>
              ))}
            </HorizontalScroll>
          )}
        </section>

        {/* ────────────────────────────────────────────────────────────────────
            4. Open Now — horizontal carousel
            ──────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="home-open-now">
          <SectionHeader id="home-open-now" title="Open Now" icon="🟢" />
          {restaurants.loading ? (
            <HorizontalScroll>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="w-64 shrink-0">
                  <RestaurantCardSkeleton />
                </div>
              ))}
            </HorizontalScroll>
          ) : openNowRestaurants.length === 0 ? (
            <EmptyState
              variant="no-restaurants"
              title="No restaurants open near you"
              description="Try a different campus or check back in a few minutes."
              className="py-8"
            />
          ) : (
            <HorizontalScroll>
              {openNowRestaurants.map((r) => (
                <div key={r.id} className="w-64 shrink-0">
                  <RestaurantCardV2
                    restaurant={r}
                    isOpen={r.isOpen !== false}
                    rewardMultiplier={r.rewardMultiplier}
                    dealLabel={r.deal ?? undefined}
                    onPress={handleRestaurantTap}
                  />
                </div>
              ))}
            </HorizontalScroll>
          )}
        </section>

        {/* ────────────────────────────────────────────────────────────────────
            S5H2: Popular among friends — friend-ranked discovery (additive)
            ──────────────────────────────────────────────────────────────────── */}
        <FriendRankedSection
          campusId={user?.campusId}
          onOpenRestaurant={handleRestaurantTap}
        />

        {/* ────────────────────────────────────────────────────────────────────
            5. Popular Near You — grid of RestaurantCardV2
            ──────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="home-popular">
          <SectionHeader id="home-popular" title="Popular Near You" icon="🔥" />
          {restaurants.loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <RestaurantCardSkeleton key={i} />
              ))}
            </div>
          ) : popularRestaurants.length === 0 ? (
            <EmptyState
              variant="no-restaurants"
              className="py-8"
              actionLabel="Switch campus"
              onAction={() => setActiveTab('explore')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {popularRestaurants.map((r) => (
                <RestaurantCardV2
                  key={r.id}
                  restaurant={r}
                  isOpen={r.isOpen !== false}
                  rewardMultiplier={r.rewardMultiplier}
                  dealLabel={r.deal ?? undefined}
                  onPress={handleRestaurantTap}
                />
              ))}
            </div>
          )}
        </section>

        {/* ────────────────────────────────────────────────────────────────────
            6. Deals — horizontal carousel
            ──────────────────────────────────────────────────────────────────── */}
        {dealsRestaurants.length > 0 && (
          <section aria-labelledby="home-deals">
            <SectionHeader id="home-deals" title="Deals" icon="⚡" />
            <HorizontalScroll>
              {dealsRestaurants.map((r) => (
                <div key={r.id} className="w-64 shrink-0">
                  <RestaurantCardV2
                    restaurant={r}
                    isOpen={r.isOpen !== false}
                    rewardMultiplier={r.rewardMultiplier}
                    dealLabel={r.deal ?? undefined}
                    onPress={handleRestaurantTap}
                  />
                </div>
              ))}
            </HorizontalScroll>
          </section>
        )}

        {/* ────────────────────────────────────────────────────────────────────
            7. Rewards Progress — RewardProgressRing + "View rewards" CTA
            ──────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="home-rewards">
          <SectionHeader id="home-rewards" title="Rewards Progress" icon="✨" />
          <Card className="overflow-hidden border-gold-200 bg-gradient-to-br from-gold-50 to-amber-50 dark:border-gold-900/40 dark:from-gold-950/30 dark:to-amber-950/20">
            <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
              {rewardsLoading ? (
                <RewardRingSkeleton />
              ) : hasRewardsAccount ? (
                <RewardProgressRing
                  points={rewardsAccount.pointsBalance}
                  size={96}
                  earnRate="You earn points on every order"
                />
              ) : (
                <div className="flex w-full flex-col items-start gap-3">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gold-100 dark:bg-gold-950/60">
                    <Sparkles className="h-8 w-8 text-gold-600 dark:text-gold-400" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Earn points on every order and unlock tier-based rewards.
                  </p>
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2 sm:items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="border-gold-300 text-gold-800 hover:bg-gold-100 dark:border-gold-800 dark:text-gold-300 dark:hover:bg-gold-950/60"
                  onClick={() => setActiveTab('rewards')}
                >
                  View rewards
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ────────────────────────────────────────────────────────────────────
            8. Friends Ordering Nearby — SocialFeedCard list (only if has friends)
            ──────────────────────────────────────────────────────────────────── */}
        {hasFriends && (
          <section aria-labelledby="home-friends">
            <SectionHeader id="home-friends" title="Friends Ordering Nearby" icon="👥" />
            {socialLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <SocialFeedSkeleton key={i} />
                ))}
              </div>
            ) : friendsOrdering.length === 0 ? (
              <EmptyState
                variant="no-friends"
                title="No friends ordering right now"
                description="When friends order, you'll see their activity here."
                className="py-8"
              />
            ) : (
              <div className="space-y-3">
                {friendsOrdering.map((a) => (
                  <SocialFeedCard
                    key={a.id}
                    activity={a}
                    onPress={(act) => {
                      if (act.restaurantId) openRestaurant(act.restaurantId)
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ────────────────────────────────────────────────────────────────────
            9. Gift a Friend — violet CTA card
            10. Start Group Order — rose CTA card
            (paired in a 2-up grid on sm+, stacked on mobile)
            ──────────────────────────────────────────────────────────────────── */}
        <section aria-label="Social actions" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CTACard
            tone="violet"
            icon={<Gift className="h-5 w-5" aria-hidden="true" />}
            title="Gift a Friend"
            description="Send a food gift to a friend on campus."
            ctaLabel="Send gift"
            onCta={() => setSendGiftOpen(true)}
          />
          <CTACard
            tone="rose"
            icon={<Users className="h-5 w-5" aria-hidden="true" />}
            title="Start Group Order"
            description="Split an order with friends — one pickup."
            ctaLabel="Start group"
            onCta={() => setCreateGroupOpen(true)}
          />
        </section>

        {/* ────────────────────────────────────────────────────────────────────
            11. Recently Ordered — vertical list of last 3 orders
            ──────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="home-recent">
          <SectionHeader id="home-recent" title="Recently Ordered" icon="📋" />
          {orders.loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <OrderCardSkeleton key={i} />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <EmptyState
              variant="no-orders"
              className="py-8"
              actionLabel="Browse restaurants"
              onAction={() => setActiveTab('explore')}
            />
          ) : (
            <div className="space-y-2">
              {recentOrders.map((o) => (
                <RecentOrderRow
                  key={o.id}
                  order={o}
                  onOpen={() => setActiveTab('orders')}
                />
              ))}
            </div>
          )}
        </section>
      </motion.div>
    </PullToRefresh>

      {/* ────────────────────────────────────────────────────────────────────
          Task 6D — Send-gift modal (opened by the "Gift a Friend" CTA above).
          Rendered as a sibling so it overlays the whole screen regardless of
          scroll position.
          ──────────────────────────────────────────────────────────────────── */}
      <SendGiftFlow open={sendGiftOpen} onClose={() => setSendGiftOpen(false)} />

      {/* ────────────────────────────────────────────────────────────────────
          Task 7B — Create-group-order modal (opened by the "Start Group Order"
          CTA above). On success, calls onCreated(groupOrderId, shareCode) —
          the actual navigation to the GroupOrderScreen overlay is wired in
          ConsumerView (Task 3A territory); here we just close the modal +
          toast the user that the share link is on the success screen.
          ──────────────────────────────────────────────────────────────────── */}
      <CreateGroupOrderFlow
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onCreated={(_id, _shareCode) => {
          setCreateGroupOpen(false)
          // Navigation to the GroupOrderScreen overlay is owned by Task 3A's
          // ConsumerView (it would render the screen as a new overlay kind).
          // For now, the success screen inside the CreateGroupOrderFlow already
          // shows the share code + copy link, so the user can share + the
          // parent screen can pick this up via the callback.
        }}
      />
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper components
// ═══════════════════════════════════════════════════════════════════════════

function SectionHeader({ id, title, icon }: { id: string; title: string; icon: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span aria-hidden="true" className="text-base">
        {icon}
      </span>
      <h2 id={id} className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
        {title}
      </h2>
    </div>
  )
}

function HorizontalScroll({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="snak-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-2"
      role="list"
    >
      {children}
    </div>
  )
}

interface CTACardProps {
  tone: 'violet' | 'rose'
  icon: React.ReactNode
  title: string
  description: string
  ctaLabel: string
  onCta: () => void
}

function CTACard({ tone, icon, title, description, ctaLabel, onCta }: CTACardProps) {
  const toneClasses =
    tone === 'violet'
      ? 'border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-fuchsia-950/20'
      : 'border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 dark:border-rose-900/50 dark:from-rose-950/30 dark:to-pink-950/20'
  const iconBg =
    tone === 'violet'
      ? 'bg-violet-500 text-white'
      : 'bg-rose-500 text-white'
  const btnClass =
    tone === 'violet'
      ? 'bg-violet-600 text-white hover:bg-violet-700'
      : 'bg-rose-600 text-white hover:bg-rose-700'

  return (
    <Card className={toneClasses}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          <Button
            type="button"
            size="sm"
            className={`mt-3 h-8 px-3 text-xs ${btnClass}`}
            onClick={onCta}
          >
            {ctaLabel}
            <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function RecentOrderRow({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open order from ${order.restaurant.name}, ${order.itemsCount} items`}
      className="snak-focus-ring flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:shadow-md"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-500 text-xl">
        🍽
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{order.restaurant.name}</span>
          <Badge className={`text-[10px] ${meta.tone}`}>{meta.short}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {order.itemsCount} items · #{order.id.slice(-6).toUpperCase()} · {timeAgo(order.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground">{inr(order.totalAmount)}</p>
      </div>
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PullToRefresh — minimal pull-to-refresh wrapper (touch pointer events only).
// We use a simple threshold-based pull on touchstart/touchmove/touchend. The
// page doesn't scroll mid-pull (we only engage when scrollTop === 0). When
// the threshold (70px) is exceeded, onRefresh fires after release.
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
  // `isPulling` tracks whether the user is actively dragging (touchstart fired
  // and touchend hasn't). We use state (not a ref) because the transition
  // style depends on it — refs accessed during render are an eslint violation.
  const [isPulling, setIsPulling] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    // Only engage if the user is at the very top of the scroll container.
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
      // Rubber-band: dampen the visual pull so it feels elastic.
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
      {/* Pull indicator — only visible while actively pulling or refreshing */}
      {(pull > 4 || refreshing) && (
        <div
          className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2"
          aria-hidden="true"
        >
          <RefreshCw
            className={`h-5 w-5 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`}
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

export default HomeScreen
