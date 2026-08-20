# U12 — Pickup Verification UI Gap Report

> **Status:** DOCUMENTATION ONLY — produced by Task ID 3 of `PRODUCT-FOUNDATION-IMPLEMENT-01`.
> **Decision authority:** Orchestrator (the resolution options at the bottom are presented for
> Orchestrator decision; they are NOT implemented in this task).
> **Hard rule honored:** No `src/app/api/**` or `src/lib/**` files were modified in producing
> this report (governance boundary).

---

## 1. The vertical slice target

The product vertical slice for `PRODUCT-FOUNDATION-IMPLEMENT-01` runs:

```
Consumer → Cart → Checkout → Order → Vendor → Pickup
```

The final hop (**Vendor → Pickup**) is supposed to call the P0-07 pickup-attribution endpoint:

```
POST /api/orders/[id]/pickup/verify
Body: { otpId, code, qrToken }
```

(Source: `src/app/api/orders/[id]/pickup/verify/route.ts:69-394`,
 schema: `src/lib/validation.ts:96-100` — `pickupVerifyBodySchema`.)

That endpoint is fully implemented and runtime-active (P0-07 closed in Wave-7). It performs
the 6-check attribution flow + cross-credential check + writes `pickupVerifiedAt`/`pickupVerifiedBy`
on the `Fulfilment` row, plus an AuditLog (`PICKUP_VERIFIED`) and Outbox event
(`FULFILMENT_STATUS_CHANGED`).

**However, the vendor UI cannot currently call this endpoint.** Two gaps prevent it.

---

## 2. Gap 1 — `otpId` is never surfaced by the status transition

### Where the pickup OTP is created

`src/app/api/orders/[id]/status/route.ts:155-160`:

```ts
let pickupOtp = order.pickupOtp
if (desired === 'READY_FOR_PICKUP' && order.user?.phone) {
  const otp = await createOtp('phone', order.user.phone, 'pickup')
  pickupOtp = otp.code          // ← only `code` is captured
  logInfo('pickup-otp-issued', { orderId: id, phone: order.user.phone }, traceId)
}
```

`createOtp('phone', phone, 'pickup')` returns `CreateOtpResult { otpId, code }`
(see `src/lib/otp-service.ts:26-48`). The new `OtpRequest` row carries:
- `id` (the `otpId`) — needed for `pickupVerifyBodySchema.otpId`
- `target` = `order.user.phone` — checked by the cross-credential verification
- `purpose` = `'pickup'` — checked by `verifyPickupAttribution`
- `codeHash` — scrypt hash of the 6-digit code

### What is persisted vs what is returned

| Field | Persisted on `Order`? | Returned in PATCH response? |
|---|---|---|
| `pickupOtp` (= `otp.code`) | ✅ `Order.pickupOtp` column | ✅ `src/app/api/orders/[id]/status/route.ts:260` returns `pickupOtp` |
| `otpId` (= `otp.otpId`) | ❌ NEVER persisted on `Order` (no column exists) | ❌ NOT in the response envelope (`src/app/api/orders/[id]/status/route.ts:255-265`) |

The response payload of `PATCH /api/orders/[id]/status` (lines 255-265):

```ts
return NextResponse.json({
  order: {
    id: updated.id,
    status: updated.status,
    totalAmount: updated.totalAmount,
    pickupOtp: updated.pickupOtp,        // ← only the 6-digit code
    updatedAt: updated.updatedAt,
    statusHistory: updated.statusHistory,
    restaurant: updated.restaurant,
  },
})
```

There is **no `otpId` field**. The `OtpRequest.id` created at line 157 is discarded the moment
the OTP record is written — it is not even logged.

### Why this breaks the vendor UI

`POST /api/orders/[id]/pickup/verify` requires `otpId` in its body
(`src/lib/validation.ts:96-100` — `pickupVerifyBodySchema.otpId: uuidSchema`).
`verifyPickupAttribution()` uses `otpId` to look up the `OtpRequest` row in
`verifyOtp(otpId, code)` (`src/lib/pickup-attribution.ts` step 4 — cross-credential check).

Without `otpId`, the vendor cannot construct the pickup-verify request body. The vendor sees
the QR-encoded string `snakzap:pickup:${orderId}:otp:${pickupOtp}` in the consumer's order
tracking card (`src/components/snak/order-tracking.tsx:80`), and they see the 6-digit code in
plaintext — but neither piece contains the `OtpRequest.id` that the server requires.

