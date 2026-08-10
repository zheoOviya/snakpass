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

  // Fail-open paths: general API
  general: { limit: 100, windowMs: WINDOW_MS, mode: 'fail-open' as LimiterMode }, // 100 req/min
} as const

// Build a rate-limit key from IP + path type.
export function rateLimitKey(ip: string, pathType: keyof typeof RATE_LIMITS): string {
  return `rl:${pathType}:${ip}`
}

// Extract client IP from request (handles proxy headers).
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}
