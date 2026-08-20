# Agent Context — Task 3D: My Orders screen + reorder

**Task ID:** 3D
**Agent:** full-stack-developer
**Wave:** 3 (Order lifecycle)
**Scope:** Build the upgraded My Orders screen (`src/components/snak/screens/my-orders-screen.tsx`) — active + history sections, live status badges, pickup OTP emphasis, reorder CTA, pull-to-refresh, realtime, framer-motion stagger, empty/error/loading states.

---

## File created

1. **`src/components/snak/screens/my-orders-screen.tsx`** (~917 LOC, `'use client'`)

### Exports
- **`MyOrdersScreen`** (named export) — the main component. Task 3A can dynamically import it.
- **`MyOrdersScreenProps`** — `{ onOpenOrder, onReorder, onBrowseRestaurants }`.
- **Default export** — convenience for callers that prefer `import MyOrdersScreen from '...'`.

### Props contract (for Task 3A consumer-view wiring)
```ts
interface MyOrdersScreenProps {
  onOpenOrder: (order: Order) => void        // tap any card → opens OrderTracking overlay
  onReorder: (restaurantId: string) => void // after reorder: parent navigates to restaurant detail
  onBrowseRestaurants: () => void           // empty-state CTA → switches to Explore tab
}
```

### Internal layout
- Header (sticky): "My Orders" title + subtitle + Refresh button (spins during loading/refresh).
- Body (with pull-to-refresh touch handlers on a wrapping `<div ref={scrollRef}>`):
  - **Error state**: inline red ErrorCard with AlertTriangle + "Retry" button → calls `fetchOrders()`.
  - **Loading state**: 4× `OrderCardSkeleton` (Task 1B) inside `role="status"`.
  - **Empty state**: `EmptyState variant="no-orders"` with "Browse restaurants" CTA → `onBrowseRestaurants()`.
  - **Active section** (orders NOT in `{PICKED_UP, CANCELLED}`):
    - Section header with live emerald pulse dot + `Active (N)` count.
    - `<AnimatePresence>` wraps the list — supports add/remove animation.
    - Each item: `<ActiveOrderCard>` (teal-2 border, live status pill with `snak-live-dot`, emerald-400 border + `snak-pulse-ring` when READY_FOR_PICKUP, emphasized pickup OTP block on READY_FOR_PICKUP, total + "Track →" hint).
    - Tap → `onOpenOrder(order)`.
  - **History section** (orders in `{PICKED_UP, CANCELLED}`):
    - Section header `History (N)`.
    - `<AnimatePresence>` list.
    - Each item: `<HistoryOrderCard>` (default border, completed green check badge OR cancelled red X badge with line-through total, restaurant thumbnail, #shortid + items + date (formatted via `formatHistoryDate`), items preview (first 2 + "+N"), total, **Reorder** button bottom-right).
    - Card body tap → `onOpenOrder(order)`.
    - Reorder button tap → `e.stopPropagation()` + `handleReorderTap(order)` (opens primary confirm dialog).

### Reorder flow (two-step confirm)
1. **Primary confirm** (`AlertDialog`): "Add items to cart?" with copy "Add all **N item(s)** from **{restaurant}** to your cart?" → buttons: Cancel / "Add to cart" (teal-600).
2. If user confirms:
   - Check if `cart.restaurantId` is set AND differs from the target order's restaurant AND `cart.count() > 0`:
     - If YES → close primary dialog, open **secondary confirm** ("Replace cart items?" / "Your cart already has items from a different restaurant. Adding these items will clear your current cart. Continue?") → buttons: Cancel / "Clear & add".
     - If NO → call `performReorder(order)` immediately.
3. `performReorder(order)`:
   - (If secondary confirmed:) `cart.clear()` first.
   - For each `OrderItem` in `order.items`: build a `MenuItem`-shaped object via `orderItemToMenuItem()` (defaults `isVeg: false` per task spec, falls back `id = item.menuItemId ?? item.id ?? 'oi-' + item.name` since the GET /api/orders response currently omits `menuItemId`).
   - Call `cart.add(menuItem, restaurantId, restaurantName)` once per unit of `quantity` (cart.add only increments by 1).
   - Count added items; `toast.success('Added N items to cart', { description: 'From {restaurant}' })`.
   - Call `onReorder(restaurantId)` — parent navigates to restaurant-detail screen.

### Pull-to-refresh
- `onTouchStart` records `startY` only when `scrollTop === 0`.
- `onTouchMove` computes rubber-banded deltaY × 0.5, clamps to `PULL_MAX = 100px`, sets `pullDistance` state.
- `onTouchEnd` triggers `fetchOrders({ silent: true })` if `pullDistance >= PULL_THRESHOLD = 70px`, then resets.
- Decorative indicator (aria-hidden): `<RefreshCw>` rotating with `pullProgress × 360deg` + "Pull to refresh" / "Release to refresh" caption.
- Respects `prefersReduced` (no rotation, no animation).

### Realtime
- Subscribes to the singleton `realtimeSocket()` (NOT a new connection — uses Task 2B's existing `use-realtime` hook's shared socket).
- Listens for `order:updated` + `order:created` → both call `fetchOrders({ silent: true })` (silent refresh without replacing the visible list with skeletons — uses `setRefreshing(true)` instead).
- Properly off-listeners on unmount.

### Auto time-ago refresh
- 30-second `setInterval` increments a dummy `setTick` state to re-render time-ago labels.

## Governance boundaries (RESPECTED)

| Boundary | Status |
|---|---|
| `consumer-view.tsx` (Task 3A) | ✅ Untouched |
| `orders-screen.tsx` (Task 2B) | ✅ Untouched (kept as fallback) |
| `order-tracking.tsx` (Task 3C) | ✅ Untouched |
| Any `src/app/api/**` route | ✅ Untouched |
| `cart-store.ts` existing API | ✅ Untouched (only CALLS `cart.add`/`cart.clear`/reads `cart.restaurantId`/`cart.count()`) |
| Payment / fulfilment / pickup governance files | ✅ Untouched |
| `prisma/schema.prisma` | ✅ Untouched |

## Verification

- **`bunx eslint src/components/snak/screens/my-orders-screen.tsx --max-warnings 0`** → EXIT 0 (zero errors, zero warnings on my file).
- **`bun run lint`** (project-wide) → reports 2 errors in `src/components/snak/screens/cart-screen.tsx` (Task 3A's file — `react-hooks/preserve-manual-memoization` on tip-input useCallback). ZERO errors in `my-orders-screen.tsx` (verified via `bun run lint 2>&1 | grep -c "my-orders-screen"` → 0 matches).
- **`bunx tsc --noEmit --skipLibCheck`** → ZERO errors in `my-orders-screen.tsx` (verified via `grep "my-orders-screen"` → no matches). Total project errors = 271 lines, all pre-existing in protected/out-of-scope files (`errors.ts`, `razorpay.ts`, `state-invariants.ts`, `pickup-attribution.ts`, `supabase.ts`, `webhook-processor.ts`, `webhooks/razorpay/route.ts`, `.next/dev/types/validator.ts`).
- **Dev server**: restarted via `setsid bun run dev > dev.log 2>&1 &` — running on port 3000. GET `/` → 200, GET `/consumer` → 200, GET `/api/orders?role=consumer` → 200 with `{"orders":[]}` (unauthenticated). No new errors or warnings in dev.log.

## Known limitations / coordination notes

1. **`menuItemId` missing from API response**: The GET `/api/orders` + GET `/api/orders/[id]` routes do NOT include `menuItemId` in their `items` array — only `id`, `name`, `price`, `quantity`, `subtotal`. The task spec assumed `menuItemId` was present. To stay within the "DO NOT touch any API route" governance boundary, my `orderItemToMenuItem()` helper falls back to `item.menuItemId ?? item.id ?? 'oi-' + item.name`. This means reordered cart lines won't dedupe correctly with freshly-added real menu items — but the user lands on the restaurant-detail screen immediately after reorder (via `onReorder`), so any items they add there will be real. The reorder items remain in the cart for checkout. If Task 3A later wants to upgrade the API to include `menuItemId`, the fallback will pick it up automatically.

2. **`isVeg` defaulting**: Per task spec ("Default isVeg to false — for MVP"), all reordered cart lines are marked non-veg. The veg badge is wrong on the cart bar until the user lands on restaurant-detail. This is documented in the file header comment and is intentional per the task spec.

3. **Reorder CTA on cancelled orders**: Suppressed (per common UX pattern — can't reorder from a cancelled order). If the spec wants cancelled orders to also be reorderable, removing the `!isCancelled` guard in `HistoryOrderCard` is a one-line change.

4. **Pull-to-refresh touch handlers**: Attach to a wrapping `<div ref={scrollRef}>` (not the body) so they only fire when the user pulls from the top of the orders list. The threshold is 70px and rubber-banded at 0.5× with a 100px max. This matches the pattern used in `restaurant-detail-screen.tsx` (Task 2D).

5. **`motion()` deprecation warning** in dev.log: comes from Task 1B's `restaurant-card-v2.tsx` (`MotionCard = motion(Card)`), NOT from my file. My file uses `<motion.div>` / `<motion.button>` JSX elements only (no deprecated `motion(Component)` call).

## Wiring notes for Task 3A (consumer-view.tsx owner)

When integrating MyOrdersScreen, the consumer-view.tsx should:
1. Replace the current `<OrdersScreen ... />` with `<MyOrdersScreen ... />` when `activeTab === 'orders'`.
2. Wire up the three props:
   - `onOpenOrder={(order) => openTracking(order.id)}` — same as the existing OrdersScreen's behavior.
   - `onReorder={(restaurantId) => openRestaurant(restaurantId)}` — navigates to the restaurant-detail overlay (Task 2D's screen) where the reordered cart is visible.
   - `onBrowseRestaurants={() => setActiveTab('explore')}` — switches to the Explore tab (Task 2C).
3. Keep the existing realtime socket subscription in consumer-view.tsx — it's complementary, not duplicated. My screen subscribes to the same socket singleton (no double-connection).
4. Optionally remove the old `OrdersScreen` import (Task 2B's version) once Task 3A is confident in the new screen — but the task spec says "Task 3A coordinates the fallback", so this is at Task 3A's discretion.
