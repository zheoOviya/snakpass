# Sub-Wave 3 Gate Review — READ/PLAN-FIRST

**Review Date:** 2026-08-15
**Reviewer:** IDE (read-only, Orchestrator-authorized)
**Authorization:** READ/PLAN-FIRST Sub-Wave 3 Gate Review ONLY
**Predecessor:** Wave-2 ✅ CLOSED (S5 Evidence-Complete)

---

## Executive Summary

| # | Question | Answer |
|---|----------|--------|
| 1 | What P0/P1 items are in Wave-3? | **2 P0s**: P0-01 (Razorpay capture, Tier 1 HIGHEST) + P0-08 (Order idempotency, Tier 4). 0 P1 items. |
| 2 | Dependencies satisfied? | ✅ YES — P0-09 (w0), P0-17 (w1), P0-24 (w2 CLOSED), P0-23 (w0), P0-25 (w1) all CLOSED |
| 3 | Are Wave-3 items already partially complete? | 🟡 P0-08 ~40% (idempotency pattern proven in orders POST); P0-01 GREENFIELD (0%) |
| 4 | Production impact? | 🔴 CRITICAL — money flow; requires Razorpay SDK, Payment model, signature verification |
| 5 | Wave-3 closure gate? | 🟡 NO WAVE3_EVIDENCE.md exists — governance gap |
| 6 | Sub-wave strategy? | 3 sub-waves: 3a (Payment model + capture route), 3b (P0-08 formalization + retry-storm), 3c (failure-injection + cross-P0 closure) |
| 7 | Reusable Wave-2 infrastructure? | 8 components: withTransaction, IdempotencyKey, ProcessedEvent, Outbox, publisher, alerts, ExceptionQueue, feature flags |
| 8 | Schema changes? | 3 new models (~55 lines): Payment, LedgerEntry, WebhookEvent. All Class-2 expand-migrate-contract. |
| 9 | Evidence requirements? | ~20 empirical test scenarios across P0-01 (17) + P0-08 (3), all with ok:true |

---

## Q1 — Wave-3 Scope: 2 P0s

| P0 | Title | Tier | Invariants | Predecessors | Blocks |
|----|-------|------|-----------|-------------|--------|
| **P0-01** | Razorpay capture | Tier 1 (HIGHEST) | I-01, I-04 | P0-09 ✅, P0-17 ✅, P0-24 ✅ CLOSED, P0-23 ✅ | P0-02, P0-03, P0-04, P0-05, P0-06 |
| **P0-08** | Order idempotency | Tier 4 | I-02, I-10 | P0-24 ✅ CLOSED, P0-25 ✅ | NONE (leaf) |

## Q2 — Current State

### P0-01 — GREENFIELD (0% implemented)
- No Payment model in schema
- No Razorpay SDK in package.json
- No /api/payments/ routes
- `realPayments` feature flag exists but unused (defaults OFF)

### P0-08 — PARTIALLY PROVEN (~40%)
- IdempotencyKey model + library EXISTS (from Wave-1 P0-17)
- Idempotency pattern proven in orders POST route (same-txn check+store)
- Needs: formal retry-storm test, reviewer sign-off, lifecycle advancement

## Q3 — Reusable Wave-2 Infrastructure (8 components)

1. `withTransaction()` — wraps capture + ledger + outbox in single transaction
2. `IdempotencyKey` model + `idempotency.ts` — payment double-click dedup
3. `ProcessedEvent` + `event-consumer.ts` — exactly-once consumer-side business effect
4. `Outbox` + `enqueueOutboxEvent()` + publisher — atomic event persistence
5. Alert rules + alert-evaluator (13 rules including `payment-success-rate`)
6. `ExceptionQueue` + `invariant-checker.ts` — I-01/I-04 violations → Level 3 kill switch
7. Feature flags (`realPayments`, `outboxPublisher`)
8. Deployment classifier (Class-2 expand-migrate-contract for schema changes)

## Q4 — Schema Changes Required

| Model | Purpose | Lines (est.) | Class |
|-------|---------|-------------|-------|
| `Payment` | Razorpay order/payment lifecycle, capture status, idempotency key FK | ~25 | Class-2 expand |
| `LedgerEntry` | Double-entry Dr/Cr pairs (append-only, I-06) | ~15 | Class-2 expand |
| `WebhookEvent` | Razorpay webhook dedup + HMAC verification | ~15 | Class-2 expand |
| Order.paymentId | 1:1 relation to Payment | 1 field | Class-2 expand |
| **Total** | | **~55 lines** | All additive |

