# PRODUCT-GJ02-SOCIAL-S5H2-FRIEND-RANKED-DISCOVERY-CONTRACT-CHALLENGE-07

## BASELINE
```
LOCAL_HEAD = REMOTE_MAIN = ea3b87a52034cf68dd22c85817da6fdc0869a1fb
S5H1 checkpoint ancestor = YES
PRODUCT SOURCE CHANGES = 0
```

---

## CURRENT DISCOVERY FINDINGS

### Existing discovery surfaces on Home screen:
1. **Quick Reorder** — horizontal carousel of recently ordered restaurants (from order history)
2. **Popular Near You** — 2-col grid of RestaurantCardV2 (top 6 by `rating DESC` from `GET /api/restaurants?campusId=...`)
3. **Friends Ordering Nearby** — SocialFeedCard list (last 3 `ORDERED` activities from social feed)
4. **Deals** — horizontal scroll of restaurants with `deal` (derived from priceForTwo < ₹300)
5. **Gift a Friend CTA** — violet card
6. **Start Group Order CTA** — rose card

### Current sorting logic:
- `GET /api/restaurants` → `orderBy: { rating: 'desc' }` — **rating-only, no social signal**
- Home screen `popularRestaurants` = `filteredRestaurants.slice(0, 6)` — just first 6 from API
- Restaurant detail `popularItems` = first 3 available menu items — **placeholder, no real popularity**

### Key finding:
**"Popular Near You" is already a fake/static list** — sorted by `rating DESC` only. This is the exact surface S5H2 should augment/replace with friend-ranked discovery.

---

## ELIGIBLE SIGNAL

A restaurant qualifies for viewer A's friend-ranked discovery when:

1. At least one currently-accepted friend (SocialConnection status=ACCEPTED, bidirectional)
2. Has a qualifying linked shared Order (SocialActivity.sourceOrderId IS NOT NULL + INNER JOIN Order with status in QUALIFYING_ORDER_STATUSES)
3. SocialActivity visibility IN ('FRIENDS', 'PRIVATE') — **PRIVATE excluded per S5H1 contract**
4. No active block between viewer and friend

**Reuses S5H1 trust chain exactly.** No new trust model.

---

## RANKING FORMULA

### Deterministic lexicographic ranking (no opaque weights):

```
PRIMARY:   uniqueFriendCount DESC
           (more unique friends = higher rank)

SECONDARY: mostRecentQualifyingShareAt DESC
           (more recent social proof = higher rank)

TERTIARY:  restaurantId ASC
           (deterministic tie-breaker, no database incidental order)
```

### Component evaluation:

| Component | Include? | Justification |
|-----------|----------|---------------|
| A. uniqueFriendCount | YES (primary) | Prevents one hyperactive friend from dominating. 3 friends > 2 friends regardless of order volume. |
| B. recency of most recent share | YES (secondary) | Fresher social proof is more relevant. Ties broken by most recent qualifying share. |
| C. repeat-friend signal | NO | Already handled by DISTINCT friend count. No additional weight needed. |
| D. Like count | NO | Like farming risk. Likes are vanity, not discovery signal. Already rejected in S5H planning. |
| E. raw activity count | NO | One friend ordering 20 times shouldn't rank above 3 friends ordering once. |
| F. restaurant rating | NO for S5H2 | Rating is already used in existing "Popular Near You". S5H2 is a separate section — mixing rating with friend count would create opaque scoring. |
| G. distance/availability | NO for MVP | Campus filter already applied. Add later if needed. |

### Example:
```
Restaurant X: B(5 orders) + C(1 order) → uniqueFriendCount=2, latest=2026-08-20
Restaurant Y: D(1) + E(1) + F(1) → uniqueFriendCount=3, latest=2026-08-18

Y ranks above X (3 > 2 unique friends)
```

---

## RECENCY CONTRACT

**Decision: No time window for S5H2 MVP.**

**Rationale:**
- S5H1 established that shares are permanent (append-only, no time window)
- If a friend shared an order 2 years ago, it still counts as social proof
- Recency is handled by the SECONDARY sort key (mostRecentQualifyingShareAt DESC) — newer shares rank higher in ties, but old shares still qualify
- Adding a time window would create inconsistency between S5H1 (badge on restaurant detail) and S5H2 (ranking on home screen)
- If product later wants time-windowed ranking, add `WHERE sa.createdAt > now - 180d` filter

