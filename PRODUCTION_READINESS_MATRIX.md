# SnakZap Production Readiness Matrix v1.4

> **Document Type:** Specification & Decision Document
> **Status:** Draft v1.4 — G-B1 resolved (P0-07 expanded, no P0-29); Query A reinterpreted via Direct Protector vs Control/Enabler classification
> **NOT an implementation plan.** This document defines *what* must be true before SnakZap can serve a real paying customer, *how* each capability must behave under failure, and *how* we will know it is ready. Implementation order, code, and sprints are derived from this — not the other way around.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Version | 1.4 |
| Date | 2026-08-09 |
| Status | G-B1 resolved; Query A reinterpreted; awaiting Artifact 1 re-run |
| Baseline | Uploaded audit (`zheo-main.zip` rebuild) + self-audit + stakeholder feedback + Strategic Blueprint cross-reference |
| Authors | Engineering + Product |
| Reviewers | (pending formal sign-off) |
| Supersedes | v1.3 |
| Next review | After Artifact 1 (P0 Traceability Map) re-runs coverage queries against v1.4 |

---

## Revision History

| Version | Date | Changes | Trigger |
|---------|------|---------|---------|
| v1.0 | 2026-08-09 | Initial matrix: 5-question framework, actor's worst day, P0/P1/P2/P3 inventory, 23 P0 capabilities. | Self-audit + stakeholder feedback. |
| v1.1 | 2026-08-09 | Added 5 new P0 capabilities (P0-24..P0-28): Transactional Data Integrity, Concurrency, DR, Deployment & Rollback, Unknown-Exception. Added 3 sections: Business Invariants, External Dependency Failure Matrix, Capability Lifecycle (8 states). Added G51–G57. | Stakeholder preliminary review — 7 corrections. |
| v1.2 | 2026-08-09 | Refined P0-24 (idempotent business effect), P0-25 (3 concurrency cases), P0-26 (business recovery), P0-27 (3 deploy classes), P0-28 (3 blast-radius levels). Added invariant IDs I-01..I-12 with `Protects` column. Added `Affected P0` column to dependency matrix. Added lifecycle state `Approved` (9 states). Strengthened launch gate to 6 AND conditions. Added Section 18: Traceability foundation. | Stakeholder architectural review — 10 corrections. |
| v1.3 | 2026-08-09 | Added invariants I-13 (Pickup/Handoff Integrity) + I-14 (Vendor Operational Integrity). Added 5 Architectural Laws. Added separation of duties for `Approved`. Added launch-gate condition 7 (no expired waiver). Cross-linked Section 10 to Strategic Blueprint risk register. Added observability cross-cutting note. Expanded Section 18: 8 coverage queries (A–H) + Strategic Blueprint feature mapping requirement. Added Q21–Q24. | Stakeholder v1.2 review — conceptually approved, final gate = traceability coverage check. |
| v1.4 | 2026-08-09 | **G-B1 resolved: expanded P0-07 (Order State Machine Hardening) acceptance criteria** to include 8 pickup-attribution conditions for the PICKED_UP transition (correct order_id, authorized collector, QR/OTP verification, immutable audit event with 5 fields, duplicate-pickup idempotent reject, cross-credential prevention, attribution-failure blocks transition). P0-07 → I-13 mapping now fully owned; **no P0-29 created**. Added 5 new P0-07 test criteria (correct collector, wrong collector, QR/OTP failure, duplicate pickup, attribution/audit persistence). Added P0-07 → P0-22 evidence linkage. **Query A reinterpreted**: introduced **Direct Protector vs Control/Enabler** classification — 10 foundational P0s reclassified as Control/Enablers (they detect/enable, not enforce business truths); `Protects` notation updated from `(foundational)`/`(observability)` to `(Control/Enabler)`. Added **Architectural Law 6**: "An invariant describes a truth that must never be violated; a capability describes the mechanism that enforces or preserves that truth." Updated I-14 wording to be explicit about P1-protection rationale (not launch-blocking financial/security invariant). P0 count unchanged at 28; invariant count unchanged at 14; no new capabilities; no new invariants. | Stakeholder G-B1 decision + Query A interpretation correction. |

---

## 1. Purpose

This matrix exists to answer a single question:

> **"If 10,000 real users and 500 restaurants land on SnakZap tomorrow, where will it break — and what happens when it does?"**

It is deliberately **not** a feature backlog. A feature backlog asks "what's missing?". This matrix asks "what survives contact with reality?".

The matrix is the gate between *demo* and *production*. No capability moves out of "not ready" until its failure path, recovery path, money/trust impact, and observability are all defined AND verified.

---

## 2. Scope

**In scope:**
- All capabilities required for SnakZap to accept a real payment, fulfil a real pickup order, and recover from any failure along that path.
- Cross-cutting concerns: auth, payments, orders, fulfilment, notifications, admin control, observability, data integrity.
- Failure semantics for every P0/P1 capability.
- Acceptance and test criteria for each.

**Out of scope (for this document):**
- Implementation details (code, schema, API contracts).
- Sprint planning, effort estimates, headcount.
- Marketing, GTM, pricing strategy.
- P3 capabilities beyond a one-line inventory entry.

---

## 3. Priority Definitions (strict)

A capability's priority is **non-negotiable** and determines review rigour.

### P0 — Cannot Launch Without It

Capabilities whose absence or failure causes **irrecoverable money loss, legal exposure, or permanent trust destruction**. SnakZap cannot accept a single real paying customer until every P0 capability is verified.

**Entry rule:** A capability is P0 only if its **failure path AND recovery path are both defined**. No failure/recovery → cannot be P0 → cannot launch.

### P1 — Must Work Reliably After Launch

Capabilities whose absence degrades the product to the point where users/vendors churn rapidly, but does not immediately destroy money or trust. Must be reliable (not just present) within a short window after launch.

**Entry rule:** Same as P0 — failure + recovery must be defined.

### P2 — Growth / Retention

Capabilities that improve conversion, repeat rate, or unit economics. Launch is possible without them; growth is not.

**Entry rule:** Failure/recovery defined for anything touching money (coupons, wallet). Others need happy path + observability only.

### P3 — Expansion

Capabilities that open new markets or business models. Out of scope for v1 launch; listed for inventory completeness only.

---

## 4. The 5-Question Framework

**Every P0 and P1 capability must answer all five questions.** A capability with any question unanswered is, by definition, *not ready* — regardless of whether the happy path works.

| # | Question | What it forces us to define |
|---|----------|------------------------------|
| 1 | **Happy Path** — What should happen in the normal case? | The expected end-to-end behaviour. |
| 2 | **Failure Path** — What happens when something goes wrong? | Every realistic failure mode and the system's response to each. |
| 3 | **Recovery Path** — How does the system return to normal? | Manual + automated recovery procedures, data correction, reconciliation. |
| 4 | **Money / Trust Impact** — If this fails, is money or user trust affected? | Direct financial exposure, refund liability, trust erosion severity. |
| 5 | **Observability** — How will we know this failed? | Logs, metrics, alerts, dashboards that surface the failure. |

**The rule that makes this real:**

> A capability is "ready" only when all five answers exist **and** the corresponding test criteria pass.

---

## 5. Actor's Worst Day Dimension

A separate, orthogonal lens applied across the matrix. For each actor, we define their worst plausible day and trace which capabilities must hold for the system to survive it. This is **not** a priority level — it is a stress test applied to the matrix itself.

| Actor | Worst Day Scenario | Capabilities That Must Hold |
|-------|---------------------|------------------------------|
| **Consumer** | Paid ₹500, app crashed, no idea if order went through. Re-opens to find no order, no refund path, no support contact. | Payment idempotency, order-payment state separation, reconciliation, refund-on-failed-order, support surface, push/email confirmation as out-of-band receipt. |
| **Vendor** | Sunday evening, 30 orders hit at once, kitchen overloaded, 2 payments captured but orders stuck, no way to pause intake. | Vendor busy-mode / pause new orders, order queue load handling, payment-order reconciliation surfacing the mismatch, exception queue alert to admin. |
| **Admin** | Razorpay partial outage, 200 payments in limbo, support tickets piling up, no idea which orders are safe to fulfil. | Payment reconciliation dashboard, exception queue with bulk actions, kill switch for order intake, audit trail of every manual override. |
| **Backend / Platform** | Database unavailable for 30 seconds mid-payment; webhook retries arrive 3×; double-click on "Pay". | Idempotency on all critical writes, webhook dedup, queue-based payment finalisation, retry-with-backoff, health checks + alerts. |
| **Finance / Compliance** | GST invoice missing for a captured payment; refund issued but ledger not updated; settlement doesn't reconcile with gateway. | Double-entry payment ledger, invoice generation tied to capture event, refund ledger entry, daily reconciliation report. |

**Usage rule:** Before signing off any P0 capability, trace it through every actor's worst day. If a capability is implicated in a worst-day scenario and is not P0, escalate it.

---

## 6. Starting Inventory (from uploaded audit)

These gaps were identified during the rebuild audit and form the **starting inventory** of the matrix. They are **not** the full matrix — the matrix below adds failure semantics, dependencies, and capabilities the audit did not surface.

| # | Gap (from audit) | Provisional Priority |
|---|------------------|----------------------|
| G1 | No payment system (fake "Paid") | P0 |
| G2 | Server-side Firebase ID token not verified | P0 |
| G3 | No Zod input validation on APIs | P0 |
| G4 | No rate limiting | P0 |
| G5 | No idempotency on critical writes | P0 |
| G6 | Single order status (no payment/fulfilment/refund separation) | P0 |
| G7 | No refund/cancellation flow | P0 |
| G8 | No webhook integrity (HMAC, dedup) | P0 |
| G9 | No audit trail integrity guarantees | P0 |
| G10 | `db:push` instead of migrations | P0 |
| G11 | No backup/recovery | P0 |
| G12 | No structured logging / monitoring / alerts | P0 |
| G13 | No error boundaries / consistent error responses | P0 |
| G14 | Cart not re-validated at checkout | P1 |
| G15 | No ETA estimation | P1 |
| G16 | No push notifications | P1 |
| G17 | No email notifications / receipts | P1 |
| G18 | No GST invoice | P1 |
| G19 | No vendor busy-mode / pause | P1 |
| G20 | No vendor menu CRUD | P1 |
| G21 | No vendor settlement dashboard | P1 |
| G22 | No vendor customer intelligence | P1 |
| G23 | No restaurant discovery / ranking / location | P1 |
| G24 | No admin exception queue | P1 |
| G25 | No admin user/vendor lifecycle management | P1 |
| G26 | No admin dispute resolution | P1 |
| G27 | No consumer profile / address | P1 |
| G28 | No real-time reconnect / missed-event sync | P1 |
| G29 | No PWA (service worker, offline) | P1 |
| G30 | No i18n (en/hi) | P1 |
| G31 | Dark mode toggle lost | P1 |
| G32 | No notification event system | P1 |
| G33 | No tests | P0 (for P0 capabilities) / P1 (for P1) |
| G34 | No loyalty / stamps / streaks / referrals | P2 |
| G35 | No coupons / promotions | P2 |
| G36 | No wallet / cashback | P2 |
| G37 | No ratings / reviews | P2 |
| G38 | No favourites | P2 |
| G39 | No reorder | P2 |
| G40 | No personalization (spice tolerance, history) | P2 |
| G41 | No AI food images (currently SVG) | P2 |
| G42 | No analytics custom events | P2 |
| G43 | No group orders | P3 |
| G44 | No catering (UI missing; backend exists) | P3 |
| G45 | No POS integration (Petpooja) | P3 |
| G46 | No multi-outlet chains | P3 |
| G47 | No heatmap | P3 |
| G48 | No watch API | P3 |
| G49 | No geo-fence auto check-in | P3 |
| G50 | No A/B testing framework | P3 |
| G51 | No transactional data integrity (cross-entity consistency) | P0 |
| G52 | No concurrency / race-condition handling on money + order writes | P0 |
| G53 | Disaster recovery not separated from backup (no RPO/RTO/restore drill) | P0 |
| G54 | No deployment / rollback capability | P0 |
| G55 | No external-dependency failure strategy (fail-open vs fail-closed per dependency) | P0 |
| G56 | No explicit business invariants (state-machine laws) | P0 |
| G57 | No unknown-exception handling (unclassified states silently ignored) | P0 |

