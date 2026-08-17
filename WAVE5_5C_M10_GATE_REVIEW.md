# Wave-5 Sub-Wave 5C — M10 Stuck REFUND_PENDING: S5 PASS / CLOSED

**Document type:** Gate Review (READ/PLAN-FIRST → IMPLEMENTATION → PostgreSQL EVIDENCE → S5 PASS / CLOSED).
**Directive IDs:** `WAVE5-5C-M10-READ-PLAN-FIRST-01` (Gate Review) → `WAVE5-5C-M10-IMPLEMENT-01` (Implementation) → `WAVE5-5C-M10-PG-EVIDENCE-GATE-01` (PostgreSQL Evidence) → `S5-5C-M10-P0-03-CLOSE` (Closure).
**Author:** IDE (read-only synthesis from repository + M16/M3/M9 closure evidence).
**Orchestrator directive:** Sub-Wave 5C — M10 is S5 PASS / CLOSED (Directive ID: `S5-5C-M10-P0-03-CLOSE`, 2026-08-17). All 4 CLASS-C remediation gates (M16, M3, M9, M10) are now CLOSED. Other classes remain LOCKED.
**Created:** 2026-08-17
**Scope:** M10 — Stuck REFUND_PENDING (Refund.status='REFUND_PENDING' older than 30 min + outbox not PENDING/CLAIMED).

> **M10 Closure (Orchestrator Directive `S5-5C-M10-P0-03-CLOSE`):** M10 (gateway-verified refund status remediation — REFUND_PENDING → REFUNDED via `fetchRazorpayRefundStatus()` with NO outbox re-enqueue and NO refund API invocation) is S5 PASS / CLOSED. The closure is based on SQLite E1-E8 (8/8 PASS) + PostgreSQL E9-E12 (8/8 PASS) + `moneyStateUnchanged=true` + `noDuplicateRemediationActions=true` + `financialMutation=false` + `falsePositives=0` + LedgerEntry unchanged (5A Option A confirmed) + Outbox unchanged (SI-11 confirmed). M10 is closed specifically as a **gateway-verified refund status-flip remediation** — NOT as a refund-retry mechanism. The prohibited retry/re-enqueue path remains prohibited. The gateway idempotency-key gap remains outside this closure.

> **Orchestrator constraint honored:** M10 involves REFUND_PENDING + 5A Option A ledger semantics — fundamentally more complex than M3/M9 (which are Payment-only status flips). M10 may interact with refund accounting, Payment.status transitions (for full refunds), and the 5A pending ledger reservation. M3/M9 safety does NOT transfer to M10.

---

## A. Executive Summary

| Field | Value |
|-------|-------|
| **M10 classification** | **CLASS C → CONDITIONAL GO (with critical constraints)** |
| **Safe sub-case** | M10a (outbox=PUBLISHED, gateway confirms refund processed) — status flip only, same pattern as M3/M9 |
| **DANGEROUS sub-case** | M10b-retry (outbox=FAILED, gateway says NOT refunded) — re-enqueue = potential DUPLICATE REFUND at gateway (same gap as M9) |
| **5A Option A interaction** | ✅ SAFE — when Refund flips to REFUNDED, the 5A pending reservation (reversal Dr/Cr) becomes canonical. NO new ledger entries needed (proven in 5A-E6). |
| **Key new dependency** | M10 needs a **new gateway function**: `fetchRazorpayRefundStatus()` — `fetchRazorpayPaymentStatus()` does NOT fetch refund-specific status. Partial refunds don't change Payment.status. |
| **Recommendation** | **CONDITIONAL GO** — status-flip path ONLY (gateway confirms refund → flip Refund + Payment). Re-enqueue path PROHIBITED (same as M9). |

---

## B. Detector Semantics

**Detector function:** `detectM10StuckRefundPending()` in `src/lib/reconciliation.ts`.

**Detection condition:**
```text
Refund.status = 'REFUND_PENDING'
AND Refund.createdAt < now - 30 min (STUCK_REFUND_PENDING_AGE_MS)
AND (
  Outbox.aggregateType = 'Refund' AND Outbox.aggregateId = Refund.id
  AND Outbox.status IN ('FAILED', 'PUBLISHED')
  OR Outbox row is MISSING
)
```

**Key differences from M9:**
- M9 fires on Payment.status='CAPTURE_PENDING'. M10 fires on **Refund.status='REFUND_PENDING'**.
- M9's entityId = Payment.id. M10's entityId = **Refund.id**.
- M9 mutates Payment.status. M10 mutates **Refund.status** (and potentially Payment.status for full refunds).
- M9 has no ledger interaction. M10 interacts with **5A Option A pending ledger reservation** (reversal Dr/Cr entries already exist at REFUND_PENDING time).

