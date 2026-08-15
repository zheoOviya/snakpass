# Sub-Wave 3c — READ/PLAN-FIRST Gate Review

**Status:** 🟡 READ/PLAN-FIRST GATE REVIEW (Implementation NOT authorized)
**Date:** 2026-08-15
**Task ID:** 3c-gate-review
**Reviewer:** Software Architect / Gate Reviewer

**Predecessor:**
- Sub-Wave 3a ✅ S5 PASS / CLOSED — Payment idempotency + PostgreSQL concurrency PROVEN (workflow 31896343466, `evidence/wave3-3a/evidence-postgresql-3a-pg-ev.json`, `ok:true`, `database:postgresql`).
- Sub-Wave 3b ✅ S5 PASS / CLOSED — Order POST idempotency + PostgreSQL concurrency PROVEN (workflow 31912679504, `evidence/wave3-3b/evidence-postgresql-3b-pg-ev.json`, `ok:true`, `database:postgresql`).
- **C1 `requestHash` deferred from 3b to 3c** (per Orchestrator D1 — Option A cached-response semantics chosen for 3b; Option B 422-on-mismatch deferred for separate authorization).

**Scope of this document:** Sub-Wave 3c — C1 `requestHash` (request-canon enforcement) + cross-P0 closure verification + 3a/3b evidence reuse analysis. READ/PLAN-FIRST review ONLY — no implementation, no tests, no migration, no deploy.

**Strict constraints honored:**
- ❌ No source-code modification (no `.ts` files edited)
- ❌ No `prisma/schema.prisma` modification
- ❌ No migration files created
- ❌ No evidence tests executed
- ❌ No production deploy
- ❌ No `realPayments` enable
- ❌ No Sub-Wave 3c implementation start (only the Gate Review document)
- ❌ No new Sub-Wave start (4+ untouched)
- ✅ Files read, analyzed, and Gate Review document produced
- ✅ Worklog appended

---

## 1. C1 RequestHash — Current State + Design Analysis

### 1.1 The deferred C1 candidate (from 3b Gate Review §5.3)

The 3b Gate Review recommended AGAINST implementing C1 in 3b and explicitly deferred it to 3c with the following rationale (quoting from `SUBWAVE_3B_GATE_REVIEW.md` §5.3, candidate C1):

> Add a `requestHash` field to `IdempotencyKey` (schema) + compute body hash in `storeIdempotencyRecord` + compare in `getCachedResponse` + return 422 `IDEMPOTENCY_KEY_REUSE` on mismatch. Closes §3.3 (Option B). Follows GitHub/HTTP-WG idempotency-key RFC draft. Migration class: expand-migrate-contract (add nullable column). Risk: LOW (additive column, nullable; existing rows have null → treated as "no hash check").

The Orchestrator confirmed this deferral in the S5 closure record (worklog line 5216, Task `3b-s5-closure`):

> C1 requestHash: DEFERRED to 3c (per Orchestrator D1 — Option A cached-response semantics chosen for 3b)

### 1.2 Current IdempotencyKey model (verified from `prisma/schema.prisma` lines 213–225)

```prisma
model IdempotencyKey {
  id              String   @id @default(cuid())
  key             String   @unique // the client-provided idempotency key
  resourceType    String   // e.g. "Order", "Payment" — which resource this key created
  resourceId      String   // the id of the created resource (for lookup)
  // Cached response payload (status + body) so retries return the exact same response.
  responseStatus  Int      // HTTP status code
  responseBody    String   // JSON-serialized response body
  createdAt       DateTime @default(now())
  expiresAt       DateTime // TTL (default 24h); old keys are safe to delete

  @@index([resourceType, resourceId])
}
```

**Critical observations:**

1. There is **NO `requestHash` column** today — the model stores only the cached **response** (status + body). The original **request** body that produced this response is NOT retained or hashed.
2. As a result, `getCachedResponse()` (lines 40–54 of `src/lib/idempotency.ts`) currently returns the cached response **regardless of whether the second request's body matches the first request's body**. This is the **Option A** behavior the Orchestrator chose for 3b:
   - 3b-E3 evidence (`evidence/wave3-3b/evidence-3b-ev-1786832887563-41ed55ac.json`, test-3-conflict): two POSTs with the same `Idempotency-Key` but materially different bodies (qty=1 vs qty=3) both returned 200 with the SAME orderId. `cachedResponseReturned: true`, `exactlyOneOrder: true`. ✅ PASS for 3b.
3. The 24h TTL (`IDEMPOTENCY_KEY_TTL_HOURS = 24`, `src/lib/idempotency.ts` line 19) bounds the window in which a key can be reused. C1's hash check only applies within this window; after expiry, the key is treated as "not found" (line 49: `if (record.expiresAt.getTime() < Date.now()) return null`) and a fresh creation under the same key with a NEW body is allowed.

### 1.3 Current idempotency library behavior (`src/lib/idempotency.ts`, 99 lines, read in full)

| Function | Lines | Current behavior | C1 impact |
|----------|-------|-------------------|-----------|
| `getIdempotencyKey(req)` | 25–32 | Regex-validates `Idempotency-Key` header `^[a-zA-Z0-9_-]{8,128}$`. Returns `null` if absent or invalid. | **Unchanged.** C1 does not modify key validation. |
| `getCachedResponse(tx, key)` | 40–54 | Reads `IdempotencyKey.findUnique({where: {key}})`. Returns `null` if absent OR expired. Else returns `{status, body}`. | **MODIFIED by C1.** When stored `requestHash` is non-null, compare with the incoming request's hash. If mismatch → throw `IdempotencyKeyReuseError` (caught by route → HTTP 422). If stored `requestHash` is null (pre-3c record) → skip hash check (backward-compat). |
| `storeIdempotencyRecord(tx, key, resourceType, resourceId, responseStatus, responseBody)` | 63–82 | Inserts a new `IdempotencyKey` row. Computes `expiresAt = now + 24h`. Throws P2002 if the key already exists. | **MODIFIED by C1.** New parameter `requestHash: string` (or computed internally from a passed `requestBody: string`). Stored in the new `requestHash` column. |
| `parseCachedResponse(cached)` | 88–98 | Parses cached JSON body. Defensive `try/catch` returns `{raw: body}` on JSON failure. | **Unchanged.** |

### 1.4 Routes that use the idempotency library (verified by reading both routes)

Both critical paths use the library identically — the `getCachedResponse` → `storeIdempotencyRecord` sequence:

| Route | File | getIdempotencyKey call site | getCachedResponse call site (inside txn) | storeIdempotencyRecord call site (inside txn) | C1 applicability |
|-------|------|----------------------------|-------------------------------------------|----------------------------------------------|------------------|
| `POST /api/orders` | `src/app/api/orders/route.ts` | line 109 (outside txn) | lines 143–151 (FIRST call inside txn) | lines 304–314 (conditional on `idempotencyKey` present) | ✅ **Yes** — closes §3.3 for Order POST |
| `POST /api/payments` | `src/app/api/payments/route.ts` | line 61 (outside txn) | lines 76–82 (FIRST call inside txn) | lines 267–270 (conditional on `idempotencyKey` present) | ✅ **Yes** — closes the equivalent §3.3 gap for Payment POST (currently only 3a-E3 covered the "same key + DIFFERENT order → cached response returned" behavior; C1 changes this to 422-on-mismatch) |
| `PATCH /api/orders/[id]/status` | `src/app/api/orders/[id]/status/route.ts` | NOT accepted | NOT used | NOT used | ❌ Out of scope (state-transition uses optimistic-lock, not idempotency) |
| `PATCH /api/kill-switches/[key]` | `src/app/api/kill-switches/[key]/route.ts` | NOT accepted | NOT used | NOT used | ❌ Out of scope |

**Scope:** C1 modifies the **shared library** `src/lib/idempotency.ts`, so the change applies to BOTH `POST /api/orders` and `POST /api/payments` simultaneously. The two routes share the same `IdempotencyKey` table and the same library — there is no per-route opt-in needed.

### 1.5 C1 design analysis — why this is non-trivial

The C1 change looks small ("add a column + a hash check"), but it touches the **shared idempotency contract** that both critical paths depend on. Specifically:

1. **Schema change** — adds a nullable column. Backward-compatible by default (existing rows have `null`).
2. **API contract change** — same-key + different-body now returns 422 instead of 200. This is a **behavioral** change visible to clients, not just an additive field.
3. **Hash semantics** — JSON canonicalization is non-trivial (key ordering, nested objects, arrays, whitespace, number representation). A naive `JSON.stringify` is non-canonical — V8 happens to produce stable ordering for object keys (insertion order), but this is **not guaranteed** across engines/versions/clients. The hash MUST be computed from a canonical form.
4. **withTransaction interaction** — the hash check happens INSIDE the retryable txn body. If a P2002 retry re-runs `getCachedResponse` and the hash mismatches on retry, the 422 path must throw cleanly without leaking partial state.
5. **Backward compatibility window** — pre-3c records (with `requestHash = null`) and post-3c records (with `requestHash = <hash>`) coexist. The `getCachedResponse` must distinguish them correctly: null-hash → skip check (Option A behavior); non-null-hash → enforce (Option B behavior).

---

## 2. Request Canonicalization Strategy

### 2.1 What goes into the hash

The hash represents the **client's intent** — the request that produced the cached response. There are three plausible scopes:

| Scope | What's hashed | Pros | Cons |
|-------|---------------|------|------|
| **(a) Body only** | The JSON-serialized request body | Simple. Matches Stripe/Razorpay convention. Body is the dominant signal of intent. | Two requests with same body but different URL/method (e.g., `POST /api/orders` vs `POST /api/payments`) would hash the same — but in practice the body shapes differ (`createOrderBodySchema` vs `captureBodySchema`), so collision is unlikely. |
| **(b) Body + method + path** | `METHOD + path + body` | Stronger: distinguishes same-body-different-endpoint. | Path is server-known and constant per route — including it adds no real signal. Method likewise. |
| **(c) Body + headers (e.g., `Idempotency-Key` itself)** | Body + selected headers | Includes auth context — but `Idempotency-Key` is the lookup key, so including it in the hash is redundant. Auth headers (session) are not part of the request "intent." | Adds complexity, no clear benefit. |

**Recommendation: scope (a) — body only.**