---

## 7. The Matrix

Columns: **ID | Domain | Capability | Failure Scenario | Dependency | Acceptance Criteria | Test Criteria | Protects (Invariants) | Owner**

### 7.1 P0 — Cannot Launch Without It

The `Protects` column lists which Business Invariants (Section 9) the capability is responsible for upholding. A capability may not reach `Production-ready` until every invariant it protects is verified.

**Capability classification (v1.4):** Every P0 is one of two types:
- **Direct Protector** — a capability that *enforces* one or more business invariants directly (e.g. P0-01 enforces I-01 Payment Integrity by rejecting unsigned captures). Its `Protects` column lists specific I-xx IDs.
- **Control/Enabler** — a capability that *detects, enables, or preserves* the system but does not enforce a specific business truth (e.g. P0-19 logging detects failures but does not enforce payment integrity; P0-15 migrations preserve schema but do not enforce any single invariant). Its `Protects` column reads `(Control/Enabler)`.

This distinction matters for Coverage Query A (Section 18.5): a Direct Protector must map to ≥1 specific invariant; a Control/Enabler legitimately does not. Calling observability an "indirect protector of I-01" would distort the architecture — observability detects I-01 violations, it does not enforce them. The classification keeps ownership honest.

**Architectural Law 6 (v1.4):** *An invariant describes a truth that must never be violated; a capability describes the mechanism that enforces or preserves that truth.* Direct Protectors enforce; Control/Enablers preserve the conditions under which Direct Protectors can function. Both are P0; their relationship to invariants differs.

| ID | Domain | Capability | Failure Scenario | Dependency | Acceptance Criteria | Test Criteria | Protects | Owner |
|----|--------|------------|------------------|------------|---------------------|---------------|----------|-------|
| P0-01 | Payment | Razorpay order create + verify + capture | Gateway timeout / signature mismatch / double Pay click | Razorpay SDK, Payment model | Every payment has a verifiable captured state; no payment captured without verified signature | Idempotency test; signature-tamper test; double-submit test | I-01, I-04 | Backend |
| P0-02 | Payment | Payment ledger (double-entry) | Ledger write fails after capture | Payment model, DB txn | Every captured payment has matching ledger entries; ledger is append-only | Ledger integrity test; partial-failure test | I-06, I-10 | Backend |
| P0-03 | Payment | Payment reconciliation (gateway ↔ ledger) | Gateway says captured, DB says failed | Payment + scheduled job | Daily reconciliation report; mismatches surface in exception queue within 1 hour | Reconciliation job test; mismatch injection test | I-01, I-06 | Backend |
| P0-04 | Payment | Refund flow (full + partial) | Refund requested but gateway down / partial refund mismatch | Payment + Razorpay refund API | Refund has its own status lifecycle; partial refunds tracked; ledger updated atomically | Refund lifecycle test; partial-refund test; refund-during-outage test | I-03, I-06, I-11 | Backend |
| P0-05 | Payment | Webhook integrity (HMAC + idempotent) | Duplicate webhook / tampered signature / out-of-order | Payment + webhook endpoint | Duplicate webhooks deduped; tampered rejected; out-of-order handled | Duplicate injection test; signature tamper test; reorder test | I-01, I-04 | Backend |
| P0-06 | Order | State separation (Order / Payment / Fulfilment / Refund) | Order cancelled but payment captured | Order + Payment + Fulfilment + Refund models | Each dimension evolves independently; inconsistent combos surfaced in exception queue | State-transition matrix test; inconsistent-state detection test | I-01, I-02, I-08 | Backend |
| P0-07 | Order | Order state machine hardening | Invalid transition attempted / concurrent updates | Order model + optimistic locking | Invalid transitions rejected; concurrent updates serialised; PICKED_UP transition requires pickup verification (QR+OTP) per I-13 | Concurrency test; invalid-transition test; pickup-verification test | I-02, I-08, I-13 | Backend |
| P0-08 | Order | Idempotency on order creation | Double submit / retry storm | Order model + idempotency key | Same idempotency key returns same order; no duplicate orders created | Idempotency-key test; retry-storm test | I-02, I-10 | Backend |
| P0-09 | Auth | Server-side Firebase ID token verification | Forged client identity / expired token | Firebase Admin SDK + session | Server rejects unverified identity; sessions bound to verified phone | Token-forgery test; expired-token test | I-12 | Backend |
| P0-10 | Auth | Session integrity (refresh, revoke, active sessions) | Stolen session token / user logs out elsewhere | Session model | Sessions expireable, revocable; active-sessions list available | Session-revoke test; concurrent-session test | I-12 | Backend |
| P0-11 | Auth | OTP retry limits + phone validation | OTP brute-force / invalid phone format | OTP service + rate limiter | Max 5 OTP attempts / 3 sends per 10 min; phone E.164 validated | Brute-force test; invalid-phone test | I-12 | Backend |
| P0-12 | Security | Zod input validation on every API | Malformed payload / type confusion | Zod schemas per route | No API accepts unvalidated input; 400 on schema mismatch | Fuzz test per route; schema-mismatch test | (Control/Enabler) | Backend |
| P0-13 | Security | Rate limiting (fail-closed for auth/payment/admin-write) | Redis down / abuse burst | Rate limiter (Redis or in-memory fallback) | Auth/payment/admin-write return 503 when limiter unavailable; general API fail-open | Fail-closed test; burst test | (Control/Enabler; enables P0-09..P0-11 to function safely) | Backend |
| P0-14 | Security | CSRF protection | Cross-site forged POST | CSRF token + SameSite cookie | State-changing POSTs require valid CSRF token | CSRF injection test | (Control/Enabler; enables all state-changing writes to be safe) | Backend |
| P0-15 | Data | Database migrations (not `db:push`) | Schema drift / data loss on deploy | Prisma migrate + review process | Every schema change ships as reviewed migration; no data-destructive push | Migration rollback test; drift detection test | (Control/Enabler) | Backend |
| P0-16 | Data | Backup | DB corruption / accidental delete | Backup schedule + corruption-detection | Daily backups; corruption-detection checksum on every backup; backup integrity verified | Backup-integrity test; corruption-detection test | (Control/Enabler) | Backend |
| P0-17 | Reliability | Idempotency on all critical writes | Retry storm / partial failure | Idempotency key on orders, payments, refunds, status updates | All critical writes idempotent; retries return same result | Idempotency test per critical write | I-04, I-10 | Backend |
| P0-18 | Reliability | Error handling (boundaries + consistent responses) | Unhandled exception / partial response | Error boundaries + error envelope | Every API returns consistent error envelope; UI shows actionable errors | Error-injection test per route | (Control/Enabler) | Full-stack |
| P0-19 | Observability | Structured logging | Silent failure / untraceable error | Logger (structured JSON) | Every critical path logs structured event with trace id | Log-coverage test | (Control/Enabler) | Backend |
| P0-20 | Observability | Health checks + basic metrics | Service silently degraded | Health endpoint + metrics export | `/health` reflects DB + Redis + gateway status; metrics exported | Health-probe test; metric-coverage test | (Control/Enabler) | Backend |
| P0-21 | Observability | Alerting on P0 failures | Payment success rate < 95% / reconciliation mismatch | Alert rules + on-call | Alerts fire on defined thresholds; false-positive rate < 5% | Alert-trigger test; false-positive audit | (Control/Enabler) | Backend |
| P0-22 | Audit | Audit trail integrity (immutable, complete) | Tampered audit log / missing entry | Audit model + append-only storage | Audit entries immutable; every admin/financial action audited | Tamper test; coverage test | I-07 | Backend |
| P0-23 | Governance | Kill switch fail-safe behaviour | Kill switch itself fails | Kill switch + fallback | Kill switch defaults to safe state on failure; toggles audited | Kill-switch-failure test | I-09 | Backend |
| P0-24 | Data | Transactional data integrity (cross-entity) — see detailed breakdown | Order + items + payment + availability + audit event partially commit; outbox publisher crashes after commit | DB transactions + outbox pattern | Committed business transaction eventually produces its required event with **idempotent business effect** (exactly-once in business outcome, even if physical delivery occurs more than once); no orphan entities; no partial commits | Partial-failure injection test; outbox-crash test; idempotent-replay test | I-01, I-02, I-05, I-06, I-10 | Backend |
| P0-25 | Reliability | Concurrency + duplicate-execution control — see detailed breakdown | (A) last-item inventory race; (B) state-transition race (vendor ACCEPT→CANCEL while admin CANCEL→OVERRIDE); (C) payment double-click / frontend retry | Optimistic locking + row-level locks + atomic decrements + idempotency keys | Concurrent writes serialised; no oversell; conflicts surface as retry/conflict not silent corruption; duplicate executions are deduped, not double-applied | Concurrency case A (last-item); case B (state-transition); case C (payment duplicate); optimistic-lock conflict test | I-02, I-04, I-05, I-10 | Backend |
| P0-26 | Data | Disaster recovery (business recovery, not just DB restore) — see detailed breakdown | DB corruption / regional failure / restore leaves payments-in-gateway inconsistent with restored DB | Backup + restore drill + post-restore reconciliation + documented runbook | RPO ≤ 24h, RTO ≤ 4h; restore drill passes monthly; **post-restore business-state reconciliation**: gateway payments re-synced to restored DB (captured-but-DB-pending → reconciled or refunded); audit log re-verified; **NO-GO if any money state unresolved post-restore** | Restore-drill test; corruption-detection test; post-restore reconciliation test; runbook walkthrough | I-01, I-02, I-06, I-07, I-10 | Backend |
| P0-27 | Reliability | Deployment & rollback (3 classes) — see detailed breakdown | Bad release / migration incompatibility / failed deploy / DB rollback unsafe | CI/CD + health-checked deploy + feature flags + 3 deployment classes | Application rollback ≤ 10 min for backward-compatible deploys; **expand-migrate-contract** for schema changes (no breaking migration without contract phase); breaking deploys gated + flagged; failed deploy auto-aborts; **DB rollback never assumed safe — contract migrations preserve old-version compatibility** | Rollback drill test (per class); expand-migrate-contract test; migration-compatibility test; failed-deploy-abort test | (Control/Enabler) | Backend |
| P0-28 | Admin | Unknown-exception handling (3 blast-radius levels) — see detailed breakdown | System reaches a state not in known state machine | Invariant checker + 3-level blast-radius freeze + exception queue + alert | Unknown state triggers the **smallest sufficient** freeze level (transaction / entity / system kill switch), preserves evidence, creates exception queue entry, alerts; never silently ignored; never over-freezes (one malformed order does not stop the platform) | Unknown-state injection at each blast-radius level; freeze-precision test; over-freeze-prevention test | I-01..I-14 (all) | Backend |

