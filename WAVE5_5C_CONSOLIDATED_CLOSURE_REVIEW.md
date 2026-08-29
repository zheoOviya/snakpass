# Wave-5 Sub-Wave 5C — Consolidated Closure Review

**Document type:** READ/REVIEW-ONLY governance gate (NO implementation, NO code changes, NO schema changes, NO evidence execution).
**Directive ID:** `WAVE5-5C-CONSOLIDATED-CLOSURE-REVIEW-01`
**Author:** IDE (read-only synthesis from repository).
**Orchestrator directive:** Sub-Wave 5C Consolidated Closure Review. Verify M16/M3/M9/M10 closures, preserve CLASS B/D/E HOLD, preserve gateway idempotency-key gap as deferred. Make NO code/schema/evidence/production changes.
**Created:** 2026-08-17
**Scope:** Wave-5 Sub-Wave 5C (P0-03 Reconciliation Remediation) — consolidated review of all closed remediation gates.

> **Governance rule:** This document is a READ-ONLY review artifact. It does NOT authorize any new implementation, schema change, migration, evidence workflow, remediation, production deployment, or feature-flag activation. Its purpose is to verify the current state of 5C closures and provide the Orchestrator with a consolidated view for the next governance decision.

---

## 1. Verification Summary (ALL 12 checks PASS)

| # | Check | Result |
|---|-------|--------|
| 1 | Git working tree clean | ✅ |
| 2 | HEAD = `a6cbbba` (M10 S5 closure) | ✅ |
| 3 | All 4 CLASS-C closure docs preserved (M16, M3, M9, M10 gate reviews) | ✅ |
| 4 | All 8 evidence artifacts preserved (4 SQLite + 4 PostgreSQL) | ✅ |
| 5 | All 4 S5 PASS / CLOSED references in WAVE5_EVIDENCE.md | ✅ (18 references) |
| 6 | `reconciliationAutoRepair` OFF by default | ✅ |
| 7 | `EVIDENCE_TEST_MODE` not set | ✅ |
| 8 | CLASS B/D/E remediation handlers NOT implemented (0 found) | ✅ |
| 9 | Gateway idempotency-key gap documented as deferred (5 references in TRANSACTION_RETRY_INVARIANT.md) | ✅ |
| 10 | CLOSED wave code untouched (capture route, refund route, webhook handler, publisher) | ✅ |
| 11 | Exactly 4 remediation handlers present (M16, M3, M9, M10) — no CLASS B/D/E | ✅ |
| 12 | Production NOT authorized (`realPayments` not set) | ✅ |

---

## 2. Closed Remediation Gates (CLASS C — all 4 S5 PASS / CLOSED)

| Gate | Mismatch class | Repair type | SQLite | PostgreSQL | S5 Directive |
|------|---------------|-------------|:------:|:----------:|-------------|
| **M16** | Outbox lag (operational) | Publisher trigger (operational, non-financial) | 8/8 PASS | 8/8 PASS | `S5-5C-M16-P0-03-CLOSE` |
| **M3** | Missing capture status | Gateway-verified CAPTURE_PENDING → CAPTURED | 8/8 PASS | 8/8 PASS | `S5-5C-M3-P0-03-CLOSE` |
| **M9** | Stuck CAPTURE_PENDING | Gateway-verified CAPTURE_PENDING → CAPTURED (NO re-enqueue) | 8/8 PASS | 8/8 PASS | `S5-5C-M9-P0-03-CLOSE` |
| **M10** | Stuck REFUND_PENDING | Gateway-verified REFUND_PENDING → REFUNDED + Payment CAPTURED → REFUNDED (full refund, NO re-enqueue, 5A Option A) | 8/8 PASS | 8/8 PASS | `S5-5C-M10-P0-03-CLOSE` |

### 2.1 Closure boundaries (all 4 gates)

| Boundary | M16 | M3 | M9 | M10 |
|----------|:---:|:--:|:--:|:---:|
| Payment.status mutation | ❌ | ✅ (CAPTURE_PENDING → CAPTURED) | ✅ (same) | ✅ (CAPTURED → REFUNDED for full refund) |
| Refund.status mutation | ❌ | ❌ | ❌ | ✅ (REFUND_PENDING → REFUNDED) |
| LedgerEntry mutation | ❌ | ❌ | ❌ | ❌ (5A Option A: reversal entries become canonical) |
| Outbox mutation | ❌ | ❌ | ❌ | ❌ (SI-11) |
| Razorpay capture call | ❌ | ❌ | ❌ | ❌ |
| Razorpay refund call | ❌ | ❌ | ❌ | ❌ |
| Outbox re-enqueue | ❌ | ❌ | ❌ (PROHIBITED) | ❌ (PROHIBITED) |
| Gateway fetch (READ-ONLY) | ❌ | ✅ (`fetchRazorpayPaymentStatus`) | ✅ (same) | ✅ (`fetchRazorpayRefundStatus`) |
| External call outside txn | N/A | ✅ | ✅ | ✅ |
| Feature-flagged | ✅ | ✅ | ✅ | ✅ |
| Escalate on ambiguity | N/A | ✅ | ✅ | ✅ |

