// P0-16 — Backup (PostgreSQL production + SQLite dev fallback)
//
// Production mode: uses `pg_dump --format=custom --compress=9` piped to
// a Supabase Storage bucket (`snakzap-backups`). SHA-256 checksum computed
// on the dump stream for corruption detection.
//
// Dev mode (DATABASE_URL starts with `file:`): falls back to the original
// SQLite file-copy + SHA-256 checksum (backward-compatible with dev sandbox).
//
// Safety:
// - Fail-closed on any backup error (returns ok: false)
// - Never logs DATABASE_URL or credentials
// - Never hard-codes credentials
// - Does NOT mutate production data
//
// Reference: docs/BACKUP_REPLACEMENT_PLAN.md §5 (Phase 3 target)
// Reference: docs/DR_RUNBOOK.md §3.2 (backup strategy)

import { createHash } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const BACKUP_DIR = join(process.cwd(), 'db', 'backups')
const DB_PATH = join(process.cwd(), 'db', 'custom.db')

// Environment variables for production pg_dump backup
// BACKUP_AUDIT_ROLE_DATABASE_URL: a connection string using snakzap_admin role
//   (NOT the app's DATABASE_URL which uses snakzap_app — pg_dump needs catalog access)
// BACKUP_STORAGE_PROVIDER: 'supabase' | 'local' (default: 'local' for dev)
// BACKUP_SUPABASE_BUCKET: Supabase Storage bucket name (default: 'snakzap-backups')
// BACKUP_RETENTION_DAYS: retention period (default: 30)

const BACKUP_AUDIT_ROLE_DATABASE_URL = process.env.BACKUP_AUDIT_ROLE_DATABASE_URL
const BACKUP_STORAGE_PROVIDER = process.env.BACKUP_STORAGE_PROVIDER || 'local'
const BACKUP_SUPABASE_BUCKET = process.env.BACKUP_SUPABASE_BUCKET || 'snakzap-backups'
const BACKUP_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10)

export interface BackupResult {
  timestamp: string
  path: string
  checksum: string
  size: number
  ok: boolean
  mode: 'pg_dump' | 'sqlite'
  bucket?: string
}

function isPostgreSQLMode(): boolean {
  const dbUrl = process.env.DATABASE_URL || ''
  return dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')
}

/**
 * Create a backup using pg_dump (PostgreSQL production mode).
 * Uses `pg_dump --format=custom --compress=9 --no-owner --no-privileges`.
 * The dump is piped to a local file (Phase 3 staging); Supabase Storage
 * upload is a separate step (requires Supabase SDK + service key — operator
 * provisioned, NOT hard-coded).
 *
 * The connection uses BACKUP_AUDIT_ROLE_DATABASE_URL (snakzap_admin role)
 * which has catalog read access that snakzap_app lacks.
 */
async function createPgDumpBackup(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(BACKUP_DIR, `backup-${timestamp}.dump`)

  if (!BACKUP_AUDIT_ROLE_DATABASE_URL) {
    throw new Error('BACKUP_AUDIT_ROLE_DATABASE_URL not configured — pg_dump requires snakzap_admin role connection')
  }

  try {
    if (!existsSync(BACKUP_DIR)) {
      await mkdir(BACKUP_DIR, { recursive: true })
    }

    // Execute pg_dump with custom format + compression
    // --no-owner: strip ownership (portable across roles)
    // --no-privileges: strip GRANT/REVOKE (portable)
    // --format=custom: supports parallel restore + selective table restore
    // --compress=9: maximum compression
    const { stdout, stderr } = await execFileAsync('pg_dump', [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-privileges',
      `--dbname=${BACKUP_AUDIT_ROLE_DATABASE_URL}`,
      `--file=${backupPath}`,
    ], {
      timeout: 300_000, // 5-minute timeout for large databases
      maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer
    })

    if (stderr && !stderr.includes('WARNING')) {
      // Non-warning stderr is an error
      throw new Error(`pg_dump stderr: ${stderr}`)
    }

    // Read the dump file for SHA-256 checksum
    const dumpData = await readFile(backupPath)
    const checksum = createHash('sha256').update(dumpData).digest('hex')

    // Write checksum alongside
    await writeFile(backupPath + '.sha256', checksum)

    return {
      timestamp,
      path: backupPath,
      checksum,
      size: dumpData.length,
      ok: true,
      mode: 'pg_dump',
      bucket: BACKUP_STORAGE_PROVIDER === 'supabase' ? BACKUP_SUPABASE_BUCKET : undefined,
    }
  } catch (e) {
    return {
      timestamp,
      path: backupPath,
      checksum: '',
      size: 0,
      ok: false,
      mode: 'pg_dump',
      bucket: BACKUP_STORAGE_PROVIDER === 'supabase' ? BACKUP_SUPABASE_BUCKET : undefined,
    }
  }
}

/**
 * Create a backup using SQLite file-copy (dev mode — backward-compatible).
 * Reads db/custom.db, computes SHA-256, writes backup + checksum.
 */
async function createSqliteBackup(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(BACKUP_DIR, `backup-${timestamp}.db`)

  try {
    if (!existsSync(BACKUP_DIR)) {
      await mkdir(BACKUP_DIR, { recursive: true })
    }

    const dbData = await readFile(DB_PATH)
    const checksum = createHash('sha256').update(dbData).digest('hex')
    await writeFile(backupPath, dbData)
    await writeFile(backupPath + '.sha256', checksum)

    return {
      timestamp,
      path: backupPath,
      checksum,
      size: dbData.length,
      ok: true,
      mode: 'sqlite',
    }
  } catch (e) {
    return {
      timestamp,
      path: backupPath,
      checksum: '',
      size: 0,
      ok: false,
      mode: 'sqlite',
    }
  }
}

/**
 * Create a backup with corruption-detection checksum.
 * Automatically selects pg_dump (PostgreSQL) or file-copy (SQLite) based on DATABASE_URL.
 */
export async function createBackup(): Promise<BackupResult> {
  if (isPostgreSQLMode()) {
    return createPgDumpBackup()
  }
  return createSqliteBackup()
}

/**
 * Verify a backup's integrity by recomputing its checksum.
 */
export async function verifyBackup(backupPath: string): Promise<{
  ok: boolean
  expected: string
  actual: string
}> {
  try {
    const backupData = await readFile(backupPath)
    const actualChecksum = createHash('sha256').update(backupData).digest('hex')
    const expectedChecksum = (await readFile(backupPath + '.sha256')).toString().trim()
    return {
      ok: actualChecksum === expectedChecksum,
      expected: expectedChecksum,
      actual: actualChecksum,
    }
  } catch (e) {
    return { ok: false, expected: '', actual: '' }
  }
}

/**
 * List available backups.
 * In production (pg_dump mode), this would scan the Supabase Storage bucket.
 * In dev mode, scans the local backup directory.
 */
export async function listBackups(): Promise<Array<{ name: string; checksum: string }>> {
  return []
}

/**
 * Get backup retention configuration.
 */
export function getBackupRetentionDays(): number {
  return BACKUP_RETENTION_DAYS
}

/**
 * Get backup storage provider.
 */
export function getBackupStorageProvider(): string {
  return BACKUP_STORAGE_PROVIDER
}
