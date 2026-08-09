# SnakZap Production Readiness Matrix v1.0

> **Document Type:** Specification & Decision Document
> **Status:** Draft v1.0 — pending sign-off
> **NOT an implementation plan.** This document defines *what* must be true before SnakZap can serve a real paying customer, *how* each capability must behave under failure, and *how* we will know it is ready. Implementation order, code, and sprints are derived from this — not the other way around.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-08-09 |
| Status | Draft — awaiting review |
| Baseline | Uploaded audit (`zheo-main.zip` rebuild) + self-audit + stakeholder feedback |
| Authors | Engineering + Product |
| Reviewers | (pending) |
| Supersedes | Ad-hoc feature checklist audit |
| Next review | After P0 sign-off; before any P1 implementation begins |

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

---

## 7. The Matrix

Columns: **Priority | Domain | Capability | Failure Scenario | Dependency | Acceptance Criteria | Test Criteria | Owner**

### 7.1 P0 — Cannot Launch Without It

| Priority | Domain | Capability | Failure Scenario | Dependency | Acceptance Criteria | Test Criteria | Owner |
|----------|--------|------------|------------------|------------|---------------------|---------------|-------|
| P0 | Payment | Razorpay order create + verify + capture | Gateway timeout / signature mismatch / double Pay click | Razorpay SDK, Payment model | Every payment has a verifiable captured state; no payment captured without verified signature | Idempotency test; signature-tamper test; double-submit test | Backend |
| P0 | Payment | Payment ledger (double-entry) | Ledger write fails after capture | Payment model, DB txn | Every captured payment has matching ledger entries; ledger is append-only | Ledger integrity test; partial-failure test | Backend |
| P0 | Payment | Payment reconciliation (gateway ↔ ledger) | Gateway says captured, DB says failed | Payment + scheduled job | Daily reconciliation report; mismatches surface in exception queue within 1 hour | Reconciliation job test; mismatch injection test | Backend |
| P0 | Payment | Refund flow (full + partial) | Refund requested but gateway down / partial refund mismatch | Payment + Razorpay refund API | Refund has its own status lifecycle; partial refunds tracked; ledger updated atomically | Refund lifecycle test; partial-refund test; refund-during-outage test | Backend |
| P0 | Payment | Webhook integrity (HMAC + idempotent) | Duplicate webhook / tampered signature / out-of-order | Payment + webhook endpoint | Duplicate webhooks deduped; tampered rejected; out-of-order handled | Duplicate injection test; signature tamper test; reorder test | Backend |
| P0 | Order | State separation (Order / Payment / Fulfilment / Refund) | Order cancelled but payment captured | Order + Payment + Fulfilment + Refund models | Each dimension evolves independently; inconsistent combos surfaced in exception queue | State-transition matrix test; inconsistent-state detection test | Backend |
| P0 | Order | Order state machine hardening | Invalid transition attempted / concurrent updates | Order model + optimistic locking | Invalid transitions rejected; concurrent updates serialised | Concurrency test; invalid-transition test | Backend |
| P0 | Order | Idempotency on order creation | Double submit / retry storm | Order model + idempotency key | Same idempotency key returns same order; no duplicate orders created | Idempotency-key test; retry-storm test | Backend |
| P0 | Auth | Server-side Firebase ID token verification | Forged client identity / expired token | Firebase Admin SDK + session | Server rejects unverified identity; sessions bound to verified phone | Token-forgery test; expired-token test | Backend |
| P0 | Auth | Session integrity (refresh, revoke, active sessions) | Stolen session token / user logs out elsewhere | Session model | Sessions expireable, revocable; active-sessions list available | Session-revoke test; concurrent-session test | Backend |
| P0 | Auth | OTP retry limits + phone validation | OTP brute-force / invalid phone format | OTP service + rate limiter | Max 5 OTP attempts / 3 sends per 10 min; phone E.164 validated | Brute-force test; invalid-phone test | Backend |
| P0 | Security | Zod input validation on every API | Malformed payload / type confusion | Zod schemas per route | No API accepts unvalidated input; 400 on schema mismatch | Fuzz test per route; schema-mismatch test | Backend |
| P0 | Security | Rate limiting (fail-closed for auth/payment/admin-write) | Redis down / abuse burst | Rate limiter (Redis or in-memory fallback) | Auth/payment/admin-write return 503 when limiter unavailable; general API fail-open | Fail-closed test; burst test | Backend |
| P0 | Security | CSRF protection | Cross-site forged POST | CSRF token + SameSite cookie | State-changing POSTs require valid CSRF token | CSRF injection test | Backend |
| P0 | Data | Database migrations (not `db:push`) | Schema drift / data loss on deploy | Prisma migrate + review process | Every schema change ships as reviewed migration; no data-destructive push | Migration rollback test; drift detection test | Backend |
| P0 | Data | Backup + recovery | DB corruption / accidental delete | Backup schedule + restore drill | Daily backups; restore drill passes monthly; RPO ≤ 24h, RTO ≤ 4h | Restore drill test; backup integrity test | Backend |
| P0 | Reliability | Idempotency on all critical writes | Retry storm / partial failure | Idempotency key on orders, payments, refunds, status updates | All critical writes idempotent; retries return same result | Idempotency test per critical write | Backend |
| P0 | Reliability | Error handling (boundaries + consistent responses) | Unhandled exception / partial response | Error boundaries + error envelope | Every API returns consistent error envelope; UI shows actionable errors | Error-injection test per route | Full-stack |
| P0 | Observability | Structured logging | Silent failure / untraceable error | Logger (structured JSON) | Every critical path logs structured event with trace id | Log-coverage test | Backend |
| P0 | Observability | Health checks + basic metrics | Service silently degraded | Health endpoint + metrics export | `/health` reflects DB + Redis + gateway status; metrics exported | Health-probe test; metric-coverage test | Backend |
| P0 | Observability | Alerting on P0 failures | Payment success rate < 95% / reconciliation mismatch | Alert rules + on-call | Alerts fire on defined thresholds; false-positive rate < 5% | Alert-trigger test; false-positive audit | Backend |
| P0 | Audit | Audit trail integrity (immutable, complete) | Tampered audit log / missing entry | Audit model + append-only storage | Audit entries immutable; every admin/financial action audited | Tamper test; coverage test | Backend |
| P0 | Governance | Kill switch fail-safe behaviour | Kill switch itself fails | Kill switch + fallback | Kill switch defaults to safe state on failure; toggles audited | Kill-switch-failure test | Backend |

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

