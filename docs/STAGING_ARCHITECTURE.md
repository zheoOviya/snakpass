# Task 6 — Staging Architecture Proposal

**Task ID:** 56
**Agent:** `deployment-infrastructure-specialist`
**Date:** 2026-08-13
**Scope:** Staging architecture for SnakZap Phase 2. Defines what "staging ready" means and provides an ASCII diagram of the staging topology. **NO provisioning is performed.**

---

## 1. Staging architecture diagram

```
                                ┌─────────────────────────────────────────────────┐
                                │   DNS (managed by Vercel — *.vercel.app)         │
                                │                                                  │
                                │   staging URL:  https://snakzap-staging.vercel.app│
                                │   (auto-generated preview URL until alias set)   │
                                └──────────────────────┬──────────────────────────┘
                                                       │
                                                       │ HTTPS (TLS, Vercel-managed)
                                                       │
                                                       ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │                                                                        │
        │   Vercel — Staging environment                                         │
        │   region: hnd1 (Tokyo)  ← chosen to be co-located with Supabase        │
        │                                                                        │
        │   ┌──────────────────────────────────────────────────────────────────┐ │
        │   │  Next.js app (single project, single deployment per push to main)│ │
        │   │                                                                  │ │
        │   │  Routes (all native — no portal shims on Vercel):                │ │
        │   │    /                       (consumer landing)                   │ │
        │   │    /consumer               (consumer portal page)                │ │
        │   │    /vendor                 (vendor portal page)                  │ │
        │   │    /admin                   (admin portal page)                   │ │
        │   │    /api/health              (P0-20 health endpoint)               │ │
        │   │    /api/auth/me             (session check)                       │ │
        │   │    /api/restaurants         (catalog browse)                      │ │
        │   │    /api/kill-switches       (governance)                          │ │
        │   │    /api/orders              (order placement)                      │ │
        │   │    /api/auth/otp/send|verify (phone OTP)                          │ │
        │   │    /api/auth/admin/login|verify                                  │ │
        │   │    /api/auth/supabase/session                                   │ │
        │   │    /api/auth/firebase/session                                   │ │
        │   │    /api/admin/metrics                                            │ │
        │   │    /api/alerts/evaluate                                          │ │
        │   │    /api/audit-logs                                               │ │
        │   │    /api/audit-integrity-test                                     │ │
        │   │    /api/backup              (admin-only — returns 500 on staging) │ │
        │   │    /api/kill-switches/[key]                                      │ │
        │   │    /api/menu/[id]                                                │ │
        │   │    /api/orders/[id]                                              │ │
        │   │    /api/orders/[id]/status                                       │ │
        │   │    /api/restaurants/[id]                                         │ │
        │   │    /api/restaurants/[id]/menu                                    │ │
        │   └────────────────────────┬─────────────────────────────────────────┘ │
        │                            │                                          │
        │                            │ 4 outbound connection types              │
        │                            │                                          │
        └────────────────────────────┼──────────────────────────────────────────┘
                                     │
                ┌────────────────────┼────────────────────┬───────────────────┐
                │                    │                    │                   │
                │ ① DB               │ ② Realtime         │ ③ Auth (JWKS)     │ ④ Audit via DB
                │                    │                    │                   │
                ▼                    ▼                    ▼                   ▼
   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────┐  ┌────────────────────┐
   │ Supabase project    │  │ Fly.io — realtime   │  │ Supabase Auth   │  │ Supabase project   │
   │ (shared staging +   │  │ app: snakzap-       │  │ (JWKS endpoint) │  │ (same as ①)        │
   │  prod — see §2)     │  │  realtime-staging   │  │                  │  │ AuditLog table      │
   │                     │  │ region: nrt (Tokyo) │  │ GET /auth/v1/    │  │ (WORM-protected    │
   │ region: ap-          │  │ size: shared-cpu-1x │  │  .well-known/   │  │  via revoke-worm)   │
   │  northeast-1 (Tokyo) │  │ memory: 512MB       │  │  jwks.json       │  │                    │
   │                     │  │ always-on            │  │                  │  │ Role: snakzap_app  │
   │ Connection string    │  │                     │  │ TLS: yes         │  │ (INSERT only)       │
   │  (Transaction Pooler │  │ URL: https://        │  │                  │  │                    │
   │   port 6543)         │  │  realtime-snakzap-   │  │ URL: https://    │  │                    │
   │                     │  │  staging.fly.dev     │  │  <project-ref>   │  │                    │
   │ Role: snakzap_app   │  │                     │  │  .supabase.co    │  │                    │
   │ (DML + INSERT-only  │  │ WebSocket clients:  │  │  /auth/v1/.well-  │  │                    │
   │  on AuditLog)        │  │  browser → wss://   │  │  known/jwks.json  │  │                    │
   └────────────────────┘  └────────────────────┘  └────────────────┘  └────────────────────┘
                                     ▲                                          │
                                     │                                          │
                                     │ ⑤ socket.io-client (server-side,         │
                                     │   Next.js API route emits events to      │
                                     │   realtime service, which fans out to     │
                                     │   browser clients)                       │
                                     │                                          │
                                     └──────────────────────────────────────────┘

   Browser clients:
     - HTTPS → Vercel staging URL (Next.js app)
     - WSS → Fly.io realtime staging URL (socket.io connection)
       (Browser connects directly to Fly.io — NOT through Vercel)
```

