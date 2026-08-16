import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5C — M16 Evidence Verify Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/m16-evidence-verify
//
// Returns the current state of M16 findings + RemediationActions + money-state
// snapshot (for E4/E5/E6/E7 diff comparison).
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  // 1. M16 findings (all — resolved + unresolved)
  const m16Findings = await db.reconciliationFinding.findMany({
    where: { mismatchClass: 'M16_OUTBOX_LAG_EXCEEDED' },
    orderBy: { firstSeenAt: 'desc' },
    take: 20,
    select: {
      id: true, entityId: true, description: true, severity: true,
      firstSeenAt: true, lastSeenAt: true, resolvedAt: true, resolutionNote: true,
    },
  })

  // 2. All other findings (for E6 — CLASS E findings remain untouched)
  const nonM16Findings = await db.reconciliationFinding.findMany({
    where: { mismatchClass: { not: 'M16_OUTBOX_LAG_EXCEEDED' } },
    orderBy: { firstSeenAt: 'desc' },
    take: 20,
    select: {
      id: true, mismatchClass: true, entityId: true, description: true, severity: true,
      firstSeenAt: true, lastSeenAt: true, resolvedAt: true,
    },
  })

  // 3. RemediationActions (audit trail)
  const remediationActions = await db.remediationAction.findMany({
    orderBy: { attemptedAt: 'desc' },
    take: 20,
    select: {
      id: true, findingId: true, repairType: true, status: true,
      actionSnapshot: true, attemptedAt: true, completedAt: true, error: true,
    },
  })

  // 4. Outbox state (current)
  const outboxPENDING = await db.outbox.count({ where: { status: 'PENDING' } })
  const outboxPUBLISHED = await db.outbox.count({ where: { status: 'PUBLISHED' } })
  const oldestPending = await db.outbox.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, eventId: true },
  })
  const lagSeconds = oldestPending
    ? Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 1000)
    : 0

  // 5. Money-state snapshot (for E4/E5/E6/E7 diff comparison)
  const moneyStateSnapshot = {
    paymentCount: await db.payment.count(),
    refundCount: await db.refund.count(),
    ledgerEntryCount: await db.ledgerEntry.count(),
    outboxCount: await db.outbox.count(),
    webhookEventCount: await db.webhookEvent.count(),
    idempotencyKeyCount: await db.idempotencyKey.count(),
    auditLogCount: await db.auditLog.count(),
    // Full row snapshots for exact diff
    paymentRows: (await db.payment.findMany({ select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } })),
    refundRows: (await db.refund.findMany({ select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } })),
    ledgerEntryRows: (await db.ledgerEntry.findMany({ select: { id: true, entryType: true, accountType: true, amount: true }, orderBy: { id: 'asc' } })),
    outboxRows: (await db.outbox.findMany({ select: { id: true, status: true, eventId: true }, orderBy: { id: 'asc' } })),
  }

  return NextResponse.json({
    ok: true,
    m16Findings,
    nonM16Findings,
    remediationActions,
    outboxState: {
      pendingCount: outboxPENDING,
      publishedCount: outboxPUBLISHED,
      oldestPendingEventId: oldestPending?.eventId ?? null,
      lagSeconds,
    },
    moneyStateSnapshot,
    evidenceTestMode: true,
  })
}
