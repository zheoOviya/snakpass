# Task 2D — Restaurant detail screen + menu redesign

**Agent:** full-stack-developer (Wave 2 Consumer MVP — Task 2D)
**Task ID:** 2D
**Scope:** Build the new Restaurant Detail screen per blueprint §11 (header, pickup estimate, deals, categories sticky tab bar, menu grouped by category, popular items carousel, reviews placeholder, sticky cart bar). Reuse Wave 1's MenuItemCardV2 + bits + SkeletonLoader + EmptyState. Consume Task 2C's additively extended /api/restaurants/[id] + /api/restaurants/[id]/menu read-only. Mobile-first, scrollable, all additively-extended API fields rendered if present (graceful fallback if absent).

**Predecessors consumed (read-only):**
- `agent-ctx/1A-db-schema-migration-seed.md` (Task 1A — Restaurant + MenuItem models)
- `agent-ctx/1C-full-stack-developer-zustand-stores-types.md` (Task 1C — cart-store with add/increment/decrement/clear + pricing())
- Wave 1B in-repo files: `bits.tsx` (VegBadge, SpiceDots, StarRating, CuisineIcon, cuisineGradient, OpenClosedBadge, DealBadge, RewardBadge, CampusBadge), `menu-item-card-v2.tsx` (premium menu item card with add→stepper spring swap), `skeleton-loader.tsx` (MenuItemSkeleton), `empty-state.tsx` (6 built-in variants).
- Wave 2A: `agent-ctx/2A-full-stack-developer-campus-onboarding.md` — confirmed Campus model + RestaurantCampus junction exist; User.campusId additive column wired.
- Wave 2C: `/api/restaurants/[id]/route.ts` + `/api/restaurants/[id]/menu/route.ts` were ALREADY additively extended by Task 2C in parallel — verified by reading the route files + dev.log queries. Task 2C API returns:
  - `rewardMultiplier` (1.0 default placeholder)
  - `deals` = `[{ title, description }]` (derived from priceForTwo under ₹300 → "Great value" deal)
  - `popularItems` = `[MenuItem, MenuItem, MenuItem]` (top-3 available by category/name)
  - `campuses` = `[{ id, name, isPrimary }]` (via RestaurantCampus junction)
  - per-item: `rewardPoints` (Math.floor(rupees * 0.1 * multiplier)), `modifiers` (empty MVP placeholder)

---

## Work Log

### Mandatory first steps
1. Read `/home/z/my-project/worklog.md` (last ~400 lines covering Wave 1 Tasks 1A/1B/1C outputs + Wave 2 Task 2A campus onboarding).
2. Read `upload/SNAKZAP_IDE_MASTER_IMPLEMENTATION_BLUEPRINT.md` §11 RESTAURANT PAGE (sections: header, pickup estimate, deals, categories, menu, popular items, reviews) + §12 CART.
3. Read `DESIGN_SYSTEM.md` §5.2.1 (restaurant card) + §5.2.2 (menu item card) for layout patterns.
4. Read `PRODUCT_IMPLEMENTATION_PLAN.md` Task 2D section (lines 1382-1405) — confirmed scope, files, governance boundaries, acceptance criteria.
5. Read Wave 1 outputs I consume:
   - `src/components/snak/menu-item-card-v2.tsx` (Task 1B) — premium menu item card with VegBadge + SpiceDots + RewardBadge + add→stepper spring swap.
   - `src/components/snak/bits.tsx` (Task 1B) — VegBadge, SpiceDots, StarRating, CuisineIcon, cuisineGradient, OpenClosedBadge, DealBadge, RewardBadge, CampusBadge, PrepTimeBadge, DistanceBadge, GiftIcon, GroupIcon.
   - `src/lib/cart-store.ts` (Task 1C) — useCart Zustand store with `add(item, restaurantId, restaurantName)`, `increment(id)`, `decrement(id)`, `clear()`, `total()`, `count()`, `restaurantId`, `restaurantName`, `lines`.
   - `src/lib/types.ts` (Task 1B) — Restaurant, MenuItem, Campus types.
   - `src/components/snak/skeleton-loader.tsx` — MenuItemSkeleton + SkeletonGroup + Shimmer pattern.
   - `src/components/snak/empty-state.tsx` — 6 variants including 'no-restaurants'.
