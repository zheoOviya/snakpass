# P0-06 State Separation — READ/PLAN-FIRST Gate Review

> **Directive:** `P0-06-READ-PLAN-FIRST-01`
> **Directive class:** READ/PLAN-FIRST governance gate (NO implementation authorized)
> **Date:** 2026-08-18
> **HEAD at review:** `ea683cf62a48701f248bf4f24574cdf48af38dfc`
> **Baseline:** `80e628d` (Wave-5 5C) → Firebase eliminated → Gateway Idempotency implemented + evidenced
> **Document type:** Gate review (current-state audit + target design + dependency map + rebuild plan + GO/NO-GO)

---

## 1. Executive Verdict

**CONDITIONAL GO** — P0-06 State Separation can be safely rebuilt additively on the current Wave-5 + Gateway baseline. The Fulfilment model + parallel state machine + M18-M21 detectors + invariant-checker service are all additive (zero Wave-5 file mutation, zero schema migration for existing tables, zero new feature flags beyond invariantChecker which already exists in deployment.ts).

**Key finding:** The Order.status column is overloaded with 3 orthogonal state dimensions (fulfilment + payment + freeze). NONE of the 17 M1-M17 reconciliation detectors query Order.status (grep: 0 matches). Cross-dimension inconsistencies (e.g., Order CANCELLED + Payment CAPTURED) are invisible to the current detection system.

**What this GO does NOT authorize:**
- ❌ Implementation (NO code changes)
- ❌ P0-07 pickup attribution (foundation only — fields prepared, logic NOT implemented)
- ❌ S5 PASS / P0-06 CLOSED declarations
- ❌ Gateway E9 reopening (FROZEN — external dependency)
- ❌ M9/M10 re-enqueue (LOCKED)

---

## 2. Phase-0 Baseline Verification

| Precondition | Status | Evidence |
|-------------|--------|----------|
| HEAD = `ea683cf` | ✅ PASS | Gateway evidence gate commit |
| Git working tree clean | ✅ PASS | 0 uncommitted |
| Wave-5 5A/5B/5C CLOSED | ✅ PASS | 18 "S5 PASS / CLOSED" mentions |
| M9/M10 re-enqueue PROHIBITED | ✅ PASS | 4× `reEnqueueProhibited: true` |
| All production flags OFF | ✅ PASS | 8 flags defaulting false |
| Firebase eliminated | ✅ PASS | 0 active source Firebase refs |
| Supabase sole auth platform | ✅ PASS | supabase.ts + supabase-admin.ts |
| Gateway idempotency immutable | ✅ PASS | cd4ae6a — 2 refs in capture route, 2 in refund, 2 in publisher, 12 in razorpay.ts |
| E9 BLOCKED accepted | ✅ PASS | E9 = external/operator dependency; NOT declared PASS |
| Fulfilment model ABSENT | ✅ PASS | 0 `model Fulfilment` in schema.prisma |
| state-invariants.ts ABSENT | ✅ PASS | File does NOT exist |
| invariant-checker service ABSENT | ✅ PASS | Directory does NOT exist |
| No orphan processes | ✅ PASS | Clean |

---

## 3. Order.status Current Semantics Audit

### 3.1 The 9 values — 3 dimensions overloaded

`prisma/schema.prisma:141`:
```
status String @default("CONFIRMED") // CONFIRMED | PREPARING | ALMOST_READY | READY_FOR_PICKUP | PICKED_UP | CANCELLED | PAID | PAYMENT_PENDING
```

| Value | Logical Dimension | Set By |
|-------|-------------------|--------|
| `CONFIRMED` | Order lifecycle (initial) | Default on Order.create |
| `PREPARING` | Fulfilment lifecycle | Vendor PATCH (`/api/orders/[id]/status`) |
| `ALMOST_READY` | Fulfilment lifecycle | Vendor PATCH |
| `READY_FOR_PICKUP` | Fulfilment lifecycle | Vendor PATCH (also issues pickup OTP) |
| `PICKED_UP` | Fulfilment lifecycle (terminal) | Vendor PATCH — NOT gated by QR+OTP (P0-07 gap) |
| `CANCELLED` | Order lifecycle (terminal) | Vendor/admin PATCH |
| `PAID` | Payment state (invading fulfilment column) | Capture route (`route.ts:188` — `status: 'PAID'`) |
| `PAYMENT_PENDING` | Payment state (invading fulfilment column) | Documented in comment but no code path sets it |
| `FROZEN` | Freeze state (invading fulfilment column) | Invariant-checker Level-1 freeze (`invariant-checker.ts:143`) |

