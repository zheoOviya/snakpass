# Wave-5 Evidence Document

**Status:** ✅ Sub-Wave 5a (P0-04 Refund) — S5 PASS / CLOSED. Sub-Wave 5b (P0-03 Reconciliation) 🔒 LOCKED (separate authorization required).
**Created:** 2026-08-16
**Sub-Wave 5a Implementation:** 2026-08-16 (IDE — task ID `wave5a-p0-04-refund`)
**Sub-Wave 5a S5 Closure:** 2026-08-16 (Orchestrator Decision — 5A S5 PASS / CLOSED)
**Authorization:** Orchestrator Decision — Wave-5 AUTHORIZED (P0-04 Refund + P0-03 Reconciliation). P0-04 IMPLEMENTED FIRST.

> **Governance rule:** This document is NOT pre-filled with fabricated evidence. Each row reflects actual evidence artifacts committed to the repo and (for PostgreSQL) actual GitHub Actions runs against the staging Supabase database.

> **Production boundary:** `realPayments` remains OFF (demo mode). `webhookHandler` remains OFF. `requestHashEnforcement` remains OFF. No production flag activation. No Wave-6/7. 5a is CLOSED — no reopen without Orchestrator authorization. 5b is LOCKED — separate authorization required.

---

## 1. Wave-5 Sub-Wave Status

| Sub-Wave | Scope | Status |
|----------|-------|--------|
| 5a | P0-04 Refund flow (mirror of 4c capture pattern) | ✅ **S5 PASS / CLOSED** (SQLite E1-E5 PASS + PostgreSQL E1-E5 PASS + PostgreSQL E6 PASS) |
| 5b | P0-03 Reconciliation | 🔒 LOCKED — separate Orchestrator authorization REQUIRED (NOT started) |

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

### PostgreSQL evidence (staging) — E1-E5

| Run ID | Artifact | Result | Tests |
|--------|----------|--------|-------|
| `5a-pg-1786875651-1765` | `evidence/wave5-5a/evidence-postgresql-5a-pg-ev.json` | ✅ ok=true | 5/5 PASS |
| _(GitHub Actions run)_ | Workflow: `subwave-5a-postgresql-evidence.yml` (run id `31941354942`) | ✅ completed / success | E1-E5 verified against staging Supabase |

Per-scenario results (PostgreSQL, staging Supabase):
- ✅ **5a-E1** Refund returns REFUND_PENDING — `e1RefundPendingReturned: true`.
- ✅ **5a-E2** Payment state consistent (atomic writes) — `reversalDrCount=1`, `reversalCrCount=1`, `auditPendingCount=1`, `outboxStatus=PENDING`, `ledgerDrSum=64000`, `ledgerCrSum=64000`, `ledgerBalanceIntact=true`.
- ✅ **5a-E3** Idempotency preserved — same key → same Refund, no duplicates.
- ✅ **5a-E4** Concurrent refund requests → exactly 1 Refund — `e4ConcurrentRefundsDeduped: true`.
- ✅ **5a-E5** Publisher retry → no duplicate refund — `firstRunRefundCalled=true`, `secondRunRefundCalled=false`, `secondRunIdempotencySkipped=true`, `finalRefundStatus=REFUNDED`, `outboxStatus=PUBLISHED`, `ledgerBalanceIntact=true`.

**Pre-step executed:** The `Wave-5 5a — Apply Staging Migration` workflow (`wave5-5a-staging-migration.yml`) was run with confirmation `APPLY-WAVE5-5A` to apply the Refund table migration to staging Supabase (migration run id `31941312885`, completed / success).

### PostgreSQL evidence (staging) — E6 (refund failure / pending ledger semantics)

| Run ID | Artifact | Result | Tests |
|--------|----------|--------|-------|
| `5a-E6-pg-1786877458-1656` | `evidence/wave5-5a/evidence-E6-postgresql-5a-pg-ev.json` | ✅ ok=true | 7/7 steps (A-G) PASS |
| _(GitHub Actions run)_ | Workflow: `subwave-5a-e6-postgresql-evidence.yml` (run id `31942679845`) | ✅ completed / success | E6 verified against staging Supabase |

