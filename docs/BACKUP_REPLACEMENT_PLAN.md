# Task 5 — Backup-Scheduler SQLite Dependency Identification & pg_dump Replacement Plan

**Task ID:** 56
**Agent:** `deployment-infrastructure-specialist`
**Date:** 2026-08-13
**Scope:** Identify ALL SQLite-specific dependencies in the current backup implementation (`mini-services/backup-scheduler/index.ts` + `src/lib/backup.ts` + `src/app/api/backup/route.ts`) and design a PostgreSQL-native replacement using `pg_dump` → Supabase Storage (or S3). **NO implementation is performed.**

---

## 1. Current implementation summary

The current backup implementation is split across three files:

| File | Purpose | P0 reference |
|---|---|---|
| `src/lib/backup.ts` | Library: `createBackup()`, `verifyBackup()`, `listBackups()` | P0-16 — Control/Enabler |
| `src/app/api/backup/route.ts` | HTTP API: `POST /api/backup` (admin-triggered), `GET /api/backup` (list) | P0-16 — exposes the library to admins |
| `mini-services/backup-scheduler/index.ts` | Standalone service on port 3004 — runs `setInterval` loop + HTTP `/trigger` + `/evidence` | P0-16 — scheduled execution |

All three share the same SQLite-specific implementation pattern: **read the `db/custom.db` file as a binary blob, compute SHA-256, write to `db/backups/backup-<timestamp>.db` + `db/backups/backup-<timestamp>.db.sha256`**.

---

## 2. SQLite-specific dependency inventory

### 2.1 File path references

| # | File:Line | Reference | SQLite-coupled? | Notes |
|---|---|---|---|---|
| 1 | `src/lib/backup.ts:13` | `const BACKUP_DIR = join(process.cwd(), 'db', 'backups')` | YES (path) | The `db/backups/` directory is the SQLite backup destination. In a PostgreSQL deployment, this directory does not exist (or, if it does, it should not be used for DB backups — Supabase Storage / S3 is the target). |
| 2 | `src/lib/backup.ts:14` | `const DB_PATH = join(process.cwd(), 'db', 'custom.db')` | **YES (CRITICAL)** | This is the SQLite database file path. **On Vercel, this file does not exist** (Vercel serverless uses ephemeral filesystems; the DB is at Supabase PostgreSQL). Calling `readFile(DB_PATH)` throws `ENOENT` — `createBackup()` returns `{ ok: false, error: 'Error: ENOENT: no such file or directory ...' }`. |
| 3 | `mini-services/backup-scheduler/index.ts:20` | `const BACKUP_DIR = join(import.meta.dir, '..', '..', 'db', 'backups')` | YES (path) | Same as #1 — relative to the mini-service's directory. |
| 4 | `mini-services/backup-scheduler/index.ts:21` | `const DB_PATH = join(import.meta.dir, '..', '..', 'db', 'custom.db')` | **YES (CRITICAL)** | Same as #2. |
| 5 | `mini-services/backup-scheduler/index.ts:22` | `const EXECUTION_LOG = join(BACKUP_DIR, 'execution-log.jsonl')` | YES (path) | The execution log is JSONL appended to a file. This is fine to keep on Fly.io (which has persistent volumes) but NOT on Vercel (ephemeral filesystem). |
| 6 | `src/app/api/backup/route.ts` | (no direct path refs — uses `createBackup()` from `src/lib/backup.ts`) | INHERITED | Inherits the SQLite coupling through the library. |

### 2.2 File copy operations

