import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
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
// Wave 7 Task 7A — POST /api/group-orders/[id]/cancel — host cancels
// ----------------------------------------------------------------------------
// Body: empty (groupOrderId comes from the URL)
//
// The host cancels an OPEN group order. Status transitions OPEN → CANCELLED.
// Members are notified. If the group order was already CONFIRMED, this
// endpoint returns 409 (host must cancel the underlying Order via the
// existing order-cancel flow instead — payment refund / order CANCELLED
// transition handled by the order governance files).
//
// Idempotent:
//   - If the group order is already CANCELLED, returns the existing state
//     WITHOUT re-notifying members (idempotency check on status).
//   - The route ALSO supports an Idempotency-Key header (resourceType=
//     'GroupOrderCancel') for client-side retry-safety.
//
// Governance (plan §7A):
//   - Auth: getSessionUser() required (401 if no session).
//   - RBAC: caller must be the GroupOrder.hostId (403 otherwise). ADMIN/
//     SUPER_ADMIN bypass for incident response.
//   - Status must be OPEN (409 if CONFIRMED — use order cancel instead;
//     idempotent 200 if already CANCELLED).
//   - Does NOT touch the Order/Payment/Refund tables (host cancels the
//     underlying Order via the existing order-cancel flow if CONFIRMED).
//
// Returns: { groupOrder: { id, status: 'CANCELLED', cancelledAt, version } }
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'GroupOrderCancel'

