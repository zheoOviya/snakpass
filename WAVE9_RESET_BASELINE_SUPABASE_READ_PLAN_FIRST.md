# WAVE9 — Reset Baseline + Supabase READ/PLAN-FIRST Gate Review

> **Directive:** `WAVE9-RESET-BASELINE-SUPABASE-READ-PLAN-FIRST-01`
> **Directive class:** READ/PLAN-FIRST governance gate (NO implementation authorized)
> **Date:** 2026-08-18
> **HEAD at review:** `b22ebf407e71a974eec9c162b34f2aadf482e12c` (descendant of recovery baseline `80e628d`)
> **Canonical recovery baseline:** `80e628da179a2de209c3e799570588b703d7706a` (Wave-5 5C Consolidated Closure Review)
> **Document type:** Gate review (current-state audit + Firebase elimination + Supabase target-state + dependency graph + rebuild plan)

---

## 1. Executive Verdict

**GO FOR NEXT READ/PLAN-FIRST** — the baseline is accepted, Wave-5 5C is intact, and the path forward is clear: re-implement Gateway Idempotency → Wave-6 (P0-06) → Wave-7 (P0-07) → Wave-8 Production Readiness, all using Supabase (NOT Firebase) as the authoritative platform.

**Critical finding:** The Supabase replacement path is **functionally complete and already wired** in production-relevant code paths. Firebase is a "dead parallel" — reachable but unused by the actual client UI. Eliminating Firebase is a low-risk, mechanical removal + documentation task requiring NO new functional code.

**What this GO does NOT authorize:**
- ❌ Implementation (NO code changes)
- ❌ S5 PASS / P0 CLOSED declarations
- ❌ Production GO
- ❌ Firebase removal (separate implementation directive required)

---

## 2. Canonical Baseline

```
80e628d — Wave-5 5C: Consolidated Closure Review — READ/REVIEW-ONLY
```

This is the canonical recovery baseline. All 13 session commits (`53b5dcd`..`2bfb097`) are **IRRETRIEVABLY ABSENT** from git object store, reflog, fsck unreachable, local refs, and remote refs (per `WAVE8_RECOVERY_BASELINE_REPORT.md`). The baseline is accepted as-is — no recovery attempt.

---

## 3. Current Repository Inventory (at `80e628d`)

### What EXISTS (pre-session Wave-5 5C state):

| Component | Status | Evidence |
|-----------|--------|----------|
| Wave-5 5A (P0-04 Refund) | ✅ S5 PASS / CLOSED | `WAVE5_EVIDENCE.md` §6; evidence/wave5-5a/ |
| Wave-5 5B (P0-03 Reconciliation) | ✅ S5 PASS / CLOSED | `WAVE5_EVIDENCE.md` §6; evidence/wave5-5b/ |
| Wave-5 5C M16 (Outbox lag) | ✅ S5 PASS / CLOSED | evidence/wave5-5c/ |
| Wave-5 5C M3 (Missing capture status) | ✅ S5 PASS / CLOSED | evidence/wave5-5c/ |
| Wave-5 5C M9 (Stuck CAPTURE_PENDING) | ✅ S5 PASS / CLOSED | evidence/wave5-5c/ |
| Wave-5 5C M10 (Stuck REFUND_PENDING) | ✅ S5 PASS / CLOSED | evidence/wave5-5c/ |
| Wave-5 5C CLASS B/D/E | 🔒 HOLD/QUARANTINE/NO-AUTO-REPAIR | `WAVE5_5C_REMEDIATION_GATE_REVIEW.md` |
| M1-M17 reconciliation detectors | ✅ Present (2580 LOC) | `src/lib/reconciliation.ts` |
| M9/M10 re-enqueue prohibition | ✅ 4× `reEnqueueProhibited: true` | `src/lib/reconciliation.ts` |
| P0-25 optimistic locking (Order.version) | ✅ Present | `prisma/schema.prisma:152`; `src/app/api/orders/[id]/status/route.ts` |
| P0-28 freeze mechanism | ✅ Present | `src/lib/invariant-checker.ts` |
| P0-22 AuditLog WORM | ✅ CLOSED (staging) | DEV-001 closure |
| OTP service (custom scrypt + DB) | ✅ Present | `src/lib/otp-service.ts` |
| Session handling (custom cookie + DB) | ✅ Present | `src/lib/session.ts` |
| Supabase client + admin | ✅ Present | `src/lib/supabase.ts`; `src/lib/supabase-admin.ts` |
| Firebase client + admin | ⚠️ Present (LEGACY — to be removed) | `src/lib/firebase.ts`; `src/lib/firebase-admin.ts` |
| Schema provider | ✅ PostgreSQL | `prisma/schema.prisma:14` |
| Migrations (Wave-1..5) | ✅ Present | `prisma/scripts/wave1..5*.sql` |
| Evidence directories (Wave-3..5) | ✅ 10 directories | `evidence/wave3-3a/`..`evidence/wave5-5c/` |
| Production readiness docs | ✅ Present (STALE) | `PRODUCTION_READINESS_GATE_REVIEW.md`; `INFRASTRUCTURE_READINESS.md` |
| GitHub workflows (45 files) | ✅ Present | `.github/workflows/` |

