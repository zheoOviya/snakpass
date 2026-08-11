import { NextRequest, NextResponse } from 'next/server'

// P0-13 — Rate limiting wired into the request path (Edge Runtime Compatible)
// P0-14 — CSRF protection (double-submit cookie pattern)
// P0-18 — Every rejection emits a structured JSON log line with the same traceId
//         that is returned in the error envelope (so client ↔ server correlation works).
// P0-19 — Structured logging: every rejection logs to stdout as JSON.
// Control/Enabler: fail-closed for auth/payment/admin-write; fail-open for general API.
//
// Edge Runtime does not support Node.js 'crypto' module, so we use Web Crypto API
// (crypto.randomUUID) and inline in-memory rate limiter (no external imports).

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

// P0-13 testability hook: simulate limiter-unavailable state at runtime.
// globalThis survives Next.js dev hot-reloads (same pattern as globalForPrisma).
// When this flag is true, checkRateLimit() throws — exercises the fail-closed
// try/catch path so we can prove the system does NOT fail-open on limiter error.
const globalForRateLimit = globalThis as unknown as {
  __p0_13_simulate_limiter_failure?: boolean
}

/** @internal Toggle the simulated limiter-failure flag (P0-13 test fixture only). */
export function _setSimulateLimiterFailure(value: boolean): void {
  globalForRateLimit.__p0_13_simulate_limiter_failure = value
}

/** @internal Read the simulated limiter-failure flag. */
export function _getSimulateLimiterFailure(): boolean {
  return !!globalForRateLimit.__p0_13_simulate_limiter_failure
}

/** @internal Reset a specific rate-limit key (used by tests to isolate scenarios). */
export function _resetRateLimitKey(key: string): void {
  store.delete(key)
}

/** @internal Reset ALL rate-limit state (used by tests to start from a clean baseline). */
export function _resetAllRateLimits(): void {
  store.clear()
}

