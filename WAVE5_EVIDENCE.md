# Wave-5 Evidence Document

**Status:** 🟡 Wave-5 AUTHORIZED — Sub-Wave 5a (P0-04 Refund) evidence-complete (awaiting Orchestrator S5 review)
**Created:** 2026-08-16
**Sub-Wave 5a Implementation:** 2026-08-16 (IDE — task ID `wave5a-p0-04-refund`)
**Authorization:** Orchestrator Decision — Wave-5 AUTHORIZED (P0-04 Refund + P0-03 Reconciliation). P0-04 IMPLEMENTED FIRST.

> **Governance rule:** This document is NOT pre-filled with fabricated evidence. Each row reflects actual evidence artifacts committed to the repo and (for PostgreSQL) actual GitHub Actions runs against the staging Supabase database.

> **Production boundary:** `realPayments` remains OFF (demo mode). `webhookHandler` remains OFF. `requestHashEnforcement` remains OFF. No production flag activation. No Wave-6/7. After P0-04 evidence package: STOP and request Orchestrator S5 review.

---

## 1. Wave-5 Sub-Wave Status

| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 5a | P0-04 Refund flow (mirror of 4c capture pattern) | 🟡 Evidence-Complete (SQLite E1-E5 PASS / PostgreSQL pending Orchestrator trigger) |
| 5b | P0-03 Reconciliation | 🔒 PENDING — separate evidence package required (NOT started) |

---

## 2. Sub-Wave 5a — P0-04 Refund Flow Evidence

### Architecture (mirrors Wave-4 4c capture)

The refund flow is a deliberate structural mirror of the capture flow's 4c architecture. The two flows share the same outbox publisher infrastructure, the same idempotency pattern (3c), the same double-entry ledger invariant (I-06), and the same `TRANSACTION_RETRY_INVARIANT` safety property (external HTTP call OUTSIDE any DB transaction body).

| Capture (Wave-4 4c) | Refund (Wave-5 5a) |
|----------------------|---------------------|
| `POST /api/payments` (capture route) | `POST /api/payments/refund` (refund route) |
| Payment.status: `PAYMENT_PENDING → CAPTURE_PENDING → CAPTURED` | Refund.status: `REFUND_PENDING → REFUNDED` (Payment.status: `CAPTURED → REFUNDED` for full refund) |
| `captureRazorpayPayment()` outside txn | `refundRazorpayPayment()` outside txn |
| Outbox event `PAYMENT_CAPTURE_REQUESTED` | Outbox event `PAYMENT_REFUND_REQUESTED` |
| Audit `PAYMENT_CAPTURE_PENDING` + `PAYMENT_CAPTURED` | Audit `PAYMENT_REFUND_PENDING` + `PAYMENT_REFUNDED` |
| LedgerEntry pair: Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE | Reversal pair: Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE (reversed) |

### Implementation Summary

