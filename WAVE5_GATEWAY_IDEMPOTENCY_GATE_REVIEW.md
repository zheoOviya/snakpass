# Wave-5 — Gateway Idempotency Key: READ/PLAN-FIRST Gate Review

**Document type:** Gate Review (READ/PLAN-FIRST — NO implementation authorization).
**Directive ID:** `WAVE5-GATEWAY-IDEMPOTENCY-READ-PLAN-FIRST-01`
**Author:** IDE (read-only synthesis from repository + M9/M10 closure evidence).
**Orchestrator directive:** Gateway Idempotency Key READ/PLAN-FIRST AUTHORIZED. Implementation 🔒 NOT YET AUTHORIZED. This is a separate safety workstream — does NOT reopen M9/M10.
**Created:** 2026-08-17
**Scope:** Pre-generated gateway idempotency key architecture for `captureRazorpayPayment()` and `refundRazorpayPayment()` — the deferred gap that prevents M9/M10 retry/re-enqueue paths from being authorized.

> **Governance rule:** This document is a READ-ONLY planning artifact. It does NOT authorize implementation, schema change, migration, evidence workflow, or any financial mutation. The IDE has NOT written any gateway-idempotency code. Implementation requires a separate Orchestrator directive after this Gate Review is reviewed.

> **Orchestrator constraint honored:** This is a **separate safety workstream** — it does NOT reopen M9, M10, or any CLOSED remediation gate. M9/M10 closures remain valid with their PROHIBITED re-enqueue paths. This review designs the architecture that would *eventually* make those retry paths safe — but does NOT authorize them.

---

## A. Current Architecture

### A.1 Gateway calls (current state — NO idempotency key)

| Function | File | Gateway API call | Idempotency key? |
|----------|------|-----------------|:----------------:|
| `createRazorpayOrder()` | `src/lib/razorpay.ts:49` | `instance.orders.create({amount, currency})` | ❌ NO |
| `captureRazorpayPayment()` | `src/lib/razorpay.ts:108` | `instance.payments.capture(razorpayPaymentId, amount, currency)` | ❌ NO |
| `refundRazorpayPayment()` | `src/lib/razorpay.ts:169` | `instance.payments.refund(razorpayPaymentId, {amount, currency})` | ❌ NO |
| `fetchRazorpayPaymentStatus()` | `src/lib/razorpay.ts:192` | `instance.payments.fetch(razorpayPaymentId)` | N/A (read-only) |
| `fetchRazorpayRefundStatus()` | `src/lib/razorpay.ts:296` | `instance.refunds.fetch(refundId)` | N/A (read-only) |

### A.2 Transaction boundary (current — correct)

All gateway mutation calls are OUTSIDE any `withTransaction()` body (TRANSACTION_RETRY_INVARIANT — Wave-4 4c + Wave-5 5a). The publisher calls them between claiming the outbox event and committing the success-txn. This is correct — but it does NOT protect against **publisher retry** (the publisher re-claims the event after a crash + calls the gateway API again).

### A.3 Razorpay SDK idempotency support