The E6 evidence proves the **Option A — Pending Ledger Semantics** (see §3 below): the refund reversal entries written at `REFUND_PENDING` time persist as an accounting reservation through publisher failure, and become canonical on retry success — with no duplicate ledger entries at any point.

**Test flow executed (7 steps, all PASS):**

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| A | GET `/api/payments/evidence-setup?scenario=refund-full` | CAPTURED Payment | `paymentId=cmsvopb9c0009ld04v62fjoff`, status=CAPTURED ✅ |
| B | POST `/api/payments/refund` + Idempotency-Key | REFUND_PENDING + reversal Dr/Cr | `refundId=cmsvopcxt000hld04mxnxmpbc`, status=REFUND_PENDING ✅ |
| C | GET `/api/payments/evidence-verify` | Payment=CAPTURED, Ledger=4, balanced | Ledger 4 entries (2 Dr / 2 Cr, sums 64000/64000), balanced, Refund=REFUND_PENDING ✅ |
| D | POST `/api/payments/evidence-publisher-run?refundId=Y&mode=refund&simulateFail=true` | refund called, SIMULATED_FAILURE, state unchanged | `refundCalled=true`, error="SIMULATED_FAILURE: gateway unavailable", Refund=REFUND_PENDING, Payment=CAPTURED ✅ |
| E | GET `/api/payments/evidence-verify` | Payment=CAPTURED unchanged, Ledger=4 (no dup), balanced | Ledger=4, Dr=Cr=64000, balanced, Refund=REFUND_PENDING ✅ |
| F | POST `/api/payments/evidence-publisher-run?refundId=Y&mode=refund` (retry) | refund called, statusAfter=REFUNDED | `refundCalled=true`, `statusAfter=REFUNDED`, `paymentStatusAfter=REFUNDED`, `gatewayRefundId=rpf_demo_1786877473634_j15l28`, `idempotencySkipped=false` ✅ |
| G | GET `/api/payments/evidence-verify` (final) | Payment=REFUNDED, Ledger=4 (no dup), balanced, no orphan | Payment=REFUNDED, Ledger=4 (2 Dr / 2 Cr, sums 64000/64000), balanced=true, noOrphanLedgerEntries=true, Refund=REFUNDED, PAYMENT_REFUNDED audit exists, Outbox=PUBLISHED ✅ |

**PostgreSQL direct verification (Supabase Management API `/database/query` — bypasses app layer):**
- `Payment.status = REFUNDED`
- `Refund.status = REFUNDED`, `gatewayRefundId = rpf_demo_1786877473634_j15l28`
- `LedgerEntry` count = **4** (no duplicate from publisher retry)
- `LedgerEntry` Dr sum = Cr sum = **64000** (I-06 preserved at all times)
- `AuditLog` `PAYMENT_REFUNDED` count = **1**
- `Outbox` (Refund aggregate) status = **PUBLISHED**
- `IdempotencyKey` count = **1**
- `Refund` rows for paymentId = **1** (no duplicate Refund record)

---

## 3. Option A — Pending Ledger Semantics (Canonical Accounting Decision)

**Decision status:** CANONICAL — adopted as the accounting semantics for the refund flow (P0-04). Documented here as the authoritative reference. Verified by 5a-E6 (PostgreSQL).

### 3.1 The decision

The refund flow writes the reversal `LedgerEntry` pair (`Dr CONSUMER_REVENUE` + `Cr GATEWAY_RECEIVABLE`) **atomically with** the `Refund` (REFUND_PENDING) + `PAYMENT_REFUND_PENDING` AuditLog + `PAYMENT_REFUND_REQUESTED` Outbox event inside the refund-route transaction. The external `refundRazorpayPayment()` call is deferred to the outbox publisher (TRANSACTION_RETRY_INVARIANT — Option C).

This means the reversal ledger entries exist in the database **before** the external refund has succeeded — i.e., while `Refund.status = REFUND_PENDING` and `Payment.status = CAPTURED`. The canonical meaning of these entries is:

