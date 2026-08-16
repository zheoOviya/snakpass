# Sub-Wave 4d — READ/PLAN-FIRST Gate Review (orphan_business_count fix)

**Status:** 🟡 READ/PLAN-FIRST GATE REVIEW (Implementation NOT authorized)
**Date:** 2026-08-16
**Task ID:** 4d-gate-review
**Reviewer:** Software Architect / Gate Reviewer

**Predecessor:** Wave-4 4a ✅ S5 PASS / CLOSED, 4b ✅ S5 PASS / CLOSED, 4c ✅ S5 PASS / CLOSED.

---

## Executive Summary

The `orphan_business_count` query in `mini-services/alert-evaluator/index.ts:183-186` counts ALL orders without a matching Outbox event, including historical pre-outbox orders. This causes a false-positive alert storm when the outbox feature is deployed to an environment with pre-existing orders. The fix is a 1-line SQL change adding a timestamp filter (`AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")`). No schema change, no migration, no application logic change. Risk: LOW. Recommendation: **GO**.

---

## Current Implementation

**File:** `mini-services/alert-evaluator/index.ts`, lines 181-192

**Alert rule:** `orphan-business-entity` (severity: critical, threshold: 0, comparison: `gt`, cooldown: 60s)

**Current SQL query:**
```sql
SELECT COUNT(*)::int as count FROM "Order" o
LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
WHERE ob.id IS NULL
```

This counts ALL orders that do not have a matching `ORDER_CREATED` outbox event — including orders created BEFORE the Outbox table existed (Wave-2 2a migration).

---

## Root Cause

The Outbox table was created in Sub-Wave 2a (`wave2-subwave-2a-migration.sql`). Orders created before that migration (seed data + testing orders) genuinely lack outbox events — they are NOT integrity violations, they are historical baseline.

The query has NO timestamp filter to exclude these pre-outbox orders. In production, if the outbox feature is deployed with existing orders, the `orphan-business-entity` alert would fire every 60 seconds (cooldown) indefinitely for all pre-outbox orders. This is an **alert storm risk**.

Source: `WAVE2_FINAL_AUDIT.md` §Audit 2 (lines 46-64).

---

## Authoritative Definition

**"Orphan business entity"** = an Order created AFTER the outbox feature was enabled, but which has NO corresponding `ORDER_CREATED` outbox event. This indicates a transactional integrity violation (the order was committed but the outbox event was not, or was lost).

**NOT an orphan:** An Order created BEFORE the outbox feature was enabled. These orders legitimately lack outbox events because the outbox pattern didn't exist when they were created.

---

## Impact Analysis

| Aspect | Impact |
|--------|--------|
| **False alerts** | YES — alert fires every 60s for every pre-outbox order (71 in staging) |
| **Data integrity** | NO — the query is read-only (detection only, no automatic repair) |
| **Business logic** | NO — alert-evaluator is decoupled from order/payment/capture flows |
| **Operational noise** | HIGH — alert storm would drown out real orphan detection |
| **Production enablement** | BLOCKING — must be fixed before production deployment |

---

## Proposed Fix

**1-line SQL change** in `mini-services/alert-evaluator/index.ts:183-186`:

**Current:**
```sql
SELECT COUNT(*)::int as count FROM "Order" o
LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
WHERE ob.id IS NULL
```

**Fixed:**
```sql
SELECT COUNT(*)::int as count FROM "Order" o
LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
WHERE ob.id IS NULL
  AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")
```

This only counts orders created AFTER the first outbox event was written — i.e., orders that SHOULD have an outbox event but don't.

**LOC:** ~3 lines changed (the `AND` clause spans 1-2 lines in the template literal).

---

## Schema/Migration Analysis

**NONE required.** The fix uses the existing `Order.createdAt` column (already exists) and `Outbox.createdAt` column (already exists). No new columns, no new indexes, no migration.

---

## Existing Invariant Impact

| Closed evidence | Impact | Safe? |
|-----------------|--------|-------|
| Wave-3 (3a/3b/3c) | NO — alert-evaluator is read-only, doesn't touch capture/order/payment flows | ✅ SAFE |
| Wave-4 4a (webhook) | NO — webhook handler doesn't use orphan_business_count | ✅ SAFE |
| Wave-4 4b (ledger) | NO — ledger formalization doesn't use orphan_business_count | ✅ SAFE |
| Wave-4 4c (retry invariant) | NO — retry invariant is about capture path, not alert-evaluator | ✅ SAFE |

No CLOSED evidence needs reopening.

---

## Evidence Plan