### 3.2 NEXT_STATUS only covers 6 fulfilment transitions

`src/lib/snack.ts:14-21`:
```typescript
export const NEXT_STATUS: Record<string, string | null> = {
  CONFIRMED: 'PREPARING',
  PREPARING: 'ALMOST_READY',
  ALMOST_READY: 'READY_FOR_PICKUP',
  READY_FOR_PICKUP: 'PICKED_UP',
  PICKED_UP: null,
  CANCELLED: null,
}
```

**Gap:** `PAID`, `PAYMENT_PENDING`, and `FROZEN` are NOT in `NEXT_STATUS` → `NEXT_STATUS[order.status]` returns `undefined` → any non-`CANCELLED` PATCH returns 409 (silent breakage, not deliberate enforcement).

### 3.3 Capture route sets Order.status='PAID'

`src/app/api/payments/route.ts:188` (inside `withTransaction`):
```typescript
await tx.order.update({
  where: { id: order.id },
  data: { status: 'PAID' },
})
```

**This is the core P0-06 problem:** the payment dimension (`PAID`) invades the fulfilment column (`Order.status`). After capture, the order loses its fulfilment state — `NEXT_STATUS['PAID']` is `undefined`, blocking any fulfilment transition.

### 3.4 Invariant-checker freezes Order by setting status='FROZEN'

`src/lib/invariant-checker.ts:143`:
```typescript
await db.order.update({
  where: { id: entityId },
  data: { status: 'FROZEN' },
})
```

**This is the freeze dimension invading the fulfilment column.** A frozen order loses its prior fulfilment state. Unfreezing resets to `CANCELLED` (safe default at `invariant-checker.ts:242`).

### 3.5 M1-M17 detectors: ZERO query Order.status

Grep: `grep -c "order.status\|Order.status" src/lib/reconciliation.ts` = **0**

All 17 detectors cover Payment/Refund/LedgerEntry/Outbox/WebhookEvent/AuditLog consistency. **NONE** query `Order.status`. Cross-dimension inconsistencies are invisible:
- ❌ No detector for `Order.status='CANCELLED'` + `Payment.status='CAPTURED'` (money leak)
- ❌ No detector for `Order.status='PAID'` + `Payment.status='REFUNDED'` (orphan payment)
- ❌ No detector for `Order.status='FROZEN'` + stale freeze (no unresolved ExceptionQueue)

---

## 4. Fulfilment State Separation Target Design

### 4.1 Architectural principle: additive-only (Class-2)

**New `Fulfilment` model** (1:1 to Order) carries the fulfilment dimension independently. `Order.status` remains as-is for backward compatibility — existing Wave-3/4/5/Gateway code unchanged.

**Why NOT split Order.status:** Splitting would re-open Wave-1 P0-25 (concurrency control relies on Order.version + status transitions), Wave-3 P0-01 (capture route sets Order.status='PAID'), Wave-1 P0-28 (freeze sets Order.status='FROZEN'), Wave-5 5B reconciliation (detectors may query Order.status in future).

### 4.2 Proposed Fulfilment model (plan-only)

```prisma
model Fulfilment {
  id              String   @id @default(cuid())
  orderId         String   @unique  // 1:1 to Order
  order           Order    @relation(fields: [orderId], references: [id])
  status          String   @default("PREPARING") // PREPARING | ALMOST_READY | READY_FOR_PICKUP | PICKED_UP
  statusHistory   String   @default("[]") // JSON array of {status, at}
  version         Int      @default(0) // P0-25 optimistic locking
  // P0-07 future fields (INACTIVE in P0-06 — NOT gated):
  pickupOtp       String?
  pickupVerifiedAt DateTime?
  pickupVerifiedBy String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([status])
}
```

