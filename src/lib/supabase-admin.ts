import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { jwtVerify, createRemoteJWKSet } from 'jose'

// P0-09 — Server-side Supabase JWT verification (DEV-002 closure)
// Supabase server-side admin client + JWT verification (sole auth platform).
// Direct Protector of I-12 (Session Revocation).
//
// The server verifies the Supabase access token using the project's JWKS
// (JSON Web Key Set) endpoint. This verifies: signature, expiry, issuer
// (project URL), and audience. Revoked tokens are checked via Supabase Auth API.
//
// BUILD-TIME SAFETY: env vars are read lazily (not at module load) so that
// `next build` doesn't crash when Supabase vars aren't set yet (e.g. during
// Vercel build before env vars are configured).

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''
const JWKS_URL = process.env.SUPABASE_JWKS_URL ?? ''

// Lazy-init: only create the client when env vars are present.
// Without this guard, createClient('', '') throws at module load time,
// crashing the build.
let _supabaseAdmin: SupabaseClient | null = null
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabaseAdmin) {
      if (!isSupabaseConfigured()) {
        throw new Error('SUPABASE_NOT_CONFIGURED: Set SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL')
      }
      _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    }
    return (_supabaseAdmin as Record<string | symbol, unknown>)[prop]
  },
})

// Lazy-init JWKS — only create when configured
let _JWKS: ReturnType<typeof createRemoteJWKSet> | null = null
function getJWKS() {
  if (!_JWKS) {
    _JWKS = createRemoteJWKSet(new URL(JWKS_URL))
  }
  return _JWKS
}

export interface VerifiedUser {
  uid: string
  phone: string
  email?: string
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && JWKS_URL)
}

// Verify a Supabase access token server-side.
// Uses JWKS to verify signature, expiry, issuer, audience.
// Returns { uid, phone } on success; throws on failure.
export async function verifySupabaseToken(accessToken: string): Promise<VerifiedUser> {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Set SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL')
  }

  // Verify the JWT using JWKS
  const { payload } = await jwtVerify(accessToken, getJWKS(), {
    issuer: `${SUPABASE_URL}/auth/v1`,
    audience: 'authenticated',
  })

  // Extract phone from JWT payload
  const phone = payload.phone as string | undefined
  if (!phone) {
    throw new Error('Token has no phone claim')
  }

  return {
    uid: payload.sub!,
    phone,
    email: payload.email as string | undefined,
  }
}

// Check if a user's session is revoked (via Supabase Auth API)
export async function isUserRevoked(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (error) return true // if we can't verify, treat as revoked (fail-closed)
    return !data?.user || data.user.banned_until !== null
  } catch {
    return true // fail-closed
  }
}
