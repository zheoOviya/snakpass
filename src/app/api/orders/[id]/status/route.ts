import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { NEXT_STATUS } from '@/lib/snack'
import { emitOrderUpdated } from '@/lib/realtime'
import { createOtp } from '@/lib/otp-service'
import { validateBody, statusUpdateBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { info as logInfo } from '@/lib/logger'

// PATCH /api/orders/[id]/status  body: { status, actorRole? }
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(req, async (traceId) => {
    const { id } = await params
    const { status: desired, actorRole } = await validateBody(req, statusUpdateBodySchema)

    const order = await db.order.findUnique({ where: { id }, include: { user: true } })
    if (!order) return apiError('NOT_FOUND', 'Order not found', 404, undefined, traceId)

    const allowed = NEXT_STATUS[order.status]
    if (desired !== 'CANCELLED' && desired !== allowed) {
      return apiError(
        'CONFLICT',
        `Invalid transition: ${order.status} -> ${desired}. Expected ${allowed ?? 'terminal'}.`,
        409,
        undefined,
        traceId,
      )
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

    const updated = await db.order.update({
      where: { id },
      data: { status: desired, statusHistory: JSON.stringify(history), ...(pickupOtp !== order.pickupOtp ? { pickupOtp } : {}) },
      include: { restaurant: { select: { id: true, name: true } } },
    })

    await db.auditLog.create({
      data: {
        actorRole: actorRole ?? 'VENDOR_OWNER',
        action: 'ORDER_STATUS_CHANGED',
        metadata: JSON.stringify({ orderId: id, from: order.status, to: desired }),
      },
    })

    logInfo('order-status-changed', { orderId: id, from: order.status, to: desired }, traceId)

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
  })