### 7.2 P1 — Must Work Reliably After Launch

| Priority | Domain | Capability | Failure Scenario | Dependency | Acceptance Criteria | Test Criteria | Owner |
|----------|--------|------------|------------------|------------|---------------------|---------------|-------|
| P1 | Vendor Ops | Busy mode / pause new orders | 30 simultaneous orders / kitchen overload | Vendor + Order intake | Vendor can pause new orders; existing orders unaffected; auto-resume optional | Load test; pause/resume test | Vendor |
| P1 | Vendor Ops | Prep-time override | Vendor sets +15 min | Order + ETA | Override reflected in consumer ETA; expires after order | Override test; expiry test | Vendor |
| P1 | Vendor Ops | Menu CRUD | Vendor edits price mid-cart | Menu + cart re-validation | Price change does not silently affect existing carts; cart re-validated at checkout | Mid-cart-edit test; re-validation test | Vendor |
| P1 | Vendor Ops | Order accept/reject flow | Vendor rejects after payment captured | Order + Payment + Refund | Rejection after capture triggers auto-refund; consumer notified | Accept/reject test; post-capture-reject test | Vendor |
| P1 | Vendor Ops | Settlement dashboard | Settlement mismatch | Payment + settlement job | Daily settlement matches ledger; discrepancies surfaced | Settlement-reconciliation test | Vendor |
| P1 | Vendor Ops | Customer intelligence (privacy-controlled) | PII leakage | Aggregation + privacy filter | Vendor sees aggregated stats only; no raw PII export | Privacy-leak test; aggregation test | Vendor |
| P1 | Discovery | Restaurant ranking + location engine | Bad ranking / no location | Geo + ranking service | Ranking considers distance, rating, availability, prep time, popularity | Ranking-regression test; location test | Backend |
| P1 | Cart | Cart re-validation at checkout | Price changed / item unavailable / restaurant closed | Cart + menu + restaurant state | Checkout blocked with clear reason if any line invalid; stale cart surfaced | Re-validation test per failure mode | Full-stack |
| P1 | Fulfilment | ETA estimation | ETA wildly wrong | Prep time + queue depth + historical | ETA within ±5 min of actual 80% of the time | ETA-accuracy test | Backend |
| P1 | Notifications | Push notifications (FCM) | Notification not delivered | FCM + token management | Token refresh handled; delivery confirmed via callback; fallback to email | FCM-failure test; fallback test | Backend |
| P1 | Notifications | Email notifications (confirmation, receipt) | Email bounced / marked spam | Email service + template | Bounces tracked; critical emails retried; spam-rate monitored | Bounce test; retry test | Backend |
| P1 | Notifications | Notification event system | One event, multiple consumers diverge | Event bus + subscribers | Single event triggers all intended consumers consistently | Event-fanout test; consumer-divergence test | Backend |
| P1 | Receipts | GST-compliant invoice generation | Invoice missing / wrong GST | Invoice service + GST config | Every captured payment has an invoice; GST calculated per rules | Invoice-coverage test; GST-calc test | Backend |
| P1 | Admin | Exception queue | 200 stuck payments | Payment + Admin + bulk actions | All unresolved exceptions visible; bulk actions available; audit logged | Failure-injection test; bulk-action test | Admin |
| P1 | Admin | User / vendor lifecycle management | Wrong suspension / no audit | Admin + audit | Suspend/reactivate audited; affected orders handled | Suspension test; audit test | Admin |
| P1 | Admin | Dispute resolution workflow | Dispute stuck / no SLA | Dispute model + SLA timer | Disputes tracked with SLA; resolution audited; refund linked | Dispute-lifecycle test; SLA-breach test | Admin |
| P1 | Consumer | Profile management | Profile edit breaks session | User model + session | Profile edits don't invalidate session; phone change re-verifies | Profile-edit test; phone-change test | Full-stack |
| P1 | Consumer | Address management | Address used for wrong restaurant | Address + restaurant geo | Address validated against restaurant pickup location | Address-validation test | Full-stack |
| P1 | Realtime | Reconnect + missed-event sync | Socket drops, events lost | Socket + event log | Reconnect fetches missed events since last-seen; no silent gaps | Reconnect test; missed-event test | Full-stack |
| P1 | PWA | Service worker + offline page | SW fails to register / offline broken | SW + manifest + offline fallback | App installable; offline shows graceful fallback, not blank | Offline test; install test | Frontend |
| P1 | i18n | en/hi translations | Missing key / wrong locale | i18n loader + locale detection | All user-facing strings translated; locale persisted | Key-coverage test; locale-switch test | Frontend |
| P1 | UX | Dark mode restore | Toggle missing / flash on load | Theme provider + persistence | Toggle present; no flash; persisted across sessions | Theme-persistence test | Frontend |
| P1 | Observability | Traces (latency diagnosis) | Latency spike, no trace | Distributed tracing | Critical paths traced; p95 latency visible | Trace-coverage test | Backend |

### 7.3 P2 — Growth / Retention

| Priority | Domain | Capability | Failure Scenario | Acceptance Criteria | Owner |
|----------|--------|------------|------------------|---------------------|-------|
| P2 | Retention | Reorder | Stale menu breaks reorder | Reorder validates current menu/price | Full-stack |
| P2 | Retention | Ratings / reviews | Fake review / review bombing | Fraud-screened; rate-limited | Full-stack |
| P2 | Retention | Favourites | Favourite points to deleted restaurant | Soft-delete; graceful fallback | Full-stack |
| P2 | Retention | Loyalty (stamps, streaks, points) | Point balance drift | Ledger-backed; auditable | Backend |
| P2 | Growth | Coupons / promotions | Coupon abuse / expired coupon | Fraud-screened; expiry enforced | Backend |
| P2 | Growth | Referral system | Self-referral / fake accounts | Fraud-screened; device/phone dedup | Backend |
| P2 | Personalization | Spice tolerance, history-based | Filter bubble / stale profile | Anti-filter-bubble guardrail | Backend |
| P2 | Polish | AI food images | Image missing / inconsistent | Fallback to SVG; consistent style template | Frontend |
| P2 | Insights | Heatmaps | Stale data / privacy leak | Aggregated; TTL-enforced | Backend |
| P2 | Wallet | Cashback + ledger | Ledger imbalance | Double-entry; reconciled | Backend |
| P2 | Analytics | Custom events | Event schema drift | Schema-validated events | Frontend |

### 7.4 P3 — Expansion (inventory only)

Group orders · Catering (separate workflow: Inquiry → Quote → Advance → Fulfil → Final) · POS integration (Petpooja) · Multi-outlet chains · Advanced analytics (CAC/LTV, cohort) · Watch API · Geo-fence auto check-in · 24h cart persistence · A/B testing framework.

*Failure/recovery definitions deferred until promoted to P1/P2.*

---

## 8. Detailed 5-Question Breakdowns (P0 + P1)

Each capability below has all five questions answered. A capability is **not ready** until the corresponding test criteria pass.

### P0-1 · Razorpay Payment Create + Verify + Capture

1. **Happy Path:** Consumer places order → backend creates Razorpay order → Checkout SDK opens → user pays → `payment.success` → backend verifies signature → marks Payment CAPTURED → marks Order CONFIRMED → emits `ORDER_CONFIRMED` event.
2. **Failure Path:**
   - Gateway timeout during order create → rollback order to PAYMENT_PENDING; consumer sees retry.
   - Signature mismatch → reject; do not capture; alert; consumer sees "payment failed, try again".
   - Double Pay click → second request rejected via idempotency key; first proceeds.
   - Webhook arrives before client callback → handle via webhook; client callback becomes no-op.
   - Capture succeeds but DB write fails → reconciliation job finalises; consumer sees "processing" until reconciled.
3. **Recovery Path:** Reconciliation job hourly; mismatches → exception queue; manual capture/refund via admin with audit.
4. **Money / Trust Impact:** **Critical.** Captured-without-order = lost money. Failed-but-marked-paid = fulfilment of unpaid order = inventory loss. Both destroy trust instantly.
5. **Observability:** Structured log per payment state transition; metric `payment_success_rate`; alert if < 95% over 5 min window; reconciliation report daily.

### P0-2 · Payment Ledger (double-entry)

1. **Happy Path:** On CAPTURED, ledger entries: `Dr. Gateway Receivable / Cr. Consumer Revenue`; on payout: `Dr. Vendor Payout / Cr. Gateway Receivable`; on refund: `Dr. Refund Expense / Cr. Gateway Payable`.
2. **Failure Path:** Ledger write fails after capture → captured payment without ledger entry → reconciliation flags.
3. **Recovery Path:** Reconciliation job detects missing entries; auto-creates from gateway record; audit logged.
4. **Money / Trust Impact:** **Critical.** Ledger drift = untraceable money = compliance failure.
5. **Observability:** Ledger integrity check hourly; alert on any imbalance.

### P0-3 · Payment Reconciliation (gateway ↔ ledger)

1. **Happy Path:** Hourly job fetches gateway settlements, compares to ledger; matches mark RECONCILED; mismatches go to exception queue.
2. **Failure Path:** Job fails → last-run timestamp stale → alert; no silent skip.
3. **Recovery Path:** Re-run job; manual reconciliation for edge cases.
4. **Money / Trust Impact:** **Critical.** Unreconciled payments = unknown financial state.
5. **Observability:** Reconciliation report dashboard; alert on mismatch count > 0 for > 1 hour.

### P0-4 · Refund Flow

1. **Happy Path:** Refund requested → REFUND_REQUESTED → Razorpay refund API → REFUND_PROCESSING → webhook → REFUNDED → ledger entry.
2. **Failure Path:** Gateway down → REFUND_REQUESTED stays; retry queue; alert if stuck > 1 hour.
3. **Recovery Path:** Manual refund via admin with audit; ledger corrected.
4. **Money / Trust Impact:** **Critical.** Unprocessed refund = consumer money trapped = trust loss + legal exposure.
5. **Observability:** Refund SLA metric; alert on REFUND_REQUESTED older than 1 hour.

### P0-5 · Webhook Integrity

1. **Happy Path:** Webhook arrives → HMAC verified → idempotency check → process → 200 OK.
2. **Failure Path:** Tampered signature → 400 + alert; duplicate → dedup, 200 OK (idempotent); out-of-order → reorder by timestamp, process in order.
3. **Recovery Path:** Reconciliation job catches anything webhooks missed.
4. **Money / Trust Impact:** **Critical.** Forged webhook = fake capture = unpaid fulfilment.
5. **Observability:** Webhook log; alert on signature failures.

### P0-6 · Order State Separation

1. **Happy Path:** Order, Payment, Fulfilment, Refund each have independent status; UI composes them.
2. **Failure Path:** Inconsistent combo (e.g. Order CANCELLED + Payment CAPTURED) → exception queue entry; auto-refund triggered.
3. **Recovery Path:** Exception queue drives manual or automated resolution.
4. **Money / Trust Impact:** **Critical.** Inconsistent states = money leaks.
5. **Observability:** Invariant checker hourly; alert on any inconsistent combo.