interface CancelResult {
  type: 'cancelled' | 'already_cancelled' | 'cached'
  status: number
  body?: string
  groupOrderId: string
  statusText: string
  cancelledAt: Date | null
  version: number
}

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
    // Compute idempotency hash BEFORE the transaction.
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
              'group-order-cancel-idempotency-dedup-hit',
              { key: idempotencyKey, groupOrderId, userId: session.userId },
              traceId,
            )
            return {
              type: 'cached' as const,
              status: cached.status,
              body: cached.body,
              groupOrderId,
              statusText: 'CANCELLED',
              cancelledAt: null,
              version: 0,
            }
          }
        }

        // -------------------------------------------------------------------
        // Load + validate the group order.
        // -------------------------------------------------------------------
        const groupOrder = await tx.groupOrder.findUnique({
          where: { id: groupOrderId },
          select: {
            id: true,
            hostId: true,
            status: true,
            shareCode: true,
            version: true,
            confirmedOrderId: true,
            restaurant: { select: { id: true, name: true } },
            members: { select: { id: true, userId: true } },
          },
        })

        if (!groupOrder) {
          throw new AppError(
            'NOT_FOUND',
            `Group order ${groupOrderId} not found`,
            404,
            { groupOrderId },
          )
        }

        // -------------------------------------------------------------------
        // Authorization — host only (ADMIN/SUPER_ADMIN bypass).
        // -------------------------------------------------------------------
        const isHost = groupOrder.hostId === session.userId
        const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
        if (!isHost && !isAdmin) {
          throw new AppError(
            'AUTHORIZATION_DENIED',
            'Only the group order host can cancel this order',
            403,
            { groupOrderId, hostId: groupOrder.hostId, callerId: session.userId },
          )
        }

        // -------------------------------------------------------------------
        // Idempotent — already CANCELLED? Return existing state (and cache
        // the response if an idempotency key was provided).
        // -------------------------------------------------------------------
        if (groupOrder.status === 'CANCELLED') {
          const responseBody = {
            groupOrder: {
              id: groupOrder.id,
              status: 'CANCELLED',
              cancelledAt: null,
              version: groupOrder.version,
            },
          }
          if (idempotencyKey) {
            await storeIdempotencyRecord(
              tx,
              idempotencyKey,
              IDEMPOTENCY_RESOURCE_TYPE,
              groupOrder.id,
              200,
              JSON.stringify(responseBody),
              requestHash,
            )
          }
          return {
            type: 'already_cancelled' as const,
            status: 200,
            groupOrderId: groupOrder.id,
            statusText: 'CANCELLED',
            cancelledAt: null,
            version: groupOrder.version,
          }
        }

        // -------------------------------------------------------------------
        // Validate status — can only cancel OPEN group orders. CONFIRMED
        // orders can't be cancelled via this endpoint (host must cancel the
        // underlying Order via the order-cancel flow).
        // -------------------------------------------------------------------
        if (groupOrder.status === 'CONFIRMED') {
          throw new AppError(
            'CONFLICT',
            'This group order has already been confirmed — cancel the underlying Order instead',
            409,
            {
              groupOrderId: groupOrder.id,
              status: groupOrder.status,
              confirmedOrderId: groupOrder.confirmedOrderId ?? null,
              hint: 'Use the order-cancel flow on the confirmed Order to issue a refund.',
            },
          )
        }
        if (groupOrder.status !== 'OPEN') {
          throw new AppError(
            'CONFLICT',
            `Cannot cancel a group order in status ${groupOrder.status}`,
            409,
            { groupOrderId: groupOrder.id, status: groupOrder.status },
          )
        }

        // -------------------------------------------------------------------
        // Transition GroupOrder → CANCELLED (with optimistic-lock on version).
        // -------------------------------------------------------------------
        const updated = await tx.groupOrder.updateMany({
          where: {
            id: groupOrderId,
            version: groupOrder.version,
            status: 'OPEN',
          },
          data: {
            status: 'CANCELLED',
            version: { increment: 1 },
          },
        })
        if (updated.count === 0) {
          // Race — concurrent transition. Throw CONFLICT; the route's retry
          // will hit the idempotent branch on the second attempt (if the first
          // committed) or re-attempt (if the first rolled back).
          throw new AppError(
            'CONFLICT',
            `Group order ${groupOrderId} could not be cancelled due to a concurrent modification. Please retry.`,
            409,
            {
              groupOrderId,
              expectedVersion: groupOrder.version,
              retryStrategy: 'retry',
            },
          )
        }

        const cancelledAt = new Date()

        // -------------------------------------------------------------------
        // AuditLog GROUP_ORDER_CANCELLED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'GROUP_ORDER_CANCELLED',
            metadata: JSON.stringify({
              groupOrderId: groupOrder.id,
              hostId: groupOrder.hostId,
              restaurantId: groupOrder.restaurant?.id ?? null,
              restaurantName: groupOrder.restaurant?.name ?? null,
              shareCode: groupOrder.shareCode,
              memberCount: groupOrder.members.length,
            }),
          },
        })

        // -------------------------------------------------------------------
        // Outbox event GROUP_ORDER_CANCELLED.
        // -------------------------------------------------------------------
        await enqueueOutboxEvent(tx, {
          eventType: 'GROUP_ORDER_CANCELLED',
          aggregateType: 'GroupOrder',
          aggregateId: groupOrder.id,
          payload: {
            groupOrderId: groupOrder.id,
            hostId: groupOrder.hostId,
            status: 'CANCELLED',
            shareCode: groupOrder.shareCode,
            cancelledAt: cancelledAt.toISOString(),
            memberCount: groupOrder.members.length,
          },
        })

        // -------------------------------------------------------------------
        // Notification to all members: "Group order cancelled by {hostName}"
        // -------------------------------------------------------------------
        const host = await tx.user.findUnique({
          where: { id: groupOrder.hostId },
          select: { name: true },
        })
        const hostDisplayName = host?.name ?? 'the host'
        if (groupOrder.members.length > 0) {
          await tx.notification.createMany({
            data: groupOrder.members.map((m) => ({
              userId: m.userId,
              type: 'GROUP_ORDER_CANCELLED',
              title: 'Group order cancelled',
              body: `Group order from ${groupOrder.restaurant?.name ?? 'a restaurant'} was cancelled by ${hostDisplayName}.`,
              data: JSON.stringify({
                groupOrderId: groupOrder.id,
                hostId: groupOrder.hostId,
                hostName: host?.name ?? null,
                shareCode: groupOrder.shareCode,
                deepLink: `/group/${groupOrder.shareCode}`,
              }),
              readAt: null,
            })),
          })
        }

        const responseBody = {
          groupOrder: {
            id: groupOrder.id,
            status: 'CANCELLED',
            cancelledAt: cancelledAt.toISOString(),
            version: groupOrder.version + 1,
          },
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            groupOrder.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'group-order-cancel-idempotency-key-stored',
            { key: idempotencyKey, groupOrderId: groupOrder.id },
            traceId,
          )
        }

        return {
          type: 'cancelled' as const,
          status: 200,
          groupOrderId: groupOrder.id,
          statusText: 'CANCELLED',
          cancelledAt,
          version: groupOrder.version + 1,
        }
      })

      // -------------------------------------------------------------------
      // Handle result variants — switch for exhaustiveness.
      // -------------------------------------------------------------------
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body ?? '' })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'cancelled':
        case 'already_cancelled': {
          logInfo(
            'group-order-cancel-success',
            {
              groupOrderId: result.groupOrderId,
              hostId: session.userId,
              status: result.statusText,
              alreadyCancelled: result.type === 'already_cancelled',
            },
            traceId,
          )
          return NextResponse.json(
            {
              groupOrder: {
                id: result.groupOrderId,
                status: 'CANCELLED',
                cancelledAt: result.cancelledAt?.toISOString() ?? null,
                version: result.version,
              },
            },
            { status: 200 },
          )
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
          'group-order-cancel-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // AppError (NOT_FOUND, AUTHORIZATION_DENIED, CONFLICT) — propagate.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-cancel-conflict',
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
          'Group order cancel conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
