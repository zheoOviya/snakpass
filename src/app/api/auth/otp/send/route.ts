import { NextRequest, NextResponse } from 'next/server'
import { createOtp } from '@/lib/otp-service'
import { validateBody, otpSendBodySchema } from '@/lib/validation'
import { withErrorHandler } from '@/lib/errors'

// POST /api/auth/otp/send  { phone, purpose: 'consumer_login' | 'vendor_login' }
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const { phone, purpose } = await validateBody(req, otpSendBodySchema)

  const { otpId, code } = await createOtp('phone', phone, purpose)

  return NextResponse.json({
    otpId,
    demo: true,
    code,
    message: `OTP sent to ${phone}`,
  })
})
