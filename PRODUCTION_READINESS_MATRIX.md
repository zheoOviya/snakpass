# SnakZap Production Readiness Matrix v1.2

> **Document Type:** Specification & Decision Document
> **Status:** Draft v1.2 — pending sign-off
> **NOT an implementation plan.** This document defines *what* must be true before SnakZap can serve a real paying customer, *how* each capability must behave under failure, and *how* we will know it is ready. Implementation order, code, and sprints are derived from this — not the other way around.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Version | 1.2 |
| Date | 2026-08-09 |
| Status | Draft — awaiting traceability review |
| Baseline | Uploaded audit (`zheo-main.zip` rebuild) + self-audit + stakeholder feedback |
| Authors | Engineering + Product |
| Reviewers | (pending) |
| Supersedes | v1.1 |
| Next review | After P0 traceability + invariant map sign-off; before P0 Dependency Graph |

---

## Revision History

| Version | Date | Changes | Trigger |
|---------|------|---------|---------|
| v1.0 | 2026-08-09 | Initial matrix: 5-question framework, actor's worst day, P0/P1/P2/P3 inventory, 23 P0 capabilities. | Self-audit + stakeholder feedback. |
| v1.1 | 2026-08-09 | Added 5 new P0 capabilities (P0-24..P0-28): Transactional Data Integrity, Concurrency, DR, Deployment & Rollback, Unknown-Exception. Added 3 sections: Business Invariants, External Dependency Failure Matrix, Capability Lifecycle (8 states). Added G51–G57. | Stakeholder preliminary review — 7 corrections. |
| v1.2 | 2026-08-09 | Refined P0-24 (idempotent business effect, not technical exactly-once), P0-25 (3 concurrency cases + duplicate-execution control), P0-26 (business recovery, not just DB restore), P0-27 (3 deployment classes: backward-compatible / expand-migrate-contract / breaking), P0-28 (3 blast-radius levels: transaction freeze / entity quarantine / system kill switch). Added invariant IDs I-01..I-12 with `Protects` column on P0 capabilities. Added `Affected P0` column to External Dependency Matrix. Added lifecycle state `Approved` (now 9 states). Strengthened P0 launch gate to 6 AND conditions. Added Section 18: P0 Traceability & Invariant Map. Updated Next-Step chain: Traceability Map → Dependency Graph → Critical Path → Implementation Order → Sprint Plan. Added 4 new open questions (Q17–Q20). | Stakeholder architectural review — 10 corrections. |

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

