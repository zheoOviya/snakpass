// P0-06 Wave-6 — Invariant Checker Worker (M18-M21 detectors)
//
// Standalone Bun service that runs state-invariant checks on a configurable
// interval. Mirrors the reconciliation mini-service (port 3010) + outbox-publisher
// + alert-evaluator mini-service pattern.
//
// SAFETY CONTRACT (Orchestrator hard boundary — additive, parallel detector):
//   This service runs the M18-M21 detectors from src/lib/state-invariants.ts.
//   Those detectors are READ-DETECT-AND-REPORT functions:
//     - M19/M20/M21: detection-only → ExceptionQueue + alert (NO write to money-state tables)
//     - M18: auto-refund via EXISTING /api/payments/refund route (HTTP fetch — no new
//       financial mutation logic; reuses Wave-5 5A infrastructure as-is)
//
//   This service NEVER writes to Payment, Refund, LedgerEntry, Outbox,
//   WebhookEvent, IdempotencyKey, or AuditLog directly. The only DB writes
//   are through reportInvariantViolation() (ExceptionQueue + freeze — existing
//   P0-28 pathway). The M18 auto-refund HTTP call delegates ALL money-state
//   writes to the existing refund route (Wave-5 5A pathway — unchanged).
//
// FEATURE FLAG: The cron poll loop is gated on `FEATURE_INVARIANT_CHECKER`
// (env var) → isStateInvariantCheckerEnabled() → isFeatureEnabled('invariantChecker').
// When OFF (default), the service starts but does NOT poll. Manual POST /trigger
// runs detectors regardless of flag state (useful for evidence collection).
// The M18 auto-refund action is additionally gated by
// STATE_INVARIANT_AUTO_REFUND !== 'false' (default ON when flag is ON).
//
// Endpoints:
//   GET /           — health check
//   POST /trigger   — manual trigger (runs one check cycle, regardless of flag)
//   GET /status     — last run summary (findingsCount, m18AutoRefundsTriggered, ...)
//
// Port: 3011 (configurable via INVARIANT_CHECKER_PORT env var)

import { PrismaClient } from '@prisma/client'
import { appendFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

// Port + poll interval (configurable via env vars).
const PORT = parseInt(process.env.INVARIANT_CHECKER_PORT || '3011', 10)
const POLL_INTERVAL_MS = parseInt(
  process.env.INVARIANT_CHECKER_POLL_INTERVAL_MS || '3600000', // default 1 hour
  10,
)
const LOG_DIR = join(import.meta.dir, '..', '..', 'db')
const LOG_FILE = join(LOG_DIR, 'invariant-checker-log.jsonl')

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {})
}

// Set up the shared PrismaClient on globalThis BEFORE importing
// state-invariants.ts so that src/lib/db.ts picks up this instance.
// (Mirrors the reconciliation mini-service pattern — port 3010.)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient()
}

// NOW import the state-invariants library — it will use the globalForPrisma
// instance (via src/lib/db.ts).
const { runStateInvariantCheck, isStateInvariantCheckerEnabled } =
  await import('../../src/lib/state-invariants.ts')

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  trigger?: string
  findingsCount?: number
  m18AutoRefundsTriggered?: number
  m18AutoRefundErrors?: number
  error?: string
}

async function log(entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
  const full: LogEntry = { ...entry, timestamp: new Date().toISOString() }
  const line = JSON.stringify(full)
  console.log(line)
  await appendFile(LOG_FILE, line + '\n').catch(() => {})
}

// Last-run summary (for GET /status). Updated after each cycle.
let lastRunSummary: {
  startedAt: Date
  completedAt: Date | null
  trigger: string
  findingsCount: number
  m18AutoRefundsTriggered: number
  m18AutoRefundErrors: number
  error?: string
} | null = null

/**
 * Run one state-invariant check cycle.
 *
 * This function does NOT consult the invariantChecker flag — it always runs
 * when called. The cron poll loop below checks the flag; the manual
 * POST /trigger endpoint does NOT (so admins can run ad-hoc checks even
 * when the flag is OFF — useful for evidence collection).
 */
async function runOnce(trigger: 'cron' | 'manual' | 'evidence' = 'cron') {
  const result = await runStateInvariantCheck(trigger)
  await log({
    level: result.completedAt ? 'info' : 'error',
    message: result.completedAt
      ? 'invariant-checker-cycle-complete'
      : 'invariant-checker-cycle-failed',
    trigger: result.trigger,
    findingsCount: result.findings.length,
    m18AutoRefundsTriggered: result.m18AutoRefundsTriggered,
    m18AutoRefundErrors: result.m18AutoRefundErrors,
  })
  lastRunSummary = {
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    trigger: result.trigger,
    findingsCount: result.findings.length,
    m18AutoRefundsTriggered: result.m18AutoRefundsTriggered,
    m18AutoRefundErrors: result.m18AutoRefundErrors,
  }
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
        service: 'invariant-checker',
        port: PORT,
        pollIntervalMs: POLL_INTERVAL_MS,
        flagEnabled: isStateInvariantCheckerEnabled(),
        safetyContract:
          'M19/M20/M21 detection-only → ExceptionQueue + alert; M18 auto-refund reuses existing refund route (HTTP fetch — no new financial mutation logic)',
      })
    }

    // POST /trigger — manual trigger (runs one check cycle, regardless of flag)
    if (url.pathname === '/trigger' && req.method === 'POST') {
      try {
        const result = await runOnce('manual')
        return Response.json({
          ok: true,
          findingsCount: result.findings.length,
          m18AutoRefundsTriggered: result.m18AutoRefundsTriggered,
          m18AutoRefundErrors: result.m18AutoRefundErrors,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
        })
      } catch (error) {
        await log({
          level: 'error',
          message: 'trigger-error',
          error: (error as Error).message,
        })
        return Response.json(
          { ok: false, error: (error as Error).message },
          { status: 500 },
        )
      }
    }

    // GET /status — last run summary
    if (url.pathname === '/status' && req.method === 'GET') {
      return Response.json({
        ok: true,
        flagEnabled: isStateInvariantCheckerEnabled(),
        pollIntervalMs: POLL_INTERVAL_MS,
        lastRun: lastRunSummary,
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(
  `Invariant Checker worker running on port ${PORT} (poll interval: ${POLL_INTERVAL_MS}ms, flagEnabled: ${isStateInvariantCheckerEnabled()})`,
)

// Run one cycle on startup ONLY if the feature flag is ON.
// (When OFF, the service starts but does NOT poll — defense-in-depth.)
if (isStateInvariantCheckerEnabled() && process.env.INVARIANT_CHECKER_AUTO_RUN !== 'false') {
  runOnce('cron').catch(async (error) => {
    await log({
      level: 'error',
      message: 'startup-cycle-error',
      error: (error as Error).message,
    })
  })
} else {
  console.log(
    'Invariant Checker flag is OFF — service started but poll loop is inert. Use POST /trigger for ad-hoc runs.',
  )
}

// Schedule recurring cycles — but only run them when the flag is ON.
// (We check the flag on each tick so an admin can enable/disable the flag
// without restarting the service.)
setInterval(async () => {
  if (!isStateInvariantCheckerEnabled()) {
    // Flag is OFF — skip this tick.
    return
  }
  try {
    await runOnce('cron')
  } catch (error) {
    await log({
      level: 'error',
      message: 'scheduled-cycle-error',
      error: (error as Error).message,
    })
  }
}, POLL_INTERVAL_MS)