**Key design properties:**
- `Fulfilment.orderId` is `@unique` → 1:1 to Order (no fan-out)
- `Fulfilment.version` for optimistic locking (mirrors P0-25 pattern on Order)
- `Fulfilment.status` is independent of `Order.status` → dimensions evolve independently
- `pickupVerifiedAt` / `pickupVerifiedBy` fields prepare for P0-07 (Wave-7) — NOT implemented in P0-06
- `Order.status` remains as-is (backward-compatible — existing Wave-3/4/5/Gateway code unchanged)
- **NO schema migration for existing tables** — only ADDITIVE new `Fulfilment` table

### 4.3 Parallel state machine

```typescript
export const NEXT_FULFILMENT_STATUS: Record<string, string | null> = {
  PREPARING: 'ALMOST_READY',
  ALMOST_READY: 'READY_FOR_PICKUP',
  READY_FOR_PICKUP: 'PICKED_UP',
  PICKED_UP: null, // terminal
}
```

This is a PARALLEL state machine — it does NOT modify the existing `NEXT_STATUS` on `Order.status`. The two coexist.

### 4.4 Fulfilment PATCH route (new — `/api/orders/[id]/fulfilment`)

- Auth: `getSessionUser()` (existing pattern)
- State machine: `isValidFulfilmentTransition(from, to)`
- Optimistic locking: `Fulfilment.version` conditional `updateMany WHERE version=X`
- Lazy-create: if Fulfilment row doesn't exist, create with `PREPARING` default
- Audit: `FULFILMENT_STATUS_CHANGED` action (new — additive to AuditLog)
- Outbox: `FULFILMENT_STATUS_CHANGED` event (new event type — additive, does NOT affect existing routing)
- Idempotency: `Idempotency-Key` header support (P0-17 pattern)

---

## 5. M18-M21 Invariant Detectors

### 5.1 Full list (new — in `src/lib/state-invariants.ts`)

| Class | Name | Severity | Detection Logic | Invariant |
|-------|------|----------|-----------------|-----------|
| M18 | ORDER_CANCELLED_PAYMENT_CAPTURED | CRITICAL | `Order.status='CANCELLED'` AND `Payment.status='CAPTURED'` | I-01 |
| M19 | ORDER_PAID_PAYMENT_REFUNDED | HIGH | `Order.status='PAID'` AND `Payment.status='REFUNDED'` | I-02 |
| M20 | FULFILMENT_PICKED_UP_PAYMENT_NOT_CAPTURED | CRITICAL | `Fulfilment.status='PICKED_UP'` AND `Payment.status != 'CAPTURED'` | I-08 |
| M21 | ORDER_FROZEN_STALE | MEDIUM | `Order.status='FROZEN'` AND no unresolved ExceptionQueue | — |

### 5.2 Runtime detection strategy

- Reuse existing infrastructure: `reportInvariantViolation()` from `invariant-checker.ts`, `ExceptionQueue` table, freeze mechanism (P0-28), `fireAlert()` from `alerting.ts`
- M18 auto-refund: reuses EXISTING refund route via HTTP (no new financial mutation — Wave-5 5A infrastructure)
- M19/M20/M21: detection-only → ExceptionQueue + alert (no auto-repair)
- **5B boundary preserved:** detectors go to `state-invariants.ts` (NOT `reconciliation.ts`)
- `inconsistent-combo` alert rule already exists in `alerting.ts` (added during a prior session — verify presence)

### 5.3 M18 auto-refund boundary (critical safety property)

When M18 detects `Order.status='CANCELLED'` + `Payment.status='CAPTURED'`:
- HTTP call to EXISTING `/api/payments/refund` route
- The refund route creates Refund + reversal LedgerEntry + `PAYMENT_REFUND_REQUESTED` outbox event (Wave-5 5A)
- **NO new financial mutation mechanism** — reuses closed-wave outbox
- **NO M9/M10 retry path** — re-enqueue remains PROHIBITED
- **NO gateway idempotency reopening** — the frozen workstream is untouched
- **NO Gateway E9 bypass** — the refund route uses the existing `gatewayIdempotencyKey` in its outbox payload (cd4ae6a — immutable)

---

