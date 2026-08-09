# P0 Traceability & Invariant Map

> **Artifact 1** of the SnakZap production-readiness chain.
> **Source of truth:** Production Readiness Matrix v1.4 (`PRODUCTION_READINESS_MATRIX.md`).
> **Purpose:** Mechanically map every P0 capability to its invariants, failure scenarios, recovery, tests, dependencies, observability, approver, evidence, lifecycle state, and Strategic Blueprint linkage — then run the 8 coverage queries (A–H) honestly. Any gap is recorded as FAIL, not silently filled.
> **Status:** v1.4 re-run — G-B1 resolved; Query A reinterpreted via Direct/Control classification.
> **Rule:** No new capabilities or invariants are introduced here. v1.4 is the source of truth.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Artifact | 1 of 5 (Traceability Map → Dependency Graph → Critical Path → Implementation Order → Sprint Plan) |
| Source | PRODUCTION_READINESS_MATRIX.md v1.4 |
| Date | 2026-08-09 |
| Status | v1.4 re-run complete |
| P0 capabilities mapped | 28 (P0-01..P0-28) — unchanged |
| Invariants mapped | 14 (I-01..I-14) — unchanged |
| External dependencies mapped | 16 |
| Approver | TBD (see Coverage G) |

---

## 1. The Traceability Table

One row per P0 capability. Columns per Section 18.5 of the matrix.

**Legend for lifecycle state:** `S2` = Specified (5 questions answered; nothing implemented). All P0s are at S2 as of this draft — no code exists yet.

**Legend for Protects (v1.4):**
- Specific I-xx = **Direct Protector** (enforces that invariant).
- `(Control/Enabler)` = capability that detects/enables/preserves but does not enforce a specific business truth. Legitimately has no direct invariant mapping per Architectural Law 6.