### 1.1 Legend

| Symbol | Meaning |
|---|---|
| `① DB` | Prisma connection to Supabase Transaction Pooler (port 6543). Role `snakzap_app`. |
| `② Realtime` | socket.io-client (server-side) from Next.js API routes → Fly.io realtime service. The realtime service then fans events out to browser clients via WSS. |
| `③ Auth (JWKS)` | `jose` library fetches Supabase JWKS to verify JWT signatures. Cached on the function instance. |
| `④ Audit via DB` | Audit log entries written by the Next.js app via Prisma (`db.auditLog.create()`). Same DB connection as `①`. |
| `⑤ socket.io-client → Fly.io` | The Next.js API route's server-side `socket.io-client` (in `src/lib/realtime.ts`) connects to Fly.io to emit `order:created`, `order:updated`, `killswitch:toggled` events. |

### 1.2 What is NOT in staging

- **No Caddyfile gateway.** The Caddyfile (`/home/z/my-project/Caddyfile`) is a sandbox/dev-only reverse proxy used to route `?XTransformPort=<port>` query params to localhost ports. On Vercel staging, all routing is handled by Vercel's edge network. The Caddyfile is **retired** for staging and production.
- **No portal shims.** `mini-services/consumer-portal`, `vendor-portal`, `admin-portal` are redundant on Vercel — the `/consumer`, `/vendor`, `/admin` paths are served natively by the Next.js app. The portal shims are **retired** for staging and production (kept for local dev only).
- **No `backup-scheduler` mini-service.** Staging relies on Supabase's automated backups (if Pro tier) or accepts that backups are not running in staging (if Free tier). The `pg_dump` rewrite is a Phase 3 follow-up (see `BACKUP_REPLACEMENT_PLAN.md`).
- **No `alert-evaluator` mini-service.** The alert-evaluator needs a long-lived process — it can be deployed to Fly.io for staging, but it is NOT a smoke-test dependency. For staging readiness, alert-evaluator can be deferred to production. If deployed, it connects to the same Supabase project (Session Pooler, port 5432, role `snakzap_app`).
- **No separate Supabase project for staging.** See §2 for the shared-vs-separate decision.

---

## 2. Supabase project topology — shared or separate?

### 2.1 Option A: Shared project (staging + production on same Supabase project)

| Pros | Cons |
|---|---|
| Simpler — no second Supabase project to provision. | Staging writes pollute production data (and vice versa). |
| Same connection strings (only role differs). | Schema migrations applied for staging also affect production. |
| No cross-project latency concerns (all in `ap-northeast-1`). | **DEV-001 WORM boundary is shared** — a staging operator with `snakzap_admin` credentials could mutate production audit history. |
| Single cost line item. | Noisy-neighbor risk — staging load tests can degrade production performance. |

