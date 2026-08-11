import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/restaurants?q=&veg=
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? ''
  const vegOnly = req.nextUrl.searchParams.get('veg') === '1'

  const restaurants = await db.restaurant.findMany({
    where: {
      isActive: true,
      isSuspended: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { cuisine: { contains: q } },
              { description: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { rating: 'desc' },
    include: { _count: { select: { menuItems: { where: { isAvailable: true } } } } },
  })

  let result = restaurants.map((r) => ({
    id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    description: r.description,
    image: r.image,
    rating: r.rating,
    prepTimeMins: r.prepTimeMins,
    priceForTwo: r.priceForTwo,
    address: r.address,
    availableItems: r._count.menuItems,
  }))

  if (vegOnly) {
    const vegCounts = await db.menuItem.groupBy({
      by: ['restaurantId'],
      where: { isVeg: true, isAvailable: true },
      _count: { _all: true },
    })
    const vegSet = new Set(vegCounts.map((v) => v.restaurantId))
    result = result.filter((r) => vegSet.has(r.id))
  }

  return NextResponse.json({ restaurants: result })
}
