import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { NEXT_STATUS } from '@/lib/snack'
import { emitOrderUpdated } from '@/lib/realtime'
import { createOtp } from '@/lib/otp-service'
import { validateBody, statusUpdateBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'

// PATCH /api/orders/[id]/status  body: { status, actorRole? }
// P0-25 Case B: State-transition race protection via optimistic locking.
// The PATCH uses a conditional UPDATE (`WHERE id = X AND version = expectedVersion`).
// If another request changed the order between our read + write, the UPDATE
// affects 0 rows → we return 409 Conflict.
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id } = await params
    const traceId = newTraceId()
    const { status: desired, actorRole } = await validateBody(req, statusUpdateBodySchema)

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
            actorRole: actorRole ?? 'VENDOR_OWNER',
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

      logInfo('order-status-changed', { orderId: id, from, to }, traceId)

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
