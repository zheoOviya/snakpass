# PRODUCT-GJ02-SOCIAL-S4-HARDENING-READ-PLAN-FIRST-02
## Final Mandatory Report

## BASELINE
```
HEAD:           b974f0b5305debca4615a09230d10acad6fa7c01
Remote:         b974f0b5305debca4615a09230d10acad6fa7c01
Working tree:   clean
S1/S2/S3 checkpoint ancestor: YES (b974f0b)
Source diff:    0 lines (unchanged)
```

## ARCHITECTURE MAP
```
User → SocialConnection (bidirectional, @@unique([followerId, followeeId]))
     → SocialActivity (actorId, verb UPPERCASE, visibility FRIENDS|PUBLIC|PRIVATE)
        → Like (@@unique([userId, activityId]))
     → Notification (dedupKey, @@unique([userId, dedupKey]))

Authorization: getSessionUser() on all routes, CSRF on mutations
Ownership: connection party-check, activity actorId hardcoded, like session-derived
Uniqueness: connection pair, like pair, notification dedupKey
Pagination: feed=offset(page/limit), notifications=cursor, connections=NONE, search=cap20
Deletion: connections DELETE cascades both edges; activities append-only; likes/notifications no delete
Privacy: FRIENDS requires ACCEPTED, PRIVATE excluded from feed+like, PUBLIC any auth
Concurrency: withTransaction+retry on connections; raw db on like (no tx)
```

## SECURITY FINDINGS

### P0 (3)
| ID | Finding | Reason Code | Evidence |
|----|---------|-------------|----------|
| S-01 | Blocked user can re-send friend request — bypass via broken `existing.followerId === followeeId` predicate + delete-and-recreate fallback | BYPASS_AFTER_BLOCK | connections/route.ts:239-294 |
| S-02 | Either party can DELETE a BLOCKED row → self-unblock (no blockedBy check on DELETE) | BLOCK_SELF_DELETE | connections/[id]/route.ts:439-554 |
| S-03 | Block-bypass triggers fresh FRIEND_REQUEST_RECEIVED notification to the blocker | NOTIF_LEAK_AFTER_BLOCK | connections/route.ts:296-332 |

### P1 (4)
| ID | Finding | Reason Code | Evidence |
|----|---------|-------------|----------|
| S-04 | No explicit /unblock endpoint | NO_UNBLOCK_ENDPOINT | no route exists |
| S-05 | Phone numbers exposed in plaintext in search results (even for name-based queries) | PHONE_EXPOSED_IN_SEARCH | search/route.ts:104-118 |
| S-06 | Like route: notification outside transaction, non-P2002 errors swallowed silently | TX-BOUNDARY | like/route.ts:75-117 |
| S-07 | Social audit writes bypass hash-chain → breaks auditIntegrityCheck() | INTEGRITY | 4 social routes use raw tx.auditLog.create instead of audit() helper |

## PRIVACY FINDINGS
```
S-05: Phone exposed in search (P1)
S-08: GET /connections leaks BLOCKED rows + peer name/phone to blocked party (P2)
S-09: User enumeration via 2-char prefix × 20-result cap × IP rate limit (P2)
```

## BLOCK SEMANTICS
```
Current: Symmetric flip — both rows set to BLOCKED on PATCH/DELETE+block
Bypass: findFirst returns one row; if follower=self, predicate fails → delete+recreate
No blockedBy column — ownership only in audit log metadata
No unblock endpoint — only broken DELETE
BLOCKED rows visible to both parties in GET /connections (peer PII leaked)
Feed/Like correctly exclude blocked peers (ACCEPTED filter + visibility check)
Search correctly excludes blocked users (excludedIds built from ALL statuses)
```

## FEED INTEGRITY
```
FRIENDS privacy: PASS — feed filters status=ACCEPTED + visibility IN [FRIENDS,PUBLIC]
PRIVATE privacy: PASS — excluded from feed + cannot be liked (403)
Blocked: PASS — BLOCKED ≠ ACCEPTED, excluded from friendIds
Metadata: PASS — sanitized on WRITE + READ (defense-in-depth)
Unknown verb: PASS — renders as fallback "ordered from"
Corrupted JSON: PASS — try/catch → {}
Pagination: offset-based, stable for current scale (P2 at 100K+)
```

## LIKE HARDENING
```
Concurrent POST: PASS — P2002 unique constraint + idempotent handling
Concurrent POST+DELETE: guarded by likingId flag (prevents double-click)
Deleted activity: no DELETE route → activities are append-only (no orphan)
Relationship removed after like: like remains (orphan-like, no FK) — P3
Self-like: PASS — no notification (activity.actorId !== session.userId check)
Like orphaning: Like has no FK to SocialActivity — if activity somehow deleted, like persists
```

