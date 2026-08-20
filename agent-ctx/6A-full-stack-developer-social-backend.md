# Task ID: 6A — Social backend (full implementation)

**Wave**: 6 (Social + Gifting) — Task 6A: Social backend
**Date**: 2026-08-20
**Agent**: full-stack-developer

## Summary
Implemented the complete social backend for SnakZap: 5 new API routes under
`/api/social/*` (connections, feed, search, activities) + 1 new lib file
(`src/lib/social-activity.ts`) + 1 additive modification to
`src/app/api/rewards/on-picked-up/route.ts` (record EARNED_REWARD activity).

## Files CREATED (6)

1. **`src/lib/social-activity.ts`** — VERBS constant, sanitizeActivityMetadata
   (defense-in-depth recursive strip of sensitive keys), recordActivity
   (transactional helper), avatarColorForUserId (deterministic FNV-1a hash
   → 8-color palette).

2. **`src/app/api/social/connections/route.ts`** — GET (list accepted friends +
   pending requests both directions) + POST (send friend request: PENDING
   SocialConnection + Notification + AuditLog).

3. **`src/app/api/social/connections/[id]/route.ts`** — PATCH (accept/block/
   reject; on ACCEPT creates reverse edge in same txn → bidirectional
   friendship) + DELETE (unfriend OR block via body `{ block: true }`).

4. **`src/app/api/social/feed/route.ts`** — GET paginated friend activity feed
   (page/limit query params, sanitize metadata on READ).

5. **`src/app/api/social/search/route.ts`** — GET search users by name/phone
   (excludes self + already-connected).

6. **`src/app/api/social/activities/route.ts`** — POST record activity
   (rejects sensitive metadata keys with 400 SENSITIVE_DATA_IN_METADATA;
   Idempotency-Key header supported).

## Files MODIFIED (1 — additive only)

7. **`src/app/api/rewards/on-picked-up/route.ts`** — ADDITIVE: after the audit
   log write, records an EARNED_REWARD SocialActivity via recordActivity(tx, ...)
   when totalPointsIssued > 0. Idempotency key
   `ORDER_PICKED_UP:${orderId}:EARNED_REWARD` ensures retry-safety.

## Acceptance criteria — ALL PASS
- [x] POST /api/social/connections creates PENDING SocialConnection + sends
      Notification to followee.
- [x] PATCH /api/social/connections/[id] { status:'ACCEPTED' } accepts +
      creates reverse edge in same txn.
- [x] DELETE /api/social/connections/[id] removes both rows (unfriend).
- [x] GET /api/social/feed?page=1&limit=20 returns activities from accepted
      friends, paginated, NEVER exposes payment amounts.
- [x] GET /api/social/search?q= returns matching users (excludes self +
      already-connected).
- [x] POST /api/social/activities records an activity with sanitized metadata
      (rejects sensitive keys).
