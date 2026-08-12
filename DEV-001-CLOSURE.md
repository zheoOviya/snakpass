# DEV-001 / P0-22 — Production WORM Closure Instructions

This document explains how to use the artifacts in `prisma/scripts/` + the GitHub Actions workflow `dev-001-closure.yml` to close the DEV-001 / P0-22 (Production WORM) deviation.

---

## Overview

DEV-001 closure requires proving that the application cannot mutate the audit log (`UPDATE` / `DELETE` / `TRUNCATE`) at the **PostgreSQL privilege level** — not just at the SQLite trigger level (which is bypassable via `DROP TRIGGER`).

This is achieved through PostgreSQL role separation:

```text
snakzap_admin (migration owner)
  ├── Full DDL (CREATE/ALTER/DROP)
  ├── Full DML (SELECT/INSERT/UPDATE/DELETE)
  └── Privilege management (GRANT/REVOKE)

snakzap_app (application role)
  ├── SELECT, INSERT, UPDATE, DELETE on operational tables
  ├── SELECT, INSERT on AuditLog (append-only)
  ├── ❌ UPDATE on AuditLog (REVOKE'd)
  ├── ❌ DELETE on AuditLog (REVOKE'd)
  └── ❌ TRUNCATE on AuditLog (REVOKE'd)
```

---

## Artifacts

| File | Purpose |
|---|---|
| `.github/workflows/dev-001-closure.yml` | GitHub Actions workflow — provisions Supabase PostgreSQL + runs full closure sequence |
| `prisma/scripts/postgres-migration.sql` | Schema migration — creates all 9 tables + WORM trigger functions (PostgreSQL syntax) |
| `prisma/scripts/create-roles.sql` | Creates `snakzap_admin` + `snakzap_app` roles with appropriate privileges |
| `prisma/scripts/revoke-worm.sql` | Explicitly REVOKEs UPDATE/DELETE/TRUNCATE on `AuditLog` from `snakzap_app` |
| `prisma/scripts/seed-postgres.sql` | Seeds initial demo data (4 restaurants, 8 menu items, 3 users, 5 kill switches, 1 audit baseline) |
| `prisma/scripts/tamper-test.sh` | 5-test tamper script: positive (INSERT works) + negative (UPDATE/DELETE denied by privilege) |

---

## Required GitHub Secrets

Configure in repo Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Description | Where to get |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase account access token | Supabase Dashboard → Account → Access Tokens → Generate new token |
| `SUPABASE_ORG_ID` | Supabase organization ID | Supabase Dashboard → Account → Organizations → ID |
| `SNAKZAP_PROJECT_NAME` | Name for the new Supabase project (e.g. `snakzap-prod`) | Your choice (lowercase, hyphenated) |
| `SNAKZAP_REGION` | Region for Supabase project | e.g. `ap-south-1` (Mumbai) or `us-east-1` |
| `SUPABASE_DB_PASSWORD` | (Optional) DB password — auto-generated if secret missing | Generate a strong random password, store as secret |

**No credentials are ever logged.** GitHub Actions automatically masks secret values in run logs.

---

## Execution Steps

### Step 1 — Commit the artifacts to the repository

Commit these files to the `main` branch of your GitHub repository:

```text
.github/workflows/dev-001-closure.yml
prisma/scripts/postgres-migration.sql
prisma/scripts/create-roles.sql
prisma/scripts/revoke-worm.sql
prisma/scripts/seed-postgres.sql
prisma/scripts/tamper-test.sh
README.md  (updated)
DEV-001-CLOSURE.md  (this file)
```

### Step 2 — Configure GitHub Secrets

Go to: `https://github.com/zheoOviya/snakpass/settings/secrets/actions`

Add the 4 required secrets listed above. **Never paste secret values in chat.**

### Step 3 — Trigger the workflow

Go to: `https://github.com/zheoOviya/snakpass/actions/workflows/dev-001-closure.yml`

Click **"Run workflow"**.

When prompted for `confirm_production`, type exactly:
```text
PROD-WORM-CLOSURE
```

### Step 4 — Monitor workflow execution

The workflow will execute these jobs in sequence:

1. **verify-trigger** — confirms the confirmation string
2. **provision-postgresql** — provisions Supabase project via Management API (waits for ACTIVE status)
3. **migrate-and-revoke** — runs schema migration + role creation + REVOKE + seed
4. **tamper-test** — runs 5 tests against the PostgreSQL boundary
5. **capture-evidence** — builds consolidated evidence JSON

Expected duration: ~5-10 minutes (Supabase provisioning takes ~2 minutes).

### Step 5 — Capture evidence

After the workflow completes:

