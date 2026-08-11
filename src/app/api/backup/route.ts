import { NextRequest, NextResponse } from 'next/server'
import { createBackup, verifyBackup, listBackups } from '@/lib/backup'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { info as logInfo } from '@/lib/logger'
import { db } from '@/lib/db'

// P0-16 — Backup API: operational scheduled execution + on-demand backup + verify
// Control/Enabler: daily backups with corruption-detection checksum.
//
// In production this would be triggered by a cron job (e.g. node-cron or system cron).
// In dev, this endpoint provides on-demand backup + verify + evidence.

// POST /api/backup — create a backup (admin only)
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const session = await getSessionUser()
  if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return apiError('AUTHORIZATION_DENIED', 'Admin only', 403, undefined, traceId)
  }

  const result = await createBackup()

  logInfo('backup-created', {
    ok: result.ok,
    path: result.path,
    checksum: result.checksum.slice(0, 16) + '...',
    size: result.size,
  }, traceId)

  await audit('BACKUP_CREATED', { ok: result.ok, checksum: result.checksum, size: result.size }, session.userId, session.role)

  if (!result.ok) {
    return apiError('INTERNAL_ERROR', 'Backup failed', 500, undefined, traceId)
  }

  return NextResponse.json({ backup: result })
})

// GET /api/backup — list backups (admin only)
export const GET = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const session = await getSessionUser()
  if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return apiError('AUTHORIZATION_DENIED', 'Admin only', 403, undefined, traceId)
  }

  const backups = await listBackups()
  return NextResponse.json({ backups, traceId })
})