> **A pending accounting reservation.** The reversal entries reserve the refund amount against `CONSUMER_REVENUE` (Dr) and `GATEWAY_RECEIVABLE` (Cr) at the moment the refund is initiated. They are NOT a settled reversal until the publisher confirms the gateway refund succeeded.

### 3.2 Why Option A (and not "write ledger only on success")

The alternative — deferring the reversal ledger entries to the publisher's success path — was rejected because it would:

1. **Break atomicity.** The `Refund` row, the `Outbox` event, and the `AuditLog` would commit in one transaction, but the `LedgerEntry` reversal pair would commit in a *separate* publisher transaction. A crash between them leaves a `Refund` (REFUND_PENDING) with no ledger reservation — a silent accounting gap.
2. **Break the I-06 invariant during the pending window.** Between the refund route's commit and the publisher's success, `Dr sum ≠ Cr sum` for the payment — the capture pair (Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE) would be unbalanced.
3. **Duplicate the retry hazard the outbox pattern exists to solve.** The publisher would need its own idempotency guard for "did I already write the reversal?", which is exactly the kind of state the outbox pattern offloads to the `Outbox` row's `status`.

Option A keeps the reversal entries inside the atomic refund-route transaction, so the I-06 invariant (Dr sum === Cr sum) holds at **every** point in the refund lifecycle: pending, failed, and refunded.

### 3.3 The deterministic state machine

| Lifecycle point | `Payment.status` | `Refund.status` | LedgerEntry count (per payment) | Dr sum | Cr sum | Outbox status | Notes |
|-----------------|------------------|-----------------|--------------------------------|--------|--------|---------------|-------|
| Captured (pre-refund) | CAPTURED | _(none)_ | 2 (capture pair) | capture amt | capture amt | _(none for refund)_ | Baseline. |
| Refund requested (commit) | CAPTURED | REFUND_PENDING | 4 (capture + reversal) | capture amt + refund amt | capture amt + refund amt | PENDING | Reversal pair = pending reservation. I-06 holds. |
| Publisher FAILS (gateway error / crash) | CAPTURED | REFUND_PENDING | 4 (unchanged) | capture amt + refund amt | capture amt + refund amt | PENDING (unchanged) | No duplicate ledger entries. Refund stays pending. Payment stays captured. I-06 holds. |
| Publisher RETRIES → success | REFUNDED (full refund) | REFUNDED | 4 (unchanged — no new entries) | capture amt + refund amt | capture amt + refund amt | PUBLISHED | Reversal pair becomes canonical settlement. NO new ledger entries created. I-06 holds. |

### 3.4 What the reversal entries are NOT

- They are **NOT** a settled cash movement at `REFUND_PENDING` time. The money has not yet left the gateway. They are an accounting reservation that becomes canonical only when the publisher confirms the gateway refund.
- They are **NOT** duplicated on publisher retry. The publisher's success path updates `Refund.status` to `REFUNDED` + writes `PAYMENT_REFUNDED` audit + flips `Outbox` to `PUBLISHED`. It does **not** insert additional `LedgerEntry` rows. This is empirically proven by 5a-E6 step G (`ledgerEntries=4` after retry success, identical to step C).
- They are **NOT** orphaned on publisher failure. They remain attached to the `Refund` row via `LedgerEntry.refundId`. If the refund is later retried and succeeds, they become canonical. If the refund is permanently abandoned (publisher exhausted retries → manual intervention), they remain as a pending reservation that a reconciliation job (5b / P0-03) will surface for operator review.

### 3.5 Invariant provenance

