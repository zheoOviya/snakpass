import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { NEXT_STATUS } from '@/lib/snack'
import { emitOrderUpdated } from '@/lib/realtime'
import { createOtp } from '@/lib/otp-service'
import { validateBody, statusUpdateBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError, AppError } from '@/lib/errors'
import { info as logInfo, warn as logWarn, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { getSessionUser } from '@/lib/session'
import { isFeatureEnabled } from '@/lib/deployment'

// PATCH /api/orders/[id]/status  body: { status, actorRole? }
// P0-25 Case B: State-transition race protection via optimistic locking.
// The PATCH uses a conditional UPDATE (`WHERE id = X AND version = expectedVersion`).
// If another request changed the order between our read + write, the UPDATE
// affects 0 rows → we return 409 Conflict.
//
// P0-07 — CRITICAL SECURITY FIX (additive — backward-compatible when flag OFF):
//   - AuthN: getSessionUser() required (401 if no session). Pre-P0-07, this
//     route was COMPLETELY UNAUTHENTICATED — any anonymous caller could drive
//     Order.status to PICKED_UP.
//   - RBAC:
//       * VENDOR_OWNER / ADMIN / SUPER_ADMIN → any transition (except PICKED_UP
//         when pickupAttributionEnforcement is ON — see below)
//       * CONSUMER → CANCEL only, AND only for their own order (order.userId
//         === session.userId)
//   - When pickupAttributionEnforcement flag is ON (default OFF — P0-27):
//       * PICKED_UP is DEPRECATED via this route → 409 directing the caller to
//         POST /api/orders/[id]/pickup/verify (the dedicated pickup-attribution
//         endpoint). This closes the I-13 gap: no caller can bypass QR+OTP
//         verification by transitioning Order.status directly.
//   - When OFF (default): existing behavior preserved (any authenticated
//     VENDOR_OWNER/ADMIN can transition to PICKED_UP — backward-compatible).
//   - Audit fix: actorId = session.userId, actorRole = actorRole ?? session.role
//     (was: actorRole defaulted to 'VENDOR_OWNER' regardless of caller).
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id } = await params
    const traceId = newTraceId()
    const { status: desired, actorRole } = await validateBody(req, statusUpdateBodySchema)

    // -------------------------------------------------------------------------
    // P0-07: AuthN — required for ALL transitions.
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
    }

    // -------------------------------------------------------------------------
    // P0-07: Flag-gated PICKED_UP deprecation.
    // When pickupAttributionEnforcement is ON, PICKED_UP via this route is
    // REJECTED with 409 — the caller must use POST /api/orders/[id]/pickup/verify
    // (the dedicated pickup-attribution endpoint that performs QR+OTP
    // verification + writes pickupVerifiedAt/By).
    // When OFF (default): existing behavior preserved (backward-compatible).
    // -------------------------------------------------------------------------
    if (desired === 'PICKED_UP' && isFeatureEnabled('pickupAttributionEnforcement')) {
      logWarn(
        'order-status-picked-up-deprecated',
        { orderId: id, flagState: 'ON' },
        traceId,
      )
      return apiError(
        'CONFLICT',
        'Direct PICKED_UP transition is deprecated when pickupAttributionEnforcement is ON. Use POST /api/orders/' +
          id +
          '/pickup/verify with a QR token + OTP to attribute pickup.',
        409,
        {
          deprecatedTransition: 'PICKED_UP',
          redirectEndpoint: `/api/orders/${id}/pickup/verify`,
          redirectMethod: 'POST',
          requiredPayload: { otpId: '<otpId>', code: '<6-digit OTP>', qrToken: '<QR token>' },
        },
        traceId,
      )
    }

    // -------------------------------------------------------------------------
    // P0-07: RBAC.
    //   - VENDOR_OWNER / ADMIN / SUPER_ADMIN → any transition (except
    //     PICKED_UP when flag is ON — handled above)
    //   - CONSUMER → CANCEL only + ownership check
    // Any other role (e.g., VENDOR_STAFF) → 403.
    // -------------------------------------------------------------------------
    const elevatedRoles = ['VENDOR_OWNER', 'ADMIN', 'SUPER_ADMIN']
    if (!elevatedRoles.includes(session.role)) {
      if (session.role !== 'CONSUMER') {
        return apiError(
          'AUTHORIZATION_DENIED',
          'Insufficient permissions for order status transition',
          403,
          { requiredRoles: [...elevatedRoles, 'CONSUMER'], actualRole: session.role },
          traceId,
        )
      }
      // CONSUMER → CANCEL only
      if (desired !== 'CANCELLED') {
        return apiError(
          'AUTHORIZATION_DENIED',
          'Consumers can only cancel orders — other transitions require vendor/admin role.',
          403,
          { requestedTransition: desired, allowedTransition: 'CANCELLED', actualRole: session.role },
          traceId,
        )
      }
      // Ownership check happens INSIDE the txn (after the Order row is loaded)
      // — we don't want a separate DB round-trip before the txn opens.
    }

    try {
      const result = await withTransaction(async (tx) => {
        // Read the order with its current version (inside txn for consistency)
        const order = await tx.order.findUnique({
          where: { id },
          include: { user: true },
        })
        if (!order) {
          return {
            type: 'error' as const,
            status: 404,
            body: { error: { code: 'NOT_FOUND', message: 'Order not found', traceId } },
          }
        }

        // -------------------------------------------------------------------
        // P0-07: CONSUMER ownership check (inside txn — see RBAC above).
        // -------------------------------------------------------------------
        if (session.role === 'CONSUMER' && order.userId !== session.userId) {
          throw new AppError(
            'AUTHORIZATION_DENIED',
            'You can only cancel your own orders',
            403,
            { orderId: id, orderOwnerId: order.userId, requesterId: session.userId },
          )
        }

        const allowed = NEXT_STATUS[order.status]
        if (desired !== 'CANCELLED' && desired !== allowed) {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: `Invalid transition: ${order.status} -> ${desired}. Expected ${allowed ?? 'terminal'}.`,
                traceId,
              },
            },
          }
        }

        let pickupOtp = order.pickupOtp
        if (desired === 'READY_FOR_PICKUP' && order.user?.phone) {
          const otp = await createOtp('phone', order.user.phone, 'pickup')
          pickupOtp = otp.code
          logInfo('pickup-otp-issued', { orderId: id, phone: order.user.phone }, traceId)
        }

        const now = new Date()
        const history = JSON.parse(order.statusHistory || '[]') as { status: string; at: string }[]
        history.push({ status: desired, at: now.toISOString() })

        // P0-25 Case B: Optimistic-lock conditional UPDATE.
        // `WHERE id = X AND version = <expected>` — if another request changed
        // the order between our read + write, this affects 0 rows.
        const updated = await tx.order.updateMany({
          where: { id, version: order.version },
          data: {
            status: desired,
            statusHistory: JSON.stringify(history),
            ...(pickupOtp !== order.pickupOtp ? { pickupOtp } : {}),
            version: { increment: 1 },
          },
        })

        if (updated.count === 0) {
          // Version mismatch — another request won the race
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: 'Order was modified by another request. Please refresh and retry.',
                traceId,
              },
            },
          }
        }

        // Fetch the updated order (with relations) for the response
        const updatedOrder = await tx.order.findUnique({
          where: { id },
          include: { restaurant: { select: { id: true, name: true } } },
        })

        await tx.auditLog.create({
          data: {
            // P0-07 fix: actorId/actorRole now correctly attributed to the
            // session (was: actorRole defaulted to 'VENDOR_OWNER' regardless
            // of caller, and actorId was never set).
            actorId: session.userId,
            actorRole: actorRole ?? session.role,
            action: 'ORDER_STATUS_CHANGED',
            metadata: JSON.stringify({ orderId: id, from: order.status, to: desired }),
          },
        })

        // P0-24: Write outbox event INSIDE the same transaction.
        await enqueueOutboxEvent(tx, {
          eventType: 'ORDER_STATUS_CHANGED',
          aggregateType: 'Order',
          aggregateId: id,
          payload: {
            orderId: id,
            restaurantId: updatedOrder?.restaurantId ?? '',
            status: desired,
            totalAmount: updatedOrder?.totalAmount ?? 0,
            updatedAt: updatedOrder?.updatedAt.toISOString() ?? new Date().toISOString(),
            pickupOtp: updatedOrder?.pickupOtp ?? '',
          },
        })

        return { type: 'success' as const, order: updatedOrder, from: order.status, to: desired }
      })

      if (result.type === 'error') {
        return NextResponse.json(result.body, { status: result.status })
      }

      const { order: updated, from, to } = result
      if (!updated) {
        // Should not happen, but be defensive
        return apiError('INTERNAL_ERROR', 'Failed to fetch updated order', 500, undefined, traceId)
      }

      logInfo(
        'order-status-changed',
        { orderId: id, from, to, actorId: session.userId, actorRole: actorRole ?? session.role },
        traceId,
      )

      emitOrderUpdated({
        orderId: updated.id,
        restaurantId: updated.restaurantId,
        status: updated.status,
        totalAmount: updated.totalAmount,
        updatedAt: updated.updatedAt.toISOString(),
        pickupOtp: updated.pickupOtp,
      })

      return NextResponse.json({
        order: {
          id: updated.id,
          status: updated.status,
          totalAmount: updated.totalAmount,
          pickupOtp: updated.pickupOtp,
          updatedAt: updated.updatedAt,
          statusHistory: updated.statusHistory,
          restaurant: updated.restaurant,
        },
      })
    } catch (error) {
      // P0-07: surface AppError (e.g., ownership-denied) via withErrorHandler's
      // existing catch path — it converts AppError → apiError with the proper
      // status code.
      if (error instanceof TransactionConflictError) {
        logInfo('order-status-conflict', { attempts: error.attempts, code: error.code }, traceId)
        return apiError(
          'CONFLICT',
          'Order status update conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
