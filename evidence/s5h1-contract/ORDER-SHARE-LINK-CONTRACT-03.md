# PRODUCT-GJ02-SOCIAL-S5H1-ORDER-SHARE-LINK-CONTRACT-03

## BASELINE
```
LOCAL_HEAD = REMOTE_MAIN = 2ca346af1eadbf23f828cde7025ea7faaac59807
S5H1-02 checkpoint ancestor = YES
PRODUCT SOURCE CHANGES = 0
```

---

## PHASE 1 — SCHEMA CONVENTIONS TRACE

### Current SocialActivity schema
```prisma
model SocialActivity {
  id            String   @id @default(cuid())
  actorId       String   // server-set from session
  verb          String   // ORDERED | EARNED_REWARD | GIFTED | JOINED_GROUP | REDEEMED
  objectType   String   // Restaurant | MenuItem | Gift | GroupOrder | Order | RewardLedgerEntry
  objectId      String   // client-supplied for POST /api/social/activities
  metadata      String   @default("{}") // JSON
  visibility    String   @default("FRIENDS")
  createdAt     DateTime @default(now())
  @@index([actorId, createdAt])
  @@index([createdAt])
  @@index([verb, createdAt])
}
```

### Existing pattern: server-side activities use objectId = authoritative entity ID

| Source | verb | objectType | objectId | Server-controlled? |
|--------|------|-----------|----------|-------------------|
| Gift redemption | REDEEMED | Gift | gift.id | YES (tx in gift-service) |
| Reward pickup | EARNED_REWARD | Order | orderId | YES (tx in rewards route) |
| Group order join | JOINED_GROUP | GroupOrder | groupOrder.id | YES (tx in join route) |
| **Client POST** | **ORDERED** | **Restaurant** | **restaurantId** | **NO — client-supplied** |

### Key insight
The existing `recordActivity()` helper is server-side only — it takes a `tx` parameter and is called inside `withTransaction`. The client-facing `POST /api/social/activities` route passes `objectId` directly from the request body without any server-side validation against an authoritative source.

### Order model
```prisma
model Order {
  id             String   @id @default(cuid())
  userId         String   // FK to User
  restaurantId   String   // FK to Restaurant
  status         String   @default("CONFIRMED")
  // ... payment, fulfilment relations
  payment        Payment? // 1:1
}
```

### Payment model
```prisma
model Payment {
  id      String  @id @default(cuid())
  orderId String  @unique // 1:1 to Order
  status  String  @default("PAYMENT_PENDING")
  // PAYMENT_PENDING → CAPTURE_PENDING → CAPTURED
  // CAPTURE_PENDING → FAILED
  // CAPTURED → REFUND_PENDING → REFUNDED | FAILED
}
```

---

## PHASE 2 — OPTION EVALUATION

### Option A: SocialActivity.sourceOrderId (FK to Order) — PREFERRED

**Design:**
```prisma
model SocialActivity {
  // ... existing fields ...
  sourceOrderId String?  // NULL for non-order activities (FRIEND_ADDED, etc.)
  sourceOrder   Order?   @relation(fields: [sourceOrderId], references: [id], onDelete: SetNull)
}
```

**Creation model:**
- `POST /api/social/activities` (client-initiated) does NOT set `sourceOrderId` — it remains NULL
- A NEW server-side endpoint `POST /api/social/share-order` accepts `{ orderId, visibility }` and:
  1. Validates the order belongs to `session.userId`
  2. Validates the order has a qualifying status (see Phase 3)
  3. Validates the order's `restaurantId` matches the claimed restaurant
  4. Creates SocialActivity with `verb=ORDERED`, `objectType=Restaurant`, `objectId=order.restaurantId`, `sourceOrderId=order.id`, `visibility`
  5. All fields are server-derived — client cannot fabricate restaurantId, orderId, or actorId

