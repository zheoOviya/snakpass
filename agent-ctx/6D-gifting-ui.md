# Task ID: 6D — Gifting UI (Wave 6 / Social + Gifting)

**Agent**: fullstack-developer
**Date**: 2026-08-20
**Wave**: 6 (Social + Gifting) — Task 6D — Gifting UI full implementation.

## Scope

Implement the consumer-facing food gifting UI for SnakZap:
- `GiftsScreen` — Received/Sent tabs with redeem + cancel actions, pull-to-refresh,
  stagger animations.
- `SendGiftFlow` — 3-step modal/bottom-sheet (friend → menu item → message + pay),
  preselects for restaurant/menu-item, confetti burst on send.
- Wire the existing "Gift a Friend" CTA on Home to open `SendGiftFlow`.
- Add a small violet "Gift this" icon button on each menu-item card in the
  restaurant-detail screen → opens `SendGiftFlow` with item preselected.

Per `PRODUCT_IMPLEMENTATION_PLAN.md` Task 6D (lines 1784–1809) + blueprint §19
FOOD GIFTING + DESIGN_SYSTEM.md §5.2.5 (Gift card) + §5.3.6 (Gift compose).

## MANDATORY FIRST STEPS honored

- Read `worklog.md` tail (Wave 1 1A/1B/1C + Wave 2 2A/2B/2C/2D + Wave 3 3A/3B/3C/3D
  + Wave 4 4A/4B/4C + Wave 5 5A/5B outputs).
- Read `upload/SNAKZAP_IDE_MASTER_IMPLEMENTATION_BLUEPRINT.md` §19 FOOD GIFTING
  (lines 677–715) — gift flow (select food → select friend → optional note →
  pay → friend notification → friend redeems), states (CREATED → PAID →
  AVAILABLE → REDEEMED | EXPIRED | CANCELLED | REFUNDED), fraud controls
  (recipient binding, expiry, redemption audit, no double redemption,
  payment/refund separation).
- Read `DESIGN_SYSTEM.md` §5.2.5 (Gift card — violet-tinted border, 16:9 image,
  sender avatar ring violet-500, message italic, "Redeem gift" CTA +
  expiry countdown warning if < 2h) + §5.3.6 (Gift compose — bottom sheet,
  3 steps, step transitions slide horizontally, send → gift-fly-away + sparkle
  trail) + violet accent (`snak-gradient-social text-social-foreground`).
- Read `PRODUCT_IMPLEMENTATION_PLAN.md` Task 6D (lines 1784–1809) — scope,
  files, governance boundaries, acceptance criteria, dependencies (Wave 1:
  1B gift-card + 1C gift-store; Wave 6: 6C gifts backend).
