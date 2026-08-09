import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { createOtp } from '@/lib/otp-service'

// POST /api/auth/admin/login  { email, password }
// Step 1 of 2FA: verify email+password, then issue a 2FA OTP challenge.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.email || !body.password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 })
  }
  const email = String(body.email).trim().toLowerCase()

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const ok = await verifyPassword(String(body.password), user.passwordHash)
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Step 2: generate 2FA OTP (emailed in production; shown in demo).
  const { otpId, code } = await createOtp('email', email, 'admin_2fa')

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'ADMIN_LOGIN_STEP1',
      metadata: JSON.stringify({ email }),
    },
  })

  return NextResponse.json({
    otpId,
    demo: true,
    code, // demo only — real deployment emails this via Firebase/SMTP
    message: `2FA code sent to ${email}`,
  })
}
