# Wave-5 Sub-Wave 5B — P0-03 Reconciliation: S5 PASS / CLOSED

**Document type:** Gate Review (READ/PLAN-FIRST → IMPLEMENTATION → S5 PASS / CLOSED).
**Author:** IDE (read-only synthesis from repository evidence).
**Orchestrator directive:** Sub-Wave 5B S5 PASS / CLOSED (Directive ID: `S5-5B-P0-03-CLOSE`, 2026-08-16). Closure applies ONLY to the detection-only P0-03 reconciliation scope. Remediation (5C) remains a separate authorization boundary.
**Created:** 2026-08-16
**Scope:** P0-03 — Payment reconciliation (gateway ↔ ledger).

> **S5 Closure (Orchestrator Directive `S5-5B-P0-03-CLOSE`):** This Gate Review was originally READ/PLAN-FIRST (no implementation). The Orchestrator subsequently authorized implementation (detection-only model per §7.1). Implementation COMPLETE + SQLite evidence E1-E6 PASS (6/6) + PostgreSQL evidence E1-E6 PASS (6/6) on staging Supabase. Orchestrator issued `S5 PASS / CLOSED` directive on 2026-08-16. The closure applies ONLY to the detection-only scope — remediation, financial repair, and production deployment remain explicitly unauthorized. See `WAVE5_EVIDENCE.md` §5 + §6 + §7 for the full implementation + evidence + closure record.

> **Orchestrator constraint honored:** P0-03's automatic financial correction is NOT self-authorized. The review explicitly separates detection (read-only) from remediation (mutation), and flags any remediation path as a separate authorization boundary (see D6, D7, §7).

---

## 0. Executive Summary

| Field | Value |
|-------|-------|
| **Sub-Wave** | 5B — P0-03 Reconciliation |
| **Authorization level** | READ/PLAN-FIRST ONLY |
| **Implementation authorized?** | ❌ NO — separate Orchestrator directive required |
| **Recommendation** | **CONDITIONAL GO** (read-only detection model first; remediation deferred to a separate sub-wave or Orchestrator directive) |
| **Schema impact** | NONE required for detection; optional Class-2 additive `ReconciliationRun` + `ReconciliationFinding` models recommended for audit trail (see D10) |
| **Production impact** | NONE — 5B does not touch production. `realPayments`, `webhookHandler`, `requestHashEnforcement` remain OFF. |
| **Impact on CLOSED waves** | NONE — Wave-3/4/5A invariants are preserved. Reconciliation is a read-only observer of their state (see D9) |
| **Root cause being addressed** | Gateway ↔ DB drift has no automatic detection. The known real-mode hazard (`TRANSACTION_RETRY_INVARIANT.md` §4.2 — capture succeeded at gateway but DB write failed) has no recovery path today. Stuck `REFUND_PENDING` refunds + orphan ledger reservations (per the Option A semantics closed in 5A) have no surfacing mechanism today. |
| **Proposed architecture** | Read-only reconciliation job (mini-service or cron route) that computes invariants from existing tables and writes findings to a new Class-2 additive `ReconciliationFinding` table. NO ledger mutations. NO Payment/Refund status changes. NO outbox events. NO external calls. (see §5) |
| **Proposed evidence matrix** | 6 E-scenarios (E1-E6). E1-E4 SQLite; E4-E6 PostgreSQL mandatory (concurrency + scale). (see D8, §6) |

**One-line recommendation:** Implement a **read-only detection reconciliation job first**. Treat any automatic repair as a **separate authorization boundary** (likely a 5C sub-wave or an Orchestrator directive). This keeps the 5B scope small, avoids touching CLOSED invariants, and gives the Orchestrator a clean decision point on whether/when to authorize remediation.

---

## 1. Current-State Findings

### 1.1 What exists today (read from repository)

| Component | Location | Relevance to P0-03 |
|-----------|----------|---------------------|
| Payment model (lifecycle states) | `prisma/schema.prisma:356-398` | Source of truth for payment state. Statuses: `PAYMENT_PENDING`, `CAPTURE_PENDING`, `CAPTURED`, `FAILED`, `REFUNDED`, `FROZEN`. |
| LedgerEntry model (double-entry, append-only) | `prisma/schema.prisma:403-418` | Source of truth for ledger. `entryType` (DEBIT/CREDIT), `accountType` (GATEWAY_RECEIVABLE / CONSUMER_REVENUE / VENDOR_PAYOUT / COMMISSION_REVENUE / GATEWAY_FEE_EXPENSE), `amount`, `paymentId` FK. **No `refundId` FK** — reversal entries are attached to `paymentId` only (5A Option A semantics). |
| Refund model | `prisma/schema.prisma:466-492` | Source of truth for refund state. Statuses: `REFUND_PENDING`, `REFUNDED`, `FAILED`. `gatewayRefundId`, `failureReason`, `version`. |
| Outbox model | `prisma/schema.prisma:294-326` | Source of truth for in-flight events. Statuses: `PENDING`, `CLAIMED`, `PUBLISHED`, `FAILED`. `attempts`, `lastError`, `claimUntil`, `workerId`. |
| WebhookEvent model | `prisma/schema.prisma:424-443` | Source of truth for gateway-side events. `eventId` unique (dedup), `verified`, `processed`, `processedAt`, `processedBy`, `processingNotes`. |
| IdempotencyKey model | `prisma/schema.prisma:213-230` | Source of truth for write dedup. `resourceType` (Order/Payment/Refund), `resourceId`, `requestHash`, `expiresAt`. |
| ExceptionQueue model | `prisma/schema.prisma:246-269` | P0-28 freeze + evidence store. `invariant`, `entityType`, `entityId`, `freezeLevel`, `stateSnapshot`, `resolvedAt`. **Reconciliation can write here** (read-only detection → freeze + evidence). |
| AuditLog model (hash-chained) | `prisma/schema.prisma:174-187` | Tamper-evidence chain (`prevHash` / `hash`). Reconciliation runs should NOT write audit logs unless they produce a finding (then they go through `reportInvariantViolation()` which writes its own evidence chain). |
| Capture route | `src/app/api/payments/route.ts` | Mutates: Payment, Order, LedgerEntry (Dr/Cr), AuditLog, Outbox, IdempotencyKey — all atomic in one txn. |
| Refund route | `src/app/api/payments/refund/route.ts` | Mutates: Refund, LedgerEntry (reversal Dr/Cr), AuditLog, Outbox, IdempotencyKey — all atomic in one txn. |
| Webhook handler | `src/app/api/webhooks/razorpay/route.ts` + `src/lib/webhook-processor.ts` | Mutates: WebhookEvent, Payment (CAPTURED/FAILED via conditional updateMany), AuditLog, Outbox (`PAYMENT_CAPTURE_CONFIRMED`). Idempotent via `eventId` unique. |
| Outbox publisher | `mini-services/outbox-publisher/index.ts` | Mutates: Payment (CAPTURED via conditional updateMany), Refund (REFUNDED via conditional updateMany), AuditLog, Outbox (PUBLISHED). External calls (`captureRazorpayPayment`, `refundRazorpayPayment`) OUTSIDE any txn body. Has `/lag` endpoint for outbox lag (oldest PENDING event age). |
| Invariant checker (P0-28) | `src/lib/invariant-checker.ts` | `reportInvariantViolation()` — writes ExceptionQueue + applies freeze (Level 1/2/3). **Reconciliation should route findings through this** (not write ExceptionQueue directly). |
| Alerting rules | `src/lib/alerting.ts` | Already has a `reconciliation-mismatch` alert rule (metric `reconciliation_mismatch_count`, threshold 0, severity critical). Alert evaluator exists in mini-service. |
| Evidence-verify route | `src/app/api/payments/evidence-verify/route.ts` | DEV-only ledger state inspector. **Contains the exact SQL pattern reconciliation will need** (LedgerEntry Dr/Cr counts + sums per payment). Can be a code reference for the detection queries. |

