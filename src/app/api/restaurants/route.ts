import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/restaurants?q=&veg=&campusId=
//
// Wave 2C additive extension — preserve ALL existing query params + response
// fields. New params / fields (additive only):
//   - `campusId` query param (optional): if provided, restrict results to
//      restaurants linked to this campus via the RestaurantCampus junction
//      (Task 1A schema). When absent → unscoped (all active restaurants).
//   - `rewardMultiplier` (response): per-restaurant placeholder (default 1.0).
//      Future: per-restaurant promo multiplier (e.g. weekend 2× pts).
//   - `isOpen` (response): derived for MVP — true for every active restaurant
//      (no hours model exists yet; blueprint §10 "open now" filter passes).
//   - `deal` (response): derived from priceForTwo — under ₹300 for two = a
//      "Great value" deal label; null otherwise.
//
// Governance: Task 2C scope. Existing fields (id/name/cuisine/description/
// image/rating/prepTimeMins/priceForTwo/address/availableItems) are untouched.

/** Threshold (in paise) for the "Great value" deal label. ₹300 for two. */
const GREAT_VALUE_THRESHOLD_PAISE = 30000

/** Default reward multiplier placeholder. */
const REWARD_MULTIPLIER_DEFAULT = 1.0

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? ''
  const vegOnly = req.nextUrl.searchParams.get('veg') === '1'
  // Wave 2C: campusId — filter via RestaurantCampus junction (additive).
  const campusId = req.nextUrl.searchParams.get('campusId')?.trim() ?? ''

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
      // Wave 2C: scope by campus if requested. Uses the RestaurantCampus
      // junction (Task 1A schema) — `some` filters the parent by an
      // existence check on a related junction row.
      ...(campusId
        ? { restaurantCampuses: { some: { campusId } } }
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
    // Wave 2C additive fields ---------------------------------------------------
    rewardMultiplier: REWARD_MULTIPLIER_DEFAULT,
    isOpen: true, // MVP: no hours model — everything is "open now"
    deal: r.priceForTwo < GREAT_VALUE_THRESHOLD_PAISE ? 'Great value' : null,
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