| ID | Domain | Capability | Failure Scenario | Dependency | Acceptance Criteria | Test Criteria | Protects | Owner |
|----|--------|------------|------------------|------------|---------------------|---------------|----------|-------|
| P0-01 | Payment | Razorpay order create + verify + capture | Gateway timeout / signature mismatch / double Pay click | Razorpay SDK, Payment model | Every payment has a verifiable captured state; no payment captured without verified signature | Idempotency test; signature-tamper test; double-submit test | I-01, I-04 | Backend |
| P0-02 | Payment | Payment ledger (double-entry) | Ledger write fails after capture | Payment model, DB txn | Every captured payment has matching ledger entries; ledger is append-only | Ledger integrity test; partial-failure test | I-06, I-10 | Backend |
| P0-03 | Payment | Payment reconciliation (gateway ↔ ledger) | Gateway says captured, DB says failed | Payment + scheduled job | Daily reconciliation report; mismatches surface in exception queue within 1 hour | Reconciliation job test; mismatch injection test | I-01, I-06 | Backend |
| P0-04 | Payment | Refund flow (full + partial) | Refund requested but gateway down / partial refund mismatch | Payment + Razorpay refund API | Refund has its own status lifecycle; partial refunds tracked; ledger updated atomically | Refund lifecycle test; partial-refund test; refund-during-outage test | I-03, I-06, I-11 | Backend |
| P0-05 | Payment | Webhook integrity (HMAC + idempotent) | Duplicate webhook / tampered signature / out-of-order | Payment + webhook endpoint | Duplicate webhooks deduped; tampered rejected; out-of-order handled | Duplicate injection test; signature tamper test; reorder test | I-01, I-04 | Backend |
| P0-06 | Order | State separation (Order / Payment / Fulfilment / Refund) | Order cancelled but payment captured | Order + Payment + Fulfilment + Refund models | Each dimension evolves independently; inconsistent combos surfaced in exception queue | State-transition matrix test; inconsistent-state detection test | I-01, I-02, I-08 | Backend |
| P0-07 | Order | Order state machine hardening | Invalid transition attempted / concurrent updates | Order model + optimistic locking | Invalid transitions rejected; concurrent updates serialised | Concurrency test; invalid-transition test | I-02, I-08 | Backend |
| P0-08 | Order | Idempotency on order creation | Double submit / retry storm | Order model + idempotency key | Same idempotency key returns same order; no duplicate orders created | Idempotency-key test; retry-storm test | I-02, I-10 | Backend |
| P0-09 | Auth | Server-side Firebase ID token verification | Forged client identity / expired token | Firebase Admin SDK + session | Server rejects unverified identity; sessions bound to verified phone | Token-forgery test; expired-token test | I-12 | Backend |
| P0-10 | Auth | Session integrity (refresh, revoke, active sessions) | Stolen session token / user logs out elsewhere | Session model | Sessions expireable, revocable; active-sessions list available | Session-revoke test; concurrent-session test | I-12 | Backend |
| P0-11 | Auth | OTP retry limits + phone validation | OTP brute-force / invalid phone format | OTP service + rate limiter | Max 5 OTP attempts / 3 sends per 10 min; phone E.164 validated | Brute-force test; invalid-phone test | I-12 | Backend |
| P0-12 | Security | Zod input validation on every API | Malformed payload / type confusion | Zod schemas per route | No API accepts unvalidated input; 400 on schema mismatch | Fuzz test per route; schema-mismatch test | (all, foundational) | Backend |
| P0-13 | Security | Rate limiting (fail-closed for auth/payment/admin-write) | Redis down / abuse burst | Rate limiter (Redis or in-memory fallback) | Auth/payment/admin-write return 503 when limiter unavailable; general API fail-open | Fail-closed test; burst test | (protects P0-09..P0-11) | Backend |
| P0-14 | Security | CSRF protection | Cross-site forged POST | CSRF token + SameSite cookie | State-changing POSTs require valid CSRF token | CSRF injection test | (all state-changing) | Backend |
| P0-15 | Data | Database migrations (not `db:push`) | Schema drift / data loss on deploy | Prisma migrate + review process | Every schema change ships as reviewed migration; no data-destructive push | Migration rollback test; drift detection test | (all, foundational) | Backend |
| P0-16 | Data | Backup | DB corruption / accidental delete | Backup schedule + corruption-detection | Daily backups; corruption-detection checksum on every backup; backup integrity verified | Backup-integrity test; corruption-detection test | (all, foundational) | Backend |
| P0-17 | Reliability | Idempotency on all critical writes | Retry storm / partial failure | Idempotency key on orders, payments, refunds, status updates | All critical writes idempotent; retries return same result | Idempotency test per critical write | I-04, I-10 | Backend |
| P0-18 | Reliability | Error handling (boundaries + consistent responses) | Unhandled exception / partial response | Error boundaries + error envelope | Every API returns consistent error envelope; UI shows actionable errors | Error-injection test per route | (all, foundational) | Full-stack |
| P0-19 | Observability | Structured logging | Silent failure / untraceable error | Logger (structured JSON) | Every critical path logs structured event with trace id | Log-coverage test | (all, observability) | Backend |
| P0-20 | Observability | Health checks + basic metrics | Service silently degraded | Health endpoint + metrics export | `/health` reflects DB + Redis + gateway status; metrics exported | Health-probe test; metric-coverage test | (all, observability) | Backend |
| P0-21 | Observability | Alerting on P0 failures | Payment success rate < 95% / reconciliation mismatch | Alert rules + on-call | Alerts fire on defined thresholds; false-positive rate < 5% | Alert-trigger test; false-positive audit | (all, observability) | Backend |
| P0-22 | Audit | Audit trail integrity (immutable, complete) | Tampered audit log / missing entry | Audit model + append-only storage | Audit entries immutable; every admin/financial action audited | Tamper test; coverage test | I-07 | Backend |
| P0-23 | Governance | Kill switch fail-safe behaviour | Kill switch itself fails | Kill switch + fallback | Kill switch defaults to safe state on failure; toggles audited | Kill-switch-failure test | I-09 | Backend |
| P0-24 | Data | Transactional data integrity (cross-entity) — see detailed breakdown | Order + items + payment + availability + audit event partially commit; outbox publisher crashes after commit | DB transactions + outbox pattern | Committed business transaction eventually produces its required event with **idempotent business effect** (exactly-once in business outcome, even if physical delivery occurs more than once); no orphan entities; no partial commits | Partial-failure injection test; outbox-crash test; idempotent-replay test | I-01, I-02, I-05, I-06, I-10 | Backend |
| P0-25 | Reliability | Concurrency + duplicate-execution control — see detailed breakdown | (A) last-item inventory race; (B) state-transition race (vendor ACCEPT→CANCEL while admin CANCEL→OVERRIDE); (C) payment double-click / frontend retry | Optimistic locking + row-level locks + atomic decrements + idempotency keys | Concurrent writes serialised; no oversell; conflicts surface as retry/conflict not silent corruption; duplicate executions are deduped, not double-applied | Concurrency case A (last-item); case B (state-transition); case C (payment duplicate); optimistic-lock conflict test | I-02, I-04, I-05, I-10 | Backend |
| P0-26 | Data | Disaster recovery (business recovery, not just DB restore) — see detailed breakdown | DB corruption / regional failure / restore leaves payments-in-gateway inconsistent with restored DB | Backup + restore drill + post-restore reconciliation + documented runbook | RPO ≤ 24h, RTO ≤ 4h; restore drill passes monthly; **post-restore business-state reconciliation**: gateway payments re-synced to restored DB (captured-but-DB-pending → reconciled or refunded); audit log re-verified; **NO-GO if any money state unresolved post-restore** | Restore-drill test; corruption-detection test; post-restore reconciliation test; runbook walkthrough | I-01, I-02, I-06, I-07, I-10 | Backend |
| P0-27 | Reliability | Deployment & rollback (3 classes) — see detailed breakdown | Bad release / migration incompatibility / failed deploy / DB rollback unsafe | CI/CD + health-checked deploy + feature flags + 3 deployment classes | Application rollback ≤ 10 min for backward-compatible deploys; **expand-migrate-contract** for schema changes (no breaking migration without contract phase); breaking deploys gated + flagged; failed deploy auto-aborts; **DB rollback never assumed safe — contract migrations preserve old-version compatibility** | Rollback drill test (per class); expand-migrate-contract test; migration-compatibility test; failed-deploy-abort test | (all, foundational) | Backend |
| P0-28 | Admin | Unknown-exception handling (3 blast-radius levels) — see detailed breakdown | System reaches a state not in known state machine | Invariant checker + 3-level blast-radius freeze + exception queue + alert | Unknown state triggers the **smallest sufficient** freeze level (transaction / entity / system kill switch), preserves evidence, creates exception queue entry, alerts; never silently ignored; never over-freezes (one malformed order does not stop the platform) | Unknown-state injection at each blast-radius level; freeze-precision test; over-freeze-prevention test | I-01..I-12 (all) | Backend |

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