## NOTIFICATION HARDENING
```
Dedup race: PASS — P2002 on @@unique([userId, dedupKey])
Producer transaction: connections INSIDE withTransaction (atomic); Like OUTSIDE (P1 S-06)
Legacy NULL dedupKey: preserved (no migration) — legacy rows can't be deduped
Cursor stability: createdAt non-unique (P3 — could skip same-ms rows)
Mark-one concurrency: idempotent (already-read returns 200 without mutation)
Mark-all concurrency: updateMany scoped to userId+readAt=null (safe)
Notification payload: minimal (no amount/paymentId/OTP/tokens — PASS)
```

## REFERENTIAL INTEGRITY
```
SocialConnection: no FK to User (plain String columns)
SocialActivity: no FK to User/Restaurant/Order (plain String objectId)
Like: no FK to User/SocialActivity (plain String columns)
Notification: no FK to User (plain String userId)
→ Orphan rows accumulate if source entities deleted (latent, not active)
→ Activities are append-only (no delete route) → no active orphaning
→ Connections DELETE cascades both edges → no orphan edges
```

## PAGINATION / SCALE
```
Connections: NO pagination (loads ALL rows) — P2 at 1000+ connections
Feed: offset (skip/take) — P2 at 100K+ activities; count() on every page
Search: cap 20, no pagination — P2; LIKE '%q%' full table scan
Notifications: cursor (correct) — P3 missing (userId, createdAt) index
IN clauses: friendIds + excludedIds + peerIds — unbounded — P2
Missing indexes: (actorId, visibility, createdAt) on SocialActivity; (userId, createdAt) on Notification — P3
N+1: NONE (all batched) — PASS
```

## RATE LIMIT / ABUSE
```
All /api/social/* → 'general' bucket (100/min/IP, fail-open) — P2/P3
No per-user throttling — P2
No per-endpoint tightening — P3
X-Forwarded-For trusted without validation — P2 (spoofable)
Search enumeration: 100 prefixes × 20 results = 2000 users/min/IP — P2
Friend-request spam: 100 targets/min/IP — P2
Like spam: 100 likes/min/IP — P3 (idempotent, low impact)
Notification amplification: mass-accept+unfriend+re-friend — P3 (latent, no GET API for legacy)
```

## CLIENT RESILIENCE
```
Feed failure: banner on feed tab only; friends tab silent — P3
Connections failure: friends tab shows false-empty (no error) — P2
Like optimistic: correct + rollback on failure — PASS
markAsRead: correct + rollback on failure — PASS
sendRequest: false-success on malformed response — P2
unfollow: throws if connections list empty — P2
Loading states: skeletons present — PASS
```

## CONTRACT MISMATCHES
```
S-10: Duplicate ACCEPTED connections in list (no dedup) — P1
S-11: Search returns avatarColor, client expects avatarUrl — P2
S-12: SocialActivity type over-promises fields never returned (commentCount, actorAvatarUrl, etc.) — P3
S-13: Notification type has no DB enum constraint — P3
S-14: POST connections response omits direction + acceptedAt — P3
```

## SECURITY CHALLENGE MATRIX

| # | Scenario | Verdict |
|---|----------|---------|
| 1 | Cross-user notification PATCH | PASS |
| 2 | Self-friend-request | PASS |
| 3 | Duplicate friend request | PARTIAL (BLOCKED bypass) |
| 4 | Blocked user sends request | FAIL (P0) |
| 5 | Cross-user Like on FRIENDS | PASS |
| 6 | PRIVATE activity Like | PASS |
| 7 | Unknown visibility | PASS |
| 8 | Sensitive metadata | PASS |
| 9 | Cross-user notification read | PASS |
| 10 | Malformed cursor in feed | PASS (uses page/limit, not cursor) |
| 11 | Large search query (DoS) | FAIL (P2 — no length cap) |
| 12 | Deleted source object | PASS (append-only, no FK) |

## PRIORITIZED FINDINGS

