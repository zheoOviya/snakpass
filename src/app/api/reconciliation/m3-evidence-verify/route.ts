import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — M3 Evidence Verify Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/m3-evidence-verify
//
// Returns the current state of M3 findings + RemediationActions + money-state
// snapshot (for E4 diff comparison).
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const m3Findings = await db.reconciliationFinding.findMany({
    where: { mismatchClass: 'M3_MISSING_CAPTURE_STATUS' },
    orderBy: { firstSeenAt: 'desc' },
    take: 20,
    select: {
      id: true, entityId: true, description: true, severity: true,
      firstSeenAt: true, lastSeenAt: true, resolvedAt: true, resolutionNote: true,
    },
  })

  const remediationActions = await db.remediationAction.findMany({
    where: { repairType: 'M3_GATEWAY_VERIFIED_STATUS_FLIP' },
    orderBy: { attemptedAt: 'desc' },
    take: 20,
    select: {
      id: true, findingId: true, repairType: true, status: true,
      actionSnapshot: true, attemptedAt: true, completedAt: true, error: true,
    },
  })

  // Money-state snapshot (for E4 diff — row-level for Payment/Refund/Ledger)
  const moneyStateSnapshot = {
    paymentCount: await db.payment.count(),
    refundCount: await db.refund.count(),
    ledgerEntryCount: await db.ledgerEntry.count(),
    outboxCount: await db.outbox.count(),
    webhookEventCount: await db.webhookEvent.count(),
    idempotencyKeyCount: await db.idempotencyKey.count(),
    auditLogCount: await db.auditLog.count(),
    paymentRows: (await db.payment.findMany({ select: { id: true, status: true, version: true, updatedAt: true, capturedAt: true }, orderBy: { id: 'asc' } })),
    refundRows: (await db.refund.findMany({ select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } })),
    ledgerEntryRows: (await db.ledgerEntry.findMany({ select: { id: true, entryType: true, accountType: true, amount: true }, orderBy: { id: 'asc' } })),
  }

  return NextResponse.json({
    ok: true,
    m3Findings,
    remediationActions,
    moneyStateSnapshot,
    evidenceTestMode: true,
  })
}
