# Wave-4 Evidence Document

**Status:** 🟢 ALL SUB-WAVES S5 PASS / CLOSED — Wave-4 COMPLETE
**Created:** 2026-08-16
**Sub-Wave 4a Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Sub-Wave 4b Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Sub-Wave 4c Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Sub-Wave 4d Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Authorization:** Orchestrator Decision (4a + 4b + 4c + 4d S5 PASS / CLOSED — Wave-4 COMPLETE)

> **Governance rule:** This document is NOT pre-filled with fabricated evidence.

---

## 1. Wave-4 Sub-Wave Status

| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 4a | P0-05 Webhook handler (HMAC verify + dedup + idempotent processing) | ✅ S5 PASS / CLOSED |
| 4b | P0-02 Ledger formalization | ✅ S5 PASS / CLOSED |
| 4c | TRANSACTION_RETRY_INVARIANT mitigation | ✅ S5 PASS / CLOSED |
| 4d | orphan_business_count fix | ✅ S5 PASS / CLOSED |

---

## 2. Sub-Wave 4a — P0-05 Webhook Handler Evidence

### Implementation Summary

| Component | File | Purpose |
|-----------|------|---------|
| Schema migration | `prisma/schema.prisma` + `prisma/scripts/wave4-subwave-4a-migration.sql` | +`processedBy String?` + `processingNotes String?` on WebhookEvent (Class-2 additive) |
| Webhook route | `src/app/api/webhooks/razorpay/route.ts` | POST handler: HMAC verify + dedup via eventId + idempotent processing |
| Webhook processor | `src/lib/webhook-processor.ts` | payment.captured/failed/refund.processed event handlers |
| HMAC verification | `src/lib/razorpay.ts` | `verifyWebhookSignature()` with constant-time comparison |
| Feature flag | `src/lib/deployment.ts` | `webhookHandler` (default OFF) |
| Evidence endpoints | `src/app/api/webhooks/evidence-setup/` + `evidence-verify/` | Test setup + state verification (EVIDENCE_TEST_MODE gated) |
| Middleware | `src/middleware.ts` | Skip CSRF for `/api/webhooks/` (HMAC is auth mechanism) |
| Evidence runner | `scripts/wave4-4a-evidence.mjs` | 4 SQLite tests |
| PostgreSQL workflow | `.github/workflows/subwave-4a-postgresql-concurrent-evidence.yml` | 5-concurrent webhook test on staging PostgreSQL |
| Staging migration | `.github/workflows/wave4-4a-staging-migration.yml` | Applied processedBy + processingNotes columns |

### SQLite Evidence (Local) — 4/4 PASS

- **Run ID:** `4a-ev-1786844765903-4acf9ce1`
- **Self-validating JSON:** `evidence/wave4-4a/evidence-4a-ev-1786844765903-4acf9ce1.json`
- **Result:** `ok: true` (all 4 tests PASSED)

#### 4a-E1: Webhook Dedup — ✅ PASS
- Same event_id → 1 WebhookEvent + 1 Payment update (CAPTURED). Duplicate webhook returned status='duplicate'.

#### 4a-E2: Webhook Signature Mismatch — ✅ PASS
- Empty signature → 403 AUTHORIZATION_DENIED. Payment not updated (still PAYMENT_PENDING).

#### 4a-E3: Webhook Processing — ✅ PASS
- payment.captured webhook → Payment CAPTURED + capturedAt set + Outbox PAYMENT_CAPTURE_CONFIRMED + 2 AuditLogs (WEBHOOK_RECEIVED + WEBHOOK_PAYMENT_CAPTURED).

#### 4a-E4: Concurrent Duplicates — ✅ PASS
- 5 concurrent same event_id → exactly 1 WebhookEvent + 1 Payment update. 1 processed, 4 deduped.

### PostgreSQL-Native Evidence — ✅ PASS

- **Workflow:** `.github/workflows/subwave-4a-postgresql-concurrent-evidence.yml`
- **Run ID:** `31921274765` (GitHub Actions run)
- **Database:** PostgreSQL (Supabase staging, project ref `zmzqqcyapcezmaqvuzzd`)
- **Staging URL:** Fresh Vercel preview deployment (EVIDENCE_TEST_MODE=true + FEATURE_WEBHOOK_HANDLER=true)
- **Evidence JSON:** `evidence/wave4-4a/evidence-postgresql-4a-pg-ev.json`
- **Result:** `ok: true` ✅

#### 4a-PG-E1: 5 Concurrent Webhooks on PostgreSQL — ✅ PASS