| ID | Capability | Type | Protects (Invariants) | Failure Scenario | Recovery | Test | Dependency | Observable Signal | Approver | Test Evidence | Lifecycle | Blueprint Feature(s) |
|----|------------|------|----------------------|------------------|----------|------|------------|-------------------|----------|---------------|-----------|---------------------|
| P0-01 | Razorpay order create + verify + capture | Direct Protector | I-01, I-04 | Gateway timeout / signature mismatch / double Pay click | Reject on mismatch; retry on timeout; idempotency dedup; reconciliation catches drift | Idempotency test; signature-tamper test; double-submit test | Razorpay SDK, Payment model | Payment success rate; capture/reject log | TBD | TBD | S2 | TBD — likely O04 Pre-paid |
| P0-02 | Payment ledger (double-entry) | Direct Protector | I-06, I-10 | Ledger write fails after capture | Reconciliation auto-creates; audit logged | Ledger integrity test; partial-failure test | Payment model, DB txn | Ledger integrity check hourly; imbalance alert | TBD | TBD | S2 | TBD — likely V11 Settlement |
| P0-03 | Payment reconciliation (gateway ↔ ledger) | Direct Protector | I-01, I-06 | Gateway captured, DB failed | Re-run; manual for edge cases | Reconciliation job test; mismatch injection test | Payment + scheduled job | Reconciliation report; mismatch alert | TBD | TBD | S2 | TBD — likely V11 Settlement |
| P0-04 | Refund flow (full + partial) | Direct Protector | I-03, I-06, I-11 | Gateway down / partial mismatch | Queue; retry; manual via admin with audit | Refund lifecycle test; partial-refund test; refund-during-outage test | Payment + Razorpay refund API | Refund SLA metric; alert >1h | TBD | TBD | S2 | TBD — refund policy feature |
| P0-05 | Webhook integrity (HMAC + idempotent) | Direct Protector | I-01, I-04 | Duplicate / tampered / out-of-order | Dedup; 400 on tampered; reorder | Duplicate injection; signature tamper; reorder test | Payment + webhook endpoint | Webhook log; signature-failure alert | TBD | TBD | S2 | TBD — likely O04 Pre-paid |
| P0-06 | Order state separation (Order/Payment/Fulfilment/Refund) | Direct Protector | I-01, I-02, I-08 | Order cancelled but payment captured | Inconsistent combo → exception queue; auto-refund | State-transition matrix test; inconsistent-state detection test | Order + Payment + Fulfilment + Refund models | Invariant checker hourly; inconsistent-combo alert | TBD | TBD | S2 | TBD — likely O08, P05 |
| P0-07 | Order state machine hardening (v1.4 — pickup attribution expanded) | Direct Protector | I-02, I-08, **I-13 (fully owned)** | Invalid transition / concurrent updates / pickup verification failure (any of 8 conditions) | Manual override (state conflicts); exception queue Level 1 freeze (attribution failures) | Concurrency test; invalid-transition test; **pickup-verification: correct collector, wrong collector, QR/OTP failure, duplicate pickup, attribution/audit persistence** | Order model + optimistic locking | Transition log; pickup-verification log; attribution-failure-rate alert; P0-22 audit linkage | TBD | TBD | S2 | TBD — likely P01 QR Pickup, P05 Live Kitchen |
| P0-08 | Idempotency on order creation | Direct Protector | I-02, I-10 | Double submit / retry storm | Same key returns same order | Idempotency-key test; retry-storm test | Order model + idempotency key | Idempotency-key hit/miss metric | TBD | TBD | S2 | TBD — likely O08 Quick Reorder |
| P0-09 | Server-side Firebase ID token verification | Direct Protector | I-12 | Forged identity / expired token | Reject; client re-authenticates | Token-forgery test; expired-token test | Firebase Admin SDK + session | Auth-failure metric; alert on spike | TBD | TBD | S2 | TBD — auth/login features |
| P0-10 | Session integrity (refresh, revoke, active sessions) | Direct Protector | I-12 | Stolen token / logout elsewhere | Re-login; revoke others | Session-revoke test; concurrent-session test | Session model | Session-anomaly metric (geo/IP) | TBD | TBD | S2 | TBD — session/account features |
| P0-11 | OTP retry limits + phone validation | Direct Protector | I-12 | Brute-force / invalid phone | Lock expires 10 min; retry | Brute-force test; invalid-phone test | OTP service + rate limiter | OTP-attempt metric; brute-force alert | TBD | TBD | S2 | TBD — auth/login features |
| P0-12 | Zod input validation on every API | Control/Enabler | (none — detects/enables, not enforces) | Malformed payload / type confusion | Client corrects; 400 with field errors | Fuzz test per route; schema-mismatch test | Zod schemas per route | Validation-failure metric per route | TBD | TBD | S2 | TBD — cross-cutting |
| P0-13 | Rate limiting (fail-closed for auth/payment/admin-write) | Control/Enabler | (none — enables P0-09..P0-11 to function safely) | Redis down / abuse burst | Limiter recovers; user waits | Fail-closed test; burst test | Rate limiter (Redis or in-memory) | Rate-limit-hit metric; limiter-down alert | TBD | TBD | S2 | TBD — cross-cutting |
| P0-14 | CSRF protection | Control/Enabler | (none — enables all state-changing writes to be safe) | Cross-site forged POST | Client refreshes token | CSRF injection test | CSRF token + SameSite cookie | CSRF-rejection metric | TBD | TBD | S2 | TBD — cross-cutting |
| P0-15 | Database migrations (not db:push) | Control/Enabler | (none — preserves schema, not a business truth) | Schema drift / data loss | Rollback migration; drift blocks deploy | Migration rollback test; drift detection test | Prisma migrate + review process | Drift detection CI check | TBD | TBD | S2 | TBD — cross-cutting |
| P0-16 | Backup | Control/Enabler | (none — preserves data, not a business truth) | DB corruption / accidental delete | Restore from last-known-good | Backup-integrity test; corruption-detection test | Backup schedule + corruption-detection | Backup-success + checksum metric | TBD | TBD | S2 | TBD — cross-cutting |
| P0-17 | Idempotency on all critical writes | Direct Protector | I-04, I-10 | Retry storm / partial failure | Retries return same result | Idempotency test per critical write | Idempotency key on critical writes | Idempotency coverage test in CI | TBD | TBD | S2 | TBD — cross-cutting |
| P0-18 | Error handling (boundaries + consistent responses) | Control/Enabler | (none — preserves operability, not a business truth) | Unhandled exception / partial response | User retries; support has trace id | Error-injection test per route | Error boundaries + envelope | Error-rate metric per route; alert on spike | TBD | TBD | S2 | TBD — cross-cutting |
| P0-19 | Structured logging | Control/Enabler | (none — detects failures, does not enforce truths) | Silent failure / untraceable error | In-memory buffer; retry | Log-coverage test | Logger (structured JSON) | Log-coverage test | TBD | TBD | S2 | TBD — cross-cutting |
| P0-20 | Health checks + basic metrics | Control/Enabler | (none — detects degradation, does not enforce truths) | Service silently degraded | Component recovers | Health-probe test; metric-coverage test | Health endpoint + metrics export | `/health` + metrics export | TBD | TBD | S2 | TBD — cross-cutting |
| P0-21 | Alerting on P0 failures | Control/Enabler | (none — surfaces failures, does not enforce truths) | Payment success < 95% / reconciliation mismatch | Mitigation; postmortem | Alert-trigger test; false-positive audit | Alert rules + on-call | Alert audit | TBD | TBD | S2 | TBD — cross-cutting |
| P0-22 | Audit trail integrity (immutable, complete) | Direct Protector | I-07 | Tampered audit log / missing entry | N/A (immutable by design) | Tamper test; coverage test | Audit model + append-only storage | Tamper alert; coverage test | TBD | TBD | S2 | TBD — compliance/governance; evidence sink for P0-07 pickup events |
| P0-23 | Kill switch fail-safe behaviour | Direct Protector | I-09 | Kill switch itself fails | Storage recovers; toggle verified | Kill-switch-failure test | Kill switch + fallback | Kill-switch-state metric | TBD | TBD | S2 | TBD — governance features |
| P0-24 | Transactional data integrity (cross-entity) | Direct Protector | I-01, I-02, I-05, I-06, I-10 | Partial commit; outbox publisher crash | Outbox retries; reconciliation; consumers idempotent | Partial-failure injection; outbox-crash; idempotent-replay test | DB transactions + outbox | Outbox lag metric; orphan-entity alert | TBD | TBD | S2 | TBD — cross-cutting; all order/payment features |
| P0-25 | Concurrency + duplicate-execution control | Direct Protector | I-02, I-04, I-05, I-10 | (A) last-item race; (B) state-transition race; (C) payment double-click | Loser retries; duplicate deduped | Concurrency case A/B/C; optimistic-lock conflict test | Optimistic locking + row locks + atomic decrements + idempotency keys | Conflict-rate metric per case; dedup-hit metric | TBD | TBD | S2 | TBD — likely O08 Quick Reorder (case C) |
| P0-26 | Disaster recovery (business recovery) | Direct Protector | I-01, I-02, I-06, I-07, I-10 | DB corruption / restore leaves money state inconsistent | Restore + post-restore reconciliation; NO-GO if unresolved | Restore-drill; corruption-detection; post-restore reconciliation; runbook walkthrough | Backup + restore drill + runbook | Backup-success; restore-drill result; post-restore mismatch count | TBD | TBD | S2 | TBD — cross-cutting |
| P0-27 | Deployment & rollback (3 classes) | Control/Enabler | (none — preserves operability, not a business truth) | Bad release / migration incompatibility / failed deploy | Class 1: traffic rollback ≤10min; Class 2: rollback to previous phase; Class 3: forward-fix | Rollback drill (per class); expand-migrate-contract; migration-compat; failed-deploy-abort test | CI/CD + health-checked deploy + feature flags | Deploy-success; rollback-time; post-deploy health alert | TBD | TBD | S2 | TBD — cross-cutting |
| P0-28 | Unknown-exception handling (3 blast-radius levels) | Direct Protector | I-01..I-14 (all — backstop) | Unknown state not in known state machine | Freeze (smallest sufficient level) + evidence + exception queue + alert | Unknown-state injection per level; freeze-precision; over-freeze-prevention test | Invariant checker + 3-level freeze + exception queue + alert | Unknown-state counter per level; freeze-distribution; exception-queue-aging metric | TBD | TBD | S2 | TBD — cross-cutting; backstops all features |

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
| I-13 | Pickup / Handoff Integrity | **P0-07 (fully owned — v1.4 expanded)**, P0-28 (backstop) | ✅ 2 protectors — G-B1 RESOLVED |
| I-14 | Vendor Operational Integrity | P0-28 (backstop only); **primary protector is P1 busy-mode** — explicitly documented P1-protected exception | ⚠️ Documented exception (not a defect) |

