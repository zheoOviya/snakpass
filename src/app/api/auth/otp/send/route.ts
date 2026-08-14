import { NextRequest, NextResponse } from 'next/server'
import { createOtp } from '@/lib/otp-service'
import { validateBody, otpSendBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { checkOtpSendAllowed, recordOtpSend } from '@/lib/otp-lockout'

// POST /api/auth/otp/send  { phone, purpose: 'consumer_login' | 'vendor_login' }
// P0-11: Per-target send rate limiting (max 3 sends per 10 min per phone).
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const { phone, purpose } = await validateBody(req, otpSendBodySchema)

  // P0-11: Check per-target lockout + send count
  const lockoutCheck = await checkOtpSendAllowed(phone)
  if (!lockoutCheck.allowed) {
    return apiError(
      'RATE_LIMITED',
      lockoutCheck.reason ?? 'Too many OTP sends. Please retry later.',
      429,
      { retryAfter: lockoutCheck.retryAfter, remaining: 0 },
    )
  }

  const { otpId, code } = await createOtp('phone', phone, purpose)

  // P0-11: Record the send (increment counter)
  await recordOtpSend(phone)

  return NextResponse.json({
    otpId,
    demo: true,
    code,
    message: `OTP sent to ${phone}`,
    remaining: lockoutCheck.remaining,
  })
})
