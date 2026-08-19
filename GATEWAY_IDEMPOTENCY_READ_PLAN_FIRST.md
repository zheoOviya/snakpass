# Gateway Idempotency — READ/PLAN-FIRST Gate Review

> **Directive:** `GATEWAY-IDEMPOTENCY-READ-PLAN-FIRST-01`
> **Directive class:** READ/PLAN-FIRST governance gate (NO implementation authorized)
> **Date:** 2026-08-18
> **HEAD at review:** `1890fed52cef0b40da00bf2e4a6103b0b37ed947` (Firebase elimination complete)
> **Canonical baseline:** `80e628d` (Wave-5 5C) → `58fdb97` (Wave-9 READ/PLAN-FIRST) → `1890fed` (Firebase eliminated)
> **Document type:** Gate review (forensic audit + additive rebuild strategy + evidence plan + GO/NO-GO)

---

## 1. Executive Verdict

**CONDITIONAL GO** — the Gateway Idempotency Key can be safely rebuilt additively on the Wave-5 baseline without touching any Wave-5 closure boundary, M9/M10 prohibition, Gateway E9 frozen state, or Supabase auth platform.

**Key finding:** The rebuild requires **8 additive edits across 3 files** (`src/app/api/payments/route.ts`, `src/app/api/payments/refund/route.ts`, `mini-services/outbox-publisher/index.ts`, `src/lib/razorpay.ts`) — **zero schema migration**, zero new feature flags, zero Wave-5 file mutations. The `Outbox.payload` is a JSON string column that accepts new fields without schema change.

**What this GO does NOT authorize:**
- ❌ Implementation (NO code changes)
- ❌ Gateway E9 reopening (FROZEN — external/operator dependency)
- ❌ M9/M10 re-enqueue activation (PROHIBITED)
- ❌ S5 PASS / P0 CLOSED declarations
- ❌ Production GO

---

## 2. Phase-0 Baseline Verification

| Precondition | Status | Evidence |
|-------------|--------|----------|
| HEAD = `1890fed` | ✅ PASS | `1890fed52cef0b40da00bf2e4a6103b0b37ed947` |
| Git working tree clean | ✅ PASS | 0 uncommitted |
| Wave-5 5A/5B/5C immutable boundary | ✅ PASS | 18 "S5 PASS / CLOSED" mentions in WAVE5_EVIDENCE.md |
| M9/M10 re-enqueue PROHIBITED | ✅ PASS | 4× `reEnqueueProhibited: true` in reconciliation.ts:1983, 1992, 2383, 2392 |
| All production flags OFF | ✅ PASS | 8 flags defaulting false in deployment.ts |
| Firebase eliminated | ✅ PASS | 0 active source Firebase refs |
| Supabase sole auth platform | ✅ PASS | supabase.ts + supabase-admin.ts + /api/auth/supabase/session |
| Gateway E9 FROZEN | ✅ PASS | 0 `gatewayIdempotencyKey` refs in source (NOT IMPLEMENTED) |
| No orphan processes | ✅ PASS | Clean |

---

## 3. Forensic Audit — Current State (7 Touch-Points)

### A. Capture Route Outbox Event (`src/app/api/payments/route.ts`)

**Current payload** (lines 240-245):
```typescript
payload: {
  paymentId: payment.id,
  orderId: order.id,
  gatewayPaymentId: body.razorpayPaymentId,
  amount: order.totalAmount,
}
```
**gatewayIdempotencyKey:** ❌ ABSENT (4 fields, no key)

**Where to add:** Before the `enqueueOutboxEvent` call — generate `const gatewayIdempotencyKey = randomUUID()` and add `gatewayIdempotencyKey,` to the payload object.

### B. Refund Route Outbox Event (`src/app/api/payments/refund/route.ts`)

**Current payload** (lines 217-225):
```typescript
payload: {
  refundId: refund.id,
  paymentId: payment.id,
  orderId: payment.orderId,
  gatewayPaymentId: payment.gatewayPaymentId,
  amount: refundAmount,
  currency: payment.currency,
  fullRefund: refundAmount === payment.amount,
}
```
**gatewayIdempotencyKey:** ❌ ABSENT (7 fields, no key)

**Where to add:** Same pattern — generate UUID before enqueue, add to payload.

### C. Publisher Capture Handler (`mini-services/outbox-publisher/index.ts`)

**Current call** (lines 262-266):
```typescript
captureResult = await captureRazorpayPayment(
  gatewayPaymentId,
  payment.amount,
  payment.currency,
)
```
**idempotencyKey arg:** ❌ ABSENT (3 args, no 4th key arg)