### 2.2 Option B: Separate projects (staging has its own Supabase project)

| Pros | Cons |
|---|---|
| Complete isolation — staging data does not touch production. | Two Supabase projects to provision (doubles the Supabase cost if both are Pro tier). |
| Schema migrations can be tested on staging before production. | Need to apply `prisma/scripts/postgres-migration.sql` + `create-roles.sql` + `revoke-worm.sql` + `seed-postgres.sql` to BOTH projects (runbook duplication). |
| DEV-001 WORM boundary is isolated per environment. | Connection strings differ — must configure Vercel env vars per environment. |
| No noisy-neighbor risk. | Cross-project latency for staging tests that need to call production endpoints. |

### 2.3 Recommendation

**For Phase 2 staging readiness: Option A (shared project).**

**Rationale:**
1. The Supabase project ref `zmzqqcyapcezmaqvuzzd` is already provisioned (per task description). Provisioning a second Supabase project is forbidden under the task constraints.
2. Staging is for testing the DEPLOYMENT pipeline (`deploy.yml`, `rollback.yml`, smoke tests), NOT for testing the DB schema. The schema is already verified by DEV-001 closure (test database with `postgres-migration.sql` applied).
3. The DEV-001 WORM boundary is enforced by the role (`snakzap_app`). Staging and production both use `snakzap_app` for runtime — both inherit the WORM protection.
4. The noisy-neighbor risk is acceptable for staging (low traffic, no load tests planned for Phase 2).

**For Phase 3 production launch: Option B (separate projects).**

**Rationale:**
1. Production must be isolated from staging.
2. Schema migrations for production should be tested on a staging DB first.
3. DEV-001 WORM boundary should be isolated per environment.

**Action required (Phase 3):** Provision a second Supabase project (`snakzap-production`) in `ap-northeast-1`. Apply the DEV-001 SQL scripts to it. Update the Vercel production environment's `DATABASE_URL` to point to the production project. Staging continues to use the original project.

---

## 3. "Staging ready" — definition

Staging is **READY** when ALL of the following are true:

### 3.1 Endpoints accessible

| Endpoint | Method | Expected status | Expected body shape | Smoke test |
|---|---|---|---|---|
| `/api/health` | GET | 200 | `{ status: "ok" | "degraded", ... }` | ✅ `scripts/smoke-test.sh` |
| `/api/auth/me` | GET | 401 | `{ user: null }` | ✅ `scripts/smoke-test.sh` |
| `/api/restaurants` | GET | 200 | `{ restaurants: [...] }` | ✅ `scripts/smoke-test.sh` |
| `/api/kill-switches` | GET | 200 | `{ switches: [...] }` | ✅ `scripts/smoke-test.sh` |
| `/api/orders` (unauthenticated) | GET | 401 | `{ error: { code: "AUTHENTICATION_REQUIRED" } }` | (not in smoke-test — manual check) |
| `/api/admin/metrics` (unauthenticated) | GET | 401 | `{ error: { code: "AUTHENTICATION_REQUIRED" } }` | (not in smoke-test — manual check) |
| `/api/audit-logs` (unauthenticated) | GET | 401 | `{ error: { code: "AUTHENTICATION_REQUIRED" } }` | (not in smoke-test — manual check) |
| `/` (consumer page) | GET | 200 | HTML with `<title>SnakZap</title>` | (not in smoke-test — manual check) |
| `/consumer` | GET | 200 | HTML | (not in smoke-test — manual check) |
| `/vendor` | GET | 200 | HTML | (not in smoke-test — manual check) |
| `/admin` | GET | 200 | HTML (login form) | (not in smoke-test — manual check) |

**Pass criteria:** All 4 smoke-test endpoints return `ok: true` in the structured JSON output of `scripts/smoke-test.sh`.

### 3.2 Environment variables configured

All env vars from `docs/ENV_VAR_AUDIT.md` §4 must be set in the Vercel project's `Preview` environment:

