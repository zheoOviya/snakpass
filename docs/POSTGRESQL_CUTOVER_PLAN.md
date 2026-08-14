# Task 3 — PostgreSQL Cutover Plan

**Task ID:** 56
**Agent:** `deployment-infrastructure-specialist`
**Date:** 2026-08-13
**Scope:** Repository-local cutover plan for switching SnakZap from SQLite (current dev) to PostgreSQL on Supabase (production). This is a **plan only** — no `schema.prisma` modification, no `.env` modification, no migrations executed.

---

## 1. Current state

| Layer | Current (dev) | Target (production) |
|---|---|---|
| `prisma/schema.prisma` `provider` | `"sqlite"` (line 9 — FROZEN per task constraints) | `"postgresql"` (switch during cutover) |
| `DATABASE_URL` value format | `file:./db/custom.db` | `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` value format | (not used — SQLite has no pooler) | `postgresql://postgres.<project-ref>:<admin-password>@aws-0-<region>.pooler.supabase.com:5432/postgres` (Session Pooler, role `snakzap_admin`) |
| DB runtime role | n/a (SQLite has no roles) | `snakzap_app` (DML only — REVOKE on `AuditLog` UPDATE/DELETE/TRUNCATE per DEV-001 WORM boundary) |
| DB migration role | n/a | `snakzap_admin` (full DDL + DML + privilege management) |
| Schema bootstrap | `prisma migrate dev` writes migrations to `prisma/migrations/*` | Manual `prisma/scripts/postgres-migration.sql` (DEV-001 — frozen, idempotent). Prisma's `migrate deploy` will see the `_prisma_migrations` row already populated and skip. |
| WORM boundary | None (SQLite has no privilege layer) | Database privilege REVOKE + plpgsql triggers (dual defense) |
| Existing seed data | `prisma/seed.ts` (TS) — runs on `db:reset` only | `prisma/scripts/seed-postgres.sql` (DEV-001 — frozen, idempotent) |

---

## 2. Pre-cutover checklist (all MUST be true)

These items must be satisfied BEFORE the cutover sequence in §4 starts. None of them require external mutation — they are verifications.

