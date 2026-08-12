import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, apiError } from '@/lib/errors'

// P0-18 — Permanent test fixture for the unhandled-error path.
//
// Returns a generic 500 with the standard error envelope and a traceId that
// ALSO appears in the structured server log line (emitted by withErrorHandler).
//
// Production guard: this endpoint returns 403 in production environments so it
// cannot be abused as an attack surface.

export const GET = (req: NextRequest) => withErrorHandler(req, async () => {
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403)
  }

  // Simulate an UNEXPECTED error (not an AppError) — e.g. a downstream library
  // throwing because of a transient dependency failure.
  throw new Error('simulated-downstream-failure: payment-gateway-timeout')
})

export const POST = (req: NextRequest) => withErrorHandler(req, async () => {
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403)
  }

  // Simulate a different unexpected error class.
  const err = new TypeError('Cannot read properties of undefined (reading "amount")')
  err.name = 'TypeError'
  throw err
})
