import { NextResponse } from 'next/server'
import { apiError } from '@/lib/errors'
import { runReconciliation, remediateM16OutboxLag, processM16Remediations } from '@/lib/reconciliation'
import { db } from '@/lib/db'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — M16 Evidence Run Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/m16-evidence-run?action=<name>&findingId=<id>
//
// Triggers M16-specific remediation actions for evidence scenarios.
// EVIDENCE_TEST_MODE must be 'true'. Uses GET to avoid CSRF.
//
// Actions:
//   - "detect"          — Run reconciliation (creates M16 findings for lag-exceeded outbox).
//   - "remediate-one"   — Remediate a specific M16 finding by findingId.
//   - "remediate-all"   — Process all unresolved M16 findings.
//   - "remediate-disabled" — Attempt remediation with FEATURE_RECONCILIATION_AUTO_REPAIR unset
//                            (tests E7 — remediation disabled when flag OFF).
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'detect'
  const findingId = url.searchParams.get('findingId')

  if (action === 'detect') {
    // Run reconciliation (creates findings for any lag-exceeded outbox events)
    const result = await runReconciliation('evidence')
    return NextResponse.json({ ok: true, action: 'detect', result })
  }

  if (action === 'remediate-one') {
    if (!findingId) return apiError('VALIDATION_ERROR', 'findingId required for remediate-one', 400)
    const result = await remediateM16OutboxLag(findingId)
    return NextResponse.json({ ok: true, action: 'remediate-one', result })
  }

  if (action === 'remediate-all') {
    const results = await processM16Remediations()
    return NextResponse.json({ ok: true, action: 'remediate-all', results })
  }

  if (action === 'remediate-disabled') {
    // Attempt remediation with the flag OFF (the evidence script sets the env
    // var to false before calling this, OR the handler checks the flag at runtime).
    // Since the flag is read at module-load time in deployment.ts, we need to
    // check it dynamically here. The remediateM16OutboxLag function already
    // checks isFeatureEnabled('reconciliationAutoRepair') — if it's OFF, it
    // returns DISABLED.
    if (!findingId) return apiError('VALIDATION_ERROR', 'findingId required for remediate-disabled', 400)
    const result = await remediateM16OutboxLag(findingId)
    return NextResponse.json({ ok: true, action: 'remediate-disabled', result })
  }

  if (action === 'list-m16-findings') {
    // List all unresolved M16 findings (for the evidence script to pick one to remediate)
    const findings = await db.reconciliationFinding.findMany({
      where: { mismatchClass: 'M16_OUTBOX_LAG_EXCEEDED', resolvedAt: null },
      select: { id: true, entityId: true, description: true, firstSeenAt: true },
    })
    return NextResponse.json({ ok: true, action: 'list-m16-findings', findings })
  }

  return apiError('VALIDATION_ERROR', `Unknown action: ${action}`, 400)
}