| ID | Severity | Reason Code | Finding | Recommended Treatment |
|----|----------|-------------|---------|----------------------|
| S-01 | P0 | BYPASS_AFTER_BLOCK | Blocked user re-sends request | Add blockedBy column; findMany instead of findFirst; 403 on ANY BLOCKED row |
| S-02 | P0 | BLOCK_SELF_DELETE | Either party DELETEs BLOCKED row | Require blockedBy === session.userId on DELETE of BLOCKED |
| S-03 | P0 | NOTIF_LEAK_AFTER_BLOCK | Block-bypass sends notification to blocker | Skip notification when target has blocked requester |
| S-04 | P1 | NO_UNBLOCK_ENDPOINT | No explicit unblock | Add PATCH status=UNBLOCKED or DELETE /connections/[id]/block |
| S-05 | P1 | PHONE_EXPOSED_IN_SEARCH | Phone leaked in name-based search | Only return phone when query is all-digit; mask otherwise |
| S-06 | P1 | TX-BOUNDARY | Like notification outside transaction | Wrap like+notification in withTransaction |
| S-07 | P1 | INTEGRITY | Audit writes bypass hash-chain | Use audit() helper in social routes |
| S-10 | P1 | CONTRACT | Duplicate ACCEPTED connections | Dedup by peerId in GET /connections |
| S-08 | P2 | BLOCK_LEAK | BLOCKED rows + PII leaked to blocked party | Filter BLOCKED from GET /connections for blocked party |
| S-09 | P2 | USER_ENUMERATION | Search enumeration via 2-char prefixes | Per-user rate limit + 3-char minimum |
| S-11 | P2 | CONTRACT | Search avatarColor vs avatarUrl mismatch | Align field names |
| S-15 | P2 | SCALE | No pagination on connections list | Add cursor pagination |
| S-16 | P2 | SCALE | Feed offset pagination + client Load-more broken | Convert to cursor; wire store to fetch page 2 |
| S-17 | P2 | SCALE | Search LIKE full table scan | Add pg_trgm index |
| S-18 | P2 | SCALE | Unbounded IN clauses | Batch or cap |
| S-19 | P2 | CLIENT-UX | Connections failure shows false-empty | Add error toast to Friends tab |
| S-20 | P2 | CLIENT-UX | sendRequest false-success on malformed response | Check response shape |
| S-21 | P2 | CLIENT-UX | unfollow throws if connections empty | Auto-refresh-and-retry |
| S-22 | P2 | SEARCH_QUERY_NO_LENGTH_CAP | No upper bound on q.length | Cap at 64 chars |
| S-23 | P2 | RATE_LIMIT_SPOOFABLE | X-Forwarded-For trusted blindly | Validate against trusted proxy |

## PROPOSED S4 WAVES

```
S4A: Security / Block Semantics (S-01, S-02, S-03, S-04, S-08)
  - Add blockedBy column to SocialConnection
  - Fix findFirst → findMany in POST /connections
  - Add blockedBy authorization to DELETE
  - Add unblock endpoint
  - Filter BLOCKED from GET /connections for blocked party
  Files: schema.prisma, connections/route.ts, connections/[id]/route.ts
  Browser gates: blocked user cannot re-request, cannot self-unblock, blocked party doesn't see BLOCKED row

S4B: Privacy / Enumeration / Abuse (S-05, S-09, S-22, S-23)
  - Mask phone in search results (name-based queries)
  - Add per-user rate limit for search
  - Cap q.length at 64
  - Validate X-Forwarded-For
  Files: search/route.ts, middleware.ts, rate-limit.ts
  Browser gates: phone not visible in name search, search throttled

S4C: Data Integrity / Concurrency (S-06, S-07, S-10)
  - Wrap Like+notification in withTransaction
  - Use audit() helper in social routes
  - Dedup ACCEPTED connections in GET /connections
  Files: like/route.ts, connections/route.ts, all social routes
  Browser gates: no duplicate friends, notification atomic with like

S4D: Pagination / Performance (S-15, S-16, S-17, S-18)
  - Add cursor pagination to GET /connections
  - Convert feed to cursor pagination
  - Wire social-store to fetch page 2
  - Add pg_trgm index on User.name/phone
  - Cap/batch IN clauses
  Files: connections/route.ts, feed/route.ts, social-store.ts, social-screen.tsx, schema.prisma
  Browser gates: load-more fetches new page

S4E: Client Resilience (S-19, S-20, S-21, S-11)
  - Error toast on Friends tab failure
  - Check sendRequest response shape
  - Auto-refresh-and-retry in unfollow
  - Align search avatarColor/avatarUrl field names
  Files: friends-screen.tsx, social-store.ts, social-screen.tsx
  Browser gates: error feedback on failure, no false-success

S4F: Browser Hardening Closure
  - All S4A-E browser evidence
  - Negatives re-run
  - Regression S1/S2/S3
```

## S1/S2/S3 REGRESSION RISK
```
S1: LOW — block fix touches connections routes but not feed/search/activities
S2: LOW — Like tx wrapping doesn't change S2 semantics (idempotent + visibility)
S3: LOW — notification producer change is additive (same dedupKey, same P2002 handling)
All waves must re-run S1/S2/S3 browser evidence as regression
```

## CODE CHANGES: NONE
## FINAL IDE VERDICT: S4_PLAN_READY
