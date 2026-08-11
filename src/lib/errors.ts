import { NextRequest, NextResponse } from 'next/server'
import { newTraceId, warn, error as logError } from './logger'

// P0-18 — Error handling (consistent error envelope with traceable correlation)
// Every API returns a consistent error envelope; UI shows actionable errors.
// The same traceId appears in: (a) the response envelope, (b) the structured
// server log line, and (c) the X-Trace-Id response header.
// Control/Enabler (Architectural Law 6): preserves operability, does not enforce a business truth.

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'KILL_SWITCH_ACTIVE'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INVARIANT_VIOLATION'
  | 'UNKNOWN_STATE'
  | 'INTERNAL_ERROR'

export interface ApiError {
  error: {
    code: ErrorCode
    message: string // user-actionable
    traceId: string
    details?: Record<string, unknown> // additional context (field errors, etc.)
  }
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// Consistent error response helper.
export function apiError(
  code: ErrorCode,
  message: string,
  statusCode: number = 400,
  details?: Record<string, unknown>,
  traceId?: string,
): NextResponse<ApiError> {
  const tid = traceId ?? newTraceId()
  return NextResponse.json(
    { error: { code, message, traceId: tid, details } },
    { status: statusCode },
  )
}

// Success response helper (for consistency).
export function apiOk<T>(data: T, traceId?: string): NextResponse<T & { traceId?: string }> {
  return NextResponse.json(traceId ? { ...data, traceId } : data)
}

// Resolve the traceId for a request. Order of precedence:
//   1. X-Trace-Id header (set by middleware) — enables cross-service correlation.
//   2. Generate a fresh traceId.
export function resolveTraceId(req?: NextRequest): string {
  if (req) {
    const header = req.headers.get('x-trace-id')
    if (header) return header
  }
  return newTraceId()
}

// Wrap an async API handler with consistent error catching AND structured logging.
// The same traceId flows into: (a) the error envelope, (b) the structured log line,
// (c) any success-path log lines emitted by the handler via the passed-in traceId.
//
// Supports two calling conventions:
//   1. withErrorHandler(req, async (traceId) => { ... })   // preferred: reuses middleware's X-Trace-Id
//   2. withErrorHandler(async (traceId) => { ... })         // fallback: generates a fresh traceId
//
// Either way, the traceId in the response envelope ALWAYS matches the traceId in
// the structured server log line, satisfying the P0-18 PASS criterion:
// "same traceId in server-side structured log".
export function withErrorHandler<T>(
  reqOrHandler: NextRequest | ((traceId: string) => Promise<NextResponse<T>>),
  maybeHandler?: (traceId: string) => Promise<NextResponse<T>>,
): Promise<NextResponse<T | ApiError>> {
  let tid: string
  let handler: (traceId: string) => Promise<NextResponse<T>>
  if (typeof reqOrHandler === 'function') {
    // Called as withErrorHandler(handler) — generate a fresh traceId.
    tid = newTraceId()
    handler = reqOrHandler
  } else {
    // Called as withErrorHandler(req, handler) — reuse middleware's X-Trace-Id.
    tid = resolveTraceId(reqOrHandler)
    handler = maybeHandler!
  }
  return handler(tid).catch((err) => {
    if (err instanceof AppError) {
      // Known application error — log at warn (expected failure mode).
      // The log message is `app.error.<code>` (machine-greppable); the human-readable
      // error message is captured as `errorMessage` in the structured context.
      warn(`app.error.${err.code}`, {
        code: err.code,
        statusCode: err.statusCode,
        errorMessage: err.message,
        details: err.details,
      }, tid)
      return apiError(err.code, err.message, err.statusCode, err.details, tid)
    }
    // Unknown/unexpected error — log at error with stack-stripped context.
    // The raw error is logged server-side (NEVER leaked to the client response).
    logError('unhandled.error', {
      errorName: err?.name,
      errorMessage: err?.message,
    }, tid)
    return apiError(
      'INTERNAL_ERROR',
      'An unexpected error occurred. Please retry.',
      500,
      { name: err?.name ?? 'UnknownError' },
      tid,
    )
  })
}