## 9. Cross-Cutting Concerns

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

## 10. Decision Log / Open Questions

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

---

## 11. Acceptance — When Is the Matrix "Done"?

The matrix itself is "done" (ready to drive implementation) when:

1. Every P0 capability has all 5 questions answered. ✅ (this v1.0)
2. Every P1 capability has all 5 questions answered. ✅ (this v1.0, condensed)
3. Actor's worst-day scenarios traced through capabilities. ✅ (this v1.0)
4. Open questions logged with defaults. ✅ (this v1.0)
5. Stakeholder sign-off on P0 scope. ⏳ (pending)
6. P2/P3 inventory acknowledged as out-of-scope for v1 launch. ✅ (this v1.0)

**A capability is "ready for production" (separate from the matrix being done) when:**

- All 5 questions answered. ✅
- Test criteria written and passing. ⏳
- Failure path verified by injection. ⏳
- Observability verified live. ⏳
- Reviewed by a second engineer. ⏳

---

## 12. Governance

- **Change control:** Any change to a P0 capability's acceptance criteria requires sign-off.
- **Promotion rule:** A capability can be promoted to P0/P1 only when its failure + recovery is defined (the entry rule).
- **Demotion rule:** A P0 capability found to have undefined failure semantics is demoted to "blocked" until resolved.
- **Review cadence:** Matrix reviewed at every P0 milestone; not ad-hoc.
- **No implementation without matrix entry:** No code is written for a capability until it has a row in this matrix.

---

## 13. Summary — The Shift This Document Represents

| From (audit) | To (matrix) |
|---------------|-------------|
| "What features are missing?" | "Where will it break, and what happens when it does?" |
| Feature checklist | Capability + failure + recovery + observability |
| Priority by gut | Priority by money/trust impact + entry rule |
| Demo readiness | Production readiness |
| "Is it built?" | "Does it survive contact with reality?" |

This matrix is the gate. SnakZap launches when every P0 capability passes its test criteria — not before.

---

*End of SnakZap Production Readiness Matrix v1.0.*