---

## 3. Open Items (NOT closed)

### 3.1 CLASS B — Ledger synthesis (HIGH RISK)

| Mismatch | Description | Why HOLD |
|----------|-------------|----------|
| M2 | Missing capture ledger pair | Synthesizing ledger entries = fabricating financial records retroactively. Requires gateway verification + careful accounting review. HIGH RISK. |
| M7 | Refund without reversal ledger | Same risk as M2 — synthesizing reversal entries. |
| M13 | Unprocessed webhook | Re-processing is lower risk but requires careful state verification. |

**Status:** 🔒 HOLD — separate authorization required. The 5C Gate Review (§2 D4) classified these as CLASS B with explicit HIGH RISK designation.

### 3.2 CLASS D — Quarantine + manual review

| Mismatch | Description | Why HOLD |
|----------|-------------|----------|
| M11-FAILED | Orphan outbox (FAILED) | Publisher exhausted retries — manual decision needed. |
| M12 | Orphan outbox (aggregate missing) | Impossible by atomicity — corruption evidence. Quarantine. |
| M14 | Webhook references missing Payment | Cannot create Payment from webhook alone. Quarantine. |

**Status:** 🔒 HOLD — always escalated, never auto-repaired. This is by design (the 5C Gate Review §2 D6 explicitly excludes automatic remediation for CLASS D).

### 3.3 CLASS E — NEVER auto-repaired

| Mismatch | Description | Why NO-AUTO-REPAIR |
|----------|-------------|-------------------|
| M1 | Ledger imbalance (I-06) | Cannot determine which entry is wrong. Forensic accounting review. |
| M4 | Duplicate capture ledger (I-04) | Cannot know which is authoritative. |
| M5 | Duplicate refund per key | Schema should prevent; if occurs, manual review. |
| M6 | Refund exceeds payment (I-03) | Money already returned. Accounting adjustment. |
| M8 | Reversal without refund | Two possible repairs, both dangerous. |
| M15 | Status-ledger inconsistency | Cannot know if status or refund records are wrong. |
| M17 | Audit chain break | The break IS the evidence. Never auto-repair. |

**Status:** 🔒 NO AUTO-REPAIR — by design. These classes require human judgment (accounting/forensic review). The 5C Gate Review (§2 D4) explicitly classified them as CLASS E.

### 3.4 Gateway idempotency-key gap (DEFERRED)

**Status:** ⚠️ DEFERRED — documented in `docs/TRANSACTION_RETRY_INVARIANT.md` §8.2 item 4.

The gap: `captureRazorpayPayment()` and `refundRazorpayPayment()` do NOT use a pre-generated idempotency key for the gateway API call. This means:
- Re-enqueuing a FAILED outbox event for capture/refund retry can cause a **duplicate charge/refund at the gateway**.
- M9 and M10's re-enqueue paths are **PROHIBITED** because of this gap.
- Closing this gap would require:
  1. Pre-generating an idempotency key before the outbox event is enqueued.
  2. Storing the key in the Outbox payload (or a dedicated column).
  3. Passing the key as an `X-Idempotency-Key` header to `instance.payments.capture()` / `instance.payments.refund()`.
  4. Verifying that Razorpay honors the key (per-endpoint — documented in TRANSACTION_RETRY_INVARIANT.md §5 Option B).

**This is a separate workstream** — it touches the capture route, refund route, outbox publisher, and razorpay.ts. It is NOT part of 5C's scope.

---

## 4. Governance Questions (Orchestrator's 3 questions)

### Q1: क्या 5C के चार CLASS-C cases पर्याप्त रूप से closed हैं?

**Answer: YES.**

All 4 CLASS-C remediation gates (M16, M3, M9, M10) have:
- ✅ Implementation COMPLETE.
- ✅ SQLite E1-E8: 8/8 PASS.
- ✅ PostgreSQL E9-E12: 8/8 PASS.
- ✅ `orchestratorRequiredFields`: all true.
- ✅ S5 PASS / CLOSED directives issued by the Orchestrator.
- ✅ Evidence artifacts preserved (not regenerated).
- ✅ Documentation updated (WAVE5_EVIDENCE.md, gate review docs, worklog).

The 4 closed gates cover the **most common real-world remediation scenarios**:
- M16: outbox publisher stalled (operational restart).
- M3: capture succeeded at gateway but DB status wasn't flipped (publisher success-txn crash).
- M9: same as M3 but for a broader set of conditions (outbox FAILED, not just PUBLISHED).
- M10: refund succeeded at gateway but DB status wasn't flipped (publisher success-txn crash).

### Q2: क्या gateway retry/idempotency-key gap हल हो गया है?

**Answer: NO.**

The gateway idempotency-key gap remains **DEFERRED** (TRANSACTION_RETRY_INVARIANT.md §8.2 item 4). M9 and M10 closures explicitly **PROHIBIT** the re-enqueue path. The closures prove:
- ✅ Status-flip safety (gateway says "captured"/"processed" → flip DB status).
- ❌ Capture/refund retry safety (gateway says "not captured"/"not processed" → re-enqueue for retry).

