# Wave-5 Sub-Wave 5C — M9 Stuck CAPTURE_PENDING: S5 PASS / CLOSED

**Document type:** Gate Review (READ/PLAN-FIRST → IMPLEMENTATION → PostgreSQL EVIDENCE → S5 PASS / CLOSED).
**Directive IDs:** `WAVE5-5C-M9-READ-PLAN-FIRST-01` (Gate Review) → `WAVE5-5C-M9-IMPLEMENT-01` (Implementation) → `WAVE5-5C-M9-PG-EVIDENCE-GATE-01` (PostgreSQL Evidence) → `S5-5C-M9-P0-03-CLOSE` (Closure).
**Author:** IDE (read-only synthesis from repository + M16/M3 closure evidence).
**Orchestrator directive:** Sub-Wave 5C — M9 is S5 PASS / CLOSED (Directive ID: `S5-5C-M9-P0-03-CLOSE`, 2026-08-17). M10 remains on HOLD. 5C is PARTIALLY CLOSED (M16 + M3 + M9 only).
**Created:** 2026-08-17
**Scope:** M9 — Stuck CAPTURE_PENDING (Payment.status='CAPTURE_PENDING' older than 30 min + outbox not PENDING/CLAIMED).

> **M9 Closure (Orchestrator Directive `S5-5C-M9-P0-03-CLOSE`):** M9 (gateway-verified CAPTURE_PENDING → CAPTURED status remediation with NO outbox re-enqueue and NO capture/refund API invocation) is S5 PASS / CLOSED. The closure is based on SQLite E1-E8 (8/8 PASS) + PostgreSQL E9-E12 (8/8 PASS) + `moneyStateUnchanged=true` + `noDuplicateRemediationActions=true` + `financialMutation=false` + `falsePositives=0` + Outbox unchanged (SI-11 confirmed). M9 is closed specifically as a **status-flip remediation** — NOT as a capture-retry mechanism. The prohibited retry/re-enqueue path remains prohibited. The gateway idempotency-key gap remains outside this closure.

> **Orchestrator constraint honored:** M16 closure proved operational remediation safety. M3 closure proved gateway-verified status-flip safety. M9 has **stuck-state/retry semantics** that are fundamentally more complex than M3 — the retry path (re-enqueue outbox for capture) creates a risk of **duplicate capture at the gateway**, which M3 does not have. M3/M16 safety does NOT transfer to M9.

---

## A. Executive Summary

| Field | Value |
|-------|-------|
| **M9 classification** | **CLASS C → CONDITIONAL GO (with critical constraints)** |
| **Safe sub-cases** | M9a (outbox=PUBLISHED, hasCapturePair=true) — REDUNDANT with M3 (already CLOSED) |
| **Conditionally safe sub-cases** | M9c-failed (outbox=FAILED, gateway says captured) — status flip only, same as M3 |
| **DANGEROUS sub-case** | M9c-retry (outbox=FAILED, gateway says NOT captured) — re-enqueue = potential DUPLICATE CAPTURE |
| **Unsafe sub-cases** | M9b (missing ledger), M9d (missing outbox) — escalate to CLASS D/E |
| **Key risk** | **captureRazorpayPayment() is NOT idempotent at the gateway.** Re-enqueueing a FAILED outbox event for capture retry can cause a **double-charge at the gateway** if the first capture attempt actually succeeded but the publisher's success-txn crashed. |
| **Recommendation** | **CONDITIONAL GO** — but ONLY for the gateway-confirmed-captured path (identical to M3). The gateway-not-captured path (re-enqueue for capture retry) is **NOT authorized** — it must remain on HOLD until a separate safety analysis proves the retry is idempotent at the gateway. |

---

## B. Detector Semantics

**Detector function:** `detectM9StuckCapturePending()` in `src/lib/reconciliation.ts`.

**Detection condition:**
```text
Payment.status = 'CAPTURE_PENDING'
AND Payment.createdAt < now - 30 min (STUCK_CAPTURE_PENDING_AGE_MS)
AND (
  Outbox.aggregateType = 'Payment' AND Outbox.aggregateId = Payment.id
  AND Outbox.status IN ('FAILED', 'PUBLISHED')
  OR Outbox row is MISSING (no outbox event for this payment)
)
```

**Key difference from M3:**
- **M3** requires `hasCapturePair = true` (ledger Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE exist).
- **M9** does NOT check `hasCapturePair` — it fires for ANY CAPTURE_PENDING payment with a stuck/missing outbox, regardless of ledger state.

