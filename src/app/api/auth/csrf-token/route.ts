import { NextResponse } from 'next/server'
import { setCsrfCookie } from '@/lib/csrf'

// P0-14 — CSRF token bootstrap endpoint
// GET /api/auth/csrf-token
//
// Returns a CSRF token AND sets the snakzap_csrf cookie (httpOnly=false).
// Clients that don't have a session yet (e.g., testing, or pre-login forms)
// can call this endpoint to bootstrap a CSRF token before making their first
// state-changing request.
//
// NOTE: For authenticated users, the CSRF cookie is automatically set at
// session-creation time (see setSessionCookie in src/lib/session.ts). This
// endpoint is primarily for testing and unauthenticated state-changing flows
// (if any are added in the future).

export async function GET() {
  const token = await setCsrfCookie()
  return NextResponse.json({ csrfToken: token })
}
