import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { emitOrderCreated } from '@/lib/realtime'
import { validateBody, createOrderBodySchema } from '@/lib/validation'
import { apiError, withErrorHandler } from '@/lib/errors'
import { info as logInfo, warn as logWarn, newTraceId } from '@/lib/logger'

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
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const traceId = newTraceId()

  // P0-12: Zod validation
  const body = await validateBody(req, createOrderBodySchema)

  logInfo('order.create.request', { restaurantId: body.restaurantId, itemCount: body.items.length, traceId }, traceId)

  // Kill switch guard: ordering
  const orderingKs = await db.killSwitch.findUnique({ where: { key: 'ordering' } })
  if (orderingKs?.enabled) {
    logWarn('order.create.blocked', { reason: 'kill_switch_ordering', traceId }, traceId)
    return apiError('KILL_SWITCH_ACTIVE', 'Ordering is currently disabled (kill switch active).', 503, undefined, traceId)
  }
  if (body.isCatering) {
    const catKs = await db.killSwitch.findUnique({ where: { key: 'catering' } })
    if (catKs?.enabled) {
      logWarn('order.create.blocked', { reason: 'kill_switch_catering', traceId }, traceId)
      return NextResponse.json({ error: 'Catering orders are currently disabled.' }, { status: 503 })
    }
  }

  const session = await getSessionUser()
  if (!session) {
    logWarn('order.create.unauthorized', { traceId }, traceId)
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const consumerId = session.userId
  const restaurant = await db.restaurant.findUnique({ where: { id: body.restaurantId } })
  if (!restaurant || !restaurant.isActive || restaurant.isSuspended) {
    logWarn('order.create.restaurant_unavailable', { restaurantId: body.restaurantId, traceId }, traceId)
    return NextResponse.json({ error: 'Restaurant unavailable' }, { status: 400 })
  }

  const total = body.items.reduce((s: number, i: { price: number; quantity: number }) => s + i.price * i.quantity, 0)
  const itemsCount = body.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0)
  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const now = new Date().toISOString()

  const order = await db.order.create({
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

  logInfo('order.create.success', { orderId: order.id, total, restaurantName: restaurant.name, traceId }, traceId)

  await db.auditLog.create({
    data: {
      actorId: consumerId,
      actorRole: 'CONSUMER',
      action: 'ORDER_CREATED',
      metadata: JSON.stringify({ orderId: order.id, total, restaurantId: body.restaurantId }),
    },
  })

  emitOrderCreated({
    orderId: order.id,
    restaurantId: order.restaurantId,
    status: order.status,
    totalAmount: order.totalAmount,
    updatedAt: order.updatedAt.toISOString(),
    pickupOtp: order.pickupOtp,
  })

  return NextResponse.json({
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
  })
})