### What is ABSENT (lost session work):

| Component | Status | Was |
|-----------|--------|-----|
| Gateway Idempotency (foundation + evidence + finalization) | ❌ ABSENT | Session work (commits `53b5dcd`..`efc1252`) |
| Wave-6 P0-06 (Fulfilment model + M18-M21 + invariant-checker) | ❌ ABSENT | Session work (commits `3cb9e10`..`a5b160d`) |
| Wave-7 P0-07 (pickup attribution + M22/M23 + pickup/verify endpoint) | ❌ ABSENT | Session work (commits `1228591`..`3d47fbe`) |
| Wave-8 Production Readiness Review | ❌ ABSENT | Session work (commit `2bfb097`) |
| `src/lib/fulfilment-state.ts` | ❌ ABSENT | Wave-6 implementation |
| `src/lib/pickup-attribution.ts` | ❌ ABSENT | Wave-7 implementation |
| `src/lib/state-invariants.ts` | ❌ ABSENT | Wave-6 implementation |
| `src/app/api/orders/[id]/pickup/verify/route.ts` | ❌ ABSENT | Wave-7 implementation |
| `src/app/api/orders/[id]/fulfilment/route.ts` | ❌ ABSENT | Wave-6 implementation |
| `mini-services/invariant-checker/` | ❌ ABSENT | Wave-6 implementation |
| `prisma/scripts/wave6-p0-06-migration.sql` | ❌ ABSENT | Wave-6 migration |
| `evidence/wave5-gateway-idempotency/` | ❌ ABSENT | Gateway evidence |
| `evidence/wave6-p0-06/` | ❌ ABSENT | Wave-6 evidence |
| `evidence/wave7-p0-07/` | ❌ ABSENT | Wave-7 evidence |
| 5 governance markdown docs | ❌ ABSENT | Gateway/Wave-5 checkpoint/Wave-6/7/8 reviews |

---

## 4. Wave-5 Status

**✅ CLOSED** — all 5A/5B/5C sub-waves S5 PASS / CLOSED.

| Sub-Wave | P0 | Status | Evidence |
|----------|-----|--------|----------|
| 5A | P0-04 (Refund) | ✅ S5 PASS / CLOSED | `WAVE5_EVIDENCE.md` §6; `evidence/wave5-5a/` |
| 5B | P0-03 (Reconciliation) | ✅ S5 PASS / CLOSED | `WAVE5_EVIDENCE.md` §6; `evidence/wave5-5b/` |
| 5C M16 | Outbox lag | ✅ S5 PASS / CLOSED | `evidence/wave5-5c/` |
| 5C M3 | Missing capture status | ✅ S5 PASS / CLOSED | `evidence/wave5-5c/` |
| 5C M9 | Stuck CAPTURE_PENDING | ✅ S5 PASS / CLOSED | `evidence/wave5-5c/` |
| 5C M10 | Stuck REFUND_PENDING | ✅ S5 PASS / CLOSED | `evidence/wave5-5c/` |
| CLASS B | M2/M7/M13 | 🔒 HOLD | Ledger synthesis HIGH RISK |
| CLASS D | M11/M12/M14 | 🔒 QUARANTINE | Manual review required |
| CLASS E | M1/M4/M5/M6/M8/M15/M17 | 🔒 NO-AUTO-REPAIR | Forensic/accounting |

