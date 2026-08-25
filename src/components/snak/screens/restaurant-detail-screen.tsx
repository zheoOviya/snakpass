'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  Clock,
  MapPin,
  Heart,
  Share2,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ShoppingCart,
  Flame,
  GraduationCap,
  Star,
  MessageSquarePlus,
  ChevronRight,
  Gift,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { useToast } from '@/hooks/use-toast'
import { useCart } from '@/lib/cart-store'
import { inr } from '@/lib/snack'
import { cn } from '@/lib/utils'
import type { MenuItem, Restaurant } from '@/lib/types'

import {
  CuisineIcon,
  cuisineGradient,
  OpenClosedBadge,
  DealBadge,
  RewardBadge,
  CampusBadge,
} from '../bits'
import { MenuItemCardV2 } from '../menu-item-card-v2'
import { MenuItemSkeleton } from '../skeleton-loader'
import { EmptyState } from '../empty-state'
import { SocialProofBadge } from '../social-proof-badge'
import { SendGiftFlow } from './send-gift-flow'
import { CreateGroupOrderFlow } from './create-group-order-flow'

// ════════════════════════════════════════════════════════════════════════════
//  TYPES — additive shapes that 2C may return via /api/restaurants/[id] +
//  /api/restaurants/[id]/menu. All fields optional so the screen degrades
//  gracefully when the API hasn't been extended yet.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Restaurant shape extended with the additive fields Task 2C is wiring into
 * GET /api/restaurants/[id]. Every new field is optional — the screen renders
 * a sensible baseline with just the Wave 1 Restaurant shape.
 */
export interface RestaurantDetail extends Restaurant {
  /** Distance (km) from user's current location, if known. */
  distanceKm?: number
  /** Reward multiplier for this restaurant (e.g., 2 = "2× pts"). Default 1. */
  rewardMultiplier?: number
  /** Active deals — Task 2C shape: `{ title, description }`. Falls back to
   *  legacy `string[]` shape if a future/older backend returns labels only. */
  deals?: Array<string | { title: string; description?: string }>
  /** Top-N items tagged as "popular" by the backend (Task 2C returns full
   *  MenuItem-shaped objects). Falls back to ID strings if backend changes. */
  popularItems?: Array<MenuItem | string>
  /** Campuses linked via RestaurantCampus junction (Task 2C shape:
   *  `{ id, name, isPrimary? }`). Falls back to plain strings. */
  campuses?: Array<string | { id: string; name: string; isPrimary?: boolean }>
  /** Open/closed state. If absent, we treat the restaurant as open. */
  isOpen?: boolean
}

/**
 * Menu payload from GET /api/restaurants/[id]/menu. The legacy response returns
 * a flat `items[]` array; the Wave 1 grouped object is preserved here too so
 * the screen renders identically whether the backend returns `grouped` (Task
 * 2C additively includes it) or only `items` (we group locally).
 */
interface MenuResponse {
  items?: MenuItem[]
  grouped?: Record<string, MenuItem[]>
  /** Optional flat list of popular MenuItems (Task 2C additively includes). */
  popularItems?: MenuItem[]
  /** Optional per-restaurant reward multiplier override. */
  rewardMultiplier?: number
}

interface RestaurantResponse {
  restaurant?: RestaurantDetail
  error?: unknown
}

interface RestaurantDetailScreenProps {
  /** ID of the restaurant to render. */
  restaurantId: string
  /** Tap the back button (top-left) or "back to restaurants" CTA. */
  onBack: () => void
  /** Tap "Proceed to Checkout" on the cart bar. */
  onCheckout: () => void
}

// ════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

/** Distance (px) the user must drag down at the top of the scroll container
 *  to trigger a pull-to-refresh. Below this we just snap back. */
const PULL_REFRESH_THRESHOLD = 70

/** Height of the sticky categories tab bar (px) — used as scroll-mt offset
 *  so anchored sections don't hide their header behind the bar. */
const STICKY_TAB_BAR_HEIGHT = 56

/** Maximum number of popular items to render in the carousel. */
const MAX_POPULAR_ITEMS = 3

// ════════════════════════════════════════════════════════════════════════════
//  RestaurantDetailScreen — main export
// ════════════════════════════════════════════════════════════════════════════