The QR token encodes only `orderId` + `pickupOtp` (the code), NOT the `otpId`:

```ts
<QRCodeSVG value={`snakzap:pickup:${order.id}:otp:${order.pickupOtp}`} size={84} level="M" />
```

(`src/components/snak/order-tracking.tsx:80`.)

So a vendor that scans the consumer's QR + reads the 6-digit code still has **no path** to
obtain the `otpId` needed to call `POST /api/orders/[id]/pickup/verify`.

---

## 3. Gap 2 — `otp/send` route REJECTS `purpose: 'pickup'`

### The schema mismatch

`src/lib/validation.ts:49` defines the OTP purpose enum:

```ts
export const otpPurposeSchema = z.enum(['consumer_login', 'vendor_login', 'admin_2fa', 'pickup'])
```

`'pickup'` IS a valid `otpPurposeSchema` value, and `verifyOtp()` (called by the pickup-verify
route) checks `result.purpose === 'pickup'` indirectly via the 6-check attribution flow
(`src/lib/pickup-attribution.ts` — `OtpRequest.purpose` is matched against `'pickup'`).

But the OTP SEND schema, `otpSendBodySchema` (`src/lib/validation.ts:72-75`), is a STRICTER
subset:

```ts
export const otpSendBodySchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['consumer_login', 'vendor_login']),  // ← 'pickup' NOT allowed
})
```

`POST /api/auth/otp/send` (`src/app/api/auth/otp/send/route.ts:10`) validates against
`otpSendBodySchema`, so a request with `purpose: 'pickup'` is REJECTED with a 400
VALIDATION_ERROR before `createOtp()` is ever called.

### Why this matters

The vendor UI could in principle issue a fresh pickup OTP for an order on demand — i.e., the
vendor calls `POST /api/auth/otp/send` with `{ phone: <order.user.phone>, purpose: 'pickup' }`,
receives `{ otpId, code }`, and then calls `POST /api/orders/[id]/pickup/verify` with all three
fields (`otpId`, `code`, `qrToken`).

That flow is BLOCKED today by `otpSendBodySchema` rejecting `purpose: 'pickup'`.

(There is also a separate concern: even if the route accepted `'pickup'`, sending a NEW pickup
OTP for an already-READY_FOR_PICKUP order would create a SECOND `OtpRequest` row, leaving the
first orphaned. `verifyPickupAttribution()` checks `default-otp-not-issued` (one of its 6
checks) — but as of Wave-7 the flag is OFF, so this check is not enforced yet. See
`src/lib/pickup-attribution.ts` and `src/lib/deployment.ts:30` —
`pickupAttributionEnforcement` flag defaults `false`.)

---

## 4. Impact on the vertical slice

Until one of the resolution options below is implemented, **the vendor side of the
`PRODUCT-FOUNDATION-IMPLEMENT-01` vertical slice cannot exercise the P0-07 endpoint from the
UI**. The vertical slice works around this by using the legacy transition path:

- `PATCH /api/orders/[id]/status` body `{ status: 'PICKED_UP' }` — transitions the order to
  PICKED_UP without QR+OTP attribution. This works because the `pickupAttributionEnforcement`
  flag (`src/lib/deployment.ts:30`) is OFF by default, so the route's PICKED_UP-deprecation
  guard at lines 59-79 is short-circuited.
- OR `PATCH /api/orders/[id]/fulfilment` body `{ status: 'PICKED_UP' }` — same outcome via
  the P0-06 fulfilment state machine. No QR+OTP, no `pickupVerifiedAt`/`pickupVerifiedBy`.

Both legacy paths produce PICKED_UP orders that lack `pickupVerifiedAt`/`pickupVerifiedBy`
attribution. They are functional for the demo, but they bypass I-13 (Pickup/Handoff Integrity)
which is exactly what P0-07 was designed to enforce.

**Net effect on the slice:** the consumer→checkout→order→vendor flow is fully demonstrable;
the pickup "verification" is a status bump, not a QR+OTP-verified handoff. The P0-07 endpoint
exists and is exercised by the test suite and forensic audits (see `pr-audit`, `oi-audit`
worklog entries), but it is **not reachable from any UI today**.

---

## 5. Resolution options (for Orchestrator decision — NOT implemented here)

