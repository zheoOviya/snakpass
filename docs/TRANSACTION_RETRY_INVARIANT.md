# Transaction Retry Architectural Invariant

**Document ID:** `3a-arch-doc`
**Author:** Architectural Documentation Specialist
**Wave/Sub-Wave:** Wave-3 / Sub-Wave 3a (PROVISIONAL PASS — evidence completion phase)
**Status:** IMPLEMENTED / VERIFIED — Wave-4 4c S5 PASS / CLOSED + Wave-5 5a S5 PASS / CLOSED. `captureRazorpayPayment()` and `refundRazorpayPayment()` are both OUTSIDE any `withTransaction()` body (deferred to the outbox publisher — Option C). Publisher retry idempotency empirically proven (4c-E5: second publisher run skips capture call; 5a-E5: second publisher run skips refund call; 5a-E6: publisher failure → retry success → no duplicate refund and no duplicate ledger reversal). Full enforcement mechanism (lint rule / code-review checklist / CI gate) remains post-production scope.
**Related worklog entries:** `3a-evidence`, `Task 89 (Sub-Wave 3a Implementation)`, `4c-evidence`, `5a-evidence`, `5a-e6-postgresql`.

---

## 1. The Invariant

```text
External gateway side-effect    ≠    blind database transaction retry
```

Any call that produces an observable side-effect outside the database
transaction (Razorpay capture, payment order creation, SMS, email, push
notification, webhook send, third-party API call, etc.) **must not** be
blindly re-executed by the `withTransaction()` retry loop in
`src/lib/db.ts`. The retry loop is **only** allowed to re-run work that is
**fully idempotent at the database layer** (re-runnable reads + writes
protected by unique constraints or optimistic-lock version checks).

If a non-idempotent external call is ever placed inside the transaction
body that `withTransaction()` retries, a database conflict retry
(P2002 / P1008 / P2024 / P2034 / P2036) will silently re-fire the
external call. For payment capture this means **catastrophic duplicate
charges**:

```text
DB transaction begins
    ↓
Razorpay capture succeeds          ← real money moved
    ↓
DB write fails (P2002 / P1008 / …)
    ↓
withTransaction() retries the WHOLE body
    ↓
Razorpay capture called AGAIN       ← duplicate charge
```

This invariant exists **today**, in demo mode, as a forward-looking
contract. It MUST be respected before `realPayments` is ever flipped on.

---

## 2. The Retry Mechanism That Makes This Dangerous

`src/lib/db.ts` exposes `withTransaction(fn, options?)`. It wraps
`prisma.$transaction(fn, { timeout, maxWait })` and, on certain Prisma
error codes, **re-invokes `fn` from the top**, up to `MAX_RETRIES = 5`
times, with exponential backoff (50ms base).

### 2.1 Retryable error codes (as of Sub-Wave 3a evidence run)

File: `src/lib/db.ts`, function `isRetryableConflict()`,
lines **62–83**:

```ts
function isRetryableConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: write conflict / deadlock (PostgreSQL)
    // P2036: Transaction timeout
    // P1008: Socket timeout (SQLite write-lock queue)
    // P2002: Unique constraint violation (idempotency-keyed writes)
    // P2024: Timed out fetching a connection from the pool
    return error.code === 'P2034' || error.code === 'P2036' ||
           error.code === 'P1008' || error.code === 'P2002' ||
           error.code === 'P2024'
  }
  return false
}
```

The set grew during the 3a evidence run: **P2002, P1008, P2024** were
added (worklog `3a-evidence`, line 4856) so that concurrent same-key
payment captures would not surface 500s to the client. This expansion
**widens the retry surface** and is the proximate reason this document
exists.

### 2.2 Why the retry is safe FOR DATABASE WRITES

Every retried route begins its transaction body by calling
`getCachedResponse(tx, idempotencyKey)` from `src/lib/idempotency.ts`
(lines **40–54**). On retry, if a sibling transaction already committed
a record under the same `Idempotency-Key`, the cache hit short-circuits
the body and returns the cached response. The `Payment.idempotencyKey`
unique constraint (P0-25 Case C) is the backstop: a duplicate insert
throws P2002, which `isRetryableConflict()` swallows and retries, after
which `getCachedResponse()` finds the now-committed row.

This is a clean, idempotent retry path **for pure database work**.

### 2.3 Why the retry is NOT safe FOR EXTERNAL CALLS

