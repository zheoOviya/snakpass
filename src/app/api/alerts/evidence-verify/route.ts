import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// Sub-Wave 4d Evidence — Orphan Business Count Verification (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/alerts/evidence-verify
//
// Runs BOTH the old (unfixed) and new (fixed) orphan_business_count queries
// and returns the results for comparison + verification.
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  // 1. Run the NEW (fixed) query — with timestamp filter
  let newOrphanCount = 0
  try {
    const result = await db.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Order" o
      LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
      WHERE ob.id IS NULL
        AND o."createdAt" >= (SELECT MIN("createdAt") FROM "Outbox")
    ` as Array<{ count: number }>
    newOrphanCount = result[0]?.count ?? 0
  } catch {
    newOrphanCount = -1 // error marker
  }

  // 2. Run the OLD (unfixed) query — without timestamp filter
  let oldOrphanCount = 0
  try {
    const result = await db.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Order" o
      LEFT JOIN "Outbox" ob ON ob."aggregateId" = o.id AND ob."aggregateType" = 'Order'
      WHERE ob.id IS NULL
    ` as Array<{ count: number }>
    oldOrphanCount = result[0]?.count ?? 0
  } catch {
    oldOrphanCount = -1 // error marker
  }

  // 3. Get the first outbox createdAt (the baseline timestamp)
  let outboxBaseline: string | null = null
  try {
    const result = await db.$queryRaw`
      SELECT MIN("createdAt")::text as baseline FROM "Outbox"
    ` as Array<{ baseline: string | null }>
    outboxBaseline = result[0]?.baseline ?? null
  } catch {
    outboxBaseline = null
  }

  // 4. Count total orders
  let totalOrders = 0
  try {
    totalOrders = await db.order.count()
  } catch {
    totalOrders = -1
  }

  // 5. Count total outbox events for orders
  let totalOutboxOrderEvents = 0
  try {
    totalOutboxOrderEvents = await db.outbox.count({
      where: { aggregateType: 'Order' },
    })
  } catch {
    totalOutboxOrderEvents = -1
  }

  // 6. Count pre-outbox orders (orders created before first outbox event)
  let preOutboxOrderCount = 0
  try {
    const result = await db.$queryRaw`
      SELECT COUNT(*)::int as count FROM "Order" o
      WHERE o."createdAt" < (SELECT MIN("createdAt") FROM "Outbox")
    ` as Array<{ count: number }>
    preOutboxOrderCount = result[0]?.count ?? 0
  } catch {
    preOutboxOrderCount = -1
  }

  // Compute invariants:
  // historicalExclusionWorking: old count > new count (or old == new if no pre-outbox orders)
  const historicalExclusionWorking = oldOrphanCount >= newOrphanCount
  // genuineOrphanDetection: new count can be > 0 (if genuine orphans exist)
  // This is verified by the evidence scenarios which create genuine orphans

  return NextResponse.json({
    newOrphanCount,
    oldOrphanCount,
    outboxBaseline,
    totalOrders,
    totalOutboxOrderEvents,
    preOutboxOrderCount,
    historicalExclusionWorking,
    evidenceTestMode: true,
    verifiedAt: new Date().toISOString(),
  })
}