| Component | File | Purpose |
|-----------|------|---------|
| Prisma model | `prisma/schema.prisma` (Refund model + Payment.refunds 1:N relation) | Refund lifecycle (REFUND_PENDING → REFUNDED \| FAILED) with idempotencyKey unique + race-safe version |
| Migration SQL | `prisma/scripts/wave5-subwave-5a-migration.sql` | Class-2 ADDITIVE: new Refund table + FK to Payment + indexes + grants |
| Gateway helper | `src/lib/razorpay.ts` → `refundRazorpayPayment()` | Demo-mode mock / real-mode `instance.payments.refund()` call (called OUTSIDE any txn) |
| Refund route | `src/app/api/payments/refund/route.ts` | POST /api/payments/refund — atomic txn writes Refund + reversal Dr/Cr + AuditLog + Outbox + IdempotencyKey |
| Publisher handler | `mini-services/outbox-publisher/index.ts` → `processPaymentRefundRequested()` | Reads Refund → idempotency check → calls `refundRazorpayPayment()` outside txn → success txn transitions Refund + Payment + AuditLog + Outbox PUBLISHED |
| Publisher dispatch | `mini-services/outbox-publisher/index.ts` (COMMAND_EVENT_TYPES set + dispatch loop) | Added `PAYMENT_REFUND_REQUESTED` to command-event set; routed to `processPaymentRefundRequested()` |
| Evidence setup | `src/app/api/payments/evidence-setup/route.ts` | Added `refund-full` / `refund-partial` scenarios that pre-create a CAPTURED Payment (+ capture Dr/Cr + AuditLog) so evidence runner can focus on the refund flow |
| Evidence verify | `src/app/api/payments/evidence-verify/route.ts` | Extended to verify Refund state, reversal Dr/Cr, PAYMENT_REFUND_PENDING + PAYMENT_REFUNDED audit, PAYMENT_REFUND_REQUESTED outbox, refund idempotency record |
| Evidence publisher-run | `src/app/api/payments/evidence-publisher-run/route.ts` | Added `mode=refund` + `refundId` query params — simulates `processPaymentRefundRequested()` for E5 testing |
| Evidence runner (SQLite) | `scripts/wave5-5a-evidence.mjs` | E1-E5 evidence runner (5 scenarios) |
| Evidence runner wrapper | `scripts/run-5a-evidence.sh` | Bash wrapper: flips schema to SQLite, pushes schema, seeds, starts dev server with `EVIDENCE_TEST_MODE=true`, runs evidence, restores PostgreSQL schema |
| Staging migration workflow | `.github/workflows/wave5-5a-staging-migration.yml` | Manual workflow: applies `wave5-subwave-5a-migration.sql` to staging Supabase via Management API |
| PostgreSQL evidence workflow | `.github/workflows/subwave-5a-postgresql-evidence.yml` | Manual workflow: triggers Vercel preview deployment with EVIDENCE_TEST_MODE=true, runs E1-E5 against staging Supabase, emits self-validating evidence JSON |

### Invariants verified

| # | Invariant | Source | 5a-Evidence |
|---|-----------|--------|-------------|
| I-04 | Capture Uniqueness (and Refund Uniqueness per payment+key) | P0_TRACEABILITY_MAP | 5a-E3 (idempotency), 5a-E4 (concurrent) |
| I-06 | Ledger double-entry balance (Dr sum === Cr sum per payment) | P0_TRACEABILITY_MAP | 5a-E2 (post-reversal ledger balanced), 5a-E5 (post-publisher ledger balanced) |
| TRANSACTION_RETRY_INVARIANT | External side-effect NOT inside withTransaction body | docs/TRANSACTION_RETRY_INVARIANT.md | 5a-E5 (publisher retry → no duplicate refund call) |
| Idempotent Business Effect | Same input → same business effect, even on retry | Architectural Law 2 | 5a-E3, 5a-E4, 5a-E5 |
| Atomic writes | Refund + reversal Dr/Cr + AuditLog + Outbox + IdempotencyKey commit in SAME txn | P0-24 outbox pattern | 5a-E2 |

### SQLite evidence (local)

| Run ID | Artifact | Result | Tests |
|--------|----------|--------|-------|
| `5a-1786874767980-fbc2ef75` | `evidence/wave5-5a/evidence-E1-E5-5a-1786874767980-fbc2ef75.json` | ✅ ok=true | 5/5 PASS |