---

## 3. The 8 Coverage Queries — v1.4 Honest Results

| Query | Requirement | Result | Detail |
|-------|-------------|--------|--------|
| **A** | Every P0 → ≥1 invariant it protects (Direct Protectors); Control/Enablers classified as such | **PASS (v1.4)** | 18 Direct Protectors map to specific invariants. 10 Control/Enablers (P0-12, 13, 14, 15, 16, 18, 19, 20, 21, 27) are explicitly classified as Control/Enabler — they detect/enable/preserve, not enforce business truths. Per Architectural Law 6, this is the correct classification, not a gap. The v1.3 "indirectly protects" framing (which distorted architecture) is eliminated. |
| **B** | Every invariant → ≥1 P0 capability that protects it (with P1-protected exceptions explicitly documented) | **PASS (v1.4)** | 13 of 14 invariants have ≥1 P0 Direct Protector. I-14 is an explicitly documented P1-protected exception (not a silent rule) — Vendor Operational Integrity is not launch-blocking financial/security; P1 busy-mode must be defined before vendor scale is enabled. Per matrix Section 9 coverage note, this is a strategic decision, not a matrix defect. |
| **C** | Every P0 → ≥1 failure-injection test | **STRUCTURAL PASS** | All 28 P0s have test criteria defined in v1.4 Section 7.1 (P0-07 now has 7 tests including 5 new pickup-verification tests). "Defined" ≠ "written" ≠ "passing" — see Coverage H. |
| **D** | Every external dependency → ≥1 failure scenario | **PASS** | 16 dependency scenarios defined in Section 10, each with strategy + user message + alert + Affected P0 + Blueprint Risk. |
| **E** | Every failure scenario → documented recovery procedure | **STRUCTURAL PASS** | Every P0's detailed breakdown includes a Recovery Path. Every dependency row includes a Strategy. Structurally complete; not yet exercised. |
| **F** | Every P0 → ≥1 observable signal (metric/log/alert) | **STRUCTURAL PASS** | Every P0's detailed breakdown includes an Observability section. Structurally complete; not yet wired to a live metrics backend. |
| **G** | Every P0 → named approver (for `Approved` state) | **FAIL** | 0 of 28 P0s have a named approver. All are "TBD". This is expected-empty-pending-implementation (approvers assigned during sprint planning), but it blocks every P0 from reaching lifecycle state 9 (Production-ready). |
| **H** | Every P0 → test evidence (CI run / drill report / injection log) | **FAIL** | 0 of 28 P0s have test evidence. Nothing is implemented; no tests written or run. This is expected-empty-pending-implementation, but it blocks every P0 from advancing past lifecycle state 2 (Specified). |