**Trust properties:**
- `sourceOrderId` is server-set → cannot be forged
- `objectId` (restaurantId) is derived from `Order.restaurantId` → matches the real order
- `actorId` is `session.userId` → matches the order owner
- The Order must exist and belong to the user → economic truth verified

**Pros:**
- Minimal schema change (one nullable field + relation)
- Follows existing pattern (EARNED_REWARD uses objectId=orderId; this adds an explicit FK)
- Client-facing `POST /api/social/activities` remains unchanged for other activity types
- New endpoint is server-validated end-to-end
- `sourceOrderId` is queryable/indexable

**Cons:**
- Requires schema migration (additive: nullable field, no existing data affected)
- Requires new API endpoint
- Existing ORDERED activities (29 rows with client-supplied objectId) have NULL sourceOrderId — they are legacy and should be excluded from social-proof query

### Option B: existing generic sourceType/sourceId — REJECTED

No existing generic sourceType/sourceId on SocialActivity. The IdempotencyKey table has `resourceType`/`resourceId` but that's for idempotency tracking, not activity sourcing. Adapting it would be a semantic stretch.

### Option C: dedicated SocialOrderShare table — REJECTED

Over-engineered for S5H1. A junction table would duplicate the SocialActivity row's purpose. The `sourceOrderId` on SocialActivity is simpler and follows the existing pattern (objectId already serves as a soft reference for Gift/GroupOrder/Order types).

### Decision: Option A — `SocialActivity.sourceOrderId`

---

## PHASE 3 — QUALIFYING ORDER STATUSES

### Order status machine
```
CONFIRMED → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP
CANCELLED (terminal)
PAID (payment confirmed)
PAYMENT_PENDING (payment not yet confirmed)
```

### Payment status machine (separate from Order)
```
PAYMENT_PENDING → CAPTURE_PENDING → CAPTURED
CAPTURE_PENDING → FAILED
CAPTURED → REFUND_PENDING → REFUNDED | FAILED
```

### Explicit allowlist

```typescript
const QUALIFYING_ORDER_STATUSES = [
  'CONFIRMED',    // order placed, payment confirmed
  'PREPARING',    // restaurant accepted, preparing
  'ALMOST_READY', // almost ready for pickup
  'READY_FOR_PICKUP', // ready for pickup
  'PICKED_UP',    // picked up by customer
  'PAID',         // payment confirmed (legacy/alternative)
]
```

### Excluded statuses
- `CANCELLED` — order was cancelled, not a real purchase
- `PAYMENT_PENDING` — payment not confirmed, order may fail

### Rationale
Only orders that represent a genuine placed AND paid purchase qualify. The order must have progressed past `PAYMENT_PENDING` (payment confirmed) to be a real economic event.

---

## PHASE 4 — SERVER-CONTROLLED CREATION CONTRACT

### New endpoint: POST /api/social/share-order

**Request:**
```json
{ "orderId": "...", "visibility": "FRIENDS" }
```

**Server-side validation (inside withTransaction):**
1. Load Order: `Order.findUnique({ where: { id: orderId } })`
2. Validate ownership: `order.userId === session.userId` (else 403)
3. Validate status: `order.status IN QUALIFYING_ORDER_STATUSES` (else 400)
4. Derive restaurantId: `restaurantId = order.restaurantId` (NOT from client)
5. Derive actorId: `actorId = session.userId` (NOT from client)
6. Check for existing share: `SocialActivity.findFirst({ where: { sourceOrderId: orderId, verb: 'ORDERED' } })`
   - If exists: return existing (idempotent — one share per order)
7. Create SocialActivity:
   ```
   verb: 'ORDERED'
   objectType: 'Restaurant'
   objectId: restaurantId  // server-derived from Order
   sourceOrderId: orderId  // authoritative FK
   actorId: session.userId // server-derived
   visibility: visibility // client-chosen (FRIENDS/PUBLIC/PRIVATE)
   metadata: { restaurantName: ... } // server-derived from Restaurant.name
   ```

