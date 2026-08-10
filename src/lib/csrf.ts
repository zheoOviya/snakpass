import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'

// P0-14 — CSRF protection
// State-changing POSTs require a valid CSRF token.
// Control/Enabler (enables all state-changing writes to be safe).
//
// Double-submit cookie pattern:
//   1. Server sets a csrf_token cookie (SameSite=Lax, HttpOnly=false so JS can read it).
//   2. Client sends the token in X-CSRF-Token header on state-changing requests.
//   3. Server compares cookie token to header token — must match.
// This is stateless and works across server instances.

export const CSRF_COOKIE = 'snakzap_csrf'
const CSRF_TOKEN_LENGTH = 32

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex')
}

// Set the CSRF cookie (called on page load / session creation).
export async function setCsrfCookie(): Promise<string> {
  const token = generateCsrfToken()
  const store = await cookies()
  store.set(CSRF_COOKIE, token, {
    httpOnly: false, // JS must read it to send in header
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days (matches session)
    secure: process.env.NODE_ENV === 'production',
  })
  return token
}

// Verify CSRF token: cookie must match header.
export async function verifyCsrfToken(headerToken: string | null): Promise<boolean> {
  if (!headerToken) return false
  const store = await cookies()
  const cookieToken = store.get(CSRF_COOKIE)?.value
  if (!cookieToken) return false
  // Constant-time comparison
  if (cookieToken.length !== headerToken.length) return false
  let match = true
  for (let i = 0; i < cookieToken.length; i++) {
    if (cookieToken[i] !== headerToken[i]) match = false
  }
  return match
}

// Check if a request needs CSRF protection (state-changing methods).
export function isStateChanging(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())
}