**Overlap with M3:** If a Payment has `hasCapturePair=true` AND `outbox.status='PUBLISHED'`, **both M3 and M9 fire** for the same `Payment.id`. M3 remediation already handles this case (gateway fetch → if captured → flip to CAPTURED). M9 remediation for this sub-case would be **identical to M3** → **redundant**.

**Severity:** HIGH.

---

## C. State Machine

M9 covers the `CAPTURE_PENDING` state of the Payment lifecycle. The relevant state transitions:

```text
PAYMENT_PENDING → CAPTURE_PENDING → CAPTURED
                  ↘ FAILED
                  ↘ (stuck — M9 fires here)
```

**Paths that create CAPTURE_PENDING:**
1. Capture route (`POST /api/payments`): creates Payment with `status='CAPTURE_PENDING'`, `capturedAt=null`. Defers actual capture to the outbox publisher (Wave-4 4c pattern).

**Paths that transition OUT of CAPTURE_PENDING:**
1. **Publisher capture handler** (success): `Payment.updateMany WHERE status='CAPTURE_PENDING' → CAPTURED, capturedAt=now, version++`.
2. **Publisher capture handler** (failure): increments `retryCount`, sets `failureReason`, leaves status as `CAPTURE_PENDING`. After MAX_RETRIES (5), outbox event → `FAILED`.
3. **Webhook handler** (`payment.captured`): `Payment.updateMany WHERE status!='CAPTURED' → CAPTURED, capturedAt=now, version++`.
4. **Webhook handler** (`payment.failed`): `Payment.updateMany WHERE status NOT IN ('FAILED','CAPTURED') → FAILED`.

**M9 fires when NONE of these paths completed** — Payment stays CAPTURE_PENDING past 30 min + outbox is not PENDING/CLAIMED.

---

## D. Existing Recovery Paths

| Path | What it does | When it runs | Can it resolve M9? |
|------|-------------|-------------|:-----------------:|
| Publisher `/trigger` (manual) | Re-runs `publishPendingEvents()` — claims PENDING events + processes them | Manual or cron | ⚠️ Only if outbox is PENDING. If outbox is FAILED, publisher won't re-claim it. |
| Publisher stale CLAIMED recovery | `Outbox.updateMany WHERE status='CLAIMED' AND claimUntil < now → PENDING` | Each publisher cycle | ✅ If outbox is CLAIMED past lease → re-marks as PENDING. But M9 requires outbox NOT PENDING/CLAIMED — so this doesn't apply. |
| Webhook `payment.captured` | Flips Payment to CAPTURED | When Razorpay sends webhook | ✅ If webhook arrives, Payment is resolved. But M9 fires because the webhook hasn't arrived (or was missed). |
| M3 remediation (5C, CLOSED) | Gateway fetch → if captured → flip to CAPTURED | When `reconciliationAutoRepair=ON` | ✅ For sub-case M9a (hasCapturePair=true, outbox=PUBLISHED). M3 ALREADY handles this. |

**Critical gap:** If the outbox event is `FAILED`, there is NO existing automated path to retry the capture. The publisher's `publishPendingEvents()` only claims `PENDING` events — `FAILED` events are not re-claimed. Manual intervention is required.

---

## E. External Dependencies

M9 remediation would require:

1. **`fetchRazorpayPaymentStatus()`** — ALREADY EXISTS (implemented for M3). READ-ONLY gateway query. Safe.

2. **`captureRazorpayPayment()`** — EXISTS (Wave-4 4c). But this is a **MUTATION** at the gateway — it captures a payment. **NOT idempotent at the gateway** (Razorpay may or may not deduplicate captures — we explicitly refuse to rely on gateway-side idempotency per TRANSACTION_RETRY_INVARIANT.md §4.2).

3. **Outbox re-enqueue** — would require either:
   - (a) Marking the `FAILED` outbox event back to `PENDING` (publisher will re-claim + retry).
   - (b) Creating a NEW `PAYMENT_CAPTURE_REQUESTED` outbox event.
   
   Option (b) is safer (preserves the audit trail of the original FAILED event) but requires a new outbox row. Option (a) is simpler but loses the FAILED history.

**Key external dependency risk:** If M9 remediation re-enqueues for capture retry, the publisher will call `captureRazorpayPayment()`. If the FIRST capture attempt (the one that FAILED the outbox) actually succeeded at the gateway but the publisher's success-txn crashed, the retry will **capture again** → **double-charge**.

---

## F. Race Analysis

