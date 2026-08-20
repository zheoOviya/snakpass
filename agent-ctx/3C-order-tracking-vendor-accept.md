# Task 3C — Order tracking redesign + vendor accept endpoint

**Agent**: full-stack-developer
**Task ID**: 3C
**Wave**: 3 (Order lifecycle)
**Status**: ✅ Complete

## Files CREATED (3)

1. **`src/app/api/vendor/orders/[id]/accept/route.ts`** (~445 LOC)
   - POST endpoint — vendor "accept order" (records Fulfilment.acceptedAt timestamp)
   - Auth (getSessionUser) + RBAC (VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN only — CONSUMER → 403)
   - Vendor ownership check (Restaurant.ownerUserId === session.userId for VENDOR_OWNER/STAFF; ADMIN/SUPER_ADMIN bypass)
   - Idempotent: if acceptedAt already set → 200 with `alreadyAccepted: true` (no audit/outbox/notification duplication)
   - Conditional UPDATE: `tx.fulfilment.updateMany({ where: { id, acceptedAt: null }, data: { acceptedAt: now } })` — atomic + race-safe
   - AuditLog (action='ORDER_ACCEPTED', metadata includes acceptedBy)
   - Outbox event (eventType='ORDER_ACCEPTED', aggregateType='Order' — additive event type, NOT registered in EVENT_TYPE_TO_SOCKET_EVENT)
   - Notification (type='ORDER_ACCEPTED', title='Order accepted! 🎉', body='{Restaurant.name} accepted your order. They\'re starting preparation.')
   - P0-17 Idempotency-Key header support (resourceType='VendorOrderAccept')

