import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

// GET /api/auth/me — returns the current session user or 401.
//
// ADDITIVE (Wave 2 Task 2A): the response now also includes `campusId` and
// `campusName` (joined from Campus via the User.campusId FK added in Task 1A).
// Both fields are null when the user hasn't picked a campus yet — the consumer
// page uses this signal to redirect to /onboarding/campus on first run.
//
// All existing fields (userId, role, name, phone, email) are preserved.
export async function GET() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return NextResponse.json({ user: null }, { status: 401 })

  // Fetch the user record + joined Campus to surface campusId + campusName.
  // We intentionally do a separate read here (rather than extending
  // SessionUser) so that session.ts stays untouched — preserving its
  // governance boundary (SessionUser is the shape used across many routes).
  const userRow = await db.user.findUnique({
    where: { id: sessionUser.userId },
    select: {
      campusId: true,
      campus: { select: { name: true } },
    },
  })

  return NextResponse.json({
    user: {
      userId: sessionUser.userId,
      role: sessionUser.role,
      name: sessionUser.name,
      phone: sessionUser.phone,
      email: sessionUser.email,
      // New additive fields — null when the user has no campus yet.
      campusId: userRow?.campusId ?? null,
      campusName: userRow?.campus?.name ?? null,
    },
  })
}