| # | Check | How to verify | Owner |
|---|---|---|---|
| P-1 | DEV-001 `postgres-migration.sql` is the canonical schema bootstrap script | `git diff HEAD~1 -- prisma/scripts/postgres-migration.sql` returns empty (frozen) | IDE (already verified — file mtime unchanged) |
| P-2 | `prisma/scripts/create-roles.sql` + `prisma/scripts/revoke-worm.sql` + `prisma/scripts/seed-postgres.sql` + `prisma/scripts/tamper-test*.sh/.sql` are present and frozen | `git status prisma/scripts/` shows clean | IDE (already verified) |
| P-3 | Supabase project is provisioned (project ref `zmzqqcyapcezmaqvuzzd`, region `ap-northeast-1`) — per task description | Read-only check: `https://api.supabase.com/v1/projects/<ref>` returns 200 (NOT executed by this agent) | Orchestrator |
| P-4 | Supabase Transaction Pooler endpoint is reachable on `aws-0-ap-northeast-1.pooler.supabase.com:6543` over IPv4 | `nc -zv aws-0-ap-northeast-1.pooler.supabase.com 6543` (NOT executed by this agent) | Orchestrator |
| P-5 | Supabase Session Pooler endpoint is reachable on `aws-0-ap-northeast-1.pooler.supabase.com:5432` over IPv4 | `nc -zv aws-0-ap-northeast-1.pooler.supabase.com 5432` (NOT executed by this agent) | Orchestrator |
| P-6 | GitHub repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` configured | Read-only check: `gh secret list` (NOT executed by this agent) | Orchestrator |
| P-7 | GitHub environments `staging` (no protection) + `production` (required reviewers) configured | Read-only check: `gh api repos/:owner/:repo/environments` (NOT executed by this agent) | Orchestrator |
| P-8 | Vercel project linked to GitHub repo (placeholder project ID — populated by `deploy.yml` at runtime from `VERCEL_PROJECT_ID` secret) | Visual: Vercel dashboard shows the project | Orchestrator |
| P-9 | Vercel project env vars populated per `docs/ENV_VAR_AUDIT.md` §4 | Visual: Vercel dashboard → Settings → Environment Variables | Orchestrator |
| P-10 | Local backup of current SQLite DB taken (rollback safety net) | `cp db/custom.db db/custom.db.pre-cutover.bak` (NOT executed by this agent) | Orchestrator |

---

## 3. Connection string formats

The two roles (`snakzap_app` and `snakzap_admin`) require **distinct** connection strings. They are NEVER interchangeable.

### 3.1 Runtime — `snakzap_app` (Transaction Pooler, port 6543)

Used by the **deployed Vercel app** and any long-lived service that opens a `PrismaClient`. Format:

```text
DATABASE_URL=postgresql://postgres.<project-ref>:<app-password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**Constraints:**
- Hostname: `aws-0-<region>.pooler.supabase.com` (Supabase PgBouncer — IPv4-capable, solves Vercel's IPv6-only egress problem on the direct `db.<ref>.supabase.co` endpoint).
- Port: `6543` (Transaction mode pooler — required for Vercel serverless functions).
- Query params: `?pgbouncer=true&connection_limit=1` — Prisma 6.x compatible (PgBouncer transaction mode). The `connection_limit=1` matches Vercel's "one connection per function invocation" pattern.
- Username: `postgres.<project-ref>` — Supabase's pooler convention (`postgres` is the database name, `<project-ref>` is the project identifier). This is NOT the role name; the role is selected by the password's auth mapping. Wait — see note below.

> **Critical nuance on the role:** Supabase's pooler username format is `postgres.<project-ref>` (the database user is `postgres`). To connect as `snakzap_app`, you must either (a) use a separate database user `snakzap_app` with its own pooler connection string `postgresql://snakzap_app:<app-password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`, OR (b) accept that the application connects as `postgres` superuser (which BYPASSES the WORM boundary — REJECTED).
>
> **Production choice (REQUIRED):** Use the role-named pooler connection string for `snakzap_app`:
> ```text
> DATABASE_URL=postgresql://snakzap_app:<app-password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
> ```
> The `snakzap_app` role is created by `prisma/scripts/create-roles.sql` (DEV-001, frozen). The pooler will authenticate using the role's password.

### 3.2 Migration runner — `snakzap_admin` (Session Pooler, port 5432)

Used by the GitHub Actions runner executing `prisma/scripts/postgres-migration.sql` + `prisma migrate deploy`. Format:

```text
DIRECT_URL=postgresql://snakzap_admin:<admin-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

**Constraints:**
- Hostname: `aws-0-<region>.pooler.supabase.com` (same pooler, different port).
- Port: `5432` (Session mode pooler — required for DDL operations like `CREATE TABLE`, `CREATE TRIGGER`, `GRANT`, `REVOKE`).
- No `?pgbouncer=true` (Session mode does not need it; in fact Prisma migrations DO NOT work over PgBouncer transaction mode — `prisma migrate deploy` opens a long-lived connection that needs session mode).
- Username: `snakzap_admin` — created by `prisma/scripts/create-roles.sql` with `CREATEDB CREATEROLE` (so it can create future tables and grant privileges).
- `DIRECT_URL` MUST be **EMPTY** on the Vercel project env. It is populated only on the migration runner host (GitHub Actions step env, NOT a Vercel env var).

### 3.3 Why two separate strings

| Property | `snakzap_app` (runtime) | `snakzap_admin` (migration) |
|---|---|---|
| Pooler mode | Transaction (port 6543) | Session (port 5432) |
| Reason | Vercel serverless functions cannot hold long-lived connections; Transaction mode multiplexes connections across function invocations. | Prisma migrations need a dedicated session for DDL (`CREATE TABLE`, `CREATE TRIGGER`, `GRANT`, `REVOKE`). Transaction mode breaks these. |
| Privileges on `AuditLog` | SELECT, INSERT only (WORM-protected) | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES (full DDL+DML) |
| Why the asymmetry | The runtime MUST NOT be able to mutate audit history (DEV-001 WORM boundary). The migration runner MUST be able to (initial bootstrap, future schema evolution). | |
| Connection count | `connection_limit=1` per Vercel function invocation | Single persistent connection per migration run |

---

## 4. Cutover sequence (ordered, atomic per step)

Each step below is designed to be **idempotent** (re-running it produces the same state). If a step fails, §5 rollback strategy applies.

### Step 1 — Pre-flight verification (NO MUTATION)

Run all checks from §2 (P-1 through P-10). If any fails, ABORT cutover. None of these steps mutate state.

### Step 2 — Apply schema migration (DESTRUCTIVE — must be `snakzap_admin`)

**Who runs it:** GitHub Actions runner (the `dev-001-sql-execution.yml` workflow already exists for this — see `.github/workflows/dev-001-sql-execution.yml`, frozen).

**How:** The workflow already invokes:

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/postgres-migration.sql
```

Where `$DIRECT_URL` is the `snakzap_admin` Session Pooler connection (§3.2).

**Effect:** Creates all 9 tables (`User`, `OtpRequest`, `Session`, `Restaurant`, `MenuItem`, `Order`, `OrderItem`, `AuditLog`, `KillSwitch`) + `_prisma_migrations` tracking table + WORM trigger functions (`prevent_audit_update`, `prevent_audit_delete`) + `updatedAt` triggers on `Order` + `KillSwitch`.

**Idempotent:** Yes — the SQL uses `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. Re-running produces the same state.

### Step 3 — Create roles (DESTRUCTIVE — must be `snakzap_admin` or `postgres` superuser)

**Who runs it:** Same GitHub Actions workflow (`dev-001-sql-execution.yml`).

**How:**

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/create-roles.sql
```

**Effect:** Creates `snakzap_admin` (CREATEDB CREATEROLE) + `snakzap_app` (NOCREATEDB NOCREATEROLE). Grants schema usage, table privileges, sequence usage. **CRITICAL:** Grants `SELECT, INSERT` on `AuditLog` to `snakzap_app` (NO UPDATE/DELETE — the WORM boundary starts here at the privilege layer).

**Idempotent:** Yes — uses `DO $$ ... IF NOT EXISTS ... $$`.

### Step 4 — Apply REVOKE (DEFENSE-IN-DEPTH — must be `snakzap_admin`)

**Who runs it:** Same GitHub Actions workflow.

**How:**

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/revoke-worm.sql
```

**Effect:** Explicit `REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM snakzap_app`. Verifies via `information_schema.role_table_grants` and **RAISES EXCEPTION** if WORM is violated (script aborts if `snakzap_app` retains any of UPDATE/DELETE/TRUNCATE on `AuditLog`).

**Idempotent:** Yes — `REVOKE` is a no-op if the privilege is already absent. The verification block at lines 33-82 of `revoke-worm.sql` runs unconditionally and prints a notice.

### Step 5 — Seed initial data (DESTRUCTIVE — should be `snakzap_admin` to avoid WORM conflicts)

**Who runs it:** Same GitHub Actions workflow.

**How:**

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/seed-postgres.sql
```

**Effect:** Truncates + inserts initial demo data (4 restaurants, 8 menu items, 3 users, 5 kill switches, 1 audit baseline). The audit baseline entry writes to `AuditLog` — this is why `snakzap_admin` (not `snakzap_app`) must run the seed: `snakzap_app` cannot `TRUNCATE` (which the seed SQL may use for reset).

**Idempotent:** Yes — the seed script is designed to be re-runnable (uses `TRUNCATE ... RESTART IDENTITY CASCADE` before each `INSERT`).

### Step 6 — Run tamper test (VERIFICATION — must be `snakzap_admin`)

**Who runs it:** Same GitHub Actions workflow.

**How:**

```bash
bash prisma/scripts/tamper-test.sh "$DIRECT_URL" > tamper-results.json
```

**Effect:** Five test cases that attempt `UPDATE`, `DELETE`, `TRUNCATE`, `INSERT with bad hash`, and `INSERT with valid hash` against `AuditLog` using `snakzap_app`. The first three MUST fail (WORM boundary holds). The fourth MUST fail (hash mismatch). The fifth MUST succeed (legitimate append).

**Pass criteria:** All 5 tests pass — the script exits 0. If any test fails, ABORT cutover.

### Step 7 — Switch `prisma/schema.prisma` provider (CODE CHANGE — runtime-only)

**Who runs it:** Orchestrator (after Step 6 is verified green).

**What to change:** Line 9 of `prisma/schema.prisma`:

```diff
 datasource db {
-  provider = "sqlite"
+  provider = "postgresql"
   url      = env("DATABASE_URL")
 }
```

**Why this must come AFTER Step 2-6 (not before):**
- If the provider is switched to `postgresql` BEFORE the `postgres-migration.sql` is applied, then `prisma generate` produces a Postgres-targeted client, but no Postgres schema exists yet. The next `prisma migrate dev` or `prisma migrate deploy` would attempt to create tables from the migration history (`prisma/migrations/*`), which is **SQLite-formatted SQL** (e.g., `AUTOINCREMENT` syntax). This causes migration failure.
- The manual `postgres-migration.sql` (DEV-001) hand-translates the schema to PostgreSQL syntax. It also creates the `_prisma_migrations` row so `prisma migrate status` reports "no migrations pending".
- Therefore: schema first, roles second, REVOKE third, seed fourth, tamper test fifth, **THEN** switch provider. After the switch, `bunx prisma generate` produces a Postgres-targeted client. `prisma migrate status` reads the `_prisma_migrations` table and reports "Database schema is up to date".

**Constraint compliance:** This step modifies `prisma/schema.prisma` — which is in the FROZEN list per the task constraints. **This step is NOT performed by this agent.** It is documented here for the Orchestrator to perform at runtime cutover time.

### Step 8 — Regenerate Prisma client (after Step 7)

**Who runs it:** Orchestrator.

**How:**

```bash
bunx prisma generate
```

**Effect:** Regenerates `node_modules/.prisma/client/*` against the PostgreSQL schema. The generated client is committed (or built at deploy time by the Dockerfile's `RUN bunx prisma generate` step — line 26 of `Dockerfile`).

### Step 9 — Deploy to Vercel staging (FIRST RUNTIME DEPLOY)

**Who runs it:** GitHub Actions `deploy.yml` workflow (frozen).

**How:** Push the schema-switched commit to `main`. `deploy.yml` triggers automatically (push to main → staging auto-deploy). It runs:
1. `vercel pull --yes --environment=preview --token=$VERCEL_TOKEN` — fetches project env.
2. `vercel build --token=$VERCEL_TOKEN` — builds Next.js (Node runtime, Bun as installer).
3. `vercel deploy --prebuilt --token=$VERCEL_TOKEN` — deploys to Vercel preview URL.
4. `./scripts/smoke-test.sh "$BASE_URL"` — runs 4-endpoint smoke test.

**Pass criteria:** Smoke test JSON shows `"ok": true`. All 4 endpoints (`/api/health`, `/api/auth/me`, `/api/restaurants`, `/api/kill-switches`) return expected status + body shape.

### Step 10 — Promote to production (MANUAL APPROVAL)

**Who runs it:** Orchestrator (clicks "Approve" in GitHub Actions environment review).

**How:** `deploy.yml` job `deploy-production` runs `vercel promote` to alias the staging deployment to the production domain. Then runs the same smoke test suite against the production URL.

**Pass criteria:** Production smoke test JSON shows `"ok": true`. GitHub Deployment record created with `state: success`.

### Step 11 — Post-cutover verification (RUNTIME)

Run the alert-evaluator's `evaluateAlertRules()` (via `POST /trigger` on `mini-services/alert-evaluator:3005`). The cycle JSON must show:
- `cleanBaseline: true` (no alerts triggered).
- `invariant-violation` rule's metric `invariant_violation_count: 0` (audit hash chain intact).
- `unknown-state-detected` rule's metric `unknown_state_count: 0`.
- `db-unavailable` rule's metric `db_health: 1` (DB reachable).

If any of these are non-zero or non-true, ROLLBACK (see §5).

---

## 5. Rollback strategy if cutover fails

### 5.1 Rollback scenarios by step

| Step failed | Rollback action | Data loss? |
|---|---|---|
| Step 2 (schema migration) | The SQL is idempotent — re-run. If irrecoverable (e.g., partial CREATE TABLE succeeded), `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` and re-run from Step 2. | All DB data lost (acceptable — empty DB at this point). |
| Step 3 (create roles) | Re-run. The `DO $$ IF NOT EXISTS $$` block is idempotent. | None. |
| Step 4 (REVOKE) | Re-run. `REVOKE` is idempotent. | None. |
| Step 5 (seed) | Re-run. `TRUNCATE ... RESTART IDENTITY` ensures clean state. | Demo data only (re-inserted by re-running). |
| Step 6 (tamper test) | Investigate the failing test. Do NOT proceed to Step 7. If a WORM test failed (UPDATE/DELETE/TRUNCATE succeeded against `AuditLog`), the role separation is broken — re-run Step 3 + Step 4, then re-run Step 6. | None. |
| Step 7 (provider switch) | `git revert` the schema.prisma change. The committed state returns to SQLite. | None — the SQLite DB is unchanged. |
| Step 8 (prisma generate) | Re-run `bunx prisma generate`. If fails, check that the `DATABASE_URL` env var is set to the Supabase Transaction Pooler URL (§3.1). | None. |
| Step 9 (staging deploy) | Vercel auto-rolls back if the build fails. If smoke tests fail, the staging deploy is NOT promoted to production — `deploy.yml` halts before the production job. Investigate the smoke test JSON. | None (staging is preview). |
| Step 10 (production promote) | Run `rollback.yml` workflow with `target: <previous production deployment URL>`. The rollback workflow asserts `TOTAL_SECS ≤ 600` (10-minute budget) per P0-27. | None — production traffic is reverted to the prior deployment. The new deployment remains accessible via its preview URL for investigation. |
| Step 11 (post-cutover verification) | If `db-unavailable` rule fires: Vercel function cannot reach Supabase pooler. Check Vercel env var `DATABASE_URL` format (must be `postgresql://...:6543/...?pgbouncer=true&connection_limit=1`). If `invariant-violation` fires: audit hash chain is broken — investigate `AuditLog` for tampering (the WORM should have prevented this; if it didn't, the role is wrong — verify `SELECT current_user` returns `snakzap_app` not `postgres`). | Depends on root cause. |

### 5.2 Last-resort rollback (nuclear option)

If the production PostgreSQL state is unrecoverable:

1. Run `rollback.yml` to revert Vercel production to the **last SQLite-backed deployment** (the previous production deployment before the cutover commit).
2. The previous deployment's env had `DATABASE_URL=file:./db/custom.db` (SQLite). It continues to serve from the local SQLite file embedded in that deployment.
3. The cutover commit is reverted in Git. The next push to `main` redeploys with SQLite.
4. Investigate the PostgreSQL failure offline. The Supabase project remains intact — re-attempt cutover from Step 2 after root cause is fixed.

### 5.3 Time budget

| Phase | Target | Hard limit |
|---|---|---|
| Steps 1-6 (DB-side) | 5 minutes (idempotent re-runs) | 15 minutes |
| Steps 7-8 (code-side) | 2 minutes | 10 minutes |
| Step 9 (staging) | 4 minutes | 10 minutes (deploy.yml timeout) |
| Step 10 (production) | 2 minutes + 20s propagation | 15 minutes (deploy.yml timeout) |
| Step 11 (verification) | 1 minute | 5 minutes |
| **Total cutover** | **14 minutes** | **60 minutes** |
| Rollback (if needed) | 5 minutes | **10 minutes** (rollback.yml hard assertion) |

---

## 6. What this plan does NOT do

Per the task constraints (FORBIDDEN list):

- ❌ Does NOT modify `prisma/schema.prisma` (Step 7 is documented for the Orchestrator to perform at runtime).
- ❌ Does NOT modify `.env.example` (frozen).
- ❌ Does NOT execute any SQL against Supabase.
- ❌ Does NOT run `prisma migrate deploy` or `prisma migrate dev`.
- ❌ Does NOT run `prisma generate`.
- ❌ Does NOT trigger `deploy.yml` or `rollback.yml`.
- ❌ Does NOT write production `DATABASE_URL` or `DIRECT_URL` to any file.
- ❌ Does NOT mutate GitHub secrets or Vercel env vars.
- ❌ Does NOT commit or push.
- ❌ Does NOT use any credentials from chat history.

This plan is documentation only — a runbook for the Orchestrator to execute (or for an automated cutover workflow to consume) at runtime cutover time.

---

## 7. Constraint compliance summary

| Constraint | Compliance | Evidence |
|---|---|---|
| Do NOT modify `prisma/schema.prisma` | ✅ COMPLIANT | This file is read-only — Step 7 documents the change for the Orchestrator. |
| Do NOT write production `DATABASE_URL` to any file | ✅ COMPLIANT | §3 uses `<project-ref>`, `<password>`, `<app-password>`, `<admin-password>` placeholders only. |
| Do NOT execute database migration | ✅ COMPLIANT | Step 2 documents the `psql` command but does NOT run it. |
| Do NOT modify DEV-001 files | ✅ COMPLIANT | `prisma/scripts/postgres-migration.sql`, `create-roles.sql`, `revoke-worm.sql`, `seed-postgres.sql`, `tamper-test*` — all read-only references. |
| Do NOT commit or push | ✅ COMPLIANT | This is a documentation file. No git operations performed. |
| Do NOT use chat-history credentials | ✅ COMPLIANT | Supabase project ref `zmzqqcyapcezmaqvuzzd` is referenced in §2 P-3 as a verification target only — NOT written to any production file. The plan uses `<project-ref>` placeholder in all connection string examples. |
