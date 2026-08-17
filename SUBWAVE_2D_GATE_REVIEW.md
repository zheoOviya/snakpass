# Sub-Wave 2d Gate Review — READ/PLAN-FIRST

**Review Date:** 2026-08-15
**Reviewer:** IDE (read-only, Orchestrator-authorized)
**Authorization:** READ/PLAN-FIRST Sub-Wave 2d Gate Review ONLY
**Predecessor:** Sub-Wave 2c ✅ PASS (S5 Evidence-Complete)

---

## Executive Summary

Sub-Wave 2d covers **reconciliation + orphan detection + final evidence consolidation** for Wave-2 closure. This review inspects what reconciliation infrastructure exists, what gaps remain, and what the 2d exit criteria should be.

| # | Question | Answer |
|---|----------|--------|
| 1 | Can the system detect business-record-without-outbox? | 🟡 PARTIALLY — no reconciliation job exists |
| 2 | Can the system detect outbox-without-business-entity? | 🟡 PARTIALLY — no reconciliation job exists |
| 3 | Can the system detect permanently FAILED events? | ✅ YES — alert rule `outbox-publish-failed` fires on FAILED count > 0 |
| 4 | Can the system detect stale CLAIMED events? | ✅ YES — publisher step 1 recovers stale CLAIMED → PENDING |
| 5 | Can the system detect unexpected duplicates? | ✅ YES — ProcessedEvent dedup prevents duplicate business effects |
| 6 | Where will reconciliation run? | Vercel Cron (staging) or alert-evaluator mini-service |
| 7 | Detection-only or repair? | Detection only — repair requires human approval |
| 8 | Duplicate repair prevention? | ProcessedEvent table (eventId unique) |

---

## 2d-1: Reconciliation — Can the system detect mismatches?

### Business record without outbox event
**Current state:** No reconciliation job exists to detect this. However, the `withTransaction()` pattern in all 3 routes (orders POST, status PATCH, kill-switch PATCH) ensures business mutation + outbox INSERT are in the same transaction. If the transaction commits, both exist. If it rolls back, neither exists. The 2a rollback-injection test proved this empirically (`atomicRollback: true`).

**Gap:** No periodic reconciliation job that independently verifies every business record has a corresponding outbox event. This is a defense-in-depth concern — the transaction guarantee should be sufficient, but a reconciliation job provides empirical verification.

**Design:**
```sql
-- Find orders without a corresponding outbox event
SELECT o.id, o.createdAt
FROM "Order" o
LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
WHERE ob.id IS NULL;
```

### Outbox event without business entity
**Current state:** No reconciliation job exists. However, the outbox event is always written inside the same transaction as the business entity, so this should be impossible under normal operation.

**Gap:** Same as above — no periodic independent verification.

**Design:**
```sql
-- Find outbox events without a corresponding business entity
SELECT ob."eventId", ob."eventType", ob."aggregateId"
FROM "Outbox" ob
LEFT JOIN "Order" o ON o.id = ob."aggregateId AND ob."aggregateType" = 'Order'
WHERE o.id IS NULL AND ob."aggregateType" = 'Order';
```

### Permanently FAILED events
**Current state:** ✅ Detected by alert rule `outbox-publish-failed` (count of FAILED > 0 → critical alert). The alert evaluator (updated in 2b-5) queries the Outbox table for FAILED status.

### Stale CLAIMED events
**Current state:** ✅ Recovered by publisher step 1 (stale CLAIMED → PENDING on lease expiry). The 2b-3 crash recovery test proved this empirically.

### Unexpected duplicate events
**Current state:** ✅ Handled by ProcessedEvent dedup. The 2b-E2 consumer E2E test proved this empirically (3× delivery → 1× business effect).

---

## 2d-2: Orphan Detection

### Types of orphans to detect:
1. **Business mutation without outbox** — should be impossible (same transaction), but reconciliation provides defense-in-depth
2. **Outbox without business entity** — should be impossible (same transaction), but reconciliation provides defense-in-depth
3. **Permanently FAILED events** — detected by alert rule, requires manual intervention
4. **Stale CLAIMED events** — auto-recovered by publisher lease mechanism
5. **Unexpected duplicate events** — prevented by ProcessedEvent dedup

