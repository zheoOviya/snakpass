import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// P0-20 — Health checks + basic metrics
// /health reflects DB + realtime service status.
// Control/Enabler (Architectural Law 6): detects degradation, does not enforce a business truth.
//
// DB is the critical dependency: if DB is down, overall = "down" (503).
// Realtime is non-critical: if only realtime is down/unconfigured, overall =
// "degraded" (200) — the platform can still take orders without live tracking.
// REALTIME_URL env var configures the realtime service URL (Phase 3: Fly.io).
// If REALTIME_URL is not set, the realtime check is skipped (staging mode).

export async function GET() {
  const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latencyMs?: number; detail?: string }> = {}

  // DB check (critical)
  try {
    const start = Date.now()
    await db.$queryRaw`SELECT 1`
    checks.db = { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    checks.db = { status: 'down', detail: String(e) }
  }

  // Realtime service check (non-critical)
  const realtimeUrl = process.env.REALTIME_URL
  if (!realtimeUrl) {
    // REALTIME_URL not configured — staging mode (realtime mini-service not deployed)
    checks.realtime = { status: 'degraded', detail: 'REALTIME_URL not configured (staging — realtime mini-service is a Phase 3 item)' }
  } else {
    try {
      const start = Date.now()
      const res = await fetch(realtimeUrl, { signal: AbortSignal.timeout(2000) })
      checks.realtime = {
        status: res.ok ? 'ok' : 'degraded',
        latencyMs: Date.now() - start,
        detail: res.ok ? undefined : `HTTP ${res.status}`,
      }
    } catch {
      checks.realtime = { status: 'down', detail: 'unreachable' }
    }
  }

  // Overall status: DB is critical, realtime is non-critical
  // - DB down → "down" (503)
  // - DB ok, realtime down/degraded/not-configured → "degraded" (200)
  // - DB ok, realtime ok → "ok" (200)
  const dbOk = checks.db?.status === 'ok'
  const realtimeOk = checks.realtime?.status === 'ok'
  const overall: 'ok' | 'degraded' | 'down' = !dbOk ? 'down' : !realtimeOk ? 'degraded' : 'ok'

  return NextResponse.json(
    {
      status: overall,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: overall === 'down' ? 503 : 200 },
  )
}
