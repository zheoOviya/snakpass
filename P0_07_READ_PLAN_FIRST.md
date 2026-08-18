# P0-07 Pickup Attribution — READ/PLAN-FIRST Gate Review

> **Directive:** `P0-07-READ-PLAN-FIRST-01`
> **Directive class:** READ/PLAN-FIRST governance gate (NO implementation authorized)
> **Date:** 2026-08-18
> **HEAD at review:** `6f259b35f82e66fd29cae22ac2a949c35a2493d1` (P0-06 CLOSED)
> **Document type:** Gate review (forensic audit + target design + I-13 contract + integration boundaries + evidence plan + GO/NO-GO)

---

## 1. Executive Verdict

**CONDITIONAL GO** — P0-07 Pickup Attribution can be safely rebuilt additively on the current P0-06 + Wave-5 + Gateway baseline. The Fulfilment model already has the placeholder fields (`pickupOtp`, `pickupVerifiedAt`, `pickupVerifiedBy`), the `pickupAttributionEnforcement` flag already exists (default OFF), and the `verifyOtp()` function is ready for reuse.

**Critical finding:** The Order.status PATCH route (`/api/orders/[id]/status`) is **completely unauthenticated** — no `getSessionUser()` call. Any anonymous caller can drive an order to `PICKED_UP`. This is a pre-existing security gap that P0-07 MUST close.

**Architecture:** Three independent state dimensions:
```
                 ORDER
                   │
        ┌──────────┼──────────┐
        │          │          │
     PAYMENT    FULFILMENT   PICKUP
        │          │          │
     Wave-5      P0-06      P0-07
        │          │          │
     Ledger     M18-M21      I-13
```

---

## 2. Phase-0 Baseline Verification

| Precondition | Status |
|-------------|--------|
| HEAD = `6f259b3` (P0-06 CLOSED) | ✅ |
| Git working tree clean | ✅ |
| P0-06 evidence S5 PASS | ✅ |
| Fulfilment model exists | ✅ (`schema.prisma:669-688`) |
| P0-06 migration exists | ✅ (`prisma/scripts/p0-06-migration.sql`) |
| M18-M21 implementation exists | ✅ (`src/lib/state-invariants.ts`) |
| Gateway idempotency unchanged | ✅ (2 refs in capture, 2 in refund, 2 in publisher) |
| M9/M10 prohibition intact | ✅ (4× `reEnqueueProhibited: true`) |
| Firebase active source refs = 0 | ✅ |
| Supabase sole auth platform | ✅ |
| P0-07 implementation absent | ✅ (no `pickup-attribution.ts`, no `/pickup/verify/route.ts`) |
| All production flags OFF | ✅ (9 flags) |

---

## 3. Current-State Inventory

### 3.1 Fulfilment model (P0-06 — placeholder fields present but INACTIVE)

| Field | Type | Status | Written by? |
|-------|------|--------|-------------|
| `pickupOtp` | `String?` | Copied from `Order.pickupOtp` on lazy-create | P0-06 lazy-create |
| `pickupVerifiedAt` | `DateTime?` | **INACTIVE** — never written | ❌ NO code writes this |
| `pickupVerifiedBy` | `String?` | **INACTIVE** — never written | ❌ NO code writes this |

### 3.2 Fulfilment PATCH route (P0-06 — no RBAC, no pickup verification)

- Auth: `getSessionUser()` ✅ (401 if no session)
- RBAC: ❌ NONE — any authenticated user (including CONSUMER) can drive all transitions
- PICKED_UP gating: ❌ NONE — only `isValidFulfilmentTransition()` checks state machine
- OTP verification: ❌ NOT performed — `verifyOtp()` never called
- `pickupVerifiedAt`/`pickupVerifiedBy` write: ❌ NOT written on PICKED_UP

### 3.3 Order.status PATCH route (pre-P0-06 — CRITICAL SECURITY GAP)

