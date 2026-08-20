'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Search,
  X,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Star,
  Tag,
  DoorOpen,
  Leaf,
  MapPin,
  AlertCircle,
  ArrowUpDown,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useCampus } from '@/lib/campus-store'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { RestaurantCardV2 } from '../restaurant-card-v2'
import { EmptyState } from '../empty-state'
import { RestaurantCardSkeleton } from '../skeleton-loader'
import type { Restaurant } from '@/lib/types'

// ════════════════════════════════════════════════════════════════════════════
//  ExploreScreen — Wave 2 Task 2C
//
//  Implements blueprint §10 RESTAURANT DISCOVERY with the full filter set:
//  - Search bar (debounced 250ms) by name / cuisine / description (server-side)
//  - Toggle chips: Open Now / Veg Only / Offers / Rating ≥ 4.0 / Campus
//  - Cuisine multi-select (bottom sheet) — populated from results' cuisines
//  - Price range: Under ₹200 / ₹200–400 / ₹400+ (based on priceForTwo)
//  - Sort: Recommended (default) / Rating / Prep Time / Price Low→High
//  - Active filter chips bar with × remove + "Clear all"
//  - Loading: RestaurantCardSkeleton grid
//  - Empty: EmptyState "no-restaurants" variant
//  - Error: inline retry card
//  - Pull-to-refresh (touch-based, mobile) + Refresh button (desktop fallback)
//  - "Load more" button (simpler than infinite scroll for MVP — opt per spec)
//
//  Server-side filters (q, veg, campusId) drive the fetch. The remaining
//  filters (openNow, offers, rating, cuisines, priceRange, sort) are applied
//  client-side post-fetch so the user sees instant feedback without re-fetching.
//
//  Governance: Task 2C owns this file. consumer-view.tsx + restaurant-detail-
//  screen.tsx (2D) are untouched — the parent wires onSelectRestaurant.
// ════════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
//  Types — local additive shapes (not in shared types.ts to avoid governance
//  boundary violation). Mirror the additive fields the API now returns.
// ---------------------------------------------------------------------------

/** Restaurant list item shape returned by /api/restaurants (Wave 2C additive). */
interface RestaurantListItem extends Restaurant {
  /** Reward multiplier (default 1.0). Wave 2C additive. */
  rewardMultiplier: number
  /** Open/closed state — always true for MVP (no hours model). */
  isOpen: boolean
  /** Derived deal label ("Great value") or null. Wave 2C additive. */
  deal: string | null
}

// ---------------------------------------------------------------------------
//  Filter config — declarative chip definitions
// ---------------------------------------------------------------------------

type ToggleKey = 'openNow' | 'vegOnly' | 'offers' | 'ratingGte4' | 'useCampus'
type PriceRange = 'any' | 'under200' | '200to400' | 'over400'
type SortKey = 'recommended' | 'rating' | 'prepTime' | 'priceLowHigh'

interface ToggleChipConfig {
  key: ToggleKey
  label: string
  Icon: typeof Star
  /** Helper to read the active state from the filter state object. */
  isActive: (s: FilterState) => boolean
}

const TOGGLE_CHIPS: ToggleChipConfig[] = [
  {
    key: 'openNow',
    label: 'Open Now',
    Icon: DoorOpen,
    isActive: (s) => s.openNow,
  },
  {
    key: 'vegOnly',
    label: 'Veg Only',
    Icon: Leaf,
    isActive: (s) => s.vegOnly,
  },
  {
    key: 'offers',
    label: 'Offers',
    Icon: Tag,
    isActive: (s) => s.offers,
  },
  {
    key: 'ratingGte4',
    label: 'Rating ≥ 4.0',
    Icon: Star,
    isActive: (s) => s.ratingGte4,
  },
  {
    key: 'useCampus',
    label: 'My Campus',
    Icon: MapPin,
    isActive: (s) => s.useCampus,
  },
]

