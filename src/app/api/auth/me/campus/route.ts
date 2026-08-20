import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, AppError } from '@/lib/errors'

// PATCH /api/auth/me/campus  { campusId: string }
// Sets the calling user's primary campusId (the campus onboarding target).
// Auth required: getSessionUser() returns 401 if no session.
// Validates that the campusId refers to an existing + active campus.
//
// Response: { user: { id, campusId, campusName } }
//
// Governance: Wave 2 Task 2A. Additive route — no existing route touched.

const setCampusBodySchema = z.object({
  campusId: z.string().min(1, 'campusId required'),
})

export const PATCH = (req: NextRequest) =>
  withErrorHandler(async () => {
    const session = await getSessionUser()
    if (!session) {
      throw new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401)
    }

    const { campusId } = await validateBody(req, setCampusBodySchema)

    // Validate campus exists + is active.
    const campus = await db.campus.findUnique({ where: { id: campusId } })
    if (!campus || !campus.isActive) {
      throw new AppError('NOT_FOUND', 'Campus not found', 404)
    }

    // Update the user's campusId (additive column from Task 1A schema).
    await db.user.update({
      where: { id: session.userId },
      data: { campusId: campus.id },
    })

    return NextResponse.json({
      user: {
        id: session.userId,
        campusId: campus.id,
        campusName: campus.name,
      },
    })
  })

// Also accept POST for client flexibility — same handler.
export const POST = PATCH