## 6. Invariant-Checker Mini-Service

### 6.1 Need

The M18-M21 detectors need to run periodically (hourly default). The existing reconciliation mini-service (`mini-services/reconciliation/`, port 3010) runs M1-M17. Adding M18-M21 to `reconciliation.ts` would cross the 5B detection-only boundary.

### 6.2 Proposed service (plan-only)

- **New file:** `mini-services/invariant-checker/index.ts`
- **Port:** 3011 (configurable)
- **Pattern:** mirrors reconciliation mini-service (port 3010) — Bun.serve HTTP + setInterval poll
- **Feature flag:** `FEATURE_INVARIANT_CHECKER` (already exists in `deployment.ts:80` — default OFF)
- **When OFF:** service starts but does NOT run detectors (manual /trigger endpoint available for evidence)
- **When ON:** hourly poll runs M18-M21 detectors → ExceptionQueue + alert

### 6.3 Production behavior

- Flag remains OFF in production without separate Orchestrator authorization
- Service NOT deployed to Fly.io in this directive (operator task — HB-9)
- Hosting plan: documented in `docs/STATEFUL_SERVICES_HOSTING.md` (to be updated — gap identified in Wave-9 audit)

---

## 7. Migration/Backfill Strategy

### 7.1 Class-2 expand-migrate-contract (additive)

- **Expand:** Create `Fulfilment` table (new — additive, no existing table modified)
- **Migrate:** Backfill Fulfilment rows for ALL existing Orders
- **Contract:** Verify 1:1 integrity (every Order has exactly one Fulfilment)

### 7.2 Backfill mapping (safe defaults — does NOT change Order.status)

| Order.status | Fulfilment.status (backfill) |
|---------------|------------------------------|
| CONFIRMED, PREPARING | PREPARING |
| ALMOST_READY | ALMOST_READY |
| READY_FOR_PICKUP | READY_FOR_PICKUP |
| PICKED_UP | PICKED_UP |
| CANCELLED, PAID, PAYMENT_PENDING, FROZEN | PREPARING (safe default) |

### 7.3 REAL pre-existing orders requirement

The migration MUST be tested with REAL pre-existing Orders (NOT an empty table). The evidence gate must:
1. Create REAL legacy Orders via SQL BEFORE running the migration
2. Run the migration
3. Verify every Order has exactly one Fulfilment row (1:1 integrity)
4. Verify 0 orphan Orders (Order without Fulfilment)
5. Verify 0 duplicate Fulfilments (Order with >1 Fulfilment)
6. Verify Order.status was NOT mutated by the migration

### 7.4 Reversibility

- Rollback: `DROP TABLE "Fulfilment"` (additive-only — no data loss to existing tables)
- maxRollbackTime: 15 min (Class-2)
- safeByDefault: true

---

## 8. P0-07 Foundation Accounting (NOT Implementing)

### 8.1 Fields prepared but INACTIVE

The Fulfilment model includes `pickupOtp`, `pickupVerifiedAt`, `pickupVerifiedBy` fields for future P0-07 (Wave-7) compatibility. These fields are:
- Present in the schema (nullable — default NULL)
- NOT written by any P0-06 code path
- NOT gated by any P0-06 transition
- NOT verified on PICKED_UP (that is P0-07)

### 8.2 P0-07 will need (when authorized separately):

- New `/api/orders/[id]/pickup/verify` endpoint (QR + OTP verification)
- RBAC + ownership checks on status PATCH route
- Cross-credential verification (`otp.target === order.user.phone`)
- Pre-transition cross-dimension checks
- Attribution-bearing AuditLog rows
- M22/M23 detectors (Order CANCELLED + Fulfilment PICKED_UP, Fulfilment PICKED_UP + Payment not CAPTURED)

**P0-06 does NOT implement any of these.** P0-06 only lays the foundation (Fulfilment model + parallel state machine + M18-M21 + invariant-checker).

---

## 9. Wave-5 Immutable Boundary

