import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { emitOrderCreated } from '@/lib/realtime'
import { validateBody, createOrderBodySchema } from '@/lib/validation'
import { apiError, withErrorHandler, AppError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { getIdempotencyKey, getCachedResponse, storeIdempotencyRecord, parseCachedResponse } from '@/lib/idempotency'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { isFeatureEnabled } from '@/lib/deployment'

// ----------------------------------------------------------------------------
// Sub-Wave 3b Evidence — env-gated failure injection
// ----------------------------------------------------------------------------
// When EVIDENCE_TEST_MODE=true and the request includes an
// `X-Evidence-Fail-After` header, the order-creation transaction will
// deliberately throw AFTER the designated write step but BEFORE the
// transaction commits. This proves that ALL writes inside the transaction
// roll back atomically (phantom-block prevention + outbox atomicity).
//
// Gate: EVIDENCE_TEST_MODE env var (set ONLY during evidence test runs,
// never in staging or production). The header is ignored if the env gate
// is off, so this code is dead in any non-test environment.
//
// Valid X-Evidence-Fail-After values (in execution order):
//   "menu-item-decrement" — fail after tx.menuItem.updateMany (inventory race guard)
//   "order-create"        — fail after tx.order.create (before audit log)
//   "audit-log"           — fail after tx.auditLog.create (before idempotency record)
//   "idempotency-record"  — fail after storeIdempotencyRecord (before outbox)  ← KEY TEST POINT
//   "outbox"              — fail after enqueueOutboxEvent (just before commit)
// ----------------------------------------------------------------------------
const EVIDENCE_TEST_MODE = process.env.EVIDENCE_TEST_MODE === 'true'

function evidenceFailAfter(step: string, failAfterStep: string | null): void {
  if (EVIDENCE_TEST_MODE && failAfterStep === step) {
    throw new AppError(
      'INTERNAL_ERROR',
      `EVIDENCE: deliberate failure after "${step}" — testing transaction rollback`,
      500,
      { evidenceFailureInjection: true, failedAfterStep: step },
    )
  }
}

// GET /api/orders?role=consumer|vendor|admin&restaurantId=&status=&limit=
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get('role') ?? 'consumer'
  const restaurantId = req.nextUrl.searchParams.get('restaurantId')
  const status = req.nextUrl.searchParams.get('status')
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '100'), 200)

  const session = await getSessionUser()

  const where: Record<string, unknown> = {}
  if (role === 'consumer') {
    // Authenticated consumers see only their own orders.
    if (!session) return NextResponse.json({ orders: [] })
    where.userId = session.userId
  }
  if (restaurantId) where.restaurantId = restaurantId
  if (status) where.status = status

  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      restaurant: { select: { id: true, name: true, cuisine: true, address: true } },
      orderItems: true,
    },
  })

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      totalAmount: o.totalAmount,
      pickupOtp: o.pickupOtp,
      isCatering: o.isCatering,
      headcount: o.headcount,
      itemsCount: o.itemsCount,
      note: o.note,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      statusHistory: o.statusHistory,
      restaurant: o.restaurant,
      items: o.orderItems.map((i) => ({
        id: i.id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        subtotal: i.subtotal,
      })),
    })),
  })
}