### P0-7 · Order State Machine Hardening

1. **Happy Path:** Valid transitions only (CONFIRMED → PREPARING → ALMOST_READY → READY → PICKED_UP).
2. **Failure Path:** Invalid transition → 409; concurrent update → optimistic lock rejects; retry.
3. **Recovery Path:** Manual override via admin with audit.
4. **Money / Trust Impact:** **High.** Wrong state = wrong fulfilment = vendor/consumer confusion.
5. **Observability:** Transition log; alert on invalid-transition attempts.

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

**Rule:** Any code change that could weaken an invariant requires matrix-governance sign-off (see Section 15).

---

## 10. External Dependency Failure Matrix

Every external dependency has an explicit failure strategy. **Fail-open** = degrade but continue serving requests. **Fail-closed** = reject the request (safer for money/auth). **Retry** = transient backoff. **Queue** = persist and process later. **User message** = what the user sees. The `Affected P0` column links each dependency failure to the capabilities it can compromise.

| Dependency | Failure Mode | Strategy | User Message | Alert? | Affected P0 |
|------------|--------------|----------|--------------|--------|-------------|
| **Razorpay (order create)** | Timeout / 5xx | Retry ×3 with backoff; then fail-closed | "Payment service busy. Please retry." | Yes, on sustained failure | P0-01, P0-03 |
| **Razorpay (capture/verify)** | Signature mismatch | Fail-closed; do not capture | "Payment could not be verified. No charge made." | Yes | P0-01, P0-05, I-01, I-04 |
| **Razorpay (refund)** | Gateway down | Queue refund; retry with backoff; REFUND_REQUESTED persists | "Refund is processing. You'll be notified." | Yes, if stuck > 1h | P0-04, P0-03 |
| **Razorpay (webhook)** | Duplicate | Idempotent dedup; 200 OK | N/A (no user) | No (expected) | P0-05, I-04 |
| **Razorpay (webhook)** | Tampered signature | 400 reject | N/A | Yes | P0-05, P0-28, I-01 |
| **Firebase (phone OTP)** | Unavailable / config error | Fail-open to demo OTP (preview only); **production: fail-closed** | "Authentication unavailable. Please retry." | Yes | P0-09, P0-11 |
| **Firebase (Admin token verify)** | Unreachable | Fail-closed; reject session mint | "Could not verify identity. Please re-login." | Yes | P0-09, P0-10, I-12 |
| **FCM (push)** | Token stale / delivery fail | Token refresh; retry; email fallback | (Consumer sees email if push fails) | No, on single fail; Yes on rate spike | (P1 notification — degraded, not P0) |
| **Email provider** | Bounce / throttle | Retry ×3; quarantine bad addresses | (User sees nothing; alt channel used) | Yes on bounce-rate spike | (P1 notification — degraded, not P0) |
| **Maps / location** | Unavailable | Fail-open; ranking without distance | "Showing nearby restaurants" (degraded ranking) | No | (P1 discovery — degraded, not P0) |
| **Database** | Degraded / unavailable 30s | Fail-closed on writes; read-replica for reads if available | "Service temporarily unavailable. Please retry." | Yes immediately | P0-24, P0-25, P0-26, I-01..I-10 (all data P0s) |
| **Redis** | Unavailable | Auth/payment/admin-write: fail-closed (503); general API: fail-open (in-memory limiter) | "Service busy. Please retry." for fail-closed paths | Yes | P0-13, P0-10 (sessions) |
| **WebSocket (socket.io)** | Disconnected | Client auto-reconnect + missed-event backfill from event log | "Reconnecting…" indicator; no silent gap | Yes if > N clients disconnected | (P1 realtime — degraded, not P0) |
| **SMS gateway (if separate from Firebase)** | Down | Queue pickup-OTP; consumer sees in-app OTP as fallback | In-app OTP visible | Yes | (P1 notification — degraded, not P0) |
| **Outbox publisher (internal worker)** | Crashes / stalled | Event row already committed; publisher restarts and re-publishes; consumers idempotent | N/A | Yes, on lag > threshold | P0-24 |
| **CI/CD pipeline** | Deploy fails mid-way | Auto-abort; traffic stays on previous version | N/A | Yes | P0-27 |

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