| Wave-5 Component | P0-06 Impact | Why |
|------------------|-------------|-----|
| 5A refund flow | ZERO RISK | P0-06 does NOT touch Refund/Payment/LedgerEntry/Outbox |
| 5B reconciliation (M1-M17) | ZERO RISK | M18-M21 go to `state-invariants.ts` (NOT `reconciliation.ts`) |
| 5C M16/M3/M9/M10 | ZERO RISK | P0-06 does NOT touch remediation handlers or re-enqueue prohibition |
| Gateway idempotency (cd4ae6a) | ZERO RISK | P0-06 does NOT touch capture/refund routes or outbox payload |
| Gateway E9 | FROZEN | P0-06 does NOT reopen E9 or make gateway calls |
| M9/M10 | PROHIBITED | 4× `reEnqueueProhibited: true` intact |
| Supabase auth | SOLE PLATFORM | No Firebase reintroduction |

### Hard implementation prohibitions:

1. ❌ Split `Order.status` column (would re-open Wave-1 P0-25 + Wave-3 P0-01 + Wave-1 P0-28)
2. ❌ Mutate `Payment.status` / `Refund.status` enums
3. ❌ Touch `LedgerEntry` semantics
4. ❌ Add outbox re-enqueue paths (SI-11)
5. ❌ Touch `Outbox.payload.gatewayIdempotencyKey` (Gateway immutable)
6. ❌ Modify `src/lib/reconciliation.ts` (5B boundary)
7. ❌ Implement P0-07 pickup attribution (8 conditions)
8. ❌ Activate any feature flag
9. ❌ Deploy

---

## 10. Implementation Inventory (Plan-Only — NOT Created)

| File | Change | Type | Est. LOC |
|------|--------|------|----------|
| `prisma/schema.prisma` | +`Fulfilment` model + `fulfilment` relation on Order | Schema (additive) | ~25 |
| `src/lib/fulfilment-state.ts` | NEW — state machine | Code (additive) | ~80 |
| `src/app/api/orders/[id]/fulfilment/route.ts` | NEW — PATCH + GET route | Code (additive) | ~200 |
| `src/lib/state-invariants.ts` | NEW — M18-M21 detectors | Code (additive) | ~350 |
| `mini-services/invariant-checker/index.ts` | NEW — hourly checker service | Code (additive) | ~200 |
| `prisma/scripts/p0-06-migration.sql` | NEW — Class-2 migration + backfill | Migration | ~80 |
| `scripts/run-p0-06-evidence-gate.mjs` | NEW — evidence runner | Test | ~400 |
| `src/lib/alerting.ts` | MODIFY — +`inconsistent-combo` alert rule (if not already present) | Code (additive) | ~10 |
| `src/lib/deployment.ts` | VERIFY — `invariantChecker` flag already exists | Config | 0 |

