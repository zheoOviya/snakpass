# Wave-2 Evidence Document

**Status:** 🟡 AUTHORIZED / IN PROGRESS
**Created:** 2026-08-14
**Authorization:** Orchestrator Decision (Sub-Wave 2a authorized)

> **Governance rule:** This document is NOT pre-filled with fabricated evidence.
> It contains gate criteria, acceptance criteria, evidence requirements, owner/task
> mapping, and status. Actual evidence is appended AFTER implementation + tests pass.

---

## 1. Wave-2 Closure Gate Criteria

Per Orchestrator Decision (Wave-2 Gate Review PASS + Sub-Wave 2a authorized):

> **Wave-2 Gate remains NOT CLOSED until P0-24 reaches S4 (Implemented) AND
> 3 failure-injection tests PASS on staging.**

### Exceptions (Orchestrator-authorized deferrals):
- **Payment + Ledger atomicity** (component #3 of P0-24 happy path): Deferred to Wave-3
  (requires P0-01 Payment model + P0-02 Ledger). Same deferral pattern as P0-25 Case C.
- **Outbox publisher worker** (Sub-Wave 2b): NOT part of Sub-Wave 2a. Sub-Wave 2a only
  wires the outbox event write INSIDE the transaction (behind feature flag OFF).

---

## 2. Wave-2 P0 Inventory + Status

| P0 | Title | Risk Tier | Wave-1 Pred | Sub-Wave | Status | Evidence |
|----|-------|-----------|-------------|----------|--------|----------|
| P0-24 | Transactional data integrity (outbox) | Tier 1 (HIGHEST) | P0-15 + P0-25 | 2a | 🟡 IN EXECUTION | §7 |

### Sub-Wave Status
| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 2a | Outbox model + migration + helper + route integration (behind flag OFF) | 🟢 AUTHORIZED |
| 2b | Publisher worker + consumer dedup + lag metric | 🔒 LOCKED |
| 2c | 3 failure-injection tests (Track B pattern) | 🔒 LOCKED |
| 2d | Reconciliation + WAVE2_EVIDENCE.md + Orchestrator review | 🔒 LOCKED |

---

## 3. Acceptance Criteria + Evidence Requirements

### Sub-Wave 2a — Outbox Model + Helper + Route Integration

| Evidence | Required | Status |
|----------|----------|--------|
| Outbox schema migration applied to staging | ✅ | 🟡 PENDING |
| Business mutation + outbox INSERT in same transaction | ✅ | 🟡 PENDING |
| Outbox row exists after commit | ✅ | 🟡 PENDING |
| Transaction failure → business + outbox both rollback | ✅ | 🟡 PENDING |
| Publisher OFF — event safely persisted (not published) | ✅ | 🟡 PENDING |
| Existing CSRF protection intact | ✅ | 🟡 PENDING |
| Existing idempotency intact | ✅ | 🟡 PENDING |
| Staging smoke tests pass (7/7) | ✅ | 🟡 PENDING |
| Production untouched | ✅ | 🟡 PENDING |
| WAVE2_EVIDENCE.md updated | ✅ | 🟡 PENDING |

---

## 4. Owner / Task Mapping

| Task | Owner | Reviewer | Approver |
|------|-------|----------|----------|
| Outbox model + migration | IDE | — | Orchestrator |
| enqueueOutboxEvent() helper | IDE | — | Orchestrator |
| Route integration (3 routes) | IDE | — | Orchestrator |
| Publisher worker (Sub-Wave 2b) | IDE | — | Orchestrator |
| Failure-injection tests (Sub-Wave 2c) | IDE | — | Orchestrator |

---

## 5. Wave-2 Deviations

| Deviation ID | Description | Status |
|--------------|-------------|--------|
| (none yet) | — | — |

---

## 6. Evidence Log (appended after implementation)

> Evidence is appended here as Sub-Wave 2a progresses.

### [Evidence will be appended below as Sub-Wave 2a completes]

---
