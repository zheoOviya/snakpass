import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// P0-20 — Health checks + basic metrics
// /health reflects DB + realtime service status.
// Control/Enabler (Architectural Law 6): detects degradation, does not enforce a business truth.

export async function GET() {
  const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latencyMs?: number; detail?: string }> = {}

  // DB check
  try {
    const start = Date.now()
    await db.$queryRaw`SELECT 1`
    checks.db = { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    checks.db = { status: 'down', detail: String(e) }
  }

  // Realtime service check (port 3003)
  try {
    const start = Date.now()
    const res = await fetch('http://localhost:3003/', { signal: AbortSignal.timeout(2000) })
    checks.realtime = {
      status: res.ok ? 'ok' : 'degraded',
      latencyMs: Date.now() - start,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    }
  } catch {
    checks.realtime = { status: 'down', detail: 'unreachable' }
  }

  // Overall status
  const allOk = Object.values(checks).every((c) => c.status === 'ok')
  const anyDown = Object.values(checks).some((c) => c.status === 'down')
  const overall = allOk ? 'ok' : anyDown ? 'down' : 'degraded'

  return NextResponse.json(
    {
      status: overall,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: overall === 'ok' ? 200 : overall === 'degraded' ? 200 : 503 },
  )
}
