# Wave-2 Final Audit Report — READ/VERIFY-ONLY

**Date:** 2026-08-15
**Auditor:** IDE (read-only, Orchestrator-authorized)
**Scope:** Final audit of Sub-Wave 2d implementation + evidence + Wave-2 closure readiness
**Constraint:** No code changes, no deployment, no flag changes, no production access

---

## Audit Summary

| # | Audit Item | Finding | Status |
|---|-----------|---------|--------|
| 1 | Exact SQL for reconciliation queries | Documented below | ✅ Verified |
| 2 | Historical pre-outbox orders handling | NOT excluded — architecture defect identified | 🟡 DEFECT |
| 3 | Production alert storm risk | HIGH risk if deployed to production with historical orders | 🟡 RISK |
| 4 | Raw alert payloads | Captured with ruleId, severity, count, threshold | ✅ Verified |
| 5 | /api/test/* production guards | VERCEL_ENV guard in place | ✅ Verified |
| 6 | No DELETE/UPDATE in reconciliation | SELECT-only ($queryRaw) | ✅ Verified |
| 7 | Production config/database untouched | Preview-only env vars + staging-only migrations | ✅ Verified |
| 8 | WAVE2_EVIDENCE.md vs implementation | All claims match implementation files | ✅ Verified |
| 9 | "No false positives" claim vs 71 orders | INACCURATE — corrected below | 🟡 CORRECTED |

---

## Audit 1: Exact SQL

### orphan_business_count (alert-evaluator/index.ts:183-186)
```sql
SELECT COUNT(*)::int as count FROM "Order" o
LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
WHERE ob.id IS NULL
```

### orphan_outbox_count (alert-evaluator/index.ts:197-200)
```sql
SELECT COUNT(*)::int as count FROM "Outbox" ob
LEFT JOIN "Order" o ON o.id = ob."aggregateId"
WHERE ob."aggregateType" = 'Order' AND o.id IS NULL
```

**Finding:** Both queries are pure SELECT (COUNT + LEFT JOIN + IS NULL). No timestamp filtering. No historical baseline exclusion.

---

## Audit 2: Historical Pre-Outbox Orders Handling

**Finding:** The `orphan_business_count` query does NOT exclude historical orders. It counts ALL orders without a matching outbox event, regardless of when they were created.

- The Outbox table was created in Sub-Wave 2a (wave2-subwave-2a-migration.sql)
- 71 staging orders were created BEFORE the Outbox table existed (seed data + testing)
- These 71 orders genuinely lack outbox events — the query correctly identifies them
- But they are NOT new integrity violations — they are historical baseline

**Architecture Defect:** In production, if the outbox feature is deployed with existing orders, the `orphan-business-entity` alert would fire every 60 seconds (cooldown) indefinitely for all pre-outbox orders. This is an alert storm risk.

**Recommended Fix (not implementing — read-only audit):**
```sql
SELECT COUNT(*)::int as count FROM "Order" o
LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
WHERE ob.id IS NULL
  AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")
```
This would only flag orders created AFTER the outbox feature was enabled.

---

## Audit 3: Production Alert Storm Risk

**Risk:** HIGH (if deployed to production with historical orders)
- Current threshold: 0 (any orphan triggers alert)
- Current cooldown: 60s (re-fires every minute)
- Pre-existing orders in staging: 71 (would be similar in production)

**Mitigation:** The defect is NOT blocking Wave-2 closure because:
1. Production deployment is NOT authorized
2. The fix (timestamp exclusion) is straightforward
3. The alert is detection-only (no automatic repair/deletion)
4. The orphan_outbox_count query does NOT have this problem (all outbox events have corresponding orders)

**Must be fixed BEFORE production deployment.**

---

## Audit 4: Raw Alert Payloads

### 2d-4a: orphan-business-entity alert
```json
{
  "timestamp": "2026-08-15T11:48:48.239Z",
  "level": "error",
  "type": "ALERT",
  "severity": "critical",
  "ruleId": "orphan-business-entity",
  "name": "Orphan Business Entity",
  "context": {
    "metric": "orphan_business_count",
    "value": 71,
    "threshold": 0
  }
}
```

### 2d-4b: orphan-outbox-event alert
```json
{
  "timestamp": "2026-08-15T11:49:13.329Z",
  "level": "error",
  "type": "ALERT",
  "severity": "critical",
  "ruleId": "orphan-outbox-event",
  "name": "Orphan Outbox Event",
  "context": {
    "metric": "orphan_outbox_count",
    "value": 1,
    "threshold": 0
  }
}
```

### Negative control cycle JSON (orphan results)
```json
{
  "ruleId": "orphan-business-entity",
  "metric": "orphan_business_count",
  "value": 71,
  "threshold": 0,
  "triggered": true,
  "alertFired": true
},
{
  "ruleId": "orphan-outbox-event",
  "metric": "orphan_outbox_count",
  "value": 0,
  "threshold": 0,
  "triggered": false,
  "alertFired": false
}
```

---

## Audit 5: /api/test/* Production Guards

| Endpoint | Guard | Verified |
|----------|-------|----------|
| `/api/test/rollback-injection` | `VERCEL_ENV === 'production'` → 403 | ✅ |
| `/api/test/consume-event` | `VERCEL_ENV === 'production'` → 403 | ✅ |
| CSRF middleware | Skip list includes `rollback-injection` + `consume-event` | ✅ |

**Finding:** Test endpoints are guarded. Production access would return 403 FORBIDDEN.

---

## Audit 6: Detection-Only (No Repair)

**Finding:** Reconciliation queries use `db.$queryRaw` with `SELECT COUNT(*)` — pure read-only. No `DELETE`, `UPDATE`, `INSERT`, or any mutation in the orphan detection code path.

**Verified:** `grep -n "DELETE\|UPDATE\|delete\|update\|repair\|fix"` in alert-evaluator → zero matches in orphan detection section.

---

## Audit 7: Production Untouched

| Item | Status |
|------|--------|
| Vercel env vars | FEATURE_OUTBOX_PUBLISHER set on **preview** only |
| Supabase migrations | Applied to **staging** project (zmzqqcyapcezmaqvuzzd) only |
| Production DATABASE_URL | NOT modified (still uses postgres superuser) |
| Production deployment | NOT triggered (all deploys used target=staging) |
| Production flag | NOT set (VERCEL_ENV=production blocks test endpoints) |

---

## Audit 8: WAVE2_EVIDENCE.md vs Implementation

| Claim | Implementation File | Verified |
|-------|-------------------|----------|
| Outbox model | prisma/schema.prisma: `model Outbox` | ✅ |
| enqueueOutboxEvent | src/lib/outbox.ts: 5 matches | ✅ |
| Outbox in 3 routes | orders/route.ts + status/route.ts + kill-switches/route.ts | ✅ (6 matches) |
| ProcessedEvent model | prisma/schema.prisma: `model ProcessedEvent` | ✅ |
| processEvent | src/lib/event-consumer.ts: 4 matches | ✅ |
| Publisher worker | mini-services/outbox-publisher/index.ts | ✅ |
| Lease fields | prisma/schema.prisma: claimedAt, claimUntil, workerId | ✅ |
| Orphan queries | alert-evaluator: 4 matches | ✅ |
| Orphan alert rules | src/lib/alerting.ts: 2 matches | ✅ |
| All evidence workflows | 6 .yml files exist | ✅ |

---

## Audit 9: "No False Positives" Claim vs 71 Historical Orders

**Original claim in WAVE2_EVIDENCE.md:** "Negative control (no false positives) ✅"

**Actual evidence:**
- `orphan_business_count = 71` — alert DID fire in negative control
- `orphan_outbox_count = 0` — alert did NOT fire (correct)

**Assessment:** The claim "no false positives" is **INACCURATE** for orphan-business-entity. The alert correctly fired because 71 orders genuinely lack outbox events. This is not a false positive — it's correct detection of a known historical baseline. But the claim should not say "no false positives."

**Corrected claim:**
> "Negative control: no UNEXPECTED orphan outbox events detected (orphan_outbox_count=0 in baseline). Pre-existing orphan business entities (71 orders from before outbox feature) are correctly detected — this is known historical baseline, not a false positive. The orphan-business-entity alert fires on these 71 orders, which is correct behavior but would cause an alert storm in production if not fixed."

---

## Final Recommendation

### GO / CONDITIONAL-GO / NO-GO

**CONDITIONAL-GO**

**Rationale:**
- ✅ All 16 P0-24 test criteria are empirically verified with ok:true
- ✅ All code implementation matches WAVE2_EVIDENCE.md claims
- ✅ Production is untouched
- ✅ Detection-only (no repair)
- ✅ Test endpoints guarded
- 🟡 Architecture defect: orphan_business_count does not exclude historical orders → alert storm risk in production
- 🟡 Evidence claim "no false positives" is inaccurate → corrected

**Conditions for Wave-2 closure:**
1. The orphan_business_count query defect is documented as a known issue (not blocking Wave-2 closure because production is not authorized)
2. The fix (timestamp exclusion) is recorded as a Phase-3 production-launch prerequisite
3. The "no false positives" claim is corrected in WAVE2_EVIDENCE.md
4. Wave-2 closure explicitly notes: "orphan_business_count historical baseline handling must be fixed before production deployment"

**If these conditions are accepted, Wave-2 can be declared PASS / S5 Evidence-Complete / CLOSED.**

---

## Phase-3 Prerequisites (carried forward from Wave-2)

1. Fix orphan_business_count query to exclude pre-outbox orders (timestamp filter)
2. Fix production DATABASE_URL to use snakzap_app (not postgres superuser)
3. Deploy realtime service to Fly.io
4. Switch publisher from HTTP transport to Socket.io transport for production
5. Payment + Ledger atomicity (requires Wave-3 P0-01)
