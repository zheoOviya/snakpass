import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// P0-03 Wave-5 Sub-Wave 5b Evidence — Verify Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/reconciliation/evidence-verify
//
// Returns the current state of reconciliation findings + a money-state
// snapshot (for E4 before/after diff comparison). The evidence script:
//   1. Calls evidence-setup (gets moneyStateSnapshotBefore).
//   2. Calls evidence-run (runs reconciliation → finds anomalies).
//   3. Calls evidence-verify (gets findings + moneyStateSnapshotAfter).
//   4. Compares before/after snapshots → asserts zero diffs in money-state
//      tables (E4 safety property: reconciliation does NOT mutate money state).
//
// Query params:
//   ?mismatchClass=M1_LEDGER_IMBALANCE  — filter findings by class (optional)
//
// Returns: {
//   findings: ReconciliationFinding[],
//   unresolvedFindingsCount: number,
//   moneyStateSnapshotAfter: { paymentCount, refundCount, ... paymentIds, ... }
// }
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const mismatchClassFilter = url.searchParams.get('mismatchClass')

  // 1. Fetch findings (optionally filtered by class)
  const where = mismatchClassFilter
    ? { mismatchClass: mismatchClassFilter }
    : {}
  const findings = await db.reconciliationFinding.findMany({
    where,
    orderBy: { firstSeenAt: 'desc' },
    take: 100,
    select: {
      id: true,
      mismatchClass: true,
      severity: true,
      entityType: true,
      entityId: true,
      description: true,
      exceptionId: true,
      firstSeenAt: true,
      lastSeenAt: true,
      resolvedAt: true,
    },
  })

  const unresolvedFindingsCount = await db.reconciliationFinding.count({
    where: { resolvedAt: null },
  })

  const recentRuns = await db.reconciliationRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      id: true, triggerType: true, status: true, startedAt: true, completedAt: true,
      paymentsChecked: true, refundsChecked: true, outboxChecked: true,
      webhooksChecked: true, findingsCount: true, mismatchCount: true,
    },
  })

  // 2. Money-state snapshot (for E4 before/after diff)
  //    Reconciliation must NOT have changed any of these values (other than
  //    the evidence-setup seeding which happened BEFORE the snapshot-before).
  const moneyStateSnapshotAfter = {
    paymentCount: await db.payment.count(),
    refundCount: await db.refund.count(),
    ledgerEntryCount: await db.ledgerEntry.count(),
    outboxCount: await db.outbox.count(),
    webhookEventCount: await db.webhookEvent.count(),
    idempotencyKeyCount: await db.idempotencyKey.count(),
    auditLogCount: await db.auditLog.count(),
    // Full row snapshots for exact diff (the evidence script compares these
    // against the before-snapshot from evidence-setup)
    paymentIds: (await db.payment.findMany({
      select: { id: true, status: true, version: true, updatedAt: true },
      orderBy: { id: 'asc' },
    })),
    refundIds: (await db.refund.findMany({
      select: { id: true, status: true, version: true, updatedAt: true },
      orderBy: { id: 'asc' },
    })),
    ledgerEntryIds: (await db.ledgerEntry.findMany({
      select: { id: true, entryType: true, accountType: true, amount: true },
      orderBy: { id: 'asc' },
    })),
  }

  // 3. ExceptionQueue entries created by reconciliation (via reportInvariantViolation)
  const exceptionsCreated = await db.exceptionQueue.findMany({
    where: { invariant: { startsWith: 'M' } }, // M1..M17 finding classes
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, invariant: true, entityType: true, entityId: true,
      freezeLevel: true, description: true, createdAt: true, resolvedAt: true,
    },
  })

  return NextResponse.json({
    ok: true,
    findings,
    unresolvedFindingsCount,
    recentRuns,
    exceptionsCreated,
    moneyStateSnapshotAfter,
    evidenceTestMode: true,
  })
}
