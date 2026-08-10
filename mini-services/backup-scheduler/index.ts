// P0-16 — Scheduled backup service
// Runs daily backup at a configured interval (default: every 24h).
// Also runs an immediate backup on startup to evidence execution.
//
// In production this would be a cron job or scheduled cloud function.
// Here it's a standalone bun process that:
//   1. Creates a backup with SHA-256 checksum
//   2. Verifies the backup integrity
//   3. Logs execution to stdout (structured JSON)
//   4. Records evidence in a backup-execution log file
//   5. Handles failure path (logs error, continues next cycle)
//
// Evidence output: /home/z/my-project/db/backups/execution-log.jsonl

import { createHash } from 'crypto'
import { readFile, writeFile, mkdir, appendFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const BACKUP_DIR = join(import.meta.dir, '..', '..', 'db', 'backups')
const DB_PATH = join(import.meta.dir, '..', '..', 'db', 'custom.db')
const EXECUTION_LOG = join(BACKUP_DIR, 'execution-log.jsonl')
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const PORT = 3004

// For dev/testing: shorter interval to evidence execution quickly
const DEV_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || '0', 10) || BACKUP_INTERVAL_MS

interface BackupExecution {
  timestamp: string
  status: 'success' | 'failed'
  backupPath: string
  checksum: string
  size: number
  verifyOk: boolean
  verifyDetail?: string
  error?: string
}

async function logExecution(entry: BackupExecution): Promise<void> {
  if (!existsSync(BACKUP_DIR)) {
    await mkdir(BACKUP_DIR, { recursive: true })
  }
  await appendFile(EXECUTION_LOG, JSON.stringify(entry) + '\n')
  // Also log to stdout (structured JSON)
  console.log(JSON.stringify(entry))
}

async function createBackupWithChecksum(): Promise<{ ok: boolean; path: string; checksum: string; size: number; error?: string }> {
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

    return { ok: true, path: backupPath, checksum, size: dbData.length }
  } catch (e) {
    return { ok: false, path: backupPath, checksum: '', size: 0, error: String(e) }
  }
}

async function verifyBackupIntegrity(backupPath: string, expectedChecksum: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const backupData = await readFile(backupPath)
    const actualChecksum = createHash('sha256').update(backupData).digest('hex')
    const ok = actualChecksum === expectedChecksum
    return { ok, detail: ok ? 'checksum matches' : `mismatch: expected ${expectedChecksum.slice(0, 16)}..., got ${actualChecksum.slice(0, 16)}...` }
  } catch (e) {
    return { ok: false, detail: String(e) }
  }
}

async function runBackupCycle(): Promise<BackupExecution> {
  const timestamp = new Date().toISOString()

  // Step 1: Create backup
  const backupResult = await createBackupWithChecksum()

  if (!backupResult.ok) {
    const entry: BackupExecution = {
      timestamp,
      status: 'failed',
      backupPath: backupResult.path,
      checksum: '',
      size: 0,
      verifyOk: false,
      error: backupResult.error,
    }
    await logExecution(entry)
    return entry
  }

  // Step 2: Verify backup integrity
  const verifyResult = await verifyBackupIntegrity(backupResult.path, backupResult.checksum)

  const entry: BackupExecution = {
    timestamp,
    status: verifyResult.ok ? 'success' : 'failed',
    backupPath: backupResult.path,
    checksum: backupResult.checksum,
    size: backupResult.size,
    verifyOk: verifyResult.ok,
    verifyDetail: verifyResult.detail,
  }

  await logExecution(entry)
  return entry
}

// HTTP server for health check + manual trigger
const httpServer = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'snakzap-backup-scheduler', port: PORT })
    }

    if (url.pathname === '/trigger' && req.method === 'POST') {
      const result = await runBackupCycle()
      return Response.json(result)
    }

    if (url.pathname === '/evidence') {
      try {
        const log = await readFile(EXECUTION_LOG, 'utf-8')
        const entries = log.trim().split('\n').map((l) => JSON.parse(l))
        return Response.json({
          totalExecutions: entries.length,
          successful: entries.filter((e: BackupExecution) => e.status === 'success').length,
          failed: entries.filter((e: BackupExecution) => e.status === 'failed').length,
          lastExecution: entries[entries.length - 1] || null,
          entries,
        })
      } catch {
        return Response.json({ totalExecutions: 0, entries: [] })
      }
    }

    return new Response('SnakZap backup-scheduler. Endpoints: /health, /trigger (POST), /evidence', { status: 200 })
  },
})

console.log(`[snakzap-backup-scheduler] listening on port ${PORT}`)
console.log(`[snakzap-backup-scheduler] backup interval: ${DEV_INTERVAL_MS}ms (${DEV_INTERVAL_MS / 1000 / 60} min)`)

// Run immediate backup on startup (evidence of execution)
console.log('[snakzap-backup-scheduler] running immediate backup on startup...')
await runBackupCycle()

// Schedule periodic backups
setInterval(async () => {
  console.log('[snakzap-backup-scheduler] scheduled backup cycle starting...')
  await runBackupCycle()
}, DEV_INTERVAL_MS)

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[snakzap-backup-scheduler] SIGTERM received, shutting down...')
  httpServer.stop()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[snakzap-backup-scheduler] SIGINT received, shutting down...')
  httpServer.stop()
  process.exit(0)
})