6. Read existing `/api/restaurants/[id]/route.ts` + `/api/restaurants/[id]/menu/route.ts` — discovered Task 2C has already extended these additively (see predecessors above).

### Files CREATED (1)

1. **`src/components/snak/screens/restaurant-detail-screen.tsx`** (~1170 LOC, `'use client'`) — full Restaurant Detail screen per blueprint §11.

   **Props:** `{ restaurantId: string, onBack: () => void, onCheckout: () => void }`

   **Sections (in order, mobile-first, scrollable):**

   | # | Section | Notes |
   |---|---------|-------|
   | 1 | Hero header | Full-width image with cuisine gradient fallback; floating top-left back button + top-right Heart/Share; OpenClosedBadge; cuisine badge; Star + rating; Clock + prep time; MapPin + distance (if present); MapPin + address |
   | 2 | Pull-to-refresh indicator | AnimatePresence mount on pullDistance > 0; rotating RefreshCw + "Pull to refresh" / "Release to refresh" copy |
   | 3 | Pickup estimate bar | Card surface; `Pickup in ~X min` (Clock, mono) + `Order ahead to skip the line` tagline (Sparkles) |
   | 4 | Deals carousel | Horizontal scroll of snak-card DealBadge cards; renders `{label, description}` (normalises string[] + `{title, description}[]` shapes) |
   | 5 | Reward multiplier banner | AnimatePresence; visible only when rewardMultiplier > 1; gold snak-gradient-reward surface + Sparkles icon + `Earn X× reward points on every order!` headline |
   | 6 | Campus badges | Horizontal scroll of CampusBadge chips; GraduationCap icon prefix; normalises string[] + `{id, name, isPrimary}[]` shapes |
   | 7 | Popular items carousel | Top-3 horizontal scroll using compact `PopularItemCard` variant; RewardBadge; add→stepper |
   | 8 | Sticky categories tab bar | Sticky top-0; role="tablist" + role="tab"; IntersectionObserver updates active tab on scroll; tapping → scrollIntoView smooth + block:start |
   | 9 | Menu grouped by category | Section per category with scroll-mt-[64px]; h3 header + count; list of MenuItemCardV2 (image + VegBadge + SpiceDots + name + description + price + RewardBadge + add→stepper with spring swap) |
   | 10 | Reviews placeholder | Card + Star icon + "Reviews coming soon" + "Write a review" outline button (placeholder toast) |
   | 11 | Sticky cart bar (AnimatePresence) | Slides up from bottom (y:120→0 spring) when cart has items from THIS restaurant; count badge + restaurantName + inr(total) + "Proceed to Checkout" → onCheckout() |
   | 12 | Switch-restaurant confirm dialog (AlertDialog) | Opens when user adds an item from a DIFFERENT restaurant while cart has items; "Keep current cart" vs "Clear & start new"; on confirm: cart.clear() + cart.add(pendingItem, ...) |

   **Behavior:**
   - Adding item to cart → toast "Added to cart" + cart bar slides up (AnimatePresence spring).
   - Switching restaurant → AlertDialog confirm → cart.clear() + cart.add() + toast "Started a new order".
   - Loading state: `RestaurantDetailSkeleton` (shimmer hero + pickup bar + categories bar + 6× MenuItemSkeleton).
   - Error state: Card + AlertTriangle icon + error message + Retry button (calls `loadAll()`). Toast variant='destructive' for silent-refresh failures.
   - Pull-to-refresh: touch handlers on scroll container; rubber-banded deltaY * 0.5; threshold 70px; releases trigger `loadAll({silent: true})`.
   - Restaurant not found: EmptyState variant='no-restaurants' with "Back to restaurants" CTA.
   - Empty menu: EmptyState variant='no-restaurants' with "No items on the menu yet" copy.

   **Reused Wave 1 components:**
   - `MenuItemCardV2` (Task 1B) — premium menu item card with all states (default, sold-out, qty > 0).
   - `bits` (Task 1B) — CuisineIcon, cuisineGradient, OpenClosedBadge, DealBadge, RewardBadge, CampusBadge.
   - `SkeletonLoader` (Task 1B) — MenuItemSkeleton.
   - `EmptyState` (Task 1B) — 'no-restaurants' variant.

   **Cart integration:**
   - Uses `useCart()` (Task 1C Zustand store) — calls `cart.add(item, restaurant.id, restaurant.name)`, `cart.decrement(item.id)`, `cart.clear()`.
   - Reads `cart.lines` for current quantity per item, `cart.total()` / `count()` / `restaurantId` for cart bar visibility.
   - DOES NOT touch cart-store.ts API (governance respected — only CALLS existing actions).

   **Accessibility:**
   - Hero has `aria-label={\`${restaurant.name} header\`}`.
   - Floating buttons (back/heart/share) have `aria-label`.
   - Categories tab bar uses `role="tablist"` + `role="tab"` + `aria-selected` + `aria-controls`.
   - Cart bar is fixed-positioned with `snak-pad-bottom-safe` for iOS safe-area.
   - Skeletons use `role="status"` + sr-only text.
   - Pull-to-refresh indicator is `aria-hidden` (decorative).
   - AnimatePresence for cart bar + reward banner + pull indicator.

   **Mobile-first + responsive:**
   - `max-w-2xl mx-auto` container.
   - Hero `h-56` mobile, `sm:h-64`.
   - Floating buttons `h-10 w-10` (40px, close to 44px touch target).
   - `PopularItemCard` `w-[220px] shrink-0` for horizontal scroll.
   - `pb-40` on root to clear the fixed cart bar.