1. Download the **`dev-001-closure-evidence`** artifact (contains `dev-001-evidence.json`)
2. Download the **`dev-001-tamper-evidence`** artifact (contains `tamper-results.json`)
3. Copy the workflow run URL (e.g. `https://github.com/zheoOviya/snakpass/actions/runs/...`)
4. Copy the relevant job logs (especially the `tamper-test` job output)

### Step 6 — Submit evidence to IDE

Paste the following into chat with the IDE:

```text
DEV-001 Closure workflow complete.

Workflow Run URL: <paste URL here>
Project Ref: <paste Supabase project ref here>

Evidence JSON:
<paste dev-001-evidence.json content here>

Tamper Test Results:
<paste tamper-results.json content here>
```

The IDE will:
- Parse the evidence
- Append to `WAVE0_GATE_REVIEW.md`
- Declare DEV-001 PASS candidate (subject to independent G/H review)

---

## Tamper Tests (what gets verified)

The `tamper-test.sh` script runs 5 tests as the `snakzap_app` role:

| # | Test | Expected | Why |
|---|---|---|---|
| 1 | INSERT into AuditLog | PASS | App must be able to append audit entries |
| 2 | UPDATE on AuditLog | DENIED | WORM boundary — PostgreSQL privilege denial |
| 3 | DELETE on AuditLog | DENIED | WORM boundary — PostgreSQL privilege denial |
| 4 | Hash-chain integrity | PASS | Chain linkage intact (first entry GENESIS allowed) |
| 5 | snakzap_admin INSERT | PASS | Admin role has full privileges (proves role separation works) |

**All 5 tests must PASS** for DEV-001 closure to be declared.

If any test fails:
- Test 1 fails → INSERT privilege missing → check `create-roles.sql`
- Test 2 or 3 fails (i.e., UPDATE/DELETE succeeds) → WORM boundary broken → check `revoke-worm.sql`
- Test 4 fails → hash-chain broken → check seed data
- Test 5 fails → admin role broken → check `create-roles.sql`

---

## Governance

- **Wave-0 remains HOLD** until DEV-001 evidence is reviewed by an independent G/H reviewer.
- **Wave-1 remains LOCKED** — no implementation work on Wave-1 P0s.
- **P0-25 remains LOCKED** — no concurrency control work.
- **No production launch declared** by this closure — only DEV-001 deviation closure.
- The `verdict` field in evidence JSON will be `PASS_CANDIDATE` (not `PASS`) until G/H review.

---

## Cleanup (optional, after Wave-0 closure)

If you want to destroy the Supabase project after DEV-001 closure is confirmed:

```bash
# Use Supabase CLI or Management API:
curl -X DELETE "https://api.supabase.com/v1/projects/<project_ref>" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```

Or via Supabase Dashboard → Project Settings → General → Delete Project.

**Do not delete the project until Wave-0 is fully CLOSED.**

---

## Troubleshooting

### "Project creation failed" in `provision-postgresql` job

- Verify `SUPABASE_ORG_ID` is correct (not the project name — the org ID)
- Verify `SNAKZAP_PROJECT_NAME` is unique (no existing project with that name)
- Verify the Supabase access token has project-creation scope
- Check Supabase free-tier limits (max 2 active projects per org)

### "Cannot connect to PostgreSQL" in verify step

- Wait longer — Supabase projects take ~2 minutes to become fully ready
- Check the `STATUS` polling output in workflow logs
- Verify the connection string format (pooler URL, port 5432)

### "permission denied for relation AuditLog" on INSERT (Test 1)

- `snakzap_app` role was not granted INSERT on AuditLog
- Re-run `create-roles.sql` (it's idempotent)
- Verify role was created: `SELECT rolname FROM pg_roles WHERE rolname = 'snakzap_app';`

### UPDATE on AuditLog succeeds (Test 2 PASSes when it should FAIL)

- The REVOKE didn't take effect
- Check: `SELECT * FROM information_schema.role_table_grants WHERE table_name = 'AuditLog' AND grantee = 'snakzap_app';`
- Re-run `revoke-worm.sql`
- Ensure the test is running as `snakzap_app` (via `SET ROLE`), not as the superuser

### Hash-chain integrity fails (Test 4)

- Multiple GENESIS entries exist
- Check seed data — only the first entry should have `prevHash = 'GENESIS'`
- The application's `audit()` helper computes the real hash; placeholder hashes in seed will be replaced on next audit call

---

## References

- `PRODUCTION_READINESS_MATRIX.md` — full P0 matrix + invariants
- `WAVE0_GATE_REVIEW.md` — consolidated Wave-0 evidence
- `worklog.md` — development journal with all P0 verification records
- Supabase Management API: https://supabase.com/docs/reference/api/introduction
- PostgreSQL REVOKE: https://www.postgresql.org/docs/current/sql-revoke.html
