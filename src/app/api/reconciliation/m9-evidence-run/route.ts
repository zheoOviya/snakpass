import { NextResponse } from 'next/server'
import { apiError } from '@/lib/errors'
import { runReconciliation, remediateM9StuckCapturePending, processM9Remediations } from '@/lib/reconciliation'
import { db } from '@/lib/db'

// M9 Evidence Run — actions: detect, remediate-one, remediate-all, list-m9-findings
export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'detect'
  const findingId = url.searchParams.get('findingId')
  const gatewayStatus = url.searchParams.get('gatewayStatus')

  if (gatewayStatus) process.env.EVIDENCE_GATEWAY_STATUS = gatewayStatus

  if (action === 'detect') {
    const result = await runReconciliation('evidence')
    return NextResponse.json({ ok: true, action: 'detect', result })
  }
  if (action === 'remediate-one') {
    if (!findingId) return apiError('VALIDATION_ERROR', 'findingId required', 400)
    const result = await remediateM9StuckCapturePending(findingId)
    return NextResponse.json({ ok: true, action: 'remediate-one', result })
  }
  if (action === 'remediate-all') {
    const results = await processM9Remediations()
    return NextResponse.json({ ok: true, action: 'remediate-all', results })
  }
  if (action === 'list-m9-findings') {
    const findings = await db.reconciliationFinding.findMany({
      where: { mismatchClass: 'M9_STUCK_CAPTURE_PENDING', resolvedAt: null },
      select: { id: true, entityId: true, description: true, firstSeenAt: true },
    })
    return NextResponse.json({ ok: true, action: 'list-m9-findings', findings })
  }
  return apiError('VALIDATION_ERROR', `Unknown action: ${action}`, 400)
}
