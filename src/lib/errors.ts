import { NextResponse } from 'next/server'
import { newTraceId } from './logger'

// P0-18 — Error handling (consistent error envelope)
// Every API returns a consistent error envelope; UI shows actionable errors.
// Control/Enabler (Architectural Law 6): preserves operability, does not enforce a business truth.

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
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

// Wrap an async API handler with consistent error catching.
export function withErrorHandler<T>(
  handler: () => Promise<NextResponse<T>>,
  traceId?: string,
): Promise<NextResponse<T | ApiError>> {
  const tid = traceId ?? newTraceId()
  return handler().catch((err) => {
    if (err instanceof AppError) {
      return apiError(err.code, err.message, err.statusCode, err.details, tid)
    }
    // Unknown error — log with trace id, return generic 500.
    console.error(`[unhandled] traceId=${tid}`, err)
    return apiError(
      'INTERNAL_ERROR',
      'An unexpected error occurred. Please retry.',
      500,
      { name: err.name },
      tid,
    )
  })
}