- Auth: ❌ **COMPLETELY UNAUTHENTICATED** — no `getSessionUser()` import or call
- RBAC: ❌ NONE — `actorRole` defaults to `'VENDOR_OWNER'` regardless of caller
- PICKED_UP gating: ❌ NONE — any anonymous caller can drive to PICKED_UP
- Can CONSUMER self-confirm? ✅ **YES — worse, an UNAUTHENTICATED client can**

### 3.4 OTP service

- `verifyOtp(otpId, code)` exists at `otp-service.ts:50-66` — correctly implements: expiry check, consumed check, timing-safe scrypt comparison, marks consumed=true
- Called for `purpose='pickup'`? ❌ **NO** — only called for `consumer_login` and `admin_2fa`
- `createOtp('phone', phone, 'pickup')` IS called at `status/route.ts:54` (issues OTP on READY_FOR_PICKUP), but the `otpId` is discarded
- `otpVerifyBodySchema.purpose` enum does NOT include `'pickup'`

### 3.5 M20 detector (P0-06 — post-transition only)

- Detects: `Fulfilment.status='PICKED_UP'` + `Payment.status != 'CAPTURED'` → I-08 violation
- Post-transition: runs in hourly invariant-checker poll (flagged OFF by default)
- Does NOT check attribution fields (`pickupVerifiedAt`/`pickupVerifiedBy`)

### 3.6 Gateway idempotency (immutable — cd4ae6a)

- `gatewayIdempotencyKey` present in capture route payload (2 refs) ✅
- `gatewayIdempotencyKey` present in refund route payload (2 refs) ✅
- Publisher reads `payload.gatewayIdempotencyKey ?? undefined` + passes to gateway functions ✅

---

## 4. P0-07 Problem Statement

**I-13 (Pickup/Handoff Integrity) is NOT enforced.** Any caller (anonymous or authenticated) can drive an order to PICKED_UP without:
1. Verifying the correct `order_id` (no QR token)
2. Verifying collector identity (no RBAC, no ownership check)
3. Verifying QR + OTP (OTP issued but never verified)
4. Persisting attribution (pickupVerifiedAt/pickupVerifiedBy never written)
5. Auditing the pickup event with attribution fields
6. Preventing duplicate pickup (no idempotency on the pickup action itself)
7. Preventing cross-credential pickup (no otp.target === order.user.phone check)
8. Blocking on attribution failure (no exception/recovery path)

---

## 5. I-13 Integrity Contract

**Statement:** A completed pickup must be attributable to the correct order and an authorized collector (QR + OTP both verified; pickup event auditable to order + customer).