| Scenario | What it proves | New? | PostgreSQL? |
|----------|---------------|-------|-------------|
| 4d-E1: Positive — orphan detected after outbox enabled | Insert an order WITHOUT an outbox event (after outbox baseline) → alert fires | YES | YES (required) |
| 4d-E2: Negative — pre-outbox order NOT flagged | Verify pre-outbox orders are excluded by timestamp filter → alert does NOT fire | YES | YES (required) |
| 4d-E3: Cooldown — alert fires once per cycle, not continuously | Verify alert-evaluation-log shows exactly 1 fire per cooldown window | YES | Optional |

**Total:** 2-3 new scenarios. Can reuse the existing 2d reconciliation evidence infrastructure pattern (alert-evaluation-log inspection).

---

## PostgreSQL Verification Plan

Both 4d-E1 and 4d-E2 require PostgreSQL because:
1. The alert-evaluator uses PostgreSQL-specific syntax (`::int` cast)
2. The `Outbox` table is only populated on PostgreSQL staging (SQLite doesn't have the outbox publisher running)
3. The timestamp filter behavior depends on real `createdAt` values in PostgreSQL

**SQLite strategy:** Not applicable (alert-evaluator is a standalone mini-service that connects to the staging PostgreSQL DB directly).

---

## Rollback Plan

**Rollback:** `git revert` the commit. The change is backward-compatible — without the fix, the query returns the old (wider) count, which may produce false alerts but doesn't cause data loss or corruption.

**Feature flag:** Not needed — the fix is a query correction, not a new feature. If the alert-evaluator is not running (which it isn't in production), the fix has no effect.

---

## Risk Assessment

**LOW.**

Justification:
- The change is a 1-line SQL `WHERE` clause addition — no structural change to the query
- The alert-evaluator is a read-only observer — it doesn't modify any data
- The fix only narrows the result set (fewer false positives, same true positives)
- No schema change, no migration, no feature flag needed
- No existing CLOSED evidence is affected
- Blast radius: ZERO (alert-evaluator is a standalone mini-service, not in the critical path)

---

## D1–D10 Decisions

| ID | Question | Answer |
|----|----------|--------|
| **D1** | Where is `orphan_business_count` computed? | `mini-services/alert-evaluator/index.ts:183-186`. SQL: `SELECT COUNT(*) FROM "Order" o LEFT JOIN "Outbox" ob ON ... WHERE ob.id IS NULL`. "Orphan" = Order without ORDER_CREATED outbox event. |
| **D2** | Evidence/query correction or real data-integrity issue? | **Evidence/query correction**. The query itself is correct (it does find orphans), but it lacks a timestamp filter to exclude pre-outbox historical orders. This is a **measurement defect**, not a data-integrity issue. |
| **D3** | Can 4d be limited to evidence/invariant correction? | **YES** — 1-line SQL change in the alert-evaluator query. No application logic change. |
| **D4** | Schema/migration needed? | **NO** — uses existing columns (`Order.createdAt`, `Outbox.createdAt`). |
| **D5** | Affects Wave-3/4a/4b/4c CLOSED invariants? | **NO** — alert-evaluator is decoupled from all business flows. |
| **D6** | How many new scenarios? Which PostgreSQL? | 2-3 new scenarios. Both 4d-E1 and 4d-E2 require PostgreSQL (alert-evaluator is PG-specific). |
| **D7** | Existing evidence reopen? | **NO** — no closed evidence is affected. |
| **D8** | Required before production? | **YES** — alert storm risk would make the alert-evaluator unusable in production. |
| **D9** | Risk? | **LOW** — 1-line read-only query fix, no blast radius. |
| **D10** | Recommendation | **GO** |

---

## Final Recommendation

# **GO**

The fix is a 1-line SQL `WHERE` clause addition in `mini-services/alert-evaluator/index.ts:183-186`. No schema change, no migration, no feature flag, no application logic change. Risk is LOW. Blast radius is ZERO (read-only observer). No existing CLOSED evidence is affected. The fix is a production-launch prerequisite (alert storm risk).

---

## Governance Compliance

| Constraint | Status |
|-----------|--------|
| No source-code modification | ✅ (only `.md` files written) |
| No schema modification | ✅ |
| No migration created | ✅ |
| No evidence tests run | ✅ |
| No production deploy | ✅ |
| `realPayments` OFF | ✅ |
| `webhookHandler` OFF in production | ✅ |
| `requestHashEnforcement` OFF in production | ✅ |
| Wave-5 NOT started | ✅ |
| 4a/4b/4c evidence NOT reopened | ✅ |
| Lint N/A (no code changes) | ✅ |
| Worklog appended | ✅ |