**Where to add:** Read `payload.gatewayIdempotencyKey` from the outbox payload, pass as 4th arg.

### D. Publisher Refund Handler (`mini-services/outbox-publisher/index.ts`)

**Current call** (lines 587-591):
```typescript
refundResult = await refundRazorpayPayment(
  gatewayPaymentId,
  refund.amount,
  refund.currency,
)
```
**idempotencyKey arg:** ❌ ABSENT (3 args, no 4th key arg)

**Where to add:** Same pattern — read from payload, pass as 4th arg.

### E. Razorpay Function Signatures (`src/lib/razorpay.ts`)

| Function | Current signature | Missing param |
|----------|-------------------|---------------|
| `createRazorpayOrder()` (line 49) | `(amount, currency)` | `idempotencyKey?: string` |
| `captureRazorpayPayment()` (line 108) | `(razorpayPaymentId, amount, currency)` | `idempotencyKey?: string` |
| `refundRazorpayPayment()` (line 372) | `(razorpayPaymentId, amount, currency)` | `idempotencyKey?: string` |

**All 3 functions need an optional `idempotencyKey?: string` parameter.** When provided in real mode, it should be passed as:
- `createRazorpayOrder`: `X-Idempotency-Key` header on `instance.orders.create()`
- `captureRazorpayPayment`: `X-Idempotency-Key` header on `instance.payments.capture()`
- `refundRazorpayPayment`: `idempotency_key` field in refund request body

### F. Outbox Payload Structure (`prisma/schema.prisma`)

```prisma
payload String // JSON
```

**The payload is a JSON string column** — `enqueueOutboxEvent` accepts `payload: unknown` (`outbox.ts:41`). Adding `gatewayIdempotencyKey` to the JSON object requires **zero schema migration**.

### G. M9/M10 reEnqueueProhibited

4 occurrences at `reconciliation.ts:1983, 1992, 2383, 2392`:
```typescript
reEnqueueProhibited: true,
```

**MUST NOT be touched.** These are safety guards preventing M9/M10 remediation handlers from re-enqueuing capture/refund outbox events. They remain `true` even after the gateway key is added — the key closes the publisher-retry hole, NOT the reconciliation re-enqueue hole.

### H. TRANSACTION_RETRY_INVARIANT §8.2

| Item | Description | Status |
|------|-------------|--------|
| 1 | Code-review checklist | ❌ DEFERRED (out of scope) |
| 2 | ESLint rule | ❌ DEFERRED (out of scope) |
| 3 | Outbox publisher for PAYMENT_CAPTURE_REQUESTED | ✅ DONE (Wave-4 4c + Wave-5 5a) |
| **4** | **Pre-generated idempotency key for createRazorpayOrder()** | **❌ DEFERRED — THIS AUDIT'S TARGET** |
| 5 | CI gate grep-scan | ❌ DEFERRED (out of scope) |

**Item 4** is the primary target of the Gateway Idempotency rebuild. `createRazorpayOrder()` is currently called INSIDE `withTransaction` at `route.ts:115` — a P2034 retry would re-execute the order-creation HTTP call (orphan-order risk). The additive fix: generate a UUID before the txn + pass it as `X-Idempotency-Key` header so Razorpay deduplicates on retry.

### I. Application-Level vs Gateway-Level Idempotency

**NOT the same — they are complementary layers:**

| Dimension | Application-level (current) | Gateway-level (target) |
|-----------|---------------------------|----------------------|
| Layer | API route | Razorpay SDK call |
| Key source | `Idempotency-Key` HTTP header (client) | `crypto.randomUUID()` server-side |
| Storage | `IdempotencyKey` table | `Outbox.payload` JSON (additive field) |
| Dedup scope | Duplicate client request at API boundary | Duplicate publisher retry at gateway boundary |
| Retry loop | `withTransaction` P2002/P1008/P2024/P2034/P2036 | Publisher 1s/5s/30s/5min/15min backoff |

### J. withTransaction Retry Surface

5 retried Prisma codes (`db.ts:78-80`): P2034 (write conflict/deadlock), P2036 (txn timeout), P1008 (socket timeout), P2002 (unique constraint), P2024 (pool timeout).

**The retry loop re-executes the ENTIRE `fn` callback** — so any external HTTP call inside the body is re-executed on retry. `captureRazorpayPayment()` / `refundRazorpayPayment()` are already OUTSIDE the txn body (publisher Option C). `createRazorpayOrder()` remains INSIDE the txn body at `route.ts:115` — this is the §8.2 item 4 risk.

