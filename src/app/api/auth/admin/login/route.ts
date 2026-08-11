import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { createOtp } from '@/lib/otp-service'
import { validateBody, adminLoginBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { audit } from '@/lib/audit'

// POST /api/auth/admin/login  { email, password }
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const { email, password } = await validateBody(req, adminLoginBodySchema)
  const normalizedEmail = email.trim().toLowerCase()

  const user = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (!user || !user.passwordHash || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid credentials', 401, undefined, traceId)
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid credentials', 401, undefined, traceId)
  }

  const { otpId, code } = await createOtp('email', normalizedEmail, 'admin_2fa')

  await audit('ADMIN_LOGIN_STEP1', { email: normalizedEmail }, user.id, user.role)

  return NextResponse.json({
    otpId,
    demo: true,
    code,
    message: `2FA code sent to ${normalizedEmail}`,
  })
})