| # | File:Line | Operation | SQLite-coupled? | Notes |
|---|---|---|---|---|
| 7 | `src/lib/backup.ts:36` | `const dbData = await readFile(DB_PATH)` | **YES (CRITICAL)** | Reads the entire SQLite file into memory as a `Buffer`. **FATAL on PostgreSQL** — there is no single file to read; the DB is a network service. |
| 8 | `src/lib/backup.ts:42` | `await writeFile(backupPath, dbData)` | YES | Writes the SQLite blob to disk. PostgreSQL replacement: stream `pg_dump` output to storage (Supabase Storage or S3). |
| 9 | `src/lib/backup.ts:45` | `await writeFile(backupPath + '.sha256', checksum)` | YES (path) | Writes the checksum alongside the backup file. PostgreSQL replacement: store checksum as object metadata (S3 `x-amz-meta-sha256` header) or as a separate small object in the same bucket. |
| 10 | `mini-services/backup-scheduler/index.ts:58` | `const dbData = await readFile(DB_PATH)` | **YES (CRITICAL)** | Same as #7 — duplicate implementation in the mini-service. |
| 11 | `mini-services/backup-scheduler/index.ts:61` | `await writeFile(backupPath, dbData)` | YES | Same as #8. |
| 12 | `mini-services/backup-scheduler/index.ts:62` | `await writeFile(backupPath + '.sha256', checksum)` | YES | Same as #9. |
| 13 | `src/lib/backup.ts:72` | `const backupData = await readFile(backupPath)` (in `verifyBackup()`) | YES | Reads the backup file back to verify checksum. PostgreSQL replacement: download object from S3, compute SHA-256, compare to stored checksum. |
| 14 | `src/lib/backup.ts:74` | `const expectedChecksum = (await readFile(backupPath + '.sha256')).toString().trim()` | YES | Reads the checksum file. PostgreSQL replacement: read object metadata. |

### 2.3 Checksum computation

| # | File:Line | Operation | SQLite-coupled? | Notes |
|---|---|---|---|---|
| 15 | `src/lib/backup.ts:39` | `const checksum = createHash('sha256').update(dbData).digest('hex')` | **NO** (algorithm is portable) | The SHA-256 algorithm is correct for any binary blob. The SQLite coupling is the *source* of `dbData` (the SQLite file), not the algorithm. The replacement uses the same algorithm on `pg_dump` output. |
| 16 | `src/lib/backup.ts:73` | `const actualChecksum = createHash('sha256').update(backupData).digest('hex')` | **NO** | Same — algorithm is portable. |
| 17 | `mini-services/backup-scheduler/index.ts:59` | `const checksum = createHash('sha256').update(dbData).digest('hex')` | **NO** | Same. |
| 18 | `mini-services/backup-scheduler/index.ts:73` | `const actualChecksum = createHash('sha256').update(backupData).digest('hex')` | **NO** | Same. |

### 2.4 SQLite-specific API usage

| # | File:Line | Operation | SQLite-coupled? | Notes |
|---|---|---|---|---|
| 19 | `mini-services/backup-scheduler/index.ts:119-151` | `Bun.serve({ port: PORT, async fetch(req) { ... } })` | **NO** | The HTTP server is portable — it's just a Bun.serve. The endpoints `/health`, `/trigger`, `/evidence` are fine. The only issue is that `/trigger` calls `runBackupCycle()` which calls `createBackupWithChecksum()` which uses the SQLite file. |
| 20 | `mini-services/backup-scheduler/index.ts:158` | `await runBackupCycle()` (immediate on startup) | INHERITED | Inherits the SQLite coupling. |
| 21 | `mini-services/backup-scheduler/index.ts:161-164` | `setInterval(async () => { await runBackupCycle() }, DEV_INTERVAL_MS)` | **NO** (mechanism) | The `setInterval` pattern itself is fine — but on Vercel it cannot be used (no long-lived processes). For Vercel Cron, the equivalent is the cron schedule in `vercel.json` (currently `[]` — empty, pending Phase 3 rewrite). |

### 2.5 Backup audit log integration

| # | File:Line | Operation | SQLite-coupled? | Notes |
|---|---|---|---|---|
| 22 | `src/app/api/backup/route.ts:31-38` | `await db.auditLog.create({ data: { actorId, actorRole, action: 'BACKUP_CREATED', metadata: JSON.stringify({...}) } })` | **NO** | This writes to `AuditLog` via Prisma — portable to PostgreSQL. The audit log entry records the backup event (with checksum + size). The WORM boundary applies here (only `INSERT` is allowed on `AuditLog` for `snakzap_app` role). **Important:** if the backup itself is run by a Vercel Cron function as `snakzap_admin` (for `pg_dump`), the audit log INSERT should be done by a SEPARATE call using `snakzap_app` to preserve the WORM boundary — `snakzap_admin` has `INSERT` on `AuditLog` AND `UPDATE`/`DELETE`, so a bug in the backup code could accidentally mutate audit history. |