---

## 4. Additive Rebuild Strategy

### Principle: additive-only, zero schema migration, zero Wave-5 file mutation

The `Outbox.payload` is a JSON string column. Adding `gatewayIdempotencyKey` to the JSON object literal requires **zero Prisma migration**. The key is generated server-side (UUID), stored in the payload, and read by the publisher on each retry.

### 8 Additive Edits (across 3 source files + 1 razorpay lib):

| # | File | Edit | Additive? |
|---|------|------|-----------|
| 1 | `src/app/api/payments/route.ts` ~line 77 | Generate `const gatewayIdempotencyKey = randomUUID()` BEFORE `withTransaction` | ✅ additive |
| 2 | `src/app/api/payments/route.ts:240-245` | Add `gatewayIdempotencyKey,` to payload object | ✅ additive |
| 3 | `src/app/api/payments/route.ts:115` | Pass `orderCreateKey` to `createRazorpayOrder(amount, currency, orderCreateKey)` | ✅ additive (optional param) |
| 4 | `src/app/api/payments/refund/route.ts` ~line 67 + 217-225 | Same pattern for refund: generate UUID before enqueue + add to payload | ✅ additive |
| 5 | `mini-services/outbox-publisher/index.ts:262-266` | Read `payload.gatewayIdempotencyKey` + pass as 4th arg to `captureRazorpayPayment()` | ✅ additive |
| 6 | `mini-services/outbox-publisher/index.ts:587-591` | Read `payload.gatewayIdempotencyKey` + pass as 4th arg to `refundRazorpayPayment()` | ✅ additive |
| 7 | `src/lib/razorpay.ts:49, 108, 372` | Add optional `idempotencyKey?: string` param to all 3 functions | ✅ additive (optional param) |
| 8 | `src/lib/razorpay.ts:63, 123, 388` | Inject `X-Idempotency-Key` header / `idempotency_key` body when key provided (real mode only) | ✅ additive (conditional) |

### Legacy compatibility:

The publisher MUST use `payload.gatewayIdempotencyKey ?? undefined` — keyless legacy outbox rows (created before this rebuild) proceed WITHOUT a key (backward-compatible). No new feature flag needed — the key is always generated by default.

### Safety boundaries:

- **Wave-5 5A/5B/5C:** UNTOUCHED (no Payment/Refund/LedgerEntry/Outbox schema change)
- **M9/M10:** `reEnqueueProhibited` 4× intact (NOT touched)
- **Gateway E9:** FROZEN (E9 = real gateway dedup proof — still requires operator-supplied Razorpay TEST credentials)
- **Supabase auth:** SOLE platform (no Firebase reintroduction)
- **Schema:** UNCHANGED (Outbox.payload JSON accepts new field)
- **Feature flags:** NO new flag (key is always generated)

---

## 5. SQLite/PostgreSQL Compatibility + Evidence Strategy

### Compatibility:

The implementation is **database-agnostic** — `randomUUID()` is a Node.js `crypto` function (no DB dependency). The `Outbox.payload` JSON field is a `String` column on both SQLite and PostgreSQL. The `enqueueOutboxEvent` function accepts `payload: unknown` (no type constraint on the JSON structure).

### Evidence strategy:

| Evidence phase | Database | Method | E9 status |
|---------------|----------|--------|-----------|
| E1-E8 (SQLite) | SQLite (embedded) | `EVIDENCE_TEST_MODE=true` + local dev server | N/A (demo mode) |
| E8a-E8f (PostgreSQL) | PostgreSQL (embedded-postgres) | Controlled embedded PostgreSQL + dev server | N/A (demo mode) |
| E9 (real gateway) | N/A | Razorpay TEST-mode credentials | 🔒 BLOCKED (operator dependency) |

**E9 will BLOCK** — same as the previous (lost) session. The Orchestrator's governance rule: *"E9 PASS required before M9/M10 retry-safety can be authorized."* The gateway idempotency key can be IMPLEMENTED + EVIDENCED (E1-E8 + PostgreSQL) without E9, but E9 (real gateway dedup proof) remains an external dependency.

### Acceptance criteria for EVIDENCE gate (NOT this gate):

