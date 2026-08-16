// P0-03 Wave-5 Sub-Wave 5b — Reconciliation Worker (detection-only)
//
// Standalone Bun service that runs reconciliation cycles on a configurable
// interval. Mirrors the outbox-publisher + alert-evaluator mini-service pattern.
//
// SAFETY CONTRACT (Orchestrator hard boundary):
//   This service NEVER writes to Payment, Refund, LedgerEntry, Outbox,
//   WebhookEvent, IdempotencyKey, or AuditLog. It NEVER makes external
//   Razorpay API calls. It NEVER triggers capture / refund / outbox enqueue.
//   It NEVER performs automatic financial correction.
//
//   Its only writes are to:
//     - ReconciliationRun (run lifecycle + summary counts)
//     - ReconciliationFinding (mismatch audit trail, idempotent)
//     - ExceptionQueue (via reportInvariantViolation() for CRITICAL/HIGH findings)
//
// Endpoints:
//   GET /           — health check
//   POST /trigger   — manual trigger (runs one reconciliation cycle)
//   GET /findings   — list recent findings (query: ?unresolvedOnly=true&limit=50)
//   GET /runs       — list recent runs (query: ?limit=20)
//   GET /mismatch-count — current unresolved mismatch count (for alert-evaluator)
//
// Port: 3010 (configurable via RECONCILIATION_PORT env var)

import { PrismaClient } from '@prisma/client'
import { appendFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

// Import the detection library + helpers from the Next.js app via relative path.
// The reconciliation.ts module uses the shared `db` client from src/lib/db.ts
// (which globalThis-caches in dev). For the standalone Bun service, we set
// the global prisma client BEFORE importing reconciliation.ts so the shared
// instance is used.
const PORT = parseInt(process.env.RECONCILIATION_PORT || '3010', 10)
const POLL_INTERVAL_MS = parseInt(process.env.RECONCILIATION_POLL_INTERVAL_MS || '3600000', 10) // default 1 hour
const LOG_DIR = join(import.meta.dir, '..', '..', 'db')
const LOG_FILE = join(LOG_DIR, 'reconciliation-log.jsonl')

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {})
}

// Set up the shared PrismaClient on globalThis BEFORE importing reconciliation.ts
// so that src/lib/db.ts picks up this instance (it checks globalForPrisma.prisma).
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient()
}

// NOW import the reconciliation library — it will use the globalForPrisma instance.
const { runReconciliation, listRecentRuns, listFindings, getMismatchCount } =
  await import('../../src/lib/reconciliation.ts')

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  runId?: string
  trigger?: string
  findingsCount?: number
  mismatchCount?: number
  error?: string
}

async function log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
  const full: LogEntry = { ...entry, timestamp: new Date().toISOString() }
  const line = JSON.stringify(full)
  console.log(line)
  await appendFile(LOG_FILE, line + '\n').catch(() => {})
}

/**
 * Run one reconciliation cycle.
 */
async function runOnce(trigger: 'cron' | 'manual' | 'evidence' = 'cron') {
  const result = await runReconciliation(trigger)
  await log({
    level: result.status === 'COMPLETED' ? 'info' : 'error',
    message: result.status === 'COMPLETED' ? 'reconciliation-cycle-complete' : 'reconciliation-cycle-failed',
    runId: result.runId,
    trigger: result.trigger,
    findingsCount: result.findingsCount,
    mismatchCount: result.mismatchCount,
    error: result.lastError,
  })
  return result
}

// Bun HTTP server
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // GET / — health check
    if (url.pathname === '/' && req.method === 'GET') {
      return Response.json({
        status: 'ok',
        service: 'reconciliation',
        port: PORT,
        pollIntervalMs: POLL_INTERVAL_MS,
        safetyContract: 'detection-only — never writes to money-state tables',
      })
    }

    // POST /trigger — manual trigger (runs one reconciliation cycle)
    if (url.pathname === '/trigger' && req.method === 'POST') {
      try {
        const result = await runOnce('manual')
        return Response.json({ ok: true, result })
      } catch (error) {
        await log({ level: 'error', message: 'trigger-error', error: (error as Error).message })
        return Response.json({ ok: false, error: (error as Error).message }, { status: 500 })
      }
    }

    // GET /findings — list recent findings (query: ?unresolvedOnly=true&limit=50)
    if (url.pathname === '/findings' && req.method === 'GET') {
      const unresolvedOnly = url.searchParams.get('unresolvedOnly')
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
      const findings = await listFindings({
        unresolvedOnly: unresolvedOnly === null ? true : unresolvedOnly !== 'false',
        limit,
      })
      return Response.json({ ok: true, findings })
    }

    // GET /runs — list recent runs (query: ?limit=20)
    if (url.pathname === '/runs' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
      const runs = await listRecentRuns(limit)
      return Response.json({ ok: true, runs })
    }

    // GET /mismatch-count — current unresolved mismatch count (for alert-evaluator)
    if (url.pathname === '/mismatch-count' && req.method === 'GET') {
      const count = await getMismatchCount()
      return Response.json({ ok: true, mismatchCount: count })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`Reconciliation worker running on port ${PORT} (poll interval: ${POLL_INTERVAL_MS}ms)`)

// Run one cycle on startup (so a fresh deploy immediately checks state)
if (process.env.RECONCILIATION_AUTO_RUN !== 'false') {
  runOnce('cron').catch(async (error) => {
    await log({ level: 'error', message: 'startup-cycle-error', error: (error as Error).message })
  })
}

// Schedule recurring cycles
setInterval(async () => {
  try {
    await runOnce('cron')
  } catch (error) {
    await log({ level: 'error', message: 'scheduled-cycle-error', error: (error as Error).message })
  }
}, POLL_INTERVAL_MS)
