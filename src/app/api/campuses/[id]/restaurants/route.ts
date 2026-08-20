import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { validateQuery } from '@/lib/validation'
import { withErrorHandler, AppError } from '@/lib/errors'

// GET /api/campuses/[id]/restaurants?q=&veg=
// Public (no auth) — restaurants linked to the given campus via the
// RestaurantCampus junction. Same response shape as GET /api/restaurants so
// the consumer UI can swap data sources without touching the renderer.
//
// Query params (mirror /api/restaurants):
//   q   — case-insensitive contains on restaurant name / cuisine / description
//   veg — "1" filters to restaurants that have at least one available veg item
//
// Response: { restaurants: [...] } (same shape as /api/restaurants)
//
// Governance: Wave 2 Task 2A. Additive route — no existing route touched.

const campusRestaurantsQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  veg: z.string().optional().default(''),
})

export const GET = (
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const { id } = await ctx.params
    if (!id) {
      throw new AppError('VALIDATION_ERROR', 'Campus id required', 400)
    }

    // Verify the campus exists + is active (404 otherwise).
    const campus = await db.campus.findUnique({ where: { id } })
    if (!campus || !campus.isActive) {
      throw new AppError('NOT_FOUND', 'Campus not found', 404)
    }

    const { q, veg } = validateQuery(req, campusRestaurantsQuerySchema)
    const vegOnly = veg === '1'

    // Pull restaurants via the RestaurantCampus junction — this is the source
    // of truth (a chain may serve multiple campuses; this route returns only
    // the ones explicitly linked to the requested campus).
    const junctions = await db.restaurantCampus.findMany({
      where: { campusId: id },
      select: { restaurantId: true },
    })
    const restaurantIds = junctions.map((j) => j.restaurantId)

    if (restaurantIds.length === 0) {
      return NextResponse.json({ restaurants: [] })
    }

    const restaurants = await db.restaurant.findMany({
      where: {
        id: { in: restaurantIds },
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
        where: {
          isVeg: true,
          isAvailable: true,
          restaurantId: { in: restaurantIds },
        },
        _count: { _all: true },
      })
      const vegSet = new Set(vegCounts.map((v) => v.restaurantId))
      result = result.filter((r) => vegSet.has(r.id))
    }

    return NextResponse.json({ restaurants: result })
  })
