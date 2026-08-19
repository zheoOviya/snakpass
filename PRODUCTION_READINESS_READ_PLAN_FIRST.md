# Production Readiness — READ/PLAN-FIRST Gate Review

> **Directive:** `PRODUCTION-READINESS-READ-PLAN-FIRST-01`
> **Directive class:** READ/PLAN-FIRST governance gate (NO implementation authorized)
> **Date:** 2026-08-18
> **HEAD at review:** `940526a6e08b6f006408720f9a896216c5663f9b` (P0-07 CLOSED)
> **Document type:** Gate review (HB inventory + A/B/C classification + DR/rollback gap + E9 dependency + production safety + proposed execution order)

---

## 1. Canonical Baseline

```text
Wave-5 5C                     ✅ CLOSED
Firebase                      ✅ ELIMINATED (1890fed)
Supabase                      ✅ SOLE AUTH PLATFORM

Gateway Idempotency           ✅ IMPLEMENTED (cd4ae6a — immutable)
  E1-E8 evidence              ✅ PASS (ea683cf)
  E9                          🔒 BLOCKED (external dependency — Razorpay TEST creds)
  M9/M10                      🚫 PROHIBITED (4× reEnqueueProhibited: true)

P0-06 State Separation        ✅ CLOSED (6f259b3 — S5 PASS)
P0-07 Pickup Attribution      ✅ CLOSED (940526a — S5 PASS)
I-13                          ✅ ENFORCED

Critical P0 path              ✅ COMPLETE (all 5 P0s CLOSED)

Production                    🚫 NOT AUTHORIZED
```

---

## 2. HB-1..HB-15 Status

| HB# | Hard Blocker | Status | A/B/C | Evidence |
|-----|--------------|--------|-------|----------|
| HB-1 | P0-04 Refund S5 PASS | ✅ RESOLVED | A | Wave-5 5A CLOSED |
| HB-2 | P0-03 Reconciliation S5 PASS | ✅ RESOLVED | A | Wave-5 5B CLOSED |
| HB-3 | P0-06 State separation S5 PASS | ✅ RESOLVED | A | P0-06 S5 PASS (6f259b3) |
| HB-4 | P0-07 Pickup attribution S5 PASS | ✅ RESOLVED | A | P0-07 S5 PASS (940526a) |
| HB-5 | DR drill executed | ❌ STILL FAILS | C | DESIGN ONLY; pg_dump NOT implemented; no dr-drill.yml; no warm-standby Supabase |
| HB-6 | Rollback drill executed (Class-1 ≤10 min) | ❌ STILL FAILS | C | rollback.yml + staging-rollback-drill.yml AUTHORED but NOT executed |
| HB-7 | Production Supabase project provisioned | ❌ STILL FAILS | B | NOT provisioned (operator task) |
| HB-8 | Production Vercel env vars configured | ❌ STILL FAILS | B | NOT configured; ENV_VAR_AUDIT.md STALE (still lists Firebase vars) |
| HB-9 | Fly.io mini-services deployed | ❌ STILL FAILS | B | 0/3+ deployed (operator task) |
| HB-10 | Razorpay production API keys provisioned | ❌ STILL FAILS | B | NOT provisioned (operator task) |
| HB-11 | Supabase Auth production configuration | ❌ STILL FAILS | B | Depends on HB-7; doc body STALE (still references Firebase) |
| HB-12 | snakzap_app role + WORM REVOKE on production | ❌ STILL FAILS | B | SQL scripts exist (DEV-001) but NOT applied to production |
| HB-13 | GitHub secrets + environments configured | ❌ STILL FAILS | B | NOT configured (operator task) |
| HB-14 | outbox-publisher on Fly.io (long-lived) | ❌ STILL FAILS | B | NOT deployed (depends on HB-9) |
| HB-15 | §8.2 enforcement items (1, 2, 4, 5) | ⚠️ PARTIALLY RESOLVED | A | Item 3 DONE (Wave-4 4c); Item 4 DONE (Gateway cd4ae6a); Items 1, 2, 5 DEFERRED |

**Summary:** 4 RESOLVED (HB-1..HB-4) + 1 PARTIALLY RESOLVED (HB-15) + 10 STILL FAILS (HB-5..HB-14)

---

## 3. 7 AND-Condition Launch Gate