| Invariant | Evidence |
|-----------|----------|
| Dr sum === Cr sum at ALL states (pending / failed / refunded) | 5a-E6 steps C, E, G — all show `ledgerDrSum=64000 === ledgerCrSum=64000` |
| No duplicate ledger entries on publisher retry | 5a-E6 step G — `ledgerEntries=4` (identical to step C), `publisherRetryDoesNotDuplicate: true` |
| No duplicate ledger entries on publisher failure | 5a-E6 step E — `ledgerEntries=4` (identical to step C), `publisherFailDoesNotDuplicate: true` |
| No orphan ledger entries | 5a-E6 step G — `noOrphanLedgerEntries: true` |
| No false REFUNDED state on publisher failure | 5a-E6 step D/E — `paymentStatusAfter=CAPTURED`, `refundStatus=REFUND_PENDING` |
| No lost PAYMENT_REFUND_REQUESTED event | 5a-E6 step G — `outboxStatus=PUBLISHED` (publisher delivered on retry) |
| No duplicate Refund record on retry | 5a-E6 step G — `refundRowsForPaymentCount=1` (PostgreSQL direct) |
| TRANSACTION_RETRY_INVARIANT preserved | 5a-E6 step D — `refundRazorpayPayment()` called OUTSIDE any txn body (publisher) |

---

## 4. Sub-Wave 5a — S5 PASS / CLOSED (Final Summary)

**Orchestrator decision (2026-08-16):** Sub-Wave 5a (P0-04 Refund) is **S5 PASS / CLOSED**.

### 4.1 Evidence summary

| Evidence | Database | Result | Artifact |
|----------|----------|--------|----------|
| E1 — Refund returns REFUND_PENDING | SQLite | ✅ PASS | `evidence/wave5-5a/evidence-E1-E5-5a-1786874767980-fbc2ef75.json` |
| E1 — Refund returns REFUND_PENDING | PostgreSQL | ✅ PASS | `evidence/wave5-5a/evidence-postgresql-5a-pg-ev.json` (run `31941354942`) |
| E2 — Payment state consistent (atomic writes) | SQLite | ✅ PASS | (same SQLite artifact) |
| E2 — Payment state consistent (atomic writes) | PostgreSQL | ✅ PASS | (same PostgreSQL artifact) |
| E3 — Idempotency preserved | SQLite | ✅ PASS | (same SQLite artifact) |
| E3 — Idempotency preserved | PostgreSQL | ✅ PASS | (same PostgreSQL artifact) |
| E4 — Concurrent refund requests → exactly 1 Refund | SQLite | ✅ PASS | (same SQLite artifact) |
| E4 — Concurrent refund requests → exactly 1 Refund | PostgreSQL | ✅ PASS | (same PostgreSQL artifact) |
| E5 — Publisher retry → no duplicate refund | SQLite | ✅ PASS | (same SQLite artifact) |
| E5 — Publisher retry → no duplicate refund | PostgreSQL | ✅ PASS | (same PostgreSQL artifact) |
| E6 — Refund failure → retry + pending ledger semantics | SQLite | ✅ PASS | `evidence/wave5-5a/evidence-E6-5a-E6-1786877008377-28e77335.json` |
| E6 — Refund failure → retry + pending ledger semantics | PostgreSQL | ✅ PASS | `evidence/wave5-5a/evidence-E6-postgresql-5a-pg-ev.json` (run `31942679845`) |

### 4.2 S5 closure justification

The S5 governance bar requires that the refund flow be deterministic across the full lifecycle — request, idempotent retry, concurrent dedup, publisher failure, publisher retry success — with no accounting invariant violation at any point. The evidence package satisfies this:

1. **Failure → retry determinism (E6):** When the publisher's `refundRazorpayPayment()` call fails (`simulateFail=true`), `Payment.status = CAPTURED`, `Refund.status = REFUND_PENDING`, the ledger reversal pair is **not duplicated** (still exactly 4 entries), and the Dr/Cr balance is intact. On retry success, `Refund.status → REFUNDED`, `Payment.status → REFUNDED`, the reversal entries **become canonical without duplication** (still exactly 4 entries), the `Outbox` flips to `PUBLISHED`, and the `PAYMENT_REFUNDED` audit log is written exactly once.
2. **Option A pending ledger semantics (canonical):** The reversal entries are a pending accounting reservation at `REFUND_PENDING` time, not a settled cash movement. They become canonical only on publisher success. This preserves the I-06 invariant (Dr sum === Cr sum) at **every** state — pending, failed, and refunded.
3. **TRANSACTION_RETRY_INVARIANT preserved:** The external `refundRazorpayPayment()` call is made by the outbox publisher **outside** any `withTransaction()` body. The refund route itself performs only database writes (Refund + reversal Dr/Cr + AuditLog + Outbox + IdempotencyKey) inside the transaction.
4. **No silent state loss:** The `PAYMENT_REFUND_REQUESTED` Outbox event is atomic with the Refund row. A crash between the refund-route commit and the publisher's external call leaves the event PENDING — the publisher picks it up on restart. No event is lost.

