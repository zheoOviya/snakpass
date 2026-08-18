import { cookies } from 'next/headers'
import { db } from './db'
import { randomToken } from './otp-service'
import { setCsrfCookie } from './csrf'
import { AppError } from './errors'

// Cookie-based session. The session token maps to a Session row in the DB
// (userId + role + expiry). HttpOnly + SameSite=Lax.

export const SESSION_COOKIE = 'snakzap_session'
const SESSION_TTL_DAYS = 7

export interface SessionUser {
  userId: string
  role: string
  name: string | null
  phone: string
  email: string | null
}

export async function createSession(userId: string, role: string): Promise<string> {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { token, userId, role, expiresAt } })
  return token
}

// Establishes the session cookie AND the CSRF cookie (double-submit pattern).
// Returns the CSRF token so callers can include it in the response body —
// the client reads it from the response (and/or the httpOnly=false cookie)
// and sends it in the X-CSRF-Token header on subsequent state-changing requests.
export async function setSessionCookie(token: string): Promise<string> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  })
  // P0-14: Establish the CSRF cookie at session-creation time so that every
  // authenticated client automatically has a valid token for the double-submit
  // pattern. This is the "set" half of the round-trip; the "verify" half is
  // in src/middleware.ts.
  const csrfToken = await setCsrfCookie()
  return csrfToken
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  // Also clear the CSRF cookie on logout
  store.delete('snakzap_csrf')
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies()
    const token = store.get(SESSION_COOKIE)?.value
    if (!token) return null
    const session = await db.session.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!session) return null
    if (session.expiresAt.getTime() < Date.now()) {
      await db.session.delete({ where: { token } }).catch(() => {})
      return null
    }
    return {
      userId: session.userId,
      role: session.role,
      name: session.user.name,
      phone: session.user.phone,
      email: session.user.email,
    }
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------
// P0-07 — requireRole helper (RBAC convenience wrapper around getSessionUser)
// ----------------------------------------------------------------------------
// Used by route handlers that need an authenticated user WITH one of a set of
// allowed roles. Returns the SessionUser on success; throws AppError on:
//   - no session  → AUTHENTICATION_REQUIRED (401)
//   - role denied → AUTHORIZATION_DENIED    (403)
//
// Usage:
//   const session = await requireRole(['VENDOR_OWNER', 'ADMIN', 'SUPER_ADMIN'])
//   // ... use session.userId / session.role
//
// For routes that need ownership checks (e.g. CONSUMER may only act on their own
// order), the caller is responsible for the ownership comparison AFTER
// requireRole() returns — e.g.:
//   const session = await requireRole(['CONSUMER', 'VENDOR_OWNER', 'ADMIN', 'SUPER_ADMIN'])
//   if (session.role === 'CONSUMER' && order.userId !== session.userId) {
//     throw new AppError('AUTHORIZATION_DENIED', 'Not your order', 403)
//   }
// ----------------------------------------------------------------------------
export async function requireRole(allowedRoles: string[]): Promise<SessionUser> {
  const session = await getSessionUser()
  if (!session) {
    throw new AppError(
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      401,
    )
  }
  if (!allowedRoles.includes(session.role)) {
    throw new AppError(
      'AUTHORIZATION_DENIED',
      'Insufficient permissions for this action',
      403,
      { requiredRoles: allowedRoles, actualRole: session.role },
    )
  }
  return session
}

export async function destroySession(): Promise<void> {
  try {
    const store = await cookies()
    const token = store.get(SESSION_COOKIE)?.value
    if (token) {
      await db.session.delete({ where: { token } }).catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

// ----------------------------------------
// P0-10 — Session integrity (refresh, revoke, active sessions)
// ----------------------------------------

/**
 * Revoke a specific session by token (not just the current one).
 * Used by admin to force-logout a specific session.
 * Returns true if a session was revoked, false if it didn't exist.
 */
export async function revokeSession(token: string): Promise<boolean> {
  try {
    await db.session.delete({ where: { token } })
    return true
  } catch {
    return false // session didn't exist (already expired or already revoked)
  }
}

/**
 * Revoke ALL sessions for a user (e.g., on password change, security incident).
 * Returns the count of revoked sessions.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } })
  return result.count
}

/**
 * List all active (non-expired) sessions for a user.
 * Used by the active-sessions dashboard.
 */
export async function listActiveSessions(userId: string): Promise<{
  token: string
  createdAt: Date
  lastActivityAt: Date
  lastIp: string | null
  isCurrent: boolean
}[]> {
  const now = new Date()
  const sessions = await db.session.findMany({
    where: {
      userId,
      expiresAt: { gt: now },
    },
    orderBy: { lastActivityAt: 'desc' },
    select: {
      token: true,
      createdAt: true,
      lastActivityAt: true,
      lastIp: true,
    },
  })

  // Determine which is the current session (by matching the cookie token)
  const store = await cookies()
  const currentToken = store.get(SESSION_COOKIE)?.value

  return sessions.map((s) => ({
    ...s,
    // Don't expose the full token — only a prefix for identification
    token: s.token.slice(0, 8) + '...',
    isCurrent: s.token === currentToken,
  }))
}

/**
 * Sliding refresh: extend the session expiry on each authenticated request.
 * Only extends if the session is within the "refresh window" (last 25% of TTL).
 * This prevents excessive DB writes on every request while keeping active
 * users logged in.
 *
 * Also updates lastActivityAt + lastIp for anomaly detection.
 */
export async function refreshSession(token: string, ip?: string): Promise<void> {
  try {
    const session = await db.session.findUnique({ where: { token } })
    if (!session) return

    const now = Date.now()
    const expiry = session.expiresAt.getTime()
    const refreshThreshold = expiry - (SESSION_TTL_DAYS * 24 * 60 * 60 * 1000 * 0.25) // refresh in last 25% of TTL

    const updates: { lastActivityAt: Date; lastIp?: string; expiresAt?: Date } = {
      lastActivityAt: new Date(now),
    }

    if (ip) {
      updates.lastIp = ip
    }

    // Only extend expiry if within the refresh window
    if (now > refreshThreshold) {
      updates.expiresAt = new Date(now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
    }

    await db.session.update({ where: { token }, data: updates })
  } catch {
    // Session may have been revoked between read + write; ignore
  }
}

/**
 * Get the client IP from a request (for session anomaly detection).
 */
export function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  return null
}

/**
 * Detect session anomaly (IP change between requests).
 * Returns true if the IP changed significantly (different /24 subnet).
 * Used for logging + alerting (not for blocking — too many false positives
 * from mobile networks).
 */
export function detectIpChange(prevIp: string | null, currentIp: string | null): boolean {
  if (!prevIp || !currentIp) return false // can't compare
  if (prevIp === currentIp) return false
  // Compare first 3 octets (same /24 subnet = same network)
  const prevPrefix = prevIp.split('.').slice(0, 3).join('.')
  const currentPrefix = currentIp.split('.').slice(0, 3).join('.')
  return prevPrefix !== currentPrefix
}
