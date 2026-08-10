import { cookies } from 'next/headers'
import { db } from './db'
import { randomToken } from './otp-service'

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

export async function setSessionCookie(token: string) {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
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