**Wave-5 5A/5B/5C closures are the foundation for all subsequent work.** They must remain untouched.

---

## 5. Gateway Status

**🔒 NOT IMPLEMENTED** — the Gateway Idempotency workstream was session work that is now ABSENT.

- `gatewayIdempotencyKey` does NOT appear anywhere in `src/` (grep: 0 matches)
- No `WAVE5_GATEWAY_IDEMPOTENCY*` documentation exists
- No gateway idempotency key in Outbox payload
- The gap is documented as DEFERRED in `src/lib/reconciliation.ts:1733` + `docs/TRANSACTION_RETRY_INVARIANT.md` §8.2 item 4
- M9/M10 re-enqueue remains PROHIBITED (4× `reEnqueueProhibited: true`)

**E9 status:** 🔒 UNVERIFIED (external/operator dependency — Razorpay TEST-mode credentials required)

---

## 6. P0-06 Status

**❌ NOT IMPLEMENTED — REQUIRES REBUILD + NEW EVIDENCE**

- No `Fulfilment` model in `prisma/schema.prisma` (grep: 0 matches)
- No `src/lib/fulfilment-state.ts`
- No `src/lib/state-invariants.ts` (M18-M21 detectors)
- No `mini-services/invariant-checker/`
- No `prisma/scripts/wave6-p0-06-migration.sql`
- No `evidence/wave6-p0-06/` evidence directory
- `Order.status` IS overloaded (fulfilment + payment + freeze collapsed into one column)
- NONE of the M1-M17 reconciliation detectors query `Order.status`

**Lifecycle state:** S2 (Specified) — no code, no tests, no evidence.

---

## 7. P0-07 Status

**❌ NOT IMPLEMENTED — REQUIRES REBUILD + NEW EVIDENCE**

- No `pickupVerifiedAt` / `pickupVerifiedBy` anywhere in schema or `src/` (grep: 0 matches)
- No `src/lib/pickup-attribution.ts`
- No `/api/orders/[id]/pickup/verify/route.ts`
- No `/api/orders/[id]/fulfilment/route.ts`
- No M22/M23 detectors
- `PATCH /api/orders/[id]/status` is UNAUTHENTICATED (no `getSessionUser()` call)
- `pickupOtp` is ISSUED on READY_FOR_PICKUP but NEVER VERIFIED on PICKED_UP
- `verifyOtp()` exists in `otp-service.ts:50` but is NOT called for `purpose='pickup'`

**Lifecycle state:** S2 (Specified) — no code, no tests, no evidence.

---

## 8. I-13 Status

**❌ NOT VERIFIED — NOT ENFORCED**

I-13 (Pickup/Handoff Integrity) is NOT enforced by any P0. The P0-07 implementation that would enforce it (8 attribution conditions for PICKED_UP) is ABSENT. Only the P0-28 backstop (invariant-checker.ts freeze on unknown states) applies — but it does NOT proactively gate PICKED_UP with QR+OTP verification.

---

## 9. Firebase Elimination Audit

### Summary: 10 source files + 19 documentation files + 1 config file

| Classification | Count | Action |
|----------------|-------|--------|
| REMOVE (delete file/route/dep) | 6 | `firebase.ts`, `firebase-admin.ts`, `/api/auth/firebase/*`, `firebase`+`firebase-admin` in `package.json`, middleware rule, `providers.tsx` analytics init |
| REPLACE (migrate to Supabase) | 2 | `/api/auth/firebase/session` → already replaced by `/api/auth/supabase/session`; `/api/auth/firebase/verify-test` → rewrite or delete |
| DOCUMENTATION (update text) | 19 | Update .md files (214 occurrences) to remove Firebase references + replace with Supabase |
| TEST | 0 | No test-only Firebase dependencies |
| EXTERNAL | 1 | `bun.lock` will regenerate on next install |

### Key finding: Supabase path is FUNCTIONALLY COMPLETE

