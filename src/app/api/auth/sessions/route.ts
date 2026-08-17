import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, listActiveSessions } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'

// GET /api/auth/sessions — list active sessions for the current user (P0-10)
// Returns all non-expired sessions with last-activity + IP info.
export const GET = (req: NextRequest) => withErrorHandler(async () => {
  const session = await getSessionUser()
  if (!session) {
    return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401)
  }

  const sessions = await listActiveSessions(session.userId)

  return NextResponse.json({ sessions })
})
