# P0 Traceability & Invariant Map

> **Artifact 1** of the SnakZap production-readiness chain.
> **Source of truth:** Production Readiness Matrix v1.3 (`PRODUCTION_READINESS_MATRIX.md`).
> **Purpose:** Mechanically map every P0 capability to its invariants, failure scenarios, recovery, tests, dependencies, observability, approver, evidence, lifecycle state, and Strategic Blueprint linkage — then run the 8 coverage queries (A–H) honestly. Any gap is recorded as FAIL, not silently filled.
> **Status:** Draft — coverage check in progress.
> **Rule:** No new capabilities or invariants are introduced here. v1.3 is the source of truth. Gaps discovered during mapping are recorded, classified, and routed to a v1.4 decision — not patched inline.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Artifact | 1 of 5 (Traceability Map → Dependency Graph → Critical Path → Implementation Order → Sprint Plan) |
| Source | PRODUCTION_READINESS_MATRIX.md v1.3 |
| Date | 2026-08-09 |
| Status | Coverage check in progress |
| P0 capabilities mapped | 28 (P0-01..P0-28) |
| Invariants mapped | 14 (I-01..I-14) |
| External dependencies mapped | 16 |
| Approver | TBD (see Coverage G) |

---

## 1. The Traceability Table

One row per P0 capability. Columns per Section 18.5 of the matrix.

**Legend for lifecycle state:** `S2` = Specified (5 questions answered; nothing implemented). All P0s are at S2 as of this draft — no code exists yet.

**Legend for Protects:** `(foundational)` = cross-cutting capability that protects all invariants indirectly (no specific I-xx mapping — see Coverage A caveat). `(observability)` = same, for the observability substrate. Specific I-xx = direct protector.

