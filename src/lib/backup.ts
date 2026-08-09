import { createHash } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

// P0-16 — Backup
// Daily backups; corruption-detection checksum on every backup; backup integrity verified.
// Control/Enabler (preserves data, not a business truth).
//
// In production this would use managed backup (e.g. AWS RDS snapshots, pg_dump to S3).
// In dev (SQLite), we copy the DB file and compute a SHA-256 checksum.

const BACKUP_DIR = join(process.cwd(), 'db', 'backups')
const DB_PATH = join(process.cwd(), 'db', 'custom.db')

export interface BackupResult {
  timestamp: string
  path: string
  checksum: string
  size: number
  ok: boolean
}

// Create a backup with corruption-detection checksum.
export async function createBackup(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(BACKUP_DIR, `backup-${timestamp}.db`)

  try {
    // Ensure backup directory exists
    if (!existsSync(BACKUP_DIR)) {
      await mkdir(BACKUP_DIR, { recursive: true })
    }

    // Read DB file
    const dbData = await readFile(DB_PATH)

    // Compute SHA-256 checksum (corruption detection)
    const checksum = createHash('sha256').update(dbData).digest('hex')

    // Write backup
    await writeFile(backupPath, dbData)

    // Write checksum alongside
    await writeFile(backupPath + '.sha256', checksum)

    return {
      timestamp,
      path: backupPath,
      checksum,
      size: dbData.length,
      ok: true,
    }
  } catch (e) {
    return {
      timestamp,
      path: backupPath,
      checksum: '',
      size: 0,
      ok: false,
    }
  }
}

// Verify a backup's integrity by recomputing its checksum.
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

// List available backups.
export async function listBackups(): Promise<Array<{ name: string; checksum: string }>> {
  // In a real implementation, this would scan the backup directory.
  // For now, return empty — backups are created on demand.
  return []
}
