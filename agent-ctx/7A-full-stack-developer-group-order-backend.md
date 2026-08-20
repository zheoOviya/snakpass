# Task ID: 7A — Group order backend (full implementation)

**Wave**: 7 (Group ordering) — Task 7A: Group order backend (Model A: host pays)
**Agent**: full-stack-developer (Z.ai Code)
**Status**: ✅ COMPLETE
**Date**: 2026-08-20

## Summary
Implemented the complete group order backend per `PRODUCT_IMPLEMENTATION_PLAN.md`
Task 7A (lines 1815-1845) + master blueprint §20 GROUP ORDERING (Model A — host
creates → share link → friends join → each selects items → host confirms →
single merchant order → host pays). 7 new API routes under `/api/group-orders`
+ 1 new lib file (`src/lib/group-order-service.ts`). All governance boundaries
respected (NO existing files modified; NO money-state tables touched; NO order
route touched).

## Files CREATED (8)

1. **`src/lib/group-order-service.ts`** (~600 LOC) — server-side transactional
   helpers:
   - `generateShareCode()`: 6-char alphanumeric (excludes ambiguous 0/O/1/I/L).
     Uses `crypto.randomBytes` (NOT Math.random — predictable seed = guessable
     codes). 31-char alphabet → 31^6 ≈ 887M combinations. Collisions handled by
     withTransaction's P2002 retry (a fresh code is generated on each retry).
   - `createGroupOrder(tx, { hostId, hostRole, restaurantId, name?, traceId? })`:
     validates restaurant exists + isActive + !isSuspended; creates GroupOrder
     (status=OPEN, shareCode, closesAt=now+24h, version=0); adds host as first
     GroupOrderMember; AuditLog GROUP_ORDER_CREATED; Outbox GROUP_ORDER_CREATED;
     SocialActivity JOINED_GROUP (best-effort).
   - `confirmGroupOrder(tx, { groupOrderId, hostId, hostRole, hostName?, traceId? })`:
     idempotent — if already CONFIRMED + confirmedOrderId set, returns the
     existing Order WITHOUT creating a duplicate. Validates status=OPEN (409
     otherwise). Loads all GroupOrderItems across all members; merges by
     menuItemId (sum quantities, sum subtotals across rows for the same
     menuItemId — preserves per-row snapshot prices). Creates a single merged
     Order: userId=hostId, restaurantId=groupOrder.restaurantId, status=CONFIRMED,
     totalAmount, pickupOtp=6-digit, itemsCount, note=`GROUP_ORDER:${groupOrderId}`,
     orderItems created from the merged list. Optimistic-lock transition
     GroupOrder → CONFIRMED via conditional `updateMany` (WHERE id=X AND
     version=Y AND status='OPEN' — 0 rows affected = race → throw CONFLICT).
     AuditLog GROUP_ORDER_CONFIRMED + ORDER_CREATED; Outbox GROUP_ORDER_CONFIRMED
     + ORDER_CREATED; Notification to all members (createMany — bulk insert):
     "Group order confirmed by {hostName}! 🎉".

2. **`src/app/api/group-orders/route.ts`** (~430 LOC):
   - **GET**: auth required. Returns `{ groupOrders: [...] }` — group orders
     where the user is host OR member. Sorted newest first. Each GroupOrderListView
     includes hostName, restaurantName, restaurantImageUrl, memberCount,
     myItemCount, totalItems, all lifecycle timestamps. Batched user-name
     resolution (single `findMany` for all hostIds).
   - **POST**: body `{ restaurantId, name? }`. Auth required + RBAC CONSUMER-only.
     Idempotency-Key header supported (resourceType='GroupOrder'). Delegates to
     `createGroupOrder`. Returns `{ groupOrder: { id, hostId, restaurantId,
     status: 'OPEN', shareCode, shareUrl, closesAt, name, ... } }`.

3. **`src/app/api/group-orders/[id]/route.ts`** (~250 LOC):
   - **GET**: auth required. Authorization: caller must be host OR member
     (403 otherwise); ADMIN/SUPER_ADMIN bypass for audit support. Returns full
     details including members (with names + avatar colors via
     `avatarColorForUserId`), myItems (current user's items), allItems (all
     members' items with userName), and totals (memberCount, mySubtotalPaise,
     totalPaise, totalItems).

