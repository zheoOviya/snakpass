# PRODUCT-GJ02-SOCIAL-S5H3-NEW-USER-FRIEND-SEED-CONTRACT-CHALLENGE-11

## BASELINE
```
LOCAL_HEAD = REMOTE_MAIN = e606c490dcbaed74f48d60136e752b56548a938b
S5H2 checkpoint ancestor = YES
PRODUCT SOURCE CHANGES = 0
```

---

## CURRENT SOCIAL GRAPH FINDINGS

### SocialConnection model:
- Bidirectional: A→B + B→A (2 rows per mutual friendship)
- `@@unique([followerId, followeeId])` — prevents duplicate edges
- `@@index([followerId, status])` + `@@index([followeeId, status])` — efficient friend lookup
- Status: PENDING | ACCEPTED | REJECTED | BLOCKED
- `blockedBy` field: who initiated the block

### User model:
- `createdAt` available (account age)
- `campusId` nullable (campus membership)
- `phone` unique, `name` optional
- Campus is visible in auth response (`campusId`, `campusName`)

### Current state:
- 62 users in dev DB
- 61 have ≤2 accepted friends (cold-start eligible)
- Existing friend search: `GET /api/social/search?q=` (name/phone contains, excludes existing connections)
- Rate limiting: per-IP (middleware) + per-user (route-local) available in rate-limit.ts

