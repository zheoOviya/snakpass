# Task 7B — Group order UI (full-stack-developer)

**Wave**: 7 (Group Ordering) — Task 7B
**Date**: 2026-08-20
**Status**: ✅ COMPLETE

## Scope

Build the Group Order UI for the SnakZap consumer app — 2 new screens
+ 2 additive modifications to existing screens.

| # | File | Action | LOC |
|---|------|--------|-----|
| 1 | `src/components/snak/screens/create-group-order-flow.tsx` | CREATE | ~870 |
| 2 | `src/components/snak/screens/group-order-screen.tsx` | CREATE | ~1020 |
| 3 | `src/components/snak/screens/home-screen.tsx` | MODIFY (additive) | +30 |
| 4 | `src/components/snak/screens/restaurant-detail-screen.tsx` | MODIFY (additive) | +45 |

## Files created

### 1. `create-group-order-flow.tsx`

Exports `CreateGroupOrderFlow` — a 3-step bottom-sheet (mobile) / dialog
(desktop) modal that lets a consumer start a new group order.

**Props:**
```ts
{
  open: boolean
  onClose: () => void
  preselectedRestaurantId?: string
  onCreated?: (groupOrderId: string, shareCode: string) => void
}
```

**Flow:**
- **Step 1 — Restaurant picker**: searchable list from `GET /api/restaurants`.
  Tap a card to select + auto-advance to step 2.
- **Step 2 — Optional name**: text input ("Lunch with friends") with 80-char
  limit + char counter. Restaurant summary card at the top. "Start group order"
  button calls `POST /api/group-orders { restaurantId, name? }` via `csrfFetch`.
- **Step 3 — Success**: party-popper animation + share code in a rose-tinted
  card + share-link preview + "Share with friends" button (Web Share API
  with copy fallback) + "Copy link" button + "Open Group Order" button
  (calls `onCreated` + `onClose`).

**Preselects**: `preselectedRestaurantId` triggers a `GET /api/restaurants/[id]`
on open + jumps straight to step 2.

**Patterns**:
- Mobile: `<Sheet side="bottom">` 88vh tall.
- Desktop: `<Dialog>` max-w-lg.
- framer-motion: horizontal step transitions (`STEP_VARIANTS` — enter from
  right when going forward, left when going back), spring.
- Step indicator: 3 dots (Restaurant → Name → Done) with checkmarks.
- Loading: restaurant-list skeletons + button spinner during create.
- Error: toast on create failure.
- Reset: 250ms after close, state is fully reset (step → 1, all selections
  cleared, copied flag cleared).

### 2. `group-order-screen.tsx`

Exports `GroupOrderScreen` — a full-screen surface that renders the
group-order detail.

**Props:**
```ts
{
  groupOrderId: string
  onConfirmSuccess: (order: Order) => void
  onBack: () => void
}
```

**Sections** (top-to-bottom):
1. **Back button + title + refresh button** — title shows group order name
   (or `Group order at [restaurant]` if no name set).
2. **Header banner** — rose gradient strip with "Group Order" badge + status
   pill (Open/Locked/Placed/Cancelled) + closes-in countdown (if open).
   Below: restaurant avatar + name + "Hosted by [host]" + start-time.
   Share code box at the bottom with "Copy link" + "Share" buttons.
3. **Members list** — avatar chips with names + Crown icon for host + "(you)"
   suffix on the current user. "Join" button appears if the current user
   isn't a member yet.
4. **My items** — quantity steppers (+/-) + remove (Trash2 icon) for each
   of the current user's items. "Add items" button opens a quick-add sheet.
   Empty state with a primary CTA. Subtotal at the bottom.
5. **All members' items** — grouped by `memberId`. Each group is a card with
   the member's avatar + name + Host badge (if host) + subtotal. Items
   listed below. Grand total at the bottom (rose-tinted box).
6. **Status notice** — locked/placed/cancelled notice card.
7. **Sticky bottom action bar** — host: "Cancel" + "Confirm & Pay · ₹X".
   Member: "Leave group" + "Waiting for host" (disabled).