```json
{
  "ok": true,
  "database": "postgresql",
  "orchestratorRequiredFields": {
    "database": "postgresql",
    "concurrentRequests": 5,
    "uniqueWebhookEvents": 1,
    "webhookEventCount": 1,
    "paymentCaptured": true,
    "outboxEventCount": 1,
    "auditLogCount": 2,
    "no422Errors": true
  }
}
```

### 4a Evidence Summary

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Webhook dedup (same event_id → 1 processing) | ✅ PASS | SQLite 4a-E1 + PostgreSQL 4a-PG-E1 |
| 2 | HMAC signature mismatch → 403 reject | ✅ PASS | SQLite 4a-E2 |
| 3 | payment.captured → Payment CAPTURED + Outbox + AuditLog | ✅ PASS | SQLite 4a-E3 |
| 4 | 5 concurrent → exactly 1 WebhookEvent + 1 Payment update | ✅ PASS | SQLite 4a-E4 + PostgreSQL 4a-PG-E1 |
| 5 | PostgreSQL-native concurrency | ✅ PASS | `evidence/wave4-4a/evidence-postgresql-4a-pg-ev.json` (run 31921274765) |
| 6 | webhookHandler flag default OFF | ✅ PASS | `deployment.ts` (default false) |
| 7 | realPayments not enabled | ✅ PASS | `realPayments=false` throughout |
| 8 | No production deployment | ✅ PASS | Staging only |
| 9 | 3a/3b/3c evidence NOT re-run | ✅ PASS | Reused, not re-proven |
| 10 | Lint PASS | ✅ PASS | `bun run lint` clean |
| 11 | Schema/env restored to production state | ✅ PASS | postgresql provider + clean .env |

**Sub-Wave 4a: ALL EVIDENCE CRITERIA PASS. PostgreSQL-native webhook concurrency PROVEN.**

### Governance State (awaiting Orchestrator S5 review)

```text
Wave-4        🟢 IMPLEMENTATION AUTHORIZED (4a only)

Sub-Wave 4a   🟡 EVIDENCE-COMPLETE — awaiting Orchestrator S5 review
              ├─ SQLite evidence: ✅ 4/4 PASS
              ├─ PostgreSQL evidence: ✅ PASS (5 concurrent webhooks)
              ├─ webhookHandler flag: ✅ OFF (default, production NOT enabled)
              └─ HMAC verification: ✅ IMPLEMENTED (constant-time)

Sub-Wave 4b   🔒 LOCKED — NOT YET AUTHORIZED
Sub-Wave 4c   🟡 CONDITIONALLY AUTHORIZED (after 4a/4b)
Sub-Wave 4d   🟢 AUTHORIZED (folded into 4b/4c)

Production    🚫 NOT AUTHORIZED
realPayments  🚫 OFF
webhookHandler (production) 🚫 OFF
```

**STOP — IDE is not self-closing 4a. Awaiting Orchestrator S5 decision.**

---

## 3. Sub-Wave 4a — S5 PASS / CLOSED (Orchestrator Decision)

> **ORCHESTRATOR DECISION — Sub-Wave 4a = S5 PASS / EVIDENCE-COMPLETE / CLOSED.**

**Date:** 2026-08-16
**Decision:** Sub-Wave 4a (P0-05 Webhook Handler) authorized scope fulfilled. Declared **S5 PASS** and **CLOSED**.

### Decisive Evidence

- **PostgreSQL Evidence:** `evidence/wave4-4a/evidence-postgresql-4a-pg-ev.json` (`ok: true`, `database: postgresql`)
- **Workflow:** GitHub Actions run `31921274765`
- **Staging Migration:** GitHub Actions run `31921235580`

### Proven

```text
concurrentRequests = 5
uniqueWebhookEvents = 1
webhookEventCount = 1
paymentCaptured = true
outboxEventCount = 1
auditLogCount = 2
no422Errors = true
ok = true
database = postgresql
```

### Important Production Boundary

**S5 PASS का अर्थ production authorization नहीं है।**
- `webhookHandler` = OFF in production (enablement is a separate Orchestrator decision)
- Production deployment = NOT AUTHORIZED
- `realPayments` = OFF

4a will NOT reopen for evidence.

---

## 4. Sub-Wave 4b — P0-02 Ledger Formalization (Implementation Authorized)

> **Orchestrator authorized Sub-Wave 4b implementation.**
> Scope: P0-02 ledger formalization evidence + `orphan_business_count` fix (if bounded/mechanically related).
> 4c NOT started. Production NOT touched. `realPayments` OFF. `webhookHandler` OFF in production.
> PostgreSQL-native evidence REQUIRED for S5.
> After implementation + evidence, STOP and report to Orchestrator. Do NOT self-close.