> **Per task governance boundary:** none of these options are implemented in Task 3.
> They are presented to the Orchestrator for decision. Each is additive (no schema migration,
> no Wave-7 immutable-file change required), but the choice depends on how much vendor-side
> UX the Orchestrator wants.

### Option A — Surface `otpId` in the `PATCH /api/orders/[id]/status` response

**Where:** `src/app/api/orders/[id]/status/route.ts:155-160` (capture the `otp.otpId`) and
`:255-265` (add `pickupOtpId` to the response envelope).

**Change shape:**
```ts
// status/route.ts:155-160
let pickupOtp = order.pickupOtp
let pickupOtpId: string | null = null
if (desired === 'READY_FOR_PICKUP' && order.user?.phone) {
  const otp = await createOtp('phone', order.user.phone, 'pickup')
  pickupOtp = otp.code
  pickupOtpId = otp.otpId              // ← capture
  logInfo('pickup-otp-issued', { orderId: id, phone: order.user.phone }, traceId)
}
// ...later in response...
return NextResponse.json({
  order: {
    ...
    pickupOtp: updated.pickupOtp,
    pickupOtpId,                       // ← surface
    ...
  },
})
```

**Pros:**
- Smallest possible change — single file, two lines added, no new endpoint.
- `otpId` is available the moment the order becomes READY_FOR_PICKUP, exactly when the vendor
  needs it. No vendor-side state to track.
- Aligns with the existing pickup-OTP creation point (status route line 157).

**Cons:**
- `pickupOtpId` is added to the Order response shape — a public API contract change. Existing
  clients (consumer tracking page, vendor-view) ignore unknown fields, so backward-compatible.
- The `otpId` is per-transition, not per-order — if the order transitions AWAY from
  READY_FOR_PICKUP (e.g., back to PREPARING) and then back to READY_FOR_PICKUP, a new OTP is
  issued with a new `otpId`. The vendor must read the latest `pickupOtpId` from the latest
  response, not cache it. This is acceptable because the realtime `order:updated` event
  already drives vendor-view refresh.

### Option B — Extend `otpSendBodySchema` to allow `purpose: 'pickup'`

**Where:** `src/lib/validation.ts:72-75`.

**Change shape:**
```ts
export const otpSendBodySchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['consumer_login', 'vendor_login', 'pickup']),  // ← add 'pickup'
})
```

**Pros:**
- Single-line change to one file. The send route already works for any purpose in the schema.
- The vendor can issue a fresh OTP on demand, decoupled from the status transition. Useful if
  the consumer arrives later than the OTP TTL (5 minutes, per `src/lib/otp-service.ts:17`).

**Cons:**
- Creates a SECOND `OtpRequest` row for the same `(target, purpose)` pair if the original
  READY_FOR_PICKUP OTP is still alive. The `default-otp-not-issued` check in
  `verifyPickupAttribution()` (one of its 6 checks) is supposed to catch this — but it's
  currently gated by the `pickupAttributionEnforcement` flag (default OFF). So issuing multiple
  pickup OTPs is allowed today, and `verifyOtp()` will accept the FIRST unconsumed matching
  code (whichever row the `findUnique({ where: { id: otpId } })` happens to find first — but
  `otpId` is uniquely indexed, so the lookup is deterministic).
- Requires the vendor to know the consumer's phone to issue the OTP. Today the vendor already
  sees the QR (which encodes `orderId` + `pickupOtp` code) — they'd also need a way to look up
  the consumer's phone. That means either exposing `order.user.phone` to the vendor (privacy
  concern) or having the send route accept `orderId` instead of `phone` (different schema).

### Option C — Dedicated `POST /api/orders/[id]/pickup/otp` endpoint

**Where:** New file `src/app/api/orders/[id]/pickup/otp/route.ts`.

**Change shape:** New POST endpoint that:
1. Requires auth (VENDOR_OWNER/ADMIN/SUPER_ADMIN).
2. Looks up the order + its user's phone.
3. Verifies the order is READY_FOR_PICKUP (409 otherwise).
4. Calls `createOtp('phone', order.user.phone, 'pickup')` and returns `{ otpId, code }`.
5. Optionally marks the previous pickup OTP as consumed (if any) — to satisfy the
   `default-otp-not-issued` check when the flag is eventually flipped ON.