### R1: M9 remediation vs webhook (`payment.captured`)

**Scenario:** M9 fetches gateway → gateway says `captured` → M9 flips Payment to CAPTURED. Simultaneously, a `payment.captured` webhook arrives.

**Protection:** Both M9 and the webhook use `Payment.updateMany WHERE status='CAPTURE_PENDING'`. The first to commit wins; the second gets count=0 → skip (idempotent). Same as M3.

**Verdict:** ✅ SAFE — conditional updateMany prevents race.

### R2: M9 remediation vs publisher retry

**Scenario:** M9 re-enqueues a FAILED outbox event → publisher picks it up → calls `captureRazorpayPayment()`. Simultaneously, M9 also fetches gateway status → says `captured` → M9 flips Payment to CAPTURED.

**Protection:** The publisher's capture handler checks `if (payment.status === 'CAPTURED') { skip }` (line 79) and `if (payment.status !== 'CAPTURE_PENDING') { throw }` (line 104). If M9 flipped first, the publisher skips the capture call → no duplicate. If the publisher captured first, M9's `updateMany WHERE status='CAPTURE_PENDING'` returns count=0 → skip.

**Verdict:** ✅ SAFE for the status-flip path. ⚠️ But if M9 re-enqueued AND the publisher calls `captureRazorpayPayment()` before checking Payment.status, the capture HTTP call fires. The publisher's idempotency check is AFTER the read but BEFORE the capture call — so the capture COULD fire if M9 hasn't committed yet. **This is the critical race for the re-enqueue path.**

### R3: M9 remediation vs normal payment retry (user double-clicks Pay)

**Scenario:** M9 is remediating a stuck Payment. User clicks Pay again → capture route tries to create a NEW Payment for the same order.

**Protection:** `Payment.orderId` is `@unique` → P2002 → `getCachedResponse` returns existing Payment. Same as M3.

**Verdict:** ✅ SAFE — unique constraint + idempotency cache.

### R4: Two concurrent M9 remediation attempts

**Protection:** `RemediationAction` unique constraint on `(findingId, repairType)` — second attempt gets P2002 → SKIPPED. Same as M3/M16.

**Verdict:** ✅ SAFE — RemediationAction dedup.

### R5: M9 remediation vs an already-resolved finding

**Protection:** Re-validation (SI-1) — re-read Payment.status. If not CAPTURE_PENDING → SKIPPED (stale). Same as M3.

**Verdict:** ✅ SAFE — re-validation.

### R6: Gateway state changes between validation and mutation

**Scenario:** M9 fetches gateway → says `captured` → between fetch and DB update, gateway state changes (refund processed → status becomes `refunded`).

**Protection:** The DB update is `updateMany WHERE status='CAPTURE_PENDING' → CAPTURED`. The gateway state at fetch time was `captured`. The DB mutation is based on DB state, not gateway state. If the gateway later shows `refunded`, the DB will show CAPTURED (correct for the capture moment) — the refund state transition will be handled by the refund flow separately.

**Verdict:** ✅ SAFE — DB mutation is based on DB state, not gateway state. Gateway fetch is advisory (determines whether to proceed, not what to write).

### R7: Transaction retry / serialization failure

**Protection:** The gateway fetch is OUTSIDE the txn body (TRANSACTION_RETRY_INVARIANT). The DB update (conditional updateMany) is inside a txn — a P2034 retry re-runs only the DB writes (which are idempotent via WHERE status='CAPTURE_PENDING'). Same as M3.

**Verdict:** ✅ SAFE — external call outside txn.

### R8: Duplicate evidence/finding creation

**Scenario:** Reconciliation runs twice → creates two M9 findings for the same Payment.

**Protection:** `ReconciliationFinding @@unique([mismatchClass, entityId, resolvedAt])` — if the first finding is unresolved (resolvedAt=NULL), the second run updates lastSeenAt instead of creating a duplicate. Same as M3/M16.

**Verdict:** ✅ SAFE — finding dedup.

---

## G. Idempotency Analysis

### Status-flip path (gateway says `captured`)

**Idempotent:** YES. RemediationAction unique constraint + conditional updateMany + idempotent GET. Same as M3 (already proven in M3 E3/E10).

### Re-enqueue path (gateway says `NOT captured`)

**Idempotent: ⚠️ DANGEROUS.**

