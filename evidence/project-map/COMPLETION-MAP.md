# SNAKZAP PROJECT-WIDE COMPLETION MAP

## BASELINE
```
LOCAL_HEAD = REMOTE_MAIN = 384f40e0794ee99bc1c5d4fc22e9c7db91745ee2
GJ-02 checkpoint ancestor = YES
PRODUCT SOURCE CHANGES = 0
```

---

## EXECUTIVE STATUS

SnakZap is a campus food-ordering platform (pickup-first, zero delivery) with 3 portals (Consumer, Vendor, Admin) built on Next.js 16 + Prisma + Socket.IO realtime.

**461 commits, 38 Prisma models, 102 API routes, 95 React components, 396 evidence files, 13,691-line worklog.**

The project has a **deep Foundation layer** (P0 series: auth, payments, audit chain, outbox, reconciliation, kill switches, rate limiting, idempotency) followed by **GJ-01 Consumer** (ordering, cart, checkout, payments, rewards, gifts, group orders) and **GJ-02 Social** (friend graph, likes, notifications, realtime, virality experiments).

---

## PROJECT MAP

| Workstream | Level | UI | API | DB | Runtime | Browser | Hardening | Remote-backed | Status |
|------------|------:|----|-----|----|---------|---------|-----------|---------------|--------|
| Foundation (P0) | 5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | CLOSED |
| GJ-01 Consumer | 4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL/HARDENED |
| GJ-02 Social | 5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | CLOSED |
| Vendor Portal | 3 | ✅ | ✅ | ✅ | ✅ | partial | partial | ✅ | FUNCTIONAL |
| Admin Portal | 3 | ✅ | ✅ | ✅ | ✅ | partial | partial | ✅ | FUNCTIONAL |
| Payments/Razorpay | 4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | HARDENED |
| Rewards | 4 | ✅ | ✅ | ✅ | ✅ | partial | ✅ | ✅ | HARDENED |
| Gifts | 4 | ✅ | ✅ | ✅ | ✅ | partial | ✅ | ✅ | HARDENED |
| Group Orders | 3 | ✅ | ✅ | ✅ | ✅ | partial | partial | ✅ | FUNCTIONAL |
| Reconciliation | 4 | N/A | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | HARDENED |
| Realtime | 5 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | CLOSED |

---

## APP MAP

| Surface | Completion | Main completed flows | Main missing flows |
|---------|------------|----------------------|--------------------|
| Consumer | ~90% | Onboarding, campus, discovery, restaurant detail, menu, cart, checkout, payments, order tracking, order history, rewards, gifts, group orders, social (feed/friends/search/likes/notifications) | Reviews/ratings system, coupon engine (placeholder), production payments (demo mode) |
| Vendor | ~65% | Orders accept, menu management, deals, analytics, live kitchen tracking | Full order lifecycle management, menu item CRUD completeness, vendor onboarding flow |
| Admin | ~55% | Feature flags, rewards management, fraud/risk module, support module, metrics | Full order oversight, vendor management, campus management, user management |
| Backend/services | ~85% | Realtime (socket auth + social events), outbox publisher, reconciliation engine, alert evaluator, backup scheduler, invariant checker | Production payment gateway (demo mode), advanced observability |

---

## FOUNDATION STATUS

| Component | Level | Status |
|-----------|------:|--------|
| Authentication (OTP + session) | 5 | CLOSED — phone OTP, session cookies, admin 2FA |
| RBAC | 4 | HARDENED — CONSUMER/VENDOR_OWNER/ADMIN/SUPER_ADMIN |
| CSRF | 5 | CLOSED — double-submit cookie, csrfFetch helper |
| Rate limiting | 4 | HARDENED — per-IP + per-user, fail-closed/open |
| Audit chain | 5 | CLOSED — CAS on AuditChainState, hash v2, PostgreSQL-safe |
| Transaction helper | 5 | CLOSED — withTransaction, retry on conflict |
| Outbox | 5 | CLOSED — commit-before-publish, at-least-once delivery |
| Realtime | 5 | CLOSED — socket auth, social events, reconnect |
| Kill switches | 5 | CLOSED — runtime feature toggles |
| Error contracts | 4 | HARDENED — apiError, withErrorHandler, trace IDs |
| Database/schema | 4 | HARDENED — 38 models, Prisma migrations, SQLite dev |
| Logging | 4 | HARDENED — structured JSON logging, trace IDs |
| Idempotency | 5 | CLOSED — Idempotency-Key header, cached responses |

---

## GJ-01 STATUS

GJ-01 Consumer is **FUNCTIONAL/HARDENED (Level 4)** — not formally closed with a gate like GJ-02, but primary happy paths work end-to-end with browser evidence.

| Flow | UI | API | DB | Runtime | Status |
|------|----|-----|----|---------|--------|
| Onboarding/login | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Campus selection | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Restaurant discovery | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Restaurant detail | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Menu browsing | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Cart | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Checkout | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Payments (demo) | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL (demo mode) |
| Order tracking | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Order history | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Rewards | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Gifts | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Group orders | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |
| Profile/settings | ✅ | ✅ | ✅ | ✅ | FUNCTIONAL |