| Function | Firebase path | Supabase path | Status |
|----------|--------------|---------------|--------|
| Client phone OTP send | `sendFirebaseOtp()` | `sendSupabaseOtp()` | ✅ Supabase used by `phone-otp-login.tsx` |
| Client phone OTP verify | Firebase `signInWithPhoneNumber` | `verifySupabaseOtp()` | ✅ Supabase used by `phone-otp-login.tsx` |
| Server JWT verify | `verifyFirebaseToken()` | `verifySupabaseToken()` | ✅ Supabase wired in `/api/auth/supabase/session` |
| Session creation | `createSession()` | Same (custom SnakZap session) | ✅ Identical |
| User revocation | N/A | `isUserRevoked()` | ✅ NEW (Supabase-only) |
| Analytics | `getFirebaseAnalytics()` | None | ⚠️ Optional (Vercel Analytics or remove) |

**Firebase is a "dead parallel" — reachable but unused by the actual client UI.** Eliminating it is a mechanical removal + documentation task requiring NO new functional code.

---

## 10. Supabase Target-State Audit

### What exists:

| Component | Status | File |
|-----------|--------|------|
| `@supabase/supabase-js` dependency | ✅ Present | `package.json:51` (`^2.112.2`) |
| `jose` dependency (JWT verification) | ✅ Present | `package.json:63` (`^6.2.8`) |
| Server-side Supabase admin client | ✅ Present | `src/lib/supabase-admin.ts` (74 LOC) |
| Client-side Supabase client | ✅ Present | `src/lib/supabase.ts` (58 LOC) |
| Supabase session route | ✅ Present | `src/app/api/auth/supabase/session/route.ts` |
| Consumer/vendor phone OTP login (Supabase) | ✅ Wired | `src/components/snak/phone-otp-login.tsx` |
| 5 Supabase env vars documented | ✅ Documented | `docs/ENV_VAR_AUDIT.md` (SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) |
| Staging Supabase project | ✅ Exists | `zmzqqcyapcezmaqvuzzd` (Tokyo ap-northeast-1) |
| Production Supabase project | ❌ NOT provisioned | HB-7 (operator task) |

### Gaps between current + required production Supabase state:

1. **Production Supabase project** NOT provisioned (HB-7 — operator task)
2. **Firebase deps** still in `package.json` (REMOVE)
3. **Firebase source files** still present (6 files to DELETE)
4. **19 documentation files** have stale Firebase references (214 occurrences)
5. **HB-11** in `PRODUCTION_READINESS_GATE_REVIEW.md` references Firebase (REPLACE with Supabase)
6. **Supabase Auth phone OTP** must be enabled in Supabase dashboard for production project (operator)
7. **Supabase SMS provider** must be configured for Indian (+91) phone numbers (operator)
8. **Admin 2FA** uses custom OTP service (scrypt + DB) — NOT Supabase (acceptable, can remain custom)

---

## 11. Dependency Graph (Rebuild from Current Repo)

```text
Wave-5 baseline (80e628d) ✅ CLOSED
      ↓
Gateway Idempotency ❌ NOT IMPLEMENTED
  (key foundation + E9 evidence — E9 BLOCKED on operator credentials)
      ↓
P0-06 State Separation ❌ NOT IMPLEMENTED
  (Fulfilment model + M18-M21 + invariant-checker)
      ↓
P0-07 Pickup Attribution ❌ NOT IMPLEMENTED
  (8 attribution conditions + pickup/verify endpoint + M22/M23)
      ↓
Production Readiness ❌ NOT READY
  (HB-5 DR + HB-6 rollback + HB-7..HB-13 infra + HB-14 outbox-publisher + HB-15 §8.2)
```

### Per-node detail:

| Node | Current Lifecycle | Current Evidence | Missing Implementation | Dependencies | Required Evidence |
|------|-------------------|-------------------|----------------------|--------------|-------------------|
| Gateway Idempotency | S2 (Specified) | NONE | Key generation + outbox payload persistence + publisher propagation + E9 gateway proof | Wave-5 CLOSED ✅; Razorpay TEST creds (E9 BLOCKED) | E1-E9 runtime evidence |
| P0-06 State Separation | S2 (Specified) | NONE | Fulfilment model + state machine + M18-M21 + invariant-checker | P0-01/02/04/05 CLOSED ✅ | E1-E12 runtime evidence |
| P0-07 Pickup Attribution | S2 (Specified) | NONE | pickup-attribution lib + pickup/verify endpoint + M22/M23 + RBAC + cross-credential | P0-06 CLOSED (NOT YET); P0-22 CLOSED ✅ | E1-E14 runtime evidence |
| Production Readiness | NOT READY | STALE docs | HB-5 DR + HB-6 rollback + HB-7..HB-13 infra + HB-14 + HB-15 | P0-06 + P0-07 CLOSED (NOT YET); operator provisioning | 7 AND-conditions ALL PASS |