**Explicit:** No retention window. Historical shares remain eligible indefinitely. Recency affects sort order only, not eligibility.

---

## AUTHORIZATION / PRIVACY

### Current authorization (reuses S5H1):
- SocialConnection status=ACCEPTED (bidirectional UNION)
- BLOCKED excluded (no ACCEPTED edge)
- Unfriended → excluded (no ACCEPTED edge)
- Re-friended → eligible again (if underlying share remains authorized)

### Visibility:
- FRIENDS share → counts
- PUBLIC share → counts (for current accepted friends per S5H1 policy)
- PRIVATE share → never counts
- No share → never counts

---

## ANTI-GAMING

| Attack vector | Defense |
|---------------|---------|
| One friend orders 20 times | uniqueFriendCount = DISTINCT actorId → counts as 1 friend |
| Duplicate shares | @@unique([actorId, sourceOrderId]) — one share per order |
| 10 fake accounts friend each other | OTP login + campus binding + friend request rate limiting (S4B) |
| Like farming | Like count NOT used in ranking formula |
| Restaurant self-promotion via employee accounts | Orders require payment. Real economic cost. |
| Activity spam | Activities are server-created (via share-order endpoint). No client-initiated ORDERED activities with sourceOrderId. |
| Share/unshare loops | No unshare API. Shares are permanent (append-only). |
| Coordinated ordering to boost ranking | Cost of abuse (real payment per order) > marginal ranking boost. uniqueFriendCount means you need many distinct friends, not just many orders. |

**No additional account-age or order-quality thresholds needed for MVP.** uniqueFriendCount + real order requirement + current friendship is sufficient.

---

## FALLBACK

### Cold-start behavior:

| Viewer state | Behavior |
|-------------|---------|
| 0 friends | Section absent. Existing "Popular Near You" (rating-based) remains. |
| Friends but 0 qualifying shares | Section absent. Existing discovery remains. |
| Friends with only PRIVATE shares | Section absent (PRIVATE excluded). |
| Friends with only blocked former friends | Section absent (no ACCEPTED edge). |
| API failure | Section hidden. Existing discovery remains usable. |

**Rule:** S5H2 is additive. If no social signal, the existing "Popular Near You" section is the fallback. S5H2 never breaks discovery.

---

## API CONTRACT

### Endpoint
```
GET /api/restaurants/friend-ranked?limit=5
```

### Response (200)
```json
{
  "restaurants": [
    {
      "id": "...",
      "name": "Dosa Den",
      "cuisine": "South Indian",
      "image": "...",
      "rating": 4.7,
      "prepTimeMins": 15,
      "priceForTwo": 300,
      "isOpen": true,
      "deal": null,
      "friendCount": 3,
      "friendCountBucket": "3+"
    }
  ],
  "hasSocialSignal": true
}
```

### Response (empty — 200)
```json
{
  "restaurants": [],
  "hasSocialSignal": false
}
```

### Privacy constraints:
- `friendCount` = integer (total unique friends)
- `friendCountBucket` = "1" | "2" | "3+" (for analytics, not display)
- NO friend identities, userIds, names, order IDs, activity IDs, blockedBy, phone/email
- S5H2 ranks restaurants, not reveals who caused ranking

### Auth: getSessionUser() required (401 if no session)

---

## QUERY CONTRACT

### Server-side query strategy:

```sql
-- Step 1: Get viewer's accepted friends (bidirectional, excludes BLOCKED)
SELECT followeeId AS friendId FROM SocialConnection
WHERE followerId = ? AND status = 'ACCEPTED'
UNION
SELECT followerId AS friendId FROM SocialConnection
WHERE followeeId = ? AND status = 'ACCEPTED'

-- Step 2: Get qualifying shared activities grouped by restaurant
SELECT
  sa.objectId AS restaurantId,
  COUNT(DISTINCT sa.actorId) AS uniqueFriendCount,
  MAX(sa.createdAt) AS mostRecentShareAt
FROM SocialActivity sa
INNER JOIN Order o ON sa.sourceOrderId = o.id
WHERE sa.verb = 'ORDERED'
  AND sa.objectType = 'Restaurant'
  AND sa.visibility IN ('FRIENDS', 'PUBLIC')
  AND sa.sourceOrderId IS NOT NULL
  AND sa.actorId IN (friendIds from step 1)
  AND o.status IN ('CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP', 'PAID')
GROUP BY sa.objectId
ORDER BY uniqueFriendCount DESC, mostRecentShareAt DESC, sa.objectId ASC
LIMIT 5

-- Step 3: Fetch restaurant details for ranked restaurantIds
SELECT id, name, cuisine, image, rating, prepTimeMins, priceForTwo, isActive
FROM Restaurant
WHERE id IN (top 5 restaurantIds from step 2)
```