**Actors:**
- CONSUMER (order owner — may verify their own pickup)
- VENDOR_OWNER (may drive fulfilment transitions on their restaurant's orders)
- ADMIN / SUPER_ADMIN (may override)

**Valid transitions:**
- `READY_FOR_PICKUP → PICKED_UP` (only when ALL 8 attribution conditions hold)

**Forbidden combinations:**
- `Fulfilment.status='PICKED_UP'` + `Payment.status != 'CAPTURED'` (M20 detects POST-transition)
- `Fulfilment.status='PICKED_UP'` + `pickupVerifiedAt IS NULL` (new M22 should detect)
- `Order.status='CANCELLED'` + `Fulfilment.status='PICKED_UP'` (new M23 should detect)

**Provider attribution requirements:**
1. Correct `order_id` resolved and verified (QR token decode + match)
2. Authorized collector/customer identity verified (session + RBAC)
3. QR + OTP verification succeeded (both — `verifyOtp()` + QR token check)
4. Pickup event persisted with 5 attribution fields
5. Pickup event in immutable audit trail (AuditLog WORM — P0-22)
6. Duplicate pickup idempotently rejected (P0-17 + P0-25 optimistic locking)
7. Cross-credential pickup impossible (`otp.target === order.user.phone`)
8. Attribution failure blocks transition + activates exception/recovery

**Failure behavior:** 409 CONFLICT + ExceptionQueue entry via `reportInvariantViolation()` + `fireAlert('inconsistent-combo')`

**Remediation:** Detection-only (M22/M23) — no auto-repair of pickup state

---

## 6. Target Architecture

### 6.1 New endpoint: `POST /api/orders/[id]/pickup/verify`

**Input:** `{ otpId: string, code: string, qrToken: string }`

**Auth:** `getSessionUser()` + RBAC (CONSUMER who owns the order, or VENDOR_OWNER assigned to the restaurant, or ADMIN/SUPER_ADMIN)

**Logic (inside `withTransaction`):**
1. Decode QR token: `snakzap:pickup:${orderId}:otp:${pickupOtp}` — verify orderId matches URL path + pickupOtp matches Order.pickupOtp
2. Call `verifyOtp(otpId, code)` — verifies OTP not consumed/expired, hash matches
3. Cross-credential check: `otp.target === order.user.phone`
4. Pre-transition: `Order.status NOT IN {CANCELLED, FROZEN}`
5. Pre-transition: `Payment.status === 'CAPTURED'`
6. Pre-transition: `Fulfilment.status === 'READY_FOR_PICKUP'`
7. On ALL pass: write `Fulfilment.pickupVerifiedAt = now`, `Fulfilment.pickupVerifiedBy = session.userId`, flip `Fulfilment.status = PICKED_UP` (conditional updateMany WHERE version=X)
8. AuditLog: `PICKUP_VERIFIED` with 5 attribution fields
9. Outbox: `FULFILMENT_STATUS_CHANGED` with attribution payload
10. Idempotency-Key support (P0-17 pattern, resourceType='PickupAttribution')

### 6.2 Modified: Fulfilment PATCH route

- Gate PICKED_UP on `pickupAttributionEnforcement` flag:
  - When ON: require `Fulfilment.pickupVerifiedAt` set — reject with 409 if not
  - When OFF: current behavior (plain state flip — backward-compatible)

### 6.3 Modified: Order.status PATCH route (CRITICAL security fix)

- Add `getSessionUser()` + RBAC (VENDOR_OWNER/ADMIN for any transition; CONSUMER only for CANCEL with ownership check)
- When `pickupAttributionEnforcement` ON: deprecate direct PICKED_UP via this route → 409 directing to `/pickup/verify`

### 6.4 New: M22/M23 detectors (additive — in `state-invariants.ts` or new file)

- M22: `Fulfilment.status='PICKED_UP'` + `pickupVerifiedAt IS NULL` → I-13 violation
- M23: `Order.status='CANCELLED'` + `Fulfilment.status='PICKED_UP'` → I-02 violation

### 6.5 No schema migration required

The Fulfilment model already has `pickupVerifiedAt`/`pickupVerifiedBy` (P0-06 placeholder fields). P0-07 only needs to WRITE them — no new columns.

---

## 7. P0-06 Integration Boundary

| P0-06 Component | P0-07 Impact | How Preserved |
|-----------------|-------------|----------------|
| Fulfilment model | LOW RISK — P0-07 WRITES to existing placeholder fields (no new columns) | Additive write path |
| `fulfilment-state.ts` | ZERO RISK — state machine unchanged | P0-07 gates on flag, doesn't modify NEXT_FULFILMENT_STATUS |
| `state-invariants.ts` M18-M21 | LOW RISK — P0-07 may ADD M22/M23 (additive) | New detectors added to same file OR new file |
| `fulfilment/route.ts` | MEDIUM RISK — P0-07 adds flag-gated PICKED_UP check + Idempotency-Key | Additive conditional (when flag ON); when OFF, current behavior |
| invariant-checker service | ZERO RISK — P0-07 may wire M22/M23 into runStateInvariantCheck | Additive call |

**P0-06 files that MUST NOT be modified:**
1. `src/lib/fulfilment-state.ts` — state machine contract
2. `prisma/scripts/p0-06-migration.sql` — already-applied migration
3. `prisma/schema.prisma` Fulfilment model block (lines 669-688) — no new columns needed

---

## 8. Wave-5 Integration Boundary

| Wave-5 Component | P0-07 Impact | Why |
|------------------|-------------|-----|
| 5A refund flow | ZERO RISK | P0-07 does NOT touch Refund/Payment/LedgerEntry/Outbox |
| 5B reconciliation (M1-M17) | ZERO RISK | M22/M23 go to `state-invariants.ts` (NOT `reconciliation.ts`) |
| 5C M16/M3/M9/M10 | ZERO RISK | P0-07 does NOT touch remediation handlers or re-enqueue |
| Gateway idempotency | ZERO RISK | P0-07 does NOT touch capture/refund routes or outbox payload |
| Gateway E9 | FROZEN | P0-07 does NOT reopen E9 |
| M9/M10 | PROHIBITED | 4× `reEnqueueProhibited: true` intact |

---

## 9. Security/Authorization Analysis

### 9.1 Current gaps (pre-P0-07)

| Gap | Severity | Fix |
|-----|---------|-----|
| Order.status route unauthenticated | CRITICAL | Add `getSessionUser()` + RBAC |
| Fulfilment route no RBAC | HIGH | Add role check (VENDOR_OWNER for kitchen; CONSUMER for pickup) |
| No pickup-verify endpoint | HIGH | New `POST /api/orders/[id]/pickup/verify` |
| OTP never verified for pickup | HIGH | Call `verifyOtp()` in pickup-verify endpoint |
| No cross-credential check | HIGH | `otp.target === order.user.phone` |
| No idempotency on pickup action | MEDIUM | P0-17 Idempotency-Key pattern |

### 9.2 RBAC design

| Route | CONSUMER | VENDOR_OWNER | ADMIN |
|-------|----------|--------------|-------|
| `PATCH /api/orders/[id]/status` | CANCEL own order only | Any transition (except PICKED_UP when flag ON) | Any |
| `PATCH /api/orders/[id]/fulfilment` | PICKED_UP only (via pickup-verify) | PREPARING → ALMOST_READY → READY_FOR_PICKUP | Any |
| `POST /api/orders/[id]/pickup/verify` | Own order only | Assigned restaurant | Any |

### 9.3 Supabase policy

- Supabase remains the SOLE auth platform
- No Firebase references introduced
- Session handling unchanged (custom cookie + DB — Supabase is identity provider)

---

## 10. Migration/Backfill Plan

**No schema migration required.** The Fulfilment model already has `pickupVerifiedAt`/`pickupVerifiedBy` (nullable, default NULL). P0-07 only writes to these fields — no new columns, no new tables.

Existing Orders/Fulfilments:
- `pickupVerifiedAt = NULL` → correct (no pickup verified yet)
- `pickupVerifiedBy = NULL` → correct
- No backfill needed — fields are correctly NULL for unfulfilled orders

---

## 11. Evidence-Gate Plan (NOT Executed)

| # | Scenario | Required Result |
|---|----------|-----------------|
| E1 | Authenticated pickup verification | 200, pickupVerifiedAt/By written |
| E2 | Unauthorized actor rejection | 403 |
| E3 | Unauthenticated rejection | 401 |
| E4 | QR/order credential binding | 409 QR_ORDER_ID_MISMATCH |
| E5 | OTP verification (wrong code) | 409 OTP_VERIFICATION_FAILED |
| E6 | Cross-credential check | 409 OTP_TARGET_MISMATCH |
| E7 | Cancelled order rejection | 409 ORDER_INACTIVE_STATE |
| E8 | Payment CAPTURED prerequisite | 409 PAYMENT_NOT_CAPTURED |
| E9 | READY_FOR_PICKUP prerequisite | 409 FULFILMENT_NOT_READY |
| E10 | Pickup attribution persistence | API + DB verified |
| E11 | AuditLog attribution (5 fields) | orderId + collectorIdentity + timestamp + verificationMethod + verificationResult |
| E12 | Idempotency-Key replay | Cached 200 on replay |
| E13 | Concurrent/stale-write protection | Single attribution, race-replay |
| E14 | M22/M23 detector logic | Exists + wired |

---

## 12. Implementation Conditions (for P0-07-IMPLEMENT-01)

1. 🔒 Additive-only — NO Fulfilment schema change (fields already exist from P0-06)
2. 🔒 New `/api/orders/[id]/pickup/verify` endpoint (dedicated, not hidden in other routes)
3. 🔒 `pickupAttributionEnforcement` flag gates PICKED_UP (default OFF — backward-compatible)
4. 🔒 Fix unauthenticated Order.status route (add `getSessionUser()` + RBAC)
5. 🔒 Cross-credential check (`otp.target === order.user.phone`)
6. 🔒 Pre-transition checks (Order.status ∉ {CANCELLED, FROZEN}, Payment.status === CAPTURED, Fulfilment.status === READY_FOR_PICKUP)
7. 🔒 Attribution failure path (409 + ExceptionQueue + alert)
8. 🔒 Write `pickupVerifiedAt`/`pickupVerifiedBy` + 5-field AuditLog
9. 🔒 `Idempotency-Key` header dedup on pickup-verify
10. 🔒 M22/M23 in `state-invariants.ts` (NOT `reconciliation.ts`)
11. 🔒 `pickupAttributionEnforcement` flag remains OFF in production
12. 🔒 Evidence gate required (E1-E14 on SQLite + PostgreSQL)
13. 🔒 Wave-5 + P0-06 + Gateway evidence re-runs MUST PASS
14. 🔒 P0-06 immutable boundary (fulfilment-state.ts, p0-06-migration.sql, Fulfilment schema block)
15. 🔒 Supabase sole auth platform (no Firebase)

---

## 13. Explicit Non-Goals

- ❌ P0-07 does NOT implement production deployment
- ❌ P0-07 does NOT activate `pickupAttributionEnforcement` in production
- ❌ P0-07 does NOT reopen Gateway E9
- ❌ P0-07 does NOT enable M9/M10 re-enqueue
- ❌ P0-07 does NOT modify P0-06 state machine (`fulfilment-state.ts`)
- ❌ P0-07 does NOT modify Wave-5 financial semantics
- ❌ P0-07 does NOT introduce Firebase
- ❌ P0-07 does NOT declare S5 PASS (requires separate evidence gate)

---

## 14. Recommended Next Directive

**`P0-07-IMPLEMENT-01`** — authorize additive-only implementation per the plan in §6.

After P0-07 implementation: `P0-07-EVIDENCE-GATE-01` (E1-E14 runtime evidence on controlled PostgreSQL).

After P0-07 S5 PASS: Production Readiness Review → DR/Rollback → Final GO/NO-GO.

---

## 15. STOP State

- ✅ No application code changed
- ✅ No schema changed
- ✅ No migration executed
- ✅ No flag activated
- ✅ No deployment
- ✅ P0-06 remains CLOSED/unchanged
- ✅ Gateway remains unchanged
- ✅ M9/M10 remain prohibited (4×)
- ✅ git working tree clean

### Canonical state:

```text
Wave-5 5C                     ✅ CLOSED
Firebase                      ✅ ELIMINATED
Supabase                      ✅ SOLE AUTH PLATFORM

Gateway Idempotency           ✅ IMPLEMENTED (cd4ae6a — immutable)
  E1-E8 evidence              ✅ PASS (ea683cf)
  E9                          🔒 BLOCKED
  M9/M10                      🚫 PROHIBITED (4×)

P0-06 State Separation        ✅ CLOSED (6f259b3)
  S5 PASS                     ✅ DECLARED

P0-07 Pickup Attribution      ❌ NOT IMPLEMENTED
  READ/PLAN-FIRST             ✅ COMPLETE (CONDITIONAL GO)
  Implementation              🔒 NOT AUTHORIZED

I-13                          ❌ NOT VERIFIED

Production                    🚫 NOT AUTHORIZED

IDE                           🛑 STOPPED
```

---

**End of P0-07 READ/PLAN-FIRST gate review. IDE STOPPED.**