| # | Condition | Status | Notes |
|---|-----------|--------|-------|
| 1 | All P0s Production-ready | ✅ PASS | All 5 critical-path P0s CLOSED |
| 2 | All invariants verified (I-01..I-14) | ✅ PASS | I-13 now enforced by P0-07 |
| 3 | External-dependency scenarios tested | ❌ FAIL | Gateway E9 BLOCKED (Razorpay TEST creds) |
| 4 | DR drill passed | ❌ FAIL | NOT executed |
| 5 | Rollback drill passed | ❌ FAIL | NOT executed |
| 6 | No unresolved P0 exception | ✅ PASS | No production traffic |
| 7 | No expired waiver | ✅ PASS | No waivers |

**Result: 4 PASS / 3 FAIL → PRODUCTION NO-GO**

---

## 4. A/B/C Classification

### A — Repository Implementation Required (HB-15 remaining items)

| Item | Description | Status |
|------|-------------|--------|
| HB-15 item 1 | Code-review checklist | ❌ NOT IMPLEMENTED |
| HB-15 item 2 | ESLint rule (no external call in withTransaction) | ❌ NOT IMPLEMENTED |
| HB-15 item 5 | CI gate grep-scan | ❌ NOT IMPLEMENTED |

**Note:** HB-15 items 3 + 4 are DONE (Wave-4 4c + Gateway cd4ae6a).

### B — Operator/Production Infrastructure Required

| HB# | Component | Dependency |
|-----|-----------|------------|
| HB-7 | Production Supabase project | Independent (first operator task) |
| HB-8 | Vercel env vars (reduced from 26 — Firebase removed) | Depends on HB-7 |
| HB-9 | Fly.io mini-services (realtime + alert-evaluator + outbox-publisher + invariant-checker) | Independent |
| HB-10 | Razorpay production API keys | Independent |
| HB-11 | Supabase Auth production config | Depends on HB-7 |
| HB-12 | snakzap_app role + WORM REVOKE | Depends on HB-7 (SQL scripts exist) |
| HB-13 | GitHub secrets + environments | Independent (unblocks HB-6) |
| HB-14 | outbox-publisher long-lived on Fly.io | Depends on HB-9 |

### C — Evidence/Drill Required

| HB# | Drill | Prerequisites |
|-----|-------|---------------|
| HB-5 | DR drill | pg_dump rewrite (A) + warm-standby Supabase (B) + dr-drill.yml workflow (A) + Orchestrator authorization |
| HB-6 | Rollback drill | HB-13 (GitHub secrets + environments) + Orchestrator authorization |

---

## 5. DR Gap Analysis (READ-ONLY)

### Current backup mechanism:
- **SQLite file-copy** (`src/lib/backup.ts` reads `db/custom.db`) — **INCOMPATIBLE with PostgreSQL production**
- `pg_dump` rewrite: **DESIGN ONLY — NOT IMPLEMENTED** (target: `pg_dump --format=custom --compress=9` → Supabase Storage bucket `snakzap-backups`)

### Restore procedure:
- Authored (6-step restore in `docs/DR_RUNBOOK.md` §4.2) but **NOT EXECUTED**
- Companion script `scripts/restore-backup.sh` exists but **NOT EXECUTED**

### Warm-standby Supabase:
- **NOT PROVISIONED** (operator task)

### RPO/RTO targets:
- RPO ≤ 24 hours
- RTO ≤ 4 hours (target ~30 min with warm standby)
- Retention: 30 days
- Drill frequency: monthly

### `dr-drill.yml` workflow:
- **DOES NOT EXIST** (47 workflows in `.github/workflows/` — none match `dr-drill`)

### Evidence required for HB-5:
1. Backup created (SHA-256 computed)
2. Restore within RTO (≤ 4 hours, target 30 min)
3. All row counts match
4. Audit hash-chain integrity verified
5. Reconciliation: no unresolved money state
6. Drill result recorded

### Prerequisites blocking HB-5:
- pg_dump rewrite (Class A — IDE task)
- Warm-standby Supabase (Class B — operator)
- dr-drill.yml workflow (Class A — IDE task)
- Orchestrator drill authorization

---

## 6. Rollback Gap Analysis (READ-ONLY)

### `rollback.yml` (production):
- **AUTHORED** (292 lines) with ≤10-min assertion + evidence artifact upload
- **NOT EXECUTED** in production
- Requires: HB-13 (GitHub secrets + environments) + production Vercel deployment

### `staging-rollback-drill.yml` (staging):
- **AUTHORED** (241 lines) with `known_good_sha` input
- **NOT EXECUTED** formally
- Scope: STAGING ONLY