### P0-7 · Order State Machine Hardening (v1.4 — pickup attribution expanded)

1. **Happy Path:** Valid transitions only (CONFIRMED → PREPARING → ALMOST_READY → READY → PICKED_UP). The PICKED_UP transition is the highest-integrity transition in the system — it marks the handoff of food to the customer. As of v1.4, PICKED_UP is valid **only when all 8 attribution conditions hold**:
   1. Correct `order_id` resolved and verified.
   2. Authorized collector/customer identity verified.
   3. Required QR + OTP verification succeeded (both, per I-13 + Q21).
   4. Pickup event persisted with at minimum: `order_id`, collector identity/reference, timestamp, verification method/result, actor/source.
   5. Pickup event written to the immutable audit trail (links to P0-22 evidence).
   6. Duplicate pickup attempt idempotently rejected/handled (no double-PICKED_UP).
   7. Cross-credential pickup impossible (one order's credential cannot pick up another order).
   8. Attribution failure blocks the PICKED_UP transition and activates the exception/recovery path (does not silently mark picked up).
2. **Failure Path:** Invalid transition → 409; concurrent update → optimistic lock rejects loser with retry guidance; pickup verification failure (any of conditions 1–3, 6, 7 fail) → transition blocked, order stays READY, exception path activates.
3. **Recovery Path:** Manual override via admin with audit (for state-machine conflicts); for attribution failures, exception queue entry created per P0-28 blast-radius Level 1 (transaction freeze on the affected order) — human investigates, corrects, and re-attempts pickup.
4. **Money / Trust Impact:** **High → Critical (v1.4).** Wrong state = wrong fulfilment. A PICKED_UP without verified attribution = food handed to the wrong person = direct consumer harm + trust destruction + potential refund liability. I-13 (Pickup/Handoff Integrity) is now fully owned by P0-07.
5. **Observability:** Transition log; alert on invalid-transition attempts; **pickup-verification log** (per attempt: order_id, collector, method, result); alert on attribution-failure rate; P0-22 audit-trail linkage verified on every PICKED_UP.

**Test criteria (v1.4 — expanded):**
- Concurrency test (existing)
- Invalid-transition test (existing)
- **Pickup-verification: correct collector** — valid QR+OTP, correct order → PICKED_UP succeeds, audit event persisted with all 5 fields.
- **Pickup-verification: wrong collector** — credential belongs to a different order/customer → transition blocked (condition 7), exception path activates.
- **Pickup-verification: QR/OTP failure** — missing or mismatched QR or OTP → transition blocked (condition 3), clear error to operator.
- **Pickup-verification: duplicate pickup** — second PICKED_UP attempt on already-picked order → idempotent reject (condition 6), no double-transition.
- **Pickup-verification: attribution/audit persistence** — after a successful PICKED_UP, the audit event is present in P0-22's immutable trail with all 5 required fields; tamper attempt detected.

**Evidence linkage (v1.4):** P0-07 enforces I-13 at the transition gate; the resulting pickup event flows to P0-22 (Audit Integrity) as immutable evidence. The relationship is: **P0-07 (mechanism) → I-13 (truth enforced) → P0-22 (evidence preserved)**. P0-07 is NOT renamed "Pickup Audit Attribution" — attribution is an integrity condition of the PICKED_UP transition, owned by the state-machine capability. P0-22 remains the audit-trail owner; P0-07 remains the transition owner.

### P0-8 · Idempotency on Order Creation

1. **Happy Path:** Same idempotency key → same order returned.
2. **Failure Path:** Retry storm → all return same order; no duplicates.
3. **Recovery Path:** N/A (prevention by design).
4. **Money / Trust Impact:** **Critical.** Duplicate orders = double charge / double fulfilment.
5. **Observability:** Idempotency-key hit/miss metric.

### P0-9 · Server-side Firebase ID Token Verification

1. **Happy Path:** Client sends Firebase ID token → server verifies via Admin SDK → mints session.
2. **Failure Path:** Forged/expired token → 401; no session.
3. **Recovery Path:** Client re-authenticates.
4. **Money / Trust Impact:** **Critical.** Forged identity = unauthorised orders/payments.
5. **Observability:** Auth-failure metric; alert on spike.

### P0-10 · Session Integrity

1. **Happy Path:** Session token valid → request proceeds.
2. **Failure Path:** Expired/stolen token → 401; revocation propagates.
3. **Recovery Path:** Re-login; active-sessions list lets user revoke others.
4. **Money / Trust Impact:** **High.** Stolen session = impersonation.
5. **Observability:** Session-anomaly metric (geo/IP change).

### P0-11 · OTP Retry Limits + Phone Validation

1. **Happy Path:** OTP sent; user enters correct code within 5 attempts.
2. **Failure Path:** >5 attempts → locked 10 min; >3 sends → locked 10 min; invalid phone → 400.
3. **Recovery Path:** Lock expires; user retries.
4. **Money / Trust Impact:** **High.** Brute-force = account takeover.
5. **Observability:** OTP-attempt metric; alert on brute-force pattern.

### P0-12 · Zod Input Validation

1. **Happy Path:** Valid payload → processed.
2. **Failure Path:** Invalid payload → 400 with field-level errors.
3. **Recovery Path:** Client corrects.
4. **Money / Trust Impact:** **Medium-High.** Type confusion = data corruption.
5. **Observability:** Validation-failure metric per route.

### P0-13 · Rate Limiting (fail-closed)

1. **Happy Path:** Under limit → request proceeds.
2. **Failure Path:** Over limit → 429; Redis down → auth/payment/admin-write return 503 (fail-closed), general API fail-open.
3. **Recovery Path:** Limiter recovers; user waits.
4. **Money / Trust Impact:** **High.** Fail-open on payments = abuse surface.
5. **Observability:** Rate-limit-hit metric; alert on limiter-down.

### P0-14 · CSRF Protection

1. **Happy Path:** Valid CSRF token → POST proceeds.
2. **Failure Path:** Missing/invalid token → 403.
3. **Recovery Path:** Client refreshes token.
4. **Money / Trust Impact:** **High.** CSRF = unauthorised state change.
5. **Observability:** CSRF-rejection metric.

### P0-15 · Database Migrations

1. **Happy Path:** Migration reviewed, applied, deploy proceeds.
2. **Failure Path:** Drift detected → deploy blocked; rollback available.
3. **Recovery Path:** Rollback migration.
4. **Money / Trust Impact:** **Critical.** Bad migration = data loss.
5. **Observability:** Drift detection CI check.

### P0-16 · Backup + Recovery

1. **Happy Path:** Daily backup succeeds.
2. **Failure Path:** Backup fails → alert; no silent skip.
3. **Recovery Path:** Restore from backup; monthly drill verifies RTO/RPO.
4. **Money / Trust Impact:** **Critical.** No backup = catastrophic data loss.
5. **Observability:** Backup-success metric; alert on failure.

### P0-17 · Idempotency on All Critical Writes

1. **Happy Path:** Retry returns same result.
2. **Failure Path:** Partial failure → retry safe.
3. **Recovery Path:** N/A.
4. **Money / Trust Impact:** **Critical.**
5. **Observability:** Idempotency coverage test in CI.

### P0-18 · Error Handling

1. **Happy Path:** N/A.
2. **Failure Path:** Unhandled exception → caught by boundary → consistent error envelope → UI actionable.
3. **Recovery Path:** User retries; support has trace id.
4. **Money / Trust Impact:** **Medium.** Bad errors = user stuck.
5. **Observability:** Error-rate metric per route; alert on spike.

### P0-19 · Structured Logging

1. **Happy Path:** Every critical path logs structured event.
2. **Failure Path:** Log write fails → in-memory buffer; retry.
3. **Recovery Path:** Buffer flushed.
4. **Money / Trust Impact:** **Medium.** Silent failure = untraceable.
5. **Observability:** Log-coverage test.

### P0-20 · Health Checks + Metrics

1. **Happy Path:** `/health` returns 200 with component statuses.
2. **Failure Path:** Component down → `/health` reflects; alert.
3. **Recovery Path:** Component recovers.
4. **Money / Trust Impact:** **Medium.** Silent degradation.
5. **Observability:** Self.

### P0-21 · Alerting on P0 Failures

1. **Happy Path:** No alert.
2. **Failure Path:** Threshold breached → alert → on-call responds.
3. **Recovery Path:** Mitigation; postmortem.
4. **Money / Trust Impact:** **High.** Missed alert = prolonged outage.
5. **Observability:** Alert audit.

### P0-22 · Audit Trail Integrity

1. **Happy Path:** Every admin/financial action logged.
2. **Failure Path:** Tamper attempt → append-only storage rejects.
3. **Recovery Path:** N/A (immutable).
4. **Money / Trust Impact:** **Critical.** Missing audit = compliance failure.
5. **Observability:** Audit-coverage test.

### P0-23 · Kill Switch Fail-Safe

1. **Happy Path:** Toggle works.
2. **Failure Path:** Kill switch storage down → defaults to safe (e.g. ordering off if uncertain).
3. **Recovery Path:** Storage recovers; toggle verified.
4. **Money / Trust Impact:** **High.** Wrong default = either lost sales or unsafe orders.
5. **Observability:** Kill-switch-state metric.

### P0-24 · Transactional Data Integrity (cross-entity) — idempotent business effect

1. **Happy Path:** Order creation writes Order + OrderItems + decrements availability + writes outbox event atomically (single DB transaction). Payment capture updates Payment + Ledger + Order status atomically. The outbox publisher later delivers the event to notifications/analytics/settlement.
2. **Failure Path:**
   - **Partial failure mid-transaction** → entire business transaction rolls back; no orphan OrderItems, no orphan ledger entries, no decremented availability without an order.
   - **Outbox publisher crashes after commit** → the event row is already committed in the DB (part of the same transaction), so it is NOT lost. Publisher restarts and re-publishes. Consumers may receive the event more than once → consumers must be idempotent, so the **business effect is exactly-once** even if physical delivery is at-least-once.
   - **Consumer crashes mid-handling** → event re-delivered; idempotency key on consumer side ensures no double-application.
3. **Recovery Path:** Outbox processor retries indefinitely with backoff; reconciliation job catches drift between transactional writes and emitted events; consumers dedup via idempotency key. The committed business transaction is never lost.
4. **Money / Trust Impact:** **Critical.** This is the difference between "DB is consistent" and "the world the DB describes matches the world the rest of the system acted on." A captured payment without a delivered settlement event = vendor never paid = silent money leak.
5. **Observability:** Outbox lag metric (unpublished events age); publisher-retry metric; consumer-idempotency-dedup metric; alert on outbox lag > threshold; partial-commit detector; alert on any orphan entity.

> **Key principle (v1.2):** We do NOT chase technical "exactly-once delivery." We chase **idempotent business effect**: a committed transaction's consequences (notifications, ledger, settlement, audit) eventually apply exactly once in business outcome, even under crashes, retries, and duplicate delivery.

### P0-25 · Concurrency + Duplicate-Execution Control — 3 cases

1. **Happy Path:** All three concurrency classes below resolve correctly under simultaneous access.
2. **Failure Path — three distinct cases:**
   - **Case A — Inventory / availability race:** Two users checkout the last available item simultaneously. Both pass cart validation, but the order-create transaction holds a row-level lock and decrements atomically. One wins; the other's transaction sees zero availability and returns 409 (clear "sold out"), not silent corruption. Protects I-05, I-10.
   - **Case B — State-transition race:** Vendor sends `ACCEPT → CANCEL` while admin sends `CANCEL → OVERRIDE` on the same order. Optimistic locking (version field) rejects the loser with a 409 + retry guidance; the winner's transition applies. The state machine never has two "current" transitions. Protects I-02, I-08.
   - **Case C — Payment duplicate execution:** User double-clicks Pay, or frontend retries. Idempotency key on the payment-create request dedupes; the second request returns the same Payment row, no second capture. Protects I-04.
3. **Recovery Path:** Loser of any race retries with fresh state; UI shows updated availability/price/status. Duplicate-execution victims are transparent — second click is a no-op returning the first result.
4. **Money / Trust Impact:** **Critical per case.** (A) Oversell = vendor can't fulfil = refund + trust loss. (B) Conflicting state transitions = order in wrong state = fulfilment or refund wrong. (C) Double-charge = direct consumer harm.
5. **Observability:** Conflict-rate metric per case (A/B/C); idempotency-dedup-hit metric; alert on conflict spike (indicates contention or bug).

### P0-26 · Disaster Recovery — business recovery, not just DB restore

1. **Happy Path:** Daily backup succeeds with corruption-detection checksum; monthly restore drill passes; runbook current.
2. **Failure Path:**
   - **Backup corrupt** → checksum mismatch → alert; last-known-good backup used.
   - **Regional failure** → failover to standby region (or accept downtime within RTO).
   - **Restore drill fails** → drill blocks release; root-caused before any deploy.
   - **Restore leaves money state inconsistent (v1.2 critical addition):** Backup is 2h old. Razorpay captured 50 payments during those 2h, but restored DB shows them pending. This is NOT "restore complete" — it is a money-state mismatch that must be reconciled.
3. **Recovery Path:**
   - Restore from last-known-good backup per runbook (RTO ≤ 4h; RPO ≤ 24h).
   - **Post-restore business-state reconciliation (v1.2):** Fetch gateway transaction list since backup point; re-sync each to restored DB — captured-but-DB-pending → mark captured + create ledger entry; or if order doesn't exist in restored DB → refund. Audit log re-verified for completeness.
   - **NO-GO if any money state unresolved post-restore.** The system is not "recovered" until money + order + audit + event state are coherent.
4. **Money / Trust Impact:** **Critical.** A "restored DB" with un-reconciled gateway payments = either lost money (captured but DB shows pending → never fulfilled, never refunded) or double-spend (DB shows pending → refund issued → but gateway already captured).
5. **Observability:** Backup-success + checksum metric; restore-drill-result metric; **post-restore reconciliation result** (mismatch count); alert on any backup failure, drill failure, or unresolved money state post-restore.

### P0-27 · Deployment & Rollback — 3 deployment classes

1. **Happy Path:** Release deploys via health-checked pipeline; class is identified pre-deploy; correct strategy applied.
2. **Failure Path + class-specific handling:**
   - **Class 1 — Backward-compatible:** Old and new app versions can coexist. Health check fails post-deploy → auto-abort, traffic stays on previous. Rollback ≤ 10 min (just traffic shift back).
   - **Class 2 — Expand → Migrate → Contract (schema changes):** Schema change deployed in 3 phases — (expand) add new columns/tables, both versions work; (migrate) backfill in background; (contract) old version retired, old columns dropped. A rollback at any phase is safe because the previous phase's schema is still compatible. **No breaking migration ships without this contract phase.**
   - **Class 3 — Breaking:** Old version immediately incompatible. Gated + flagged + requires explicit sign-off; rollback requires DB rollback too (which may be unsafe) → so breaking deploys require a forward-fix plan, not a rollback plan.
3. **Recovery Path:**
   - Class 1: traffic rollback ≤ 10 min.
   - Class 2: rollback to previous phase (always safe).
   - Class 3: forward-fix (rollback often unsafe for DB); breaking deploys thus carry the highest governance bar.
4. **Money / Trust Impact:** **Critical.** A bad deploy with no safe rollback = indefinite outage. A breaking migration rolled back unsafely = data loss.
5. **Observability:** Deploy-class label per deploy; deploy-success metric; rollback-time metric (per class); migration-compatibility check in CI; alert on health-check degradation post-deploy.

> **Key principle (v1.2):** Application rollback and DB rollback are different problems. The 10-minute rollback guarantee applies to backward-compatible (Class 1) deploys only. Schema changes must use expand-migrate-contract so rollback is always safe. Breaking changes accept forward-fix as the recovery path.

### P0-28 · Unknown-Exception Handling — 3 blast-radius levels

1. **Happy Path:** System stays within known state machines; no unknown states reached.
2. **Failure Path:** System reaches a state not in any known state machine (e.g. Order status = "ZOMBIE", or Payment captured but no Order exists, or ledger imbalance detected). The invariant checker detects it and triggers the **smallest sufficient** freeze level:
   - **Level 1 — Transaction freeze:** Only the affected order/payment is frozen (no further state transitions on it). The rest of the platform continues normally. Used when the anomaly is isolated to one business transaction.
   - **Level 2 — Entity quarantine:** A whole entity is quarantined — e.g. a vendor whose orders keep producing anomalies, or a menu item with inconsistent state. New orders against that entity are blocked; existing ones elsewhere continue. Used when the anomaly appears systemic to one entity.
   - **Level 3 — System kill switch:** Emergency shutdown of an entire subsystem (e.g. ordering, payments). This connects to the existing kill-switch architecture (P0-23). Used only when the anomaly threatens platform-wide integrity.
   At every level: evidence preserved (full state snapshot + trace + invariant that was violated), exception queue entry created, on-call alerted.
3. **Recovery Path:** Human investigates via exception queue; root-causes; corrects state through audited manual action or marks resolved-with-explanation; unfreezes the affected transaction/entity/subsystem. System never silently drops or auto-"fixes" unknown states.
4. **Money / Trust Impact:** **Critical, but bounded.** Silently ignoring unknown states is how money leaks compound undetected. Over-freezing (Level 3 for a Level 1 problem) is how a single malformed order takes down the platform. The 3-level model contains blast radius appropriately.
5. **Observability:** Unknown-state counter metric (per level); freeze-level distribution metric; alert on any non-zero count; exception-queue-aging metric; **over-freeze-prevention audit** (was Level 3 used when Level 1 would have sufficed?).

> **Key principle (v1.2):** Freeze precision matters. The goal is not "freeze everything that looks weird" — it is "freeze the smallest scope that contains the anomaly, so the rest of the platform keeps serving customers."

---

### P1 detailed breakdowns (condensed — same 5 questions per capability)

| Capability | Happy | Failure | Recovery | Money/Trust | Observability |
|------------|-------|---------|----------|-------------|---------------|
| Vendor busy mode | Vendor pauses new orders | Pause fails | Manual fallback | Medium (overload) | Pause-state metric |
| Prep-time override | Vendor sets +15 min | Override not reflected | Consumer sees original ETA via re-fetch | Low | Override log |
| Menu CRUD | Vendor edits menu | Edit mid-cart | Cart re-validation blocks checkout | Medium (price mismatch) | Edit log |
| Order accept/reject | Vendor accepts | Reject after capture → auto-refund | Refund completes | High | Reject log |
| Settlement dashboard | Daily settlement matches | Mismatch | Exception queue | High | Reconciliation report |
| Customer intelligence | Aggregated stats | PII leak attempt | Privacy filter blocks | High (compliance) | Privacy-leak alert |
| Ranking engine | Ranked results | Bad ranking | Re-rank on feedback | Low-Medium | Ranking-quality metric |
| Cart re-validation | Valid cart checks out | Invalid line blocks | User removes/updates line | Medium (price mismatch) | Re-validation-failure metric |
| ETA estimation | ETA within ±5 min | Wildly wrong ETA | Re-estimate on status change | Medium (trust) | ETA-accuracy metric |
| Push (FCM) | Notification delivered | Token stale | Token refresh; email fallback | Medium | Delivery-rate metric |
| Email | Email delivered | Bounce | Retry; fallback | Medium | Bounce metric |
| Notification event system | Event fans out | Consumer diverges | Re-emit; reconciliation | Medium | Fanout audit |
| GST invoice | Invoice per capture | Invoice missing | Re-generate from ledger | High (compliance) | Invoice-coverage metric |
| Admin exception queue | Exceptions visible | Queue backlog | Bulk actions | High | Queue-depth metric |
| User/vendor lifecycle | Suspend/reactivate | Wrong suspension | Audit + rollback | High | Audit log |
| Dispute resolution | Dispute tracked with SLA | SLA breach | Escalation | High | SLA metric |
| Profile management | Profile edits | Session breaks | Re-login | Low | Edit log |
| Address management | Address validated | Wrong-restaurant address | Validation blocks | Low | Validation log |
| Realtime reconnect | Reconnect syncs missed events | Event gap | Backfill from event log | Medium | Gap-detection metric |
| PWA | Installable + offline | SW fails | Fallback to online-only | Low | SW-registration metric |
| i18n | All strings translated | Missing key | Fallback to en | Low | Key-coverage metric |
| Dark mode | Toggle + persisted | Flash on load | SSR theme cookie | Low | Visual-regression test |
| Traces | Critical paths traced | Missing trace | Add trace | Medium | Trace-coverage metric |

---

## 9. Business Invariants (Laws of the System)

Invariants are not acceptance criteria — they are **laws** the system must never violate. Every P0 capability is tested against these. A violation of any invariant is, by definition, an **unknown exception** (see P0-28) and must be frozen + alerted, not silently corrected.

Each invariant has a stable ID (`I-01`..`I-12`) so capabilities and dependencies can reference it via a `Protects:` column (see Section 7.1 and the Traceability Map, Section 18).

| ID | Name | Invariant (Law) | Enforcement | Violation ⇒ |
|----|------|-----------------|-------------|-------------|
| I-01 | Payment Integrity | A captured payment cannot exist without a valid order. | Payment.orderId FK NOT NULL + transactional create | Freeze + exception queue |
| I-02 | Order Integrity | A completed order cannot exist without a successful fulfilment. | Order.status transition guarded by fulfilment status | Freeze + exception queue |
| I-03 | Refund Integrity | Total refund amount across a payment cannot exceed the captured amount. | Refund service checks sum before creating | Reject + alert |
| I-04 | Capture Uniqueness | A payment cannot be captured twice. | Payment.status single-transition + idempotency key | Reject second capture + alert |
| I-05 | Item-Order Consistency | An order's items must all belong to the order's restaurant. | OrderItem.menuItemId → MenuItem.restaurantId == Order.restaurantId | Reject + alert |
| I-06 | Ledger Balance | Ledger must balance: sum of debits == sum of credits per order/payment. | Ledger integrity check hourly | Freeze affected + exception queue |
| I-07 | Audit Integrity | Audit log is append-only; no entry may be mutated or deleted. | Storage-level WORM + reject on update/delete | Alert on any attempt |
| I-08 | Fulfilment Authorization | A vendor cannot fulfil an order they did not accept (if accept flow exists). | Fulfilment status gated on acceptance | Reject + alert |
| I-09 | Kill-Switch Monotonicity | Kill switch state is monotonic per toggle event; no silent reverts. | Toggle event log + state derived from log | Freeze on inconsistency |
| I-10 | Transactional Completeness | No business transaction may leave orphan entities (items without order, ledger without payment). | DB transaction + outbox | Freeze + reconciliation |
| I-11 | Refund Precondition | Refund cannot be requested on an un-captured payment. | Refund service checks Payment.status | Reject + alert |
| I-12 | Session Revocation | Session token cannot be valid after revocation. | Session revocation checked on every request | Reject + alert on anomaly |
| I-13 | Pickup / Handoff Integrity | A completed pickup must be attributable to the correct order and an authorized collector (QR + OTP both verified; pickup event auditable to order + customer). | Pickup service requires both QR-scan and OTP match before marking PICKED_UP; pickup event links order_id + collector identity + timestamp | Reject pickup + alert; freeze order if mismatch |
| I-14 | Vendor Operational Integrity | A vendor must not receive uncontrolled workload beyond their declared operational capacity (busy-mode / pause / kitchen-load limits enforced). | Vendor capacity flag + order-intake gate; new orders blocked when vendor in paused/over-capacity state | Reject new order (clear "vendor busy" message); existing orders unaffected |

**Coverage note (v1.4):** I-13 was a genuine gap in v1.2 — I-08 (Fulfilment Authorization) covers *vendor-side* authorization ("vendor can't fulfil an order they didn't accept"), but did not cover *customer-side* handoff correctness ("the right order goes to the right customer"). SnakZap's core promise (Strategic Blueprint: pickup experience = correct order to correct customer via QR + OTP) required this as a first-class invariant. **As of v1.4, I-13 is fully owned by P0-07** (Order State Machine Hardening) — the PICKED_UP transition now requires verified pickup attribution (8 conditions, see P0-07 detailed breakdown). No separate P0-29 was created; attribution is an integrity condition of the transition, not a standalone capability. I-14 captures the vendor-overload failure mode (Strategic Blueprint simulated scenario: active restaurants overwhelmed → vendor NPS drop). **I-14 is intentionally P1-protected because Vendor Operational Integrity is not a launch-blocking financial/security invariant; its P1 control (busy-mode) must nevertheless be defined before the relevant vendor scale is enabled.** This is consistent with the Strategic Blueprint's operational risk register (vendor overload is a documented risk). I-14 is linked to I-02 as a risk amplifier — an overloaded vendor cannot reliably fulfil orders — but is not itself a direct money/order integrity law.

**Rule:** Any code change that could weaken an invariant requires matrix-governance sign-off (see Section 15).

---

## 10. External Dependency Failure Matrix

Every external dependency has an explicit failure strategy. **Fail-open** = degrade but continue serving requests. **Fail-closed** = reject the request (safer for money/auth). **Retry** = transient backoff. **Queue** = persist and process later. **User message** = what the user sees. The `Affected P0` column links each dependency failure to the capabilities it can compromise. The `Blueprint Risk` column cross-links to the Strategic Blueprint's risk register (named risks: R-msg91, R-razorpay-wh, R-db-pool, R-session-loss, and others) so strategic risk and technical readiness live in one graph.

| Dependency | Failure Mode | Strategy | User Message | Alert? | Affected P0 | Blueprint Risk |
|------------|--------------|----------|--------------|--------|-------------|----------------|
| **Razorpay (order create)** | Timeout / 5xx | Retry ×3 with backoff; then fail-closed | "Payment service busy. Please retry." | Yes, on sustained failure | P0-01, P0-03 | R-razorpay-wh |
| **Razorpay (capture/verify)** | Signature mismatch | Fail-closed; do not capture | "Payment could not be verified. No charge made." | Yes | P0-01, P0-05, I-01, I-04 | R-razorpay-wh |
| **Razorpay (refund)** | Gateway down | Queue refund; retry with backoff; REFUND_REQUESTED persists | "Refund is processing. You'll be notified." | Yes, if stuck > 1h | P0-04, P0-03 | R-razorpay-wh |
| **Razorpay (webhook)** | Duplicate | Idempotent dedup; 200 OK | N/A (no user) | No (expected) | P0-05, I-04 | R-razorpay-wh |
| **Razorpay (webhook)** | Tampered signature | 400 reject | N/A | Yes | P0-05, P0-28, I-01 | R-razorpay-wh |
| **Firebase (phone OTP)** | Unavailable / config error | Fail-open to demo OTP (preview only); **production: fail-closed** | "Authentication unavailable. Please retry." | Yes | P0-09, P0-11 | R-session-loss |
| **Firebase (Admin token verify)** | Unreachable | Fail-closed; reject session mint | "Could not verify identity. Please re-login." | Yes | P0-09, P0-10, I-12 | R-session-loss |
| **FCM (push)** | Token stale / delivery fail | Token refresh; retry; email fallback | (Consumer sees email if push fails) | No, on single fail; Yes on rate spike | (P1 notification — degraded, not P0) | (P1 risk) |
| **Email provider** | Bounce / throttle | Retry ×3; quarantine bad addresses | (User sees nothing; alt channel used) | Yes on bounce-rate spike | (P1 notification — degraded, not P0) | (P1 risk) |
| **Maps / location** | Unavailable | Fail-open; ranking without distance | "Showing nearby restaurants" (degraded ranking) | No | (P1 discovery — degraded, not P0) | (P1 risk) |
| **Database** | Degraded / unavailable 30s / connection pool exhaustion | Fail-closed on writes; read-replica for reads if available | "Service temporarily unavailable. Please retry." | Yes immediately | P0-24, P0-25, P0-26, I-01..I-10 (all data P0s) | R-db-pool |
| **Redis** | Unavailable | Auth/payment/admin-write: fail-closed (503); general API: fail-open (in-memory limiter) | "Service busy. Please retry." for fail-closed paths | Yes | P0-13, P0-10 (sessions) | R-session-loss |
| **WebSocket (socket.io)** | Disconnected | Client auto-reconnect + missed-event backfill from event log | "Reconnecting…" indicator; no silent gap | Yes if > N clients disconnected | (P1 realtime — degraded, not P0) | (P1 risk) |
| **SMS gateway (MSG91 or similar)** | Down | Queue pickup-OTP; consumer sees in-app OTP as fallback | In-app OTP visible | Yes | P0-11 (OTP delivery), I-13 (pickup handoff) | R-msg91 |
| **Outbox publisher (internal worker)** | Crashes / stalled | Event row already committed; publisher restarts and re-publishes; consumers idempotent | N/A | Yes, on lag > threshold | P0-24 | (internal) |
| **CI/CD pipeline** | Deploy fails mid-way | Auto-abort; traffic stays on previous version | N/A | Yes | P0-27 | (internal) |

**Rule:** A dependency not listed here cannot be added to the system without a row in this table. No external call without a failure strategy.

---

## 11. Capability Lifecycle

A capability is not "done" when code is merged. It moves through explicit lifecycle states, each a gate. A capability at a lower state cannot be relied upon by a capability at a higher state. Automated tests prove system behavior; the final `Approved` state proves a human business owner accepts the residual risk.

```
Proposed
   ↓  [matrix row exists with failure + recovery defined]
Specified
   ↓  [all dependencies are themselves at least Specified; acceptance + test criteria written]
Dependency-ready
   ↓  [code merged; happy-path tests pass]
Implemented
   ↓  [happy-path verified in a realistic environment]
Tested
   ↓  [running in production-like env with observability live]
Observed
   ↓  [failure paths injected and verified; recovery confirmed]
Failure-tested
   ↓  [second-engineer review; invariant checks pass]
Reviewed
   ↓  [business owner accepts residual risk; sign-off]
Approved
   ↓  [final production gate]
Production-ready
```

| State | Meaning | Gate to next |
|-------|---------|--------------|
| **Proposed** | A row in the matrix. | Failure + recovery + observability answers exist. |
| **Specified** | 5 questions answered; acceptance + test criteria written. | All dependencies are at least Specified. |
| **Dependency-ready** | Dependencies are at least Implemented. | Code merged; happy-path tests pass. |
| **Implemented** | Code exists; unit + integration tests green. | Happy-path verified in staging. |
| **Tested** | Happy path works in production-like env. | Observability live and emitting expected signals. |
| **Observed** | Running with observability; baseline metrics captured. | Failure paths injected. |
| **Failure-tested** | Failure + recovery paths verified by injection. | Second-engineer review; invariants pass. |
| **Reviewed** | Second engineer reviewed; invariants verified; technical sign-off. | Business owner accepts residual risk. |
| **Approved** | Business owner has accepted the risk profile; governance sign-off recorded. | Final production gate. |
| **Production-ready** | Approved + all launch-gate AND-conditions met. May be relied upon. | — |

**The four rules that make this real:**

1. **"Code merged" ≠ "Production-ready."** A merged capability at `Implemented` cannot be a dependency for another capability's `Production-ready` claim.
2. **No capability reaches `Production-ready` without passing `Failure-tested` AND `Reviewed` AND `Approved`.** Happy-path-only capabilities block launch. Automated tests are necessary but not sufficient — a human must accept the risk.
3. **`Approved` is a business decision, not a technical one.** It records that a business owner understands the failure modes, the residual risk, and the recovery procedure — and accepts launching with them.
4. **Separation of duties (v1.3):** The developer who wrote a P0 capability **cannot** be its `Reviewed` or `Approved` signatory. `Reviewed` requires a different engineer; `Approved` requires a business/operations owner. No self-approval of P0 — this is a hard governance rule, not a guideline.

**Launch gate (see Section 14 for full conditions):** SnakZap launches only when **every P0 capability is at `Production-ready`** AND all launch-gate AND-conditions hold.

---

## 12. Cross-Cutting Concerns

These apply horizontally across priorities and domains. Each must be defined before its dependent capabilities can be marked ready.

### 12.1 Architectural Laws (v1.3)

These are the highest-level principles of the system — above invariants, above capabilities. They are stated once here and referenced everywhere.

> **Law 1 — Business Recovery Coherence:** A system is not recovered until money state, order state, audit state, and required event state are coherent. A DB restore alone is not recovery. (Enforced by P0-26.)

> **Law 2 — Idempotent Business Effect:** A committed business transaction's consequences eventually apply exactly once in business outcome, even under crashes, retries, and duplicate delivery. Technical "exactly-once delivery" is not pursued. (Enforced by P0-24, P0-17.)

> **Law 3 — Freeze Precision:** When an unknown state is detected, the smallest sufficient blast radius is frozen. One malformed order must not stop the platform. (Enforced by P0-28.)

> **Law 4 — Pickup Correctness:** No order is marked PICKED_UP without verified handoff (QR + OTP) attributable to the correct order and an authorized collector. (Enforced by I-13, P0-07.)

> **Law 5 — Separation of Duties:** No P0 capability is self-approved. The developer is never the `Reviewed` or `Approved` signatory. (Enforced by Section 11, rule 4.)

> **Law 6 — Invariant vs Capability Separation (v1.4):** *An invariant describes a truth that must never be violated; a capability describes the mechanism that enforces or preserves that truth.* Direct Protectors enforce invariants; Control/Enablers preserve the conditions under which Direct Protectors can function. This separation keeps ownership honest: observability detects I-01 violations, it does not enforce I-01. (Enforced by Section 7.1 classification + Section 18.5 Coverage Query A interpretation.)

### 12.2 Cross-cutting capabilities table

| Concern | Definition | Applies To |
|---------|------------|------------|
| **Money flow closed loop** | Consumer → escrow/hold → vendor payout − commission − gateway fee − refund = platform margin. The loop must close on every order. | All P0 payment capabilities |
| **Event-driven notification** | One domain event (e.g. `ORDER_CONFIRMED`) triggers all consumers (push, email, vendor dashboard, analytics). No direct coupling. | All P1 notification capabilities |
| **Idempotency everywhere** | Every state-changing write accepts an idempotency key; retries are safe. | All P0 + P1 writes |
| **Failure isolation** | A failure in one domain (e.g. notifications) must not block another (e.g. payment). | All domains |
| **Privacy by design** | Vendor/admin sees aggregated or role-scoped data only; no raw PII export without audit. | Vendor + admin capabilities |
| **Audit everything financial** | Every money-moving action is in an immutable audit trail linked to the ledger. | All P0 payment + refund capabilities |
| **Graceful degradation** | Non-critical features degrade visibly, not silently. | All P1+ |
| **Operational observability (v1.3 — cross-cutting, not per-domain)** | One unified observability substrate (structured logs + metrics + traces + alerts) serves all domains. Per-domain observability requirements (payment, order, notification, DB) are *consumers* of this substrate, not separate capabilities. This avoids matrix duplication: there is one P0-19 (logging), one P0-20 (health/metrics), one P0-21 (alerting) — domain-specific dashboards are built on top, not added as new P0 rows. | All P0 + P1 |

---

## 13. Decision Log / Open Questions

These require stakeholder input before implementation. Listed here so they are not lost.

| # | Question | Default if unresolved | Needed by |
|---|----------|-----------------------|-----------|
| Q1 | Razorpay live keys vs test keys for soft launch? | Test keys; no real money | P0 implementation |
| Q2 | Firebase Admin SDK service-account — who provisions? | Block P0-9 until provisioned | P0-9 |
| Q3 | Redis availability — managed or self-hosted? | Self-hosted fallback; fail-closed semantics | P0-13 |
| Q4 | Email service provider (SES, SendGrid, Postmark)? | Postmark default | P1 email |
| Q5 | GST configuration — per-state rates? | Central config; state overrides later | P1 invoice |
| Q6 | On-call rotation ownership? | Engineering rotation | P0-21 |
| Q7 | Backup destination + retention? | Daily, 30-day retention | P0-16 |
| Q8 | Refund policy — auto vs manual above ₹X? | Manual above ₹1000 | P0-4 |
| Q9 | Vendor payout frequency — daily or weekly? | Daily settlement, weekly payout | P1 settlement |
| Q10 | PWA scope — full offline or graceful fallback? | Graceful fallback only | P1 PWA |
| Q11 | CI/CD platform — GitHub Actions, GitLab CI, or other? | GitHub Actions default | P0-27 deployment |
| Q12 | Standby region for DR, or single-region with backups? | Single-region + backups; RTO 4h accepted | P0-26 disaster recovery |
| Q13 | Feature-flag system — LaunchDarkly, custom, or env-based? | Env-based initially; migrate later | P0-27 deployment |
| Q14 | Outbox implementation — DB table + worker, or message broker? | DB table + worker (simpler) | P0-24 transactional integrity |
| Q15 | Optimistic-lock retry policy — auto-retry N times or surface to user? | Auto-retry ×2; then surface conflict | P0-25 concurrency |
| Q16 | Exception queue ownership — dedicated ops role or shared on-call? | Shared on-call initially | P0-28 + P1 admin exception queue |
| Q17 | Outbox consumer idempotency key — order id or event id? | Event id (allows multiple event types per order) | P0-24 |
| Q18 | Freeze blast-radius escalation — auto-escalate Level 1 → 2 → 3, or human-escalated only? | Human-escalated; auto only on invariant I-01/I-04 (money) violation | P0-28 |
| Q19 | Deployment class classification — pre-deploy automated check, or manual label? | Automated check via migration-analysis tool; manual override requires sign-off | P0-27 |
| Q20 | Business owner for `Approved` lifecycle state — per capability, or single product owner? | Single product owner for v1; per-capability owners post-launch | Capability lifecycle |
| Q21 | Pickup verification — QR + OTP both required, or either? | Both required (defense in depth; QR alone spoofable, OTP alone transferable) | I-13 |
| Q22 | Vendor capacity threshold — fixed per vendor, or adaptive based on historical prep time? | Adaptive (rolling 7-day median prep time × headroom) | I-14 |
| Q23 | P0 waiver max expiry — 30 days blanket, or per-capability? | 30 days blanket for v1; per-capability post-launch | Launch gate condition 7 |
| Q24 | Strategic Blueprint feature mapping — who owns the feature→capability→invariant mapping? | Product owner owns mapping; engineering validates capability/invariant side | Section 18.6 |

---

## 14. Acceptance — When Is the Matrix "Done"?

The matrix itself is "done" (ready to drive implementation) when:

1. Every P0 capability has all 5 questions answered. ✅ (v1.2 — 28 P0 capabilities)
2. Every P1 capability has all 5 questions answered. ✅ (v1.2, condensed — 22 P1 capabilities)
3. Actor's worst-day scenarios traced through capabilities. ✅ (v1.2)
4. Business invariants (Section 9) defined with stable IDs + enforcement + violation-handling. ✅ (v1.2 — 12 invariants I-01..I-12)
5. External dependency failure matrix (Section 10) complete with `Affected P0` linkage. ✅ (v1.2 — 16 dependency scenarios)
6. Capability lifecycle (Section 11) defined with explicit gates including `Approved`. ✅ (v1.2 — 9 states)
7. Traceability map (Section 18) linking capabilities ↔ invariants ↔ dependencies ↔ tests ↔ observability. ✅ (v1.2)
8. Open questions logged with defaults. ✅ (v1.2 — 20 open questions)
9. Stakeholder sign-off on P0 scope. ⏳ (pending)
10. P2/P3 inventory acknowledged as out-of-scope for v1 launch. ✅ (v1.2)

**A capability is "Production-ready" (separate from the matrix being done) when it reaches state 9 of the Capability Lifecycle (Section 11):**

- Specified (5 questions answered). ✅ at matrix v1.2
- Dependency-ready (dependencies at least Implemented). ⏳
- Implemented (code merged; happy-path tests pass). ⏳
- Tested (happy-path verified in staging). ⏳
- Observed (observability live; baseline captured). ⏳
- Failure-tested (failure paths injected; recovery confirmed). ⏳
- Reviewed (second-engineer; invariants verified). ⏳
- Approved (business owner accepts residual risk). ⏳
- → **Production-ready**. ⏳

### 14.1 P0 Launch Gate — 7 AND-conditions (PRODUCTION GO / NO-GO)

SnakZap launches **only when ALL seven conditions hold simultaneously.** Any single failure ⇒ NO-GO.

| # | Condition | Evidence |
|---|-----------|----------|
| 1 | **All P0 capabilities at `Production-ready`** (lifecycle state 9) | Capability lifecycle tracker — every P0 row green |
| 2 | **All P0 invariants verified** (I-01..I-14) | Invariant-checker test suite green; no unresolved violations |
| 3 | **All critical external-dependency scenarios tested** | Dependency matrix (Section 10) — every row with a P0 `Affected P0` link has been failure-injected |
| 4 | **DR drill passed** (including post-restore business-state reconciliation) | P0-26 restore-drill report; no unresolved money state |
| 5 | **Rollback drill passed** (per deployment class) | P0-27 rollback-drill report; Class 1 ≤ 10 min verified |
| 6 | **No unresolved P0 exception** in the exception queue | Exception queue empty of P0-class entries; any open entries have an accepted-risk record |
| 7 | **No expired exception waiver** (v1.3) | Every P0 exception waiver has: named owner + explicit expiry date + documented mitigation + business-owner approval. No waiver may be past its expiry. Temporary waivers must not have become permanent — each is reviewed at expiry and either resolved or re-approved with fresh justification. |

**Verdict:** Conditions 1–7 all green ⇒ **PRODUCTION GO.** Any red ⇒ **NO-GO**, no exceptions, no "we'll fix it post-launch" for P0.

**Waiver discipline (v1.3):** A P0 exception waiver is a structured record, not a verbal hand-wave. Required fields: `owner`, `expiry` (max 30 days for P0), `mitigation` (what reduces risk until resolved), `approver` (business owner, not the developer). A waiver past expiry with no re-approval is treated as an unresolved P0 exception (condition 6 fails).

---

## 15. Governance

- **Change control:** Any change to a P0 capability's acceptance criteria requires sign-off.
- **Promotion rule:** A capability can be promoted to P0/P1 only when its failure + recovery is defined (the entry rule).
- **Demotion rule:** A P0 capability found to have undefined failure semantics is demoted to "blocked" until resolved.
- **Invariant protection:** Any code change that could weaken a Business Invariant (Section 9) requires matrix-governance sign-off. Invariants are laws, not guidelines.
- **Lifecycle enforcement:** A capability may not be claimed as a dependency until it reaches at least `Dependency-ready` (state 3, Section 11). A capability may not gate launch until it reaches `Production-ready` (state 9, which requires `Approved` — business-owner sign-off).
- **External dependency rule:** No new external dependency may be introduced without a row in the External Dependency Failure Matrix (Section 10).
- **Traceability rule:** Every P0 capability must list which invariants it `Protects` (Section 7.1). Every invariant must have at least one protecting capability (Section 18.2). Gaps are matrix defects.
- **Review cadence:** Matrix reviewed at every P0 milestone; not ad-hoc.
- **No implementation without matrix entry:** No code is written for a capability until it has a row in this matrix.

---

## 16. Summary — The Shift This Document Represents

| From (audit) | To (matrix) |
|---------------|-------------|
| "What features are missing?" | "Where will it break, and what happens when it does?" |
| Feature checklist | Capability + failure + recovery + observability |
| Priority by gut | Priority by money/trust impact + entry rule |
| Demo readiness | Production readiness |
| "Is it built?" | "Does it survive contact with reality?" |
| "Code merged = done" | 9-state lifecycle; "Production-ready" only after failure-tested + reviewed + approved |
| Implicit consistency | 12 explicit Business Invariants (I-01..I-12) enforced as laws |
| Ad-hoc external calls | Every dependency has a fail-open/closed/queue strategy + `Affected P0` link |
| Known failures only | Unknown-exception handling freezes + alerts unknown states (3 blast-radius levels) |
| Technical exactly-once | Idempotent business effect (outbox + idempotent consumers) |
| "DB restore = recovered" | Business recovery — post-restore money/order/audit state reconciled |
| "10-min rollback" blanket promise | Per deployment class: backward-compatible / expand-migrate-contract / breaking |
| "Freeze everything weird" | Smallest-sufficient freeze scope (transaction / entity / system) |
| Parallel lists (caps, invariants, deps, tests) | Traceability map links them first-class (Section 18); 8 coverage queries A–H as pass/fail |
| "All tests green = launch" | 7 AND-condition launch gate (caps + invariants + dep tests + DR drill + rollback drill + zero P0 exceptions + no expired waiver) |
| Strategy ↔ engineering disconnected | Strategic Blueprint feature → capability → invariant mapping (Section 18.6) |
| Missing pickup correctness law | I-13 Pickup/Handoff Integrity + Architectural Law 4 (Section 12.1) |
| Self-approval possible | Separation of duties — developer cannot be `Reviewed` or `Approved` signatory |
| Per-domain observability duplication | One cross-cutting observability substrate; domain dashboards consume it |

This matrix is the gate. SnakZap launches only when **all 7 launch-gate AND-conditions (Section 14.1) are green** — not before, not with exceptions.

---

## 17. Next Step (after sign-off)

Once v1.3 is signed off, the next artifacts follow a strict chain — **no implementation, no sprints, until each link is reviewed.**

```
v1.3 Matrix (this document)
        ↓  [conceptual approval ✅; formal sign-off pending coverage check]
Artifact 1 — P0 Traceability & Invariant Map (P0_TRACEABILITY_MAP.md)
        ↓  [must pass all 8 coverage queries A–H; Strategic Blueprint feature mapping populated]
Artifact 2 — P0 Dependency Graph (technical + business/feature dependencies)
        ↓  [review]
Artifact 3 — Critical Path to Launch
        ↓  [review]
Artifact 4 — Implementation Order
        ↓  [review]
Artifact 5 — Sprint Plan
        ↓
Implementation begins
```

**Artifact 1 (immediate next)** is the P0 Traceability & Invariant Map. It is a single table (one row per P0 capability, columns per Section 18.5) plus the Strategic Blueprint feature→capability→invariant mapping (Section 18.6). It is a **coverage test**, not a document — the 8 queries (A–H) run as automated checks; any blank cell fails. Formal sign-off of this matrix is blocked until Artifact 1 passes all 8 queries.

**Artifact 2** (P0 Dependency Graph) builds on Artifact 1 to define:
- Which P0 capability must be built first (no dependents).
- What each P0 capability requires its dependencies to be at (which lifecycle state).
- Which capabilities unlock once a given capability reaches `Production-ready`.
- The critical path to launch.
- **Business/feature dependencies preserved** (e.g. Pre-paid + Quick Reorder, POS + Daily Settlement, Live-Kitchen + Push — interactions from the Strategic Blueprint), not just technical dependencies. These interactions are nodes in the graph, not linear edges.

Only after Artifact 2 + Artifact 3 are reviewed does sprint breakdown (Artifact 5) begin.

---

## 18. P0 Traceability & Invariant Map (v1.3 — coverage-test specification)

This section is the **bridge** between the matrix's parallel lists (capabilities / invariants / dependencies / tests / observability) and the upcoming P0 Dependency Graph. It makes the relationships first-class so the dependency graph is built on facts, not assumptions.

### 18.1 Master chain

Every P0 capability traces through this chain. A break at any link is a matrix defect.

```
Capability (P0-##)
    ↓  Protects →
Invariant (I-##)
    ↓  Enforced by →
Acceptance criterion + Test criterion
    ↓  Verified via →
Failure-injection scenario
    ↓  Recovered via →
Recovery procedure
    ↓  Observed via →
Metric / log / alert
    ↓  Triggered by failure of →
External dependency (Section 10 row)
    ↓  Lifecycle gate →
Production-ready (state 9)
```

### 18.2 Capability → Invariant coverage

Which invariants each P0 capability protects (consolidated from Section 7.1 `Protects` column). Every invariant must have at least one protecting capability; gaps are matrix defects.

| Invariant | Protected by (P0 capabilities) |
|-----------|-------------------------------|
| I-01 Payment Integrity | P0-01, P0-03, P0-05, P0-06, P0-24, P0-26 |
| I-02 Order Integrity | P0-06, P0-07, P0-08, P0-24, P0-25, P0-26 |
| I-03 Refund Integrity | P0-04 |
| I-04 Capture Uniqueness | P0-01, P0-05, P0-17, P0-25 |
| I-05 Item-Order Consistency | P0-24, P0-25 |
| I-06 Ledger Balance | P0-02, P0-03, P0-04, P0-24, P0-26 |
| I-07 Audit Integrity | P0-22, P0-26 |
| I-08 Fulfilment Authorization | P0-06, P0-07, P0-25 |
| I-09 Kill-Switch Monotonicity | P0-23 |
| I-10 Transactional Completeness | P0-02, P0-08, P0-17, P0-24, P0-25, P0-26 |
| I-11 Refund Precondition | P0-04 |
| I-12 Session Revocation | P0-09, P0-10, P0-11 |
| I-13 Pickup / Handoff Integrity | **P0-07 (fully owned as of v1.4 — PICKED_UP transition requires verified attribution)**, P0-28 (unknown-exception on handoff mismatch) |
| I-14 Vendor Operational Integrity | P0-28 (backstop only); **primary protector is P1 busy-mode** — intentionally P1-protected (not launch-blocking financial/security invariant); P1 control must be defined before vendor scale is enabled |

**Coverage rule (v1.4):** Any invariant with zero protectors is a matrix defect. **P0 capabilities are classified as Direct Protectors (must map to ≥1 specific invariant) or Control/Enablers (legitimately map to none — they detect/enable, not enforce).** Control/Enablers are not "indirect protectors" — that framing distorts architecture (observability detects I-01 violations, it does not enforce them). I-14 is an explicitly documented P1-protected exception, not a silent rule introduction.

### 18.3 Dependency → Capability impact (consolidated)

Which P0 capabilities each external-dependency failure can compromise (from Section 10 `Affected P0` column). Every P0 capability that depends on an external system must appear here.

| Dependency failure | Compromises P0 capabilities |
|--------------------|------------------------------|
| Razorpay order create timeout | P0-01, P0-03 |
| Razorpay capture/verify mismatch | P0-01, P0-05 (and invariants I-01, I-04) |
| Razorpay refund gateway down | P0-04, P0-03 |
| Razorpay webhook duplicate | P0-05 (and I-04) |
| Razorpay webhook tampered | P0-05, P0-28 (and I-01) |
| Firebase phone OTP unavailable | P0-09, P0-11 |
| Firebase Admin verify unreachable | P0-09, P0-10 (and I-12) |
| Database degraded/unavailable | P0-24, P0-25, P0-26 (and all data invariants I-01..I-10) |
| Redis unavailable | P0-13, P0-10 |
| Outbox publisher stalled | P0-24 |
| CI/CD pipeline failure | P0-27 |

### 18.4 Test → Capability mapping (principle)

Every P0 capability has at least one test criterion (Section 7.1). The traceability map requires:
- Each test criterion links to the capability it validates.
- Each test criterion links to the invariant(s) it verifies.
- A test that verifies no invariant is either a happy-path smoke test (acceptable but not sufficient for `Production-ready`) or a candidate for removal.

This mapping is the input to the **P0 Dependency Graph** — it tells us which capabilities share test infrastructure, which invariants cross multiple capabilities (and thus need cross-capability test coordination), and which dependencies block the most capabilities (highest-priority hardening targets).

### 18.5 The 8 Coverage Queries (v1.3 — pass/fail spec for the Traceability Map)

The full P0 Traceability & Invariant Map (next artifact) is not just a document — it is a **coverage test**. It must satisfy all 8 queries below. Any blank cell ⇒ matrix incomplete ⇒ formal sign-off blocked.

| Query | Requirement | Blank ⇒ |
|-------|-------------|---------|
| **A** | Every P0 capability → ≥1 invariant it protects | Capability with no invariant is either foundational (Zod, migrations, observability) or a demotion candidate |
| **B** | Every invariant → ≥1 P0 capability that protects it | Invariant with no protector is a matrix defect — must be added or removed |
| **C** | Every P0 capability → ≥1 failure-injection test | Untested P0 capability blocks launch |
| **D** | Every external dependency → ≥1 failure scenario | Unguarded dependency violates Section 10 rule |
| **E** | Every failure scenario → documented recovery procedure | Failure with no recovery is an unknown-exception (P0-28) waiting to happen |
| **F** | Every P0 capability → ≥1 observable signal (metric/log/alert) | Silent P0 capability violates P0-19/P0-21 |
| **G** | Every P0 capability → named approver (for `Approved` state) | No approver ⇒ cannot reach `Production-ready` (separation of duties, Section 11 rule 4) |
| **H** | Every P0 capability → test evidence (CI run / drill report / injection log) | No evidence ⇒ lifecycle state cannot advance past `Failure-tested` |

**The Traceability Map artifact must render as a single table** with one row per P0 capability and columns: `ID | Capability | Protects (invariants) | Failure scenario | Recovery | Test | Dependency | Observable signal | Approver | Test evidence | Lifecycle state`. Then the 8 coverage queries are run as automated checks against that table — any empty cell is a failing test.

### 18.6 Strategic Blueprint ↔ Matrix feature mapping (v1.3 — the strategy↔engineering bridge)

The Strategic Blueprint defines *what* SnakZap builds and *why* (102 feature ideas, ICE prioritization, feature interactions). The Readiness Matrix defines *how* it operates safely. The bridge between them is a **feature → capability → invariant** mapping so that every strategic feature traces to the technical guarantees that make it safe.

The full Traceability Map artifact must include this mapping layer. Seed structure (to be populated against the Strategic Blueprint's feature IDs):

| Blueprint Feature ID | Feature | → Capability | → Invariant(s) |
|----------------------|---------|--------------|----------------|
| O04 | Pre-paid Button | P0-01 (Razorpay capture) | I-01, I-04 |
| O08 | Quick Reorder | P0-08 (order idempotency) + P0-25 (concurrency) | I-02, I-10 |
| P01 | QR Pickup | P0-07 (state machine, PICKED_UP gate) | I-13 |
| P05 | Live Kitchen | P0-06 (state separation) + P0-07 | I-02, I-08 |
| V11 | Daily Settlement | P0-02 (ledger) + P0-03 (reconciliation) | I-06 |
| (…full list populated from Strategic Blueprint's 102 features) | | | |

**Feature interactions preserved (per Strategic Blueprint):** The mapping must also capture *interactions* — e.g. "Pre-paid + Quick Reorder" requires both P0-01 and P0-08 to be `Production-ready` AND their interaction tested (a reorder that triggers payment must not double-charge). "POS + Daily Settlement" requires P0-02 + P0-03 + the POS-import capability (P3) to be coherent. These interactions are nodes in the upcoming P0 Dependency Graph, not just linear dependencies.

### 18.7 Status of this section in v1.3

v1.3 expands the traceability foundation:
- ✅ Invariant IDs I-01..I-14 stable (I-13 Pickup, I-14 Vendor Operational added).
- ✅ `Protects` column on every P0 capability.
- ✅ `Affected P0` + `Blueprint Risk` columns on every dependency row.
- ✅ Coverage tables 18.2, 18.3 populated (updated for I-13, I-14).
- ✅ 8 coverage queries (A–H) defined as pass/fail spec (18.5).
- ✅ Strategic Blueprint feature→capability→invariant mapping requirement defined (18.6).

The **full** traceability map (single table, one row per P0 capability, all columns, 8 queries green, feature mapping populated) is the next artifact. It will live as a separate document (`P0_TRACEABILITY_MAP.md`) referenced by this matrix.

---

*End of SnakZap Production Readiness Matrix v1.4.*
