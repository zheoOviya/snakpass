import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'
import { auditWithTx } from '@/lib/audit'

// ----------------------------------------------------------------------------
// S5H1: POST /api/social/share-order
// ----------------------------------------------------------------------------
// Server-authoritative endpoint for sharing a real Order as a SocialActivity.
//
// This is the ONLY way to create an ORDERED SocialActivity with a non-NULL
// sourceOrderId. The generic POST /api/social/activities endpoint does NOT
// set sourceOrderId (it remains NULL — legacy activities excluded from
// social-proof query).
//
// TRUST CHAIN (all server-derived):
//   1. Order ownership: order.userId === session.userId (client can't share
//      someone else's order)
//   2. Order status: must be in QUALIFYING_ORDER_STATUSES (real paid purchase)
//   3. Restaurant identity: objectId = order.restaurantId (server-derived,
//      NOT client-supplied — prevents restaurant mismatch)
//   4. Actor identity: actorId = session.userId (server-set)
//   5. sourceOrderId: server-set FK to Order.id (authoritative link)
//   6. Idempotency: @@unique([actorId, sourceOrderId]) — one share per order
//
// Auth: getSessionUser() required (401 if no session).
//
// Body: { orderId: string, visibility?: 'FRIENDS' | 'PUBLIC' | 'PRIVATE' }
//
// Response: 201 { activity: { id, visibility, sourceOrderId, ... } }
//           200 { activity: { ... } } (idempotent — existing share returned)
//           400 (invalid status/visibility)
//           403 (not order owner)
//           404 (order not found)
//           409 (conflict — should not happen due to @@unique, but handled)
// ----------------------------------------------------------------------------

const QUALIFYING_ORDER_STATUSES = new Set([
  'CONFIRMED',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'PAID',
])

export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

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

    // Parse body
    let body: { orderId?: unknown; visibility?: unknown } = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as typeof body
      }
    } catch {
      // ignore — fails validation below
    }

    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) {
      return apiError(
        'VALIDATION_ERROR',
        'orderId is required',
        400,
        { field: 'orderId' },
        traceId,
      ) as unknown as NextResponse
    }

    // Validate visibility (default FRIENDS)
    let visibility: 'FRIENDS' | 'PUBLIC' | 'PRIVATE' = 'FRIENDS'
    if (typeof body.visibility === 'string') {
      const v = body.visibility.trim().toUpperCase()
      if (v === 'FRIENDS' || v === 'PUBLIC' || v === 'PRIVATE') {
        visibility = v
      } else {
        return apiError(
          'VALIDATION_ERROR',
          `Invalid visibility '${body.visibility}'`,
          400,
          { field: 'visibility', allowed: ['FRIENDS', 'PUBLIC', 'PRIVATE'] },
          traceId,
        ) as unknown as NextResponse
      }
    }

    try {
      const result = await withTransaction(async (tx) => {
        // 1. Load the Order (with restaurant for metadata)
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            userId: true,
            restaurantId: true,
            status: true,
            restaurant: { select: { id: true, name: true } },
          },
        })

        if (!order) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: 'Order not found',
                traceId,
                details: { orderId },
              },
            },
          }
        }

        // 2. Validate ownership — client cannot share someone else's order
        if (order.userId !== session.userId) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'You can only share your own orders',
                traceId,
              },
            },
          }
        }

        // 3. Validate order status — must be a qualifying real purchase
        if (!QUALIFYING_ORDER_STATUSES.has(order.status)) {
          return {
            type: 'error' as const,
            status: 400,
            body: {
              error: {
                code: 'VALIDATION_ERROR',
                message: `Order status '${order.status}' does not qualify for social sharing`,
                traceId,
                details: {
                  currentStatus: order.status,
                  qualifyingStatuses: Array.from(QUALIFYING_ORDER_STATUSES),
                },
              },
            },
          }
        }

        // 4. Check for existing share (idempotent — @@unique([actorId, sourceOrderId]))
        const existing = await tx.socialActivity.findFirst({
          where: {
            actorId: session.userId,
            sourceOrderId: orderId,
            verb: 'ORDERED',
          },
          select: {
            id: true,
            visibility: true,
            sourceOrderId: true,
            objectId: true,
            createdAt: true,
          },
        })

        if (existing) {
          // Idempotent — return existing share
          return {
            type: 'success' as const,
            status: 200,
            body: {
              activity: {
                id: existing.id,
                verb: 'ORDERED',
                objectType: 'Restaurant',
                objectId: existing.objectId,
                visibility: existing.visibility,
                sourceOrderId: existing.sourceOrderId,
                createdAt: existing.createdAt.toISOString(),
              },
              idempotent: true,
            },
          }
        }

        // 5. Create the SocialActivity with server-derived fields
        //    - actorId = session.userId (server-set)
        //    - objectId = order.restaurantId (server-derived, NOT client)
        //    - sourceOrderId = order.id (authoritative FK)
        //    - visibility = client-chosen (FRIENDS/PUBLIC/PRIVATE)
        const activity = await tx.socialActivity.create({
          data: {
            actorId: session.userId,
            verb: 'ORDERED',
            objectType: 'Restaurant',
            objectId: order.restaurantId, // server-derived from Order
            metadata: JSON.stringify({
              restaurantName: order.restaurant?.name ?? 'Unknown',
            }),
            visibility,
            sourceOrderId: order.id, // authoritative FK — server-set only
          },
          select: {
            id: true,
            verb: true,
            objectType: true,
            objectId: true,
            visibility: true,
            sourceOrderId: true,
            createdAt: true,
          },
        })

        // 6. Audit log
        await auditWithTx(
          tx,
          'SOCIAL_ORDER_SHARED',
          {
            orderId: order.id,
            restaurantId: order.restaurantId,
            activityId: activity.id,
            visibility,
          },
          session.userId,
          session.role,
        )

        return {
          type: 'success' as const,
          status: 201,
          body: {
            activity: {
              id: activity.id,
              verb: activity.verb,
              objectType: activity.objectType,
              objectId: activity.objectId,
              visibility: activity.visibility,
              sourceOrderId: activity.sourceOrderId,
              createdAt: activity.createdAt.toISOString(),
            },
            idempotent: false,
          },
        }
      })

      switch (result.type) {
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'success': {
          logInfo(
            'social-order-shared',
            {
              orderId,
              activityId: result.body.activity.id,
              visibility: result.body.activity.visibility,
              idempotent: result.body.idempotent,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Share conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        ) as unknown as NextResponse
      }
      // P2002 = unique constraint violation — already handled by idempotent check,
      // but if race condition causes it, treat as idempotent success
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        // Re-fetch the existing share
        const existing = await db.socialActivity.findFirst({
          where: { actorId: session.userId, sourceOrderId: orderId, verb: 'ORDERED' },
          select: { id: true, visibility: true, sourceOrderId: true, objectId: true, createdAt: true },
        })
        if (existing) {
          return NextResponse.json(
            {
              activity: {
                id: existing.id,
                verb: 'ORDERED',
                objectType: 'Restaurant',
                objectId: existing.objectId,
                visibility: existing.visibility,
                sourceOrderId: existing.sourceOrderId,
                createdAt: existing.createdAt.toISOString(),
              },
              idempotent: true,
            },
            { status: 200 },
          )
        }
      }
      throw error
    }
  })