### Evidence required for HB-6:
1. Workflow dispatch record
2. T0/T1/T2 timing capture (`timing.env`)
3. Smoke test results (4 endpoints PASS)
4. `within_budget=true` assertion (≤ 600s)
5. Artifact upload (90-day retention)

### Prerequisites blocking HB-6:
- HB-13 (GitHub secrets + environments — operator)
- Orchestrator drill authorization

---

## 7. Gateway E9 Dependency (READ-ONLY — NOT Reopened)

**Status:** 🔒 BLOCKED — external/operator dependency

**Exact missing dependency:** Razorpay TEST-mode credentials (`RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` — TEST mode, NOT production)

**Verification procedure for E9:**
1. Configure Razorpay TEST-mode API keys on staging Vercel
2. Enable `realPayments=true` on staging ONLY
3. Trigger capture with pre-generated `X-Idempotency-Key`
4. Force publisher retry (same key, same payload)
5. Verify Razorpay deduplicates (returns same `razorpay_payment_id`)
6. Verify ONE Payment row, ONE LedgerEntry pair, ONE Outbox row
7. Repeat for refund flow
8. Capture evidence JSON with `mode: real` + `ok: true`

**Is E9 a direct §14.1 launch-gate condition?** NO — E9 rolls up under Cond #3 (external-dependency scenarios tested)

**Can production proceed without E9?**
- `realPayments=true`: ❌ NO — requires staging real-mode evidence
- Demo-mode soft launch (`realPayments=false`): ✅ YES — but drills + operator provisioning still required

**M9/M10 retry:** 🚫 PROHIBITED — E9 PASS required before M9/M10 retry-safety can be authorized. Gateway NOT CLOSED.

---

## 8. Production Safety Matrix

| Component | Status |
|-----------|--------|
| `realPayments` | 🚫 OFF |
| `pickupAttributionEnforcement` | 🚫 OFF |
| `invariantChecker` | 🚫 OFF |
| `reconciliationAutoRepair` | 🚫 OFF |
| `webhookHandler` | 🚫 OFF |
| `requestHashEnforcement` | 🚫 OFF |
| `outboxPublisher` | 🚫 OFF |
| `concurrencyControl` | 🚫 OFF |
| `drDrillMode` | 🚫 OFF |
| M9/M10 `reEnqueueProhibited` | ✅ 4× intact |
| Gateway E9 | 🔒 FROZEN/BLOCKED |
| P0-06 | ✅ CLOSED (immutable) |
| P0-07 | ✅ CLOSED (immutable) |
| I-13 | ✅ ENFORCED |
| Supabase sole auth | ✅ VERIFIED (0 Firebase refs) |
| Wave-5 5A/5B/5C | ✅ CLOSED (immutable) |

---

## 9. Supabase Production Requirements

| Component | Current | Required |
|-----------|---------|----------|
| Production Supabase project | ❌ NOT provisioned | Separate project (HB-7) |
| DATABASE_URL (production) | ❌ NOT configured | Supabase Transaction Pooler URL with `snakzap_app` role |
| SUPABASE_URL | ❌ NOT in production env | Production project URL |
| SUPABASE_SECRET_KEY | ❌ NOT in production env | Service role key |
| SUPABASE_JWKS_URL | ❌ NOT in production env | `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` |
| NEXT_PUBLIC_SUPABASE_URL | ❌ NOT in production env | Production project URL (browser) |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ❌ NOT in production env | Anon key (browser) |
| snakzap_app role + WORM REVOKE | ❌ NOT applied | `create-roles.sql` + `revoke-worm.sql` (HB-12) |
| Supabase Storage bucket | ❌ NOT provisioned | `snakzap-backups` for pg_dump (HB-5 prerequisite) |

---

## 10. Proposed Execution Order