| Variable | Required for staging? | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ YES | Supabase Transaction Pooler, port 6543, role `snakzap_app`. If unset, `/api/health` returns 500 (Prisma throws). |
| `SUPABASE_URL` | ✅ YES | If unset, `/api/auth/supabase/session` crashes at import time. |
| `SUPABASE_SECRET_KEY` | ✅ YES | Same. |
| `SUPABASE_JWKS_URL` | ✅ YES | Same. |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ YES | If unset, browser-side OTP UI fails. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ YES | Same. |
| `NODE_ENV` | auto-set | Vercel sets to `production` for preview environments. This means `firebase-admin.ts` HARD-FAILS on any token verification attempt — staging MUST either (a) not exercise Firebase auth paths, OR (b) configure `FIREBASE_SERVICE_ACCOUNT_JSON`. |
| `LOG_LEVEL` | optional | Defaults to `info` if unset. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | optional | Required only if staging tests Firebase auth. Otherwise, the `/api/auth/firebase/session` route will 500 on token verification (intended — fail-closed). |
| `NEXT_PUBLIC_FIREBASE_*` (7 vars) | optional | Required only if staging tests the browser-side Firebase OTP UI. |
| `DIRECT_URL` | ❌ EMPTY on Vercel | Migrations run from GitHub Actions, not from the deployed app. |
| `FEATURE_*` (5 flags) | optional | All default OFF. Leave OFF for staging. |
| `REALTIME_URL` | (future) | Not yet in code — Phase 3 refactor. If absent, Next.js API routes silently degrade (no real-time updates) but do not crash. |

### 3.3 Smoke tests must pass

The `scripts/smoke-test.sh` script (frozen, NOT modified by this agent) tests 4 endpoints:

```bash
./scripts/smoke-test.sh "https://snakzap-staging.vercel.app"
```

**Pass criteria:** Exit code 0. Output JSON:

```json
{
  "ok": true,
  "baseUrl": "https://snakzap-staging.vercel.app",
  "startedAt": "2026-...",
  "finishedAt": "2026-...",
  "elapsedMs": <number>,
  "checks": [
    { "ok": true, "status": 200, "latencyMs": <number>, "url": "/api/health", "body": { "status": "ok" } },
    { "ok": true, "status": 401, "latencyMs": <number>, "url": "/api/auth/me", "body": { "user": null } },
    { "ok": true, "status": 200, "latencyMs": <number>, "url": "/api/restaurants", "body": { "restaurants": [...] } },
    { "ok": true, "status": 200, "latencyMs": <number>, "url": "/api/kill-switches", "body": { "switches": [...] } }
  ]
}
```

### 3.4 Additional staging checks (manual — not automated)

These are not part of the smoke test suite but should be manually verified after the first staging deploy:

| # | Check | How | Pass criteria |
|---|---|---|---|
| M-1 | Database connection from Vercel function | `curl https://snakzap-staging.vercel.app/api/restaurants` returns 200 with non-empty array | At least 4 restaurants (seeded by `prisma/scripts/seed-postgres.sql`). |
| M-2 | WORM boundary enforced | `curl -X POST https://snakzap-staging.vercel.app/api/audit-integrity-test` returns 200 with hash-chain verification passing | All audit log entries pass hash-chain verification. |
| M-3 | DEV-001 WORM trigger active | Attempt to `UPDATE "AuditLog"` via `psql` as `snakzap_app` (manual, against staging DB) | Error: `AUDIT_WORM: UPDATE rejected — audit log is append-only` |
| M-4 | Cookie security | `curl -v https://snakzap-staging.vercel.app/api/health` shows `Set-Cookie: snakzap_session=...; Secure; HttpOnly; SameSite=Lax` | The `Secure` flag is present (because `NODE_ENV=production` on Vercel preview). |
| M-5 | CSRF protection | `curl -X POST https://snakzap-staging.vercel.app/api/orders` (without CSRF token) returns 403 | `{ error: { code: "VALIDATION_ERROR", message: "CSRF token required" } }` |
| M-6 | Build artifact | Vercel deployment shows "Ready" status with <60s build time | Build succeeds, no `output: "standalone"` warnings. |

