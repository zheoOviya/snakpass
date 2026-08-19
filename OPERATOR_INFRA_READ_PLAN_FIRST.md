# Operator Infrastructure — READ/PLAN-FIRST Gate Review

> **Directive:** `OPERATOR-INFRA-READ-PLAN-FIRST-01`
> **Directive class:** READ/PLAN-FIRST governance gate (NO implementation authorized)
> **Date:** 2026-08-18
> **HEAD at review:** `5b0d374583db80f6d679e4b8221d9d467f150a1d` (HB-15 fully resolved)
> **Document type:** Gate review (operator dependency inventory + A/B/C/D matrix + DR/rollback gap + E9 + execution order)

---

## 1. Canonical Baseline

```text
Wave-5 5C                     ✅ CLOSED
Firebase                      ✅ ELIMINATED
Supabase                      ✅ SOLE AUTH PLATFORM
Gateway Idempotency           ✅ IMPLEMENTED (E1-E8 PASS, E9 BLOCKED)
P0-06                         ✅ CLOSED
P0-07                         ✅ CLOSED
I-13                          ✅ ENFORCED
HB-15                         ✅ FULLY RESOLVED (items 1,2,3,4,5 all done)
M9/M10                        🚫 PROHIBITED (4×)
All production flags          ✅ ALL 9 OFF
Production                    🚫 NOT AUTHORIZED
```

---

## 2. HB-7..HB-14 Matrix

| HB# | Objective | Status | Owner | External Dep | Credentials | Evidence Required | Reversible | Class |
|-----|-----------|--------|-------|-------------|-------------|-------------------|------------|-------|
| **HB-7** | Production Supabase project | ❌ FAILS | Operator | Supabase platform | Project ref + DB password | `psql SELECT current_user='snakzap_app'` + tamper-test.sh 5/5 | YES (drop project) | **B** |
| **HB-8** | Vercel production env vars | ❌ FAILS | Operator | Vercel platform | ~17 env vars (Firebase removed) | `/api/health` 200 + `/api/restaurants` 200 + `SELECT current_user='snakzap_app'` | YES (revert env) | **B** |
| **HB-9** | Fly.io mini-services | ❌ FAILS | Operator | Fly.io platform | Per-service env vars | `/health` 200 per service + `fly status` running | YES (destroy apps) | **B** |
| **HB-10** | Razorpay production keys | ❌ FAILS | Operator | Razorpay platform | RAZORPAY_KEY_ID + SECRET + WEBHOOK_SECRET | Webhook HMAC verify + dedup PASS | NO (irreversible — keys are permanent) | **B** |
| **HB-11** | Supabase Auth production config | ❌ FAILS | Operator | Supabase (comes with HB-7) | 5 Supabase env vars | `verifySupabaseToken()` returns uid+phone | YES (disable Auth) | **B** |
| **HB-12** | snakzap_app role + WORM REVOKE | ❌ FAILS | Operator | Production Supabase (after HB-7) | Postgres superuser | revoke-worm.sql verification + tamper-test.sh 5/5 | NO (DDL — forward-fix only) | **B** |
| **HB-13** | GitHub secrets + environments | ❌ FAILS | Operator | GitHub platform | VERCEL_TOKEN + ORG_ID + PROJECT_ID | deploy.yml end-to-end + rollback.yml reachable | YES (remove secrets/envs) | **B** |
| **HB-14** | outbox-publisher on Fly.io | ❌ FAILS | Operator | Fly.io (subset of HB-9) | Same as HB-9 | `/health` 200 + outbox PENDING→PUBLISHED | YES (destroy app) | **B** |

**Classification: ALL 8 are Class B (Operator-required).** Zero are Class A (IDE) or Class C (evidence/drill) or Class D (separate evidence-gate).

---

## 3. Supabase Production Requirements (HB-7 + HB-11 + HB-12)

### Ready to provision:
- ✅ `schema.prisma` provider = `postgresql` (already switched)
- ✅ All migration SQL scripts exist (`prisma/scripts/wave*.sql` + `p0-06-migration.sql`)
- ✅ `create-roles.sql` + `revoke-worm.sql` exist (DEV-001 closure)
- ✅ `seed-postgres.sql` exists
- ✅ Supabase client + admin client code exists (`src/lib/supabase.ts` + `src/lib/supabase-admin.ts`)
- ✅ 5 Supabase env vars documented

### Requires operator input:
- ❌ Separate production Supabase project (Option B — `ap-northeast-1`)
- ❌ Phone Auth provider enabled in Supabase dashboard
- ❌ SMS provider configured for IN (+91) numbers
- ❌ `snakzap_app` + `snakzap_admin` roles created
- ❌ WORM REVOKE applied to AuditLog
- ❌ All wave migrations executed on production DB