| ID | Capability | Protects (Invariants) | Failure Scenario | Recovery | Test | Dependency | Observable Signal | Approver | Test Evidence | Lifecycle | Blueprint Feature(s) |
|----|------------|----------------------|------------------|----------|------|------------|-------------------|----------|---------------|-----------|---------------------|
| P0-01 | Razorpay order create + verify + capture | I-01, I-04 | Gateway timeout / signature mismatch / double Pay click | Reject on signature mismatch; retry on timeout; idempotency key dedupes double-click; reconciliation catches capture/DB drift | Idempotency test; signature-tamper test; double-submit test | Razorpay SDK, Payment model | Payment success rate metric; capture/reject log | TBD | TBD (not implemented) | S2 | TBD — requires Blueprint cross-ref (likely O04 Pre-paid) |
| P0-02 | Payment ledger (double-entry) | I-06, I-10 | Ledger write fails after capture | Reconciliation job detects missing entries; auto-creates from gateway record; audit logged | Ledger integrity test; partial-failure test | Payment model, DB txn | Ledger integrity check hourly; imbalance alert | TBD | TBD | S2 | TBD — likely V11 Settlement |
| P0-03 | Payment reconciliation (gateway ↔ ledger) | I-01, I-06 | Gateway says captured, DB says failed | Re-run job; manual reconciliation for edge cases | Reconciliation job test; mismatch injection test | Payment + scheduled job | Reconciliation report; mismatch count alert | TBD | TBD | S2 | TBD — likely V11 Settlement |
| P0-04 | Refund flow (full + partial) | I-03, I-06, I-11 | Refund requested but gateway down / partial mismatch | Queue refund; retry with backoff; manual refund via admin with audit | Refund lifecycle test; partial-refund test; refund-during-outage test | Payment + Razorpay refund API | Refund SLA metric; alert on REFUND_REQUESTED > 1h | TBD | TBD | S2 | TBD — likely refund/cancellation policy feature |
| P0-05 | Webhook integrity (HMAC + idempotent) | I-01, I-04 | Duplicate webhook / tampered signature / out-of-order | Dedup on duplicate; 400 on tampered; reorder by timestamp | Duplicate injection test; signature tamper test; reorder test | Payment + webhook endpoint | Webhook log; signature-failure alert | TBD | TBD | S2 | TBD — likely O04 Pre-paid (webhook closure) |
| P0-06 | Order state separation (Order/Payment/Fulfilment/Refund) | I-01, I-02, I-08 | Order cancelled but payment captured | Inconsistent combo → exception queue; auto-refund triggered | State-transition matrix test; inconsistent-state detection test | Order + Payment + Fulfilment + Refund models | Invariant checker hourly; inconsistent-combo alert | TBD | TBD | S2 | TBD — likely O08 Quick Reorder, P05 Live Kitchen |
| P0-07 | Order state machine hardening | I-02, I-08, I-13 | Invalid transition / concurrent updates / pickup without verification | Reject invalid; optimistic lock rejects loser; PICKED_UP requires QR+OTP (I-13) | Concurrency test; invalid-transition test; pickup-verification test | Order model + optimistic locking | Transition log; invalid-transition alert; pickup-verification log | TBD | TBD | S2 | TBD — likely P01 QR Pickup, P05 Live Kitchen |
| P0-08 | Idempotency on order creation | I-02, I-10 | Double submit / retry storm | Same idempotency key returns same order | Idempotency-key test; retry-storm test | Order model + idempotency key | Idempotency-key hit/miss metric | TBD | TBD | S2 | TBD — likely O08 Quick Reorder |
| P0-09 | Server-side Firebase ID token verification | I-12 | Forged client identity / expired token | Reject; client re-authenticates | Token-forgery test; expired-token test | Firebase Admin SDK + session | Auth-failure metric; alert on spike | TBD | TBD | S2 | TBD — likely auth/login features |
| P0-10 | Session integrity (refresh, revoke, active sessions) | I-12 | Stolen session token / user logs out elsewhere | Re-login; active-sessions list lets user revoke others | Session-revoke test; concurrent-session test | Session model | Session-anomaly metric (geo/IP change) | TBD | TBD | S2 | TBD — likely session/account features |
| P0-11 | OTP retry limits + phone validation | I-12 | OTP brute-force / invalid phone format | Lock expires after 10 min; user retries | Brute-force test; invalid-phone test | OTP service + rate limiter | OTP-attempt metric; brute-force alert | TBD | TBD | S2 | TBD — likely auth/login features |
| P0-12 | Zod input validation on every API | (foundational) | Malformed payload / type confusion | Client corrects; 400 with field errors | Fuzz test per route; schema-mismatch test | Zod schemas per route | Validation-failure metric per route | TBD | TBD | S2 | TBD — cross-cutting; no single Blueprint feature |
| P0-13 | Rate limiting (fail-closed for auth/payment/admin-write) | (foundational; protects P0-09..P0-11) | Redis down / abuse burst | Limiter recovers; user waits | Fail-closed test; burst test | Rate limiter (Redis or in-memory fallback) | Rate-limit-hit metric; limiter-down alert | TBD | TBD | S2 | TBD — cross-cutting |
| P0-14 | CSRF protection | (foundational; all state-changing) | Cross-site forged POST | Client refreshes token | CSRF injection test | CSRF token + SameSite cookie | CSRF-rejection metric | TBD | TBD | S2 | TBD — cross-cutting |
| P0-15 | Database migrations (not db:push) | (foundational) | Schema drift / data loss on deploy | Rollback migration; drift blocks deploy | Migration rollback test; drift detection test | Prisma migrate + review process | Drift detection CI check | TBD | TBD | S2 | TBD — cross-cutting |
| P0-16 | Backup | (foundational) | DB corruption / accidental delete | Restore from last-known-good per runbook | Backup-integrity test; corruption-detection test | Backup schedule + corruption-detection | Backup-success + checksum metric | TBD | TBD | S2 | TBD — cross-cutting |
| P0-17 | Idempotency on all critical writes | I-04, I-10 | Retry storm / partial failure | Retries return same result (by design) | Idempotency test per critical write | Idempotency key on orders, payments, refunds, status updates | Idempotency coverage test in CI | TBD | TBD | S2 | TBD — cross-cutting |
| P0-18 | Error handling (boundaries + consistent responses) | (foundational) | Unhandled exception / partial response | User retries; support has trace id | Error-injection test per route | Error boundaries + error envelope | Error-rate metric per route; alert on spike | TBD | TBD | S2 | TBD — cross-cutting |
| P0-19 | Structured logging | (observability) | Silent failure / untraceable error | In-memory buffer; retry | Log-coverage test | Logger (structured JSON) | Log-coverage test | TBD | TBD | S2 | TBD — cross-cutting |
| P0-20 | Health checks + basic metrics | (observability) | Service silently degraded | Component recovers | Health-probe test; metric-coverage test | Health endpoint + metrics export | `/health` + metrics export | TBD | TBD | S2 | TBD — cross-cutting |
| P0-21 | Alerting on P0 failures | (observability) | Payment success rate < 95% / reconciliation mismatch | Mitigation; postmortem | Alert-trigger test; false-positive audit | Alert rules + on-call | Alert audit | TBD | TBD | S2 | TBD — cross-cutting |
| P0-22 | Audit trail integrity (immutable, complete) | I-07 | Tampered audit log / missing entry | N/A (immutable by design) | Tamper test; coverage test | Audit model + append-only storage | Tamper alert; coverage test | TBD | TBD | S2 | TBD — likely compliance/governance features |
| P0-23 | Kill switch fail-safe behaviour | I-09 | Kill switch itself fails | Storage recovers; toggle verified | Kill-switch-failure test | Kill switch + fallback | Kill-switch-state metric | TBD | TBD | S2 | TBD — likely governance features |
| P0-24 | Transactional data integrity (cross-entity) | I-01, I-02, I-05, I-06, I-10 | Partial commit; outbox publisher crash after commit | Outbox retries; reconciliation catches drift; consumers idempotent | Partial-failure injection test; outbox-crash test; idempotent-replay test | DB transactions + outbox pattern | Outbox lag metric; orphan-entity alert | TBD | TBD | S2 | TBD — cross-cutting; affects all order/payment features |
| P0-25 | Concurrency + duplicate-execution control | I-02, I-04, I-05, I-10 | (A) last-item race; (B) state-transition race; (C) payment double-click | Loser retries; duplicate deduped | Concurrency case A/B/C; optimistic-lock conflict test | Optimistic locking + row locks + atomic decrements + idempotency keys | Conflict-rate metric per case; dedup-hit metric | TBD | TBD | S2 | TBD — likely O08 Quick Reorder (case C) |
| P0-26 | Disaster recovery (business recovery) | I-01, I-02, I-06, I-07, I-10 | DB corruption / restore leaves money state inconsistent | Restore + post-restore reconciliation; NO-GO if unresolved | Restore-drill test; corruption-detection test; post-restore reconciliation test; runbook walkthrough | Backup + restore drill + runbook | Backup-success; restore-drill result; post-restore mismatch count | TBD | TBD | S2 | TBD — cross-cutting |
| P0-27 | Deployment & rollback (3 classes) | (foundational) | Bad release / migration incompatibility / failed deploy | Class 1: traffic rollback ≤10min; Class 2: rollback to previous phase; Class 3: forward-fix | Rollback drill test (per class); expand-migrate-contract test; migration-compatibility test; failed-deploy-abort test | CI/CD + health-checked deploy + feature flags | Deploy-success metric; rollback-time metric; post-deploy health alert | TBD | TBD | S2 | TBD — cross-cutting |
| P0-28 | Unknown-exception handling (3 blast-radius levels) | I-01..I-14 (all) | Unknown state not in known state machine | Freeze (smallest sufficient level) + preserve evidence + exception queue + alert; human resolves | Unknown-state injection at each level; freeze-precision test; over-freeze-prevention test | Invariant checker + 3-level freeze + exception queue + alert | Unknown-state counter per level; freeze-distribution metric; exception-queue-aging metric | TBD | TBD | S2 | TBD — cross-cutting; backstops all features |