### Challenges addressed:
- **N+1:** Batch — 3 queries total (friends, grouped activities, restaurant details)
- **Duplicate friend rows:** UNION deduplicates
- **Duplicate activities:** GROUP BY restaurantId + COUNT(DISTINCT actorId)
- **Same friend ordering multiple times:** DISTINCT actorId in count
- **Blocked relationship:** SocialConnection ACCEPTED filter
- **Stale reverse ACCEPTED:** Both directions via UNION
- **PRIVATE leakage:** visibility IN ('FRIENDS','PUBLIC') filter
- **Large activity history:** GROUP BY + LIMIT 5 — bounded result set
- **Large friend list:** IN clause with friendIds (bounded by natural social graph)

---

## UI CONTRACT

### Section: "Popular among friends"

**Placement:** Between "Quick Reorder" and "Popular Near You" on home screen.

**Wording by count:**
| friendCount | Wording |
|-------------|---------|
| 1 | "Ordered by a friend" |
| 2+ | "Popular among friends" |

**Card content:**
- Restaurant card (same as existing RestaurantCardV2)
- Small social proof text: "👥 3 friends" (or "👥 1 friend")
- NO friend names or avatars (unlike S5H1 restaurant-detail badge)

**Behavior:**
| State | UI |
|-------|-----|
| 0 results / no social signal | Section absent, "Popular Near You" remains |
| 1-5 results | Section visible with ranked cards |
| Loading | Skeleton (same as existing) |
| API failure | Section hidden, existing discovery usable |

---

## MEASUREMENT CONTRACT

### Primary metric:
```
friend-ranked restaurant card → restaurant-detail open rate
```

### Secondary:
- Detail → menu interaction rate
- Detail → order-start rate
- Social proof impression count

### Guardrails:
- Block/unfriend rate (should not increase)
- Page latency (API p95 < 200ms)
- API error rate (< 1%)

### Counter-metrics (NOT success):
- Like count
- Raw notification volume
- Time-in-app

---

## ANALYTICS PRIVACY

### Events:
```
FRIEND_RANKED_IMPRESSION — section renders with >0 restaurants
FRIEND_RANKED_RESTAURANT_OPEN — user taps a friend-ranked restaurant card
```

### Safe dimensions:
```
experimentId: "s5h2-friend-ranked-discovery"
variant: "treatment"
restaurantId: "..."
rankPosition: 1-5
friendCountBucket: "1" | "2" | "3+"
```

### Forbidden:
```
friend userId
friend name
phone/email
orderId
sourceOrderId
blockedBy
graph edges
session/token
```

---

## PERFORMANCE

### Query cost estimation:

| Scale | Estimated cost |
|-------|---------------|
| 10 friends, 100 activities | ~5ms (3 indexed queries, GROUP BY, LIMIT 5) |
| 50 friends, 1000 activities | ~10ms |
| 250 friends, 5000 activities | ~25ms |
| 1000 friends, 10000 activities | ~50ms |

### Existing indexes:
- `SocialConnection(followerId, status)` ✅
- `SocialConnection(followeeId, status)` ✅
- `SocialActivity(verb, createdAt)` ✅
- `SocialActivity(actorId, createdAt)` ✅
- `SocialActivity.sourceOrderId` — no index yet ⚠️

### Index recommendation:
**New index:** `SocialActivity(objectId, verb, visibility)` — for the friend-ranked query's GROUP BY on objectId.

**Without this index:** Full table scan on SocialActivity for the grouped query. At 10k activities, this is ~50ms — acceptable for dev but should be added before production.

**Classification:** Not a blocker for S5H2 implementation. Add index before production.

---

## RUNTIME MODEL

### Realtime:
```
REALTIME_FRIEND_RANKED = DEFERRED
```

