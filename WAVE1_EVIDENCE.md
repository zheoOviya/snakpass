# Wave-1 Evidence Document

**Status:** 🟡 AUTHORIZED / IN PROGRESS
**Created:** 2026-08-14
**Authorization:** Orchestrator Decision (Sub-Wave 1a authorized)

> **Governance rule:** This document is NOT pre-filled with fabricated evidence.
> It contains gate criteria, acceptance criteria, evidence requirements, owner/task
> mapping, and status. Actual evidence is appended AFTER implementation + tests pass.

---

## 1. Wave-1 Closure Gate Criteria

Per `WAVE0_EVIDENCE.md` line 5 (Wave-0 precedent) and Orchestrator Decision O-1:

> **Wave-1 Gate remains NOT CLOSED until ALL 6 Wave-1 P0s reach S9 Production-ready
> (G/H evidence + business-owner approval) AND all Wave-1 deviations are CLOSED.**

### Exceptions (Orchestrator-authorized splits):
- **P0-26:** Split — Wave-1 closes the "design + runbook + restore procedure" half;
  "actual DR drill + production-grade restore/reconciliation" is deferred to Phase 3
  (Orchestrator Decision O-3, Option B).
- **P0-25 Case C (payment duplicate):** Cannot fully close in Wave-1 — requires
  Wave-3 Payment model (P0-01). Wave-1 prepares P0-17 infrastructure only.
- **P0-26 post-restore money-state reconciliation:** Deferred to Wave-3 (post-P0-01).

---

## 2. Wave-1 P0 Inventory + Status

| P0 | Title | Risk Tier | Wave-0 Pred | Sub-Wave | Status | Evidence |
|----|-------|-----------|-------------|----------|--------|----------|
| P0-25 | Concurrency (3 cases) | Tier 2 (HIGH) | P0-15 | 1a | 🟡 QUEUED | — |
| P0-17 | Idempotency on critical writes | Tier 4 | P0-15 | 1a | 🟡 QUEUED | — |
| P0-28 | Unknown-exception handling | Tier 3 | P0-19/20/21/22 | 1b | 🟡 QUEUED | — |
| P0-10 | Session integrity | Tier 4 | P0-09 | 1b | 🟡 QUEUED | — |
| P0-11 | OTP retry limits | Tier 4 | P0-09 | 1b | 🟡 QUEUED | — |
| P0-26 | Disaster recovery (split) | Tier 3 | P0-16 | 1c | 🟡 DESIGN ONLY | — |

### Shared Prerequisite
| Item | Status | Evidence |
|------|--------|----------|
| `withTransaction()` helper in `src/lib/db.ts` | 🟢 AUTHORIZED (FIRST) | — |

---

## 3. Acceptance Criteria + Evidence Requirements

### Shared Helper: `withTransaction()`
- **Acceptance:** `withTransaction(fn)` wrapper exists; calls `prisma.$transaction(fn)`;
  handles retry-on-conflict; tested with 2 concurrent transactions on same row.
- **Evidence required:** Unit test showing one succeeds, one retries or gets 409.

### P0-25 — Concurrency (Cases A + B)
- **Acceptance:** Concurrent writes serialised; no oversell; conflicts surface as 409 (not silent corruption).
- **Evidence required:**
  - Case A test: 2 concurrent POST /api/orders for last available item → 1 succeeds (201), 1 fails (409)
  - Case B test: 2 concurrent PATCH /api/orders/[id]/status with conflicting transitions → 1 succeeds, 1 fails (409)
  - Transaction behavior evidence (atomic check-then-write)
  - Optimistic locking / version field evidence
  - Failure-path evidence (409 response shape)
  - Relevant CI result
- **Note:** Case C (payment duplicate) deferred to Wave-3 (needs Payment model).

### P0-17 — Idempotency
- **Acceptance:** All critical writes idempotent; retries return same result.
- **Evidence required:**
  - Duplicate request test (same Idempotency-Key → same response + same resourceId)
  - Concurrent duplicate test (2 concurrent requests with same key → 1 succeeds, 1 deduped)
  - Replay behavior test (replay after success → same response)
  - Persistence behavior test (key survives DB round-trip)
  - Response consistency test (status + body match)
  - Phantom-block-prevention test (crash between check + write → retry succeeds)
