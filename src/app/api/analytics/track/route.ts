import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'

// ----------------------------------------------------------------------------
// S5H1: POST /api/analytics/track
// ----------------------------------------------------------------------------
// Minimal privacy-safe analytics event receiver.
// Logs events to the server log (no third-party SDK).
//
// PRIVACY:
//   - Only safe dimensions accepted (event, experimentId, variant, restaurantId, friendCountBucket)
//   - Any forbidden fields in the body are silently dropped (not logged)
//   - No friend userId, name, phone, email, orderId, sourceOrderId, blockedBy, session/token
//
// This is intentionally simple — it logs structured events that can be
// collected by log aggregation. No database writes (analytics is ephemeral).

const ALLOWED_EVENTS = new Set([
  'SOCIAL_PROOF_IMPRESSION',
  'SOCIAL_PROOF_RESTAURANT_ENGAGEMENT',
  'SOCIAL_PROOF_ORDER_START',
])

const ALLOWED_FIELDS = new Set([
  'event',
  'experimentId',
  'variant',
  'restaurantId',
  'friendCountBucket',
  'timestamp',
])

export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    let body: Record<string, unknown> = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as Record<string, unknown>
      }
    } catch {
      return apiError('VALIDATION_ERROR', 'Invalid JSON', 400, undefined, traceId) as unknown as NextResponse
    }

    const event = typeof body.event === 'string' ? body.event : ''
    if (!ALLOWED_EVENTS.has(event)) {
      return apiError('VALIDATION_ERROR', `Unknown event: ${event}`, 400, undefined, traceId) as unknown as NextResponse
    }

    // Extract only allowed fields (drop any forbidden fields)
    const safeDimensions: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body) {
        safeDimensions[key] = body[key]
      }
    }

    // Log the event (structured log — collectable by log aggregation)
    logInfo('analytics-event', {
      userId: session.userId.substring(0, 8), // truncated hash for session correlation, NOT friend identity
      ...safeDimensions,
    }, traceId)

    return NextResponse.json({ ok: true })
  })
