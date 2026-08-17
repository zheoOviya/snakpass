import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// M10 Evidence Verify
export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)

  const m10Findings = await db.reconciliationFinding.findMany({
    where: { mismatchClass: 'M10_STUCK_REFUND_PENDING' },
    orderBy: { firstSeenAt: 'desc' }, take: 20,
    select: { id: true, entityId: true, description: true, severity: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true, resolutionNote: true },
  })

  const remediationActions = await db.remediationAction.findMany({
    where: { repairType: 'M10_GATEWAY_VERIFIED_REFUND_STATUS_FLIP' },
    orderBy: { attemptedAt: 'desc' }, take: 20,
    select: { id: true, findingId: true, repairType: true, status: true, actionSnapshot: true, attemptedAt: true, completedAt: true, error: true },
  })

  const moneyStateSnapshot = {
    paymentCount: await db.payment.count(), refundCount: await db.refund.count(),
    ledgerEntryCount: await db.ledgerEntry.count(), outboxCount: await db.outbox.count(),
    webhookEventCount: await db.webhookEvent.count(), idempotencyKeyCount: await db.idempotencyKey.count(),
    auditLogCount: await db.auditLog.count(),
    paymentRows: (await db.payment.findMany({ select: { id: true, status: true, version: true, updatedAt: true }, orderBy: { id: 'asc' } })),
    refundRows: (await db.refund.findMany({ select: { id: true, status: true, version: true, updatedAt: true, amount: true, paymentId: true }, orderBy: { id: 'asc' } })),
    ledgerEntryRows: (await db.ledgerEntry.findMany({ select: { id: true, entryType: true, accountType: true, amount: true }, orderBy: { id: 'asc' } })),
    outboxRows: (await db.outbox.findMany({ select: { id: true, status: true, eventId: true }, orderBy: { id: 'asc' } })),
  }

  return NextResponse.json({ ok: true, m10Findings, remediationActions, moneyStateSnapshot, evidenceTestMode: true })
}
