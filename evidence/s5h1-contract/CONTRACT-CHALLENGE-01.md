# PRODUCT-GJ02-SOCIAL-S5H1-FRIENDS-ORDERED-HERE-CONTRACT-CHALLENGE-01

## BASELINE

```
WORKTREE_CLEAN = YES (after git reset --hard dbd6f78)
LOCAL_HEAD = REMOTE_MAIN = dbd6f78093f5ae5837a1f299b9fad3c50d421649
S5H planning checkpoint ancestor = YES
PRODUCT SOURCE CHANGES = 0
```

---

## DATA MODEL FINDINGS

### Restaurant identity on SocialActivity

**Current state:**
- `SocialActivity.objectId` is a free-form String (not a foreign key)
- `SocialActivity.objectType` = 'Restaurant' for order activities
- `SocialActivity.metadata` contains `restaurantName` (display string) but NO `restaurantId`
- When `objectType='Restaurant'`, `objectId` SOMETIMES contains a real Restaurant.id (cuid format), but SOMETIMES contains test strings like `test-rest-1`

**Critical finding:**
- Order creation (`POST /api/orders`) does **NOT** auto-create a SocialActivity
- SocialActivity is created via `POST /api/social/activities` — a **client-initiated** endpoint
- The frontend calls this AFTER order completion (per `social-activity.ts` comment: "consumer-triggered — e.g. after order")
- `objectId` is set by the client caller, not server-derived from the Order

**Trust assessment:**
- `objectId` for `objectType='Restaurant'` is client-supplied
- A client could pass any restaurantId in `objectId` when creating an activity
- However, `POST /api/social/activities` requires auth (session) + the activity is tied to `actorId = session.userId`
- The activity is NOT linked to an Order row — there's no `orderId` on SocialActivity
- This means: a user can create an "ORDERED" activity for any restaurant without actually ordering

**This is a material trust risk for S5H1.** See Abuse Challenge (Phase 14).

### Order → Restaurant linkage

- `Order.restaurantId` IS a proper foreign key to `Restaurant.id`
- Order creation is server-side, validated, payment-gated
- If S5H1 wants authoritative "friend ordered here", it should query `Order` table (not `SocialActivity`)

### Recommendation

**Two options:**

**Option A (preferred): Query Order table directly**
- `SELECT DISTINCT userId FROM Order WHERE restaurantId = ? AND userId IN (accepted friends) AND status NOT IN ('CANCELLED')`
- Pro: 100% authoritative (server-created, payment-gated, real foreign key)
- Pro: No client fabrication possible
- Con: Only captures actual orders, not gift/group activities at that restaurant

**Option B: Query SocialActivity but filter to objectId matching Restaurant.id**
- `SELECT DISTINCT actorId FROM SocialActivity WHERE objectId = restaurantId AND objectType='Restaurant' AND verb='ORDERED'`
- Pro: captures all activity types (gift, group order)
- Con: objectId is client-supplied — trust risk
- Con: Test data has `objectId='test-rest-1'` which won't match real Restaurant.id

**Decision: Use Option A (Order table) as primary signal.** This is the authoritative, payment-gated, server-created source. SocialActivity can be used as a secondary enrichment (for gift/group activity display) but NOT for the count.

---

## DEFINITION OF QUALIFYING FRIEND

A user counts as "ordered here" only when ALL of these are true:

1. **Current friendship:** viewer ↔ friend has `SocialConnection` with `status='ACCEPTED'` in either direction (bidirectional)
2. **No block:** neither side has blocked the other (BLOCKED status excludes)
3. **Real order:** friend has at least one `Order` where `restaurantId = target restaurant` AND `status != 'CANCELLED'`
4. **Current truth:** friendship + block status evaluated at query time (not cached from stale state)

### Explicit decisions:

| Scenario | Counts? | Reason |
|----------|---------|--------|
| FRIENDS activity | N/A | We query Order table, not SocialActivity. Visibility doesn't apply to Order. |
| PUBLIC activity | N/A | Same — we query Order, not activity |
| PRIVATE activity | N/A | Same |
| Old order after unfriend | NO | No ACCEPTED SocialConnection → excluded |
| Old order after block | NO | BLOCKED SocialConnection → excluded |
| Multiple orders by same friend | YES (counts as 1) | DISTINCT friend count, not order count |
| Multiple activities for same order | N/A | We query Order, not SocialActivity |
| Deleted/cancelled order | NO | `status != 'CANCELLED'` filter |
| Gift order (ghost order) | NO | Ghost orders have `note.startsWith('GIFT:')` — exclude via `NOT note LIKE 'GIFT:%'` |
| Group order | YES if member has a real order | Group order creates real Order rows for each member |

