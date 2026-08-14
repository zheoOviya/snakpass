'use client'

// P0-14 — CSRF client helper (double-submit cookie pattern)
//
// The server sets the `snakzap_csrf` cookie (httpOnly=false) at session-creation
// time (see src/lib/session.ts → setSessionCookie → setCsrfCookie). The client
// reads this cookie and sends its value in the X-CSRF-Token header on every
// state-changing request (POST/PUT/PATCH/DELETE). The server's middleware
// (src/middleware.ts) compares the cookie value to the header value — they must
// match for the request to proceed.
//
// Usage:
//   import { csrfFetch } from '@/lib/csrf-client'
//   const res = await csrfFetch('/api/orders', {
//     method: 'POST',
//     headers: { 'content-type': 'application/json' },
//     body: JSON.stringify({ ... }),
//   })
//
// csrfFetch auto-injects the X-CSRF-Token header for state-changing methods.
// For GET/HEAD/OPTIONS it behaves like a normal fetch.

const CSRF_COOKIE = 'snakzap_csrf'

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null // SSR safety
  const match = document.cookie.match(new RegExp('(?:^|; )' + CSRF_COOKIE + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function isStateChanging(method: string | undefined): boolean {
  const m = (method || 'GET').toUpperCase()
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)
}

/**
 * Wrapper around fetch() that auto-injects the X-CSRF-Token header for
 * state-changing requests (POST/PUT/PATCH/DELETE). The token is read from
 * the snakzap_csrf cookie (set by the server at login).
 *
 * If the cookie is missing (e.g., user not logged in, or cookie expired),
 * the request is still sent — the server will reject it with 403 if CSRF
 * is required. This matches the double-submit pattern: the server is the
 * source of truth, the client just provides the token if it has one.
 */
export async function csrfFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const method = typeof init.method === 'string' ? init.method.toUpperCase() : 'GET'

  // Merge headers (don't overwrite caller-provided X-CSRF-Token)
  const headers = new Headers(init.headers || {})
  if (isStateChanging(method)) {
    const token = readCsrfCookie()
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token)
    }
  }

  return fetch(input, { ...init, headers })
}