### Requires application change:
- ❌ `src/lib/realtime.ts:7` hardcodes `localhost:3003` — needs `process.env.REALTIME_URL` (SB-3 follow-up, NOT blocking production but blocks real-time features)

---

## 4. Vercel / Application Runtime (HB-8)

### Env vars required (post-Firebase elimination — ~17 vars):

| # | Env var | Scope | Source |
|---|---------|-------|--------|
| 1 | `NODE_ENV` | Runtime (auto-set by Vercel) | — |
| 2 | `DATABASE_URL` | Server-only | `postgresql://snakzap_app:<pw>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` |
| 3 | `SUPABASE_URL` | Server-only | `src/lib/supabase-admin.ts:12` |
| 4 | `SUPABASE_SECRET_KEY` | Server-only (SECRET) | `src/lib/supabase-admin.ts:13` |
| 5 | `SUPABASE_JWKS_URL` | Server-only | `src/lib/supabase-admin.ts:14` |
| 6 | `NEXT_PUBLIC_SUPABASE_URL` | Frontend | `src/lib/supabase.ts:8` |
| 7 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | `src/lib/supabase.ts:9` |
| 8 | `RAZORPAY_KEY_ID` | Server-only (HB-10) | `src/lib/razorpay.ts:24` |
| 9 | `RAZORPAY_KEY_SECRET` | Server-only (HB-10) | `src/lib/razorpay.ts:25` |
| 10 | `RAZORPAY_WEBHOOK_SECRET` | Server-only (HB-10) | `src/lib/razorpay.ts:453` |
| 11 | `FEATURE_REAL_PAYMENTS` | Flag (OFF until Phase 3) | `deployment.ts:27` |
| 12 | `FEATURE_PICKUP_ATTRIBUTION_ENFORCEMENT` | Flag (OFF until Phase 2) | `deployment.ts:30` |
| 13 | `FEATURE_WEBHOOK_HANDLER` | Flag (OFF until HB-10) | `deployment.ts:53` |
| 14 | `FEATURE_OUTBOX_PUBLISHER` | Flag (OFF until HB-14) | `deployment.ts:36` |
| 15 | `FEATURE_REQUEST_HASH_ENFORCEMENT` | Flag (low-risk) | `deployment.ts:47` |
| 16 | `FEATURE_CONCURRENCY_CONTROL` | Flag (low-risk) | `deployment.ts:39` |
| 17 | `FEATURE_RECONCILIATION_AUTO_REPAIR` | Flag (separate decision) | `deployment.ts:67` |
| 18 | `FEATURE_INVARIANT_CHECKER` | Flag (separate decision) | `deployment.ts:83` |

**Note:** `DIRECT_URL` MUST be EMPTY on Vercel (per ENV_VAR_AUDIT.md R-H3). Firebase env vars REMOVED (9 vars eliminated — commit 1890fed).

### Documentation STALE:
- `docs/ENV_VAR_AUDIT.md` still lists 9 Firebase env vars (lines 38-46) — needs cleanup
- `PRODUCTION_READINESS_GATE_REVIEW.md` body still references Firebase (lines 228, 448, 483, 754) — needs cleanup

---

## 5. Fly.io / Mini-Services (HB-9 + HB-14)

### All production mini-services:

| Service | Port | Required for | Deploy | Dockerfile? | fly.toml? |
|---------|------|-------------|--------|-------------|-----------|
| realtime | 3003 | Real-time order tracking | Fly.io `nrt` | ❌ (doc only) | ❌ |
| alert-evaluator | 3005 | P0-21 alert evaluation | Fly.io `nrt` | ❌ (doc only) | ❌ |
| outbox-publisher | 3009 | Payment capture/refund (HB-14) | Fly.io `nrt` | ❌ | ❌ |
| reconciliation | 3010 | M1-M17 detection | Fly.io `nrt` | ❌ | ❌ |
| invariant-checker | 3011 | M18-M21 + M22/M23 detection | Fly.io `nrt` | ❌ | ❌ |
| backup-scheduler | 3004 | DR backup (Phase-3, needs pg_dump rewrite) | Vercel Cron (preferred) | ❌ | N/A |

**Gap:** 0 Dockerfiles, 0 fly.toml files exist. Only "recommended shapes" in `docs/STATEFUL_SERVICES_HOSTING.md`.

### invariant-checker remains OFF:
- `FEATURE_INVARIANT_CHECKER` defaults OFF (`deployment.ts:83`)
- Service starts but does NOT run detectors when flag is OFF
- Activation requires separate Orchestrator authorization

---

## 6. Gateway E9 Dependency

**Status:** 🔒 BLOCKED — external/operator dependency