4. **`src/app/api/group-orders/[id]/join/route.ts`** (~340 LOC):
   - **POST**: body `{ shareCode?: string }`. If shareCode is provided, lookup
     by shareCode (URL [id] ignored — useful for deep links like
     `/group/[shareCode]` → POST /api/group-orders/join-id/join). Else use URL
     [id] as the groupOrderId. Auth required + RBAC CONSUMER-only (admin
     bypass). Validates: status=OPEN (409 if CONFIRMED/CANCELLED), closesAt >
     now (410 Gone if expired). Idempotent — if user is already a member,
     returns existing membership WITHOUT creating a duplicate. Adds
     GroupOrderMember; AuditLog GROUP_ORDER_JOINED; Outbox GROUP_ORDER_JOINED;
     SocialActivity JOINED_GROUP (best-effort).

5. **`src/app/api/group-orders/[id]/items/route.ts`** (~440 LOC):
   - **GET**: auth required + member-only. Returns `{ items: [...], totals }`
     — current user's items in the group order (with pricePaise + subtotalPaise).
   - **POST**: body `{ menuItemId, quantity }` (name + price are looked up
     server-side — NOT trusted from the client). Optional name + price in body
     are accepted for backward-compat with the existing client store (Wave 1C)
     but ignored. Validates menu item exists + !deletedAt + belongs to the
     group order's restaurant + isAvailable. Cart-merge semantics — if user
     already has an item with the same menuItemId, INCREMENT quantity (atomic
     inside the same transaction); else create new GroupOrderItem (with name +
     price snapshot from the DB). Idempotency-Key supported
     (resourceType='GroupOrderItem'). AuditLog GROUP_ORDER_ITEM_ADDED.

6. **`src/app/api/group-orders/[id]/items/[itemId]/route.ts`** (~430 LOC):
   - **PATCH**: body `{ quantity }`. Auth required + owner-only (item.userId
     === session.userId, 403 otherwise; ADMIN/SUPER_ADMIN bypass). Updates
     quantity; preserves the price snapshot (NOT refreshed from the menu item —
     captured at add time). Idempotency-Key supported
     (resourceType='GroupOrderItemUpdate'). AuditLog GROUP_ORDER_ITEM_UPDATED.
   - **DELETE**: auth required + owner-only. Removes the item. Idempotent —
     deleting a non-existent item is a no-op (200 with the itemId). AuditLog
     GROUP_ORDER_ITEM_REMOVED.

7. **`src/app/api/group-orders/[id]/confirm/route.ts`** (~280 LOC):
   - **POST**: body empty. Auth required + host-only (403 otherwise; ADMIN/
     SUPER_ADMIN bypass). Delegates to `confirmGroupOrder` service function.
     Idempotent: if already CONFIRMED, returns the existing confirmed Order
     (service-function check) + an Idempotency-Key header is ALSO supported
     (resourceType='GroupOrderConfirm') for client-side retry-safety. Returns
     `{ order: { id, status, totalAmount, pickupOtp, itemsCount, note,
     restaurantId, userId, createdAt }, groupOrder: { id, status: 'CONFIRMED',
     confirmedOrderId, confirmedAt, version }, created: boolean }`.

8. **`src/app/api/group-orders/[id]/cancel/route.ts`** (~330 LOC):
   - **POST**: body empty. Auth required + host-only (403 otherwise; ADMIN/
     SUPER_ADMIN bypass). Validates status — must be OPEN (409 if CONFIRMED —
     host must cancel the underlying Order via the existing order-cancel flow
     instead). Optimistic-lock transition GroupOrder → CANCELLED via conditional
     `updateMany` (WHERE id=X AND version=Y AND status='OPEN' — 0 rows = race →
     409). Idempotent: if already CANCELLED, returns existing state without
     re-notifying members. Idempotency-Key supported
     (resourceType='GroupOrderCancel'). AuditLog GROUP_ORDER_CANCELLED;
     Outbox GROUP_ORDER_CANCELLED; Notification to all members (createMany):
     "Group order cancelled by {hostName}." Returns `{ groupOrder: { id,
     status: 'CANCELLED', cancelledAt, version } }`.

## Governance Boundaries (PRESERVED)

- ❌ Did NOT touch `src/app/api/orders/route.ts` (POST — order creation). The
  confirm endpoint creates the merged Order via direct `tx.order.create`
  inside `confirmGroupOrder` (additive only — mirrors the /api/orders POST
  pattern but without the idempotency/outbox indirection; the group-order
  confirm endpoint itself is idempotent via the GroupOrder.status check).
- ❌ Did NOT touch `src/app/api/payments/route.ts` (POST — payment capture).
  Host pays via the existing route on the confirmed Order.
- ❌ Did NOT touch fulfilment/pickup governance files
  (`fulfilment-state.ts`, `pickup-attribution.ts`, `state-invariants.ts`,
  `reconciliation.ts`, `razorpay.ts`, `deployment.ts`).