External calls (Razorpay HTTP, SMS, email, webhooks) are **not** inside
the `IdempotencyKey` table. They are **not** protected by a database
unique constraint. They are **not** automatically deduplicated by
re-running `getCachedResponse()`. So when the transaction body retries:

- The DB writes get deduplicated by the idempotency cache / unique
  constraint.
- The external calls get fired **again**, in full, against the real
  external system.

For payment capture, this means: **the customer is charged twice for one
order**. There is no automatic compensation.

---

## 3. Current Code Analysis

### 3.1 The capture route — `src/app/api/payments/route.ts`

The `POST /api/payments` handler is **one big `withTransaction()` block**.
The relevant call sites:

| Line | Call | External? | Inside `withTransaction` body? |
|------|------|-----------|--------------------------------|
| 77   | `getCachedResponse(tx, idempotencyKey)` | No  | Yes |
| 85   | `tx.order.findUnique(...)`               | No  | Yes |
| 110  | `createRazorpayOrder(...)`               | **YES** (when `realPayments=true`) | **YES** |
| 115  | `verifyRazorpaySignature(...)`          | No (pure crypto) | Yes |
| 123  | `tx.payment.create({ status: 'FAILED' })` | No  | Yes |
| 138  | `tx.auditLog.create(...)`               | No  | Yes |
| 155  | `captureRazorpayPayment(...)`           | **YES** (when `realPayments=true`) | **YES** |
| 169  | `tx.payment.create({ status: 'CAPTURED' })` | No  | Yes |
| 188  | `tx.order.update({ status: 'PAID' })`   | No  | Yes |
| 197  | `tx.ledgerEntry.create({ DEBIT })`      | No  | Yes |
| 211  | `tx.ledgerEntry.create({ CREDIT })`      | No  | Yes |
| 225  | `tx.auditLog.create(...)`               | No  | Yes |
| 238  | `enqueueOutboxEvent(tx, ...)`           | No  | Yes |
| 268  | `storeIdempotencyRecord(tx, ...)`       | No  | Yes |

**Two external calls are inside the retryable transaction body:**

1. `createRazorpayOrder(...)` — line **110** (conditional: only when
   `order.payment?.gatewayOrderId` is missing on the first attempt).
2. `captureRazorpayPayment(...)` — line **155** (always, on the happy
   path).

### 3.2 The Razorpay SDK wrapper — `src/lib/razorpay.ts`

Both external calls are gated by the `realPayments` feature flag
(`src/lib/deployment.ts` line 27: `getFlag('real-payments', false)` —
**defaults to false**).

- **Demo mode (`realPayments=false`, the current default):**
  - `createRazorpayOrder()` returns a mock order ID string
    (`order_demo_<ts>_<rand>`) — lines 53–60.
  - `captureRazorpayPayment()` returns a mock success — lines 113–120.
  - **No real HTTP is performed.** Retries are harmless from the
    gateway's perspective.

- **Real mode (`realPayments=true`, NOT yet authorized in 3a):**
  - `createRazorpayOrder()` calls `instance.orders.create(...)` —
    line 63. Razorpay's `orders.create` endpoint is **NOT idempotent**;
    no `X-Idempotency-Key` header is forwarded.
  - `captureRazorpayPayment()` calls `instance.payments.capture(...)` —
    line 123. The Razorpay API does not currently receive an
    idempotency key from this code path either.

### 3.3 The idempotency library — `src/lib/idempotency.ts`

The library protects **database rows** keyed by the `Idempotency-Key`
header. It does **not** protect external HTTP calls:

- `getCachedResponse(tx, key)` (lines 40–54): reads `IdempotencyKey`
  table. Pure DB.
- `storeIdempotencyRecord(tx, key, ...)` (lines 63–82): inserts into
  `IdempotencyKey` table inside the same transaction. Pure DB.

The library is intentionally narrow. It cannot know about gateway-side
state, and it must not be relied on as a backstop for external
side-effects.

### 3.4 The outbox library — `src/lib/outbox.ts`

`enqueueOutboxEvent(tx, event)` (lines 55–72) writes a row to the
`Outbox` table **inside the current transaction**. The row is only
visible after commit. A separate publisher process is then responsible
for reading `PENDING` rows and delivering them (over Socket.io, HTTP,
etc.) — see header comment lines 1–35 and the
`EVENT_TYPE_TO_SOCKET_EVENT` map at lines 103–107.

