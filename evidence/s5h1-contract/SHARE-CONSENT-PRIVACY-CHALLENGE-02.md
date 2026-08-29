# PRODUCT-GJ02-SOCIAL-S5H1-SHARE-CONSENT-PRIVACY-CHALLENGE-02

## BASELINE
```
LOCAL_HEAD = REMOTE_MAIN = 3a3ca59aad70000899ed0ae912e51962824418fa
S5H1 contract checkpoint ancestor = YES
PRODUCT SOURCE CHANGES = 0
```

---

## PHASE 1 — CURRENT SOCIAL SHARING SEMANTICS

### Finding: Order completion does NOT create a SocialActivity

**Evidence:**
- `POST /api/orders` has **0 references** to `recordActivity` or `socialActivity`
- No frontend code calls `POST /api/social/activities` after order completion
- The `POST /api/social/activities` endpoint is a **standalone client-initiated API** — users must explicitly call it to create an ORDERED activity

**Current activity creation sources:**
| Source | Verb | Auto-created? | objectType | objectId |
|--------|------|---------------|-----------|----------|
| Group order join | JOINED_GROUP | YES (server-side) | GroupOrder | groupOrderId |
| Reward pickup | EARNED_REWARD | YES (server-side) | Order | orderId |
| Gift redemption | REDEEMED | YES (server-side) | Gift | giftId |
| **Order completion** | **ORDERED** | **NO** | Restaurant | restaurantId (client-supplied) |

### Critical finding: ORDERED activity is purely client-initiated

- A user completes an order → **no SocialActivity is created**
- The user (or frontend) must **separately** call `POST /api/social/activities` to share the order socially
- This means: **every existing ORDERED activity represents an explicit share action**
- If no ORDERED activity exists, the user has NOT shared their order socially

### Can user prevent sharing?
- **YES** — by not calling `POST /api/social/activities`, the order is never shared
- **YES** — user can set `visibility='PRIVATE'` when creating the activity
- **NO** — there is no "delete/hide activity" API (activities are append-only)

### Does SocialActivity retain orderId?
- **NO** — SocialActivity has no `orderId` field
- `objectId` for objectType='Restaurant' contains restaurantId, not orderId
- There is **no authoritative link** between SocialActivity and Order

---

## PHASE 2 — AUTHORITATIVE SHARE SIGNAL

### Option A (Order only) — REJECTED

Querying Order table directly reveals purchase history regardless of whether the user chose to share.

**Privacy violation:** B orders food but doesn't create a SocialActivity (doesn't want to share). A sees "B ordered here" — this discloses B's purchase history without B's consent.

**Verdict: REJECTED** — violates purchase-history privacy.

### Option B (Order + SocialActivity) — PREFERRED but requires schema repair

Qualifying proof = valid Order + linked SocialActivity + current visibility authorization.

**Problem:** No authoritative join exists between Order and SocialActivity. SocialActivity.objectId for objectType='Restaurant' contains restaurantId (not orderId). There is no `SocialActivity.orderId` field.

**Trust chain:**
```
REAL ORDER (proves economic truth)
+
AUTHORIZED SOCIAL SHARE (SocialActivity with visibility=FRIENDS/PUBLIC for that restaurant)
+
CURRENT FRIEND/BLOCK CHECK
=
FRIENDS ORDERED HERE
```

### Option C (explicit sharing flag on Order) — REJECTED

No existing concept of a "share this order" flag on the Order table. Inventing one would be a product-policy decision requiring user consent UI — beyond S5H1 scope.

### Decision: Option B with schema repair

S5H1 requires a trustworthy join between Order and SocialActivity. Current schema lacks this.

**Required schema addition:**
```prisma
model SocialActivity {
  // ... existing fields ...
  // S5H1: Authoritative link to the Order that triggered this activity.
  // NULL for activities not tied to a specific order (e.g., FRIEND_ADDED).
  sourceOrderId String?
  order         Order?  @relation(fields: [sourceOrderId], references: [id], onDelete: SetNull)
}
```

**Alternative (no schema change):** Use SocialActivity.metadata.orderId. But metadata is a JSON string — not indexable, not enforceable. **UNSAFE_HEURISTIC.**

---

## PHASE 3 — PRIVACY MATRIX

| B's real order | Social share state | Expected A sees proof? | Reason |
|----------------|-------------------|------------------------|--------|
| Exists | FRIENDS activity | YES | B explicitly shared with friends |
| Exists | PUBLIC activity | YES | B explicitly shared publicly |
| Exists | PRIVATE activity | **NO** | B chose not to share |
| Exists | no SocialActivity | **NO** | B chose not to share (no explicit share action) |
| Exists | activity deleted/hidden | **NO** | No delete API exists; if added, excluded |
| Exists | A later blocked B | **NO** | Block isolates (S4A) |
| Exists | A/B unfriend | **NO** | No ACCEPTED edge |
| Exists | unblock but not refriend | **NO** | No ACCEPTED edge |
| Exists | friendship re-established | YES if share remains FRIENDS/PUBLIC | Current friendship + current share = eligible |