// POST /api/orders  body: { restaurantId, items:[{menuItemId,name,price,quantity}], isCatering?, headcount?, note? }
// P0-17: Accepts Idempotency-Key header — retries with same key return cached response.
// P0-25 Case A: Inventory race protection via transaction + atomic availableCount check.
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const traceId = newTraceId()
  // P0-12: Zod validation
  const body = await validateBody(req, createOrderBodySchema)

  // P0-17: Check idempotency key BEFORE any business logic.
  // The actual cached-response lookup happens INSIDE the transaction below
  // (to prevent phantom-block), but we extract the key here first.
  const idempotencyKey = getIdempotencyKey(req)

  // Evidence failure-injection header (ignored unless EVIDENCE_TEST_MODE=true)
  const evidenceFailAfterStep = EVIDENCE_TEST_MODE
    ? req.headers.get('x-evidence-fail-after')
    : null

  // Kill switch guard: ordering (outside txn — read-only check, safe to race)
  const orderingKs = await db.killSwitch.findUnique({ where: { key: 'ordering' } })
  if (orderingKs?.enabled) {
    return apiError('KILL_SWITCH_ACTIVE', 'Ordering is currently disabled (kill switch active).', 503)
  }
  if (body.isCatering) {
    const catKs = await db.killSwitch.findUnique({ where: { key: 'catering' } })
    if (catKs?.enabled) {
      return NextResponse.json({ error: 'Catering orders are currently disabled.' }, { status: 503 })
    }
  }

  const session = await getSessionUser()
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const consumerId = session.userId

  try {
    // P0-25 + P0-17: Execute the entire order-creation logic inside a transaction.
    // This ensures:
    //   - Inventory check + order create are atomic (no oversell)
    //   - Idempotency key check + order create are atomic (no phantom block)
    //   - Audit log is in the same transaction (consistent)
    const result = await withTransaction(async (tx) => {
      // P0-17: Check for cached idempotency response FIRST (inside txn).
      // If found, return it without executing any business logic.
      if (idempotencyKey) {
        const cached = await getCachedResponse(tx, idempotencyKey)
        if (cached) {
          logInfo('idempotency-dedup-hit', { key: idempotencyKey }, traceId)
          // Return a sentinel so the outer code knows to return the cached response
          // instead of proceeding with the normal order-created response.
          return { type: 'cached' as const, status: cached.status, body: cached.body }
        }
      }

      // P0-25 Case A: Inventory check inside transaction.
      // Fetch all requested menu items with a row lock (SELECT ... FOR UPDATE
      // is implicit in Prisma's $transaction under READ COMMITTED isolation —
      // the UPDATE at the end of the txn will block concurrent updates to the
      // same rows). We verify isAvailable + availableCount here.
      const menuItemIds = body.items.map((i: { menuItemId: string }) => i.menuItemId)
      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds } },
        select: { id: true, name: true, price: true, isAvailable: true, availableCount: true, version: true },
      })

      // Validate all items exist + are available
      const menuItemMap = new Map(menuItems.map((m) => [m.id, m]))
      for (const item of body.items) {
        const menuItem = menuItemMap.get(item.menuItemId)
        if (!menuItem) {
          return {
            type: 'error' as const,
            status: 400,
            body: { error: { code: 'VALIDATION_ERROR', message: `Menu item ${item.menuItemId} not found`, traceId } },
          }
        }
        if (!menuItem.isAvailable) {
          return {
            type: 'error' as const,
            status: 400,
            body: { error: { code: 'VALIDATION_ERROR', message: `${menuItem.name} is no longer available`, traceId } },
          }
        }
        // P0-25 Case A: If availableCount is set (not null), atomically decrement.
        // Uses conditional UPDATE (WHERE availableCount >= quantity AND version = X)
        // to prevent oversell. If the UPDATE affects 0 rows, another concurrent order
        // won the race → return 409.
        if (menuItem.availableCount !== null) {
          if (menuItem.availableCount < item.quantity) {
            return {
              type: 'error' as const,
              status: 409,
              body: { error: { code: 'CONFLICT', message: `Only ${menuItem.availableCount} of ${menuItem.name} available`, traceId } },
            }
          }
          // Atomically decrement availableCount.
          // WHERE availableCount >= quantity ensures we don't go negative.
          // WHERE version = X ensures optimistic locking (concurrent orders conflict).
          const decrement = await tx.menuItem.updateMany({
            where: {
              id: item.menuItemId,
              availableCount: { gte: item.quantity },
              version: menuItem.version,
            },
            data: {
              availableCount: { decrement: item.quantity },
              version: { increment: 1 },
            },
          })
          if (decrement.count === 0) {
            // Another concurrent order took the last item — race prevented
            return {
              type: 'error' as const,
              status: 409,
              body: { error: { code: 'CONFLICT', message: `Item '${menuItem.name}' was sold out by another order. Please retry.`, traceId } },
            }
          }
        }
      }

      // === EVIDENCE CHECKPOINT: menu-item-decrement ===
      evidenceFailAfter('menu-item-decrement', evidenceFailAfterStep)

      const restaurant = await tx.restaurant.findUnique({ where: { id: body.restaurantId } })
      if (!restaurant || !restaurant.isActive || restaurant.isSuspended) {
        return {
          type: 'error' as const,
          status: 400,
          body: { error: { code: 'VALIDATION_ERROR', message: 'Restaurant unavailable', traceId } },
        }
      }

      const total = body.items.reduce((s: number, i: { price: number; quantity: number }) => s + i.price * i.quantity, 0)
      const itemsCount = body.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0)
      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const now = new Date().toISOString()

      const order = await tx.order.create({
        data: {
          userId: consumerId,
          restaurantId: body.restaurantId,
          status: 'CONFIRMED',
          totalAmount: total,
          pickupOtp: otp,
          isCatering: !!body.isCatering,
          headcount: body.headcount ?? null,
          itemsCount,
          note: body.note ?? null,
          statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: now }]),
          orderItems: {
            create: body.items.map((i: { menuItemId: string; name: string; price: number; quantity: number }) => ({
              menuItemId: i.menuItemId,
              name: i.name,
              price: i.price,
              quantity: i.quantity,
              subtotal: i.price * i.quantity,
            })),
          },
        },
        include: { orderItems: true, restaurant: { select: { id: true, name: true } } },
      })

      // === EVIDENCE CHECKPOINT: order-create ===
      evidenceFailAfter('order-create', evidenceFailAfterStep)

      await tx.auditLog.create({
        data: {
          actorId: consumerId,
          actorRole: 'CONSUMER',
          action: 'ORDER_CREATED',
          metadata: JSON.stringify({ orderId: order.id, total, restaurantId: body.restaurantId }),
        },
      })

      // === EVIDENCE CHECKPOINT: audit-log ===
      evidenceFailAfter('audit-log', evidenceFailAfterStep)

      // Build the success response body
      const responseBody = {
        order: {
          id: order.id,
          status: order.status,
          totalAmount: order.totalAmount,
          pickupOtp: order.pickupOtp,
          isCatering: order.isCatering,
          headcount: order.headcount,
          itemsCount: order.itemsCount,
          note: order.note,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          statusHistory: order.statusHistory,
          restaurant: order.restaurant,
          items: order.orderItems.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            subtotal: i.subtotal,
          })),
        },
      }

      // P0-17: Store the idempotency key + cached response (inside same txn).
      // This prevents phantom-block: if the txn commits, the key is stored;
      // if it rolls back, the key is NOT stored (so retry is safe).
      if (idempotencyKey) {
        await storeIdempotencyRecord(
          tx,
          idempotencyKey,
          'Order',
          order.id,
          200,
          JSON.stringify(responseBody),
        )
        logInfo('idempotency-key-stored', { key: idempotencyKey, orderId: order.id }, traceId)
      }

      // === EVIDENCE CHECKPOINT: idempotency-record (KEY TEST POINT — phantom-block) ===
      evidenceFailAfter('idempotency-record', evidenceFailAfterStep)

      // P0-24: Write outbox event INSIDE the same transaction (behind feature flag).
      // When outboxPublisher flag is ON, the publisher worker (Sub-Wave 2b) will
      // pick up this event and deliver it via Socket.io.
      // When flag is OFF (Sub-Wave 2a state), the event is still persisted in the
      // Outbox table (committed atomically with the order) — it just won't be
      // published yet. This proves the transactional outbox pattern is wired.
      await enqueueOutboxEvent(tx, {
        eventType: 'ORDER_CREATED',
        aggregateType: 'Order',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          restaurantId: order.restaurantId,
          status: order.status,
          totalAmount: order.totalAmount,
          updatedAt: order.updatedAt.toISOString(),
          pickupOtp: order.pickupOtp,
        },
      })

      // === EVIDENCE CHECKPOINT: outbox (just before commit) ===
      evidenceFailAfter('outbox', evidenceFailAfterStep)

      return { type: 'created' as const, status: 200, body: responseBody, order }
    })

    // Handle the transaction result
    if (result.type === 'cached') {
      const parsed = parseCachedResponse({ status: result.status, body: result.body })
      return NextResponse.json(parsed.body, { status: parsed.status })
    }
    if (result.type === 'error') {
      return NextResponse.json(result.body, { status: result.status })
    }
    // result.type === 'created'
    const order = result.order

    emitOrderCreated({
      orderId: order.id,
      restaurantId: order.restaurantId,
      status: order.status,
      totalAmount: order.totalAmount,
      updatedAt: order.updatedAt.toISOString(),
      pickupOtp: order.pickupOtp,
    })

    return NextResponse.json(result.body)
  } catch (error) {
    // P0-25: Transaction conflict (concurrent order on same inventory)
    if (error instanceof TransactionConflictError) {
      logInfo('order-create-conflict', { attempts: error.attempts, code: error.code }, traceId)
      // Sub-Wave 3b C2: Actionable conflict message — distinguish retry-with-same-key
      // (P2002/P1008/P2024 — idempotency cache will return cached response) from
      // retry-with-new-key (P2034/P2036 — business state may have changed).
      // The client SHOULD retry with the SAME Idempotency-Key if one was provided.
      const retryStrategy = idempotencyKey ? 'same-key' : 'new-key'
      return apiError(
        'CONFLICT',
        idempotencyKey
          ? 'Order could not be processed due to a concurrent modification. Retry with the SAME Idempotency-Key to receive the cached response.'
          : 'Order could not be processed due to a concurrent modification. Please retry.',
        409,
        {
          retryStrategy,
          conflictCode: error.code,
          attempts: error.attempts,
          ...(idempotencyKey ? { idempotencyKeyHint: 'Your Idempotency-Key was NOT consumed. Retrying with the same key will return the original response if the first transaction committed.' } : {}),
        },
        traceId,
      )
    }
    // Evidence failure-injection errors are AppError(INTERNAL_ERROR) — rethrow
    // so withErrorHandler returns a 500 with the evidence details.
    throw error
  }
})
