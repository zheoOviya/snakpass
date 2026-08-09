import { NextRequest, NextResponse } from 'next/server'
import { createOtp } from '@/lib/otp-service'

// POST /api/auth/otp/send  { phone, purpose: 'consumer_login' | 'vendor_login' }
// In demo mode (no Firebase creds), returns the code so the UI can show it
// for testing. In production with Firebase configured, the client uses
// Firebase's signInWithPhoneNumber directly and this endpoint is only the
// demo fallback.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.phone || !body.purpose) {
    return NextResponse.json({ error: 'phone and purpose required' }, { status: 400 })
  }
  const phone = String(body.phone).trim()
  const purpose = String(body.purpose)
  if (!['consumer_login', 'vendor_login'].includes(purpose)) {
    return NextResponse.json({ error: 'invalid purpose' }, { status: 400 })
  }

  const { otpId, code } = await createOtp('phone', phone, purpose)

  // Demo mode: surface the code. In real Firebase mode this endpoint would
  // not be the delivery channel (Firebase sends the SMS client-side).
  return NextResponse.json({
    otpId,
    demo: true,
    code, // <-- only present in demo mode; remove in production
    message: `OTP sent to ${phone}`,
  })
}
