import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/restaurants/[id]
//
// Wave 2C additive extension — preserve ALL existing response fields.
// New additive fields (per PRODUCT_IMPLEMENTATION_PLAN.md Task 2C):
//   - `rewardMultiplier` (default 1.0): per-restaurant placeholder. Future:
//      per-restaurant promo multiplier (e.g. weekend 2× pts).
//   - `deals` (array): placeholder derived from priceForTwo. Under ₹300 for
//      two = `[{ title: "Great value", description: "Under ₹300 for two" }]`.
//      Empty array when no deal applies. Future: real Deal model rows.
//   - `popularItems` (array): top 3 available menu items for MVP. Placeholder
//      sort — first 3 by category/name (no real popularity signal yet).
//   - `campuses` (array of strings): campus names linked to this restaurant via
//      the RestaurantCampus junction (Task 1A).
//
// Governance: Task 2C scope. Existing fields preserved verbatim.

const REWARD_MULTIPLIER_DEFAULT = 1.0
const GREAT_VALUE_THRESHOLD_PAISE = 30000
const POPULAR_ITEM_PREVIEW_LIMIT = 3

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Parallel fetch: restaurant + menu items (for popularItems preview) +
  // RestaurantCampus junction (for campuses names). All run concurrently.
  const [r, availableMenuItems, campusLinks] = await Promise.all([
    db.restaurant.findUnique({ where: { id } }),
    db.menuItem.findMany({
      where: { restaurantId: id, isAvailable: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: POPULAR_ITEM_PREVIEW_LIMIT,
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        image: true,
        spiceLevel: true,
        isVeg: true,
        isAvailable: true,
        category: true,
      },
    }),
    db.restaurantCampus.findMany({
      where: { restaurantId: id },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: { isPrimary: 'desc' },
    }),
  ])

  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Wave 2C additive: deals derived from priceForTwo (placeholder — future
  // source = real Deal model rows joined to the restaurant).
  const deals =
    r.priceForTwo < GREAT_VALUE_THRESHOLD_PAISE
      ? [
          {
            title: 'Great value',
            description: 'Under ₹300 for two',
          },
        ]
      : []

  // Wave 2C additive: popularItems = first 3 available items (no real
  // popularity signal yet — placeholder per plan §2C acceptance criteria).
  const popularItems = availableMenuItems.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    price: m.price,
    image: m.image,
    spiceLevel: m.spiceLevel,
    isVeg: m.isVeg,
    isAvailable: m.isAvailable,
    category: m.category,
  }))

  // Wave 2C additive: campuses linked via RestaurantCampus junction.
  const campuses = campusLinks.map((rc) => ({
    id: rc.campus.id,
    name: rc.campus.name,
    isPrimary: rc.isPrimary,
  }))

  return NextResponse.json({
    restaurant: {
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      description: r.description,
      image: r.image,
      rating: r.rating,
      prepTimeMins: r.prepTimeMins,
      priceForTwo: r.priceForTwo,
      address: r.address,
      gstNumber: r.gstNumber,
      // Wave 2C additive fields --------------------------------------------------
      rewardMultiplier: REWARD_MULTIPLIER_DEFAULT,
      deals,
      popularItems,
      campuses,
    },
  })
}
