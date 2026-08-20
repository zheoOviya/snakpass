'use client'

// src/components/snak/consumer-view.tsx
//
// ConsumerView — REWRITTEN as a screen host (Task 2B).
//
// Responsibilities:
//  1. Hold shared state: orders list, active order, restaurant selection.
//  2. Render the active bottom-nav tab's screen (Home / Explore / Orders /
//     Rewards / Profile).
//  3. Render overlays: restaurant-detail (dynamic import — Task 2D),
//     cart (Task 3A — full-screen review), order-tracking, checkout.
//  4. Render the global cart bar above the BottomNav when the cart has items.
//  5. Wire realtime socket: refresh orders on `order:updated`/`order:created`.
//  6. Accept `initialTab` prop for deep-linking from notifications etc.
//
// Tab model (DESIGN_SYSTEM.md §5.1.1):
//   BottomNavTab = 'home' | 'explore' | 'social' | 'orders' | 'rewards'.
//   Per the design system, Profile is folded into the Social/"You" tab — for
//   Wave 2 MVP the 'social' tab renders the ProfileScreen placeholder. Wave 6
//   will swap in a real social feed when the graph has density.
//
// Task 3A additive (Wave 3):
//   - New 'cart' overlay (Task 3A) wires the CartScreen between
//     restaurant-detail and checkout. Cart review happens BEFORE payment per
//     blueprint §12 + §13 (Cart → Pickup → Payment → Review → Confirm).
//   - Orders tab now prefers Task 3D's MyOrdersScreen (dynamic import with
//     runtime fallback to Task 2B's OrdersScreen if 3D's export is missing).
//
// Governance (Task 2B + 3A):
//   - Does NOT touch any API route.
//   - Does NOT touch cart-store's existing API (additive only — Task 1C owns).
//   - Does NOT touch explore-screen.tsx, restaurant-detail-screen.tsx,
//     my-orders-screen.tsx, or checkout-view.tsx (other tasks own those).
//   - Does NOT touch payment/fulfilment/pickup governance files.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Receipt,
  ShoppingCart,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCart } from '@/lib/cart-store'
import { useUI } from '@/lib/ui-store'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { inr } from '@/lib/snack'
import type { Order } from '@/lib/types'

import { OrderTracking } from '@/components/snak/order-tracking'
import { CheckoutView } from '@/components/snak/checkout-view'
import {
  RestaurantCardSkeleton,
  MenuItemSkeleton,
  OrderCardSkeleton,
  SkeletonGroup,
} from '@/components/snak/skeleton-loader'

// Lazy-loaded screens — Tasks 2C/2D/3D own these files. Using `next/dynamic`
// means TS compilation succeeds even before those files exist; at runtime
// the loading skeleton shows while the chunk is fetched (or, in dev, while
// the file is being created by the parallel agent).
const ExploreScreen = dynamic(
  () =>
    import('./screens/explore-screen').then((m) => ({ default: m.ExploreScreen })),
  {
    ssr: false,
    loading: () => <ExploreLoadingSkeleton />,
  },
)

const RestaurantDetailScreen = dynamic(
  () =>
    import('./screens/restaurant-detail-screen').then(
      (m) => ({ default: m.RestaurantDetailScreen }),
    ),
  {
    ssr: false,
    loading: () => <RestaurantDetailLoadingSkeleton />,
  },
)

// Task 7B: GroupOrderScreen — lazy-loaded overlay for group order detail.
const GroupOrderScreen = dynamic(
  () =>
    import('./screens/group-order-screen').then(
      (m) => ({ default: m.GroupOrderScreen }),
    ),
  {
    ssr: false,
    loading: () => <RestaurantDetailLoadingSkeleton />,
  },
)