### 1.2 What is MISSING (the gap P0-03 must close)

| Gap | Impact today | What 5B must add |
|-----|--------------|------------------|
| **No scheduled reconciliation job.** No cron route, no mini-service, no `/api/reconciliation/*` endpoint. | Gateway ↔ DB drift undetected indefinitely. The known real-mode hazard (capture succeeded at gateway, DB write failed) has no automatic surfacing. Stuck `REFUND_PENDING` refunds + their pending ledger reservations (5A Option A) persist silently. | A reconciliation runner (mini-service on its own port, OR a cron-triggered route, OR a manual `/api/reconciliation/run` endpoint gated by `EVIDENCE_TEST_MODE` for evidence). |
| **No mismatch-detection logic.** No code computes "Dr sum === Cr sum per payment", "CAPTURED payment has exactly 1 Dr + 1 Cr", "REFUNDED payment's Refund rows sum to Payment.amount", "Outbox PENDING age > threshold", "Refund REFUND_PENDING age > threshold". | The 5A Option A pending-reservation entries (reversal Dr/Cr written at `REFUND_PENDING` time) have no surfacing path if the publisher permanently fails. They sit as silent accounting reservations. | Detection queries that compute these invariants and emit findings. |
| **No reconciliation report / audit trail.** No `ReconciliationRun` or `ReconciliationFinding` table. | Reconciliation runs are not auditable. Operators cannot see "when did we last reconcile? what did we find?". | Optional Class-2 additive models (see D10) for run + finding records. |
| **No operator surfacing.** No admin UI, no alert routing for "stuck refund" / "orphan ledger" / "gateway-DB drift". | The existing `reconciliation-mismatch` alert rule (alerting.ts:36) fires on a metric (`reconciliation_mismatch_count`) that is **never emitted today**. | The reconciliation job must emit `reconciliation_mismatch_count` (and per-class sub-metrics) so the existing alert rule activates. |
| **No integration with P0-28 exception queue.** Reconciliation findings do NOT currently route through `reportInvariantViolation()`. | Findings have no freeze/evidence path. | Reconciliation should call `reportInvariantViolation()` for high-severity findings (Level 1 freeze on the affected Payment). |

### 1.3 What is CLOSED and must NOT be reopened

Per the Orchestrator's directive, these waves are immutable. 5B must NOT modify their evidence, code paths, or invariants:

```text
Wave-3        ✅ CLOSED  (P0-01 capture, P0-08 order idempotency, 3c requestHash)
Wave-4        ✅ CLOSED  (P0-05 webhook, P0-02 ledger, 4c retry invariant, 4d orphan_business_count)
Wave-5A       ✅ CLOSED  (P0-04 refund + Option A pending ledger semantics)
```

5B is a **read-only observer** of these systems. The CLOSED invariants (I-01 Payment Integrity, I-04 Capture Uniqueness, I-06 Ledger Balance, I-07 Audit Integrity, the TRANSACTION_RETRY_INVARIANT) must all remain intact. 5B does not write to Payment, LedgerEntry, Refund, Outbox, WebhookEvent, or IdempotencyKey — it only reads them.

---

## 2. The D1–D12 Gate Review

### D1 — Scope

**Question:** What is the actual problem P0-03 Reconciliation must solve, and what is the expected outcome?

**Answer:**

P0-03 is a **Direct Protector** of invariants **I-01 (Payment Integrity)** and **I-06 (Ledger Balance)** per `P0_TRACEABILITY_MAP.md:40,75,80`. Its job is to detect — on a recurring schedule — any drift between the three sources of truth that together define "money state":

