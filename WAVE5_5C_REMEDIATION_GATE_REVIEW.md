# Wave-5 Sub-Wave 5C — P0-03 Reconciliation Remediation: READ/PLAN-FIRST Gate Review

**Document type:** Gate Review (READ/PLAN-FIRST — NO implementation authorization).
**Directive ID:** `WAVE5-5C-P0-03-REMEDIATION-GATE`
**Author:** IDE (read-only synthesis from repository + 5B evidence).
**Orchestrator directive:** Sub-Wave 5C READ/PLAN-FIRST AUTHORIZED. 5C implementation 🔒 NOT YET AUTHORIZED. 5C financial mutation 🔒 NOT AUTHORIZED.
**Created:** 2026-08-16
**Scope:** P0-03 Reconciliation Remediation — repair of findings detected by Sub-Wave 5B.

> **Governance rule:** This document is a READ-ONLY planning artifact. It does NOT authorize implementation, schema change, migration, evidence workflow, remediation worker, or any financial mutation. The IDE has NOT written any 5C code. 5C implementation requires a separate Orchestrator directive after this Gate Review is reviewed.

> **Orchestrator constraint honored:** 5B's successful E4/E5/E6 proved **detection safety**. **Repair safety has NOT been proven.** Detection safety does not transfer to repair safety. 5C is a distinct safety boundary that requires its own evidence package. The Orchestrator's default preference is CONDITIONAL GO (limited remediation for explicitly approved classes), NOT blanket automatic remediation.

> **Architectural principle (Orchestrator mandate):** The IDE must NOT design "automatically repair every finding." The 5C pipeline must be: Detection → Re-validate current state → Safe/Unsafe classification → Authorization (if needed) → Repair transaction → Post-repair verification → Finding resolution → Audit evidence. Three principles are non-negotiable: (1) Re-validation before repair, (2) Repair idempotency, (3) External gateway ambiguity = no automatic repair.

---

## 0. Executive Summary

| Field | Value |
|-------|-------|
| **Sub-Wave** | 5C — P0-03 Reconciliation Remediation |
| **Authorization level** | READ/PLAN-FIRST ONLY |
| **Implementation authorized?** | ❌ NO — separate Orchestrator directive required |
| **Recommendation** | **CONDITIONAL GO** — limited remediation for explicitly approved mismatch classes only; majority of classes remain detection + operator review |
| **Safe-to-automate classes** | **1 of 17** (M16 — operational, not financial) |
| **Requires-gateway-verification classes** | **3 of 17** (M3, M9, M10 — status mutation based on gateway truth) |
| **Requires-state-verification classes** | **3 of 17** (M2, M7, M13 — verify current state before optional synthesis) |
| **Requires-human-authorization classes** | **3 of 17** (M11-FAILED, M12, M14 — quarantine + manual review) |
| **DO-NOT-AUTOMATICALLY-REMEDIATE classes** | **7 of 17** (M1, M4, M5, M6, M8, M15, M17 — accounting/forensic review only) |
| **Schema impact** | NONE required for planning; implementation may add `RemediationAction` + `RemediationRun` tables (Class-2 additive, separate authorization) |
| **Production impact** | NONE — 5C does not touch production. All flags remain OFF. |
| **Impact on CLOSED waves** | NONE — Wave-3/4/5A invariants preserved. Remediation repair handlers are new code paths, not modifications to CLOSED routes. |

**One-line recommendation:** Implement remediation for **only the mismatch classes where a deterministic, idempotent, and independently verifiable repair path can be proven** (initially: M16 operational + optionally M3/M9/M10 gateway-verified status flips). Keep the remaining 13+ classes on **detection + operator review** until each is individually authorized with its own evidence package. **Do NOT implement blanket automatic remediation.**

---

## 1. Current-State Findings

### 1.1 What 5B produced (read from evidence artifacts)

The 5B detection layer is COMPLETE and verified on both SQLite + PostgreSQL. The evidence artifacts confirm:

| Evidence | Database | Mismatch classes exercised | Findings | ExceptionQueue entries |
|----------|----------|---------------------------|----------|------------------------|
| `evidence-E1-E6-sqlite-5b.json` | SQLite | M1, M9, M10, M12 (seeded) | 6/6 PASS | Created (Level 1 freeze) |
| `evidence-E1-E6-postgresql-5b-pg-ev.json` | PostgreSQL | M1, M9, M10, M12 (seeded) + M4 (natural false positive from E1's extra DEBIT) | 6/6 PASS | 43 entries (from all E1-E6 runs) |

**Important caveat:** The 5B evidence exercised only **4 of 17** mismatch classes (M1, M9, M10, M12) via seeded anomalies. The remaining 13 classes (M2, M3, M4, M5, M6, M7, M8, M11, M13, M14, M15, M16, M17) are implemented in code but have NOT been exercised against real anomalies in the evidence runs. This means:
- The **detection logic** for all 17 classes is implemented + read-only.
- The **remediation analysis** below is based on code reading + architectural reasoning, NOT on observed real-world findings.
- Before any class is authorized for remediation, its detector should be exercised against a real anomaly to confirm the finding is actionable.

### 1.2 What the CLOSED waves produce (mutation points that remediation would interact with)

| CLOSED-wave component | Mutation points (inside `withTransaction`) | What remediation might need to touch |
|------------------------|---------------------------------------------|--------------------------------------|
| **Capture route** (`src/app/api/payments/route.ts`) | Payment (CAPTURE_PENDING), Order (PAID), LedgerEntry (Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE), AuditLog (PAYMENT_CAPTURE_PENDING), Outbox (PAYMENT_CAPTURE_REQUESTED), IdempotencyKey | Payment.status, LedgerEntry (synthesis), AuditLog (repair record) |
| **Refund route** (`src/app/api/payments/refund/route.ts`) | Refund (REFUND_PENDING), LedgerEntry (reversal Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE), AuditLog (PAYMENT_REFUND_PENDING), Outbox (PAYMENT_REFUND_REQUESTED), IdempotencyKey | Refund.status, LedgerEntry (synthesis), AuditLog (repair record) |
| **Publisher — capture handler** (`mini-services/outbox-publisher/index.ts`) | Payment (CAPTURED via conditional updateMany), AuditLog (PAYMENT_CAPTURED), Outbox (PUBLISHED) | Payment.status (re-flip if stuck) |
| **Publisher — refund handler** | Refund (REFUNDED via conditional updateMany), Payment (REFUNDED for full refund), AuditLog (PAYMENT_REFUNDED), Outbox (PUBLISHED) | Refund.status, Payment.status (re-flip if stuck) |
| **Webhook handler** (`src/app/api/webhooks/razorpay/route.ts` + `src/lib/webhook-processor.ts`) | WebhookEvent (dedup via eventId), Payment (CAPTURED/FAILED via conditional updateMany), AuditLog, Outbox (PAYMENT_CAPTURE_CONFIRMED) | WebhookEvent (re-process), Payment.status |

**Critical observation:** Every CLOSED-wave mutation point uses **conditional updates** (`updateMany WHERE status=...`) — race-safe optimistic locking. Any 5C remediation handler that touches these tables MUST follow the same pattern. It MUST NOT use unconditional `update()` — that would bypass the version field and could overwrite a concurrent state change.

### 1.3 The 5B safety contract (what 5C inherits + must not break)

5B proved (E4): reconciliation does NOT mutate money-state tables. 5C **inverts** this contract — its entire purpose IS to mutate money-state tables. This is why 5C is a distinct safety boundary:

| Property | 5B (detection) | 5C (remediation) |
|----------|-----------------|-------------------|
| Writes to Payment/Refund/LedgerEntry/Outbox/WebhookEvent/IdempotencyKey/AuditLog | ❌ NEVER | ✅ YES (that's the point) |
| External Razorpay API calls | ❌ NEVER | ⚠️ MAYBE (for CLASS C — gateway verification) |
| Financial mutation risk | ❌ ZERO | ⚠️ NON-ZERO (requires its own evidence) |
| Idempotency requirement | Dedup via unique constraint | **Repair idempotency** (re-running repair must NOT cause a second financial mutation) |
| Concurrency requirement | Read-only (no write locks) | **Repair txn must be race-safe** (conditional updates, version checks) |

---

## 2. M1–M17 Remediation Classification

This is the core of the Gate Review. Each mismatch class is classified into one of five remediation categories:

| Class | Description | Automatic repair possible? |
|-------|-------------|:--------------------------:|
| **CLASS A** | Safe deterministic local remediation | ✅ YES (no external state, no ambiguity) |
| **CLASS B** | Requires additional state verification before repair | ⚠️ CONDITIONAL (verify current DB state, then optionally repair) |
| **CLASS C** | Requires external Razorpay verification | ⚠️ CONDITIONAL (gateway truth required before status mutation) |
| **CLASS D** | Requires human/operator authorization | ❌ NO (quarantine + manual review) |
| **CLASS E** | DO NOT automatically remediate | ❌ NO (accounting/forensic review only) |

### 2.1 Classification Table

| # | Class | Severity | Root cause | Repair action | Classification | Rationale |
|---|-------|----------|------------|---------------|:---------------:|-----------|
| **M1** | LEDGER_IMBALANCE | CRITICAL | Partial commit (impossible by atomicity) OR manual DB edit OR storage corruption | None (cannot know which entry is wrong) | **CLASS E** | Cannot determine whether the Dr or Cr is authoritative. Adding a balancing entry = fabricating accounting records. Requires forensic accounting review. |
| **M2** | MISSING_CAPTURE_LEDGER | CRITICAL | Payment CAPTURED but no Dr/Cr pair (impossible by atomicity) | Synthesize the missing Dr/Cr pair IF gateway confirms capture | **CLASS B** | Could synthesize, but this is retroactively creating financial records. Must verify gateway captured first. High risk — prefer operator review. |
| **M3** | MISSING_CAPTURE_STATUS | HIGH | Payment has capture ledger pair but status still CAPTURE_PENDING (publisher failed to flip) | If gateway confirms capture → flip Payment.status to CAPTURED (conditional updateMany WHERE status=CAPTURE_PENDING) | **CLASS C** | Safe to repair IF gateway confirms. MUST NOT guess — if gateway is ambiguous, escalate to operator. The repair is a STATUS mutation, not a ledger mutation (lower risk). |
| **M4** | DUPLICATE_CAPTURE_LEDGER | CRITICAL | More than 1 Dr GATEWAY_RECEIVABLE per payment (I-04 violation) | None (cannot know which entry is authoritative) | **CLASS E** | Removing one entry could break Dr/Cr balance. Requires accounting review to determine which is the duplicate. |
| **M5** | DUPLICATE_REFUND_PER_KEY | CRITICAL | Schema unique constraint violated (schema drift or manual edit) | None (cannot know which refund is real) | **CLASS E** | Both refunds may have been processed at the gateway. Requires manual review of gateway state. |
| **M6** | REFUND_EXCEEDS_PAYMENT | HIGH | Refund validation gap — refunds sum past payment amount | None (money already returned to customer; cannot undo a real gateway refund) | **CLASS E** | The damage is done. Repair = accounting adjustment (recognize the over-refund as a loss) + operator review. NOT a technical repair. |
| **M7** | REFUND_WITHOUT_REVERSAL_LEDGER | HIGH | Refund marked REFUNDED but no reversal Dr/Cr pair (impossible by atomicity) | Synthesize the missing reversal Dr/Cr pair IF gateway confirms refund | **CLASS B** | Could synthesize, but this is fabricating ledger entries retroactively. Must verify gateway refunded first. High risk — prefer operator review. |
| **M8** | REVERSAL_WITHOUT_REFUND | HIGH | Reversal Dr/Cr entries exist but no Refund row (impossible by atomicity) | None (cannot know if a Refund should be created or entries should be removed) | **CLASS E** | Two possible repairs, both dangerous. Requires manual review to determine the correct action. |
| **M9** | STUCK_CAPTURE_PENDING | HIGH | Payment CAPTURE_PENDING past threshold, outbox not PENDING (publisher exhausted or FAILED) | If gateway confirms capture → flip to CAPTURED. If gateway says not captured → retry capture (re-enqueue outbox) OR mark FAILED. | **CLASS C** | Safe to repair IF gateway confirms. The repair is a STATUS mutation based on gateway truth. If gateway is ambiguous, escalate. NOTE: retry capture (re-enqueue outbox) risks duplicate capture at gateway — must use publisher's idempotency check (Payment.status === CAPTURED → skip). |
| **M10** | STUCK_REFUND_PENDING | HIGH | Refund REFUND_PENDING past threshold, outbox not PENDING | If gateway confirms refund → flip to REFUNDED. If gateway says not refunded → retry refund OR mark FAILED. | **CLASS C** | Safe to repair IF gateway confirms. Complex interaction with 5A Option A pending ledger semantics: if refund succeeds on retry, the pending reservation becomes canonical (no new ledger entries). If refund is permanently FAILED, the reservation must be manually resolved (requires accounting review — CLASS E for the FAILED path). |
| **M11** | ORPHAN_OUTBOX | HIGH | Outbox PENDING/CLAIMED past TTL or FAILED | For PENDING/CLAIMED past TTL → re-claim + retry (risk: duplicate side-effect at gateway). For FAILED → manual decision. | **CLASS D** (FAILED) / **CLASS B** (PENDING/CLAIMED) | Re-enqueueing risks duplicate capture/refund at gateway. The publisher's idempotency checks (Payment.status === CAPTURED → skip; Refund.status === REFUNDED → skip) protect against this, but FAILED events need manual judgment. |
| **M12** | ORPHAN_OUTBOX_AGGREGATE_MISSING | CRITICAL | Outbox references Payment/Refund that doesn't exist (impossible by atomicity — manual DB delete) | Quarantine the outbox event (do NOT delete — preserve audit trail) | **CLASS D** | Cannot repair the missing aggregate. The outbox event is evidence of corruption. Quarantine + manual review. |
| **M13** | UNPROCESSED_WEBHOOK | MEDIUM | Webhook received + verified but never processed (handler crash mid-processing) | Re-process the webhook (the handler is idempotent via eventId dedup) | **CLASS B** | Re-processing is safe IF the webhook handler's idempotency holds (eventId unique constraint dedups). Must verify current state before applying — the Payment may have been updated by another path since the webhook was received. |
| **M14** | WEBHOOK_MISSING_PAYMENT | MEDIUM | Webhook references Payment that doesn't exist (race or stale webhook) | Quarantine the webhook (cannot create a Payment from a webhook alone) | **CLASS D** | Cannot repair. Quarantine + manual review to determine if the webhook is stale or if a Payment should be created. |
| **M15** | STATUS_LEDGER_INCONSISTENCY | HIGH | Payment REFUNDED but refunds don't sum to payment amount | None (cannot know if the status is wrong or the refunds are wrong) | **CLASS E** | Requires accounting review to determine whether the status should be changed or the refund records should be adjusted. |
| **M16** | OUTBOX_LAG_EXCEEDED | MEDIUM | Publisher is behind (operational health, not money-state violation) | Restart/scale publisher (operational, not financial) | **CLASS A** | The "repair" is NOT a financial mutation — it's an operational action (restart the publisher mini-service). No ledger/Payment/Refund mutation. Safe to automate as an operational alert + auto-restart. |
| **M17** | AUDIT_CHAIN_BREAK | MEDIUM | AuditLog hash-chain broken (tamper evidence or storage corruption) | None (NEVER auto-repair an audit log — the break IS the evidence) | **CLASS E** | Repairing the chain would destroy the tamper evidence. Forensic/operator path only. The break must be investigated, not "fixed." |

### 2.2 Classification Summary

| Class | Count | Mismatch classes | Automatic repair? |
|-------|:-----:|------------------|:-----------------:|
| **CLASS A** (safe deterministic) | 1 | M16 | ✅ YES (operational, not financial) |
| **CLASS B** (requires state verification) | 3 | M2, M7, M13 | ⚠️ CONDITIONAL |
| **CLASS C** (requires gateway verification) | 3 | M3, M9, M10 | ⚠️ CONDITIONAL |
| **CLASS D** (requires human authorization) | 3 | M11-FAILED, M12, M14 | ❌ NO (quarantine + manual) |
| **CLASS E** (DO NOT automatically remediate) | 7 | M1, M4, M5, M6, M8, M15, M17 | ❌ NO (accounting/forensic) |

**Key insight:** Only **1 of 17** mismatch classes (M16) is safe for deterministic automatic remediation — and it's an **operational** repair (restart publisher), not a **financial** mutation. The remaining 16 classes require either state verification, gateway verification, human authorization, or are outright prohibited from automatic repair.

**This strongly supports a CONDITIONAL GO recommendation** — blanket automatic remediation is unsafe for the vast majority of mismatch classes.

---

## 3. Proposed Remediation Architecture (NOT implemented)

### 3.1 The remediation pipeline

Per the Orchestrator's mandate, the pipeline is NOT "detect → auto-repair." It is:

```text
                    ┌──────────────────┐
                    │ Reconciliation   │
                    │    Finding (5B)  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ Re-validate      │  ← MANDATORY: re-read current DB state
                    │ Current State    │    (the finding may be stale)
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │                  │
                 Safe               Unsafe/
                 repair             ambiguous
                    │                  │
                    ▼                  ▼
             Authorization       ExceptionQueue
             (if CLASS D)       (escalate)
                    │                  │
                    ▼                  │
             Repair Transaction        │  ← MANDATORY: idempotent + conditional
                    │                  │    (re-running must NOT cause 2nd mutation)
                    ▼                  │
             Post-repair Verify ◄──────┘  ← MANDATORY: verify the repair worked
                    │                      + did NOT create new drift
                    ▼
             Finding Resolution
             (mark ReconciliationFinding.resolvedAt)
                    │
                    ▼
             Audit Evidence
             (AuditLog entry: RECONCILIATION_REPAIR_*)
```

### 3.2 The three non-negotiable principles

#### Principle 1: Re-validation before repair

A 5B finding is a **snapshot of state at detection time**. By the time a remediation worker picks it up, the state may have changed (e.g., a stuck CAPTURE_PENDING payment may have been captured by a publisher retry in the meantime).

**Rule:** Before any repair, the remediation handler MUST re-read the current state of the affected entity + re-run the specific detector. If the finding is no longer present, the repair is skipped (the finding is marked as "resolved by external action" + resolvedAt is set).

**Implementation pattern:**
```text
1. Read ReconciliationFinding by id
2. Re-read the affected entity (Payment/Refund/Outbox/etc.) from DB
3. Re-run the specific detector (M1-M17) against the current state
4. If the finding is still present → proceed to repair
5. If the finding is no longer present → mark finding resolved ("stale — auto-resolved")
```

#### Principle 2: Repair idempotency

If the remediation worker crashes between the repair commit and the finding-resolution commit, a retry must NOT cause a second financial mutation.

**Rule:** Every repair handler MUST be idempotent. Re-running the repair against an already-repaired state must be a no-op (or a safe dedup).

**Implementation pattern:**
```text
1. Use conditional updates (updateMany WHERE status=...) — if the state is already
   the target state, count=0, skip.
2. Use a RemediationAction table (new Class-2 additive) with a unique constraint
   on (findingId, repairType) — if a repair action already exists for this finding,
   skip.
3. Mark the ReconciliationFinding as resolved ONLY inside the same txn as the repair
   — if the repair commits but the resolution doesn't, the finding remains unresolved
   and the next run will re-validate (Principle 1) + find the state already correct →
   skip.
```

#### Principle 3: External gateway ambiguity = no automatic repair

If the local DB state and the Razorpay gateway state disagree, the remediation service MUST NOT guess. It MUST escalate to a human operator.

**Rule:** For CLASS C mismatches (M3, M9, M10), the repair handler MUST call the Razorpay API to verify the gateway state. If the gateway returns a clear answer (captured / not captured / refunded / not refunded), the repair proceeds. If the gateway returns an ambiguous answer (error, timeout, unknown status), the repair is aborted + the finding is escalated to ExceptionQueue for manual review.

**Implementation pattern:**
```text
1. Call Razorpay API (fetch payment/refund status)
2. If gateway confirms the expected state → proceed with DB status mutation
3. If gateway contradicts the expected state → escalate to ExceptionQueue
   (the DB state may be correct and the finding may be a false positive)
4. If gateway is ambiguous (error/timeout) → abort + retry later (NOT escalate —
   the gateway may be temporarily unavailable)
5. The Razorpay API call MUST be OUTSIDE any withTransaction body
   (TRANSACTION_RETRY_INVARIANT — same as capture/refund external calls)
```

### 3.3 Per-class repair handlers (proposed — NOT implemented)

| Class | Handler | What it does | Idempotency mechanism |
|-------|---------|--------------|----------------------|
| **M16** | `handleM16OutboxLag` | Operational: alert + (optionally) trigger publisher restart via health-check endpoint. NO financial mutation. | N/A (no financial mutation) |
| **M3** | `handleM3MissingCaptureStatus` | CLASS C: Call Razorpay API to verify capture. If confirmed → `Payment.updateMany WHERE status=CAPTURE_PENDING → CAPTURED`. If ambiguous → escalate. | Conditional updateMany (if already CAPTURED, count=0, skip). |
| **M9** | `handleM9StuckCapturePending` | CLASS C: Call Razorpay API. If captured → flip to CAPTURED (same as M3). If not captured → re-enqueue outbox (publisher idempotency check prevents duplicate capture). If ambiguous → escalate. | Conditional updateMany + publisher's Payment.status check. |
| **M10** | `handleM10StuckRefundPending` | CLASS C: Call Razorpay API. If refunded → flip Refund to REFUNDED + (if full refund) Payment to REFUNDED. If not refunded → re-enqueue outbox. If ambiguous → escalate. NOTE: 5A Option A pending reservation becomes canonical on success (no new ledger entries). If permanently FAILED → escalate (CLASS E for the FAILED path). | Conditional updateMany + publisher's Refund.status check. |
| **M2** | `handleM2MissingCaptureLedger` | CLASS B: Verify Payment is CAPTURED + gateway captured. Synthesize the missing Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE. HIGH RISK — prefer operator review. | RemediationAction unique constraint + ledger balance re-check post-repair. |
| **M7** | `handleM7RefundWithoutReversal` | CLASS B: Verify Refund is REFUNDED + gateway refunded. Synthesize the missing reversal Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE. HIGH RISK — prefer operator review. | RemediationAction unique constraint + ledger balance re-check post-repair. |
| **M13** | `handleM13UnprocessedWebhook` | CLASS B: Re-process the webhook via the existing `processWebhookEvent()` (idempotent via eventId dedup). Must verify current Payment state before applying. | WebhookEvent.eventId unique constraint (existing 4a dedup). |

**CLASS D + CLASS E handlers:** No automatic repair. CLASS D → quarantine + ExceptionQueue + alert. CLASS E → freeze + ExceptionQueue + forensic/accounting review alert.

---

## 4. Mandatory Safety Invariants for 5C

Any future 5C implementation MUST satisfy these invariants. Violation of any one is a blocker.

| # | Invariant | Rationale |
|---|-----------|-----------|
| **SI-1** | Re-validation before repair | A finding may be stale; repairing a non-existent issue creates new drift. |
| **SI-2** | Repair idempotency | A worker crash + retry must NOT cause a second financial mutation. |
| **SI-3** | External gateway ambiguity = no repair | If gateway state is ambiguous, the remediation service MUST NOT guess. |
| **SI-4** | All repairs use conditional updates (updateMany WHERE status=...) | Race-safe optimistic locking — same pattern as CLOSED-wave routes. |
| **SI-5** | External Razorpay API calls OUTSIDE any withTransaction body | TRANSACTION_RETRY_INVARIANT — same as capture/refund external calls. A P2034 retry must NOT re-fire the gateway API call. |
| **SI-6** | Every repair writes a RemediationAction audit record | The repair itself is a financial mutation — it MUST be auditable. |
| **SI-7** | Every repair writes an AuditLog entry (`RECONCILIATION_REPAIR_*`) | The repair is a business event — it goes in the hash-chained audit log. |
| **SI-8** | Post-repair verification: re-run the specific detector to confirm the finding is resolved | The repair may not have worked (e.g., a concurrent write overwrote it). Verify, don't assume. |
| **SI-9** | Post-repair ledger balance check: if the repair touched LedgerEntry, re-verify Dr sum === Cr sum | A ledger-synthesizing repair could itself create an imbalance if it partially fails. |
| **SI-10** | CLASS E mismatches are NEVER automatically repaired | M1, M4, M5, M6, M8, M15, M17 require human judgment. The code MUST NOT contain a repair handler for these classes. |
| **SI-11** | CLASS D mismatches are quarantined, not repaired | M11-FAILED, M12, M14 → ExceptionQueue + alert. No automatic action beyond freeze. |
| **SI-12** | Remediation is feature-flagged (`reconciliationAutoRepair`, default OFF) | The Orchestrator must explicitly authorize remediation enablement. Even after 5C implementation, the flag starts OFF. |
| **SI-13** | No repair handler re-opens a CLOSED wave's evidence | The repair handlers are NEW code paths. They do NOT modify the capture/refund/webhook/publisher routes. The CLOSED wave code is immutable. |
| **SI-14** | Remediation workers are single-instance (lease-based) | Two concurrent repair workers must NOT process the same finding. Use the same claim/lease pattern as the outbox publisher. |

---

## 5. Authorization Boundaries

The 5C pipeline has explicit authorization boundaries between each phase:

```text
Detection (5B — CLOSED)
    │
    │ [no authorization needed — 5B is read-only]
    ▼
Re-validation (5C — read-only)
    │
    │ [no authorization needed — read-only]
    ▼
Classification (5C — automatic, based on mismatch class)
    │
    ├─ CLASS A → automatic repair (operational only — M16)
    ├─ CLASS B → requires state verification, then automatic repair (M2, M7, M13)
    ├─ CLASS C → requires gateway verification, then automatic repair (M3, M9, M10)
    ├─ CLASS D → quarantine + ExceptionQueue + alert (M11-FAILED, M12, M14)
    └─ CLASS E → freeze + ExceptionQueue + forensic alert (M1, M4, M5, M6, M8, M15, M17)
    │
    │ [CLASS A/B/C: automatic IF reconciliationAutoRepair flag is ON]
    │ [CLASS D/E: always escalate — no flag can authorize automatic repair]
    ▼
Repair Transaction (5C — financial mutation)
    │
    │ [CLASS A: no authorization — operational]
    │ [CLASS B/C: authorized by reconciliationAutoRepair flag]
    │ [CLASS D/E: NOT authorized — requires separate human authorization]
    ▼
Post-repair Verification (5C — read-only)
    │
    │ [no authorization needed — read-only]
    ▼
Finding Resolution + Audit Evidence (5C — write to ReconciliationFinding + AuditLog)
```

**Key boundary:** The `reconciliationAutoRepair` feature flag controls ONLY CLASS A/B/C repairs. CLASS D/E are NEVER automatically repaired — the code path for them is "escalate to ExceptionQueue + alert." No flag flip can authorize automatic repair of CLASS E mismatches.

---

## 6. Evidence Plan (for future 5C implementation — NOT authorized now)

If the Orchestrator authorizes 5C implementation, the following evidence scenarios are mandatory:

### 6.1 SQLite evidence (E1-E8)

| # | Evidence | What it proves | Mandatory on PostgreSQL? |
|---|----------|----------------|:------------------------:|
| **E1** | CLASS A repair (M16) — operational, no financial mutation | M16 triggers publisher restart; no money-state mutation | Optional |
| **E2** | CLASS C repair (M3/M9) — gateway-verified status flip | Seed stuck CAPTURE_PENDING + gateway confirms capture → Payment flips to CAPTURED | Optional |
| **E3** | CLASS C repair (M10) — gateway-verified refund status flip | Seed stuck REFUND_PENDING + gateway confirms refund → Refund flips to REFUNDED + Payment flips to REFUNDED (full refund) | Optional |
| **E4** | CLASS E escalation (M1) — ledger imbalance → ExceptionQueue + freeze, NO repair | Seed ledger imbalance → finding created → ExceptionQueue entry → NO financial mutation | Optional |
| **E5** | Re-validation before repair — stale finding is skipped | Seed finding, then auto-resolve the underlying issue, then run remediation → remediation detects state is already correct → skips repair | Optional |
| **E6** | Repair idempotency — crash + retry does NOT cause second mutation | Run repair handler twice → second run is a no-op (conditional updateMany count=0) | Optional |
| **E7** | Gateway ambiguity = no repair + escalate | Seed stuck CAPTURE_PENDING + simulate gateway error → remediation aborts + escalates to ExceptionQueue, NO status mutation | Optional |
| **E8** | Post-repair verification — repair resolved the finding | After repair, re-run the specific detector → finding is no longer present → ReconciliationFinding marked resolved | Optional |

### 6.2 PostgreSQL-mandatory evidence (E9-E12)

| # | Evidence | What it proves | Mandatory on PostgreSQL? |
|---|----------|----------------|:------------------------:|
| **E9** | No money-state mutation for CLASS E (same as 5B-E4, but for remediation) | Run remediation against CLASS E findings → ZERO money-state mutation (only ExceptionQueue + freeze) | **✅ PostgreSQL mandatory** |
| **E10** | Concurrent remediation runs — no duplicate repairs | Two remediation workers process the same finding → exactly 1 repair (dedup via RemediationAction unique constraint) | **✅ PostgreSQL mandatory** |
| **E11** | Scale — 1000+ findings + mixed classes → correct remediation within SLA | Seed 1000 findings (mix of CLASS A/B/C/D/E) → correct classification + repair/escalation + runtime < SLA | **✅ PostgreSQL mandatory** |
| **E12** | Gateway-verified repair (M3/M9/M10) with REAL Razorpay test API (if authorized) | Use Razorpay test-mode API to verify gateway state → confirm repair is based on real gateway truth (not mock) | **✅ PostgreSQL mandatory** (requires `realPayments=true` in staging — separate authorization) |

### 6.3 Evidence principles

- **E9 is the CRITICAL SAFETY gate** (mirrors 5B-E4): for CLASS E mismatches, remediation must NOT mutate money state. This is the inverse of 5B's detection safety — 5C must prove it DOESN'T repair what it shouldn't.
- **E10 is the concurrency gate** (mirrors 5B-E5): two workers must not double-repair.
- **E11 is the scale gate** (mirrors 5B-E6): correct classification + repair at scale.
- **E12 is the gateway-truth gate**: the repair must be based on real gateway state, not a mock. This requires `realPayments=true` in staging — a separate Orchestrator authorization.
- **All evidence must use `EVIDENCE_TEST_MODE=true`** (same pattern as 5A/5B).

---

## 7. Rollback / Recovery Requirements

### 7.1 Per-repair rollback

Every repair handler MUST be reversible (or at least compensable):

| Class | Repair | Rollback |
|-------|--------|----------|
| M16 | Restart publisher | Stop publisher (operational — no financial rollback needed) |
| M3/M9 | Flip Payment CAPTURE_PENDING → CAPTURED | Flip back to CAPTURE_PENDING (conditional updateMany WHERE status=CAPTURED) — BUT only if gateway state also confirms this is wrong |
| M10 | Flip Refund REFUND_PENDING → REFUNDED + Payment CAPTURED → REFUNDED | Flip back — BUT only if gateway confirms the refund didn't actually happen |
| M2/M7 | Synthesize ledger entries | Reverse the synthesized entries (create compensating Dr/Cr pair) — this creates an audit trail of the reversal |
| M13 | Re-process webhook | Cannot un-process a webhook (the side-effect already happened). Idempotency dedup prevents re-processing. |

**Critical rule:** Rollback of a status mutation (M3/M9/M10) requires re-verifying the gateway state. You cannot blindly roll back a status flip — the gateway may have actually captured/refunded, and rolling back the DB status would re-create the original drift.

### 7.2 Schema rollback

If the 5C implementation adds `RemediationAction` + `RemediationRun` tables (Class-2 additive), rollback = drop those tables. No money-state data is lost.

### 7.3 Feature-flag rollback

The `reconciliationAutoRepair` flag defaults to OFF. If remediation causes problems, flip the flag back to OFF — all repair handlers stop. Existing findings remain in ReconciliationFinding + ExceptionQueue (no data loss).

---

## 8. Concurrency and Idempotency Requirements

### 8.1 Concurrency

| Requirement | Implementation |
|------------|----------------|
| Single-instance remediation worker | Use the same claim/lease pattern as the outbox publisher (CLAIMED status + claimUntil TTL). Two workers cannot process the same finding. |
| Conditional updates | All status mutations use `updateMany WHERE status=...` (optimistic locking via version field). A concurrent write by another path results in count=0 → skip. |
| No lock escalation | Remediation handlers do NOT take table-level locks. Row-level locks only (via conditional updateMany). |

### 8.2 Idempotency

| Requirement | Implementation |
|------------|----------------|
| Repair handler is idempotent | Re-running the handler against an already-repaired finding is a no-op (conditional updateMany count=0 + RemediationAction unique constraint dedup). |
| Gateway call is idempotent | The Razorpay API call (fetch payment/refund status) is a GET — idempotent by nature. |
| Finding resolution is atomic with repair | The ReconciliationFinding.resolvedAt is set INSIDE the same txn as the repair. If the repair commits but the worker crashes before marking the finding resolved, the next run re-validates (Principle 1) + finds the state already correct → marks the finding resolved ("stale — auto-resolved by external action"). |
| No duplicate side-effects | For CLASS C repairs that re-enqueue outbox events (M9/M10 retry), the publisher's idempotency checks (Payment.status === CAPTURED → skip; Refund.status === REFUNDED → skip) prevent duplicate capture/refund at the gateway. This is the existing Wave-4 4c / Wave-5 5a safety property — 5C inherits it. |

---

## 9. Risk Matrix

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| **R1** | Repair creates NEW drift (the repair itself is wrong) | MEDIUM | CRITICAL | Re-validation (SI-1) + post-repair verification (SI-8) + ledger balance check (SI-9). If post-repair verification fails, the repair is rolled back + the finding is escalated. |
| **R2** | Repair is not idempotent (crash + retry causes double mutation) | LOW | CRITICAL | Conditional updates (SI-4) + RemediationAction unique constraint (SI-6) + finding resolution atomic with repair (§8.2). |
| **R3** | Gateway ambiguity leads to wrong repair | MEDIUM | HIGH | Gateway ambiguity = no repair (SI-3). CLASS C handlers MUST escalate on ambiguity. |
| **R4** | CLASS E mismatch is accidentally repaired | LOW | CRITICAL | CLASS E handlers do NOT exist in code (SI-10). The classification logic routes CLASS E findings directly to ExceptionQueue + freeze. Code review enforces no CLASS E handler is ever added. |
| **R5** | Remediation worker processes stale finding | MEDIUM | LOW | Re-validation (SI-1) detects stale findings + skips repair. |
| **R6** | Two workers process the same finding | LOW | HIGH | Claim/lease pattern (SI-14) + RemediationAction unique constraint. |
| **R7** | Remediation re-opens a CLOSED wave's code path | LOW | HIGH | Repair handlers are NEW code (SI-13). They do NOT modify capture/refund/webhook/publisher routes. CLOSED wave code is immutable. |
| **R8** | `reconciliationAutoRepair` flag is accidentally enabled | LOW | HIGH | Flag defaults to OFF (SI-12). Enablement is a separate Orchestrator decision. Code review + deployment review enforces. |
| **R9** | Ledger synthesis (M2/M7) creates fabricated entries that don't match gateway reality | MEDIUM | HIGH | CLASS B handlers require gateway verification before synthesis (§3.2 Principle 3). Post-repair ledger balance check (SI-9). HIGH RISK — prefer operator review (recommend NOT authorizing M2/M7 in initial 5C). |
| **R10** | Audit chain repair (M17) destroys tamper evidence | N/A | N/A | M17 is CLASS E — NEVER repaired (SI-10). No handler exists. |

**Overall risk:** MEDIUM-HIGH. The highest risks are R1 (repair creates new drift) and R3 (gateway ambiguity). Both are mitigated by re-validation + post-repair verification + escalation on ambiguity. The risk is LOWER for CLASS A (operational only) and CLASS C (status mutation based on gateway truth). The risk is HIGHER for CLASS B (ledger synthesis — fabricating financial records).

---

## 10. Recommendation: CONDITIONAL GO

### 10.1 The condition

5C implementation is authorized **ONLY for the following mismatch classes** in the initial implementation:

| Class | Mismatch | Why authorized | Repair type |
|-------|----------|----------------|-------------|
| **CLASS A** | M16 (outbox lag) | Operational repair (restart publisher), NOT a financial mutation. Zero money-state risk. | Automatic (alert + optional restart) |
| **CLASS C** | M3 (missing capture status) | Status mutation based on gateway truth. No ledger mutation. Low risk IF gateway verification is solid. | Automatic IF `reconciliationAutoRepair=ON` + gateway confirms |
| **CLASS C** | M9 (stuck CAPTURE_PENDING) | Same as M3 — status mutation based on gateway truth. Publisher idempotency check prevents duplicate capture on retry. | Automatic IF `reconciliationAutoRepair=ON` + gateway confirms |
| **CLASS C** | M10 (stuck REFUND_PENDING) | Same pattern — status mutation based on gateway truth. 5A Option A semantics preserved (pending reservation becomes canonical on success). | Automatic IF `reconciliationAutoRepair=ON` + gateway confirms |

### 10.2 What is NOT authorized (even in the initial 5C implementation)

| Class | Mismatch | Why NOT authorized |
|-------|----------|---------------------|
| **CLASS B** | M2, M7, M13 | Ledger synthesis (M2/M7) is HIGH RISK (fabricating financial records). Webhook re-processing (M13) is lower risk but still requires careful state verification. Defer to a later 5C phase or operator review. |
| **CLASS D** | M11-FAILED, M12, M14 | Always quarantine + escalate. No automatic repair. |
| **CLASS E** | M1, M4, M5, M6, M8, M15, M17 | NEVER automatically repaired. Requires human/accounting/forensic review. |

### 10.3 Rationale

1. **Detection safety ≠ repair safety.** 5B proved we can detect drift. 5C must prove we can repair drift without creating new drift. The safest way to prove this is to start with the LOWEST-risk repairs (operational + gateway-verified status flips) and defer higher-risk repairs (ledger synthesis) until the low-risk path is proven in production.

2. **The majority of mismatch classes (10 of 17) should NOT be automatically repaired.** This is not a limitation of the detection layer — it's a fundamental property of financial systems. Some drift requires human judgment, and automating that judgment is dangerous.

3. **The `reconciliationAutoRepair` flag provides a kill switch.** Even after 5C implementation, the flag defaults to OFF. The Orchestrator can authorize enablement separately. If remediation causes problems, flip the flag back to OFF — all repair handlers stop.

4. **The initial 4-class scope (M16 + M3/M9/M10) covers the most operationally meaningful findings.** Stuck CAPTURE_PENDING/REFUND_PENDING (M9/M10) are the most likely real-world findings (publisher failures). M3 is a related status-flip. M16 is operational health. Together, these address the "publisher crashed / gateway drift" scenario that is the primary motivation for P0-03.

### 10.4 GO / CONDITIONAL GO / NO-GO

**CONDITIONAL GO.**

- **GO** would authorize all 17 classes for automatic remediation — UNSAFE (7 classes are CLASS E, 3 are CLASS D, 3 are CLASS B with ledger synthesis risk).
- **NO-GO** would leave all findings on detection-only — misses the operational value of auto-resolving stuck CAPTURE_PENDING/REFUND_PENDING (the most common real-world drift).
- **CONDITIONAL GO** authorizes the 4 safest classes (M16 + M3/M9/M10) + defers the rest. This is the safest path that delivers operational value.

---

## 11. Stop Point

This Gate Review is COMPLETE. The IDE is STOPPING.

- 5C READ/PLAN-FIRST Gate Review: ✅ COMPLETE.
- 5C implementation: 🔒 NOT YET AUTHORIZED.
- 5C financial mutation: 🔒 NOT AUTHORIZED.
- Production: 🚫 NOT AUTHORIZED.
- `realPayments` / `webhookHandler` / `requestHashEnforcement` / `reconciliationAutoRepair`: 🚫 ALL OFF.
- Wave-3/4/5A: ✅ CLOSED — immutable. 5C does not touch them.
- Wave-6 / Wave-7: 🔒 LOCKED.

**Next governance checkpoint:** Orchestrator decision on 5C implementation authorization. The Orchestrator may:
- (a) Authorize 5C implementation for the 4 CONDITIONAL GO classes (M16 + M3/M9/M10) per §10.1.
- (b) Modify the scope (e.g., add M13, remove M10).
- (c) Defer 5C entirely (keep all findings on detection + operator review).
- (d) Reject the plan and demand a different architecture.

**The IDE must NOT interpret a successful planning review as authorization for remediation implementation.** Implementation requires a separate explicit Orchestrator directive.

---

## 12. Per-Class Detailed Analysis (M1-M17)

This section provides the detailed per-class analysis that informs the classification in §2.

### M1 — LEDGER_IMBALANCE (CRITICAL) → CLASS E

**Detection:** Dr sum ≠ Cr sum per payment (I-06 violation).

**Root cause:** Should be impossible by atomicity (capture/refund routes write Dr/Cr pairs in the same txn). If it occurs: manual DB edit, storage corruption, or a bug in a CLOSED wave's atomic writes.

**Why CLASS E:** You cannot know WHICH entry is wrong. If Dr=6500 and Cr=5000, is the extra Dr a duplicate (should be removed) or is the Cr missing (should be added)? Adding a "balancing" entry is fabricating accounting records without knowing the truth. Removing an entry could break the other side's balance. This requires forensic accounting review — the break itself is evidence of corruption that must be investigated, not "fixed" by an algorithm.

**Repair:** NONE (automatic). Freeze + ExceptionQueue + forensic alert.

### M2 — MISSING_CAPTURE_LEDGER (CRITICAL) → CLASS B

**Detection:** Payment.status='CAPTURED' but no Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE pair.

**Root cause:** Should be impossible by atomicity (capture route writes Payment + LedgerEntry in the same txn). If it occurs: partial commit (impossible), manual DB edit, or storage corruption.

**Why CLASS B:** You COULD synthesize the missing Dr/Cr pair IF you know the capture amount + account types (which you do — Payment.amount is known). But this is retroactively creating financial records. You MUST verify the gateway actually captured first (CLASS C element) AND verify no other ledger entries exist for this payment (to avoid creating a duplicate). HIGH RISK — recommend deferring to operator review in the initial 5C. If authorized later, the handler must: (1) verify gateway captured, (2) verify no existing ledger entries, (3) synthesize Dr/Cr pair inside a txn, (4) write AuditLog (RECONCILIATION_REPAIR_M2_SYNTHESIZE_LEDGER), (5) post-repair ledger balance check.

**Repair (if authorized):** Synthesize Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE = Payment.amount, inside a txn with AuditLog.

### M3 — MISSING_CAPTURE_STATUS (HIGH) → CLASS C

**Detection:** Payment has capture ledger pair but status still CAPTURE_PENDING past publisher retry window.

**Root cause:** The capture txn committed (Payment + ledger + outbox written), but the publisher failed to flip Payment.status to CAPTURED (publisher crash, gateway error, or exhausted retries).

**Why CLASS C:** The repair is a STATUS mutation (CAPTURE_PENDING → CAPTURED), NOT a ledger mutation. This is lower risk than ledger synthesis. BUT you MUST verify the gateway actually captured before flipping the status. If the gateway says "not captured," the repair is wrong (the payment should NOT be CAPTURED). If the gateway is ambiguous, escalate.

**Repair:** Call Razorpay API to verify capture. If confirmed → `Payment.updateMany WHERE status=CAPTURE_PENDING, version=X → status=CAPTURED, capturedAt=now, version=version+1`. If gateway says not captured → escalate (the capture may need to be retried, not the status flipped). If ambiguous → abort + retry later.

### M4 — DUPLICATE_CAPTURE_LEDGER (CRITICAL) → CLASS E

**Detection:** More than 1 Dr GATEWAY_RECEIVABLE per payment.

**Root cause:** I-04 violation. Should be impossible (capture route writes exactly 1 Dr per payment). If it occurs: retry-invariant violation (the hazard that TRANSACTION_RETRY_INVARIANT was designed to prevent), manual DB edit, or a bug.

**Why CLASS E:** You cannot know which Dr entry is authoritative. Removing the "wrong" one could break the Dr/Cr balance (if the Cr was written to match one specific Dr). This requires accounting review to determine which entry is the duplicate + whether the corresponding Cr needs adjustment.

**Repair:** NONE (automatic). Freeze + ExceptionQueue + forensic alert.

### M5 — DUPLICATE_REFUND_PER_KEY (CRITICAL) → CLASS E

**Detection:** More than 1 Refund per payment+idempotencyKey.

**Root cause:** Schema unique constraint on `Refund.idempotencyKey` should prevent this. If it occurs: schema drift (constraint was dropped) or manual DB edit.

**Why CLASS E:** Both refunds may have been processed at the gateway. You cannot know which is "real" without checking gateway state for each. Even then, removing a refund record doesn't un-refund the customer at the gateway. This requires manual review of gateway state + accounting adjustment.

**Repair:** NONE (automatic). Freeze + ExceptionQueue + alert.

### M6 — REFUND_EXCEEDS_PAYMENT (HIGH) → CLASS E

**Detection:** Sum of refund amounts > Payment.amount.

**Root cause:** Refund route validation gap — the route checks `refundAmount > payment.amount` for a single refund, but does NOT check the cumulative total of all refunds. If multiple partial refunds are processed, they could sum past the payment amount.

**Why CLASS E:** The money has already been returned to the customer. You cannot "un-refund" a real gateway refund. The damage is done. "Repair" = accounting adjustment (recognize the over-refund as a loss) + operator review to fix the validation gap in the refund route (a CLOSED-wave code change — separate authorization).

**Repair:** NONE (automatic). Freeze + ExceptionQueue + alert. The validation gap should be fixed in the refund route (Wave-5A code — requires separate authorization to modify a CLOSED wave).

### M7 — REFUND_WITHOUT_REVERSAL_LEDGER (HIGH) → CLASS B

**Detection:** Refund.status='REFUNDED' but no matching reversal Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE pair with amount === Refund.amount.

**Root cause:** Should be impossible by atomicity (refund route writes Refund + reversal Dr/Cr in the same txn). If it occurs: partial commit, manual DB edit, or storage corruption.

**Why CLASS B:** You COULD synthesize the missing reversal Dr/Cr pair. But this is fabricating ledger entries. You MUST verify the gateway actually refunded first. HIGH RISK — recommend deferring to operator review in the initial 5C. Same pattern as M2.

**Repair (if authorized):** Verify gateway refunded. Synthesize Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE = Refund.amount, inside a txn with AuditLog. Post-repair ledger balance check.

### M8 — REVERSAL_WITHOUT_REFUND (HIGH) → CLASS E

**Detection:** Reversal Dr CONSUMER_REVENUE entries exist for a payment but no Refund row.

**Root cause:** Should be impossible by atomicity (reversal Dr/Cr is written in the same txn as the Refund row). If it occurs: partial commit, manual DB edit, or storage corruption.

**Why CLASS E:** Two possible repairs: (a) create a Refund row matching the reversal entries, or (b) remove the reversal entries. Both are dangerous. You cannot know which is correct without external context (did a refund actually happen at the gateway?). This requires manual review.

**Repair:** NONE (automatic). Freeze + ExceptionQueue + alert.

### M9 — STUCK_CAPTURE_PENDING (HIGH) → CLASS C

**Detection:** Payment.status='CAPTURE_PENDING' older than 30 min + outbox not PENDING/CLAIMED (publisher exhausted or FAILED).

**Root cause:** The publisher's capture handler failed to flip the Payment status. Either the gateway call failed (and the publisher exhausted retries), or the publisher crashed.

**Why CLASS C:** The repair depends on gateway state:
- If gateway confirms capture → flip Payment.status to CAPTURED (same as M3).
- If gateway says not captured → re-enqueue the outbox event (publisher will retry capture — idempotency check prevents duplicate capture).
- If gateway is ambiguous → escalate.

**Repair:** Call Razorpay API. If captured → conditional updateMany to CAPTURED. If not captured → re-enqueue outbox (or mark outbox PENDING for publisher retry). If ambiguous → abort + escalate.

**5A Option A interaction:** N/A (this is a capture flow, not a refund flow).

### M10 — STUCK_REFUND_PENDING (HIGH) → CLASS C

**Detection:** Refund.status='REFUND_PENDING' older than 30 min + outbox not PENDING/CLAIMED.

**Root cause:** The publisher's refund handler failed to flip the Refund status.

**Why CLASS C:** Same pattern as M9 but for refunds:
- If gateway confirms refund → flip Refund to REFUNDED + (if full refund) Payment to REFUNDED.
- If gateway says not refunded → re-enqueue outbox (publisher retries refund — idempotency check prevents duplicate refund).
- If gateway is ambiguous → escalate.

**5A Option A interaction:** The 5A pending ledger reservation (reversal Dr/Cr written at REFUND_PENDING time) persists. If the refund succeeds on retry, the reservation becomes canonical (NO new ledger entries — the existing reversal pair becomes the settled record). If the refund is permanently FAILED, the reservation must be manually resolved (the reversal entries sit as a pending reservation with no corresponding refund — this becomes an M8 finding, which is CLASS E). So the FAILED path of M10 escalates to CLASS E.

**Repair:** Call Razorpay API. If refunded → conditional updateMany to REFUNDED. If not refunded → re-enqueue outbox. If ambiguous → abort + escalate. If permanently FAILED → escalate (CLASS E for the FAILED path — manual resolution of the pending reservation).

### M11 — ORPHAN_OUTBOX (HIGH) → CLASS D (FAILED) / CLASS B (PENDING/CLAIMED)

**Detection:** Outbox PENDING/CLAIMED past TTL or FAILED.

**Root cause:** Publisher crashed (CLAIMED past lease), publisher stalled (PENDING past TTL), or publisher exhausted retries (FAILED).

**Why split classification:**
- **PENDING/CLAIMED past TTL (CLASS B):** The event was never delivered. Re-claiming + retrying is the natural repair. BUT retrying risks duplicate side-effects (capture/refund at the gateway). The publisher's idempotency checks (Payment.status === CAPTURED → skip; Refund.status === REFUNDED → skip) protect against this. Repair = re-mark as PENDING (publisher will pick it up).
- **FAILED (CLASS D):** The event exhausted all retries. The underlying issue (gateway error, malformed payload, missing aggregate) may still exist. Re-enqueueing will likely fail again. Manual review is needed to determine the root cause + whether to re-enqueue, discard, or escalate.

**Repair (PENDING/CLAIMED):** Re-mark outbox row as PENDING (publisher will retry). Idempotency checks protect against duplicates.

**Repair (FAILED):** NONE (automatic). Quarantine + ExceptionQueue + alert.

### M12 — ORPHAN_OUTBOX_AGGREGATE_MISSING (CRITICAL) → CLASS D

**Detection:** Outbox references Payment/Refund that doesn't exist.

**Root cause:** Impossible by atomicity (outbox + business row commit in the same txn). If it occurs: manual DB delete of the Payment/Refund row.

**Why CLASS D:** The outbox event is orphaned — there's no aggregate to deliver it to. You cannot "repair" the missing aggregate (creating a Payment from an outbox event alone is impossible — the outbox payload doesn't have enough information). The outbox event is evidence of corruption. Quarantine + manual review.

**Repair:** NONE (automatic). Quarantine (mark outbox as QUARANTINED — new status) + ExceptionQueue + alert. Do NOT delete the outbox row (preserve audit trail).

### M13 — UNPROCESSED_WEBHOOK (MEDIUM) → CLASS B

**Detection:** WebhookEvent.verified=true but processed=false past threshold.

**Root cause:** Webhook handler crashed mid-processing (after creating WebhookEvent but before setting processed=true).

**Why CLASS B:** Re-processing the webhook is safe IF the webhook handler's idempotency holds (eventId unique constraint dedups — if the webhook was partially processed, re-processing will either complete it or be a no-op). BUT you must verify the current Payment state before applying — the Payment may have been updated by another path (publisher, another webhook, a manual admin action) since the webhook was received.

**Repair:** Re-process the webhook via `processWebhookEvent()`. The existing idempotency (eventId dedup + conditional updateMany WHERE status=...) protects against duplicates. Must verify current state before applying.

### M14 — WEBHOOK_MISSING_PAYMENT (MEDIUM) → CLASS D

**Detection:** WebhookEvent references a Payment that doesn't exist.

**Root cause:** Stale webhook (payment was deleted), race (webhook arrived before the Payment was created), or wrong-payment webhook (gateway sent us a webhook for a payment that's not ours).

**Why CLASS D:** You cannot create a Payment from a webhook alone (the webhook payload doesn't have the order, user, amount, etc. in a trustable form). Quarantine the webhook + manual review.

**Repair:** NONE (automatic). Quarantine + ExceptionQueue + alert.

### M15 — STATUS_LEDGER_INCONSISTENCY (HIGH) → CLASS E

**Detection:** Payment.status='REFUNDED' but refunds don't sum to Payment.amount.

**Root cause:** Either the status is wrong (should be CAPTURED or PARTIALLY_REFUNDED) or the refund records are wrong (missing a refund, or a refund amount is wrong).

**Why CLASS E:** You cannot know whether the status or the refund records are authoritative. Changing the status without verifying gateway state is dangerous. Changing the refund records without verifying gateway state is fabricating financial records. This requires accounting review + gateway verification.

**Repair:** NONE (automatic). Freeze + ExceptionQueue + alert.

### M16 — OUTBOX_LAG_EXCEEDED (MEDIUM) → CLASS A

**Detection:** Oldest PENDING outbox event > 5 min SLA.

**Root cause:** Publisher is stalled, crashed, or under-scaled.

**Why CLASS A:** The "repair" is NOT a financial mutation — it's an operational action (restart the publisher mini-service, scale up). No Payment/Refund/LedgerEntry/Outbox/WebhookEvent/IdempotencyKey/AuditLog mutation. This is the only mismatch class where automatic "repair" (operational, not financial) is unconditionally safe.

**Repair:** Alert + (optionally) trigger publisher restart via the publisher's health-check endpoint. No financial mutation.

### M17 — AUDIT_CHAIN_BREAK (MEDIUM) → CLASS E

**Detection:** AuditLog hash-chain broken (prevHash mismatch or hash recomputation failure).

**Root cause:** Manual DB edit of an AuditLog entry, storage corruption, or a bug in the hash-chain computation.

**Why CLASS E:** The break IS the evidence. "Repairing" the chain (recomputing hashes to make them match) would DESTROY the tamper evidence. This is a forensic/security issue — the break must be investigated to determine whether it's corruption (accidental) or tampering (intentional). NEVER auto-repair.

**Repair:** NONE (automatic). Freeze + ExceptionQueue + forensic/security alert.

---

## 13. D1–D12 Decision Summary (mirrors the 5B Gate Review structure)

| Gate | Decision |
|------|----------|
| **D1 — Scope** | Repair only the mismatch classes where a deterministic, idempotent, independently verifiable repair path can be proven. Initially: M16 + M3/M9/M10 (4 classes). The rest remain detection + operator review. |
| **D2 — Current State** | 5B detection is COMPLETE (17 classes, SQLite + PostgreSQL PASS). No remediation code exists. The `reconciliation-mismatch` alert rule is active. ExceptionQueue routing is active for CRITICAL/HIGH findings. |
| **D3 — Source of Truth** | Gateway truth (Razorpay) is authoritative for CLASS C repairs. DB state is authoritative for CLASS B repairs (after re-validation). For CLASS E, there is no single source of truth — human judgment is required. |
| **D4 — Repair Classes** | 5 classes: A (safe deterministic), B (state verification), C (gateway verification), D (human authorization), E (do not repair). 17 mismatch classes mapped to these 5 categories. |
| **D5 — Idempotency** | Repair idempotency via: (1) conditional updateMany (status already target → skip), (2) RemediationAction unique constraint, (3) finding resolution atomic with repair. |
| **D6 — Remediation Boundary** | 5C implements repair handlers ONLY for authorized classes (initially M16 + M3/M9/M10). CLASS D/E are escalated, never repaired. CLASS B is deferred to a later phase. |
| **D7 — Transaction Safety** | All repairs use conditional updates (optimistic locking). External gateway calls OUTSIDE txn body (TRANSACTION_RETRY_INVARIANT). Post-repair verification re-runs the detector. |
| **D8 — Evidence** | 12 E-scenarios (E1-E12). E9 (no money-state mutation for CLASS E) + E10 (concurrency) + E11 (scale) + E12 (gateway truth) are PostgreSQL-mandatory. |
| **D9 — Existing Waves** | NO impact on Wave-3/4/5A CLOSED invariants. Repair handlers are NEW code paths, not modifications to CLOSED routes. CLOSED wave code is immutable. |
| **D10 — Schema** | Optional Class-2 additive: `RemediationAction` + `RemediationRun` tables. No existing model modified. Separate authorization required. |
| **D11 — Production Impact** | 5C implementation is NOT a production blocker. Detection-only (5B) is sufficient for launch (operators manually resolve findings). 5C adds operational automation but is not launch-mandatory. |
| **D12 — Recommendation** | **CONDITIONAL GO.** Authorize implementation for M16 + M3/M9/M10 only. Defer M2/M7/M13 (CLASS B) + all CLASS D/E. Feature-flagged (`reconciliationAutoRepair`, default OFF). |

---

**End of Gate Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `realPayments` OFF. `webhookHandler` OFF. `requestHashEnforcement` OFF. `reconciliationAutoRepair` does not exist yet (would default to OFF). Wave-3/4/5A CLOSED — immutable. Wave-6/7 LOCKED.**

**STOP. Awaiting Orchestrator decision on 5C implementation authorization.**
