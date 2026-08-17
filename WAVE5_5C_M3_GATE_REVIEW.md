# Wave-5 Sub-Wave 5C — M3 Missing Capture Status: S5 PASS / CLOSED

**Document type:** Gate Review (READ/PLAN-FIRST → IMPLEMENTATION → PostgreSQL EVIDENCE → S5 PASS / CLOSED).
**Directive IDs:** `WAVE5-5C-M3-READ-PLAN-FIRST-01` (Gate Review) → `WAVE5-5C-M3-IMPLEMENT-01` (Implementation) → `WAVE5-5C-M3-PG-EVIDENCE-GATE-01` (PostgreSQL Evidence) → `S5-5C-M3-P0-03-CLOSE` (Closure).
**Author:** IDE (read-only synthesis from repository + M16 closure evidence).
**Orchestrator directive:** Sub-Wave 5C — M3 is S5 PASS / CLOSED (Directive ID: `S5-5C-M3-P0-03-CLOSE`, 2026-08-17). M9/M10 + CLASS B/D/E remain LOCKED. 5C is PARTIALLY CLOSED (M16 + M3 only).
**Created:** 2026-08-16
**Scope:** M3 — Missing Capture Status (Payment has capture ledger pair but status still CAPTURE_PENDING past publisher retry window).

> **M3 Closure (Orchestrator Directive `S5-5C-M3-P0-03-CLOSE`):** M3 (gateway-verified status remediation — CAPTURE_PENDING → CAPTURED) is S5 PASS / CLOSED. The closure is based on SQLite E1-E8 (8/8 PASS) + PostgreSQL E9-E12 (8/8 PASS) + `moneyStateUnchanged=true` + `noDuplicateRemediationActions=true` + `financialMutation=false` + `falsePositives=0`. M3 closure applies ONLY to the gateway-verified status-flip remediation scope. It does NOT authorize M9/M10 (CLASS C — stuck-state/retry semantics), CLASS B (ledger synthesis), CLASS D (quarantine), or CLASS E (never auto-repaired). The `reconciliationAutoRepair` flag remains OFF in production. See `WAVE5_EVIDENCE.md` §6 for the full canonical governance state.

> **Orchestrator constraint honored:** M16 closure proved **operational remediation safety** (outbox lag — no financial mutation). M3 is a **gateway-verified status mutation** — a fundamentally different safety boundary. M16's safety does NOT transfer to M3. M3 requires its own evidence package + its own Orchestrator authorization.

