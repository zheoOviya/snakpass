import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandler, AppError } from '@/lib/errors'

// GET /api/campuses/[id]
// Public (no auth) — single campus details by ID.
//
// Response: { campus: { id, name, shortName, city, state, domain, isActive, createdAt } }
// 404 if the campus does not exist (or is soft-deleted via isActive=false).
//
// Governance: Wave 2 Task 2A. Additive route — no existing route touched.

export const GET = (
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const { id } = await ctx.params
    if (!id) {
      throw new AppError('VALIDATION_ERROR', 'Campus id required', 400)
    }

    const campus = await db.campus.findUnique({ where: { id } })
    if (!campus || !campus.isActive) {
      throw new AppError('NOT_FOUND', 'Campus not found', 404)
    }

    return NextResponse.json({
      campus: {
        id: campus.id,
        name: campus.name,
        shortName: campus.shortName,
        city: campus.city,
        state: campus.state,
        domain: campus.domain,
        isActive: campus.isActive,
        createdAt: campus.createdAt.toISOString(),
      },
    })
  })