### 4.3 Boundaries reaffirmed

- This closure is **NOT** a production-readiness approval. `realPayments` remains OFF. `webhookHandler` remains OFF in production. `requestHashEnforcement` remains OFF in production.
- This closure does **NOT** auto-start 5b (P0-03 Reconciliation). 5b remains LOCKED — separate Orchestrator authorization required.
- Wave-6 (P0-06 State Separation) and Wave-7 (P0-07 Pickup Attribution) remain LOCKED.
- 5a evidence is CLOSED — no reopen without Orchestrator authorization.

---

## 5. Sub-Wave 5b — P0-03 Reconciliation

🔒 **LOCKED** — Separate Orchestrator authorization REQUIRED. NOT started.

Sub-Wave 5b (P0-03 Reconciliation) is the next sub-wave in the Wave-5 authorization, but it remains LOCKED pending a separate Orchestrator directive. The IDE MUST NOT begin any 5b implementation, schema change, evidence scenario, or workflow until the Orchestrator issues a `5B — READ/PLAN-FIRST Gate Review` authorization.

**Expected 5b scope (for planning reference only — NOT authorized):**
- Reconciliation job to detect orphan ledger entries, stuck `REFUND_PENDING` refunds (publisher exhausted retries), and ledger balance drift.
- Surfaces pending reservations (per the Option A semantics documented in §3) for operator review.
- No production activation; no `realPayments=true`; no schema changes outside the 5b evidence package.

**Next governance checkpoint:** `Sub-Wave 5b — P0-03 Reconciliation: READ/PLAN-FIRST Gate Review` (separate Orchestrator directive required).

---

## 6. Canonical Governance State (Snapshot at 5a Closure)

```text
Wave-0        ✅ CLOSED
Wave-1        ✅ CLOSED
Wave-2        ✅ CLOSED
Wave-3        ✅ COMPLETE / CLOSED
Wave-4        ✅ COMPLETE / CLOSED

Wave-5
  5A          ✅ S5 PASS / CLOSED
              ├─ E1 ✅ Refund → REFUND_PENDING (SQLite + PostgreSQL)
              ├─ E2 ✅ State + ledger consistency (SQLite + PostgreSQL)
              ├─ E3 ✅ Idempotency (SQLite + PostgreSQL)
              ├─ E4 ✅ Concurrent refund dedup (SQLite + PostgreSQL)
              ├─ E5 ✅ Publisher retry / no duplicate refund (SQLite + PostgreSQL)
              └─ E6 ✅ Failure → retry + pending-ledger semantics (SQLite + PostgreSQL)

  5B          🔒 LOCKED — P0-03 Reconciliation
              Separate Orchestrator authorization REQUIRED

Production               🚫 NOT AUTHORIZED
realPayments             🚫 OFF
webhookHandler           🚫 OFF in production
requestHashEnforcement   🚫 OFF in production

Wave-6                   🔒 LOCKED (P0-06 State Separation)
Wave-7                   🔒 LOCKED (P0-07 Pickup Attribution)
```

---

## 7. Stop Point

Sub-Wave 5a closure documentation is COMPLETE. The IDE is STOPPING.

- 5a evidence is CLOSED — no reopen without Orchestrator authorization.
- 5b (P0-03 Reconciliation) is LOCKED — NOT started. Awaits separate Orchestrator authorization (`5B — READ/PLAN-FIRST Gate Review`).
- Wave-6 / Wave-7 remain LOCKED.
- Production remains NOT AUTHORIZED. All production flags remain OFF.

**Next governance checkpoint:** Orchestrator directive on Sub-Wave 5b (P0-03 Reconciliation).

---

**End of document.**