**The three rules that make this real:**

1. **"Code merged" ≠ "Production-ready."** A merged capability at `Implemented` cannot be a dependency for another capability's `Production-ready` claim.
2. **No capability reaches `Production-ready` without passing `Failure-tested` AND `Reviewed` AND `Approved`.** Happy-path-only capabilities block launch. Automated tests are necessary but not sufficient — a human must accept the risk.
3. **`Approved` is a business decision, not a technical one.** It records that a business owner understands the failure modes, the residual risk, and the recovery procedure — and accepts launching with them.

**Launch gate (see Section 14 for full conditions):** SnakZap launches only when **every P0 capability is at `Production-ready`** AND all launch-gate AND-conditions hold.

---

## 12. Cross-Cutting Concerns

These apply horizontally across priorities and domains. Each must be defined before its dependent capabilities can be marked ready.

| Concern | Definition | Applies To |
|---------|------------|------------|
| **Money flow closed loop** | Consumer → escrow/hold → vendor payout − commission − gateway fee − refund = platform margin. The loop must close on every order. | All P0 payment capabilities |
| **Event-driven notification** | One domain event (e.g. `ORDER_CONFIRMED`) triggers all consumers (push, email, vendor dashboard, analytics). No direct coupling. | All P1 notification capabilities |
| **Idempotency everywhere** | Every state-changing write accepts an idempotency key; retries are safe. | All P0 + P1 writes |
| **Failure isolation** | A failure in one domain (e.g. notifications) must not block another (e.g. payment). | All domains |
| **Privacy by design** | Vendor/admin sees aggregated or role-scoped data only; no raw PII export without audit. | Vendor + admin capabilities |
| **Audit everything financial** | Every money-moving action is in an immutable audit trail linked to the ledger. | All P0 payment + refund capabilities |
| **Graceful degradation** | Non-critical features degrade visibly, not silently. | All P1+ |

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