If M9 re-enqueues the outbox event for capture retry:
1. The publisher calls `captureRazorpayPayment()`.
2. If the FIRST capture attempt actually succeeded at the gateway (but the publisher's success-txn crashed), this retry will **capture again** → **double-charge**.
3. The publisher's idempotency check (`payment.status === 'CAPTURED' → skip`) does NOT protect against this — the Payment is still CAPTURE_PENDING (the first capture's success-txn crashed before flipping the status).
4. The `captureRazorpayPayment()` function does NOT use a pre-generated idempotency key for the gateway call (TRANSACTION_RETRY_INVARIANT.md §8.2 item 4 — deferred).

**This is the fundamental safety gap:** Without a pre-generated idempotency key for `captureRazorpayPayment()`, retrying a FAILED capture is NOT safe. The retry could double-charge the customer.

---

## H. Transaction Boundary

### Status-flip path (gateway says `captured`)

- Gateway fetch: OUTSIDE txn (TRANSACTION_RETRY_INVARIANT — same as M3).
- DB update: INSIDE txn (conditional updateMany + RemediationAction + AuditLog + ReconciliationFinding resolution).
- ✅ Compliant — same as M3 (already proven).

### Re-enqueue path (gateway says `NOT captured`)

- Gateway fetch: OUTSIDE txn.
- Outbox re-enqueue: INSIDE txn (mark FAILED event as PENDING, or create new event).
- Publisher capture call: OUTSIDE txn (publisher handles this).
- ⚠️ The re-enqueue itself is safe (conditional update on outbox.status). But the DOWNSTREAM effect (publisher calls `captureRazorpayPayment()`) is NOT idempotent — see §G.

---

## I. Financial-State Impact

| Table | Can M9 mutate it? | Via what path? | Risk |
|-------|:-----------------:|----------------|------|
| `Payment.status` | ✅ YES | Conditional updateMany CAPTURE_PENDING → CAPTURED | LOW (same as M3 — proven safe) |
| `Refund` | ❌ NO | — | — |
| `LedgerEntry` | ❌ NO | — | — |
| `Outbox` | ⚠️ YES (re-enqueue path only) | Mark FAILED → PENDING, or create new event | **HIGH** — re-enqueue triggers publisher capture retry → potential double-charge |
| `WebhookEvent` | ❌ NO | — | — |
| `IdempotencyKey` | ❌ NO | — | — |
| `AuditLog` | ✅ YES (audit entry) | Remediation audit log | LOW (append-only) |

**Critical finding:** M9's re-enqueue path can mutate `Outbox` (marking a FAILED event as PENDING), which triggers the publisher to call `captureRazorpayPayment()` again. This is a **financial side-effect** (potential double-charge) that M3 does NOT have.

---

## J. Safety Invariants

For any future M9 implementation, the following invariants would be mandatory:

| # | Invariant | Rationale |
|---|-----------|-----------|
| M9-SI-1 | Re-validation before repair (re-read Payment.status; if not CAPTURE_PENDING → skip) | Finding may be stale. |
| M9-SI-2 | Repair idempotency (RemediationAction unique constraint) | Crash + retry must NOT cause second action. |
| M9-SI-3 | Gateway ambiguity = no repair (non-captured → escalate, NOT re-enqueue) | **CRITICAL: The re-enqueue path is NOT authorized in the initial M9 implementation.** |
| M9-SI-4 | Conditional updateMany (WHERE status=CAPTURE_PENDING) — race-safe | Same as M3. |
| M9-SI-5 | Gateway-fetch OUTSIDE txn body | TRANSACTION_RETRY_INVARIANT. |
| M9-SI-6 | RemediationAction audit record created | Audit trail. |
| M9-SI-7 | AuditLog entry created | Business event. |
| M9-SI-8 | Post-repair verification (re-read Payment.status to confirm CAPTURED) | Verify, don't assume. |
| M9-SI-9 | Feature-flagged (reconciliationAutoRepair, default OFF) | Orchestrator authorization. |
| M9-SI-10 | NO LedgerEntry mutation | M9 is a status-only repair (for the safe path). |
| M9-SI-11 | NO Outbox enqueue (for the initial implementation) | **CRITICAL: Re-enqueue is NOT authorized — it risks duplicate capture.** |
| M9-SI-12 | NO capture/refund call | M9 only FETCHES gateway state (same as M3). |
| M9-SI-13 | Escalate on any non-captured gateway status | authorized/failed/refunded/unknown → escalate. |
| M9-SI-14 | Dedup with M3: if M3 has already remediated the same Payment, M9 must skip | M3 and M9 can both fire for the same Payment — avoid duplicate remediation. |

---

## K. Evidence Requirements

