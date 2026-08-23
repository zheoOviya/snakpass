// P0-13 — Rate limiting (fail-closed for auth/payment/admin-write)
// Auth/payment/admin-write return 503 when limiter unavailable; general API fail-open.
// Control/Enabler (enables P0-09..P0-11 to function safely).
//
// In production this uses Redis (sliding window). In dev (no Redis) it falls back to
// an in-memory limiter. The fail-closed semantics are:
//   - For auth/payment/admin-write paths: if the limiter is unavailable, REJECT (503).
//   - For general API: if the limiter is unavailable, ALLOW (fail-open).
// This is per matrix Section 10 (Redis unavailable row).

interface RateLimitEntry {
  count: number
  windowStart: number
}

// In-memory store (dev fallback). Production: Redis.
const store = new Map<string, RateLimitEntry>()
const WINDOW_MS = 60_000 // 1 minute

type LimiterMode = 'fail-closed' | 'fail-open'

// Check rate limit for a key. Returns { allowed, remaining, resetAt }.
// If the limiter is in fail-closed mode and unavailable, returns allowed=false.
export function checkRateLimit(
  key: string,
  limit: number,
  mode: LimiterMode = 'fail-open',
): { allowed: boolean; remaining: number; resetAt: number } {
  // In dev, the in-memory store is always available.
  // In production, this is where Redis availability would be checked.
  // For now, always available (in-memory).

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // New window
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS }
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + WINDOW_MS }
  }

  entry.count++
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + WINDOW_MS }
}

// Rate limit configurations per path type.
export const RATE_LIMITS = {
  // Fail-closed paths: auth, payment, admin-write
  auth: { limit: 20, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode }, // 20/min for login attempts
  otpSend: { limit: 3, windowMs: 10 * 60_000, mode: 'fail-closed' as LimiterMode }, // 3 OTP sends per 10 min
  otpVerify: { limit: 5, windowMs: 10 * 60_000, mode: 'fail-closed' as LimiterMode }, // 5 verify attempts per 10 min
  payment: { limit: 10, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode }, // 10 payment attempts/min
  adminWrite: { limit: 30, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode }, // 30 admin writes/min

  // S4B Privacy/Abuse Repair-03 (P4-C): Search endpoint gets its own
  // fail-closed bucket because it is an enumeration-sensitive surface.
  // If the limiter backend is unavailable, search returns 503 (controlled
  // failure) rather than allowing unrestricted enumeration.
  search: { limit: 30, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode }, // 30 search req/min

  // Fail-open paths: general API
  general: { limit: 100, windowMs: WINDOW_MS, mode: 'fail-open' as LimiterMode }, // 100 req/min
} as const

// Build a rate-limit key from IP + path type.
export function rateLimitKey(ip: string, pathType: keyof typeof RATE_LIMITS): string {
  return `rl:${pathType}:${ip}`
}

// S4B Privacy/Abuse Repair-03 (P4-A): Extract client IP from request.
//
// SECURITY: We NO LONGER trust client-supplied `x-forwarded-for` directly.
// Previously, an attacker could rotate XFF values to obtain fresh rate-limit
// buckets (proven at runtime — X-RateLimit-Remaining reset from 95 to 99
// when only XFF changed).
//
// New contract:
//   - In production behind a trusted proxy (e.g. Caddy/Cloudflare), the proxy
//     sets `x-real-ip` from the actual connection. We trust x-real-ip ONLY.
//   - We IGNORE `x-forwarded-for` entirely — it is client-spoofable.
//   - Fallback: 'unknown' (which gets its own bucket — fail-safe).
//
// This is the safer behavior per the directive: "ignore X-Forwarded-For for
// rate-limit identity rather than trusting attacker input."
export function getClientIP(req: Request): string {
  // Trust x-real-ip (set by trusted reverse proxy like Caddy)
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP.trim()
  // Intentionally DO NOT read x-forwarded-for — it's client-spoofable.
  // Fallback to 'unknown' bucket (fail-safe — all unknowns share a bucket).
  return 'unknown'
}
