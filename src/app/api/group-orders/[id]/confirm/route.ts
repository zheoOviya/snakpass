import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import { confirmGroupOrder } from '@/lib/group-order-service'

// ----------------------------------------------------------------------------
// Wave 7 Task 7A — POST /api/group-orders/[id]/confirm — host confirms
// ----------------------------------------------------------------------------
// Body: empty (groupOrderId comes from the URL)
//
// The host confirms a group order → creates a single merged Order with all
// members' items merged by menuItemId (sum quantities). The GroupOrder
// transitions to CONFIRMED + confirmedOrderId is set.
//
// Idempotent:
//   - If the group order is already CONFIRMED, the existing confirmed Order
//     is returned WITHOUT creating a duplicate (the service function's
//     idempotency check).
//   - The route ALSO supports an Idempotency-Key header (resourceType=
//     'GroupOrderConfirm') for client-side retry-safety. Same key on retry
//     returns the cached response.
//
// Governance (plan §7A):
//   - Auth: getSessionUser() required (401 if no session).
//   - RBAC: caller must be the GroupOrder.hostId (403 otherwise). ADMIN/
//     SUPER_ADMIN bypass for incident response.
//   - The Order is created via direct `tx.order.create` inside
//     withTransaction — does NOT call /api/orders POST (preserves order
//     route governance per plan Decision #4).
//   - The Order's `note` encodes `GROUP_ORDER:${groupOrderId}` so the
//     frontend can filter it from "My Orders" UI.
//   - Host pays via the existing /api/payments POST route on the confirmed
//     Order (NOT touched here).
//
// Returns: { order: { id, status, totalAmount, pickupOtp, itemsCount, note,
//            restaurantId, userId, createdAt }, groupOrder: { id, status:
//            'CONFIRMED', confirmedOrderId, confirmedAt, version },
//            created: boolean }
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'GroupOrderConfirm'

export const POST = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: groupOrderId } = await params

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Compute idempotency hash BEFORE the transaction (deterministic — same on retry).
    // The body is empty (groupOrderId comes from URL) — we hash the groupOrderId
    // so a confirm-then-confirm-again with the same key returns the cached response.
    // -------------------------------------------------------------------------
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash({ groupOrderId }) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'group-order-confirm-idempotency-dedup-hit',
              { key: idempotencyKey, groupOrderId, userId: session.userId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Pre-flight authorization check — load the group order OUTSIDE the
        // service function so we can return a clean 403 (instead of relying
        // on the service function's defensive 403). The service function
        // ALSO checks authoritatively (defense-in-depth).
        //
        // NOTE: This read is INSIDE the transaction so it sees the same
        // snapshot as the service function's read. We pass the hostName in
        // so the notification body can include "{hostName} confirmed".
        // -------------------------------------------------------------------
        const groupOrderRow = await tx.groupOrder.findUnique({
          where: { id: groupOrderId },
          select: {
            id: true,
            hostId: true,
            status: true,
            confirmedOrderId: true,
          },
        })

        if (!groupOrderRow) {
          throw new AppError(
            'NOT_FOUND',
            `Group order ${groupOrderId} not found`,
            404,
            { groupOrderId },
          )
        }

        const isHost = groupOrderRow.hostId === session.userId
        const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
        if (!isHost && !isAdmin) {
          throw new AppError(
            'AUTHORIZATION_DENIED',
            'Only the group order host can confirm this order',
            403,
            { groupOrderId, hostId: groupOrderRow.hostId, callerId: session.userId },
          )
        }

        // -------------------------------------------------------------------
        // Resolve the host's display name for the notification body
        // ("Group order confirmed by {hostName}! 🎉").
        // -------------------------------------------------------------------
        const host = await tx.user.findUnique({
          where: { id: groupOrderRow.hostId },
          select: { id: true, name: true },
        })
        const hostName = host?.name ?? null

        // -------------------------------------------------------------------
        // Delegate to group-order-service.confirmGroupOrder for the atomic
        // mutation. Throws AppError on:
        //   - NOT_FOUND (already checked above — defensive)
        //   - AUTHORIZATION_DENIED (already checked above — defensive)
        //   - CONFLICT (status=OPEN race / already CONFIRMED by a concurrent txn)
        //   - VALIDATION_ERROR (empty group order)
        //   - UNKNOWN_STATE (confirmedOrderId set but Order missing — data corruption)
        // -------------------------------------------------------------------
        const confirmed = await confirmGroupOrder(tx, {
          groupOrderId,
          hostId: session.userId,
          hostRole: session.role,
          hostName,
          traceId,
        })

        const responseBody = {
          order: {
            id: confirmed.order.id,
            status: confirmed.order.status,
            totalAmount: confirmed.order.totalAmount,
            pickupOtp: confirmed.order.pickupOtp,
            itemsCount: confirmed.order.itemsCount,
            note: confirmed.order.note,
            restaurantId: confirmed.order.restaurantId,
            userId: confirmed.order.userId,
            createdAt: confirmed.order.createdAt.toISOString(),
          },
          groupOrder: {
            id: confirmed.groupOrder.id,
            status: confirmed.groupOrder.status,
            confirmedOrderId: confirmed.groupOrder.confirmedOrderId,
            confirmedAt: confirmed.groupOrder.confirmedAt?.toISOString() ?? null,
            version: confirmed.groupOrder.version,
          },
          created: confirmed.created,
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            confirmed.order.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'group-order-confirm-idempotency-key-stored',
            {
              key: idempotencyKey,
              groupOrderId,
              orderId: confirmed.order.id,
              requestHashStored: requestHash !== null,
            },
            traceId,
          )
        }

        return {
          type: 'confirmed' as const,
          status: 200,
          body: responseBody,
          orderId: confirmed.order.id,
          created: confirmed.created,
        }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'confirmed': {
          logInfo(
            'group-order-confirm-success',
            {
              groupOrderId,
              orderId: result.orderId,
              hostId: session.userId,
              created: result.created,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          // Exhaustiveness guard
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      // Sub-Wave 3c: IdempotencyKeyReuseError — same key + different body.
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'group-order-confirm-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // AppError (NOT_FOUND, AUTHORIZATION_DENIED, CONFLICT, VALIDATION_ERROR,
      // UNKNOWN_STATE) — propagate to withErrorHandler for status mapping.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted (concurrent confirm race).
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-confirm-conflict',
          {
            attempts: error.attempts,
            code: error.code,
            userId: session.userId,
            groupOrderId,
          },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Group order confirm conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