**Rationale:** Friend-ranked discovery is fetched on page load. If a friend places an order while viewer is on the home screen, the updated ranking appears on next page load. Adding realtime invalidation is over-engineering for S5H2 MVP.

### Experiment status:
```
FEATURE_INSTRUMENTATION = ACTIVE
RANDOMIZED_AB_TEST = DEFERRED
```

---

## MANDATORY RANKING MATRIX

| Restaurant | Unique friends | Total orders | Latest signal | Eligible | Expected rank |
|-----------|---------------|-------------|---------------|----------|--------------|
| X | 2 | 10 | 2026-08-20 | YES | 3rd (2 friends) |
| Y | 3 | 3 | 2026-08-18 | YES | 1st (3 friends, older) |
| Z | 3 | 8 | 2026-08-25 | YES | 2nd (3 friends, newer than Y) |
| Private-only | 5 | 20 | N/A | NO | excluded |
| Blocked-only | 4 | 10 | N/A | NO | excluded |

**Note:** Y and Z both have 3 unique friends. Z ranks above Y because Z's mostRecentShareAt (2026-08-25) > Y's (2026-08-18). X ranks below both because 2 < 3 unique friends.

---

## MANDATORY CONTRACT MATRIX

| Contract | Decision | Evidence | Risk | Ready? |
|----------|----------|----------|------|--------|
| Ranking unit | uniqueFriendCount (DISTINCT actorId) | Prevents hyperactive friend dominance | Low | ✅ |
| Unique-friend dedup | COUNT(DISTINCT sa.actorId) GROUP BY restaurantId | SQL-level dedup | Low | ✅ |
| Recency | MAX(createdAt) DESC as secondary sort | No time window, recency affects order only | Low | ✅ |
| Tie-breaker | restaurantId ASC (deterministic) | No database incidental order | Low | ✅ |
| Current friendship | SocialConnection ACCEPTED bidirectional UNION | S5H1 reused | Low | ✅ |
| Block isolation | ACCEPTED excludes BLOCKED | S4A preserved | Low | ✅ |
| PRIVATE exclusion | visibility IN ('FRIENDS','PUBLIC') | S5H1 reused | Low | ✅ |
| No-share exclusion | sourceOrderId IS NOT NULL | S5H1 reused | Low | ✅ |
| Minimum threshold | >=1 friend → eligible, wording changes at 2+ | "Ordered by a friend" vs "Popular among friends" | Low | ✅ |
| Fallback | Section absent → existing "Popular Near You" remains | Additive, no breakage | Low | ✅ |
| Result cap | LIMIT 5 | Bounded result set | Low | ✅ |
| API privacy | friendCount + friendCountBucket only, no identities | Consistent with S5H1 | Low | ✅ |
| Analytics privacy | experimentId, variant, restaurantId, rankPosition, friendCountBucket | No friend IDs | Low | ✅ |
| Anti-gaming | uniqueFriendCount + payment-gated orders + @@unique idempotency | All S5H1 defenses reused | Low | ✅ |
| Query performance | 3 queries, GROUP BY, LIMIT 5 | Needs SocialActivity(objectId,verb,visibility) index for prod | Medium | ✅ |

---

## BLOCKERS

**No hard blockers.**

**Production note:**
- Add `SocialActivity(objectId, verb, visibility)` index before production launch for query performance at scale
- Not a blocker for S5H2 implementation — dev handles current volume fine

---

## FINAL VERDICT

```text
S5H2_IMPLEMENTATION_READY
```

**Key design decisions:**
1. **Ranking unit:** uniqueFriendCount (not raw order/activity/Like count)
2. **Formula:** Deterministic lexicographic — uniqueFriendCount DESC → mostRecentShareAt DESC → restaurantId ASC
3. **Recency:** No time window (recency affects sort order only, not eligibility)
4. **Minimum threshold:** >=1 friend eligible; wording changes at 2+ ("Popular among friends")
5. **Fallback:** Section absent → existing "Popular Near You" (rating-based) remains
6. **API:** `GET /api/restaurants/friend-ranked?limit=5` — friendCount + friendCountBucket only
7. **UI:** New section between "Quick Reorder" and "Popular Near You"
8. **Measurement:** Friend-ranked card → restaurant-detail open rate
9. **Realtime:** DEFERRED (page-load fetch)
10. **Experiment:** Instrumentation ACTIVE, randomized A/B DEFERRED

