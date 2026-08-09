import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'

// POST /api/auth/firebase/session  { phone, purpose, firebaseUid }
//
// Called by the frontend AFTER Firebase has verified the phone OTP client-side
// (signInWithPhoneNumber + confirmationResult.confirm). We trust the client's
// claim here; in production you'd verify the Firebase ID token server-side via
// the Firebase Admin SDK (requires a service-account key — not provided in this
// demo). The client passes the verified phone + the Firebase UID as proof.
//
// Resolves/creates the user (vendors must be seeded) and mints a session cookie.
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

  const role = purpose === 'vendor_login' ? 'VENDOR_OWNER' : 'CONSUMER'
  let user = await db.user.findUnique({ where: { phone } })

  if (!user) {
    if (purpose === 'vendor_login') {
      return NextResponse.json({ error: 'No vendor account for this phone' }, { status: 403 })
    }
    user = await db.user.create({
      data: { phone, role: 'CONSUMER', name: `User ${phone.slice(-4)}` },
    })
  } else if (purpose === 'vendor_login' && !['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
    return NextResponse.json({ error: 'This phone is not a vendor account' }, { status: 403 })
  }

  const token = await createSession(user.id, user.role)
  await setSessionCookie(token)

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_FIREBASE_OTP_LOGIN',
      metadata: JSON.stringify({ purpose, phone, firebaseUid: body.firebaseUid ?? null }),
    },
  })

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email },
  })
}
