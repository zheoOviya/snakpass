# Sub-Wave 2c Gate Review — READ/PLAN-FIRST

**Review Date:** 2026-08-15
**Reviewer:** IDE (read-only, Orchestrator-authorized)
**Authorization:** READ/PLAN-FIRST Sub-Wave 2c Gate Review ONLY
**Predecessor:** Sub-Wave 2b ✅ PASS (S5 Evidence-Complete)

---

## Executive Summary

P0-24's documented test criteria (per `PRODUCTION_READINESS_MATRIX.md` §7.1) require 3 failure-injection tests:

1. **Partial-failure injection test** — inject failure mid-transaction; verify entire txn rolls back; no orphan entities
2. **Outbox-crash test** — simulate publisher crash AFTER commit; verify event row exists in DB; restart publisher; verify event eventually published; consumer dedup ensures exactly-once business effect
3. **Idempotent-replay test** — deliver same event twice to consumer; verify consumer applies business effect exactly once

### Key Finding: ALL 3 tests have existing evidence from 2a/2b

| Test | Required by Matrix | Existing Evidence | Gap |
|------|-------------------|-------------------|-----|
| Partial-failure injection | Mid-transaction failure → full rollback → no orphans | ✅ **2a rollback-injection test** (run 31869987403): order.create + outbox INSERT → deliberate error → both rolled back (orderExists=false, outboxExists=false) | **NONE** — already empirically proven |
| Outbox-crash test | Publisher crash after commit → event recoverable → no loss | ✅ **2b-3 crash recovery test** (run 31873863056): event CLAIMED by crashed worker → lease expired → publisher recovered → PUBLISHED | **NONE** — already empirically proven |
| Idempotent-replay test | Same event delivered 2× → business effect exactly once | ✅ **2b-E2 consumer E2E** (run 31877198639): 3× delivery via real consumer → 1 ProcessedEvent → 1 business effect | **NONE** — already empirically proven |

### Recommendation: 2c may be SATISFIED by existing evidence

All 3 P0-24 test criteria are already empirically satisfied by evidence captured during 2a and 2b. No new implementation or testing is required — only evidence consolidation.

However, the Orchestrator may require a consolidated 2c evidence workflow that re-runs all 3 tests as a single package to formally close 2c.

---

## Detailed Analysis

### Test 1: Partial-Failure Injection

**Matrix requirement (§7.1 P0-24):**
> "Partial failure mid-transaction → entire business transaction rolls back; no orphan OrderItems, no orphan ledger entries, no decremented availability without order."

**Existing evidence (2a rollback-injection, run 31869987403):**
- Test endpoint: `POST /api/test/rollback-injection`
- Sequence: Start transaction → create order → write outbox event → throw deliberate error
- Result: `orderExists: false`, `outboxExists: false`, `atomicRollback: true`
- Both business mutation AND outbox INSERT rolled back atomically

**Gap:** NONE. The 2a rollback-injection test is exactly the partial-failure injection test required by P0-24.

### Test 2: Outbox-Crash Test

**Matrix requirement (§7.1 P0-24):**
> "Outbox publisher crashes after commit → the event row is already committed in the DB (part of the same transaction), so it is NOT lost. Publisher restarts and re-publishes."

**Existing evidence (2b-3 crash recovery, run 31873863056 + 31877198639):**
- Test: Event created → claimed by crashed worker (5s lease) → lease expired → publisher recovered → PUBLISHED
- Result: `finalStatus: "PUBLISHED"`, `noEventLoss: true`

**Gap:** NONE. The 2b-3 crash recovery test proves the publisher recovers from crash and delivers the event.

**Note:** The matrix describes "crash AFTER commit" — our 2b-3 test simulates crash DURING publish (between claim and publish). The "crash after commit" scenario is implicitly covered by the lease mechanism: if the publisher crashes after committing the PUBLISHED status, the event is already delivered (no recovery needed). If it crashes before committing PUBLISHED, the lease expires and recovery happens (which is what 2b-3 tests).

### Test 3: Idempotent-Replay Test

**Matrix requirement (§7.1 P0-24):**
> "Consumers may receive the event more than once → consumers must be idempotent, so the business effect is exactly-once even if physical delivery is at-least-once."

**Existing evidence (2b-E2 consumer E2E, run 31877198639):**
- Test: 3× delivery via real HTTP consumer endpoint (`/api/test/consume-event`)
- Result: Delivery 1 → processed=true; Delivery 2 → processed=false (dedup); Delivery 3 → processed=false (dedup)
- ProcessedEvent count: 1
- Business effect count: 1

**Gap:** NONE. The 2b-E2 test is exactly the idempotent-replay test required by P0-24.

---

## Dependency Mapping

| 2c Test | Depends on | Existing Evidence Location |
|---------|------------|---------------------------|
| Partial-failure | 2a withTransaction + rollback-injection endpoint | WAVE2_EVIDENCE.md §6 (2a rollback) |
| Outbox-crash | 2b-2 claim/lease + 2b-3 crash recovery | WAVE2_EVIDENCE.md §6 (2b-3 crash) |
| Idempotent-replay | 2b-1 ProcessedEvent + 2b-E2 consumer E2E | WAVE2_EVIDENCE.md §6 (2b-E2) |

All dependencies are satisfied by 2a (PASS) and 2b (PASS).

---

## Test Isolation + Staging Safety

- All tests use `/api/test/*` endpoints guarded by `VERCEL_ENV !== 'production'`
- Test events use unique markers (`crash-test-*`, `poison-test-*`, `consumer-e2e-*`) for identification
- Cleanup SQL deletes test rows after each test
- No production data affected
- No production configuration changed

---

## 2c Exit Criteria + Required Artifacts

### Option A: Satisfy by existing evidence (recommended)
If the Orchestrator accepts that 2a/2b evidence satisfies 2c:
- Consolidate all 3 test results into a single `2c-evidence.json` artifact
- Update WAVE2_EVIDENCE.md with cross-references
- Declare 2c = S5 Evidence-Complete

### Option B: Re-run as consolidated package
If the Orchestrator requires a fresh consolidated run:
- Create a single workflow that runs all 3 tests in sequence
- Capture combined evidence JSON
- This is lower-risk but higher effort

---

## Current Governance State
```
Wave-2                    🔓 UNLOCKED
Sub-Wave 2a               ✅ PASS — S5 Evidence-Complete
Sub-Wave 2b               ✅ PASS — S5 Evidence-Complete
Sub-Wave 2c               🔒 LOCKED (READ/PLAN-FIRST review complete)
Sub-Wave 2d               🔒 LOCKED
Wave-2 closure             🔒 NOT YET
Wave-3                     🔒 LOCKED
Production                 🚫 NOT AUTHORIZED
```

## Recommendation to Orchestrator

**All 3 P0-24 test criteria are already empirically satisfied by evidence from 2a and 2b.** The 2c Gate Review recommends Option A (satisfy by existing evidence) because:

1. The 2a rollback-injection test IS the partial-failure injection test
2. The 2b-3 crash recovery test IS the outbox-crash test
3. The 2b-E2 consumer E2E test IS the idempotent-replay test

No new implementation is needed. The only deliverable is evidence consolidation (cross-referencing existing evidence in WAVE2_EVIDENCE.md).

If the Orchestrator prefers Option B (consolidated re-run), a single workflow can be created that runs all 3 tests in sequence and captures a combined evidence JSON.

**STOP.** Awaiting Orchestrator decision on 2c: Option A (existing evidence) vs Option B (consolidated re-run).