This is the canonical pattern for **deferring** an external side-effect
to **after commit**, decoupling it from the retryable transaction body.
See §5 and §6 below.

---

## 4. Current Safety Posture

### 4.1 SAFE today (demo mode)

Today, in Sub-Wave 3a, the invariant is **not violated in practice**,
because:

1. The `realPayments` feature flag defaults to `false`
   (`src/lib/deployment.ts` line 27).
2. In demo mode, `createRazorpayOrder()` and `captureRazorpayPayment()`
   return mock responses without any real HTTP
   (`src/lib/razorpay.ts` lines 53–60, 113–120).
3. The transaction body can therefore be retried freely — there is no
   external system to double-fire against.

The Sub-Wave 3a evidence run (worklog `3a-evidence`, lines 4858–4870)
empirically confirmed this: 5 concurrent same-key captures produced
exactly 1 Payment, 2 LedgerEntries, 1 Outbox row — the retry path was
exercised and produced no duplicates.

### 4.2 LATENT RISK if `realPayments=true` is ever enabled

The moment `realPayments` is flipped to `true`, the current code becomes
**invariant-violating** because both `createRazorpayOrder()` (line 110)
and `captureRazorpayPayment()` (line 155) sit **inside** the
`withTransaction()` body that retries on P2002/P1008/P2024/P2034/P2036.

Concretely:

- **`captureRazorpayPayment()` (line 155)** — the catastrophic case.
  A transaction that succeeds at the gateway call but then fails on a
  later DB write (e.g., a P2002 on `Payment.idempotencyKey` from a
  sibling transaction that committed in the meantime, or a P1008 socket
  timeout on the LedgerEntry write) will retry the whole body, calling
  `instance.payments.capture(...)` again. **The customer is charged
  twice.**
- **`createRazorpayOrder()` (line 110)** — a minor leak rather than a
  duplicate charge. Each retry creates a new Razorpay order object on
  the gateway (Razorpay `orders.create` is not idempotent without an
  `X-Idempotency-Key` header, which the current code does not pass).
  Orphan orders accumulate on the Razorpay dashboard. Money is not
  moved, so the customer is not harmed, but reconciliation becomes
  noisy and the gateway may rate-limit the account.

**Razorpay's gateway-side idempotency on captures** is a partial
mitigation that we **explicitly refuse to rely on**:
re-capturing an already-captured payment typically returns the original
capture object rather than charging again, but this is gateway-internal
behavior, not a contract we control. For other gateway operations
(SMS, email, webhook sends), there is no such implicit deduplication
at all. The invariant must be enforced at the application layer.

### 4.3 Summary table

| Concern                                      | Demo mode (current) | Real mode (if enabled today) |
|----------------------------------------------|:-------------------:|:----------------------------:|
| Duplicate capture charge on retry            | N/A (no real call)  | **VIOLATES invariant**        |
| Orphan Razorpay orders on retry              | N/A (no real call)  | Minor leak (no money lost)    |
| DB-write idempotency on retry                | ✅ Held              | ✅ Held (idempotency cache)    |
| Outbox event atomicity                       | ✅ Held              | ✅ Held                        |
| Audit log atomicity                          | ✅ Held              | ✅ Held                        |

---

## 5. The Rule (mandatory for future code changes)

When adding **any** external side-effect near a `withTransaction()`
block, the call MUST be placed in **one** of the three configurations
below. Any other placement violates this invariant.

### Option A — After commit (call site OUTSIDE the transaction body)

Use when the side-effect is **only** allowed to fire if the business
write committed, and when it is acceptable for the side-effect itself
to fail without rolling back the business write (failure of the
side-effect is monitored, not rolled back).

```ts
const result = await withTransaction(async (tx) => {
  // ... pure DB writes only ...
  return { paymentId: payment.id }
})

// External call AFTER commit. Will not be retried by withTransaction().
await sendSms(customer.phone, `Order ${result.paymentId} confirmed`)
```

⚠️ **Risk**: if the process crashes between commit and the side-effect,
the side-effect is lost. For side-effects that must not be lost, use
Option C (outbox).

### Option B — Idempotent at the gateway (pre-generated idempotency key)

Use when the external API natively supports an idempotency key (e.g.,
Stripe, Razorpay on certain endpoints). The idempotency key is
generated **before** the transaction starts and is stored in the
database inside the transaction. The external call may be placed inside
or outside the body — the gateway itself deduplicates.

