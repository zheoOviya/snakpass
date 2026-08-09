import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { NEXT_STATUS } from '@/lib/snack'
import { emitOrderUpdated } from '@/lib/realtime'

// PATCH /api/orders/[id]/status  body: { status, actorRole? }
// Enforces the fulfillment state machine (NEXT_STATUS).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body?.status) return NextResponse.json({ error: 'status required' }, { status: 400 })

  const order = await db.order.findUnique({ where: { id } })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const desired = body.status as string
  const allowed = NEXT_STATUS[order.status]
  // allow CANCELLED from any active state
  if (desired !== 'CANCELLED' && desired !== allowed) {
    return NextResponse.json(
      { error: `Invalid transition: ${order.status} -> ${desired}. Expected ${allowed ?? 'terminal'}.` },
      { status: 409 },
    )
  }

  const now = new Date()
  const history = JSON.parse(order.statusHistory || '[]') as { status: string; at: string }[]
  history.push({ status: desired, at: now.toISOString() })

  const updated = await db.order.update({
    where: { id },
    data: { status: desired, statusHistory: JSON.stringify(history) },
    include: { restaurant: { select: { id: true, name: true } } },
  })

  await db.auditLog.create({
    data: {
      actorRole: body.actorRole ?? 'VENDOR_OWNER',
      action: 'ORDER_STATUS_CHANGED',
      metadata: JSON.stringify({ orderId: id, from: order.status, to: desired }),
    },
  })

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
}