### Status: 🟡 IMPLEMENTATION IN PROGRESS

(Evidence will be appended after implementation + SQLite + PostgreSQL tests pass.)

---

## 5. Sub-Wave 4b — S5 PASS / CLOSED (Orchestrator Decision)

> **ORCHESTRATOR DECISION — Sub-Wave 4b = S5 PASS / EVIDENCE-COMPLETE / CLOSED.**

**Date:** 2026-08-16
**Decision:** Sub-Wave 4b (P0-02 Ledger Formalization) authorized scope fulfilled. Declared **S5 PASS** and **CLOSED**.

### Decisive Evidence

- **PostgreSQL Evidence:** `evidence/wave4-4b/evidence-postgresql-4b-pg-ev.json` (`ok: true`, `database: postgresql`)
- **Workflow:** GitHub Actions run `31922913773`

### Proven

```text
concurrentRequests = 5
paymentCount = 5
ledgerEntryCount = 10
ledgerDrCount = 5
ledgerCrCount = 5
ledgerBalanceIntact = true
noOrphanLedgerEntries = true
ok = true
database = postgresql
```

4b will NOT reopen for evidence.

---

## 6. Sub-Wave 4c — Transaction Retry Invariant Mitigation (Implementation Authorized)

> **Orchestrator authorized Sub-Wave 4c implementation.**
> Primary objective: Move `captureRazorpayPayment()` out of `withTransaction()` body.
> SQLite + PostgreSQL evidence REQUIRED. No production. realPayments OFF.

### ✅ S5 PASS / CLOSED (Orchestrator Decision — 2026-08-16)

**Decisive Evidence:**
- **SQLite:** 5/5 PASS (E1-E5)
- **PostgreSQL:** PASS (E1/E4/E5 concurrent + publisher retry)
- **Workflow runs:** 31925497313 (E1/E4), 31927563085 (E5)

#### 4c Evidence Summary

| # | Scenario | Status | Evidence |
|---|----------|--------|----------|
| 4c-E1 | Capture returns CAPTURE_PENDING (not CAPTURED) | ✅ PASS | SQLite + PostgreSQL |
| 4c-E2 | Payment state consistent (Dr/Cr + balance + idempotency) | ✅ PASS | SQLite |
| 4c-E3 | Idempotency preserved (same key → same Payment) | ✅ PASS | SQLite |
| 4c-E4 | 5 concurrent → exactly 1 Payment, no duplicate | ✅ PASS | SQLite + PostgreSQL |
| **4c-E5** | **Publisher retry → no duplicate capture** | **✅ PASS** | **SQLite + PostgreSQL** |

#### E5 Key Proof

```text
Publisher attempt #1:
    captureCalled = true     → external side-effect executed
    Payment → CAPTURED
Publisher retry:
    captureCalled = false    → external side-effect NOT repeated ✅
    idempotencySkipped = true → Payment.status === CAPTURED check prevented duplicate ✅
```

4c will NOT reopen for evidence.

---

## 7. Sub-Wave 4d — orphan_business_count Fix (Evidence-Complete)

> **Sub-Wave 4d evidence captured via GitHub Actions run 31935166775.**
> Workflow: `.github/workflows/subwave-4d-postgresql-evidence.yml`
> Fix: 1-line SQL `WHERE` clause addition in `mini-services/alert-evaluator/index.ts:191`
>   `AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")`
> No schema change. No migration. No feature flag. No application logic change.
> Risk: LOW (read-only query fix, zero blast radius).
> PostgreSQL-native evidence REQUIRED for S5.
> After evidence capture, STOP and report to Orchestrator. Do NOT self-close.

### Status: ✅ S5 PASS / CLOSED (Orchestrator Decision — 2026-08-16)

4d will NOT reopen for evidence.

- **Workflow:** GitHub Actions run `31935166775`
- **Job ID:** `95135808149` — "4d-PG — Orphan business count fix verification on PostgreSQL"
- **Job window:** started 2026-08-16T07:56:23Z, completed 2026-08-16T07:58:00Z (~1m37s)
- **Conclusion:** ✅ success
- **Database:** PostgreSQL (Supabase staging, project ref `zmzqqcyapcezmaqvuzzd`)
- **Staging URL:** `https://snakpass-476kyssdf-snakzap.vercel.app`
- **Evidence JSON:** `evidence/wave4-4d/evidence-postgresql-4d-pg-ev.json`
- **Run ID:** `4d-pg-ev-1786867070`
- **Timestamp:** 2026-08-16T07:57:57Z