- ❌ Did NOT touch `prisma/schema.prisma` — GroupOrder, GroupOrderMember,
  GroupOrderItem models were created in Task 1A (with all needed fields:
  hostId, restaurantId, status, shareCode @unique, closesAt, confirmedAt,
  confirmedOrderId, version, name + GroupOrderMember @@unique([groupOrderId,
  userId]) + GroupOrderItem composite FK to GroupOrderMember).
- ✅ OWN: 7 new API routes + `group-order-service.ts` lib (all 8 files NEW —
  no existing files modified).

## Architecture Decisions

1. **Model A only (host pays)** — Per blueprint §20 + plan §7A, the first
   implementation is Model A: host creates → share link → friends join → host
   confirms → host pays the single merged Order via the existing
   /api/payments route. Split payment (Model B) is deferred.

2. **Direct `tx.order.create` inside `withTransaction` (NOT calling /api/orders
   POST)** — Per plan Decision #4, the confirm endpoint creates the merged
   Order directly inside the same transaction as the GroupOrder.status
   transition. This avoids modifying the /api/orders POST route (governance
   protected) while preserving atomicity (the Order + GroupOrder status
   transition + audit log + outbox events + notifications all commit
   atomically or roll back together). The confirm endpoint itself is
   idempotent via the GroupOrder.status check (already CONFIRMED → return
   existing Order).

3. **Optimistic lock on GroupOrder.version** — The confirm + cancel
   transitions use conditional `tx.groupOrder.updateMany` with
   `WHERE id=X AND version=Y AND status='OPEN'`. If 0 rows are affected, a
   concurrent transition won the race → throw CONFLICT. withTransaction's
   retry loop re-attempts; the second attempt either hits the idempotent
   branch (if the first committed) or re-attempts the transition (if the first
   rolled back). This pattern is identical to the gift-service's optimistic-
   lock transitions.

4. **Cart-merge semantics** — When a user adds a menu item they already have
   in the group cart, the quantity is INCREMENTED (NOT a new row). This
   matches the client store's optimistic update pattern (Wave 1C). The merge
   is atomic inside the same transaction (no race between the read + the
   update). The price snapshot is captured at first add (NOT refreshed on
   merge — preserves the original price even if the menu item's price changed
   in the meantime).

5. **Server-side menu item lookup (NOT trusted from client)** — Per the
   task spec, the POST items endpoint accepts only `{ menuItemId, quantity }`.
   The server looks up the menu item from the DB and validates:
   - exists + !deletedAt (404 NOT_FOUND)
   - belongs to the group order's restaurant (400 VALIDATION_ERROR)
   - isAvailable (400 VALIDATION_ERROR)
   The name + price are snapshot from the DB (NOT trusted from the client).
   For backward-compat with the existing client store (Wave 1C, which sends
   name + price in the body), the schema accepts optional name + price
   fields — they're ignored (DB lookup is authoritative) but their presence
   doesn't fail validation.

6. **`note='GROUP_ORDER:${groupOrderId}'` pattern** — The merged Order's
   `note` encodes `GROUP_ORDER:${groupOrderId}` so the frontend can filter
   it out of "My Orders" UI by checking `note.startsWith('GROUP_ORDER:')`.
   This mirrors the ghost-order pattern used by gifts
   (`note='GIFT:${giftId}:for:${recipientId}'`). Task 7B (UI) will use this
   to filter.

7. **Idempotency** — POST /api/group-orders, POST /api/group-orders/[id]/items,
   PATCH /api/group-orders/[id]/items/[itemId], POST /api/group-orders/[id]/
   confirm, POST /api/group-orders/[id]/cancel all support the
   `Idempotency-Key` header (P0-17 pattern — cache check FIRST inside
   withTransaction to prevent phantom-block). The confirm + cancel endpoints
   are ALSO idempotent via the GroupOrder.status check (already CONFIRMED →
   return existing Order; already CANCELLED → return existing state) — so
   they work correctly even without an Idempotency-Key header.

8. **Best-effort SocialActivity** — `createGroupOrder` records a JOINED_GROUP
   activity for the host (host joining their own group is the first feed
   entry). `join` records a JOINED_GROUP activity for the friend. Both are
   wrapped in try/catch — failure to record the activity does NOT roll back
   the group operation (the feed is non-critical).

9. **Notification bulk-insert (createMany)** — The confirm + cancel endpoints
   send notifications to all members via a single `tx.notification.createMany`
   call (bulk insert — one SQL statement for N rows). This is more efficient
   than N individual inserts for groups with many members.

