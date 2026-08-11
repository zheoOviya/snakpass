import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { createOtp } from '@/lib/otp-service'
import { validateBody, adminLoginBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'

// POST /api/auth/admin/login  { email, password }
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const { email, password } = await validateBody(req, adminLoginBodySchema)
  const normalizedEmail = email.trim().toLowerCase()

  const user = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (!user || !user.passwordHash || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid credentials', 401)
  }

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid credentials', 401)
  }

  const { otpId, code } = await createOtp('email', normalizedEmail, 'admin_2fa')

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'ADMIN_LOGIN_STEP1',
      metadata: JSON.stringify({ email: normalizedEmail }),
    },
  })

  return NextResponse.json({
    otpId,
    demo: true,
    code,
    message: `2FA code sent to ${normalizedEmail}`,
  })
})
