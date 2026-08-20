# Task ID: 6C — Wave 6 Gifting Backend (Ghost Order Pattern)

**Agent:** fullstack-developer (Z.ai Code)
**Status:** ✅ COMPLETE
**Date:** Wave 6 Task 6C

## Scope
Implemented the gifting backend per `PRODUCT_IMPLEMENTATION_PLAN.md` Task 6C (lines 1754-1780) + master blueprint §19 FOOD GIFTING. Uses the **ghost order pattern** (plan Decision #3) — sender pays for the gifted item via a "ghost Order" whose `note` encodes `GIFT:${giftId}:for:${recipientId}` so the frontend can filter it out of "My Orders" UI. Recipient redeems by creating a NEW zero-amount Order with `note='GIFT_FROM:${senderId}:${giftId}'`.

## Files Created (5)

1. **`src/lib/gift-service.ts`** (~1100 LOC) — server-side transactional helpers:
   - `createGift(tx, { senderId, recipientId, menuItemId, message, ... })`: loads menu item (validates exists + available + not soft-deleted + restaurant active); validates recipient exists + sender ≠ recipient; creates Gift (status=CREATED) with snapshot (menuItemName + menuItemPrice); creates ghost Order via `tx.order.create` (note encodes `GIFT:${giftId}:for:${recipientId}`); creates demo Payment (status=CAPTURED since realPayments is OFF — skips CAPTURE_PENDING publisher step for gifts per plan MVP scope); creates Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE LedgerEntries; updates ghost Order → PAID; updates Gift → AVAILABLE + paymentId + orderId + expiresAt (30 days from now) + paidAt + availableAt; creates AuditLogs (GIFT_CREATED + PAYMENT_CAPTURED); enqueues Outbox events (GIFT_CREATED + PAYMENT_CAPTURED); creates Notification to recipient (GIFT_RECEIVED).
   - `redeemGift(tx, { giftId, recipientId, ... })`: idempotent — if already REDEEMED, returns existing recipientOrderId; validates status=AVAILABLE (else 409 CONFLICT); lazy expiry check (if expiresAt < now, transitions to EXPIRED + 409); creates NEW zero-amount Order (userId=recipientId, totalAmount=0, pickupOtp=6-digit, note=`GIFT_FROM:${senderId}:${giftId}`, items=[{ menuItemId, name, price=0, quantity=1, subtotal=0 }]); transitions Gift → REDEEMED via `updateMany` with `WHERE status='AVAILABLE'` (optimistic lock — 0 rows affected = concurrent transition → throws CONFLICT to abort txn); creates AuditLogs (GIFT_REDEEMED + ORDER_CREATED); enqueues Outbox events (GIFT_REDEEMED + ORDER_CREATED); creates Notification to sender (GIFT_REDEEMED); records SocialActivity (REDEEMED — best-effort try/catch, never includes payment amount per blueprint §18).
   - `cancelGift(tx, { giftId, senderId, ... })`: idempotent — if already CANCELLED/REFUNDED, returns existing state; validates source status in {CREATED, PAID, AVAILABLE} (else 409); if gift was PAID (paymentId set + Payment.status=CAPTURED): creates Refund record (REFUNDED in demo mode inline + gatewayRefundId=`rpf_demo_<ts>` + refundedAt=now); creates reversal LedgerEntries (DEBIT CONSUMER_REVENUE + CREDIT GATEWAY_RECEIVABLE — mirrors /api/payments/refund route's logic); updates Payment.status → REFUNDED via conditional `updateMany` (optimistic lock on version); updates ghost Order.status → CANCELLED; enqueues Outbox (PAYMENT_REFUNDED); updates Gift → CANCELLED + cancelledAt + refundedAt (if refund processed); creates AuditLog (GIFT_CANCELLED + PAYMENT_REFUNDED); enqueues Outbox (GIFT_CANCELLED); creates Notification to recipient.
   - `expireGifts(tx, options?)`: background-job placeholder — finds AVAILABLE gifts with `expiresAt < now`; transitions each → EXPIRED via conditional `updateMany`; for paid gifts, mirrors cancelGift's refund flow (Refund + reversal LedgerEntries + Payment → REFUNDED + Order → CANCELLED + AuditLog + Outbox + Notification to sender). Idempotent — concurrent job runs are safe.
   - Exports `GIFT_EXPIRY_MS` (30 days) + `GIFT_STATUSES` (union of valid status values) + types (`CreateGiftInput/Result`, `RedeemGiftInput/Result`, `CancelGiftInput/Result`, `ExpireGiftsResult`).

2. **`src/app/api/gifts/route.ts`** (~430 LOC):
   - **GET**: auth required. Returns `{ sent, received }` — gifts sent by + received by the current user. Parallel fetches + batched user-name resolution. Each GiftView includes senderName, senderPhone, recipientName, recipientPhone, menuItemName/Price/Image, restaurantId/Name + all lifecycle timestamps. Read-only (no lazy expiry mutation — dedicated expireGifts() cron handles that).
   - **POST**: body `{ recipientId, menuItemId, message? }` (validated via existing `giftCreateSchema` in `src/lib/validation.ts`). Auth required + RBAC CONSUMER-only. Idempotency-Key header supported (resourceType='Gift'). Delegates to `createGift` service function. Returns `{ gift, order, payment }`.

3. **`src/app/api/gifts/[id]/route.ts`** (~210 LOC):
   - **GET**: auth required. Authorization: only sender OR recipient (403 otherwise); ADMIN/SUPER_ADMIN bypass for audit support. Returns full gift details including sender name, recipient name, menu item details, restaurant details, payment info (if paid), recipient order (if redeemed), ghost order (via payment.orderId). **Redemption code redaction**: if viewer is sender (not recipient), `redemptionCode` is redacted to null (fraud control — sender shouldn't be able to redeem their own gift).

4. **`src/app/api/gifts/[id]/redeem/route.ts`** (~230 LOC):
   - **POST**: auth required. Authorization: caller must be `gift.recipientId` (403 otherwise). Body `{ redemptionCode }` (validated via `giftRedeemSchema`). Extra fraud control: validates the submitted `redemptionCode` matches the gift's stored code (403 on mismatch). Delegates to `redeemGift` service function. Idempotency-Key header supported (resourceType='GiftRedeem'). Returns `{ order, gift }` — the order's `pickupOtp` is included so the recipient can pick up the zero-amount order via the existing `/api/orders/[id]/pickup/verify` endpoint.

5. **`src/app/api/gifts/[id]/cancel/route.ts`** (~210 LOC):
   - **POST**: auth required. Authorization: caller must be `gift.senderId` (403 otherwise); ADMIN/SUPER_ADMIN bypass for incident response. Body: empty (giftId from URL). Delegates to `cancelGift` service function. Idempotency-Key header supported (resourceType='GiftCancel'). Returns `{ gift, refund }` — `refund` is null if the gift was CREATED (not yet paid); otherwise contains the refund id/status/amount.

## Governance Boundaries (PRESERVED)

- ❌ Did NOT touch `src/app/api/payments/route.ts` (POST — payment capture). Ghost order payment is done INLINE within `gift-service.createGift` (mirrors the route's Payment + LedgerEntry + AuditLog + Outbox logic — additive only).
- ❌ Did NOT touch `src/app/api/orders/route.ts` (POST — order creation). Ghost order is created via direct `tx.order.create`, NOT calling the route.
- ❌ Did NOT touch `src/app/api/payments/refund/route.ts` (POST — refund). Gift cancel + expire refunds are done INLINE within `gift-service.cancelGift` + `gift-service.expireGifts` (mirrors the route's Refund + reversal LedgerEntries + AuditLog + Outbox logic — additive only).
- ❌ Did NOT touch fulfilment/pickup governance files (`fulfilment-state.ts`, `pickup-attribution.ts`, `state-invariants.ts`, `reconciliation.ts`, `audit.ts`, `razorpay.ts`, `deployment.ts`).
- ❌ Did NOT modify the Order / Payment / Refund / LedgerEntry / MenuItem / Restaurant / User models.
- ❌ Did NOT modify `prisma/schema.prisma` — Gift model already exists from Task 1A (with all needed fields: senderId, recipientId, menuItemId, menuItemName, menuItemPrice, message, status, redemptionCode @unique, expiresAt, paymentId, recipientOrderId, paidAt, availableAt, redeemedAt, cancelledAt, refundedAt, createdAt, updatedAt + indexes).
- ✅ OWN: 4 new API routes + `gift-service.ts` lib (all 5 files NEW — no existing files modified).

## Architecture Decisions

1. **Demo payment (CAPTURED directly, not CAPTURE_PENDING)** — When `realPayments` feature flag is OFF (default), the gift-service.createGift function creates the Payment record with `status='CAPTURED'` directly + sets `capturedAt=now`. This skips the CAPTURE_PENDING → publisher → CAPTURED flow that the regular /api/payments route uses. Rationale: per plan Decision #3 MVP scope — "skip the CAPTURE_PENDING publisher step for gifts to keep it simple." When realPayments is ON (future), the route should be modified to set CAPTURE_PENDING + enqueue PAYMENT_CAPTURE_REQUESTED for the publisher.

2. **Demo refund (REFUNDED directly, not REFUND_PENDING)** — Same pattern for refunds. When realPayments is OFF, the Refund record is created with `status='REFUNDED'` directly + sets `refundedAt=now` + `gatewayRefundId='rpf_demo_<ts>'`. The Payment is also flipped to `REFUNDED` via conditional `updateMany` (optimistic-lock on version). When realPayments is ON (future), the route should be modified to set REFUND_PENDING + enqueue PAYMENT_REFUND_REQUESTED.

3. **Ghost order pattern** — Sender's payment goes through a "ghost Order" (status=CONFIRMED → PAID → CANCELLED on cancel). The order has `pickupOtp='000000'` (sender never picks up) + `note='GIFT:${giftId}:for:${recipientId}'`. The frontend filters ghost orders out of "My Orders" UI by checking `note.startsWith('GIFT:')` (Task 6D responsibility).

4. **Recipient's zero-amount order** — Recipient redeems by creating a NEW Order with `totalAmount=0`, `userId=recipientId`, `note='GIFT_FROM:${senderId}:${giftId}'`, items=[{ menuItemId, name, price=0, quantity=1, subtotal=0 }]. The recipient picks up this order normally via the existing `/api/orders/[id]/pickup/verify` endpoint (no payment needed — the item was already paid for by the sender).

5. **Idempotency** — All write routes (POST /api/gifts, POST /api/gifts/[id]/redeem, POST /api/gifts/[id]/cancel) support the `Idempotency-Key` header. The cache check happens FIRST inside `withTransaction` (P0-17 pattern — prevents phantom-block). The service functions are pure (take `tx` param) — the routes handle idempotency-cache + auth + RBAC + body validation + delegation.

6. **Optimistic-lock transitions** — Gift status transitions use `tx.gift.updateMany` with `WHERE status = expectedStatus` (conditional update). If a concurrent transaction already transitioned the gift, the update affects 0 rows → throw AppError(CONFLICT) → the transaction rolls back (no orphan orders/payments). Same pattern for Payment CAPTURED → REFUNDED transition (using `version` field for optimistic locking).

7. **Lazy expiry (read-only in GET)** — The GET routes do NOT mutate gift state (no lazy AVAILABLE → EXPIRED transition on read). This preserves read-only idempotency. The dedicated `expireGifts()` background job (cron, Wave 8+) is the primary mechanism; `redeemGift` does a defensive lazy expiry check + transition (since redemption requires a fresh state anyway).

8. **SocialActivity (best-effort)** — `redeemGift` records a `REDEEMED` activity for the recipient's friends feed (blueprint §18 verbs). Metadata NEVER includes payment amount (fraud control per blueprint §18). The write is wrapped in try/catch — a failure doesn't roll back the redemption (best-effort).

9. **Redemption code redaction** — GET /api/gifts/[id] redacts the `redemptionCode` to null when the viewer is the sender (not the recipient). This prevents the sender from redeeming their own gift (fraud control — recipient binding per blueprint §19).

## Validation

- ✅ `bun run lint` — exits 0 (no errors).
- ✅ `bunx tsc --noEmit --skipLibCheck` — ZERO errors in any of the 5 new files. (Pre-existing errors in evidence-verify/test/webhook routes + razorpay.ts/supabase.ts/webhook-processor.ts are unrelated + pre-date this task.)
- ✅ Dev server runs without errors (port 3000). Curl tests:
  - `GET /api/gifts` → HTTP 401 (auth required — correct).
  - `GET /api/gifts/nonexistent-id` → HTTP 401 (auth required — correct).
  - `GET /api/gifts/test-id/redeem` → HTTP 405 (only POST defined — correct).
  - `GET /api/gifts/test-id/cancel` → HTTP 405 (only POST defined — correct).
  - `POST /api/gifts` → HTTP 403 (CSRF token required — middleware blocks before route handler; correct).
  - `POST /api/gifts/test-id/redeem` → HTTP 403 (CSRF — correct).
  - `POST /api/gifts/test-id/cancel` → HTTP 403 (CSRF — correct).
- ✅ Prisma client regenerated (Gift model types verified).
- ✅ Database schema in sync (`prisma db push` confirms "already in sync" — Gift table exists from Task 1A).

## Files Read (Reference)

- `prisma/schema.prisma` — Gift model (Task 1A), Order/Payment/Refund/LedgerEntry/Notification/Outbox/AuditLog models.
- `src/app/api/orders/route.ts` (POST) — order creation contract reference (ghost order pattern; NOT modified).
- `src/app/api/payments/route.ts` (POST) — payment capture logic reference (mirrored inline; NOT modified).
- `src/app/api/payments/refund/route.ts` (POST) — refund logic reference (mirrored inline; NOT modified).
- `src/app/api/vendor/menu/[id]/route.ts` — pattern reference for `[id]` params + `withErrorHandler<unknown>` trick + idempotency-cache pattern.
- `src/app/api/rewards/redeem/route.ts` — pattern reference for auth + RBAC + idempotency + service-function delegation.
- `src/lib/{db,errors,session,validation,idempotency,outbox,deployment,logger,gift-store,razorpay,types}.ts` — used as-is.
- `src/lib/gift-store.ts` (client Zustand store from Task 1C) — READ-only to confirm the wire contract (POST /api/gifts expects `{ recipientId, menuItemId, message? }`, returns `{ gift }`; POST /api/gifts/[id]/redeem expects `{ redemptionCode }`, returns `{ gift }`; POST /api/gifts/[id]/cancel expects empty body, returns `{ gift }`).
- `upload/SNAKZAP_IDE_MASTER_IMPLEMENTATION_BLUEPRINT.md` §19 FOOD GIFTING (gift states + fraud controls).
- `PRODUCT_IMPLEMENTATION_PLAN.md` Task 6C section (lines 1754-1780).

## Coordination Notes for Wave 6+ Tasks

- **Task 6D (Gifting UI)** — owns the `send-gift-flow.tsx` modal + `gifts-screen.tsx`. The wire contract is:
  - `GET /api/gifts` → `{ sent: GiftView[], received: GiftView[] }` (GiftView includes senderName, recipientName, menuItemName, restaurantName, status, redemptionCode, expiresAt, etc.)
  - `POST /api/gifts` body `{ recipientId, menuItemId, message? }` → `{ gift, order, payment }` (status=AVAILABLE).
  - `POST /api/gifts/[id]/redeem` body `{ redemptionCode }` → `{ order: { id, status, pickupOtp, ... }, gift: { id, status, recipientOrderId, redeemedAt } }` (recipient then navigates to OrderTracking for the new zero-amount Order).
  - `POST /api/gifts/[id]/cancel` body `{}` → `{ gift: { id, status: 'CANCELLED', cancelledAt, refundedAt }, refund: { id, status, amount } | null }`.
  - Ghost orders are filtered from "My Orders" UI by checking `order.note?.startsWith('GIFT:')` (the note encodes `GIFT:${giftId}:for:${recipientId}`).
  - Recipient's redeemed orders have `note.startsWith('GIFT_FROM:')` — these are NOT filtered (they're the recipient's actual pickup orders).
  - GET /api/gifts/[id] redacts `redemptionCode` to null when viewer is the sender (Task 6D should hide the redeem button for senders).

- **Task 6A (Social backend — if running in parallel)** — `redeemGift` records a `SocialActivity` (verb=REDEEMED, objectType=Gift). If 6A's SocialActivity model isn't ready yet, the best-effort try/catch will silently no-op (no rollback).

- **Wave 8 (Admin polish)** — the `expireGifts()` background job is a placeholder for the cron job (Wave 8 will wire it up to a real cron runner). The function is idempotent + safe to call repeatedly.

- **Future realPayments rollout** — when `realPayments` feature flag is flipped ON, the gift-service.createGift + cancelGift + expireGifts functions should be modified to:
  1. Set Payment.status=CAPTURE_PENDING + Refund.status=REFUND_PENDING (instead of CAPTURED/REFUNDED directly).
  2. Enqueue PAYMENT_CAPTURE_REQUESTED + PAYMENT_REFUND_REQUESTED outbox events.
  3. The publisher (existing outbox publisher worker) calls captureRazorpayPayment() + refundRazorpayPayment() + transitions the statuses.
  The current demo-mode code is the simplest path that proves the ghost-order pattern end-to-end.

## agent-ctx file
- `/home/z/my-project/agent-ctx/6C-gifts-backend.md` (this file)