---

## 12. Production Readiness Matrix (Rebuilt — Supabase-Only)

### HB-1..HB-15 (current repository evidence):

| HB# | Hard Blocker | Status | Evidence | Notes |
|-----|--------------|--------|----------|-------|
| HB-1 | P0-04 Refund S5 PASS | ✅ RESOLVED | Wave-5 5A CLOSED | Pre-session |
| HB-2 | P0-03 Reconciliation S5 PASS | ✅ RESOLVED | Wave-5 5B CLOSED | Pre-session |
| HB-3 | P0-06 State separation S5 PASS | ❌ NOT IMPLEMENTED | ABSENT (lost) | Requires rebuild |
| HB-4 | P0-07 Pickup attribution S5 PASS | ❌ NOT IMPLEMENTED | ABSENT (lost) | Requires rebuild |
| HB-5 | DR drill executed | ❌ FAILS | DESIGN ONLY | pg_dump rewrite + warm-standby + drill |
| HB-6 | Rollback drill executed | ❌ FAILS | Production rollback.yml NEVER dispatched | Requires HB-13 |
| HB-7 | Production Supabase project provisioned | ❌ FAILS | NOT provisioned | Operator task |
| HB-8 | Production Vercel env vars configured | ❌ FAILS | NOT configured | Operator task |
| HB-9 | Fly.io mini-services deployed | ❌ FAILS | 0/3 deployed | Operator task |
| HB-10 | Razorpay production keys provisioned | ❌ FAILS | NOT provisioned | Operator task |
| HB-11 | ~~Firebase service account~~ → **Supabase Auth production config** | ❌ FAILS | Firebase references STALE | Replace with Supabase Auth config |
| HB-12 | snakzap_app role + WORM REVOKE on production | ❌ FAILS | Staging-only | Operator task |
| HB-13 | GitHub secrets + environments | ❌ FAILS | NOT configured | Operator task |
| HB-14 | outbox-publisher on Fly.io | ❌ FAILS | NOT deployed | Operator task |
| HB-15 | §8.2 enforcement items (1,2,4,5) | ❌ FAILS | Item 3 DONE; 1,2,4,5 NOT | IDE task |

### 7 AND-condition launch gate:

| # | Condition | Status |
|---|-----------|--------|
| 1 | All P0s Production-ready | ❌ FAIL (P0-06 + P0-07 NOT IMPLEMENTED) |
| 2 | All invariants verified | ❌ FAIL (I-13 NOT enforced) |
| 3 | External-dep scenarios tested | ❌ FAIL (Gateway E9 UNVERIFIED) |
| 4 | DR drill | ❌ FAIL (NOT executed) |
| 5 | Rollback drill | ❌ FAIL (NOT executed) |
| 6 | No unresolved P0 exception | ✅ PASS (trivially) |
| 7 | No expired waiver | ✅ PASS |

**Result: 2 PASS / 5 FAIL → PRODUCTION NO-GO** (worse than the lost `2bfb097` state which had 4 PASS / 3 FAIL, because P0-06 + P0-07 regressed to NOT IMPLEMENTED).

---

## 13. Rebuild Plan (DO NOT Execute)

### A. Mandatory Rebuild (functionality lost from repository)

| Phase | Work | Estimated LOC | Depends on |
|-------|------|---------------|------------|
| Gateway Idempotency | Key generation + outbox payload + publisher propagation | ~300 | Wave-5 ✅ |
| P0-06 State Separation | Fulfilment model + state machine + M18-M21 + invariant-checker + migration | ~1300 | Gateway (optional — can proceed in parallel) |
| P0-07 Pickup Attribution | pickup-attribution lib + pickup/verify endpoint + M22/M23 + RBAC + cross-credential | ~1000 | P0-06 CLOSED |
| §8.2 Enforcement | Code-review checklist + ESLint rule + pre-gen idempotency key + CI gate | ~200 | None (can parallel) |