**Missing:** Formal GJ-01 closure gate, reviews/ratings, coupon engine (placeholder)

---

## GJ-02 STATUS

**GJ-02 = CLOSED (Level 5)**

All sub-waves formally closed with browser/runtime evidence + remote checkpoint:
- S1 Foundation, S2 Likes, S3 Notifications, S4A-S4F Hardening
- S5A-S5G Realtime (auth, connections, notifications, feed, likes, reconnect, scale)
- S5H1 Friends Ordered Here, S5H2 Friend-ranked Discovery, S5H3 Friend Seed, S5H4 Measurement Closure

---

## GJ-03+ DISCOVERY

No explicit GJ-03 workstream found in source code, schema, or plans. The following **gaps** represent potential future workstreams:

### Gap 1: Vendor Lifecycle (Level 3 — FUNCTIONAL but incomplete)
- Vendor API: order accept, menu management, deals, analytics
- Missing: full order lifecycle (prepare → ready → picked up), vendor onboarding, menu item CRUD completeness
- ~65% complete

### Gap 2: Admin Operations (Level 3 — FUNCTIONAL but incomplete)
- Admin API: feature flags, metrics, rewards management
- Missing: full order oversight, vendor management, campus CRUD, user management
- ~55% complete

### Gap 3: Reviews/Ratings (Level 0 — NOT STARTED)
- Placeholder in restaurant detail: "REVIEWS PLACEHOLDER"
- No API, no DB model, no UI

### Gap 4: Production Payments (Level 4 — HARDENED but demo mode)
- Razorpay integration exists with evidence routes
- Demo mode active (realPayments=false)
- Missing: production gateway keys, real payment capture

### Gap 5: Coupon Engine (Level 1 — SCAFFOLD)
- Placeholder in cart: PLACEHOLDER_COUPON_RATE = 0.1
- No API, no DB model

### Gap 6: Rewards Expiry (Level 1 — SCAFFOLD)
- Placeholder in rewards-engine.ts: "PLACEHOLDER — full implementation deferred"

---

## DATABASE COVERAGE

38 Prisma models across:
- **Foundation:** User, Session, OtpRequest, OtpLockout, AuditLog, AuditChainState, KillSwitch, IdempotencyKey, ExceptionQueue, Outbox, ProcessedEvent
- **Consumer:** Restaurant, MenuItem, VendorDeal, Order, OrderItem, Campus, RestaurantCampus, Fulfilment
- **Payments:** Payment, Refund, LedgerEntry, WebhookEvent, ReconciliationRun, ReconciliationFinding, RemediationAction
- **Rewards:** RewardAccount, RewardRule, RewardLedgerEntry, RewardRedemption
- **Social:** SocialConnection, SocialActivity, Like, Notification
- **Gifts:** Gift
- **Group Orders:** GroupOrder, GroupOrderMember, GroupOrderItem

All models actively used. No orphan models. Missing: Review/Rating model, Coupon model.

---

## API COVERAGE

