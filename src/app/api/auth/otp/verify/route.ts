import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyOtp } from '@/lib/otp-service'
import { createSession, setSessionCookie } from '@/lib/session'

// POST /api/auth/otp/verify  { otpId, code, phone, purpose }
// Verifies the OTP, resolves/creates the user, issues a session cookie.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.otpId || !body.code || !body.phone || !body.purpose) {
    return NextResponse.json({ error: 'otpId, code, phone, purpose required' }, { status: 400 })
  }

  const result = await verifyOtp(String(body.otpId), String(body.code))
  if (!result.ok) {
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 401 })
  }
  if (result.target !== String(body.phone)) {
    return NextResponse.json({ error: 'OTP target mismatch' }, { status: 401 })
  }

  const phone = String(body.phone)
  const purpose = String(body.purpose)
  const role = purpose === 'vendor_login' ? 'VENDOR_OWNER' : 'CONSUMER'

  // Resolve user by phone. Vendors must already exist (seeded). Consumers
  // are auto-created on first login (phone-keyed identity).
  let user = await db.user.findUnique({ where: { phone } })
  if (!user) {
    if (purpose === 'vendor_login') {
      return NextResponse.json({ error: 'No vendor account for this phone' }, { status: 403 })
    }
    user = await db.user.create({
      data: { phone, role: 'CONSUMER', name: `User ${phone.slice(-4)}` },
    })
  } else {
    // enforce role match
    if (purpose === 'vendor_login' && !['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
      return NextResponse.json({ error: 'This phone is not a vendor account' }, { status: 403 })
    }
  }

  const token = await createSession(user.id, user.role)
  await setSessionCookie(token)

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
  })
}