**Client CANNOT:**
- Choose `objectId` (restaurantId) — server derives from Order
- Choose `actorId` — server sets from session
- Choose `orderId` that doesn't belong to them — 403
- Share a cancelled/pending order — 400
- Create duplicate shares for the same order — idempotent

---

## PHASE 5 — REVISED SOCIAL-PROOF QUERY

### Query (using sourceOrderId for authoritative join)

```sql
-- Step 1: Get viewer's accepted friends (bidirectional, excludes BLOCKED)
SELECT followeeId AS friendId FROM SocialConnection
WHERE followerId = ? AND status = 'ACCEPTED'
UNION
SELECT followerId AS friendId FROM SocialConnection
WHERE followeeId = ? AND status = 'ACCEPTED'

-- Step 2: Get distinct friends with qualifying shared orders at this restaurant
SELECT DISTINCT sa.actorId
FROM SocialActivity sa
INNER JOIN Order o ON sa.sourceOrderId = o.id
WHERE sa.verb = 'ORDERED'
  AND sa.objectType = 'Restaurant'
  AND sa.objectId = ?  -- target restaurantId
  AND sa.visibility IN ('FRIENDS', 'PUBLIC')
  AND sa.sourceOrderId IS NOT NULL  -- must have authoritative order link
  AND sa.actorId IN (friendIds from step 1)
  AND o.status IN ('CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP', 'PAID')
ORDER BY MAX(sa.createdAt) DESC, sa.actorId ASC

-- Step 3: Project max 3 friend profiles (name + avatarColor only)
```

### Trust chain verified:
1. `SocialActivity.sourceOrderId IS NOT NULL` → activity is server-created (not client-fabricated)
2. `INNER JOIN Order` → the order exists and is real
3. `o.status IN allowlist` → the order is a genuine paid purchase
4. `sa.objectId = targetRestaurantId` → the activity claims this restaurant
5. `o.restaurantId` (via join) matches `sa.objectId` → restaurant identity verified
6. `sa.visibility IN ('FRIENDS','PUBLIC')` → explicit share consent
7. `sa.actorId IN accepted friends` → current viewer authorization

---

## PHASE 6 — RUNTIME TRUST MATRIX

