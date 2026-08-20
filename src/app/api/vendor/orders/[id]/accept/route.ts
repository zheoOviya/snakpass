import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'

// ----------------------------------------------------------------------------
// Wave 3 Task 3C — POST /api/vendor/orders/[id]/accept
// ----------------------------------------------------------------------------
// Vendor "accept order" endpoint — records the moment a vendor acknowledges
// an incoming order (analogous to a "read receipt"). Drives the new
// "Restaurant Accepted" step in the consumer's order-tracking timeline.
//
// CRITICAL GOVERNANCE (plan Decision #1):
//   - This is NOT a Fulfilment.status enum value change. The state machine
//     (PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP) is untouched
//     (P0-06 boundary). Instead, the additive nullable column
//     `Fulfilment.acceptedAt` (added by Task 1A) records the timestamp.
//   - The Fulfilment.status remains whatever it currently is (typically
//     PREPARING — lazy-created on first access). Accept is a PARALLEL signal,
//     not a state-machine transition.
//   - `acceptedBy` is NOT a schema column (Fulfilment has only `acceptedAt`).
//     The accepting vendor's userId is recorded in:
//       1. AuditLog.actorId (and embedded in metadata.acceptedBy)
//       2. Outbox event payload.acceptedBy
//       3. Response body.acceptedBy (echoed from the session)
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: VENDOR_OWNER (must own the restaurant) / VENDOR_STAFF / ADMIN /
//       SUPER_ADMIN. CONSUMER → 403. Ownership check uses
//       Restaurant.ownerUserId === session.userId (added by Task 1A — a SOFT
//       FK to User.id without a Prisma relation to avoid touching the User
//       model). ADMIN + SUPER_ADMIN bypass the ownership check.
//
// Idempotency:
//   1. INHERENT — if `Fulfilment.acceptedAt` is already set, returns 200 with
//      `{ accepted: true, alreadyAccepted: true, acceptedAt }` and does NOT
//      re-create audit/outbox/notification. This means safe retries without a
//      client-supplied Idempotency-Key.
//   2. P0-17 EXPLICIT — `Idempotency-Key` header honored; same key on retry
//      returns the cached response (resourceType='VendorOrderAccept').
//
// Side effects (inside withTransaction):
//   - Lazy-create Fulfilment row if missing (status='PREPARING', pickupOtp
//     copied from Order — mirrors the fulfilment/route.ts lazy-create pattern).
//   - Conditional UPDATE: WHERE id = X AND acceptedAt IS NULL — 0 rows means
//     another concurrent transaction accepted in between → re-fetch + return
//     idempotent (no audit/outbox/notification duplication).
//   - AuditLog: action='ORDER_ACCEPTED', metadata={orderId, fulfilmentId,
//     acceptedAt, acceptedBy}.
//   - Outbox event: ORDER_ACCEPTED (additive event type — NOT registered in
//     EVENT_TYPE_TO_SOCKET_EVENT in outbox.ts; consumers can subscribe if
//     needed; the publisher will still deliver via at-least-once).
//   - Notification: userId=order.userId, type='ORDER_ACCEPTED',
//     title='Order accepted! 🎉',
//     body=`{Restaurant.name} accepted your order. They're starting preparation.`,
//     data={ orderId, restaurantId, acceptedAt, acceptedBy }.
//
// Response: 200 { accepted: true, acceptedAt, acceptedBy, alreadyAccepted? }
// Errors: 401 (no session) / 403 (RBAC or ownership) / 404 (order not found)
//         / 409 (transaction conflict) / 422 (Idempotency-Key reuse).
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'VendorOrderAccept'

