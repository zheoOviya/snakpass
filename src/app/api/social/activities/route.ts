import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import {
  recordActivity,
  sanitizeActivityMetadata,
  VERBS,
  type SocialActivityRow,
} from '@/lib/social-activity'
import { enqueueActivityFeedFanout } from '@/lib/social-realtime'

// ----------------------------------------------------------------------------
// Wave 6 Task 6A — POST /api/social/activities
// ----------------------------------------------------------------------------
// Record a social activity for the current user. Called by the frontend
// AFTER an event (order created, gift sent, group joined, etc.).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: CONSUMER (or any role for their own activity). Most activities are
//       consumer-side (ordering, gifting, group joining). Vendors + admins
//       are allowed too — they can have their own social activity.
//
// Body: {
//   verb: string,         // use VERBS constant (ORDERED | EARNED_REWARD | ...)
//   objectType: string,   // 'Restaurant' | 'MenuItem' | 'Gift' | 'GroupOrder'
//   objectId: string,     // the id of the referenced object
//   metadata?: object,    // optional — sensitive keys are stripped
//   visibility?: 'FRIENDS' | 'PUBLIC' | 'PRIVATE'  // default 'FRIENDS'
// }
//
// CRITICAL: Sanitize metadata — strip `amount`, `total`, `price`, `paymentId`,
//   `razorpayPaymentId`, `razorpaySignature` keys. If any are present, return
//   400 with code `SENSITIVE_DATA_IN_METADATA`.
//
// Idempotency:
//   - Idempotency-Key header supported (optional — activities are append-only,
//     but dedup is nice for safe retries).
//   - When the header is present + a cached response exists, return it.
//
// Side effects (inside withTransaction):
//   - Sanitizes metadata (defense-in-depth on WRITE).
//   - Creates a SocialActivity row with the sanitized metadata.
//   - (No Notification — activities are not push-notifications.)
//
// Response: 201 { activity: { id, actorId, verb, objectType, objectId,
//                              metadata, visibility, createdAt } }
//
// Errors: 400 (validation / SENSITIVE_DATA_IN_METADATA) / 401 (no session) /
//         409 (conflict) / 422 (Idempotency-Key reuse) / 500 (internal).
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'SocialActivity'
const ALLOWED_VERBS = new Set<string>(Object.values(VERBS))
const ALLOWED_VISIBILITY = new Set(['FRIENDS', 'PUBLIC', 'PRIVATE'])

// Validated body shape.
interface ActivityBody {
  verb: string
  objectType: string
  objectId: string
  metadata?: Record<string, unknown>
  visibility?: 'FRIENDS' | 'PUBLIC' | 'PRIVATE'
}

/** Detect sensitive keys in a metadata object (recursively, case-insensitive). */
function findSensitiveKeys(value: unknown, path: string = ''): string[] {
  const found: string[] = []
  if (value === null || typeof value !== 'object') return found
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      found.push(...findSensitiveKeys(value[i], `${path}[${i}]`))
    }
    return found
  }
  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase()
    // Match the SENSITIVE_METADATA_KEYS set (defined in social-activity.ts).
    if (
      [
        'amount',
        'total',
        'price',
        'paymentid',
        'razorpaypaymentid',
        'razorpaysignature',
        'amountpaise',
        'totalamount',
        'totalpaise',
        'subtotal',
        'grandtotal',
        'discountamount',
        'refundamount',
        'paidamount',
        'chargedamount',
      ].includes(lowerKey)
    ) {
      found.push(path ? `${path}.${key}` : key)
    } else {
      // Recurse into nested objects.
      const nested = obj[key]
      if (nested !== null && typeof nested === 'object') {
        found.push(...findSensitiveKeys(nested, path ? `${path}.${key}` : key))
      }
    }
  }
  return found
}

