import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/errors'

// ----------------------------------------------------------------------------
// Sub-Wave 3b Evidence — State Verification Endpoint (DEV-ONLY)
// ----------------------------------------------------------------------------
// GET /api/orders/evidence-verify?orderId=<id>&idempotencyKey=<key>&userId=<id>
//
// Returns the full state of all Order-creation writes for verification:
//   - Order (exists? status? amount?)
//   - OrderItem count (should be 0 for rollback, >=1 for success)
//   - AuditLog (ORDER_CREATED entry exists?)
//   - Outbox (ORDER_CREATED event exists?)
//   - IdempotencyKey (record exists for this key?)
//
// This endpoint is ONLY accessible when EVIDENCE_TEST_MODE === 'true'.
//
// Query params:
//   - orderId (required) — the order ID to verify
//   - idempotencyKey (optional) — the idempotency key to verify
//   - userId (optional) — filter by user (for counting ALL orders by a user)
// ----------------------------------------------------------------------------

export async function GET(req: Request) {
  // Evidence test mode gate
  if (process.env.EVIDENCE_TEST_MODE !== 'true') {
    return apiError('AUTHORIZATION_DENIED', 'Evidence test mode not enabled', 403)
  }

  const url = new URL(req.url)
  const orderId = url.searchParams.get('orderId')
  const idempotencyKey = url.searchParams.get('idempotencyKey')
  const userId = url.searchParams.get('userId')

  if (!orderId) {
    return apiError('VALIDATION_ERROR', 'orderId query param required', 400)
  }

  // 1. Order state
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      userId: true,
      restaurantId: true,
      itemsCount: true,
      createdAt: true,
    },
  })

  // 2. OrderItem count for this order
  let orderItems = 0
  if (order) {
    orderItems = await db.orderItem.count({ where: { orderId } })
  }

  // 3. AuditLog (ORDER_CREATED for this order)
  const auditLog = await db.auditLog.findFirst({
    where: {
      action: 'ORDER_CREATED',
      metadata: { contains: orderId },
    },
    select: { id: true, action: true, createdAt: true },
  })

  // 4. Outbox (ORDER_CREATED event for this order)
  const outbox = await db.outbox.findFirst({
    where: {
      aggregateType: 'Order',
      aggregateId: orderId,
    },
    select: { id: true, eventId: true, status: true, eventType: true, createdAt: true },
  })

  // 5. IdempotencyKey record
  let idempotencyRecord = null
  if (idempotencyKey) {
    idempotencyRecord = await db.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
      select: {
        id: true,
        key: true,
        resourceType: true,
        resourceId: true,
        responseStatus: true,
        requestHash: true,
        createdAt: true,
      },
    })
  }

  // 6. Count ALL orders created by this user (for concurrent test — verify
  // exactly 1 order was created from N concurrent requests)
  let totalOrdersByUser = null
  if (userId) {
    totalOrdersByUser = await db.order.count({ where: { userId } })
  }

  // 7. Count ALL IdempotencyKey records for resourceType='Order' (for phantom-block
  // test — verify 0 records after a failed txn)
  let orderResourceCount = null
  if (userId) {
    orderResourceCount = await db.idempotencyKey.count({
      where: { resourceType: 'Order' },
    })
  }

  // Compute invariants:
  // exactlyOneOrder: order exists + CONFIRMED + orderItems >= 1 + auditLog + outbox + idempotencyRecord
  const orderExists = !!order
  const orderConfirmed = order?.status === 'CONFIRMED'
  const exactlyOneOrder =
    orderExists &&
    orderConfirmed &&
    orderItems >= 1 &&
    !!auditLog &&
    !!outbox &&
    (!idempotencyKey || (!!idempotencyRecord && idempotencyRecord.resourceId === orderId))

  // atomicRollback: order doesn't exist + no orderItems + no auditLog + no outbox + no idempotencyRecord
  const atomicRollback =
    !orderExists &&
    orderItems === 0 &&
    !auditLog &&
    !outbox &&
    (!idempotencyKey || !idempotencyRecord)

  // phantomBlockPrevented: the idempotency key is NOT stored after a failed txn
  // (order doesn't exist for this orderId, but the key may or may not exist)
  const phantomBlockPrevented = !idempotencyRecord || idempotencyRecord.resourceId !== orderId

  return NextResponse.json({
    orderId,
    idempotencyKey: idempotencyKey ?? null,
    userId: userId ?? null,
    order: order
      ? {
          exists: true,
          id: order.id,
          status: order.status,
          totalAmount: order.totalAmount,
          restaurantId: order.restaurantId,
          itemsCount: order.itemsCount,
          createdAt: order.createdAt,
        }
      : { exists: false },
    orderItems,
    auditLogExists: !!auditLog,
    auditLogId: auditLog?.id ?? null,
    outboxExists: !!outbox,
    outboxId: outbox?.id ?? null,
    outboxStatus: outbox?.status ?? null,
    outboxEventType: outbox?.eventType ?? null,
    idempotencyRecordExists: !!idempotencyRecord,
    idempotencyRecordId: idempotencyRecord?.id ?? null,
    idempotencyResourceId: idempotencyRecord?.resourceId ?? null,
    idempotencyResponseStatus: idempotencyRecord?.responseStatus ?? null,
    idempotencyRequestHash: idempotencyRecord?.requestHash ?? null,
    totalOrdersByUser,
    orderResourceCount,
    // Invariant flags (computed server-side for self-validation)
    atomicRollback,
    exactlyOneOrder,
    phantomBlockPrevented,
    evidenceTestMode: true,
    verifiedAt: new Date().toISOString(),
  })
}
