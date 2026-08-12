import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, apiError } from '@/lib/errors'
import { _setSimulateDbFailure, _getSimulateDbFailure, getKillSwitchState } from '@/lib/killswitch'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'

// P0-23 — Permanent test fixture for the kill-switch fail-safe path.
//
// Provides runtime-toggleable simulation of DB-read failure on the kill-switch
// store, so the P0-23 fail-safe test can prove:
//   - dependency failure → kill-switch state unavailable → SAFE DEFAULT applied
//   - protected operation blocked (NOT fail-open)
//
// Production guard: this endpoint returns 403 in production environments.

const toggleBodySchema = z.object({
  simulateDbFailure: z.boolean(),
})

// GET /api/p0-23-test — returns current simulation flag + tests the read path.
export const GET = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403, undefined, traceId)
  }
  const state = await getKillSwitchState('ordering', traceId)
  return NextResponse.json({
    simulateDbFailure: _getSimulateDbFailure(),
    killSwitchRead: {
      key: state.key,
      enabled: state.enabled,
      source: state.source,
      reason: state.reason ?? null,
    },
    traceId,
  })
})

// POST /api/p0-23-test  body: { simulateDbFailure: boolean }
// Toggles the in-process simulation flag. The flag is process-local (not
// persisted), so a server restart clears it.
export const POST = (req: NextRequest) => withErrorHandler(req, async (traceId) => {
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403, undefined, traceId)
  }
  const { simulateDbFailure } = await validateBody(req, toggleBodySchema)
  _setSimulateDbFailure(simulateDbFailure)
  // Read the state IMMEDIATELY after toggling so we can capture the fail-safe
  // event in the same request and confirm it engages.
  const state = await getKillSwitchState('ordering', traceId)
  return NextResponse.json({
    simulateDbFailure: _getSimulateDbFailure(),
    killSwitchRead: {
      key: state.key,
      enabled: state.enabled,
      source: state.source,
      reason: state.reason ?? null,
    },
    traceId,
  })
})
