import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/admin/metrics
export async function GET() {
  const totalOrders = await db.order.count()
  const activeOrders = await db.order.count({
    where: { status: { in: ['CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP'] } },
  })
  const pickedUp = await db.order.count({ where: { status: 'PICKED_UP' } })
  const cancelled = await db.order.count({ where: { status: 'CANCELLED' } })

  const revenueAgg = await db.order.aggregate({
    _sum: { totalAmount: true },
    where: { status: { in: ['PICKED_UP', 'READY_FOR_PICKUP', 'ALMOST_READY', 'PREPARING', 'CONFIRMED'] } },
  })
  const settledAgg = await db.order.aggregate({
    _sum: { totalAmount: true },
    where: { status: 'PICKED_UP' },
  })

  const restaurants = await db.restaurant.count()
  const activeRestaurants = await db.restaurant.count({ where: { isActive: true, isSuspended: false } })
  const menuItems = await db.menuItem.count()
  const consumers = await db.user.count({ where: { role: 'CONSUMER' } })

  // Status breakdown
  const statusBreakdown = await db.order.groupBy({
    by: ['status'],
    _count: { _all: true },
  })

  // Revenue by restaurant (top 4)
  const byRestaurantAgg = await db.order.groupBy({
    by: ['restaurantId'],
    _sum: { totalAmount: true },
    _count: { _all: true },
  })
  const restMap = await db.restaurant.findMany()
  const revenueByRestaurant = byRestaurantAgg
    .map((r) => {
      const rest = restMap.find((x) => x.id === r.restaurantId)
      return {
        name: rest?.name ?? 'Unknown',
        revenue: r._sum.totalAmount ?? 0,
        orders: r._count._all,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4)

  // Hourly order volume (last 12 hours)
  const now = Date.now()
  const hourly: { hour: string; orders: number }[] = []
  for (let h = 11; h >= 0; h--) {
    const start = new Date(now - h * 3600000)
    const end = new Date(now - (h - 1) * 3600000)
    const c = await db.order.count({ where: { createdAt: { gte: start, lt: end } } })
    hourly.push({ hour: `${start.getHours()}:00`, orders: c })
  }

  // Avg order value
  const aov = totalOrders > 0 ? Math.round((revenueAgg._sum.totalAmount ?? 0) / totalOrders) : 0

  return NextResponse.json({
    metrics: {
      totalOrders,
      activeOrders,
      pickedUp,
      cancelled,
      revenue: revenueAgg._sum.totalAmount ?? 0,
      settled: settledAgg._sum.totalAmount ?? 0,
      aov,
      restaurants,
      activeRestaurants,
      menuItems,
      consumers,
      completionRate: totalOrders > 0 ? Math.round((pickedUp / totalOrders) * 100) : 0,
      cancellationRate: totalOrders > 0 ? Math.round((cancelled / totalOrders) * 100) : 0,
    },
    statusBreakdown: statusBreakdown.map((s) => ({ status: s.status, count: s._count._all })),
    revenueByRestaurant,
    hourly,
  })
}