export function RestaurantDetailScreen({
  restaurantId,
  onBack,
  onCheckout,
}: RestaurantDetailScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()
  const cart = useCart()

  // ─── State ────────────────────────────────────────────────────────────────
  const [restaurant, setRestaurant] = React.useState<RestaurantDetail | null>(null)
  const [menuItems, setMenuItems] = React.useState<MenuItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  // ─── Confirm-switch dialog state ─────────────────────────────────────────
  const [pendingAdd, setPendingAdd] = React.useState<MenuItem | null>(null)

  // ─── Task 6D — Gift-this-item flow state ─────────────────────────────────
  // When set, opens the SendGiftFlow modal with the menu item + restaurant
  // preselected. Cleared on close.
  const [giftItem, setGiftItem] = React.useState<{
    menuItemId: string
    restaurantId: string
  } | null>(null)

  // ─── Task 7B — Start-group-order flow state ────────────────────────────
  // When true, opens the CreateGroupOrderFlow modal with this restaurant
  // preselected (so step 1 is skipped — the user lands on the name step).
  const [startGroupOpen, setStartGroupOpen] = React.useState(false)

  // ─── Active category for sticky tab highlight ────────────────────────────
  const [activeCategory, setActiveCategory] = React.useState<string>('')

  // ─── Pull-to-refresh state ────────────────────────────────────────────────
  const [pullDistance, setPullDistance] = React.useState(0)
  const touchStartY = React.useRef<number | null>(null)
  const isPulling = React.useRef(false)

  // ─── Refs for anchored scroll-to-category ─────────────────────────────────
  const sectionRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)

  // ─── Derived data ──────────────────────────────────────────────────────────
  const groupedMenu = React.useMemo(() => groupByCategory(menuItems), [menuItems])
  const categories = React.useMemo(() => Object.keys(groupedMenu), [groupedMenu])

  const rewardMultiplier =
    restaurant?.rewardMultiplier && restaurant.rewardMultiplier > 1
      ? restaurant.rewardMultiplier
      : undefined

  // Resolve "popular items" — the Task 2C API returns popularItems as full
  // MenuItem objects on the RESTAURANT payload (top-3 by category/name). The
  // legacy menu endpoint doesn't include them, so we read from
  // `restaurant.popularItems`. Strings in the array (older shape) are matched
  // against menuItems by ID.
  const popularResolved = React.useMemo(() => {
    if (!restaurant?.popularItems?.length) return []
    const out: MenuItem[] = []
    for (const p of restaurant.popularItems) {
      if (typeof p === 'string') {
        const matched = menuItems.find((m) => m.id === p)
        if (matched) out.push(matched)
      } else {
        // Object-shape popular item — verify it's still on the menu so the
        // cart integration has a real MenuItem to add.
        const matched = menuItems.find((m) => m.id === p.id)
        out.push(matched ?? p)
      }
      if (out.length >= MAX_POPULAR_ITEMS) break
    }
    return out
  }, [restaurant?.popularItems, menuItems])

  // ─── Data fetching ────────────────────────────────────────────────────────
  const loadAll = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false
      if (!silent) {
        setLoading(true)
        setError(null)
      } else {
        setRefreshing(true)
      }
      try {
        const [rRes, mRes] = await Promise.all([
          fetch(`/api/restaurants/${restaurantId}`, { cache: 'no-store' }),
          fetch(`/api/restaurants/${restaurantId}/menu`, { cache: 'no-store' }),
        ])
        if (!rRes.ok) {
          throw new Error(`Couldn't load this restaurant (${rRes.status})`)
        }
        const rJson = (await rRes.json().catch(() => ({}))) as RestaurantResponse
        const mJson = (await mRes.json().catch(() => ({}))) as MenuResponse

        if (!rJson.restaurant) {
          throw new Error('This restaurant could not be found.')
        }
        setRestaurant(rJson.restaurant as RestaurantDetail)

        // The Task 2C menu endpoint returns a flat `items[]` array — we group
        // it locally to preserve category order (alphabetical by category,
        // then by name within each category, matching the SQL ORDER BY).
        const items = mJson.items ?? []
        setMenuItems(items)

        // Seed the active category as the first one alphabetically.
        const firstCat = Object.keys(groupByCategory(items))[0]
        if (firstCat) setActiveCategory(firstCat)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Something went wrong.'
        setError(msg)
        if (silent) {
          // Surface silent failures via toast so the user knows the refresh
          // didn't work even though their previous data is still visible.
          toast({
            title: 'Refresh failed',
            description: msg,
            variant: 'destructive',
          })
        }
      } finally {
        if (!silent) setLoading(false)
        else setRefreshing(false)
        setPullDistance(0)
        isPulling.current = false
      }
    },
    [restaurantId, toast],
  )

  // Initial load + reload when restaurantId changes.
  React.useEffect(() => {
    loadAll()
  }, [loadAll])

  // ─── Cart helpers ──────────────────────────────────────────────────────────
  const handleAdd = React.useCallback(
    (item: MenuItem) => {
      if (!restaurant) return
      // Cart already has items from a DIFFERENT restaurant → confirm first.
      if (
        cart.restaurantId &&
        cart.restaurantId !== restaurant.id &&
        cart.count() > 0
      ) {
        setPendingAdd(item)
        return
      }
      cart.add(item, restaurant.id, restaurant.name)
      toast({
        title: 'Added to cart',
        description: `${item.name} · ${inr(item.price)}`,
      })
    },
    [restaurant, cart, toast],
  )

  const handleIncrement = React.useCallback(
    (item: MenuItem) => {
      if (!restaurant) return
      // Switch-restaurant safety — same guard as handleAdd. In practice this
      // branch rarely fires (you can't increment an item not in the cart), but
      // we keep it for robustness.
      if (
        cart.restaurantId &&
        cart.restaurantId !== restaurant.id &&
        cart.count() > 0
      ) {
        setPendingAdd(item)
        return
      }
      cart.add(item, restaurant.id, restaurant.name)
    },
    [restaurant, cart],
  )

  const handleDecrement = React.useCallback(
    (item: MenuItem) => {
      cart.decrement(item.id)
    },
    [cart],
  )

  // Confirmed switch — clear cart and add the pending item to the new
  // restaurant's cart.
  const confirmSwitchAndAdd = React.useCallback(() => {
    if (!pendingAdd || !restaurant) return
    cart.clear()
    cart.add(pendingAdd, restaurant.id, restaurant.name)
    toast({
      title: 'Started a new order',
      description: `${pendingAdd.name} added from ${restaurant.name}.`,
    })
    setPendingAdd(null)
  }, [pendingAdd, restaurant, cart, toast])

  const cancelSwitch = React.useCallback(() => {
    setPendingAdd(null)
  }, [])

  // ─── Anchor-scroll to a category ──────────────────────────────────────────
  const scrollToCategory = React.useCallback((category: string) => {
    const el = sectionRefs.current.get(category)
    if (!el) return
    setActiveCategory(category)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ─── Active-category tracking via IntersectionObserver ───────────────────
  React.useEffect(() => {
    if (categories.length === 0 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost intersecting section whose top is closest to the
        // sticky tab bar's bottom edge — that's the section currently "in view".
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          const id = visible[0].target.getAttribute('data-category')
          if (id) setActiveCategory(id)
        }
      },
      {
        // Trigger when a section's top edge enters the band just below the
        // sticky tab bar (so the highlight updates as the user scrolls).
        rootMargin: `-${STICKY_TAB_BAR_HEIGHT + 16}px 0px -60% 0px`,
        threshold: 0,
      },
    )
    sectionRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [categories])

  // ─── Pull-to-refresh touch handlers ────────────────────────────────────────
  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    if (scroller.scrollTop <= 0) {
      touchStartY.current = e.touches[0]?.clientY ?? null
      isPulling.current = true
    } else {
      touchStartY.current = null
      isPulling.current = false
    }
  }, [])

  const onTouchMove = React.useCallback(
    (e: React.TouchEvent) => {
      if (!isPulling.current || touchStartY.current == null) return
      const scroller = scrollContainerRef.current
      if (!scroller || scroller.scrollTop > 0) {
        isPulling.current = false
        setPullDistance(0)
        return
      }
      const dy = (e.touches[0]?.clientY ?? 0) - touchStartY.current
      // Only positive deltas (pulling DOWN) count. Apply a rubber-band factor
      // so the indicator doesn't feel like it tracks 1:1 with the finger.
      if (dy > 0) {
        const eased = Math.min(PULL_REFRESH_THRESHOLD * 1.5, dy * 0.5)
        setPullDistance(eased)
      } else {
        setPullDistance(0)
      }
    },
    [],
  )

  const onTouchEnd = React.useCallback(() => {
    if (!isPulling.current) return
    if (pullDistance >= PULL_REFRESH_THRESHOLD) {
      loadAll({ silent: true })
    } else {
      setPullDistance(0)
    }
    isPulling.current = false
    touchStartY.current = null
  }, [pullDistance, loadAll])

  // ─── Derived display values ────────────────────────────────────────────────
  const cartTotal = cart.total()
  const cartCount = cart.count()
  const showCartBar = cartCount > 0 && !!restaurant && cart.restaurantId === restaurant.id

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════════

  // ─── Error state ────────────────────────────────────────────────────────────
  if (error && !restaurant) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Button variant="ghost" size="sm" className="mb-4" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to restaurants
        </Button>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">Couldn&apos;t load this restaurant</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <Button onClick={() => loadAll()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Loading state (skeletons + shimmer hero) ──────────────────────────────
  if (loading && !restaurant) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <RestaurantDetailSkeleton />
      </div>
    )
  }

  // ─── Restaurant not found (after fetch) ────────────────────────────────────
  if (!restaurant) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Button variant="ghost" size="sm" className="mb-4" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to restaurants
        </Button>
        <EmptyState
          variant="no-restaurants"
          title="Restaurant not found"
          description="This restaurant may have been removed or is no longer accepting orders."
          actionLabel="Back to restaurants"
          onAction={onBack}
        />
      </div>
    )
  }

  const isOpen = restaurant.isOpen ?? true
  // Normalise deals — Task 2C returns `{ title, description }` objects;
  // legacy shape is a bare string. We render both as DealBadge cards.
  const deals = (restaurant.deals ?? []).map((d, idx) => ({
    id: idx,
    label: typeof d === 'string' ? d : d.title,
    description: typeof d === 'string' ? undefined : d.description,
  }))
  // Normalise campuses — Task 2C returns `{ id, name, isPrimary }` objects;
  // legacy shape is a bare string. We render both as CampusBadge chips.
  const campusNames = (restaurant.campuses ?? []).map((c) =>
    typeof c === 'string' ? c : c.name,
  )
  const showRewardBanner = !!rewardMultiplier && rewardMultiplier > 1

  // Pickup estimate — use restaurant.prepTimeMins as the baseline.
  const pickupMinutes = restaurant.prepTimeMins

  return (
    <div
      ref={scrollContainerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="relative mx-auto max-w-2xl pb-40"
    >
      {/* ══════════════════════════════════════════════════════════════════════
          HERO HEADER
         ══════════════════════════════════════════════════════════════════════ */}
      <section
        className="relative -mx-4 -mt-6 h-56 w-[calc(100%+2rem)] overflow-hidden sm:h-64"
        aria-label={`${restaurant.name} header`}
      >
        {/* Hero image with cuisine gradient fallback */}
        {restaurant.image ? (
          <img
            src={restaurant.image}
            alt={restaurant.name}
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center bg-gradient-to-br',
              cuisineGradient(restaurant.cuisine),
            )}
            aria-hidden="true"
          >
            <CuisineIcon cuisine={restaurant.cuisine} className="text-6xl opacity-90" />
          </div>
        )}

        {/* Gradient scrim for legibility of overlay text */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />

        {/* Floating top-left back button */}
        <button
          type="button"
          aria-label="Back to restaurants"
          onClick={onBack}
          className="snak-focus-ring absolute left-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur-md transition hover:bg-background"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Floating top-right heart/share — placeholders */}
        <div className="absolute right-3 top-3 z-20 flex gap-2">
          <button
            type="button"
            aria-label="Save restaurant to favourites"
            onClick={() =>
              toast({ title: 'Saved!', description: 'Favourites are coming soon.' })
            }
            className="snak-focus-ring flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur-md transition hover:bg-background"
          >
            <Heart className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Share this restaurant"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.share) {
                navigator
                  .share({ title: restaurant.name, text: `Order from ${restaurant.name} on SnakZap` })
                  .catch(() => undefined)
              } else {
                toast({ title: 'Link copied', description: 'Share link ready to paste.' })
              }
            }}
            className="snak-focus-ring flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur-md transition hover:bg-background"
          >
            <Share2 className="h-5 w-5" />
          </button>
        </div>

        {/* Open/closed pill (top-right of the body area) */}
        <div className="absolute right-3 top-16 z-10">
          <OpenClosedBadge isOpen={isOpen} />
        </div>

        {/* Hero body — name + cuisine + rating + prep time + address + distance */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-4 text-white">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="bg-white/20 text-white backdrop-blur-md"
            >
              <CuisineIcon cuisine={restaurant.cuisine} className="mr-1" />
              {restaurant.cuisine}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold drop-shadow-md sm:text-3xl">
            {restaurant.name}
          </h1>
          {restaurant.description && (
            <p className="mt-1 line-clamp-1 text-sm text-white/85">
              {restaurant.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span className="font-mono tabular-nums">{restaurant.rating.toFixed(1)}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-mono tabular-nums">{restaurant.prepTimeMins} min</span>
            </span>
            {typeof restaurant.distanceKm === 'number' && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono tabular-nums">{restaurant.distanceKm.toFixed(1)} km</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-white/85">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="line-clamp-1">{restaurant.address}</span>
            </span>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          PULL-TO-REFRESH INDICATOR
         ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {pullDistance > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2"
            style={{ height: pullDistance }}
            aria-hidden="true"
          >
            <div className="flex flex-col items-center justify-center gap-1">
              <motion.div
                animate={{ rotate: refreshing ? 360 : 0 }}
                transition={
                  refreshing
                    ? { repeat: Infinity, duration: 0.9, ease: 'linear' }
                    : { duration: 0.2 }
                }
              >
                <RefreshCw className="h-5 w-5 text-primary" />
              </motion.div>
              <span className="text-[11px] font-medium text-muted-foreground">
                {pullDistance >= PULL_REFRESH_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════════
          PICKUP ESTIMATE BAR
         ══════════════════════════════════════════════════════════════════════ */}
      <section className="-mx-4 mb-3 border-y border-border bg-card px-4 py-2.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
            Pickup in ~<span className="font-mono tabular-nums">{pickupMinutes}</span> min
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Order ahead to skip the line
          </span>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          Task 7B — Start Group Order Here (rose CTA, per DESIGN_SYSTEM §5.8.7)
          Sits directly below the prep time bar so the user sees it as a
          peer action to "Order ahead" above. Tapping opens the
          CreateGroupOrderFlow with this restaurant preselected (skips the
          restaurant-picker step).
         ══════════════════════════════════════════════════════════════════════ */}
      {restaurant && (
        <section className="mb-3" aria-label="Start group order">
          <button
            type="button"
            onClick={() => setStartGroupOpen(true)}
            className="snak-focus-ring flex w-full items-center gap-3 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-3 text-left transition hover:border-rose-300 hover:from-rose-100 dark:border-rose-900/50 dark:from-rose-950/30 dark:to-pink-950/20 dark:hover:border-rose-800"
            aria-label={`Start a group order at ${restaurant.name}`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white">
              <Users className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Start Group Order Here</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Friends join, add their items — you confirm + pay.
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          </button>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DEALS CAROUSEL
         ══════════════════════════════════════════════════════════════════════ */}
      {deals.length > 0 && (
        <section className="mb-3" aria-label="Active deals">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Deals
          </h2>
          <div
            className="snak-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
            role="list"
          >
            {deals.map((deal) => (
              <div
                key={deal.id}
                role="listitem"
                className="snak-card flex min-w-[200px] flex-col gap-2 p-3"
              >
                <DealBadge label={deal.label} />
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {deal.description ?? 'Tap an item to apply this deal at checkout.'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          REWARD MULTIPLIER BANNER
         ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showRewardBanner && (
          <motion.section
            initial={prefersReduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3, ease: [0.3, 0, 0, 1] }}
            className="mb-3"
            aria-label="Reward multiplier"
          >
            <div className="snak-gradient-reward flex items-center gap-3 rounded-2xl p-3 text-reward-foreground">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/30">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  Earn {rewardMultiplier}× reward points on every order!
                </p>
                <p className="text-xs text-reward-foreground/80">
                  Limited-time multiplier active at {restaurant.name}.
                </p>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════════
          CAMPUS BADGES
         ══════════════════════════════════════════════════════════════════════ */}
      {campusNames.length > 0 && (
        <section className="mb-3" aria-label="Available on campuses">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="snak-scroll flex flex-1 gap-2 overflow-x-auto">
              {campusNames.map((name) => (
                <CampusBadge key={name} name={name} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          S5H1: FRIENDS ORDERED HERE (social proof — above popular items)
         ══════════════════════════════════════════════════════════════════════ */}
      <SocialProofBadge restaurantId={restaurant.id} />

      {/* ══════════════════════════════════════════════════════════════════════
          POPULAR ITEMS CAROUSEL (above the categories bar for visibility)
         ══════════════════════════════════════════════════════════════════════ */}
      {popularResolved.length > 0 && (
        <section className="mb-4" aria-label="Popular items">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
              Popular picks
            </h2>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <div
            className="snak-scroll -mx-4 flex gap-3 overflow-x-auto px-4 pb-1"
            role="list"
          >
            {popularResolved.map((item) => (
              <PopularItemCard
                key={item.id}
                item={item}
                rewardMultiplier={rewardMultiplier ?? 1}
                onAdd={handleAdd}
                onIncrement={handleIncrement}
                onDecrement={handleDecrement}
                quantity={
                  cart.lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          STICKY CATEGORIES TAB BAR
         ══════════════════════════════════════════════════════════════════════ */}
      {categories.length > 0 && (
        <div
          className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 backdrop-blur-md"
          style={{ height: STICKY_TAB_BAR_HEIGHT }}
        >
          <div
            role="tablist"
            aria-label="Menu categories"
            className="snak-scroll flex h-full items-center gap-2 overflow-x-auto"
          >
            {categories.map((cat) => {
              const isActive = activeCategory === cat
              return (
                <button
                  key={cat}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-controls={`category-section-${slugify(cat)}`}
                  onClick={() => scrollToCategory(cat)}
                  className={cn(
                    'snak-focus-ring relative shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70',
                  )}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MENU GROUPED BY CATEGORY
         ══════════════════════════════════════════════════════════════════════ */}
      {loading && menuItems.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Loading menu">
          <span className="sr-only">Loading menu items…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <MenuItemSkeleton key={i} />
          ))}
        </div>
      ) : menuItems.length === 0 ? (
        <EmptyState
          variant="no-restaurants"
          title="No items on the menu yet"
          description="This restaurant hasn't added any items. Try another spot."
          actionLabel="Back to restaurants"
          onAction={onBack}
        />
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => {
            const items = groupedMenu[cat] ?? []
            return (
              <section
                key={cat}
                id={`category-section-${slugify(cat)}`}
                data-category={cat}
                aria-label={cat}
                ref={(el) => {
                  if (el) sectionRefs.current.set(cat, el)
                  else sectionRefs.current.delete(cat)
                }}
                style={{ scrollMarginTop: STICKY_TAB_BAR_HEIGHT + 8 }}
              >
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {cat}
                  <span className="ml-2 text-xs font-normal text-muted-foreground/70">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                  </span>
                </h3>
                <div className="space-y-1.5">
                  {items.map((item) => {
                    const qty =
                      cart.lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0
                    return (
                      <div key={item.id} className="relative">
                        <MenuItemCardV2
                          item={item}
                          quantity={qty}
                          rewardMultiplier={rewardMultiplier ?? 1}
                          onAdd={handleAdd}
                          onIncrement={handleIncrement}
                          onDecrement={handleDecrement}
                        />
                        {/* Task 6D — "Gift this" button (violet) overlaid at the
                            top-right of the menu item card. Sits next to the Add
                            button which is at the right edge, vertically centered.
                            Hidden when the item is sold out (gift can't be sent
                            for an unavailable item). */}
                        {item.isAvailable && (
                          <button
                            type="button"
                            aria-label={`Gift ${item.name} to a friend`}
                            title="Gift this to a friend"
                            onClick={(e) => {
                              e.stopPropagation()
                              setGiftItem({
                                menuItemId: item.id,
                                restaurantId: restaurant.id,
                              })
                            }}
                            className="snak-focus-ring absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-violet-300 bg-background/95 text-violet-600 shadow-sm backdrop-blur transition-colors hover:bg-violet-50 hover:text-violet-700 dark:border-violet-800 dark:bg-violet-950/80 dark:text-violet-300 dark:hover:bg-violet-900/60"
                          >
                            <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          REVIEWS PLACEHOLDER
         ══════════════════════════════════════════════════════════════════════ */}
      <section className="mt-8" aria-label="Reviews">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Star className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">Reviews coming soon</p>
              <p className="mt-1 text-sm text-muted-foreground">
                We&apos;re rolling out dish + restaurant reviews shortly.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast({
                  title: 'Thanks for the interest!',
                  description: 'Review submission opens in a future release.',
                })
              }
            >
              <MessageSquarePlus className="mr-1 h-4 w-4" />
              Write a review
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          STICKY CART BAR — slides up from the bottom (AnimatePresence)
         ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showCartBar && (
          <motion.div
            initial={prefersReduced ? false : { y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { y: 120, opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 26,
              mass: 1,
            }}
            className="snak-pad-bottom-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-md"
          >
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {cartCount}
                </span>
                <div className="leading-tight">
                  <p className="text-xs text-muted-foreground">
                    {cart.restaurantName}
                  </p>
                  <p className="font-semibold font-mono tabular-nums">
                    {inr(cartTotal)}
                  </p>
                </div>
              </div>
              <Button onClick={onCheckout} className="gap-1.5">
                <ShoppingCart className="h-4 w-4" />
                Proceed to Checkout
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════════════════════════
          SWITCH-RESTAURANT CONFIRM DIALOG
         ══════════════════════════════════════════════════════════════════════ */}
      <AlertDialog
        open={pendingAdd !== null}
        onOpenChange={(open) => {
          if (!open) cancelSwitch()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new order?</AlertDialogTitle>
            <AlertDialogDescription>
              Your cart already has items from{' '}
              <span className="font-medium text-foreground">
                {cart.restaurantName ?? 'another restaurant'}
              </span>
              . Adding from{' '}
              <span className="font-medium text-foreground">{restaurant.name}</span>{' '}
              will clear your current cart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelSwitch}>Keep current cart</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSwitchAndAdd}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Clear &amp; start new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ══════════════════════════════════════════════════════════════════════
          Task 6D — Send-gift flow (opened by the "Gift this" icon button on
          each menu item card). Preselected with the tapped item + restaurant.
         ══════════════════════════════════════════════════════════════════════ */}
      <SendGiftFlow
        open={!!giftItem}
        onClose={() => setGiftItem(null)}
        preselectedMenuItemId={giftItem?.menuItemId}
        preselectedRestaurantId={giftItem?.restaurantId}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          Task 7B — Create-group-order flow (opened by the "Start Group Order
          Here" button above the deals carousel). Preselected with this
          restaurant so step 1 is skipped — the user lands on the name step.
          On success, calls onCreated(groupOrderId, shareCode) + closes.
         ══════════════════════════════════════════════════════════════════════ */}
      <CreateGroupOrderFlow
        open={startGroupOpen}
        onClose={() => setStartGroupOpen(false)}
        preselectedRestaurantId={restaurant?.id}
        onCreated={(_id, _shareCode) => {
          setStartGroupOpen(false)
          // The success screen inside CreateGroupOrderFlow already shows the
          // share code + copy link. The actual navigation to the
          // GroupOrderScreen overlay is owned by Task 3A's ConsumerView.
        }}
      />
    </div>
  )
}

export default RestaurantDetailScreen

// ════════════════════════════════════════════════════════════════════════════
//  PopularItemCard — compact horizontal card variant for the popular items
//  carousel. Reuses MenuItemCardV2's add/stepper logic but in a narrower,
//  vertically-stacked "card" layout suited to horizontal carousels.
// ════════════════════════════════════════════════════════════════════════════

interface PopularItemCardProps {
  item: MenuItem
  quantity: number
  rewardMultiplier?: number
  onAdd?: (item: MenuItem) => void
  onIncrement?: (item: MenuItem) => void
  onDecrement?: (item: MenuItem) => void
}

function PopularItemCard({
  item,
  quantity,
  rewardMultiplier = 1,
  onAdd,
  onIncrement,
  onDecrement,
}: PopularItemCardProps) {
  const prefersReduced = useReducedMotion()
  const isSoldOut = !item.isAvailable
  const hasQty = quantity > 0

  return (
    <div
      role="listitem"
      className={cn(
        'snak-card relative flex w-[220px] shrink-0 flex-col overflow-hidden p-0',
        isSoldOut && 'opacity-60',
      )}
    >
      {/* Image with veg + spice overlays */}
      <div className="relative h-28 w-full overflow-hidden bg-muted">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className={cn('h-full w-full object-cover', isSoldOut && 'grayscale')}
            loading="lazy"
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center bg-gradient-to-br text-2xl',
              cuisineGradient('Default'),
            )}
            aria-hidden="true"
          >
            🍽
          </div>
        )}
        <div className="absolute left-1.5 top-1.5 rounded bg-background/85 p-0.5 backdrop-blur-sm">
          {/* Inline veg badge — kept small to match MenuItemCardV2 */}
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-sm ${item.isVeg ? 'veg-dot' : 'nonveg-dot'}`}
            aria-label={item.isVeg ? 'Vegetarian' : 'Non-vegetarian'}
          >
            <span className={`h-2 w-2 rounded-full ${item.isVeg ? 'bg-emerald-600' : 'bg-red-600'}`} />
          </span>
        </div>
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Sold out
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h4 className="line-clamp-1 text-sm font-semibold text-foreground">{item.name}</h4>
        {item.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-sm font-semibold text-foreground">
              {inr(item.price)}
            </span>
            {!isSoldOut && (
              <RewardBadge>+{pointsFor(item.price, rewardMultiplier)}</RewardBadge>
            )}
          </div>
          {!isSoldOut && (
            <AnimatePresence mode="wait" initial={false}>
              {hasQty ? (
                <motion.div
                  key="stepper"
                  initial={prefersReduced ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: 'spring', stiffness: 180, damping: 14, mass: 1 }}
                  className="flex items-center gap-1 rounded-full bg-primary px-1.5 py-1 text-primary-foreground"
                  role="group"
                  aria-label={`Quantity ${quantity}`}
                >
                  <button
                    type="button"
                    aria-label={`Decrease ${item.name} quantity`}
                    onClick={() => onDecrement?.(item)}
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-primary-foreground/15"
                  >
                    <span className="text-lg leading-none" aria-hidden="true">−</span>
                  </button>
                  <span className="min-w-[20px] text-center font-mono text-sm font-bold tabular-nums">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${item.name} quantity`}
                    onClick={() => onIncrement?.(item)}
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-primary-foreground/15"
                  >
                    <span className="text-lg leading-none" aria-hidden="true">+</span>
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  key="add"
                  type="button"
                  aria-label={`Add ${item.name} to cart`}
                  onClick={() => onAdd?.(item)}
                  initial={prefersReduced ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                  transition={{ type: 'spring', stiffness: 180, damping: 14, mass: 1 }}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary bg-background text-primary transition-colors hover:bg-primary/10"
                >
                  <span className="text-xl leading-none" aria-hidden="true">+</span>
                </motion.button>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  RestaurantDetailSkeleton — shimmer hero + skeleton menu items
// ════════════════════════════════════════════════════════════════════════════

function RestaurantDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading restaurant">
      <span className="sr-only">Loading restaurant…</span>
      {/* Shimmer hero */}
      <div className="snak-shimmer -mx-4 -mt-6 h-56 w-[calc(100%+2rem)] rounded-none sm:h-64" />
      {/* Pickup bar */}
      <div className="snak-shimmer -mx-4 my-3 h-10 w-[calc(100%+2rem)]" />
      {/* Categories bar */}
      <div className="snak-shimmer -mx-4 mb-4 h-14 w-[calc(100%+2rem)]" />
      {/* Menu items */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <MenuItemSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════════════════

function groupByCategory(items: MenuItem[]): Record<string, MenuItem[]> {
  const g: Record<string, MenuItem[]> = {}
  for (const it of items) {
    if (!g[it.category]) g[it.category] = []
    g[it.category].push(it)
  }
  return g
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Reward points earned for an item price (in paise) at a given multiplier. */
function pointsFor(pricePaise: number, multiplier: number): number {
  const rupees = pricePaise / 100
  return Math.round(rupees * 0.1 * multiplier)
}