function checkRateLimit(
  key: string,
  limit: number,
  mode: LimiterMode,
  req: NextRequest,
): { allowed: boolean; remaining: number; resetAt: number } {
  // P0-13 test hook: simulate limiter failure.
  // Two trigger paths so the flag survives Next.js dev hot-reloads AND
  // the Edge/Node.js runtime boundary (middleware runs in Edge Runtime;
  // the test fixture endpoint runs in Node.js — they have separate
  // globalThis objects):
  //   1. globalThis flag (set via the /api/p0-13-test endpoint — works when
  //      middleware + handler share a runtime, e.g. in production with a
  //      single worker).
  //   2. Request header `X-P0-13-Simulate-Failure: 1` (set by the test
  //      runner; works across runtimes because headers cross the boundary).
  //   3. env var `RATE_LIMIT_SIMULATE_FAILURE=1` (set at server start).
  const headerFlag = req.headers.get('x-p0-13-simulate-failure')
  if (
    _getSimulateLimiterFailure() ||
    headerFlag === '1' ||
    process.env.RATE_LIMIT_SIMULATE_FAILURE === '1'
  ) {
    throw new Error('simulated: rate-limiter store unavailable (P0-13 fail-closed test)')
  }
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

// Edge-safe structured JSON log emitter (matches the shape emitted by src/lib/logger).
// Edge Runtime cannot import src/lib/logger (uses Node's process.stdout), so we
// inline the same JSON shape here using console.warn/error which work in Edge.
function emitStructuredLog(
  level: 'warn' | 'error',
  message: string,
  traceId: string,
  context: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId,
    ...context,
  })
  // Edge Runtime: console.warn → stderr; console.log → stdout. Both are captured
  // by Next.js dev server's tee'd output (dev.log) in production-equivalent fashion.
  if (level === 'error') {
    console.error(line)
  } else {
    console.warn(line)
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

  // Skip test endpoints (P0-18 test fixture + audit integrity test + P0-23 kill-switch fail-safe test + P0-13 rate-limit test)
  if (pathname.includes('/verify-test') || pathname.includes('/audit-integrity-test') || pathname.includes('/p0-18-test') || pathname.includes('/p0-23-test') || pathname.includes('/p0-13-test')) {
    return NextResponse.next()
  }

  // P0-14 — CSRF protection on state-changing requests.
  // Double-submit cookie pattern: cookie token must match X-CSRF-Token header.
  const method = req.method.toUpperCase()
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    // Skip auth/login routes — CSRF token not yet set before login
    // (login sets the CSRF cookie; subsequent requests must include it)
    if (!pathname.startsWith('/api/auth/')) {
      const cookieToken = req.cookies.get('snakzap_csrf')?.value
      const headerToken = req.headers.get('x-csrf-token')

      // P0-18 / P0-19: every CSRF rejection logs a structured line with the SAME traceId
      // that is returned in the error envelope, so client ↔ server correlation works.
      if (!cookieToken || !headerToken) {
        const traceId = newTraceId()
        emitStructuredLog('warn', 'csrf.rejected.missing_token', traceId, {
          code: 'CSRF_INVALID',
          statusCode: 403,
          path: pathname,
          method,
          reason: !cookieToken ? 'missing_cookie' : 'missing_header',
        })
        return NextResponse.json(
          { error: { code: 'CSRF_INVALID', message: 'CSRF token required', traceId } },
          { status: 403 },
        )
      }

      // Constant-time comparison
      if (cookieToken.length !== headerToken.length) {
        const traceId = newTraceId()
        emitStructuredLog('warn', 'csrf.rejected.length_mismatch', traceId, {
          code: 'CSRF_INVALID',
          statusCode: 403,
          path: pathname,
          method,
        })
        return NextResponse.json(
          { error: { code: 'CSRF_INVALID', message: 'CSRF token mismatch', traceId } },
          { status: 403 },
        )
      }

      let match = true
      for (let i = 0; i < cookieToken.length; i++) {
        if (cookieToken[i] !== headerToken[i]) match = false
      }

      if (!match) {
        const traceId = newTraceId()
        emitStructuredLog('warn', 'csrf.rejected.token_mismatch', traceId, {
          code: 'CSRF_INVALID',
          statusCode: 403,
          path: pathname,
          method,
        })
        return NextResponse.json(
          { error: { code: 'CSRF_INVALID', message: 'CSRF token mismatch', traceId } },
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

  let result: { allowed: boolean; remaining: number; resetAt: number }
  try {
    result = checkRateLimit(key, config.limit, config.mode, req)
  } catch (err) {
    // Limiter unavailable (e.g. Redis down in production, or simulated failure).
    // P0-13 PASS criterion: protected requests must NOT fail-open.
    // fail-closed → return 503 (block the request, do NOT call the handler).
    // fail-open → allow the request through (general API class only).
    const errorMessage = (err as Error)?.message ?? 'unknown-limiter-error'
    if (config.mode === 'fail-closed') {
      emitStructuredLog('error', 'rate-limit.limiter-unavailable-fail-closed', traceId, {
        code: 'RATE_LIMITED',
        statusCode: 503,
        ip,
        pathType,
        errorMessage,
      })
      const failClosedResponse = NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Service busy. Please retry.', traceId, details: { pathType, reason: 'limiter-unavailable' } } },
        { status: 503 },
      )
      failClosedResponse.headers.set('X-Trace-Id', traceId)
      return failClosedResponse
    }
    // fail-open mode: log + allow through (general API).
    emitStructuredLog('warn', 'rate-limit.limiter-unavailable-fail-open', traceId, {
      code: 'RATE_LIMITED',
      statusCode: 200,
      ip,
      pathType,
      errorMessage,
    })
    // Allow the request through with a synthetic "unlimited" result.
    result = { allowed: true, remaining: 0, resetAt: Date.now() + WINDOW_MS }
  }

  if (!result.allowed) {
    // Rate limit exceeded — emit structured log (Edge-safe pattern, matches src/lib/logger shape)
    emitStructuredLog('warn', 'rate-limit.exceeded', traceId, {
      code: 'RATE_LIMITED',
      statusCode: config.mode === 'fail-closed' ? 503 : 429,
      ip,
      pathType,
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
    })

    const statusCode = config.mode === 'fail-closed' ? 503 : 429
    const message = config.mode === 'fail-closed'
      ? 'Service busy. Please retry.'
      : 'Too many requests. Please slow down.'

    const blockedResponse = NextResponse.json(
      { error: { code: 'RATE_LIMITED', message, traceId, details: { pathType, retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) } } },
      { status: statusCode },
    )
    // P0-18 / P0-19 consistency: X-Trace-Id header on EVERY response so client
    // tooling can correlate without parsing the JSON body.
    blockedResponse.headers.set('X-Trace-Id', traceId)
    return blockedResponse
  }

  // P0-18 / P0-19: forward X-Trace-Id on the REQUEST so downstream route handlers
  // can reuse the SAME traceId for their log lines and any error envelopes.
  // This is the single source of truth for traceId across the request lifecycle.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-trace-id', traceId)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('X-RateLimit-Limit', String(config.limit))
  response.headers.set('X-RateLimit-Remaining', String(result.remaining))
  response.headers.set('X-RateLimit-Reset', String(result.resetAt))
  response.headers.set('X-Trace-Id', traceId)

  return response
}

export const config = {
  matcher: '/api/:path*',
}