### 14.1 P0 Launch Gate — 6 AND-conditions (PRODUCTION GO / NO-GO)

SnakZap launches **only when ALL six conditions hold simultaneously.** Any single failure ⇒ NO-GO.

| # | Condition | Evidence |
|---|-----------|----------|
| 1 | **All P0 capabilities at `Production-ready`** (lifecycle state 9) | Capability lifecycle tracker — every P0 row green |
| 2 | **All P0 invariants verified** (I-01..I-12) | Invariant-checker test suite green; no unresolved violations |
| 3 | **All critical external-dependency scenarios tested** | Dependency matrix (Section 10) — every row with a P0 `Affected P0` link has been failure-injected |
| 4 | **DR drill passed** (including post-restore business-state reconciliation) | P0-26 restore-drill report; no unresolved money state |
| 5 | **Rollback drill passed** (per deployment class) | P0-27 rollback-drill report; Class 1 ≤ 10 min verified |
| 6 | **No unresolved P0 exception** in the exception queue | Exception queue empty of P0-class entries; any open entries have an accepted-risk record |

**Verdict:** Conditions 1–6 all green ⇒ **PRODUCTION GO.** Any red ⇒ **NO-GO**, no exceptions, no "we'll fix it post-launch" for P0.

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
| Parallel lists (caps, invariants, deps, tests) | Traceability map links them first-class (Section 18) |
| "All tests green = launch" | 6 AND-condition launch gate (caps + invariants + dep tests + DR drill + rollback drill + zero P0 exceptions) |

This matrix is the gate. SnakZap launches only when **all 6 launch-gate AND-conditions (Section 14.1) are green** — not before, not with exceptions.

---

## 17. Next Step (after sign-off)

Once v1.2 is signed off, the next artifacts follow a strict chain — **no implementation, no sprints, until each link is reviewed.**

```
v1.2 Matrix (this document)
        ↓  [sign-off]
P0 Traceability & Invariant Map (Section 18, foundation laid in this version)
        ↓  [review]
P0 Dependency Graph (technical + business/feature dependencies)
        ↓  [review]
Critical Path to Launch
        ↓  [review]
Implementation Order
        ↓  [review]
Sprint Plan
        ↓
Implementation begins
```

The **P0 Traceability & Invariant Map** (Section 18) is the immediate next artifact because the matrix currently lists capabilities, invariants, dependencies, and tests as parallel lists — without explicit links between them, a dependency graph would be built on assumptions. The traceability map makes those links first-class.

The **P0 Dependency Graph** then builds on the traceability map to define:
- Which P0 capability must be built first (no dependents).
- What each P0 capability requires its dependencies to be at (which lifecycle state).
- Which capabilities unlock once a given capability reaches `Production-ready`.
- The critical path to launch.
- **Business/feature dependencies preserved** (e.g. prepaid + quick reorder, POS + settlement, live-kitchen + push notifications — interactions called out in the Strategic Blueprint), not just technical dependencies.

Only after the Dependency Graph + Critical Path are reviewed does sprint breakdown begin.

---

## 18. P0 Traceability & Invariant Map (v1.2 foundation)

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

**Coverage rule:** Any invariant with zero protectors is a matrix defect. Any P0 capability protecting no invariant is either foundational (Zod, migrations, observability — which protect *all* invariants indirectly) or a candidate for demotion.

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

### 18.5 Status of this section in v1.2

v1.2 lays the **foundation** for the traceability map:
- ✅ Invariant IDs (I-01..I-12) stable.
- ✅ `Protects` column on every P0 capability (Section 7.1).
- ✅ `Affected P0` column on every dependency row (Section 10).
- ✅ Coverage tables (18.2, 18.3) populated.

The **full** traceability map (every test → every invariant → every capability → every dependency, with lifecycle state per capability) is the next artifact after v1.2 sign-off. It will live as a separate document referenced by this matrix, because its size warrants it.

---

*End of SnakZap Production Readiness Matrix v1.2.*