### Coverage summary (v1.4)

| Status | Count | Queries |
|--------|-------|---------|
| ✅ PASS | 3 | A, B, D |
| 🟡 STRUCTURAL PASS (defined, not exercised) | 3 | C, E, F |
| ❌ FAIL (expected-empty-pending-implementation) | 2 | G, H |

**Gate 1 (Matrix Completion):** Queries A–F now all PASS (A and B resolved in v1.4; C/D/E/F structurally complete). **Gate 1 is GREEN.**

**Gate 2 (Production Readiness):** Queries G and H remain FAIL — these can only be resolved by implementation (assigning approvers + writing/running tests). They do not block Artifact 2 (Dependency Graph); they block launch.

**Formal matrix sign-off:** No longer blocked by coverage. G-B1 resolved; Query A reinterpreted; Query B exception documented. The remaining work (G-F1: Blueprint feature mapping population) is a cross-reference task for Artifact 2, not a matrix defect.

---

## 4. Resolved Gaps (v1.3 → v1.4)

| Gap ID | v1.3 Status | v1.4 Resolution |
|--------|-------------|-----------------|
| **G-B1** (I-13 thin P0 coverage) | Potential matrix defect — needs v1.4 decision | **RESOLVED.** P0-07 expanded to fully own I-13 via 8 pickup-attribution conditions for the PICKED_UP transition. No P0-29 created. P0-07 → I-13 → P0-22 evidence linkage defined. |
| **G-A1** (10 foundational P0s no invariant mapping) | Rigor gap — "indirectly protects" framing | **RESOLVED.** Direct Protector vs Control/Enabler classification introduced (Architectural Law 6). The 10 are explicitly Control/Enablers — they detect/enable, not enforce. "Indirectly protects" framing eliminated as architecture-distorting. |
| **G-B2** (I-14 P1-protected) | Accepted exception (wording loose) | **RESOLVED (wording).** Explicit statement: "I-14 is intentionally P1-protected because Vendor Operational Integrity is not a launch-blocking financial/security invariant; its P1 control must nevertheless be defined before the relevant vendor scale is enabled." No longer a silent rule. |