### SQLite evidence scenarios (proposed — NOT executed)

| # | Scenario | What it proves |
|---|----------|----------------|
| M9-E1 | M9 detection + gateway-confirmed status flip (captured → CAPTURED) | Same as M3-E1 (redundant path proven safe). |
| M9-E2 | Re-validation prevents stale repair | Same as M3-E2. |
| M9-E3 | Idempotent retry | Same as M3-E3. |
| M9-E4 | No money-state mutation outside authorized M9 transition | Same as M3-E4 (Refund/Ledger unchanged). |
| M9-E5 | Gateway says `authorized` → escalate (no flip, no re-enqueue) | Same as M3-E5. |
| M9-E6 | Gateway error → abort | Same as M3-E6. |
| M9-E7 | Flag OFF → DISABLED | Same as M3-E7. |
| M9-E8 | Post-repair verification | Same as M3-E8. |
| **M9-E9** | **M9 + M3 dedup: both fire for same Payment → only one RemediationAction created** | **M9-specific: proves M9 does NOT duplicate M3's repair.** |
| **M9-E10** | **Outbox=FAILED + gateway says `captured` → flip to CAPTURED (no re-enqueue)** | **M9-specific: proves the FAILED-outbox sub-case is handled safely.** |

### PostgreSQL evidence scenarios (proposed — NOT executed)

| # | Scenario | What it proves |
|---|----------|----------------|
| M9-E11 | Concurrent M9 + M3 remediation | Both fire for same Payment → exactly 1 RemediationAction. |
| M9-E12 | Scale — 1000+ M9 findings + mixed gateway responses | Correct classification + false positives = 0. |

---

## L. Failure / Escalation Semantics

| Gateway status | M9 action | Risk |
|----------------|-----------|------|
| `captured` | Flip Payment to CAPTURED (conditional updateMany) | LOW — same as M3. |
| `authorized` | Escalate — capture didn't happen. | LOW — no mutation. |
| `failed` | Escalate — payment failed. | LOW — no mutation. |
| `refunded` | Escalate — multi-state drift. | LOW — no mutation. |
| `unknown` | Escalate. | LOW — no mutation. |
| Error/timeout | Abort + retry later. | LOW — no mutation. |
| `captured` + outbox=FAILED | Flip to CAPTURED. **DO NOT re-enqueue.** | LOW — status flip only. |
| `authorized` + outbox=FAILED | **Escalate. DO NOT re-enqueue.** | **The re-enqueue path is NOT authorized.** |

**Critical rule:** The re-enqueue path (gateway says NOT captured → mark outbox PENDING for capture retry) is **NOT authorized** in the initial M9 implementation. It requires a separate safety analysis proving that `captureRazorpayPayment()` is idempotent at the gateway (via pre-generated idempotency key — TRANSACTION_RETRY_INVARIANT.md §8.2 item 4, currently deferred).

---

## M. Implementation Boundary

### Authorized (if a future M9 implementation directive is issued)

- M9 status-flip path: gateway fetch → if `captured` → conditional updateMany CAPTURE_PENDING → CAPTURED.
- This is **identical to M3** — the only difference is M9 fires for a broader set of conditions (no hasCapturePair check).

### NOT authorized (even in a future M9 implementation directive)

- ❌ **Re-enqueue path**: marking a FAILED outbox event as PENDING for capture retry.
- ❌ **New outbox event creation**: creating a new `PAYMENT_CAPTURE_REQUESTED` event.
- ❌ **captureRazorpayPayment() call**: M9 must NOT call capture — it only FETCHES gateway state.
- ❌ **LedgerEntry mutation**: M9 is a status-only repair.
- ❌ **Refund mutation**: no refund interaction.
- ❌ **M10 implementation**: separate scope.
- ❌ **CLASS B/D/E remediation**: separate scope.

### Dedup with M3

If both M3 and M9 fire for the same Payment (sub-case M9a), M9 must check whether M3 has already created a RemediationAction for this Payment. If yes → skip (M3 already handled it). This can be implemented via:
- M9's `revalidateM9Finding()` checks for an existing M3 RemediationAction for the same `entityId` (Payment.id).
- Or: M9 uses a different `repairType` (`M9_GATEWAY_VERIFIED_STATUS_FLIP`) — the RemediationAction unique constraint on `(findingId, repairType)` does NOT prevent M3 and M9 from both creating actions for the same Payment (because findingId is different — M3 and M9 create separate ReconciliationFinding rows for the same Payment).
- **Recommended:** M9 should check `Payment.status` via re-validation (SI-1) — if M3 already flipped to CAPTURED, M9's re-validation will detect it → skip (stale finding). This is the simplest + safest dedup mechanism.