export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse body.
    // -------------------------------------------------------------------------
    let body: Partial<ActivityBody> = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as Partial<ActivityBody>
      }
    } catch {
      // ignore — fails validation below
    }

    const verb = typeof body.verb === 'string' ? body.verb.trim() : ''
    const objectType = typeof body.objectType === 'string' ? body.objectType.trim() : ''
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : ''
    const metadata = body.metadata ?? {}
    // S1 Reconstruction: validate-before-default. Unknown visibility values
    // are rejected with 400 (NOT silently coerced to FRIENDS). PRIVATE is now
    // a valid visibility level (actor-only — feed route excludes it).
    let visibility: 'FRIENDS' | 'PUBLIC' | 'PRIVATE'
    if (typeof body.visibility === 'string') {
      const v = body.visibility.trim().toUpperCase()
      if (v === 'FRIENDS' || v === 'PUBLIC' || v === 'PRIVATE') {
        visibility = v
      } else {
        return apiError(
          'VALIDATION_ERROR',
          `Invalid visibility '${body.visibility}'`,
          400,
          { field: 'visibility', allowed: ['FRIENDS', 'PUBLIC', 'PRIVATE'] },
          traceId,
        ) as unknown as NextResponse
      }
    } else {
      visibility = 'FRIENDS' // default when omitted
    }

    // -------------------------------------------------------------------------
    // Validate.
    // -------------------------------------------------------------------------
    if (!verb) {
      return apiError(
        'VALIDATION_ERROR',
        'verb is required',
        400,
        { field: 'verb', allowed: Array.from(ALLOWED_VERBS) },
        traceId,
      ) as unknown as NextResponse
    }
    if (!ALLOWED_VERBS.has(verb)) {
      return apiError(
        'VALIDATION_ERROR',
        `Unknown verb '${verb}'`,
        400,
        { field: 'verb', allowed: Array.from(ALLOWED_VERBS) },
        traceId,
      ) as unknown as NextResponse
    }
    if (!objectType) {
      return apiError(
        'VALIDATION_ERROR',
        'objectType is required',
        400,
        { field: 'objectType' },
        traceId,
      ) as unknown as NextResponse
    }
    if (!objectId) {
      return apiError(
        'VALIDATION_ERROR',
        'objectId is required',
        400,
        { field: 'objectId' },
        traceId,
      ) as unknown as NextResponse
    }
    if (!ALLOWED_VISIBILITY.has(visibility)) {
      return apiError(
        'VALIDATION_ERROR',
        `Invalid visibility '${visibility}'`,
        400,
        { field: 'visibility', allowed: Array.from(ALLOWED_VISIBILITY) },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Sensitive-key detection — reject with 400 SENSITIVE_DATA_IN_METADATA
    // if the caller tried to include payment amounts.
    // -------------------------------------------------------------------------
    if (metadata !== null && typeof metadata === 'object') {
      const sensitiveKeys = findSensitiveKeys(metadata)
      if (sensitiveKeys.length > 0) {
        return apiError(
          'VALIDATION_ERROR',
          'Payment amounts are not allowed in activity metadata',
          400,
          {
            code: 'SENSITIVE_DATA_IN_METADATA',
            sensitiveKeys,
            hint: 'Strip amount/total/price/paymentId from metadata before recording the activity.',
          },
          traceId,
        ) as unknown as NextResponse
      }
    }

    // -------------------------------------------------------------------------
    // Idempotency-Key header (optional).
    // -------------------------------------------------------------------------
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'social-activities-idempotency-dedup-hit',
              { key: idempotencyKey },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Record the activity. recordActivity() sanitizes metadata again
        // (defense-in-depth) before INSERT.
        // -------------------------------------------------------------------
        const activity = (await recordActivity(tx, {
          actorId: session.userId,
          verb,
          objectType,
          objectId,
          metadata,
          visibility,
          idempotencyKey: idempotencyKey ?? undefined,
        })) as SocialActivityRow

        // Re-parse the stored metadata to return it as an object (the schema
        // stores it as a JSON-stringified String column).
        let returnedMetadata: Record<string, unknown> = {}
        try {
          returnedMetadata = JSON.parse(activity.metadata)
        } catch {
          returnedMetadata = {}
        }
        // Sanitize on READ too (defense-in-depth).
        returnedMetadata = sanitizeActivityMetadata(returnedMetadata)

        const responseBody = {
          activity: {
            id: activity.id,
            actorId: activity.actorId,
            verb: activity.verb,
            objectType: activity.objectType,
            objectId: activity.objectId,
            metadata: returnedMetadata,
            visibility: activity.visibility,
            createdAt: activity.createdAt.toISOString(),
          },
        }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            activity.id,
            201,
            JSON.stringify(responseBody),
            requestHash,
          )
        }

        // S5D: Realtime feed fanout — emit SOCIAL_ACTIVITY_CREATED to all
        // accepted friends of the actor. Recipients are server-derived from
        // committed DB truth (SocialConnection where followerId=actor, status=ACCEPTED).
        // PRIVATE: no fanout (actor-only). FRIENDS/PUBLIC: fanout to friends.
        // Commit-before-publish: if the transaction rolls back, no event is
        // emitted (no activity row → no phantom feed invalidation).
        const fanoutResult = await enqueueActivityFeedFanout(tx, {
          actorId: session.userId,
          activityId: activity.id,
          visibility,
        })

        return { type: 'success' as const, status: 201, body: responseBody, fanoutRecipients: fanoutResult.recipientCount }
      })

      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'success': {
          logInfo(
            'social-activity-recorded',
            {
              activityId: result.body.activity.id,
              verb: result.body.activity.verb,
              objectType: result.body.activity.objectType,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'social-activities-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Activity recording conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