**Total estimated:** ~1300 LOC (comparable to the lost session's implementation)

---

## 11. Evidence Plan (NOT Executed)

| # | Scenario | Required Result |
|---|----------|-----------------|
| E1 | Fulfilment model created (1:1 to Order) | Table exists, `orderId @unique` |
| E2 | Fulfilment state machine (valid transition) | PREPARING → ALMOST_READY → 200 |
| E3 | Fulfilment optimistic locking (version increment) | 0 → 1 on transition |
| E4 | M18 detector (Order CANCELLED + Payment CAPTURED) | Finding + ExceptionQueue + auto-refund |
| E5 | M19 detector (Order PAID + Payment REFUNDED) | Finding + ExceptionQueue |
| E6 | M20 detector (Fulfilment PICKED_UP + Payment not CAPTURED) | Finding + ExceptionQueue |
| E7 | M21 detector (Order FROZEN + stale) | Finding + alert |
| E8 | Invariant-checker mini-service (health check) | Port 3011 health 200 |
| E9 | inconsistent-combo alert rule | Exists in alerting.ts |
| E10 | Wave-5 regression (5A capture flow intact) | CAPTURE_PENDING + 2 ledger + balanced |
| E11 | No Order.status mutation (capture route unchanged) | Still sets `status: 'PAID'` |
| E12 | No Outbox re-enqueue (SI-11 preserved) | 4× `reEnqueueProhibited: true` |
| MIG | Migration backfill (REAL pre-existing orders) | 1:1 integrity, 0 orphans, 0 dupes, Order.status preserved |

**PostgreSQL evidence:** via embedded-postgres (controlled environment)
**E9 (gateway):** NOT part of P0-06 evidence (Gateway E9 is FROZEN — separate workstream)

---

## 12. Safety Invariants

| ID | Invariant | How Preserved |
|----|-----------|---------------|
| P6-SI-01 | Wave-5 5A/5B/5C closures untouched | No Payment/Refund/LedgerEntry/Outbox mutation |
| P6-SI-02 | M9/M10 re-enqueue PROHIBITED | 4× `reEnqueueProhibited: true` NOT touched |
| P6-SI-03 | Gateway E9 FROZEN | No credential fabrication; E9 BLOCKED accepted |
| P6-SI-04 | Gateway implementation (cd4ae6a) immutable | No touch to capture/refund routes or outbox payload |
| P6-SI-05 | Order.status NOT split | Additive Fulfilment model (parallel dimension) |
| P6-SI-06 | Payment/refund/ledger semantics unchanged | P0-06 does NOT touch these |
| P6-SI-07 | Outbox re-enqueue PROHIBITED (SI-11) | P0-06 does NOT add re-enqueue paths |
| P6-SI-08 | P0-07 NOT implemented | Fields prepared but INACTIVE; no pickup attribution logic |
| P6-SI-09 | Supabase sole auth platform | No Firebase reintroduction |
| P6-SI-10 | All production flags remain OFF | invariantChecker defaults OFF |
| P6-SI-11 | No schema migration for existing tables | Only ADDITIVE new Fulfilment table |
| P6-SI-12 | M18 auto-refund uses existing refund route | No new financial mutation logic |

---

## 13. GO / NO-GO Recommendation

### **CONDITIONAL GO**

P0-06 State Separation implementation can be separately authorized. Conditions:

1. 🔒 Additive-only (Class-2) — NO `Order.status` split, NO existing table mutation
2. 🔒 New `Fulfilment` model (1:1 to Order) — parallel state machine
3. 🔒 M18-M21 in `state-invariants.ts` (NOT `reconciliation.ts` — 5B boundary)
4. 🔒 M18 auto-refund uses EXISTING refund route (no new financial mutation)
5. 🔒 P0-07 pickup attribution NOT implemented (fields prepared, logic INACTIVE)
6. 🔒 `invariantChecker` flag remains OFF (default false, already in deployment.ts)
7. 🔒 Evidence gate required (E1-E12 + migration backfill with REAL orders)
8. 🔒 Wave-5 5A/5B/5C + Gateway + M9/M10 evidence re-runs MUST PASS
9. 🔒 Migration with REAL pre-existing orders (NOT empty table)
10. 🔒 No schema migration for existing tables (only new Fulfilment table)

### Proposed implementation directive:

**`P0-06-IMPLEMENT-01`** — authorize additive-only implementation per the plan in §10.

### What this GO does NOT authorize:

- ❌ P0-07 implementation (requires separate `P0-07-READ-PLAN-FIRST-01`)
- ❌ S5 PASS / P0-06 CLOSED (requires separate `P0-06-EVIDENCE-GATE-01`)
- ❌ Production deployment — NOT AUTHORIZED
- ❌ `invariantChecker` flag activation — defaults OFF
- ❌ Gateway E9 reopening — FROZEN
- ❌ M9/M10 re-enqueue — LOCKED

---

## 14. STOP State

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

Gateway Idempotency           ✅ IMPLEMENTED (cd4ae6a — immutable)
  E1-E8 evidence              ✅ PASS (ea683cf)
  E9                          🔒 BLOCKED (external dependency)
  M9/M10                      🚫 PROHIBITED (4× reEnqueueProhibited: true)

P0-06 State Separation        ❌ NOT IMPLEMENTED
  READ/PLAN-FIRST             ✅ COMPLETE (CONDITIONAL GO)
  Implementation              🔒 NOT AUTHORIZED

P0-07 Pickup Attribution      ❌ NOT IMPLEMENTED
I-13                          ❌ NOT VERIFIED

Production                    🚫 NOT AUTHORIZED

IDE                           🛑 STOPPED
```

---

**End of P0-06 READ/PLAN-FIRST gate review. IDE STOPPED.**
