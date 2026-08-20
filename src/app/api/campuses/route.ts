import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { validateQuery } from '@/lib/validation'
import { withErrorHandler } from '@/lib/errors'

// GET /api/campuses?q=&city=
// Public (no auth) — list of campuses matching search query by name / city / domain.
// Each campus row carries `restaurantCount` = count of RestaurantCampus junction rows
// pointing at that campus (so the onboarding screen can show "12 restaurants").
//
// Response: { campuses: [{ id, name, shortName, city, state, domain, restaurantCount }] }
//
// Governance: Wave 2 Task 2A. Additive route — no existing route touched.

const campusListQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
})

export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const { q, city } = validateQuery(req, campusListQuerySchema)

    // Build the WHERE clause from the optional search + city filters.
    // Search matches campus name / shortName / domain / city / state (SQLite
    // is ASCII-case-insensitive by default for `LIKE`).
    const where: Record<string, unknown> = { isActive: true }
    const terms: string[] = []
    if (q) terms.push(q)
    if (city) terms.push(city)

    if (terms.length > 0) {
      // Combine q + city into a single OR search across all searchable text fields.
      const combined = terms.join(' ').toLowerCase()
      where.OR = [
        { name: { contains: combined } },
        { shortName: { contains: combined } },
        { domain: { contains: combined } },
        { city: { contains: combined } },
        { state: { contains: combined } },
      ]
    }

    const rows = await db.campus.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: {
        _count: {
          select: { restaurantCampuses: true },
        },
      },
    })

    const campuses = rows.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      city: c.city,
      state: c.state,
      domain: c.domain,
      restaurantCount: c._count.restaurantCampuses,
    }))

    return NextResponse.json({ campuses })
  })
