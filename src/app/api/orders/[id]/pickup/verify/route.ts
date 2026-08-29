import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { validateBody, pickupVerifyBodySchema } from '@/lib/validation'
import { info as logInfo, warn as logWarn, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { auditWithTx, audit } from '@/lib/audit'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import {
  verifyPickupAttribution,
  reportAttributionFailure,
  type PickupAttributionFailure,
  type PickupAttributionSuccess,
} from '@/lib/pickup-attribution'

// ----------------------------------------------------------------------------
// P0-07 — POST /api/orders/[id]/pickup/verify
// ----------------------------------------------------------------------------
// Pickup attribution endpoint — implements I-13 (Pickup/Handoff Integrity).
//
// Input: `{ otpId: string, code: string, qrToken: string }`
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: CONSUMER (own order only), VENDOR_OWNER (any restaurant), ADMIN,
// SUPER_ADMIN. CONSUMER ownership check is enforced inside the txn (after the
// Order row is loaded) — we read order.userId and compare to session.userId.
//
// Idempotency (P0-17): Idempotency-Key header honored — same key on retry
// returns the cached response. resourceType='PickupAttribution'.
//
// Logic (inside withTransaction):
//   1. Check idempotency cache (return cached response if hit)
//   2. Load Order with relations
//   3. RBAC ownership check (CONSUMER → order.userId === session.userId)
//   4. Call verifyPickupAttribution(tx, params) — 6 checks + cross-credential
//   5. On success: AuditLog (PICKUP_VERIFIED with 5 attribution fields) +
//      Outbox (FULFILMENT_STATUS_CHANGED with attribution payload) +
//      storeIdempotencyRecord
//   6. On failure: return 409/404/422 with reason + stateSnapshot
//
// FAILURE HANDLING (OUTSIDE txn):
//   - reportAttributionFailure() routes to ExceptionQueue + alert (only for
//     failures that carry invariantViolation metadata — ORDER_INACTIVE_STATE,
//     OTP_TARGET_MISMATCH). Routine rejections (QR_TOKEN_INVALID,
//     ORDER_NOT_FOUND, OTP_VERIFICATION_FAILED) are logged only.
//
// Catch TransactionConflictError → 409 (retry-safe — Idempotency-Key ensures
// the next retry returns the cached response if the original eventually
// committed).
//
// SAFETY (Orchestrator boundary):
//   - This endpoint is ADDITIVE — it does NOT modify the existing
//     PATCH /api/orders/[id]/fulfilment route. Both routes coexist; the
//     pickupAttributionEnforcement flag gates whether PICKED_UP via the
//     fulfilment route is rejected (see fulfilment/route.ts modification).
//   - This endpoint is ALWAYS active (regardless of flag state) — once a
//     caller has a QR token + OTP, they can verify pickup. The flag only
//     gates whether the ALTERNATIVE fulfilment PATCH path is blocked.
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'PickupAttribution'

export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id: orderId } = await params
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
    }

    // -------------------------------------------------------------------------
    // Validate body (Zod) + extract Idempotency-Key
    // -------------------------------------------------------------------------
    const body = await validateBody(req, pickupVerifyBodySchema)
    const idempotencyKey = getIdempotencyKey(req)
    // Compute request hash OUTSIDE txn so retry uses the same hash (deterministic).
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    let attributionFailure: PickupAttributionFailure | null = null
    let attributionSuccess: PickupAttributionSuccess | null = null
    let cachedResponse: { status: number; body: unknown } | null = null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // Idempotency cache check (FIRST — inside txn)
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'pickup-verify-idempotency-dedup-hit',
              { key: idempotencyKey, orderId },
              traceId,
            )
            const parsed = parseCachedResponse(cached)
            return { type: 'cached' as const, status: parsed.status, body: parsed.body }
          }
        }

        // -------------------------------------------------------------------
        // V4A-1: RBAC ownership check (CONSUMER → own order, VENDOR_OWNER → owning restaurant)
        // -------------------------------------------------------------------
        // Allowed roles for pickup verification:
        //   - CONSUMER       → only their own order (ownership check below)
        //   - VENDOR_OWNER   → only orders for restaurants they own (ownership check below)
        //   - ADMIN          → any
        //   - SUPER_ADMIN    → any
        //
        // V4A-1 REPAIR: Previously VENDOR_OWNER could verify ANY order's pickup
        // (cross-tenant mutation). Now mirrors the V1-hardened fulfilment PATCH
        // route's ownership check: Restaurant.ownerUserId === session.userId.
        const allowedRoles = ['CONSUMER', 'VENDOR_OWNER', 'ADMIN', 'SUPER_ADMIN']
        if (!allowedRoles.includes(session.role)) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'Insufficient permissions for pickup verification',
                traceId,
                details: { requiredRoles: allowedRoles, actualRole: session.role },
              },
            },
          }
        }

        // For CONSUMER and VENDOR_OWNER, load the order to check ownership
        // BEFORE the attribution check (so we don't even attempt QR+OTP
        // verification for an unauthorized caller).
        if (session.role === 'CONSUMER' || session.role === 'VENDOR_OWNER') {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: { id: true, userId: true, restaurantId: true },
          })
          if (!order) {
            return {
              type: 'error' as const,
              status: 404,
              body: {
                error: { code: 'NOT_FOUND', message: 'Order not found', traceId },
              },
            }
          }
          if (session.role === 'CONSUMER') {
            // CONSUMER → only own order
            if (order.userId !== session.userId) {
              return {
                type: 'error' as const,
                status: 403,
                body: {
                  error: {
                    code: 'AUTHORIZATION_DENIED',
                    message: 'You can only verify pickup for your own orders',
                    traceId,
                    details: { orderId, orderOwnerId: order.userId, requesterId: session.userId },
                  },
                },
              }
            }
          } else {
            // VENDOR_OWNER → only restaurants they own
            const restaurant = await tx.restaurant.findUnique({
              where: { id: order.restaurantId },
              select: { ownerUserId: true },
            })
            if (!restaurant || restaurant.ownerUserId !== session.userId) {
              return {
                type: 'error' as const,
                status: 403,
                body: {
                  error: {
                    code: 'AUTHORIZATION_DENIED',
                    message: 'You do not own the restaurant for this order.',
                    traceId,
                    details: { orderId, restaurantId: order.restaurantId, requesterId: session.userId },
                  },
                },
              }
            }
          }
        }

        // -------------------------------------------------------------------
        // Core attribution verification (6 checks + cross-credential)
        // -------------------------------------------------------------------
        const attributionResult = await verifyPickupAttribution(tx, {
          orderId,
          otpId: body.otpId,
          code: body.code,
          qrToken: body.qrToken,
          verifier: {
            userId: session.userId,
            role: session.role,
          },
          traceId,
        })

        if (!attributionResult.ok) {
          // Stash the failure for OUTSIDE-txn escalation (do NOT report inside
          // txn — we want the ExceptionQueue write to survive even if this txn
          // rolls back / is rolled back by the caller's catch path).
          attributionFailure = attributionResult
          return {
            type: 'attribution-failure' as const,
            status: attributionResult.httpStatus,
            body: {
              error: {
                code: 'CONFLICT',
                message: attributionResult.description,
                traceId,
                details: {
                  reason: attributionResult.reason,
                  stateSnapshot: attributionResult.stateSnapshot,
                },
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // SUCCESS — write AuditLog (PICKUP_VERIFIED, 5 attribution fields) +
        // Outbox (FULFILMENT_STATUS_CHANGED with attribution payload)
        // -------------------------------------------------------------------
        // PHASE 5 (P1) — Canonical chained audit (NOT direct tx.auditLog.create).
        // Actor role is ALWAYS session.role (actual verifier role). Metadata
        // includes the 5 attribution fields + forensic context. No secrets.
        await auditWithTx(
          tx,
          'PICKUP_VERIFIED',
          {
            // 5 attribution fields (per P0-07 §6.1 step 8):
            orderId: attributionResult.attribution.orderId,
            collectorIdentity: attributionResult.attribution.collectorIdentity,
            timestamp: attributionResult.attribution.timestamp,
            verificationMethod: attributionResult.attribution.verificationMethod,
            verificationResult: attributionResult.attribution.verificationResult,
            // Additional context for forensic audit (NOT part of the 5-field
            // contract, but useful for downstream analysis):
            collectorRole: attributionResult.attribution.collectorRole,
            fulfilmentId: attributionResult.fulfilmentId,
            newVersion: attributionResult.newVersion,
          },
          session.userId,
          session.role,
        )

        // PHASE 6/7 (P0-2) — Transactional outbox event (durable realtime).
        // V1: Reuse the existing ORDER_STATUS_CHANGED event type (mapped to
        // the `order:updated` Socket.io event by the publisher). The previous
        // FULFILMENT_STATUS_CHANGED type was NOT in the publisher's
        // EVENT_TYPE_TO_SOCKET map — the publisher threw "Unknown event type"
        // and events were stuck/failing. Payload is minimal: no secrets, no
        // attribution (that lives in the audit trail). The client receives
        // `order:updated` and refetches the authoritative order endpoint.
        await enqueueOutboxEvent(tx, {
          eventType: 'ORDER_STATUS_CHANGED',
          aggregateType: 'Fulfilment',
          aggregateId: attributionResult.fulfilmentId,
          payload: {
            orderId: attributionResult.orderId,
            fulfilmentId: attributionResult.fulfilmentId,
            status: 'PICKED_UP',
            version: attributionResult.newVersion,
            updatedAt: attributionResult.attribution.timestamp,
          },
        })

        const responseBody = {
          attribution: attributionResult.attribution,
          fulfilment: {
            id: attributionResult.fulfilmentId,
            orderId: attributionResult.orderId,
            status: 'PICKED_UP',
            version: attributionResult.newVersion,
            pickupVerifiedAt: attributionResult.pickupVerifiedAt,
            pickupVerifiedBy: attributionResult.pickupVerifiedBy,
          },
        }

        // Store idempotency record (so a retry with the same key returns this
        // exact response — preventing duplicate pickup writes).
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            attributionResult.fulfilmentId,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'pickup-verify-idempotency-key-stored',
            {
              key: idempotencyKey,
              fulfilmentId: attributionResult.fulfilmentId,
              requestHashStored: requestHash !== null,
            },
            traceId,
          )
        }

        attributionSuccess = attributionResult
        return { type: 'success' as const, status: 200, body: responseBody }
      })

      // Handle result variants
      if (result.type === 'cached') {
        cachedResponse = { status: result.status, body: result.body }
        return NextResponse.json(result.body, { status: result.status })
      }
      if (result.type === 'error') {
        return NextResponse.json(result.body, { status: result.status })
      }
      if (result.type === 'attribution-failure') {
        // Attribution failed — escalate OUTSIDE txn (attributionFailure is set)
        if (attributionFailure) {
          await reportAttributionFailure(attributionFailure, orderId, traceId)
        }
        // Also write a failure AuditLog (PICKUP_VERIFICATION_FAILED) so the
        // failure is recorded in the immutable audit trail (P0-22).
        if (attributionFailure) {
          try {
            // PHASE 5 (P1) — Canonical chained audit (non-transactional `audit`
            // wraps its own withTransaction + CAS retry). This runs OUTSIDE
            // the main txn so it survives even if the main txn rolled back.
            // Actor role is ALWAYS session.role. No secrets in metadata.
            await audit(
              'PICKUP_VERIFICATION_FAILED',
              {
                orderId,
                reason: attributionFailure.reason,
                httpStatus: attributionFailure.httpStatus,
                description: attributionFailure.description,
                stateSnapshot: attributionFailure.stateSnapshot,
                timestamp: new Date().toISOString(),
              },
              session.userId,
              session.role,
            )
          } catch (auditErr) {
            // Audit failure is non-fatal — the attribution failure has
            // already been escalated via reportAttributionFailure (above).
            logWarn(
              'pickup-verify-failure-audit-write-failed',
              { orderId, reason: attributionFailure.reason, error: (auditErr as Error).message },
              traceId,
            )
          }
        }
        return NextResponse.json(result.body, { status: result.status })
      }

      // Success
      logInfo(
        'pickup-verified',
        {
          orderId,
          fulfilmentId: attributionSuccess?.fulfilmentId,
          verifierUserId: session.userId,
          verifierRole: session.role,
        },
        traceId,
      )
      return NextResponse.json(result.body, { status: result.status })
    } catch (error) {
      // If we hit an attribution failure path that threw (e.g., the txn rolled
      // back), still escalate the failure OUTSIDE the txn.
      if (attributionFailure) {
        try {
          await reportAttributionFailure(attributionFailure, orderId, traceId)
        } catch (reportErr) {
          logWarn(
            'pickup-verify-report-failure-after-throw-failed',
            { orderId, reason: attributionFailure.reason, error: (reportErr as Error).message },
            traceId,
          )
        }
      }

      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'pickup-verify-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        logInfo(
          'pickup-verify-conflict',
          { attempts: error.attempts, code: error.code, orderId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Pickup verification conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    } finally {
      // If we returned a cached response, log the dedup hit (no escalation).
      if (cachedResponse) {
        logInfo(
          'pickup-verify-cached-response-returned',
          { key: idempotencyKey, orderId, status: cachedResponse.status },
          traceId,
        )
      }
    }
  })