### Current detection capability:
| Orphan Type | Detection Mechanism | Status |
|-------------|--------------------|--------|
| Business without outbox | None (relies on transaction guarantee) | 🟡 No reconciliation job |
| Outbox without business | None (relies on transaction guarantee) | 🟡 No reconciliation job |
| FAILED events | `outbox-publish-failed` alert rule | ✅ Detected |
| Stale CLAIMED | Publisher lease recovery | ✅ Auto-recovered |
| Duplicates | ProcessedEvent dedup | ✅ Prevented |

---

## 2d-3: Operational Reconciliation

### Where will reconciliation run?
- **Option A:** Add reconciliation queries to the alert-evaluator mini-service (already queries Outbox table for lag + failed count). This is the lowest-effort approach — add 2 more queries to the existing evaluation cycle.
- **Option B:** Create a dedicated `mini-services/reconciliation-job/` that runs periodically and checks for mismatches. Higher effort but cleaner separation.

**Recommendation:** Option A (add to alert-evaluator) — lower effort, already running, already queries Outbox table.

### Frequency
- Alert evaluator runs every 60 seconds (configurable via `ALERT_INTERVAL_MS`)
- Reconciliation checks would run at the same frequency

### Detection-only or repair?
- **Detection only.** No automatic repair. If a mismatch is detected:
  - Alert fires (critical severity)
  - ExceptionQueue entry created (via P0-28 `reportInvariantViolation`)
  - Human intervention required

### Duplicate repair prevention
- ProcessedEvent table (eventId unique) prevents duplicate processing
- Reconciliation job is read-only (SELECT queries) — no writes, no repair

---

## 2d-4: Evidence Consolidation

### Final Wave-2 Evidence Package Structure
```
WAVE2_EVIDENCE.md
├── §1: Wave-2 Closure Gate Criteria
├── §2: Wave-2 P0 Inventory + Status
├── §3: Acceptance Criteria + Evidence Requirements
├── §4: Owner / Task Mapping
├── §5: Wave-2 Deviations
├── §6: Evidence Log
│   ├── Sub-Wave 2a Evidence (Outbox model + rollback)
│   ├── Sub-Wave 2b Evidence (publisher + consumer + crash + retry + alerts + flag ON)
│   ├── Sub-Wave 2c Evidence (consolidated from 2a/2b)
│   └── Sub-Wave 2d Evidence (reconciliation + final package)
└── §7: Final Wave-2 Closure Statement
```

### Every claim must have evidence/run reference
- All evidence claims include workflow name, run ID, and key metrics
- No fabricated claims
- Implementation reasoning is NOT evidence

---

## 2d Exit Criteria

| Criterion | Required | Current Status |
|-----------|----------|----------------|
| Reconciliation query for business-without-outbox | ✅ | 🟡 Not yet implemented |
| Reconciliation query for outbox-without-business | ✅ | 🟡 Not yet implemented |
| Reconciliation integrated into alert-evaluator | ✅ | 🟡 Not yet implemented |
| Alert fires on mismatch detection | ✅ | 🟡 Not yet implemented |
| WAVE2_EVIDENCE.md final consolidation | ✅ | 🟡 Partial (2a/2b/2c done, 2d pending) |
| Production untouched | ✅ | ✅ |

---

## Current Governance State
```
Wave-2                    🔓 UNLOCKED
Sub-Wave 2a               ✅ PASS — S5 Evidence-Complete
Sub-Wave 2b               ✅ PASS — S5 Evidence-Complete
Sub-Wave 2c               ✅ PASS — S5 Evidence-Complete
Sub-Wave 2d               🔒 LOCKED (READ/PLAN-FIRST review complete)
Wave-2 closure             🔒 NOT YET
Wave-3                     🔒 LOCKED
Production                 🚫 NOT AUTHORIZED
```

## Recommendation to Orchestrator

2d scope is well-defined:
1. **Reconciliation queries** — add 2 SELECT queries to alert-evaluator (business-without-outbox + outbox-without-business)
2. **Alert rules** — add `orphan-business-entity` + `orphan-outbox-event` alert rules
3. **Evidence consolidation** — finalize WAVE2_EVIDENCE.md with all evidence (2a + 2b + 2c + 2d)
4. **Wave-2 closure** — declare P0-24 S9 Production-ready + Wave-2 CLOSED

The reconciliation implementation is minimal (2 SQL queries + 2 alert rules added to existing alert-evaluator). No new infrastructure needed.

**STOP.** Awaiting Orchestrator decision on 2d implementation authorization.
