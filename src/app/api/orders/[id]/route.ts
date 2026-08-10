import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/orders/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const o = await db.order.findUnique({
    where: { id },
    include: {
      restaurant: { select: { id: true, name: true, cuisine: true, address: true, prepTimeMins: true } },
      orderItems: true,
    },
  })
  if (!o) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    order: {
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
    },
  })
}