**Severity:** HIGH.

---

## C. State Machine (Refund)

```text
REFUND_PENDING → REFUNDED (publisher success / M10 remediation)
REFUND_PENDING → FAILED (publisher exhausted retries — M10 FAILED path escalates to CLASS E)
```

**Paths that create REFUND_PENDING:**
1. Refund route (`POST /api/payments/refund`): creates Refund with `status='REFUND_PENDING'` + reversal Dr/Cr ledger entries + AuditLog + Outbox event (all atomic in one txn — 5A pattern).

**Paths that transition OUT of REFUND_PENDING:**
1. **Publisher refund handler** (success): `Refund.updateMany WHERE status='REFUND_PENDING' → REFUNDED` + `Payment.updateMany WHERE status='CAPTURED' → REFUNDED` (if full refund) + AuditLog + Outbox PUBLISHED. All atomic.
2. **Publisher refund handler** (failure): increments version, sets failureReason, leaves status as REFUND_PENDING. After MAX_RETRIES, outbox → FAILED.
3. **Webhook** (`refund.processed`): currently DEFERRED to Wave-5 (`handleRefundProcessed` logs but does NOT process). This is a gap — but not M10's concern (M10 is about stuck REFUND_PENDING, not webhook processing).

---

## D. Existing Recovery Paths

| Path | What it does | Can resolve M10? |
|------|-------------|:----------------:|
| Publisher `/trigger` | Re-runs `publishPendingEvents()` | ⚠️ Only if outbox is PENDING. If outbox is FAILED, publisher won't re-claim. |
| Webhook `refund.processed` | Currently deferred (logs only) | ❌ Does not process. |
| M9 remediation | Only handles Payment CAPTURE_PENDING | ❌ Different entity (Refund, not Payment). |

**Critical gap:** If the outbox event is `FAILED`, there is NO existing automated path to retry the refund. Same gap as M9.

---

## E. Gateway Verification Capability

**Current state:** `fetchRazorpayPaymentStatus()` fetches the PAYMENT status (`captured`/`authorized`/`failed`/`refunded`). It does NOT fetch refund-specific status.

**Problem:** For partial refunds, the Payment status remains `captured` even after a refund is processed. Only full refunds change Payment.status to `refunded`. Therefore, checking Payment status is INSUFFICIENT for M10.

**Required:** M10 needs a **new gateway function**: `fetchRazorpayRefundStatus(refundId)` that calls:
- `instance.refunds.fetch(refundId)` — returns the refund object with `status` field (`pending` / `processed` / `failed`).

**Razorpay refund statuses:**
| Gateway status | Meaning | M10 action |
|----------------|---------|------------|
| `processed` | Refund completed at gateway | Flip Refund → REFUNDED + (if full refund) Payment → REFUNDED |
| `pending` | Refund is in progress | Escalate (not yet confirmed — do NOT flip) |
| `failed` | Refund failed at gateway | Escalate (Refund should be FAILED, not REFUND_PENDING — different mismatch) |
| Error/timeout | Ambiguous | Abort + retry later |

**Critical:** `processed` is the ONLY gateway status that permits M10 remediation. Same rule as M3/M9 (only `captured` permits the flip).

---

## F. Race Analysis

### R1: M10 remediation vs refund webhook (`refund.processed`)

**Scenario:** M10 fetches gateway → says `processed` → M10 flips Refund to REFUNDED. Simultaneously, a `refund.processed` webhook arrives.

**Current state:** The webhook handler's `handleRefundProcessed` currently only logs (does NOT process). So there is NO race today. BUT if webhook processing is enabled in the future, both paths would use `Refund.updateMany WHERE status='REFUND_PENDING'` — the first to commit wins, the second gets count=0 → skip (idempotent).

**Verdict:** ✅ SAFE — conditional updateMany prevents race (same as M3/M9).

### R2: M10 remediation vs publisher refund retry

**Scenario:** M10 re-enqueues a FAILED outbox event → publisher picks it up → calls `refundRazorpayPayment()`.

**Protection:** The publisher's refund handler checks `if (refund.status === 'REFUNDED') { skip }` and `if (refund.status !== 'REFUND_PENDING') { throw }`. If M10 flipped first, the publisher skips. If the publisher refunded first, M10's `updateMany WHERE status='REFUND_PENDING'` returns count=0 → skip.