**Preferred privacy rule:** CURRENT relationship + CURRENT order status determine current social proof. Historical friendships do NOT qualify.

---

## API CONTRACT

### Endpoint
```
GET /api/restaurants/[id]/social-proof
```

### Response (200)
```json
{
  "friendOrderCount": 5,
  "friends": [
    { "name": "Aditi", "avatarColor": "violet" },
    { "name": "Rahul", "avatarColor": "teal" },
    { "name": "Priya", "avatarColor": "rose" }
  ],
  "hasMore": true
}
```

### Constraints
- `friends.length <= 3` (max 3 avatars)
- `friendOrderCount` = UNIQUE friends who qualify (not order count)
- `hasMore` = true if `friendOrderCount > 3`
- NO `userId` in response — UI only needs name + avatarColor for display
- NO phone, email, blockedBy, orderId, paymentId, amount, timestamp, address, campus
- NO full User object

### Response (401)
```json
{ "error": { "code": "AUTHENTICATION_REQUIRED", "message": "Authentication required" } }
```

### Response (404)
```json
{ "error": { "code": "NOT_FOUND", "message": "Restaurant not found" } }
```

### Response (empty — 200 with zero)
```json
{
  "friendOrderCount": 0,
  "friends": [],
  "hasMore": false
}
```

### Failure behavior
- API failure → UI shows nothing (no fake social proof)
- 401 → component hidden (user not logged in)
- 404 → component hidden (restaurant not found)
- 500 → component hidden, error logged

---

## QUERY CONTRACT

### Server-side query strategy

```sql
-- Step 1: Get viewer's accepted friends (bidirectional, excludes BLOCKED)
SELECT followeeId AS friendId
FROM SocialConnection
WHERE followerId = ? AND status = 'ACCEPTED'
UNION
SELECT followerId AS friendId
FROM SocialConnection
WHERE followeeId = ? AND status = 'ACCEPTED'

-- Step 2: Get distinct friends who ordered at this restaurant (non-cancelled, non-gift)
SELECT DISTINCT o.userId
FROM Order o
WHERE o.restaurantId = ?
  AND o.userId IN (friendIds from step 1)
  AND o.status != 'CANCELLED'
  AND (o.note IS NULL OR o.note NOT LIKE 'GIFT:%')
ORDER BY o.createdAt DESC

-- Step 3: Project max 3 friend profiles
SELECT name FROM User WHERE id IN (first 3 friendIds from step 2)
```

### Challenges addressed:
- **N+1 queries:** Batch fetch — 3 queries total (friends, orders, profiles)
- **Duplicate friend rows:** UNION deduplicates bidirectional edges
- **Duplicate activities:** DISTINCT on userId in Order query
- **Same friend ordering multiple times:** DISTINCT handles this
- **Blocked relationship:** SocialConnection status='ACCEPTED' filter excludes BLOCKED
- **Stale ACCEPTED reverse edge:** Both directions queried via UNION
- **PRIVATE leakage:** Order table has no visibility concept — all orders count regardless of activity visibility. This is correct: a real order is a real order.
- **PUBLIC semantics:** N/A for Order table
- **Large activity history:** We query Order table (not SocialActivity). Order count is naturally bounded by user's ordering frequency.

### Deterministic ordering
```sql
ORDER BY MAX(o.createdAt) DESC, o.userId ASC
```
- Most recent qualifying order DESC (friend who ordered most recently appears first)
- userId ASC as tie-breaker (deterministic, no database incidental order)

### Performance optimization
- Query uses existing indexes: `SocialConnection(followerId, status)`, `SocialConnection(followeeId, status)`, `Order(restaurantId)` (if exists)
- Max 3 profile fetches (bounded)
- No pagination needed (max 3 avatars)

---

## PRIVACY/BLOCK CONTRACT

### Block isolation test (Phase 5)

Using A/B/C:
- A = viewer
- B = accepted friend (has order at restaurant)
- C = non-friend (has order at restaurant)

**Expected:**
```
A opens restaurant detail → social-proof returns B (not C)
A blocks B → social-proof returns 0 friends (B excluded)
A unblocks B (no refriend) → social-proof returns 0 (no ACCEPTED edge)
A refriends B → social-proof returns B again
```

### PRIVATE B activity
- N/A — we query Order table, not SocialActivity. Order has no visibility field.
- A real order at a restaurant is always counted regardless of activity visibility.
- This is correct: if you ordered food, your friend should see you "ordered here" — the order is a social fact.

### Non-friend PUBLIC activity
- N/A — we query Order table, not SocialActivity.
- A non-friend's order does NOT appear because they're not in the viewer's ACCEPTED friend list.