### Campus visibility contract:
- `campusId` is already exposed in `GET /api/auth/me` response
- Campus is not sensitive (it's a public university/org identifier)
- Same-campus discovery does NOT leak private graph structure

---

## NEW-USER ELIGIBILITY

### Frozen rule:
```
acceptedFriendCount <= 2
```

**Rationale:** Social cold-start is defined by lack of friends, not account age or order count. A user who registered 2 years ago but has 0 friends is still socially cold. A user who registered yesterday but was invited by friends and already has 3 connections doesn't need seeding.

### Exit condition:
```
acceptedFriendCount >= 3
```
Once user has 3 accepted friends, section disappears. 3 is the minimum for a functional social feed (S5D's "Friends Ordering Nearby" shows 3 activities).

### Optional secondary exit:
User dismisses section → not implemented in MVP (no dismiss API). Exit is purely friendCount-driven.

---

## CANDIDATE SOURCES

### Source 1: Friends-of-friends (primary)
```
A → accepted friend B
B → accepted friend C
C is a candidate (if not already excluded)
```

### Source 2: Same campus (fallback)
If fewer than 3 mutual candidates, fill with same-campus users who have ≥1 accepted connection (minimum trust signal).

### Rejected sources:
- C. Same recent restaurant/order context — too narrow, limited candidates
- D. Directory/search popularity — no popularity signal exists
- E. Imported contacts — no consent infrastructure
- F. Random users — no relevance signal

---

## PRIVACY / BLOCK CONTRACT

### Traversal rule:
```
ONLY traverse through currently ACCEPTED, non-blocked first-degree edges.
```

### Blocked-chain isolation:

| Scenario | Behavior |
|----------|----------|
| A blocks C | C excluded from candidates (blockedBy check) |
| C blocks A | C excluded from candidates (blockedBy check) |
| A blocks B | B's friends NOT traversed (blocked edge = no traversal) |
| B blocks C | C still reachable via A→D→C (different path), but NOT via A→B→C |

### Exclusion list (applied to every candidate):
1. Self (A)
2. Already accepted friends
3. Pending sent requests
4. Pending received requests
5. Blocked relationships (either direction)
6. Users who blocked the viewer
7. Users the viewer blocked
8. Inactive/suspended users (if any exist)

---

## MUTUAL CONTEXT CONTRACT

### Decision: Show bucketed mutual count, NOT identities.

**Rationale:** Exact large counts (e.g., "12 mutual friends") reveal graph density — a privacy-sensitive signal. Bucketed count ("3+") limits information leakage while still providing useful social proof.

### UI display:
- 1 mutual: "1 mutual connection"
- 2 mutual: "2 mutual connections"
- 3+ mutual: "3+ mutual connections"

### Forbidden:
- Mutual friend names
- Mutual friend IDs
- Mutual friend avatars
- Graph path (which friend connects to which candidate)
- Exact count beyond 3

---

## CANDIDATE PROJECTION

```json
{
  "id": "candidate-opaque-id",
  "name": "Priya",
  "avatarColor": "violet",
  "reason": "MUTUAL",
  "mutualCountBucket": "2"
}
```

### Field decisions:
- `id`: Required for Add Friend button (POST /api/social/connections needs followeeId). This is the same `userId` already exposed in friend search results. NOT graph metadata.
- `name`: Already exposed in search results. Safe.
- `avatarColor`: Derived from userId. Safe.
- `reason`: "MUTUAL" | "CAMPUS" — minimal signal, no graph path.
- `mutualCountBucket`: "1" | "2" | "3+" — bucketed, no identities.

### Forbidden fields:
- phone, email, blockedBy
- exact mutual user IDs
- graph path (A→B→C)
- order IDs, activity IDs
- session/token
- private profile metadata
- campusId (already public, but not needed for seed card)

---

## RANKING FORMULA

### Deterministic lexicographic:

```
PRIMARY:   mutualAcceptedFriendCount DESC
           (more mutual friends = higher trust = higher rank)

SECONDARY: candidate.createdAt DESC
           (newer accounts first — fresher social context for cold-start users)

TERTIARY:  candidateId ASC
           (deterministic tie-breaker)
```

### Not used:
- Raw Like count — vanity, gaming risk
- Raw activity volume — spam risk
- Number of sent requests — no quality signal
- Notification count — irrelevant
- Account age weights — opaque, unnecessary

### Why candidate.createdAt as secondary:
For cold-start users, newer candidates are more likely to be actively looking for friends (similar cold-start situation). This creates a natural "connect with other new users" signal.

---

## CAMPUS FALLBACK

### Trigger:
Fewer than 3 mutual candidates available.

### Rule:
Fill remaining slots (up to 3 total) with same-campus users who:
1. Have `campusId` matching viewer's `campusId`
2. Have ≥1 accepted connection (minimum trust signal — not a completely isolated account)
3. Are not in the exclusion list
4. Are not already in the mutual candidate list

### Campus visibility:
- `campusId` is already public (in auth response, restaurant API)
- Campus is not sensitive — it's a university/org identifier
- Same-campus suggestion does NOT leak private graph structure

### Priority:
Mutual candidates always rank above campus fallback candidates (MUTUAL reason > CAMPUS reason in sort).

---

## ABUSE CONTROLS

### Existing defenses (reused):
- OTP login (phone verification required)
- Campus binding (reduces anonymous accounts)
- Friend request rate limiting (S4B: 20/min/user on search, middleware IP-based)
- Block isolation (S4A)
- `@@unique([followerId, followeeId])` prevents duplicate requests

### S5H3-specific:
- **Minimum trust threshold for candidates:** Candidate must have ≥1 accepted connection. This is naturally true for friends-of-friends (they have at least the mutual friend). For campus fallback, explicitly required.
- **Decline cooldown:** NOT implemented in MVP. Current schema stores REJECTED status, but there's no "lastDeclinedAt" field. If a candidate was previously declined, they still appear (the existing connection was deleted, so they're eligible again). **Classification: DEFERRED_PRODUCT_POLICY.** Not a blocker — existing friend request flow handles this (user can decline again).
- **Request spam:** Existing per-user rate limiting on friend requests is sufficient. The seed endpoint is read-only (GET). The Add Friend button uses the existing POST /api/social/connections (already rate-limited).

### Not overbuilt:
- No daily request cap beyond existing rate limits
- No candidate cooldown (would need schema change)
- No account-age threshold beyond the ≥1 connection rule

---

## API CONTRACT

### Endpoint
```
GET /api/social/friend-seed
```

### Response (200 — eligible)
```json
{
  "eligible": true,
  "candidates": [
    {
      "id": "cmt8...",
      "name": "Priya",
      "avatarColor": "violet",
      "reason": "MUTUAL",
      "mutualCountBucket": "2"
    },
    {
      "id": "cmt8...",
      "name": "Rahul",
      "avatarColor": "teal",
      "reason": "MUTUAL",
      "mutualCountBucket": "1"
    },
    {
      "id": "cmt8...",
      "name": "Ananya",
      "avatarColor": "rose",
      "reason": "CAMPUS",
      "mutualCountBucket": "0"
    }
  ]
}
```

### Response (200 — not eligible, ≥3 friends)
```json
{
  "eligible": false,
  "candidates": []
}
```

### Response (200 — eligible but 0 candidates)
```json
{
  "eligible": true,
  "candidates": []
}
```

### Auth: getSessionUser() required (401 if no session)
### Result cap: 3 candidates max

---

## QUERY CONTRACT

### Server-side query strategy:

```sql
-- Step 1: Check eligibility (viewer has <=2 accepted friends)
SELECT COUNT(*) FROM SocialConnection
WHERE followerId = ? AND status = 'ACCEPTED'

-- Step 2: Get viewer's accepted friends (bidirectional, excludes BLOCKED)
SELECT followeeId AS friendId FROM SocialConnection
WHERE followerId = ? AND status = 'ACCEPTED'
UNION
SELECT followerId AS friendId FROM SocialConnection
WHERE followeeId = ? AND status = 'ACCEPTED'

-- Step 3: Get exclusion set (existing connections of any status)
SELECT followeeId FROM SocialConnection WHERE followerId = ?
UNION
SELECT followerId FROM SocialConnection WHERE followeeId = ?

-- Step 4: Traverse second-degree (friends-of-friends)
-- For each friend B in step 2, get B's accepted friends C
SELECT DISTINCT c.followeeId AS candidateId
FROM SocialConnection c
WHERE c.followerId IN (friendIds from step 2)
  AND c.status = 'ACCEPTED'
  AND c.followeeId NOT IN (exclusion set from step 3)
  AND c.followeeId != ? (viewer)

-- Step 5: Count mutual friends for each candidate
SELECT candidateId, COUNT(DISTINCT connectorId) AS mutualCount
FROM (
  SELECT c.followeeId AS candidateId, c.followerId AS connectorId
  FROM SocialConnection c
  WHERE c.followerId IN (friendIds from step 2)
    AND c.status = 'ACCEPTED'
    AND c.followeeId IN (candidates from step 4)
) GROUP BY candidateId
ORDER BY mutualCount DESC, candidateId ASC

-- Step 6: If <3 mutual candidates, fill with same-campus fallback
SELECT u.id, u.name
FROM User u
WHERE u.campusId = ? (viewer's campus)
  AND u.id NOT IN (exclusion set + mutual candidates already selected)
  AND u.id != ? (viewer)
  AND EXISTS (SELECT 1 FROM SocialConnection WHERE followerId = u.id AND status = 'ACCEPTED')
ORDER BY u.createdAt DESC
LIMIT (3 - mutualCount)

-- Step 7: Fetch candidate profiles (name only)
SELECT id, name FROM User WHERE id IN (candidateIds)
```

### Challenges addressed:
- **N+1:** Batch — 7 queries, but steps 4-5 can be combined
- **Duplicate reciprocal rows:** UNION deduplicates in step 2
- **Stale one-way ACCEPTED:** Both directions queried via UNION
- **Blocked users:** Exclusion set includes all statuses (PENDING, ACCEPTED, REJECTED, BLOCKED)
- **Large graph:** Bounded by friend-of-friend depth (2 hops), cap 3 results
- **Self-exclusion:** Explicit `!= viewer` filter

---

## UI CONTRACT

### Section: "People you may know"

**Placement:** On Friends screen (Social → Friends sub-tab), above the search bar.

**Wording:** "People you may know" — neutral, doesn't imply hidden knowledge.

### Card content:
- Avatar (avatarColor initial)
- Name
- "1 mutual connection" / "2 mutual connections" / "3+ mutual connections" (if reason=MUTUAL)
- "Same campus" (if reason=CAMPUS)
- "Add friend" button

### Behavior:
| State | UI |
|-------|-----|
| 0 candidates | Section absent |
| 1-3 candidates | Cards visible with Add Friend buttons |
| Not eligible (≥3 friends) | Section absent |
| Loading | Skeleton |
| API failure | Section hidden |

### Add Friend flow:
Uses existing `POST /api/social/connections` (sendRequest in social-store). No new mutation path. After request sent, candidate remains visible but button changes to "Pending" (existing social-store behavior).

---

## MEASUREMENT CONTRACT

### Primary metric:
```
friend-seed card → friend-request conversion
```
(How many seed suggestions result in a friend request?)

### Secondary:
- Request → accepted conversion
- Seed impression count
- Candidate reason distribution (MUTUAL vs CAMPUS)

### Guardrails:
- Block rate (should not increase)
- Decline rate (should not be abnormally high)
- Request spam rate (existing rate limiting should catch)
- Section dismissal rate (if dismiss feature added later)

### Counter-metrics (NOT success):
- Raw requests sent (quality > quantity)
- Time-in-app

---

## ANALYTICS PRIVACY

### Events:
```
FRIEND_SEED_IMPRESSION — section renders with >0 candidates
FRIEND_SEED_REQUEST_SENT — user clicks Add Friend on a seed candidate
```

### Safe dimensions:
```
experimentId: "s5h3-new-user-friend-seed"
variant: "treatment"
rankPosition: 1-3
candidateReason: "MUTUAL" | "CAMPUS"
mutualCountBucket: "0" | "1" | "2" | "3+"
```

### Forbidden:
```
candidateId (not logged — too close to identity)
candidate phone/email
mutual friend IDs
graph path
orderId/sourceOrderId
blockedBy
session/token
```

### Note on candidateId:
Not logged in analytics. The restaurantId field is replaced by a generic `rankPosition` — no restaurant context needed for friend-seed events.

---

## PERFORMANCE

### Query cost estimation:

| Scale | Estimated cost |
|-------|---------------|
| 2 friends, 10 fof candidates | ~5ms (4 indexed queries) |
| 2 friends, 50 fof candidates | ~10ms |
| 2 friends, 250 fof candidates | ~20ms |
| 2 friends, 1000 fof candidates | ~40ms (may need optimization) |

### Existing indexes (sufficient):
- `SocialConnection(followerId, status)` ✅ — efficient friend lookup + fof traversal
- `SocialConnection(followeeId, status)` ✅ — efficient reverse lookup
- `User(campusId)` — no index yet ⚠️

### Index recommendation:
**New index:** `User(campusId)` — for the campus fallback query. Without this, a full table scan on User for same-campus users.

**Classification:** Not a blocker for S5H3 implementation. Dev handles current volume. Add before production.

---

## RUNTIME MODEL

### Fixtures:

| Fixture | Setup | Expected |
|---------|-------|----------|
| R1 | C=3 mutuals, D=2, E=1 | C > D > E (rank by mutualCount) |
| R2 | F=5 mutuals, but F blocked by A | F excluded |
| R3 | H=6 mutuals, but H already friend | H excluded |
| R4 | G=4 mutuals, but G has pending request | G excluded |
| R5 | 0 mutual candidates + same-campus users | Campus fallback fills 3 |
| R6 | 0 candidates total | Section absent |

### Mandatory Ranking Matrix:

| Candidate | Mutuals | State | Expected |
|-----------|---------|-------|----------|
| C | 3 | eligible | rank 1 |
| D | 2 | eligible | rank 2 |
| E | 1 | eligible | rank 3 |
| F | 5 | blocked | excluded |
| G | 4 | pending | excluded |
| H | 6 | already friend | excluded |

---

## MANDATORY CONTRACT MATRIX

| Contract | Decision | Evidence | Risk | Ready? |
|----------|----------|----------|------|--------|
| New-user eligibility | acceptedFriendCount <= 2 | Social cold-start definition | Low | ✅ |
| Exit condition | acceptedFriendCount >= 3 | 3 friends = functional social feed | Low | ✅ |
| Candidate source | Friends-of-friends (primary) + same-campus (fallback) | Reuses existing graph | Low | ✅ |
| Mutual count | DISTINCT connectorId, bucketed "1"/"2"/"3+" | Prevents graph density leak | Low | ✅ |
| Block isolation | Traversal only through ACCEPTED non-blocked edges | S4A preserved | Low | ✅ |
| Pending exclusion | All existing connections excluded | Prevents re-suggest | Low | ✅ |
| Existing-friend exclusion | All statuses in exclusion set | Prevents duplicate suggestions | Low | ✅ |
| Campus fallback | Same-campus + ≥1 connection, fills remaining slots | Campus is public, not sensitive | Low | ✅ |
| Candidate projection | name + avatarColor + reason + mutualCountBucket only | No graph path, no PII | Low | ✅ |
| Ranking | mutualCount DESC → candidate.createdAt DESC → candidateId ASC | Deterministic, trust-based | Low | ✅ |
| Result cap | 3 candidates | Bounded, focused | Low | ✅ |
| Add-friend mutation path | Existing POST /api/social/connections | No new mutation path | Low | ✅ |
| Abuse controls | ≥1 connection for candidates + existing rate limiting | Reuses S4B defenses | Low | ✅ |
| Analytics privacy | rankPosition + candidateReason + mutualCountBucket only | No candidateId, no friend IDs | Low | ✅ |
| Performance | 4 indexed queries, ~10ms at 50 fof | Needs User(campusId) index for prod fallback | Medium | ✅ |

---

## BLOCKERS

**No hard blockers.**

**Production notes:**
- Add `User(campusId)` index before production launch (campus fallback query performance)
- Decline cooldown deferred (would need schema change — `lastDeclinedAt` on SocialConnection)
- Not a blocker for S5H3 implementation

---

## FINAL VERDICT

```text
S5H3_IMPLEMENTATION_READY
```

**Key design decisions:**
1. **Eligibility:** `acceptedFriendCount <= 2` (social cold-start, not account age)
2. **Exit:** `acceptedFriendCount >= 3` (section disappears automatically)
3. **Candidate source:** Friends-of-friends (primary) + same-campus (fallback)
4. **Privacy:** No mutual identities exposed. Bucketed count only ("1"/"2"/"3+"). No graph path.
5. **Block isolation:** Traversal only through ACCEPTED non-blocked edges. Blocked users never appear as candidates.
6. **Ranking:** mutualCount DESC → candidate.createdAt DESC → candidateId ASC
7. **Cap:** 3 candidates max
8. **Add Friend:** Uses existing POST /api/social/connections (no new mutation path)
9. **Analytics:** FRIEND_SEED_IMPRESSION + FRIEND_SEED_REQUEST_SENT. Safe dimensions only (rankPosition, candidateReason, mutualCountBucket). No candidateId.
10. **Experiment:** Instrumentation ACTIVE, randomized A/B DEFERRED
11. **Realtime:** Page-load fetch. No new realtime events. Existing S5B connection invalidation sufficient.
