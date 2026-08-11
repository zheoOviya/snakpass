import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/session'
import { z } from 'zod'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { verifySupabaseToken, isUserRevoked, isSupabaseConfigured } from '@/lib/supabase-admin'
import { warn as logWarn } from '@/lib/logger'

const supabaseSessionBodySchema = z.object({
  accessToken: z.string().min(1, 'Supabase access token required'),
  purpose: z.enum(['consumer_login', 'vendor_login']),
})

// POST /api/auth/supabase/session  { accessToken, purpose }
//
// DEV-002 CLOSURE: Server-side JWT verification via Supabase JWKS.
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  const { accessToken, purpose } = await validateBody(req, supabaseSessionBodySchema)

  if (!isSupabaseConfigured()) {
    logWarn('supabase-not-configured', {}, traceId)
    return apiError('DEPENDENCY_UNAVAILABLE', 'Authentication service not configured', 503, undefined, traceId)
  }

  // Step 1: Verify the JWT server-side via JWKS
  let verified: { uid: string; phone: string; email?: string }
  try {
    verified = await verifySupabaseToken(accessToken)
  } catch (e) {
    const msg = (e as Error).message
    logWarn('supabase-token-verification-failed', { reason: msg }, traceId)
    return apiError('AUTHENTICATION_REQUIRED', 'Token verification failed', 401, undefined, traceId)
  }

  // Step 2: Check if user is revoked/banned
  const revoked = await isUserRevoked(verified.uid)
  if (revoked) {
    logWarn('supabase-user-revoked', { uid: verified.uid }, traceId)
    return apiError('AUTHENTICATION_REQUIRED', 'User account is revoked', 401, undefined, traceId)
  }

  const { phone, uid: supabaseUid, email } = verified
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

  await db.auditLog.create({
    data: {
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_SUPABASE_OTP_LOGIN',
      metadata: JSON.stringify({ purpose, phone, supabaseUid, email: email ?? null }),
    },
  })

  return NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role, email: user.email ?? email },
  })
})
