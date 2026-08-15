# Wave-3 Evidence Document

**Status:** 🟡 AUTHORIZED / IN PROGRESS
**Created:** 2026-08-15
**Authorization:** Orchestrator Decision (Sub-Wave 3a authorized)

> **Governance rule:** This document is NOT pre-filled with fabricated evidence.
> It contains gate criteria, acceptance criteria, evidence requirements, owner/task
> mapping, and status. Actual evidence is appended AFTER implementation + tests pass.

---

## 1. Wave-3 Closure Gate Criteria

> **Wave-3 Gate remains NOT CLOSED until P0-01 reaches S5 (Tested) AND
> P0-08 reaches S5 (Tested) AND ~20 empirical test scenarios PASS on staging.**

### Exceptions (Orchestrator-authorized deferrals):
- **Webhook handler** (P0-05): Wave-4 scope. Wave-3 lands WebhookEvent model only.
- **Refund flow** (P0-04): Wave-5 scope. Wave-3 lands Payment.status='REFUNDED' enum only.
- **Reconciliation job** (P0-03): Wave-5 scope. Wave-3 stubs the report format only.
- **P0-26 post-restore money-state reconciliation**: Wave-3 unblocks dependency but does NOT close P0-26.

---

## 2. Wave-3 P0 Inventory + Status

| P0 | Title | Risk Tier | Wave-2 Pred | Sub-Wave | Status | Evidence |
|----|-------|-----------|-------------|----------|--------|----------|
| P0-01 | Razorpay capture | Tier 1 (HIGHEST) | P0-09/17/24/23 | 3a | 🟡 IN EXECUTION | §7 |
| P0-08 | Order idempotency | Tier 4 | P0-24/25 | 3b | 🔒 LOCKED | — |

### Sub-Wave Status
| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 3a | Payment model + capture route + LedgerEntry + WebhookEvent | 🟢 AUTHORIZED |
| 3b | P0-08 formalization (retry-storm, sign-off) | 🔒 LOCKED |
| 3c | Failure injection + cross-P0 closure | 🔒 LOCKED |

---

## 3. Acceptance Criteria + Evidence Requirements

### Sub-Wave 3a — Payment Model + Capture Route

| Evidence | Required | Status |
|----------|----------|--------|
| Payment + LedgerEntry + WebhookEvent schema migration applied to staging | ✅ | 🟡 PENDING |
| Capture route accepts Idempotency-Key header | ✅ | 🟡 PENDING |
| Same idempotency key → same Payment row (dedup works) | ✅ | 🟡 PENDING |
| Capture failure → no partial Order/Ledger/Outbox state (rollback) | ✅ | 🟡 PENDING |
| realPayments=false → demo mode (no real Razorpay call) | ✅ | 🟡 PENDING |
| Payment + LedgerEntry + Order + Outbox in same transaction | ✅ | 🟡 PENDING |
| Staging smoke tests pass (7/7 + new payment tests) | ✅ | 🟡 PENDING |
| Production untouched | ✅ | 🟡 PENDING |

---

## 4. Owner / Task Mapping

| Task | Owner | Reviewer | Approver |
|------|-------|----------|----------|
| Payment model + migration | IDE | — | Orchestrator |
| Razorpay SDK + capture route | IDE | — | Orchestrator |
| Evidence + WAVE3_EVIDENCE.md | IDE | — | Orchestrator |

---

## 5. Wave-3 Deviations

| Deviation ID | Description | Status |
|--------------|-------------|--------|
| (none yet) | — | — |

---

## 6. Evidence Log (appended after implementation)

> Evidence is appended here as Sub-Wave 3a progresses.

### [Evidence will be appended below as Sub-Wave 3a completes]

---
