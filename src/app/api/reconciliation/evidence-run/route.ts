import { NextResponse } from 'next/server'
import { apiError } from '@/lib/errors'
import { runReconciliation } from '@/lib/reconciliation'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5b Evidence — Run Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/evidence-run
//
// Triggers a single reconciliation cycle (trigger='evidence'). Returns the
// full run result including findings. This is the evidence-test entry point
// that calls runReconciliation() — the SAME function the mini-service uses.
//
// Uses GET (not POST) to avoid CSRF middleware on POST requests. This is a
// dev-only evidence endpoint — RESTful correctness is secondary.
//
// EVIDENCE_TEST_MODE must be 'true'. No auth required (evidence-only).
// Query params: ?concurrent=N — run N concurrent reconciliation cycles (for E5).
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  // Optional: simulate concurrent runs via ?concurrent=N
  const url = new URL(req.url)
  const concurrent = parseInt(url.searchParams.get('concurrent') ?? '1', 10)

  if (concurrent > 1) {
    // E5 — concurrent reconciliation runs
    const runs = await Promise.all(
      Array.from({ length: concurrent }, () => runReconciliation('evidence')),
    )
    return NextResponse.json({ ok: true, concurrent, runs })
  }

  const result = await runReconciliation('evidence')
  return NextResponse.json({ ok: true, result })
}