### 2.6 Summary

| Category | Count | Coupling severity |
|---|---|---|
| File path references | 6 (items 1-6) | 2 CRITICAL (#2, #4 — the SQLite file path itself), 4 LOW (backup directory + log file — portable to filesystem-backed hosting). |
| File copy operations | 8 (items 7-14) | 2 CRITICAL (#7, #10 — reading the SQLite file), 6 LOW (writing backup files — portable if filesystem exists). |
| Checksum computation | 4 (items 15-18) | 0 — algorithm is portable. |
| SQLite-specific API usage | 3 (items 19-21) | 0 — mechanism is portable. |
| Audit log integration | 1 (item 22) | 0 — Prisma-based, portable. |

**Bottom-line:** The backup implementation has **2 critical SQLite couplings** (the `DB_PATH` reads at `src/lib/backup.ts:36` and `mini-services/backup-scheduler/index.ts:58`) and **8 file-write couplings** that must be replaced with object storage uploads. The SHA-256 algorithm, HTTP server, `setInterval` mechanism, and audit log integration are all portable.

---

## 3. pg_dump replacement implementation plan

### 3.1 Design goals

1. **Production-grade backup format:** `pg_dump` custom format (`-Fc`) — supports parallel restore, selective table restore, compression.
2. **Off-site storage:** Supabase Storage (preferred — same project, no separate S3 account) or AWS S3 (alternative — broader ecosystem, more mature tooling).
3. **Checksum integrity:** SHA-256 of the `pg_dump` output (computed post-dump, stored as object metadata).
4. **Verification:** Re-download the backup, recompute SHA-256, compare to stored checksum.
5. **WORM boundary preservation:** The backup process must NOT use the `snakzap_app` role for `pg_dump` (that role lacks `pg_dump` privileges on system catalogs). It must use `snakzap_admin` (which has full DDL+DML). The audit log INSERT must be done via a SEPARATE connection using `snakzap_app` (which has `INSERT` on `AuditLog`).
6. **Scheduled execution:** Vercel Cron (preferred for simplicity) OR Fly.io `setInterval` (if Vercel Cron's 1-job-on-Hobby-tier limit is hit).
7. **No long-lived filesystem:** Vercel serverless functions have ephemeral filesystems. The `pg_dump` output must be streamed directly to storage (NOT to a temp file). This requires `pg_dump`'s `--file=-` (stdout) option, piped to a storage upload stream.

### 3.2 pg_dump command

The replacement uses `pg_dump` with the following options:

```bash
pg_dump \
  --format=custom \              # -Fc — compressed binary format, supports parallel restore
  --no-owner \                  # strip ownership (so restore works on any role)
  --no-privileges \             # strip GRANT/REVOKE (so restore doesn't fail on role mismatch)
  --compress=9 \                # max compression (smaller backups, slower dump)
  --dbname="$DIRECT_URL" \      # connection string (snakzap_admin role, Session Pooler port 5432)
  --file=-                      # write to stdout (so we can stream to storage)
```

**Role:** `snakzap_admin` (Session Pooler, port 5432). NOT `snakzap_app` (insufficient privileges for `pg_dump`).

**Why custom format (`-Fc`) not plain SQL (`-Fp`):**
- Custom format is ~5x smaller (compression).
- Supports `pg_restore --jobs=N` for parallel restore (faster DR).
- Supports selective table restore (`pg_restore --table=AuditLog`).
- Plain SQL would require `psql` to restore and cannot do selective restore.

**Why `--no-owner --no-privileges`:**
- The backup may need to be restored to a different Supabase project (DR scenario). Stripping ownership + privileges ensures the restore works on any role.
- The WORM boundary is enforced by `revoke-worm.sql` on the target DB — restoring `GRANT`/`REVOKE` from a backup would be redundant and could mask privilege drift.

### 3.3 Storage target

**Primary: Supabase Storage** (preferred for Phase 2).

- Same project, same authentication (Supabase service-role key already in env).
- No separate S3 account needed.
- Bucket: `snakzap-backups` (must be created — Phase 3 follow-up, NOT performed by this agent).
- Object path: `backups/<YYYY>/<MM>/<backup-<timestamp>.dump>`.
- Object metadata: `x-amz-meta-sha256: <checksum>`, `x-amz-meta-size: <bytes>`, `x-amz-meta-pgdump-version: <pg_dump --version>`.

**Alternative: AWS S3** (if Supabase Storage hits quota or for cross-cloud DR).

- Bucket: `snakzap-backups-<account-id>` (must be provisioned — Phase 3 follow-up).
- Object path: same as Supabase Storage.
- Same metadata fields.

**Decision criteria:**
- If Supabase project is on Free tier (1GB Storage): use S3 for backups (backups will exceed 1GB quickly).
- If Supabase project is on Pro tier (8GB Storage): use Supabase Storage for backups (simpler auth, fewer moving parts).
- For Phase 2 staging: use Supabase Storage (smaller DB, simpler).

### 3.4 Checksum computation

The checksum is computed **as the `pg_dump` stream is being uploaded** — NOT after the dump is complete (which would require buffering the entire dump in memory).

**Implementation pattern (TypeScript, using Node streams):**

```typescript
// Pseudocode — NOT actual implementation
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { createUploadStream } from '@supabase/storage-js'  // or @aws-sdk/lib-storage for S3

async function backupPostgres(): Promise<{ ok: boolean; checksum: string; size: number; objectKey: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const objectKey = `backups/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}/backup-${timestamp}.dump`

  const pgDump = spawn('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--compress=9',
    `--dbname=${process.env.DIRECT_URL}`,
    '--file=-',  // stdout
  ])

  const hasher = createHash('sha256')
  let size = 0

  // Pipe pg_dump stdout → hasher + uploader
  // Use a PassThrough stream to fork the data: one branch goes to hasher, one to uploader
  const { PassThrough } = require('stream')
  const tee = new PassThrough()
  pgDump.stdout.pipe(tee)

  // Branch 1: hasher
  const hashPromise = new Promise<string>((resolve, reject) => {
    tee.on('data', (chunk) => { hasher.update(chunk); size += chunk.length })
    tee.on('end', () => resolve(hasher.digest('hex')))
    tee.on('error', reject)
  })

  // Branch 2: uploader (Supabase Storage upload stream)
  const uploadPromise = uploadStream(tee, objectKey)

  // Wait for both
  const [checksum, uploadResult] = await Promise.all([hashPromise, uploadPromise])

  // Set object metadata (checksum, size)
  await setObjectMetadata(objectKey, { 'sha256': checksum, 'size': String(size) })

  return { ok: true, checksum, size, objectKey }
}
```

**Note:** This is a plan / pseudocode. The actual implementation is a Phase 3 follow-up — NOT performed by this agent.

### 3.5 Verification

The `verifyBackup(objectKey)` function:

```typescript
async function verifyBackup(objectKey: string): Promise<{ ok: boolean; expected: string; actual: string }> {
  // 1. Download the object metadata to get the expected checksum
  const metadata = await getObjectMetadata(objectKey)
  const expected = metadata['sha256']

  // 2. Download the object body (streamed)
  const stream = await downloadObjectStream(objectKey)

  // 3. Compute SHA-256 of the downloaded stream
  const hasher = createHash('sha256')
  for await (const chunk of stream) {
    hasher.update(chunk)
  }
  const actual = hasher.digest('hex')

  // 4. Compare
  return { ok: actual === expected, expected, actual }
}
```

### 3.6 Restore procedure (DR runbook)

**When:** Disaster recovery — production DB is corrupt or unavailable.

**Steps:**

1. Provision a NEW Supabase project (DO NOT reuse the corrupt one — restore to a fresh DB to avoid contaminating the recovery).
2. Apply `prisma/scripts/postgres-migration.sql` to create the empty schema (Step 2 of `POSTGRESQL_CUTOVER_PLAN.md`).
3. Apply `prisma/scripts/create-roles.sql` + `revoke-worm.sql` (Steps 3, 4).
4. Download the latest valid backup object from Supabase Storage (or S3).
5. Restore:

   ```bash
   pg_restore \
     --dbname="$DIRECT_URL_NEW" \
     --no-owner \
     --no-privileges \
     --jobs=4 \
     --clean \
     --if-exists \
     backup-<timestamp>.dump
   ```

   - `--jobs=4` — parallel restore (4x faster on multi-core).
   - `--clean --if-exists` — drops existing objects before recreating (idempotent if Step 2 was already applied).
   - `--no-owner --no-privileges` — strips ownership from the backup (matches the dump options in §3.2).

6. Verify the restore:
   - `SELECT COUNT(*) FROM "User";` — should match pre-disaster count.
   - `SELECT COUNT(*) FROM "AuditLog";` — should match.
   - Run the alert-evaluator's `/trigger` endpoint — `cleanBaseline: true` (no alerts).
   - Run `bash prisma/scripts/tamper-test.sh "$DIRECT_URL_NEW"` — all 5 tests pass (WORM boundary intact).

7. Switch the Vercel project env var `DATABASE_URL` to the new Supabase project's pooler URL.
8. Run `rollback.yml` to revert Vercel to the last known-good deployment (if the deployment itself was unhealthy) OR just redeploy (if only the DB was corrupt).

**Time budget:** <30 minutes (assuming the new Supabase project is already provisioned as a warm standby). For tighter RTO, consider a cross-region Supabase replica.

---

## 4. Required env vars (Phase 3 — for the pg_dump rewrite)

These env vars are NOT in the current `.env.example` (frozen — cannot modify). They will be added by the Orchestrator in Phase 3 OR by a follow-up agent with explicit unfreeze authorization.

| Variable | Classification | Used by | Notes |
|---|---|---|---|
| `BACKUP_STORAGE_PROVIDER` | FEATURE_FLAG | backup-scheduler / Vercel Cron | `supabase` (default) or `s3`. Selects the storage backend. |
| `BACKUP_SUPABASE_BUCKET` | SERVER-ONLY | backup-scheduler / Vercel Cron | Supabase Storage bucket name. Default: `snakzap-backups`. |
| `BACKUP_S3_BUCKET` | SERVER-ONLY | backup-scheduler / Vercel Cron | S3 bucket name (only if `BACKUP_STORAGE_PROVIDER=s3`). |
| `BACKUP_S3_REGION` | SERVER-ONLY | backup-scheduler / Vercel Cron | S3 region (e.g., `ap-northeast-1`). |
| `BACKUP_S3_ACCESS_KEY_ID` | SERVER-ONLY (SECRET) | backup-scheduler / Vercel Cron | S3 access key. NOT prefixed with `NEXT_PUBLIC_`. |
| `BACKUP_S3_SECRET_ACCESS_KEY` | SERVER-ONLY (SECRET) | backup-scheduler / Vercel Cron | S3 secret key. NOT prefixed with `NEXT_PUBLIC_`. |
| `BACKUP_RETENTION_DAYS` | RUNTIME | backup-scheduler / Vercel Cron | How long to keep backups before auto-deleting. Default: `30`. |
| `BACKUP_AUDIT_ROLE_DATABASE_URL` | SERVER-ONLY (SECRET) | backup-scheduler / Vercel Cron | A separate `DATABASE_URL` using role `snakzap_app` for writing the audit log entry (after the backup completes). The `pg_dump` itself uses `DIRECT_URL` (role `snakzap_admin`). |

**Note on the audit log role:** If the backup process uses `DIRECT_URL` (role `snakzap_admin`) for both `pg_dump` AND the audit log INSERT, a bug in the backup code could accidentally `UPDATE`/`DELETE` audit history (because `snakzap_admin` has those privileges). To preserve the WORM boundary, the audit log INSERT should use `BACKUP_AUDIT_ROLE_DATABASE_URL` (role `snakzap_app`). This is a defense-in-depth measure.

---

## 5. Migration strategy (SQLite implementation → pg_dump implementation)

### 5.1 Phase 2 (current — DO NOT implement now)

- Keep the SQLite implementation as-is for local dev (`db/custom.db` exists locally).
- The `backup-scheduler` mini-service continues to run in dev mode.
- The `/api/backup` route continues to work for local dev admin testing.
- On Vercel staging: the `/api/backup` route returns 500 (ENOENT) because `db/custom.db` does not exist. **Acceptable for staging** — backup is not part of the smoke test suite (`scripts/smoke-test.sh` tests `/api/health`, `/api/auth/me`, `/api/restaurants`, `/api/kill-switches` — NOT `/api/backup`).

### 5.2 Phase 3 (when implementing)

1. Add the 8 new env vars from §4 to `.env.example` (requires unfreeze authorization).
2. Rewrite `src/lib/backup.ts`:
   - Replace `readFile(DB_PATH)` with `spawn('pg_dump', [...])`.
   - Replace `writeFile(backupPath, dbData)` with `uploadStream(objectKey, dumpStream)`.
   - Keep the SHA-256 algorithm.
   - Add `verifyBackup(objectKey)` using the new download pattern.
   - `listBackups()` becomes a list-objects-in-bucket call.
3. Rewrite `mini-services/backup-scheduler/index.ts` OR move the logic into a Vercel Cron function (`src/app/api/cron/backup/route.ts` — new file).
4. Add `crons` entry to `vercel.json`:
   ```json
   "crons": [
     {
       "path": "/api/cron/backup",
       "schedule": "0 2 * * *"  // 02:00 UTC daily
     }
   ]
   ```
5. Provision Supabase Storage bucket `snakzap-backups` (or S3 bucket).
6. Test the backup cycle against staging:
   - Trigger `/api/cron/backup` manually.
   - Verify object appears in Supabase Storage.
   - Verify `AuditLog` row written with `BACKUP_CREATED` action.
   - Verify `verifyBackup(objectKey)` returns `ok: true`.
7. Test the DR restore:
   - Download the backup object.
   - Restore to a fresh Supabase project.
   - Verify row counts + WORM boundary.

---

## 6. Supabase's daily automated backups (free supplement)

**Important context:** Supabase Pro tier ($25/month) includes daily automated backups of the entire PostgreSQL database (7-day retention). This is a managed service that does NOT require any code from SnakZap.

**Decision:** For Phase 2 staging, rely on Supabase's automated backups. For production, ALSO maintain the `pg_dump` → Supabase Storage implementation for:
1. Cross-project restore capability (Supabase's automated backups can only restore to the same project).
2. On-demand backups (before risky migrations).
3. Longer retention (Supabase Pro is 7 days; the `pg_dump` implementation can do 30+ days).

**Status:** Supabase project tier is unknown (Free vs Pro). Orchestrator should verify before relying on Supabase's automated backups.

---

## 7. What this plan does NOT do

Per the task constraints (FORBIDDEN list):

- ❌ Does NOT implement the `pg_dump` replacement (Phase 3 follow-up).
- ❌ Does NOT modify `src/lib/backup.ts`, `mini-services/backup-scheduler/index.ts`, `src/app/api/backup/route.ts` (frozen for Phase 2 — local dev still uses SQLite).
- ❌ Does NOT provision Supabase Storage bucket or S3 bucket.
- ❌ Does NOT modify `.env.example` (frozen).
- ❌ Does NOT modify `vercel.json`'s `crons` array (kept `[]` for Phase 2).
- ❌ Does NOT commit or push.

This is a **plan only** — documentation for the Phase 3 implementation agent to consume.