> **Prerequisite (M16 closure):** M16 is S5 PASS / CLOSED (Directive `S5-5C-M16-P0-03-CLOSE`). M3 is the first gateway-dependent remediation candidate. M9/M10 are on HOLD (stuck-state/retry semantics are more sensitive than M3's status-flip).

---

## A. M3 Detector Definition

**Detector function:** `detectM3MissingCaptureStatus()` in `src/lib/reconciliation.ts` (lines ~138-180).

**What it detects:** A Payment where:
1. `status = 'CAPTURE_PENDING'`
2. `createdAt < (now - STUCK_CAPTURE_PENDING_AGE_MS)` where `STUCK_CAPTURE_PENDING_AGE_MS = 30 * 60 * 1000` (30 min)
3. The payment has a capture ledger pair: `LedgerEntry` rows with `DEBIT GATEWAY_RECEIVABLE` + `CREDIT CONSUMER_REVENUE`
4. The outbox event for this payment is NOT in `PENDING` or `CLAIMED` status (it is `PUBLISHED` or `FAILED` or missing)

**Severity:** HIGH

**State snapshot captured:**
```json
{
  "paymentId": "...",
  "orderId": "...",
  "status": "CAPTURE_PENDING",
  "amount": 32000,
  "createdAt": "...",
  "ageMs": 1800000,
  "gatewayPaymentId": "pay_...",
  "hasCaptureLedger": true,
  "pendingOutbox": "PUBLISHED" | "FAILED" | null
}
```

**Interpretation:** The capture transaction committed (Payment + ledger Dr/Cr + outbox event all written atomically), but the publisher failed to flip `Payment.status` to `CAPTURED`. This means either:
- (a) The publisher called `captureRazorpayPayment()` and it succeeded at the gateway, but the publisher's success-txn (which flips Payment to CAPTURED) failed/crashed. → Gateway says CAPTURED, DB says CAPTURE_PENDING. Repair: flip status to CAPTURED.
- (b) The publisher called `captureRazorpayPayment()` and it failed at the gateway (or the gateway was ambiguous). The publisher exhausted retries. → Gateway says NOT captured, DB says CAPTURE_PENDING. Repair: re-enqueue outbox for capture retry (NOT flip status).
- (c) The publisher never ran (crashed before processing the outbox event). → Gateway state unknown, DB says CAPTURE_PENDING. This should NOT be M3 (the outbox would still be PENDING → this is M9's domain). M3 only fires when the outbox is NOT PENDING/CLAIMED.

---

## B. Exact Triggering Condition

```text
Payment.status = 'CAPTURE_PENDING'
AND Payment.createdAt < now - 30 min
AND EXISTS (LedgerEntry WHERE paymentId = Payment.id AND entryType = 'DEBIT' AND accountType = 'GATEWAY_RECEIVABLE')
AND EXISTS (LedgerEntry WHERE paymentId = Payment.id AND entryType = 'CREDIT' AND accountType = 'CONSUMER_REVENUE')
AND (
  NOT EXISTS (Outbox WHERE aggregateType = 'Payment' AND aggregateId = Payment.id AND status IN ('PENDING', 'CLAIMED'))
)
```

The last condition distinguishes M3 from M9:
- **M9** (stuck CAPTURE_PENDING): outbox is PENDING/CLAIMED past TTL OR outbox is FAILED/missing. If outbox is still PENDING/CLAIMED, it's M9 (publisher hasn't processed it yet — may be transient).
- **M3** (missing capture status): the outbox has been processed (PUBLISHED or FAILED), but the Payment status was never flipped. This means the publisher's success-txn or failure-handling didn't complete the status transition.

**Critical distinction:** M3 fires when the outbox is PUBLISHED (publisher thinks it's done) but Payment is still CAPTURE_PENDING. This is a **publisher success-txn crash** — the gateway call may have succeeded, but the DB write that flips status didn't commit.

---

## C. Authoritative Gateway Truth Required

**M3 remediation MUST verify the gateway state before any DB mutation.** The gateway is the authoritative source of "did the capture actually happen?"

**Required gateway API:** `Razorpay.payments.fetch(razorpayPaymentId)` — returns the payment object with a `status` field (`captured` / `authorized` / `failed` / `refunded`).

**Current state:** The `src/lib/razorpay.ts` file does NOT have a `fetchRazorpayPaymentStatus()` function. The existing functions are:
- `createRazorpayOrder()` — creates an order
- `captureRazorpayPayment()` — captures a payment
- `refundRazorpayPayment()` — refunds a payment
- `verifyRazorpaySignature()` — verifies checkout signature
- `verifyWebhookSignature()` — verifies webhook HMAC

**M3 implementation would need to add:** `fetchRazorpayPaymentStatus(razorpayPaymentId)` — a new function that calls `instance.payments.fetch(razorpayPaymentId)` in real mode, or returns a mock status in demo mode. This is a **new external call** — it must be placed OUTSIDE any `withTransaction()` body (TRANSACTION_RETRY_INVARIANT).

**Gateway truth outcomes:**

| Gateway status | Meaning | M3 repair action |
|----------------|---------|-------------------|
| `captured` | Capture succeeded at gateway. DB is wrong (should be CAPTURED). | Flip Payment.status to CAPTURED (conditional updateMany WHERE status=CAPTURE_PENDING). |
| `authorized` | Payment authorized but NOT captured. Gateway did not capture. DB is correct (should be CAPTURE_PENDING). | DO NOT flip status. Re-enqueue outbox for capture retry (this is M9 territory, not M3). Escalate. |
| `failed` | Payment failed at gateway. DB is wrong (should be FAILED). | DO NOT flip to CAPTURED. Escalate (this is a different mismatch — Payment should be FAILED, not CAPTURED). |
| `refunded` | Payment was captured then refunded. DB is wrong (should be REFUNDED). | DO NOT flip to CAPTURED. Escalate (this is a multi-state drift — requires accounting review). |
| API error / timeout | Gateway state is ambiguous. | DO NOT flip status. Abort + retry later. Escalate if persistent. |

---

## D. Proposed State Transition

**If gateway confirms `captured`:**
```sql
UPDATE "Payment"
SET status = 'CAPTURED', capturedAt = now(), version = version + 1
WHERE id = :paymentId AND status = 'CAPTURE_PENDING'
```

This is a **conditional updateMany** (race-safe optimistic locking — same pattern as the publisher + webhook handler). If a concurrent path (webhook, publisher retry) already flipped the status, `count = 0` → skip (idempotent).

**If gateway says anything else:** DO NOT mutate Payment.status. Escalate to ExceptionQueue.

**Additional writes in the repair txn:**
1. `RemediationAction` row (audit trail — repairType = `M3_GATEWAY_VERIFIED_STATUS_FLIP`).
2. `AuditLog` row (`RECONCILIATION_REPAIR_M3_CAPTURE_STATUS_FLIPPED`) — the repair is a business event, goes in the hash-chained audit log.
3. `ReconciliationFinding` resolution (resolvedAt + resolutionNote).

**What the repair does NOT write:**
- ❌ `LedgerEntry` — no ledger mutation (the capture ledger pair already exists; M3 is a status-only repair).
- ❌ `Outbox` — no outbox enqueue (the outbox event was already PUBLISHED; M3 is not a retry).
- ❌ `Refund` — no refund interaction.
- ❌ `WebhookEvent` — no webhook processing.
- ❌ `IdempotencyKey` — no idempotency-key mutation.

---

## E. Race / Concurrency Analysis

M3 remediation could race with FOUR concurrent paths that also mutate `Payment.status`:

### E.1 Race with capture webhook (`payment.captured`)

**Scenario:** M3 remediation reads gateway → gateway says `captured` → M3 flips Payment.status to CAPTURED. Simultaneously, a `payment.captured` webhook arrives + the webhook handler also tries to flip Payment.status to CAPTURED.

**Existing protection:** The webhook handler uses `tx.payment.updateMany WHERE id = :id AND version = :version AND status != 'CAPTURED'` (conditional update — if already CAPTURED, count=0, no-op). See `src/lib/webhook-processor.ts:148-161`.

**M3 remediation must use the SAME pattern:** `updateMany WHERE id = :id AND status = 'CAPTURE_PENDING'`. If the webhook won the race, M3's updateMany returns count=0 → skip (idempotent). No conflict.

**Verdict:** ✅ SAFE — conditional updateMany prevents race with webhook.

### E.2 Race with capture route (`POST /api/payments`)

**Scenario:** M3 remediation flips Payment to CAPTURED. Simultaneously, the capture route tries to create a NEW Payment for the same order (double-click on Pay).

**Existing protection:** The capture route checks `order.payment.status === 'CAPTURED'` (line 104) and returns 409 if the order already has a captured payment. M3's status flip to CAPTURED would make this check return 409 — preventing a duplicate capture.

**Edge case:** If M3 flips status to CAPTURED while the capture route is mid-txn (between the `order.payment` check and the `tx.payment.create`), the capture route could create a SECOND Payment. However, the capture route's `tx.payment.create` uses `orderId` which is `@unique` — a second create would throw P2002 (unique constraint) → the route's `withTransaction` retries → `getCachedResponse` finds the existing Payment → returns cached response. This is the existing idempotency pattern (Wave-3 3b).

**Verdict:** ✅ SAFE — unique constraint on `Payment.orderId` + idempotency cache prevents duplicate.

### E.3 Race with outbox publisher (capture retry)

**Scenario:** M3 remediation flips Payment to CAPTURED. Simultaneously, the publisher picks up a re-enqueued outbox event + tries to call `captureRazorpayPayment()` + flip status.

**Existing protection:** The publisher's capture handler checks `if (payment.status === 'CAPTURED') { skip }` (line 79) and `if (payment.status !== 'CAPTURE_PENDING') { throw }` (line 104). If M3 already flipped to CAPTURED, the publisher's `updateMany WHERE status = 'CAPTURE_PENDING'` returns count=0 → skip AuditLog → mark outbox PUBLISHED. This is the existing 4c idempotency pattern.

**Edge case:** If the publisher calls `captureRazorpayPayment()` BEFORE M3 flips the status, and the gateway capture succeeds, but M3 also calls `fetchRazorpayPaymentStatus()` + flips status — both paths converge on `updateMany WHERE status = 'CAPTURE_PENDING'`. The first to commit wins; the second gets count=0 → skip. No double-write.

**Verdict:** ✅ SAFE — publisher's idempotency check (status === CAPTURED → skip) + conditional updateMany prevents race.

### E.4 Race with another M3 remediation worker

**Scenario:** Two M3 remediation workers process the same finding simultaneously.

**Protection:** `RemediationAction` unique constraint on `(findingId, repairType)` — the second worker's insert throws P2002 → the handler catches it + returns SKIPPED. This is the same idempotency pattern proven in M16 (E3).

**Verdict:** ✅ SAFE — RemediationAction unique constraint prevents duplicate repair.

### E.5 Race with M9 remediation (future, if authorized)

**Scenario:** M3 remediation flips Payment to CAPTURED. Simultaneously, M9 remediation (if authorized later) re-enqueues the outbox event for capture retry.

**Protection:** The publisher's capture handler checks `payment.status === 'CAPTURED'` → skip. If M3 flipped first, M9's re-enqueue results in the publisher skipping the capture call (no duplicate charge at gateway). If M9's re-enqueue + publisher capture succeeds first, M3's `fetchRazorpayPaymentStatus` returns `captured` → M3's `updateMany WHERE status = 'CAPTURE_PENDING'` returns count=0 → skip (already CAPTURED).

**Verdict:** ✅ SAFE — both paths converge on the same conditional updateMany + publisher idempotency check.

---

## F. Idempotency Analysis

### F.1 Repair handler idempotency

If the M3 remediation worker crashes between the gateway-fetch + the status-flip, a retry must NOT cause a second gateway call or a second status mutation.

**Mechanism:**
1. `RemediationAction` unique constraint on `(findingId, repairType = 'M3_GATEWAY_VERIFIED_STATUS_FLIP')` — second attempt to create a RemediationAction for the same finding throws P2002 → handler catches + returns SKIPPED.
2. `Payment.updateMany WHERE status = 'CAPTURE_PENDING'` — if the status was already flipped, count=0 → skip.
3. The gateway-fetch (`fetchRazorpayPaymentStatus`) is a GET — idempotent by nature. Calling it twice is safe (no side-effect at gateway).

**Verdict:** ✅ IDEMPOTENT — RemediationAction dedup + conditional updateMany + idempotent GET.

### F.2 Re-validation before repair (SI-1)

Before any repair, the M3 handler MUST re-read the current Payment state. The finding may be stale — the publisher or webhook may have already flipped the status.

**Mechanism:** Re-read `Payment.findUnique({ where: { id: finding.entityId } })`. If `status !== 'CAPTURE_PENDING'`, the finding is stale → mark resolved ("stale — status already flipped by external action") + return SKIPPED.

**Verdict:** ✅ RE-VALIDATION enforced — same pattern as M16.

---

## G. External Call / Transaction Boundary

### G.1 The gateway-fetch call

`fetchRazorpayPaymentStatus(razorpayPaymentId)` is an external HTTP call to Razorpay's API. Per the TRANSACTION_RETRY_INVARIANT:

> "Any call that produces an observable side-effect outside the database transaction (Razorpay capture, payment order creation, SMS, email, push notification, webhook send, third-party API call, etc.) must not be blindly re-executed by the withTransaction() retry loop."

A GET (fetch) does NOT produce a side-effect at the gateway — it's a read-only query. However, the TRANSACTION_RETRY_INVARIANT still applies: the fetch MUST be placed OUTSIDE any `withTransaction()` body, so a P2034 retry of the status-flip txn does NOT re-fire the gateway fetch.

**Pattern (mirrors Wave-4 4c / Wave-5 5a):**
```text
1. [OUTSIDE txn] Call fetchRazorpayPaymentStatus(gatewayPaymentId)
2. If gateway says 'captured' → proceed to step 3
3. [INSIDE txn] Payment.updateMany WHERE status='CAPTURE_PENDING' → CAPTURED
                 + RemediationAction.create + AuditLog.create + ReconciliationFinding.update
4. [OUTSIDE txn] Post-repair verification: re-read Payment.status to confirm CAPTURED
```

**Verdict:** ✅ COMPLIANT — external call OUTSIDE txn body (TRANSACTION_RETRY_INVARIANT preserved).

### G.2 Demo mode vs real mode

In demo mode (`realPayments=false`), `fetchRazorpayPaymentStatus` would return a mock status. For M3 evidence (SQLite + PostgreSQL), the mock should return `captured` (simulating a successful gateway capture). For real-mode evidence (E12 — requires `realPayments=true`), the actual Razorpay test API would be called.

**Important:** M3 evidence in demo mode can only prove the DB-side safety (status-flip + idempotency + no money-state mutation). It CANNOT prove that the gateway-fetch correctly interprets real Razorpay responses. That requires E12 (PostgreSQL + `realPayments=true` — separate authorization).

---

## H. Failure and Ambiguity Behavior

### H.1 Gateway returns `captured` (clear answer)

**Action:** Proceed with status-flip. Payment.updateMany WHERE status=CAPTURE_PENDING → CAPTURED.

### H.2 Gateway returns `authorized` / `failed` / `refunded` (clear answer, but NOT captured)

**Action:** DO NOT flip to CAPTURED. The DB state is correct (or needs a DIFFERENT repair). Escalate to ExceptionQueue:
- `authorized` → the capture didn't happen. This is an M9 issue (re-enqueue for capture retry). Escalate.
- `failed` → the payment failed. The DB should be FAILED, not CAPTURE_PENDING. Escalate (different mismatch).
- `refunded` → the payment was captured + refunded. The DB should be REFUNDED. Escalate (multi-state drift — accounting review).

### H.3 Gateway returns API error / timeout (ambiguous)

**Action:** DO NOT flip status. Abort the repair. Mark the RemediationAction as FAILED (`status=FAILED`, `error=gateway-error`). The finding stays unresolved — the next reconciliation run will re-detect it + the alert will fire. If the gateway is persistently unavailable, the finding will eventually be escalated by an operator.

**Critical rule (SI-3):** External gateway ambiguity = NO automatic repair. Never guess. Never flip status based on an assumption.

### H.4 Gateway returns unexpected status (e.g., `created`, `attempted`)

**Action:** DO NOT flip status. Escalate to ExceptionQueue with the unexpected status recorded. An operator must investigate.

### H.5 `gatewayPaymentId` is null

**Edge case:** The Payment row has `gatewayPaymentId = null` (shouldn't happen for a CAPTURE_PENDING payment — the capture route always sets it). If it IS null, M3 cannot call `fetchRazorpayPaymentStatus` (no payment ID to fetch).

**Action:** DO NOT proceed. Escalate to ExceptionQueue ("cannot verify gateway state — gatewayPaymentId is null").

---

## I. CLOSED-Wave Invariant Compatibility

### I.1 Wave-3 (P0-01 capture) invariants

| Invariant | Impact of M3 repair |
|-----------|---------------------|
| I-01 Payment Integrity | ✅ M3 FLIPS status to CAPTURED (the correct state if gateway confirms). Does NOT create a new Payment. Does NOT modify the amount. |
| I-04 Capture Uniqueness | ✅ M3 does NOT create a second Payment. The `Payment.orderId` unique constraint + the capture route's `order.payment.status === 'CAPTURED'` check prevent duplicates. |

### I.2 Wave-4 (P0-02 ledger + P0-05 webhook + 4c retry invariant) invariants

| Invariant | Impact of M3 repair |
|-----------|---------------------|
| I-06 Ledger Balance | ✅ M3 does NOT touch LedgerEntry. The capture ledger pair already exists (M3's triggering condition). M3 is a status-only repair. |
| I-04 (webhook dedup) | ✅ M3 does NOT touch WebhookEvent. The webhook handler's `eventId` unique constraint is unaffected. |
| TRANSACTION_RETRY_INVARIANT | ✅ M3's gateway-fetch is OUTSIDE the txn body. The status-flip txn does NOT include the external call. A P2034 retry re-runs only the DB writes (updateMany is idempotent via WHERE status=CAPTURE_PENDING). |

### I.3 Wave-5A (P0-04 refund + Option A pending ledger) invariants

| Invariant | Impact of M3 repair |
|-----------|---------------------|
| I-03 Refund Integrity | ✅ M3 does NOT touch Refund. If the gateway says `refunded`, M3 escalates (does NOT flip to CAPTURED). |
| Option A pending ledger | ✅ M3 does NOT touch LedgerEntry. The 5A Option A pending reservation (reversal Dr/Cr for refunds) is unaffected. |

### I.4 Wave-5B (P0-03 detection) invariants

| Invariant | Impact of M3 repair |
|-----------|---------------------|
| Detection-only (5B) | ✅ M3 is a 5C remediation handler — it's a SEPARATE code path from the 5B detectors. The 5B detectors are read-only + immutable. M3 does NOT modify any 5B code. |
| `ReconciliationFinding` | ✅ M3 resolves the finding (sets resolvedAt). This is the intended lifecycle — 5B detects, 5C repairs. |

### I.5 Wave-5C M16 (operational remediation) compatibility

| Invariant | Impact of M3 repair |
|-----------|---------------------|
| M16 operational boundary | ✅ M3 is a DIFFERENT repair type (status mutation, not publisher trigger). M16's code path is unaffected. M3's RemediationAction uses `repairType = 'M3_GATEWAY_VERIFIED_STATUS_FLIP'` (distinct from M16's `'M16_PUBLISHER_TRIGGER'`). |

**Verdict:** ✅ ALL CLOSED-wave invariants preserved. M3 is a NEW code path that mutates ONLY `Payment.status` (via conditional updateMany) + writes to `RemediationAction` + `AuditLog` + `ReconciliationFinding`. It does NOT touch any other CLOSED-wave table.

---

## J. Classification

### M3 — MISSING_CAPTURE_STATUS: CLASS C (Requires External Razorpay Verification)

**Classification rationale:**

| Criterion | Assessment |
|-----------|------------|
| Is the repair deterministic? | ⚠️ CONDITIONAL — depends on gateway truth. If gateway says `captured` → deterministic flip. If gateway says anything else → escalate (not deterministic). |
| Does the repair require external state? | ✅ YES — Razorpay gateway truth is authoritative. |
| Can the repair race with other paths? | ✅ YES — but all races are safe (conditional updateMany + idempotency checks). |
| Is the repair idempotent? | ✅ YES — RemediationAction unique constraint + conditional updateMany + idempotent GET. |
| Does the repair mutate financial state? | ⚠️ PARTIAL — it mutates `Payment.status` (a business-state field) but does NOT mutate `LedgerEntry` (accounting state). The ledger already reflects the capture (M3's triggering condition). |
| Can the repair create new drift? | ⚠️ LOW RISK — if the gateway-fetch is wrong (bug in parsing), the status could be flipped incorrectly. Mitigated by: (a) explicit gateway status mapping, (b) post-repair verification, (c) escalation on any ambiguity. |
| Should this be automatic? | ⚠️ CONDITIONAL — automatic ONLY if `reconciliationAutoRepair` flag is ON AND the gateway returns a clear `captured` status. Any ambiguity → escalate. |

**CLASS C confirmed:** M3 requires external Razorpay verification before any DB mutation. The repair is a status mutation (not a ledger mutation), which is lower risk than CLASS B (ledger synthesis). But it is NOT as safe as CLASS A (M16 — operational, no financial mutation).

---

## K. Proposed SQLite Evidence Scenarios

| # | Scenario | What it proves |
|---|----------|----------------|
| **M3-E1** | M3 detection + gateway-confirmed status flip | Seed a CAPTURE_PENDING Payment with capture ledger pair + old createdAt + PUBLISHED outbox. Mock gateway returns `captured`. Run remediation → Payment.status flips to CAPTURED. RemediationAction created. |
| **M3-E2** | Re-validation prevents stale repair | Seed M3 finding, then manually flip Payment to CAPTURED (simulate webhook). Run remediation → re-validation detects status is already CAPTURED → SKIPPED. |
| **M3-E3** | Idempotent retry — no duplicate repair | Run M3 remediation twice on the same finding. Second run → RemediationAction unique constraint → SKIPPED. |
| **M3-E4** | No money-state mutation (CRITICAL) | Snapshot Payment/Refund/LedgerEntry/Outbox/WebhookEvent/IdempotencyKey/AuditLog before + after. Assert: only Payment.status changed (CAPTURE_PENDING → CAPTURED). LedgerEntry unchanged. Outbox unchanged. |
| **M3-E5** | Gateway says `authorized` → escalate (no flip) | Mock gateway returns `authorized`. Run remediation → DO NOT flip status. RemediationAction status=FAILED. Finding stays unresolved. ExceptionQueue entry created. |
| **M3-E6** | Gateway error → abort + retry later | Mock gateway throws error. Run remediation → DO NOT flip status. RemediationAction status=FAILED, error recorded. Finding stays unresolved. |
| **M3-E7** | Flag OFF → DISABLED | `reconciliationAutoRepair=false`. Run remediation → returns DISABLED. No RemediationAction created. |
| **M3-E8** | Post-repair verification — status confirmed | After M3-E1, re-read Payment.status → CAPTURED. ReconciliationFinding resolved. |

---

## L. Proposed PostgreSQL Evidence Scenarios

| # | Scenario | What it proves | Mandatory? |
|---|----------|----------------|:----------:|
| **M3-E9** | Concurrent M3 remediation + capture webhook | Two paths try to flip Payment.status simultaneously. Conditional updateMany ensures exactly 1 succeeds. No duplicate AuditLog. | **✅ PostgreSQL mandatory** |
| **M3-E10** | Concurrent M3 remediation + publisher retry | M3 flips status while publisher also tries to capture. Publisher's idempotency check (status === CAPTURED → skip) prevents duplicate capture at gateway. | **✅ PostgreSQL mandatory** |
| **M3-E11** | Money-state immutability on PostgreSQL (CRITICAL) | Row-level before/after snapshot. Assert: only Payment.status + Payment.version changed. LedgerEntry/Refund/Outbox/WebhookEvent/IdempotencyKey rows unchanged. | **✅ PostgreSQL mandatory** |
| **M3-E12** | Scale — 1000+ M3 findings + mixed gateway responses | Seed 1000 CAPTURE_PENDING payments (mix of gateway-captured + gateway-authorized + gateway-error). Run remediation → correct classification + correct action per finding. falsePositives=0. Runtime < SLA. | **✅ PostgreSQL mandatory** |

**E12 with real Razorpay test API:** If the Orchestrator authorizes `realPayments=true` in staging, E12 can verify the gateway-fetch against real Razorpay test-mode payments. Without `realPayments=true`, E12 uses mock gateway responses (proving DB-side safety but NOT gateway-parsing correctness).

---

## M. Required Safety Invariants

| # | Invariant | Rationale |
|---|-----------|-----------|
| **M3-SI-1** | Re-validation before repair (re-read Payment.status; if not CAPTURE_PENDING → skip) | Finding may be stale (webhook/publisher may have already flipped). |
| **M3-SI-2** | Repair idempotency (RemediationAction unique constraint + conditional updateMany) | Crash + retry must NOT cause second gateway call or second status mutation. |
| **M3-SI-3** | Gateway ambiguity = no repair (error/timeout → abort, do NOT flip) | Never guess. Never flip status based on assumption. |
| **M3-SI-4** | Conditional updateMany (WHERE status=CAPTURE_PENDING) — race-safe | Prevents overwriting a concurrent state change by webhook/publisher. |
| **M3-SI-5** | Gateway-fetch OUTSIDE any withTransaction body | TRANSACTION_RETRY_INVARIANT — a P2034 retry must NOT re-fire the gateway API call. |
| **M3-SI-6** | RemediationAction audit record created | The repair is a business mutation — must be auditable. |
| **M3-SI-7** | AuditLog entry created (RECONCILIATION_REPAIR_M3_CAPTURE_STATUS_FLIPPED) | The repair is a business event — goes in the hash-chained audit log. |
| **M3-SI-8** | Post-repair verification (re-read Payment.status to confirm CAPTURED) | The repair may not have worked (concurrent write). Verify, don't assume. |
| **M3-SI-9** | Feature-flagged (reconciliationAutoRepair, default OFF) | Orchestrator must explicitly authorize. Even after implementation, flag starts OFF. |
| **M3-SI-10** | NO LedgerEntry mutation | M3 is a status-only repair. The capture ledger pair already exists. |
| **M3-SI-11** | NO Outbox enqueue | M3 is NOT a retry. The outbox event was already PUBLISHED. M3 repairs the DB state, not the event. |
| **M3-SI-12** | NO Razorpay capture/refund call | M3 does NOT capture or refund. It only FETCHES gateway state (read-only GET). |
| **M3-SI-13** | Escalate on any non-`captured` gateway status | `authorized`/`failed`/`refunded`/unexpected → ExceptionQueue + alert. |

---

## N. Explicit Recommendation

### CONDITIONAL GO

**The condition:** M3 implementation is authorized **ONLY if** all of the following are satisfied:

1. **`fetchRazorpayPaymentStatus()` is added to `src/lib/razorpay.ts`** — a new function that calls `instance.payments.fetch(razorpayPaymentId)` in real mode + returns a mock status in demo mode. This is a new external call — must be OUTSIDE any txn body (SI-5).

2. **The M3 remediation handler is a NEW code path** in `src/lib/reconciliation.ts` — `remediateM3MissingCaptureStatus(findingId)`. It does NOT modify the existing capture route, publisher, or webhook handler. CLOSED-wave code is immutable.

3. **The handler follows all 13 safety invariants (M3-SI-1 through M3-SI-13)** — re-validation, idempotency, gateway ambiguity = no repair, conditional updateMany, external call outside txn, audit records, post-repair verification, feature-flagged, no ledger mutation, no outbox enqueue, no capture/refund call, escalate on non-captured.

4. **The handler is feature-flagged** — `reconciliationAutoRepair` must be ON for M3 to execute. Even then, M3 only executes if the gateway returns a clear `captured` status. Any ambiguity → escalate.

5. **SQLite evidence (M3-E1 through M3-E8) must PASS** before PostgreSQL evidence is authorized.

6. **PostgreSQL evidence (M3-E9 through M3-E12) must PASS** before M3 S5 closure is considered.

### What GO would authorize (if a separate implementation directive is issued)

- New `fetchRazorpayPaymentStatus()` function in `src/lib/razorpay.ts`.
- New `remediateM3MissingCaptureStatus()` function in `src/lib/reconciliation.ts`.
- New `processM3Remediations()` batch function (mirrors M16's `processM16Remediations()`).
- New evidence endpoints (setup/run/verify for M3-specific scenarios).
- SQLite + PostgreSQL evidence workflows.

### What GO would NOT authorize

- ❌ M9 / M10 implementation (separate directives required).
- ❌ M2 / M7 / M13 remediation (CLASS B — HIGH RISK).
- ❌ M11 / M12 / M14 remediation (CLASS D — quarantine).
- ❌ M1 / M4 / M5 / M6 / M8 / M15 / M17 remediation (CLASS E — never).
- ❌ 5C full closure.
- ❌ Production deployment / feature-flag activation.
- ❌ Wave-6 / Wave-7.

### Rationale

M3 is the **safest gateway-dependent remediation candidate** because:
1. It is a **status mutation** (not a ledger mutation) — lower risk than CLASS B.
2. It uses **conditional updateMany** (same race-safe pattern as the publisher + webhook handler) — proven safe in Wave-4 4c + Wave-5 5a.
3. It is **idempotent** (RemediationAction dedup + conditional updateMany + idempotent GET).
4. It does **NOT capture or refund** — it only FETCHES gateway state (read-only).
5. It **escalates on any ambiguity** — never guesses.

However, M3 is still MORE dangerous than M16 because:
1. It mutates `Payment.status` (a business-state field) — M16 mutates nothing.
2. It requires a **new external call** (`fetchRazorpayPaymentStatus`) — M16 only triggers the existing publisher.
3. It depends on **correctly parsing gateway responses** — a bug in the status mapping could flip the status incorrectly.
4. It races with the **webhook handler + publisher** — though all races are safe (conditional updateMany), the complexity is higher.

**CONDITIONAL GO** is the appropriate recommendation: M3 is safe enough to implement with the right safety invariants, but NOT safe enough to implement without a separate evidence package + Orchestrator authorization.

---

## Stop Point

This Gate Review is COMPLETE. The IDE is STOPPING.

- M3 READ/PLAN-FIRST Gate Review: ✅ COMPLETE.
- M3 implementation: 🔒 NOT YET AUTHORIZED.
- M3 financial mutation: 🔒 NOT AUTHORIZED.
- M9 / M10: 🔒 HOLD.
- Production: 🚫 NOT AUTHORIZED.
- `realPayments` / `webhookHandler` / `requestHashEnforcement` / `reconciliationAutoRepair`: 🚫 ALL OFF.
- Wave-3/4/5A/5B/5C-M16: ✅ CLOSED — immutable. M3 does not touch them.
- Wave-6 / Wave-7: 🔒 LOCKED.

**Next governance checkpoint:** Orchestrator decision on M3 implementation authorization. The Orchestrator may:
- (a) Authorize M3 implementation per the CONDITIONAL GO recommendation.
- (b) Defer M3 (keep on detection + operator review).
- (c) Reject the plan + demand a different approach.
- (d) Authorize M9 or M10 instead (though the Orchestrator noted M3 is the safest gateway-dependent candidate).

**The IDE must NOT interpret a successful planning review as authorization for M3 implementation.** Implementation requires a separate explicit Orchestrator directive.

---

**End of Gate Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `realPayments` OFF. `webhookHandler` OFF. `requestHashEnforcement` OFF. `reconciliationAutoRepair` OFF. Wave-3/4/5A/5B/5C-M16 CLOSED — immutable. Wave-6/7 LOCKED.**

**STOP. Awaiting Orchestrator decision on M3 implementation authorization.**