### Governance boundaries (CRITICAL — all respected)
- ❌ Did NOT touch `src/components/snak/consumer-view.tsx` (Task 2B owns it).
- ❌ Did NOT touch `src/components/snak/app-shell.tsx` (Task 2B owns it).
- ❌ Did NOT touch `src/components/snak/screens/explore-screen.tsx` or `home-screen.tsx` (Tasks 2C/2B own those).
- ❌ Did NOT touch any `/api/**` route (Task 2C owns restaurant API; consumed read-only).
- ❌ Did NOT touch `src/lib/cart-store.ts`'s existing API (Task 1C owns it — only CALLED existing actions).
- ❌ Did NOT touch payment/fulfilment/pickup governance files.
- ❌ Did NOT touch `prisma/schema.prisma`.
- ✅ OWNED: `src/components/snak/screens/restaurant-detail-screen.tsx` (created only).
- ✅ No new helper files needed in `src/lib/` (inlined the small `groupByCategory` + `slugify` + `pointsFor` helpers at the bottom of the screen file).

### Acceptance criteria verification
- [✓] Restaurant detail screen renders: hero with image + name + cuisine + rating + prep time + address + distance, deals section (if any), reward multiplier banner (if > 1), campus badges, categories tab bar (sticky), menu grouped by category, popular items carousel, reviews placeholder.
- [✓] Menu item cards use MenuItemCardV2 with image, name, description, price, dietary tags (veg badge), reward points (gold RewardBadge), add button → quantity stepper (spring swap).
- [✓] Adding item to cart → cart bar slides up from bottom (AnimatePresence, y:120→0 spring).
- [✓] Switching restaurant (different restaurantId when cart has items) → AlertDialog confirm → cart.clear() + cart.add().
- [✓] Tapping "Proceed to Checkout" → calls `onCheckout()` prop.
- [✓] Categories tab bar → tapping scrolls to that category (scrollIntoView smooth + block:start; scroll-margin-top:64px).
- [✓] Loading skeletons (RestaurantDetailSkeleton + 6× MenuItemSkeleton), error state (Card + AlertTriangle + Retry button + toast), pull-to-refresh (touch handlers + rubber-banded deltaY + threshold).
- [✓] `bunx eslint src/components/snak/screens/restaurant-detail-screen.tsx` exits 0 on the new file (verified).
- [✓] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in my file (verified — 174 pre-existing errors are all in protected/out-of-scope files).
- [✓] Dev server runs without errors (dev.log shows successful compilation + 200 responses for /api/restaurants/[id] + /menu).

