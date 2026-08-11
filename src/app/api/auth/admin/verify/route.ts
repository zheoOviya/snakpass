import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyOtp } from '@/lib/otp-service'
import { createSession, setSessionCookie } from '@/lib/session'
import { validateBody, adminVerifyBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'

// POST /api/auth/admin/verify  { otpId, code }
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const { otpId, code } = await validateBody(req, adminVerifyBodySchema)

  const result = await verifyOtp(otpId, code)
  if (!result.ok || result.purpose !== 'admin_2fa') {
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid or expired 2FA code', 401, undefined, traceId)
  }

  const user = await db.user.findUnique({ where: { email: result.target! } })
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return apiError('AUTHORIZATION_DENIED', 'Not an admin account', 403, undefined, traceId)
  }

  const token = await createSession(user.id, user.role)
  await setSessionCookie(token)

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'ADMIN_LOGIN_SUCCESS',
      metadata: JSON.stringify({ email: user.email }),
    },
  })

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email },
  })
})