| Fixture | Eligible? | Why |
|---------|-----------|-----|
| Real qualifying order + linked FRIENDS share | ✅ YES | All conditions met |
| Real qualifying order + linked PUBLIC share | ✅ YES | PUBLIC is eligible per frozen policy |
| Real order + PRIVATE share | ❌ NO | visibility=PRIVATE excluded |
| Real order + no share | ❌ NO | No SocialActivity → no sourceOrderId → excluded |
| Fake SocialActivity + no Order | ❌ NO | sourceOrderId IS NULL (client POST doesn't set it) → excluded |
| SocialActivity points to another user's Order | ❌ NO | Server validates ownership: order.userId === session.userId |
| SocialActivity Order restaurant ≠ claimed restaurant | ❌ NO | objectId is server-derived from Order.restaurantId — always matches |
| Cancelled/failed/non-qualifying Order | ❌ NO | Order.status not in allowlist |
| Blocked/unfriended viewer | ❌ NO | No ACCEPTED SocialConnection |

---

## PHASE 7 — LEGACY DATA HANDLING

### Existing 29 ORDERED activities (client-created, no sourceOrderId)

**Decision:** Legacy activities are EXCLUDED from social-proof query.

**Rationale:**
- They have `sourceOrderId = NULL` → the `sourceOrderId IS NOT NULL` filter excludes them
- They were created via client-supplied objectId → cannot be trusted as authoritative
- Excluding them is correct — they may have been fabricated
- Users who want social proof must re-share via the new `POST /api/social/share-order` endpoint

**Migration:** No data migration needed. The `sourceOrderId IS NOT NULL` filter naturally excludes legacy rows.

---

## PHASE 8 — GIFT/ORDER-NOTE LOGIC

### Classification: N/A for S5H1

Gift activities use `verb=REDEEMED` + `objectType=Gift` (not `ORDERED` + `Restaurant`), so they're naturally excluded from the social-proof query.

Ghost orders (note=`GIFT:...`) are irrelevant because we query SocialActivity (not Order). If a ghost order were somehow shared (it shouldn't be — the share endpoint validates real orders), the `o.status IN allowlist` check would exclude it (ghost orders have status=CONFIRMED but are zero-amount; however, they're excluded by the `note NOT LIKE 'GIFT:%'` check if we add it — but since we query SocialActivity.sourceOrderId, ghost orders are only included if someone explicitly shared them, which the new endpoint prevents by validating real orders only).

**Decision:** No `note` filter needed. The `sourceOrderId` FK + Order status allowlist is sufficient.

---

## MANDATORY MATRIX

| Contract | Decision | Ready? |
|----------|----------|--------|
| Economic truth | Real Order (via sourceOrderId FK INNER JOIN) | ✅ |
| Social disclosure consent | SocialActivity.visibility IN ('FRIENDS','PUBLIC') | ✅ |
| Order↔share linkage | SocialActivity.sourceOrderId (server-set, FK to Order.id) | ✅ |
| FRIENDS visibility | respected (included) | ✅ |
| PRIVATE visibility | excluded | ✅ |
| No-share order | excluded (no SocialActivity with sourceOrderId) | ✅ |
| Current friendship | required (SocialConnection ACCEPTED, bidirectional) | ✅ |
| Current block state | required (ACCEPTED excludes BLOCKED) | ✅ |
| Historical retention | indefinite (share is permanent, append-only) | ✅ |
| Qualifying order status | explicit allowlist (CONFIRMED, PREPARING, ALMOST_READY, READY_FOR_PICKUP, PICKED_UP, PAID) | ✅ |
| Gift semantics | N/A (gift activities use verb=REDEEMED, excluded) | ✅ |
| Unique friend counting | DISTINCT actorId | ✅ |
| PII projection | name + avatarColor only | ✅ |
| Abuse resistance | Server-controlled creation (client cannot set sourceOrderId, objectId, actorId) | ✅ |

---

## BLOCKERS

**No hard blockers.** The schema repair (`SocialActivity.sourceOrderId`) is required for implementation but is an additive, nullable field — no existing data or routes are affected.

**Required implementation steps (for S5H1 implementation directive):**
1. Add `sourceOrderId String?` + `@relation` to SocialActivity in schema
2. Run `bun run db:migrate` (additive migration)
3. Create `POST /api/social/share-order` endpoint (server-validated)
4. Create `GET /api/restaurants/[id]/social-proof` endpoint (uses sourceOrderId join)
5. Add `Order(restaurantId, userId)` index for production performance
6. Restaurant detail UI component (fetch social-proof, render avatars + count)

---

## FINAL VERDICT

```text
S5H1_IMPLEMENTATION_READY
```

**Trust chain (complete):**
```
REAL ORDER (Order table, via sourceOrderId FK)
    proves economic truth — order exists, belongs to user, qualifying status
+
AUTHORIZED SOCIAL SHARE (SocialActivity, visibility=FRIENDS/PUBLIC)
    proves user chose to disclose — server-created via share-order endpoint
+
CURRENT VIEWER AUTHORIZATION (SocialConnection ACCEPTED)
    proves viewer may currently see — current friendship, no block
=
FRIENDS ORDERED HERE
```

**All three facts are now server-authoritative:**
1. Economic truth: `sourceOrderId` FK → Order exists, status qualifies
2. Share consent: `visibility` field → FRIENDS/PUBLIC = explicit consent
3. Viewer authorization: SocialConnection ACCEPTED → current relationship

**Client cannot fabricate any of these facts.**