// Task 3D's MyOrdersScreen — preferred over Task 2B's OrdersScreen for the
// Orders tab. We wrap the dynamic import in a try/catch so a missing export
// or build-time stub gracefully falls back to OrdersScreen. This keeps the
// consumer-view host resilient to Task 3D landing in parallel.
//
// Type note: the two screen components have DIFFERENT prop shapes
// (MyOrdersScreen takes onOpenOrder/onReorder/onBrowseRestaurants;
// OrdersScreen takes orders/loading/onMount). We cast both through `unknown`
// to a common minimal prop type so the loader can return either — at runtime,
// extra props are silently ignored by the fallback component (which degrades
// gracefully to an empty list when `orders` is undefined).
type MyOrdersLikeComponent = React.ComponentType<{
  onOpenOrder: (order: Order) => void
  onReorder: (restaurantId: string) => void
  onBrowseRestaurants: () => void
}>
const MyOrdersScreen = dynamic<{
  onOpenOrder: (order: Order) => void
  onReorder: (restaurantId: string) => void
  onBrowseRestaurants: () => void
}>(
  async () => {
    try {
      const mod = await import('./screens/my-orders-screen')
      if (mod?.MyOrdersScreen) {
        return { default: mod.MyOrdersScreen as unknown as MyOrdersLikeComponent }
      }
      throw new Error('my-orders-screen: MyOrdersScreen export missing')
    } catch {
      const fallback = await import('./screens/orders-screen')
      return { default: fallback.OrdersScreen as unknown as MyOrdersLikeComponent }
    }
  },
  {
    ssr: false,
    loading: () => <OrdersLoadingSkeleton />,
  },
)

// Statically-imported screens (this Task / Task 2B own them).
import { HomeScreen } from './screens/home-screen'
// Note: OrdersScreen (Task 2B) is no longer rendered directly — it's used as
// the dynamic-import fallback inside the MyOrdersScreen loader below.
import { RewardsScreen } from './screens/rewards-screen'
import { ProfileScreen } from './screens/profile-screen'
import { SocialScreen } from './screens/social-screen'
// Task 3A: CartScreen is owned by this task — static import is fine.
import { CartScreen } from './screens/cart-screen'

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsumerViewProps {
  /**
   * Initial tab to show on mount. Used for deep-linking from notifications
   * (?tab=orders). Defaults to whatever the ui-store already holds (or 'home').
   */
  initialTab?: 'home' | 'explore' | 'social' | 'orders' | 'rewards'
}

// ─────────────────────────────────────────────────────────────────────────────
// ConsumerView
// ─────────────────────────────────────────────────────────────────────────────