#### 4d Evidence Summary

| # | Scenario | Status | Evidence |
|---|----------|--------|----------|
| 4d-E1 | Historical baseline exclusion (pre-outbox orders NOT counted) | ✅ PASS | PostgreSQL |
| 4d-E2 | Genuine orphan detection (post-outbox orphan IS detected) | ✅ PASS | PostgreSQL |
| 4d-E3 | Mixed population correctness (valid order WITH outbox NOT counted) | ✅ PASS | PostgreSQL |

#### 4d-E1: Historical Baseline Exclusion — ✅ PASS

```json
{
  "name": "Historical baseline exclusion",
  "passed": true,
  "oldOrphanCount": 78,
  "newOrphanCount": 7,
  "preOutboxOrderCount": 72,
  "description": "Pre-outbox orders should NOT be counted as orphans"
}
```

#### 4d-E2: Genuine Orphan Detection — ✅ PASS

```json
{
  "name": "Genuine orphan detection",
  "passed": true,
  "orphanCountAfterInsert": 8,
  "description": "Post-outbox order without outbox event SHOULD be detected"
}
```

#### 4d-E3: Mixed Population Correctness — ✅ PASS

```json
{
  "name": "Mixed population correctness",
  "passed": true,
  "orphanCountAfterMixed": 8,
  "expectedCount": 8,
  "description": "Valid order WITH outbox event should NOT be counted as orphan"
}
```

#### Decisive Evidence (orchestrator-required fields)

```text
database = postgresql
historicalExclusionWorking = true
genuineOrphanDetected = true
mixedPopulationCorrect = true
ok = true
```

#### Baseline

```text
oldOrphanCount = 78
newOrphanCount = 7
outboxBaseline = 2026-08-15 05:56:51.55
totalOrders = 90
preOutboxOrderCount = 72
```

#### Governance

```text
realPaymentsEnabled = false
productionTouched = false
schemaChanged = false
migrationCreated = false
note = "4d evidence: orphan_business_count timestamp filter fix verified on staging PostgreSQL. Test data cleaned up. No production traffic touched."
```

### Governance State (awaiting Orchestrator S5 review)

```text
Wave-4        🟢 IMPLEMENTATION AUTHORIZED (4d fold-in)

Sub-Wave 4d   🟡 EVIDENCE-COMPLETE — awaiting Orchestrator S5 review
              ├─ 4d-E1: Historical baseline exclusion ✅ PASS
              ├─ 4d-E2: Genuine orphan detection ✅ PASS
              ├─ 4d-E3: Mixed population correctness ✅ PASS
              ├─ Fix: 1-line SQL WHERE clause addition (read-only)
              └─ No schema/migration/feature-flag needed

Production    🚫 NOT AUTHORIZED
realPayments  🚫 OFF
```

**STOP — IDE is not self-closing 4d. Awaiting Orchestrator S5 decision.**

---

## 8. Wave-4 — COMPLETE / ALL SUB-WAVES S5 PASS / CLOSED

> **ORCHESTRATOR DECISION — Wave-4 = ALL SUB-WAVES S5 PASS / CLOSED.**

**Date:** 2026-08-16

### Final Governance State

```text
Wave-0        ✅ CLOSED
Wave-1        ✅ CLOSED
Wave-2        ✅ CLOSED
Wave-3        ✅ COMPLETE / CLOSED

Wave-4        ✅ COMPLETE / ALL SUB-WAVES CLOSED
              ├─ 4a  ✅ Webhook handler (P0-05)
              ├─ 4b  ✅ Ledger formalization (P0-02)
              ├─ 4c  ✅ Transaction retry invariant mitigation
              └─ 4d  ✅ orphan_business_count correction

Production               🚫 NOT AUTHORIZED
realPayments             🚫 OFF
webhookHandler           🚫 OFF in production
requestHashEnforcement   🚫 OFF in production
Wave-5                   🔒 LOCKED
```

### Wave-4 Closure ≠ Production Authorization

Wave-4 completion does NOT authorize production enablement. Specifically:
- `realPayments=true` ❌ NOT AUTHORIZED
- production `webhookHandler=true` ❌ NOT AUTHORIZED
- production `requestHashEnforcement=true` ❌ NOT AUTHORIZED
- production migration/deployment ❌ NOT AUTHORIZED
- Wave-5 ❌ NOT STARTED

Production readiness is a separate governance decision.

**IDE: STOP. Wave-4 is COMPLETE. No further implementation authorized.**
