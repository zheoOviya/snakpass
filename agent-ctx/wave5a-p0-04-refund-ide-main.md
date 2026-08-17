# Task wave5a-p0-04-refund — Wave-5 Sub-Wave 5a (P0-04 Refund Implementation)

**Agent**: IDE (Full-Stack Developer)
**Date**: 2026-08-16
**Wave**: 5 (Sub-Wave 5a — P0-04 Refund)
**Orchestrator Authorization**: WAVE-5 AUTHORIZED — P0-04 REFUND. START WITH P0-04.
**Predecessor context**: Wave-0 through Wave-4 ALL CLOSED. Wave-4 4c S5 PASS / CLOSED (publisher retry idempotency pattern proven). Wave-4 4d S5 PASS / CLOSED. Production remains LOCKED (realPayments OFF, webhookHandler OFF, requestHashEnforcement OFF).

---

## Task

Implement the P0-04 Refund flow as a deliberate structural mirror of the Wave-4 4c capture flow:

1. **Refund route** (`src/app/api/payments/refund/route.ts`):
   - POST /api/payments/refund
   - Body: `{ paymentId, amount? (partial refund, defaults to full) }`
   - Accepts `Idempotency-Key` header (reuses existing 3c idempotency pattern)
   - Inside `withTransaction`:
     - Check `Payment.status === 'CAPTURED'` (can only refund captured payments)
     - Check `Payment.frozen === false` (can't refund frozen payments)
     - Create `Refund` record (status='REFUND_PENDING')
     - Create reversal `LedgerEntry` pair: DEBIT CONSUMER_REVENUE + CREDIT GATEWAY_RECEIVABLE (reverses the original capture's Dr/Cr — ledger remains balanced per I-06)
     - `AuditLog` (PAYMENT_REFUND_PENDING)
     - Store IdempotencyKey record
     - `enqueueOutboxEvent` PAYMENT_REFUND_REQUESTED (NOT the refund API call itself — that goes in the publisher per 4c pattern)
   - Returns Refund status='REFUND_PENDING'

2. **Refund model** (`prisma/schema.prisma`):
   - Add `Refund` model with full lifecycle (REFUND_PENDING → REFUNDED | FAILED)
   - Add `refunds Refund[]` relation to Payment model
   - Class-2 additive schema change (new model + new relation, no existing columns changed)

3. **Razorpay refund function** (`src/lib/razorpay.ts`):
   - Add `refundRazorpayPayment(razorpayPaymentId, amount, currency)` function
   - In demo mode (realPayments=false): return mock success
   - In real mode: call `instance.payments.refund(razorpayPaymentId, { amount, currency })`
   - Called by the outbox publisher (OUTSIDE any txn) — same pattern as 4c capture

4. **Outbox publisher handler** (`mini-services/outbox-publisher/index.ts`):
   - Add `processPaymentRefundRequested()` handler (mirror of `processPaymentCaptureRequested()`)
   - Read Refund → idempotency check (if REFUNDED → mark PUBLISHED, skip)
   - Call `refundRazorpayPayment()` OUTSIDE any txn
   - On success: new txn → update Refund to REFUNDED + refundedAt + gatewayRefundId + (for full refund) Payment to REFUNDED + AuditLog (PAYMENT_REFUNDED) → mark outbox PUBLISHED
   - On failure: increment version, set failureReason, leave status as REFUND_PENDING, throw (publisher catch handles retry)
   - Add `PAYMENT_REFUND_REQUESTED` to `COMMAND_EVENT_TYPES` set

5. **Evidence endpoints**:
   - Extend `evidence-setup` to create a CAPTURED Payment (for refund testing) via `refund-full` / `refund-partial` scenarios
   - Extend `evidence-verify` to check Refund state (refundId + refundIdempotencyKey query params)
   - Add `evidence-publisher-run?mode=refund&refundId=<id>` for E5 testing

6. **Evidence runner** (`scripts/wave5-5a-evidence.mjs`):
   - E1: Refund returns REFUND_PENDING
   - E2: Payment state consistent (atomic writes — Refund + reversal Dr/Cr + AuditLog + Outbox + IdempotencyKey)
   - E3: Idempotency preserved (same key → same Refund)
   - E4: Concurrent refund requests → exactly 1 Refund
   - E5: Publisher retry → no duplicate refund (mirrors 4c-E5)

7. **PostgreSQL workflow**: `.github/workflows/subwave-5a-postgresql-evidence.yml` + staging migration workflow

## Constraints honored

- ✅ Did NOT enable `realPayments` (still OFF — demo mode).
- ✅ Did NOT modify `db.ts` or `idempotency.ts`.
- ✅ Did NOT reopen Wave-3/4 evidence.
- ✅ Did NOT start P0-03 (separate evidence package required).
- ✅ Followed the 4c pattern (external call OUTSIDE txn, via outbox publisher).
- ✅ Used idempotency pattern (3c) — same `getCachedResponse` + `storeIdempotencyRecord` + `computeRequestHash` as capture route.
- ✅ Preserved ledger double-entry (Dr/Cr reversal for refund — `Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE` mirrors the capture flow's `Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE` in reverse).
- ✅ Verified lint passes (`bun run lint` → exit 0).

## What I Read (Prior Agent Context)

- `worklog.md` tail (~lines 5900-6250): Wave-4 4c S5 PASS / CLOSED (publisher retry idempotency proven via 4c-E5); Wave-4 4d S5 PASS / CLOSED (orphan_business_count fix verified); Wave-4 COMPLETE; PRODUCTION_READINESS_GATE_REVIEW.md produced (NOT READY — 4 P0s LOCKED on critical path, 4 of 7 launch-gate AND-conditions FAIL). Orchestrator authorized Wave-5 (P0-04 + P0-03), start with P0-04.
- `src/app/api/payments/route.ts` (capture route, 4c Phase 1): Payment starts as CAPTURE_PENDING; captureRazorpayPayment deferred to publisher via PAYMENT_CAPTURE_REQUESTED outbox event; AuditLog PAYMENT_CAPTURE_PENDING written in route; LedgerEntry Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE written in route.
- `src/lib/razorpay.ts`: captureRazorpayPayment demo/real-mode pattern; verifyRazorpaySignature; verifyWebhookSignature (4a).
- `src/lib/idempotency.ts`: getCachedResponse + storeIdempotencyRecord + computeRequestHash (3c pattern).
- `src/lib/outbox.ts`: enqueueOutboxEvent(tx, { eventType, aggregateType, aggregateId, payload }) — MUST be called inside withTransaction.
- `src/lib/db.ts`: withTransaction with P2034 retry; TransactionConflictError. NOT modified.
- `mini-services/outbox-publisher/index.ts` (pre-change): cron-triggered, lease-based atomic claim (PENDING → CLAIMED), dispatch via EVENT_TYPE_TO_SOCKET lookup that throws on unknown event types; PAYMENT_CAPTURE_REQUESTED handled via `processPaymentCaptureRequested()` (4c Phase 2).
- `src/app/api/payments/evidence-setup/route.ts` + `evidence-verify/route.ts` + `evidence-publisher-run/route.ts`: Wave-4 4c evidence endpoints.
- `scripts/wave4-4c-evidence-e5.mjs` + `scripts/run-4c-e5-evidence.sh`: Wave-4 4c-E5 evidence runner (publisher retry / duplicate-capture-prevention).
- `.github/workflows/subwave-4c-e5-postgresql-evidence.yml` + `.github/workflows/subwave-4d-postgresql-evidence.yml` + `.github/workflows/wave4-4a-staging-migration.yml`: existing workflow patterns reused.
- `prisma/scripts/wave3-subwave-3a-migration.sql` + `prisma/scripts/wave4-subwave-4a-migration.sql`: existing migration patterns reused (Class-2 ADDITIVE; BEGIN/COMMIT; GRANT to snakzap_app + snakzap_admin).
- `prisma/schema.prisma`: existing Payment + LedgerEntry + Outbox + WebhookEvent models.
- `agent-ctx/4c-implementation-phase2-ide-main.md`: predecessor agent's work record (4c publisher handler).

## What I Changed

### 1. `prisma/schema.prisma`
- Updated Payment model:
  - Documented the new status lifecycle (`CAPTURED → REFUND_PENDING → REFUNDED | FAILED`).
  - Added `refunds Refund[]` 1:N relation.
- Added new `Refund` model (Class-2 additive):
  - id (cuid PK), paymentId (FK → Payment), amount (paise), currency (default INR), status (default REFUND_PENDING), gatewayRefundId?, idempotencyKey? @unique, failureReason?, refundedAt?, version (default 0), createdAt, updatedAt.
  - Indexes: `@@index([paymentId, status])` + `@@index([status, createdAt])`.

### 2. `prisma/scripts/wave5-subwave-5a-migration.sql` (new)
- Class-2 ADDITIVE: CREATE TABLE IF NOT EXISTS Refund (idempotencyKey unique index + paymentId_status index + status_createdAt index + FK to Payment ON DELETE RESTRICT).
- GRANT SELECT, INSERT, UPDATE to snakzap_app; GRANT ALL to snakzap_admin.
- BEGIN/COMMIT + DO $$ RAISE NOTICE.

### 3. `src/lib/razorpay.ts`
- Added `RazorpayRefundResponse` interface.
- Added `refundRazorpayPayment(razorpayPaymentId, amount, currency)` function:
  - Demo mode: returns mock `{ refunded: true, gatewayRefundId: 'rpf_demo_...', amount, currency }`.
  - Real mode: calls `instance.payments.refund(razorpayPaymentId, { amount, currency })`. Treats Razorpay's `pending` + `processed` refund statuses as success (gateway accepted the refund request — bank settlement is async, confirmed via webhook).

### 4. `src/app/api/payments/refund/route.ts` (new)
- POST /api/payments/refund — Zod-validated body `{ paymentId, amount? }`.
- Idempotency-Key header support (3c pattern: getCachedResponse + computeRequestHash + storeIdempotencyRecord).
- Inside `withTransaction`:
  1. Idempotency cache check.
  2. Read Payment; assert status === 'CAPTURED' (409 otherwise).
  3. Assert Payment.frozen === false (409 otherwise).
  4. Authorization: only owner or ADMIN/SUPER_ADMIN (403 otherwise).
  5. Compute refundAmount (default = Payment.amount; > Payment.amount → 400).
  6. Create Refund (status='REFUND_PENDING').
  7. Create reversal Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE LedgerEntry pair.
  8. AuditLog PAYMENT_REFUND_PENDING.
  9. enqueueOutboxEvent PAYMENT_REFUND_REQUESTED (aggregateType='Refund', aggregateId=refund.id).
  10. storeIdempotencyRecord.
- Returns `{ refund: { id, paymentId, status: 'REFUND_PENDING', amount, currency, fullRefund } }`.
- Error handling: IdempotencyKeyReuseError (422), TransactionConflictError (409), AppError rethrow, fallback rethrow.

### 5. `mini-services/outbox-publisher/index.ts`
- Added `refundRazorpayPayment` import.
- Extended `COMMAND_EVENT_TYPES` set to include `PAYMENT_REFUND_REQUESTED`.
- Added `refundId?` field to `LogEntry` interface.
- Added `processPaymentRefundRequested(event)` function (~290 lines incl. doc comments):
  - Parses payload (aggregateId = refund.id per refund route's enqueueOutboxEvent).
  - Reads Refund by id.
  - Idempotency: if REFUNDED → mark outbox PUBLISHED, exit.
  - If FAILED (terminal) → mark outbox PUBLISHED, exit.
  - If status !== REFUND_PENDING → throw.
  - Resolves gatewayPaymentId (payload.gatewayPaymentId or Payment.gatewayPaymentId).
  - Calls `refundRazorpayPayment()` **OUTSIDE any txn** (Wave-4 4c safety property).
  - On call failure / declined: increment Refund.version + set failureReason → rethrow (publisher catch handles retry/backoff).
  - On success: NEW `db.$transaction()` atomically commits:
    (a) Refund REFUND_PENDING → REFUNDED + refundedAt + gatewayRefundId (race-safe conditional updateMany WHERE status='REFUND_PENDING').
    (b) If full refund AND Payment.status==='CAPTURED': Payment CAPTURED → REFUNDED (race-safe conditional updateMany).
    (c) AuditLog PAYMENT_REFUNDED if either Refund or Payment was updated.
    (d) Outbox.status=PUBLISHED (always).
- Updated `publishPendingEvents()` dispatch loop:
  ```ts
  if (COMMAND_EVENT_TYPES.has(event.eventType)) {
    if (event.eventType === 'PAYMENT_CAPTURE_REQUESTED') {
      await processPaymentCaptureRequested(event)
    } else if (event.eventType === 'PAYMENT_REFUND_REQUESTED') {
      await processPaymentRefundRequested(event)
    } else {
      throw new Error(`No handler registered for command event type: ${event.eventType}`)
    }
    result.published++
    continue
  }
  ```

### 6. `src/app/api/payments/evidence-setup/route.ts`
- Added `refund-full` + `refund-partial` scenarios that pre-create a CAPTURED Payment:
  - Writes Payment with status='CAPTURED', capturedAt=now, version=1, gatewayPaymentId=`pay_evidence_<scenario>_<timestamp>_<rand>`.
  - Writes capture Dr/Cr LedgerEntry pair (Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE) so the ledger is balanced before the refund's reversal pair is added.
  - Writes AuditLog PAYMENT_CAPTURED (source='evidence-setup', simulating publisher).
- Returns paymentId, paymentStatus, paymentAmount, gatewayPaymentId alongside the existing fields.

### 7. `src/app/api/payments/evidence-verify/route.ts`
- Added `refundId` + `refundIdempotencyKey` query params.
- Returns refund state (exists, id, paymentId, amount, status, gatewayRefundId, idempotencyKey, failureReason, refundedAt, version).
- Returns reversal Dr/Cr counts + sums (DEBIT CONSUMER_REVENUE + CREDIT GATEWAY_RECEIVABLE).
- Returns refund-specific AuditLog entries (PAYMENT_REFUND_PENDING + PAYMENT_REFUNDED).
- Returns refund-specific Outbox event (aggregateType='Refund' + aggregateId=refundId).
- Returns refund IdempotencyKey record (if refundIdempotencyKey provided).
- Computed invariants: `exactlyOneRefundInitiated` + `refundCompleted`.

### 8. `src/app/api/payments/evidence-publisher-run/route.ts`
- Added `mode=refund` + `refundId` query params.
- Added `runRefundPublisher(refundId)` function that mirrors the capture simulator:
  - Reads Refund + Payment.
  - Idempotency: if REFUNDED → return refundCalled=false, idempotencySkipped=true.
  - If FAILED (terminal) → return error.
  - If status !== REFUND_PENDING → return error.
  - Calls `refundRazorpayPayment()` OUTSIDE any txn (mirrors 4c safety).
  - On success: race-safe conditional updateMany Refund (WHERE status='REFUND_PENDING') + Payment (WHERE status='CAPTURED', only for full refund). AuditLog PAYMENT_REFUNDED if either was updated. Outbox marked PUBLISHED.
  - Returns `{ mode: 'refund', refundId, paymentId, statusBefore, refundCalled, statusAfter, refundedAt, gatewayRefundId, paymentStatusBefore, paymentStatusAfter, idempotencySkipped, versionAfter, error, traceId }`.

### 9. `scripts/wave5-5a-evidence.mjs` (new)
- Evidence runner for E1-E5 scenarios:
  - E1: Refund returns REFUND_PENDING — POST /api/payments/refund returns Refund in REFUND_PENDING status.
  - E2: Payment state consistent — Refund + 1 reversal Dr + 1 reversal Cr + PAYMENT_REFUND_PENDING audit + PAYMENT_REFUND_REQUESTED outbox (PENDING) + IdempotencyKey record + ledgerBalanceIntact (I-06 preserved through reversal).
  - E3: Idempotency preserved — same Idempotency-Key on retry returns the SAME Refund id, no duplicate reversal entries, no duplicate Outbox event.
  - E4: Concurrent refund requests — 2 simultaneous POSTs with the same Idempotency-Key produce exactly 1 Refund row + 1 reversal Dr/Cr pair.
  - E5: Publisher retry → no duplicate refund — first publisher run calls refundRazorpayPayment (refundCalled=true, Refund → REFUNDED, Payment → REFUNDED), second run skips (refundCalled=false, idempotencySkipped=true). Final state: exactly 1 reversal Dr/Cr pair, exactly 1 PAYMENT_REFUNDED audit, Outbox PUBLISHED, ledger balanced.
- Emits self-validating evidence JSON to `evidence/wave5-5a/evidence-E1-E5-<runId>.json`.

### 10. `scripts/run-5a-evidence.sh` (new)
- Bash wrapper (mirrors `run-4c-e5-evidence.sh`):
  - Flips schema to SQLite, sets `DATABASE_URL=file:...?connection_limit=1&busy_timeout=30000`.
  - Pushes schema + generates client + seeds.
  - Starts dev server with `EVIDENCE_TEST_MODE=true`.
  - Runs `node scripts/wave5-5a-evidence.mjs`.
  - Restores PostgreSQL schema + `.env` + regenerates client.

### 11. `.github/workflows/wave5-5a-staging-migration.yml` (new)
- Manual workflow: applies `prisma/scripts/wave5-subwave-5a-migration.sql` to staging Supabase via Management API.
- Confirmation string `APPLY-WAVE5-5A`.
- Verifies Refund table + indexes + FK after migration.

### 12. `.github/workflows/subwave-5a-postgresql-evidence.yml` (new)
- Manual workflow: runs E1-E5 against staging Supabase PostgreSQL.
- Confirmation string `RUN-5A-PG-EVIDENCE`.
- Pre-step: verifies Refund table exists on staging (post-migration).
- Sets `EVIDENCE_TEST_MODE=true` on Vercel preview, triggers new deployment, waits for READY.
- For each scenario (E1-E5): creates CAPTURED Payment via `evidence-setup?scenario=refund-full`, fires refund POST(s), then queries Supabase directly via `/database/query` to verify Refund + reversal Dr/Cr + AuditLog + Outbox + IdempotencyKey state.
- E5: runs publisher twice (first call → refundCalled=true; second call → refundCalled=false, idempotencySkipped=true).
- Cleans up ALL test data after each scenario (Refund + LedgerEntry + Outbox + Payment + IdempotencyKey + AuditLog + OrderItem + Order rows).
- Emits `wave5-5a-postgresql-evidence.json` self-validating evidence file (uploaded as Actions artifact).

### 13. `WAVE5_EVIDENCE.md` (new)
- Wave-5 evidence document. Status: 🟡 Wave-5 AUTHORIZED — Sub-Wave 5a evidence-complete (awaiting Orchestrator S5 review).
- Section 2: Sub-Wave 5a — P0-04 Refund Flow Evidence — architecture (capture↔refund mapping table), implementation summary (per-file table), invariants verified (I-04, I-06, TRANSACTION_RETRY_INVARIANT, Idempotent Business Effect, Atomic writes), SQLite evidence table (5/5 PASS), PostgreSQL evidence table (pending Orchestrator trigger), governance safeguards.
- Section 3: Sub-Wave 5b — P0-03 Reconciliation — 🔒 PENDING (separate evidence package required; NOT started).
- Section 4: Wave-5 closure criteria.
- Section 5: Stop point.

## SQLite Evidence Result (5/5 PASS)

Run ID: `5a-1786874767980-fbc2ef75`
Artifact: `evidence/wave5-5a/evidence-E1-E5-5a-1786874767980-fbc2ef75.json`
- `ok: true`, `summary.totalTests: 5`, `summary.passed: 5`, `summary.failed: 0`, `summary.allPassed: true`
- `governance.realPaymentsEnabled: false`, `governance.productionTouched: false`

Per-scenario:
- ✅ 5a-E1: Refund returns REFUND_PENDING
- ✅ 5a-E2: Payment state consistent (atomic writes — Refund + reversal Dr/Cr + AuditLog + Outbox + IdempotencyKey all present, ledgerBalanceIntact=true)
- ✅ 5a-E3: Idempotency preserved (same key → same Refund id, no duplicate reversal entries)
- ✅ 5a-E4: Concurrent refund requests → exactly 1 Refund (1 Refund row, 1 reversal Dr/Cr pair)
- ✅ 5a-E5: Publisher retry → no duplicate refund (first run refundCalled=true, second run refundCalled=false + idempotencySkipped=true; final Refund REFUNDED + Payment REFUNDED + 1 reversal Dr/Cr + 1 PAYMENT_REFUNDED audit + Outbox PUBLISHED + ledger balanced)

## Lint

`bun run lint` → exit 0 (no errors, no warnings).

## Dependencies

- Installed `razorpay@2.9.8` (was in package.json but not in node_modules — `bun install razorpay` resolved it). Required for `import Razorpay from 'razorpay'` in `src/lib/razorpay.ts` (existing import, not new — but the package wasn't installed locally).

## Stage Summary

- Wave-5 Sub-Wave 5a (P0-04 Refund) — IMPLEMENTED + SQLite evidence E1-E5 PASS (5/5).
- PostgreSQL evidence workflow committed (pending Orchestrator trigger via `APPLY-WAVE5-5A` then `RUN-5A-PG-EVIDENCE`).
- WAVE5_EVIDENCE.md created with full implementation summary + governance safeguards.
- Production remains LOCKED. realPayments OFF. webhookHandler OFF. requestHashEnforcement OFF.
- P0-03 (Reconciliation) NOT started — separate evidence package required.
- Wave-6/7 NOT started.
- IDE is STOPPING. Awaiting Orchestrator S5 review of P0-04 evidence package.
