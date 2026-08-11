import { NextRequest, NextResponse } from 'next/server'

// P0-13 — Rate limiting wired into the request path (Edge Runtime compatible)
// Control/Enabler: fail-closed for auth/payment/admin-write; fail-open for general API.
//
// Edge Runtime does not support Node.js 'crypto' module, so we use Web Crypto API
// (crypto.randomUUID) and an inline in-memory rate limiter (no external imports).

// --- Inline rate limiter (Edge-safe) ---
interface RateLimitEntry {
  count: number
  windowStart: number
}
const store = new Map<string, RateLimitEntry>()
const WINDOW_MS = 60_000

type LimiterMode = 'fail-closed' | 'fail-open'

const RATE_LIMITS = {
  auth: { limit: 20, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode },
  otpSend: { limit: 3, windowMs: 10 * 60_000, mode: 'fail-closed' as LimiterMode },
  otpVerify: { limit: 5, windowMs: 10 * 60_000, mode: 'fail-closed' as LimiterMode },
  payment: { limit: 10, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode },
  adminWrite: { limit: 30, windowMs: WINDOW_MS, mode: 'fail-closed' as LimiterMode },
  general: { limit: 100, windowMs: WINDOW_MS, mode: 'fail-open' as LimiterMode },
} as const

function checkRateLimit(
  key: string,
  limit: number,
  mode: LimiterMode,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS }
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + WINDOW_MS }
  }

  entry.count++
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + WINDOW_MS }
}

function classifyPath(pathname: string): keyof typeof RATE_LIMITS {
  if (pathname.startsWith('/api/auth/otp/send')) return 'otpSend'
  if (pathname.startsWith('/api/auth/otp/verify')) return 'otpVerify'
  if (pathname.startsWith('/api/auth/admin')) return 'auth'
  if (pathname.startsWith('/api/auth/firebase')) return 'auth'
  if (pathname.startsWith('/api/auth/login')) return 'auth'
  if (pathname.startsWith('/api/orders') && pathname.endsWith('/status')) return 'adminWrite'
  if (pathname.startsWith('/api/orders') && !pathname.includes('/', '/api/orders'.length)) return 'payment'
  if (pathname.startsWith('/api/payments')) return 'payment'
  if (pathname.startsWith('/api/kill-switches')) return 'adminWrite'
  if (pathname.startsWith('/api/menu')) return 'adminWrite'
  return 'general'
}

function getClientIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

// Edge-safe trace ID (Web Crypto API)
function newTraceId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Skip health check (must always be accessible)
  if (pathname === '/api/health') {
    return NextResponse.next()
  }

  // Skip test endpoints
  if (pathname.includes('/verify-test') || pathname.includes('/audit-integrity-test')) {
    return NextResponse.next()
  }

  // P0-14 — CSRF protection on state-changing requests
  // Double-submit cookie pattern: cookie token must match X-CSRF-Token header.
  const method = req.method.toUpperCase()
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    // Skip auth/login routes — CSRF token not yet set before login
    // (login sets the CSRF cookie; subsequent requests must include it)
    if (!pathname.startsWith('/api/auth/')) {
      const cookieToken = req.cookies.get('snakzap_csrf')?.value
      const headerToken = req.headers.get('x-csrf-token')

      const traceId = newTraceId()

      if (!cookieToken || !headerToken) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'CSRF token required', traceId } },
          { status: 403 },
        )
      }

      // Constant-time comparison
      if (cookieToken.length !== headerToken.length) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'CSRF token mismatch', traceId } },
          { status: 403 },
        )
      }

      let match = true
      for (let i = 0; i < cookieToken.length; i++) {
        if (cookieToken[i] !== headerToken[i]) match = false
      }

      if (!match) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'CSRF token mismatch', traceId } },
          { status: 403 },
        )
      }
    }
  }

  // P0-13 — Rate limiting
  const pathType = classifyPath(pathname)
  const config = RATE_LIMITS[pathType]
  const ip = getClientIP(req)
  const key = `rl:${pathType}:${ip}`
  const traceId = newTraceId()

  const result = checkRateLimit(key, config.limit, config.mode)

  if (!result.allowed) {
    // Rate limit exceeded — console.warn is Edge-safe (no external logger import)
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: '[P0-13] rate-limit-exceeded',
      traceId,
      ip,
      pathType,
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
    }))

    const statusCode = config.mode === 'fail-closed' ? 503 : 429
    const message = config.mode === 'fail-closed'
      ? 'Service busy. Please retry.'
      : 'Too many requests. Please slow down.'

    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message, traceId, details: { pathType, retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) } } },
      { status: statusCode },
    )
  }

  const response = NextResponse.next()
  response.headers.set('X-RateLimit-Limit', String(config.limit))
  response.headers.set('X-RateLimit-Remaining', String(result.remaining))
  response.headers.set('X-RateLimit-Reset', String(result.resetAt))
  response.headers.set('X-Trace-Id', traceId)

  return response
}

export const config = {
  matcher: '/api/:path*',
}