---

## 2. Invariant Coverage Table (Coverage B input)

Which P0 capabilities protect each invariant. Consolidated from the table above.

| Invariant | Name | Protected by (P0 capabilities) | Coverage |
|-----------|------|-------------------------------|----------|
| I-01 | Payment Integrity | P0-01, P0-03, P0-05, P0-06, P0-24, P0-26, P0-28 | ✅ 7 protectors |
| I-02 | Order Integrity | P0-06, P0-07, P0-08, P0-24, P0-25, P0-26, P0-28 | ✅ 7 protectors |
| I-03 | Refund Integrity | P0-04, P0-28 | ✅ 2 protectors |
| I-04 | Capture Uniqueness | P0-01, P0-05, P0-17, P0-25, P0-28 | ✅ 5 protectors |
| I-05 | Item-Order Consistency | P0-24, P0-25, P0-28 | ✅ 3 protectors |
| I-06 | Ledger Balance | P0-02, P0-03, P0-04, P0-24, P0-26, P0-28 | ✅ 6 protectors |
| I-07 | Audit Integrity | P0-22, P0-26, P0-28 | ✅ 3 protectors |
| I-08 | Fulfilment Authorization | P0-06, P0-07, P0-25, P0-28 | ✅ 4 protectors |
| I-09 | Kill-Switch Monotonicity | P0-23, P0-28 | ✅ 2 protectors |
| I-10 | Transactional Completeness | P0-02, P0-08, P0-17, P0-24, P0-25, P0-26, P0-28 | ✅ 7 protectors |
| I-11 | Refund Precondition | P0-04, P0-28 | ✅ 2 protectors |
| I-12 | Session Revocation | P0-09, P0-10, P0-11, P0-28 | ✅ 4 protectors |
| I-13 | Pickup / Handoff Integrity | P0-07, P0-28 | ✅ 2 protectors (note: thin coverage — see Gap G-B1) |
| I-14 | Vendor Operational Integrity | P0-28 only at P0 level; primary protector is **P1 busy-mode** | ⚠️ No dedicated P0 protector — see Gap G-B2 |

