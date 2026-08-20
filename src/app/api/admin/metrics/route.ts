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

  // -------------------------------------------------------------------------
  // Wave 8 Task 8 (additive) — rewards metrics
  //   - totalIssued:    sum of points across all EARN ledger entries.
  //   - totalRedeemed:  sum of |points| across all REDEEM ledger entries.
  //   - activeAccounts: count of distinct reward accounts with a > 0 balance.
  // -------------------------------------------------------------------------
  const earnAgg = await db.rewardLedgerEntry.aggregate({
    _sum: { points: true },
    where: { type: 'EARN' },
  }).catch(() => ({ _sum: { points: 0 } }))
  const redeemAgg = await db.rewardLedgerEntry.aggregate({
    _sum: { points: true },
    where: { type: 'REDEEM' },
  }).catch(() => ({ _sum: { points: 0 } }))
  const activeAccounts = await db.rewardAccount.count({
    where: { balance: { gt: 0 } },
  }).catch(() => 0)

  const rewards = {
    totalIssued: Math.max(0, earnAgg._sum.points ?? 0),
    totalRedeemed: Math.abs(redeemAgg._sum.points ?? 0),
    activeAccounts,
  }

  // -------------------------------------------------------------------------
  // Wave 8 Task 8 (additive) — gift metrics
  //   - totalSent:       count of all Gift rows.
  //   - totalRedeemed:   count where status === 'REDEEMED'.
  //   - totalCancelled:  count where status === 'CANCELLED'.
  // -------------------------------------------------------------------------
  const [totalSent, totalGiftRedeemed, totalGiftCancelled] = await Promise.all([
    db.gift.count().catch(() => 0),
    db.gift.count({ where: { status: 'REDEEMED' } }).catch(() => 0),
    db.gift.count({ where: { status: 'CANCELLED' } }).catch(() => 0),
  ])

  const gifts = {
    totalSent,
    totalRedeemed: totalGiftRedeemed,
    totalCancelled: totalGiftCancelled,
  }

  // -------------------------------------------------------------------------
  // Wave 8 Task 8 (additive) — group order metrics
  //   - totalCreated:    count of all GroupOrder rows.
  //   - totalConfirmed:  count where status === 'CONFIRMED'.
  //   - totalCancelled:  count where status === 'CANCELLED'.
  // -------------------------------------------------------------------------
  const [totalGroupCreated, totalGroupConfirmed, totalGroupCancelled] = await Promise.all([
    db.groupOrder.count().catch(() => 0),
    db.groupOrder.count({ where: { status: 'CONFIRMED' } }).catch(() => 0),
    db.groupOrder.count({ where: { status: 'CANCELLED' } }).catch(() => 0),
  ])

  const groupOrders = {
    totalCreated: totalGroupCreated,
    totalConfirmed: totalGroupConfirmed,
    totalCancelled: totalGroupCancelled,
  }

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
    // Wave 8 Task 8 additive — new metric buckets.
    rewards,
    gifts,
    groupOrders,
    statusBreakdown: statusBreakdown.map((s) => ({ status: s.status, count: s._count._all })),
    revenueByRestaurant,
    hourly,
  })
}
