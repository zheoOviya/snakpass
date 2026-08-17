# Wave-4 — READ/PLAN-FIRST Gate Review

**Status:** 🟡 READ/PLAN-FIRST GATE REVIEW (Implementation NOT authorized)
**Date:** 2026-08-15
**Task ID:** wave4-gate-review
**Reviewer:** Software Architect / Gate Reviewer

**Predecessor:** Wave-3 ✅ ALL SUB-WAVES S5 PASS / CLOSED (3a + 3b + 3c).

> **Orchestrator Authorization (verbatim):** Wave-4 — READ/PLAN-FIRST Gate Review ONLY. NO implementation authorization. NO schema modification. NO migration. NO evidence run. NO deployment. NO production access/change. NO `realPayments` activation. NO `requestHashEnforcement` production ON. NO Wave-4 implementation authorization assumed. IDE MUST STOP after producing this Gate Review document and the Orchestrator will resolve GO / CONDITIONAL-GO / NO-GO.

---

## Table of Contents

1. [Wave-4 Objective](#1-wave-4-objective)
2. [Current-State Findings](#2-current-state-findings)
3. [P0 Inventory + Status](#3-p0-inventory--status)
4. [Dependency Analysis](#4-dependency-analysis)
5. [P0/Invariant Impact](#5-p0invariant-impact)
6. [Proposed Implementation Scope](#6-proposed-implementation-scope)
7. [Schema/Migration Impact](#7-schemamigration-impact)
8. [Evidence Requirements](#8-evidence-requirements)
9. [Production Impact](#9-production-impact)
10. [Rollback Strategy](#10-rollback-strategy)
11. [Risk / Blast Radius](#11-risk--blast-radius)
12. [Decision Points](#12-decision-points)
13. [Recommendation](#13-recommendation)
14. [Governance Compliance](#14-governance-compliance)

---

## 1. Wave-4 Objective

Wave-4 is the **post-Wave-3 phase** that moves SnakZap closer to production authorization by closing the next set of P0 capabilities on the critical path.

### 1.1 Architectural position of Wave-4

Per `IMPLEMENTATION_ORDER.md` Wave 4 and `CRITICAL_PATH.md`:

```
Wave 0 → Wave 1 → Wave 2 → Wave 3 → [Wave 4] → Wave 5 → Wave 6 → Wave 7
                                  P0-01      P0-02,    P0-04,    P0-06   P0-07
                                  P0-08      P0-05     P0-03              (terminus)
                                  (CLOSED)   (target)  (deferred)         (deferred)
```

Wave-3 closed P0-01 (capture) + P0-08 (order idempotency) + P0-08+ (C1 requestHash). Wave-4 picks up the **next layer of dependencies**: P0-02 (payment ledger) and P0-05 (webhook integrity).

### 1.2 Wave-4 candidate scope (per Sub-Wave 3 Gate Review deferrals)

`SUBWAVE_3_GATE_REVIEW.md` and `WAVE3_EVIDENCE.md` §1 explicitly deferred three items:

| Item | Deferred-to | Current state | Wave-4 fit |
|------|-------------|---------------|------------|
| **Webhook handler (P0-05)** | Wave-4 | WebhookEvent model in schema (`prisma/schema.prisma:411-431`), handler NOT implemented (no `src/app/api/webhooks/*` route exists) | ✅ **PRIMARY Wave-4 candidate** |
| **Refund flow (P0-04)** | Wave-5 | Payment.status enum has `REFUNDED` (Wave-3a schema only); no refund route, no Razorpay refund API call | ❌ DEFERRED to Wave-5 |
| **Reconciliation job (P0-03)** | Wave-5 | No scheduled job, no report stub, no mismatch-detection logic | ❌ DEFERRED to Wave-5 |

### 1.3 Carry-forward items from Wave-2 + 3a (Phase-3 prerequisites)

Per `WAVE2_FINAL_AUDIT.md` §"Phase-3 Prerequisites" + `docs/TRANSACTION_RETRY_INVARIANT.md` §8:

| # | Carry-forward item | Source | Status | Wave-4 fit |
|---|--------------------|--------|--------|------------|
| 1 | Fix `orphan_business_count` query to exclude pre-outbox orders (timestamp filter) | WAVE2_FINAL_AUDIT §Audit 2 + §Audit 3 | DEFECT documented, NOT fixed (alert storm risk if deployed to production with historical orders) | 🟡 Optional Wave-4 (production-launch prerequisite) |
| 2 | Fix production `DATABASE_URL` to use `snakzap_app` role (not `postgres` superuser) | WAVE2_FINAL_AUDIT §Audit 7 + POSTGRESQL_CUTOVER_PLAN §3 | NOT DONE (Vercel production env vars not yet configured for snakzap_app role) | ❌ OUT of Wave-4 scope (operator action, not IDE scope) |
| 3 | Deploy `realtime` service to Fly.io | P0-27-PHASE2-REMEDIATION §7 | NOT DONE (no Fly.io provisioning; `REALTIME_URL` still hard-coded `localhost:3003` in `src/lib/realtime.ts`) | ❌ OUT of Wave-4 scope (operator provisioning) |
| 4 | Switch publisher from HTTP transport to Socket.io transport | WAVE2_EVIDENCE 2b-0 Transport Contract Fix | ✅ DONE in Sub-Wave 2b-0 (colons `order:created` matching realtime mini-service) | ✅ CLOSED (carry-forward satisfied) |
| 5 | Payment + Ledger atomicity test | WAVE2_FINAL_AUDIT §Phase-3 Prerequisites | ✅ DONE in Wave-3a (3a-5: Transactional Atomicity — 6 writes in same txn) | ✅ CLOSED (carry-forward satisfied) |
| 6 | TRANSACTION_RETRY_INVARIANT enforcement (lint rule / CI gate / outbox publisher for captures) | `docs/TRANSACTION_RETRY_INVARIANT.md` §8.2 | PARTIAL — document exists, enforcement mechanism NOT implemented; `captureRazorpayPayment()` STILL inside txn body in `src/app/api/payments/route.ts:160` (gated by `realPayments=false`) | 🟡 Strong Wave-4 candidate (REQUIRED before `realPayments=true`) |
| 7 | `requestHashEnforcement` production enablement | SUBWAVE_3C_GATE_REVIEW §10 (D2) | IMPLEMENTED, default OFF in production; flag enabled only on staging during 3c-PG-E1 evidence | ❌ OUT of Wave-4 scope (separate Orchestrator authorization) |
| 8 | Switch `prisma/schema.prisma` provider from `sqlite` to `postgresql` | P0-27-PHASE2-REMEDIATION §12 item 1 | ✅ DONE (verified `prisma/schema.prisma:14` — `provider = "postgresql"`) | ✅ CLOSED (carry-forward satisfied) |
| 9 | Razorpay test API keys for staging | SUBWAVE_3_GATE_REVIEW §Q7 | NOT DONE (no `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` env vars configured) | 🟡 Wave-4 candidate (required for webhook signature verification on real Razorpay webhooks) |

### 1.4 Wave-4 objective (consolidated)

**Wave-4 aims to:**

1. **Implement P0-05 (Webhook integrity handler)** — Razorpay webhook endpoint with HMAC verification + idempotent processing (dedup via `WebhookEvent.eventId` unique constraint). Closes I-01 (Payment Integrity) + I-04 (Capture Uniqueness) for the webhook side.
2. **Formalize P0-02 (Payment ledger)** — Wave-3a wrote Dr/Cr LedgerEntry pairs inside the capture txn; Wave-4 should formally close P0-02 with reconciliation-gap analysis + balance-integrity evidence. (P0-02 currently NOT at S5 — it is at "Implemented + Empirically exercised via 3a-5 atomicity test" but no dedicated P0-02 evidence.)
3. **Mitigate the TRANSACTION_RETRY_INVARIANT hazard** — Move `captureRazorpayPayment()` OUT of the txn body via the outbox publisher pattern (Option C in `docs/TRANSACTION_RETRY_INVARIANT.md` §6). This is REQUIRED before `realPayments=true` can ever be authorized.
4. **OPTIONALLY close Wave-2 Phase-3 carry-forwards** — `orphan_business_count` timestamp filter (Phase-3 prerequisite #1).

Wave-4 does NOT aim to:
- Implement P0-04 (Refund flow) — Wave-5 scope per deferral.
- Implement P0-03 (Reconciliation job) — Wave-5 scope per deferral.
- Authorize production deployment — that is a separate Orchestrator decision.
- Enable `realPayments` in production — that is a separate Orchestrator decision.
- Enable `requestHashEnforcement` in production — that is a separate Orchestrator decision.

---

## 2. Current-State Findings

### 2.1 Wave-3 closure state (verified from worklog + WAVE3_EVIDENCE.md)

```text
Wave-0                   ✅ CLOSED
Wave-1                   ✅ CLOSED
Wave-2                   ✅ CLOSED (S5 Evidence-Complete)
Wave-3                   ✅ CLOSED
  ├─ Sub-Wave 3a          ✅ S5 PASS / CLOSED — Payment idempotency + PostgreSQL concurrency
  │                         (workflow 31896343466, ok:true, database:postgresql)
  ├─ Sub-Wave 3b          ✅ S5 PASS / CLOSED — Order POST idempotency + PostgreSQL concurrency
  │                         (workflow 31912679504, ok:true, database:postgresql)
  └─ Sub-Wave 3c          ✅ S5 PASS / CLOSED — C1 requestHash + PostgreSQL concurrency (flag ON)
                            (workflow 31916110251, ok:true, database:postgresql)
Wave-4                   🔒 LOCKED (READ/PLAN-FIRST Gate Review in progress)
Production               🚫 NOT AUTHORIZED
realPayments             🚫 OFF (default false, `src/lib/deployment.ts:27`)
requestHashEnforcement   🚫 OFF in production (default false, `src/lib/deployment.ts:47`)
```

### 2.2 Wave-3 evidence artifacts (referenced; NOT to be re-run in Wave-4)

| Sub-Wave | SQLite evidence | PostgreSQL evidence | Workflow run ID |
|----------|------------------|---------------------|-----------------|
| 3a | `evidence/wave3-3a/evidence-3a-ev-...json` (5/5 PASS) | `evidence/wave3-3a/evidence-postgresql-3a-pg-ev.json` | 31896343466 |
| 3b | `evidence/wave3-3b/evidence-3b-ev-1786832887563-41ed55ac.json` (5/5 PASS) | `evidence/wave3-3b/evidence-postgresql-3b-pg-ev.json` | 31912679504 |
| 3c | `evidence/wave3-3c/evidence-3c-complete-3c-remed-1786839940410-78fc4f22.json` (5/5 PASS) | `evidence/wave3-3c/evidence-postgresql-3c-pg-ev.json` | 31916110251 |

**Total closed evidence scenarios: 16 (5 from 3a + 5 from 3b + 5 from 3c + 1 PostgreSQL-concurrency proof per sub-wave already counted in each sub-wave's count).** Wave-4 MUST NOT re-run these — they remain valid proof for the flag-OFF paths (3a/3b) and the flag-ON path (3c).

### 2.3 Schema state (verified from `prisma/schema.prisma`)

| Model | Wave | Status |
|-------|------|--------|
| `User`, `OtpRequest`, `Session`, `OtpLockout` | Wave-0/1 | ✅ Stable |
| `Restaurant`, `MenuItem` (with `availableCount`, `version` for P0-25 Case A) | Wave-0/1 | ✅ Stable |
| `Order` (with `version` for P0-25 Case B, `payment` 1:1 relation) | Wave-0/3a | ✅ Stable |
| `OrderItem` | Wave-0 | ✅ Stable |
| `AuditLog` (with hash-chain `prevHash`/`hash` for tamper-evidence, WORM-protected at PG role level per DEV-001) | Wave-0/2 | ✅ Stable |
| `KillSwitch` (with `version` for P0-25) | Wave-0/1 | ✅ Stable |
| `IdempotencyKey` (with `requestHash` column from 3c) | Wave-1/3c | ✅ Stable |
| `Outbox` (with claim/lease fields from 2b-2) | Wave-2a/2b | ✅ Stable |
| `ProcessedEvent` (consumer-side dedup from 2b-1) | Wave-2b | ✅ Stable |
| `ExceptionQueue` (P0-28 freeze state) | Wave-1 | ✅ Stable |
| `Payment` (with `gatewayOrderId`, `gatewayPaymentId`, `gatewaySignature`, `idempotencyKey` unique, `frozen`, `version`) | Wave-3a | ✅ Stable |
| `LedgerEntry` (double-entry Dr/Cr, append-only) | Wave-3a | ✅ Stable (P0-02 schema-complete; formal closure pending) |
| `WebhookEvent` (eventId unique, payload, payloadHash, signature, verified, processed) | Wave-3a | ✅ Stable (P0-05 schema-complete; handler NOT implemented) |

**Schema state for Wave-4:** No new tables strictly required for P0-05 webhook handler (WebhookEvent model is sufficient). Possible additions: `RazorpayRefund` table (Wave-5) — out of Wave-4 scope. Possible schema touch: extend WebhookEvent with `processedBy`, `processingNotes` (optional).

### 2.4 Codebase state (verified via Read + Grep)

| Surface | State | Wave-4 fit |
|---------|-------|------------|
| `src/app/api/webhooks/*` | DOES NOT EXIST (no webhook route directory; no webhook handler implementation anywhere in `src/`) | 🔴 Wave-4 PRIMARY target |
| `src/lib/razorpay.ts` | Implements `createRazorpayOrder`, `verifyRazorpaySignature` (HMAC-SHA256), `captureRazorpayPayment` — all gated by `realPayments=false` (demo mode returns mocks) | ✅ Can be reused; signature verification already implemented |
| `src/app/api/payments/route.ts` | Implements capture route with 6 writes in txn (Payment, Order.update, 2× LedgerEntry, AuditLog, Outbox, IdempotencyKey); 8 evidence checkpoints for failure injection | ⚠️ Transactional Retry Invariant: `captureRazorpayPayment()` at line 160 is INSIDE `withTransaction()` body (latent risk per `docs/TRANSACTION_RETRY_INVARIANT.md` — REQUIRED mitigation before `realPayments=true`) |
| `src/app/api/orders/route.ts` | Order POST with idempotency + C1 hash (3c) + inventory race (P0-25 Case A) | ✅ Stable; no Wave-4 changes required |
| `src/lib/idempotency.ts` | C1 requestHash (3c) with `canonicalizeRequestBody`, `computeRequestHash`, `IdempotencyKeyReuseError` | ✅ Stable; reusable for webhook idempotency via `eventId` unique constraint (different mechanism from `Idempotency-Key` header) |
| `src/lib/outbox.ts` | `enqueueOutboxEvent(tx, event)` writes Outbox row inside txn; EVENT_TYPE_TO_SOCKET_EVENT map for realtime routing | ✅ Reusable; Wave-4 may add `PAYMENT_CAPTURE_REQUESTED` event type if retry-invariant mitigation is in scope |
| `src/lib/db.ts` | `withTransaction()` with retryable conflicts P2002/P1008/P2024/P2034/P2036; MAX_RETRIES=5; `TransactionConflictError` | ✅ Stable; Wave-4 does NOT modify retry semantics |
| `src/lib/deployment.ts` | Feature flags: `realPayments`, `pickupAttributionEnforcement`, `drDrillMode`, `outboxPublisher`, `concurrencyControl`, `requestHashEnforcement` — all default OFF | ✅ Stable; Wave-4 may add `webhookHandler` feature flag (default OFF for safety) |
| `mini-services/outbox-publisher/` | EXISTS from Wave-2b — handles Socket.io realtime fanout (`order:created`, `order:updated`, `killswitch:toggled`) | ⚠️ Does NOT handle `PAYMENT_CAPTURE_REQUESTED` (Wave-4 candidate extension if retry-invariant mitigation is in scope) |
| `mini-services/alert-evaluator/` | EXISTS from Wave-2d — evaluates 13 alert rules including `orphan-business-entity` (with the historical-baseline defect), `orphan-outbox-event`, `payment-success-rate` | ✅ Stable; Wave-4 may add `webhook-replay-storm` alert rule |
| `scripts/smoke-test.sh` | EXISTS from P0-27 remediation — 4-endpoint smoke test (health, auth-me, restaurants, kill-switches) | 🟡 Wave-4 may extend to cover webhook endpoint if implemented |

### 2.5 Governance gaps identified

1. 🟡 **No webhook handler implementation** — `WebhookEvent` model is schema-only (Wave-3a landed the schema, handler deferred to Wave-4).
2. 🟡 **P0-02 ledger is NOT formally S5 closed** — Wave-3a proved the atomic write of LedgerEntry Dr/Cr pairs but did NOT formally close P0-02 (no dedicated P0-02 evidence scenarios; no reconciliation gap analysis).
3. 🟡 **TRANSACTION_RETRY_INVARIANT is documented but UNMITIGATED** — `captureRazorpayPayment()` at `src/app/api/payments/route.ts:160` is still inside the `withTransaction()` body. The hazard is gated by `realPayments=false` but will be violated the moment `realPayments=true` is authorized.
4. 🟡 **`orphan_business_count` query defect** — Does not exclude pre-outbox historical orders (WAVE2_FINAL_AUDIT §Audit 2). Would cause alert storm in production. Fix is a 1-line SQL change.
5. 🟡 **Production env vars NOT configured** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` not in Vercel project env (out of IDE scope; Orchestrator/operator action).
6. 🟡 **`realPayments` flag is dormant** — defined in `deployment.ts:27` but never wired to live Razorpay credentials in production.
7. 🟡 **`requestHashEnforcement` flag is dormant** — defined in `deployment.ts:47`, set to `true` ONLY on staging Vercel preview during 3c-PG-E1 evidence runs. Production enablement is NOT authorized.

---

## 3. P0 Inventory + Status

### 3.1 P0 status map (post-Wave-3 closure)

| P0 | Title | Critical Path | Risk Tier | Wave | S5? | Evidence |
|----|-------|---------------|-----------|------|-----|----------|
| P0-15 | Database migrations | L0 (root) | Tier 2 | Wave-0 | ✅ | (Wave-0) |
| P0-25 | Concurrency + duplicate-exec | L1 | Tier 2 | Wave-1 | ✅ | (Wave-1) |
| P0-24 | Transactional data integrity (outbox) | L2 | Tier 1 | Wave-2 | ✅ | WAVE2_EVIDENCE.md |
| P0-01 | Razorpay capture | L3 | Tier 1 | Wave-3a | ✅ | WAVE3_EVIDENCE.md §7, 3a-E1..3a-PG-E1 |
| P0-08 | Order idempotency | L3 | Tier 4 | Wave-3b | ✅ | WAVE3_EVIDENCE.md §9, 3b-E1..3b-PG-E1 |
| P0-08+ | Order idempotency + C1 requestHash | L3 | Tier 4 | Wave-3c | ✅ | WAVE3_EVIDENCE.md §11-12, 3c-E1..3c-PG-E1 |
| **P0-02** | **Payment ledger (double-entry)** | **L4** | **Tier 2** | **Wave-4 candidate** | **🟡 PARTIAL (no S5 closure)** | Wave-3a 3a-5 atomicity (Dr/Cr pair write); NO P0-02-dedicated evidence |
| **P0-05** | **Webhook integrity (HMAC + idempotent)** | **L4** | **Tier 4** | **Wave-4 candidate** | **🔴 SCHEMA-ONLY (handler not implemented)** | NONE |
| P0-04 | Refund flow | L5 | Tier 1 | Wave-5 | 🔒 LOCKED | (deferred) |
| P0-03 | Payment reconciliation | L5 | Tier 3 | Wave-5 | 🔒 LOCKED | (deferred) |
| P0-06 | Order state separation | L6 | Tier 2 | Wave-6 | 🔒 LOCKED | (depends on P0-04 + P0-05) |
| P0-07 | Order state machine + pickup | L7 (terminus) | Tier 1 | Wave-7 | 🔒 LOCKED | (depends on P0-06) |
| P0-17 | Idempotency (critical writes) | L1 | Tier 4 | Wave-1 | ✅ | extended in 3c (requestHash) |
| P0-22 | Audit trail integrity (WORM) | L0 (join) | Tier 3 | Wave-0/2 | ✅ | DEV-001 closure (PG WORM boundary) |
| P0-23 | Kill switch fail-safe | L0 (join) | Tier 3 | Wave-0 | ✅ | (Wave-0) |
| P0-27 | Deployment & rollback (3 classes) | isolated control | (none) | Wave-0 parallel | ✅ (Phase-2 remediation) | P0-27-PHASE2-REMEDIATION.md |
| P0-28 | Unknown-exception handling | L1 leaf | Tier 3 | Wave-1 | ✅ | (Wave-1) |
| P0-26 | Disaster recovery | L1 leaf | Tier 3 | Wave-1 | 🟡 PARTIAL (runbook design only — no DR drill executed) | docs/DR_RUNBOOK.md |

**P0s NOT at S5 / CLOSED:**
- 🟡 P0-02 (ledger) — PARTIAL (schema + write exist, no formal S5 closure)
- 🔴 P0-05 (webhook) — SCHEMA-ONLY (handler not implemented)
- 🔒 P0-03, P0-04, P0-06, P0-07 — Wave-5/6/7 (locked)
- 🟡 P0-26 (DR) — design only, no drill executed

### 3.2 Wave-4 P0 candidates (filtered by readiness)

| P0 | Why Wave-4? | Hard deps satisfied? | Implementation effort | Risk |
|----|-------------|---------------------|----------------------|------|
| **P0-05 (Webhook handler)** | SUBWAVE_3_GATE_REVIEW.md §1 + WAVE3_EVIDENCE.md §1 explicitly defer to Wave-4. WebhookEvent schema EXISTS from 3a. | ✅ P0-01 (capture) CLOSED — webhook closes the capture-confirmed event from gateway side | MEDIUM (1 new route + signature verification reuse from razorpay.ts + dedup via existing WebhookEvent.eventId unique constraint) | MEDIUM (HMAC verification must be timing-safe; replay storm protection needed) |
| **P0-02 (Ledger formalization)** | IMPLEMENTATION_ORDER.md Wave 4 lists P0-02 alongside P0-05. Wave-3a wrote Dr/Cr pairs but did not formally close P0-02 (no balance-integrity evidence). | ✅ P0-01 CLOSED (capture writes LedgerEntry); P0-24 CLOSED (atomicity proven) | LOW-MEDIUM (no schema change; evidence scenarios + balance-integrity test + ledger audit report stub) | LOW (additive evidence; no critical-path code change) |
| **TRANSACTION_RETRY_INVARIANT mitigation** (move capture to outbox publisher) | `docs/TRANSACTION_RETRY_INVARIANT.md` §8.2 lists 5 enforcement items; full enforcement deferred to "Wave-3b/3c-adjacent" — that boundary has now passed. | ✅ P0-24 CLOSED (outbox infrastructure exists); P0-01 CLOSED (capture route exists); Wave-2b publisher worker exists (extend it) | HIGH (modify capture route to NOT call captureRazorpayPayment(); instead enqueue `PAYMENT_CAPTURE_REQUESTED` outbox event; extend publisher to call capture; idempotency via Payment.status check) | HIGH (touches money-critical path; required before `realPayments=true`) |
| **`orphan_business_count` timestamp-filter fix** | WAVE2_FINAL_AUDIT §Audit 2-3 — documented defect, production-launch prerequisite. NOT a P0 by itself (belongs to P0-24's orphan-detection surface). | ✅ None | LOW (1-line SQL change in `mini-services/alert-evaluator/index.ts:183-186`) | LOW (detection-only change) |

### 3.3 P0s explicitly OUT of Wave-4 scope

| P0 | Why deferred |
|----|--------------|
| P0-04 (Refund flow) | SUBWAVE_3_GATE_REVIEW + WAVE3_EVIDENCE.md §1: "Wave-5 scope. Wave-3 lands Payment.status='REFUNDED' enum only." Refund requires Razorpay refund API + lifecycle + ledger interaction — too large for Wave-4 alongside P0-05 + retry-invariant. |
| P0-03 (Reconciliation job) | Same deferral: "Wave-5 scope. Wave-3 stubs the report format only." Reconciliation depends on P0-02 + P0-05 (webhook updates ledger truth from gateway side). |
| P0-06 (Order state separation) | Wave-6 per IMPLEMENTATION_ORDER.md — depends on P0-05 (webhook) + P0-04 (refund) at L4/L5. |
| P0-07 (State machine + pickup) | Wave-7 (critical-path terminus) — depends on P0-06 at L6. |
| P0-26 DR drill execution | Wave-1 design only; actual drill is Phase-3 (production launch gate, NOT Wave-4 IDE scope). |
| `requestHashEnforcement` production enablement | SUBWAVE_3C_GATE_REVIEW §10 (D2): "DEFER to 3d or later" — explicitly separate Orchestrator authorization. |

---

## 4. Dependency Analysis

### 4.1 P0-05 (Webhook handler) — dependency graph

| Dependency | Type | Status | Notes |
|------------|------|--------|-------|
| P0-01 (Razorpay capture) | Hard (B-edge, blocking) | ✅ CLOSED | Webhook closes the capture-confirmed event from the gateway side. Capture record must exist before webhook can update it. |
| WebhookEvent schema | Hard (technical) | ✅ EXISTS (`prisma/schema.prisma:411-431`) | Schema-only in Wave-3a; Wave-4 implements handler. |
| `verifyRazorpaySignature()` | Hard (technical) | ✅ EXISTS (`src/lib/razorpay.ts:79-102`) | HMAC-SHA256 with constant-time comparison; reusable for webhook signature verification (with different payload: webhook payload instead of `orderId|paymentId`). |
| `withTransaction()` | Hard (technical) | ✅ EXISTS (`src/lib/db.ts:95-138`) | Webhook handler must update Payment + WebhookEvent + AuditLog + Outbox atomically. |
| `enqueueOutboxEvent()` | Hard (technical) | ✅ EXISTS (`src/lib/outbox.ts:55-72`) | Webhook may emit `PAYMENT_CAPTURE_CONFIRMED` outbox event for downstream consumers. |
| Razorpay webhook secret | Hard (env var) | 🔴 NOT CONFIGURED | `RAZORPAY_WEBHOOK_SECRET` env var not in Vercel project env (operator action). Without this, signature verification cannot work in production. |
| Public webhook URL | Hard (infrastructure) | 🟡 EXISTING (Vercel) | Vercel auto-exposes `/api/webhooks/*` routes; no infra provisioning needed. |
| Real Razorpay test API keys | Soft (for real-webhook evidence) | 🔴 NOT CONFIGURED | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` env vars not in staging Vercel (operator action). Demo mode exists in razorpay.ts. |

**Blockers for P0-05 production rollout:** Razorpay webhook secret + API keys (operator/Orchestrator action, NOT IDE scope).

### 4.2 P0-02 (Ledger formalization) — dependency graph

| Dependency | Type | Status | Notes |
|------------|------|--------|-------|
| P0-01 (Razorpay capture) | Hard (B-edge, blocking) | ✅ CLOSED | LedgerEntry Dr/Cr pairs are written inside the capture txn (Wave-3a). |
| LedgerEntry schema | Hard (technical) | ✅ EXISTS (`prisma/schema.prisma:394-409`) | Double-entry Dr/Cr with `entryType`, `accountType`, `amount`, `traceId`. Append-only (no `updatedAt`). |
| Capture route writes LedgerEntry | Hard (technical) | ✅ EXISTS (`src/app/api/payments/route.ts:201-224`) | Lines 201-210 write DEBIT/GATEWAY_RECEIVABLE; lines 215-224 write CREDIT/CONSUMER_REVENUE. Atomic with capture. |
| P0-03 (Reconciliation) | Soft (Wave-5 closure) | 🔒 LOCKED (Wave-5) | P0-02 ledger formalization does NOT require P0-03 reconciliation. But P0-03 will depend on P0-02 (reconciliation compares gateway ↔ ledger). |
| P0-24 (Outbox atomicity) | Hard (already CLOSED) | ✅ CLOSED | LedgerEntry + Outbox + Payment all in same txn (3a-5 atomicity proven). |

**Blockers for P0-02 S5 closure:** None. P0-02 is a leaf extension on Wave-3a's capture write — formal closure requires evidence scenarios for balance integrity (Dr sum == Cr sum per Payment) + no-orphan-ledger-entry (every LedgerEntry has a Payment) + no-phantom-ledger (failed capture does NOT leave LedgerEntry rows).

### 4.3 TRANSACTION_RETRY_INVARIANT mitigation — dependency graph

| Dependency | Type | Status | Notes |
|------------|------|--------|-------|
| P0-24 (Outbox pattern) | Hard (B-edge, blocking) | ✅ CLOSED | Outbox infrastructure is the canonical solution (Option C in TRANSACTION_RETRY_INVARIANT.md §6). |
| Outbox publisher worker | Hard (technical) | ✅ EXISTS (`mini-services/outbox-publisher/`) | Wave-2b publisher handles Socket.io realtime fanout. Wave-4 may extend to handle `PAYMENT_CAPTURE_REQUESTED` events. |
| `captureRazorpayPayment()` in `src/lib/razorpay.ts:108-130` | Hard (technical, refactor target) | ✅ EXISTS | Currently called from `src/app/api/payments/route.ts:160` INSIDE `withTransaction()`. Mitigation: remove from txn body, call from publisher instead. |
| `Payment.status` check (idempotency for publisher) | Hard (technical) | ✅ EXISTS | Publisher must check `Payment.status !== 'CAPTURED'` before calling capture (at-least-once delivery requires idempotent consumer). |
| Razorpay test API keys | Soft (for real-mode evidence) | 🔴 NOT CONFIGURED | Demo mode exists; real-mode capture requires keys. |
| `realPayments` flag | Hard (gating) | ✅ EXISTS (default OFF) | Mitigation is REQUIRED before flipping this flag to ON in production. |

**Blockers for retry-invariant mitigation:** None technical. The mitigation is a code refactor (move capture call out of txn body into publisher) + an extension to the publisher worker (handle `PAYMENT_CAPTURE_REQUESTED` event type). Risk is HIGH because the refactor touches the money-critical path.

### 4.4 `orphan_business_count` fix — dependency graph

| Dependency | Type | Status | Notes |
|------------|------|--------|-------|
| Outbox table createdAt column | Hard (technical) | ✅ EXISTS | `Outbox.createdAt` exists; can be used as the timestamp baseline. |
| `alert-evaluator` mini-service | Hard (technical) | ✅ EXISTS (`mini-services/alert-evaluator/index.ts:183-186`) | The defective query is at lines 183-186. Fix is a 1-line SQL addition (`AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")`). |
| Production deployment of alert-evaluator | Soft (Phase-3 prerequisite) | 🟡 NOT DEPLOYED | Alert-evaluator runs only locally + on staging Fly.io (per P0-27-PHASE2-REMEDIATION §7); production deployment is operator action. |

**Blockers:** None technical. This is a 1-line SQL fix in `mini-services/alert-evaluator/index.ts`. Lowest-risk Wave-4 candidate.

### 4.5 Carry-over items from Wave-2 (Phase-3 prerequisites)

From `WAVE2_FINAL_AUDIT.md` §"Phase-3 Prerequisites":

| # | Item | Status | Wave-4 fit |
|---|------|--------|------------|
| 1 | Fix `orphan_business_count` query | DEFECT documented, NOT fixed | ✅ Wave-4 (low-risk 1-line fix) |
| 2 | Production `DATABASE_URL` to use `snakzap_app` role | NOT DONE | ❌ Operator/Orchestrator action (not IDE scope) |
| 3 | Deploy `realtime` service to Fly.io | NOT DONE | ❌ Operator/Orchestrator action (not IDE scope) |
| 4 | Switch publisher HTTP → Socket.io transport | ✅ DONE in 2b-0 | N/A (closed) |
| 5 | Payment + Ledger atomicity | ✅ DONE in 3a-5 | N/A (closed) |

---

## 5. P0/Invariant Impact

### 5.1 Invariant impact matrix for proposed Wave-4 items

| # | Invariant | Source P0(s) | Wave-4 item impact | Safe? |
|---|----------|--------------|---------------------|-------|
| 1 | **I-01 Payment Integrity** | P0-01, P0-03, P0-05, P0-06, P0-24, P0-26, P0-28 | P0-05 webhook handler CLOSES the gateway-side of I-01 (gateway-captured event flows back to update Payment record). TRANSACTION_RETRY_INVARIANT mitigation (Option C) PRESERVES I-01 by moving capture out of retryable txn body. | ✅ SAFE + STRENGTHENED |
| 2 | **I-02 Order Integrity** | P0-06, P0-07, P0-08, P0-24, P0-25, P0-26, P0-28 | Wave-4 does NOT touch Order creation flow. Webhook handler may update `Order.status` to `PAID` if not already set (defensive — capture route already sets this). | ✅ SAFE (no regression) |
| 3 | **I-03 Refund Integrity** | P0-04, P0-28 | Wave-4 does NOT implement refund flow (Wave-5 scope). Webhook handler may receive `refund.processed` events — should be recorded in WebhookEvent but NOT processed (deferred). | ✅ SAFE (no refund-side impact) |
| 4 | **I-04 Capture Uniqueness** | P0-01, P0-05, P0-17, P0-25, P0-28 | P0-05 webhook handler dedups via `WebhookEvent.eventId` unique constraint (Razorpay event_id). This PREVENTS duplicate capture from webhook replays. TRANSACTION_RETRY_INVARIANT mitigation PRESERVES I-04 (no double-capture from retry). | ✅ SAFE + STRENGTHENED |
| 5 | **I-05 Item-Order Consistency** | P0-24, P0-25, P0-28 | Wave-4 does NOT touch MenuItem or OrderItem. | ✅ N/A |
| 6 | **I-06 Ledger Balance** | P0-02, P0-03, P0-04, P0-24, P0-26, P0-28 | P0-02 formal closure STRENGTHENS I-06 (balance-integrity evidence: Dr sum == Cr sum per Payment). | ✅ SAFE + STRENGTHENED |
| 7 | **I-07 Audit Integrity** | P0-22, P0-26, P0-28 | Wave-4 adds new AuditLog entries (`WEBHOOK_RECEIVED`, `WEBHOOK_VERIFIED`, `WEBHOOK_PROCESSED`, `WEBHOOK_REJECTED`). All append-only, hash-chain preserved. | ✅ SAFE |
| 8 | **I-08 Fulfilment Authorization** | P0-06, P0-07, P0-25, P0-28 | Wave-4 does NOT touch fulfilment flow. | ✅ N/A |
| 9 | **I-09 Kill-Switch Monotonicity** | P0-23, P0-28 | Wave-4 does NOT touch kill switch. | ✅ N/A |
| 10 | **I-10 Transactional Completeness** | P0-02, P0-08, P0-17, P0-24, P0-25, P0-26, P0-28 | Webhook handler MUST write Payment update + WebhookEvent + AuditLog + Outbox in same txn (atomicity preserved). Retry-invariant mitigation changes the txn boundary but preserves atomicity (outbox row commits atomically with Payment record; capture call happens AFTER commit, in publisher). | ✅ SAFE (txn atomicity preserved across boundary shift) |
| 11 | **I-11 Refund Precondition** | P0-04, P0-28 | Wave-4 does NOT implement refund. | ✅ N/A |
| 12 | **I-12 Session Revocation** | P0-09, P0-10, P0-11, P0-28 | Wave-4 does NOT touch auth/session. Webhook endpoint is unauthenticated (Razorpay → server, HMAC-verified, NOT session-based). | ✅ N/A |
| 13 | **I-13 Pickup/Handoff Integrity** | P0-07, P0-28 | Wave-4 does NOT touch pickup flow. | ✅ N/A |
| 14 | **I-14 Vendor Operational Integrity** | (P1-protected) | Wave-4 does NOT touch vendor flow. | ✅ N/A |

**No invariants are WEAKENED by Wave-4.** Three are STRENGTHENED: I-01 (webhook closes gateway-side), I-04 (webhook dedup), I-06 (P0-02 ledger formal closure).

### 5.2 Cross-P0 closure analysis (does Wave-4 reopen CLOSED P0s?)

| CLOSED P0 | Wave-4 impact | Reopen risk |
|-----------|---------------|-------------|
| P0-15 (migrations) | Wave-4 may add 0-2 schema columns (WebhookEvent extension, optional). All Class-2 additive. | NONE — additive migration |
| P0-17 (idempotency) | Wave-4 webhook handler uses `WebhookEvent.eventId` unique constraint (DIFFERENT mechanism from `Idempotency-Key` header). No overlap. | NONE — independent idempotency surface |
| P0-24 (transactional outbox) | Wave-4 may extend publisher to handle `PAYMENT_CAPTURE_REQUESTED`. Outbox schema unchanged. New event type. | NONE — additive event type |
| P0-25 (concurrency) | Wave-4 does NOT touch `MenuItem.version` / `Order.version` / `Payment.version` (except: webhook handler may set `Payment.status = 'CAPTURED'` if not already set, using `updateMany WHERE status != 'CAPTURED' AND version = X` for optimistic-lock). | NONE — uses existing P0-25 pattern |
| P0-27 (deployment) | Wave-4 changes are Class-2 expand-migrate-contract (additive schema, additive API route, additive publisher event type). | NONE — Class-2 rollback-safe |
| P0-28 (unknown-exception handling) | Wave-4 webhook handler must catch unknown webhook event types and enqueue ExceptionQueue entry. Reuses P0-28 infrastructure. | NONE — additive use of existing surface |
| P0-01 (capture) | Wave-4 retry-invariant mitigation MODIFIES the capture route (removes `captureRazorpayPayment()` from txn body). 3a evidence (3a-E1..3a-PG-E1) was generated with capture INSIDE txn body in DEMO mode. If retry-invariant mitigation is implemented, 3a evidence MUST be re-verified under the new flow. | 🟡 POTENTIAL REOPEN — see §8 for evidence strategy |
| P0-08 (order idempotency) | Wave-4 does NOT touch order route. | NONE |
| P0-08+ (C1 requestHash) | Wave-4 does NOT touch idempotency library. | NONE |
| P0-22 (audit) | Wave-4 adds new audit actions (WEBHOOK_*). Hash-chain preserved. | NONE — additive audit actions |
| P0-23 (kill switch) | Wave-4 does NOT touch kill switch. | NONE |

**Critical finding:** If Wave-4 implements the TRANSACTION_RETRY_INVARIANT mitigation (move capture to outbox publisher), **3a evidence MAY need re-verification** because the capture route's flow changes. However, the Orchestrator could decide that:
- (a) The mitigation is implemented but `realPayments` flag STAYS OFF → 3a evidence remains valid (demo-mode capture path is byte-identical).
- (b) The mitigation is implemented AND `realPayments` is flipped ON for a new evidence scenario → 3a evidence is insufficient; NEW Wave-4 evidence scenario (`4c-PG-E1: real-mode capture via publisher`) is required.

The Orchestrator should resolve this in D6 (see §12).

### 5.3 Hazards out of Wave-4 scope (per `docs/TRANSACTION_RETRY_INVARIANT.md`)

| Hazard | Wave-4 status |
|--------|---------------|
| ❌ Real Razorpay API calls in production | `realPayments` flag remains OFF. Wave-4 may implement retry-invariant mitigation but MUST NOT enable the flag. |
| ❌ Webhook signature verification in production | Webhook handler may be implemented but MUST NOT receive real production traffic until `RAZORPAY_WEBHOOK_SECRET` is configured AND the Orchestrator authorizes production webhook enablement. |
| ❌ `requestHashEnforcement` production ON | Flag remains OFF in production. Wave-4 does NOT enable it. |
| ❌ Move `captureRazorpayPayment()` outside txn body | IN SCOPE for Wave-4 (Option C — outbox publisher pattern). Required before `realPayments=true`. |
| ❌ Move `createRazorpayOrder()` outside txn body | IN SCOPE for Wave-4 (Option B — pre-generated idempotency key, Razorpay supports `X-Idempotency-Key` on `orders.create`). Optional but recommended. |

---

## 6. Proposed Implementation Scope

### 6.1 Wave-4 proposed scope (3 candidate items + 1 optional)

| # | Item | P0 | Priority | Effort | Risk | Recommended for Wave-4? |
|---|------|-----|----------|--------|------|-------------------------|
| 1 | **Webhook handler implementation** | P0-05 | PRIMARY | MEDIUM (~250-350 LOC: 1 new route + signature verify + dedup + processing logic) | MEDIUM | ✅ YES — explicitly deferred to Wave-4 |
| 2 | **P0-02 ledger formalization** | P0-02 | SECONDARY | LOW-MEDIUM (~150-250 LOC: evidence endpoints + balance-integrity test + audit report stub) | LOW | ✅ YES — IMPLEMENTATION_ORDER Wave 4 lists P0-02 |
| 3 | **TRANSACTION_RETRY_INVARIANT mitigation** | (cross-cutting; P0-01 + P0-24) | DEFENSE-IN-DEPTH | HIGH (~300-500 LOC: capture route refactor + publisher extension + idempotency check + 5 enforcement items from §8.2 of invariant doc) | HIGH | 🟡 OPTIONAL but STRONGLY RECOMMENDED if Wave-4 is intended to unblock `realPayments=true` |
| 4 | **`orphan_business_count` timestamp-filter fix** | (P0-24 sub-item) | LOW | LOW (~5-10 LOC: 1-line SQL change in alert-evaluator) | LOW | 🟡 OPTIONAL — production-launch prerequisite (Phase-3) |

**Total estimated scope: ~700-1100 LOC across 3-4 items.** Within reason for a single wave if sub-waved.

### 6.2 Sub-wave structure recommendation

Mirroring Wave-3's sub-wave pattern (3a/3b/3c each with separate authorization), Wave-4 should be split into sub-waves to allow independent authorization + evidence + closure:

| Sub-Wave | Scope | Authorization boundary |
|----------|-------|------------------------|
| **4a — Webhook handler (P0-05)** | Implement `POST /api/webhooks/razorpay` route with HMAC verification + idempotent processing via `WebhookEvent.eventId` unique constraint. Demo mode + real mode (gated by `realPayments`). | Single focused sub-wave; reuse of `verifyRazorpaySignature` from `razorpay.ts`; new `webhookHandler` feature flag default OFF. |
| **4b — P0-02 ledger formalization** | Evidence scenarios for balance integrity (Dr sum == Cr sum), no-orphan-ledger, no-phantom-ledger. Optional: ledger audit report stub. NO schema change. | Evidence-only sub-wave (similar to 3b); reuses 3a-evidence infrastructure pattern. |
| **4c — TRANSACTION_RETRY_INVARIANT mitigation** | Move `captureRazorpayPayment()` out of `withTransaction()` body into outbox publisher (Option C). Extend publisher to handle `PAYMENT_CAPTURE_REQUESTED` events. Optionally: pre-generated idempotency key for `createRazorpayOrder()` (Option B). 5 enforcement items from §8.2 of invariant doc (lint rule, code-review checklist, outbox publisher, CI grep-scan gate). | HIGH-risk sub-wave; touches money-critical path; required before `realPayments=true`. |
| **4d (optional) — orphan_business_count fix** | 1-line SQL change in `mini-services/alert-evaluator/index.ts:183-186`. | LOW-risk; can be merged into any of 4a/4b/4c or done as a separate small sub-wave. |

**Recommended Wave-4 structure:** 4a + 4b + 4c (with 4d folded into 4b or 4c). Total: 3 sub-waves + 1 folded fix.

### 6.3 Per-item implementation scope details

#### 6.3.1 P0-05 Webhook handler (4a)

| Component | File | Change | LOC (est.) | Risk |
|-----------|------|--------|------------|------|
| Webhook route | `src/app/api/webhooks/razorpay/route.ts` (NEW) | POST handler: (1) read raw body + `X-Razorpay-Event-Id` + `X-Razorpay-Signature` headers; (2) HMAC-SHA256 verify using `RAZORPAY_WEBHOOK_SECRET`; (3) dedup via `WebhookEvent.eventId` unique constraint (insert → if P2002, already processed → return 200); (4) if verified, mark `verified=true`, dispatch to event-type processor (`payment.captured` → update Payment + emit outbox; `payment.failed` → update Payment status; `refund.processed` → record but defer processing to Wave-5); (5) mark `processed=true`. All inside `withTransaction()` for atomicity. | ~200-300 | MEDIUM |
| Webhook signature verification | `src/lib/razorpay.ts` | Add `verifyWebhookSignature(payload, signature, secret)` function (similar to existing `verifyRazorpaySignature` but for webhook payload + secret). Use `crypto.createHmac('sha256', secret).update(payload).digest('hex')` with constant-time comparison. | ~30-40 | LOW |
| Webhook event processor | `src/lib/webhook-processor.ts` (NEW) | Route webhook event types to handlers: `payment.captured` → idempotent Payment update (status=CAPTURED, capturedAt); `payment.failed` → Payment status update + exception queue entry; `refund.processed` → log + defer to Wave-5. | ~80-120 | MEDIUM |
| Feature flag | `src/lib/deployment.ts` | Add `webhookHandler` flag (default OFF for first deploy; can be flipped ON after staging evidence passes). | ~5 | LOW |
| Evidence endpoints | `src/app/api/webhooks/evidence-setup/route.ts` + `evidence-verify/route.ts` (NEW) | Mirror 3a/3b/3c pattern: setup creates a test Payment in PAYMENT_PENDING status; verify checks WebhookEvent was created + Payment was updated. | ~150-200 | LOW |
| Evidence runner | `scripts/wave4-4a-evidence.mjs` (NEW) | SQLite scenarios: webhook-dedup (same event_id → 1 processing), signature-mismatch (rejected), out-of-order (handled), crash-recovery (webhook received but not processed → re-delivery). | ~200-300 | LOW |
| Staging workflow | `.github/workflows/subwave-4a-postgresql-concurrent-evidence.yml` (NEW) | PostgreSQL concurrency: 5 concurrent same-event-id webhooks → exactly 1 Payment update. | ~800 (mirror 3b pattern) | LOW |
| AuditLog entries | (in webhook route) | New actions: `WEBHOOK_RECEIVED`, `WEBHOOK_VERIFIED`, `WEBHOOK_PROCESSED`, `WEBHOOK_REJECTED`. All append-only, hash-chain preserved. | ~10 | LOW |
| Outbox events | (in webhook route) | Emit `PAYMENT_CAPTURE_CONFIRMED` outbox event for downstream consumers (consumers may include realtime update to vendor + alert evaluator). | ~15 | LOW |
| Schema extension (optional) | `prisma/schema.prisma` | Extend `WebhookEvent` with `processedBy String?` (worker ID) + `processingNotes String?` (failure reason if rejected). Class-2 additive. | ~5 | LOW |
| Migration SQL | `prisma/scripts/wave4-subwave-4a-migration.sql` (NEW) | `ALTER TABLE "WebhookEvent" ADD COLUMN "processedBy" TEXT; ADD COLUMN "processingNotes" TEXT;` Class-2 additive. | ~10 | LOW |

**Total 4a: ~510-810 LOC.** Estimated 1-2 days of focused implementation + 1 day evidence.

#### 6.3.2 P0-02 ledger formalization (4b)

| Component | File | Change | LOC (est.) | Risk |
|-----------|------|--------|------------|------|
| Evidence setup endpoint | `src/app/api/payments/evidence-setup/route.ts` (EXTEND) | Add `?scenario=ledger-balance` mode: creates a captured Payment with Dr/Cr pair, returns paymentId for verification. | ~30-50 | LOW |
| Evidence verify endpoint | `src/app/api/payments/evidence-verify/route.ts` (EXTEND) | Add `ledgerBalanceIntact: boolean` (Dr sum == Cr sum per Payment) + `noOrphanLedgerEntries: boolean` (every LedgerEntry has a Payment) + `ledgerEntryCount: number` to response. | ~40-60 | LOW |
| Evidence runner | `scripts/wave4-4b-evidence.mjs` (NEW) | 4 scenarios: (1) ledger-balance-intact (Dr sum == Cr sum), (2) no-orphan-ledger (every LedgerEntry has a Payment), (3) no-phantom-ledger (failed capture does NOT leave LedgerEntry rows — reuses 3a-E1 rollback injection), (4) idempotent-ledger (5-concurrent capture → exactly 2 LedgerEntries per Payment, no duplicates). | ~200-300 | LOW |
| Staging workflow | `.github/workflows/subwave-4b-postgresql-concurrent-evidence.yml` (NEW) | PostgreSQL concurrency: 5 concurrent captures → exactly 5 Payments, each with Dr/Cr pair (10 LedgerEntries total), no duplicates. | ~800 (mirror 3a pattern) | LOW |
| Ledger audit report stub (optional) | `src/app/api/admin/ledger-report/route.ts` (NEW, optional) | Returns ledger summary: total Dr, total Cr, balance check, count by accountType. Read-only. Admin-only. | ~80-120 | LOW |
| NO schema change | — | LedgerEntry schema is sufficient (Wave-3a). | 0 | NONE |
| NO migration | — | — | 0 | NONE |

**Total 4b: ~350-530 LOC.** Estimated 1 day implementation + 1 day evidence.

#### 6.3.3 TRANSACTION_RETRY_INVARIANT mitigation (4c) — HIGHEST RISK

| Component | File | Change | LOC (est.) | Risk |
|-----------|------|--------|------------|------|
| Capture route refactor | `src/app/api/payments/route.ts` | (1) REMOVE `captureRazorpayPayment()` call from inside `withTransaction()` body (line 160). (2) Instead, enqueue `PAYMENT_CAPTURE_REQUESTED` outbox event inside txn (so the event is committed atomically with Payment record). (3) Capture route returns immediately with `Payment.status = 'CAPTURE_PENDING'` (new status value) + the outbox event ID. (4) Client polls `/api/payments/<id>` for status (or receives webhook). | ~80-120 net change | HIGH |
| Payment status enum extension | `prisma/schema.prisma` | Add `CAPTURE_PENDING` to Payment.status comment (already a String column; no schema migration needed for enum value; just documentation update). | ~3 | LOW |
| Outbox publisher extension | `mini-services/outbox-publisher/index.ts` | (1) Add handler for `PAYMENT_CAPTURE_REQUESTED` event type. (2) Before calling `captureRazorpayPayment()`, check `Payment.status !== 'CAPTURED'` (idempotency). (3) Call `captureRazorpayPayment()` (now safely OUTSIDE any txn body). (4) On success: update Payment status to CAPTURED + capturedAt inside a NEW txn (atomic with AuditLog + Outbox event marking PUBLISHED). (5) On failure: increment Payment.retryCount, set failureReason, leave status as CAPTURE_PENDING (will be retried by publisher on next iteration). | ~150-200 | HIGH |
| Razorpay order create idempotency (Option B, optional) | `src/lib/razorpay.ts` + `src/app/api/payments/route.ts` | (1) Pre-generate idempotency key as `randomUUID()` BEFORE the txn. (2) Store it in Payment record (new column `gatewayOrderCreateKey String?`). (3) Pass to `createRazorpayOrder()` as `X-Idempotency-Key` header. This eliminates orphan-order leaks on retry. | ~50-80 | MEDIUM |
| Lint rule | `.eslintrc.local.js` (NEW) or custom rule | Error on any `await captureRazorpayPayment(` or `await createRazorpayOrder(` or `await fetch(` inside a `withTransaction(async (tx) => { ... })` body — unless allow-listed. | ~80-120 | MEDIUM |
| Code-review checklist | `docs/PAYMENT_CODE_REVIEW_CHECKLIST.md` (NEW) | Mandatory checklist for any PR touching `src/app/api/payments/` or `src/lib/razorpay.ts`. Cites `docs/TRANSACTION_RETRY_INVARIANT.md`. | ~80-120 (doc) | LOW |
| CI gate | `scripts/check-external-calls-in-txn.sh` (NEW) | Grep-scan `src/app/api/**/route.ts` for `captureRazorpayPayment(` / `createRazorpayOrder(` calls inside `withTransaction(` blocks. Fails the build if found outside the publisher. | ~50-80 | LOW |
| Evidence endpoints | `src/app/api/payments/evidence-setup/route.ts` (EXTEND) | Add `?scenario=capture-via-publisher` mode: simulate capture-via-publisher flow with `realPayments=false` (mock capture in publisher). | ~60-80 | MEDIUM |
| Evidence runner | `scripts/wave4-4c-evidence.mjs` (NEW) | 5 scenarios: (1) capture-via-publisher (capture call happens AFTER commit, in publisher), (2) publisher-crash-recovery (publisher crashes mid-capture; restart picks up event, idempotency check prevents double-capture), (3) capture-failure-retry (capture fails; Payment.retryCount incremented; status stays CAPTURE_PENDING; next publisher iteration retries), (4) concurrent-capture-attempts (5 concurrent capture requests → 5 Payments, 5 outbox events, 5 publisher-side captures — no double-capture), (5) realPayments-false-mode (demo mode still works; publisher returns mock capture). | ~300-400 | HIGH |
| Staging workflow | `.github/workflows/subwave-4c-postgresql-concurrent-evidence.yml` (NEW) | PostgreSQL concurrency: 5 concurrent captures → 5 Payments (CAPTURE_PENDING) → publisher processes 5 events → 5 Payments (CAPTURED). | ~800 (mirror 3a pattern) | MEDIUM |
| Migration | `prisma/scripts/wave4-subwave-4c-migration.sql` (NEW) | Add `gatewayOrderCreateKey String?` column to Payment (if Option B implemented). Class-2 additive nullable. | ~10 | LOW |
| Documentation update | `docs/TRANSACTION_RETRY_INVARIANT.md` §8 | Update enforcement status from "PARTIAL — documented in 3a" to "ENFORCED — Wave-4 4c mitigation complete". | ~20 (doc) | LOW |

**Total 4c: ~880-1230 LOC.** Estimated 2-3 days implementation + 1-2 days evidence. HIGHEST RISK sub-wave.

#### 6.3.4 `orphan_business_count` fix (4d — folded into 4b or 4c)

| Component | File | Change | LOC (est.) | Risk |
|-----------|------|--------|------------|------|
| Alert query fix | `mini-services/alert-evaluator/index.ts:183-186` | Add `AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")` to WHERE clause. | ~3 | LOW |
| Workflow update (if alert-evaluator is deployed via GitHub Actions) | (none — direct code change) | — | 0 | NONE |
| Test | (manual) | Verify alert does NOT fire on pre-outbox orders; DOES fire on post-outbox orphans. | ~10 (test) | LOW |

**Total 4d: ~13 LOC.** Can be folded into 4b or 4c as a small bonus fix.

---

## 7. Schema/Migration Impact

### 7.1 Per-sub-wave schema/migration class

| Sub-Wave | Schema change | Migration class | Risk |
|----------|---------------|------------------|------|
| **4a (Webhook handler)** | Extend `WebhookEvent` with `processedBy String?` + `processingNotes String?` (optional — current schema is sufficient for basic handler). | Class-2 expand-migrate-contract (additive nullable columns). | LOW |
| **4b (P0-02 ledger formalization)** | NONE — LedgerEntry schema is complete from Wave-3a. | NONE — no migration. | NONE |
| **4c (Retry-invariant mitigation)** | Add `gatewayOrderCreateKey String?` to Payment (if Option B for createRazorpayOrder is implemented). Status enum extension is documentation-only (status is a String column, not a PG enum). | Class-2 expand-migrate-contract (additive nullable column). | LOW |
| **4d (`orphan_business_count` fix)** | NONE — query change only. | NONE — no migration. | NONE |

### 7.2 Total Wave-4 schema delta

| Model | Change | LOC |
|-------|--------|-----|
| `WebhookEvent` (4a, optional) | +`processedBy String?`, +`processingNotes String?` | +2 |
| `Payment` (4c, optional Option B) | +`gatewayOrderCreateKey String?` | +1 |
| **Total** | | **+3 lines** (all additive nullable) |

**All Wave-4 schema changes are Class-2 expand-migrate-contract (additive nullable columns).** No breaking changes. No new indexes required (existing `WebhookEvent.eventId @unique` is the dedup key; existing `Payment.idempotencyKey @unique` is the capture-dedup key). Rollback is safe (drop the nullable columns).

### 7.3 Migration plan

| Migration | Applied to | Workflow |
|-----------|------------|----------|
| `prisma/scripts/wave4-subwave-4a-migration.sql` | staging Supabase ONLY | `.github/workflows/wave4-4a-staging-migration.yml` (NEW, mirror 3a pattern) |
| `prisma/scripts/wave4-subwave-4c-migration.sql` | staging Supabase ONLY | `.github/workflows/wave4-4c-staging-migration.yml` (NEW, mirror 3a pattern) |

**Production migrations:** NOT AUTHORIZED in Wave-4. Migration scripts are created and applied to staging ONLY. Production migration is a separate Orchestrator decision (likely Wave-5 or a dedicated production-cutover wave).

---

## 8. Evidence Requirements

### 8.1 Wave-4 NEW evidence scenarios

| Sub-Wave | Scenario | Dimension | What it proves | Reuses infra? |
|----------|----------|-----------|----------------|----------------|
| 4a-E1 | Webhook dedup (same event_id → 1 processing) | Idempotent webhook processing | `WebhookEvent.eventId` unique constraint prevents duplicate processing of replayed webhooks. | YES (mirror 3a-E1 rollback + 3b-E2 replay) |
| 4a-E2 | Webhook signature mismatch (tampered payload → 400 reject) | HMAC verification | Constant-time HMAC-SHA256 comparison rejects tampered payloads. | YES (mirror 3a-E3 conflict + new dimension: signature mismatch) |
| 4a-E3 | Webhook out-of-order (payment.failed arrives before payment.captured) | Event ordering | Webhook processor handles out-of-order events idempotently (status transition check via `Payment.version` optimistic lock). | YES (mirror 3b-E5 phantom-block) |
| 4a-E4 | Webhook crash-recovery (webhook received, marked unverified, re-delivered) | At-least-once delivery + idempotency | If webhook handler crashes after `WebhookEvent.create` but before `processed=true`, the re-delivered webhook is deduped via `eventId` unique constraint. | YES (mirror 2b-E3 crash recovery) |
| 4a-PG-E1 | 5 concurrent same-event_id webhooks on PostgreSQL | PostgreSQL concurrency | 5 concurrent webhook POSTs with same `X-Razorpay-Event-Id` → exactly 1 Payment update, 1 WebhookEvent, 1 AuditLog. | YES (mirror 3a-PG-E1 + 3b-PG-E1) |
| 4b-E1 | Ledger balance intact (Dr sum == Cr sum per Payment) | Double-entry integrity | For each Payment, sum of DEBIT entries equals sum of CREDIT entries. | YES (mirror 3a-5 atomicity) |
| 4b-E2 | No orphan ledger entries (every LedgerEntry has a Payment) | Referential integrity | `SELECT COUNT(*) FROM LedgerEntry le LEFT JOIN Payment p ON le.paymentId = p.id WHERE p.id IS NULL` returns 0. | YES (mirror 2d-4a orphan-business) |
| 4b-E3 | No phantom ledger (failed capture does NOT leave LedgerEntry rows) | Rollback atomicity | Failed capture (via `X-Evidence-Fail-After: ledger-dr` or `ledger-cr`) → 0 LedgerEntry rows for that Payment. | YES (mirror 3a-E1 rollback injection) |
| 4b-E4 | Idempotent ledger (5-concurrent capture → exactly 2 LedgerEntries per Payment, 10 total) | Concurrency + idempotency | 5 concurrent captures with different idempotency keys → 5 Payments, 10 LedgerEntries (Dr + Cr per Payment). No duplicates. | YES (mirror 3a-PG-E1) |
| 4b-PG-E1 | 5 concurrent captures on PostgreSQL → 10 LedgerEntries total | PostgreSQL concurrency | Same as 4b-E4 on staging PostgreSQL. | YES (mirror 3a-PG-E1) |
| 4c-E1 | Capture-via-publisher (capture call happens AFTER commit, in publisher) | Retry-invariant mitigation | `captureRazorpayPayment()` is called from the publisher (OUTSIDE any `withTransaction()` body). Capture route returns immediately with `Payment.status = 'CAPTURE_PENDING'`. | YES (mirror 3a-E2 replay + new dimension: publisher-side capture) |
| 4c-E2 | Publisher crash-recovery (publisher crashes mid-capture; restart picks up event, idempotency check prevents double-capture) | At-least-once + idempotency | If publisher crashes after `captureRazorpayPayment()` succeeds but before `Payment.status = 'CAPTURED'` commit, the restarted publisher's idempotency check (`Payment.status !== 'CAPTURED'`) prevents a second capture call. | YES (mirror 2b-E3 crash recovery + new dimension: gateway-side idempotency) |
| 4c-E3 | Capture failure retry (capture fails; Payment.retryCount incremented; status stays CAPTURE_PENDING; next publisher iteration retries) | Failure recovery | On capture failure (gateway 5xx), publisher increments `Payment.retryCount`, sets `failureReason`, leaves status as `CAPTURE_PENDING`. Next iteration retries with exponential backoff. | YES (mirror 2b-E1 transient retry) |
| 4c-E4 | Concurrent capture attempts (5 concurrent captures → 5 Payments, 5 outbox events, 5 publisher-side captures — no double-capture) | End-to-end concurrency | 5 concurrent POST /api/payments with different idempotency keys → 5 Payments (CAPTURE_PENDING), 5 outbox events, 5 publisher-side captures → 5 Payments (CAPTURED). No double-capture. | YES (mirror 3a-PG-E1) |
| 4c-PG-E1 | 5 concurrent captures on PostgreSQL → 5 Payments (CAPTURED) via publisher | PostgreSQL concurrency | Same as 4c-E4 on staging PostgreSQL. | YES (mirror 3a-PG-E1 + 3b-PG-E1) |
| 4c-E5 (optional) | `realPayments=false` demo mode still works (publisher returns mock capture) | Backward compatibility | With `realPayments=false`, publisher calls `captureRazorpayPayment()` which returns mock success. Payment.status transitions CAPTURE_PENDING → CAPTURED. | YES (mirror 3a demo mode) |

**Total NEW Wave-4 scenarios: 16 (5 for 4a + 5 for 4b + 6 for 4c).** All reuse the 3a/3b/3c evidence infrastructure pattern (evidence-setup + evidence-verify endpoints + SQLite evidence runner + PostgreSQL GitHub Actions workflow + self-validating JSON with `ok:true`).

### 8.2 CLOSED evidence that MUST NOT be re-run in Wave-4

| Sub-Wave | CLOSED scenarios | Why they stay CLOSED |
|----------|------------------|----------------------|
| 3a | 3a-E1, 3a-E2, 3a-E3, 3a-E4, 3a-PG-E1 | Wave-4 4a/4b/4c do NOT modify the 3a Payment capture flow (capture route's idempotency cache, Dr/Cr atomicity, demo-mode capture) — EXCEPT if 4c is implemented, which moves `captureRazorpayPayment()` out of the txn body. See §5.2 for re-verification strategy. |
| 3b | 3b-E1, 3b-E2, 3b-E3, 3b-E4, 3b-E5, 3b-PG-E1 | Wave-4 does NOT touch Order POST route. 3b evidence remains valid. |
| 3c | 3c-E1, 3c-E2, 3c-E3, 3c-E4, 3c-E5, 3c-PG-E1 | Wave-4 does NOT touch idempotency library. 3c evidence remains valid. |

### 8.3 3a re-verification strategy (if 4c is implemented)

If Wave-4 implements 4c (TRANSACTION_RETRY_INVARIANT mitigation), the 3a evidence flow changes:
- BEFORE 4c: `POST /api/payments` calls `captureRazorpayPayment()` INSIDE txn → Payment.status = CAPTURED immediately on response.
- AFTER 4c: `POST /api/payments` enqueues `PAYMENT_CAPTURE_REQUESTED` outbox event INSIDE txn → Payment.status = CAPTURE_PENDING on response → publisher processes event → `captureRazorpayPayment()` called by publisher → Payment.status = CAPTURED on publisher commit.

**Re-verification strategy:**

| Strategy | 3a evidence impact | Recommendation |
|----------|---------------------|----------------|
| (A) Implement 4c but keep `realPayments=false` in production. 3a evidence (demo mode) is re-generated under the new flow. | 3a evidence is INVALIDATED (capture route flow changed). NEW 4c-E5 (demo mode) covers this. 3a scenarios (3a-E1..3a-PG-E1) MUST be re-run under the new flow as 4c-E5. | 🟡 ACCEPTABLE — re-runs the 5 3a scenarios as 4c scenarios under the new flow. |
| (B) Implement 4c with `realPayments=false` flag. 3a evidence remains valid because the capture CALL is unchanged in demo mode (returns mock); only the LOCATION of the call changes (from route to publisher). | 3a evidence remains valid for the demo-mode flow. NEW 4c evidence covers the publisher-side flow. | ✅ RECOMMENDED — 3a evidence is byte-identical under demo mode (mock capture). 4c adds NEW evidence for publisher-side flow. |
| (C) Implement 4c AND flip `realPayments=true` for a NEW Wave-4 evidence scenario with real Razorpay test API keys. | 3a evidence is INVALIDATED for real mode (it was generated in demo mode). NEW 4c-PG-E2 (real-mode capture via publisher) is required. | ❌ NOT RECOMMENDED in Wave-4 — `realPayments=true` production enablement is a separate Orchestrator decision. Wave-4 may implement the code path but MUST NOT enable the flag. |

**Recommendation:** Strategy (B). 3a evidence stays valid for the demo-mode path; 4c adds NEW evidence for the publisher-side flow. If the Orchestrator later authorizes `realPayments=true` (Wave-5 or later), a NEW real-mode evidence scenario will be required at that time.

### 8.4 Self-validating JSON shape for Wave-4 evidence

```json
{
  "ok": true,
  "database": "postgresql",
  "subWave": "4a" | "4b" | "4c",
  "runId": "4a-pg-ev-<timestamp>-<rand>",
  "evidenceType": "webhook-concurrent-idempotency" | "ledger-balance-integrity" | "capture-via-publisher-concurrent",
  "test": "<scenario description>",
  "orchestratorRequiredFields": {
    "database": "postgresql",
    "concurrentRequests": 5,
    "<scenario-specific fields>": "..."
  },
  "invariant": {
    "<scenario-specific invariant>": true
  },
  "databaseState": { "..." },
  "responseSummary": { "..." },
  "expected": { "..." },
  "governance": {
    "realPaymentsEnabled": false,
    "requestHashEnforcementEnabled": false,
    "webhookHandlerEnabled": true,
    "productionDeployed": false,
    "productionMigrationApplied": false,
    "wave4SubWaveStarted": "4a" | "4b" | "4c",
    "wave5Started": false
  }
}
```

### 8.5 PostgreSQL-native concurrency requirement

**REQUIRED for all Wave-4 sub-waves** (same bar as 3a/3b/3c). SQLite-only evidence is NOT sufficient for S5 closure. Each sub-wave MUST have a `4x-PG-E1` PostgreSQL concurrency scenario on staging Supabase, with `ok:true, database: 'postgresql'`.

---

## 9. Production Impact

### 9.1 Production readiness gap AFTER Wave-4

| Dimension | Pre-Wave-4 | Post-Wave-4 (estimated) |
|-----------|------------|--------------------------|
| P0-05 (webhook handler) | 🔴 SCHEMA-ONLY | ✅ IMPLEMENTED + EVIDENCE-COMPLETE (staging) — NOT deployed to production |
| P0-02 (ledger formalization) | 🟡 PARTIAL (3a-5 atomicity only) | ✅ FORMAL S5 CLOSURE (balance-integrity evidence) |
| TRANSACTION_RETRY_INVARIANT | 🟡 DOCUMENTED, UNMITIGATED | ✅ MITIGATED (capture moved to publisher) — `realPayments` still OFF |
| `orphan_business_count` defect | 🟡 DEFECT (Phase-3 prereq) | ✅ FIXED (1-line SQL) |
| `realPayments` flag | 🚫 OFF | 🚫 STILL OFF (Wave-4 does NOT enable) |
| `requestHashEnforcement` flag | 🚫 OFF in production | 🚫 STILL OFF (Wave-4 does NOT enable) |
| `webhookHandler` flag | (does not exist) | 🚫 OFF (default; Wave-4 implements but does NOT enable) |
| Production migration | 🚫 NOT AUTHORIZED | 🚫 STILL NOT AUTHORIZED (Wave-4 staging only) |
| Production deployment | 🚫 NOT AUTHORIZED | 🚫 STILL NOT AUTHORIZED |
| Production env vars (RAZORPAY_KEY_ID, RAZORPAY_WEBHOOK_SECRET, snakzap_app role, etc.) | 🚫 NOT CONFIGURED | 🚫 STILL NOT CONFIGURED (operator/Orchestrator action) |
| Realtime service on Fly.io | 🚫 NOT DEPLOYED | 🚫 STILL NOT DEPLOYED (operator action) |
| DR drill | 🚫 NOT EXECUTED | 🚫 STILL NOT EXECUTED (Phase-3 launch gate) |

### 9.2 Migrations required for production (post-Wave-4, separate authorization)

| Migration | Applied to | Pre-condition | Post-condition |
|-----------|------------|---------------|----------------|
| `wave4-subwave-4a-migration.sql` (WebhookEvent extension) | Production Supabase | Wave-4 4a S5 PASS + Orchestrator production authorization | WebhookEvent has `processedBy` + `processingNotes` columns |
| `wave4-subwave-4c-migration.sql` (Payment extension) | Production Supabase | Wave-4 4c S5 PASS + Orchestrator production authorization | Payment has `gatewayOrderCreateKey` column (if Option B implemented) |

### 9.3 Feature flags required for production enablement (post-Wave-4)

| Flag | Default | Production enablement | Required for |
|------|---------|------------------------|--------------|
| `realPayments` | OFF | Separate Orchestrator decision (likely Wave-5 or production-cutover wave) | Real Razorpay API calls (capture, order create, refund) |
| `requestHashEnforcement` | OFF | Separate Orchestrator decision (deferred from 3c) | 422 on idempotency-key reuse with different body |
| `webhookHandler` (NEW in 4a) | OFF | Separate Orchestrator decision (likely Wave-5 or production-cutover wave) | Receiving real Razorpay webhooks |
| `outboxPublisher` | OFF | Already authorized for staging; production enablement requires Orchestrator decision | Outbox event delivery via Socket.io |
| `concurrencyControl` | OFF | Already authorized for staging; production enablement requires Orchestrator decision | Optimistic-lock enforcement |

### 9.4 Rollback strategy for production

| Scenario | Rollback procedure | Time | Safe? |
|----------|---------------------|------|-------|
| Webhook handler bug in production | Flip `webhookHandler` flag to OFF. Razorpay webhooks will return 404 (no route) — Razorpay will retry per their retry policy. No data corruption. | <1 min | ✅ YES (feature-flagged) |
| Capture-via-publisher bug in production | Flip `realPayments` flag to OFF. Capture route returns to demo-mode (mock capture in publisher). No real money movement. NOTE: This rollback does NOT revert the capture-route refactor (capture call is still in publisher); it only disables real-mode capture. | <1 min | ✅ YES (feature-flagged) |
| Ledger formalization evidence failure | NOT a production concern — 4b is evidence-only, no production code change. | N/A | ✅ N/A |
| `orphan_business_count` fix regression | Git revert + redeploy alert-evaluator. | <5 min | ✅ YES |
| Full Wave-4 production deploy | (1) Flip all flags OFF. (2) Git revert Wave-4 commits. (3) Drop nullable columns (if added). | <15 min | ✅ YES (Class-2 expand-migrate-contract, additive only) |

### 9.5 Is Wave-4 the final wave before production authorization?

**NO.** Wave-4 does NOT close all production-launch prerequisites. After Wave-4:

| Still required before production launch | Owner | Wave |
|------------------------------------------|-------|------|
| P0-04 (refund flow) | IDE | Wave-5 |
| P0-03 (reconciliation job) | IDE | Wave-5 |
| P0-06 (order state separation) | IDE | Wave-6 |
| P0-07 (state machine + pickup attribution) | IDE | Wave-7 |
| P0-26 DR drill execution | Orchestrator + operator | Phase-3 launch gate |
| Production env vars (RAZORPAY_KEY_ID, RAZORPAY_WEBHOOK_SECRET, snakzap_app role, etc.) | Orchestrator + operator | Phase-3 launch gate |
| Realtime service deployment to Fly.io | Operator | Phase-3 launch gate |
| `realPayments` production enablement | Orchestrator | Post-Wave-7 (after P0-07 closes critical path) |
| `requestHashEnforcement` production enablement | Orchestrator | Post-Wave-4 (deferred from 3c) |
| `webhookHandler` production enablement | Orchestrator | Post-Wave-4 (after Wave-5 reconciliation closes P0-03) |

**Wave-4 closes P0-05 + P0-02 + TRANSACTION_RETRY_INVARIANT mitigation.** Wave-5 will close P0-04 + P0-03. Wave-6 closes P0-06. Wave-7 closes P0-07 (critical path terminus). Production launch gate is post-Wave-7 + operator provisioning + Orchestrator sign-off.

---

## 10. Rollback Strategy

### 10.1 Per-sub-wave rollback

| Sub-Wave | Rollback procedure | Time | Safe by default? |
|----------|---------------------|------|------------------|
| **4a (Webhook handler)** | (1) Flip `webhookHandler` flag to OFF. (2) Git revert. (3) Drop nullable columns from WebhookEvent (safe — columns are nullable, not used by older code). | <10 min | ✅ YES |
| **4b (P0-02 ledger formalization)** | N/A — evidence-only sub-wave. No production code change. | N/A | ✅ N/A |
| **4c (TRANSACTION_RETRY_INVARIANT mitigation)** | (1) Flip `realPayments` flag to OFF (demo mode — publisher returns mock capture). (2) Git revert capture route + publisher changes. (3) Re-deploy. (4) Existing Payments in CAPTURE_PENDING state will need manual reconciliation (mark as CAPTURED if gateway confirms, or FAILED if gateway confirms failure). (5) Drop `gatewayOrderCreateKey` column (safe — nullable). | <15 min (code rollback); manual reconciliation for in-flight Payments | 🟡 MOSTLY — code rollback is safe; in-flight Payment reconciliation is manual |
| **4d (`orphan_business_count` fix)** | Git revert + redeploy alert-evaluator. | <5 min | ✅ YES |

### 10.2 Overall Wave-4 rollback

```text
Wave-4 rollback procedure:
  1. Flip feature flags OFF (webhookHandler, realPayments).
  2. Git revert Wave-4 commits (4a + 4b + 4c + 4d).
  3. Drop nullable columns (WebhookEvent.processedBy, WebhookEvent.processingNotes, Payment.gatewayOrderCreateKey).
  4. Re-deploy (Vercel preview + production if deployed).
  5. Manual reconciliation: any Payment with status=CAPTURE_PENDING must be checked against Razorpay dashboard.
     - If gateway shows captured → mark Payment.status=CAPTURED.
     - If gateway shows failed → mark Payment.status=FAILED.
     - If gateway shows no record → mark Payment.status=FAILED + enqueue ExceptionQueue entry.
  6. Verify rollback: smoke tests pass; no new webhook events processed; no new captures.
  7. Document rollback in worklog.
```

**Maximum rollback time:** ~30 minutes (code + redeploy + manual reconciliation of in-flight Payments).

---

## 11. Risk / Blast Radius

### 11.1 Overall Wave-4 risk level: **MEDIUM-HIGH**

| Risk dimension | Level | Justification |
|----------------|-------|---------------|
| Schema change risk | LOW | All changes are Class-2 additive nullable. No breaking changes. |
| API change risk | LOW | New routes (`/api/webhooks/razorpay`) + new error codes. No breaking changes to existing routes. |
| Code change risk | HIGH | 4c refactors the money-critical capture path. Bug in publisher could cause lost captures or duplicate captures. |
| Evidence risk | LOW | All scenarios reuse proven 3a/3b/3c infrastructure pattern. |
| Production risk | LOW | All changes are feature-flagged OFF by default. Production deployment is NOT authorized. |
| Rollback risk | MEDIUM | 4c rollback requires manual reconciliation of in-flight Payments. |
| Operational risk | MEDIUM | 4c introduces a new async dependency (publisher must process events for captures to complete). Monitoring of publisher lag becomes critical. |

### 11.2 Per-sub-wave risk + blast radius

| Sub-Wave | Risk | Blast radius | Mitigation |
|----------|------|--------------|------------|
| **4a (Webhook handler)** | MEDIUM | New endpoint (`/api/webhooks/razorpay`). If handler is buggy, webhooks are not processed → gateway-side capture events are lost → reconciliation will catch mismatches (Wave-5). Does NOT affect synchronous capture flow (capture route still works). | Feature flag (`webhookHandler`, default OFF). Staging-only evidence. Production enablement is separate decision. |
| **4b (P0-02 ledger formalization)** | LOW | Evidence-only. No production code change. No blast radius. | N/A |
| **4c (TRANSACTION_RETRY_INVARIANT mitigation)** | HIGH | Capture route refactor + publisher extension. If publisher fails to process `PAYMENT_CAPTURE_REQUESTED` events, captures are stuck in CAPTURE_PENDING. If publisher calls `captureRazorpayPayment()` twice (idempotency check fails), customer is double-charged. Blast radius = ALL payment captures. | Feature flag (`realPayments`, default OFF — publisher is in demo mode). Staging-only evidence. Production enablement is separate decision. Publisher idempotency check (`Payment.status !== 'CAPTURED'`). Monitoring: publisher lag + capture-failure-rate alerts. |
| **4d (`orphan_business_count` fix)** | LOW | Alert-evaluator query change. If regression, alert may fire incorrectly OR fail to fire on real orphans. Detection-only — no automatic repair. | Git revert. Staging verification before production deploy. |

### 11.3 Worst-case scenario

**Worst case:** Wave-4 4c is implemented, `realPayments` is enabled in production (NOT authorized in Wave-4, but hypothetically), and the publisher has a bug that causes it to call `captureRazorpayPayment()` twice for the same Payment.

**Impact:**
- Customer is charged twice for one order.
- Reconciliation (Wave-5 P0-03) would catch the mismatch (gateway shows 2 captures, ledger shows 1 Payment with 2 Dr/Cr pairs).
- Manual refund required (Wave-5 P0-04 refund flow not yet implemented — refund would need to be done via Razorpay dashboard manually).
- Reputation damage + potential chargeback.

**Mitigation:**
- `realPayments` flag MUST remain OFF in production until Wave-5 (refund) is implemented.
- Publisher idempotency check (`Payment.status !== 'CAPTURED'`) is the primary defense.
- Razorpay's gateway-side idempotency on captures (re-capturing an already-captured payment returns the original capture object) is a secondary defense — but NOT relied upon per `docs/TRANSACTION_RETRY_INVARIANT.md` §4.2.
- Monitoring: publisher lag alert, capture-failure-rate alert, double-capture detection alert (compare gateway captures vs ledger entries).

---

## 12. Decision Points

The Orchestrator must resolve the following decision points before authorizing Wave-4 implementation:

### D1 — Wave-4 scope (which items to include)

**Options:**
- (a) **Minimum scope:** 4a (webhook handler) ONLY. ~510-810 LOC. Single sub-wave. Mirrors Wave-3a scope.
- (b) **Recommended scope:** 4a + 4b + 4c. ~1740-2570 LOC. Three sub-waves. Mirrors Wave-3 (3a+3b+3c) structure.
- (c) **Extended scope:** 4a + 4b + 4c + 4d (orphan_business_count fix folded in). ~1753-2583 LOC. Three sub-waves + 1 small fix.
- (d) **Maximum scope:** 4a + 4b + 4c + 4d + early P0-04 (refund) prep. NOT recommended — refund requires Wave-5's reconciliation to be safe.

**Default recommendation:** (c) Extended scope — 4a + 4b + 4c + 4d. This closes the most P0s (P0-05, P0-02) AND mitigates the TRANSACTION_RETRY_INVARIANT hazard AND fixes the orphan_business_count defect. The 4d fix is essentially free (1-line SQL change).

### D2 — Sub-wave structure (should Wave-4 be split like Wave-3?)

**Options:**
- (a) **Single wave:** Implement all 4 items in one go. One S5 closure decision. ~2570 LOC. Risk: HIGH (4c touches money-critical path).
- (b) **Sub-wave structure (recommended):** 4a, 4b, 4c each gets separate READ/PLAN-FIRST Gate Review + implementation authorization + S5 closure. 4d folded into 4b or 4c. Mirrors Wave-3 governance model.

**Default recommendation:** (b) Sub-wave structure. Each sub-wave has independent authorization, evidence, and closure. 4c (HIGHEST RISK) gets its own Gate Review with extra scrutiny.

### D3 — PostgreSQL-native concurrency requirement (same bar as Wave-3?)

**Options:**
- (a) **YES (recommended):** Each sub-wave requires a `4x-PG-E1` PostgreSQL concurrency scenario on staging Supabase with `ok:true`. Same bar as 3a-PG-E1, 3b-PG-E1, 3c-PG-E1.
- (b) **NO:** SQLite-only evidence is sufficient. (NOT recommended — would regress the evidence bar set by Wave-3.)

**Default recommendation:** (a) YES. PostgreSQL-native concurrency is required for S5 closure. The Orchestrator's precedent in 3a (Option B) established this bar; Wave-4 must maintain it.

### D4 — Production readiness: is Wave-4 the final pre-production wave?

**Options:**
- (a) **YES:** Wave-4 is the final wave. Wave-5+ not needed. (NOT supported by evidence — P0-04, P0-03, P0-06, P0-07 are still LOCKED.)
- (b) **NO (recommended):** Wave-4 is NOT the final wave. Wave-5 (P0-04 refund + P0-03 reconciliation), Wave-6 (P0-06 state separation), Wave-7 (P0-07 state machine + pickup) are still required before production launch gate.

**Default recommendation:** (b) NO. Wave-4 closes 2 P0s (P0-05, P0-02) + mitigates 1 hazard. 4 P0s remain on the critical path (P0-04, P0-03, P0-06, P0-07). Production launch is post-Wave-7.

### D5 — Feature flag strategy for production enablement

**Options:**
- (a) **Wave-4 enables production flags:** `webhookHandler` flipped ON in production as part of Wave-4 closure. `realPayments` flipped ON. `requestHashEnforcement` flipped ON. (NOT recommended — production enablement is a separate decision with separate evidence requirements.)
- (b) **Wave-4 implements but does NOT enable (recommended):** All Wave-4 code paths are feature-flagged OFF in production. Staging evidence uses the flags (set to ON on staging Vercel preview only). Production enablement is a separate Orchestrator decision after Wave-5+ closure.

**Default recommendation:** (b) Implement but do NOT enable. Same pattern as 3c (`requestHashEnforcement` flag implemented but NOT enabled in production).

### D6 — 3a evidence re-verification strategy (if 4c is implemented)

**Options:**
- (a) **Re-run 3a evidence under new flow:** 3a-E1..3a-PG-E1 are re-run with the capture-via-publisher flow. 3a evidence files are superseded by 4c evidence files.
- (b) **Keep 3a evidence + add NEW 4c evidence (recommended):** 3a evidence remains valid for the demo-mode path (mock capture in route). 4c adds NEW evidence for the publisher-side flow. Both stay CLOSED.
- (c) **Invalidate 3a evidence + require 4c-PG-E2 (real-mode capture):** 3a evidence is invalidated because the capture route changed. 4c-PG-E2 is required with `realPayments=true` (real Razorpay test API keys). (NOT recommended — `realPayments=true` is a separate Orchestrator decision.)

**Default recommendation:** (b) Keep 3a evidence + add NEW 4c evidence. 3a demo-mode capture path is byte-identical (mock capture call, just moved from route to publisher). 4c adds NEW evidence for publisher-side flow + crash recovery + failure retry.

### D7 — Razorpay test API keys for staging evidence

**Options:**
- (a) **YES:** Orchestrator authorizes configuring `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET` on staging Vercel. Allows real-mode evidence scenarios in Wave-4.
- (b) **NO (recommended):** Wave-4 uses demo mode (`realPayments=false`). Real-mode evidence is deferred to a future wave (after Wave-5 refund flow is implemented, so any accidental double-charge can be refunded via the system).

**Default recommendation:** (b) NO. Wave-4 evidence uses demo mode. Real-mode evidence is deferred. This is consistent with the 3a approach (demo mode for staging evidence).

### D8 — `orphan_business_count` fix inclusion

**Options:**
- (a) **Include in Wave-4 (recommended):** 1-line SQL fix in `mini-services/alert-evaluator/index.ts:183-186`. Closes the WAVE2_FINAL_AUDIT Phase-3 prerequisite #1.
- (b) **Defer to Wave-5 or Phase-3 launch gate:** Keep the defect documented. Fix later.

**Default recommendation:** (a) Include in Wave-4 (folded into 4b or 4c as a small fix). The fix is trivial and closes a documented production-launch prerequisite.

### D9 — Webhook handler endpoint URL

**Options:**
- (a) `/api/webhooks/razorpay` (recommended): Conventional RESTful path. Razorpay dashboard configures this URL.
- (b) `/api/webhook/razorpay`: Singular form.
- (c) `/api/razorpay/webhook`: Vendor-first path.

**Default recommendation:** (a) `/api/webhooks/razorpay`. Conventional, matches REST resource naming.

### D10 — Webhook handler authentication model

**Options:**
- (a) **HMAC only (recommended):** Webhook endpoint is unauthenticated (no session cookie). HMAC signature verification is the sole authentication. Razorpay → server, no user session.
- (b) **HMAC + IP allowlist:** Add Razorpay's published IP ranges as an additional check. Defense-in-depth but requires maintaining IP list.

**Default recommendation:** (a) HMAC only. Razorpay's IP ranges are not guaranteed stable; HMAC is the canonical webhook authentication model. (Razorpay docs recommend HMAC verification as the primary auth.)

---

## 13. Recommendation

### **CONDITIONAL-GO**

### 13.1 Justification

Wave-4 is **feasible, well-scoped, and necessary** to advance SnakZap toward production. All proposed items (P0-05 webhook handler, P0-02 ledger formalization, TRANSACTION_RETRY_INVARIANT mitigation, `orphan_business_count` fix) have CLOSED predecessors and reuse proven Wave-2/3 infrastructure.

The CONDITIONAL qualifier reflects:
1. **Sub-wave structure is required** — 4c (HIGHEST RISK) must get its own Gate Review with extra scrutiny. Bundling 4c into a single Wave-4 implementation authorization is NOT recommended.
2. **`realPayments` flag MUST stay OFF** — Wave-4 implements the retry-invariant mitigation code path but does NOT enable real-mode captures.
3. **`webhookHandler` flag MUST stay OFF in production** — Wave-4 implements the handler but does NOT enable production webhook reception.
4. **`requestHashEnforcement` production enablement is OUT of Wave-4 scope** — deferred from 3c, requires separate authorization.
5. **PostgreSQL-native concurrency evidence is REQUIRED** — same bar as 3a/3b/3c.
6. **3a evidence re-verification strategy (D6)** must be resolved BEFORE 4c implementation begins. Default recommendation: keep 3a evidence + add NEW 4c evidence (Strategy B).
7. **Wave-4 is NOT the final wave** — P0-04, P0-03, P0-06, P0-07 remain LOCKED. Production launch is post-Wave-7.

### 13.2 Conditions for GO (must be honored by the Wave-4 implementation agents)

1. **Sub-wave structure:** Wave-4 is split into 4a, 4b, 4c (with 4d folded into 4b or 4c). Each sub-wave gets separate READ/PLAN-FIRST Gate Review + implementation authorization + S5 closure decision. Direct implementation of all 4 items in one authorization is NOT permitted.
2. **Schema changes are Class-2 expand-migrate-contract ONLY.** All additive nullable columns. NO breaking changes. NO new NOT NULL constraints. NO new indexes (existing `WebhookEvent.eventId @unique` is the dedup key). Migration applied to staging ONLY.
3. **Feature flags `webhookHandler` + `realPayments` + `requestHashEnforcement` MUST remain OFF in production.** Staging Vercel preview may have them ON during evidence runs.
4. **PostgreSQL-native concurrency evidence is REQUIRED for S5 closure of each sub-wave.** SQLite-only evidence is NOT sufficient.
5. **3a evidence MUST NOT be invalidated** (per D6 Strategy B). 4c adds NEW evidence for publisher-side flow; 3a evidence remains valid for demo-mode capture path.
6. **DO NOT enable `realPayments` in production.** Wave-4 implements the retry-invariant mitigation code path but does NOT flip the flag. Flag enablement is a separate Orchestrator decision (likely post-Wave-5, after refund flow is implemented so any accidental double-charge can be refunded via the system).
7. **DO NOT enable `webhookHandler` in production.** Wave-4 implements the handler but does NOT flip the flag. Production webhook reception requires `RAZORPAY_WEBHOOK_SECRET` env var (operator action) + Orchestrator authorization.
8. **DO NOT enable `requestHashEnforcement` in production.** Deferred from 3c. Separate Orchestrator decision.
9. **DO NOT modify `withTransaction()` retry semantics** (`src/lib/db.ts`). The retryable-conflict set (P2002/P1008/P2024/P2034/P2036) stays as-is. The new `IdempotencyKeyReuseError` (from 3c) remains non-retryable.
10. **DO NOT start Wave-5+ .** Wave-4 is the current wave. Wave-5 (P0-04 refund + P0-03 reconciliation) requires separate Orchestrator authorization after Wave-4 closure.
11. **DO NOT deploy to production.** Staging-only migrations + staging-only Vercel preview deployments for evidence.
12. **REUSE the 3a/3b/3c evidence infrastructure pattern.** Evidence-setup + evidence-verify endpoints, SQLite evidence runner, PostgreSQL GitHub Actions workflow, self-validating JSON with `ok:true`.
13. **HMAC signature verification MUST use constant-time comparison.** Reuse `verifyRazorpaySignature` pattern from `src/lib/razorpay.ts:79-102`.
14. **Webhook handler MUST write Payment + WebhookEvent + AuditLog + Outbox in same `withTransaction()` block.** Atomicity preserved (I-10).
15. **Publisher (4c) MUST check `Payment.status !== 'CAPTURED'` before calling `captureRazorpayPayment()`.** Idempotent consumer pattern (at-least-once delivery requires idempotent business effect).
16. **Wave-4 4c lint rule + CI gate MUST be implemented.** Per `docs/TRANSACTION_RETRY_INVARIANT.md` §8.2 items 2 + 5. This is the enforcement mechanism that prevents future regressions.

### 13.3 Why CONDITIONAL-GO (not GO)?

- The implementation is feasible (4 sub-waves, ~2570 LOC total, 3a/3b/3c-infra reuse, Class-2 migrations, feature-flagged). A GO would be appropriate if the Orchestrator is willing to accept the medium-high risk scope (4c touches money-critical path).
- The CONDITIONAL qualifier reflects the **HIGH risk of 4c** (capture route refactor + publisher extension + manual reconciliation on rollback) and the **sub-wave structure requirement** (each sub-wave needs separate authorization).

### 13.4 Why CONDITIONAL-GO (not NO-GO)?

- P0-05 (webhook handler) is explicitly deferred to Wave-4 by `SUBWAVE_3_GATE_REVIEW.md` + `WAVE3_EVIDENCE.md` §1. NOT implementing it would leave a documented gap.
- P0-02 (ledger formalization) is listed in `IMPLEMENTATION_ORDER.md` Wave 4 alongside P0-05. NOT closing it would leave a P0 in PARTIAL state.
- TRANSACTION_RETRY_INVARIANT mitigation is REQUIRED before `realPayments=true` can ever be authorized. Wave-4 is the natural place to do it (after 3a closed the capture flow + 3c closed idempotency).
- `orphan_business_count` fix is a 1-line SQL change that closes a documented production-launch prerequisite.
- All predecessors are CLOSED/S5. No blocking dependencies.
- The 3a/3b/3c evidence pattern is proven and reusable. No new infrastructure needed.
- Feature flags provide kill-switches — even after deploy, new code paths are dormant until explicitly enabled.
- The architectural invariant (`TRANSACTION_RETRY_INVARIANT.md`) is preserved — 4c MITIGATES the hazard rather than introducing new ones.

### 13.5 Next steps for Orchestrator decision

1. **Resolve Decision D1** (Wave-4 scope — recommended: 4a + 4b + 4c + 4d).
2. **Resolve Decision D2** (sub-wave structure — recommended: YES, 3 sub-waves + 4d folded in).
3. **Resolve Decision D3** (PostgreSQL-native concurrency — recommended: YES, same bar as Wave-3).
4. **Resolve Decision D4** (Wave-4 is NOT the final wave — recommended: NO, 4 more P0s remain).
5. **Resolve Decision D5** (feature flag strategy — recommended: implement but do NOT enable in production).
6. **Resolve Decision D6** (3a evidence re-verification — recommended: Strategy B, keep 3a + add NEW 4c).
7. **Resolve Decision D7** (Razorpay test API keys — recommended: NO, demo mode for staging evidence).
8. **Resolve Decision D8** (`orphan_business_count` fix — recommended: include in Wave-4).
9. **Resolve Decision D9** (webhook URL — recommended: `/api/webhooks/razorpay`).
10. **Resolve Decision D10** (webhook auth — recommended: HMAC only).
11. **Authorize Sub-Wave 4a implementation** (webhook handler — bounded scope, MEDIUM risk).
12. **DO NOT authorize production deploy. DO NOT enable `realPayments`. DO NOT enable `webhookHandler` in production. DO NOT enable `requestHashEnforcement` in production. DO NOT start Wave-5.**

---

## 14. Governance Compliance

This Gate Review was conducted under the Orchestrator's READ/PLAN-FIRST authorization for Wave-4. The following constraints were honored:

| Constraint | Status |
|-----------|--------|
| No source-code modification (`.ts` files) | ✅ HONORED — no `.ts` files were edited |
| No `prisma/schema.prisma` modification | ✅ HONORED — schema file unchanged |
| No migration files created | ✅ HONORED — no new SQL migration scripts |
| No evidence tests executed | ✅ HONORED — no test runs; only file reads + analysis |
| No production deploy | ✅ HONORED — production untouched |
| No `realPayments` enable | ✅ HONORED — `realPayments` flag unchanged (defaults to false, per `src/lib/deployment.ts:27`) |
| No `requestHashEnforcement` production enable | ✅ HONORED — flag remains OFF in production (per `src/lib/deployment.ts:47`); staging-only enablement from 3c remains |
| No `webhookHandler` flag added | ✅ HONORED — flag does NOT exist yet (Wave-4 4a implementation would add it, default OFF; this Gate Review only DESCRIBES the flag, does not create it) |
| No Wave-4 implementation start | ✅ HONORED — only this document produced |
| No Wave-5+ start | ✅ HONORED — Wave-5 remains LOCKED |
| No production access/change | ✅ HONORED — no production env vars modified, no production migrations, no production deploys |
| Files read, analyzed, and Gate Review document produced | ✅ DONE — see §14.1 for the file inventory |
| Worklog appended | ✅ DONE — appended as Task ID `wave4-gate-review` |

### 14.1 Files read for this Gate Review

| File | Lines | Purpose |
|------|-------|---------|
| `/home/z/my-project/worklog.md` (lines 4000-5492) | ~1492 | Wave-2 closure + Wave-3 closure (3a/3b/3c S5 PASS / CLOSED) — establishes that Wave-3 is fully closed, Wave-4 LOCKED |
| `/home/z/my-project/SUBWAVE_3_GATE_REVIEW.md` | 142 | Original Sub-Wave 3 Gate Review — has Wave-4/5 deferrals (webhook → Wave-4, refund → Wave-5, reconciliation → Wave-5) |
| `/home/z/my-project/SUBWAVE_3B_GATE_REVIEW.md` | 597 | 3b Gate Review — pattern reference for sub-wave structure |
| `/home/z/my-project/SUBWAVE_3C_GATE_REVIEW.md` | 823 | 3c Gate Review — C1 requestHash + cross-P0 closure analysis + 3a/3b evidence reuse pattern |
| `/home/z/my-project/WAVE3_EVIDENCE.md` | 1200 | Wave-3 evidence (3a §7, 3b §9, 3c §11-12) — confirms all sub-waves S5 PASS / CLOSED |
| `/home/z/my-project/WAVE2_EVIDENCE.md` | 511 | Wave-2 evidence (outbox, concurrency, exception queue) — context on reusable infrastructure |
| `/home/z/my-project/WAVE2_FINAL_AUDIT.md` | 234 | Wave-2 final audit — Phase-3 prerequisites + orphan_business_count defect |
| `/home/z/my-project/P0_TRACEABILITY_MAP.md` | 192 | P0 traceability — which P0s are closed, which are pending |
| `/home/z/my-project/P0_DEPENDENCY_GRAPH.md` | 408 | P0 dependencies — B-edges, F-nodes, P-edges |
| `/home/z/my-project/P0-27-PHASE2-REMEDIATION.md` | 566 | Phase 2 remediation — production deployment plan + carry-forward items |
| `/home/z/my-project/CRITICAL_PATH.md` | 408 | Critical path to launch — 7-edge critical path (P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-04 → P0-06 → P0-07) |
| `/home/z/my-project/IMPLEMENTATION_ORDER.md` | 298 | Implementation order — Wave 4 = P0-02 + P0-05 |
| `/home/z/my-project/PRODUCTION_READINESS_MATRIX.md` | 1024 | Production readiness matrix v1.4 — 7 launch-gate AND-conditions |
| `/home/z/my-project/STRATEGIC_FEATURE_MAPPING.md` | 242 | Strategic feature mapping — G-F1 finalization |
| `/home/z/my-project/DEV-001-CLOSURE.md` | 227 | PostgreSQL WORM boundary closure — P0-22 audit integrity |
| `/home/z/my-project/docs/TRANSACTION_RETRY_INVARIANT.md` | 537 | Architectural invariant — external gateway side-effect ≠ blind DB retry (5 enforcement items in §8.2 deferred to Wave-4) |
| `/home/z/my-project/docs/DR_RUNBOOK.md` | 216 | DR runbook — design only (Phase-3 launch gate) |
| `/home/z/my-project/docs/POSTGRESQL_CUTOVER_PLAN.md` | 310 | PostgreSQL cutover plan — snakzap_app role + snakzap_admin role |
| `/home/z/my-project/prisma/schema.prisma` | 432 | Full schema — verified WebhookEvent + LedgerEntry + Payment models exist from Wave-3a |
| `/home/z/my-project/src/lib/idempotency.ts` | 223 | Idempotency library — C1 requestHash (3c) confirmed implemented |
| `/home/z/my-project/src/lib/db.ts` | 176 | withTransaction — retryable conflicts P2002/P1008/P2024/P2034/P2036 confirmed |
| `/home/z/my-project/src/lib/deployment.ts` | 98 | Feature flags — `realPayments`, `requestHashEnforcement` confirmed OFF |
| `/home/z/my-project/src/lib/outbox.ts` | 108 | Outbox helper — `enqueueOutboxEvent` confirmed atomic with business write |
| `/home/z/my-project/src/lib/razorpay.ts` | 137 | Razorpay SDK — demo mode (realPayments=false) confirmed; `verifyRazorpaySignature` reusable for webhook HMAC |
| `/home/z/my-project/src/app/api/payments/route.ts` | 311 | Payment capture route — `captureRazorpayPayment()` at line 160 INSIDE withTransaction body (TRANSACTION_RETRY_INVARIANT hazard) |
| `/home/z/my-project/src/app/api/orders/route.ts` | 410 | Order POST route — C1 requestHash (3c) confirmed; no Wave-4 changes required |
| `/home/z/my-project/src/app/api/` (directory listing) | (LS) | Confirmed NO `/api/webhooks/*` route exists — webhook handler NOT implemented |

### 14.2 Confirmed governance state at end of this Gate Review

```text
Wave-0        ✅ CLOSED
Wave-1       ✅ CLOSED
Wave-2       ✅ CLOSED
Wave-3       ✅ CLOSED
              ├─ Sub-Wave 3a  ✅ S5 PASS / CLOSED — WILL NOT REOPEN
              ├─ Sub-Wave 3b  ✅ S5 PASS / CLOSED — WILL NOT REOPEN
              └─ Sub-Wave 3c  ✅ S5 PASS / CLOSED — WILL NOT REOPEN

Wave-4       🟡 READ/PLAN-FIRST GATE REVIEW COMPLETE
              ├─ Recommendation: CONDITIONAL-GO
              ├─ 10 decision points (D1-D10) for Orchestrator resolution
              ├─ Proposed sub-waves: 4a (webhook handler) + 4b (P0-02 ledger) + 4c (retry-invariant mitigation) + 4d (orphan_business_count fix)
              ├─ Implementation NOT started
              └─ No code/schema/migration/evidence changes made

Wave-5+      🔒 LOCKED — NOT AUTHORIZED
Production   🚫 NOT AUTHORIZED
realPayments 🚫 OFF (default false)
requestHashEnforcement (production) 🚫 OFF (default false; staging-only enablement from 3c)
webhookHandler 🚫 DOES NOT EXIST YET (Wave-4 4a implementation would add it, default OFF)
```

---

**End of Wave-4 READ/PLAN-FIRST Gate Review.**

**Recommendation: CONDITIONAL-GO.** Awaiting Orchestrator decision on the 10 decision points (D1-D10) and authorization to implement Wave-4 sub-waves (4a + 4b + 4c + 4d).

**STOP. No implementation started. No Wave-5 started. No production touched. `realPayments` OFF. `requestHashEnforcement` OFF in production. `webhookHandler` does not exist yet. Wave-4 implementation NOT authorized — only this Gate Review document has been produced.**