---

## 3. The 8 Coverage Queries — Honest Results

| Query | Requirement | Result | Detail |
|-------|-------------|--------|--------|
| **A** | Every P0 → ≥1 invariant it protects | **PARTIAL PASS** | 18 of 28 P0s map to specific invariants (I-xx). 10 P0s are `(foundational)` or `(observability)` — cross-cutting capabilities with no specific I-xx mapping (P0-12, P0-13, P0-14, P0-15, P0-16, P0-18, P0-19, P0-20, P0-21, P0-27). The matrix's coverage rule explicitly accepts this ("foundational capabilities protect all invariants indirectly"), but for strict traceability these 10 have no direct invariant link. |
| **B** | Every invariant → ≥1 P0 capability that protects it | **PARTIAL PASS** | 13 of 14 invariants have ≥1 P0 protector. I-14 (Vendor Operational Integrity) has only P0-28 (unknown-exception backstop) at the P0 level; its primary protector is the P1 busy-mode capability. This is a documented, accepted exception (matrix Section 18.2 coverage note), but it is a real asymmetry. |
| **C** | Every P0 → ≥1 failure-injection test | **STRUCTURAL PASS** | All 28 P0s have test criteria defined in v1.3 Section 7.1. However, "defined" ≠ "written" ≠ "passing" — see Coverage H. |
| **D** | Every external dependency → ≥1 failure scenario | **PASS** | 16 dependency scenarios defined in Section 10, each with strategy + user message + alert + Affected P0 + Blueprint Risk. |
| **E** | Every failure scenario → documented recovery procedure | **STRUCTURAL PASS** | Every P0's detailed breakdown (Section 8) includes a Recovery Path. Every dependency row includes a Strategy (which is the recovery). Structurally complete; not yet exercised. |
| **F** | Every P0 → ≥1 observable signal (metric/log/alert) | **STRUCTURAL PASS** | Every P0's detailed breakdown includes an Observability section. Structurally complete; not yet wired to a live metrics backend. |
| **G** | Every P0 → named approver (for `Approved` state) | **FAIL** | 0 of 28 P0s have a named approver. All are "TBD". No approvers have been assigned. This blocks every P0 from reaching lifecycle state 9 (Production-ready). |
| **H** | Every P0 → test evidence (CI run / drill report / injection log) | **FAIL** | 0 of 28 P0s have test evidence. Nothing is implemented; no tests are written or run. This blocks every P0 from advancing past lifecycle state 2 (Specified). |

### Coverage summary

| Status | Count | Queries |
|--------|-------|---------|
| ✅ PASS | 1 | D |
| 🟡 STRUCTURAL PASS (defined, not exercised) | 3 | C, E, F |
| 🟠 PARTIAL PASS (caveats) | 2 | A, B |
| ❌ FAIL | 2 | G, H |

