# Task 2B — Home screen redesign + consumer-view screen architecture

## Summary
Rewrote `consumer-view.tsx` as a **screen host** that switches between 5 tab screens (Home / Explore / Orders / Rewards / Profile) based on the active bottom-nav tab from a new shared `ui-store`. Built the Home screen per blueprint §9 with all 11 sections. Added a global CartBar that floats above the BottomNav whenever the cart has items. Preserved the existing realtime socket logic, CheckoutView, and OrderTracking overlay flows.

## Files created (5)
1. **`src/lib/ui-store.ts`** (82 LOC) — Zustand store for activeTab + overlay coordination. Decouples AppShell's BottomNav from ConsumerView's screen routing.
2. **`src/components/snak/screens/home-screen.tsx`** (848 LOC) — Home screen per blueprint §9 with all 11 sections (campus context, search, quick reorder, open now, popular near you, deals, rewards progress, friends ordering nearby, gift CTA, group order CTA, recently ordered). Includes pull-to-refresh + framer-motion section entrance stagger.
3. **`src/components/snak/screens/orders-screen.tsx`** (200 LOC) — Orders tab. Active + History sections with skeleton + empty states. Tapping an order opens the tracking overlay via ui-store.openTracking.
4. **`src/components/snak/screens/rewards-screen.tsx`** (303 LOC) — Rewards tab placeholder. Shows RewardProgressRing + recent ledger + "How to earn" rules card + "Redeem at checkout" placeholder.
5. **`src/components/snak/screens/profile-screen.tsx`** (282 LOC) — Profile tab placeholder. Avatar + account details + settings shortcuts + Logout. Calls useAuth().logout.

## Files modified (2)
6. **`src/components/snak/consumer-view.tsx`** (461 → 454 LOC) — full rewrite as screen host. Renders active-tab screen via ui-store state, manages overlays (restaurant-detail / tracking / checkout), preserves realtime socket logic, supports `initialTab` prop + `?tab=` deep-linking.
7. **`src/components/snak/app-shell.tsx`** (219 → 235 LOC) — additive: imports `BottomNav`, renders it for the consumer persona only, wires active-tab to ui-store. Adds `pb-[var(--height-bottom-nav-safe)]` to main content to prevent overlap. Vendor + admin personas unchanged.

## Tab mapping
The existing BottomNav (Task 1B) has tabs `home / explore / social / orders / rewards`. Per DESIGN_SYSTEM.md §5.1.1, Profile is folded into the Social/"You" tab for thumb ergonomics. For Wave 2 MVP, the `social` tab renders the new ProfileScreen placeholder — Wave 6 will swap in a real social feed when the graph has density. The ui-store's `BottomNavTab` type matches Task 1B exactly.

## Acceptance criteria — all PASS
- [x] Home screen renders all 11 sections from blueprint §9.
- [x] Each restaurant card uses RestaurantCardV2 from Task 1B (via Quick Reorder / Open Now / Popular / Deals sections).
- [x] Pull-to-refresh works (re-fetches restaurants + orders + social feed + rewards).
- [x] Loading skeletons (SkeletonLoader), empty states (EmptyState), error states (toast) for each section.
- [x] Tapping a restaurant → navigates to Restaurant Detail (via `ui-store.openRestaurant(id)` — the consumer-view's overlay renders Task 2D's screen via dynamic import).
- [x] BottomNav switches between Home/Explore/Orders/Rewards/Profile screens (via shared ui-store).
- [x] Campus context bar shows selected campus (from campus-store).
- [x] `bun run lint` exits 0 on all new/modified files (only the pre-existing project-level MODULE_TYPELESS_PACKAGE_JSON warning for eslint-rules/no-external-call-in-transaction.js — not mine).
- [x] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in my files (verified per-file — only pre-existing errors in protected/out-of-scope files like razorpay.ts, webhook-processor.ts, supabase.ts, errors.ts, etc.).
- [x] Dev server runs without errors (checked dev.log — only prisma query logs, no runtime errors. `GET /consumer` returns 200 in ~684ms).

