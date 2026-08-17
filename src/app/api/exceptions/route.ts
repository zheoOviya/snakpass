import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { listUnresolvedExceptions, resolveException } from '@/lib/invariant-checker'
import { withErrorHandler, apiError } from '@/lib/errors'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'

const resolveExceptionSchema = z.object({
  exceptionId: z.string().min(1),
  resolutionNote: z.string().min(1).max(2000),
})

// GET /api/exceptions — list unresolved exceptions (admin only, P0-28)
export const GET = withErrorHandler(async () => {
  const session = await getSessionUser()
  if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return apiError('AUTHORIZATION_DENIED', 'Forbidden — admin only', 403)
  }

  const exceptions = await listUnresolvedExceptions()

  return NextResponse.json({ exceptions })
})

// POST /api/exceptions/resolve — resolve an exception (admin only, P0-28)
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const session = await getSessionUser()
  if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return apiError('AUTHORIZATION_DENIED', 'Forbidden — admin only', 403)
  }

  const { exceptionId, resolutionNote } = await validateBody(req, resolveExceptionSchema)

  await resolveException(exceptionId, session.userId, resolutionNote)

  return NextResponse.json({ ok: true, exceptionId })
})
