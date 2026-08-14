import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyOtp } from '@/lib/otp-service'
import { createSession, setSessionCookie } from '@/lib/session'
import { validateBody, otpVerifyBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { checkOtpVerifyAllowed, recordOtpVerifyFailure, resetOtpCounters } from '@/lib/otp-lockout'

// POST /api/auth/otp/verify  { otpId, code, phone, purpose }
// P0-11: Per-target verify rate limiting (max 5 failed attempts per 10 min per phone).
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const { otpId, code, phone, purpose } = await validateBody(req, otpVerifyBodySchema)

  // P0-11: Check per-target lockout + verify fail count
  const lockoutCheck = await checkOtpVerifyAllowed(phone)
  if (!lockoutCheck.allowed) {
    return apiError(
      'RATE_LIMITED',
      lockoutCheck.reason ?? 'Too many failed attempts. Please retry later.',
      429,
      { retryAfter: lockoutCheck.retryAfter, remaining: 0 },
    )
  }

  const result = await verifyOtp(otpId, code)
  if (!result.ok) {
    // P0-11: Record the failed attempt
    await recordOtpVerifyFailure(phone)
    return apiError('AUTHENTICATION_REQUIRED', 'Invalid or expired OTP', 401)
  }
  if (result.target !== phone) {
    await recordOtpVerifyFailure(phone)
    return apiError('AUTHENTICATION_REQUIRED', 'OTP target mismatch', 401)
  }

  // P0-11: Reset counters on successful verify (target is legitimate)
  await resetOtpCounters(phone)

  const role = purpose === 'vendor_login' ? 'VENDOR_OWNER' : 'CONSUMER'

  let user = await db.user.findUnique({ where: { phone } })
  if (!user) {
    if (purpose === 'vendor_login') {
      return apiError('AUTHORIZATION_DENIED', 'No vendor account for this phone', 403)
    }
    user = await db.user.create({
      data: { phone, role: 'CONSUMER', name: `User ${phone.slice(-4)}` },
    })
  } else {
    if (purpose === 'vendor_login' && !['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
      return apiError('AUTHORIZATION_DENIED', 'This phone is not a vendor account', 403)
    }
  }

  const token = await createSession(user.id, user.role)
  const csrfToken = await setSessionCookie(token)

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_OTP_LOGIN',
      metadata: JSON.stringify({ purpose, phone }),
    },
  })

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email },
    csrfToken, // P0-14: client must send this in X-CSRF-Token header on state-changing requests
  })
})