### B. Existing Wave-5 Functionality (must remain untouched)

- Wave-5 5A refund flow (Payment/Refund/LedgerEntry/Outbox)
- Wave-5 5B reconciliation (M1-M17 detectors + ReconciliationFinding)
- Wave-5 5C M16/M3/M9/M10 remediation (status-flip only, NO re-enqueue)
- M9/M10 re-enqueue prohibition (4× `reEnqueueProhibited: true`)

### C. Supabase Migration (Firebase → Supabase)

| Task | Effort | Classification |
|------|--------|----------------|
| Delete `src/lib/firebase.ts` | Trivial | REMOVE |
| Delete `src/lib/firebase-admin.ts` | Trivial | REMOVE |
| Delete `src/app/api/auth/firebase/` (2 routes) | Trivial | REMOVE |
| Remove `firebase` + `firebase-admin` from `package.json` | Trivial | REMOVE |
| Remove Firebase from `providers.tsx` + `page.tsx` + `middleware.ts` | Trivial | REMOVE |
| Update `otp-service.ts` stale comment | Trivial | DOCUMENTATION |
| Update 19 .md files (214 occurrences) | Medium | DOCUMENTATION |
| Replace HB-11 in production readiness docs | Trivial | DOCUMENTATION |
| `bun install` to regenerate `bun.lock` | Trivial | EXTERNAL |

**No new functional code required** — the Supabase path is already wired and functional.

### D. Production Infrastructure (operator-controlled)

- HB-7: Production Supabase project
- HB-8: Production Vercel env vars (remove Firebase env vars, keep Supabase)
- HB-9: Fly.io mini-services (outbox-publisher, reconciliation, alert-evaluator, realtime, invariant-checker)
- HB-10: Razorpay production API keys
- HB-12: snakzap_app role + WORM REVOKE
- HB-13: GitHub secrets + environments
- HB-14: outbox-publisher as long-lived service

### E. Evidence Gates

Each implementation phase MUST have a separate evidence gate:
1. `GATEWAY-IDEMPOTENCY-EVIDENCE-GATE-01` (E1-E9 — E9 will BLOCK on credentials)
2. `WAVE6-P0-06-EVIDENCE-GATE-01` (E1-E12)
3. `WAVE7-P0-07-EVIDENCE-GATE-01` (E1-E14)
4. Firebase elimination evidence (lint + compile + auth flow works with Supabase-only)
5. `WAVE8-PRODUCTION-READINESS-REVIEW-02` (Supabase-only re-audit)
6. DR drill evidence (HB-5)
7. Rollback drill evidence (HB-6)

---

## 14. Evidence-Gate Plan

```text
WAVE9 READ/PLAN-FIRST (this gate)
    ↓
Firebase Elimination (IMPLEMENT + EVIDENCE)
    ↓
Gateway Idempotency (READ/PLAN-FIRST → IMPLEMENT → EVIDENCE — E9 will BLOCK)
    ↓
P0-06 State Separation (READ/PLAN-FIRST → IMPLEMENT → EVIDENCE)
    ↓
P0-07 Pickup Attribution (READ/PLAN-FIRST → IMPLEMENT → EVIDENCE)
    ↓
§8.2 Enforcement (IMPLEMENT → EVIDENCE)
    ↓
WAVE8 Production Readiness Review v2 (Supabase-only)
    ↓
DR Drill + Rollback Drill (operator-authorized)
    ↓
Final Production GO / NO-GO
```