export function ConsumerView({ initialTab }: ConsumerViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const cart = useCart()
  const { connected } = useRealtime(['consumer:all'])

  const activeTab = useUI((s) => s.activeTab)
  const setActiveTab = useUI((s) => s.setActiveTab)
  const overlay = useUI((s) => s.overlay)
  const selectedRestaurantId = useUI((s) => s.selectedRestaurantId)
  const selectedOrderId = useUI((s) => s.selectedOrderId)
  const openRestaurant = useUI((s) => s.openRestaurant)
  const closeRestaurant = useUI((s) => s.closeRestaurant)
  const openTracking = useUI((s) => s.openTracking)
  const closeTracking = useUI((s) => s.closeTracking)
  // Task 3A additive — cart overlay coordination.
  const openCart = useUI((s) => s.openCart)
  const closeCart = useUI((s) => s.closeCart)
  // Task 7B additive — group-order overlay coordination.
  const selectedGroupOrderId = useUI((s) => s.selectedGroupOrderId)
  const openGroupOrder = useUI((s) => s.openGroupOrder)
  const closeGroupOrder = useUI((s) => s.closeGroupOrder)

  // ── Local view state ──────────────────────────────────────────────────────
  // 'tab' = render the active bottom-nav tab's screen
  // 'checkout' = render CheckoutView as a full-screen takeover
  const [view, setView] = React.useState<'tab' | 'checkout'>('tab')
  const [activeOrder, setActiveOrder] = React.useState<Order | null>(null)

  // ── Orders list (shared between HomeScreen + OrdersScreen) ────────────────
  const [myOrders, setMyOrders] = React.useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = React.useState(true)

  const fetchMyOrders = React.useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await fetch('/api/orders?role=consumer&limit=20', {
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as { orders?: Order[] }
      setMyOrders(data.orders ?? [])
    } catch {
      /* best-effort; user may be unauthenticated */
    } finally {
      setLoadingOrders(false)
    }
  }, [])

  // Mount: apply initialTab from props OR ?tab= URL param, then fetch orders.
  React.useEffect(() => {
    const param = searchParams?.get('tab') as 'home' | 'explore' | 'social' | 'orders' | 'rewards' | null
    if (initialTab) {
      setActiveTab(initialTab)
    } else if (param && ['home', 'explore', 'social', 'orders', 'rewards'].includes(param)) {
      setActiveTab(param)
      // Clean the URL so refresh doesn't re-trigger deep-link behaviour.
      router.replace('/consumer')
    }
    fetchMyOrders()
  }, [initialTab, searchParams, router, setActiveTab, fetchMyOrders])

  // ── Realtime: refresh orders + active order on socket events ─────────────
  React.useEffect(() => {
    const sock = realtimeSocket()
    const handler = (p: { orderId: string }) => {
      // Refresh active order if it matches the updated one.
      if (activeOrder && p.orderId === activeOrder.id) {
        fetch(`/api/orders/${activeOrder.id}`)
          .then((r) => r.json())
          .then((d) => d?.order && setActiveOrder(d.order as Order))
          .catch(() => {
            /* best-effort */
          })
      }
      // Always refresh the orders list.
      void fetchMyOrders()
    }
    const createdHandler = () => void fetchMyOrders()
    sock.on('order:updated', handler)
    sock.on('order:created', createdHandler)
    return () => {
      sock.off('order:updated', handler)
      sock.off('order:created', createdHandler)
    }
  }, [activeOrder, fetchMyOrders])

  // ── Tracking overlay: when selectedOrderId changes, fetch the order ──────
  React.useEffect(() => {
    if (!selectedOrderId) {
      setActiveOrder(null)
      return
    }
    let cancelled = false
    fetch(`/api/orders/${selectedOrderId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.order) {
          setActiveOrder(d.order as Order)
        }
      })
      .catch(() => {
        /* best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [selectedOrderId])

  // ── Checkout success → switch to tracking overlay ─────────────────────────
  const handleCheckoutSuccess = React.useCallback(
    (order: Order) => {
      setActiveOrder(order)
      openTracking(order.id)
      setView('tab')
      void fetchMyOrders()
    },
    [fetchMyOrders, openTracking],
  )

  // ── Task 3A: Cart screen handlers ────────────────────────────────────────
  // CartScreen.onCheckout — proceed to checkout-view (Task 3B owns the
  // rewrite). The local view state flips to 'checkout' which renders the
  // CheckoutView overlay above everything else.
  const handleCartCheckout = React.useCallback(() => {
    setView('checkout')
  }, [])

  // CartScreen.onContinueShopping — used by the "Change" link on the
  // restaurant banner AND the empty-cart "Browse restaurants" CTA. If the
  // user came from a restaurant-detail overlay (still selected), restore it
  // so they can keep browsing the menu. Otherwise switch to Explore so they
  // can pick a different restaurant.
  const handleCartContinueShopping = React.useCallback(() => {
    closeCart()
    if (!selectedRestaurantId) {
      setActiveTab('explore')
    }
  }, [closeCart, selectedRestaurantId, setActiveTab])

  // CartScreen.onBack — closes the cart overlay (restores the underlying
  // restaurant-detail or active tab).
  const handleCartBack = React.useCallback(() => {
    closeCart()
  }, [closeCart])

  // Task 3D's MyOrdersScreen.onOpenOrder — opens the order-tracking overlay.
  const handleOpenOrder = React.useCallback(
    (order: Order) => {
      openTracking(order.id)
    },
    [openTracking],
  )

  // Task 3D's MyOrdersScreen.onReorder — user tapped "Reorder" on a history
  // order. The MyOrdersScreen has already cleared/repopulated the cart; we
  // just navigate to the restaurant-detail overlay so they can review +
  // proceed to checkout.
  const handleReorder = React.useCallback(
    (restaurantId: string) => {
      openRestaurant(restaurantId)
    },
    [openRestaurant],
  )

  // Task 3D's MyOrdersScreen.onBrowseRestaurants — empty-state CTA.
  const handleBrowseRestaurants = React.useCallback(() => {
    setActiveTab('explore')
  }, [setActiveTab])

  const cartTotal = cart.total()
  const cartCount = cart.count()

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER — overlays take priority over tab view
  // ═════════════════════════════════════════════════════════════════════════

  // ── Overlay: CheckoutView ────────────────────────────────────────────────
  if (view === 'checkout') {
    return (
      <CheckoutView
        onBack={() => {
          // Re-open the restaurant detail overlay if we have a restaurant
          // selected; otherwise just return to the active tab.
          if (cart.restaurantId) {
            openRestaurant(cart.restaurantId)
          }
          setView('tab')
        }}
        onSuccess={handleCheckoutSuccess}
      />
    )
  }

  // ── Overlay: Restaurant Detail (Task 2D's screen via dynamic import) ───
  // Task 3A: "Proceed to Checkout" now opens the cart review overlay first
  // (blueprint §12 → §13 flow: Cart → Pickup → Payment → Review → Confirm).
  if (overlay === 'menu' && selectedRestaurantId) {
    return (
      <div className="relative">
        <div className="mx-auto w-full max-w-2xl px-4 pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="mb-2"
            onClick={() => {
              closeRestaurant()
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        </div>
        <RestaurantDetailScreen
          restaurantId={selectedRestaurantId}
          onBack={() => closeRestaurant()}
          onCheckout={() => openCart()}
        />
      </div>
    )
  }

  // ── Overlay: Cart screen (Task 3A — full-screen review before checkout) ──
  if (overlay === 'cart') {
    return (
      <CartScreen
        onCheckout={handleCartCheckout}
        onContinueShopping={handleCartContinueShopping}
        onBack={handleCartBack}
      />
    )
  }

  // ── Overlay: Group order screen (Task 7B — full-screen group order detail) ──
  if (overlay === 'group-order' && selectedGroupOrderId) {
    return (
      <div className="relative">
        <div className="mx-auto w-full max-w-2xl px-4 pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="mb-2"
            onClick={() => closeGroupOrder()}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        </div>
        <GroupOrderScreen
          groupOrderId={selectedGroupOrderId}
          onConfirmSuccess={(order) => {
            // Host confirmed → treat like a normal checkout success:
            // clear cart, show tracking, close group-order overlay.
            cart.clear()
            closeGroupOrder()
            setActiveOrder(order)
            openTracking(order.id)
          }}
          onBack={() => closeGroupOrder()}
        />
      </div>
    )
  }

  // ── Overlay: OrderTracking (active order) ────────────────────────────────
  if (overlay === 'tracking' && activeOrder) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              closeTracking()
              setActiveOrder(null)
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 snak-live-dot' : 'bg-muted-foreground'}`}
              aria-hidden="true"
            />
            {connected ? 'Live' : 'Reconnecting…'}
          </div>
        </div>
        <OrderTracking order={activeOrder} />
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => {
              closeTracking()
              setActiveOrder(null)
              setActiveTab('orders')
            }}
          >
            <Receipt className="mr-1 h-4 w-4" /> My Orders
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              closeTracking()
              setActiveOrder(null)
              setActiveTab('home')
            }}
          >
            Order something else
          </Button>
        </div>
      </div>
    )
  }

  // ── Default: render the active tab's screen ───────────────────────────────
  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.3, 0, 0, 1] }}
        >
          {activeTab === 'home' && <HomeScreen onRefresh={() => fetchMyOrders()} />}
          {activeTab === 'explore' && (
            <ExploreScreen onSelectRestaurant={(id) => openRestaurant(id)} />
          )}
          {activeTab === 'orders' && (
            <MyOrdersScreen
              onOpenOrder={handleOpenOrder}
              onReorder={handleReorder}
              onBrowseRestaurants={handleBrowseRestaurants}
            />
          )}
          {activeTab === 'rewards' && <RewardsScreen />}
          {activeTab === 'social' && <SocialScreen />}
          {activeTab === 'profile' && <ProfileScreen />}
        </motion.div>
      </AnimatePresence>

      {/* Global cart bar — visible above BottomNav whenever the cart has items
          AND we're not currently inside an overlay (restaurant-detail renders
          its own cart bar; cart/checkout/tracking overlays take over the whole
          screen). Tapping "Checkout" opens the cart review overlay (Task 3A)
          rather than jumping straight to payment — review-before-pay UX. */}
      {overlay === null && (
        <CartBar
          count={cartCount}
          total={cartTotal}
          restaurantName={cart.restaurantName}
          onCheckout={() => openCart()}
        />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CartBar — sticky bar above BottomNav showing cart count + checkout CTA.
// Hidden when cart is empty.
// ═══════════════════════════════════════════════════════════════════════════

interface CartBarProps {
  count: number
  total: number
  restaurantName: string | null
  onCheckout: () => void
}

function CartBar({ count, total, restaurantName, onCheckout }: CartBarProps) {
  if (count === 0) return null
  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
        // Position the cart bar just above the BottomNav. The BottomNav is
        // fixed bottom-0 with height var(--height-bottom-nav-safe). On
        // md+ screens the BottomNav is hidden — we still pin to bottom there
        // (16px breathing room feels right on desktop).
        className="fixed inset-x-0 bottom-[var(--height-bottom-nav-safe)] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-4"
        role="region"
        aria-label="Cart"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500 text-sm font-bold text-white"
              aria-hidden="true"
            >
              {count}
            </span>
            <div className="min-w-0">
              {restaurantName && (
                <p className="truncate text-xs text-muted-foreground">{restaurantName}</p>
              )}
              <p className="font-semibold text-foreground">{inr(total)}</p>
            </div>
          </div>
          <Button
            type="button"
            onClick={onCheckout}
            className="bg-teal-600 hover:bg-teal-700"
          >
            <ShoppingCart className="mr-1 h-4 w-4" aria-hidden="true" />
            Checkout
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Loading skeletons for the dynamically-imported sibling screens
// ═══════════════════════════════════════════════════════════════════════════

function ExploreLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-24">
      <Skeleton className="mb-4 h-11 w-full rounded-2xl" />
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <RestaurantCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

function RestaurantDetailLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24" role="status" aria-label="Loading restaurant">
      <span className="sr-only">Loading restaurant menu…</span>
      <Skeleton className="mb-4 h-40 w-full rounded-2xl" />
      <Skeleton className="mb-2 h-7 w-2/3 rounded" />
      <Skeleton className="mb-4 h-4 w-1/2 rounded" />
      <SkeletonGroup label="Loading menu">
        {Array.from({ length: 5 }).map((_, i) => (
          <MenuItemSkeleton key={i} />
        ))}
      </SkeletonGroup>
    </div>
  )
}

// Task 3A: loading skeleton for the MyOrdersScreen dynamic import. Falls back
// to a list of OrderCardSkeletons while the chunk loads (or while the fallback
// to OrdersScreen is being resolved at runtime).
function OrdersLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24" role="status" aria-label="Loading orders">
      <span className="sr-only">Loading your orders…</span>
      <Skeleton className="mb-4 h-7 w-32 rounded" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <OrderCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

export default ConsumerView