## Q5 — Sub-Wave Strategy

### Sub-Wave 3a — Payment Model + Capture Route
1. Add Payment + LedgerEntry + WebhookEvent models to schema
2. Create migration SQL (Class-2 additive)
3. Install Razorpay SDK
4. Create `src/lib/razorpay.ts` — order create + verify signature + capture
5. Create `POST /api/payments` — capture route (withTransaction + IdempotencyKey + Outbox)
6. Wire `realPayments` feature flag (demo vs real Razorpay)
7. Staging migration + deploy + smoke tests

### Sub-Wave 3b — P0-08 Formalization
1. Formal retry-storm test (10+ concurrent requests, same key → 1 order)
2. Reviewer sign-off
3. Lifecycle advancement S2 → S5

### Sub-Wave 3c — Failure Injection + Cross-P0 Closure
1. P0-01 failure tests (signature tamper, double-submit, gateway timeout, capture-DB-fail)
2. P0-25 Case C closure (payment double-click → exactly 1 capture)
3. P0-24-deferred Payment+Ledger atomicity test
4. Prepaid+Reorder F-convergence interaction test
5. Evidence consolidation → WAVE3_EVIDENCE.md

## Q6 — Evidence Requirements (~20 scenarios)

### P0-01 (17 scenarios)
- 3 matrix test criteria (idempotency, signature-tamper, double-submit)
- 5 §8 failure sub-scenarios (gateway timeout, signature mismatch, double-click, webhook-before-callback, capture-DB-fail)
- 5 external dependency scenarios (Razorpay timeout/mismatch — 2 in Wave-3, 3 deferred)
- 4 cross-P0 closure tests (P0-24 atomicity, P0-25 Case C, P0-26 reconciliation dependency, F-convergence)
- 4 observability signals (structured logs, payment_success_rate metric, alert, reconciliation report stub)

### P0-08 (3 scenarios)
- Idempotency-key test (already proven, needs formal evidence capture)
- Retry-storm test (10+ concurrent → 1 order)
- F-convergence interaction test (reorder → payment → no double-charge)

## Q7 — Governance Gaps

1. 🟡 `WAVE3_EVIDENCE.md` does not exist — must be created before implementation
2. 🟡 5 Phase-3 prerequisites carried forward from Wave-2 (historical orphan fix, production DB role, realtime service, transport switch, Payment+Ledger atomicity)
3. 🟡 `realPayments` feature flag is dead code — must be wired in Wave-3
4. 🟡 P0-26 + P0-25 Case C cross-wave dependencies — Wave-3 unblocks but does NOT formally close these

## Q8 — Production Impact

| Dimension | Impact |
|-----------|--------|
| Schema change | ✅ 3 new models (Class-2 additive) |
| New dependency | ✅ Razorpay SDK (`razorpay` npm package) |
| New env vars | ✅ RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET |
| New infrastructure | 🟡 None (uses existing withTransaction + IdempotencyKey + Outbox) |
| Blast radius | 🔴 CRITICAL — money flow; capture without signature = lost money |
| Mitigation | `realPayments` flag OFF by default; demo mode for staging |

## Current Governance State
```
Wave-0                   ✅ CLOSED
Wave-1                   ✅ CLOSED
Wave-2                   ✅ CLOSED (S5 Evidence-Complete)
Wave-3                   🔒 LOCKED (READ/PLAN-FIRST review complete — awaiting authorization)
Wave-4+                  🔒 LOCKED
Production               🚫 NOT AUTHORIZED
```

## Recommendation to Orchestrator

Wave-3 scope is well-defined: 2 P0s (P0-01 GREENFIELD + P0-08 partially proven). All predecessor gates are GREEN. 8 reusable Wave-2 infrastructure components are available. ~55 lines of new schema + Razorpay SDK + capture route.

Key decisions required:
1. Authorize creation of `WAVE3_EVIDENCE.md` (governance documentation)
2. Authorize Sub-Wave 3a first (Payment model + capture route behind `realPayments=false`)
3. Razorpay test keys for staging (not production keys)
4. Do NOT authorize production deployment

**STOP.** Awaiting Orchestrator decision on Wave-3 implementation authorization.
