import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'
import { z } from 'zod'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError, AppError } from '@/lib/errors'
import { verifyFirebaseToken, isAdminConfigured } from '@/lib/firebase-admin'
import { audit } from '@/lib/audit'
import { warn as logWarn } from '@/lib/logger'

const firebaseSessionBodySchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token required'),
  purpose: z.enum(['consumer_login', 'vendor_login']),
})

// POST /api/auth/firebase/session  { idToken, purpose }
//
// DEV-002 CLOSURE: This route now REQUIRES a Firebase ID token and calls
// verifyFirebaseToken() server-side. The phone number is extracted from the
// VERIFIED token — NOT from the client claim. Demo-trust mode (dev only)
// accepts "demo:<phone>:<uid>" format tokens.
//
// In production (NODE_ENV=production): if Admin SDK is not configured, this
// route returns 503 (DEPENDENCY_UNAVAILABLE). No demo-trust fallback.
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const { idToken, purpose } = await validateBody(req, firebaseSessionBodySchema)

  // Verify the Firebase ID token server-side.
  // In dev: demo-trust mode accepts "demo:<phone>:<uid>".
  // In production: real Admin SDK verification (signature, expiry, project, revocation).
  // In production without Admin SDK configured: HARD FAIL (503).
  let verified: { uid: string; phone: string; email?: string }
  try {
    verified = await verifyFirebaseToken(idToken)
  } catch (e) {
    const msg = (e as Error).message
    if (msg.startsWith('FIREBASE_ADMIN_NOT_CONFIGURED')) {
      logWarn('firebase-admin-not-configured-in-production', {}, traceId)
      return apiError('DEPENDENCY_UNAVAILABLE', 'Authentication service not configured', 503, undefined, traceId)
    }
    // Token verification failed: expired, malformed, wrong-project, revoked.
    logWarn('firebase-token-verification-failed', { reason: msg }, traceId)
    return apiError('AUTHENTICATION_REQUIRED', 'Token verification failed', 401, undefined, traceId)
  }

  const { phone, uid: firebaseUid, email } = verified
  const role = purpose === 'vendor_login' ? 'VENDOR_OWNER' : 'CONSUMER'

  let user = await db.user.findUnique({ where: { phone } })

  if (!user) {
    if (purpose === 'vendor_login') {
      return apiError('AUTHORIZATION_DENIED', 'No vendor account for this phone', 403, undefined, traceId)
    }
    user = await db.user.create({
      data: { phone, role: 'CONSUMER', name: `User ${phone.slice(-4)}` },
    })
  } else if (purpose === 'vendor_login' && !['VENDOR_OWNER', 'VENDOR_STAFF'].includes(user.role)) {
    return apiError('AUTHORIZATION_DENIED', 'This phone is not a vendor account', 403, undefined, traceId)
  }

  const token = await createSession(user.id, user.role)
  await setSessionCookie(token)

  await audit('AUTH_FIREBASE_OTP_LOGIN', {
    purpose,
    phone,
    firebaseUid,
    adminConfigured: isAdminConfigured(),
  }, user.id, user.role)

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email ?? email },
  })
})