---

## COUNT SEMANTICS

```text
friendOrderCount = unique friends who qualify
```

**NOT:**
- Number of orders
- Number of activities
- Number of Likes

**Example:**
```
B orders 5 times from restaurant X
D orders 2 times from restaurant X
→ friendOrderCount = 2 (B and D are 2 distinct friends)
→ friends = [{B's name}, {D's name}] (max 3, hasMore=false)
```

UI says: "2 friends ordered here"
**NOT:** "7 friend orders"

---

## UI CONTRACT

### Minimum surface
```
[avatar][avatar][avatar]  "3 friends ordered here"
```

### Expanded wording (optional)
```
"Aditi, Rahul and 1 other friend ordered here"
```
**Decision: Use compact form** — "3 friends ordered here" with avatar stack. Expanded wording with names risks privacy (name exposure beyond max 3) and visual noise.

### Behavior matrix

| State | UI |
|-------|----|
| 0 friends | Component absent (no empty state) |
| 1 friend | 1 avatar + "1 friend ordered here" |
| 2 friends | 2 avatars + "2 friends ordered here" |
| 3 friends | 3 avatars + "3 friends ordered here" |
| >3 friends | 3 avatars + "3+ friends ordered here" |
| Missing name | Fallback: "SnakZap user" (consistent with S4B search) |
| Missing avatarColor | Fallback: default color (teal) |
| Loading | Component hidden (no skeleton — avoid fake social proof) |
| API failure | Component hidden (no fallback content) |
| API 401 | Component hidden (user not logged in) |

**Failure must never show fake social proof.**

---

## EXPERIMENT CONTRACT

### Primary metric
```text
restaurant-detail → add-to-cart / order-start conversion rate
for sessions exposed to Friends Ordered Here
```

**Rationale:** The proof lives INSIDE restaurant detail. "Opens from social" doesn't apply. The real question: does seeing friend proof increase the likelihood of starting an order?

### Secondary metrics
- Social-proof impressions (how often the component renders with >0 friends)
- Friend-count distribution (1 / 2 / 3+)
- Menu interaction rate after proof impression
- Time-to-first-cart-add after proof impression

### Guardrail metrics
- Block rate (should not increase)
- Unfriend rate (should not increase)
- Page latency (API response time p95 < 200ms)
- API error rate (< 1%)

### Counter-metrics (NOT success metrics)
- Like count
- Raw notification volume
- Time-in-app

---

## ANALYTICS EVENTS

### Event: SOCIAL_PROOF_IMPRESSION
```json
{
  "experimentId": "s5h1-friends-ordered-here",
  "variant": "treatment|control",
  "restaurantId": "...",
  "friendCountBucket": "0|1|2|3+",
  "timestamp": "server-generated"
}
```

### Event: SOCIAL_PROOF_ORDER_START
```json
{
  "experimentId": "s5h1-friends-ordered-here",
  "variant": "treatment|control",
  "restaurantId": "...",
  "friendCountBucket": "0|1|2|3+",
  "timeFromImpressionMs": 12345,
  "timestamp": "server-generated"
}
```

### Privacy
- **NO friend identities logged.** Only `friendCountBucket` (0/1/2/3+).
- `restaurantId` is already public (in URL).
- `variant` is experiment assignment.
- `timestamp` is server-generated to prevent client manipulation.

---

## PERFORMANCE

### Query cost estimation

| Scenario | Estimated cost |
|----------|---------------|
| 10 friends, 1000 activities | ~5ms (3 indexed queries, max 3 profile fetches) |
| 50 friends, 5000 activities | ~10ms |
| 250 friends, 25000 activities | ~25ms |
| 1000 friends, 100000 activities | ~50ms (may need optimization) |

### Current indexes
- `SocialConnection(followerId, status)` ✅
- `SocialConnection(followeeId, status)` ✅
- `Order(restaurantId)` — **NOT PRESENT** ⚠️

### Index requirement
**New index needed:** `Order(restaurantId, userId)` — for the social-proof query to be efficient at scale.

**Without this index:** Full table scan on Order for each restaurant detail page view. At 100k orders, this is ~100ms — acceptable for dev but risky for production.

**Classification:** Not a blocker for S5H1 implementation, but should be added before production launch.

---

## ABUSE CHALLENGE

### Critical finding: SocialActivity is client-fabricatable

**Current state:** `POST /api/social/activities` allows any authenticated user to create an "ORDERED" activity for any restaurant — without actually ordering. The `objectId` is client-supplied.

