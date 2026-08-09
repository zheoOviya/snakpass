import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyOtp } from '@/lib/otp-service'
import { createSession, setSessionCookie } from '@/lib/session'

// POST /api/auth/admin/verify  { otpId, code }
// Step 2 of 2FA: verify the OTP, issue session.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.otpId || !body.code) {
    return NextResponse.json({ error: 'otpId and code required' }, { status: 400 })
  }

  const result = await verifyOtp(String(body.otpId), String(body.code))
  if (!result.ok || result.purpose !== 'admin_2fa') {
    return NextResponse.json({ error: 'Invalid or expired 2FA code' }, { status: 401 })
  }

  const user = await db.user.findUnique({ where: { email: result.target! } })
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return NextResponse.json({ error: 'Not an admin account' }, { status: 403 })
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
}