const PRICE_RANGES: { value: PriceRange; label: string; chip: string }[] = [
  { value: 'any', label: 'Any price', chip: '' },
  { value: 'under200', label: 'Under ₹200', chip: 'Under ₹200' },
  { value: '200to400', label: '₹200 – ₹400', chip: '₹200–400' },
  { value: 'over400', label: '₹400+', chip: '₹400+' },
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Rating' },
  { value: 'prepTime', label: 'Prep Time' },
  { value: 'priceLowHigh', label: 'Price: Low → High' },
]

interface FilterState {
  openNow: boolean
  vegOnly: boolean
  offers: boolean
  ratingGte4: boolean
  useCampus: boolean
  cuisines: string[]
  priceRange: PriceRange
  sort: SortKey
}

const DEFAULT_FILTERS: FilterState = {
  openNow: false,
  vegOnly: false,
  offers: false,
  ratingGte4: false,
  useCampus: false,
  cuisines: [],
  priceRange: 'any',
  sort: 'recommended',
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 250
const PAGE_SIZE = 6
const GREAT_VALUE_THRESHOLD_PAISE = 30000
const RATING_FLOOR = 4.0

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

/** Single toggle filter chip — pill shape, filled when active. */
function FilterChip({
  label,
  Icon,
  active,
  onClick,
  disabled,
}: {
  label: string
  Icon: typeof Star
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.12 }}
      className={cn(
        'snak-focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors',
        'whitespace-nowrap select-none',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/70',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label}</span>
    </motion.button>
  )
}

/** Active filter chip with an × remove button — rendered in the active filter bar. */
function ActiveFilterChip({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <Badge
      variant="secondary"
      className="gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs"
    >
      <span className="max-w-[140px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="snak-focus-ring -mr-1 ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-secondary-foreground/15"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </Badge>
  )
}

/**
 * Trigger button for a bottom-sheet dropdown (cuisines / price / sort).
 * Shows the active selection label and a chevron icon.
 */
function SheetTriggerButton({
  label,
  value,
  active,
  Icon,
  onClick,
  badgeCount,
}: {
  label: string
  value: string
  active: boolean
  Icon: typeof Star
  onClick: () => void
  badgeCount?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={active}
      className={cn(
        'snak-focus-ring inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border bg-background text-foreground hover:bg-accent',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="max-w-[120px] truncate font-semibold">{value}</span>
      {typeof badgeCount === 'number' && badgeCount > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          aria-label={`${badgeCount} selected`}
        >
          {badgeCount}
        </span>
      )}
      <ChevronDown
        className={cn('h-3 w-3 transition-transform', active && 'rotate-180')}
        aria-hidden="true"
      />
    </button>
  )
}

/** Error card with retry — shown when fetch fails. */
function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="mx-auto max-w-md border-destructive/30 bg-destructive/5">
      <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            Couldn’t load restaurants
          </p>
          <p className="text-xs text-muted-foreground">
            Something went wrong. Please try again.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="snak-focus-ring"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
//  Sheet config (defined outside the component so the JSX stays clean)
// ---------------------------------------------------------------------------

type SheetKind = 'cuisines' | 'price' | 'sort' | null

// ---------------------------------------------------------------------------
//  Main component
// ---------------------------------------------------------------------------

export interface ExploreScreenProps {
  /** Called when a restaurant card is tapped. Parent handles navigation. */
  onSelectRestaurant: (id: string) => void
  /** Optional className override for the root wrapper. */
  className?: string
}

export function ExploreScreen({
  onSelectRestaurant,
  className,
}: ExploreScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()
  const selectedCampusId = useCampus((s) => s.selectedCampusId)
  const selectedCampusName = useCampus((s) => s.selectedCampusName)

  // --- State -----------------------------------------------------------------
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS)
  const [restaurants, setRestaurants] = React.useState<RestaurantListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
  const [refreshing, setRefreshing] = React.useState(false)
  const [openSheet, setOpenSheet] = React.useState<SheetKind>(null)
  // Working drafts inside sheets — applied on "Apply" or live-updated.
  const [draftCuisines, setDraftCuisines] = React.useState<string[]>([])
  const [draftPriceRange, setDraftPriceRange] =
    React.useState<PriceRange>('any')
  const [draftSort, setDraftSort] = React.useState<SortKey>('recommended')

  // Pull-to-refresh state (mobile only — touchstart/touchmove on the
  // scroll container).
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const pullStartY = React.useRef<number | null>(null)
  const [pullDistance, setPullDistance] = React.useState(0)
  const PULL_THRESHOLD = 70
  const PULL_MAX = 100

  // --- Debounce search (250ms per acceptance criteria) ----------------------
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // --- Reset visible count when filters / search change ----------------------
  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [debouncedSearch, filters])

  // --- Fetch (server-side filters: q + vegOnly + campusId) -------------------
  const fetchRef = React.useRef(0)
  const doFetch = React.useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const silent = opts.silent ?? false
      if (!silent) setLoading(true)
      setError(null)
      const myFetchId = ++fetchRef.current
      try {
        const params = new URLSearchParams()
        if (debouncedSearch) params.set('q', debouncedSearch)
        if (filters.vegOnly) params.set('veg', '1')
        if (filters.useCampus && selectedCampusId) {
          params.set('campusId', selectedCampusId)
        }
        const url = `/api/restaurants${params.size ? `?${params.toString()}` : ''}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = (await res.json().catch(() => ({}))) as {
          restaurants?: RestaurantListItem[]
          error?: string
        }
        // Stale-response guard — only commit if this fetch is the latest.
        if (myFetchId !== fetchRef.current) return
        if (data.restaurants) {
          setRestaurants(data.restaurants)
        } else {
          setRestaurants([])
          if (data.error) setError(data.error)
        }
      } catch (e) {
        if (myFetchId !== fetchRef.current) return
        setError(e instanceof Error ? e.message : 'Failed to fetch restaurants')
        setRestaurants([])
      } finally {
        if (myFetchId === fetchRef.current) {
          setLoading(false)
          setRefreshing(false)
          setPullDistance(0)
        }
      }
    },
    [debouncedSearch, filters.vegOnly, filters.useCampus, selectedCampusId],
  )

  // Trigger fetch whenever server-side inputs change.
  React.useEffect(() => {
    doFetch()
  }, [doFetch])

  // --- Derived: available cuisines (from currently loaded restaurants) ------
  const availableCuisines = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of restaurants) set.add(r.cuisine)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [restaurants])

  // --- Derived: client-side filtered + sorted results -----------------------
  const filteredRestaurants = React.useMemo(() => {
    let list = restaurants.slice()
    // openNow — always true for MVP (no hours model); kept for spec compliance.
    if (filters.openNow) {
      list = list.filter((r) => r.isOpen)
    }
    // offers — filter to restaurants with a non-null deal.
    if (filters.offers) {
      list = list.filter((r) => r.deal !== null && r.deal !== '')
    }
    // ratingGte4 — rating floor.
    if (filters.ratingGte4) {
      list = list.filter((r) => r.rating >= RATING_FLOOR)
    }
    // cuisines (multi-select) — must include all selected cuisines.
    if (filters.cuisines.length > 0) {
      const wanted = new Set(filters.cuisines)
      list = list.filter((r) => wanted.has(r.cuisine))
    }
    // priceRange — based on priceForTwo (paise).
    if (filters.priceRange !== 'any') {
      list = list.filter((r) => {
        const paise = r.priceForTwo
        if (filters.priceRange === 'under200') return paise < 20000
        if (filters.priceRange === '200to400')
          return paise >= 20000 && paise <= 40000
        if (filters.priceRange === 'over400') return paise > 40000
        return true
      })
    }
    // sort
    switch (filters.sort) {
      case 'rating':
        list.sort((a, b) => b.rating - a.rating)
        break
      case 'prepTime':
        list.sort((a, b) => a.prepTimeMins - b.prepTimeMins)
        break
      case 'priceLowHigh':
        list.sort((a, b) => a.priceForTwo - b.priceForTwo)
        break
      case 'recommended':
      default:
        // Default API order (rating desc) — preserve.
        break
    }
    return list
  }, [restaurants, filters])

  // Visible slice — "Load more" paginated.
  const visibleRestaurants = filteredRestaurants.slice(0, visibleCount)
  const hasMore = visibleCount < filteredRestaurants.length

  // --- Active filter chips (rendered above results) -------------------------
  const activeFilterChips: { label: string; onRemove: () => void }[] = React.useMemo(
    () => {
      const chips: { label: string; onRemove: () => void }[] = []
      if (filters.openNow) {
        chips.push({
          label: 'Open Now',
          onRemove: () => setFilters((f) => ({ ...f, openNow: false })),
        })
      }
      if (filters.vegOnly) {
        chips.push({
          label: 'Veg Only',
          onRemove: () => setFilters((f) => ({ ...f, vegOnly: false })),
        })
      }
      if (filters.offers) {
        chips.push({
          label: 'Offers',
          onRemove: () => setFilters((f) => ({ ...f, offers: false })),
        })
      }
      if (filters.ratingGte4) {
        chips.push({
          label: 'Rating ≥ 4.0',
          onRemove: () => setFilters((f) => ({ ...f, ratingGte4: false })),
        })
      }
      if (filters.useCampus && selectedCampusName) {
        chips.push({
          label: `Campus: ${selectedCampusName}`,
          onRemove: () => setFilters((f) => ({ ...f, useCampus: false })),
        })
      }
      for (const c of filters.cuisines) {
        chips.push({
          label: c,
          onRemove: () =>
            setFilters((f) => ({
              ...f,
              cuisines: f.cuisines.filter((x) => x !== c),
            })),
        })
      }
      if (filters.priceRange !== 'any') {
        const cfg = PRICE_RANGES.find((p) => p.value === filters.priceRange)
        if (cfg && cfg.chip) {
          chips.push({
            label: cfg.chip,
            onRemove: () => setFilters((f) => ({ ...f, priceRange: 'any' })),
          })
        }
      }
      if (filters.sort !== 'recommended') {
        const cfg = SORTS.find((s) => s.value === filters.sort)
        if (cfg) {
          chips.push({
            label: `Sort: ${cfg.label}`,
            onRemove: () => setFilters((f) => ({ ...f, sort: 'recommended' })),
          })
        }
      }
      return chips
    },
    [filters, selectedCampusName],
  )

  const hasActiveFilters = activeFilterChips.length > 0

  const clearAllFilters = React.useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setDraftCuisines([])
    setDraftPriceRange('any')
    setDraftSort('recommended')
  }, [])

  // --- Pull-to-refresh handlers --------------------------------------------
  const onTouchStart = (e: React.TouchEvent) => {
    const el = scrollRef.current
    if (!el || el.scrollTop > 0) return
    pullStartY.current = e.touches[0]?.clientY ?? null
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current == null) return
    const delta = e.touches[0]?.clientY ?? 0
    const pull = delta - pullStartY.current
    if (pull > 0 && pull <= PULL_MAX) {
      setPullDistance(pull)
    }
  }
  const onTouchEnd = () => {
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true)
      doFetch({ silent: true })
    } else {
      setPullDistance(0)
    }
    pullStartY.current = null
  }

  const handleManualRefresh = () => {
    setRefreshing(true)
    doFetch({ silent: true })
  }

  // --- Sheet handlers --------------------------------------------------------
  const openCuisineSheet = () => {
    setDraftCuisines(filters.cuisines.slice())
    setOpenSheet('cuisines')
  }
  const openPriceSheet = () => {
    setDraftPriceRange(filters.priceRange)
    setOpenSheet('price')
  }
  const openSortSheet = () => {
    setDraftSort(filters.sort)
    setOpenSheet('sort')
  }

  const applyCuisines = () => {
    setFilters((f) => ({ ...f, cuisines: draftCuisines.slice() }))
    setOpenSheet(null)
  }
  const toggleDraftCuisine = (c: string) => {
    setDraftCuisines((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c],
    )
  }
  const applyPriceRange = () => {
    setFilters((f) => ({ ...f, priceRange: draftPriceRange }))
    setOpenSheet(null)
  }
  const applySort = () => {
    setFilters((f) => ({ ...f, sort: draftSort }))
    setOpenSheet(null)
  }

  // --- Toggle chip handler ---------------------------------------------------
  const toggleFilter = (key: ToggleKey) => {
    setFilters((f) => {
      const next = !f[key]
      // Special-case "useCampus" — if no campus selected, surface a toast.
      if (key === 'useCampus' && next && !selectedCampusId) {
        toast({
          title: 'No campus selected',
          description: 'Pick a campus from the top bar first.',
          variant: 'destructive',
        })
        return f // don't toggle on
      }
      return { ...f, [key]: next }
    })
  }

  // --- Render: skeleton grid (loading) --------------------------------------
  const renderSkeletons = () => (
    <div
      role="status"
      aria-label="Loading restaurants"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <RestaurantCardSkeleton key={i} />
      ))}
    </div>
  )

  // --- Render: results grid --------------------------------------------------
  const renderResults = () => {
    if (filteredRestaurants.length === 0) {
      return (
        <EmptyState
          variant="no-restaurants"
          title={
            debouncedSearch || hasActiveFilters
              ? 'No matches found'
              : 'No restaurants near this campus yet'
          }
          description={
            debouncedSearch || hasActiveFilters
              ? 'Try adjusting your filters or search term.'
              : 'Try switching to a different campus, or browse all restaurants.'
          }
          actionLabel={
            hasActiveFilters ? 'Clear all filters' : 'Switch campus'
          }
          onAction={
            hasActiveFilters
              ? clearAllFilters
              : () => {
                  setFilters((f) => ({ ...f, useCampus: false }))
                }
          }
          secondaryActionLabel={
            hasActiveFilters ? 'Switch campus' : undefined
          }
          onSecondaryAction={
            hasActiveFilters
              ? () => {
                  setFilters((f) => ({ ...f, useCampus: false }))
                }
              : undefined
          }
        />
      )
    }
    return (
      <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleRestaurants.map((r, i) => (
            <motion.div
              key={r.id}
              initial={prefersReduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.28,
                ease: [0.3, 0, 0, 1],
                delay: prefersReduced ? 0 : Math.min(i * 0.03, 0.24),
              }}
            >
              <RestaurantCardV2
                restaurant={r}
                isOpen={r.isOpen}
                rewardMultiplier={r.rewardMultiplier}
                dealLabel={r.deal ?? undefined}
                onPress={(restaurant) => onSelectRestaurant(restaurant.id)}
              />
            </motion.div>
          ))}
        </div>
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setVisibleCount((c) => c + PAGE_SIZE)
              }
              className="snak-focus-ring"
            >
              Load more
              <span className="ml-1 text-muted-foreground">
                ({filteredRestaurants.length - visibleCount} more)
              </span>
            </Button>
          </div>
        )}
      </>
    )
  }

  // Pull-to-refresh visual indicator
  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1)
  const pullActive = pullDistance >= PULL_THRESHOLD

  // Active sort + price labels for the trigger buttons
  const sortLabel =
    SORTS.find((s) => s.value === filters.sort)?.label ?? 'Recommended'
  const priceLabel =
    PRICE_RANGES.find((p) => p.value === filters.priceRange)?.label ?? 'Any price'

  return (
    <div
      className={cn('flex min-h-[calc(100vh-4rem)] flex-col bg-background', className)}
    >
      {/* Sticky search + filters header */}
      <div
        className={cn(
          'sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm',
        )}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6">
          {/* Search bar row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                inputMode="search"
                placeholder="Search restaurants, cuisines…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search restaurants"
                className="h-10 rounded-lg pl-9 pr-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="snak-focus-ring absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleManualRefresh}
              disabled={refreshing}
              aria-label="Refresh restaurants"
              className="snak-focus-ring h-10 w-10 shrink-0"
            >
              <RefreshCw
                className={cn('h-4 w-4', refreshing && 'animate-spin')}
                aria-hidden="true"
              />
            </Button>
          </div>

          {/* Filter chips row — horizontally scrollable; scrollbar hidden
              via Tailwind arbitrary variants (works in webkit + Firefox). */}
          <div
            role="group"
            aria-label="Quick filters"
            className="-mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TOGGLE_CHIPS.map((chip) => {
              const isActive = chip.isActive(filters)
              // Disable "useCampus" if no campus selected — already handled by
              // toggleFilter's toast, but visually signal it too.
              const isDisabled =
                chip.key === 'useCampus' && !selectedCampusId
              return (
                <FilterChip
                  key={chip.key}
                  label={
                    chip.key === 'useCampus' && selectedCampusName && isActive
                      ? selectedCampusName
                      : chip.label
                  }
                  Icon={chip.Icon}
                  active={isActive}
                  onClick={() => toggleFilter(chip.key)}
                  disabled={isDisabled}
                />
              )
            })}
          </div>

          {/* Secondary row — sheet triggers */}
          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            <SheetTriggerButton
              label="Cuisine"
              value={
                filters.cuisines.length === 0
                  ? 'All'
                  : filters.cuisines.length === 1
                    ? filters.cuisines[0]!
                    : `${filters.cuisines.length} selected`
              }
              active={filters.cuisines.length > 0 || openSheet === 'cuisines'}
              Icon={SlidersHorizontal}
              onClick={openCuisineSheet}
              badgeCount={filters.cuisines.length}
            />
            <SheetTriggerButton
              label="Price"
              value={priceLabel}
              active={filters.priceRange !== 'any' || openSheet === 'price'}
              Icon={Tag}
              onClick={openPriceSheet}
            />
            <SheetTriggerButton
              label="Sort"
              value={sortLabel}
              active={filters.sort !== 'recommended' || openSheet === 'sort'}
              Icon={ArrowUpDown}
              onClick={openSortSheet}
            />
          </div>

          {/* Active filters bar — removable chips */}
          <AnimatePresence initial={false}>
            {hasActiveFilters && (
              <motion.div
                initial={prefersReduced ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={prefersReduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.3, 0, 0, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-2 flex flex-wrap items-center gap-1.5 pb-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Active:
                  </span>
                  {activeFilterChips.map((chip, i) => (
                    <ActiveFilterChip
                      key={`${chip.label}-${i}`}
                      label={chip.label}
                      onRemove={chip.onRemove}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="snak-focus-ring ml-1 text-xs font-medium text-primary hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Pull-to-refresh indicator (mobile only — touch devices) */}
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden transition-all',
          pullDistance > 0 ? 'h-8' : 'h-0',
        )}
        style={{
          opacity: pullProgress,
        }}
        aria-hidden="true"
      >
        <RefreshCw
          className={cn('h-4 w-4', pullActive && 'animate-spin')}
          style={{
            transform: `rotate(${pullProgress * 360}deg)`,
          }}
        />
      </div>

      {/* Results body — touch handlers attached for pull-to-refresh */}
      <div
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="flex-1 touch-pan-y overflow-y-auto"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance * 0.4}px)` : undefined,
          transition: pullDistance === 0 ? 'transform 0.2s ease' : undefined,
        }}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
          {/* Result count summary */}
          {!loading && !error && (
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {filteredRestaurants.length === 0
                  ? 'No restaurants match'
                  : `${filteredRestaurants.length} restaurant${filteredRestaurants.length === 1 ? '' : 's'}`}
              </p>
            </div>
          )}

          {/* Loading state */}
          {loading ? (
            renderSkeletons()
          ) : error ? (
            <ErrorCard onRetry={() => doFetch()} />
          ) : (
            renderResults()
          )}
        </div>
      </div>

      {/* Cuisine multi-select bottom sheet */}
      <Sheet
        open={openSheet === 'cuisines'}
        onOpenChange={(o) => o || setOpenSheet(null)}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[85vh] w-full max-w-md rounded-t-3xl p-0"
        >
          <SheetHeader className="px-5 pb-2 pt-4">
            <SheetTitle className="text-base">Filter by cuisine</SheetTitle>
            <SheetDescription className="text-xs">
              Pick one or more cuisines to narrow results.
            </SheetDescription>
          </SheetHeader>
          <div className="max-h-[55vh] overflow-y-auto px-5 py-2">
            {availableCuisines.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No cuisines available.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {availableCuisines.map((c) => {
                  const checked = draftCuisines.includes(c)
                  return (
                    <li key={c}>
                      <label
                        className="flex cursor-pointer items-center gap-3 py-3"
                        htmlFor={`cuisine-${c}`}
                      >
                        <Checkbox
                          id={`cuisine-${c}`}
                          checked={checked}
                          onCheckedChange={() => toggleDraftCuisine(c)}
                        />
                        <span className="flex-1 text-sm font-medium">
                          {c}
                        </span>
                        {checked && (
                          <Check
                            className="h-4 w-4 text-primary"
                            aria-hidden="true"
                          />
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraftCuisines([])}
              disabled={draftCuisines.length === 0}
              className="snak-focus-ring"
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={applyCuisines}
              className="snak-focus-ring flex-1"
            >
              Apply {draftCuisines.length > 0 && `(${draftCuisines.length})`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Price range bottom sheet */}
      <Sheet
        open={openSheet === 'price'}
        onOpenChange={(o) => o || setOpenSheet(null)}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[85vh] w-full max-w-md rounded-t-3xl p-0"
        >
          <SheetHeader className="px-5 pb-2 pt-4">
            <SheetTitle className="text-base">Price for two</SheetTitle>
            <SheetDescription className="text-xs">
              Pick a price range based on cost for two.
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 py-2">
            <ul className="divide-y divide-border">
              {PRICE_RANGES.map((p) => {
                const checked = draftPriceRange === p.value
                return (
                  <li key={p.value}>
                    <button
                      type="button"
                      onClick={() => setDraftPriceRange(p.value)}
                      className="snak-focus-ring flex w-full items-center gap-3 py-3 text-left"
                      aria-pressed={checked}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border-2',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background',
                        )}
                      >
                        {checked && (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        )}
                      </span>
                      <span className="flex-1 text-sm font-medium">
                        {p.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background px-5 py-3">
            <Button
              type="button"
              size="sm"
              onClick={applyPriceRange}
              className="snak-focus-ring flex-1"
            >
              Apply
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sort bottom sheet */}
      <Sheet
        open={openSheet === 'sort'}
        onOpenChange={(o) => o || setOpenSheet(null)}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[85vh] w-full max-w-md rounded-t-3xl p-0"
        >
          <SheetHeader className="px-5 pb-2 pt-4">
            <SheetTitle className="text-base">Sort by</SheetTitle>
            <SheetDescription className="text-xs">
              Choose how to order results.
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 py-2">
            <ul className="divide-y divide-border">
              {SORTS.map((s) => {
                const checked = draftSort === s.value
                return (
                  <li key={s.value}>
                    <button
                      type="button"
                      onClick={() => setDraftSort(s.value)}
                      className="snak-focus-ring flex w-full items-center gap-3 py-3 text-left"
                      aria-pressed={checked}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border-2',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background',
                        )}
                      >
                        {checked && (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        )}
                      </span>
                      <span className="flex-1 text-sm font-medium">
                        {s.label}
                      </span>
                      {s.value === 'rating' && (
                        <ChevronUp className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      )}
                      {s.value === 'priceLowHigh' && (
                        <ChevronUp className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      )}
                      {s.value === 'prepTime' && (
                        <ChevronUp className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background px-5 py-3">
            <Button
              type="button"
              size="sm"
              onClick={applySort}
              className="snak-focus-ring flex-1"
            >
              Apply
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default ExploreScreen