**Recommended sequence:** Firebase elimination FIRST (it's mechanical + removes a dead parallel path), then Gateway → P0-06 → P0-07 (the critical path), then §8.2 enforcement, then production readiness review.

---

## 15. Safety Invariants

| ID | Invariant | Must hold during rebuild |
|----|-----------|--------------------------|
| W9-SI-01 | Wave-5 5A/5B/5C closures remain untouched | No Payment/Refund/LedgerEntry/Outbox mutation |
| W9-SI-02 | M9/M10 re-enqueue remains PROHIBITED | 4× `reEnqueueProhibited: true` intact |
| W9-SI-03 | Gateway E9 remains FROZEN/UNVERIFIED | No credential fabrication; E9 BLOCKED accepted |
| W9-SI-04 | Order.status NOT split until P0-06 is properly re-implemented | Additive Fulfilment model (NOT column split) |
| W9-SI-05 | I-13 NOT declared enforced until P0-07 is re-implemented + evidenced | No inference from conversation history |
| W9-SI-06 | Firebase NOT introduced as new dependency | `firebase` + `firebase-admin` deps REMOVED, not added |
| W9-SI-07 | Supabase is the SOLE auth/OTP platform | No Firebase fallback retained |
| W9-SI-08 | All production flags remain OFF | realPayments, webhookHandler, requestHashEnforcement, reconciliationAutoRepair, invariantChecker, pickupAttributionEnforcement |
| W9-SI-09 | No P0-06/P0-07 S5 PASS declared from conversation history alone | Must be re-implemented + runtime-evidenced |
| W9-SI-10 | No production deployment authorized by this gate | Production remains NOT AUTHORIZED |

---

## 16. Explicit Implementation Prohibitions

This READ/PLAN-FIRST gate MUST NOT:
- ❌ modify application code
- ❌ modify schema
- ❌ create migrations
- ❌ modify flags
- ❌ activate flags
- ❌ deploy
- ❌ run production mutations
- ❌ reopen Gateway E9
- ❌ activate M9/M10 retry
- ❌ modify Payment/Refund/LedgerEntry/Outbox semantics
- ❌ declare P0-06 PASS
- ❌ declare P0-07 PASS
- ❌ declare I-13 enforced
- ❌ declare production READY
- ❌ introduce Firebase
- ❌ attempt to recover/fabricate the 13 lost session commits

---

## 17. Orchestrator Decision Required

**GO FOR NEXT READ/PLAN-FIRST** — the baseline is accepted, the path is clear.

The recommended next implementation directive is:

**`FIREBASE-ELIMINATION-IMPLEMENT-01`** — authorize the mechanical removal of Firebase (6 source files + 2 package.json deps + middleware rule + providers/page.tsx references) + documentation update (19 .md files). This is the lowest-risk, highest-value first step because:
1. It's mechanical (no new functional code — Supabase path already wired)
2. It removes a dead parallel (Firebase is unused by the client UI)
3. It enforces the new Supabase-only policy
4. It cleans the codebase before the Wave-6/7 rebuild

After Firebase elimination: `GATEWAY-IDEMPOTENCY-READ-PLAN-FIRST-01` → `WAVE6-P0-06-READ-PLAN-FIRST-01` → `WAVE7-P0-07-READ-PLAN-FIRST-01` → production readiness review.

---

## 18. STOP State

### Verification — no modifications performed:

- ✅ No application code changed
- ✅ No schema changed
- ✅ No migration created
- ✅ No flags changed (all 8 remain OFF)
- ✅ No deployment occurred
- ✅ git working tree clean
- ✅ No orphan processes

### Deliverable:

`WAVE9_RESET_BASELINE_SUPABASE_READ_PLAN_FIRST.md` — this document (READ/PLAN-FIRST only).

### Canonical state:

```text
80e628d Canonical Baseline     ✅ ACCEPTED

Wave-5 5C                     ✅ CLOSED
Gateway E9                    🔒 FROZEN / UNVERIFIED
M9/M10                        🚫 PROHIBITED

P0-06                         ⚠️ REQUIRES REBUILD + NEW EVIDENCE
P0-07                         ⚠️ REQUIRES REBUILD + NEW EVIDENCE
I-13                          ❌ NOT VERIFIED

Firebase                      🚫 FORBIDDEN
Supabase                      ✅ REQUIRED (functionally complete, Firebase removal = mechanical)

Production                    🚫 NOT AUTHORIZED (5 of 7 launch-gate conditions FAIL)

WAVE9 READ/PLAN-FIRST         ✅ COMPLETE
Implementation                🔒 NOT AUTHORIZED

IDE                           🛑 STOPPED
```

---

**End of WAVE9 READ/PLAN-FIRST gate review. IDE STOPPED.**