## 5. Remaining Items (not matrix defects)

| Item | Type | Blocks? | Resolution |
|------|------|---------|------------|
| G-G1 (0/28 approvers named) | Expected-empty-pending-implementation | Gate 2 (launch), not Gate 1 | Assign approvers during Artifact 5 (Sprint Plan) |
| G-H1 (0/28 test evidence) | Expected-empty-pending-implementation | Gate 2 (launch), not Gate 1 | Resolved only by implementation |
| G-F1 (Blueprint feature mapping incomplete) | Incomplete cross-reference | Artifact 2 (Dependency Graph) | Populate full mapping from Strategic Blueprint before Artifact 2 |

---

## 6. Sign-off Status

| Gate | Status | Blocker |
|------|--------|---------|
| **Gate 1 — Matrix Completion** (Queries A–F) | ✅ **GREEN** | None — G-B1 resolved, A/B pass, C/D/E/F structural |
| Matrix formal sign-off | ✅ **UNBLOCKED** | (was blocked on G-B1; now resolved) |
| Artifact 2 (Dependency Graph) | ⏳ Pending G-F1 (Blueprint feature mapping) | Populate full feature→capability→invariant mapping from Strategic Blueprint |
| Gate 2 — Production Readiness (G + H per capability) | ⏳ Pending implementation | Approver assignment (G-G1) + test evidence (G-H1) |

---

## 7. Next Actions

1. **Matrix v1.4 formally signed off** (coverage check passed; no matrix defects remain).
2. **Populate G-F1:** Cross-reference Strategic Blueprint's 102 features → capability → invariant. This is the input to Artifact 2.
3. **Artifact 2 — P0 Dependency Graph:** Build on the v1.4 traceability table + full feature mapping. Define build order, dependency states, critical path, feature interactions (Pre-paid + Quick Reorder, POS + Settlement, Live-Kitchen + Push).
4. **Then:** Artifact 3 (Critical Path) → Artifact 4 (Implementation Order) → Artifact 5 (Sprint Plan) → implementation.

---

## 8. G-F1 Strategic Feature Mapping — Finalization (Artifact 1 FINAL)

G-F1 is the finalization step of Artifact 1. It proves that the Strategic Blueprint's chosen features trace into the production-control architecture. Full mapping lives in `STRATEGIC_FEATURE_MAPPING.md`. Summary:

| Criterion | Status |
|-----------|--------|
| Features mapped (Mapped + Partially mapped) | 41 / ~45 named features + 8 interaction nodes |
| Features unmapped | 4 (all UX/polish — Dark mode, WCAG, i18n, Sidebar nav) |
| Unmapped with documented disposition | 4 / 4 (100%) — **0 undisposed** |
| Unmapped = architectural gap | 0 — no v1.5 escalation needed |
| Caution flags for P2/P3 | 3 (G04 geo-fence+pickup, C01 catering state machine, L02 loyalty ledger) |
| Feature interactions preserved | 8 (Prepaid+Reorder, POS+Settlement, LiveKitchen+Push, Wallet+Loyalty, GroupOrder+Concurrency, Geo-fence+Pickup, Catering+StateMachine, KillSwitch+OrderIntake) |
| New P0/invariant added during mapping | 0 (discipline held) |

**New coverage query (I):** *Every strategic feature → P0/invariant (or documented disposition).*
**Result:** ✅ PASS — 0 undisposed features.

### Artifact 1 — FINAL ✅

| Criterion | Status |
|-----------|--------|
| P0 system internally traceable (A–F) | ✅ Green |
| Strategic features traceable (G-F1 / Query I) | ✅ Green |
| No undisposed unmapped features | ✅ Confirmed |
| No new P0/invariant added during mapping | ✅ Discipline held |
| Caution flags for P2/P3 recorded | ✅ 3 flags |
| Feature interactions preserved | ✅ 8 interaction nodes |

**Artifact 2 — P0 Dependency Graph: UNLOCKED.**

---

*End of P0 Traceability & Invariant Map (Artifact 1 — FINAL).*
