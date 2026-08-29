# PRODUCT-GJ02-SOCIAL-S4-HARDENING-READ-PLAN-FIRST-01
## Final Mandatory Report

## BASELINE
```
HEAD:     41d375b4549e259cd8097ab462f2d596198702f1
Branch:   main
Status:   clean working tree (only .zscripts/dev.pid modified — runtime artifact)
```

### CRITICAL STATE DISCLOSURE

The directive asked to audit "S1-S3 as one integrated Social subsystem." However, **the actual git tree at HEAD 41d375b does NOT contain S2 or S3 implementations**:

| Component | Expected (per directive) | Actual State |
|-----------|--------------------------|--------------|
| S1 Foundation (connections, activities, feed, search) | ✅ CLOSED | ✅ Present (Wave 6 Tasks 6A-6D) |
| S2 Persistent Likes (Like model, like API, feed projection) | ✅ CLOSED | ❌ **ABSENT** — no `Like` model, no `/api/social/activities/[id]/like` route |
| S3 Notifications (notifications API, NotificationBell, dedupKey) | ✅ CLOSED | ❌ **ABSENT** — no `/api/notifications/` directory, Notification schema has no `dedupKey`, `notification-store.ts` is dead code |

The conversation summary's S1/S2/S3 closure claims reference commit SHAs (`9b2a9d9`, `ceb0a73`, `15a3fdd`) that **do not exist in this repository's git history**. The worklog confirms Social work was done under "Wave 6 Tasks 6A/6B/6C/6D" — not S1/S2/S3 subwaves.

**This audit is grounded in the ACTUAL source tree**, not the conversation summary's closure claims. All findings below are verified against real files at HEAD 41d375b.

---

## CURRENT SOCIAL ARCHITECTURE

```
API Routes (5 total, all under /api/social/):
  GET  /api/social/search           — user search by name/phone (cap 20)
  GET  /api/social/connections      — list connections (NO pagination)
  POST /api/social/connections      — send friend request
  PATCH /api/social/connections/[id] — accept/reject/block
  DELETE /api/social/connections/[id] — unfriend/block
  POST /api/social/activities       — record activity (NO GET handler)
  GET  /api/social/feed             — friend activity feed (offset pagination)

Schema Models:
  SocialConnection — followerId, followeeId, status, @@unique([followerId, followeeId])
  SocialActivity   — actorId, verb, objectType, objectId, metadata, visibility
  Notification     — userId, type, title, body, data, readAt (NO dedupKey, NO API)

Missing (claimed as closed but absent):
  ❌ Like model (S2)
  ❌ /api/social/activities/[id]/like route (S2)
  ❌ /api/notifications/ route tree (S3)
  ❌ NotificationBell component (S3)
  ❌ dedupKey field on Notification (S3)

Client Components:
  social-screen.tsx, friends-screen.tsx, social-feed-card.tsx, social-store.ts
  notification-store.ts (DEAD CODE — zero imports)
```

---

## AUTHORIZATION MATRIX