```text
Phase 1 — Operator Infrastructure Wave (HB-7..HB-13 + HB-14)
  ├── HB-7:  Provision production Supabase project
  ├── HB-12: Apply snakzap_app role + WORM REVOKE
  ├── HB-8:  Configure Vercel env vars (Supabase-only — Firebase removed)
  ├── HB-11: Supabase Auth production config (comes free with HB-7)
  ├── HB-13: Configure GitHub secrets + environments (unblocks HB-6)
  ├── HB-9:  Deploy Fly.io mini-services (realtime + alert-evaluator + outbox-publisher + invariant-checker)
  ├── HB-14: outbox-publisher as long-lived service
  └── HB-10: Provision Razorpay production API keys

Phase 2 — Repository Implementation (HB-15 items 1, 2, 5)
  ├── Item 1: Code-review checklist document
  ├── Item 2: ESLint custom rule (no external call in withTransaction)
  └── Item 5: CI gate grep-scan script

Phase 3 — DR Preparation (HB-5 prerequisites)
  ├── pg_dump rewrite (src/lib/backup.ts + backup-scheduler)
  ├── dr-drill.yml workflow authoring
  └── Warm-standby Supabase provisioning (operator)

Phase 4 — DR Drill (HB-5)
  └── Execute controlled DR drill → evidence

Phase 5 — Rollback Drill (HB-6)
  ├── Execute staging-rollback-drill.yml formally
  └── Execute production rollback.yml (post-soft-launch)

Phase 6 — Gateway E9 (Cond #3 — external dependency)
  ├── Operator supplies Razorpay TEST-mode credentials
  ├── Execute E9 real gateway dedup test on staging
  └── Capture evidence

Phase 7 — Documentation Hygiene
  ├── Update ENV_VAR_AUDIT.md (remove Firebase vars)
  ├── Update PRODUCTION_READINESS_GATE_REVIEW.md (remove Firebase references)
  ├── Recreate .env.example (Supabase-only)
  └── Update TRANSACTION_RETRY_INVARIANT.md §8.3 (item 4 DONE)

Phase 8 — Final Production Readiness Evidence Gate
  ├── All 7 AND-conditions verified
  └── FINAL GO / NO-GO
```

---

## 11. Explicit Blockers

| Blocker | Category | Blocks |
|--------|----------|-------|
| HB-5 (DR drill) | C | Cond #4 |
| HB-6 (rollback drill) | C | Cond #5 |
| HB-7 (production Supabase) | B | HB-8, HB-11, HB-12 |
| HB-8 (Vercel env vars) | B | Production deploy |
| HB-9 (Fly.io) | B | HB-14 |
| HB-10 (Razorpay keys) | B | realPayments activation |
| HB-13 (GitHub secrets) | B | HB-6 (rollback drill needs secrets) |
| HB-14 (outbox-publisher Fly.io) | B | realPayments activation |
| HB-15 items 1, 2, 5 | A | realPayments activation |
| Gateway E9 | External | Cond #3, M9/M10 retry-safety |

---

## 12. Recommended Next Directives

1. **`HB-15-IMPLEMENT-01`** — authorize ESLint rule + code-review checklist + CI gate (Class A — IDE work, ~200 LOC, no external dependency)
2. **`OPERATOR-INFRA-AUTHORIZATION-01`** — authorize operator provisioning wave (HB-7..HB-13 + HB-14) — Orchestrator decision to provision external infrastructure
3. **`DR-PREP-IMPLEMENT-01`** — authorize pg_dump rewrite + dr-drill.yml workflow authoring (Class A — IDE work, ~400 LOC)
4. **`GATEWAY-E9-CREDENTIAL-PROVISION-01`** — operator supplies Razorpay TEST-mode credentials (re-issue with credentials if available)

---

## 13. STOP State

- ✅ No application code changed
- ✅ No schema changed
- ✅ No migration executed
- ✅ No flag activated
- ✅ No deployment
- ✅ No Gateway E9 reopening
- ✅ No M9/M10 retry
- ✅ git working tree clean

### Canonical state:

```text
Wave-5 5C                     ✅ CLOSED
Firebase                      ✅ ELIMINATED
Supabase                      ✅ SOLE AUTH PLATFORM

Gateway Idempotency           ✅ IMPLEMENTED (immutable)
  E1-E8 evidence              ✅ PASS
  E9                          🔒 BLOCKED (external dependency)
  M9/M10                      🚫 PROHIBITED (4×)

P0-06                         ✅ CLOSED (immutable)
P0-07                         ✅ CLOSED (immutable)
I-13                          ✅ ENFORCED
Critical P0 path              ✅ COMPLETE

Production                    🚫 NOT AUTHORIZED
  4 of 7 launch-gate conditions PASS
  3 of 7 FAIL (Cond #3 E9, #4 DR, #5 rollback)
  10 of 15 HBs STILL FAIL
  1 of 15 HBs PARTIALLY RESOLVED (HB-15)

PRODUCTION-READINESS-READ-PLAN-FIRST  ✅ COMPLETE

IDE                           🛑 STOPPED
```

---

**End of Production Readiness READ/PLAN-FIRST gate review. IDE STOPPED.**
