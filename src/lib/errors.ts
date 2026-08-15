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
  | 'IDEMPOTENCY_KEY_REUSE' // Sub-Wave 3c: same key + materially different request body (422)

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

// ----------------------------------------------------------------------------
// Sub-Wave 3c — IdempotencyKeyReuseError
// ----------------------------------------------------------------------------
// Thrown when an idempotency key is reused with a materially different request
// body (hash mismatch). This is a NON-retryable error — the client must either:
//   1. Use a NEW idempotency key for the new request, OR
//   2. Send the SAME request body to retrieve the cached response.
//
// This error is thrown INSIDE the withTransaction body (from getCachedResponse)
// and propagates out of the retry loop (it is NOT in isRetryableConflict).
// The route handler catches it and returns HTTP 422.
// ----------------------------------------------------------------------------
export class IdempotencyKeyReuseError extends AppError {
  constructor(
    key: string,
    storedRequestHash: string | null,
    receivedRequestHash: string,
    resourceType: string,
    resourceId: string,
  ) {
    super(
      'IDEMPOTENCY_KEY_REUSE',
      `Idempotency-Key '${key.slice(0, 8)}...' was already used for a different request. Use a new Idempotency-Key or send the same request body.`,
      422,
      {
        idempotencyKey: key,
        resourceType,
        resourceId,
        storedRequestHash,
        receivedRequestHash,
        retryStrategy: 'new-key',
        hint: 'This key was previously used with a different request body. To retrieve the original response, send the same request body. To create a new resource, use a new Idempotency-Key.',
      },
    )
    this.name = 'IdempotencyKeyReuseError'
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
