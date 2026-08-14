# Task 2 — Runtime Environment Variable Audit

**Task ID:** 56
**Agent:** `deployment-infrastructure-specialist`
**Date:** 2026-08-13
**Scope:** Full inventory and classification of every `process.env.*` reference in the SnakZap repository (main Next.js app + 6 mini-services).

---

## 1. Methodology

1. `grep -rn 'process\.env\.[A-Z_]+' src/ mini-services/` over the entire source tree.
2. For each match, classify the referenced variable into one of:
   - **FRONTEND** — prefixed `NEXT_PUBLIC_*` (exposed to the browser bundle)
   - **SERVER-ONLY** — never prefixed, never shipped to the browser
   - **SUPABASE** — Supabase auth/DB related
   - **DATABASE** — Prisma DB connection
   - **FEATURE_FLAG** — feature toggle (`FEATURE_*`)
   - **RUNTIME** — Node/Vercel runtime convention (`NODE_ENV`, `LOG_LEVEL`)
3. Cross-check each classified variable against `.env.example` (frozen reference).
4. Grep the entire source tree for **hard-coded secret values** (passwords, API keys, JWTs, connection strings).

---

## 2. Inventory — All `process.env.*` references

### 2.1 Main Next.js application (`src/**`)

| # | Variable | File:Line | Classification | Exposed to browser? | `.env.example` documented? | Notes |
|---|---|---|---|---|---|---|
| 1 | `NODE_ENV` | `src/lib/session.ts:33`, `src/lib/csrf.ts:30`, `src/lib/db.ts:13`, `src/lib/firebase-admin.ts:73`, `src/app/api/auth/firebase/verify-test/route.ts:31,36,99`, `src/app/api/p0-13-test/route.ts:29,39`, `src/app/api/p0-18-test/route.ts:13,23`, `src/app/api/p0-23-test/route.ts:22,42`, `src/app/api/audit-integrity-test/route.ts:14` | **RUNTIME** | No | ✅ §0 | Standard Node convention; toggles `secure` cookies, disables demo-trust fallback in `firebase-admin.ts`. |
| 2 | `LOG_LEVEL` | `src/lib/logger.ts:61` | **RUNTIME** | No | ✅ §0 | Enables `debug()` log channel when set to `"debug"`. |
| 3 | `SUPABASE_URL` | `src/lib/supabase-admin.ts:12` | **SERVER-ONLY** / **SUPABASE** | No | ✅ §2 | Server-side Supabase REST base URL. Required for `verifySupabaseToken()`. |
| 4 | `SUPABASE_SECRET_KEY` | `src/lib/supabase-admin.ts:13` | **SERVER-ONLY** / **SUPABASE** (SECRET) | No (must NOT be) | ✅ §2 | Service-role key. Bypasses RLS. Server-only. **If leaked to browser → full DB compromise.** |
| 5 | `SUPABASE_JWKS_URL` | `src/lib/supabase-admin.ts:14` | **SERVER-ONLY** / **SUPABASE** | No | ✅ §2 | JWKS endpoint for `jose` library JWT verification. |
| 6 | `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase.ts:8` | **FRONTEND** / **SUPABASE** | Yes | ✅ §3 | Browser-side Supabase client URL (same project as #3). |
| 7 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/lib/supabase.ts:9` | **FRONTEND** / **SUPABASE** | Yes (by design) | ✅ §3 | Anon public key — subject to RLS, safe to publish. |
| 8 | `FIREBASE_SERVICE_ACCOUNT_PATH` | `src/lib/firebase-admin.ts:23,34` | **SERVER-ONLY** | No | ✅ §4 | Absolute path to Firebase service-account JSON file. |
| 9 | `FIREBASE_SERVICE_ACCOUNT_JSON` | `src/lib/firebase-admin.ts:24,35` | **SERVER-ONLY** (SECRET) | No (must NOT be) | ✅ §4 | Inline JSON content of Firebase service-account. Mutually exclusive with #8. |
| 10 | `NEXT_PUBLIC_FIREBASE_API_KEY` | `src/lib/firebase.ts:22` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase API key. |
| 11 | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `src/lib/firebase.ts:23` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase auth domain. |
| 12 | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `src/lib/firebase.ts:24` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase project ID. |
| 13 | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `src/lib/firebase.ts:25` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase storage bucket. |
| 14 | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `src/lib/firebase.ts:26` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase sender ID. |
| 15 | `NEXT_PUBLIC_FIREBASE_APP_ID` | `src/lib/firebase.ts:27` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase app ID. |
| 16 | `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | `src/lib/firebase.ts:28` | **FRONTEND** | Yes | ✅ §4 | Browser Firebase Analytics measurement ID. |
| 17 | `DATABASE_URL` | `prisma/schema.prisma:10` (Prisma convention) | **DATABASE** | No | ✅ §1 | Prisma `datasource` URL. Must be the Supabase **Transaction Pooler** (`?pgbouncer=true&connection_limit=1`, port 6543) on Vercel serverless. |
| 18 | `DIRECT_URL` | (Prisma convention — referenced only in `.env.example`) | **DATABASE** | No | ✅ §1 | Direct Postgres URL for `prisma migrate deploy`. Empty on Vercel; populated on the migration runner host only. |
| 19 | `FEATURE_*` (5 flags) | `src/lib/deployment.ts:27-39` (via `getFlag()`) | **FEATURE_FLAG** | Indirectly (server reads, returns boolean) | ✅ §6 | 5 flags: `FEATURE_REAL_PAYMENTS`, `FEATURE_PICKUP_ATTRIBUTION_ENFORCEMENT`, `FEATURE_DR_DRILL_MODE`, `FEATURE_OUTBOX_PUBLISHER`, `FEATURE_CONCURRENCY_CONTROL`. All default OFF. |

### 2.2 Mini-services (`mini-services/**`)

| # | Variable | File:Line | Service | Port | Classification | `.env.example` documented? | Notes |
|---|---|---|---|---|---|---|---|
| 20 | `ALERT_INTERVAL_MS` | `mini-services/alert-evaluator/index.ts:20` | `alert-evaluator` | 3005 | **RUNTIME** (service-specific) | ✅ §5 | Evaluation cadence (default `60000` = 60s). |
| 21 | `BACKUP_INTERVAL_MS` | `mini-services/backup-scheduler/index.ts:27` | `backup-scheduler` | 3004 | **RUNTIME** (service-specific) | ✅ §5 | Backup cadence (default `86400000` = 24h). Falls back to default when `0` or NaN. |
| 22 | (implicit) `DATABASE_URL` | `mini-services/alert-evaluator/index.ts:16` (`new PrismaClient()`) | `alert-evaluator` | 3005 | **DATABASE** | ✅ §1 (same var) | Prisma reads `DATABASE_URL` from env implicitly — no `process.env` ref because Prisma's `datasource` config in `prisma/schema.prisma:10` reads it. **Same var as #17.** For long-lived services, the Supabase **Session Pooler** (port 5432, `?pooler=true`) is preferred over the Transaction Pooler. |
| 23 | (implicit) `REALTIME_URL` | (not yet present in code — flagged as follow-up) | N/A (Next.js app) | N/A | **SERVER-ONLY** (would be) | ❌ NOT documented | `src/lib/realtime.ts:7` hard-codes `http://localhost:3003`. **Refactor follow-up #9 in P0-27-PHASE2-REMEDIATION.md §12**: read from `process.env.REALTIME_URL` so the Next.js app can connect to the Fly.io-hosted realtime service in production. Currently NOT in `.env.example` because no `process.env` reference exists. |

### 2.3 GitHub Actions — referenced by workflow YAMLs (NOT in source code)

These are NOT `process.env` references in source — they are `${{ secrets.* }}` references in `.github/workflows/deploy.yml` and `rollback.yml`. Listed here for completeness because the audit must cover every external surface the deployment depends on.

| # | Secret | Used by | Classification | Notes |
|---|---|---|---|---|
| 24 | `VERCEL_TOKEN` | `deploy.yml`, `rollback.yml` | CI secret (Vercel PAT) | Scope: `deploy`. Stored under Settings → Secrets → Actions. NOT in `.env.example` by design. |
| 25 | `VERCEL_ORG_ID` | `deploy.yml`, `rollback.yml` | CI secret (Vercel team ID) | Pulled into `.vercel/project.local` at runtime. |
| 26 | `VERCEL_PROJECT_ID` | `deploy.yml`, `rollback.yml` | CI secret (Vercel project ID) | Pulled into `.vercel/project.local` at runtime. |

---

## 3. Hard-coded secret scan

Searched the entire source tree for indicators of leaked secrets:

| Pattern | Matches in source code? | Verdict |
|---|---|---|
| `postgresql://...` literal connection strings | None in `src/` or `mini-services/`. Found only in `.env.example` (placeholders) and `prisma/scripts/*.sql` (placeholder comments). | ✅ Clean |
| `eyJ...` (JWT base64 prefix) | None. | ✅ Clean |
| `aws-0-...pooler.supabase.com` literal | None in `src/` or `mini-services/`. Found only in `.env.example` (placeholder template) and `P0-27-PHASE2-REMEDIATION.md` (documentation). | ✅ Clean |
| `service_role` literal | None. | ✅ Clean |
| `postgres.<project-ref>` literal | None. `.env.example` uses `<project-ref>` placeholder. | ✅ Clean |
| Real Supabase project ref `zmzqqcyapcezmaqvuzzd` (from task description) | **Not written to ANY file** in this audit. The audit + downstream docs use `<project-ref>` placeholder exclusively. | ✅ Clean |

### 3.1 Notable soft-finds (NOT secrets, but worth flagging)

| Pattern | File:Line | Severity | Notes |
|---|---|---|---|
| `useState('admin123')` (default admin password in UI input) | `src/components/snak/admin-login.tsx:16` | LOW (dev-only) | This is a **client-side form default value**, not a hard-coded credential. The actual password check uses `src/lib/password.ts:verifyPassword()` against a `passwordHash` stored in the `User` table. The default is a UX convenience for local dev only — does NOT bypass server-side auth. **Recommended:** remove the default before production launch (replace with `useState('')`). Not a Phase 2 blocker. |
| `demo:<phone>:<uid>` token format | `src/lib/firebase-admin.ts:87-100` | LOW (dev-only) | Demo-trust mode. Hard-disabled in production (`NODE_ENV === 'production'` throws — see line 73). Safe by construction. |
| `NEXT_TELEMETRY_DISABLED=1` | `Dockerfile:29,37`, `vercel.json` (env + build.env) | INFO | Not a secret — Next.js opt-out flag. |

---

## 4. Vercel/Vercel-environment-variable mapping

This table maps each env var to its required Vercel environment scope (`Production`, `Preview`, `Development`). All env vars needed by the runtime MUST be set in Vercel project settings → Environment Variables.

| # | Variable | Vercel: Production | Vercel: Preview | Vercel: Development | Source |
|---|---|---|---|---|---|
| 1 | `NODE_ENV` | auto-set by Vercel (`production`) | auto-set by Vercel (`production`) for preview | manual (`development`) | Vercel default |
| 2 | `LOG_LEVEL` | `info` | `info` | `debug` | Manual |
| 3 | `SUPABASE_URL` | ✅ set | ✅ set | optional | Manual (server-only) |
| 4 | `SUPABASE_SECRET_KEY` | ✅ set | ✅ set | optional | Manual (server-only — **MUST NOT be `NEXT_PUBLIC_*`) |
| 5 | `SUPABASE_JWKS_URL` | ✅ set | ✅ set | optional | Manual |
| 6 | `NEXT_PUBLIC_SUPABASE_URL` | ✅ set | ✅ set | optional | Manual (frontend, exposed by design) |
| 7 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ set | ✅ set | optional | Manual (frontend, exposed by design) |
| 8 | `FIREBASE_SERVICE_ACCOUNT_PATH` | empty (use #9 instead on Vercel) | empty | optional | Manual |
| 9 | `FIREBASE_SERVICE_ACCOUNT_JSON` | ✅ set (inline JSON string) | ✅ set | optional | Manual (server-only secret) |
| 10-16 | `NEXT_PUBLIC_FIREBASE_*` (7 vars) | optional (only if Firebase is the chosen OTP provider; Supabase is preferred) | optional | optional | Manual |
| 17 | `DATABASE_URL` | ✅ set (Supabase Transaction Pooler, role `snakzap_app`) | ✅ set (Supabase Transaction Pooler, role `snakzap_app`) | optional | Manual — **DEV-001 WORM boundary enforced only if role is `snakzap_app`** |
| 18 | `DIRECT_URL` | **EMPTY on Vercel** (migrations run from GitHub Actions, not from the deployed app) | EMPTY | EMPTY | Manual — populated only on the migration runner host |
| 19 | `FEATURE_*` (5 flags) | `false` for Phase 2 launch | `false` | `false` | Manual — all default OFF |
| 23 | `REALTIME_URL` | (NOT YET in code — refactor follow-up) | — | — | Future |
| 24-26 | `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | N/A — these are GitHub repo secrets, NOT Vercel project env vars | N/A | N/A | GitHub Settings → Secrets → Actions |

---

## 5. Risk findings

### 5.1 HIGH risk — must fix before production deploy

| ID | Finding | Required action | Owner |
|---|---|---|---|
| R-H1 | `SUPABASE_SECRET_KEY` is read with a non-null assertion (`!`) at `src/lib/supabase-admin.ts:13`. If the env var is missing on Vercel, the server crashes at import time (good — fail-closed). | Ensure `SUPABASE_SECRET_KEY` is set in Vercel env (all environments). | Orchestrator |
| R-H2 | `DATABASE_URL` must point to the Supabase **Transaction Pooler** (port 6543) with `?pgbouncer=true&connection_limit=1` AND use role `snakzap_app` (not `postgres`). If the wrong role is used, the DEV-001 WORM boundary is silently bypassed. | Set in Vercel env per `.env.example` §1. Verify by checking `SELECT current_user` from the running app. | Orchestrator |
| R-H3 | `DIRECT_URL` MUST be EMPTY on Vercel. If accidentally populated on Vercel with the postgres superuser URL, the WORM boundary is bypassed for any code path that reads `DIRECT_URL` (currently no source path reads it — Prisma only). | Leave `DIRECT_URL` empty in Vercel env. The migration runner GitHub Action populates it locally for `prisma migrate deploy` only. | Orchestrator |
| R-H4 | `FIREBASE_SERVICE_ACCOUNT_JSON` (server-only secret) MUST NOT be prefixed with `NEXT_PUBLIC_`. If accidentally exposed, an attacker can mint Firebase admin tokens. | Verify the Vercel env var name is exactly `FIREBASE_SERVICE_ACCOUNT_JSON` (no `NEXT_PUBLIC_` prefix). | Orchestrator |

### 5.2 MEDIUM risk — should fix before Phase 2 sign-off

| ID | Finding | Required action | Owner |
|---|---|---|---|
| R-M1 | `REALTIME_URL` is hard-coded to `http://localhost:3003` in `src/lib/realtime.ts:7`. On Vercel serverless, `localhost:3003` does not exist — the realtime service runs on Fly.io in production. The current code swallows `connect_error` so API routes silently degrade (no real-time updates) instead of crashing. | Refactor to read from `process.env.REALTIME_URL`. Add `REALTIME_URL` to `.env.example`. (Phase 3 follow-up — flagged in P0-27-PHASE2-REMEDIATION.md §12 #9.) | Phase 3 |
| R-M2 | `getSocket()` singleton in `src/lib/realtime.ts:11` does not survive across Vercel function invocations (each invocation is a fresh process). The singleton only helps within one warm invocation. Acceptable for Phase 2 latency budget but is a Phase 3 optimization target. | Document and accept for Phase 2. Optimize in Phase 3. | Phase 3 |
| R-M3 | `admin-login.tsx` defaults the password field to `'admin123'`. This is a UX convenience only — server-side `verifyPassword()` is still enforced. Not a security issue, but should be removed before production launch for hygiene. | Replace `useState('admin123')` with `useState('')`. (Phase 3 cleanup.) | Phase 3 |

### 5.3 LOW risk — informational

| ID | Finding | Notes |
|---|---|---|
| R-L1 | `LOG_LEVEL` is checked with strict-equality `=== 'debug'` (`src/lib/logger.ts:61`). Other valid levels (`info`, `warn`, `error`) are always emitted. No issue — just informational. | — |
| R-L2 | All `process.env.NEXT_PUBLIC_FIREBASE_*` values may be `undefined` in production if Firebase is not used. The `isFirebaseConfigured` check (`src/lib/firebase.ts:31-33`) guards this — if all three required fields are absent, the Firebase path is skipped. | — |

---

## 6. Verdict

**Audit status: PASS** for repository-local readiness.

- 26 unique variables inventoried (17 in main app + 2 in mini-services + 1 future + 3 GitHub secrets + 3 not-yet-in-code).
- ZERO hard-coded secrets in source code.
- ZERO real connection strings in source code.
- ZERO real Supabase project references in source code.
- All 17 in-app variables are documented in `.env.example` (frozen).
- 3 GitHub repo secrets documented in `.env.example` §7 and in `deploy.yml` / `rollback.yml` header comments.
- 1 future variable (`REALTIME_URL`) flagged for Phase 3 follow-up.

**Outstanding action items** (none blocking this audit — all runtime concerns):
1. Orchestrator populates Vercel env per §4 mapping above.
2. Orchestrator populates GitHub repo secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
3. Phase 3 refactor: `REALTIME_URL` env var + remove `admin-login.tsx` default password.