- Matches the Stripe convention (https://stripe.com/docs/api/idempotent_requests) — Stripe's `Idempotency-Key` is scoped per-endpoint and the hash is implicitly over the request parameters.
- Both SnakZap routes already have distinct body schemas (validated by Zod: `createOrderBodySchema` vs `captureBodySchema`), so body-only hashing is sufficient to distinguish intent.
- The `resourceType` column on `IdempotencyKey` already records which resource the key created ("Order" vs "Payment"), providing audit trail even without including the URL in the hash.

### 2.2 JSON canonicalization algorithm

The hash is computed over the **canonical form** of the request body. A naive `JSON.stringify(body)` is NOT canonical because:

- Object key insertion order varies across clients (e.g., Python `dict`, Go `map`, JS `Object` literals — all may produce different orderings for the same logical object).
- Whitespace between tokens is irrelevant to semantics but changes the byte string.
- Number representation (e.g., `1.0` vs `1`) differs across JSON serializers.

**Algorithm (JSON Canonicalization Scheme — RFC 8785, simplified):**

1. Recursively sort all object keys alphabetically (UTF-8 lexicographic).
2. Preserve array element order (arrays are semantically ordered — `[a, b]` ≠ `[b, a]`).
3. Stringify with no whitespace (compact form): `JSON.stringify(canonicalObject)` where `canonicalObject` is the sorted form.
4. Hash the resulting UTF-8 byte string with SHA-256 → 64-char hex.

**Implementation sketch (NOT to be implemented in this Gate Review — shown for design clarity):**

```ts
// Hypothetical canonicalize function (NOT in 3c Gate Review scope)
function canonicalize(body: unknown): string {
  if (body === null || typeof body !== 'object') return JSON.stringify(body)
  if (Array.isArray(body)) return '[' + body.map(canonicalize).join(',') + ']'
  const keys = Object.keys(body).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((body as Record<string, unknown>)[k])).join(',') + '}'
}

function computeRequestHash(body: unknown): string {
  return crypto.createHash('sha256').update(canonicalize(body)).digest('hex')
}
```

**Library option:** Use `fast-json-stable-stringify` (well-maintained, used by `axios`) instead of rolling our own. It does NOT do RFC 8785 fully (no number normalization) but covers the common cases (key sorting, compact output). For SnakZap's body schemas (no float ambiguity — prices/quantities are integers), this is sufficient.

**Edge runtime compatibility:** `crypto.createHash` is Node.js — not Edge-runtime compatible. However, the idempotency library runs in the route handler (Node.js runtime, not Edge Runtime — verified by `src/middleware.ts` matcher: middleware runs on Edge, but route handlers run on Node.js). So Node.js `crypto` is fine. Alternative: Web Crypto `crypto.subtle.digest('SHA-256', ...)` — works on both runtimes. Recommendation: use Web Crypto for forward-compatibility.

### 2.3 Hash algorithm + storage

- **Algorithm:** SHA-256 (FIPS 180-4). 64-char hex string output.
- **Strength:** 128-bit security — collision-infeasible (2^128 work factor for birthday attack). Adequate for protecting a 24h-TTL idempotency cache.
- **Storage:** `requestHash String?` on `IdempotencyKey` model (nullable).
  - Pre-3c records: `null` (no hash check — Option A backward-compat).
  - Post-3c records: 64-char hex string (hash check enforced — Option B).
- **Index:** No index on `requestHash` — it's not a lookup key. The lookup is still by `key @unique`. The hash is computed and compared AFTER the lookup, only when the row exists.

### 2.4 Compute location

| Step | Where | When |
|------|-------|------|
| Canonicalize + hash incoming request body | In route handler, BEFORE `withTransaction` (the body is already parsed by Zod at this point — `validateBody` returns the parsed body) | Outside txn — cheap, idempotent, no DB I/O |
| Store hash in IdempotencyKey | In `storeIdempotencyRecord(tx, key, ..., requestHash)` — inside txn | Inside txn — committed atomically with the response |
| Compare hash in `getCachedResponse` | In `getCachedResponse(tx, key, incomingRequestHash)` — inside txn | Inside txn — first call, before any business write |

**Important:** The incoming request hash is computed ONCE per request (outside the txn). The retry loop re-runs `getCachedResponse`, passing the same hash. The stored hash is read from the DB on each retry. Since the stored hash is deterministic (committed in the first successful txn), retry comparison is stable.

---

## 3. Same-key/Different-request Contract (422 vs other)

### 3.1 Option B selection (Orchestrator D1 deferred this from 3b to 3c)

The Orchestrator's D1 decision (worklog line 5216) chose **Option A** for 3b:
- Same key + different body → cached response returned (no 422)
- Rationale for 3b: avoids contract change in the same wave as the evidence-only scope; defers the contract change to 3c where it can be trialed separately.

For 3c, the **Option B** contract is the proposed target:
- Same key + different body → HTTP 422 `IDEMPOTENCY_KEY_REUSE` with actionable details.

### 3.2 Status code choice: 422 vs 409 vs 400

| Code | RFC 9110 meaning | Fit for "same key + different body" |
|------|------------------|--------------------------------------|
| **400 Bad Request** | The server cannot process the request due to a client error (e.g., malformed syntax). | ❌ The request is syntactically valid (Zod passed). The error is not "syntax" — it's a semantic conflict with a prior request. Stripe uses 400 for `idempotency_key_in_use`, but Stripe's error semantics are bespoke. |
| **409 Conflict** | The request conflicts with the current state of the target resource. | 🟡 Closer semantically — there IS a conflicting resource (the existing IdempotencyKey row). But 409 implies "retry with a different state," and the resolution here is "use a new key" rather than "resolve the state conflict." Also, 409 is already used by the route for `TransactionConflictError` (P2034/P2036) — overloading it would conflate "transient conflict (retry same key)" with "permanent conflict (use new key)." |
| **422 Unprocessable Entity** | The server understands the content type and syntax, but is unable to process the request because of semantic instructions (e.g., missing required field, logical inconsistency). | ✅ **Best fit.** The request is syntactically valid but semantically inconsistent with the existing idempotency record. The client must generate a new key (not retry the same one). WebDAV extension (RFC 4918) but widely adopted by REST APIs (used by GitHub, Rails, Django). |

**Recommendation: 422** with `error.code = 'IDEMPOTENCY_KEY_REUSE'`.

### 3.3 Error response shape

```json
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSE",
    "message": "Idempotency-Key was already used for a different request. Generate a new Idempotency-Key and retry.",
    "traceId": "<uuid>",
    "details": {
      "idempotencyKey": "<the-key>",
      "resourceType": "Order",
      "storedResourceId": "<the-original-resource-id>",
      "storedRequestHash": "<first-16-chars-of-sha256-hex>",
      "receivedRequestHash": "<first-16-chars-of-sha256-hex>",
      "retryStrategy": "new-key"
    }
  }
}
```

**Design choices:**

1. **`storedRequestHash` and `receivedRequestHash` are truncated to first 16 chars** (8-byte fingerprint, 64-bit collision resistance — sufficient for debugging without leaking the full hash). This is a conservative disclosure — the full SHA-256 hash is also safe to disclose (it's a one-way function), but truncation provides defense-in-depth against any future hash-inversion attack on small-body enumeration.
2. **`storedResourceId` IS disclosed** — this is the original Order/Payment ID that the first request created. This is intentional: if the client believes it is creating a new resource but the server has already created one under this key, the client should be able to look up that original resource (e.g., via `GET /api/orders/<storedResourceId>`). This is the same resource ID the cached-response path would have returned in Option A — so disclosure here is equivalent to Option A's behavior.
3. **`retryStrategy: 'new-key'`** mirrors the C2 conflict-semantics pattern from 3b (which used `retryStrategy: 'same-key'` for `TransactionConflictError`). Clients can branch on `retryStrategy` to decide between "retry with same key" (C2 path) and "generate new key" (C1 path).

### 3.4 What "materially different" means

The hash is over the canonicalized full body. This means **ANY byte-level difference** in the body (after canonicalization) triggers the 422. Specifically:

| Body A | Body B | Hash differs? | Behavior |
|--------|--------|---------------|----------|
| `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 1, ...}]}` | same as A | No | 200 cached (current 3b behavior) |
| `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 1}]}` | `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 2}]}` | Yes (quantity differs) | 422 (C1 new behavior) |
| `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 1}]}` | `{restaurantId: "r2", items: [{menuItemId: "m1", quantity: 1}]}` | Yes (restaurantId differs) | 422 |
| `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 1}], note: "abc"}` | `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 1}], note: "abc "}` (trailing space) | Yes (note differs after trim? — depends on whether Zod trims) | 422 if Zod doesn't trim; 200 if Zod trims (because post-validation bodies are identical) |
| `{restaurantId: "r1", items: [{menuItemId: "m1", quantity: 1}]}` (sent as `{"items":[{"menuItemId":"m1","quantity":1}],"restaurantId":"r1"}` — keys reordered) | same logical body | **No** (canonicalization sorts keys) | 200 |

**Critical implication:** The hash must be computed over the **post-Zod-validation body** (the parsed, normalized object), NOT over the raw request bytes. Otherwise, semantically-identical requests with different byte representations (whitespace, key order) would spuriously 422. This is the same logic as Zod parsing — once parsed, the body is a normalized JS object, and the canonicalization is computed from that normalized form.

### 3.5 Backward compatibility for the C2 path (3b's `retryStrategy: 'same-key'`)

C1 does NOT change the C2 conflict-semantics path:
- `TransactionConflictError` (P2034/P2036/P1008/P2002/P2024) after exhausting retries → still HTTP 409 with `retryStrategy: 'same-key'` (when an idempotency key was provided).
- C1's 422 path is for the "stored hash mismatches incoming hash" case — this is a different error path, NOT a sub-case of `TransactionConflictError`.

The two error paths are mutually exclusive:
- 409 + `retryStrategy: 'same-key'` → retry with the SAME key (the original txn may have committed; cached response will be returned).
- 422 + `retryStrategy: 'new-key'` → the original txn DEFINITELY committed (the row exists with a non-null hash); generate a NEW key.

---

## 4. Backward Compatibility + Old Records Behavior

### 4.1 Migration class — expand-migrate-contract

| Phase | Action | Backward-compatible? |
|-------|--------|----------------------|
| **Expand** | Add `requestHash String?` column to `IdempotencyKey` table (nullable, no default). Migration applied to staging. | ✅ Yes — existing rows have `null`. Pre-3c code reads the column as `null` and skips the check. |
| **Migrate** | Deploy new code that COMPUTES `requestHash` on insert and COMPARES on read (with null-skip). New rows have non-null hash; old rows still have null. | ✅ Yes — old rows behave as Option A (no hash check); new rows behave as Option B (hash check). |
| **Contract** | (Optional, future wave) Backfill `requestHash` for old rows by replaying transaction logs — NOT required for correctness; only for consistency. | 🟡 Optional — could be deferred indefinitely. Old rows naturally expire (24h TTL) and are deleted. After 24h post-deploy, all rows have non-null hash. |

### 4.2 Old IdempotencyKey records behavior

| Record age | `requestHash` value | Behavior on second request (same key, different body) | Behavior on second request (same key, same body) |
|------------|----------------------|--------------------------------------------------------|--------------------------------------------------|
| Pre-3c (< 24h old, created before 3c deploy) | `null` | **200 cached response** (Option A — no hash check) | **200 cached response** (Option A) |
| Post-3c (created after 3c deploy) | `<sha256-hex>` | **422 `IDEMPOTENCY_KEY_REUSE`** (Option B — hash mismatch) | **200 cached response** (Option B — hash match) |
| Pre-3c (> 24h old) | (record expired, treated as not-found) | n/a — `getCachedResponse` returns `null` → fresh creation allowed (current behavior, no change) | n/a — fresh creation allowed |

**This is graceful migration:** no breaking change for existing records. Pre-3c records continue to behave per Option A until they expire (max 24h). After 24h post-deploy, all `IdempotencyKey` rows have non-null `requestHash` and Option B is uniformly enforced.

### 4.3 Feature flag consideration (optional defense-in-depth)

**Decision:** Add a `requestHashEnforcement` feature flag, default OFF.

| Flag value | Behavior | Use case |
|------------|----------|----------|
| `requestHashEnforcement = false` (default) | Code computes hash on insert (stored for all new records), but `getCachedResponse` SKIPS the comparison check (treats all rows as "no hash check" — Option A behavior even for new records). | Initial deploy — proves the hash-computation path works without breaking clients. |
| `requestHashEnforcement = true` | `getCachedResponse` enforces the comparison (Option B behavior for rows with non-null hash). | Post-soak-period enablement — typically 1-7 days after deploy, after monitoring shows no spurious 422s. |

**Rationale:** The null-check on the column already provides backward compatibility for OLD records. But adding a feature flag provides a kill-switch for NEW records too — if the canonicalization algorithm has a bug (e.g., edge case with nested arrays), the flag can be flipped OFF to immediately revert to Option A without a code deploy. This is a low-cost defense-in-depth measure.

**Where the flag lives:** `src/lib/deployment.ts` (same pattern as `realPayments` — `getFlag('request-hash-enforcement', false)`).

**Default value:** `false` — code path is dormant until explicitly enabled.

**Enablement authorization:** NOT in 3c scope. Enablement requires separate Orchestrator authorization (Wave-3d or later). 3c only IMPLEMENTS the flag and the dormant code path; it does NOT flip the flag.

### 4.4 What if both flag is OFF and stored hash is non-null?

| Scenario | Code path | Behavior |
|----------|-----------|----------|
| Flag OFF, stored hash non-null (post-3c record but flag not enabled yet) | `getCachedResponse` checks flag → flag is OFF → skip hash comparison → return cached response | **Option A behavior** (200 cached, no 422) |
| Flag ON, stored hash non-null | `getCachedResponse` checks flag → flag is ON → compare stored hash with incoming hash → if mismatch, throw 422 | **Option B behavior** (422 on mismatch) |
| Flag ON, stored hash null (pre-3c record) | `getCachedResponse` checks flag → flag is ON → stored hash is null → skip comparison (backward-compat for old records) | **Option A behavior** (200 cached) |
| Flag OFF, stored hash null (pre-3c record + flag not enabled) | Same as above (flag check short-circuits before hash check) | **Option A behavior** (200 cached) |

This 2×2 matrix shows the flag provides a clean kill-switch that overrides the column-null check.

### 4.5 Implementation skeleton (NOT to be implemented in this Gate Review — design sketch only)

```ts
// Hypothetical getCachedResponse with C1 (NOT in 3c Gate Review scope)
export async function getCachedResponse(
  tx: Prisma.TransactionClient,
  key: string,
  incomingRequestHash?: string,  // NEW parameter — computed by caller, outside txn
): Promise<{ status: number; body: string } | null> {
  const record = await tx.idempotencyKey.findUnique({ where: { key } })
  if (!record) return null
  if (record.expiresAt.getTime() < Date.now()) return null  // TTL check (unchanged)

  // C1: requestHash enforcement (gated by feature flag)
  if (incomingRequestHash && record.requestHash && isFeatureEnabled('requestHashEnforcement')) {
    if (record.requestHash !== incomingRequestHash) {
      throw new IdempotencyKeyReuseError({
        idempotencyKey: key,
        resourceType: record.resourceType,
        storedResourceId: record.resourceId,
        storedRequestHash: record.requestHash,
        receivedRequestHash: incomingRequestHash,
      })
    }
  }

  return { status: record.responseStatus, body: record.responseBody }
}

// Hypothetical storeIdempotencyRecord with C1 (NOT in 3c Gate Review scope)
export async function storeIdempotencyRecord(
  tx: Prisma.TransactionClient,
  key: string,
  resourceType: string,
  resourceId: string,
  responseStatus: number,
  responseBody: string,
  requestHash?: string,  // NEW parameter — computed by caller, outside txn
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000)
  await tx.idempotencyKey.create({
    data: {
      key,
      resourceType,
      resourceId,
      responseStatus,
      responseBody,
      expiresAt,
      requestHash: requestHash ?? null,  // null for pre-3c callers (defensive)
    },
  })
}
```

The new `IdempotencyKeyReuseError` class would be caught by the route handler (in both `orders/route.ts` and `payments/route.ts`) and translated to HTTP 422 with the response shape from §3.3.

---

## 5. Cross-P0 Closure Analysis

This section verifies that implementing C1 does NOT break established invariants from 3a, 3b, and the broader P0 set.

### 5.1 Invariant preservation matrix

| # | Invariant | Source (P0 + Wave) | C1 impact | Safe? | Justification |
|---|-----------|--------------------|-----------|-------|---------------|
| 1 | **Payment idempotency** (3a-E1..3a-PG-E1) — same `Idempotency-Key` + same body → exactly 1 Payment, 1 ledger pair, 1 outbox, 1 idempotency record, 1 audit log. | P0-01 + P0-17, Wave-3a | C1 ADDS a hash check in `getCachedResponse`. For new records (post-3c, hash non-null): hash comparison runs. For same-body requests, hash matches → cached response returned (same as 3a). For different-body requests, hash mismatches → 422 (NEW behavior — but only if `requestHashEnforcement` flag is ON, which 3c does NOT enable). With flag OFF (3c default), no behavior change vs 3a. | ✅ **SAFE** | C1 is **additive + gated**. With flag OFF, 3a behavior is byte-identical. With flag ON, only same-key + different-body diverges (422 instead of 200 cached) — but this is the intended new behavior, and 3a's "same key + same body → 1 capture" invariant is preserved. |
| 2 | **Order idempotency** (3b-E1..3b-PG-E1) — same `Idempotency-Key` + same body → exactly 1 Order, 1 OrderItem, 1 Outbox, 1 IdempotencyKey, 1 AuditLog. | P0-08 + P0-17, Wave-3b | Same as #1 — C1 is additive. With flag OFF, 3b behavior byte-identical. With flag ON, only same-key + different-body diverges (422 instead of 200 cached). 3b-E3 evidence (same key + qty=1 then qty=3 → cached response) would now return 422 if flag is ON — this is the **intended** Option B behavior. The 3b-E3 evidence remains valid proof of the **flag-OFF** path; a NEW 3c evidence scenario (3c-E2, see §6) proves the **flag-ON** path. | ✅ **SAFE** | C1 does not invalidate 3b evidence; it adds a NEW dimension (422-on-mismatch) that 3b explicitly deferred. |
| 3 | **Transaction retry behavior** — `withTransaction` (P2002/P1008/P2024/P2034/P2036 retryable, MAX_RETRIES=5). | P0-25 + P0-17, Wave-1 1a, regression-analyzed in 3a | C1 does NOT modify `withTransaction` or `isRetryableConflict`. The hash check happens INSIDE the txn body (in `getCachedResponse`). On retry: `getCachedResponse` re-runs → reads same row → hash check re-runs → same incoming hash (computed once outside txn) → deterministic outcome. If hash matches → cached response returned (short-circuit, same as today). If hash mismatches → `IdempotencyKeyReuseError` thrown → txn aborts → propagates out of `withTransaction` (NOT a retryable conflict — does not match any of P2002/P1008/P2024/P2034/P2036). The `IdempotencyKeyReuseError` is caught by the route handler and translated to HTTP 422. **No retry storm, no infinite loop.** | ✅ **SAFE** | `IdempotencyKeyReuseError` is a NEW error class, distinct from `Prisma.PrismaClientKnownRequestError`. `isRetryableConflict` returns `false` for it (it's not a Prisma error). The retry loop treats it as "non-retryable — rethrow as-is." Bounded behavior preserved. |
| 4 | **Outbox atomicity** (P0-24) — `enqueueOutboxEvent(tx, ...)` committed atomically with the business write. | P0-24, Wave-2 (CLOSED) | C1 does NOT touch the outbox. The outbox event is committed atomically with the Order/Payment (and now also with the `IdempotencyKey` row that now stores `requestHash`). The atomicity guarantee is preserved — the outbox row + the IdempotencyKey row (including its new `requestHash` column) commit in the same txn, or both roll back. | ✅ **SAFE** | The new `requestHash` column is added to the same `IdempotencyKey` row that's already inside the txn. Atomicity extends naturally to the new column. |
| 5 | **AuditLog integrity** (DEV-001 hash chain) — append-only, hash = SHA-256(prevHash + entry data). | P0-22, Wave-2 (CLOSED) | C1 does NOT touch AuditLog. The audit log entry is written inside the txn (unchanged). The audit log's `prevHash`/`hash` chain is unaffected — C1 does not modify `AuditLog` schema or writes. | ✅ **SAFE** | No interaction. C1 modifies `IdempotencyKey` schema only. |
| 6 | **External payment side-effects** (TRANSACTION_RETRY_INVARIANT.md) — external gateway side-effect ≠ blind DB retry. | Architectural invariant doc (`docs/TRANSACTION_RETRY_INVARIANT.md`), Wave-3a 3a-arch-doc | C1 does NOT change WHERE external calls happen. `captureRazorpayPayment()` is still INSIDE the txn body (3a documented this as a latent risk if `realPayments=true`; 3c does NOT fix this — it's out of 3c scope). C1 only adds a hash check BEFORE the existing business writes — it does not move or add any external calls. | ✅ **SAFE** | C1 is purely additive DB-layer logic. No new external calls introduced. The invariant (external side-effect ≠ blind DB retry) is preserved — C1 doesn't change the retry semantics for external calls. |
| 7 | **Capture uniqueness** (I-04) — each Payment captured exactly once. | P0-01 + P0-25 Case C, Wave-3a | C1 adds a hash check on the idempotency key path. The `Payment.idempotencyKey` unique constraint (P0-25 Case C) still enforces capture uniqueness at the DB layer. C1's hash check is an ADDITIONAL check on top of the existing unique constraint. If two different requests share a key, the first one captures + stores the hash; the second one's hash check fails → 422 → no second capture attempted. **C1 actually STRENGTHENS I-04** by rejecting the second request BEFORE any business write, rather than relying on the unique constraint to reject mid-txn. | ✅ **SAFE + STRENGTHENED** | C1 is a defense-in-depth for I-04. The unique constraint remains the ultimate backstop; C1 provides an earlier, cleaner rejection path. |
| 8 | **Order Integrity** (I-02) — each Order created exactly once. | P0-08 + P0-25, Wave-3b | Same as #7 — C1 strengthens I-02 by rejecting same-key + different-body before the second Order creation is attempted. The `IdempotencyKey.key` unique constraint remains the backstop. | ✅ **SAFE + STRENGTHENED** | Same as #7. |
| 9 | **Transactional Completeness** (I-10) — all writes in a txn commit atomically or all roll back. | P0-24 + P0-17, Wave-2 | C1's hash check happens inside the txn, BEFORE any business write. If the hash mismatches, the txn throws and rolls back — but NO business write has happened yet (the hash check is the FIRST call inside the txn body). So no rollback of business writes is needed — the txn aborts cleanly before any business mutation. | ✅ **SAFE** | The hash check is positioned BEFORE `tx.order.create` / `tx.payment.create` — same position as the existing `getCachedResponse` call. Atomicity preserved. |
| 10 | **Idempotency-Key hit/miss metric** (P0-17 observability signal). | P0-17 traceability row | C1 adds a NEW signal: `idempotency-key-reuse-rejected` (logged when 422 is returned). The existing `idempotency-dedup-hit` and `idempotency-key-stored` log fields are unchanged. The new signal can be derived from structured logs without a metrics backend. | ✅ **SAFE + ENHANCED** | C1 adds observability, does not subtract. |

### 5.2 Cross-P0 dependency check (from `P0_DEPENDENCY_GRAPH.md`)

| P0 | C1 interaction | Risk |
|----|----------------|------|
| P0-01 (Razorpay capture) | C1 modifies the shared `idempotency.ts` library used by `/api/payments`. The change is additive (hash check before business writes) and gated by `requestHashEnforcement` flag (default OFF). 3a evidence (3a-PG-E1) was generated with flag implicitly OFF (no `requestHashEnforcement` flag exists today). 3c implementation must NOT break 3a evidence — verified by `getCachedResponse` null-hash short-circuit (pre-3c records → skip check). | LOW |
| P0-08 (Order idempotency) | C1 modifies the shared `idempotency.ts` library used by `/api/orders`. Same as P0-01 — additive, gated, backward-compatible. 3b evidence (3b-PG-E1) was generated with flag implicitly OFF. 3c must NOT break 3b evidence — same null-hash short-circuit. | LOW |
| P0-17 (Idempotency infrastructure) | C1 EXTENDS P0-17's library (`idempotency.ts`) with hash computation + comparison. P0-17's existing functions (`getIdempotencyKey`, `parseCachedResponse`) are unchanged. `getCachedResponse` and `storeIdempotencyRecord` get new optional parameters — old callers that don't pass the hash parameter still work (defensive `?? null` defaults). | LOW |
| P0-24 (Transactional outbox) | C1 does NOT touch outbox. Atomicity of outbox event + IdempotencyKey row is preserved (both commit in the same txn, or both roll back). The new `requestHash` column is just an additional field on the IdempotencyKey row — atomicity extends naturally. | NONE |
| P0-25 (Concurrency + duplicate-execution) | C1 does NOT touch the optimistic-lock `version` field, the `MenuItem.availableCount` decrement, or the P2002 retry logic. The hash check is independent of the optimistic-lock path. For concurrent same-key + same-body requests: 1 wins (creates the row + hash), 4 losers hit P2002 on `storeIdempotencyRecord` → retry → `getCachedResponse` finds the row → hash matches (same body) → cached response returned. Same as 3b-PG-E1. For concurrent same-key + different-body requests (rare, but possible if a buggy client races two different bodies under the same key): 1 wins (creates the row + hash for body B1), others retry → `getCachedResponse` finds the row → hash mismatches (their body is B2 or B3, not B1) → 422. **This is the correct behavior.** | LOW |
| P0-27 (Deployment & rollback) | C1 is a Class-2 expand-migrate-contract migration (nullable column). Rollback = revert code + drop column (safe because column is nullable and not used by older code). The feature flag provides additional rollback safety (flip flag OFF without code revert). | LOW |
| P0-28 (Unknown-exception handling) | C1 introduces `IdempotencyKeyReuseError` (a new typed error). It's caught explicitly by route handlers — does NOT reach the unknown-exception backstop. If `IdempotencyKeyReuseError` is thrown and NOT caught (programming bug), it would propagate to `withErrorHandler` → generic 500 → ExceptionQueue entry. This is the standard error-handling path; no new unknown-state surface. | LOW |

**No blocking dependencies.** All P0-08 / P0-01 / P0-17 predecessors are CLOSED/S5. C1 is a leaf extension on the existing idempotency infrastructure.

### 5.3 withTransaction retry interaction — explicit analysis

The 3a regression analysis (`evidence/wave3-3a/regression-analysis.md`) identified 4 callers of `withTransaction`. C1's impact on each:

| # | Caller | C1 impact | Retry-safe? |
|---|--------|-----------|-------------|
| 1 | `POST /api/orders` — uses `getCachedResponse` + `storeIdempotencyRecord` | C1 adds hash check inside `getCachedResponse` + hash storage in `storeIdempotencyRecord`. On retry: same incoming hash (computed once outside txn) compared against same stored hash (deterministic). Match → cached response; mismatch → `IdempotencyKeyReuseError` (non-retryable, propagates out of retry loop). | ✅ YES — `IdempotencyKeyReuseError` is not in `isRetryableConflict`'s set, so retry loop treats it as "non-retryable, rethrow." Bounded behavior preserved. |
| 2 | `POST /api/payments` — same pattern | Same as #1. | ✅ YES |
| 3 | `PATCH /api/orders/[id]/status` — uses optimistic-lock, NOT idempotency | C1 does NOT touch this route (no `Idempotency-Key` header accepted, no `getCachedResponse` call). | ✅ N/A — no interaction |
| 4 | `PATCH /api/kill-switches/[key]` — uses optimistic-lock, NOT idempotency | Same as #3. | ✅ N/A |

**Verdict:** C1 does not modify the retry behavior. The new error class `IdempotencyKeyReuseError` is non-retryable by design — once the hash mismatches, retrying with the same hash will mismatch again. The client must generate a new `Idempotency-Key` (which means a new IdempotencyKey row, no hash check, fresh creation).

---

## 6. 3a/3b Evidence Reuse + NEW 3c Evidence Scenarios

### 6.1 Already-CLOSED evidence (do NOT re-prove in 3c)

The following 3a/3b evidence scenarios are S5 PASS / CLOSED. They MUST NOT be re-run as part of 3c — re-running them would waste resources and would not add new information (they were proven on PostgreSQL staging with `ok:true`).

| # | Scenario | Evidence file | Sub-Wave | Why it stays CLOSED |
|---|----------|---------------|----------|---------------------|
| 3a-E1 | Capture transaction rollback (Payment) | `evidence/wave3-3a/evidence-3a-ev-...json` | 3a (CLOSED) | C1 does not modify the Payment capture flow's rollback guarantee. The new `requestHash` column rolls back atomically with the rest of the row. |
| 3a-E2 | Idempotency replay (Payment: same key + same order → 1 capture) | same | 3a (CLOSED) | C1 preserves same-body behavior. Same body → same hash → cached response. |
| 3a-E3 | Idempotency conflict (Payment: same key + different order → cached response, Option A) | same | 3a (CLOSED) | This was Option A behavior for 3a. Under 3c with `requestHashEnforcement` flag ON, this would now return 422 — but 3c does NOT enable the flag, so 3a-E3 remains valid. (When the flag is enabled in a future wave, a NEW 3c-style evidence scenario will be required for Payment.) |
| 3a-E4 | 5-concurrent duplicate (Payment, SQLite) | same | 3a (CLOSED) | C1 does not change concurrent-same-key + same-body behavior. |
| 3a-PG-E1 | 5-concurrent duplicate (Payment, PostgreSQL) | `evidence/wave3-3a/evidence-postgresql-3a-pg-ev.json` | 3a (CLOSED) | Same as 3a-E4, on PostgreSQL. Workflow 31896343466, `ok:true`. |
| 3b-E1 | Order POST transaction rollback (phantom-block prevention) | `evidence/wave3-3b/evidence-3b-ev-1786832887563-41ed55ac.json` | 3b (CLOSED) | C1 does not modify Order POST rollback. |
| 3b-E2 | Idempotency replay (Order: same key + same body → 1 order) | same | 3b (CLOSED) | C1 preserves same-body behavior. |
| 3b-E3 | Idempotency conflict (Order: same key + materially different body → cached response, Option A) | same | 3b (CLOSED) | This was Option A behavior for 3b. Under 3c with flag ON, would return 422. 3c does NOT enable the flag, so 3b-E3 remains valid. NEW 3c-E2 (see below) proves the flag-ON path. |
| 3b-E4 | 5-concurrent duplicate (Order, SQLite) | same | 3b (CLOSED) | Same as 3a-E4. |
| 3b-E5 | Phantom-block prevention (Order: failed txn + retry succeeds) | same | 3b (CLOSED) | C1 does not modify phantom-block behavior — hash check happens BEFORE business writes, so failed txn still stores no hash. |
| 3b-PG-E1 | 5-concurrent duplicate (Order, PostgreSQL) | `evidence/wave3-3b/evidence-postgresql-3b-pg-ev.json` | 3b (CLOSED) | Same as 3b-E4, on PostgreSQL. Workflow 31912679504, `ok:true`. |

**Total reused evidence:** 11 scenarios (5 from 3a, 6 from 3b). All remain valid proof for the flag-OFF path.

### 6.2 NEW evidence scenarios needed for 3c

3c must prove the **NEW behaviors** introduced by C1 — specifically the hash computation, hash storage, hash comparison, and 422-on-mismatch path. The 4 NEW scenarios below cover all dimensions of C1's behavior:

| # | Scenario name | Dimension | What it proves | Test setup | Expected invariant | Reuses 3b infra? |
|---|---------------|-----------|----------------|------------|---------------------|------------------|
| 3c-E1 | Same-key + same-body → cached response (flag-ON, backward-compat with 3b-E2) | Hash match path | With `requestHashEnforcement` flag ON, same-key + same-body request still returns cached response (no spurious 422). Proves the hash computation is deterministic and matches. | (1) Set `requestHashEnforcement=true` on staging Vercel preview. (2) POST /api/orders with `Idempotency-Key: K` + body B → 200, orderId=O1, `requestHash` stored. (3) POST /api/orders with same key K + same body B → 200, orderId=O1 (cached). (4) `/api/orders/evidence-verify?orderId=O1&idempotencyKey=K` → assert `idempotencyRecordExists: true`, `idempotencyRecord.requestHash` is non-null + matches `SHA-256(canonicalize(B))`. | `sameOrderId: true`, `cachedResponseReturned: true`, `idempotencyRecordExists: true`, `idempotencyRecord.requestHash === SHA-256(canonicalize(B))`, `orderCount: 1` | YES (mirror 3b-E2 + add `requestHash` assertion to evidence-verify response) |
| 3c-E2 | Same-key + different-body → 422 `IDEMPOTENCY_KEY_REUSE` (flag-ON, NEW behavior) | Hash mismatch path — the core 3c decision | With flag ON, same-key + materially-different-body returns HTTP 422 with `IDEMPOTENCY_KEY_REUSE` error code and actionable `details.retryStrategy: 'new-key'`. No second order created. | (1) Set `requestHashEnforcement=true`. (2) POST /api/orders with `Idempotency-Key: K` + body B1 (qty=1) → 200, orderId=O1. (3) POST /api/orders with same key K + body B2 (qty=3, materially different) → **422**, `error.code: 'IDEMPOTENCY_KEY_REUSE'`, `error.details.retryStrategy: 'new-key'`, `error.details.storedResourceId: O1`, `error.details.storedRequestHash: <first-16-chars>`, `error.details.receivedRequestHash: <first-16-chars>` (different from stored). (4) `/api/orders/evidence-verify?orderId=O1&idempotencyKey=K` → assert `orderCount: 1`, `orderId: O1` (only the first order; second was rejected), `idempotencyRecordExists: true`, `idempotencyRecord.resourceId: O1`. | `httpStatus: 422`, `errorCode: 'IDEMPOTENCY_KEY_REUSE'`, `retryStrategy: 'new-key'`, `storedRequestHash !== receivedRequestHash`, `exactlyOneOrder: true` | YES (mirror 3b-E3 + assert 422 instead of 200 cached) |
| 3c-E3 | Old IdempotencyKey record (`requestHash=null`) + same key + different body → cached response (flag-ON, backward-compat for pre-3c records) | Backward-compat for old records | With flag ON, a pre-3c record (requestHash=null) is treated as "no hash check" → cached response returned (Option A behavior preserved for old records). This proves the null-hash short-circuit. | (1) Set `requestHashEnforcement=true`. (2) Manually insert an `IdempotencyKey` row with `key=K`, `requestHash=null`, `responseStatus=200`, `responseBody=<cached JSON>`, `resourceType='Order'`, `resourceId='O_old'`, `expiresAt=<future>` (via evidence-setup or SQL). (3) POST /api/orders with `Idempotency-Key: K` + body B (different from the original) → **200** with cached response body (orderId=O_old). (4) Verify `orderCount: 1` (no new order created), `idempotencyRecordExists: true`, `idempotencyRecord.requestHash: null` (unchanged). | `httpStatus: 200`, `cachedResponseReturned: true`, `idempotencyRecord.requestHash: null`, `exactlyOneOrder: true` | YES (mirror 3b-E3 with pre-inserted null-hash record — requires evidence-setup extension to support manual IdempotencyKey insertion) |
| 3c-E4 | Old IdempotencyKey record (`requestHash=null`) + same key + same body → cached response (flag-ON, backward-compat for pre-3c records, same-body variant) | Backward-compat for old records, same-body | With flag ON, a pre-3c record (requestHash=null) + same body still returns cached response. Symmetric to 3c-E3 but with same body (proves the null-hash short-circuit is independent of body match/mismatch). | (1) Set `requestHashEnforcement=true`. (2) Manually insert a pre-3c IdempotencyKey row (requestHash=null) as in 3c-E3. (3) POST /api/orders with `Idempotency-Key: K` + body B (matching the original response's "would-be" body) → 200 cached. (4) Verify same as 3c-E3. | Same as 3c-E3 | YES |
| 3c-E5 (optional) | 5-concurrent same-key + same-body on PostgreSQL (flag-ON) — concurrency preserved | C1 doesn't break 3b-PG-E1's concurrency guarantee when flag is ON | With flag ON, 5 concurrent same-key + same-body requests still produce exactly 1 Order. The 4 losers hit P2002 on `storeIdempotencyRecord` → retry → `getCachedResponse` finds the row → hash matches (same body) → cached response returned. No 422 spurious. | (1) Set `requestHashEnforcement=true` on staging Vercel preview. (2) 5 concurrent POST /api/orders with same `Idempotency-Key: K` + same body B → all 5 return 200 with same orderId. (3) Verify `uniqueOrderIds: 1`, `orderCount: 1`, `idempotencyRecordCount: 1` (with non-null `requestHash`), `ok:true`, `database: 'postgresql'`. | `uniqueOrderIds: 1`, `orderCount: 1`, `idempotencyRecordExists: true`, `idempotencyRecord.requestHash` non-null, `ok: true`, `database: 'postgresql'` | YES (mirror 3b-PG-E1 workflow with flag ON) |

**Total NEW scenarios: 5 (4 required + 1 optional PostgreSQL-concurrency proof).**

### 6.3 Why these 5 scenarios are sufficient (coverage matrix)

| C1 dimension | Covered by scenario(s) |
|--------------|--------------------------|
| Hash computation is deterministic (same body → same hash) | 3c-E1 (same body → match) |
| Hash storage works (new rows have non-null hash) | 3c-E1, 3c-E5 |
| Hash comparison works (different body → mismatch → 422) | 3c-E2 |
| Null-hash backward-compat (old records skip check) | 3c-E3, 3c-E4 |
| Feature flag gating (flag-OFF → no enforcement; flag-ON → enforcement) | 3c-E1 (flag-ON, same body), 3c-E2 (flag-ON, diff body), 3c-E3/E4 (flag-ON, null hash) |
| Concurrency preserved (5-concurrent same-key + same-body still → 1 order) | 3c-E5 (PostgreSQL, flag-ON) |
| 3a/3b evidence not regressed (flag-OFF path unchanged) | 3a-E1..3a-PG-E1 + 3b-E1..3b-PG-E1 (CLOSED, NOT re-run) |

### 6.4 Evidence infrastructure reuse

3c reuses the **3b evidence infrastructure pattern** (the same one 3b inherited from 3a):

| Component | 3b source | 3c adaptation |
|-----------|-----------|---------------|
| Evidence-setup endpoint | `src/app/api/orders/evidence-setup/route.ts` | Reuse as-is. Optionally extend to support a `?preInsertIdempotencyKey=true` query param for 3c-E3/E4 (manually insert a pre-3c record with `requestHash=null`). |
| Evidence-verify endpoint | `src/app/api/orders/evidence-verify/route.ts` | Extend to return `idempotencyRecord.requestHash` in the response (currently not exposed — see lines 81–91 of the file, the `select` clause omits `requestHash`). Add `requestHash: true` to the `select`. |
| Failure-injection header | `X-Evidence-Fail-After` on `orders/route.ts` | Reuse as-is. The 5 checkpoints (menu-item-decrement, order-create, audit-log, idempotency-record, outbox) are sufficient — C1 doesn't add new failure-injection checkpoints (the hash check happens BEFORE menu-item-decrement, so failure-injecting at "hash-check" is equivalent to failure-injecting at the start of the txn, which is already covered by the rollback scenarios). |
| Evidence runner script | `scripts/wave3-3b-evidence.mjs` | Mirror as `scripts/wave3-3c-evidence.mjs`. Run 4-5 tests (3c-E1..3c-E5). Generate self-validating JSON with `ok:true, subWave: '3c', featureFlag: 'requestHashEnforcement'`. |
| GitHub Actions workflow | `.github/workflows/subwave-3b-postgresql-concurrent-evidence.yml` | Mirror as `.github/workflows/subwave-3c-postgresql-concurrent-evidence.yml`. Adapt for 3c: (a) set `requestHashEnforcement=true` env var on Vercel preview (in addition to `EVIDENCE_TEST_MODE=true`), (b) swap evidence-setup/verify URLs to 3c-aware variants (or reuse 3b URLs with extended query params), (c) update JSON output shape to include `requestHashEnforcement: true`. |

**No new infrastructure pattern needed.** The 3a→3b→3c chain reuses the same Vercel preview deploy + Supabase Management API verification + self-validating JSON pattern.

### 6.5 What NEW evidence proves (vs what 3a/3b already proved)

| Behavior | Proven by 3a/3b? | Proven by 3c? |
|----------|------------------|----------------|
| Same key + same body → cached response (Option A, flag-OFF) | ✅ 3a-E2, 3b-E2 | n/a (3c doesn't re-prove) |
| Same key + same body → cached response (Option B, flag-ON) | ❌ | ✅ 3c-E1 |
| Same key + different body → cached response (Option A, flag-OFF) | ✅ 3a-E3, 3b-E3 | n/a (3c doesn't re-prove; 3a/3b evidence remains valid for the flag-OFF path) |
| Same key + different body → 422 (Option B, flag-ON) | ❌ | ✅ 3c-E2 |
| Old records (`requestHash=null`) skip hash check | ❌ | ✅ 3c-E3, 3c-E4 |
| Hash computation is deterministic | ❌ | ✅ 3c-E1 (implied by hash-match path) |
| Hash storage works on new records | ❌ | ✅ 3c-E1, 3c-E5 |
| 5-concurrent same-key + same-body → exactly 1 order (flag-OFF) | ✅ 3a-PG-E1, 3b-PG-E1 | n/a |
| 5-concurrent same-key + same-body → exactly 1 order (flag-ON) | ❌ | ✅ 3c-E5 (optional but recommended) |

---

## 7. Required Implementation (Code/Schema/API changes)

> **READ-ONLY Gate Review.** These changes are described for planning purposes only. They MUST NOT be implemented in this Gate Review. The Orchestrator's authorization to implement 3c is a separate decision.

### 7.1 Schema changes

**Single change:** Add a nullable `requestHash` column to the `IdempotencyKey` model.

```prisma
model IdempotencyKey {
  id              String   @id @default(cuid())
  key             String   @unique
  resourceType    String
  resourceId      String
  responseStatus  Int
  responseBody    String
  createdAt       DateTime @default(now())
  expiresAt       DateTime
  // C1 (Sub-Wave 3c): SHA-256 hash of the canonicalized request body.
  // NULL for pre-3c records (skip hash check — backward-compat).
  // Non-null for post-3c records (enforce hash check when feature flag ON).
  requestHash     String?

  @@index([resourceType, resourceId])
}
```

**Migration class:** Class-2 expand-migrate-contract (additive nullable column — no default, no breaking change).

**Migration file:** Would be created by `prisma migrate dev --name wave3_3c_add_request_hash` during implementation (NOT in Gate Review scope).

**Staging apply:** Via GitHub Actions workflow (mirror of 3a/3b staging-migration pattern).

**Production apply:** NOT authorized in 3c. Staging-only.

### 7.2 API changes

**Single new error response:** HTTP 422 with `IDEMPOTENCY_KEY_REUSE` error code.

```json
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSE",
    "message": "Idempotency-Key was already used for a different request. Generate a new Idempotency-Key and retry.",
    "traceId": "<uuid>",
    "details": {
      "idempotencyKey": "<the-key>",
      "resourceType": "Order" | "Payment",
      "storedResourceId": "<original-resource-id>",
      "storedRequestHash": "<first-16-chars-of-sha256-hex>",
      "receivedRequestHash": "<first-16-chars-of-sha256-hex>",
      "retryStrategy": "new-key"
    }
  }
}
```

**Backward compatibility:** Additive — clients that don't recognize `IDEMPOTENCY_KEY_REUSE` will see a generic 4xx error and can retry with a new key. No existing 200/409/500 response shape changes.

### 7.3 Code changes

| File | Change | Lines (est.) | Risk |
|------|--------|--------------|------|
| `prisma/schema.prisma` | Add `requestHash String?` column to `IdempotencyKey` model. | +1 | LOW |
| `prisma/scripts/wave3-subwave-3c-migration.sql` | NEW migration SQL (Class-2 additive `ALTER TABLE`). | +15 | LOW |
| `src/lib/idempotency.ts` | (1) Add `IdempotencyKeyReuseError` class. (2) Modify `getCachedResponse` to accept `incomingRequestHash?: string` parameter + compare with stored hash (gated by `requestHashEnforcement` flag + null-hash short-circuit). (3) Modify `storeIdempotencyRecord` to accept `requestHash?: string` parameter + store it. (4) Add `canonicalize(body)` helper (or use `fast-json-stable-stringify`). (5) Add `computeRequestHash(body)` helper using Web Crypto API. | +60 | MEDIUM (shared library, both routes affected) |
| `src/lib/deployment.ts` | Add `requestHashEnforcement` feature flag (default `false`). | +5 | LOW |
| `src/app/api/orders/route.ts` | (1) Compute `requestHash` from validated body BEFORE `withTransaction`. (2) Pass `requestHash` to `getCachedResponse` + `storeIdempotencyRecord`. (3) Add `catch (error) { if (error instanceof IdempotencyKeyReuseError) return apiError('IDEMPOTENCY_KEY_REUSE', ..., 422, {...details}) }`. | +20 | MEDIUM |
| `src/app/api/payments/route.ts` | Same as orders/route.ts but for Payment capture body. | +20 | MEDIUM |
| `src/app/api/orders/evidence-verify/route.ts` | Add `requestHash: true` to the `select` clause (line 88) + include `requestHash` in response body. | +3 | LOW |
| `src/app/api/payments/evidence-verify/route.ts` | Same as orders/evidence-verify but for Payment. | +3 | LOW |
| `src/app/api/orders/evidence-setup/route.ts` | (Optional) Add `?preInsertIdempotencyKey=true` query param to support 3c-E3/E4 (manually insert a pre-3c record with `requestHash=null`). | +15 | LOW (dev-only, gated by `EVIDENCE_TEST_MODE`) |
| `scripts/wave3-3c-evidence.mjs` | NEW evidence runner script. Mirrors `wave3-3b-evidence.mjs` structure. Runs 3c-E1..3c-E4 (SQLite local). | +200 | LOW (dev-only) |
| `scripts/run-3c-evidence.sh` | NEW shell wrapper (starts dev server with `EVIDENCE_TEST_MODE=true` + `requestHashEnforcement=true` + runs evidence script). | +20 | LOW (dev-only) |
| `.github/workflows/subwave-3c-postgresql-concurrent-evidence.yml` | NEW workflow. Mirrors 3b workflow. Sets `requestHashEnforcement=true` + `EVIDENCE_TEST_MODE=true` on Vercel preview + runs 3c-E5. | +800 | LOW (workflow-only) |
| `.github/workflows/wave3-3c-staging-migration.yml` | NEW workflow to apply the migration to staging Supabase. | +200 | LOW (workflow-only) |

**Total:** ~14 files touched/created, ~1362 lines added. Most are dev-only (evidence + workflow) — production code changes are limited to `idempotency.ts` (~60 lines), `deployment.ts` (~5 lines), `orders/route.ts` (~20 lines), `payments/route.ts` (~20 lines), `schema.prisma` (~1 line). Total production code delta: ~106 lines.

### 7.4 Migration class summary

- **Schema:** Class-2 expand-migrate-contract (additive nullable column).
- **API:** Additive (new 422 error response; no existing response shape changed).
- **Code:** Additive (new error class, new optional parameters, new feature flag).
- **Feature flag:** New `requestHashEnforcement` flag, default OFF. Code path is dormant until flag is enabled.
- **Rollback:** Git revert + `ALTER TABLE IdempotencyKey DROP COLUMN requestHash` (safe because column is nullable + code path is feature-flagged OFF).

---

## 8. Risk / Rollback Analysis

### 8.1 Risk level: **MEDIUM**

**Justification:**

- **MEDIUM, not LOW**, because C1 modifies the **shared idempotency library** (`src/lib/idempotency.ts`) that both critical paths (`/api/orders` + `/api/payments`) depend on. A bug in the hash computation or comparison logic could break ALL idempotent writes, not just one route. Blast radius = Order creation + Payment capture = the two most critical paths in the system.
- **MEDIUM, not HIGH**, because:
  - The feature flag (`requestHashEnforcement`, default OFF) provides a kill-switch. Even after deploy, the new code path is dormant. A bug in the hash-computation code would NOT affect production behavior until the flag is flipped ON.
  - The schema migration is Class-2 expand-migrate-contract (additive nullable column). Old code (pre-3c) reads the new column as `null` and continues to work. No breaking change to existing rows.
  - The null-hash short-circuit provides backward compatibility for pre-3c records. Even with the flag ON, old records continue to behave per Option A.
  - The 3a/3b evidence (11 scenarios, S5 PASS / CLOSED) remains valid for the flag-OFF path. The flag-OFF path is byte-identical to 3b behavior. So even if 3c introduces a bug, the 3a/3b evidence proves the flag-OFF path is safe.

### 8.2 Rollback plan

| Implementation scope | Rollback procedure | Time | Safe by default? |
|----------------------|---------------------|------|------------------|
| Schema only (add column) | `ALTER TABLE IdempotencyKey DROP COLUMN requestHash` (safe — column is nullable + no indexes depend on it). | <5 min | YES |
| Code only (idempotency.ts + deployment.ts + routes) | Git revert. No DB rollback needed (column remains nullable; old code reads `null` for all new rows, which triggers the null-hash short-circuit). | <10 min | YES |
| Feature flag flip (OFF → ON) | Flip flag back to OFF (via Vercel env var or deployment.ts `getFlag` default). No code deploy needed if flag is read at runtime. | <1 min | YES |
| Full 3c deploy (schema + code + flag ON) | (1) Flip flag to OFF. (2) Git revert code. (3) `DROP COLUMN requestHash`. All three steps are independent and safe. | <15 min | YES |

### 8.3 Blast radius

**HIGH** — C1 touches the shared idempotency library used by Order POST + Payment POST. A bug in `getCachedResponse` could:
- Block all Order creation (consumers can't place orders → revenue impact).
- Block all Payment capture (consumers can't pay for orders → revenue impact).
- Spuriously 422 valid retries (clients see "IDEMPOTENCY_KEY_REUSE" when retrying the SAME body due to a hash-canon bug).

**Mitigations:**
1. Feature flag (`requestHashEnforcement`, default OFF) — dormant code path until explicitly enabled.
2. Staging-first deployment (Vercel preview). Evidence scenarios (3c-E1..3c-E5) MUST pass on staging PostgreSQL before any production consideration.
3. Production deployment is NOT authorized in 3c (per Orchestrator directive).
4. The `EVIDENCE_TEST_MODE` gate ensures evidence endpoints are NOT accessible in production.
5. The hash-canon algorithm is testable in isolation (unit test the `canonicalize` + `computeRequestHash` functions against known inputs/outputs) — this should be the first unit test added, before any integration test.

### 8.4 P0 dependencies that could complicate 3c

| Dependency | Status | Complication risk for 3c |
|-----------|--------|--------------------------|
| P0-17 (idempotency infrastructure) | ✅ S5 PASS (Wave-1 1a) | LOW — C1 extends the library; old functions unchanged. The 3a regression analysis confirmed retry-safety of all 4 callers. |
| P0-24 (transactional outbox) | ✅ S5 PASS (Wave-2 CLOSED) | NONE — C1 does not touch outbox. |
| P0-25 (concurrency + duplicate-exec) | ✅ S5 PASS (Wave-1 Track B) | LOW — C1's hash check is positioned BEFORE the optimistic-lock decrement; no interaction with P0-25's race-prevention logic. 3c-E5 verifies concurrency preserved. |
| P0-01 (Razorpay capture, 3a) | ✅ S5 PASS / CLOSED | LOW — C1 modifies the shared library used by `/api/payments`. The 3a evidence (3a-E1..3a-PG-E1) remains valid for the flag-OFF path. With flag ON, a NEW Payment-side 3c-style evidence scenario would be required — but 3c does NOT enable the flag, so 3a evidence stays valid. (If the flag is enabled in a future wave, that wave must run a Payment-specific 3c-E2 equivalent.) |
| P0-08 (Order idempotency, 3b) | ✅ S5 PASS / CLOSED | LOW — same as P0-01. |
| P0-27 (deployment & rollback, 3 classes) | ✅ S5 PASS | LOW — C1 is Class-2 expand-migrate-contract. Rollback procedure is well-defined (§8.2). |

**No blocking dependencies.** All predecessors are CLOSED/S5.

### 8.5 Does C1 interact with `withTransaction` retry? (explicit answer)

**YES, but safely.** The hash check happens INSIDE the txn body (in `getCachedResponse`, which is the FIRST call inside `withTransaction`). On retry:

1. `withTransaction` catches a retryable conflict (P2002/P1008/P2024/P2034/P2036).
2. Backoff + retry — the SAME `fn` callback is invoked fresh.
3. `getCachedResponse(tx, key, incomingRequestHash)` re-runs.
4. Reads the same `IdempotencyKey` row (either committed by the prior attempt, or by a sibling transaction).
5. Hash check: `incomingRequestHash` (computed once outside the txn — same value on every retry) compared with `record.requestHash` (deterministic — same value on every read).
6. **If hash matches:** cached response returned → short-circuit (same as today).
7. **If hash mismatches:** `IdempotencyKeyReuseError` thrown → propagates out of `withTransaction` (NOT a retryable conflict — `isRetryableConflict` returns `false` for non-Prisma errors). Route handler catches it → HTTP 422.

**Is this correct?** YES. If the hash mismatches on retry, it will mismatch on every retry (the stored hash is committed; the incoming hash is fixed). Retrying would be wasteful. The 422 is the correct terminal behavior — the client must generate a new `Idempotency-Key`.

**Edge case:** What if the FIRST attempt's txn committed (stored hash = H1), but the client's retry sends a DIFFERENT body (hash = H2)? The hash check correctly returns 422. The client must generate a new key. This is the intended Option B behavior — no bug.

**Edge case:** What if the FIRST attempt's txn rolled back (no row stored), and the retry sends the SAME body (hash = H1)? `getCachedResponse` returns `null` (no row) → proceeds with business write → stores row with `requestHash = H1`. No 422. Correct behavior — this is the 3b-E5 phantom-block scenario, preserved.

### 8.6 Hazards explicitly out of scope for 3c

- ❌ `realPayments` flag — remains OFF. No Razorpay gateway changes. The Payment-side hash check applies to the request body (`orderId`, `razorpayPaymentId`, `razorpaySignature`), NOT to gateway-side state.
- ❌ `requestHashEnforcement` flag enablement — flag is IMPLEMENTED (default OFF) but NOT enabled. Enablement requires separate Orchestrator authorization in a future wave.
- ❌ Webhook handler — Wave-4 scope. WebhookEvent model remains schema-only.
- ❌ Refund flow — Wave-5 scope.
- ❌ Reconciliation job — Wave-5 scope.
- ❌ `withTransaction` retry-list expansion — already done in 3a, NOT touched in 3c.
- ❌ Move `captureRazorpayPayment()` outside the txn body — out of 3c scope. The `TRANSACTION_RETRY_INVARIANT.md` hazard remains documented but unmitigated (gated by `realPayments=false`).
- ❌ Production deployment — NOT authorized.
- ❌ Wave-4+ — NOT started.

---

## 9. Exit Criteria

3c is declared **S5 PASS** when ALL of the following are true:

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | All NEW evidence scenarios (3c-E1, 3c-E2, 3c-E3, 3c-E4) PASS on SQLite local | Self-validating JSON with `ok:true` for each; saved to `evidence/wave3-3c/evidence-3c-ev-<runId>.json` |
| 2 | 3c-E5 (PostgreSQL concurrency, flag-ON) PASS with `ok:true, database: 'postgresql', uniqueOrderIds: 1, orderCount: 1, idempotencyRecordExists: true, idempotencyRecord.requestHash` non-null | GitHub Actions workflow run, evidence JSON saved to `evidence/wave3-3c/evidence-postgresql-3c-pg-ev.json` |
| 3 | 3a/3b evidence NOT re-run (already CLOSED) | Confirmed by worklog — 3c does NOT re-execute 3a-E1..3a-PG-E1 or 3b-E1..3b-PG-E1 |
| 4 | No regression in existing tests | 3a/3b evidence JSONs unchanged; lint PASS; typecheck PASS for `withTransaction` surface; existing unit tests (if any) PASS |
| 5 | Lint PASS | `bun run lint` exit 0 |
| 6 | Production untouched | No production deploy, no production env vars modified, no production migration |
| 7 | `realPayments` OFF | Confirmed via `src/lib/deployment.ts` (flag defaults to false) |
| 8 | `requestHashEnforcement` flag OFF in production (staging may be ON for evidence) | Confirmed via Vercel env vars — flag is set to `true` ONLY on the staging Vercel preview during evidence runs; production Vercel target has flag unset (defaults to false) |
| 9 | Cross-P0 invariants preserved (documented in §5 of this Gate Review) | Each invariant in the §5.1 matrix verified SAFE; no regression in 3a/3b closure criteria |
| 10 | Schema/env restored to production state after evidence runs | `prisma/schema.prisma` provider = `postgresql`; `.env` clean (no temp SQLite params); Prisma client regenerated for PostgreSQL; `requestHash` column exists on staging but is nullable + unused in production code path (flag OFF) |
| 11 | WAVE3_EVIDENCE.md updated with Sub-Wave 3c evidence section | All 5 NEW scenarios documented with PASS/FAIL + evidence JSON links; §11 "Sub-Wave 3c — S5 PASS / CLOSED" section added |
| 12 | No external gateway side-effect inside any `withTransaction` body (per `docs/TRANSACTION_RETRY_INVARIANT.md`) | Code-review checklist — C1 does NOT add any external call inside the txn body. The hash computation happens OUTSIDE the txn (before `withTransaction`); the hash comparison happens INSIDE the txn (in `getCachedResponse`) but is pure DB read + in-memory string compare. No HTTP, no gateway, no I/O outside DB. |
| 13 | C1 `requestHash` enforcement is FEATURE-FLAGGED OFF by default | Confirmed via `src/lib/deployment.ts` — `requestHashEnforcement` flag defaults to `false`. Production code path is dormant. |
| 14 | 3c does NOT enable the flag, does NOT deploy to production, does NOT touch `realPayments`, does NOT start Wave-4+ | Worklog confirms; governance state at end of 3c: `Sub-Wave 3c ✅ S5 PASS / CLOSED`, `requestHashEnforcement = OFF (dormant)`, `Production 🚫 NOT AUTHORIZED`, `realPayments 🚫 OFF`, `Wave-4 🔒 LOCKED`. |

---

## 10. Recommendation

### **CONDITIONAL-GO**

**Justification:**

3c implementation is **feasible, well-scoped, and medium-risk** — provided the following conditions are met:

#### Conditions (must be honored by the 3c implementation agent)

1. **Schema change is Class-2 expand-migrate-contract ONLY.** Add nullable `requestHash String?` column to `IdempotencyKey`. Do NOT add NOT NULL constraints, do NOT add indexes on `requestHash`, do NOT modify existing columns. Migration applied to staging ONLY (via GitHub Actions workflow, mirror of 3a/3b staging-migration pattern). Production migration is NOT authorized in 3c.

2. **Feature flag `requestHashEnforcement` MUST be implemented with default OFF.** The code path computes the hash on insert (stored for all new records) but `getCachedResponse` SKIPS the comparison check when the flag is OFF. This provides a kill-switch for new records in addition to the null-hash short-circuit for old records. The flag is set to `true` ONLY on the staging Vercel preview during evidence runs.

3. **DO NOT enable the flag in production.** 3c IMPLEMENTS the flag (default OFF) but does NOT flip it to ON in production. Flag enablement requires separate Orchestrator authorization in a future wave (3d or later), with a fresh Gate Review confirming the production-impact analysis.

4. **DO NOT modify `withTransaction` (`src/lib/db.ts`).** The retry-list expansion (P2002/P1008/P2024) was done in 3a and is regression-analyzed (PASS-WITH-DOCUMENTED-RISK). The new `IdempotencyKeyReuseError` is NOT a retryable conflict — it must NOT be added to `isRetryableConflict`. The retry loop must treat it as "non-retryable, rethrow as-is."

5. **DO NOT move `captureRazorpayPayment()` outside the txn body.** This is out of 3c scope (TRANSACTION_RETRY_INVARIANT.md hazard mitigation is Wave-3b/3c-adjacent but separate). 3c only adds the hash check; it does NOT change where external calls happen. `realPayments` remains OFF.

6. **REUSE the 3b evidence infrastructure pattern.** Extend `src/app/api/orders/evidence-verify/route.ts` to expose `idempotencyRecord.requestHash` in the response (add `requestHash: true` to the `select` clause). Optionally extend `src/app/api/orders/evidence-setup/route.ts` to support `?preInsertIdempotencyKey=true` for 3c-E3/E4 (manually insert a pre-3c record with `requestHash=null`). Create parallel `evidence-setup`/`evidence-verify` extensions for `/api/payments/` if a Payment-side 3c evidence scenario is desired (optional — 3c-E1..3c-E5 cover Order POST; Payment-side is structurally identical and can be inferred).

7. **PostgreSQL-native concurrency evidence (3c-E5) is REQUIRED for S5 closure** (Option B parallel — same precedent as 3a-PG-E1 + 3b-PG-E1). 3c-E5 must run on staging PostgreSQL (Supabase) and produce a self-validating JSON with `database: 'postgresql', ok: true, uniqueOrderIds: 1, idempotencyRecordExists: true, idempotencyRecord.requestHash` non-null. SQLite-only evidence is NOT sufficient (same bar as 3a + 3b).

8. **Implement 4 NEW SQLite evidence scenarios (3c-E1, 3c-E2, 3c-E3, 3c-E4) + 1 NEW PostgreSQL scenario (3c-E5).** Total: 5 NEW scenarios. Do NOT re-run the 11 CLOSED 3a/3b scenarios — they remain valid proof for the flag-OFF path.

9. **Implement the hash computation using a CANONICAL JSON form.** Use `fast-json-stable-stringify` (or equivalent) for canonicalization. Do NOT use raw `JSON.stringify(body)` — key ordering is not guaranteed across clients. Hash algorithm: SHA-256 (Web Crypto API `crypto.subtle.digest` for Edge-runtime compatibility, OR Node.js `crypto.createHash` since route handlers run on Node.js).

10. **Hash scope: BODY ONLY.** Do NOT include URL path, HTTP method, or headers in the hash. The body is the dominant signal of client intent. The `resourceType` column already records which resource the key created (audit trail without needing URL/method in the hash).

11. **Error response shape follows §3.3 of this Gate Review.** HTTP 422 with `error.code: 'IDEMPOTENCY_KEY_REUSE'`, `error.details.retryStrategy: 'new-key'`, `error.details.storedResourceId`, `error.details.storedRequestHash` (truncated to first 16 chars), `error.details.receivedRequestHash` (truncated to first 16 chars). Do NOT include the full 64-char hash in the response (defense-in-depth against hash-inversion attacks).

12. **DO NOT start Wave-4+ .** 3c remains the final Sub-Wave of Wave-3. Wave-4 (webhook handler) requires separate Orchestrator authorization. After 3c S5 PASS, the IDE MUST STOP and await Orchestrator direction.

#### Why CONDITIONAL-GO (not GO)?

- The implementation is feasible (5 NEW scenarios, 3b-infra reuse, Class-2 migration, feature-flagged). A GO would be appropriate if the Orchestrator is willing to accept the medium-risk scope (shared library change, both critical paths affected).
- The CONDITIONAL qualifier reflects the **medium risk** (shared `idempotency.ts` modification, blast radius HIGH for both critical paths) and the **flag-enablement deferral** (3c implements but does NOT enable — production enablement is a separate decision).

#### Why CONDITIONAL-GO (not NO-GO)?

- The C1 design is well-specified (canonicalization, hash algorithm, error shape, backward-compat all defined in this Gate Review).
- The 3a/3b evidence (11 scenarios, S5 PASS / CLOSED) remains valid for the flag-OFF path — 3c does not regress 3a/3b.
- The feature flag provides a kill-switch — even after deploy, the new code path is dormant until explicitly enabled.
- All P0-08/P0-01/P0-17 predecessors are CLOSED/S5 — no blocking dependencies.
- The 3a regression analysis confirms `withTransaction` retry-safety for all 4 callers; C1's `IdempotencyKeyReuseError` is non-retryable and propagates cleanly out of the retry loop.
- The 3a architectural invariant (`TRANSACTION_RETRY_INVARIANT.md`) is preserved — C1 does not move or add external calls.

#### Decision points for Orchestrator resolution

1. **D1 (3c scope):** Authorize C1 implementation + 5 NEW evidence scenarios + feature-flagged-OFF deploy to staging only? Default recommendation: **YES** (CONDITIONAL-GO).
2. **D2 (flag enablement):** Authorize `requestHashEnforcement` flag enablement in production as part of 3c, or defer to 3d? Default recommendation: **DEFER to 3d** (or later) — 3c implements but does NOT enable.
3. **D3 (Payment-side evidence):** Require a Payment-side 3c-E2 equivalent (same-key + different-body → 422 for `/api/payments`), or accept Order-side 3c-E2 as structurally-transferable proof? Default recommendation: **ACCEPT Order-side as transferable** (the shared `idempotency.ts` library means the hash-check logic is identical for both routes; a Payment-side test would be redundant). If the Orchestrator wants the extra rigor, a Payment-side 3c-E2 can be added (mirrors Order-side, swaps body schema + URL).
4. **D4 (hash algorithm):** SHA-256 (recommended), SHA-3, or BLAKE3? Default recommendation: **SHA-256** (FIPS standard, universally available, adequate security for 24h-TTL cache).
5. **D5 (canonicalization):** `fast-json-stable-stringify` (recommended library), RFC 8785 full implementation, or hand-rolled? Default recommendation: **`fast-json-stable-stringify`** (well-maintained, covers key sorting + compact output; sufficient for SnakZap's integer-only body schemas).

#### Next steps for Orchestrator decision

1. **Resolve Decision D1** (authorize 3c implementation scope — C1 + 5 NEW scenarios + flag-OFF staging deploy).
2. **Resolve Decision D2** (flag-enablement timing — defer to 3d or later).
3. **Resolve Decision D3** (Payment-side evidence scope — accept Order-side as transferable, or require Payment-side).
4. **Resolve Decision D4** (hash algorithm — SHA-256 default).
5. **Resolve Decision D5** (canonicalization library — `fast-json-stable-stringify` default).
6. **Authorize 3c implementation** with the chosen scope.
7. **Do NOT authorize production deploy. Do NOT enable `realPayments`. Do NOT enable `requestHashEnforcement` in production. Do NOT start Wave-4.**

---

## 11. Governance Compliance

This Gate Review was conducted under the Orchestrator's READ/PLAN-FIRST authorization for Sub-Wave 3c. The following constraints were honored:

| Constraint | Status |
|-----------|--------|
| No source-code modification (`.ts` files) | ✅ HONORED — no `.ts` files were edited |
| No `prisma/schema.prisma` modification | ✅ HONORED — schema file unchanged |
| No migration files created | ✅ HONORED — no new SQL migration scripts |
| No evidence tests executed | ✅ HONORED — no test runs; only file reads + analysis |
| No production deploy | ✅ HONORED — production untouched |
| No `realPayments` enable | ✅ HONORED — `realPayments` flag unchanged (defaults to false, per `src/lib/deployment.ts`) |
| No `requestHashEnforcement` flag added | ✅ HONORED — flag does NOT exist yet (3c implementation would add it, default OFF; this Gate Review only DESCRIBES the flag, does not create it) |
| No Sub-Wave 3c implementation start | ✅ HONORED — only this document produced |
| No Wave-4+ start | ✅ HONORED — Wave-4 remains LOCKED |
| Files read, analyzed, and Gate Review document produced | ✅ DONE — see §11.1 for the file inventory |
| Worklog appended | ✅ DONE — appended as Task ID `3c-gate-review` |

### 11.1 Files read for this Gate Review

| File | Lines | Purpose |
|------|-------|---------|
| `/home/z/my-project/worklog.md` (lines 4840–5236) | ~400 | Sub-Wave 3a closure + 3b Gate Review + 3b workflow-adapt + 3b PostgreSQL evidence + 3b S5 closure records — establishes that 3a + 3b are CLOSED, C1 deferred to 3c |
| `/home/z/my-project/src/lib/idempotency.ts` | 99 | IdempotencyKey library (getCachedResponse, storeIdempotencyRecord, parseCachedResponse) — primary modification target for C1 |
| `/home/z/my-project/src/lib/db.ts` | 176 | withTransaction helper (retry logic, MAX_RETRIES=5, retryable error codes P2002/P1008/P2024/P2034/P2036) — verifies retry-safety of new IdempotencyKeyReuseError |
| `/home/z/my-project/src/lib/outbox.ts` | 108 | Outbox helper (enqueueOutboxEvent) — verifies C1 does not break outbox atomicity |
| `/home/z/my-project/src/lib/razorpay.ts` | 137 | Razorpay SDK wrapper — confirms C1 does not change external-call placement |
| `/home/z/my-project/src/lib/validation.ts` | 112 | createOrderBodySchema + captureBodySchema — confirms body schemas are distinct + Zod-validated (hash computed post-validation) |
| `/home/z/my-project/src/middleware.ts` | 195 | CSRF + rate limiting — confirms `/api/orders` and `/api/payments` are classified as `payment` rate limit (10/min); evidence endpoints are exempt |
| `/home/z/my-project/src/app/api/orders/route.ts` | 395 | Order POST route — primary idempotency surface (uses getCachedResponse + storeIdempotencyRecord) |
| `/home/z/my-project/src/app/api/payments/route.ts` | 299 | Payment POST route — second idempotency surface (uses same library) |
| `/home/z/my-project/src/app/api/orders/[id]/status/route.ts` | 169 | Order status PATCH — uses optimistic-lock, NOT idempotency (boundary is clean) |
| `/home/z/my-project/src/app/api/orders/evidence-setup/route.ts` | 108 | 3b evidence-setup endpoint — base pattern for 3c evidence infra reuse |
| `/home/z/my-project/src/app/api/orders/evidence-verify/route.ts` | 169 | 3b evidence-verify endpoint — needs `requestHash` added to `select` clause for 3c |
| `/home/z/my-project/src/app/api/payments/evidence-setup/route.ts` | 119 | 3a evidence-setup endpoint — base pattern |
| `/home/z/my-project/src/app/api/payments/evidence-verify/route.ts` | 167 | 3a evidence-verify endpoint |
| `/home/z/my-project/prisma/schema.prisma` | 427 | IdempotencyKey model (current schema) — C1 would add `requestHash String?` column |
| `/home/z/my-project/SUBWAVE_3B_GATE_REVIEW.md` | 597 | 3b Gate Review — has C1 candidate analysis in §5.3 (deferred to 3c) |
| `/home/z/my-project/SUBWAVE_3_GATE_REVIEW.md` | 142 | Original Sub-Wave 3 Gate Review — has 3c scope outline in §Q5 |
| `/home/z/my-project/WAVE3_EVIDENCE.md` | 943 | Wave-3 evidence (3a + 3b sections, both S5 PASS / CLOSED) |
| `/home/z/my-project/evidence/wave3-3a/evidence-postgresql-3a-pg-ev.json` | 135 | 3a PostgreSQL evidence (workflow 31896343466, `ok:true`) |
| `/home/z/my-project/evidence/wave3-3b/evidence-postgresql-3b-pg-ev.json` | 133 | 3b PostgreSQL evidence (workflow 31912679504, `ok:true`) |
| `/home/z/my-project/evidence/wave3-3b/evidence-3b-ev-1786832887563-41ed55ac.json` | 241 | 3b SQLite evidence (5/5 PASS, includes 3b-E3 conflict test — Option A behavior) |
| `/home/z/my-project/evidence/wave3-3a/regression-analysis.md` | 357 | withTransaction regression analysis (4 callers, retry-safety, PASS-WITH-DOCUMENTED-RISK) |
| `/home/z/my-project/docs/TRANSACTION_RETRY_INVARIANT.md` | 536 | Architectural invariant doc (external gateway side-effect ≠ blind DB retry) |
| `/home/z/my-project/P0_TRACEABILITY_MAP.md` | 192 | P0 traceability (P0-08 → I-02, I-10; P0-17 → I-04, I-10) |
| `/home/z/my-project/P0_DEPENDENCY_GRAPH.md` | 408 | P0 dependencies (P0-08 depends on P0-24 + P0-25, both CLOSED/S5) |

### 11.2 Confirmed governance state at end of this Gate Review

```text
Wave-0        ✅ CLOSED
Wave-1        ✅ CLOSED
Wave-2        ✅ CLOSED

Wave-3        🔓 UNLOCKED

Sub-Wave 3a   ✅ S5 PASS / CLOSED — WILL NOT REOPEN
Sub-Wave 3b   ✅ S5 PASS / CLOSED — WILL NOT REOPEN
Sub-Wave 3c   🟡 READ/PLAN-FIRST GATE REVIEW COMPLETE
              ├─ Recommendation: CONDITIONAL-GO
              ├─ Awaiting Orchestrator decision on D1–D5
              ├─ Implementation NOT started
              └─ No code/schema/migration/evidence changes made

Wave-4+       🔒 LOCKED — NOT AUTHORIZED
Production    🚫 NOT AUTHORIZED
realPayments  🚫 OFF
requestHashEnforcement  🚫 DOES NOT EXIST YET (3c implementation would add it, default OFF)
```

---

**End of Sub-Wave 3c READ/PLAN-FIRST Gate Review.**

**Recommendation: CONDITIONAL-GO.** Awaiting Orchestrator decision on the 5 decision points (D1–D5) and authorization to implement 3c (C1 + 5 NEW evidence scenarios + feature-flagged-OFF staging deploy only).

**STOP. No implementation started. No Wave-4 started. No production touched. `realPayments` OFF. `requestHashEnforcement` does not exist yet.**