**Quick-Add Sheet**: A `<Sheet>` (mobile) / `<Dialog>` (desktop) that fetches
the restaurant's menu via `GET /api/restaurants/[id]/menu` and shows it
category-grouped with a search bar + Add button per item. Each Add calls
`POST /api/group-orders/[id]/items { menuItemId, quantity: 1 }`.

**Realtime**: Both polling (every 10s) AND a `group-order:updated` socket
listener (best-effort — the realtime service may not emit this event yet;
the listener is silent if the event isn't fired).

**Patterns**:
- framer-motion: `LIST_CONTAINER` + `LIST_ITEM` stagger on initial mount
  + AnimatePresence on MyItemRow mount/unmount + layout animation.
- Loading: skeleton screens (avatar + banner + content cards).
- Error: full-screen error state with "Try again" CTA (if fetch fails
  before any data loads).
- Empty states: "No items in the cart yet" for the all-items list,
  "No items yet" for my items (with CTA when open).
- Loading state per-action: spinner on the join/confirm/cancel/leave
  buttons; `busyItemId` guards against concurrent item updates.
- Optimistic updates: removeItem removes locally first, rolls back on
  failure. handleQuickAdd optimistically merges into both myItems + allItems.
- Cancel confirmation: `<AlertDialog>` with destructive action button.

**API contracts used (Task 7A provides these in parallel):**
- `GET /api/group-orders/[id]` → `{ groupOrder: { ..., members, myItems, allItems } }`
- `POST /api/group-orders/[id]/join` → `{ groupOrder }`
- `POST /api/group-orders/[id]/items { menuItemId, quantity }` → `{ item }`
- `PATCH /api/group-orders/[id]/items/[itemId] { quantity }` → `{ item }`
- `DELETE /api/group-orders/[id]/items/[itemId]` → `{ ok }`
- `POST /api/group-orders/[id]/confirm` → `{ order, groupOrder }`
- `POST /api/group-orders/[id]/cancel` → `{ groupOrder }`

I bypass `group-order-store.ts` (Task 1C's older contract — uses
`?shareCode=` query params) and call the new id-based contracts directly
via `csrfFetch` (matches the task brief's contract list).

## Files modified (additive)

### 3. `home-screen.tsx`

**Changes**:
- Added `import { CreateGroupOrderFlow } from './create-group-order-flow'`
- Added `const [createGroupOpen, setCreateGroupOpen] = React.useState(false)`
- Wired the existing rose CTACard's "Start group" button:
  ```tsx
  onCta={() => setCreateGroupOpen(true)}  // was: a "coming in Wave 7" toast
  ```
- Rendered `<CreateGroupOrderFlow>` as a sibling of `<PullToRefresh>` +
  `<SendGiftFlow>` (renders on top regardless of scroll position).
- `onCreated={(id, code) => { setCreateGroupOpen(false); /* navigate */ }}` —
  the actual navigation to the GroupOrderScreen overlay is owned by Task 3A's
  ConsumerView (would need a new overlay kind in `ui-store.ts`); for now the
  success screen inside CreateGroupOrderFlow already shows the share code +
  copy link.

**Preserved**: everything else (PullToRefresh, campus context bar, search,
Quick Reorder carousel, Open Now carousel, Popular grid, Deals carousel,
Rewards progress, Friends Ordering Nearby, Gift a Friend CTA, Recently
Ordered, SendGiftFlow rendering).

### 4. `restaurant-detail-screen.tsx`

**Changes**:
- Added `Users` to the lucide-react icon import block.
- Added `import { CreateGroupOrderFlow } from './create-group-order-flow'`.
- Added `const [startGroupOpen, setStartGroupOpen] = React.useState(false)`
  alongside the existing `giftItem` state.
- Added a new `<section aria-label="Start group order">` directly BELOW the
  "PICKUP ESTIMATE BAR" (so it sits as a peer action to "Order ahead to
  skip the line" above + the DEALS CAROUSEL below). The section is a
  rose-tinted gradient button card with:
  - Rose icon circle (Users icon)
  - "Start Group Order Here" title + "Friends join, add their items —
    you confirm + pay." description
  - ChevronRight icon (rose-tinted)
- Renders `<CreateGroupOrderFlow>` with `preselectedRestaurantId={restaurant?.id}`
  + `onCreated` callback (closes the modal).

**Preserved**: everything else (hero banner, prep-time bar, deals carousel,
menu list, cart bar, gift-this-item flow, send-gift flow, pull-to-refresh,
sticky category tabs, quantity stepper).

## Acceptance criteria — ALL PASS

- [x] "Start Group Order" CTA on Home opens CreateGroupOrderFlow.
      *(home-screen.tsx — CTA's onCta → `setCreateGroupOpen(true)`)*
- [x] Create flow: select restaurant → optional name → success screen with
      share code + copy link. *(3 steps with framer-motion transitions)*
- [x] Group order screen: restaurant banner + share code + members + my
      items + all items + host/member controls. *(all 7 sections present)*
- [x] Host "Confirm & Pay" → creates Order → `onConfirmSuccess(order)`.
      *(handleConfirm calls /confirm → reads `data.order` → fires callback)*
- [x] "Start Group Order Here" button on restaurant detail.
      *(restaurant-detail-screen.tsx — section below the prep-time bar)*
- [x] framer-motion + loading/empty/error states. *(STEPS_VARIANTS +
      LIST_CONTAINER/LIST_ITEM + skeletons + empty/error states)*
- [x] `bun run lint` exits 0 on all files.
      *(verified — only pre-existing MODULE_TYPELESS_PACKAGE_JSON warning
      for eslint-rules/no-external-call-in-transaction.js)*
- [x] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors.
      *(138 src/ errors — all in governance-protected API routes + lib files
      (auth, payments, orders, razorpay, supabase, state-invariants,
      webhook-processor, errors.ts, pickup-attribution). ZERO in
      src/components/snak/screens/)*
- [x] Dev server runs without errors. *(verified — `GET /consumer 200 in
      7.6s (compile: 7.2s, render: 357ms)` — Turbopack compiled my screens
      successfully; only pre-existing `motion() is deprecated` warning from
      framer-motion which is a codebase-wide pattern)*

## Governance boundaries RESPECTED (all ❌ preserved)

- ❌ Did NOT touch any API route. (Task 7A owns `/api/group-orders/*`.)
- ❌ Did NOT touch `consumer-view.tsx`, `app-shell.tsx`, `bottom-nav.tsx`.
- ❌ Did NOT touch `group-order-store.ts` — bypassed it with direct
  `csrfFetch` calls to the new id-based contracts.
- ❌ Did NOT touch `prisma/schema.prisma`.
- ❌ Did NOT touch payment/fulfilment/pickup governance files.
- ❌ Did NOT touch `types.ts` (Task 1B owns) — used local additive casts
  (`GroupOrderDetail` with `shareCode?`) for server-returned fields not
  yet in the Wave-1B GroupOrder interface.
- ❌ Did NOT touch `ui-store.ts` (Task 2B owns) — did not add a new
  group-order overlay kind. The actual screen-host rendering of
  GroupOrderScreen is owned by Task 3A's ConsumerView.
- ✅ OWNED + CREATED: `create-group-order-flow.tsx` + `group-order-screen.tsx`.
- ✅ OWNED + MODIFIED (additive): `home-screen.tsx` + `restaurant-detail-screen.tsx`.

## Implementation notes

### Bypassing the existing group-order-store
The Wave-1C `group-order-store.ts` was written for an older contract:
- `refresh(shareCode)` → `GET /api/group-orders?shareCode=...`
- `join(shareCode)` → `POST /api/group-orders/join?shareCode=...`

The new Task 7A contract is id-based:
- `GET /api/group-orders/[id]`
- `POST /api/group-orders/[id]/join`
- etc.

Since the task brief explicitly says "DO NOT touch group-order-store.ts",
I bypass it entirely and call the API directly via `csrfFetch`. This keeps
the store's existing callers (none visible in the codebase) intact while
letting my new screens use the new contracts. Task 1C (or a follow-up
task) can later reconcile the store with the new contract.

### Defensive response shape
The task brief says the GET response nests `members/myItems/allItems`
INSIDE the groupOrder object: `{ groupOrder: { ..., members, myItems, allItems } }`.
The existing store reads them as top-level: `{ groupOrder, members, myItems, allItems }`.
To be robust against either shape, my `GroupOrderDetailResponse` type
includes both, and `fetchGroupOrder` reads nested first then falls back to
top-level:
```ts
const nested = g as GroupOrderDetailResponse['groupOrder']
setMembers(nested.members ?? data.members ?? [])
setMyItems(nested.myItems ?? data.myItems ?? [])
setAllItems(nested.allItems ?? data.allItems ?? [])
```

### "Add Items" — modal vs restaurant-detail "group mode"
The task brief offered two options for the "Add Items" button:
1. Navigate to restaurant-detail in "group order mode" (passes groupOrderId
   so the menu's Add button adds to the group cart instead of regular cart)
2. Open a modal/bottom sheet with the menu for quick add

I chose option 2 because:
- It's simpler (no need to modify restaurant-detail-screen to accept a
  `groupOrderId` prop AND change every menu-item-card's Add button
  behavior).
- It's more cohesive — the user stays in the group-order-screen context
  while adding items.
- The QuickAddSheet is a self-contained component that fetches the menu
  + renders a category-grouped list with a search bar + Add button per
  item. Each Add calls `POST /api/group-orders/[id]/items` directly.
- Optimistic update: the response `{ item: GroupOrderItem }` is merged
  into both `myItems` and `allItems` immediately.

### Member "leave" uses the cancel endpoint
Per the existing store's `leave()` method (which calls `/cancel`), the
server detects whether the caller is the host or a member and acts
accordingly. My `handleLeave` follows the same pattern — calls
`POST /api/group-orders/[id]/cancel`. Task 7A's contract:
- Host cancel → GroupOrder.status = CANCELLED.
- Member leave → GroupOrderMember.status = LEFT for the caller + their
  items removed (but GroupOrder stays OPEN).

### Polling + realtime refresh
I do BOTH:
- A 10s polling interval as a baseline (covers the no-realtime case).
- A socket listener for `group-order:updated` events (best-effort —
  if the realtime service doesn't emit this event, the listener is a
  silent no-op).

The socket listener filters by `payload.groupOrderId === groupOrderId`
so the screen only refreshes for its own group order. This matches the
existing pattern in consumer-view.tsx (which listens for `order:updated`
+ `order:created`).

### Order navigation after Confirm
The task brief says: "Host 'Confirm & Pay' → creates Order → navigates
to checkout with the merged order." My `handleConfirm` reads
`data.order` from the response + fires `onConfirmSuccess(data.order)`.
The parent (ConsumerView, owned by Task 3A) wires this callback to
render the CheckoutView with the merged order. The Order object passed
back is the full server response (not a stub) — Task 7A's confirm
endpoint is responsible for returning a properly-shaped Order.

## Issues encountered + resolved

1. **`encodeURIComponent(preselectedRestaurantId)` TS2345** — initial
   draft passed the prop directly into `encodeURIComponent` inside an
   async closure. TypeScript couldn't narrow `string | undefined` to
   `string` across the closure boundary (the early-return guard runs
   before the closure is invoked, but the closure captures the prop
   binding which can theoretically be reassigned). Resolved by capturing
   the narrowed value into a local `const restaurantId = preselectedRestaurantId`
   before the closure.

2. **Older store contract mismatch** — the existing `group-order-store.ts`
   uses `?shareCode=` query params + reads members/myItems at top-level.
   The new Task 7A contracts use id-based paths + nest members/myItems
   inside groupOrder. Resolved by bypassing the store + calling the
   API directly via `csrfFetch`. My `GroupOrderDetailResponse` type
   supports both nested + top-level shapes defensively (so the screen
   works whether Task 7A lands the nested shape OR the older top-level
   shape).

3. **No `shareCode` field on Wave-1B GroupOrder** — the type doesn't
   include `shareCode` (server-returned). Resolved by adding an
   additive local type `GroupOrderDetail = GroupOrder & { shareCode?: string; name?: string | null; restaurantImage?: string | null }`.
   Same pattern as `GiftWithOrder` in gifts-screen.tsx (Task 6D).

4. **No group-order overlay in `ui-store.ts`** — the existing store has
   `ConsumerOverlay = 'tracking' | 'menu' | 'cart' | null` (no group-order
   kind). Adding a `'group-order'` overlay would require modifying
   ui-store.ts (Task 2B governance). Resolved by leaving the navigation
   wiring as a `/* navigate */` comment in the onCreated callback
   (matching the task brief's instruction verbatim) — the success screen
   inside CreateGroupOrderFlow already shows the share code + copy link,
   so the user can share + the parent screen can pick this up via the
   callback. Task 3A's ConsumerView (or a future wave) wires the actual
   GroupOrderScreen overlay rendering.

5. **`useRealtime` hook isn't a great fit** — the existing `useRealtime(channels)`
   hook subscribes to channels via `s.emit('subscribe', c)` + returns a
   connected flag. The group-order socket event is `group-order:updated`
   (an event NAME, not a channel). So I use `realtimeSocket()` directly
   to attach a one-off listener inside a `useEffect` (with proper cleanup).
   This matches the comment in `use-realtime.ts` that the hook is for
   channel subscription; ad-hoc event listeners should use the socket
   directly.

## Coordination notes for Wave 7+ tasks

- **Task 7A (Group order backend)** — your routes are now being consumed
  by my screens. Please ensure:
  - `POST /api/group-orders { restaurantId, name? }` returns `{ groupOrder: { id, shareCode, ... } }`
  - `GET /api/group-orders/[id]` returns `{ groupOrder: { ..., members, myItems, allItems } }`
    (nested shape per the task brief — my screen reads nested first, falls
    back to top-level)
  - `POST /api/group-orders/[id]/confirm` returns `{ order: Order, groupOrder: GroupOrder }`
    (my handleConfirm reads `data.order` + passes it directly to
    `onConfirmSuccess` — it must be the full Order shape, not a stub)
  - `POST /api/group-orders/[id]/items { menuItemId, quantity }` returns
    `{ item: GroupOrderItem }` (I optimistically merge this into both
    myItems + allItems)
  - `PATCH /api/group-orders/[id]/items/[itemId] { quantity }` returns
    `{ item: GroupOrderItem }` (I use this for the quantity stepper)
  - `DELETE /api/group-orders/[id]/items/[itemId]` returns `{ ok }` or any
    shape (I don't read the body — just check `res.ok`)

  Two TS errors in your routes (visible from tsc, not my code):
  - `src/app/api/group-orders/[id]/cancel/route.ts(164,44): error TS2339:
    Property 'confirmedOrderId' does not exist on type`
  - `src/app/api/group-orders/[id]/items/[itemId]/route.ts(406,17): error
    TS2322: Type '{ type: "deleted"; ... }' is not assignable to type 'never'`
  These are your fix — I didn't touch them.

- **Task 3A (ConsumerView)** — to wire the GroupOrderScreen into the
  consumer app, add a new `'group-order'` overlay kind to `ui-store.ts` +
  an `openGroupOrder(id)` action + render the screen via dynamic import
  in ConsumerView when `overlay === 'group-order'`. Then update the
  HomeScreen's `onCreated` + RestaurantDetailScreen's `onCreated` to
  call `openGroupOrder(id)` instead of just closing the modal.

- **Task 1B (types.ts)** — please extend the `GroupOrder` interface with:
  - `shareCode: string` (server-returned, used for the share link)
  - `name?: string | null` (host-set name)
  - `restaurantImage?: string | null` (banner image URL)
  Once types.ts is updated, my local `GroupOrderDetail` cast can be
  removed (it's a temporary shim).

- **Task 1C (group-order-store.ts)** — the store uses the older shareCode-
  based contract. The new Task 7A contract is id-based. Consider migrating
  the store to:
  - `refresh(id: string)` → `GET /api/group-orders/[id]`
  - `join(id: string)` → `POST /api/group-orders/[id]/join`
  - `confirm()` → returns `{ orderId, order }` (not just `orderId`)
  Until then, my screens bypass the store + call the API directly.

- **Wave 7C+ (realtime group-order events)** — if the realtime service
  will emit `group-order:updated` events with a `groupOrderId` payload,
  my screen already listens for them. No UI changes needed — just make
  sure the event name matches + the payload includes `groupOrderId`.
  Else my 10s polling will keep the screen fresh on its own.