**Pros:**
- Most semantically clean — the vendor's intent ("issue a pickup OTP for THIS order") is
  explicit, not implicit through a generic OTP-send route.
- No need to expose `order.user.phone` to the vendor UI — the endpoint resolves it from the
  orderId.
- Adds an explicit AuditLog entry (`PICKUP_OTP_ISSUED`) for forensic traceability.

**Cons:**
- New endpoint = new code surface area, new auth/RBAC rules, new error paths. Higher
  implementation cost than Options A or B.
- The endpoint still must NOT bypass `pickupAttributionEnforcement` semantics when the flag is
  eventually flipped ON — needs careful design.

### Recommendation (non-binding)

**Option A** is the lowest-risk, lowest-cost change and unblocks the vendor UI immediately. It
should be the default choice unless the Orchestrator has a specific reason to prefer a
fresh-OTP flow (Option B/C).

**Combined approach:** Option A (always surface `otpId` at READY_FOR_PICKUP) + Option C (vendor
can re-issue if expired) gives the most UX flexibility. Both are additive; they can be shipped
independently.

---

## 6. Cross-references (file:line)

| Concern | Path:Line |
|---|---|
| `createOtp` signature | `src/lib/otp-service.ts:31-48` |
| `verifyOtp` signature | `src/lib/otp-service.ts:50-66` |
| OTP created on READY_FOR_PICKUP transition | `src/app/api/orders/[id]/status/route.ts:155-160` |
| `otpId` discarded (not in response) | `src/app/api/orders/[id]/status/route.ts:255-265` |
| `pickupVerifyBodySchema` requires `otpId` | `src/lib/validation.ts:96-100` |
| `otpPurposeSchema` includes `'pickup'` | `src/lib/validation.ts:49` |
| `otpSendBodySchema` REJECTS `'pickup'` | `src/lib/validation.ts:72-75` |
| `POST /api/auth/otp/send` uses `otpSendBodySchema` | `src/app/api/auth/otp/send/route.ts:10` |
| `POST /api/orders/[id]/pickup/verify` route | `src/app/api/orders/[id]/pickup/verify/route.ts:69-394` |
| `verifyPickupAttribution()` 6-check flow | `src/lib/pickup-attribution.ts` |
| `pickupAttributionEnforcement` flag (default OFF) | `src/lib/deployment.ts:30` |
| QR token format `snakzap:pickup:${orderId}:otp:${pickupOtp}` | `src/components/snak/order-tracking.tsx:80` |
| Vendor UI uses legacy PICKED_UP transition (flag OFF) | `src/components/snak/vendor-view.tsx` (concurrent Task 1 file) |

---

## 7. Why this gap exists

P0-07 was designed and implemented as a backend-only enforcement layer (Wave-7 closure). The
`pickupAttributionEnforcement` flag was intentionally defaulted to OFF so that:
- Existing flows (status-bump-to-PICKED_UP) continue working without modification.
- The P0-07 endpoint can be exercised by tests and forensic audits (see `pr-audit` worklog
  entry).
- The flag can be flipped ON once the UI is updated to use QR+OTP (Options A/B/C above).

`PRODUCT-FOUNDATION-IMPLEMENT-01` is the first task to build a UI for the pickup flow. It
discovered the gap because it actually needs to CALL the endpoint from the vendor side. The
gap is therefore a **UI↔API integration gap**, not a backend design flaw — the backend is
complete and correct per the P0-07 spec.

---

## 8. Status

| Item | State |
|---|---|
| Backend `POST /api/orders/[id]/pickup/verify` endpoint | ✅ Implemented, runtime-active (P0-07 Wave-7) |
| `pickupVerifyBodySchema` requires `{ otpId, code, qrToken }` | ✅ Defined |
| `pickupAttributionEnforcement` flag | ⚠️ Default OFF (backward-compat) |
| `otpId` surfaced in status-transition response | ❌ GAP 1 |
| `otp/send` route accepts `purpose: 'pickup'` | ❌ GAP 2 |
| Vendor UI can call pickup-verify endpoint | ❌ BLOCKED by GAP 1 + GAP 2 |
| Vertical slice workaround | ✅ Legacy `PATCH /api/orders/[id]/status` (flag OFF) |
| Resolution implemented in Task 3 | ❌ Out of scope — Orchestrator decision required |

**— End of U12 Pickup Verification Gap Report —**