102 API routes total:
- **Production routes:** ~70 (auth, restaurants, orders, payments, social, rewards, gifts, group-orders, vendor, admin, notifications, analytics)
- **Evidence/test routes:** ~32 (evidence-setup, evidence-verify, evidence-run, test/*, p0-*-test)
- **Dead routes:** 0 (all production routes have UI consumers or are service-internal)

---

## UI COVERAGE

14 consumer screens + 3 vendor screens + 5 admin modules:
- All consumer screens reachable via bottom navigation (Home, Explore, Social, Orders, Rewards)
- Vendor: vendor-view (orders, menu, deals, analytics)
- Admin: admin-view (feature flags, rewards, fraud/risk, support, metrics)
- Placeholders: reviews (restaurant detail), coupon (cart)

---

## TEST/EVIDENCE COVERAGE

| Workstream | Static | API/Runtime | Browser | Negative/Security | Remote-backed |
|------------|--------|-------------|---------|-------------------|---------------|
| Foundation | ✅ | ✅ | ✅ | ✅ | ✅ |
| GJ-01 Consumer | ✅ | ✅ | ✅ | partial | ✅ |
| GJ-02 Social | ✅ | ✅ | ✅ | ✅ | ✅ |
| Vendor | ✅ | ✅ | partial | partial | ✅ |
| Admin | ✅ | ✅ | partial | partial | ✅ |
| Payments | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## DEFERRED / TECHNICAL DEBT

| Item | Priority | Classification |
|------|----------|---------------|
| Randomized A/B test infrastructure | P3 | DEFERRED — instrumentation active, randomization not built |
| Production PostgreSQL migration | P2 | DEFERRED — SQLite dev, PostgreSQL prod (CAS verified on PGlite) |
| SQLite write contention | P3 | DOWNGRADE — throughput limitation, not correctness bug |
| Reviews/Ratings system | P1 | NOT STARTED — placeholder in UI |
| Coupon engine | P2 | SCAFFOLD — placeholder in cart |
| Rewards expiry (365-day) | P3 | SCAFFOLD — placeholder in rewards-engine |
| Vendor full lifecycle | P1 | PARTIAL — accept works, full lifecycle incomplete |
| Admin full operations | P1 | PARTIAL — feature flags work, management incomplete |
| Production payment gateway | P2 | DEFERRED — demo mode active |
| Advanced observability | P3 | DEFERRED — structured logging exists, no dashboards |
| Performance indexes (production) | P3 | DEFERRED — several indexes identified for prod scale |

---

## COMPLETION ESTIMATE

### Method:
```
Level 0 = 0%, Level 1 = 20%, Level 2 = 40%, Level 3 = 65%, Level 4 = 85%, Level 5 = 100%
```

### A. Journey Completion (by planned major workstreams):
| Workstream | Level | % |
|------------|------:|--:|
| Foundation | 5 | 100% |
| GJ-01 Consumer | 4 | 85% |
| GJ-02 Social | 5 | 100% |
| Vendor | 3 | 65% |
| Admin | 3 | 65% |

**Journey completion: ~83%** (weighted by 5 workstreams)

### B. Implementation Completion (by actual code coverage):
- Consumer flows: ~90% implemented (all primary flows functional)
- Vendor flows: ~65% implemented (core accept + menu, missing full lifecycle)
- Admin flows: ~55% implemented (feature flags + rewards, missing management)
- Foundation: ~95% implemented (all critical infrastructure)
- Social: ~100% implemented (formally closed)
- Payments: ~85% implemented (demo mode, all APIs exist)

**Implementation completion: ~80-85%** (range due to unfrozen scope)

---

## TOP REMAINING WORK

### P0 — Blocks core product operation/security
- None identified (core product is operational)

### P1 — Required for next major journey
- Vendor full order lifecycle (prepare → ready → picked up)
- Admin full operations (order oversight, vendor management)
- Reviews/Ratings system (placeholder → real implementation)

### P2 — Required before production readiness
- Production payment gateway (Razorpay keys)
- Coupon engine (placeholder → real implementation)
- PostgreSQL migration (dev SQLite → prod PostgreSQL)

### P3 — Optimization/deferred
- Randomized A/B test infrastructure
- Advanced observability/dashboards
- Rewards expiry (365-day)
- Performance indexes for production scale
- SQLite contention (resolved by PostgreSQL migration)

---

## NEXT WORKSTREAM

### NEXT_AUTHORIZED_CANDIDATE: Vendor Lifecycle Completion

### WHY_THIS_IS_NEXT:
1. **Dependency readiness:** Consumer ordering (GJ-01) and Social (GJ-02) are CLOSED. Vendor is the natural next surface — consumers create orders, vendors must fulfill them.
2. **User/business value:** Without complete vendor lifecycle, orders can be placed but not properly fulfilled (only "accept" exists). This is the critical gap in the order-to-pickup loop.
3. **Implementation gap:** Vendor is Level 3 (FUNCTIONAL) — core accept works, but full lifecycle (prepare → almost ready → ready → picked up) is missing from the vendor UI.
4. **Risk:** Low — all infrastructure (DB models, API routes, audit, realtime) exists. Only vendor UI + missing API endpoints need work.
5. **Existing scaffold:** Vendor portal exists, vendor-view.tsx (796 lines), vendor-menu-manager.tsx (1348 lines), vendor API routes for accept/menu/deals/analytics.
6. **Ability to close end-to-end:** High — the order state machine already exists in the Order model. Vendor just needs UI to drive state transitions.

### DEPENDENCIES_ALREADY_READY:
- Order model with full status machine (CONFIRMED → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP)
- Fulfilment model with parallel state machine
- Vendor API: orders/[id]/accept (exists)
- Realtime infrastructure (S5A-S5G)
- Audit chain (S4C)
- Vendor portal mini-service (port 3007)

### WHAT_EXISTS_ALREADY:
- Vendor page (src/app/vendor/page.tsx)
- Vendor view component (src/components/snak/vendor-view.tsx)
- Vendor API routes: accept, menu, deals, analytics
- Vendor portal mini-service (port 3007 proxy)
- Fulfilment API route (orders/[id]/fulfilment)

### WHAT_IS_MISSING:
- Vendor UI for order state transitions (prepare → ready → picked up)
- Vendor UI for pickup OTP verification
- Full menu item CRUD (create/update/delete)
- Vendor onboarding flow (restaurant creation)
- Vendor dashboard with live order queue
- Browser/runtime evidence for vendor flows

### FIRST_SAFE_DIRECTIVE:
A contract challenge for Vendor Lifecycle — define exact state transitions, UI contracts, API gaps, and evidence requirements before implementation.

---

## FINAL VERDICT

```text
PROJECT_MAP_READY
```

STOP. NO PRODUCT CODE CHANGES.