- **Note:** Only POST /api/orders in Wave-1; Payment/refund routes deferred to Wave-3.

### P0-28 — Unknown-Exception Handling
- **Acceptance:** Unknown state triggers smallest sufficient freeze; preserves evidence;
  creates exception queue entry; alerts; never silently ignored; never over-freezes.
- **Evidence required:**
  - Unknown-state injection at Level 1 (transaction freeze)
  - Unknown-state injection at Level 2 (entity quarantine)
  - Unknown-state injection at Level 3 (system kill switch)
  - Freeze-precision test (smallest sufficient level used)
  - Over-freeze-prevention test (Level 3 NOT used when Level 1 would suffice)

### P0-10 — Session Integrity
- **Acceptance:** Sessions expireable, revocable; active-sessions list available.
- **Evidence required:**
  - Session-revoke test (revokeSession → next request 401)
  - Concurrent-session test (revokeAllSessionsForUser → all invalidated)
  - Active-sessions list test (GET /api/auth/sessions returns correct data)
  - Sliding refresh test (expiry extends on request)

### P0-11 — OTP Retry Limits
- **Acceptance:** Max 5 OTP attempts / 3 sends per 10 min; phone E.164 validated.
- **Evidence required:**
  - Brute-force test (6th attempt → lockout)
  - Send-limit test (4th send per 10min → 429)
  - Lockout-TTL test (after 10 min → cleared)
  - Brute-force alert test (alert fires after threshold)
  - Invalid-phone test (E.164 validation)

### P0-26 — DR (Design Only — Split)
- **Acceptance:** DR design + runbook + restore procedure documented.
- **Evidence required:**
  - `docs/DR_RUNBOOK.md` exists
  - `scripts/restore-backup.sh` authored (not executed against production)
  - Post-restore reconciliation procedure documented (implementation deferred to Wave-3)
- **NOT required in Wave-1:** Actual DR drill, production-grade restore, money-state reconciliation.

---

## 4. Sub-Wave Execution Plan

### Sub-Wave 1a — Foundation + Critical Path (AUTHORIZED)
**Sequence:**
1. `withTransaction()` helper — FIRST
2. P0-25 Cases A + B (inventory race + state-transition race)
3. P0-17 (idempotency infrastructure)
4. Single coordinated Prisma migration

**Exit criteria:**
- `withTransaction()` helper exists + tested
- P0-25 Case A: concurrent POST /api/orders → exactly 1 succeeds, other 409
- P0-25 Case B: concurrent PATCH → exactly 1 succeeds, other 409
- P0-17: POST /api/orders with same Idempotency-Key → same response (dedup)
- Staging smoke tests still PASS (4 original + CSRF round-trip)
- **Unblocks Wave-2 (P0-24 needs P0-25)**

### Sub-Wave 1b — Hardening (QUEUED)
1. P0-28 (unknown-exception handling)
2. P0-10 (session integrity)
3. P0-11 (OTP retry limits)

### Sub-Wave 1c — DR Design Only (QUEUED)
1. P0-26 design + runbook + restore script (NO drill execution)

---

## 5. Owner / Task Mapping

| Task | Owner | Reviewer | Approver |
|------|-------|----------|----------|
| `withTransaction()` | IDE | — | Orchestrator |
| P0-25 | IDE | — | Orchestrator |
| P0-17 | IDE | — | Orchestrator |
| P0-28 | IDE | — | Orchestrator |
| P0-10 | IDE | — | Orchestrator |
| P0-11 | IDE | — | Orchestrator |
| P0-26 (design) | IDE | — | Orchestrator |

---

## 6. Wave-1 Deviations

| Deviation ID | Description | Status |
|--------------|-------------|--------|
| (none yet) | — | — |

---

## 7. Evidence Log (appended after implementation)

> Evidence is appended here as each P0 reaches S4 (Implemented) → S5 (Tested) → S9 (Production-ready).

### [Evidence will be appended below as Sub-Wave 1a progresses]

---
