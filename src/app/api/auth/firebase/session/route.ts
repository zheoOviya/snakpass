import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'
import { z } from 'zod'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'

const firebaseSessionBodySchema = z.object({
  phone: z.string().regex(/^\+?[0-9]{10,15}$/, 'Invalid phone number'),
  purpose: z.enum(['consumer_login', 'vendor_login']),
  firebaseUid: z.string().optional(),
})

// POST /api/auth/firebase/session  { phone, purpose, firebaseUid }
export const POST = (req: NextRequest) => withErrorHandler(async () => {
  const { phone, purpose, firebaseUid } = await validateBody(req, firebaseSessionBodySchema)

  const role = purpose === 'vendor_login' ? 'VENDOR_OWNER' : 'CONSUMER'
  let user = await db.user.findUnique({ where: { phone } })

  if (!user) {
    if (purpose === 'vendor_login') {
      return apiError('AUTHORIZATION_DENIED', 'No vendor account for this phone', 403)
    }
    user = await db.user.create({
      data: { phone, role: 'CONSUMER', name: `User ${phone.slice(-4)}` },
    })
  } else if (purpose === 'vendor_login' && !['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
    return apiError('AUTHORIZATION_DENIED', 'This phone is not a vendor account', 403)
  }

  const token = await createSession(user.id, user.role)
  await setSessionCookie(token)

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_FIREBASE_OTP_LOGIN',
      metadata: JSON.stringify({ purpose, phone, firebaseUid: firebaseUid ?? null }),
    },
  })

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email },
  })
})
