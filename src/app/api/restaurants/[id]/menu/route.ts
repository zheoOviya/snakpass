import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { REWARD_POINTS_PER_RUPEE } from '@/lib/snack'

// GET /api/restaurants/[id]/menu?veg=
//
// Wave 2C additive extension — preserve ALL existing response fields.
// New additive fields per item (PRODUCT_IMPLEMENTATION_PLAN.md Task 2C):
//   - `rewardPoints` (number): computed as
//      `Math.floor((price / 100) * REWARD_POINTS_PER_RUPEE * rewardMultiplier)`.
//      Price is stored in paise (MenuItem.price) — divided by 100 to convert
//      to rupees before applying the earn rate (0.1 pt per ₹1).
//      rewardMultiplier is a per-restaurant placeholder (default 1.0). Future:
//      pulled from a per-restaurant promo config.
//   - `modifiers` (array): empty placeholder for MVP. Future: per-item
//      customization options (size, add-ons, spice level, etc.).
//
// Governance: Task 2C scope. Existing fields preserved verbatim.

const REWARD_MULTIPLIER_DEFAULT = 1.0

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const vegOnly = req.nextUrl.searchParams.get('veg') === '1'

  // Fetch restaurant (for rewardMultiplier placeholder) + items concurrently.
  const [restaurant, items] = await Promise.all([
    db.restaurant.findUnique({
      where: { id },
      select: { id: true }, // Future: select rewardMultiplier column when it exists.
    }),
    db.menuItem.findMany({
      where: { restaurantId: id, ...(vegOnly ? { isVeg: true } : {}) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  ])

  if (!restaurant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rewardMultiplier = REWARD_MULTIPLIER_DEFAULT

  const grouped: Record<string, typeof items> = {}
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = []
    grouped[it.category].push(it)
  }

  return NextResponse.json({
    items: items.map((i) => {
      // price is in paise — convert to rupees before applying earn rate.
      const rupees = i.price / 100
      const rewardPoints = Math.floor(
        rupees * REWARD_POINTS_PER_RUPEE * rewardMultiplier,
      )
      return {
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        image: i.image,
        spiceLevel: i.spiceLevel,
        isVeg: i.isVeg,
        isAvailable: i.isAvailable,
        category: i.category,
        // Wave 2C additive fields ----------------------------------------------
        rewardPoints,
        modifiers: [] as Array<unknown>, // MVP placeholder — future: customization options
      }
    }),
    grouped,
    // Wave 2C additive: surface the multiplier used so the UI can show
    // "2× pts" badges consistently (default 1.0 for MVP).
    rewardMultiplier,
  })
}
