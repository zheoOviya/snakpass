import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/restaurants/[id]/menu?veg=
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const vegOnly = req.nextUrl.searchParams.get('veg') === '1'

  const items = await db.menuItem.findMany({
    where: { restaurantId: id, ...(vegOnly ? { isVeg: true } : {}) },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  const grouped: Record<string, typeof items> = {}
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = []
    grouped[it.category].push(it)
  }

  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      price: i.price,
      image: i.image,
      spiceLevel: i.spiceLevel,
      isVeg: i.isVeg,
      isAvailable: i.isAvailable,
      category: i.category,
    })),
    grouped,
  })
}