The retry path requires a pre-generated idempotency key for `captureRazorpayPayment()` / `refundRazorpayPayment()` — a separate safety improvement that is NOT part of 5C.

### Q3: क्या इससे production authorization स्वतः मिल जाता है?

**Answer: NO.**

- `reconciliationAutoRepair` remains **OFF** by default.
- `realPayments` remains **OFF**.
- `webhookHandler` remains **OFF** in production.
- `requestHashEnforcement` remains **OFF** in production.
- Production deployment is **NOT AUTHORIZED**.
- Wave-6 (P0-06 State Separation) remains **LOCKED**.
- Wave-7 (P0-07 Pickup Attribution) remains **LOCKED**.

The 5C closures prove **remediation safety** (detect → classify → repair → verify), NOT **production readiness**. Production authorization requires a separate Orchestrator decision that considers:
1. The 4 LOCKED P0s (P0-04 ✅, P0-03 ✅, P0-06 🔒, P0-07 🔒 — wait, P0-04 and P0-03 are closed via Wave-5 5A/5B/5C; P0-06 and P0-07 are still LOCKED).
2. DR drill (not executed — Phase-3 launch-gate item).
3. Rollback drill (not executed — Phase-3 launch-gate item).
4. Production infrastructure (not provisioned).
5. The gateway idempotency-key gap (deferred — needed before `realPayments=true`).

---

## 5. Recommendation

### 5C CLASS-C remediation is CONSOLIDATED-CLOSED.

The 4 CLASS-C remediation gates (M16, M3, M9, M10) are sufficiently closed. The remaining classes (B, D, E) are correctly LOCKED — they require human judgment (CLASS D/E) or are HIGH RISK (CLASS B). The gateway idempotency-key gap is correctly DEFERRED — it is a separate workstream.

### Proposed next governance decision tree

```text
5C Consolidated Closure Review
        │
        ├── CLOSE 5C CLASS-C scope
        │      (M16 + M3 + M9 + M10 = S5 PASS / CLOSED)
        │
        ├── CLASS B/D/E remain LOCKED
        │      (separate authorization per class if ever needed)
        │
        ├── Gateway idempotency-key gap
        │      → separate workstream (if retry path is ever needed)
        │
        ├── Production remains NOT AUTHORIZED
        │      (separate Orchestrator decision — multiple hard blockers remain)
        │
        └── Wave-6 (P0-06 State Separation) remains LOCKED
               (separate Orchestrator directive required)
```

### What this review does NOT change

- ❌ No new implementation authorized.
- ❌ No CLASS B/D/E remediation authorized.
- ❌ No production deployment authorized.
- ❌ No feature-flag activation authorized.
- ❌ No Wave-6 / Wave-7 authorized.
- ❌ No evidence reruns.
- ❌ No code/schema changes.

### What this review confirms

- ✅ M16 + M3 + M9 + M10 are all S5 PASS / CLOSED with preserved evidence.
- ✅ CLASS B/D/E remain correctly LOCKED.
- ✅ Gateway idempotency-key gap remains correctly DEFERRED.
- ✅ `reconciliationAutoRepair` remains OFF.
- ✅ Production remains NOT AUTHORIZED.
- ✅ Wave-6 / Wave-7 remain LOCKED.
- ✅ CLOSED wave code (Wave-3/4/5A) remains untouched.

---

## 6. Stop Point

This Consolidated Closure Review is COMPLETE. The IDE is STOPPING.

- 5C Consolidated Closure Review: ✅ COMPLETE.
- No new implementation authorized.
- No production authorized.
- No feature-flag activation authorized.
- Wave-6 / Wave-7 remain LOCKED.

**Next governance checkpoint:** Orchestrator decision on:
- (a) **Close 5C CLASS-C scope** (formally declare 5C as "CLASS-C CLOSED, remaining classes permanently HOLD/NO-AUTO-REPAIR" — documentation-only).
- (b) **Authorize CLASS B/D/E remediation** (separate directive per class — READ/PLAN-FIRST first).
- (c) **Authorize gateway idempotency-key workstream** (separate workstream — closes the M9/M10 re-enqueue gap).
- (d) **Authorize production readiness review** (separate gate — multiple hard blockers remain: DR drill, rollback drill, production infrastructure, P0-06, P0-07).
- (e) **Authorize Wave-6** (P0-06 State Separation — separate directive).

**The IDE must NOT interpret this review as authorization for any new work.** The IDE is STOPPED.

---

**End of Consolidated Closure Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `reconciliationAutoRepair` OFF. `realPayments` OFF. `webhookHandler` OFF. `requestHashEnforcement` OFF. Wave-3/4/5A/5B/5C-M16/M3/M9/M10 CLOSED — immutable. Wave-6/7 LOCKED.**

**STOP. Awaiting Orchestrator's next governance decision.**