## Governance boundaries — respected
- ❌ Did NOT touch any API route (`src/app/api/**`).
- ❌ Did NOT touch cart-store.ts's existing API.
- ❌ Did NOT touch payment/fulfilment/pickup governance files (razorpay.ts, reconciliation.ts, pickup-attribution.ts, fulfilment-state.ts, state-invariants.ts, deployment.ts).
- ❌ Did NOT touch auth/* routes (Task 2A owns).
- ❌ Did NOT create explore-screen.tsx or restaurant-detail-screen.tsx (Tasks 2C/2D own those — used via `next/dynamic` import with graceful loading skeletons).
- ❌ Did NOT touch prisma/schema.prisma.
- ✅ Owned consumer-view.tsx (rewrite), home-screen.tsx, orders-screen.tsx, rewards-screen.tsx, profile-screen.tsx, and additive app-shell.tsx BottomNav addition.
- ✅ Created src/lib/ui-store.ts for activeTab coordination.

## Coordination notes for Wave 2+ tasks
- **ui-store** is the single source of truth for the active tab + overlay state. Any screen that wants to navigate to a restaurant should call `useUI.getState().openRestaurant(id)`. To open order tracking: `useUI.getState().openTracking(orderId)`.
- **Tab 'social'** is rendered as the ProfileScreen placeholder for Wave 2 MVP. When Wave 6 makes social a real tab, swap the `{activeTab === 'social' && <ProfileScreen />}` line in consumer-view.tsx for the real SocialScreen.
- **Dynamic imports**: Both `ExploreScreen` (Task 2C) and `RestaurantDetailScreen` (Task 2D) are loaded via `next/dynamic` with `ssr: false` + custom loading skeletons. This means TS compilation succeeds even if those files don't exist yet, and the screens are lazy-loaded only when first needed (better bundle splitting).
- **Cart bar**: Global — visible above BottomNav whenever `cart.count() > 0` AND no overlay is active. The restaurant-detail screen (Task 2D) has its own internal cart bar (it owns the cart-with-menu UX), so the global cart bar is suppressed when `overlay === 'menu'`.
- **Realtime**: The consumer-view host wires `order:updated` + `order:created` socket events to refresh the orders list + the active tracking order. Screens don't need to wire their own socket subscriptions.
- **Deep-linking**: `/consumer?tab=orders` will switch to the Orders tab on mount, then strip the query param via `router.replace('/consumer')` so refresh doesn't re-trigger.

## Issues encountered + resolved
1. **Eslint react-hooks/refs error** in PullToRefresh — initially accessed `startY.current` during render to decide transition style. Fixed by promoting the "isPulling" boolean to state (set in touchstart/touchend) so the transition style derives from state, not a ref.
2. **TS overload errors** when calling ExploreScreen + RestaurantDetailScreen — Tasks 2C/2D had already created their files with required props (`onSelectRestaurant` for Explore, `onCheckout` for RestaurantDetail). Fixed by passing those props from consumer-view.
3. **Removed unused CartBar from restaurant-detail overlay** — Task 2D's screen has its own internal cart bar (line 922 of restaurant-detail-screen.tsx shows the "Proceed to Checkout" button calls `onCheckout`). So my consumer-view no longer renders a CartBar when `overlay === 'menu'` (only when `overlay === null`).
4. **Removed unused `usePathname` + `pathname` from app-shell.tsx** — pre-existing unused var; cleaned up since I was modifying the file anyway (additive cleanup, no behavior change).
5. **Removed unused `useToast` import from orders-screen.tsx** — was originally included for "future error surfaces" but never used; cleaned up to pass lint.

## agent-ctx file: /home/z/my-project/agent-ctx/2B-home-screen-consumer-view.md