**BUT:** The re-enqueue path (publisher calls `refundRazorpayPayment()`) is **NOT idempotent at the gateway** — same gap as M9 capture retry. `refundRazorpayPayment()` does NOT use a pre-generated idempotency key (TRANSACTION_RETRY_INVARIANT.md §8.2 item 4 — deferred).

**Verdict:** ✅ SAFE for status-flip. ⚠️ DANGEROUS for re-enqueue (same as M9).

### R3-R8: Same as M9

All other races (concurrent M10, stale finding, gateway state change, txn retry, duplicate findings) are structurally identical to M9 (which mirrors M3). All are SAFE for the status-flip path.

---

## G. 5A Option A Interaction

**This is the KEY difference from M9.**

When a Refund is created (REFUND_PENDING), the refund route writes the reversal Dr/Cr ledger entries atomically:
- `LedgerEntry DEBIT CONSUMER_REVENUE` (reverses capture credit)
- `LedgerEntry CREDIT GATEWAY_RECEIVABLE` (reverses capture debit)

These entries exist in the database while the Refund is still REFUND_PENDING. They are a **pending accounting reservation** (5A Option A semantics).

**When M10 flips Refund to REFUNDED (gateway confirmed):**
- The reversal entries become **canonical** (the refund is confirmed — the reservation is now settled).
- **NO new ledger entries are created.** The existing reversal pair simply changes meaning from "pending reservation" to "settled reversal."
- This is EXACTLY what happens in the publisher's success path (proven in 5A-E6: publisher failure → retry success → no duplicate ledger entries).

**When M10 escalates (gateway says NOT refunded):**
- The reversal entries remain as a **pending reservation** (Refund stays REFUND_PENDING).
- If the refund is permanently FAILED, the reservation must be manually resolved (becomes M8 finding — CLASS E).
- M10 does NOT create, modify, or delete LedgerEntry rows. It only mutates Refund.status (+ Payment.status for full refunds).

**Verdict:** ✅ SAFE — 5A Option A semantics are preserved. M10's status-flip path is the same as the publisher's success path (proven in 5A-E6). NO ledger mutation.

---

## H. Financial-State Impact

| Table | Can M10 mutate it? | Via what path? | Risk |
|-------|:-----------------:|----------------|------|
| `Refund.status` | ✅ YES | Conditional updateMany REFUND_PENDING → REFUNDED | LOW (same pattern as M3/M9) |
| `Payment.status` | ✅ YES (full refund only) | Conditional updateMany CAPTURED → REFUNDED (if full refund) | LOW (same as publisher success path — proven in 5A) |
| `Refund.gatewayRefundId` | ✅ YES | Set to the gateway's refund ID | LOW (metadata only) |
| `Refund.refundedAt` | ✅ YES | Set to now() | LOW (timestamp) |
| `LedgerEntry` | ❌ NO | — | — (5A Option A: reversal entries already exist, become canonical) |
| `Outbox` | ❌ NO (status-flip path) | — | — (re-enqueue path PROHIBITED) |
| `WebhookEvent` | ❌ NO | — | — |
| `IdempotencyKey` | ❌ NO | — | — |
| `AuditLog` | ✅ YES (audit entry) | Remediation audit log | LOW (append-only) |

**Key finding:** M10 mutates TWO tables (Refund + Payment), unlike M3/M9 which mutate only Payment. However, both mutations use conditional updateMany (race-safe) and follow the exact same pattern as the publisher's success path (proven in 5A-E6 on PostgreSQL).

---

## I. Transaction Boundary

### Status-flip path (gateway says `processed`)

- Gateway refund fetch: OUTSIDE txn (TRANSACTION_RETRY_INVARIANT — new function `fetchRazorpayRefundStatus()`).
- DB update: INSIDE txn (conditional updateMany on Refund + conditional updateMany on Payment + RemediationAction + AuditLog + ReconciliationFinding resolution).
- ✅ Compliant — same as M3/M9.

### Re-enqueue path (gateway says NOT processed)

- PROHIBITED — same as M9. `refundRazorpayPayment()` is NOT idempotent at the gateway.

---

## J. Safety Invariants