### 3.5 Staging DR readiness (DEFERRED to Phase 3)

The following are NOT required for staging readiness but ARE required for production launch:

| # | Item | Phase | Notes |
|---|---|---|---|
| D-1 | `backup-scheduler` deployed and producing daily backups | Phase 3 | See `BACKUP_REPLACEMENT_PLAN.md`. |
| D-2 | `alert-evaluator` deployed to Fly.io | Phase 3 | See `STATEFUL_SERVICES_HOSTING.md` §1.2. |
| D-3 | `realtime` deployed to Fly.io | Phase 3 (or Phase 2 if real-time updates are part of the staging demo) | See `STATEFUL_SERVICES_HOSTING.md` §1.1. |
| D-4 | Rollback drill executed (≤10 minutes) | Phase 3 | `rollback.yml` workflow exists but is NOT executed by this agent. |
| D-5 | Separate Supabase project for production | Phase 3 | See §2 above. |

---

## 4. Caddyfile — still needed?

### 4.1 Local dev (current sandbox)

The `Caddyfile` at `/home/z/my-project/Caddyfile` is a sandbox-only reverse proxy:

```caddy
:81 {
    @transform_port_query {
        query XTransformPort=*
    }
    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort} { ... }
    }
    handle {
        reverse_proxy localhost:3000 { ... }
    }
}
```

It serves two purposes in the sandbox:
1. Routes `?XTransformPort=<port>` requests to localhost mini-services (e.g., browser connects to `/socket.io/?XTransformPort=3003` to reach the realtime service on port 3003).
2. Routes default requests to `localhost:3000` (the Next.js dev server).

### 4.2 Vercel staging + production

**The Caddyfile is NOT used on Vercel.** Vercel handles all routing natively:
- `/api/*` routes are served by Next.js API routes (serverless functions).
- `/_next/*` routes are served by Vercel's CDN (static assets).
- `/consumer`, `/vendor`, `/admin` routes are served by Next.js pages.

**What about `?XTransformPort=` for the realtime service?**

In production, the browser connects DIRECTLY to the Fly.io realtime service URL:

```typescript
io('https://realtime-snakzap-staging.fly.dev', { path: '/' })
```

There is no Caddyfile in front of Fly.io — Fly.io's edge network handles TLS termination and routing. The `?XTransformPort` query param is a sandbox-only convention that is **retired** on staging and production.

### 4.3 Recommendation