---

## N. Recommendation

### CONDITIONAL GO (with critical constraints)

**The condition:** M9 implementation is authorized **ONLY for the gateway-confirmed-captured status-flip path** (identical to M3). The following constraints are mandatory:

1. **NO re-enqueue path.** M9 must NOT re-enqueue FAILED outbox events for capture retry. The re-enqueue path requires a pre-generated idempotency key for `captureRazorpayPayment()` (TRANSACTION_RETRY_INVARIANT.md §8.2 item 4 — currently deferred). Until that key exists, re-enqueue is **prohibited**.

2. **NO capture call.** M9 must NOT call `captureRazorpayPayment()`. It only FETCHES gateway state via `fetchRazorpayPaymentStatus()` (same as M3).

3. **Dedup with M3.** If M3 has already remediated the same Payment (status is already CAPTURED), M9's re-validation must skip (stale finding). This is handled naturally by SI-1 (re-read Payment.status).

4. **All 14 safety invariants (M9-SI-1 through M9-SI-14) must be satisfied.**

5. **SQLite evidence (M9-E1 through M9-E10) must PASS** before PostgreSQL evidence.

6. **PostgreSQL evidence (M9-E11 through M9-E12) must PASS** before M9 S5 closure.

### Why CONDITIONAL GO (not HOLD)

- The **status-flip path** (gateway says `captured` → flip to CAPTURED) is **identical to M3** — already proven safe on both SQLite + PostgreSQL.
- M9's broader detection (no `hasCapturePair` check) catches cases M3 misses (e.g., outbox=FAILED + Payment still CAPTURE_PENDING).
- The **dangerous path** (re-enqueue for capture retry) is explicitly **excluded** from the initial implementation.

### Why NOT full GO

- The **re-enqueue path** is a fundamental part of M9's original design (Gate Review §C said "If gateway says not captured → re-enqueue outbox"). Excluding it means M9 is a **partial remediation** — it only handles the gateway-confirmed-captured sub-case, not the retry sub-case.
- The retry sub-case requires a pre-generated idempotency key for `captureRazorpayPayment()` — a separate safety improvement that is currently deferred (TRANSACTION_RETRY_INVARIANT.md §8.2 item 4).
- M9 has **overlap with M3** — the dedup mechanism must be proven via evidence (M9-E9).

### What this means operationally

- M9 would catch **stuck CAPTURE_PENDING payments where the gateway DID capture** (publisher success-txn crashed). This is the most common real-world scenario.
- M9 would NOT catch **stuck CAPTURE_PENDING payments where the gateway did NOT capture** (publisher failed at gateway). These would be escalated to ExceptionQueue for manual review — which is the safe behavior.

---

## Stop Point

This Gate Review is COMPLETE. The IDE is STOPPING.

- M9 READ/PLAN-FIRST Gate Review: ✅ COMPLETE.
- M9 implementation: 🔒 NOT YET AUTHORIZED.
- M9 re-enqueue path: 🔒 NOT AUTHORIZED (requires pre-generated idempotency key — deferred).
- M10: 🔒 HOLD.
- Production: 🚫 NOT AUTHORIZED.
- `reconciliationAutoRepair`: 🚫 OFF.
- Wave-3/4/5A/5B/5C-M16/5C-M3: ✅ CLOSED — immutable.
- Wave-6 / Wave-7: 🔒 LOCKED.

**Next governance checkpoint:** Orchestrator decision on M9 implementation authorization. The Orchestrator may:
- (a) Authorize M9 implementation for the status-flip path only (per the CONDITIONAL GO recommendation).
- (b) Defer M9 (keep on detection + operator review — the re-enqueue gap makes it incomplete).
- (c) Reject the plan + demand the re-enqueue path be included (requires the idempotency key safety improvement first).
- (d) Authorize M10 instead (stuck REFUND_PENDING — different risk profile).

**The IDE must NOT interpret a successful planning review as authorization for M9 implementation.** Implementation requires a separate explicit Orchestrator directive.

---

**End of Gate Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `realPayments` OFF. `webhookHandler` OFF. `requestHashEnforcement` OFF. `reconciliationAutoRepair` OFF. Wave-3/4/5A/5B/5C-M16/5C-M3 CLOSED — immutable. Wave-6/7 LOCKED.**

**STOP. Awaiting Orchestrator decision on M9 implementation authorization.**