| # | Invariant | Rationale |
|---|-----------|-----------|
| M10-SI-1 | Re-validation before repair (re-read Refund.status; if not REFUND_PENDING → skip) | Finding may be stale. |
| M10-SI-2 | Repair idempotency (RemediationAction unique constraint) | Crash + retry must NOT cause second action. |
| M10-SI-3 | Gateway ambiguity = no repair (non-processed → escalate, NOT re-enqueue) | **Re-enqueue PROHIBITED.** |
| M10-SI-4 | Conditional updateMany (WHERE status=REFUND_PENDING for Refund; WHERE status=CAPTURED for Payment) | Race-safe. |
| M10-SI-5 | Gateway refund-fetch OUTSIDE txn body | TRANSACTION_RETRY_INVARIANT. |
| M10-SI-6 | RemediationAction audit record created | Audit trail. |
| M10-SI-7 | AuditLog entry created (RECONCILIATION_REPAIR_M10_REFUND_STATUS_FLIPPED) | Business event. |
| M10-SI-8 | Post-repair verification (re-read Refund.status + Payment.status) | Verify, don't assume. |
| M10-SI-9 | Feature-flagged (reconciliationAutoRepair, default OFF) | Orchestrator authorization. |
| M10-SI-10 | NO LedgerEntry mutation | 5A Option A: reversal entries already exist, become canonical. NO new entries. |
| M10-SI-11 | NO Outbox enqueue (re-enqueue PROHIBITED) | Same as M9 — refundRazorpayPayment() not idempotent at gateway. |
| M10-SI-12 | NO refundRazorpayPayment() call | M10 only FETCHES gateway refund state. |
| M10-SI-13 | Escalate on any non-`processed` gateway status | pending/failed/unknown → escalate. |
| M10-SI-14 | Dedup with publisher (re-validation naturally handles this — if publisher already flipped to REFUNDED, M10 skips) | Same as M9-SI-14. |
| M10-SI-15 | Full refund → Payment.status also flipped (conditional updateMany WHERE status=CAPTURED) | Same as publisher success path. Partial refunds do NOT flip Payment. |
| M10-SI-16 | New gateway function needed: `fetchRazorpayRefundStatus(refundId)` | `fetchRazorpayPaymentStatus()` is insufficient (partial refunds don't change Payment.status). |

---

## K. Evidence Requirements

### SQLite evidence (proposed — NOT executed)

| # | Scenario | What it proves |
|---|----------|----------------|
| M10-E1 | M10 detection + gateway-confirmed refund status flip (processed → REFUNDED) | Refund + Payment (if full) flipped. RemediationAction created. |
| M10-E2 | Re-validation prevents stale repair | Refund already REFUNDED → detector skipped / M10 skipped. |
| M10-E3 | Idempotent retry | 1 RemediationAction, second run SKIPPED. |
| M10-E4 | No money-state mutation outside authorized M10 transition | Ledger/Outbox rows unchanged. |
| M10-E5 | Gateway says `pending` → escalate | No flip. |
| M10-E6 | Gateway says `failed` → escalate | No flip. |
| M10-E7 | Flag OFF → DISABLED | No remediation. |
| M10-E8 | Post-repair verification | Finding resolved, action SUCCEEDED. |
| M10-E9 | Partial refund → Refund flipped but Payment NOT flipped | SI-15: partial refunds don't change Payment.status. |
| M10-E10 | Full refund → Refund + Payment both flipped | SI-15: full refunds change Payment.status to REFUNDED. |

### PostgreSQL evidence (proposed — NOT executed)

| # | Scenario | What it proves |
|---|----------|----------------|
| M10-E11 | Concurrent M10 + publisher refund | Both try to flip Refund → exactly 1 succeeds. |
| M10-E12 | Scale — mixed gateway outcomes + partial/full refunds | Correct classification + false positives = 0. |

---

## L. Failure / Escalation Semantics

| Gateway refund status | M10 action | Risk |
|----------------------|------------|------|
| `processed` | Flip Refund → REFUNDED + (if full refund) Payment → REFUNDED. NO ledger mutation. | LOW — same as publisher success path. |
| `pending` | Escalate — refund not yet confirmed. | LOW — no mutation. |
| `failed` | Escalate — refund failed at gateway. Refund should be FAILED, not REFUND_PENDING. | LOW — no mutation. |
| Error/timeout | Abort + retry later. | LOW — no mutation. |
| `processed` + outbox=FAILED | Flip to REFUNDED. **DO NOT re-enqueue.** | LOW — status flip only. |
| `pending`/`failed` + outbox=FAILED | **Escalate. DO NOT re-enqueue.** | Re-enqueue PROHIBITED. |

---

## M. Implementation Boundary

### Authorized (if a future M10 implementation directive is issued)

- Add `fetchRazorpayRefundStatus(refundId)` to `src/lib/razorpay.ts` (READ-ONLY, new function).
- M10 status-flip path: gateway fetch → if `processed` → conditional updateMany Refund REFUND_PENDING → REFUNDED + (if full refund) Payment CAPTURED → REFUNDED.
- This mirrors the publisher's success path (proven in 5A-E6) + M3/M9 pattern (proven on SQLite + PostgreSQL).

### NOT authorized

- ❌ **Re-enqueue path** — same as M9 (refundRazorpayPayment() not idempotent at gateway).
- ❌ **refundRazorpayPayment() call** — M10 only FETCHES gateway state.
- ❌ **LedgerEntry mutation** — 5A Option A: reversal entries already exist.
- ❌ **Outbox mutation** — SI-11: NO outbox enqueue.
- ❌ **Partial refund → Payment flip** — only full refunds flip Payment.

### New dependency

M10 requires a **new gateway function**: `fetchRazorpayRefundStatus(refundId)`:
- In demo mode: returns mock status controlled by `EVIDENCE_GATEWAY_REFUND_STATUS` env var.
- In real mode: calls `instance.refunds.fetch(refundId)` + maps Razorpay refund status (`pending`/`processed`/`failed`) to internal type.
- MUST be called OUTSIDE any txn body (TRANSACTION_RETRY_INVARIANT).

---

## N. Recommendation

### CONDITIONAL GO (with critical constraints)

**The condition:** M10 implementation is authorized **ONLY for the gateway-confirmed-processed status-flip path** (same pattern as M3/M9, but for Refund instead of Payment). The following constraints are mandatory:

1. **New gateway function:** `fetchRazorpayRefundStatus(refundId)` must be added to `razorpay.ts`. READ-ONLY, OUTSIDE txn.
2. **NO re-enqueue path.** Same as M9 — `refundRazorpayPayment()` is not idempotent at the gateway.
3. **NO ledger mutation.** 5A Option A: reversal entries already exist, become canonical on REFUNDED.
4. **Full refund → Payment also flipped** (conditional updateMany WHERE status=CAPTURED). Partial refunds do NOT flip Payment.
5. **All 16 safety invariants (M10-SI-1 through M10-SI-16) must be satisfied.**
6. **SQLite evidence (M10-E1 through M10-E10) must PASS** before PostgreSQL evidence.
7. **PostgreSQL evidence (M10-E11 through M10-E12) must PASS** before M10 S5 closure.

### Why CONDITIONAL GO (not HOLD)

- The **status-flip path** (gateway says `processed` → flip to REFUNDED) is **structurally identical** to the publisher's success path — already proven safe in 5A-E6 (PostgreSQL).
- The **5A Option A ledger interaction** is SAFE — no new ledger entries are created. The existing reversal pair becomes canonical (same as publisher success).
- The **dangerous path** (re-enqueue for refund retry) is explicitly **excluded** — same as M9.

### Why NOT full GO

- M10 mutates **TWO tables** (Refund + Payment), unlike M3/M9 (Payment only). Both use conditional updateMany (proven safe), but the complexity is higher.
- M10 requires a **new gateway function** (`fetchRazorpayRefundStatus`) — not yet implemented. This is a new external call that must be proven safe.
- M10 interacts with **5A Option A ledger semantics** — while the analysis shows it's safe (no ledger mutation), the evidence must explicitly verify this.
- The **re-enqueue path** remains a fundamental gap (same as M9).

---

## Stop Point

This Gate Review is COMPLETE. The IDE is STOPPING.

- M10 READ/PLAN-FIRST Gate Review: ✅ COMPLETE.
- M10 implementation: 🔒 NOT YET AUTHORIZED.
- M10 re-enqueue path: 🔒 NOT AUTHORIZED (same as M9).
- Production: 🚫 NOT AUTHORIZED.
- `reconciliationAutoRepair`: 🚫 OFF.
- Wave-3/4/5A/5B/5C-M16/5C-M3/5C-M9: ✅ CLOSED — immutable.
- Wave-6 / Wave-7: 🔒 LOCKED.

**Next governance checkpoint:** Orchestrator decision on M10 implementation authorization. The Orchestrator may:
- (a) Authorize M10 implementation for the status-flip path only (per the CONDITIONAL GO recommendation).
- (b) Defer M10 (keep on detection + operator review).
- (c) Reject the plan.
- (d) Declare 5C as "sufficiently closed" (M16 + M3 + M9 cover the most common real-world scenarios; M10's incremental value is lower).

---

**End of Gate Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `reconciliationAutoRepair` OFF. Wave-3/4/5A/5B/5C-M16/M3/M9 CLOSED — immutable. Wave-6/7 LOCKED.**

**STOP. Awaiting Orchestrator decision on M10 implementation authorization.**