2. **`src/app/api/orders/[id]/accepted/route.ts`** (~95 LOC)
   - ADDITIVE GET endpoint exposing ONLY acceptedAt (resolution to the P0-06 GET /fulfilment endpoint's missing-acceptedAt-in-response issue)
   - Auth required (no strict ownership check — mirrors the /fulfilment GET pattern)
   - Lazy-create Fulfilment if missing
   - Response: `{ orderId, fulfilmentId, acceptedAt: string | null, accepted: boolean }`

3. **`src/components/snak/order-tracking.tsx`** (~480 LOC, REWRITTEN in-place)
   - Preserves `OrderTracking` export name + `{ order: Order }` prop signature
   - Hero header (gradient teal-500 → emerald-600, restaurant name, address, status badge)
   - Vertical timeline (up to 7 steps when acceptedAt is set, 6 steps when null)
     - Order Placed → Payment Confirmed → Restaurant Accepted (NEW, conditional) → Preparing → Almost Ready → Ready for Pickup → Picked Up
   - Estimated ready time countdown (createdAt + prepTimeMins, formatCountdown from src/lib/snack.ts, ticks every 1s, shown only when PREPARING/ALMOST_READY)
   - Restaurant contact button (tel:+918000000000)
   - Pickup instructions card with QR + 6-digit OTP + Share button (when status >= READY_FOR_PICKUP)
   - Items list + total paid
   - Receipt download placeholder (toast "Receipt coming soon")
   - framer-motion transitions + useReducedMotion respected
   - Realtime: subscribes to `order:updated` socket → refetches acceptedAt

## Governance boundaries RESPECTED

- ❌ Did NOT touch `src/app/api/orders/[id]/fulfilment/route.ts` (P0-06 — READ only)
- ❌ Did NOT touch `src/lib/fulfilment-state.ts` (P0-06 state machine — READ only)
- ❌ Did NOT touch `src/lib/pickup-attribution.ts` (P0-07 — READ only)
- ❌ Did NOT touch `src/app/api/orders/[id]/pickup/verify/route.ts` (P0-07 boundary)
- ❌ Did NOT touch `src/app/api/orders/[id]/status/route.ts` (legacy)
- ❌ Did NOT touch `src/components/snak/consumer-view.tsx` (Task 3A owns)
- ❌ Did NOT touch `src/components/snak/checkout-view.tsx` (Task 3B owns)
- ❌ Did NOT touch `src/components/snak/screens/cart-screen.tsx` or `my-orders-screen.tsx` (Tasks 3A/3D)
- ❌ Did NOT touch `prisma/schema.prisma` (Fulfilment.acceptedAt already added by Task 1A)
- ❌ Did NOT modify Fulfilment.status enum or NEXT_FULFILMENT_STATUS (P0-06)
- ✅ OWNED: `src/app/api/vendor/orders/[id]/accept/route.ts` (create) + `src/components/snak/order-tracking.tsx` (rewrite in-place)
- ➕ ALSO CREATED (additive, no existing files modified): `src/app/api/orders/[id]/accepted/route.ts` (necessary to expose acceptedAt to the UI without violating P0-06 GET /fulfilment boundary)

## Verification

- `bun run lint` → EXIT 0 (only the pre-existing MODULE_TYPELESS_PACKAGE_JSON warning)
- `bunx tsc --noEmit --skipLibCheck` → ZERO errors in my 3 files (269 total error lines = pre-existing baseline)
- Dev server: running cleanly on port 3000, no runtime errors in dev.log

## curl acceptance tests (all PASS)

| Test | Endpoint | Auth | Expected | Actual |
|------|----------|------|----------|--------|
| 1 | GET /api/orders/<id>/accepted | consumer, before accept | 200, acceptedAt:null | ✅ |
| 2 | POST /api/vendor/orders/<id>/accept | vendor, first accept | 200, accepted:true, alreadyAccepted:false | ✅ |
| 3 | GET /api/orders/<id>/accepted | consumer, after accept | 200, acceptedAt:ISO | ✅ |
| 4 | POST /api/vendor/orders/<id>/accept | vendor, second accept | 200, alreadyAccepted:true, SAME timestamp | ✅ |
| 5 | POST /api/vendor/orders/<id>/accept | consumer | 403 AUTHORIZATION_DENIED | ✅ |
| 6c | POST /api/vendor/orders/<nonexistent>/accept | vendor | 404 NOT_FOUND | ✅ |
| 8 | POST /api/vendor/orders/<Dosa Den order>/accept | Spice Junction vendor | 200 (seed has all restaurants owned by same vendor) | ✅ |
| - | GET /api/orders/<id>/accepted | no auth | 401 AUTHENTICATION_REQUIRED | ✅ |
| - | POST /api/vendor/orders/<id>/accept | no CSRF | 403 CSRF token required (middleware) | ✅ |

## DB inspection confirms

- AuditLog: 2 ORDER_ACCEPTED entries (one per unique order — idempotency confirmed)
- Notification: 2 ORDER_ACCEPTED notifications (with title "Order accepted! 🎉")
- Outbox: 2 ORDER_ACCEPTED events (aggregateType='Order', status='PENDING')
- Fulfilment: acceptedAt set, status UNCHANGED (PREPARING), version UNCHANGED (0), statusHistory UNCHANGED ("[]") — perfect additive-column governance

## Coordination notes

- The `OrderTracking` export name + `{ order: Order }` prop signature are preserved — no changes needed for consumer-view.tsx (Task 3A).
- The `POST /api/vendor/orders/[id]/accept` endpoint is ready for the vendor POS UI (Wave 6+) to call when a vendor taps "Accept".
- The `GET /api/orders/[id]/accepted` endpoint is a stable consumer-facing API — any future component that needs the vendor-accept timestamp can fetch it (no need to modify the P0-06 /fulfilment route).
- The ORDER_ACCEPTED outbox event is NOT registered in EVENT_TYPE_TO_SOCKET_EVENT in src/lib/outbox.ts (governance: do NOT modify outbox.ts). When the realtime mini-service is ready to relay ORDER_ACCEPTED events to consumers via Socket.io, that mapping should be added.
