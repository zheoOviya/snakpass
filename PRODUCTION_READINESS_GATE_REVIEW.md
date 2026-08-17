# Production Readiness Gate Review

**Status:** 🟡 READ/PLAN-FIRST GATE REVIEW (Implementation NOT authorized)
**Date:** 2026-08-16
**Task ID:** `prod-readiness-gate-review`
**Reviewer:** Software Architect / Gate Reviewer
**Wave:** Post-Wave-4 Production Readiness Assessment

**Predecessor:** Wave-0 → Wave-1 → Wave-2 → Wave-3 → Wave-4 — **ALL CLOSED**.
- Wave-0 ✅ CLOSED (foundation, observability, auth)
- Wave-1 ✅ CLOSED (concurrency, idempotency, DR design, unknown-exception)
- Wave-2 ✅ CLOSED (transactional outbox P0-24)
- Wave-3 ✅ COMPLETE / CLOSED (3a P0-01 capture, 3b P0-08 idempotency, 3c requestHash)
- Wave-4 ✅ COMPLETE / ALL SUB-WAVES CLOSED (4a P0-05 webhook, 4b P0-02 ledger, 4c retry-invariant mitigation, 4d orphan_business_count)

> **Orchestrator Authorization (verbatim):** Production Readiness / Launch Gate — READ/PLAN-FIRST Review ONLY. NO implementation authorization. NO schema/migration. NO production deployment. NO flag enablement. NO real payment activation. NO new production tests that modify state. NO Wave-5 implementation. NO Wave-4 reopening.
>
> Produce `PRODUCTION_READINESS_GATE_REVIEW.md`. STOP after Gate Review.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State (Wave-0 through Wave-4)](#2-current-state-wave-0-through-wave-4)
3. [P0 Inventory Status](#3-p0-inventory-status)
4. [Production Readiness Gaps](#4-production-readiness-gaps)
5. [Risk Assessment](#5-risk-assessment)
6. [Production Authorization Conditions](#6-production-authorization-conditions)
7. [Feature Flag Rollout Plan](#7-feature-flag-rollout-plan)
8. [External Service Dependencies](#8-external-service-dependencies)
9. [Decision Points for Orchestrator](#9-decision-points-for-orchestrator)
10. [Recommendation](#10-recommendation)
11. [Governance Compliance](#11-governance-compliance)

---

## 1. Executive Summary

Wave-0 through Wave-4 closed **24 of 28 P0 capabilities** (including the cross-cutting `TRANSACTION_RETRY_INVARIANT` mitigation and the `orphan_business_count` defect fix). Repository-local preparation is COMPLETE: PostgreSQL schema applied to staging Supabase (`zmzqqcyapcezmaqvuzzd`), `snakzap_app` + `snakzap_admin` roles created, WORM boundary enforced, Vercel/`vercel.json` configured, deployment workflows (`deploy.yml`, `rollback.yml`) + smoke tests + DR runbook all authored. All Wave-4 code paths are feature-flagged OFF in production per governance.

**However, production authorization is NOT yet possible.** Four P0s on the critical path remain LOCKED (P0-04 Refund, P0-03 Reconciliation, P0-06 State Separation, P0-07 State Machine + Pickup Attribution). Two of the seven launch-gate AND-conditions fail today (no DR drill executed, no rollback drill executed). All production infrastructure remains UNPROVISIONED (no production Supabase project, no production Vercel environment, no Fly.io services, no production env vars). All three "money-mode" feature flags (`realPayments`, `webhookHandler`, `requestHashEnforcement`) are correctly OFF — and cannot be safely enabled until P0-04 (refund) closes, because there is currently no in-system mechanism to refund an accidental double-charge.

**Recommendation: NOT READY.** Production launch is structurally blocked by 4 LOCKED P0s + 2 unexecuted drills + complete absence of production infrastructure provisioning. Even after Wave-7 closes the critical path, a substantial operator-provisioning + drill-execution phase remains before authorization. Wave-5 (P0-04 + P0-03) should be the next authorized wave.

---

## 2. Current State (Wave-0 through Wave-4)

### 2.1 What's been accomplished

| Wave | P0s Closed | Sub-Waves | Evidence Pattern | Status |
|------|-----------|-----------|------------------|--------|
| Wave-0 | P0-09, P0-12, P0-13, P0-14, P0-15, P0-16, P0-19, P0-20, P0-21, P0-22, P0-23, P0-27 | (single wave, 12 P0s + P0-27 parallel-isolated) | audit hash chain, kill switch, Firebase verify, migrations, backup design, structured logging, health, alerts, Zod, rate-limit, CSRF, deploy/rollback classes | ✅ CLOSED |
| Wave-1 | P0-10, P0-11, P0-17, P0-25, P0-26 (design), P0-28 | 1a/1b/1c | sessions, OTP lockout, idempotency, concurrency (3 cases), DR design + runbook, 3-blast-radius freeze | ✅ CLOSED |
| Wave-2 | P0-24 | 2a/2b/2c/2d | transactional outbox + publisher + exception queue + reconciliation evidence; orphan_business_count defect documented | ✅ CLOSED |
| Wave-3 | P0-01, P0-08 | 3a/3b/3c | Razorpay capture (demo mode), order idempotency, requestHash enforcement (default OFF) | ✅ CLOSED |
| Wave-4 | P0-02, P0-05 + retry-invariant mitigation + orphan_business_count fix | 4a/4b/4c/4d | webhook HMAC + dedup, ledger double-entry balance integrity, capture moved to publisher, alert-evaluator timestamp filter | ✅ ALL SUB-WAVES CLOSED |

**Total P0s at S5 PASS / CLOSED:** 24 of 28.
**P0s LOCKED (Wave-5/6/7):** P0-04 (Refund), P0-03 (Reconciliation), P0-06 (State Separation), P0-07 (State Machine + Pickup Attribution).
**P0s at PARTIAL:** P0-26 (DR runbook designed; drill NOT executed — Phase-3 launch-gate item).

### 2.2 Evidence pattern (established & reusable)

- **SQLite evidence runner** (`scripts/waveN-x-evidence.mjs`) → emits self-validating JSON with `ok: true/false`.
- **PostgreSQL-native concurrency evidence** via GitHub Actions (each sub-wave has its own workflow `.github/workflows/subwave-Nx-postgresql-concurrent-evidence.yml`).
- **Staging migrations** applied via `.github/workflows/waveN-Nx-staging-migration.yml` against Supabase staging project `zmzqqcyapcezmaqvuzzd`.
- **Feature flags** toggled ON on staging Vercel preview only (via `EVIDENCE_TEST_MODE=true` + `FEATURE_*` env vars) — never on production.
- All Wave-3 + Wave-4 sub-waves have PostgreSQL concurrency evidence with `database: "postgresql"`, `concurrentRequests: 5`, `ok: true`.

### 2.3 Final governance state (as of Wave-4 closure)

```text
Wave-0        ✅ CLOSED
Wave-1        ✅ CLOSED
Wave-2        ✅ CLOSED
Wave-3        ✅ COMPLETE / CLOSED (3a + 3b + 3c)
Wave-4        ✅ COMPLETE / ALL SUB-WAVES CLOSED (4a + 4b + 4c + 4d)

Production               🚫 NOT AUTHORIZED
realPayments             🚫 OFF (default false)
webhookHandler           🚫 OFF in production
requestHashEnforcement   🚫 OFF in production
Wave-5                   🔒 LOCKED
```

### 2.4 Wave-4 closure ≠ production authorization

Per the Orchestrator's governance model and `WAVE4_GATE_REVIEW.md` §9.5 ("Is Wave-4 the final wave before production authorization? **NO.**"), Wave-4 closure is a P0-completion milestone, not a launch authorization. Four P0s remain on the critical path (P0-04 → P0-03 → P0-06 → P0-07) plus the operator-provisioning + drill-execution phase. The launch gate (`PRODUCTION_READINESS_MATRIX.md` §14.1 — 7 AND-conditions) cannot be satisfied today.

---

## 3. P0 Inventory Status

### 3.1 P0s at S5 PASS / CLOSED (24 of 28)

| Wave | P0 | Capability | Notes |
|------|----|------------|-------|
| Wave-0 | P0-15 | Database migrations | `db:push` disabled; `prisma/migrations/*` + DEV-001 SQL applied to staging |
| Wave-0 | P0-22 | Audit trail integrity (WORM) | DEV-001 closure; tamper trigger + REVOKE UPDATE/DELETE/TRUNCATE on `AuditLog` from `snakzap_app` |
| Wave-0 | P0-23 | Kill switch fail-safe | Storage recovers; toggle verified |
| Wave-0 | P0-09 | Firebase ID token verify | `jose` + JWKS cached on function instance |
| Wave-0 | P0-16 | Backup | **DESIGN ONLY** — SQLite file-copy in dev; `pg_dump` rewrite is Phase-3 (BLOCKER #10 in INFRASTRUCTURE_READINESS.md) |
| Wave-0 | P0-19 | Structured logging | JSON to stdout (works on Vercel) |
| Wave-0 | P0-20 | Health + metrics | `/api/health` endpoint |
| Wave-0 | P0-21 | Alerting | 13 alert rules; **alert-evaluator NOT deployed to Fly.io** (Phase-3 BLOCKER #9) |
| Wave-0 | P0-12 | Zod input validation | Per-route |
| Wave-0 | P0-13 | Rate limiting | In-memory fallback; **Redis NOT provisioned** (in-memory limiter not cross-instance) |
| Wave-0 | P0-14 | CSRF protection | Double-submit cookie; `secure: NODE_ENV==='production'` |
| Wave-0 | P0-27 | Deployment & rollback (3 classes) | Workflows authored (`deploy.yml`, `rollback.yml`); **rollback drill NOT executed** (launch-gate #5 fails) |
| Wave-1 | P0-25 | Concurrency + version fields | Optimistic locking + atomic decrements |
| Wave-1 | P0-17 | Idempotency (critical writes) | `IdempotencyKey` model + library |
| Wave-1 | P0-26 | Disaster recovery (business recovery) | **DESIGN ONLY** — runbook authored (`docs/DR_RUNBOOK.md`); **drill NOT executed** (launch-gate #4 fails) |
| Wave-1 | P0-28 | Unknown-exception handling | 3-level freeze + exception queue |
| Wave-1 | P0-10 | Session integrity | Session model + revoke |
| Wave-1 | P0-11 | OTP retry limits | 5-attempt lockout, 10-min expiry |
| Wave-2 | P0-24 | Transactional data integrity (outbox) | `Outbox` model + `enqueueOutboxEvent()` + publisher mini-service |
| Wave-3 | P0-01 | Razorpay capture | Demo mode (`realPayments=false`); capture moved to publisher (Wave-4 4c) |
| Wave-3 | P0-08 | Order idempotency | Same-txn check+store; retry-storm proven |
| Wave-4 | P0-02 | Payment ledger (double-entry) | Dr/Cr pairs atomic with capture; balance integrity proven on PostgreSQL |
| Wave-4 | P0-05 | Webhook integrity (HMAC + idempotent) | `WebhookEvent.eventId` unique dedup; constant-time HMAC verify |

### 3.2 P0s LOCKED — NOT YET IMPLEMENTED (4 of 28) — ALL ON CRITICAL PATH

| P0 | Capability | Wave | Tier | Why locked | Impact if launched without |
|----|-----------|------|------|-----------|----------------------------|
| **P0-04** | Refund flow (full + partial) | Wave-5 | Tier 1 (HIGHEST) | Razorpay refund API + lifecycle + ledger interaction not implemented. Payment.status has `REFUNDED` enum (Wave-3a schema only). | No in-system mechanism to refund a customer. Any payment dispute becomes a manual Razorpay-dashboard operation. **CRITICAL: blocks `realPayments=true` enablement** because accidental double-charges cannot be refunded in-system. |
| **P0-03** | Payment reconciliation (gateway ↔ ledger) | Wave-5 | Tier 3 (MEDIUM) | No scheduled job, no report stub, no mismatch-detection logic. | Gateway ↔ DB drift undetected. Captured-but-DB-pending state (the known real-mode hazard in `TRANSACTION_RETRY_INVARIANT.md` §4.2) has no automatic recovery. |
| **P0-06** | Order state separation (Order/Payment/Fulfilment/Refund) | Wave-6 | Tier 2 (HIGH) | Depends on P0-04 + P0-05. State-transition matrix not implemented. | Order cancelled but payment captured → no exception-queue detection. Inconsistent combos cannot be caught. |
| **P0-07** | Order state machine hardening + pickup attribution (8 conditions for PICKED_UP) | Wave-7 (critical-path terminus) | Tier 1 (HIGHEST) | Depends on P0-06. QR + OTP pickup verification + immutable audit event not implemented. | Wrong customer could pick up wrong order. I-13 (Pickup/Handoff Integrity) not enforced. |

**P0-07 fully owns I-13 (Pickup/Handoff Integrity)** per Production Readiness Matrix v1.4 G-B1 resolution — no separate P0-29 exists. Until P0-07 closes, I-13 is unprotected by a P0 (only the P0-28 backstop applies).

### 3.3 P0s at PARTIAL state (1 of 28 — not launch-blocking per se, but its drill is)

| P0 | Capability | What's done | What's missing |
|----|-----------|-------------|----------------|
| P0-26 | Disaster recovery | DR architecture + backup/restore runbook + post-restore reconciliation procedure documented (`docs/DR_RUNBOOK.md`). | **DR drill NOT executed** (Phase-3 launch gate, condition #4). `pg_dump` backup mechanism not implemented (SQLite file-copy in current code; `backup-scheduler` mini-service returns 500 on Vercel — needs Phase-3 rewrite). Warm-standby Supabase project NOT provisioned. |

### 3.4 Invariant coverage (I-01..I-14)

| Invariant | Direct Protectors | Status |
|-----------|-------------------|--------|
| I-01 Payment Integrity | P0-01 ✅, P0-03 🔒, P0-05 ✅, P0-06 🔒, P0-24 ✅, P0-26 (partial), P0-28 ✅ | 2 P0 protectors LOCKED |
| I-02 Order Integrity | P0-06 🔒, P0-07 🔒, P0-08 ✅, P0-24 ✅, P0-25 ✅, P0-26 (partial), P0-28 ✅ | 2 P0 protectors LOCKED (state machine + state separation) |
| I-03 Refund Integrity | P0-04 🔒, P0-28 ✅ | **1 of 2 protectors LOCKED — weakest invariant** |
| I-04 Capture Uniqueness | P0-01 ✅, P0-05 ✅, P0-17 ✅, P0-25 ✅, P0-28 ✅ | ✅ All CLOSED |
| I-05 Item-Order Consistency | P0-24 ✅, P0-25 ✅, P0-28 ✅ | ✅ All CLOSED |
| I-06 Ledger Balance | P0-02 ✅, P0-03 🔒, P0-04 🔒, P0-24 ✅, P0-26 (partial), P0-28 ✅ | 2 P0 protectors LOCKED |
| I-07 Audit Integrity | P0-22 ✅, P0-26 (partial), P0-28 ✅ | ✅ All CLOSED (P0-26 partial: hash-chain tamper-evidence has known weakness — true WORM prevention needs production storage layer) |
| I-08 Fulfilment Authorization | P0-06 🔒, P0-07 🔒, P0-25 ✅, P0-28 ✅ | 2 P0 protectors LOCKED |
| I-09 Kill-Switch Monotonicity | P0-23 ✅, P0-28 ✅ | ✅ All CLOSED |
| I-10 Transactional Completeness | P0-02 ✅, P0-08 ✅, P0-17 ✅, P0-24 ✅, P0-25 ✅, P0-26 (partial), P0-28 ✅ | ✅ All CLOSED |
| I-11 Refund Precondition | P0-04 🔒, P0-28 ✅ | **1 of 2 protectors LOCKED — weakest invariant** |
| I-12 Session Revocation | P0-09 ✅, P0-10 ✅, P0-11 ✅, P0-28 ✅ | ✅ All CLOSED |
| I-13 Pickup / Handoff Integrity | P0-07 🔒 (fully owned), P0-28 ✅ (backstop) | **P0-07 LOCKED — I-13 NOT YET ENFORCED by a P0** |
| I-14 Vendor Operational Integrity | P0-28 ✅ (backstop only); primary protector = P1 busy-mode | ⚠️ Documented P1-protected exception (not a launch-blocking financial/security invariant) |

**Coverage verdict:** Launch-gate condition #2 ("All P0 invariants verified") **FAILS** today — I-03, I-06, I-08, I-11, I-13 all have LOCKED direct protectors (P0-04, P0-06, P0-07) and cannot be empirically verified.

---

## 4. Production Readiness Gaps

### 4.1 Database

| Item | Status | Evidence |
|------|--------|----------|
| Production DATABASE_URL configured | 🚫 NOT READY | Only staging Supabase project `zmzqqcyapcezmaqvuzzd` exists. Production Supabase project NOT provisioned. `docs/STAGING_ARCHITECTURE.md` §2.3 recommends Option B (separate production project) for Phase-3 launch. |
| Production DB role `snakzap_app` (not `postgres` superuser) | 🟡 PARTIALLY READY | Roles created in staging via `prisma/scripts/create-roles.sql`. Production DB does not yet exist → roles not yet applied to production. The role-named pooler connection string (`postgresql://snakzap_app:<app-password>@aws-0-<region>.pooler.supabase.com:6543/...`) MUST be used — NOT `postgres.<project-ref>` (which bypasses WORM). |
| All migrations applied to production | 🚫 NOT READY | `prisma/scripts/postgres-migration.sql` + `create-roles.sql` + `revoke-worm.sql` + `seed-postgres.sql` + Wave-1/2/3/4 sub-wave migrations (1a, 1b, 2a, 2b, 3a, 3c, 4a) — all applied to STAGING only. Production migrations BLOCKED on production Supabase provisioning. |
| Outbox publisher deployed and running in production | 🚫 NOT READY | `mini-services/outbox-publisher/index.ts` exists (with `PAYMENT_CAPTURE_REQUESTED` capture handler from Wave-4 4c Phase 2). NOT deployed as a long-running service. Vercel serverless cannot host it (long-lived process + lease-based claim loop). Needs Fly.io. Without it, `Payment` rows stay in `CAPTURE_PENDING` indefinitely (acceptable for demo mode; **`realPayments=true` MUST NOT be enabled**). |
| WORM boundary on `AuditLog` enforced at runtime | ✅ Ready (on staging) | DEV-001 closure: `revoke-worm.sql` + tamper triggers applied to staging. Will be re-applied to production when production DB is provisioned. |
| `snakzap_admin` migration runner role + `DIRECT_URL` Session Pooler (port 5432) | 🟡 PARTIALLY READY | Role + workflow (`dev-001-sql-execution.yml`) exist. Production `DIRECT_URL` not configured (must be EMPTY on Vercel env; populated only on GitHub Actions runner). |
| `provider = "postgresql"` in `schema.prisma` | ✅ DONE | `prisma/schema.prisma:14` confirmed `provider = "postgresql"`. Phase-3 prerequisite #8 from `WAVE4_GATE_REVIEW.md` closed. |

### 4.2 Feature Flags (all currently OFF in production)

Source: `src/lib/deployment.ts` (lines 25–54). All defaults to `false`; env var override pattern `FEATURE_<KEY>`.

| Flag | Default | Production State | Required for | Rollout dependency |
|------|---------|------------------|--------------|---------------------|
| `realPayments` | OFF | 🚫 OFF | Real Razorpay API calls (capture, order create) | **BLOCKED on P0-04 (refund) closure** — accidental double-charges cannot be refunded in-system until Wave-5. |
| `pickupAttributionEnforcement` | OFF | 🚫 OFF | QR + OTP pickup verification (P0-07 8 conditions) | **BLOCKED on P0-07 (Wave-7) closure** — flag exists but underlying logic not implemented. |
| `drDrillMode` | OFF | 🚫 OFF | DR drill execution (P0-26) | BLOCKED on operator-provisioned warm-standby Supabase + `pg_dump` rewrite (Phase-3). |
| `outboxPublisher` | OFF | 🚫 OFF | Outbox event delivery via Socket.io + Razorpay capture via publisher | Infrastructure-ready (Wave-2b + Wave-4 4c Phase 2); deployment to Fly.io NOT done. Required for `realPayments=true`. |
| `concurrencyControl` | OFF | 🚫 OFF | Optimistic-lock enforcement (P0-25) | Already implemented in code (Wave-1); enablement is operator/Orchestrator decision. |
| `requestHashEnforcement` | OFF | 🚫 OFF | 422 on idempotency-key reuse with different body | Implemented (Wave-3 3c); staging-only evidence passed; production enablement is separate Orchestrator decision. Low-risk to enable. |
| `webhookHandler` | OFF | 🚫 OFF | Receiving real Razorpay webhooks | Implemented (Wave-4 4a); **production enablement requires `RAZORPAY_WEBHOOK_SECRET` env var** (not provisioned) + Orchestrator authorization. Wave-4 4a Gate Review recommends deferring production enablement until after Wave-5 reconciliation (P0-03) closes. |

**All 7 flags correctly OFF.** No flag can be safely enabled until its rollout dependency is satisfied.

### 4.3 P0 items — open vs closed

(See §3 above for full table.)

**Summary:**
- ✅ 24 of 28 P0s at S5 PASS / CLOSED.
- 🔒 4 of 28 P0s LOCKED (P0-04, P0-03, P0-06, P0-07) — all on critical path, all in upcoming waves (5/6/7).
- 🟡 1 of 28 at PARTIAL (P0-26 DR runbook designed; drill NOT executed).
- 🔴 Launch-gate AND-condition #1 ("All P0s at Production-ready") FAILS.
- 🔴 Launch-gate AND-condition #2 ("All P0 invariants verified") FAILS — I-03, I-06, I-08, I-11, I-13 have LOCKED direct protectors.

### 4.4 External services

| Service | Provisioned for Production? | Notes |
|---------|------------------------------|-------|
| Razorpay (real-mode API) | 🚫 NOT PROVISIONED | `razorpay` SDK v2.9.8 installed. Test keys NOT configured (Wave-4 4a D7 decision was NO — demo mode for staging evidence). Production keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) NOT provisioned. Razorpay dashboard webhook URL NOT configured. |
| Supabase (production project) | 🚫 NOT PROVISIONED | Staging project `zmzqqcyapcezmaqvuzzd` exists in `ap-northeast-1`. Per `docs/STAGING_ARCHITECTURE.md` §2.3, **production requires a SEPARATE Supabase project** (Option B) for isolation + DEV-001 WORM boundary per environment. |
| Vercel (production environment) | 🟡 PARTIALLY READY | `vercel.json` configured (region `hnd1` Tokyo, function maxDurations, security headers). GitHub repo linked (deploy.yml expects `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` secrets). **Production env vars NOT configured** (Blockers #7, #8 in INFRASTRUCTURE_READINESS.md). Vercel tier (Hobby vs Pro) UNVERIFIED — Hobby caps function `maxDuration` to 10s (the `/api/backup` route at 30s would be rejected — Blocker A5). |
| Realtime service (Fly.io) | 🚫 NOT DEPLOYED | `mini-services/realtime/index.ts` exists (port 3003, socket.io Server). Currently runs only in local sandbox. `src/lib/realtime.ts:7` hard-codes `http://localhost:3003` — needs `process.env.REALTIME_URL` refactor (Phase-3 follow-up #11/A2). Without it, browser real-time updates silently degrade (API routes still succeed). |
| Alert-evaluator (Fly.io) | 🚫 NOT DEPLOYED | `mini-services/alert-evaluator/index.ts` exists (port 3005, long-lived `setInterval` evaluating 13 alert rules incl. `orphan_business_count` fixed in Wave-4 4d). Production-compatible if `DATABASE_URL` = Supabase pooler. Not a smoke-test dependency (Phase-3 BLOCKER #9). |
| Outbox-publisher (Fly.io) | 🚫 NOT DEPLOYED | `mini-services/outbox-publisher/index.ts` exists with Wave-4 4c Phase 2 capture handler. Long-lived process (lease-based atomic claim loop). Needs Fly.io (or equivalent long-running host). Without it, `PAYMENT_CAPTURE_REQUESTED` events are never consumed → `Payment` stays in `CAPTURE_PENDING` (acceptable in demo mode; blocks `realPayments=true`). |
| Backup-scheduler | 🚫 NOT DEPLOYED (and needs rewrite) | `mini-services/backup-scheduler/index.ts` uses SQLite file-copy logic — references `db/custom.db` which does NOT exist in PostgreSQL deployment. Phase-3 rewrite needed (`pg_dump` → Supabase Storage bucket `snakzap-backups`). Blocker #10 in INFRASTRUCTURE_READINESS.md. |
| Firebase (Admin SDK) | 🚫 NOT PROVISIONED | `firebase-admin` v14.2.0 + `firebase` v12.17.1 installed. `FIREBASE_SERVICE_ACCOUNT_JSON` env var NOT configured. In `NODE_ENV=production`, `firebase-admin.ts` HARD-FAILS on any token verification attempt (fail-closed) — staging must either skip Firebase auth paths OR configure the service account. |
| Supabase Storage bucket (`snakzap-backups`) | 🚫 NOT PROVISIONED | Required by Phase-3 `pg_dump` rewrite (DR_RUNBOOK.md §3.2). |
| GitHub repo secrets | 🚫 NOT VERIFIED | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` needed by `deploy.yml`. NOT verified present (INFRASTRUCTURE_READINESS.md Blocker #3 — Orchestrator-only check). |
| GitHub environments (`staging`, `production`) | 🚫 NOT CONFIGURED | `deploy.yml` requires `staging` (no protection) + `production` (required reviewers) GitHub environments. Blockers #4, #5. |

### 4.5 Security

| Control | Implemented? | Production-Ready? | Notes |
|---------|--------------|-------------------|-------|
| CSRF protection (double-submit cookie) | ✅ | ✅ | `secure: NODE_ENV==='production'` (Vercel preview auto-sets). `src/lib/csrf.ts`. `/api/webhooks/` route is exempted (HMAC is its auth mechanism — Wave-4 4a). |
| Rate limiting (fail-closed for auth/payment/admin-write) | ✅ (in-memory) | 🟡 PARTIAL | `src/lib/rate-limit.ts` uses in-memory `Map`. On Vercel serverless, each function invocation has its own in-memory store → limits NOT enforced across instances. Production needs Redis (not provisioned). Fail-closed mode means auth/payment/admin-write paths return 503 if limiter "unavailable" — on Vercel this never triggers because the in-memory store is always available per-invocation, but the limit is effectively per-instance. **Cross-instance burst protection NOT present.** |
| Session management (refresh, revoke, active sessions) | ✅ | ✅ | `Session` model + `src/lib/session.ts`. Cookie `Secure; HttpOnly; SameSite=Lax` in production. |
| OTP service (Firebase phone auth) | ✅ (code) | 🟡 PARTIAL | `src/lib/otp-service.ts` + `firebase-admin.ts`. Code present. `FIREBASE_SERVICE_ACCOUNT_JSON` NOT provisioned → phone OTP returns 500 in production (fail-closed by design). |
| `admin-login.tsx` hard-coded default password `'admin123'` | ⚠️ HYGIENE | 🟡 NOT READY | `src/components/snak/admin-login.tsx:16` defaults password field. Server-side `verifyPassword()` is still enforced (NOT a security issue). Phase-3 cleanup (INFRASTRUCTURE_READINESS.md Blocker A3). |
| WORM boundary on `AuditLog` | ✅ (staging) | 🟡 PARTIAL | `revoke-worm.sql` + plpgsql triggers. Applied to staging; production application requires production DB provisioning. Hash-chain tamper-evidence has known weakness (true PREVENTION needs production WORM storage — `src/lib/audit.ts` documents this). |
| `vercel.json` security headers | ✅ | ✅ | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`. |
| Realtime CORS | 🟡 NOT HARDENED | 🟡 NOT READY | `mini-services/realtime/index.ts:28` allows `origin: '*'`. Phase-3 hardening needed (INFRASTRUCTURE_READINESS.md Blocker A1). Acceptable for staging. |

### 4.6 Infrastructure (mini-services)

| Service | Deployed? | Where | Blocker |
|---------|-----------|-------|---------|
| Next.js app | 🟡 Staging only | Vercel preview (`snakpass-*.vercel.app`) | Production env not configured |
| `realtime` (3003) | 🚫 NOT DEPLOYED | (Fly.io `nrt` Tokyo recommended) | `REALTIME_URL` hard-coded refactor + Fly.io provisioning |
| `alert-evaluator` (3005) | 🚫 NOT DEPLOYED | (Fly.io `nrt` Tokyo recommended) | Fly.io provisioning; not smoke-test-blocking |
| `outbox-publisher` | 🚫 NOT DEPLOYED | (Fly.io `nrt` Tokyo recommended) | Fly.io provisioning; **REQUIRED before `realPayments=true`** |
| `backup-scheduler` (3004) | 🚫 NOT DEPLOYED + NEEDS REWRITE | (replace with Vercel Cron + `pg_dump` to Supabase Storage) | Phase-3 rewrite; `pg_dump` to Storage bucket |
| `consumer-portal` (3006) | N/A — RETIRE | Vercel handles routing natively | Phase-3 retirement (cosmetic) |
| `vendor-portal` (3007) | N/A — RETIRE | Vercel handles routing natively | Phase-3 retirement (cosmetic) |
| `admin-portal` (3008) | N/A — RETIRE | Vercel handles routing natively | Phase-3 retirement (cosmetic) |

**Production environment variables** (per `docs/ENV_VAR_AUDIT.md`):
- 🚫 Not configured on Vercel production environment.
- 26 env vars total documented; 8 staging-blocking (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `LOG_LEVEL`, plus `FEATURE_*` defaults).
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `DIRECT_URL` (empty on Vercel; only on GitHub Actions runner) — all NOT configured.

### 4.7 Testing

| Test type | Status | Notes |
|-----------|--------|-------|
| Smoke tests (4 endpoints) | ✅ Script exists | `scripts/smoke-test.sh` tests `/api/health`, `/api/auth/me`, `/api/restaurants`, `/api/kill-switches`. Frozen file. Verified locally (exits 1 on unreachable URL). |
| Smoke tests on staging | 🟡 ASSUMED PASSING | Per `WAVE4_EVIDENCE.md` §4a "schema/env restored to production state", staging migrations applied + smoke-tested as part of Wave-3/4 evidence runs. NOT independently re-verified by this Gate Review (read-only constraint). |
| Smoke tests on production | 🚫 NOT RUN | Production not deployed. |
| Pre-production checklist | ✅ EXISTS | `docs/STAGING_ARCHITECTURE.md` §3.4 (M-1 through M-6 manual checks) + §6 (S-1 through S-14 staging readiness checklist). S-11 (rollback drill), S-12 (realtime Fly.io), S-13 (alert-evaluator Fly.io), S-14 (backup-scheduler rewrite) DEFERRED to Phase-3. |
| Load tests | 🚫 NOT EXIST | No load-test scripts in repo. Not part of any wave's evidence. Acceptable for staging; **likely required before production launch traffic ramp**. |
| Wave evidence (SQLite + PostgreSQL) | ✅ ALL PASS | Each Wave-1/2/3/4 sub-wave has SQLite evidence + PostgreSQL concurrency evidence with `ok: true`. See `evidence/wave*/` directory. |
| Failure-injection tests | ✅ STRUCTURAL PASS | Per P0_TRACEABILITY_MAP.md Query C — all 28 P0s have test criteria defined. Wave-0..4 P0s have evidence; Wave-5/6/7 P0s (P0-04, P0-03, P0-06, P0-07) have criteria defined but NOT exercised. |
| Manual checks M-1..M-6 | 🟡 PARTIAL | M-1 (DB connection) likely OK on staging. M-2/M-3 (WORM boundary) verified by DEV-001 closure on staging. M-4 (cookie security) auto-enforced by `NODE_ENV=production`. M-5 (CSRF) auto-enforced by middleware. M-6 (build artifact) verified per Wave-3/4 evidence runs. |

### 4.8 Monitoring + Alerting

| Component | Status | Notes |
|-----------|--------|-------|
| Alert rules (13) | ✅ DEFINED | `src/lib/alerting.ts` + `mini-services/alert-evaluator/index.ts` — 13 rules including `payment-success-rate`, `invariant-violation`, `db-unavailable`, `orphan_business_count` (fixed Wave-4 4d), `unknown-state-detected`, `exception-queue-backlog`. |
| Alert evaluator deployed | 🚫 NOT DEPLOYED | Alert-evaluator mini-service NOT deployed to Fly.io. Alerts can be triggered on-demand via `GET /api/alerts/evaluate` (serverless) but NOT on a schedule. Production needs the long-lived evaluator. |
| Logging (structured JSON to stdout) | ✅ READY | `src/lib/logger.ts`. Vercel captures stdout. Acceptable for production. |
| Dashboard | 🚫 NOT EXIST | No Grafana / Datadog / Vercel Observability dashboard configured. Operator action. |
| On-call rotation | 🚫 NOT CONFIGURED | P0-21 alerting defines rules but no on-call contact / PagerDuty integration. Operator action. |

### 4.9 DR (Disaster Recovery)

| Item | Status | Notes |
|------|--------|-------|
| DR runbook complete | ✅ DONE | `docs/DR_RUNBOOK.md` (216 lines) — architecture, backup procedure, restore procedure, post-restore reconciliation procedure, drill procedure, NO-GO conditions. |
| DR drill executed | 🚫 NOT EXECUTED | **Launch-gate AND-condition #4 FAILS.** `docs/DR_RUNBOOK.md` §6 — drill NOT run. `pg_dump` mechanism not implemented (SQLite file-copy in current code). Warm-standby Supabase project NOT provisioned. |
| Backup/restore tested | 🚫 NOT TESTED | `scripts/restore-backup.sh` authored but NOT executed. Restore procedure verified only against the design — no empirical drill. |
| RPO ≤ 24 hours | 🟡 DEPENDS ON TIER | If Supabase Pro tier: daily automated backups (7-day retention). If Free tier: NO automated backups. Supabase tier UNVERIFIED (INFRASTRUCTURE_READINESS.md Blocker A4). |
| RTO ≤ 4 hours (target ~30 min) | 🟡 DESIGN ONLY | Estimated ~20–30 min with warm standby; warm-standby NOT provisioned. Cold provisioning would push RTO to 2–4 hours. |
| Monthly drill cadence | 🚫 NOT ESTABLISHED | `docs/DR_RUNBOOK.md` §6.1 specifies monthly cadence — not yet operational. |

---

## 5. Risk Assessment

### 5.1 Critical-path risk table

| # | Gap | Risk Level | Impact if not resolved before production | Mitigation | Estimated Effort |
|---|-----|------------|-------------------------------------------|------------|------------------|
| R1 | P0-04 (Refund) LOCKED | **CRITICAL** | No in-system refund mechanism. Accidental double-charges, customer disputes, gateway-side captures without matching ledger entries — all become manual Razorpay-dashboard operations. Blocks `realPayments=true` enablement entirely. | Implement Wave-5 (P0-04 refund flow + P0-03 reconciliation). ~600–900 LOC + Razorpay refund API integration + ledger interaction. | HIGH (1 wave) |
| R2 | P0-03 (Reconciliation) LOCKED | **HIGH** | Gateway ↔ DB drift undetected. The known real-mode hazard (`TRANSACTION_RETRY_INVARIANT.md` §4.2 — capture succeeded at gateway but DB write failed) has no automatic recovery path. | Implement Wave-5 (P0-03 reconciliation job + report stub + mismatch detection). | MEDIUM (1 wave) |
| R3 | P0-07 (State machine + pickup attribution) LOCKED | **CRITICAL** | I-13 (Pickup/Handoff Integrity) NOT enforced by a P0. Wrong customer could pick up wrong order via QR/OTP bypass. SnakZap's core promise (correct order to correct customer) unprotected. | Implement Wave-7 (P0-07 8 attribution conditions for PICKED_UP + immutable audit event + QR + OTP verification). | HIGH (1 wave; critical-path terminus) |
| R4 | P0-06 (State separation) LOCKED | **HIGH** | Order cancelled but payment captured → no exception-queue detection. Inconsistent state combos cannot be caught. | Implement Wave-6 (P0-06 state-transition matrix + 4-way state separation). | MEDIUM (1 wave) |
| R5 | DR drill NOT executed | **HIGH** | Launch-gate AND-condition #4 FAILS. No empirical proof that backup/restore + post-restore reconciliation works. RPO/RTO targets unverified. | Execute DR drill per `docs/DR_RUNBOOK.md` §6. Requires: warm-standby Supabase project + `pg_dump` rewrite + drill workflow. | MEDIUM (operator + IDE) |
| R6 | Rollback drill NOT executed | **MEDIUM** | Launch-gate AND-condition #5 FAILS. P0-27 3-class rollback model documented but not exercised. ≤10-min Class-1 rollback target unverified. | Execute `rollback.yml` workflow against staging. | LOW (operator only) |
| R7 | Production Supabase project NOT provisioned | **CRITICAL** | No production database exists. Cannot deploy. | Provision separate Supabase project in `ap-northeast-1` (Option B per `docs/STAGING_ARCHITECTURE.md` §2.3). Apply DEV-001 SQL scripts. | LOW (operator, ~30 min) |
| R8 | Production Vercel env vars NOT configured | **HIGH** | App cannot connect to DB, Supabase Auth, Firebase, or Razorpay. | Populate 26 env vars per `docs/ENV_VAR_AUDIT.md` §4 on Vercel production environment. | LOW (operator, ~30 min) |
| R9 | `realtime`, `alert-evaluator`, `outbox-publisher` mini-services NOT deployed to Fly.io | **HIGH** | Real-time updates silently degrade (API routes still work). Alert rules can be triggered on-demand but NOT on schedule. `PAYMENT_CAPTURE_REQUESTED` events never consumed → Payments stuck in `CAPTURE_PENDING`. **BLOCKS `realPayments=true`** (publisher must exist). | Provision 3 Fly.io apps in `nrt` region. Refactor `REALTIME_URL` env var (Phase-3 follow-up A2). | MEDIUM (operator, ~2 hours) |
| R10 | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` NOT provisioned | **HIGH** | Real-mode captures impossible. Webhook handler cannot verify HMAC signatures. | Provision Razorpay production account + API keys + webhook secret. Configure Razorpay dashboard webhook URL → production `/api/webhooks/razorpay`. | LOW (operator, ~1 hour) |
| R11 | `FIREBASE_SERVICE_ACCOUNT_JSON` NOT provisioned | **MEDIUM** | Phone OTP auth returns 500 in production (fail-closed by `firebase-admin.ts` design). Consumers cannot log in via phone OTP. | Provision Firebase Admin SDK service account JSON. Configure as Vercel env var. | LOW (operator, ~30 min) |
| R12 | Production deployment of `snakzap_app` role + WORM REVOKE | **HIGH** | If app connects as `postgres` superuser (via `postgres.<project-ref>` pooler username), WORM boundary is BYPASSED — audit log can be mutated. | Use role-named pooler connection string `postgresql://snakzap_app:<app-password>@...`. Apply `create-roles.sql` + `revoke-worm.sql` to production Supabase. | LOW (operator, included in R7) |
| R13 | `TRANSACTION_RETRY_INVARIANT` partial enforcement | **MEDIUM** | Mitigation IMPLEMENTED (Wave-4 4c — capture moved to publisher, idempotency proven). But §8.2 items 1 (code-review checklist), 2 (lint rule), 4 (pre-generated idempotency key for `createRazorpayOrder()`), 5 (CI gate) are STILL DEFERRED. Future regression risk: a developer could re-introduce an external call inside `withTransaction()`. | Implement §8.2 items 1, 2, 4, 5. Post-Wave-5 priority (before `realPayments=true`). | MEDIUM (~1–2 days IDE) |
| R14 | `admin-login.tsx` hard-coded default password `'admin123'` | **LOW** | UX hygiene only. Server-side `verifyPassword()` still enforced. | Replace `useState('admin123')` with `useState('')`. Phase-3 follow-up A3. | TRIVIAL (~5 min) |
| R15 | `REALTIME_URL` hard-coded `localhost:3003` in `src/lib/realtime.ts:7` | **MEDIUM** | On Vercel, `localhost` does not exist across function instances. socket.io-client silently swallows connect_error. API routes still succeed without real-time updates. | Refactor to `process.env.REALTIME_URL`. Phase-3 follow-up A2. Add to `.env.example`. | LOW (~15 min IDE + env var) |
| R16 | Realtime service CORS `origin: '*'` | **LOW** | Acceptable for staging. For production, MUST be tightened to allowed origins list. | Phase-3 hardening A1. | TRIVIAL (~10 min) |
| R17 | Rate limiter in-memory (not Redis) | **MEDIUM** | Cross-instance burst protection NOT present on Vercel serverless. Each function invocation has its own in-memory store → effectively per-instance limits. Fail-closed mode never triggers (limiter always "available" per-invocation). | Provision Redis (Upstash recommended for Vercel). Refactor `src/lib/rate-limit.ts` to use Redis when `REDIS_URL` present. | MEDIUM (~2 days IDE) |
| R18 | `getSocket()` singleton not serverless-optimized | **LOW** | On Vercel, `globalThis` is per-invocation. Each invocation opens a new socket.io-client connection. Per-request latency overhead. Acceptable for Phase-2/3. | Phase-3 follow-up #11. Optional optimization. | LOW (~1 day IDE) |
| R19 | Backup-scheduler uses SQLite file-copy | **HIGH** | References `db/custom.db` which does NOT exist in PostgreSQL deployment. Returns 500 on Vercel. No production backup mechanism (unless relying on Supabase Pro automated backups). | Replace with `pg_dump --format=custom --compress=9` → Supabase Storage bucket `snakzap-backups`. Blocker #10. | MEDIUM (~1 day IDE + operator) |
| R20 | AuditLog hash-chain tamper-evidence weakness | **LOW** | Hash-chain is computed but true PREVENTION requires production WORM storage. Current `revoke-worm.sql` + plpgsql triggers are defense-in-depth; if `snakzap_app` role is bypassed (e.g., by `postgres` superuser), hash-chain can be tampered. | Documented in `src/lib/audit.ts`. True WORM storage is post-launch. | LOW (post-launch) |
| R21 | No load tests | **MEDIUM** | Production traffic behavior under load unverified. Vercel function `maxDuration` caps + Supabase pooler connection limits untested. | Author load-test script (k6 or Artillery). Run against staging. Pre-launch-traffic-ramp requirement. | MEDIUM (~2 days IDE) |
| R22 | Supabase/Vercel tier UNVERIFIED | **LOW** | If Supabase Free: no automated backups. If Vercel Hobby: function maxDuration capped at 10s (backup route at 30s rejected). | Orchestrator verify-only check (Blockers A4, A5). | TRIVIAL (~5 min operator) |
| R23 | GitHub repo secrets + environments NOT configured | **HIGH** | `deploy.yml` cannot trigger. No production approval gate. | Configure 3 secrets + 2 environments in GitHub repo settings. Blockers #3, #4, #5. | LOW (~30 min operator) |
| R24 | Razorpay dashboard webhook URL NOT configured | **HIGH** | Real Razorpay webhooks (`payment.captured`, `payment.failed`, `refund.processed`) not delivered to the app. WebhookHandler flag is OFF anyway, but enabling requires this URL first. | Configure webhook endpoint URL on Razorpay dashboard → production `/api/webhooks/razorpay`. | TRIVIAL (~5 min operator, after R10) |

### 5.2 Risk summary

| Risk Level | Count | Items |
|-----------|-------|-------|
| CRITICAL | 4 | R1 (P0-04), R3 (P0-07), R7 (prod DB), R12 (snakzap_app role) |
| HIGH | 9 | R2 (P0-03), R4 (P0-06), R5 (DR drill), R8 (Vercel env vars), R9 (Fly.io mini-services), R10 (Razorpay keys), R11 (Firebase), R19 (backup rewrite), R23 (GitHub secrets) |
| MEDIUM | 7 | R6 (rollback drill), R13 (retry invariant enforcement), R15 (REALTIME_URL), R17 (Redis rate-limit), R21 (load tests), R22 (tier check), R24 (Razorpay webhook URL — though trivial effort) |
| LOW | 5 | R14 (admin password default), R16 (realtime CORS), R18 (socket singleton), R20 (audit WORM), R25 |
| TRIVIAL | (folded into LOW) | R14, R16, R22, R24 |

---

## 6. Production Authorization Conditions

Per `PRODUCTION_READINESS_MATRIX.md` §14.1 — 7 launch-gate AND-conditions. ALL seven must be GREEN simultaneously for PRODUCTION GO. Any single red ⇒ NO-GO.

### 6.1 Launch-gate AND-condition status

| # | Condition | Status | Why |
|---|-----------|--------|-----|
| 1 | All P0 capabilities at `Production-ready` (lifecycle state 9) | 🔴 **FAIL** | 4 P0s LOCKED (P0-04, P0-03, P0-06, P0-07). P0-26 at PARTIAL (design only). |
| 2 | All P0 invariants verified (I-01..I-14) | 🔴 **FAIL** | I-03, I-06, I-08, I-11, I-13 have LOCKED direct protectors. I-13 specifically depends on P0-07 (Wave-7 terminus). |
| 3 | All critical external-dependency scenarios tested | 🟡 **PARTIAL** | Razorpay scenarios tested in DEMO MODE only (real-mode scenarios deferred). Firebase auth path NOT exercised in production mode (no service account). Supabase pooler scenarios tested on staging. Razorpay webhook real-mode scenario NOT tested. |
| 4 | DR drill passed (incl. post-restore business-state reconciliation) | 🔴 **FAIL** | DR drill NOT executed. `pg_dump` mechanism not implemented. Warm-standby Supabase NOT provisioned. |
| 5 | Rollback drill passed (per deployment class) | 🔴 **FAIL** | `rollback.yml` workflow authored but NOT executed. Class-1 ≤10-min target unverified. `staging-rollback-drill.yml` workflow exists in `.github/workflows/` but has not been run as a formal drill per Wave-1 closure records. |
| 6 | No unresolved P0 exception in exception queue | ✅ **PASS** (today) | No production traffic → no exceptions. (Trivially true because production is not live.) |
| 7 | No expired exception waiver | ✅ **PASS** (today) | No waivers issued. |

**Verdict:** 4 of 7 conditions FAIL. **PRODUCTION NO-GO.** No exceptions, no "we'll fix it post-launch" for P0.

### 6.2 Hard blockers (MUST fix before production authorization)

These MUST be resolved before production can be authorized. Each maps to a launch-gate AND-condition failure or a CRITICAL risk.

| # | Hard Blocker | AND-condition / Risk | Resolution |
|---|--------------|----------------------|------------|
| HB-1 | P0-04 (Refund flow) implemented + S5 PASS | Cond #1, #2; R1 | Wave-5 |
| HB-2 | P0-03 (Reconciliation) implemented + S5 PASS | Cond #1, #2; R2 | Wave-5 |
| HB-3 | P0-06 (State separation) implemented + S5 PASS | Cond #1, #2; R4 | Wave-6 |
| HB-4 | P0-07 (State machine + pickup attribution) implemented + S5 PASS | Cond #1, #2; R3 | Wave-7 (critical-path terminus) |
| HB-5 | DR drill executed (RPO ≤24h, RTO ≤4h target ~30 min, post-restore reconciliation clean) | Cond #4; R5 | Phase-3 (requires `pg_dump` rewrite + warm-standby Supabase) |
| HB-6 | Rollback drill executed (Class-1 ≤10 min verified) | Cond #5; R6 | Operator action (run `rollback.yml` + `staging-rollback-drill.yml` formally) |
| HB-7 | Production Supabase project provisioned (separate from staging) | R7 | Operator (Option B per STAGING_ARCHITECTURE.md §2.3) |
| HB-8 | Production Vercel environment configured (all 26 env vars) | R8 | Operator (per docs/ENV_VAR_AUDIT.md §4) |
| HB-9 | `realtime`, `alert-evaluator`, `outbox-publisher` deployed to Fly.io | R9 | Operator (3 Fly.io apps in `nrt` region) |
| HB-10 | Razorpay production API keys + webhook secret provisioned | R10 | Operator |
| HB-11 | Firebase service account JSON provisioned | R11 | Operator |
| HB-12 | `snakzap_app` role + WORM REVOKE applied to production Supabase | R12 | Operator (apply `create-roles.sql` + `revoke-worm.sql`) |
| HB-13 | GitHub repo secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) + environments (`staging`, `production`) configured | R23 | Operator |
| HB-14 | `outbox-publisher` running as long-lived service (REQUIRED before `realPayments=true`) | R9 | Operator (Fly.io) |
| HB-15 | `TRANSACTION_RETRY_INVARIANT` §8.2 enforcement items (1, 2, 4, 5) implemented | R13 | IDE (post-Wave-5, pre-`realPayments=true`) |

### 6.3 Soft blockers (SHOULD fix before production launch)

These do not block launch-gate AND-conditions but represent quality / hygiene / operational-readiness issues.

| # | Soft Blocker | Why "should" | Resolution |
|---|--------------|--------------|------------|
| SB-1 | `backup-scheduler` rewrite to `pg_dump` → Supabase Storage | DR_RUNBOOK §3.2 backup procedure depends on it. R19. | Phase-3 (IDE + operator) |
| SB-2 | Rate limiter refactor to Redis (Upstash) | Cross-instance burst protection absent on Vercel. R17. | Phase-3 IDE |
| SB-3 | `REALTIME_URL` env var refactor in `src/lib/realtime.ts:7` | Hard-coded `localhost:3003`. R15. | Phase-3 IDE (5 min) |
| SB-4 | Realtime CORS hardening (`origin: '*'` → allowed list) | R16. | Phase-3 IDE (10 min) |
| SB-5 | `admin-login.tsx` hard-coded `'admin123'` removed | R14. | Phase-3 IDE (5 min) |
| SB-6 | Supabase/Vercel tier verified (Pro for backups + maxDuration) | R22. | Operator verify (5 min) |
| SB-7 | Load tests authored + executed on staging | R21. | Pre-launch-traffic IDE (~2 days) |
| SB-8 | Monitoring dashboard configured (Grafana / Vercel Observability) | Operational visibility. | Operator |
| SB-9 | On-call rotation + PagerDuty integration | P0-21 alert delivery mechanism. | Operator |
| SB-10 | AuditLog hash-chain true WORM storage layer (defense-in-depth beyond plpgsql triggers) | R20. | Post-launch |
| SB-11 | Portal shims (`consumer-portal`, `vendor-portal`, `admin-portal`) retired on Vercel | Cosmetic — Vercel handles routing natively. | Phase-3 |
| SB-12 | `getSocket()` singleton serverless optimization | R18. Latency optimization. | Phase-3 |
| SB-13 | Razorpay dashboard webhook URL configured → production `/api/webhooks/razorpay` | R24. Required for `webhookHandler=true` enablement. | Operator (after HB-10) |
| SB-14 | Staging-rollback-drill workflow formally executed as Wave-1 closure evidence | R6 partial. | Operator |

### 6.4 Post-production items (can be addressed after launch)

| # | Post-Production Item | Notes |
|---|---------------------|-------|
| PP-1 | Monthly DR drill cadence operational | `docs/DR_RUNBOOK.md` §6.1 |
| PP-2 | P0-26 drill result recorded in `DrDrillResult` model (or audit log) | Wave-1 deferred |
| PP-3 | AuditLog true WORM storage migration (defense-in-depth beyond current triggers) | R20 |
| PP-4 | `getSocket()` per-invocation latency optimization (if budget exceeded) | R18 |
| PP-5 | Performance/load test re-runs at scale milestones | R21 |
| PP-6 | Realtime service horizontal scaling (if room fanout exceeds single-instance capacity) | Future |
| PP-7 | Wallet + Loyalty interaction test (P2 feature — per IMPLEMENTATION_ORDER.md §5) | P2 deferred |
| PP-8 | Catering state machine + Geo-fence + Pickup caution flag (P3 features — per IMPLEMENTATION_ORDER.md §5) | P3 deferred |

---

## 7. Feature Flag Rollout Plan

### 7.1 Flag enablement prerequisites (per flag)

| Flag | Prerequisite | Wave/Phase | Notes |
|------|--------------|-----------|-------|
| `concurrencyControl` | Already implemented (Wave-1). Staging-tested. | Can enable post-Wave-7 | Low-risk; Orchestrator decision. |
| `requestHashEnforcement` | Already implemented (Wave-3 3c). Staging-tested. | Can enable post-Wave-4 | Low-risk; Orchestrator decision. Backward-compatible (null-hash records + non-null-hash records both return cached response when OFF). |
| `outboxPublisher` | Mini-service deployed to Fly.io (HB-9). | Required pre-`realPayments=true` | Long-lived process; cannot run on Vercel. |
| `webhookHandler` | `RAZORPAY_WEBHOOK_SECRET` env var (HB-10) + Razorpay dashboard webhook URL (SB-13). | Post-Wave-5 (after P0-03 reconciliation closes) per WAVE4_GATE_REVIEW.md D5 | Webhook handler is the gateway-side capture confirmation; without reconciliation, mismatches are harder to detect. |
| `realPayments` | **ALL of:** P0-04 refund (HB-1), P0-03 reconciliation (HB-2), outbox-publisher deployed (HB-14), TRANSACTION_RETRY_INVARIANT §8.2 enforcement (HB-15), Razorpay production API keys (HB-10), `webhookHandler=true` (so gateway-side captures are confirmed). | Post-Wave-5 (minimum), recommended post-Wave-7 | THE most consequential flag — flips SnakZap from demo to real money. |
| `pickupAttributionEnforcement` | P0-07 (HB-4) implemented + S5 PASS. | Post-Wave-7 | Required before serving real pickup orders. |
| `drDrillMode` | Warm-standby Supabase + `pg_dump` rewrite (HB-5 prerequisites). | Phase-3 (post-launch if drill cadence is the only blocker) | Drill-only mode — never enabled in production traffic. |

### 7.2 Recommended rollout sequence

```text
Phase 0 (today, all flags OFF):
  - All flags OFF in production.
  - Wave-5/6/7 implementation proceeds against staging.

Phase 1 (post-Wave-5):
  - Enable `concurrencyControl` ✅ (already proven)
  - Enable `requestHashEnforcement` ✅ (already proven, 3c evidence)
  - DEPLOY `outbox-publisher` to Fly.io ✅ (HB-14)
  - Enable `outboxPublisher` ✅
  - DEPLOY `realtime` + `alert-evaluator` to Fly.io ✅ (HB-9)
  - Configure `RAZORPAY_WEBHOOK_SECRET` + webhook URL ✅ (HB-10, SB-13)
  - Enable `webhookHandler` ✅ (after P0-03 reconciliation closes — needed for mismatch detection)
  - TRANSACTIONS IN DEMO MODE still (`realPayments=false`)

Phase 2 (post-Wave-7 — critical path closed):
  - Implement P0-07 pickup attribution (HB-4)
  - Enable `pickupAttributionEnforcement` ✅
  - Execute DR drill (HB-5)
  - Execute rollback drill (HB-6)
  - Implement §8.2 enforcement items (HB-15)

Phase 3 (production launch — only after ALL HB-1..HB-15 satisfied):
  - Provision production Supabase (HB-7) + apply DEV-001 SQL
  - Configure production Vercel env vars (HB-8)
  - Configure Firebase service account (HB-11)
  - Configure snakzap_app role + WORM REVOKE on production (HB-12)
  - Configure GitHub secrets + environments (HB-13)
  - Smoke tests pass on production URL
  - Enable `realPayments=true` 🟢 (PRODUCTION GO — but only after staging real-mode evidence with real Razorpay test keys)

Phase 4 (post-launch — Soft Blockers + Post-Production items):
  - SB-1..SB-14
  - PP-1..PP-8
```

### 7.3 Evidence required for each flag enablement

| Flag | Evidence Required | Wave that produced evidence |
|------|-------------------|------------------------------|
| `concurrencyControl` | Wave-1 P0-25 evidence (3 concurrency cases) | Wave-1 |
| `requestHashEnforcement` | Wave-3 3c-PG-E1 evidence (`ok:true`, database:postgresql) | Wave-3 |
| `outboxPublisher` | Wave-2 2b evidence + Wave-4 4c-E5 (publisher retry idempotency) | Wave-2 + Wave-4 |
| `webhookHandler` | Wave-4 4a evidence (5 concurrent webhooks on PostgreSQL) | Wave-4 |
| `realPayments` | **NEW evidence required** — real-mode capture via publisher against Razorpay test API keys. NOT yet captured. Staging-only. | Future wave (post-Wave-5) |
| `pickupAttributionEnforcement` | Wave-7 P0-07 evidence (8 attribution conditions) | Wave-7 (not started) |
| `drDrillMode` | DR drill execution report (`docs/DR_RUNBOOK.md` §6.2) | Phase-3 (not executed) |

---

## 8. External Service Dependencies

### 8.1 Per-service production readiness

| Service | Production-Ready? | Required For | Provisioning Effort |
|---------|-------------------|--------------|---------------------|
| **Supabase PostgreSQL** (production project) | 🚫 NOT PROVISIONED | All persistence (Orders, Payments, LedgerEntry, AuditLog, Outbox, Sessions, etc.) | Operator: provision new project in `ap-northeast-1`. Apply DEV-001 SQL (`postgres-migration.sql` + `create-roles.sql` + `revoke-worm.sql` + `seed-postgres.sql`) + Wave-1..4 sub-wave migrations. ~1 hour. |
| **Supabase Auth** (JWKS endpoint) | 🟡 Staging-only | `jose` JWT verification | Same Supabase project — JWKS endpoint comes free with project. Configure `SUPABASE_URL` + `SUPABASE_JWKS_URL` env vars on Vercel production. |
| **Vercel** (production environment) | 🟡 Project exists, prod env NOT configured | Hosting Next.js app + serverless functions | Operator: link repo, configure 26 env vars per `docs/ENV_VAR_AUDIT.md` §4, configure production domain. ~30 min. |
| **Razorpay** (production API) | 🚫 NOT PROVISIONED | Real payment capture + order create + (Wave-5) refund | Operator: provision Razorpay production account, generate API keys, configure webhook endpoint URL → `/api/webhooks/razorpay`, obtain `RAZORPAY_WEBHOOK_SECRET`. ~1 hour. **BLOCKED on Wave-5 (P0-04 refund) closure** for safe enablement. |
| **Firebase** (Admin SDK) | 🚫 NOT PROVISIONED | Phone OTP authentication | Operator: provision Firebase project, generate service account JSON, configure `FIREBASE_SERVICE_ACCOUNT_JSON` env var. ~30 min. |
| **Fly.io** (3 mini-services) | 🚫 NOT PROVISIONED | `realtime` (3003) + `alert-evaluator` (3005) + `outbox-publisher` | Operator: provision 3 Fly.io apps in `nrt` (Tokyo) region, configure env vars (`DATABASE_URL`, `REALTIME_URL` consumers, etc.), deploy via `fly deploy`. ~2 hours. |
| **GitHub** (repo secrets + environments) | 🚫 NOT CONFIGURED | `deploy.yml` (staging auto-deploy + production manual approval gate) + `rollback.yml` (manual rollback) | Operator: configure 3 repo secrets + 2 environments (`staging` no protection, `production` with required reviewers). ~30 min. |
| **Supabase Storage** (`snakzap-backups` bucket) | 🚫 NOT PROVISIONED | `pg_dump` → Storage backup mechanism | Operator: create Storage bucket. Phase-3 (SB-1). ~10 min. |
| **Redis** (Upstash recommended for Vercel) | 🚫 NOT PROVISIONED | Cross-instance rate limiting (P0-13) | Operator: provision Upstash Redis, configure `REDIS_URL` env var. Refactor `src/lib/rate-limit.ts`. Phase-3 (SB-2). ~30 min + 2 days IDE. |
| **Monitoring / Dashboard** (Grafana / Vercel Observability / Datadog) | 🚫 NOT CONFIGURED | Operational visibility | Operator. Phase-3 (SB-8). |
| **On-call / PagerDuty** | 🚫 NOT CONFIGURED | P0-21 alert delivery | Operator. Phase-3 (SB-9). |

### 8.2 External dependency failure matrix (per Production Readiness Matrix §10)

| Dependency | Failure Scenario | Strategy | User Message | Alert | Affected P0 | Tested? |
|-----------|------------------|----------|--------------|-------|-------------|---------|
| Razorpay | Gateway timeout | Retry on idempotency key | "Payment processing — please wait" | `payment-success-rate < 95%` | P0-01 | Demo mode only |
| Razorpay | Signature mismatch | Reject; idempotency dedup | "Payment verification failed" | Signature-failure alert | P0-01, P0-05 | ✅ Staging |
| Razorpay | Webhook duplicate | `WebhookEvent.eventId` unique | (silent dedup) | Webhook log | P0-05 | ✅ Staging (5 concurrent) |
| Razorpay | Webhook tampered | HMAC verify 403 | (silent reject) | Signature-failure alert | P0-05 | ✅ Staging |
| Supabase DB | Unreachable | Health endpoint reports `degraded` | "Service temporarily unavailable" | `db-unavailable` alert | P0-20, P0-21 | ✅ Staging |
| Supabase DB | Pooler exhaustion | `connection_limit=1` per function | Retry; backoff | Connection-pool alert | P0-15, P0-24 | NOT tested |
| Firebase | Token verify fail | Reject; client re-auth | "Session expired — please log in" | Auth-failure alert | P0-09 | NOT tested in production mode |
| Firebase | Service account missing | `firebase-admin.ts` HARD-FAIL (fail-closed) | "OTP unavailable" | Auth-failure alert | P0-09, P0-11 | NOT tested |
| Vercel | Function timeout | Vercel returns 504; client retries | "Request timed out" | Timeout alert | (cross-cutting) | NOT tested |
| Fly.io (realtime) | Service down | socket.io-client swallows connect_error | (silent — API routes still work) | Realtime-down alert | (UX-only) | NOT tested |
| Fly.io (outbox-publisher) | Service down | Payments stuck in `CAPTURE_PENDING` | "Payment processing — please wait" | Publisher-lag alert | P0-01, P0-24 | NOT tested |
| Fly.io (alert-evaluator) | Service down | Alerts not fired on schedule | (silent — alerts can be triggered on-demand) | Meta-alert (manual) | P0-21 | NOT tested |

---

## 9. Decision Points for Orchestrator

The Orchestrator must resolve the following decision points before authorizing any production-related work:

### D1 — Wave-5 authorization (P0-04 Refund + P0-03 Reconciliation)

**Options:**
- (a) **Authorize Wave-5 NOW** (recommended) — Implement P0-04 (refund flow) + P0-03 (reconciliation job). ~600–900 LOC. Mirrors Wave-3/4 sub-wave structure (5a refund + 5b reconciliation + 5c cross-P0 closure). Demo mode for staging evidence. Real-mode refund evidence deferred until Razorpay test keys authorized.
- (b) **Defer Wave-5** — Pause P0 closure; focus on operator provisioning + DR drill + rollback drill. (NOT recommended — leaves 2 CRITICAL P0s LOCKED indefinitely.)

**Default recommendation:** (a) Authorize Wave-5. Wave-5 unblocks `realPayments=true` enablement (HB-1, HB-2).

### D2 — Operator provisioning sequence

**Options:**
- (a) **Sequential** — Provision Supabase prod → Vercel env vars → GitHub secrets/envs → Fly.io mini-services → Razorpay → Firebase. (Recommended.)
- (b) **Parallel** — All operator tasks in parallel. (Risky — dependencies exist: Fly.io mini-services need `DATABASE_URL` from Supabase prod; Razorpay keys need webhook URL from Vercel prod.)

**Default recommendation:** (a) Sequential. Estimated ~4–6 hours total Orchestrator + operator time.

### D3 — DR drill + Rollback drill authorization

**Options:**
- (a) **Execute both drills immediately** against staging (recommended). Uses existing `staging-rollback-drill.yml` + authored DR drill procedure. Closes launch-gate AND-conditions #4 + #5.
- (b) **Defer drills until Wave-7 closure.** (NOT recommended — drills may surface infrastructure gaps that take time to fix.)

**Default recommendation:** (a) Execute drills now. DR drill requires `pg_dump` rewrite (SB-1) + warm-standby Supabase (HB-5 prerequisites) — these become Wave-5/6 parallel work.

### D4 — Feature flag enablement scope for "staging real-mode evidence"

**Options:**
- (a) **Authorize Razorpay test API keys on staging Vercel** (Wave-5 or later). Enables real-mode capture + refund evidence scenarios. (WAVE4_GATE_REVIEW.md D7 — was NO; reconsider post-Wave-5.)
- (b) **Continue demo-mode-only evidence.** (NOT recommended post-Wave-5 — `realPayments=true` enablement requires real-mode evidence.)

**Default recommendation:** (a) Authorize staging real-mode evidence post-Wave-5 (after P0-04 refund closes — so accidental double-charges can be refunded in-system).

### D5 — `requestHashEnforcement` production enablement timing

**Options:**
- (a) **Enable NOW** (post-Wave-4). Low-risk; backward-compatible (null-hash records still return cached response). Closes 3c deferral.
- (b) **Enable post-Wave-5.** (Conservative — bundles with other flag enablements.)
- (c) **Enable post-Wave-7.** (Most conservative.)

**Default recommendation:** (a) Enable now. Lowest-risk flag in the inventory.

### D6 — `webhookHandler` production enablement timing

**Options:**
- (a) **Enable post-Wave-4.** (After `RAZORPAY_WEBHOOK_SECRET` provisioned + Razorpay webhook URL configured.)
- (b) **Enable post-Wave-5.** (After P0-03 reconciliation closes — recommended by WAVE4_GATE_REVIEW.md D5.)
- (c) **Enable with `realPayments=true`.** (Bundled.)

**Default recommendation:** (b) Enable post-Wave-5. Webhook handler is the gateway-side capture confirmation; without reconciliation (P0-03), gateway ↔ DB mismatches are harder to detect.

### D7 — `realPayments` production enablement timing

**Options:**
- (a) **Post-Wave-5** (minimum). After P0-04 refund + P0-03 reconciliation + outbox-publisher deployed + Razorpay keys + `webhookHandler=true` + §8.2 enforcement items.
- (b) **Post-Wave-7** (recommended). After full critical path closes (P0-06 + P0-07) — maximum safety.

**Default recommendation:** (b) Post-Wave-7. `realPayments=true` is the most consequential flag; enabling without pickup attribution (P0-07) means real orders can be placed without pickup verification.

### D8 — Production launch strategy

**Options:**
- (a) **Soft launch** — Production deploy with `realPayments=false` (demo mode), all other flags OFF. Validates infrastructure end-to-end without real money. (Recommended pre-launch step.)
- (b) **Hard launch** — Production deploy with `realPayments=true` immediately. (NOT recommended — too much risk surface.)
- (c) **Phased soft launch** — Soft launch → enable `concurrencyControl` + `requestHashEnforcement` → enable `webhookHandler` → enable `realPayments` (only after real-mode staging evidence). (Recommended.)

**Default recommendation:** (c) Phased soft launch. Each phase has its own evidence + smoke-test verification.

### D9 — `TRANSACTION_RETRY_INVARIANT` §8.2 enforcement items (1, 2, 4, 5)

**Options:**
- (a) **Implement in Wave-5** (parallel with P0-04/P0-03). Closes HB-15 before `realPayments=true`.
- (b) **Implement in Wave-6** (after Wave-5). Allows Wave-5 to focus on P0-04/P0-03.
- (c) **Implement post-Wave-7** (just before production launch).

**Default recommendation:** (a) Wave-5. Enforcement items (lint rule, code-review checklist, pre-generated idempotency key for `createRazorpayOrder()`, CI gate) protect against future regressions. Wave-5 introduces the refund flow which uses Razorpay refund API — another external call that must NOT be inside `withTransaction()`.

### D10 — Backup mechanism rewrite (SB-1)

**Options:**
- (a) **Rewrite in Wave-5/6** (parallel with P0 work). Closes HB-5 DR drill prerequisite.
- (b) **Rewrite in Phase-3** (post-Wave-7). (NOT recommended — DR drill blocked until rewrite done.)

**Default recommendation:** (a) Parallel with Wave-5/6. DR drill (HB-5) cannot execute until `pg_dump` mechanism exists.

### D11 — Load testing (SB-7)

**Options:**
- (a) **Author load tests in Wave-6/7** (parallel with P0-06/P0-07). Run on staging.
- (b) **Defer to pre-launch-traffic** (post-Wave-7).

**Default recommendation:** (a) Parallel with Wave-6/7. Surfaces Vercel maxDuration + Supabase pooler limits before production traffic ramp.

### D12 — AuditLog true WORM storage (SB-10 / R20)

**Options:**
- (a) **Post-launch** (acceptable). Current `revoke-worm.sql` + plpgsql triggers provide defense-in-depth at the privilege layer. True WORM storage is supplementary.
- (b) **Pre-launch** (conservative).

**Default recommendation:** (a) Post-launch. Current defense-in-depth is adequate if `snakzap_app` role is enforced at runtime (HB-12).

---

## 10. Recommendation

### **NOT READY**

### 10.1 Justification

SnakZap is **NOT READY** for production authorization today. The structural blockers are:

1. **4 P0s on the critical path remain LOCKED** (P0-04 Refund, P0-03 Reconciliation, P0-06 State Separation, P0-07 State Machine + Pickup Attribution). These represent 3 of 14 invariants (I-03, I-06, I-08, I-11, I-13) with LOCKED direct protectors.
2. **2 of 7 launch-gate AND-conditions FAIL**:
   - Condition #4 (DR drill) — NOT executed.
   - Condition #5 (Rollback drill) — NOT executed.
3. **All production infrastructure is UNPROVISIONED**:
   - No production Supabase project (separate from staging).
   - No production Vercel environment configured.
   - No Fly.io mini-services (`realtime`, `alert-evaluator`, `outbox-publisher`).
   - No Razorpay production API keys.
   - No Firebase service account.
   - No GitHub repo secrets / environments.
4. **3 of 7 feature flags are correctly OFF and CANNOT be safely enabled**:
   - `realPayments` — blocked on P0-04 (no in-system refund for accidental double-charges).
   - `webhookHandler` — blocked on Razorpay webhook secret + recommended post-Wave-5 (reconciliation).
   - `requestHashEnforcement` — could enable (low-risk) but separate Orchestrator decision.
5. **TRANSACTION_RETRY_INVARIANT partial enforcement** — mitigation implemented (Wave-4 4c) but §8.2 items (lint rule, code-review checklist, pre-generated idempotency key, CI gate) remain deferred.

### 10.2 Why NOT READY (not CONDITIONALLY READY)

A "CONDITIONALLY READY" verdict would be appropriate if the only remaining work were operator provisioning + drill execution. However, this Gate Review finds **structural P0 work remaining** — 4 P0s on the critical path, including the critical-path terminus (P0-07) which fully owns I-13 (Pickup/Handoff Integrity). These cannot be closed by operator action; they require Wave-5/6/7 IDE implementation.

### 10.3 Path to READY

```text
Today (NOT READY)
   │
   ▼ Wave-5 (P0-04 refund + P0-03 reconciliation + §8.2 enforcement + pg_dump rewrite + load test authoring)
   │
   ▼ Wave-6 (P0-06 state separation)
   │
   ▼ Wave-7 (P0-07 state machine + pickup attribution) — CRITICAL PATH TERMINUS
   │
   ▼ Phase-3 Operator Provisioning:
   │    - Provision production Supabase (HB-7)
   │    - Configure production Vercel env vars (HB-8)
   │    - Deploy 3 Fly.io mini-services (HB-9, HB-14)
   │    - Provision Razorpay + Firebase (HB-10, HB-11)
   │    - Apply snakzap_app role + WORM REVOKE (HB-12)
   │    - Configure GitHub secrets + environments (HB-13)
   │
   ▼ Phase-3 Drills:
   │    - DR drill (HB-5) — requires pg_dump rewrite (SB-1) + warm-standby Supabase
   │    - Rollback drill (HB-6)
   │
   ▼ Phase-3 Real-mode staging evidence:
   │    - Configure Razorpay TEST keys on staging (D4 option a)
   │    - Real-mode capture via publisher evidence
   │    - Real-mode refund evidence
   │
   ▼ Soft launch (D8 option c — phased):
   │    - Production deploy with realPayments=false
   │    - Smoke tests pass on production URL
   │    - Enable concurrencyControl + requestHashEnforcement
   │    - Enable webhookHandler
   │    - Enable realPayments (PRODUCTION GO — only after staging real-mode evidence passes)
   │
READY ✅
```

**Estimated time to READY:**
- IDE work (Wave-5/6/7 + §8.2 enforcement + load tests + pg_dump rewrite): **3–6 months** (3 waves + parallel work).
- Operator provisioning: **~4–6 hours** (sequential).
- Drill execution: **~2–4 hours** (after prerequisites).
- Real-mode staging evidence: **~1–2 days** (after Razorpay test keys authorized).

### 10.4 What CAN proceed immediately (without violating NOT READY)

- ✅ Operator provisioning (HB-7 through HB-13) — does NOT require P0 closure. Can run in parallel with Wave-5.
- ✅ Rollback drill (HB-6) — uses existing `rollback.yml` + `staging-rollback-drill.yml` workflows. Can run against staging now.
- ✅ Soft blockers SB-3 (`REALTIME_URL` env var refactor), SB-4 (realtime CORS), SB-5 (admin password default), SB-6 (tier verification) — low-risk IDE + operator actions.
- ✅ `requestHashEnforcement` production enablement (D5 option a) — low-risk, closes 3c deferral. (Separate Orchestrator decision.)

### 10.5 What MUST NOT proceed

- ❌ `realPayments=true` enablement (until P0-04 + P0-03 + outbox-publisher + §8.2 enforcement + Razorpay keys + webhook handler all in place).
- ❌ `webhookHandler=true` enablement (until Razorpay webhook secret + URL configured; recommended post-Wave-5).
- ❌ Production migration (until production Supabase provisioned).
- ❌ Production deploy (until all hard blockers resolved).
- ❌ Wave-5 implementation (until Orchestrator authorizes — D1).
- ❌ Wave-4 reopening (Wave-4 is COMPLETE / CLOSED — `WAVE4_EVIDENCE.md` §8).

---

## 11. Governance Compliance

This Gate Review was conducted under the Orchestrator's READ/PLAN-FIRST authorization for Production Readiness / Launch Gate. The following constraints were honored:

| Constraint | Status |
|-----------|--------|
| No source-code modification (`.ts` files) | ✅ HONORED — no `.ts` files were edited |
| No `prisma/schema.prisma` modification | ✅ HONORED — schema file unchanged |
| No migration files created | ✅ HONORED — no new SQL migration scripts |
| No evidence tests executed | ✅ HONORED — no test runs; only file reads + analysis |
| No production deploy | ✅ HONORED — production untouched |
| No `realPayments` enable | ✅ HONORED — flag remains OFF (per `src/lib/deployment.ts:27`) |
| No `requestHashEnforcement` production enable | ✅ HONORED — flag remains OFF in production (per `src/lib/deployment.ts:47`) |
| No `webhookHandler` production enable | ✅ HONORED — flag remains OFF in production (per `src/lib/deployment.ts:53`) |
| No Wave-5+ implementation start | ✅ HONORED — Wave-5 remains LOCKED (recommended for authorization in D1) |
| No Wave-4 reopening | ✅ HONORED — Wave-4 stays COMPLETE / CLOSED |
| No production access/change | ✅ HONORED — no production env vars modified, no production migrations, no production deploys |
| No real payment activation | ✅ HONORED — `realPayments=false` throughout |
| No new production tests that modify state | ✅ HONORED — no tests executed |
| Files read, analyzed, and Gate Review document produced | ✅ DONE — see §11.1 for file inventory |
| Worklog appended | ✅ DONE — appended as Task ID `prod-readiness-gate-review` |

### 11.1 Files read for this Gate Review

| File | Lines | Purpose |
|------|-------|---------|
| `/home/z/my-project/worklog.md` (tail, ~lines 5500-6197) | ~700 | Wave-4 closure (4a/4b/4c/4d S5 PASS / CLOSED) + Wave-4 COMPLETE formalization |
| `/home/z/my-project/WAVE4_EVIDENCE.md` | 409 | Wave-4 evidence — all sub-waves S5 PASS / CLOSED; final governance state |
| `/home/z/my-project/WAVE4_GATE_REVIEW.md` | 941 | Wave-4 READ/PLAN-FIRST Gate Review — Wave-5 deferrals + D1-D10 decision points + CONDITIONAL-GO recommendation |
| `/home/z/my-project/SUBWAVE_3_GATE_REVIEW.md` | 142 | Original Sub-Wave 3 Gate Review — Wave-4/5 deferrals (webhook → Wave-4, refund → Wave-5, reconciliation → Wave-5) |
| `/home/z/my-project/P0_TRACEABILITY_MAP.md` | 192 | P0 → invariant map + 8 coverage queries A-H (G-B1 resolved) |
| `/home/z/my-project/P0_DEPENDENCY_GRAPH.md` | 407 | 28 P0 nodes + B/F/P edge types |
| `/home/z/my-project/CRITICAL_PATH.md` | 407 | 7-edge critical path P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-04 → P0-06 → P0-07 |
| `/home/z/my-project/IMPLEMENTATION_ORDER.md` | 298 | 8 waves of P0 implementation order; Wave 4 = P0-02 + P0-05; Wave 5 = P0-04 + P0-03; Wave 6 = P0-06; Wave 7 = P0-07 |
| `/home/z/my-project/PRODUCTION_READINESS_MATRIX.md` | 1024 | v1.4 — 7 launch-gate AND-conditions (§14.1) + 28 P0 capabilities + 14 invariants |
| `/home/z/my-project/P0-27-PHASE2-REMEDIATION.md` | 566 | Phase-2 readiness remediation — 12 open items (operator + Phase-3) |
| `/home/z/my-project/INFRASTRUCTURE_READINESS.md` | 427 | Infrastructure readiness report — 17 blockers (8 staging-blocking, 9 Phase-3 deferred) |
| `/home/z/my-project/docs/STAGING_ARCHITECTURE.md` | 403 | Staging architecture + shared-vs-separate Supabase decision (Option B for prod) + 14-item staging readiness checklist |
| `/home/z/my-project/docs/POSTGRESQL_CUTOVER_PLAN.md` | 311 | 11-step PostgreSQL cutover runbook + 5-scenario rollback strategy |
| `/home/z/my-project/docs/DR_RUNBOOK.md` | 216 | DR runbook — design only; drill NOT executed (Phase-3 launch gate) |
| `/home/z/my-project/docs/TRANSACTION_RETRY_INVARIANT.md` | 559 | Transaction retry invariant — IMPLEMENTED / VERIFIED (Wave-4 4c); §8.2 enforcement items 1, 2, 4, 5 deferred |
| `/home/z/my-project/prisma/schema.prisma` (head) | 50 | Confirmed `provider = "postgresql"` (line 14) |
| `/home/z/my-project/src/lib/deployment.ts` | 103 | Feature flags — all 7 confirmed OFF by default |
| `/home/z/my-project/src/lib/csrf.ts` (head) | 40 | CSRF double-submit cookie — `secure: NODE_ENV==='production'` |
| `/home/z/my-project/src/lib/rate-limit.ts` (head) | 40 | In-memory rate limiter (Redis NOT provisioned) |
| `/home/z/my-project/src/app/api/alerts/evaluate/route.ts` (head) | 40 | On-demand alert evaluation endpoint |
| `/home/z/my-project/vercel.json` | 75 | Vercel config — region `hnd1`, function maxDurations, security headers |
| `/home/z/my-project/package.json` | 103 | Confirmed `razorpay@^2.9.8` + `firebase-admin@^14.2.0` + `firebase@^12.17.1` + `socket.io@^4.8.3` + `@supabase/supabase-js@^2.112.2` installed |
| `/home/z/my-project/.env` (current sandbox) | 1 | `DATABASE_URL=file:/home/z/my-project/db/custom.db` — local SQLite (NOT production) |
| `.github/workflows/` (directory listing) | (35 workflows) | Confirmed: `deploy.yml`, `rollback.yml`, `staging-rollback-drill.yml`, `dev-001-*.yml` (4), `wave{N}-{Nx}-*` migration workflows, `subwave-{Nx}-postgresql-concurrent-evidence.yml` (Wave-3/4), `vercel-preflight.yml`, `vercel-env-config.yml`, `fix-preview-database-url.yml`, `disable-vercel-protection.yml`, `diagnose-db-hostname.yml` |
| `prisma/migrations/` (directory listing) | (2 migrations) | `20260809183236_initial_schema` + `20260809185723_audit_hash_chain` + `migration_lock.toml`. Wave-1..4 sub-wave migrations are in `prisma/scripts/` (applied to staging Supabase only, NOT Prisma migrate-managed) |

### 11.2 Confirmed governance state at end of this Gate Review

```text
Wave-0        ✅ CLOSED
Wave-1        ✅ CLOSED
Wave-2        ✅ CLOSED
Wave-3        ✅ COMPLETE / CLOSED (3a + 3b + 3c)
Wave-4        ✅ COMPLETE / ALL SUB-WAVES CLOSED (4a + 4b + 4c + 4d)

Production Readiness Gate Review:
              ├─ Recommendation: NOT READY
              ├─ 4 P0s LOCKED on critical path (P0-04, P0-03, P0-06, P0-07)
              ├─ 2 launch-gate AND-conditions FAIL (DR drill, rollback drill)
              ├─ All production infrastructure UNPROVISIONED
              ├─ 12 decision points (D1-D12) for Orchestrator resolution
              └─ Path to READY: Wave-5/6/7 + Phase-3 operator provisioning + drills + real-mode evidence

Wave-5                   🔒 LOCKED (recommended for authorization in D1)
Wave-6                   🔒 LOCKED
Wave-7                   🔒 LOCKED
Production               🚫 NOT AUTHORIZED
realPayments             🚫 OFF (default false)
webhookHandler           🚫 OFF in production (default false)
requestHashEnforcement   🚫 OFF in production (default false)
```

### 11.3 STOP — Awaiting Orchestrator decision

This Gate Review is **READ/PLAN-FIRST only**. No implementation has been authorized. No production systems have been touched. No feature flags have been enabled. No Wave-5 implementation has been started. No Wave-4 sub-wave has been reopened.

**The Orchestrator must resolve decision points D1–D12 before any further work proceeds.**

---

**End of Production Readiness Gate Review.**

**Recommendation: NOT READY.** Awaiting Orchestrator decision on the 12 decision points (D1–D12) and authorization of Wave-5 (P0-04 refund + P0-03 reconciliation).

**STOP. No implementation started. No Wave-5 started. No production touched. `realPayments` OFF. `requestHashEnforcement` OFF in production. `webhookHandler` OFF in production. Wave-4 stays CLOSED. Production authorization NOT granted — this Gate Review is advisory only.**
