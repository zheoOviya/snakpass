# Wave-4 Evidence Document

**Status:** 🟢 4a S5 PASS / CLOSED | 🟢 4b S5 PASS / CLOSED | 🟢 4c S5 PASS / CLOSED
**Created:** 2026-08-16
**Sub-Wave 4a Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Sub-Wave 4b Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Sub-Wave 4c Closure:** 2026-08-16 (Orchestrator S5 PASS decision)
**Authorization:** Orchestrator Decision (4a + 4b + 4c S5 PASS / CLOSED)

> **Governance rule:** This document is NOT pre-filled with fabricated evidence.

---

## 1. Wave-4 Sub-Wave Status

| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 4a | P0-05 Webhook handler (HMAC verify + dedup + idempotent processing) | ✅ S5 PASS / CLOSED |
| 4b | P0-02 Ledger formalization | ✅ S5 PASS / CLOSED |
| 4c | TRANSACTION_RETRY_INVARIANT mitigation | ✅ S5 PASS / CLOSED |
| 4d | orphan_business_count fix | 🔒 PENDING (awaiting authorization) |

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