| Question | Answer |
|-----------|--------|
| What is needed? | Razorpay TEST-mode credentials (TEST API key ID + TEST API key secret) |
| Who supplies? | Operator |
| Independent of HB-7..HB-14? | YES — staging-only verification, can run in parallel |
| Blocks production? | Demo mode: NO. realPayments=true: YES (Cond #3 + M9/M10 retry-safety) |
| Verification procedure | (1) Configure TEST keys on staging; (2) `realPayments=true` staging only; (3) Capture with X-Idempotency-Key; (4) Force retry; (5) Verify dedup; (6) Verify single Payment/Ledger/Outbox; (7) Repeat for refund |
| Credentials invented? | NO — never |
| E9 PASS declared? | NO — remains BLOCKED |

---

## 7. GitHub / CI / Secrets (HB-13)

| Required | Status |
|----------|--------|
| `VERCEL_TOKEN` secret | ❌ NOT configured |
| `VERCEL_ORG_ID` secret | ❌ NOT configured |
| `VERCEL_PROJECT_ID` secret | ❌ NOT configured |
| `staging` environment (no protection) | ❌ NOT configured |
| `production` environment (required reviewers) | ❌ NOT configured |

**HB-13 is a prerequisite for HB-6 (rollback drill)** — workflows reference `${{ secrets.VERCEL_TOKEN }}` which would fail without configuration.

---

## 8. DR / Rollback Dependencies

### HB-5 (DR drill) — CANNOT run today:

| Prerequisite | Owner | Status |
|-------------|-------|--------|
| pg_dump rewrite | IDE (Class A) | ❌ NOT done — `backup.ts` still reads SQLite |
| Warm-standby Supabase | Operator (Class B) | ❌ NOT provisioned (3rd project beyond staging+prod) |
| `dr-drill.yml` workflow | IDE (Class A) | ❌ NOT created |
| Orchestrator authorization | Orchestrator | ❌ NOT granted |

### HB-6 (rollback drill) — CANNOT run today:

| Prerequisite | Owner | Status |
|-------------|-------|--------|
| HB-13 (GitHub secrets + environments) | Operator (Class B) | ❌ NOT configured |
| Production Vercel deployment (HB-8) | Operator (Class B) | ❌ NOT live |
| Orchestrator authorization | Orchestrator | ❌ NOT granted |
| `rollback.yml` workflow | IDE | ✅ AUTHORED (292 lines) |
| `staging-rollback-drill.yml` workflow | IDE | ✅ AUTHORED (241 lines) |

---

## 9. Final Classification Matrix

| HB# | Status | IDE | Operator | External Dep | Credentials | Evidence | Rollback | Class |
|-----|--------|-----|----------|-------------|-------------|----------|----------|-------|
| HB-5 | ❌ FAILS | pg_dump + dr-drill.yml | Warm-standby Supabase | — | — | Drill execution | Drop warm-standby | A+B+C |
| HB-6 | ❌ FAILS | — | HB-13 + HB-8 | — | GitHub secrets | Drill execution | Vercel redeploy | B+C |
| HB-7 | ❌ FAILS | — | Supabase project | Supabase | DB password | psql + tamper-test | Drop project | B |
| HB-8 | ❌ FAILS | — | Vercel env vars | Vercel | ~17 env vars | /api/health 200 | Revert env | B |
| HB-9 | ❌ FAILS | Dockerfiles (IDE) | Fly.io apps | Fly.io | Per-service env | /health 200 | Destroy apps | A+B |
| HB-10 | ❌ FAILS | — | Razorpay keys | Razorpay | 3 secrets | Webhook HMAC | Irreversible | B |
| HB-11 | ❌ FAILS | — | Supabase Auth config | Supabase (HB-7) | 5 env vars | verifySupabaseToken | Disable Auth | B |
| HB-12 | ❌ FAILS | — | snakzap_app + WORM | Supabase (HB-7) | Postgres superuser | revoke-worm.sql + tamper-test | Irreversible (DDL) | B |
| HB-13 | ❌ FAILS | — | GitHub secrets + envs | GitHub | 3 secrets | deploy.yml + rollback.yml | Remove secrets/envs | B |
| HB-14 | ❌ FAILS | — | outbox-publisher Fly.io | Fly.io (HB-9) | Same as HB-9 | /health + PENDING→PUBLISHED | Destroy app | B |
| E9 | 🔒 BLOCKED | — | Razorpay TEST creds | Razorpay (TEST) | 2 TEST keys | Dedup verification | N/A | C (external) |

**Summary:** 8 Class B (operator), 2 Class C (evidence/drill), 1 Class C-external (E9), 2 Class A sub-tasks within HB-5/HB-9 (pg_dump rewrite + Dockerfiles)

---

## 10. Proposed Execution Order

```text
Phase 1 — Operator Provisioning Wave (HB-7..HB-14) — ALL Class B, parallel-safe
  ├── HB-7:  Provision production Supabase project (ap-northeast-1)
  ├── HB-12: Apply create-roles.sql + revoke-worm.sql (after HB-7)
  ├── HB-8:  Configure Vercel production env vars (~17 vars, Firebase removed)
  ├── HB-11: Configure Supabase Auth (comes free with HB-7)
  ├── HB-13: Configure GitHub secrets + environments (staging + production)
  ├── HB-9:  Provision Fly.io apps (realtime + alert-evaluator + outbox-publisher + reconciliation + invariant-checker)
  │         └── IDE: Create Dockerfiles + fly.toml files (Class A sub-task)
  ├── HB-14: Deploy outbox-publisher as long-lived service (after HB-9)
  └── HB-10: Provision Razorpay production API keys + webhook secret

Phase 2 — IDE Repository Work (parallel with Phase 1)
  ├── pg_dump rewrite (backup.ts → pg_dump → Supabase Storage)
  ├── dr-drill.yml workflow authoring
  └── Documentation cleanup (ENV_VAR_AUDIT.md, PRODUCTION_READINESS_GATE_REVIEW.md, TRANSACTION_RETRY_INVARIANT.md §8.3)

Phase 3 — Gateway E9 (parallel with Phase 1 + 2)
  └── Operator supplies Razorpay TEST-mode credentials → staging E9 verification

Phase 4 — DR Drill (HB-5) — after Phase 1 (HB-7) + Phase 2 (pg_dump + dr-drill.yml)
  └── Execute controlled DR drill → evidence

Phase 5 — Rollback Drill (HB-6) — after Phase 1 (HB-13 + HB-8)
  ├── Execute staging-rollback-drill.yml formally
  └── Execute production rollback.yml (post-soft-launch)

Phase 6 — Final Production Readiness Evidence Gate
  ├── All 7 AND-conditions verified
  └── FINAL GO / NO-GO
```

### Items that must remain OFF:
- `realPayments` — OFF until ALL HBs resolved + E9 PASS
- `pickupAttributionEnforcement` — OFF until Phase-2 rollout
- `invariantChecker` — OFF until separate Orchestrator authorization
- `reconciliationAutoRepair` — OFF until separate Orchestrator authorization
- `webhookHandler` — OFF until HB-10 + Razorpay dashboard configured
- `outboxPublisher` — OFF until HB-14 deployed
- `drDrillMode` — NEVER in production traffic

### Explicit Production NO-GO conditions:
- ANY of HB-5..HB-14 unresolved
- E9 BLOCKED (Cond #3 fails)
- ANY production flag activated without authorization
- M9/M10 re-enqueue activated
- P0-06/P0-07 evidence invalidated

---

## 11. Governance Decision

**Verdict: CONDITIONAL GO** — the operator infrastructure plan is complete and executable.

The plan covers all 8 remaining hard blockers (HB-7..HB-14, all Class B operator tasks), 2 evidence/drill gates (HB-5, HB-6, Class C), and 1 external dependency (Gateway E9, Class C-external). The execution order is dependency-ordered with clear prerequisites.

### Recommended next directive:

**`OPERATOR-INFRA-AUTHORIZATION-01`** — authorize operator provisioning of HB-7..HB-14 (Phase 1) + parallel IDE work (pg_dump rewrite + Dockerfiles + documentation cleanup, Phase 2) + Gateway E9 credential provision (Phase 3, parallel).

---

## 12. STOP State

- ✅ No application code changed
- ✅ No schema changed
- ✅ No migration executed
- ✅ No flag activated
- ✅ No deployment
- ✅ No Gateway E9 reopening
- ✅ No M9/M10 retry
- ✅ No credential creation
- ✅ git working tree clean

### Canonical state:

```text
Wave-5 5C                     ✅ CLOSED
Firebase                      ✅ ELIMINATED
Supabase                      ✅ SOLE AUTH PLATFORM
Gateway Idempotency           ✅ IMPLEMENTED (E1-E8 PASS, E9 BLOCKED)
P0-06                         ✅ CLOSED
P0-07                         ✅ CLOSED
I-13                          ✅ ENFORCED
HB-15                         ✅ FULLY RESOLVED
Critical P0 path              ✅ COMPLETE

Production                    🚫 NOT AUTHORIZED
  4 of 7 launch-gate conditions PASS
  3 of 7 FAIL (Cond #3 E9, #4 DR, #5 rollback)
  8 of 15 HBs STILL FAIL (all Class B operator tasks)
  2 of 15 HBs STILL FAIL (Class C evidence/drill)

OPERATOR-INFRA-READ-PLAN-FIRST  ✅ COMPLETE (CONDITIONAL GO)

IDE                           🛑 STOPPED
```

---

**End of Operator Infrastructure READ/PLAN-FIRST gate review. IDE STOPPED.**