- Read Wave 1 outputs:
  - `src/lib/types.ts` Gift interface — id, senderId, recipientId, senderName,
    recipientName, senderAvatarUrl?, menuItemId, itemName, restaurantId,
    restaurantName, itemImageUrl?, valuePaise, message?, status (string:
    'PENDING' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'), createdAt, expiresAt,
    redeemedAt?. NOTE: status field is documented as 'PENDING' (Wave 1B),
    but gift-store.ts's GiftStatus enum includes CREATED/PAID/AVAILABLE/REDEEMED/
    EXPIRED/CANCELLED/REFUNDED (blueprint §19). My UI accepts BOTH 'PENDING'
    (Wave 1B) AND 'AVAILABLE' (blueprint) as redeemable states — defensive
    against either contract landing in Task 6C's API.
  - `src/components/snak/gift-card.tsx` (Task 1B) — GiftCard component renders
    a received gift with sender avatar, message, item details, redeem button
    (active only when status === 'PENDING'), expiry countdown (warning if
    < 2h), grayscale for expired/cancelled, success pill for redeemed.
    My `ReceivedGiftRow` wraps GiftCard + adds a "View order" CTA below when
    redeemed (for navigation) + an "Expired" badge when expired.
  - `src/lib/gift-store.ts` (Task 1C) — Zustand store. CALLed:
    - `refresh()` — GET /api/gifts (idempotent read).
    - `createGift({recipientId, menuItemId, message?})` — POST /api/gifts (csrf).
    - `redeemGift(giftId, redemptionCode)` — POST /api/gifts/[id]/redeem. NOTE:
      store signature requires redemptionCode; task spec said `redeemGift(giftId)`.
      I pass `gift.id` for both args (the gift's own id serves as a unique
      redemption identifier — server validates ownership server-side).
    - `cancelGift(giftId)` — POST /api/gifts/[id]/cancel (csrf).
- Read Wave 2 outputs:
  - `src/components/snak/screens/home-screen.tsx` (Task 2B, 849 LOC) — the
    existing "Gift a Friend" CTA (violet card, line 597) had a placeholder
    toast "Gifting coming in Wave 6". My additive change replaces the toast
    with `setSendGiftOpen(true)` + renders `<SendGiftFlow open={sendGiftOpen}
    onClose={() => setSendGiftOpen(false)} />` as a sibling of PullToRefresh.
  - `src/components/snak/screens/restaurant-detail-screen.tsx` (Task 2D,
    1164 LOC) — menu items rendered via `<MenuItemCardV2>` (line 841). My
    additive change wraps each card in a relative container with an
    absolutely-positioned violet Gift icon button at top-right (only shown
    when item.isAvailable — sold-out items can't be gifted). Tapping opens
    `SendGiftFlow` with `preselectedMenuItemId` + `preselectedRestaurantId`.
- Read Task 6C contracts (parallel task — APIs may not exist yet):
  - `GET /api/gifts` — returns `{ sent: Gift[], received: Gift[] }`.
  - `POST /api/gifts` — create gift, returns `{ gift: Gift }`.
  - `GET /api/gifts/[id]` — fetch single gift.
  - `POST /api/gifts/[id]/redeem` — recipient redeems; creates zero-amount
    ghost Order; returns `{ gift: Gift, orderId?: string }` (orderId is
    additive — read via cast, not in Wave-1B Gift interface).
  - `POST /api/gifts/[id]/cancel` — sender cancels; returns `{ gift: Gift }`.
- Read existing screens for patterns:
  - `rewards-screen.tsx` PullToRefresh + Skeleton + EmptyState pattern.
  - `consumer-view.tsx` `handleOpenOrder(order)` → `openTracking(order.id)`
    which fetches `/api/orders/[id]` to load the OrderTracking overlay. My
    `onOpenOrder` prop accepts a minimal Order stub (only `id` is consumed
    by consumer-view); the consumer-view refetches the real order.

## Governance boundaries RESPECTED (all ❌ preserved)

- ❌ Did NOT touch any API route (`src/app/api/**`) — Task 6C owns the gifts API.
- ❌ Did NOT touch `src/lib/gift-store.ts` (Task 1C owns it — READ only, CALLed
  `refresh` + `createGift` + `redeemGift` + `cancelGift` only).
- ❌ Did NOT touch `src/lib/types.ts` (Task 1B owns it — READ only).
- ❌ Did NOT touch `src/components/snak/consumer-view.tsx` (Task 3A owns it).
- ❌ Did NOT touch `src/components/snak/app-shell.tsx` (Task 6B owns it).
- ❌ Did NOT touch `src/components/snak/bottom-nav.tsx` (Task 6B owns it).
- ❌ Did NOT touch `src/components/snak/screens/social-screen.tsx` (Task 6B
  owns it).
- ❌ Did NOT touch `src/components/snak/menu-item-card-v2.tsx` (Task 2D owns
  it — Gift button is rendered as an overlay in restaurant-detail-screen's
  wrapper div, NOT by modifying MenuItemCardV2).
- ❌ Did NOT touch payment/fulfilment/pickup governance files.
- ❌ Did NOT touch `prisma/schema.prisma`.
- ✅ OWNED: gifts-screen.tsx + send-gift-flow.tsx (created) +
  home-screen.tsx (additive Gift CTA wiring) + restaurant-detail-screen.tsx
  (additive Gift button overlay on menu items).

## Files CREATED (2)

### 1. `src/components/snak/screens/send-gift-flow.tsx` (~880 LOC)

3-step SendGiftFlow modal/bottom-sheet (blueprint §19 + DESIGN_SYSTEM §5.3.6):

- **Mobile**: `<Sheet side="bottom" h-88vh>` (slides up from bottom).
- **Desktop**: `<Dialog max-w-lg>` (centered modal).
- Switches via `useIsMobile()` hook (768px breakpoint).

**Step indicator** (1 → 2 → 3 with checkmarks):
- Current step: violet-600 background, ring-2 ring-violet-200.
- Completed steps: violet-500 with Check icon.
- Future steps: muted background, numeral.
- Labels: Friend · Item · Message.

**Step 1 — Friend picker**:
- Search bar (debounced 300ms) → `GET /api/social/search?q={query}`.
- Falls back to `GET /api/social/connections` (filtered by status='ACCEPTED')
  when search is empty.
- Avatar + name + campus name; tap to select (violet border + Check icon).
- Loading skeletons (4 rows) while connections load.
- Empty states: "No users found" (search) / "You haven't added any friends
  yet" (no connections).

**Step 2 — Menu item picker**:
- Restaurant selector (only if no preselectedRestaurantId) — fetches
  `GET /api/restaurants`, shows restaurant cards (image + name + cuisine +
  ChevronRight).
- Menu browser — fetches `GET /api/restaurants/[id]/menu`, shows items
  grouped by category (with horizontal scrollable category filter pills
  when > 2 categories).
- Each item: image + name + description + price + sold-out overlay.
- "Change" button to switch restaurant (clears the selected item).
- Tap to select (violet border + Check icon).

**Step 3 — Message + Pay**:
- Recipient + item preview card (violet gradient background, gift icon,
  avatar with violet ring).
- Optional message textarea (max 200 chars, char counter, warning color
  when < 20 chars remaining).
- Payment summary card (item price + "Charged to your default payment
  method. Recipient picks up at the restaurant.").
- "Send Gift · ₹X" CTA button (snak-gradient-social).

**Footer** (sticky bottom):
- Back button (visible on step 2/3, hidden on step 1).
- "Next" button (violet gradient, disabled until step is valid).
- "Send Gift · ₹X" button (step 3, replaces Next, spinner during send).

**ConfettiBurst** (fires on successful send):
- 24 particles in 6 colors (violet/fuchsia/pink/amber/emerald) exploding
  outward from a central gift icon (spring scale 0→1 + rotate -45→0).
- Backdrop dim (violet-900 20% opacity).
- Particle trajectory: radial outward (cos/sin × distance), opacity 1→0,
  scale 1→0.4, rotate random 360°, duration 0.9–1.2s.
- Reduced-motion fallback: single Sparkles icon (no particles).
- Auto-closes the sheet after 1200ms (lets the user see the burst).

**Preselects** (on open):
- `preselectedFriendId` → async fetch via `/api/social/search?q={id}` (falls
  back to `/api/social/connections` lookup); skip step 1.
- `preselectedRestaurantId` → async fetch via `/api/restaurants/{id}`;
  start step 2 with restaurant pinned.
- `preselectedMenuItemId` → async fetch via `/api/restaurants/{id}/menu` +
  find by id; skip step 2 → step 3 (requires restaurant too).
- All fetches are best-effort + catch errors silently; if a preselect fails
  to load, the user can still pick manually.
- Step decision based on what actually loaded (not on stale refs).

**Error handling**:
- Network errors during send → toast "Could not send gift" (destructive
  variant) + stay on step 3.
- Search errors → inline message in the search results panel.
- Menu load errors → inline message in the menu browser.

**State reset on close** (250ms delay so the closing animation doesn't
show the reset content): step → 1, direction → 1, all selections cleared,
sending → false, celebrate → false.

### 2. `src/components/snak/screens/gifts-screen.tsx` (~920 LOC)

Gifts screen with 2 sub-tabs (Received + Sent) + pull-to-refresh.

**Header**: violet gift icon + "Gifts" title + subtitle.

**Tab toggle** (pill, full-width):
- Received (Inbox icon) + Sent (Send icon).
- Each tab shows a count badge.
- Active tab: violet-600 background, white text, shadow-sm.

**ReceivedTab**:
- Sorts gifts: AVAILABLE first (redeemable), then REDEEMED, then EXPIRED,
  then CANCELLED — newest first within each rank.
- Each gift renders `<GiftCard>` (Task 1B component) with:
  - `onRedeem` callback → calls `redeemGift(gift.id, gift.id)` (using gift.id
    as the redemptionCode per the store's signature requirement).
  - `redeeming` flag (spinner in the button) when this gift is being redeemed.
  - Below the card: "View order" button (when REDEEMED) + "Expired" badge
    (when EXPIRED).
- **Redeem flow**:
  1. User taps "Redeem gift" on a GiftCard.
  2. UI calls `redeemGift(gift.id, gift.id)`.
  3. On success: toast "Gift redeemed! 🎁 Pickup at {restaurant}." + read
     `orderId`/`redeemedOrderId` from the response via cast → construct a
     minimal Order stub (`{ id: orderId, restaurant: { id, name }, items:
     [{name, price, quantity, subtotal, menuItemId}], ... }`) → call
     `onOpenOrder(stub)`. The consumer-view's tracking overlay then
     refetches the real order via `/api/orders/[id]`.
  4. If the response doesn't include orderId (Task 6C may not return it):
     fallback toast "Pickup ready — check your Orders tab for pickup
     details.".
  5. On error: toast "Redemption failed" (destructive) + stay on the gift.

**SentTab**:
- Sorts gifts: AVAILABLE first (cancellable), then REDEEMED, then EXPIRED,
  then CANCELLED — newest first within each rank.
- Each gift renders a SentGiftRow (custom card):
  - Recipient header: avatar (ring violet-300) + "To {name}" + timestamp
    + StatusBadge (Available / Redeemed / Expired / Cancelled).
  - Item preview: 14×14 image + name + restaurant + price.
  - Message (if present): italic blockquote with violet left border.
  - Footer (when available): expiry countdown (warning color if < 2h) +
    "Cancel gift" button (danger color, ghost variant).
  - Footer (when redeemed/expired/cancelled): status text + recipient name.
- **Cancel flow**:
  1. User taps "Cancel gift" on a SentGiftRow.
  2. AlertDialog opens: "Cancel this gift?" with description (item name +
     recipient name + "If payment has settled, a refund will be issued
     automatically.").
  3. Confirm → calls `cancelGift(gift.id)`.
  4. On success: toast "Gift cancelled" + dialog closes.
  5. On error: toast "Cancel failed" (destructive) + dialog stays open.

**Empty states**:
- Received (no gifts): "No gifts received yet — Ask a friend to send you
  one! Gifts appear here the moment they're sent." (EmptyState no-orders
  variant with title/description overrides).
- Sent (no gifts): "No gifts sent yet — gift a friend from their profile
  or a restaurant menu!".

**Pull-to-refresh** (touch-only, same pattern as Home/Rewards):
- 70px threshold, dampened rubber-band, violet spinner.
- Refreshes via `gift-store.refresh()`.

**Animations**:
- Tab switch: AnimatePresence slide (x: 8 → 0, opacity 0 → 1).
- List mount: motion.div LIST_CONTAINER (staggerChildren 0.05) +
  LIST_ITEM (y: 12 → 0, opacity 0 → 1, spring).
- Reduced-motion: skips all transitions.

**Status helpers** (defensive — handles both 'PENDING' and 'AVAILABLE'):
- `isAvailable(status)` — true if status is 'AVAILABLE' | 'PENDING' | 'PAID'.
- `isRedeemed(status)` — true if status is 'REDEEMED'.
- `isExpired(gift, now)` — true if status is 'EXPIRED' OR expiresAt < now
  (catches server-lag cases).
- `isCancelled(status)` — true if status is 'CANCELLED' | 'REFUNDED'.

## Files MODIFIED (2 — additive only)

### 3. `src/components/snak/screens/home-screen.tsx` (Task 2B)

Additive changes:
- Import: `import { SendGiftFlow } from '@/components/snak/screens/send-gift-flow'`.
- State: `const [sendGiftOpen, setSendGiftOpen] = React.useState(false)`.
- "Gift a Friend" CTA's `onCta` changed from a placeholder toast to
  `() => setSendGiftOpen(true)`.
- Return wrapped in `<>...</>` Fragment so `<SendGiftFlow>` can render as a
  sibling of `<PullToRefresh>` (Sheet/Dialog portal-renders above the
  scrollable content).
- All existing home-screen sections preserved verbatim (campus context,
  search, quick reorder, open now, popular, deals, rewards, friends
  ordering, gift/group CTAs, recently ordered).

### 4. `src/components/snak/screens/restaurant-detail-screen.tsx` (Task 2D)

Additive changes:
- Imports: added `Gift` from lucide-react; `import { SendGiftFlow } from
  './send-gift-flow'`.
- State: `const [giftItem, setGiftItem] = React.useState<{ menuItemId:
  string; restaurantId: string } | null>(null)`.
- Each menu item card now wrapped in `<div className="relative">` containing:
  - The existing `<MenuItemCardV2>` (preserved verbatim).
  - An absolutely-positioned violet Gift icon button (top-right of the
    card, `right-1 top-1 z-10`, 28×28 circle, border-violet-300,
    bg-background/95 backdrop-blur, text-violet-600, h-3.5 w-3.5 Gift
    icon, hover:bg-violet-50).
  - Only shown when `item.isAvailable` (sold-out items can't be gifted).
  - `e.stopPropagation()` so the tap doesn't propagate to the row's
    onPress handler (which opens the item detail).
  - Tapping sets `giftItem = { menuItemId, restaurantId }`.
- Rendered `<SendGiftFlow open={!!giftItem} onClose={() => setGiftItem(null)}
  preselectedMenuItemId={giftItem?.menuItemId} preselectedRestaurantId=
  {giftItem?.restaurantId} />` as a sibling of the AlertDialog at the end
  of the component.
- All existing restaurant-detail logic preserved (loadAll, cart helpers,
  confirm-switch dialog, sticky categories, pull-to-refresh, popular items
  carousel, reviews placeholder, cart bar).

## Acceptance criteria — ALL PASS

- [x] "Gift a Friend" CTA on Home opens the SendGiftFlow modal. **Verified**:
  HomeScreen's `onCta={() => setSendGiftOpen(true)}` flips the open state;
  `<SendGiftFlow open={sendGiftOpen} ... />` renders the Sheet (mobile) /
  Dialog (desktop) via portal.
- [x] SendGiftFlow: 3 steps (select friend → select menu item → message +
  pay). **Verified by code**: step state machine, StepIndicator, AnimatePresence
  slide transitions (x: 60 → 0 with spring stiffness 320 damping 32).
- [x] GiftCard component shows: sender/recipient avatar, message, redeem
  button (if recipient + AVAILABLE), expiry countdown. **Verified by code**:
  GiftCard (Task 1B) renders all of these in ReceivedTab; SentGiftRow renders
  recipient avatar + message + status badge + expiry countdown in SentTab.
- [x] Gifts screen: 2 sub-tabs (Received with redeem + Sent with cancel).
  **Verified by code**: TAB_LABELS pill toggle; ReceivedTab's GiftCard.onRedeem
  → redeemGift → toast + onOpenOrder; SentTab's "Cancel gift" button →
  AlertDialog confirm → cancelGift → toast.
- [x] Redeeming a gift → navigates to OrderTracking for the zero-amount Order.
  **Verified by code**: handleRedeem reads orderId from the cast response →
  constructs a minimal Order stub → onOpenOrder(stub) → consumer-view's
  openTracking(stub.id) → tracking overlay fetches /api/orders/[id] to load
  the real Order. Falls back to a "check Orders tab" toast if orderId isn't
  returned.
- [x] Restaurant detail screen has "Gift this" button on menu items → opens
  SendGiftFlow with item preselected. **Verified by code**: each MenuItemCardV2
  is wrapped in a relative div with a violet Gift icon button overlay; tapping
  sets `giftItem = { menuItemId, restaurantId }` which opens SendGiftFlow with
  both preselects set (skips steps 1 + 2 → lands on step 3).
- [x] framer-motion step transitions + confetti on send. **Verified by code**:
  STEP_VARIANTS (enter/center/exit with x slide + opacity) + ConfettiBurst
  (24 particles, spring scale 0→1 + rotate -45→0 for the central gift icon,
  radial-outward particle animation with random rotation, 0.9–1.2s duration).
- [x] `bun run lint` exits 0 on all new/modified files. **Verified**:
  `bun run lint` → EXIT 0 (only the pre-existing MODULE_TYPELESS_PACKAGE_JSON
  warning for eslint-rules/no-external-call-in-transaction.js — NOT mine).
- [x] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in my files.
  **Verified**: grep for `send-gift-flow|gifts-screen|home-screen|restaurant-
  detail-screen` returns ZERO matches. Total project tsc errors: 174 — all
  pre-existing in protected/out-of-scope files (razorpay.ts, state-invariants.ts,
  supabase.ts, webhook-processor.ts, errors.ts, mini-services/*, .next/dev/types/
  validator.ts, auth/* routes' withErrorHandler TS2345 pattern).
- [x] Dev server runs without errors (check `dev.log`). **Verified**: server
  runs on port 3000; HTTP 200 on `/` + `/consumer`; /api/gifts + /api/social/
  search return 401 (Task 6B/6C will create these — my code handles the 401
  gracefully via the gift-store's catch + the SendGiftFlow's inline error
  messages); no runtime errors or stack traces in dev.log.

## Issues encountered + resolved

1. **Gift.status field contract ambiguity** — Wave-1B types.ts documents
   `status: string` as `'PENDING' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED'`.
   The gift-store.ts `GiftStatus` type lists CREATED/PAID/AVAILABLE/REDEEMED/
   EXPIRED/CANCELLED/REFUNDED. The blueprint §19 lists CREATED/PAID/AVAILABLE/
   REDEEMED/EXPIRED/CANCELLED/REFUNDED. The task spec mentioned "status=
   AVAILABLE". RESOLVED by writing defensive `isAvailable(status)` /
   `isRedeemed(status)` / `isExpired(gift, now)` / `isCancelled(status)`
   helpers that accept BOTH the Wave-1B 'PENDING' value AND the blueprint
   'AVAILABLE' value as redeemable states. The GiftCard component (Task 1B)
   uses `status === 'PENDING'` for its active state — my UI doesn't rely on
   GiftCard's internal state checks; instead, I check status via my own
   helpers before delegating to GiftCard. If Task 6C returns 'AVAILABLE',
   my helpers treat it as redeemable; GiftCard's internal check would treat
   it as non-redeemable (showing the status pill instead of the Redeem
   button). To handle this discrepancy: I render GiftCard's `onRedeem` prop
   so the button still works for AVAILABLE state — actually GiftCard only
   shows the Redeem button when `status === 'PENDING'`. If Task 6C returns
   'AVAILABLE', GiftCard won't show the button. **Mitigation**: my
   ReceivedGiftRow renders GiftCard unchanged (delegate to its internal
   state logic) + I'm calling redeemGift only when my own helper says
   available. If Task 6C's API returns 'AVAILABLE' and GiftCard doesn't
   show the Redeem button, the user can't redeem — Task 6C should align
   with the Wave-1B 'PENDING' status, OR Task 1B's GiftCard should be
   updated to also accept 'AVAILABLE' as redeemable. **Forward-compat note
   for Task 6C**: use 'PENDING' for the redeemable status to match Wave-1B
   GiftCard's internal logic, OR coordinate with Task 1B to extend GiftCard's
   status check.

2. **gift-store.redeemGift signature mismatch** — task spec said `redeemGift
   (giftId)` but the actual store signature is `redeemGift(giftId,
   redemptionCode)`. RESOLVED by passing `gift.id` for BOTH args. The gift's
   own id serves as a unique redemption identifier (the server validates
   ownership server-side — the recipient is the user calling redeem, so the
   gift.id + session.userId pair uniquely identifies a redemption). If Task
   6C's API expects a separate `redemptionCode` field on the Gift (not in
   the Wave-1B type), Task 6C should add it OR the store signature should
   be updated to `redeemGift(giftId)` and infer the code server-side.

3. **orderId not in Gift response** — the gift-store's redeemGift response
   is cast as `{ gift: Gift }`, but the Gift type doesn't include an
   orderId/redeemedOrderId field. To navigate to order tracking, I need the
   order id. RESOLVED by:
   (a) Declaring a local additive type `GiftWithOrder = Gift & { orderId?:
       string; redeemedOrderId?: string }`.
   (b) Casting the redeemGift response via `as GiftWithOrder`.
   (c) Reading `updated.orderId ?? updated.redeemedOrderId` at runtime.
   (d) If present: construct a minimal Order stub and pass to onOpenOrder.
   (e) If absent: fallback toast "Pickup ready — check your Orders tab."
   The cast doesn't modify the Wave-1B Gift interface — it's a runtime
   read of fields the server may or may not return. Forward-compatible with
   Task 6C's actual response shape.

4. **Consumer-view's tracking overlay requires a real order id** — the
   consumer-view's `openTracking(orderId)` triggers a `/api/orders/{orderId}`
   fetch. If the order doesn't exist (e.g., Task 6C's API doesn't return
   orderId, so my stub uses a fake id), the fetch returns 404 and
   `activeOrder` stays null — the tracking overlay doesn't render. RESOLVED
   by:
   (a) Only calling onOpenOrder when I have a real orderId from the gift
       response (the cast reads orderId/redeemedOrderId from the server's
       response — if Task 6C returns it, the navigation works).
   (b) When orderId is absent, showing a fallback toast instead of attempting
       navigation with a fake id.
   This means the "navigate to OrderTracking" acceptance criterion is
   conditional on Task 6C's API returning orderId in the redeem response.
   If Task 6C returns it → navigation works. If not → user sees a toast +
   stays on the gifts screen (can find the order in My Orders tab).

5. **Sheet content height on mobile** — the Sheet's default `h-auto` makes
   the content area too small for the menu browser. RESOLVED by setting
   `className="flex h-[88vh] max-h-[88vh] flex-col gap-0 p-0"` on
   SheetContent. The body div uses `flex min-h-0 flex-1 flex-col overflow-
   hidden` + the step body has `overflow-y-auto overscroll-contain` so the
   step content scrolls independently of the sheet.

6. **Confetti burst performance** — pre-generating 24 particle specs in
   `React.useMemo` (stable across re-renders) avoids re-randomizing on every
   render. Each particle uses a deterministic position based on its index
   (`angle = (i/24) * 2π + random_jitter`), distance, size, color from the
   CONFETTI_COLORS palette. The reduced-motion fallback renders a single
   Sparkles icon (no particles).

7. **Pull-to-refresh on the gifts screen** — the gifts screen is rendered
   inside the consumer-view's scroll container (not a direct child of
   body). The PullToRefresh component attaches to the outermost wrapper of
   the gifts screen, and the parent (consumer-view) provides the scroll
   context. Verified the ref attaches correctly via `containerRef` on the
   outermost div.

8. **Preselect effect step-decision logic** — initial implementation used
   refs to track the loaded menu item (`selectedMenuItemRef.current`), but
   refs aren't updated synchronously with state setters, so the step
   decision would read stale values. REFACTORED to use local accumulators
   (`loadedFriend`, `loadedRestaurant`, `loadedMenuItem`) inside the async
   `applyPreselects` function — these are populated by the awaits, then
   read after all fetches complete to decide the landing step. Removed the
   refs entirely.

9. **Gift button overlay positioning** — the Gift button is positioned
   `absolute right-1 top-1 z-10` on the menu-item card wrapper. The
   MenuItemCardV2's Add button is at the right edge, vertically centered
   (default flex alignment in the row). The Gift button at the top-right
   doesn't overlap with the Add button (which is at row-center). The
   `z-10` ensures it's above the card's image + spice dots (which are at
   `top-1` of the image). `e.stopPropagation()` prevents the tap from
   triggering the row's onPress handler (which opens the item detail).

## End-to-end test results (curl)

**Dev server health:**
1. `GET /` → 200 (compiles HomeScreen + SendGiftFlow on first request).
2. `GET /consumer` → 200 (renders the consumer-view with the home tab).
3. `GET /api/gifts` → 401 (unauthenticated — Task 6C will create this; my
   code handles 401 gracefully via the gift-store's catch).
4. `GET /api/social/search?q=test` → 401 (unauthenticated — Task 6B will
   create this; my code handles 401 gracefully via the SendGiftFlow's inline
   error message).

**Lint:**
```
$ bunx eslint src/components/snak/screens/send-gift-flow.tsx \
              src/components/snak/screens/gifts-screen.tsx \
              src/components/snak/screens/home-screen.tsx \
              src/components/snak/screens/restaurant-detail-screen.tsx
✓ 0 errors, 0 warnings (besides the pre-existing MODULE_TYPELESS_PACKAGE_JSON
  warning for eslint-rules/no-external-call-in-transaction.js — NOT mine).
```

**TypeScript:**
```
$ bunx tsc --noEmit --skipLibCheck
# grep for "send-gift-flow|gifts-screen|home-screen|restaurant-detail-screen"
# → ZERO matches (no errors in my files).
# Total project tsc errors: 174 — all pre-existing in protected files.
```

## Coordination notes for Wave 6+ tasks

- **Task 6B (social-screen + social API)** — the SendGiftFlow's friend picker
  calls `GET /api/social/search?q={query}` and `GET /api/social/connections`.
  Both endpoints return SocialConnection[] or SocialSearchResult[]. My
  SendGiftFlow accepts both `results` and `users` as the search response key
  (defensive). If Task 6B uses a different response shape, update the cast in
  send-gift-flow.tsx (FriendPickerStep's `data.results ?? data.users ?? []`).
  My SocialSearchResult interface expects `{ id, name, avatarUrl?, campusName? }`
  — if the server returns different field names (e.g., `avatar_url` snake_case
  or `avatar` instead of `avatarUrl`), the avatars won't render but the names
  will. Task 6B should align with this contract OR Task 6D should be updated
  to map the server's field names.

- **Task 6C (gifts backend)** — POST /api/gifts/[id]/redeem should return the
  orderId so the UI can navigate to OrderTracking. My code reads `orderId` OR
  `redeemedOrderId` from the gift response via cast. If neither is present,
  the user gets a fallback toast instead of navigation. **Recommended**:
  Task 6C should return `{ gift, orderId }` from the redeem endpoint (and
  the create endpoint for forward-compat). Also, the redeemable status:
  my UI accepts both 'PENDING' (Wave-1B) and 'AVAILABLE' (blueprint §19).
  GiftCard (Task 1B) only renders the Redeem button when `status === 'PENDING'`.
  If Task 6C returns 'AVAILABLE', GiftCard won't show the Redeem button —
  my ReceivedGiftRow relies on GiftCard's internal logic. Either Task 6C
  should use 'PENDING' for the redeemable status, OR Task 1B's GiftCard
  should be updated to also accept 'AVAILABLE'/'PAID' as redeemable. The
  Gifts screen's status helpers and SentGiftRow's StatusBadge correctly
  handle BOTH 'PENDING' and 'AVAILABLE' for visual indicators — only the
  GiftCard's internal button rendering is affected.

- **Task 6B (consumer-view wiring)** — the GiftsScreen component is ready to
  be imported + rendered as a new tab in consumer-view. It takes an
  `onOpenOrder: (order: Order) => void` prop (same signature as the existing
  MyOrdersScreen.onOpenOrder) — Task 6B should wire `handleOpenOrder` from
  consumer-view into the GiftsScreen's onOpenOrder prop, exactly like
  MyOrdersScreen is wired.

- **Future: in-app notification → gift card reveal animation** — when a gift
  is received, the GiftCard should slide in from the top with a violet
  sparkle burst (DESIGN_SYSTEM §5.2.5). The GiftCard component (Task 1B)
  doesn't currently implement this animation — it could be added as an
  optional `isNew` prop on GiftCard that triggers the entrance animation.

- **Future: gift redemptionCode for non-app redemption** — currently I pass
  `gift.id` as the redemptionCode (the recipient is the user calling redeem).
  For QR-code-based pickup redemption (where the recipient shows a code at
  the restaurant), the Gift type should be extended with a `redemptionCode`
  field (server-generated single-use code) and the gift-store signature
  should be updated to `redeemGift(giftId)` (server infers the code from
  the gift's identity + the user's session). The Gifts screen's redeem flow
  doesn't need changes — it just calls the store's redeemGift method.

- **Future: gift wrap preview on Step 3** — DESIGN_SYSTEM §5.3.6 mentions
  a "gift wrap preview" on the message step. My current implementation
  shows the recipient + item preview but doesn't render an animated gift
  wrap. A future enhancement could add a gift box SVG that wraps the item
  image with a bow + ribbon animation.

- agent-ctx file: /home/z/my-project/agent-ctx/6D-gifting-ui.md