- **Local dev sandbox:** Keep Caddyfile as-is (it's the only way to expose multiple localhost ports via a single external port).
- **Vercel staging:** Caddyfile is NOT used. Vercel handles routing.
- **Vercel production:** Caddyfile is NOT used.
- **Fly.io realtime:** Caddyfile is NOT used. Fly.io handles TLS + routing natively.

**Action:** No Caddyfile changes needed for staging. The existing Caddyfile is preserved for local dev.

---

## 5. Vercel environment separation (Preview vs Production)

Vercel projects have three built-in environments:
1. **Production** — the production deployment (aliased to the production domain).
2. **Preview** — every non-production deployment (every push to a branch, every preview URL).
3. **Development** — local `vercel dev`.

For staging, we use the **Preview** environment. The `deploy.yml` workflow deploys to preview (`vercel deploy --prebuilt`) and then promotes to production (`vercel promote`) only after manual approval.

### 5.1 Vercel env var scoping

Each env var can be scoped to one or more of: `Production`, `Preview`, `Development`.

| Variable | Production | Preview | Development | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | ✅ prod Supabase project | ✅ staging Supabase project (same as prod in Phase 2 — see §2) | local SQLite | Different values per env. |
| `SUPABASE_SECRET_KEY` | ✅ prod project | ✅ staging project (same in Phase 2) | optional | Same project, same key in Phase 2. |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ prod URL | ✅ staging URL | optional | Same URL in Phase 2. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ prod anon key | ✅ staging anon key | optional | Same key in Phase 2. |
| `NODE_ENV` | `production` (auto) | `production` (auto for preview) | `development` | Vercel auto-sets. |
| `LOG_LEVEL` | `info` | `info` | `debug` | |
| `FEATURE_*` | `false` | `false` | `false` | All flags OFF for Phase 2. |
| `DIRECT_URL` | empty | empty | empty | Migrations run from GitHub Actions only. |

### 5.2 Promotion path

```
push to feature branch
   │
   ▼
CI runs (ci.yml — lint + build)
   │
   ▼ (CI passes)
push to main (or merge PR)
   │
   ▼
deploy.yml triggers
   │
   ├── ci-gate (verify CI passed on same SHA)
   │
   ▼
deploy-staging (vercel deploy --prebuilt → preview URL)
   │
   ├── smoke-test.sh against preview URL
   │
   ▼ (smoke tests pass)
[manual approval gate — GitHub environment "production" required reviewers]
   │
   ▼
deploy-production (vercel promote → production domain)
   │
   ├── smoke-test.sh against production URL
   │
   ▼
evidence artifact uploaded (90-day retention)
```

---

## 6. Staging readiness checklist

For the Orchestrator to declare "staging ready":

| # | Item | Owner | Blocking? | Notes |
|---|---|---|---|---|
| S-1 | GitHub repo secrets configured (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) | Orchestrator | YES | Per `P0-27-PHASE2-REMEDIATION.md` §12 #3. |
| S-2 | GitHub environments `staging` + `production` configured | Orchestrator | YES | Per §12 #4, #5. |
| S-3 | Vercel project linked to GitHub repo | Orchestrator | YES | Per §12 #6. |
| S-4 | Vercel project env vars populated (Preview env) per §5.1 | Orchestrator | YES | Per §12 #7, #8. |
| S-5 | Supabase project has DEV-001 SQL applied (schema + roles + WORM + seed) | Orchestrator | YES | Per §12 #2. Already verified by DEV-001 closure. |
| S-6 | `prisma/schema.prisma` provider switched to `postgresql` | Orchestrator | YES | Per `POSTGRESQL_CUTOVER_PLAN.md` Step 7. (After DEV-001 SQL applied.) |
| S-7 | `bunx prisma generate` regenerates client against PostgreSQL schema | Orchestrator | YES | Per `POSTGRESQL_CUTOVER_PLAN.md` Step 8. |
| S-8 | First push to `main` triggers `deploy.yml` → staging preview URL | Orchestrator | YES | Auto-trigger after S-1 through S-7. |
| S-9 | Smoke tests pass against staging URL | Orchestrator | YES | Auto-verified by `deploy.yml` job `deploy-staging` step `smoke`. |
| S-10 | Manual checks M-1 through M-6 (§3.4) verified | Orchestrator | YES | Manual verification after first staging deploy. |
| S-11 | Rollback drill executed (≤10 minutes) | Orchestrator | DEFERRED (Phase 3) | Per `rollback.yml` — NOT executed by this agent. |
| S-12 | `realtime` service deployed to Fly.io | Orchestrator | DEFERRED (Phase 3) | Real-time updates not part of smoke test suite. |
| S-13 | `alert-evaluator` service deployed to Fly.io | Orchestrator | DEFERRED (Phase 3) | Alert evaluation not part of smoke test suite. |
| S-14 | `backup-scheduler` rewritten with `pg_dump` | Orchestrator | DEFERRED (Phase 3) | See `BACKUP_REPLACEMENT_PLAN.md`. |

**Staging is READY when S-1 through S-10 are all complete.**

---

## 7. What this proposal does NOT do

Per the task constraints (FORBIDDEN list):

- ❌ Does NOT provision Vercel project.
- ❌ Does NOT provision Fly.io apps.
- ❌ Does NOT provision Supabase Storage bucket.
- ❌ Does NOT modify `Caddyfile`.
- ❌ Does NOT modify `.env.example`.
- ❌ Does NOT execute `deploy.yml` or `rollback.yml`.
- ❌ Does NOT commit or push.

This is a **proposal only** — documentation for the Orchestrator to consume when provisioning staging.
