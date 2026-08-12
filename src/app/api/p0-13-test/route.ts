import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, apiError } from '@/lib/errors'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'
import {
  _setSimulateLimiterFailure,
  _getSimulateLimiterFailure,
  _resetAllRateLimits,
  _resetRateLimitKey,
} from '@/middleware'

// P0-13 — Permanent test fixture for rate-limit verification.
//
// Provides:
//   GET  /api/p0-13-test              — current simulation flag + limiter state
//   POST /api/p0-13-test              — toggle simulation flag + reset rate-limit state
//   POST /api/p0-13-test/reset-all    — reset ALL rate-limit state (clean baseline)
//   POST /api/p0-13-test/reset-key    — reset a specific rate-limit key
//
// Production guard: returns 403 in production environments.

const toggleBodySchema = z.object({
  simulateLimiterFailure: z.boolean().optional(),
  resetAll: z.boolean().optional(),
  resetKey: z.string().optional(),
})

export const GET = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403, undefined, traceId)
  }
  return NextResponse.json({
    simulateLimiterFailure: _getSimulateLimiterFailure(),
    traceId,
  })
})

export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403, undefined, traceId)
  }
  const body = await validateBody(req, toggleBodySchema)

  if (body.resetAll) {
    _resetAllRateLimits()
  }
  if (body.resetKey) {
    _resetRateLimitKey(body.resetKey)
  }
  if (typeof body.simulateLimiterFailure === 'boolean') {
    _setSimulateLimiterFailure(body.simulateLimiterFailure)
  }

  return NextResponse.json({
    simulateLimiterFailure: _getSimulateLimiterFailure(),
    action: {
      resetAll: !!body.resetAll,
      resetKey: body.resetKey ?? null,
      toggledSimulate: typeof body.simulateLimiterFailure === 'boolean',
    },
    traceId,
  })
})