- E1: Key generated (UUID) + persisted in outbox payload
- E2: Key deterministic (same key on repeated reads)
- E3: Publisher reads key from payload + passes to gateway function
- E4: Publisher does NOT regenerate key on retry (reads from persisted payload)
- E5: Refund key separate from capture key
- E6: Publisher passes refund key to refundRazorpayPayment
- E7: Legacy keyless outbox rows compatible (`?? undefined` fallback)
- E8: PostgreSQL persistence (key in payload JSON, stable across retry)
- E9: Real gateway dedup (BLOCKED — external dependency)

---

## 6. Safety Invariants

| ID | Invariant | How preserved |
|----|-----------|---------------|
| GI-SI-01 | Wave-5 5A/5B/5C closures untouched | No Payment/Refund/LedgerEntry/Outbox schema change |
| GI-SI-02 | M9/M10 re-enqueue PROHIBITED | 4× `reEnqueueProhibited: true` intact (NOT touched) |
| GI-SI-03 | Gateway E9 FROZEN | No credential fabrication; E9 BLOCKED accepted |
| GI-SI-04 | Application-level idempotency (P0-17) preserved | Gateway key is complementary, NOT replacement |
| GI-SI-05 | External calls OUTSIDE withTransaction | createRazorpayOrder moves key generation OUTSIDE txn body (key generated before txn, passed in) |
| GI-SI-06 | Legacy outbox compatibility | `payload.gatewayIdempotencyKey ?? undefined` fallback |
| GI-SI-07 | No new feature flag | Key is always generated by default (no flag needed) |
| GI-SI-08 | No schema migration | Outbox.payload JSON accepts new field |
| GI-SI-09 | Supabase sole auth platform | No Firebase reintroduction |
| GI-SI-10 | All production flags remain OFF | No flag activation |

---

## 7. GO / NO-GO Recommendation

### **CONDITIONAL GO**

The Gateway Idempotency Key can be safely rebuilt additively. The conditions:

1. 🔒 Additive-only (8 edits, zero schema migration, zero Wave-5 file mutation)
2. 🔒 Legacy compatibility (`?? undefined` fallback for keyless outbox rows)
3. 🔒 No new feature flag (key always generated)
4. 🔒 External calls remain OUTSIDE withTransaction (key generated before txn, passed in)
5. 🔒 M9/M10 reEnqueueProhibited NOT touched (4× intact)
6. 🔒 Gateway E9 remains FROZEN (E9 BLOCKED on operator credentials — accepted)
7. 🔒 Supabase sole auth platform (no Firebase reintroduction)
8. 🔒 Evidence gate required (E1-E8 SQLite + PostgreSQL) before any S5 PASS claim
9. 🔒 E9 (real gateway dedup) remains BLOCKED — does NOT block implementation, but blocks M9/M10 retry-safety authorization

### Proposed implementation directive:

**`GATEWAY-IDEMPOTENCY-IMPLEMENT-01`** — authorize the 8 additive edits across 4 files.

### What this GO does NOT authorize:

- ❌ Wave-6 (P0-06) — NOT started
- ❌ Wave-7 (P0-07) — NOT started
- ❌ M9/M10 re-enqueue — LOCKED
- ❌ Gateway E9 reopening — FROZEN
- ❌ Production deployment — NOT AUTHORIZED
- ❌ S5 PASS — requires separate evidence gate

---

## 8. STOP State

- ✅ No application code changed
- ✅ No schema changed
- ✅ No migration created
- ✅ No flags changed (all 8 remain OFF)
- ✅ No deployment
- ✅ No Gateway E9 execution
- ✅ No M9/M10 retry
- ✅ git working tree clean

### Canonical state:

```text
Wave-5 5C                     ✅ CLOSED
Firebase                      ✅ ELIMINATED
Supabase                      ✅ SOLE AUTH PLATFORM

Gateway Idempotency           ❌ NOT IMPLEMENTED (additive rebuild plan ready)
  E9                          🔒 FROZEN / UNVERIFIED (external dependency)
  M9/M10                      🚫 PROHIBITED (4× reEnqueueProhibited: true)

P0-06                         ⚠️ REQUIRES REBUILD
P0-07                         ⚠️ REQUIRES REBUILD
I-13                          ❌ NOT VERIFIED

Production                    🚫 NOT AUTHORIZED

GATEWAY READ/PLAN-FIRST       ✅ COMPLETE (CONDITIONAL GO)
Implementation                🔒 NOT AUTHORIZED (requires separate GATEWAY-IDEMPOTENCY-IMPLEMENT-01)

IDE                           🛑 STOPPED
```

---

**End of Gateway Idempotency READ/PLAN-FIRST gate review. IDE STOPPED.**