```ts
const idempotencyKey = randomUUID()
await withTransaction(async (tx) => {
  // Store the key FIRST so a retry finds it.
  await tx.externalCallLog.create({
    data: { key: idempotencyKey, kind: 'CAPTURE', paymentId, status: 'IN_FLIGHT' }
  })
  // ... other DB writes ...
})

// External call uses the same key. Gateway deduplicates on retry.
await instance.payments.capture(paymentId, amount, currency, {
  headers: { 'X-Idempotency-Key': idempotencyKey }
})
```

⚠️ **Constraint**: this requires the gateway to actually honor the
idempotency key (read the gateway docs — do not assume). Razorpay
supports idempotency keys on **some** endpoints; verify per-endpoint.

### Option C — Transactional Outbox (CANONICAL solution)

Use when the side-effect MUST happen if and only if the transaction
committed, and MUST survive process crashes. The external call is
**deferred** to a publisher that runs **after commit**, reading from the
`Outbox` table. This is the pattern implemented in
`src/lib/outbox.ts`.

```ts
await withTransaction(async (tx) => {
  const payment = await tx.payment.create({ /* ... */ })
  await enqueueOutboxEvent(tx, {
    eventType: 'PAYMENT_CAPTURE_REQUESTED',
    aggregateType: 'Payment',
    aggregateId: payment.id,
    payload: { paymentId: payment.id, amount: payment.amount, currency: 'INR' }
  })
})

// The publisher (separate process / scheduled task) reads PENDING rows
// from Outbox, calls captureRazorpayPayment(...), then marks the row
// PUBLISHED. On crash, the row is re-delivered (at-least-once).
```

The publisher must additionally be made idempotent (e.g., check the
payment's `status` field before calling capture; skip if already
`CAPTURED`), because at-least-once delivery can still fire the same
event twice if the publisher crashes between the capture call and the
`PUBLISHED` status update.

**Option C is the recommended default** for SnakZap. It already exists
for `PAYMENT_CAPTURED` (route.ts line 238) and `ORDER_CREATED` /
`ORDER_STATUS_CHANGED` / `KILL_SWITCH_TOGGLED`
(see `EVENT_TYPE_TO_SOCKET_EVENT` in `outbox.ts` lines 103–107).

---

## 6. The Outbox Pattern — Canonical Reference

File: `src/lib/outbox.ts`

The outbox pattern solves the dual problem of atomicity + external
delivery:

| Failure point                                      | Outcome                                                  |
|----------------------------------------------------|----------------------------------------------------------|
| Business write fails → outbox insert never commits | No orphan event, no phantom entity. ✅                    |
| Outbox insert fails → business write rolls back    | No phantom event without a business entity. ✅            |
| Both succeed → process crashes before commit       | Entire transaction rolls back. ✅                         |
| Both succeed → commit succeeds → publisher crashes | Event row persists; publisher picks it up on restart. ✅ |

The contract enforced by `enqueueOutboxEvent(tx, event)`:

1. **MUST** be called inside a `withTransaction(async (tx) => { ... })`
   block. The `tx` argument is the Prisma transaction client. (See
   `outbox.ts` lines 19–21 + lines 46–48.)
2. The event row is committed atomically with the business mutation.
3. A separate publisher is responsible for reading `PENDING` rows and
   performing the actual external call.

The publisher for SnakZap currently handles Socket.io realtime fanout
(Sub-Wave 2b). When `realPayments=true` is authorized (Wave-3b or 3c),
the publisher MUST be extended (or a second publisher added) to handle
gateway capture for `PAYMENT_CAPTURE_REQUESTED` events — at which
point `captureRazorpayPayment()` will move OUT of
`src/app/api/payments/route.ts` line 155 and INTO the publisher.

---

## 7. DO NOT — Anti-patterns That Violate This Invariant

The following are explicitly forbidden for any code that lives inside
a `withTransaction()` body:

```ts
// ❌ DO NOT — Razorpay capture inside the retryable transaction body
await withTransaction(async (tx) => {
  const payment = await tx.payment.create({ /* ... */ })
  await captureRazorpayPayment(payment.gatewayPaymentId, amount) // ← retries will re-charge
  await tx.order.update({ /* PAID */ })
})

// ❌ DO NOT — SMS / email / push inside the retryable transaction body
await withTransaction(async (tx) => {
  const order = await tx.order.create({ /* ... */ })
  await sendSms(customer.phone, `Order ${order.id} placed`) // ← retries will re-send
  await sendEmail(customer.email, 'order-confirm', { orderId: order.id })
})

// ❌ DO NOT — Webhook send inside the retryable transaction body
await withTransaction(async (tx) => {
  const refund = await tx.refund.create({ /* ... */ })
  await fetch(vendor.webhookUrl, { method: 'POST', body: JSON.stringify(refund) })
})

// ❌ DO NOT — Assume "the gateway dedupes" without an explicit key
await withTransaction(async (tx) => {
  await tx.payment.create({ /* ... */ })
  await instance.payments.capture(id, amount, currency)
  // No X-Idempotency-Key header → relies on undocumented gateway behavior
})

// ❌ DO NOT — Wrap an external call in its own try/catch inside the body
// to "absorb" the failure and let the transaction commit. This does not
// prevent the retry loop from re-firing the call on the NEXT attempt.
await withTransaction(async (tx) => {
  try { await captureRazorpayPayment(id, amount) } catch { /* ignored */ }
  await tx.payment.create({ /* ... */ })
})
```

### The only acceptable patterns

```ts
// ✅ Option A — external call AFTER commit, outside the body
const result = await withTransaction(async (tx) => {
  return await tx.payment.create({ /* ... */ })
})
await sendSms(customer.phone, `Payment ${result.id} captured`)

// ✅ Option B — pre-generated idempotency key honored by the gateway
const idk = randomUUID()
await withTransaction(async (tx) => {
  await tx.externalCallLog.create({ data: { key: idk, /* ... */ } })
})
await instance.payments.capture(id, amount, currency, {
  headers: { 'X-Idempotency-Key': idk }
})

// ✅ Option C — defer to a post-commit publisher via the outbox
await withTransaction(async (tx) => {
  const payment = await tx.payment.create({ /* ... */ })
  await enqueueOutboxEvent(tx, {
    eventType: 'PAYMENT_CAPTURE_REQUESTED',
    aggregateType: 'Payment',
    aggregateId: payment.id,
    payload: { paymentId: payment.id, amount: payment.amount }
  })
})
// Publisher picks up the event after commit.
```

---

## 8. Enforcement Status & Forward Plan

### 8.1 Current enforcement: NONE (manual review only)

As of Sub-Wave 3a, this invariant is enforced **only by convention and
code review**. There is:

- ❌ No ESLint rule that flags external HTTP calls inside a
  `withTransaction` callback.
- ❌ No TypeScript type-level constraint that distinguishes "transaction
  client" code paths from "post-commit" code paths.
- ❌ No CI gate that runs an AST scan to detect forbidden patterns.
- ❌ No mandatory code-review checklist item for payment-related PRs.

This is acceptable for 3a because the `realPayments` flag defaults to
`false` and the only external-capable code path (the capture route)
runs in demo mode.

### 8.2 Wave-3b / 3c scope (NOT started)

The full enforcement mechanism is deferred to Wave-3b / 3c. At minimum
it should include:

1. **Code-review checklist item** — every PR touching
   `src/app/api/payments/` or any route that calls
   `captureRazorpayPayment()` / `createRazorpayOrder()` /
   `enqueueOutboxEvent()` MUST cite this document and confirm the
   external call placement.
2. **Lint rule** (eslint-plugin-local or a custom rule) that errors on
   any `await` of an imported function whose name starts with
   `capture` / `send` / `notify` / `publish` / `fetch` inside a
   `withTransaction(async (tx) => { ... })` body — unless explicitly
   allow-listed.
3. **Outbox publisher for `PAYMENT_CAPTURE_REQUESTED`** — must exist
   before `realPayments=true` is authorized. The capture call moves
   from `route.ts` line 155 to the publisher.
4. **Pre-generated idempotency key flow** for `createRazorpayOrder()`
   (Razorpay supports `X-Idempotency-Key` on `orders.create`) — to
   eliminate orphan-order leaks on retry.
5. **CI gate** — a small script that grep-scans
   `src/app/api/**/route.ts` for `captureRazorpayPayment(` /
   `createRazorpayOrder(` calls inside `withTransaction(` blocks,
   failing the build if found outside the publisher.

### 8.3 Resolution status

```text
IMPLEMENTED / VERIFIED — Wave-4 4c S5 PASS / CLOSED + Wave-5 5a S5 PASS / CLOSED.
```