### Issues encountered + resolved
1. **Initial type design mismatch with Task 2C's API response shape** — I initially assumed `deals` was `string[]`, `popularItems` was `string[]` of IDs, and `campuses` was `string[]` of names. After re-reading the Task 2C-extended API routes mid-implementation, I discovered the actual shapes:
   - `deals`: `Array<{ title, description }>`
   - `popularItems`: `Array<MenuItem>` (full objects, top-3 by category/name)
   - `campuses`: `Array<{ id, name, isPrimary }>`
   
   **Resolution:** Updated the `RestaurantDetail` interface to accept BOTH the new shape AND the legacy string shape (`Array<string | { title, description }>` etc.). Added normalisation logic at render-time so the screen degrades gracefully if the API ever changes shape. Removed the now-unused `popularItems` state (was unused since popularItems come from restaurant response, not menu response).

2. **React hooks ordering concern** — I initially used `React.useMemo` for `deals` and `campusNames` AFTER the early returns (loading/error/not-found states), which would have violated the Rules of Hooks (conditional hook calls).
   
   **Resolution:** Inlined the calculations as plain `const` expressions (no useMemo) — the arrays are small (typically 0-3 entries), so memoization isn't needed and inlining avoids the hooks-ordering trap entirely.

3. **Pre-existing ESLint error in `home-screen.tsx`** (owned by Task 2C/2B) — `react-hooks/refs` rule fires on line 832 because `startY.current` is accessed in a `style` prop during render. Per governance boundary I did NOT touch this file. Project-wide `bun run lint` reports this single error; my file passes lint cleanly.

4. **Pull-to-refresh UX** — implementing true pull-to-refresh requires careful touch event handling on the scroll container. Chose a rubber-band factor of 0.5 (eased pull distance = dy * 0.5, capped at PULL_REFRESH_THRESHOLD * 1.5 = 105px) to make the indicator feel springy without exceeding the viewport. Touch start only registers when scrollTop === 0 (top of page). Touch end triggers `loadAll({silent: true})` if pullDistance >= 70px, else snaps back to 0.

### Coordination notes for downstream tasks

**Wave 2 Task 2B (ConsumerView owner — will dynamically import RestaurantDetailScreen):**
- Component name: `RestaurantDetailScreen` (named export + default export both available).
- Props: `{ restaurantId: string, onBack: () => void, onCheckout: () => void }`.
- Import path: `import { RestaurantDetailScreen } from '@/components/snak/screens/restaurant-detail-screen'`.
- Suggested wiring in ConsumerView: when `view === 'restaurant'` and `selectedRestaurantId` is set, render:
  ```tsx
  <RestaurantDetailScreen
    restaurantId={selectedRestaurantId}
    onBack={() => setView('browse')}
    onCheckout={() => setView('checkout')}
  />
  ```
- The screen fetches `/api/restaurants/[id]` + `/api/restaurants/[id]/menu` itself — no need to pass restaurant/menu data as props.
- Cart bar's "Proceed to Checkout" calls `onCheckout()` prop — ConsumerView should switch to the Cart screen (Task 3A) or fall back to the existing CheckoutView.

**Wave 3 Task 3A (Cart screen redesign — receives the onCheckout hand-off):**
- When `onCheckout()` is called, the cart already has items from this restaurant (cart.restaurantId === restaurant.id is guaranteed by the `showCartBar` check).
- The Cart screen should use `cart.pricing()` (Task 1C) for the transparent breakdown.
- The Cart screen should also display the restaurant banner — `cart.restaurantId` + `cart.restaurantName` are available.

**Wave 1 Task 1C (cart-store owner):**
- No new actions or fields were needed — I only CALL existing `add`, `increment` (via `cart.add` with same item), `decrement`, `clear`, `total`, `count`, `lines`, `restaurantId`, `restaurantName`.

**Wave 2 Task 2C (restaurant API owner):**
- Additive fields I consume (and their expected shapes):
  - `rewardMultiplier: number` (default 1.0; only triggers the reward banner when > 1)
  - `deals: Array<{ title: string; description?: string }>` (legacy `string[]` also supported)
  - `popularItems: Array<MenuItem>` (legacy `string[]` of IDs also supported — matched against menuItems client-side)
  - `campuses: Array<{ id: string; name: string; isPrimary?: boolean }>` (legacy `string[]` of names also supported)
  - per-item: `rewardPoints: number`, `modifiers: Array<unknown>` (currently ignored by MenuItemCardV2 — it auto-calculates reward points via `pointsEarnedFor(price/100, rewardMultiplier)`)
