import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/restaurants/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await db.restaurant.findUnique({ where: { id } })
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    },
  })
}