As of Wave-4 Sub-Wave 4c, `captureRazorpayPayment()` has been removed from the
`withTransaction()` body in `src/app/api/payments/route.ts` and deferred to the
outbox publisher. As of Wave-5 Sub-Wave 5a, `refundRazorpayPayment()` follows
the same pattern from `src/app/api/payments/refund/route.ts` — it is called by
the outbox publisher (`mini-services/outbox-publisher/index.ts` →
`processPaymentRefundRequested()`) OUTSIDE any transaction body.

**Capture route (4c):** Creates `Payment` (CAPTURE_PENDING) + `Order` (PAID) +
`LedgerEntry` Dr/Cr + `AuditLog` (`PAYMENT_CAPTURE_PENDING`) + `IdempotencyKey`
+ `Outbox` (`PAYMENT_CAPTURE_REQUESTED`) atomically in one txn. Publisher calls
`captureRazorpayPayment()` outside the txn, then flips `Payment` to `CAPTURED`.

**Refund route (5a):** Creates `Refund` (REFUND_PENDING) + reversal
`LedgerEntry` Dr/Cr (`Dr CONSUMER_REVENUE` + `Cr GATEWAY_RECEIVABLE`) +
`AuditLog` (`PAYMENT_REFUND_PENDING`) + `IdempotencyKey` + `Outbox`
(`PAYMENT_REFUND_REQUESTED`) atomically in one txn. Publisher calls
`refundRazorpayPayment()` outside the txn, then flips `Refund` to `REFUNDED`
and `Payment` to `REFUNDED` (full refund). The reversal ledger entries are a
**pending accounting reservation** (Option A — Pending Ledger Semantics; see
`WAVE5_EVIDENCE.md` §3) that becomes canonical on publisher success WITHOUT
creating duplicate ledger entries. This is empirically proven by 5a-E6: after
publisher failure (`simulateFail=true`) the ledger is still exactly 4 entries
(no duplication), and after retry success the ledger is STILL exactly 4 entries
(the reversal pair becomes canonical, no new rows inserted).

**Empirical proof of invariant (both flows):**

| Flow | External call | Publisher retry evidence | Result |
|------|---------------|--------------------------|--------|
| Capture (4c) | `captureRazorpayPayment()` | 4c-E5 | 2nd publisher run skips capture (Payment already CAPTURED). No duplicate charge. |
| Refund (5a) | `refundRazorpayPayment()` | 5a-E5 | 2nd publisher run skips refund (Refund already REFUNDED). No duplicate refund. |
| Refund failure → retry (5a) | `refundRazorpayPayment()` | 5a-E6 (PostgreSQL) | Publisher fail → state unchanged + ledger unduplicated; publisher retry success → Refund REFUNDED + ledger still 4 entries (reversal pair canonical, no dup). |

The remaining enforcement mechanisms (lint rule, code-review checklist, CI gate,
pre-generated idempotency key for `createRazorpayOrder()`) are still deferred —
see §8.2.

The invariant itself is **non-negotiable**: the moment any code path places a
non-idempotent external call inside a retryable `withTransaction()` body
without an Option A / B / C mitigation, the code is broken by construction and
MUST NOT ship to a `realPayments=true` environment.

---

## 9. Pointers (read these before editing payment code)

| Concern                                  | File                                        | Lines        |
|------------------------------------------|---------------------------------------------|--------------|
| Retryable error set                      | `src/lib/db.ts`                             | 62–83        |
| `withTransaction()` retry loop           | `src/lib/db.ts`                             | 95–138       |
| `TransactionConflictError`               | `src/lib/db.ts`                             | 51–60        |
| Capture route — full transaction body    | `src/app/api/payments/route.ts`             | 74–276       |
| Capture call site (inside body)          | `src/app/api/payments/route.ts`             | 155          |
| Razorpay order create call (inside body) | `src/app/api/payments/route.ts`             | 110          |
| Razorpay SDK wrapper — demo vs real      | `src/lib/razorpay.ts`                       | 49–130       |
| `realPayments` flag default              | `src/lib/deployment.ts`                     | 27           |
| Idempotency cache read                   | `src/lib/idempotency.ts`                    | 40–54        |
| Idempotency record write                 | `src/lib/idempotency.ts`                    | 63–82        |
| Outbox enqueue helper                    | `src/lib/outbox.ts`                         | 55–72        |
| Outbox invariant comment                 | `src/lib/outbox.ts`                         | 19–21        |
| Outbox → Socket.io event map             | `src/lib/outbox.ts`                         | 103–107      |

---

**End of document.**