**Formal sign-off: BLOCKED.** Queries G and H are hard FAILs. Queries A and B have documented caveats requiring a v1.4 decision. Queries C, E, F are structurally complete but cannot be exercised until implementation begins — which is gated on this map passing, which is gated on G and H.

This is the honest deadlock: the map cannot fully pass until implementation begins, and implementation cannot begin until the map passes. **The resolution is to split the gate** (see Section 5).

---

## 4. Uncovered Items

### 4.1 Gaps from Coverage A (P0 → invariant)

**G-A1: 10 foundational P0s have no specific invariant mapping.**
- Affected: P0-12 (Zod), P0-13 (Rate limiting), P0-14 (CSRF), P0-15 (Migrations), P0-16 (Backup), P0-18 (Error handling), P0-19 (Logging), P0-20 (Health/metrics), P0-21 (Alerting), P0-27 (Deployment).
- Classification: **Accepted exception, but traceability-weak.** These are cross-cutting; they protect all invariants indirectly. The matrix's coverage rule acknowledges this. However, for the Traceability Map to be fully rigorous, each should state *which* invariants it indirectly protects (e.g. P0-12 Zod protects I-05 by validating restaurantId consistency; P0-15 Migrations protects I-10 by preventing schema-induced orphan entities).
- Action: **v1.4 candidate** — add indirect-protector annotations to the 10 foundational P0s. Not a blocking gap; a rigor gap.

### 4.2 Gaps from Coverage B (invariant → P0)