## Acceptance criteria — ALL PASS

- [x] `POST /api/group-orders { restaurantId }` creates a GroupOrder
  (status=OPEN + 6-char shareCode + closesAt = createdAt + 24h + host as
  first member). Verified: returns status=OPEN, shareCode="NYJ24W",
  closesAt = createdAt + 86400000ms.
- [x] `POST /api/group-orders/[id]/join` adds user as member (if not already).
  Verified: friend joined via shareCode in body — created GroupOrderMember;
  re-join returned existing membership (idempotent).
- [x] `POST /api/group-orders/[id]/items { menuItemId, quantity }` adds to
  user's cart. Verified: server looked up name (Cappuccino) + price (10000
  paise) from DB; returned item with subtotalPaise=20000.
- [x] `PATCH /api/group-orders/[id]/items/[itemId] { quantity }` updates user's
  item. Verified: quantity 2 → 3, subtotalPaise 20000 → 30000.
- [x] `POST /api/group-orders/[id]/confirm` (host only) creates single merged
  Order. Idempotent. Verified: 2 members (host + friend), host added 2 Cold
  Coffee (12000 paise each = 24000) + friend added 1 Cappuccino (10000 paise)
  → merged Order with totalAmount=34000, itemsCount=3, 2 OrderItem rows
  (Cold Coffee qty=2 + Cappuccino qty=1). Re-confirm returned same orderId
  with `created: false`.
- [x] `POST /api/group-orders/[id]/cancel` (host only) sets CANCELLED.
  Verified: status → CANCELLED, version 0 → 1. Re-cancel returned CANCELLED
  state (idempotent). Cancel on CONFIRMED returned 409 with hint to use
  order-cancel flow.
- [x] `bun run lint` exits 0 on all new files (zero errors, zero warnings).
- [x] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in the new
  files. (Pre-existing errors in protected/out-of-scope files: razorpay.ts,
  state-invariants.ts, supabase.ts, webhook-processor.ts, errors.ts,
  pickup-attribution.ts — ALL preserved unchanged. My 8 files contribute
  ZERO new errors.)
- [x] Dev server runs without errors (port 3000). Curl tests:
  - `GET /api/group-orders` → HTTP 401 (auth required — correct).
  - `GET /api/group-orders/nonexistent-id` → HTTP 401 (auth required).
  - `POST /api/group-orders` → HTTP 403 (CSRF token required — middleware
    blocks before route handler; correct).
  - `POST /api/group-orders/x/join` → HTTP 403 (CSRF).
  - `POST /api/group-orders/x/items` → HTTP 403 (CSRF).
  - `PATCH /api/group-orders/x/items/y` → HTTP 403 (CSRF).
  - `DELETE /api/group-orders/x/items/y` → HTTP 403 (CSRF).
  - `POST /api/group-orders/x/confirm` → HTTP 403 (CSRF).
  - `POST /api/group-orders/x/cancel` → HTTP 403 (CSRF).
  - Authenticated end-to-end flow (host + friend): create → join → both add
    items → host confirms → verified merged Order (totalAmount=34000,
    itemsCount=3) → re-confirm idempotent → cancel on CONFIRMED returns 409.
  - Authenticated end-to-end cancel flow: create → cancel → re-cancel
    idempotent.
  - Friend tries to PATCH host's item → 403 (owner-only).
  - Friend tries to DELETE host's item → 403.
  - Friend tries to confirm → 403 (host-only).
  - Friend tries to cancel → 403 (host-only).

## Validation

- ✅ `bun run lint` (full project) → EXIT 0. Only the pre-existing
  MODULE_TYPELESS_PACKAGE_JSON warning about
  eslint-rules/no-external-call-in-transaction.js (project-level, NOT mine).
- ✅ `bunx tsc --noEmit --skipLibCheck | grep -E "group-order"` → ZERO matches
  (ZERO new errors in any of my 8 files).
- ✅ Dev server runs cleanly on port 3000 — all 8 routes registered + return
  expected status codes (401 for GETs without auth, 403 for POST/PATCH/DELETE
  without CSRF, 200 for authenticated requests).
- ✅ End-to-end authenticated test: host creates → friend joins via shareCode
  → both add items → host confirms → verified merged Order with items from
  both members (totalAmount + itemsCount correct) → re-confirm idempotent.
- ✅ Cancel flow: create → cancel → re-cancel idempotent → cancel on CONFIRMED
  returns 409 with hint.
- ✅ Authorization: friend cannot PATCH/DELETE host's items (403); friend
  cannot confirm/cancel (403).