1. **Gateway source of truth** (Razorpay's view of a payment: captured / failed / refunded).
2. **Database source of truth** (`Payment.status`, `Refund.status`, `LedgerEntry` Dr/Cr pairs).
3. **Event source of truth** (`Outbox` PENDING/CLAIMED/PUBLISHED/FAILED, `WebhookEvent` processed/unprocessed).

When these three disagree, money state is inconsistent. P0-03's job is to **detect and surface** the disagreement, not (in this sub-wave) to repair it.

**Concrete mismatch classes 5B must detect** (enumerated in D4): missing capture, missing ledger, duplicate ledger, amount mismatch, status mismatch, stuck `CAPTURE_PENDING`, stuck `REFUND_PENDING`, orphan Outbox (PENDING/CLAIMED past TTL or FAILED), orphan WebhookEvent (unprocessed past threshold), ledger imbalance (Dr ≠ Cr), refund-total-exceeds-payment, and the 5A-specific "pending reservation that never became canonical" (publisher exhausted retries on a refund).

**Expected outcome of 5B (read-only model):**
- A reconciliation job runs on a schedule (cron or mini-service poll).
- It computes the invariant checks against the database (no external calls — see D3).
- It writes findings to a new `ReconciliationFinding` table (Class-2 additive, see D10).
- High-severity findings route through `reportInvariantViolation()` → ExceptionQueue + freeze (existing P0-28 path).
- It emits the `reconciliation_mismatch_count` metric (activating the existing alert rule).
- It does NOT mutate any money-state row.

**What 5B explicitly does NOT do (deferred to a separate remediation boundary):**
- Does NOT create/reverse ledger entries.
- Does NOT change Payment.status / Refund.status.
- Does NOT trigger capture/refund.
- Does NOT enqueue outbox events.
- Does NOT make external Razorpay API calls.

### D2 — Current State

**Question:** What exists in reconciliation today, and what is missing?

**Answer:** See §1.2 above. Summary:

| Component | Exists? | Notes |
|-----------|---------|-------|
| Reconciliation job / cron / mini-service | ❌ NO | Not in repo. |
| Mismatch-detection SQL / logic | ❌ NO | Not in repo. (But the **query pattern** exists in `src/app/api/payments/evidence-verify/route.ts:73-81` — LedgerEntry Dr/Cr counts + sums per payment. This is the exact pattern reconciliation needs.) |
| Reconciliation report / finding table | ❌ NO | Not in schema. |
| `reconciliation-mismatch` alert rule | ✅ YES | `src/lib/alerting.ts:36-43` — but fires on a metric that is never emitted today. |
| Integration with P0-28 exception queue | ❌ NO | `reportInvariantViolation()` exists but is never called from a reconciliation path. |
| Outbox lag endpoint | ✅ YES | `mini-services/outbox-publisher/index.ts:951-968` — `/lag` returns oldest PENDING event age. **Reconciliation can read this directly** (no new code needed for outbox-lag detection). |
| Post-restore reconciliation procedure | ✅ YES (design only) | `docs/DR_RUNBOOK.md` — documented procedure, not exercised. (P0-26 partial.) |

### D3 — Accounting Source of Truth

**Question:** Among Payment, LedgerEntry, Outbox, and Razorpay state, what is canonical?

**Answer:**

The canonical source of truth is **layered**, and 5B must respect this layering:

| Source | Canonical for | Authority |
|--------|---------------|-----------|
| **Razorpay gateway** | "Did money actually move?" | External, authoritative for cash事实. A capture confirmed by Razorpay's API/webhook is the ground truth that the customer was charged. A refund confirmed by Razorpay is the ground truth that money was returned. |
| **`Payment.status` + `Refund.status`** | "What does our system believe about this payment?" | Authoritative for DB-side state. Set by the capture route (CAPTURE_PENDING), the publisher (CAPTURED / REFUNDED), and the webhook handler (CAPTURED / FAILED). |
| **`LedgerEntry` Dr/Cr pairs** | "What is the accounting record?" | Authoritative for the ledger. Append-only. I-06 (Dr sum === Cr sum per payment) must hold at all times (5A Option A: pending reservation + canonical settlement). |
| **`Outbox`** | "What business events are in-flight?" | Authoritative for pending side-effects. PENDING/CLAIMED = publisher owes an external call. PUBLISHED = delivered. FAILED = publisher exhausted retries → manual intervention. |
| **`WebhookEvent`** | "What did the gateway tell us?" | Authoritative for gateway-side confirmations. `verified` + `processed` flags track the lifecycle. |

**The reconciliation contract:**

1. **`LedgerEntry` is the accounting ground truth inside the DB.** If Dr ≠ Cr for a payment, the ledger is broken — that is a finding, no matter what `Payment.status` says. (I-06 is the invariant P0-03 protects.)
2. **`Payment.status` is the DB-side business state.** It must be consistent with the ledger (e.g., CAPTURED ⇒ exactly 1 Dr + 1 Cr capture pair; REFUNDED ⇒ additional reversal pair summing to the refund amount).
3. **`Outbox` is the pending-side-effect truth.** A PENDING `PAYMENT_CAPTURE_REQUESTED` older than the publisher's max-retry window means the capture may not have happened at the gateway — that is a finding.
4. **`WebhookEvent` is the gateway-confirmation truth.** An unprocessed `payment.captured` webhook older than threshold means gateway-confirmed capture may not have been recorded — that is a finding.
5. **Razorpay itself is the external ground truth.** 5B does NOT call Razorpay directly in its initial detection pass (see D6). If 5B detects a DB-side inconsistency that suggests gateway drift, it raises a finding flagged for "manual gateway reconciliation" — a human (or a future authorized remediation sub-wave) calls Razorpay's API to confirm.

**Why this layering matters:** 5B must NOT treat any single source as the "winner." It must compute the **consistency relationships between them** and surface any disagreement as a finding. The reconciliation job's output is "here are the disagreements," not "here is the corrected state."

### D4 — Mismatch Classes

**Question:** Which mismatches must be detected — missing capture, missing ledger, duplicate, amount mismatch, status mismatch, etc.?

**Answer:** The 5B detection model must cover the following classes. Each is listed with its detection query (DB-only, no external calls) and severity.

| # | Mismatch class | Detection query (DB-only) | Severity | Example |
|---|----------------|---------------------------|----------|---------|
| **M1** | Ledger imbalance (I-06 violation) | `SELECT paymentId, SUM(amount) FILTER (WHERE entryType='DEBIT') AS dr, SUM(amount) FILTER (WHERE entryType='CREDIT') AS cr FROM LedgerEntry GROUP BY paymentId HAVING dr <> cr` | **CRITICAL** (I-06) | Payment has Dr=64000, Cr=32000 — ledger broken. |
| **M2** | Missing capture ledger pair | `Payment.status='CAPTURED'` but `LedgerEntry` count for paymentId < 2 (or Dr GATEWAY_RECEIVABLE missing, or Cr CONSUMER_REVENUE missing) | **CRITICAL** (I-01) | Payment CAPTURED but no ledger entries (impossible by atomicity — would indicate a schema-level corruption). |
| **M3** | Missing capture status (ledger has capture pair but Payment not CAPTURED) | `LedgerEntry` has Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE for paymentId, but `Payment.status` is still `CAPTURE_PENDING` after publisher max-retry window | **HIGH** | Publisher failed to flip Payment to CAPTURED after capture succeeded at gateway (the §4.2 hazard in TRANSACTION_RETRY_INVARIANT.md). |
| **M4** | Duplicate capture ledger pair | `COUNT(LedgerEntry WHERE entryType='DEBIT' AND accountType='GATEWAY_RECEIVABLE' AND paymentId=X) > 1` | **CRITICAL** (I-04) | Would indicate a retry-invariant violation slipped through (should be impossible after 4c, but reconciliation catches it if it ever happens). |
| **M5** | Duplicate Refund record per payment+idempotencyKey | `COUNT(Refund WHERE paymentId=X AND idempotencyKey=Y) > 1` (should be impossible — `idempotencyKey` is `@unique`) | **CRITICAL** (I-04) | Schema-enforced; reconciliation catches if the unique constraint was ever dropped. |
| **M6** | Refund total exceeds payment amount | `SELECT paymentId, Payment.amount, SUM(Refund.amount) AS refund_total ... HAVING refund_total > Payment.amount` | **HIGH** (I-03) | Partial refunds summing past the original capture (would indicate a refund-route validation gap). |
| **M7** | Refund has no reversal ledger pair | `Refund.status='REFUNDED'` but no matching reversal Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE for that paymentId with amount === Refund.amount | **HIGH** (I-03 / I-06) | Refund marked REFUNDED but ledger entries missing (impossible by atomicity — would indicate corruption). |
| **M8** | Refund reversal pair without matching Refund row | `LedgerEntry` has Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE for paymentId, but no `Refund` row for that paymentId | **HIGH** | Orphan reversal entries (impossible by atomicity — would indicate corruption). |
| **M9** | Stuck CAPTURE_PENDING (publisher lag) | `Payment.status='CAPTURE_PENDING'` AND age > publisher max-retry window (e.g., 5 attempts × backoff schedule ≈ 30 min) AND no `Outbox` PENDING/CLAIMED `PAYMENT_CAPTURE_REQUESTED` for this payment | **HIGH** | Publisher exhausted retries → outbox FAILED → Payment stuck CAPTURE_PENDING. Requires manual gateway check. |
| **M10** | Stuck REFUND_PENDING (publisher lag) | `Refund.status='REFUND_PENDING'` AND age > publisher max-retry window AND no `Outbox` PENDING/CLAIMED `PAYMENT_REFUND_REQUESTED` for this refund | **HIGH** | Same as M9 but for refunds. The 5A Option A pending reservation entries sit silently unless reconciliation surfaces them. |
| **M11** | Orphan Outbox (PENDING past TTL or FAILED) | `Outbox.status IN ('PENDING','CLAIMED')` AND `createdAt < now - max_publish_attempts_window` OR `Outbox.status='FAILED'` | **HIGH** | Event lost or stuck — publisher did not deliver. |
| **M12** | Orphan Outbox (aggregate missing) | `Outbox.aggregateType='Payment'` but `Payment` row for `aggregateId` does not exist (or `aggregateType='Refund'` but `Refund` row missing) | **CRITICAL** | Impossible by atomicity (outbox + business row commit in same txn). Would indicate a manual DB delete. |
| **M13** | Unprocessed WebhookEvent past threshold | `WebhookEvent.verified=true AND processed=false AND receivedAt < now - threshold` | **MEDIUM** | Webhook received + verified but never processed (publisher/handler crash mid-processing). |
| **M14** | WebhookEvent references missing Payment | `WebhookEvent.paymentId` is non-null but `Payment` row does not exist | **MEDIUM** | Webhook for a payment we don't have (could be a race or a stale webhook). |
| **M15** | Payment status vs ledger state consistency | `Payment.status='REFUNDED'` but `Refund` rows for paymentId do not sum to `Payment.amount` (full refund not reflected) | **HIGH** | Payment marked fully refunded but refunds don't add up. |
| **M16** | Outbox lag exceeding SLA | `/lag` endpoint reports oldest PENDING event age > SLA threshold (e.g., 5 min) | **MEDIUM** | Publisher is behind — not a money-state violation but an operational health signal. |
| **M17** | AuditLog hash-chain break | The `prevHash` / `hash` chain on `AuditLog` is broken (a known P0-22 weakness — true WORM needs production storage) | **MEDIUM** | Tamper-evidence check — already a P0-22 concern; reconciliation can surface it. |

**Total: 17 mismatch classes.** The 5B implementation will prioritize M1-M12 (money-state integrity) and M15; M13-M14 and M16-M17 are operational/tamper checks that can be in the same job.

### D5 — Idempotency

**Question:** Can reconciliation itself cause duplicate accounting mutations?

**Answer:** **NO — by construction.** The 5B detection model is **read-only**. It performs only `SELECT` / `COUNT` / `SUM` queries against the database. It writes only to:
1. A new `ReconciliationRun` table (run metadata: startedAt, completedAt, counts).
2. A new `ReconciliationFinding` table (findings: class, severity, entityId, snapshot).
3. `ExceptionQueue` (via `reportInvariantViolation()` — existing P0-28 path, which is itself idempotent: a finding for the same entityId + invariant can be deduped by checking existing unresolved exceptions for that entity).
4. The `reconciliation_mismatch_count` metric (fire-and-forget).

None of these touch `Payment`, `Refund`, `LedgerEntry`, `Outbox`, `WebhookEvent`, or `IdempotencyKey`. The ledger cannot be mutated by reconciliation.

**Idempotency of reconciliation runs themselves:** If the reconciliation job runs twice in quick succession (e.g., cron overlap), the second run will find the same mismatches. To avoid duplicate findings:
- Each `ReconciliationFinding` row has a unique key `(runId, mismatchClass, entityId)`.
- A finding is only created if no unresolved finding exists for the same `(mismatchClass, entityId)` (checked inside the same txn as the finding insert).
- This is the same idempotency pattern as `WebhookEvent.eventId` dedup (Wave-4 4a).

**Concurrency safety:** The reconciliation job should run as a single instance (cron or mini-service with a lease). If two instances run concurrently, the finding-insert idempotency check prevents duplicates. No `withTransaction()` retry is needed for reads; the finding inserts are simple unique-constraint-protected writes.

### D6 — Remediation

**Question:** Will reconciliation only detect, or also automatically repair?

**Answer:** **DETECTION ONLY in 5B.** Remediation is a **separate authorization boundary**.

This is the single most important architectural decision in this Gate Review, and it directly honors the Orchestrator's constraint:

> *"P0-03 में automatic financial correction को स्वतः authorize नहीं किया गया है। यदि Gate Review यह पाता है कि reconciliation को ledger entries create/reverse करने, Payment status बदलने, refund/capture trigger करने, Outbox events enqueue करने, या external Razorpay side-effects करने की आवश्यकता है, तो उसे अलग authorization boundary के रूप में चिन्हित किया जाए। पहले detection/read-only reconciliation model स्पष्ट किया जाएगा।"*

**5B scope = detection + surfacing only.** Specifically:

| Action | In 5B? | Where does it go? |
|--------|:------:|-------------------|
| Read Payment / Refund / LedgerEntry / Outbox / WebhookEvent / IdempotencyKey | ✅ YES | Reconciliation job. |
| Compute invariant checks (M1-M17) | ✅ YES | Reconciliation job. |
| Write `ReconciliationRun` row (run metadata) | ✅ YES | Reconciliation job (new Class-2 table). |
| Write `ReconciliationFinding` rows (one per mismatch) | ✅ YES | Reconciliation job (new Class-2 table). |
| Emit `reconciliation_mismatch_count` metric | ✅ YES | Reconciliation job (activates existing alert rule). |
| Route high-severity findings through `reportInvariantViolation()` → ExceptionQueue + freeze | ✅ YES | Reconciliation job calls existing P0-28 path. |
| **Create / reverse LedgerEntry rows** | ❌ **NO** | Separate remediation sub-wave (5C or Orchestrator directive). |
| **Change Payment.status / Refund.status** | ❌ **NO** | Separate remediation sub-wave. |
| **Trigger capture / refund** | ❌ **NO** | Separate remediation sub-wave. |
| **Enqueue Outbox events** | ❌ **NO** | Separate remediation sub-wave. |
| **Make external Razorpay API calls** | ❌ **NO** | Separate remediation sub-wave (or manual operator action). |

**Rationale:** Detection is safe (read-only, cannot break invariants). Remediation is dangerous (mutates money state, can introduce NEW drift if the remediation logic itself has a bug). Splitting them gives the Orchestrator a clean decision point: "we have detection working, we can see the drift, now decide whether to authorize automatic repair or keep it manual."

**What remediation would look like (for planning reference only — NOT authorized in 5B):**
- A future `5C — Remediation` sub-wave would add `reconcile()` handlers per mismatch class.
- Each handler would be a `withTransaction()` body that mutates money state.
- Each handler would be feature-flagged (`reconciliationAutoRepair` flag, default OFF).
- Each handler would be idempotent (check current state before mutating).
- Each handler would write an AuditLog entry (`RECONCILIATION_REPAIR_...`).
- The TRANSACTION_RETRY_INVARIANT would apply: no external calls inside the txn body.

### D7 — Transaction Safety

**Question:** During retry/concurrency, will reconciliation break the accounting invariant?

**Answer:** **NO — by construction.**

The 5B detection model performs only reads. Reads do not take write locks, do not participate in the `withTransaction()` retry loop, and cannot violate I-06 (Dr === Cr) or any other invariant.

The only writes 5B performs are to NEW tables (`ReconciliationRun`, `ReconciliationFinding`) and to the existing `ExceptionQueue` (via the existing `reportInvariantViolation()` path, which is itself atomic — it creates the ExceptionQueue entry + applies the freeze in a single txn).

**Concurrency scenarios:**

| Scenario | Outcome |
|----------|---------|
| Reconciliation runs while a capture route is mid-txn | Reconciliation sees the pre-txn state (Payment not yet created, or CAPTURE_PENDING). No false positive — the finding for "stuck CAPTURE_PENDING" has an age threshold (e.g., 30 min) that tolerates in-flight txns. |
| Reconciliation runs while a publisher is mid-refund | Same — sees the pre-publish state. The "stuck REFUND_PENDING" finding has an age threshold. |
| Two reconciliation runs overlap | Finding-insert idempotency (unique key on `runId, mismatchClass, entityId` + check for existing unresolved finding) prevents duplicates. |
| Reconciliation runs during a P2034 retry of a capture/refund txn | Reconciliation sees the pre-txn state (the retry hasn't committed yet). No false positive. |
| Reconciliation runs after a publisher marked outbox PUBLISHED but before the success-txn committed | Reconciliation might briefly see `Outbox.status=PUBLISHED` + `Payment.status=CAPTURE_PENDING`. This is a transient state — the age threshold prevents false positives. |

**The key safety property:** 5B's writes are to NON-money-state tables. Even if a reconciliation run's writes are rolled back or retried, no money-state invariant is affected. This is the architectural guarantee that makes the detection-only model safe.

### D8 — Evidence

**Question:** Which E-scenarios are required, and which must be proven on PostgreSQL?

**Answer:** 6 E-scenarios (E1-E6). E1-E4 on SQLite (fast iteration); E4-E6 mandatory on PostgreSQL (concurrency + scale + real-mode constraints).

| # | Evidence | DB | What it proves | Mandatory on PostgreSQL? |
|---|----------|-----|----------------|:------------------------:|
| **E1** | Reconciliation detects ledger imbalance (M1) | SQLite | Insert a synthetic Dr-without-Cr ledger entry → reconciliation finds it → finding row created → metric emitted → ExceptionQueue entry created (Level 1 freeze on Payment) → alert rule fires. | Optional (logic is DB-agnostic). |
| **E2** | Reconciliation detects stuck CAPTURE_PENDING (M9) + stuck REFUND_PENDING (M10) + orphan Outbox (M11/M12) | SQLite | Seed a Payment CAPTURE_PENDING with an old createdAt + no PENDING outbox → reconciliation finds it → finding created → metric emitted. Same for a Refund REFUND_PENDING with old createdAt. | Optional. |
| **E3** | Reconciliation is idempotent (D5) | SQLite | Run reconciliation twice → second run creates NO new findings (deduped by `(mismatchClass, entityId)` check). | Optional. |
| **E4** | Reconciliation does NOT mutate money state (D7) — the critical safety property | SQLite + **PostgreSQL** | Snapshot Payment / Refund / LedgerEntry / Outbox / WebhookEvent / IdempotencyKey before reconciliation. Run reconciliation. Snapshot after. Assert: zero diffs in money-state tables. Only `ReconciliationRun` + `ReconciliationFinding` + `ExceptionQueue` rows were added. | **✅ PostgreSQL mandatory** — this is the invariant that protects CLOSED waves. Must be proven on the production-grade DB. |
| **E5** | Reconciliation handles concurrent runs without duplicate findings | **PostgreSQL** | Trigger two reconciliation runs simultaneously → both complete → exactly one set of findings (dedup via unique constraint). | **✅ PostgreSQL mandatory** — concurrency behavior differs between SQLite (database-level lock) and PostgreSQL (row-level locks). Must prove on PostgreSQL. |
| **E6** | Reconciliation at scale (1000+ payments, 100+ refunds, mixed states) completes within SLA + produces correct findings | **PostgreSQL** | Seed 1000 payments (mix of CAPTURED / REFUNDED / CAPTURE_PENDING / REFUND_PENDING), 100 refunds, 50 orphan outbox rows, 10 ledger imbalances. Run reconciliation. Assert: all 50 + 10 + N findings found, runtime < SLA (e.g., 30s), no false positives on healthy payments. | **✅ PostgreSQL mandatory** — scale + correctness on real dataset. |

**Evidence pattern (mirrors Wave-3/4/5A):**
- EVIDENCE_TEST_MODE-gated setup + verify endpoints under `/api/reconciliation/evidence-setup` + `/api/reconciliation/evidence-verify`.
- SQLite evidence runner script `scripts/wave5-5b-evidence.mjs` (5/5 or 6/6 PASS).
- Staging migration workflow (`wave5-5b-staging-migration.yml`) to apply the Class-2 additive schema (ReconciliationRun + ReconciliationFinding tables) to staging Supabase.
- PostgreSQL evidence workflow (`subwave-5b-postgresql-evidence.yml`) that triggers a Vercel preview deployment with `EVIDENCE_TEST_MODE=true` and runs E4/E5/E6 against staging Supabase.

### D9 — Existing Waves (Impact on CLOSED invariants)

**Question:** Will 5B affect the CLOSED invariants of Wave-3/4/5A?

**Answer:** **NO.** 5B is read-only with respect to all CLOSED-wave money-state tables.

| CLOSED invariant | Source wave | How 5B respects it |
|------------------|-------------|---------------------|
| I-01 Payment Integrity | Wave-3 (P0-01), Wave-4 (P0-05) | 5B does NOT write to `Payment` or `WebhookEvent`. It only reads them. |
| I-04 Capture Uniqueness | Wave-3 (P0-01, P0-17), Wave-4 (P0-05) | 5B does NOT create Payments or capture them. It detects duplicate-capture-ledger-pair (M4) but does not remove duplicates. |
| I-06 Ledger Balance | Wave-3 (P0-02), Wave-5A (P0-04) | 5B does NOT write to `LedgerEntry`. It detects imbalance (M1) but does not repair it. |
| I-07 Audit Integrity | Wave-0 (P0-22) | 5B does NOT write to `AuditLog` directly. If it routes a finding through `reportInvariantViolation()`, that function writes its own evidence (ExceptionQueue row), which is the P0-28 path — not an AuditLog mutation. |
| I-03 Refund Integrity | Wave-5A (P0-04) | 5B does NOT write to `Refund`. It detects refund anomalies (M6, M7, M8, M10, M15) but does not repair them. |
| I-10 Transactional Completeness | Wave-1 (P0-17, P0-25), Wave-2 (P0-24) | 5B does NOT participate in any business txn. Its own writes (ReconciliationRun/Finding) are simple inserts, not business mutations. |
| TRANSACTION_RETRY_INVARIANT | Wave-4 4c, Wave-5A | 5B does NOT make external calls. No external call inside any txn body — trivially satisfied. |

**The single permitted write to a CLOSED-wave table:** `ExceptionQueue` (via `reportInvariantViolation()`). This is the P0-28 path, designed for exactly this use case (an invariant checker detecting a violation). It does NOT mutate the money-state row directly — it freezes it (sets `Payment.frozen=true` for Level 1, or activates a kill switch for Level 3). The freeze is a **safety action**, not a money-state mutation.

**Verification:** E4 (above) empirically proves this. Snapshot all money-state tables before + after a reconciliation run → zero diffs.

### D10 — Schema/Migration

**Question:** Is a schema/migration needed, or are existing models sufficient?

**Answer:** Existing models are **sufficient for detection** (all mismatch queries can run against the current schema). However, two **Class-2 additive** models are recommended for audit trail + idempotency. No existing model is modified. No breaking change.

**Proposed Class-2 additive schema (NOT yet authorized — for planning reference):**

```prisma
// P0-03 Wave-5 Sub-Wave 5b — Reconciliation run + findings (Class-2 additive)
// Detection-only: reconciliation writes here, never to money-state tables.

model ReconciliationRun {
  id              String   @id @default(cuid())
  // Trigger: 'cron' | 'manual' | 'evidence'
  trigger         String
  // Status of the run itself
  status          String   @default("RUNNING") // RUNNING | COMPLETED | FAILED
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  // Summary counts (populated on completion)
  paymentsChecked Int      @default(0)
  refundsChecked  Int      @default(0)
  outboxChecked    Int      @default(0)
  findingsCount    Int      @default(0)
  // Metrics emitted (for the alert rule)
  mismatchCount    Int      @default(0)
  // Error tracking
  lastError        String?
  findings         ReconciliationFinding[]

  @@index([status, startedAt])
}

model ReconciliationFinding {
  id              String   @id @default(cuid())
  runId           String
  run             ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  // Mismatch class (M1-M17 from D4)
  mismatchClass   String   // e.g., "M1_LEDGER_IMBALANCE", "M9_STUCK_CAPTURE_PENDING"
  // Severity: CRITICAL | HIGH | MEDIUM
  severity        String
  // The affected entity (Payment, Refund, Outbox, WebhookEvent)
  entityType      String   // "Payment" | "Refund" | "Outbox" | "WebhookEvent"
  entityId        String
  // Full state snapshot at detection time (JSON)
  stateSnapshot   String
  // Whether this finding was routed to ExceptionQueue (high-severity only)
  exceptionId     String?  // FK to ExceptionQueue.id (if routed)
  // Resolution tracking
  resolvedAt      DateTime?
  resolvedBy      String?
  resolutionNote  String?
  detectedAt      DateTime @default(now())

  // Idempotency: one unresolved finding per (mismatchClass, entityId)
  // (a second run for the same mismatch updates the existing row, not a new one)
  @@unique([mismatchClass, entityId, resolvedAt])
  @@index([severity, resolvedAt])
  @@index([entityType, entityId])
}
```

**Migration class (per `src/lib/deployment.ts:60-75`):** `expand-migrate-contract` (has migration, non-breaking). Rollback: drop the two new tables (no data loss in money-state). Safe.

**What if the Orchestrator does NOT want a schema change in 5B?** The reconciliation job can run without these tables — it would emit findings via logs + the `reconciliation_mismatch_count` metric + ExceptionQueue (for high-severity). The downside: no persistent audit trail of findings, no idempotency dedup (findings would be re-emitted on every run). **Recommendation:** include the two Class-2 tables — they are additive, non-breaking, and provide the audit trail operators will need.

### D11 — Production Impact

**Question:** What part of P0-03 is a mandatory blocker before production launch?

**Answer:** Per `PRODUCTION_READINESS_GATE_REVIEW.md`:
- P0-03 is a **Hard Blocker (HB-2)** for launch-gate AND-condition #1 (all P0s at Production-ready) and #2 (all invariants verified).
- P0-03 is also listed as Risk **R2 (HIGH)**: "Gateway ↔ DB drift undetected. The known real-mode hazard (capture succeeded at gateway but DB write failed) has no automatic recovery path."

**Mandatory for production launch (must close before `realPayments=true`):**

| Capability | Why mandatory |
|------------|---------------|
| **Detection job exists + runs on schedule** | Without it, gateway ↔ DB drift is silent. `realPayments=true` means real money; drift means real money lost. |
| **At least M1-M12 + M15 mismatch classes detected** | These cover the money-state integrity invariants (I-01, I-04, I-06, I-03). |
| **High-severity findings route to ExceptionQueue + freeze** | A CRITICAL finding (e.g., ledger imbalance) must freeze the affected Payment so no further state changes can occur until an admin resolves it. |
| **`reconciliation_mismatch_count` metric emitted** | The existing alert rule (`alerting.ts:36`) fires on this metric. Without it, operators are not paged. |
| **PostgreSQL evidence (E4/E5/E6) PASS** | Must prove on the production-grade DB that reconciliation is safe (E4), concurrency-safe (E5), and correct at scale (E6). |

**NOT mandatory for production launch (can be deferred):**

| Capability | Why deferrable |
|------------|----------------|
| Automatic remediation (repair handlers) | Detection-only is sufficient for launch — operators can manually resolve findings. Remediation is a separate authorization boundary. |
| Razorpay API reconciliation (fetch gateway state) | Not needed for launch if webhook handler is enabled (gateway state flows in via webhooks). Manual gateway check suffices for findings. |
| Admin UI for findings | Operators can query the `ReconciliationFinding` table directly (or via a simple admin route). UI is a P1 convenience. |
| M13-M17 (operational/tamper checks) | Useful but not launch-blocking. Can be added in a later iteration. |

**Production flag enablement sequence (advisory — NOT authorized by this Gate Review):**
1. 5B implemented + S5 PASS / CLOSED.
2. `webhookHandler=true` (so gateway-side captures are confirmed via webhook — gives reconciliation the gateway-confirmation truth source).
3. `realPayments=true` (only after 5B + webhookHandler + outbox-publisher deployed + Razorpay keys).

This matches `PRODUCTION_READINESS_GATE_REVIEW.md:417` and `WAVE4_GATE_REVIEW.md` D5.

### D12 — Recommendation

**Question:** GO / CONDITIONAL GO / NO-GO, and why?

**Answer:** **CONDITIONAL GO.**

**The condition:** 5B is authorized **as a read-only detection model only**. Automatic financial correction (ledger reversal, Payment status change, refund trigger, outbox enqueue, external Razorpay call) is **NOT authorized in 5B** — it is a separate authorization boundary (likely a 5C sub-wave or a dedicated Orchestrator directive).

**Rationale:**
1. **Detection is safe.** It cannot break any CLOSED invariant (E4 proves this). It cannot lose money. It can only surface drift that today goes undetected.
2. **Remediation is dangerous.** Automatic repair mutates money state. A bug in the repair logic could introduce NEW drift — worse than the original. Remediation requires its own evidence package + its own Orchestrator decision.
3. **The Orchestrator's constraint explicitly demands this split.** The directive says: "पहले detection/read-only reconciliation model स्पष्ट किया जाएगा" (first the detection/read-only model will be clarified). This Gate Review honors that.
4. **The split gives the Orchestrator a clean decision point.** After 5B closes, the Orchestrator can review the actual findings (how many stuck REFUND_PENDING? how many orphan outbox? any ledger imbalance?) and decide whether automatic repair is even needed, or whether manual operator action suffices.

**What GO would authorize (separate directive required):**
- Implementation of the reconciliation job (mini-service or cron route).
- The two Class-2 additive tables (ReconciliationRun, ReconciliationFinding).
- The 17 mismatch-class detection queries (M1-M17).
- Integration with `reportInvariantViolation()` for high-severity findings.
- The `reconciliation_mismatch_count` metric emission.
- SQLite + PostgreSQL evidence (E1-E6).

**What GO would NOT authorize (even in a separate 5B-implementation directive):**
- Any write to `Payment`, `Refund`, `LedgerEntry`, `Outbox`, `WebhookEvent`, `IdempotencyKey`, or `AuditLog` (other than via `reportInvariantViolation()` which writes to `ExceptionQueue` only).
- Any external Razorpay API call.
- Any `realPayments` / `webhookHandler` / `requestHashEnforcement` flag flip.
- Any production deployment or migration.

**NO-GO would be appropriate if:** the Orchestrator determines that detection without remediation provides no value (unlikely — surfacing drift is itself valuable for operator action + audit).

---

## 3. Identified Root Cause / Scope

**Root cause P0-03 must address:** Three sources of truth (gateway, DB money-state, DB event-state) can drift apart, and today there is no mechanism to detect the drift. The specific drift modes are:

1. **Gateway ↔ DB drift:** Razorpay confirms a capture/refund, but the DB write fails (the §4.2 hazard in TRANSACTION_RETRY_INVARIANT.md — mitigated but not eliminated by 4c). Without reconciliation, this is silent.
2. **DB internal drift:** Ledger imbalance (I-06 violation) — should be impossible by atomicity, but if it ever occurs (bug, manual DB edit, storage corruption), it is silent today.
3. **Event-state drift:** Outbox PENDING/CLAIMED past TTL or FAILED, WebhookEvent unprocessed past threshold — these represent stuck side-effects that need operator attention.

**Scope of 5B (detection model):**
- Read-only reconciliation job (mini-service on its own port, OR cron route, OR manual evidence-gated endpoint).
- 17 mismatch-class detection queries (M1-M17).
- 2 new Class-2 additive tables (ReconciliationRun, ReconciliationFinding) — optional but recommended.
- Integration with existing `reportInvariantViolation()` for high-severity findings.
- Emission of `reconciliation_mismatch_count` metric (activates existing alert rule).
- SQLite + PostgreSQL evidence (E1-E6).

**Out of scope for 5B:**
- Automatic remediation (separate boundary).
- Razorpay API reconciliation fetch (manual or future sub-wave).
- Admin UI for findings (P1).
- M13-M17 can be included or deferred (operational, not money-state).

---

## 4. Proposed Architecture

### 4.1 Deployment model

**Option A (recommended): Mini-service.** A new `mini-services/reconciliation/` Bun service on its own port (e.g., 3010). Polls on an interval (e.g., every 5 min in dev, every 1 hour in staging, every 15 min in production — operator-configurable). Exposes `/health`, `/trigger` (manual run), `/findings` (list recent findings), `/runs` (list recent runs). Mirrors the outbox-publisher mini-service pattern.

**Option B: Cron route.** A `/api/reconciliation/run` route triggered by Vercel Cron. Simpler but constrained by Vercel's function timeout (10s on Hobby, 60s on Pro). Sufficient for small-scale; not for 1000+ payment scans.

**Option C: Manual + evidence-gated.** A route that only runs when `EVIDENCE_TEST_MODE=true` + an admin trigger. Lowest risk, highest operator burden. Suitable for the evidence phase; not for production.

**Recommendation:** Option A for production. Option C for evidence (5B-E1-E6). The evidence endpoints can be the same code path, just gated.

### 4.2 Detection flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Reconciliation Job (mini-service, port 3010)                     │
│                                                                  │
│  1. Create ReconciliationRun (status=RUNNING)                    │
│  2. For each mismatch class M1..M17:                            │
│     a. Run detection query (read-only SELECT/COUNT/SUM)          │
│     b. For each row returned (a mismatch):                      │
│        i.   Check for existing unresolved finding                │
│             (mismatchClass + entityId + resolvedAt IS NULL)      │
│        ii.  If exists: update lastSeenAt (no new row)            │
│        iii. If not: insert ReconciliationFinding                 │
│        iv.  If severity is CRITICAL or HIGH:                     │
│             call reportInvariantViolation() →                    │
│               ExceptionQueue entry + freeze (Level 1 on Payment) │
│  3. Emit reconciliation_mismatch_count metric                   │
│     (count of unresolved findings)                               │
│  4. Update ReconciliationRun (status=COMPLETED, counts)          │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ reads (never writes)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Money-state tables (CLOSED — Wave-3/4/5A)                        │
│  Payment, Refund, LedgerEntry, Outbox, WebhookEvent,            │
│  IdempotencyKey, AuditLog                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ writes (new Class-2 additive only)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Reconciliation tables (NEW — 5B)                                 │
│  ReconciliationRun, ReconciliationFinding                        │
│  + ExceptionQueue (existing P0-28 — via reportInvariantViolation)│
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Idempotency guarantee

- Each `ReconciliationFinding` has `@@unique([mismatchClass, entityId, resolvedAt])` — a partial unique index (resolvedAt is NULL for unresolved findings). This means: one unresolved finding per (mismatchClass, entityId) pair. A second run for the same mismatch updates `lastSeenAt` on the existing row, does NOT create a new row.
- This is the same dedup pattern as `WebhookEvent.eventId` (Wave-4 4a) and `IdempotencyKey.key` (Wave-1 P0-17).

### 4.4 Safety properties (the 5B contract)

| # | Property | How guaranteed |
|---|----------|----------------|
| S1 | Reconciliation never writes to money-state tables | Code review + E4 empirical proof (snapshot before/after). |
| S2 | Reconciliation never makes external calls | No `fetch()` / `razorpay.*` calls in the job. |
| S3 | Reconciliation findings are idempotent | Unique constraint on `(mismatchClass, entityId, resolvedAt)`. |
| S4 | High-severity findings freeze the affected entity | Routed through `reportInvariantViolation()` (P0-28). |
| S5 | Reconciliation cannot break a CLOSED invariant | It doesn't touch the tables those invariants protect. |
| S6 | Reconciliation is concurrency-safe | Finding insert idempotency + single-instance lease. |

---

## 5. Proposed Evidence Matrix

(See D8 above for the full E1-E6 table.)

**Summary:**
- **E1-E3:** SQLite — logic correctness (imbalance detection, stuck-pending detection, idempotency).
- **E4:** SQLite + **PostgreSQL mandatory** — the critical safety property (no money-state mutation).
- **E5:** **PostgreSQL mandatory** — concurrent runs (dedup under real row-level locking).
- **E6:** **PostgreSQL mandatory** — scale + correctness (1000+ payments, mixed states, SLA).

**Evidence artifacts (to be created in implementation — NOT in this Gate Review):**
- `evidence/wave5-5b/evidence-E1-E3-5b-<runId>.json`
- `evidence/wave5-5b/evidence-E4-5b-<runId>.json` (SQLite)
- `evidence/wave5-5b/evidence-E4-postgresql-5b-pg-ev.json`
- `evidence/wave5-5b/evidence-E5-postgresql-5b-pg-ev.json`
- `evidence/wave5-5b/evidence-E6-postgresql-5b-pg-ev.json`
- `.github/workflows/subwave-5b-postgresql-evidence.yml`
- `.github/workflows/wave5-5b-staging-migration.yml`

---

## 6. Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| **R1** | Reconciliation query has a bug → false positive → false freeze on a healthy Payment | MEDIUM | HIGH (false freeze blocks a customer's payment) | (a) Age threshold on stuck-pending findings (tolerates in-flight txns). (b) E6 scale test proves no false positives on healthy payments. (c) Findings route through ExceptionQueue (admin can resolve + unfreeze). |
| **R2** | Reconciliation query has a bug → false negative → real drift undetected | MEDIUM | HIGH (defeats the purpose of P0-03) | (a) E1/E2 prove each mismatch class is detected with a synthetic seed. (b) E6 scale test with seeded anomalies proves detection at scale. |
| **R3** | Reconciliation run is slow → blocks the DB / causes lock contention | LOW | MEDIUM | (a) Read-only queries use no write locks. (b) E6 SLA test (e.g., <30s for 1000 payments). (c) Run during off-peak if needed. |
| **R4** | Reconciliation Run table grows unbounded | LOW | LOW | (a) TTL on ReconciliationFinding rows (e.g., 90 days). (b) ReconciliationRun rows pruned after 30 days. (c) Index on `(severity, resolvedAt)` for fast admin queries. |
| **R5** | Operator ignores findings → drift persists | MEDIUM | HIGH (defeats purpose) | (a) `reconciliation_mismatch_count` metric + existing alert rule pages on-call. (b) ExceptionQueue entries for CRITICAL/HIGH findings block further state changes (frozen Payment cannot be refunded). |
| **R6** | Scope creep → 5B tries to do remediation | MEDIUM | HIGH (violates Orchestrator constraint) | (a) This Gate Review explicitly excludes remediation. (b) Code review enforces "no writes to money-state tables." (c) E4 empirically proves no money-state mutation. |
| **R7** | Schema change (ReconciliationRun/Finding tables) breaks something | LOW | LOW | (a) Class-2 additive — no existing model modified. (b) `expand-migrate-contract` deployment class — safe rollback (drop the new tables). |
| **R8** | Reconciliation runs during a publisher txn and sees a transient state | MEDIUM | LOW (false positive, deduped on next run) | (a) Age thresholds on stuck-pending findings. (b) Idempotent finding insert (no duplicate on re-run). |
| **R9** | 5B reopens a CLOSED wave's evidence | LOW | HIGH (governance violation) | (a) This Gate Review explicitly states 5B is read-only w.r.t. CLOSED-wave tables. (b) E4 proves no money-state mutation. (c) No Wave-3/4/5A evidence file is modified. |

**Overall risk:** MEDIUM. The detection-only model is inherently low-risk (cannot break invariants). The main risks are false positives (R1, R8) and scope creep into remediation (R6) — both mitigated by the evidence matrix + code review.

---

## 7. Exact Implementation Boundary (what a future 5B-implementation directive would authorize)

**This Gate Review does NOT authorize implementation.** The following is the precise boundary a future Orchestrator directive would need to authorize:

### 7.1 Authorized (if a future 5B-implementation directive is issued)

| # | Item | Boundary |
|---|------|----------|
| 1 | New `mini-services/reconciliation/` Bun service (port 3010) | Detection-only. No external calls. |
| 2 | New `src/lib/reconciliation.ts` detection library | 17 mismatch-class query functions. Read-only. |
| 3 | New `prisma/scripts/wave5-subwave-5b-migration.sql` | Class-2 additive: ReconciliationRun + ReconciliationFinding tables. No existing model modified. |
| 4 | New `src/app/api/reconciliation/evidence-setup/route.ts` + `evidence-verify/route.ts` | EVIDENCE_TEST_MODE-gated. For E1-E6 only. |
| 5 | New `scripts/wave5-5b-evidence.mjs` + `scripts/run-5b-evidence.sh` | SQLite evidence runner. |
| 6 | New `.github/workflows/wave5-5b-staging-migration.yml` + `subwave-5b-postgresql-evidence.yml` | Staging migration + PostgreSQL evidence. |
| 7 | New `WAVE5_EVIDENCE.md` §5b section + `WAVE5_5B_GATE_REVIEW.md` closure update | Documentation. |
| 8 | Integration with existing `reportInvariantViolation()` (P0-28) for high-severity findings | Calls existing function; does NOT modify it. |
| 9 | Emission of `reconciliation_mismatch_count` metric | Activates existing alert rule (`alerting.ts:36`). |

### 7.2 NOT authorized (even in a future 5B-implementation directive — requires separate boundary)

| # | Item | Why deferred |
|---|------|---------------|
| 1 | Any write to `Payment`, `Refund`, `LedgerEntry`, `Outbox`, `WebhookEvent`, `IdempotencyKey`, `AuditLog` | Money-state mutation — separate remediation boundary. |
| 2 | Any external Razorpay API call from the reconciliation job | External side-effect — separate remediation boundary. |
| 3 | Any feature flag flip (`realPayments`, `webhookHandler`, `requestHashEnforcement`, new `reconciliationAutoRepair`) | Orchestrator decision. |
| 4 | Any production deployment or migration | Orchestrator decision. |
| 5 | Any reopen of Wave-3/4/5A evidence | Governance rule — CLOSED waves are immutable. |

### 7.3 What would trigger a separate remediation authorization

If, after 5B detection is running in staging, the Orchestrator observes:
- A high volume of stuck `REFUND_PENDING` findings (publisher failing repeatedly), OR
- Ledger imbalance findings (indicating a real bug in a CLOSED wave), OR
- Gateway-DB drift findings (capture confirmed at gateway but DB stuck CAPTURE_PENDING),

...then the Orchestrator may issue a separate directive authorizing a **5C — Remediation** sub-wave. That sub-wave would:
- Add per-mismatch-class repair handlers (each a `withTransaction()` body).
- Be feature-flagged (`reconciliationAutoRepair`, default OFF).
- Follow the TRANSACTION_RETRY_INVARIANT (no external calls inside txn body).
- Have its own evidence matrix (proving repair is idempotent + invariant-preserving).

This is explicitly out of scope for 5B.

---

## 8. Stop Point

This Gate Review is COMPLETE. The IDE is STOPPING.

- 5B READ/PLAN-FIRST Gate Review: ✅ COMPLETE.
- 5B implementation: 🔒 NOT YET AUTHORIZED.
- 5B remediation (auto-repair): 🔒 NOT AUTHORIZED (separate boundary).
- Production: 🚫 NOT AUTHORIZED.
- `realPayments` / `webhookHandler` / `requestHashEnforcement`: 🚫 OFF.
- Wave-3/4/5A: ✅ CLOSED — immutable. 5B does not touch them.

**Next governance checkpoint:** Orchestrator decision on 5B implementation authorization (separate directive required). The Orchestrator may:
- (a) Authorize 5B implementation (detection-only model, per §7.1 boundary).
- (b) Modify the 5B scope (e.g., add/subtract mismatch classes, change schema decision).
- (c) Defer 5B and prioritize another wave.
- (d) Reject the detection-only model and demand remediation bundled (NOT recommended — see D6/D12 rationale).

---

## 9. D1–D12 Decision Summary (one-line each)

| Gate | Decision |
|------|----------|
| **D1 — Scope** | Detect gateway ↔ DB ↔ event-state drift via 17 mismatch classes; surface findings + freeze high-severity. No repair. |
| **D2 — Current State** | No reconciliation job, no detection logic, no finding table. Alert rule exists but metric never emitted. Evidence-verify route has the query pattern. |
| **D3 — Source of Truth** | Layered: Razorpay (cash事实), Payment/Refund status (DB business state), LedgerEntry (accounting), Outbox (pending side-effects), WebhookEvent (gateway confirmations). Reconciliation computes consistency between them. |
| **D4 — Mismatch Classes** | 17 classes (M1-M17): ledger imbalance, missing/duplicate capture ledger, refund-total-exceeds-payment, stuck CAPTURE_PENDING/REFUND_PENDING, orphan outbox, unprocessed webhook, status-vs-ledger consistency, outbox lag, audit chain break. |
| **D5 — Idempotency** | Read-only — cannot cause duplicate accounting mutations. Findings deduped via `@@unique([mismatchClass, entityId, resolvedAt])`. |
| **D6 — Remediation** | DETECTION ONLY in 5B. Repair (ledger reversal, status change, refund trigger, outbox enqueue, external call) is a separate authorization boundary (5C or Orchestrator directive). |
| **D7 — Transaction Safety** | Reads only — no write locks, no txn retry, cannot break I-06 or any CLOSED invariant. E4 proves this empirically. |
| **D8 — Evidence** | 6 E-scenarios (E1-E6). E1-E3 SQLite; E4-E6 PostgreSQL mandatory (safety + concurrency + scale). |
| **D9 — Existing Waves** | NO impact on Wave-3/4/5A CLOSED invariants. 5B is read-only w.r.t. their tables. Only permitted write to CLOSED-wave-adjacent table is ExceptionQueue (via existing P0-28 path). |
| **D10 — Schema/Migration** | Existing models sufficient for detection. Recommended: 2 Class-2 additive tables (ReconciliationRun, ReconciliationFinding). No breaking change. `expand-migrate-contract` class. |
| **D11 — Production Impact** | Detection job + M1-M12 + M15 + ExceptionQueue routing + metric emission + PostgreSQL E4/E5/E6 PASS = mandatory for launch. Remediation, Razorpay fetch, admin UI, M13-M17 = deferrable. |
| **D12 — Recommendation** | **CONDITIONAL GO.** Condition: 5B is detection-only; remediation is a separate boundary. Rationale: detection is safe, remediation is dangerous, the split gives the Orchestrator a clean decision point. |

---

**End of Gate Review. NO implementation started. NO code modified. NO schema changed. NO evidence run. Production NOT touched. `realPayments` OFF. `webhookHandler` OFF. `requestHashEnforcement` OFF. Wave-3/4/5A CLOSED — immutable.**

**STOP. Awaiting Orchestrator decision on 5B implementation authorization.**