| # | Action | Route | Auth | CSRF | Server Authz | Cross-user | Blocked | PRIVATE | Unauth |
|---|--------|-------|------|------|---------------|------------|---------|---------|--------|
| 1 | Search users | GET /search | ✅ 401 | N/A (GET) | Excludes self + all connections (any status) | Any user by name/phone | ✅ Excludes blocked | N/A | 403 CSRF (middleware fires before 401) |
| 2 | List connections | GET /connections | ✅ 401 | N/A | Self-scoped (OR follower/followee) | Self-only | ⚠️ Returns BLOCKED to BOTH parties | N/A | 403 CSRF |
| 3 | Send request | POST /connections | ✅ 401 | ✅ | followerId=session.userId (hardcoded) | Any valid target | ✅ 403 BLOCKED_BY_TARGET (target-blocked only) | N/A | 403 CSRF |
| 4a | Accept | PATCH [id] ACCEPTED | ✅ 401 | ✅ | Followee-only (recipient) | Server-enforced | ✅ 409 on BLOCKED | N/A | 403 CSRF |
| 4b | Block | PATCH [id] BLOCKED | ✅ 401 | ✅ | Either party (symmetric) | Server-enforced | ✅ Flips both rows | N/A | 403 CSRF |
| 4c | Reject | PATCH [id] REJECTED | ✅ 401 | ✅ | Followee-only | Server-enforced | N/A | N/A | 403 CSRF |
| 5 | Unfriend/Block | DELETE [id] | ✅ 401 | ✅ | Either party | Server-enforced | ✅ Dual-row block | N/A | 403 CSRF |
| 6 | Create activity | POST /activities | ✅ 401 | ✅ | actorId=session.userId (hardcoded) | Self-only | No block check | ❌ Cannot create PRIVATE (validation rejects) | 403 CSRF |
| 7 | Read feed | GET /feed | ✅ 401 | N/A | Self-scoped (accepted friends only) | Self-only | ✅ Implicit (BLOCKED ≠ ACCEPTED) | ❌ PRIVATE excluded (but also can't be created) | 403 CSRF |

**Key finding**: Authorization is server-enforced everywhere — NO authorization relies solely on UI hiding. However, UI↔server contract is broken (see P0 findings below).

---

## BLOCK CONTRACT

### Current Behavior (defective)
```
A blocks B → both rows (A→B and B→A) flipped to BLOCKED
```

### 8 Scenarios Audited

| Scenario | Result | Verdict |
|----------|--------|---------|
| Can A see B in search? | Hidden | ✅ Correct |
| Can B see A in search? | Hidden | ✅ Correct |
| Can B send request to A? | **YES — bypass via re-POST** (findFirst returns one row; if follower=self, deletes block + creates PENDING) | ❌ CODE DEFECT |
| Can B see A's feed activities? | Hidden (BLOCKED ≠ ACCEPTED) | ✅ Correct |
| Can old ACCEPTED edge remain? | No (both rows overwritten) | ✅ Correct |
| Notifications generated on block? | None (intentional) | ✅ Correct |
| Can search surface blocked users? | No | ✅ Correct |
| Is there an unblock endpoint? | **NO** — comments promise "explicit unblock" but no endpoint exists | ❌ CONTRACT GAP |

### Additional Block Defects
1. **Blockee can DELETE the block** — DELETE authorizes either party, doesn't check who blocked
2. **Re-POST leaves stale reverse-edge** — state becomes A→B=PENDING, B→A=BLOCKED (non-deterministic)
3. **`findFirst` instead of `findMany`** — root cause of bypass; should inspect BOTH rows
4. **No `blockedBy` column** — schema cannot disambiguate who initiated the block

### Proposed Canonical Block Contract
```
BLOCK is unidirectional, asymmetric, terminal.
- Only the blocker's row (A→B) is set to BLOCKED
- The reverse edge (B→A) is DELETED (not flipped)
- Schema needs: blockedBy String? column
- Blocker can unblock via PATCH {status:'UNBLOCKED'} or DELETE /connections/[id]/block
- Blockee cannot unblock, cannot DELETE the block
- Blockee gets generic 403 "User not available" (no BLOCKED_BY_TARGET code)
- POST /connections uses findMany → 403 if ANY row is BLOCKED
```

---

## ABUSE / RATE-LIMIT AUDIT

### Current State
```
All 5 Social endpoints → classifyPath = 'general' → 100/min/IP, fail-open
No per-user throttling anywhere
getClientIP trusts X-Forwarded-For / X-Real-IP with NO validation (spoofable)
```

### Spam Vectors

| Vector | Mechanism | Severity |
|--------|-----------|----------|
| Mass friend requests | 100 distinct targets/min/IP, each creates PENDING + Notification | HIGH |
| Activity flooding | POST /activities 100/min, Idempotency-Key opt-in | HIGH |
| Search enumeration | 2-char min + LIKE '%q%' + no per-user throttle → entire userbase in ~7 min | MEDIUM |
| Notification amplification | Mass-accept + unfriend + re-friend cycle (latent — no GET API yet) | MEDIUM |
| Block bypass via re-request | Blockee can re-spam after block (see Block defects) | HIGH |
| IP spoofing | X-Forwarded-For header trusted blindly → unlimited | HIGH |

### Recommended Limits (PLAN ONLY)
```
social_search:           30/min + 500/day per-user
social_friend_request:  10/min + 20/hour per-user, fail-closed
social_activity_post:    20/min + 30/hour per-user, fail-closed, metadata ≤4KB
social_feed_read:        60/min
```

---

## PAGINATION / SCALE AUDIT

| Endpoint | Pagination | N+1? | Unbounded? | Scale Risk |
|----------|-----------|------|------------|------------|
| GET /feed | Offset (page/limit, max 100) | ✅ No (3 batched queries) | friendIds array unbounded | ⚠️ count() + skip-scan at 50K+ activities |
| GET /connections | **NONE** | ✅ No (2 batched queries) | ❌ Returns ALL rows | ❌ 1000 connections → 200KB response |
| GET /search | Hard cap 20 | ✅ No | excludedIds unbounded | ⚠️ LIKE '%q%' full scan at 10K+ users |
| POST /activities | N/A | N/A | ❌ metadata no size cap | ❌ Stack overflow on deep nesting |

### Missing Indexes
- SocialConnection: no index for OR (followerId/followeeId) query, no createdAt index
- SocialActivity: no (actorId, visibility, createdAt) compound index
- User: no index on name (substring search unindexable without trigrams)

---

## NOTIFICATION FAILURE UX

**S3 notifications API does not exist.** The `notification-store.ts` file is dead code (zero component imports). Notifications ARE written to the DB by connection routes (friend_request, friend_request_accepted) but there is NO GET/PATCH/POST API to read or mark them read.

**UX hardening plan (deferred to when S3 is actually built):**
```
- Success feedback: toast on mark-read success
- Failure toast: notification-store catch block should set error state + show toast
- Retry affordance: "Retry" button on failed mark-read
- Offline state: detect navigator.onLine, queue mutations
- Slow API: skeleton loader with timeout
```

---

## FEED INTEGRITY

| Scenario | Behavior | Crash? | Severity |
|----------|----------|--------|----------|
| Actor deleted | "Unknown user" card persists forever | Graceful skip | P2 |
| Restaurant deleted | Stale cached name, tap does nothing | Graceful skip | P3 |
| Order deleted | Dangling reference, no detection | Graceful skip | P3 |
| Unfriend after activity | Activity disappears from feed (correct) | ✅ | — |
| Block after activity | Activity disappears (BLOCKED ≠ ACCEPTED) | ✅ | — |
| Legacy metadata | Passes through unchecked (no allowlist) | Graceful skip | P1 |
| Unknown verb | Renders as fallback "ordered from restaurant" | Graceful skip | P1 |
| Corrupted JSON | try/catch → {} | ✅ Graceful | — |
| Non-existent objectId | Returns as-is, no validation | Graceful skip | P3 |

**Key finding**: Feed NEVER crashes (defensive try/catch). But verb vocabulary mismatch (server UPPERCASE vs client snake_case) makes EVERY activity render as the fallback string.

---

## CONCURRENCY MATRIX

| Scenario | Race? | Protection | Verdict |
|----------|-------|------------|---------|
| Dual friend requests (A→B + B→A) | Logical race | @@unique only constrains same pair | ⚠️ Two PENDING rows, implicit auto-accept later |
| Unfriend while reading feed | No | Snapshot consistency | ✅ Safe |
| Block while sending request | No | SQLite serializes writers | ✅ Safe (but discloses block status) |
| Duplicate accept | No | State-machine guard (409) | ✅ Safe |
| Accept vs reject | No | State-machine guard (409) | ✅ Safe |
| Activity visibility change | N/A | No PATCH route exists | ❌ CONTRACT GAP |
| Mark-one vs mark-all | N/A | No notification API exists | ❌ N/A |
| Double friend-request POST | No | @@unique + retry | ✅ Safe |

### Latent Postgres Incompatibility
- `recordActivity` idempotency uses `metadata: { contains }` — full table scan, no DB uniqueness guarantee
- All mutation routes use read-then-write inside txn — safe on SQLite (single-writer lock), **needs SELECT FOR UPDATE on Postgres**

---

## PRIVACY LEAKAGE AUDIT

| # | Category | Finding | Severity |
|---|----------|---------|----------|
| 3.1 | Phone in search | `phone` returned in search results → any authenticated user can enumerate entire userbase's phones in ~100 queries | **P0** |
| 3.2 | User IDs in search | cuids returned pre-friend-request → enables persistent tracking | P1 |
| 3.3 | Activity metadata | Blocklist only (no allowlist) → `customerNote`, `deliveryAddress`, `amount_inr` pass through | P1 |
| 3.4 | Notification data | `followerName`/`followeeName` falls back to phone if User.name null → stored PII | P1 |
| 3.5 | Activity metadata shape | Server returns flat metadata; client expects projected fields → type mismatch | P1 |
| 3.6 | Search response fields | Email/campusId correctly excluded; phone is the leak | P3 |
| 3.7 | Blocked relationship | `BLOCKED_BY_TARGET` code in 403 + duplicated BLOCKED rows in GET /connections → blocked user definitively knows they're blocked | **P0** |
| 3.8 | Activity ID enumeration | Low risk (gated by friendship) | P3 |

---

## BROWSER RESILIENCE PLAN

For eventual S4 browser tests:
```
Loading state: skeleton loaders for feed/connections/notifications
Empty state: "No activities yet" / "No friends yet" / "No notifications"
Error state: error boundary + retry button
Offline: detect navigator.onLine, queue mutations
Slow API: timeout skeleton after 3s
Double-click: debounce buttons (friend request, like, mark-read)
Back navigation: cache previous feed page
Hard reload: re-fetch fresh data
Mobile viewport: test all screens at 375px
Long names: truncate with ellipsis
Large unread count: 99+ cap (already implemented in S3 design)
```

---

## FINDINGS

### P0 — Security/Privacy Violations (4)

| ID | Finding | Type | Evidence |
|----|---------|------|---------|
| P0-1 | Phone numbers exposed in search results | PRIVACY LEAK | `search/route.ts:104-118` returns `phone` per result |
| P0-2 | Blocked users explicitly informed via `BLOCKED_BY_TARGET` code + duplicated BLOCKED rows | PRIVACY LEAK | `connections/route.ts:250-267`, `connections/route.ts:67-72` |
| P0-3 | Client store reads `data.feed`, server returns `data.activities` → feed permanently empty | CONTRACT GAP | `social-store.ts:87` vs `feed/route.ts:166` |
| P0-4 | Status enum mismatch (PENDING_IN/OUT vs PENDING_SENT/RECEIVED) → Friends UI non-functional | CONTRACT GAP | `friends-screen.tsx:122-128` vs `connections/route.ts:101-103` |

### P1 — Integrity (7)

| ID | Finding | Type |
|----|---------|------|
| P1-1 | Verb vocabulary mismatch (UPPERCASE vs snake_case) → all activities render as fallback | CONTRACT GAP |
| P1-2 | Metadata blocklist insufficient — no allowlist | PRIVACY LEAK |
| P1-3 | Notification data stores phone fallback for nameless users | PRIVACY LEAK |
| P1-4 | Server feed response doesn't populate client SocialActivity type fields | CONTRACT GAP |
| P1-5 | No FK relations on Social models → orphans accumulate | CODE DEFECT |
| P1-6 | `recordActivity` idempotency via metadata substring scan — no DB uniqueness | CONTRACT GAP |
| P1-7 | `message` cap inconsistent (280 in route vs 500 in Zod schema) | CONTRACT GAP |

### P2 — Scale/Reliability (10)

| ID | Finding | Type |
|----|---------|------|
| P2-1 | Block bypass via re-POST (findFirst returns one row, deletes block) | CODE DEFECT |
| P2-2 | Blockee can DELETE block (no blockedBy check) | CODE DEFECT |
| P2-3 | No unblock endpoint (comments promise it) | CONTRACT GAP |
| P2-4 | No `blockedBy` column | CONTRACT GAP |
| P2-5 | GET /connections has NO pagination | CODE DEFECT |
| P2-6 | Feed uses offset pagination (count + skip-scan) | SCALE RISK |
| P2-7 | All Social endpoints in 'general' rate-limit bucket (100/min, fail-open) | CONTRACT GAP |
| P2-8 | Rate limiter per-IP only, no per-user throttle | CONTRACT GAP |
| P2-9 | getClientIP trusts X-Forwarded-For with no validation | CODE DEFECT |
| P2-10 | No PATCH/DELETE activity route (can't retract mis-posted activity) | CONTRACT GAP |

### P3 — UX/Polish (6)

| ID | Finding | Type |
|----|---------|------|
| P3-1 | Deleted actor activities persist as "Unknown user" forever | UX WEAKNESS |
| P3-2 | Deleted restaurant shows stale name, tap does nothing | UX WEAKNESS |
| P3-3 | Stale schema comment for SocialActivity.verb | EVIDENCE GAP |
| P3-4 | Notifications written but no GET API (dead store) | EVIDENCE GAP |
| P3-5 | Role hidden in search (can't tell vendor from consumer) | UX WEAKNESS |
| P3-6 | Zod schemas in validation.ts unused by routes | CONTRACT GAP |

---

## S4 PROPOSED WAVES

```
S4A Block Semantics & Security (P0-2, P2-1 through P2-4)
  - Add blockedBy column to SocialConnection
  - Fix block to be asymmetric (only blocker's row)
  - Add UNBLOCK endpoint
  - Fix findFirst → findMany in POST /connections
  - Add blockedBy authorization to DELETE/PATCH
  - Remove BLOCKED_BY_TARGET disclosure (generic 403)

S4B Privacy & Abuse Hardening (P0-1, P1-2, P1-3, P2-7, P2-8, P2-9)
  - Remove phone from search results
  - Replace metadata blocklist with allowlist
  - Never fall back to phone for notification names
  - Add per-user rate-limit tiers
  - Validate X-Forwarded-For against trusted proxy

S4C Pagination & Performance (P2-5, P2-6, missing indexes)
  - Add pagination to GET /connections
  - Migrate feed to cursor pagination
  - Add missing indexes (createdAt, compound visibility)
  - Cap metadata size + recursion depth

S4D Contract Reconciliation (P0-3, P0-4, P1-1, P1-4, P1-7, P3-6)
  - Fix social-store.ts to read data.activities (not data.feed)
  - Fix friends-screen.tsx status enums (PENDING_SENT/RECEIVED)
  - Fix social-feed-card.tsx verb vocabulary (UPPERCASE)
  - Align message cap (280 everywhere)
  - Remove or import unused Zod schemas

S4E Integrated Browser Hardening Gate
  - Browser tests for all S4A-D repairs
  - Loading/empty/error/offline states
  - Double-click debouncing
  - Mobile viewport verification
```

---

## IMPLEMENTATION DEPENDENCIES

```
S4A → requires schema migration (blockedBy column) → db:push
S4B → no schema changes, pure route + middleware changes
S4C → schema migration for indexes → db:push
S4D → no schema changes, client-only fixes
S4E → depends on S4A-D completion
```

## FILES LIKELY TO CHANGE

```
S4A: prisma/schema.prisma, src/app/api/social/connections/route.ts, [id]/route.ts
S4B: src/app/api/social/search/route.ts, src/lib/social-activity.ts, src/middleware.ts, src/lib/rate-limit.ts
S4C: src/app/api/social/connections/route.ts, feed/route.ts, prisma/schema.prisma
S4D: src/lib/social-store.ts, src/components/snak/screens/friends-screen.tsx, social-feed-card.tsx, src/lib/types.ts
S4E: src/components/snak/screens/*.tsx, new test scripts
```

## GOVERNANCE BOUNDARIES

```
NO realtime / Socket.io (S5 boundary)
NO push notifications (S5 boundary)
NO Gifts implementation (GJ-04 boundary)
NO Group-order changes (GJ-03 boundary)
NO production flag changes (governance freeze)
NO schema redesign beyond additive columns/indexes
NO S1/S2/S3 changes (S1 exists; S2/S3 must be BUILT first if closure claims are to be honored)
```

---

## VERDICT

```
CONDITIONAL GO
```

**Reason**: The audit is complete and comprehensive. However, two critical conditions must be resolved before any S4 implementation wave:

1. **STATE RECONCILIATION**: The conversation summary claims S1/S2/S3 are CLOSED, but the actual git tree contains only S1. S2 (Like model, like API) and S3 (notifications API, NotificationBell, dedupKey) are ABSENT. The Orchestrator must clarify:
   - Are S2/S3 closure claims from a different git history that was lost?
   - Should S4 audit findings be applied to the current S1-only tree?
   - Or should S2/S3 be re-implemented first before S4 hardening?

2. **P0 CONTRACT GAPS**: The current Social UI is non-functional due to:
   - `social-store.ts` reads `data.feed` but server returns `data.activities` (feed permanently empty)
   - Status enum mismatch (`PENDING_IN/OUT` vs `PENDING_SENT/RECEIVED`) — Friends UI non-functional
   - Phone numbers exposed in search (privacy leak)
   - Blocked users explicitly informed they're blocked (privacy leak)

These P0 issues should be resolved BEFORE any S4 hardening waves, as they represent basic functional correctness, not hardening.

```
NO CODE CHANGES — READ/PLAN-FIRST ONLY
```
