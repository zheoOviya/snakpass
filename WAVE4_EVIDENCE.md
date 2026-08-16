# Wave-4 Evidence Document

**Status:** 🟡 Sub-Wave 4a — Evidence-Complete (4/4 SQLite PASS + PostgreSQL PASS, awaiting Orchestrator S5 review)
**Created:** 2026-08-16
**Sub-Wave 4a Evidence Complete:** 2026-08-16
**Authorization:** Orchestrator Decision (Wave-4 implementation authorized, 4a P0-05 Webhook Handler)

> **Governance rule:** This document is NOT pre-filled with fabricated evidence.

---

## 1. Wave-4 Sub-Wave Status

| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 4a | P0-05 Webhook handler (HMAC verify + dedup + idempotent processing) | 🟡 Evidence-Complete (awaiting S5 review) |
| 4b | P0-02 Ledger formalization | 🔒 LOCKED (not yet authorized) |
| 4c | TRANSACTION_RETRY_INVARIANT mitigation | 🟡 CONDITIONALLY AUTHORIZED (after 4a/4b) |
| 4d | orphan_business_count fix | 🟢 AUTHORIZED (folded into 4b/4c) |

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