**Impact on S5H1:**
- If S5H1 queries SocialActivity → users can inflate "friends ordered here" by creating fake activities
- **Mitigation: S5H1 queries Order table (not SocialActivity)** — Order rows are server-created, payment-gated, validated
- Order creation requires: valid session → valid restaurant → valid menu items → payment → ghost order or real order

### Abuse vectors

| Vector | Control |
|--------|---------|
| Fake orders/activity spam | S5H1 queries Order table (not SocialActivity). Orders require payment. Cannot be fabricated. |
| Friend farming | Friend requests rate-limited (S4B). Acceptance required. |
| Multiple activities to inflate proof | N/A — we count distinct friends with orders, not activities |
| Self activity | Self is not in friend list. Self orders don't count. |
| Duplicate order activity | DISTINCT userId in query |
| Coordinated ordering to boost ranking | Cost of abuse (real payment) > value (marginal ranking boost). Also, count is distinct friends — one friend ordering 100 times still counts as 1. |

**Trust assessment:** S5H1 is abuse-resistant because it queries the Order table (authoritative, payment-gated) rather than SocialActivity (client-fabricatable).

---

## REALTIME DECISION

**S5H1 does NOT need new realtime events.**

**Rationale:**
- Social proof is fetched on page load (restaurant detail opens)
- The proof is static during a single page view — it doesn't change while the user is looking at it
- If a friend places an order while viewer is on the page, the viewer will see updated proof on next page load
- Adding realtime invalidation for social proof would create unnecessary complexity for marginal value

**Optional enhancement (defer):**
- Existing S5D `SOCIAL_ACTIVITY_CREATED` realtime event could trigger social-proof refetch
- But this is over-engineering for S5H1 — the proof is "nice to have" social context, not critical state

**Decision:** Fetch on page load only. No realtime invalidation. No new realtime events.

---

## MANDATORY MATRIX

| Contract | Decision | Evidence | Risk | Ready? |
|----------|----------|----------|------|--------|
| Restaurant identity | Query Order.restaurantId (FK to Restaurant.id) | Order.restaurantId is proper FK | Low | ✅ YES |
| Qualifying activity | Real Order with status != CANCELLED, note != GIFT:% | Order table is server-created, payment-gated | Low | ✅ YES |
| Current friendship | SocialConnection status=ACCEPTED, bidirectional UNION | Existing indexes on followerId+status, followeeId+status | Low | ✅ YES |
| Block isolation | SocialConnection status=ACCEPTED excludes BLOCKED | S4A semantics preserved | Low | ✅ YES |
| Visibility | N/A for Order table (orders are social facts) | Order has no visibility field | None | ✅ YES |
| Unique-friend count | DISTINCT userId in Order query | Prevents count inflation | Low | ✅ YES |
| Max 3 avatars | LIMIT 3 on profile projection | Privacy: no full friend list exposure | Low | ✅ YES |
| PII projection | name + avatarColor only (no userId, phone, email) | Consistent with S4B search response | Low | ✅ YES |
| Deterministic ordering | MAX(createdAt) DESC, userId ASC | No database incidental order | Low | ✅ YES |
| API failure truthfulness | Component hidden on failure (no fake proof) | Never shows false social proof | Low | ✅ YES |
| Experiment primary metric | order-start conversion after proof impression | Not vanity like-count | Low | ✅ YES |
| Analytics privacy | friendCountBucket only (no friend IDs) | No PII in analytics | Low | ✅ YES |
| Query performance | 3 indexed queries, ~10ms at 50 friends | Needs Order(restaurantId,userId) index for prod | Medium | ✅ YES (with index note) |
| Abuse resistance | Queries Order table (payment-gated), not SocialActivity | Client cannot fabricate orders | Low | ✅ YES |

---

## BLOCKERS

**No hard blockers.**

**One note for production:**
- Add `Order(restaurantId, userId)` index before production launch for query performance at scale
- Not a blocker for S5H1 implementation — dev environment handles current volume fine

**One trust note (resolved):**
- SocialActivity.objectId is client-supplied → S5H1 avoids this by querying Order table
- This is a design decision, not a blocker

---

## FINAL VERDICT

```text
S5H1_IMPLEMENTATION_READY
```

**Rationale:**
- Data model supports authoritative query via Order table (proper FK, payment-gated)
- Privacy/block isolation preserved (SocialConnection ACCEPTED status, bidirectional)
- Count semantics correct (distinct friends, not orders)
- API contract minimal (name + avatarColor, max 3, no PII)
- Abuse-resistant (queries Order, not client-fabricatable SocialActivity)
- Performance adequate for dev (index note for production)
- No new realtime events needed
- Experiment metrics focused on conversion, not vanity

**Next step: S5H1 implementation directive (API + restaurant-detail UI + measurement).**