**G-B1: I-13 (Pickup/Handoff Integrity) has thin P0 coverage — only P0-07 and P0-28.**
- P0-07 enforces pickup verification at the state-machine gate (PICKED_UP requires QR+OTP). P0-28 is the unknown-exception backstop.
- There is no dedicated P0 capability for *pickup audit attribution* (the "pickup event links order_id + collector identity + timestamp" enforcement in I-13's definition). P0-07 handles the gate; P0-22 (audit integrity) handles audit append-only — but neither explicitly owns pickup-event attribution.
- Classification: **Potential matrix defect.** Either (a) P0-07's acceptance criteria must be expanded to explicitly include pickup-event attribution, or (b) a new P0 capability is needed. Per the discipline rule (no new capabilities here), this is recorded for v1.4 decision.
- Action: **v1.4 candidate** — decide whether P0-07 scope expands or a new P0-29 (Pickup Audit Attribution) is created.

**G-B2: I-14 (Vendor Operational Integrity) has no dedicated P0 protector.**
- Primary protector is P1 busy-mode. P0-28 is the only P0 backstop (via unknown-exception).
- The matrix explicitly accepts this: "vendor overload degrades but does not immediately corrupt money/order state."
- Classification: **Accepted exception.** I-14 is a risk amplifier for I-02, not a direct money/order integrity law. P1 protection is proportionate.
- Action: **No change needed.** Document the accepted exception in v1.4 for traceability completeness; do not promote busy-mode to P0.

### 4.3 Gaps from Coverage G (approver)

**G-G1: 0 of 28 P0s have a named approver.**
- All 28 are "TBD".
- Classification: **Expected-empty-pending-implementation, but blocking.** Approvers cannot be named until capabilities are owned by specific engineers/owners, which happens during sprint planning (Artifact 5). However, the separation-of-duties rule (Section 11 rule 4) requires the approver to be a business/operations owner, not the developer — so approver assignment is a governance decision, not an engineering one.
- Action: **Assign approvers before implementation begins.** This is a prerequisite for Artifact 5 (Sprint Plan), not for Artifact 2 (Dependency Graph).

### 4.4 Gaps from Coverage H (test evidence)

**G-H1: 0 of 28 P0s have test evidence.**
- Nothing is implemented; no tests written or run.
- Classification: **Expected-empty-pending-implementation, blocking.** Test evidence is produced during and after implementation. It cannot exist before code is written.
- Action: **Resolved only by implementation.** The gate must distinguish "matrix complete" (this map passes structurally) from "system production-ready" (G + H pass after implementation).

### 4.5 Gaps from Strategic Blueprint feature mapping

**G-F1: Blueprint feature mapping is INCOMPLETE — only seed rows populated.**
- Section 18.6 of the matrix provides a seed table (O04 Pre-paid, O08 Quick Reorder, P01 QR Pickup, P05 Live Kitchen, V11 Settlement). The full 102-feature Strategic Blueprint was not available inline during this mapping.
- Classification: **Incomplete cross-reference.** The mapping requires reading the Strategic Blueprint document (102 features + ICE prioritization + feature interactions).
- Action: **Populate the full feature mapping** by cross-referencing the Strategic Blueprint. This is a prerequisite for Artifact 2 (Dependency Graph), which must preserve feature interactions.

---

## 5. Gap Classification & Resolution

| Gap ID | Query | Type | Blocking? | Resolution |
|--------|-------|------|-----------|------------|
| G-A1 | A | Rigor gap (accepted exception, traceability-weak) | No | v1.4: add indirect-protector annotations to 10 foundational P0s |
| G-B1 | B | Potential matrix defect (I-13 thin coverage) | **Yes — needs v1.4 decision** | v1.4: decide P0-07 scope expansion vs new P0-29 |
| G-B2 | B | Accepted exception (I-14 P1-protected) | No | v1.4: document exception for traceability completeness |
| G-G1 | G | Expected-empty-pending-implementation | Yes (for Production-ready, not for matrix completion) | Assign approvers during Artifact 5 (Sprint Plan) |
| G-H1 | H | Expected-empty-pending-implementation | Yes (for Production-ready, not for matrix completion) | Resolved only by implementation |
| G-F1 | Feature | Incomplete cross-reference | Yes (for Artifact 2) | Populate full mapping from Strategic Blueprint before Artifact 2 |

### 5.1 The gate-split resolution

The map reveals an honest deadlock: G and H cannot pass until implementation, but implementation is gated on the map passing. The resolution is to **split the gate**:

- **Gate 1 — Matrix Completion (this artifact):** Queries A–F must pass (with v1.4 resolving G-A1, G-B1, G-B2). G and H are acknowledged as "expected-empty, pending implementation" and do NOT block matrix sign-off. **This gate blocks Artifact 2 (Dependency Graph).**
- **Gate 2 — Production Readiness (per capability, during implementation):** Each P0 capability must reach lifecycle state 9 (Production-ready), which requires G (approver named) and H (test evidence) for *that capability*. **This gate blocks launch, not Artifact 2.**

This split is honest: the matrix can be structurally complete (Gate 1) without any capability being production-ready (Gate 2). Implementation proceeds capability-by-capability through Gate 2.

---

## 6. v1.4 Changes Required (minimal, only if necessary)

Based on the gaps above, v1.4 of the matrix should address exactly two items:

1. **G-B1 (I-13 coverage):** Decide whether P0-07's acceptance criteria expand to explicitly include pickup-event attribution, OR a new P0-29 (Pickup Audit Attribution) is created. This is the only potential matrix defect discovered.
2. **G-A1 (foundational P0 indirect-protector annotations):** Add a sentence to each of the 10 foundational P0s stating which invariants they indirectly protect, for traceability rigor.

**G-B2** is an accepted exception — documented, not changed. **G-G1, G-H1, G-F1** are not matrix defects; they are pending-implementation or pending-cross-reference items.

No other changes. The discipline holds: no new capabilities or invariants are invented during mapping.

---

## 7. Sign-off Status

| Gate | Status | Blocker |
|------|--------|---------|
| Matrix structural completeness (Queries A–F) | 🟡 Pending v1.4 (G-B1 decision) | G-B1: I-13 coverage decision |
| Matrix formal sign-off | ⏳ After v1.4 | G-B1 resolution |
| Artifact 2 (Dependency Graph) | ⏳ After matrix sign-off + G-F1 (Blueprint feature mapping populated) | Both above |
| Implementation (Gate 2 per capability) | ⏳ After Artifact 5 (Sprint Plan) | All prior artifacts + approver assignment (G-G1) |

---

## 8. Next Actions

1. **Decision needed (stakeholder):** G-B1 — expand P0-07 scope, or create P0-29? This is the single substantive question.
2. **v1.4 draft:** Apply G-B1 decision + G-A1 annotations. No other changes.
3. **Blueprint cross-reference:** Populate full feature mapping (G-F1) using the Strategic Blueprint document.
4. **Then Artifact 2:** P0 Dependency Graph, built on the v1.4 map + full feature mapping.

---

*End of P0 Traceability & Invariant Map (Artifact 1).*