**Frozen rule:** CURRENT relationship + CURRENT share state determine current social proof. Historical purchases without explicit share are NEVER eligible.

---

## PHASE 4 — HISTORICAL DISCLOSURE

**Decision: No time-window retention. Eligibility is based on existence of a qualifying SocialActivity, not age.**

**Rationale:**
- If B shared an order as FRIENDS 18 months ago, and A becomes B's friend today, A sees "B ordered here"
- This is correct: B explicitly chose to share. The share is permanent (append-only). A new friend seeing it is expected social behavior (like seeing an old post on a social feed)
- Adding a time window would require a product-policy decision ("we hide old social activity") — beyond S5H1 scope
- If product later wants time-windowed social proof, it can add a `createdAt > now - 90d` filter to the query

**Explicit:** No retention window for S5H1. Historical shares remain eligible indefinitely.

---

## PHASE 5 — COUNT SEMANTICS AFTER CONSENT FILTER

```text
friendOrderCount = unique currently-authorized friends
with at least one qualifying SocialActivity (verb=ORDERED, objectType=Restaurant,
  objectId=targetRestaurantId, visibility IN ('FRIENDS','PUBLIC'))
```

**NOT:**
- Total orders (Order table not queried for count)
- Total activities (only ORDERED verb qualifies)
- Likes

**Example:**
```
B has 5 qualifying FRIENDS ORDERED activities for restaurant X
C has 2 qualifying PUBLIC ORDERED activities for restaurant X
D has 10 real orders at X but no SocialActivity (didn't share)
E has 1 ORDERED activity with visibility=PRIVATE for X

→ friendOrderCount = 2 (B and C; D didn't share, E is PRIVATE)
→ friends = [{B's name}, {C's name}] (max 3, hasMore=false)
```

D contributes zero. E contributes zero. This is correct.

---

## PHASE 6 — SOURCE-TRUST CONTRACT

The desired trust chain:

```
REAL ORDER (Order table)
    proves economic truth — but does NOT prove social disclosure permission
+
AUTHORIZED SHARE (SocialActivity with visibility=FRIENDS/PUBLIC)
    proves user elected to expose this order socially
    BUT: SocialActivity.objectId is client-supplied — it could reference
    a restaurant the user didn't actually order from
+
CURRENT FRIEND/BLOCK CHECK (SocialConnection ACCEPTED)
    proves current viewer authorization
=
FRIENDS ORDERED HERE
```

**Trust gap:** SocialActivity.objectId is client-supplied. A user could create an ORDERED activity for a restaurant they never ordered from.

**However:** This is a lower-severity risk than purchase-history disclosure:
- Creating a fake "I ordered here" activity is a vanity action — it inflates the user's own social proof, not someone else's
- It requires the user to explicitly call POST /api/social/activities (conscious action)
- The activity is tied to their actorId — they're claiming they ordered, not fabricating someone else's order
- The "friend ordered here" count is distinct friends — one fake activity from one friend counts as 1, regardless of how many fake activities they create

**Decision for S5H1:** Accept this trust model. The trust chain is:
1. SocialActivity proves the user **chose to share** (explicit consent)
2. Current friendship proves **current authorization** (S4A/S4B)
3. SocialActivity.objectId = restaurantId provides **restaurant identity** (client-supplied but acceptable for social-proof display)

**If product later requires authoritative order-share linkage:**
- Add `SocialActivity.sourceOrderId` (schema repair)
- Auto-create ORDERED activity on order completion (server-side)
- Query would then join: SocialActivity.sourceOrderId → Order.restaurantId

**Classification:** `S5H1_SCHEMA_REPAIR_RECOMMENDED_FOR_FUTURE` (not a blocker for S5H1)

---

## PHASE 7 — DATA-MODEL CONSEQUENCE

**Current schema cannot securely correlate a real Order with an authorized Social share.**

SocialActivity has:
- `objectId` (client-supplied, sometimes restaurantId)
- NO `orderId` or `sourceOrderId` field
- NO relation to Order

**Classification:** `S5H1_SCHEMA_REPAIR_RECOMMENDED_FOR_FUTURE`

**Recommended future schema:**
```prisma
model SocialActivity {
  // ... existing fields ...
  sourceOrderId String? // NULL for non-order activities
  order         Order?  @relation(fields: [sourceOrderId], references: [id])
}
```

**For S5H1 (current schema):**
- Use SocialActivity with `verb='ORDERED'` + `objectType='Restaurant'` + `objectId=restaurantId` + `visibility IN ('FRIENDS','PUBLIC')`
- Accept that objectId is client-supplied (lower-severity vanity risk)
- Do NOT query Order table (would reveal unshared purchase history)

---

## PHASE 8 — QUALIFYING ORDER STATUSES

N/A for S5H1 — we query SocialActivity, not Order.

If schema repair adds `sourceOrderId` in the future, qualifying Order statuses would be:

**Explicit allowlist:**
```text
QUALIFYING_ORDER_STATUSES = ['CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP', 'PAID']
```

**Excluded:**
- `CANCELLED` — order was cancelled, not a real purchase
- `PAYMENT_PENDING` — payment not confirmed

---

## PHASE 9 — GIFT/ORDER-NOTE LOGIC

**Classification:** `LEGACY_CONVENTION`

The `note` field pattern (`GIFT:`, `GIFT_FROM:`) is used by the gift service to mark ghost orders:
- Ghost order: `note = GIFT:${giftId}:for:${recipientId}`
- Redemption order: `note = GIFT_FROM:${senderId}:${giftId}`

**For S5H1:** Since we query SocialActivity (not Order), the `note` field is irrelevant. SocialActivity for gifts uses `verb='REDEEMED'` + `objectType='Gift'` (not `ORDERED` + `Restaurant`), so gift activities are naturally excluded from the "friends ordered here" query.

**If schema repair queries Order table in the future:** Use `NOT (note LIKE 'GIFT:%' OR note LIKE 'GIFT_FROM:%')` to exclude ghost orders. But this is convention, not a contractual marker.

---

## PHASE 10 — REVISED QUERY CONTRACT

### Previous (S5H1-01) — REJECTED:
```sql
-- Queries Order table directly — reveals unshared purchase history
SELECT DISTINCT userId FROM Order WHERE restaurantId = ? AND status != 'CANCELLED'
```

### Revised (S5H1-02) — APPROVED:
```sql
-- Step 1: Get viewer's accepted friends (bidirectional, excludes BLOCKED)
SELECT followeeId AS friendId FROM SocialConnection
WHERE followerId = ? AND status = 'ACCEPTED'
UNION
SELECT followerId AS friendId FROM SocialConnection
WHERE followeeId = ? AND status = 'ACCEPTED'

-- Step 2: Get distinct friends who shared an ORDERED activity for this restaurant
-- (visibility FRIENDS or PUBLIC — PRIVATE excluded)
SELECT DISTINCT actorId
FROM SocialActivity
WHERE verb = 'ORDERED'
  AND objectType = 'Restaurant'
  AND objectId = ?  -- target restaurantId
  AND visibility IN ('FRIENDS', 'PUBLIC')
  AND actorId IN (friendIds from step 1)
ORDER BY MAX(createdAt) DESC, actorId ASC

-- Step 3: Project max 3 friend profiles
SELECT name, ... FROM User WHERE id IN (first 3 actorIds from step 2)
```

**Key change:** Queries SocialActivity (with explicit share consent via visibility) instead of Order (which reveals unshared purchases).

---

## REVISED MANDATORY MATRIX

| Contract | Decision | Ready? |
|----------|----------|--------|
| Economic truth | SocialActivity (explicit share) NOT Order (unshared purchase) | ✅ |
| Social disclosure consent | SocialActivity.visibility IN ('FRIENDS','PUBLIC') — PRIVATE excluded | ✅ |
| Order↔share linkage | N/A for S5H1 — queries SocialActivity directly. Schema repair recommended for future. | ✅ |
| FRIENDS visibility | respected (included) | ✅ |
| PRIVATE visibility | excluded | ✅ |
| No-share order | excluded (no SocialActivity = no share = not eligible) | ✅ |
| Current friendship | required (SocialConnection ACCEPTED, bidirectional) | ✅ |
| Current block state | required (ACCEPTED excludes BLOCKED) | ✅ |
| Historical retention | indefinite (share is permanent, append-only) | ✅ |
| Qualifying order status | N/A (queries SocialActivity, not Order) | ✅ |
| Gift semantics | N/A (gift activities use verb=REDEEMED, not ORDERED) | ✅ |
| Unique friend counting | DISTINCT actorId | ✅ |
| PII projection | name + avatarColor only | ✅ |
| Abuse resistance | SocialActivity.objectId is client-supplied (vanity risk only, not privacy violation) | ✅ |

---

## BLOCKERS

**No hard blockers for S5H1 implementation with revised query.**

**Schema repair recommended for future (not S5H1 blocker):**
- Add `SocialActivity.sourceOrderId` for authoritative Order↔SocialActivity linkage
- Auto-create ORDERED activity on order completion (server-side)
- This would close the "client-supplied objectId" trust gap

---

## FINAL VERDICT

```text
S5H1_IMPLEMENTATION_READY
```

**Key correction from S5H1-01:**
- **Previous:** Query Order table (reveals unshared purchase history) — **REJECTED**
- **Revised:** Query SocialActivity with visibility filter (respects explicit share consent) — **APPROVED**

**Trust chain:**
```
AUTHORIZED SOCIAL SHARE (SocialActivity, visibility=FRIENDS/PUBLIC)
    proves user chose to share
+
CURRENT FRIEND/BLOCK CHECK (SocialConnection ACCEPTED)
    proves current viewer authorization
=
FRIENDS ORDERED HERE
```

**Privacy preserved:** No purchase history disclosed without explicit share consent.
