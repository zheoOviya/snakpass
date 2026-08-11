import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyOtp } from '@/lib/otp-service'
import { createSession, setSessionCookie } from '@/lib/session'
import { validateBody, otpVerifyBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { audit } from '@/lib/audit'

// POST /api/auth/otp/verify  { otpId, code, phone, purpose }
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const { otpId, code, phone, purpose } = await validateBody(req, otpVerifyBodySchema)

  const result = await verifyOtp(otpId, code)
  if (!result.ok) {
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid or expired OTP', 401, undefined, traceId)
  }
  if (result.target !== phone) {
    return apiError('AUTHENTICATION_REQUIRED', 'OTP target mismatch', 401, undefined, traceId)
  }

  const role = purpose === 'vendor_login' ? 'VENDOR_OWNER' : 'CONSUMER'

  let user = await db.user.findUnique({ where: { phone } })
  if (!user) {
    if (purpose === 'vendor_login') {
      return apiError('AUTHORIZATION_DENIED', 'No vendor account for this phone', 403, undefined, traceId)
    }
    user = await db.user.create({
      data: { phone, role: 'CONSUMER', name: `User ${phone.slice(-4)}` },
    })
  } else {
    if (purpose === 'vendor_login' && !['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
      return apiError('AUTHORIZATION_DENIED', 'This phone is not a vendor account', 403, undefined, traceId)
    }
  }

  const token = await createSession(user.id, user.role)
  await setSessionCookie(token)

  await audit('AUTH_OTP_LOGIN', { purpose, phone }, user.id, user.role)

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email },
  })
})