- [x] rewards/on-picked-up records EARNED_REWARD activity (additive).
- [x] bun run lint exits 0 on all new/modified files.
- [x] bunx tsc --noEmit --skipLibCheck shows ZERO new errors in my files
      (174 total pre-existing errors; 0 in src/app/api/social/*, src/lib/
      social-activity.ts, src/app/api/rewards/on-picked-up/route.ts).
- [x] Dev server runs without errors (verified via curl + dev.log inspection).

## End-to-end test results (curl)
- POST /api/social/connections (followeeId) → 201 PENDING_SENT
- Duplicate POST → 409 CONFLICT (existing PENDING)
- PATCH { status:'ACCEPTED' } as sender (not followee) → 403 NOT_FOLLOWEE
- PATCH { status:'ACCEPTED' } as followee → 200 ACCEPTED (+ reverse edge
  created in same txn)
- DELETE → 200 unfriended (both rows deleted)
- GET /api/social/connections → returns accepted friends + pending requests
- GET /api/social/feed?page=1&limit=10 → returns sanitized activity entries
- GET /api/social/search?q=Spice → returns matching users (excluding self +
  connected)
- POST /api/social/activities with metadata containing amount/total/price/
  paymentId/razorpayPaymentId/razorpaySignature → 400 SENSITIVE_DATA_IN_METADATA
- POST /api/social/activities with valid metadata → 201 created
- POST /api/social/activities with Idempotency-Key, retry → returns same activity
- POST /api/rewards/on-picked-up as vendor → 200 (issued rewards + recorded
  EARNED_REWARD activity with metadata {points, rules, newBalance} — NO
  sensitive keys)
- POST /api/rewards/on-picked-up retry → 200 alreadyIssued:true (no duplicate
  activity — early-exit path before activity recording)

## Governance boundaries RESPECTED
- ❌ Did NOT touch src/app/api/orders/route.ts (POST) — preserved verbatim.
- ❌ Did NOT touch src/app/api/orders/[id]/fulfilment/route.ts (P0-06).
- ❌ Did NOT touch any payment/refund route (src/app/api/payments/*, src/app/api/
  webhooks/*).
- ❌ Did NOT touch prisma/schema.prisma (Task 1A created SocialConnection +
  SocialActivity + Notification).
- ❌ Did NOT touch src/lib/deployment.ts, razorpay.ts, reconciliation.ts,
  pickup-attribution.ts, fulfilment-state.ts, state-invariants.ts.
- ✅ OWNED: 5 new API routes + social-activity.ts lib + additive
  rewards/on-picked-up (record EARNED_REWARD activity).

## Coordination notes for Wave 6+ tasks
- **Task 6B (Social UI)** — the backend is ready to be consumed:
  - GET /api/social/connections → drives the friends list + pending requests.
    Note: response shape is `{ connections: [{ id, userId, name, phone,
    avatarColor, status, direction, message, createdAt, acceptedAt }] }`.
    `status` is normalized to ACCEPTED/PENDING_SENT/PENDING_RECEIVED/BLOCKED.
    `direction` is 'sent' | 'received' for pending requests.
  - GET /api/social/feed?page=1&limit=20 → drives the activity feed.
  - GET /api/social/search?q= → drives the user search bar.
  - POST /api/social/connections { followeeId } → send friend request.
  - PATCH /api/social/connections/[id] { status: 'ACCEPTED' | 'BLOCKED' |
    'REJECTED' } → accept/block/reject.
  - DELETE /api/social/connections/[id] (or with body `{ block: true }`) →
    unfriend (or block).
  - POST /api/social/activities → record an activity (called by consumer-view
    after order creation, gift creation, group join, etc.).
  - **IMPORTANT**: The existing `src/lib/social-store.ts` (Wave 1C) uses
    `targetUserId` + `action: 'ACCEPT' | 'REJECT'`. The new endpoints ACCEPT
    BOTH shapes (alias) for backward compat — but the spec-recommended shape
    is `followeeId` + `status: 'ACCEPTED' | 'BLOCKED' | 'REJECTED'`. Task 6B
    should update social-store.ts to use the spec-recommended shape.
  - **IMPORTANT**: The existing `social-feed-card.tsx` (Wave 1B) verb map uses
    lowercase verbs (`ordered_from`, `earned_reward`, etc.). The new endpoints
    use UPPERCASE verbs (ORDERED, EARNED_REWARD, GIFTED, JOINED_GROUP,
    FRIEND_ADDED) per spec + schema comment. Task 6B should update the verb map
    OR add a mapping layer.

- **Task 6C (Gifting backend)** — when recording GIFTED activities, use
  `recordActivity(tx, { actorId: senderId, verb: 'GIFTED', objectType: 'Gift',
  objectId: giftId, metadata: { menuItemName, recipientName }, visibility:
  'FRIENDS' })`. NEVER include `menuItemPrice` or `amount` (those are sensitive
  keys — would be stripped on READ but should also be absent on WRITE per
  defense-in-depth).

- **Task 6D (Gifting UI)** — the gifting activity verb is `GIFTED` (uppercase).

## Issues encountered + resolved
1. **Existing social-store.ts contract mismatch** — Wave 1C social-store.ts
   used `targetUserId` + `action: 'ACCEPT'|'REJECT'|'BLOCK'`. The task spec
   for 6A says `followeeId` + `status: 'ACCEPTED'|'BLOCKED'|'REJECTED'`. To
   avoid breaking the existing client, I ACCEPT BOTH shapes (alias — `status`
   takes precedence when present, falls back to `action` mapping). Task 6B
   will own updating social-store.ts to the spec-recommended shape.

2. **No avatarColor column in User model** — the schema doesn't have an
   avatarColor field (and the task spec forbids schema modifications).
   Computed server-side via FNV-1a hash of userId → 8-color palette
   (teal/emerald/amber/rose/violet/orange/pink/fuchsia). Stable across
   pages + sessions. Same approach used by GET /connections, /feed, /search.

3. **Sensitive metadata detection** — the activities POST endpoint detects
   sensitive keys recursively (case-insensitive) and rejects with 400
   SENSITIVE_DATA_IN_METADATA before INSERT. The list of sensitive keys
   includes amount/total/price/paymentId/razorpayPaymentId/razorpaySignature
   + common variants (amountPaise, totalAmount, subtotal, grandTotal, etc.).
   The READ side (feed route) ALSO sanitizes via sanitizeActivityMetadata
   (defense-in-depth — handles legacy rows written by other code paths).

4. **Idempotency for activity recording** — the activities POST endpoint
   supports the Idempotency-Key header (optional). When present + a cached
   response exists, returns it. The recordActivity helper ALSO has built-in
   idempotency: when an idempotencyKey is provided, it stores the key in
   metadata.idempotencyKey + checks for an existing row with the same key
   prefix before creating a duplicate. (Note: SQLite doesn't support JSON
   queries on String columns, so the check uses a `contains` filter on the
   metadata column — a soft check that's good enough for retry safety.)

5. **withErrorHandler TS2345 pattern** — same as Wave 5A: cast each
   `apiError(...)` early-return to `as unknown as NextResponse` to unify
   with the success-path `NextResponse.json(...)` return type. For
   transactional routes that return `{ type: 'cached' | 'error' | 'success' }`
   discriminated unions (connections POST, connections/[id] PATCH+DELETE,
   activities POST), use exhaustive `switch (result.type)` with
   `const _exhaustive: never = result` exhaustiveness guard. Result: ZERO
   new TS errors in my files.

6. **No `db` import in connections/[id]/route.ts** — the file only uses
   `withTransaction` + `TransactionConflictError` (not the raw `db` client).
   Removed the unused `db` import to avoid lint errors.