export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id: orderId } = await params
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
    }

    // -------------------------------------------------------------------------
    // RBAC — CONSUMER is forbidden (403). Allowed: VENDOR_OWNER /
    // VENDOR_STAFF / ADMIN / SUPER_ADMIN.
    // -------------------------------------------------------------------------
    const allowedRoles = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']
    if (!allowedRoles.includes(session.role)) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only vendor staff or admins can accept orders',
        403,
        { requiredRoles: allowedRoles, actualRole: session.role },
        traceId,
      )
    }

    // -------------------------------------------------------------------------
    // Optional body — accept either empty body or `{} ` (no fields needed).
    // -------------------------------------------------------------------------
    let body: unknown = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text)
      }
    } catch {
      // ignore — treat as empty body
    }

    // -------------------------------------------------------------------------
    // Idempotency-Key header (optional). Compute the request hash OUTSIDE the
    // transaction so retries reuse the same hash deterministically.
    // -------------------------------------------------------------------------
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'vendor-accept-idempotency-dedup-hit',
              { key: idempotencyKey, orderId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Load the Order (must exist — Fulfilment is 1:1 to Order).
        // Select the restaurant row so we can (a) check ownership and
        // (b) read the restaurant name for the notification body.
        // -------------------------------------------------------------------
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            userId: true,
            pickupOtp: true,
            status: true,
            restaurantId: true,
            restaurant: {
              select: { id: true, name: true, address: true, ownerUserId: true },
            },
          },
        })
        if (!order) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: { code: 'NOT_FOUND', message: 'Order not found', traceId },
            },
          }
        }

        // -------------------------------------------------------------------
        // Vendor ownership check — VENDOR_OWNER / VENDOR_STAFF must own the
        // restaurant (Restaurant.ownerUserId === session.userId). ADMIN +
        // SUPER_ADMIN bypass this check.
        //
        // Note: Restaurant.ownerUserId is a SOFT FK to User.id (added by Task
        // 1A — no Prisma relation declared to avoid touching the User model).
        // It is nullable; if null, no vendor has claimed this restaurant, and
        // the ownership check fails for VENDOR_OWNER/VENDOR_STAFF (but ADMIN
        // / SUPER_ADMIN can still accept).
        // -------------------------------------------------------------------
        if (session.role === 'VENDOR_OWNER' || session.role === 'VENDOR_STAFF') {
          if (!order.restaurant.ownerUserId || order.restaurant.ownerUserId !== session.userId) {
            return {
              type: 'error' as const,
              status: 403,
              body: {
                error: {
                  code: 'AUTHORIZATION_DENIED',
                  message:
                    'You can only accept orders for restaurants you own',
                  traceId,
                  details: {
                    orderId,
                    restaurantId: order.restaurantId,
                    restaurantOwnerId: order.restaurant.ownerUserId ?? null,
                    requesterId: session.userId,
                  },
                },
              },
            }
          }
        }

        // -------------------------------------------------------------------
        // Lazy-create Fulfilment row if missing (mirrors
        // /api/orders/[id]/fulfilment GET/PATCH lazy-create pattern). If the
        // row exists, we read it as-is — accept is additive on top of the
        // existing status, never modifies it.
        // -------------------------------------------------------------------
        let fulfilment = await tx.fulfilment.findUnique({
          where: { orderId },
        })
        if (!fulfilment) {
          fulfilment = await tx.fulfilment.create({
            data: {
              orderId,
              status: 'PREPARING',
              pickupOtp: order.pickupOtp,
            },
          })
          logInfo(
            'vendor-accept-fulfilment-lazy-created',
            { orderId, fulfilmentId: fulfilment.id },
            traceId,
          )
        }

        // -------------------------------------------------------------------
        // INHERENT IDEMPOTENCY — if acceptedAt is already set, return 200 with
        // alreadyAccepted: true (no audit/outbox/notification duplication).
        // -------------------------------------------------------------------
        if (fulfilment.acceptedAt) {
          const idempotentBody = {
            accepted: true,
            alreadyAccepted: true,
            acceptedAt: fulfilment.acceptedAt.toISOString(),
            acceptedBy: session.userId,
            orderId,
            fulfilmentId: fulfilment.id,
          }
          if (idempotencyKey) {
            await storeIdempotencyRecord(
              tx,
              idempotencyKey,
              IDEMPOTENCY_RESOURCE_TYPE,
              fulfilment.id,
              200,
              JSON.stringify(idempotentBody),
              requestHash,
            )
          }
          logInfo(
            'vendor-accept-already-accepted',
            { orderId, fulfilmentId: fulfilment.id, acceptedAt: fulfilment.acceptedAt.toISOString() },
            traceId,
          )
          return { type: 'ok' as const, status: 200, body: idempotentBody }
        }

        // -------------------------------------------------------------------
        // Conditional UPDATE — `WHERE id = X AND acceptedAt IS NULL`. 0 rows
        // means another concurrent transaction accepted in between → re-fetch
        // + return idempotent (no audit/outbox/notification duplication).
        // This is atomic + race-safe without needing version-based locking
        // (the acceptedAt column is set exactly once per fulfilment row).
        // -------------------------------------------------------------------
        const now = new Date()
        const updateResult = await tx.fulfilment.updateMany({
          where: { id: fulfilment.id, acceptedAt: null },
          data: { acceptedAt: now },
        })

        if (updateResult.count === 0) {
          // Another transaction beat us — re-fetch the acceptedAt + return
          // idempotent (this is a benign race, NOT a conflict).
          const refetched = await tx.fulfilment.findUnique({
            where: { id: fulfilment.id },
          })
          const acceptedAtIso = refetched?.acceptedAt?.toISOString() ?? now.toISOString()
          const idempotentBody = {
            accepted: true,
            alreadyAccepted: true,
            acceptedAt: acceptedAtIso,
            acceptedBy: session.userId,
            orderId,
            fulfilmentId: fulfilment.id,
          }
          if (idempotencyKey) {
            await storeIdempotencyRecord(
              tx,
              idempotencyKey,
              IDEMPOTENCY_RESOURCE_TYPE,
              fulfilment.id,
              200,
              JSON.stringify(idempotentBody),
              requestHash,
            )
          }
          logInfo(
            'vendor-accept-race-resolved-idempotent',
            { orderId, fulfilmentId: fulfilment.id, acceptedAt: acceptedAtIso },
            traceId,
          )
          return { type: 'ok' as const, status: 200, body: idempotentBody }
        }

        // -------------------------------------------------------------------
        // SUCCESS — acceptedAt was just set. Write audit + outbox +
        // notification atomically.
        // -------------------------------------------------------------------
        const acceptedAtIso = now.toISOString()

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'ORDER_ACCEPTED',
            metadata: JSON.stringify({
              orderId,
              fulfilmentId: fulfilment.id,
              restaurantId: order.restaurantId,
              acceptedAt: acceptedAtIso,
              acceptedBy: session.userId,
            }),
          },
        })

        // Outbox event — additive ORDER_ACCEPTED type. NOT registered in
        // EVENT_TYPE_TO_SOCKET_EVENT in outbox.ts (governance: do NOT modify
        // outbox.ts). The publisher will still deliver via at-least-once;
        // consumers can subscribe to ORDER_ACCEPTED events when they wire up
        // their socket relays in a future wave.
        await enqueueOutboxEvent(tx, {
          eventType: 'ORDER_ACCEPTED',
          aggregateType: 'Order',
          aggregateId: orderId,
          payload: {
            orderId,
            restaurantId: order.restaurantId,
            restaurantName: order.restaurant.name,
            acceptedAt: acceptedAtIso,
            acceptedBy: session.userId,
            acceptedByRole: session.role,
            consumerUserId: order.userId,
            fulfilmentId: fulfilment.id,
          },
        })

        // Notification for the consumer — type 'ORDER_ACCEPTED' (uppercase to
        // match the existing notification-type convention in seed.ts).
        await tx.notification.create({
          data: {
            userId: order.userId,
            type: 'ORDER_ACCEPTED',
            title: 'Order accepted! 🎉',
            body: `${order.restaurant.name} accepted your order. They're starting preparation.`,
            data: JSON.stringify({
              orderId,
              restaurantId: order.restaurantId,
              restaurantName: order.restaurant.name,
              acceptedAt: acceptedAtIso,
              acceptedBy: session.userId,
            }),
          },
        })

        const responseBody = {
          accepted: true,
          alreadyAccepted: false,
          acceptedAt: acceptedAtIso,
          acceptedBy: session.userId,
          orderId,
          fulfilmentId: fulfilment.id,
        }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            fulfilment.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'vendor-accept-idempotency-key-stored',
            {
              key: idempotencyKey,
              fulfilmentId: fulfilment.id,
              requestHashStored: requestHash !== null,
            },
            traceId,
          )
        }

        return { type: 'success' as const, status: 200, body: responseBody }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'ok':
        case 'success': {
          logInfo(
            'vendor-accept-success',
            { orderId, alreadyAccepted: result.body.alreadyAccepted === true },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          // Exhaustiveness guard — if a new variant is added to the union
          // without a case here, TypeScript flags this assignment as an error
          // (because `result` is `never` after all cases are handled).
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'vendor-accept-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        logInfo(
          'vendor-accept-conflict',
          { attempts: error.attempts, code: error.code, orderId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Order accept conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