## Coordination Notes for Wave 7+ Tasks

- **Task 7B (Group order UI)** — owns the `group-order-screen.tsx` +
  `create-group-order-flow.tsx`. The wire contract is:
  - `GET /api/group-orders` → `{ groupOrders: GroupOrderListView[] }`
    (each includes hostName, restaurantName, restaurantImageUrl, memberCount,
    myItemCount, totalItems, status, shareCode, shareUrl, closesAt,
    confirmedAt, confirmedOrderId, name, createdAt, updatedAt).
  - `POST /api/group-orders` body `{ restaurantId, name? }` → `{ groupOrder:
    { id, hostId, restaurantId, status: 'OPEN', shareCode, shareUrl, closesAt,
    name, ... } }`.
  - `GET /api/group-orders/[id]` → `{ groupOrder, members, myItems, allItems,
    totals }` — each member has userName + userAvatarColor; each item has
    pricePaise + subtotalPaise.
  - `POST /api/group-orders/[id]/join` body `{ shareCode? }` → `{ groupOrder,
    member }`. (URL [id] can be a dummy like "join-id" when shareCode is in
    the body — useful for deep links like `/group/[shareCode]`.)
  - `POST /api/group-orders/[id]/items` body `{ menuItemId, quantity }` →
    `{ item: { id, ..., pricePaise, quantity, subtotalPaise, merged } }`.
    `merged: true` means the item was already in the cart + the quantity was
    incremented (the UI can use this to decide whether to scroll to the
    existing item or show a "new item added" toast).
  - `PATCH /api/group-orders/[id]/items/[itemId]` body `{ quantity }` →
    `{ item: { ..., quantity, subtotalPaise } }`.
  - `DELETE /api/group-orders/[id]/items/[itemId]` → `{ deleted: true, item:
    { id }, alreadyDeleted: boolean }`.
  - `POST /api/group-orders/[id]/confirm` → `{ order: { id, status, totalAmount,
    pickupOtp, itemsCount, note, restaurantId, userId, createdAt }, groupOrder:
    { id, status: 'CONFIRMED', confirmedOrderId, confirmedAt, version },
    created: boolean }`. UI should navigate to CheckoutView with the
    `order.id` (host pays via the existing /api/payments POST route).
  - `POST /api/group-orders/[id]/cancel` → `{ groupOrder: { id, status:
    'CANCELLED', cancelledAt, version } }`.
- **Existing client store (Wave 1C group-order-store.ts)** — uses a slightly
  different wire contract (`POST /api/group-orders/join?shareCode=X` with no
  body; POST items with `{ menuItemId, name, price, quantity }`; confirm
  returns `{ orderId, groupOrder }`). Task 7B should reconcile the store with
  the new spec-compliant routes (the routes ACCEPT the existing store's
  optional name/price fields for backward-compat, but the URL for join
  changed — the store uses `/api/group-orders/join?shareCode=X` while the new
  route is `/api/group-orders/[id]/join` with shareCode in the body).

## Files Read (Reference)

- `prisma/schema.prisma` — GroupOrder, GroupOrderMember, GroupOrderItem
  (Task 1A), Order, OrderItem, MenuItem, Restaurant, User, AuditLog,
  Notification, Outbox models.
- `src/app/api/orders/route.ts` (POST) — order creation contract reference
  (mirrored inline via `tx.order.create` inside `confirmGroupOrder` — NOT
  modified).
- `src/app/api/gifts/route.ts` + `src/app/api/gifts/[id]/route.ts` + `gifts/[id]/cancel/route.ts` — pattern reference
  for service-function delegation + idempotency-cache + exhaustive switch.
- `src/lib/gift-service.ts` — pattern reference for `tx.order.create` inside
  withTransaction + outbox + audit log + notification createMany.
- `src/lib/{db,errors,session,validation,idempotency,outbox,deployment,logger,
  realtime,social-activity}.ts` — used as-is.
- `src/lib/group-order-store.ts` (Wave 1C client store) — READ-only to
  confirm the existing wire contract (POST items with name/price — my schema
  accepts these as optional for backward-compat; URL for join differs — Task
  7B will reconcile).
- `upload/SNAKZAP_IDE_MASTER_IMPLEMENTATION_BLUEPRINT.md` §20 GROUP ORDERING
  (Model A flow).
- `PRODUCT_IMPLEMENTATION_PLAN.md` Task 7A section (lines 1815-1845).
- `src/middleware.ts` — confirmed CSRF + rate-limit gates on POST/PATCH/DELETE.
