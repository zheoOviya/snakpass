import { NextResponse } from 'next/server'
import { apiError } from '@/lib/errors'
import { runReconciliation, remediateM3MissingCaptureStatus, processM3Remediations } from '@/lib/reconciliation'
import { db } from '@/lib/db'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — M3 Evidence Run Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/m3-evidence-run?action=<name>&findingId=<id>&gatewayStatus=<status>
//
// EVIDENCE_TEST_MODE must be 'true'. Uses GET to avoid CSRF.
//
// Actions:
//   - "detect"             — Run reconciliation (creates M3 findings).
//   - "remediate-one"      — Remediate a specific M3 finding by findingId.
//                            Optional gatewayStatus param controls the mock gateway response.
//   - "remediate-all"      — Process all unresolved M3 findings.
//   - "list-m3-findings"   — List all unresolved M3 findings.
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'detect'
  const findingId = url.searchParams.get('findingId')
  const gatewayStatus = url.searchParams.get('gatewayStatus')

  // Set the gateway status env var for the mock (demo mode only)
  if (gatewayStatus) {
    process.env.EVIDENCE_GATEWAY_STATUS = gatewayStatus
  }

  if (action === 'detect') {
    const result = await runReconciliation('evidence')
    return NextResponse.json({ ok: true, action: 'detect', result })
  }

  if (action === 'remediate-one') {
    if (!findingId) return apiError('VALIDATION_ERROR', 'findingId required for remediate-one', 400)
    const result = await remediateM3MissingCaptureStatus(findingId)
    return NextResponse.json({ ok: true, action: 'remediate-one', result })
  }

  if (action === 'remediate-all') {
    const results = await processM3Remediations()
    return NextResponse.json({ ok: true, action: 'remediate-all', results })
  }

  if (action === 'list-m3-findings') {
    const findings = await db.reconciliationFinding.findMany({
      where: { mismatchClass: 'M3_MISSING_CAPTURE_STATUS', resolvedAt: null },
      select: { id: true, entityId: true, description: true, firstSeenAt: true },
    })
    return NextResponse.json({ ok: true, action: 'list-m3-findings', findings })
  }

  return apiError('VALIDATION_ERROR', `Unknown action: ${action}`, 400)
}