Per-scenario results (SQLite):
- ✅ **5a-E1** Refund returns REFUND_PENDING — `Refund.status === 'REFUND_PENDING'` returned to client.
- ✅ **5a-E2** Payment state consistent (atomic writes) — Refund + reversal Dr CONSUMER_REVENUE (1) + reversal Cr GATEWAY_RECEIVABLE (1) + PAYMENT_REFUND_PENDING AuditLog + PAYMENT_REFUND_REQUESTED Outbox (PENDING) + IdempotencyKey record. Ledger balance intact (`reversalDrSum === reversalCrSum > 0`).
- ✅ **5a-E3** Idempotency preserved — same Idempotency-Key on retry returns the SAME Refund id. No duplicate Refund, no duplicate reversal entries, no duplicate Outbox event, no duplicate IdempotencyKey record.
- ✅ **5a-E4** Concurrent refund requests → exactly 1 Refund — 2 simultaneous POSTs with the same Idempotency-Key produce 1 Refund row + 1 reversal Dr/Cr pair.
- ✅ **5a-E5** Publisher retry → no duplicate refund — first publisher run calls `refundRazorpayPayment()` (refundCalled=true, Refund → REFUNDED, Payment → REFUNDED); second run skips the call (refundCalled=false, idempotencySkipped=true). Final state: Refund REFUNDED, Payment REFUNDED, exactly 1 reversal Dr/Cr pair, exactly 1 PAYMENT_REFUNDED audit log, Outbox PUBLISHED, ledger still balanced.

### PostgreSQL evidence (staging)

| Run ID | Artifact | Result | Tests |
|--------|----------|--------|-------|
| _(pending Orchestrator trigger)_ | `wave5-5a-postgresql-evidence.json` (uploaded as Actions artifact) | ⏳ Pending | ⏳ Pending |

**Required pre-step (manual):** Run the `Wave-5 5a — Apply Staging Migration` workflow (`.github/workflows/wave5-5a-staging-migration.yml`) with confirmation string `APPLY-WAVE5-5A` to apply the Refund table migration to staging Supabase.

**Then:** Run the `Wave-5 5a — PostgreSQL Refund Flow (P0-04) Evidence` workflow (`.github/workflows/subwave-5a-postgresql-evidence.yml`) with confirmation string `RUN-5A-PG-EVIDENCE`. The workflow:
1. Verifies the Refund table exists on staging (post-migration).
2. Sets `EVIDENCE_TEST_MODE=true` on the Vercel preview environment.
3. Triggers a new Vercel preview deployment.
4. Waits for health + evidence endpoints to come online.
5. Runs E1-E5 against the staging Supabase PostgreSQL database directly (via Supabase Management API `/database/query` endpoint).
6. Cleans up all test data (Refund + LedgerEntry + Outbox + Payment + IdempotencyKey + AuditLog + OrderItem + Order rows created during the run).
7. Emits a self-validating evidence JSON (uploaded as Actions artifact + written to the runner).

### Governance safeguards

- `realPayments` remains OFF (demo mode). `refundRazorpayPayment()` returns mock success in demo mode — no real Razorpay API calls.
- `webhookHandler` remains OFF. `requestHashEnforcement` remains OFF.
- No production flag activation. No production traffic touched.
- No existing CLOSED Wave-3/4 evidence reopened (capture-flow evidence files untouched).
- P0-03 Reconciliation NOT started — separate evidence package required.
- Wave-6/7 NOT started.

---

## 3. Sub-Wave 5b — P0-03 Reconciliation

🔒 **PENDING** — Separate evidence package required. NOT started in this Wave-5 5a scope.

---

## 4. Wave-5 Closure Criteria

Wave-5 will be COMPLETE when:
- ✅ Sub-Wave 5a (P0-04 Refund) — SQLite evidence E1-E5 PASS (achieved).
- ⏳ Sub-Wave 5a — PostgreSQL evidence E1-E5 PASS (pending Orchestrator workflow trigger).
- ⏳ Sub-Wave 5a — Orchestrator S5 PASS / CLOSED decision.
- 🔒 Sub-Wave 5b (P0-03 Reconciliation) — separate evidence package (NOT started).

---

## 5. Stop Point

After P0-04 evidence package (SQLite E1-E5 PASS + PostgreSQL workflow committed + this evidence document updated): IDE is STOPPING. Awaiting Orchestrator S5 review of P0-04.

P0-03 (Reconciliation) is NOT started. Wave-6/7 NOT started. Production remains LOCKED.