The Razorpay Node.js SDK (`razorpay@2.9.8`) supports an `idempotency_key` parameter on certain endpoints:
- `instance.orders.create()` — accepts `idempotency_key` in the request body.
- `instance.payments.capture()` — the SDK accepts options but the `X-Idempotency-Key` header support is **unclear** (Razorpay's official documentation mentions idempotency for `orders.create` and `payments.refund` but NOT explicitly for `payments.capture`).
- `instance.payments.refund()` — accepts `idempotency_key` in the request body per Razorpay docs.

**Critical:** We explicitly refuse to rely on undocumented gateway behavior (TRANSACTION_RETRY_INVARIANT.md §4.2). The gate review must verify per-endpoint whether Razorpay honors the key.

---

## B. Existing Retry Behavior

### B.1 Publisher retry loop

```text
1. Publisher claims outbox event (status PENDING → CLAIMED + lease).
2. Publisher calls gateway API (capture/refund) OUTSIDE txn.
3. If gateway succeeds → success-txn (flip status + AuditLog + Outbox PUBLISHED).
4. If gateway fails → increment attempts + lastError + back to PENDING with backoff.
5. After MAX_RETRIES (5) → status = FAILED (manual intervention).
```

### B.2 The dangerous gap

If step 2 succeeds at the gateway (money actually moved) but step 3 fails (crash, P2034 retry of the success-txn, etc.), the publisher's retry loop will **re-execute step 2** — calling the gateway API again. Without an idempotency key:

- **Capture:** Customer is charged twice.
- **Refund:** Customer is refunded twice.

The publisher's existing idempotency check (`if payment.status === 'CAPTURED' → skip`) only protects against re-running step 3 — it does NOT prevent re-running step 2 (the gateway call itself).

---

## C. Current Idempotency Mechanisms

| Mechanism | What it protects | What it does NOT protect |
|-----------|-----------------|-------------------------|
| `IdempotencyKey` table (P0-17) | Client retry of POST /api/payments, POST /api/payments/refund | Publisher retry of the gateway call |
| `Payment.idempotencyKey` unique constraint (P0-25 Case C) | Duplicate Payment creation | Duplicate gateway capture |
| `Refund.idempotencyKey` unique constraint | Duplicate Refund creation | Duplicate gateway refund |
| Publisher status check (`status === CAPTURED/REFUNDED → skip`) | Re-running success-txn after status already flipped | Re-running the gateway call before status flips |
| `Outbox.eventId` unique (consumer-side dedup) | Duplicate event delivery to consumers | Duplicate gateway mutation |

**The gap:** There is NO mechanism that prevents the publisher from calling `captureRazorpayPayment()` / `refundRazorpayPayment()` twice for the same outbox event if the first call succeeded at the gateway but the success-txn crashed.

---

## D. Gateway Idempotency Gap

### D.1 The fundamental problem

```text
Publisher claims outbox event E1
    ↓
Calls captureRazorpayPayment(pay_X, amount)     ← money moves at gateway
    ↓
Success-txn begins (Payment CAPTURE_PENDING → CAPTURED)
    ↓
Crash / P2034 / timeout                          ← success-txn fails
    ↓
Publisher retries: re-claims E1
    ↓
Calls captureRazorpayPayment(pay_X, amount)     ← DUPLICATE CHARGE
```

### D.2 Why the existing checks don't help

- `Payment.status === 'CAPTURE_PENDING'` at retry time (the success-txn didn't commit) → publisher proceeds with capture.
- No idempotency key sent to gateway → gateway has no way to know this is a duplicate.
- `getCachedResponse()` (P0-17) only works for HTTP API retries, not publisher retries.

---

## E. Required Key Lifecycle

### E.1 Key generation timing

The idempotency key MUST be generated **before** the gateway call, and persisted in the database **inside** the original business transaction (the capture route / refund route txn). This ensures:

1. The key survives process crashes (it's in the DB).
2. The publisher can read the key from the outbox event payload (or a dedicated column).
3. Re-delivery of the same outbox event reuses the same key.

### E.2 Key persistence

**Option 1: Store in Outbox payload (recommended)**

The capture/refund route already writes an outbox event with a JSON payload. Add a `gatewayIdempotencyKey` field to the payload:

```json
{
  "paymentId": "...",
  "orderId": "...",
  "gatewayPaymentId": "pay_X",
  "amount": 32000,
  "gatewayIdempotencyKey": "idem_cms..._capture"
}
```

The publisher reads this key from the payload and passes it as the `X-Idempotency-Key` header (or `idempotency_key` body parameter) to the Razorpay API.

**Advantages:**
- No schema change needed (payload is already a JSON string).
- The key is atomic with the business transaction (written in the same txn as Payment + Outbox).
- The key is deterministic (same key for all retries of the same event).

**Option 2: Add a dedicated column to Outbox**

Add a `gatewayIdempotencyKey` column to the `Outbox` model. This is a Class-2 additive migration (no breaking change). More queryable but requires a schema change.

### E.3 Key format

The key should be deterministic + unique per business operation:
- Capture: `idem_<paymentId>_capture` (or a UUID generated at route time + stored in payload).
- Refund: `idem_<refundId>_refund` (or a UUID generated at route time + stored in payload).

Using a UUID is safer (no PII in the key, no predictable pattern). The key is generated in the route handler (before the txn) and stored in the outbox payload (inside the txn).

### E.4 Key reuse

The key MUST be reused across all retries of the same outbox event. The publisher reads it from the payload on each attempt — it does NOT generate a new key. This ensures the gateway sees the same key and deduplicates.

### E.5 Key retention/lifecycle

The key persists as long as the outbox event exists. Since outbox events are never deleted (they're an audit trail), the key persists indefinitely. This is correct — Razorpay's idempotency keys are valid for 24 hours (per their docs); after that, the same key may be rejected or treated as a new request. For our use case, retries happen within minutes (backoff schedule: 1s, 5s, 30s, 5min, 15min — total ~20 min), well within the 24-hour window.

---

## F. Capture Retry Design

### F.1 Current capture flow

```text
Capture route (POST /api/payments):
  1. withTransaction:
     - Payment.create(status=CAPTURE_PENDING)
     - Order.update(status=PAID)
     - LedgerEntry.create(Dr + Cr)
     - AuditLog.create(PAYMENT_CAPTURE_PENDING)
     - Outbox.create(PAYMENT_CAPTURE_REQUESTED, payload={paymentId, gatewayPaymentId, amount})
     - IdempotencyKey.create (if header present)
  2. Return CAPTURE_PENDING to client.
```

### F.2 Proposed capture flow (with gateway idempotency key)

```text
Capture route (POST /api/payments):
  1. Generate gatewayIdempotencyKey = randomUUID()    ← BEFORE txn
  2. withTransaction:
     - Payment.create(status=CAPTURE_PENDING)
     - Order.update(status=PAID)
     - LedgerEntry.create(Dr + Cr)
     - AuditLog.create(PAYMENT_CAPTURE_PENDING)
     - Outbox.create(PAYMENT_CAPTURE_REQUESTED,
         payload={paymentId, gatewayPaymentId, amount,
                  gatewayIdempotencyKey})              ← KEY IN PAYLOAD
     - IdempotencyKey.create (if header present)
  3. Return CAPTURE_PENDING to client.

Publisher (processPaymentCaptureRequested):
  1. Read outbox event payload → extract gatewayIdempotencyKey.
  2. Call captureRazorpayPayment(gatewayPaymentId, amount, currency,
       {headers: {'X-Idempotency-Key': gatewayIdempotencyKey}})
     ← KEY SENT TO GATEWAY
  3. Success-txn: Payment → CAPTURED + AuditLog + Outbox PUBLISHED.
```

### F.3 What changes

- `captureRazorpayPayment()` signature: add optional `idempotencyKey` parameter.
- Razorpay SDK call: pass `idempotency_key` in the request body or `X-Idempotency-Key` header.
- Capture route: generate key + store in outbox payload.
- Publisher: read key from payload + pass to `captureRazorpayPayment()`.

### F.4 What does NOT change

- The route's transaction structure (Payment + Ledger + AuditLog + Outbox atomic).
- The publisher's call placement (OUTSIDE txn body — TRANSACTION_RETRY_INVARIANT).
- The success-txn structure (conditional updateMany + AuditLog + Outbox PUBLISHED).
- The reconciliation detectors (M3/M9) — they don't call capture, they only fetch status.

---

## G. Refund Retry Design

### G.1 Current refund flow

```text
Refund route (POST /api/payments/refund):
  1. withTransaction:
     - Refund.create(status=REFUND_PENDING)
     - LedgerEntry.create(reversal Dr + Cr)
     - AuditLog.create(PAYMENT_REFUND_PENDING)
     - Outbox.create(PAYMENT_REFUND_REQUESTED, payload={refundId, paymentId, amount, fullRefund})
     - IdempotencyKey.create (if header present)
  2. Return REFUND_PENDING to client.
```

### G.2 Proposed refund flow (with gateway idempotency key)

Same pattern as capture — generate key before txn, store in outbox payload, publisher reads + passes to `refundRazorpayPayment()`.

### G.3 Separate key domains

Capture and refund MUST use separate key domains:
- A capture key applies to one capture attempt for one payment.
- A refund key applies to one refund attempt for one refund.
- Multiple refunds on the same payment (partial refunds) each get their own key.
- The key format includes the business entity ID (paymentId for capture, refundId for refund) to ensure uniqueness.

---

## H. Race Analysis

### H.1 Publisher retry after crash (THE critical scenario)

```text
Attempt 1:
  Publisher claims E1 → calls capture(idempotencyKey=K1) → gateway succeeds
  → success-txn begins → CRASH

Attempt 2 (retry):
  Publisher re-claims E1 → reads K1 from payload → calls capture(idempotencyKey=K1)
  → gateway sees same key → returns cached response (no duplicate charge)
  → success-txn begins → Payment → CAPTURED ✅
```

**Verdict: ✅ SAFE with idempotency key.** The gateway deduplicates the second call.

### H.2 Concurrent publishers (two workers claim the same event)

The existing claim/lease mechanism (`status=CLAIMED + claimUntil`) prevents two workers from processing the same event simultaneously. If the lease expires, only one worker re-claims it.

**Verdict: ✅ SAFE** (existing mechanism + idempotency key = double protection).

### H.3 Gateway timeout with unknown outcome

```text
Publisher calls capture(idempotencyKey=K1) → TIMEOUT (no response)
  → Publisher marks event as failed → retries
  → Re-claims E1 → calls capture(idempotencyKey=K1) → gateway sees same key
  → Two possibilities:
    (a) Gateway processed the first call → returns cached response ✅
    (b) Gateway did NOT process the first call → processes now ✅
  → Either way: exactly one capture at gateway ✅
```

**Verdict: ✅ SAFE with idempotency key.** This is the primary scenario the key solves.

### H.4 M9/M10 reconciliation remediation concurrent with publisher

```text
M9 status-flip: gateway says 'captured' → Payment → CAPTURED
Publisher retry: reads K1 → calls capture(idempotencyKey=K1) → gateway says already captured
  → Publisher's idempotency check (status === CAPTURED → skip) → no success-txn needed
```

**Verdict: ✅ SAFE** — M9/M10 status-flip + publisher retry converge. The idempotency key is an additional safety net.

---

## I. Crash-Recovery Analysis

| Crash point | Without key | With key |
|-------------|:-----------:|:--------:|
| After gateway call, before success-txn | ❌ Duplicate charge on retry | ✅ Gateway deduplicates |
| Before gateway call (outbox claimed but not processed) | ✅ Safe (no gateway call made) | ✅ Safe |
| During success-txn (after gateway call) | ❌ Duplicate charge on retry | ✅ Gateway deduplicates |
| After success-txn commit | ✅ Safe (status already flipped → publisher skips) | ✅ Safe |

**The key eliminates the "after gateway call, before success-txn" crash window** — the most dangerous scenario.

---

## J. Failure/Timeout Handling

| Scenario | Without key | With key |
|----------|:-----------:|:--------:|
| Gateway returns success | ✅ Proceed | ✅ Proceed |
| Gateway returns failure | ✅ Retry (no duplicate — gateway didn't process) | ✅ Retry (gateway deduplicates) |
| Gateway times out (unknown outcome) | ❌ Unsafe (might have processed → retry = duplicate) | ✅ Safe (retry with same key → gateway deduplicates) |
| Gateway returns error after partial processing | ❌ Unsafe | ✅ Safe (same key → gateway deduplicates) |

---

## K. Database Constraints

### K.1 No new unique constraint needed

The idempotency key is stored in the outbox `payload` JSON field (or a new nullable `gatewayIdempotencyKey` column). It does NOT need a unique constraint because:
- The key is generated once per outbox event (inside the business txn).
- The outbox `eventId` is already unique — one event = one key.
- The publisher reads the key from the event payload — it doesn't look it up by key.

### K.2 Optional: dedicated column (if Option 2 chosen)

If a `gatewayIdempotencyKey` column is added to `Outbox`, it should be nullable (existing events don't have it) + indexed (for debugging/audit queries). A unique constraint is NOT required (one event = one key, and `eventId` is already unique).

---

## L. Security/Audit Considerations

- The key is a UUID — no PII, no predictable pattern.
- The key is stored in the outbox payload (JSON) — it's part of the event audit trail.
- The key is visible in the publisher logs (for debugging duplicate-charge investigations).
- The key is NOT sent to the client (it's internal to the publisher → gateway flow).
- The key does NOT expose the payment ID or refund ID (it's a random UUID).

---

## M. Compatibility with CLOSED Waves

| CLOSED wave | Impact of gateway idempotency key |
|-------------|----------------------------------|
| Wave-3 (P0-01 capture) | ✅ COMPATIBLE — the key is generated in the capture route (same txn as Payment + Outbox) and stored in the outbox payload. No change to the route's transaction structure. The publisher reads the key and passes it to `captureRazorpayPayment()`. The capture route code itself does NOT change (only the payload content + the publisher's call). |
| Wave-4 (P0-05 webhook, P0-02 ledger, 4c retry invariant) | ✅ COMPATIBLE — the key does NOT change the webhook handler, ledger entries, or the TRANSACTION_RETRY_INVARIANT. The invariant is preserved (gateway call still outside txn body). The key is an ADDITIONAL safety layer, not a replacement. |
| Wave-5A (P0-04 refund) | ✅ COMPATIBLE — same pattern as capture. Key generated in refund route, stored in outbox payload, publisher reads + passes to `refundRazorpayPayment()`. |
| Wave-5B (P0-03 detection) | ✅ COMPATIBLE — detection is read-only. The key is not used by detectors. |
| Wave-5C M16/M3/M9/M10 | ✅ COMPATIBLE — M3/M9/M10 only FETCH gateway state (they don't call capture/refund). The key does NOT affect their status-flip remediation. When the gateway idempotency key is implemented, it would ENABLE the M9/M10 re-enqueue paths (but that requires a SEPARATE authorization directive — this review does NOT authorize it). |

**Verdict: ✅ ALL CLOSED waves remain compatible.** The gateway idempotency key is an additive safety improvement — it adds a parameter to existing gateway calls and a field to the outbox payload. No CLOSED wave code is modified.

---

## N. Recommendation and Explicit Authorization Boundary

### Recommendation: CONDITIONAL GO

**The condition:** Implementation is authorized **ONLY for**:
1. Adding `gatewayIdempotencyKey` to the outbox payload (in capture route + refund route).
2. Adding `idempotencyKey` parameter to `captureRazorpayPayment()` and `refundRazorpayPayment()`.
3. Modifying the publisher to read the key from the payload + pass it to the gateway API.
4. Verifying per-endpoint that Razorpay honors the key (test-mode API call).

### What GO would NOT authorize

- ❌ **M9/M10 re-enqueue path** — enabling the retry path requires a SEPARATE directive (M9/M10 closures explicitly PROHIBIT re-enqueue). The gateway idempotency key is a prerequisite, not an authorization.
- ❌ **`createRazorpayOrder()` idempotency key** — this is a separate gap (orphan-order leaks, not duplicate-charge). It can be addressed in the same workstream but is a different endpoint.
- ❌ **Production deployment** — the key is tested in demo mode (mock gateway) + staging. Production requires separate authorization.
- ❌ **Feature-flag activation** — `reconciliationAutoRepair` remains OFF.

### Why CONDITIONAL GO (not GO)

The architecture is sound + well-understood (Option B in TRANSACTION_RETRY_INVARIANT.md). But:
1. Razorpay's per-endpoint idempotency key support needs empirical verification (not all endpoints are documented).
2. The implementation touches the capture route, refund route, publisher, and razorpay.ts — multiple CLOSED-wave files. The changes must be additive only (no modification of existing transaction structure).
3. The evidence must prove the key is correctly generated, persisted, reused, and sent to the gateway — including crash/retry scenarios.

### Evidence requirements (if implementation is authorized)

| # | Scenario | What it proves |
|---|----------|----------------|
| E1 | Key is generated + stored in outbox payload | Key persists across crashes. |
| E2 | Publisher reads key from payload + passes to gateway | Key reaches the gateway API. |
| E3 | Publisher retry reuses the same key | No new key generated on retry. |
| E4 | Gateway deduplicates on retry (mock mode) | Second call with same key = cached response (no duplicate). |
| E5 | Crash after gateway call → retry → no duplicate | The critical safety scenario. |
| E6 | No money-state mutation outside the authorized paths | Refund/Ledger/Outbox unchanged by the key addition. |
| E7 | Feature flag respected | Key is only used when `realPayments=true` (in demo mode, key is generated but not sent to gateway — or sent but gateway is mock). |
| E8 | CLOSED wave compatibility | Capture/refund/webhook/publisher flows unchanged in structure. |

---

## Stop Point

This Gate Review is COMPLETE. The IDE is STOPPING.

- Gateway Idempotency Key READ/PLAN-FIRST Gate Review: ✅ COMPLETE.
- Implementation: 🔒 NOT YET AUTHORIZED.
- M9/M10 re-enqueue path: 🔒 NOT AUTHORIZED (requires key implementation + separate directive).
- Production: 🚫 NOT AUTHORIZED.
- `reconciliationAutoRepair`: 🚫 OFF.
- Wave-3/4/5A/5B/5C-M16/M3/M9/M10: ✅ CLOSED — immutable.
- Wave-6 / Wave-7: 🔒 LOCKED.

**Next governance checkpoint:** Orchestrator decision on gateway idempotency key implementation authorization. The Orchestrator may:
- (a) Authorize implementation (per the CONDITIONAL GO recommendation).
- (b) Defer (keep the gap as DEFERRED).
- (c) Reject the plan.
- (d) Prioritize a different workstream (e.g., production readiness, Wave-6).

**The IDE must NOT interpret this review as authorization for implementation.** Implementation requires a separate explicit Orchestrator directive.

---

**End of Gate Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `reconciliationAutoRepair` OFF. `realPayments` OFF. Wave-3/4/5A/5B/5C-M16/M3/M9/M10 CLOSED — immutable. Wave-6/7 LOCKED.**

**STOP. Awaiting Orchestrator decision on gateway idempotency key implementation authorization.**
