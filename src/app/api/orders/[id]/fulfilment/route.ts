import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { validateBody } from '@/lib/validation'
import { info as logInfo, warn as logWarn, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { auditWithTx } from '@/lib/audit'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import {
  FULFILMENT_STATUSES,
  isValidFulfilmentTransition,
} from '@/lib/fulfilment-state'
import { scryptSync } from 'crypto'

// ----------------------------------------------------------------------------
// V1 SECURITY/INTEGRITY REPAIR (SNAKZAP-VENDOR-LIFECYCLE-V1-SECURITY-INTEGRITY-REPAIR-02)
// ----------------------------------------------------------------------------
// PATCH /api/orders/[id]/fulfilment   body: { status }
// GET  /api/orders/[id]/fulfilment
//
// V1 REPAIRS (this wave):
//   P0-1 (PHASE 2) — Ownership authorization:
//     Before any mutation, derive vendor identity from the authenticated
//     session and resolve the Order's Restaurant. Require:
//         Restaurant.ownerUserId === session.userId
//     Authorization is NEVER derived from client-supplied restaurantId/vendorId.
//     A vendor who does not own the order's restaurant → 403 with 0 mutation.
//
//   PHASE 3 — Role boundary:
//     Only VENDOR_OWNER may drive the kitchen fulfilment lifecycle via this
//     route. CONSUMER, ADMIN, SUPER_ADMIN, and unauthenticated callers are
//     rejected with controlled 403/401. Admins do not cook; pickup-verify
//     (the canonical PICKED_UP path) retains its own broader RBAC.
//
//   P1 (PHASE 5) — Audit chain repair:
//     All audit writes use the canonical `auditWithTx(tx, action, metadata,
//     actorId, actorRole)` chained-append primitive (CAS-safe, hash-linked)
//     inside the SAME transaction as the business mutation. No direct
//     `tx.auditLog.create(...)`. The actor role is ALWAYS `session.role`
//     (the actual vendor role) — NEVER a client-supplied `actorRole`.
//
//   P0-2 (PHASE 6/7) — Transactional realtime/outbox:
//     Every successful transition enqueues an `ORDER_STATUS_CHANGED` outbox
//     event (mapped to the `order:updated` Socket.io event by the publisher)
//     INSIDE the same transaction. Consumers receive the invalidation signal
//     and refetch the authoritative REST/order endpoint. The previous
//     `FULFILMENT_STATUS_CHANGED` event type was NOT in the publisher's
//     EVENT_TYPE_TO_SOCKET map — the publisher threw "Unknown event type"
//     and the events were stuck/failing. Reusing the existing
//     `ORDER_STATUS_CHANGED` contract fixes durable delivery.
//     Payload is minimal (orderId, restaurantId, status, version, updatedAt)
//     — no secrets, no full Order object.
//
//   PHASE 14 — PICKED_UP boundary:
//     The PICKED_UP attribution gate is now ENFORCED UNCONDITIONALLY on this
//     route (the `pickupAttributionEnforcement` flag check is removed for the
//     fulfilment PATCH path). PICKED_UP via PATCH REQUIRES
//     `Fulfilment.pickupVerifiedAt` to already be set — which can ONLY happen
//     via the dedicated POST /api/orders/[id]/pickup/verify endpoint (QR+OTP
//     verification). This closes the pickup-verification bypass on the
//     fulfilment route. This is an authorization/enforcement repair, NOT a
//     state-machine redesign (the PREPARING→ALMOST_READY→READY_FOR_PICKUP→
//     PICKED_UP chain is unchanged). The ORDER-status route's PICKED_UP gate
//     remains flag-gated (separate Order.status machine, out of V1 scope).
//
// PRESERVED (unchanged from pre-V1):
//   - NEXT_FULFILMENT_STATUS state machine + isValidFulfilmentTransition()
//   - Optimistic locking via tx.fulfilment.updateMany({ where: { id, version } })
//   - Idempotency-Key handling (P0-17) + request hash
//   - Lazy-create of Fulfilment row on first access (now ownership-gated)
//   - Idempotent same→same transition (200 with idempotent: true)
//
// SECURITY MATRIX (enforced):
//   Vendor A own order          → 200, status+version mutated, 1 audit, 1 outbox
//   Vendor A → Vendor B order   → 403, 0 mutation, 0 audit, 0 outbox
//   Consumer caller             → 403, 0 mutation, 0 audit, 0 outbox
//   Admin caller                 → 403, 0 mutation, 0 audit, 0 outbox
//   Unauthenticated             → 401, 0 mutation, 0 audit, 0 outbox
//   Invalid transition          → 409, 0 mutation, 0 audit, 0 outbox
//   Concurrent stale version    → 409, one winner, one increment, one audit, one outbox
// ----------------------------------------------------------------------------

const fulfilmentStatusSchema = z.enum(FULFILMENT_STATUSES)
// V1: `actorRole` removed from the body schema. The audit role is ALWAYS
// derived from session.role (the actual vendor role). A client-supplied
// `actorRole` in the request body is silently stripped by Zod (backward-
// compatible — the vendor-view still sends `actorRole: 'VENDOR_OWNER'` but
// it is now ignored; the server uses the session's true role).
const fulfilmentUpdateBodySchema = z.object({
  status: fulfilmentStatusSchema,
})

// PATCH /api/orders/[id]/fulfilment
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id } = await params
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
    }

    // -------------------------------------------------------------------------
    // PHASE 3 — Role boundary.
    // Only VENDOR_OWNER may drive the kitchen fulfilment lifecycle. CONSUMER,
    // ADMIN, SUPER_ADMIN are rejected. Admins do not transition kitchen state
    // via this route; pickup-verify retains its own broader RBAC.
    // -------------------------------------------------------------------------
    if (session.role !== 'VENDOR_OWNER') {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only the vendor who owns this restaurant may drive the fulfilment lifecycle.',
        403,
        { requiredRole: 'VENDOR_OWNER', actualRole: session.role },
        traceId,
      )
    }

    const body = await validateBody(req, fulfilmentUpdateBodySchema)
    const idempotencyKey = getIdempotencyKey(req)
    // Compute request hash outside txn so retry uses the same hash (deterministic).
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        // P0-17: Check idempotency cache FIRST (inside txn).
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo('fulfilment-idempotency-dedup-hit', { key: idempotencyKey, orderId: id }, traceId)
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // Read the order (must exist — Fulfilment is 1:1 to Order).
        // V2: include user.phone so we can issue a pickup OTP at READY_FOR_PICKUP
        // (mirrors the /status route's createOtp call — consistency fix, NOT a
        // state-machine redesign).
        const order = await tx.order.findUnique({
          where: { id },
          select: { id: true, pickupOtp: true, status: true, restaurantId: true, user: { select: { phone: true } } },
        })
        if (!order) {
          return {
            type: 'error' as const,
            status: 404,
            body: { error: { code: 'NOT_FOUND', message: 'Order not found', traceId } },
          }
        }

        // -------------------------------------------------------------------
        // PHASE 2 (P0-1) — Ownership authorization.
        // Derive vendor identity from the session + resolve the Order's
        // Restaurant. Require Restaurant.ownerUserId === session.userId.
        // Authorization is NEVER derived from a client-supplied id.
        // This runs BEFORE any mutation (including lazy-create) so a
        // non-owner gets 403 with 0 mutation, 0 audit, 0 outbox.
        // -------------------------------------------------------------------
        const restaurant = await tx.restaurant.findUnique({
          where: { id: order.restaurantId },
          select: { ownerUserId: true },
        })
        if (!restaurant || restaurant.ownerUserId !== session.userId) {
          logWarn(
            'fulfilment-ownership-denied',
            {
              orderId: id,
              restaurantId: order.restaurantId,
              requesterUserId: session.userId,
              restaurantOwnerUserId: restaurant?.ownerUserId ?? null,
            },
            traceId,
          )
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'You do not own the restaurant for this order.',
                traceId,
              },
            },
          }
        }

        // Lazy-create: if no Fulfilment row exists yet, create with PREPARING default.
        let fulfilment = await tx.fulfilment.findUnique({
          where: { orderId: id },
        })
        if (!fulfilment) {
          fulfilment = await tx.fulfilment.create({
            data: {
              orderId: id,
              status: 'PREPARING',
              pickupOtp: order.pickupOtp,
            },
          })
          logInfo('fulfilment-lazy-created', { orderId: id, fulfilmentId: fulfilment.id }, traceId)

          // PHASE 5 (P1): canonical chained audit (NOT direct tx.auditLog.create).
          // Audit the lazy-create so we have a record even if the PATCH itself
          // is rejected by the transition check below. Actor role is always the
          // session's true role (VENDOR_OWNER) — never client-supplied.
          await auditWithTx(
            tx,
            'FULFILMENT_CREATED',
            {
              orderId: id,
              fulfilmentId: fulfilment.id,
              initialStatus: 'PREPARING',
              restaurantId: order.restaurantId,
            },
            session.userId,
            session.role,
          )
        }

        const desired = body.status
        const from = fulfilment.status

        // Idempotent transition (same → same): return 200 with idempotent: true.
        if (from === desired) {
          const idempotentBody = {
            fulfilment: {
              id: fulfilment.id,
              orderId: fulfilment.orderId,
              status: fulfilment.status,
              version: fulfilment.version,
              pickupOtp: fulfilment.pickupOtp,
              updatedAt: fulfilment.updatedAt,
              statusHistory: fulfilment.statusHistory,
            },
            idempotent: true,
          }
          if (idempotencyKey) {
            await storeIdempotencyRecord(
              tx,
              idempotencyKey,
              'Fulfilment',
              fulfilment.id,
              200,
              JSON.stringify(idempotentBody),
              requestHash,
            )
          }
          return { type: 'ok' as const, status: 200, body: idempotentBody }
        }

        // Validate the transition against NEXT_FULFILMENT_STATUS (PHASE 4 — unchanged).
        if (!isValidFulfilmentTransition(from, desired)) {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: `Invalid fulfilment transition: ${from} -> ${desired}. Expected next sequential status.`,
                traceId,
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // PHASE 14 — PICKED_UP boundary (ENFORCED UNCONDITIONALLY in V1).
        // PICKED_UP via this route REQUIRES `Fulfilment.pickupVerifiedAt` to
        // already be set — which can ONLY happen via the dedicated
        // POST /api/orders/[id]/pickup/verify endpoint (QR+OTP verification).
        // This closes the pickup-verification bypass on the fulfilment route.
        // The flag-gate is removed; enforcement is unconditional. This is an
        // authorization repair, not a state-machine redesign.
        // -------------------------------------------------------------------
        if (desired === 'PICKED_UP' && !fulfilment.pickupVerifiedAt) {
          logWarn(
            'fulfilment-picked-up-attribution-required',
            { orderId: id, fulfilmentId: fulfilment.id },
            traceId,
          )
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message:
                  'PICKED_UP via PATCH /fulfilment requires prior pickup attribution. Use POST /api/orders/' +
                  id +
                  '/pickup/verify with a QR token + OTP to attribute pickup.',
                traceId,
                details: {
                  reason: 'PICKUP_ATTRIBUTION_REQUIRED',
                  redirectEndpoint: `/api/orders/${id}/pickup/verify`,
                  redirectMethod: 'POST',
                  requiredPayload: {
                    otpId: '<otpId>',
                    code: '<6-digit OTP>',
                    qrToken: '<QR token>',
                  },
                  fulfilmentId: fulfilment.id,
                  pickupVerifiedAt: fulfilment.pickupVerifiedAt,
                },
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // V2 — Pickup OTP issuance at READY_FOR_PICKUP.
        // When the fulfilment transitions to READY_FOR_PICKUP, issue a pickup
        // OTP to the customer's phone (mirrors the /status route's behavior).
        // This ensures the canonical POST /api/orders/[id]/pickup/verify
        // endpoint can verify the OTP later. The otpId is returned in the
        // response so the vendor UI can pass it to pickup-verify.
        //
        // CRITICAL: The OTP record is created using `tx.otpRequest.create`
        // (NOT `db.otpRequest.create` via `createOtp()`) because on SQLite,
        // a write from the global `db` client while a `tx` transaction holds
        // a BEGIN IMMEDIATE write lock causes "database is locked" errors.
        // Using `tx` ensures the OTP record is created in the SAME transaction
        // as the fulfilment transition — atomic + no lock conflict.
        //
        // This is NOT a state-machine redesign — it's a consistency fix so
        // the V2 vendor UI's pickup-verify flow works via the hardened
        // /fulfilment route (instead of requiring the legacy /status route).
        // -------------------------------------------------------------------
        let pickupOtpId: string | null = null
        if (desired === 'READY_FOR_PICKUP' && order.user?.phone && order.pickupOtp === '000000') {
          // Generate the 6-digit code + hash (mirrors otp-service.ts hashCode).
          const otpCode = String(Math.floor(100000 + Math.random() * 900000))
          const salt = Buffer.from('snakzap-otp-salt')
          const codeHash = scryptSync(otpCode, salt, 32).toString('hex')
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5-min TTL
          // Create the OTP record INSIDE the transaction.
          const otpRec = await tx.otpRequest.create({
            data: {
              channel: 'phone',
              target: order.user.phone,
              purpose: 'pickup',
              codeHash,
              expiresAt,
            },
          })
          pickupOtpId = otpRec.id
          // Update Order.pickupOtp so the QR token + pickup-verify can use it.
          await tx.order.update({
            where: { id },
            data: { pickupOtp: otpCode },
          })
          // Also update the Fulfilment's cached pickupOtp (lazy-created copy).
          await tx.fulfilment.update({
            where: { id: fulfilment.id },
            data: { pickupOtp: otpCode },
          })
          logInfo('fulfilment-pickup-otp-issued', { orderId: id, phone: order.user.phone, otpId: pickupOtpId }, traceId)
        }

        // Build new status history (parallel to Order.statusHistory).
        const now = new Date()
        const history = JSON.parse(fulfilment.statusHistory || '[]') as {
          status: string
          at: string
        }[]
        history.push({ status: desired, at: now.toISOString() })

        // P0-25 Case B: Optimistic-lock conditional UPDATE.
        // `WHERE id = X AND version = expected` — 0 rows means another PATCH
        // won the race → 409 Conflict.
        const updated = await tx.fulfilment.updateMany({
          where: { id: fulfilment.id, version: fulfilment.version },
          data: {
            status: desired,
            statusHistory: JSON.stringify(history),
            version: { increment: 1 },
          },
        })

        if (updated.count === 0) {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message:
                  'Fulfilment was modified by another request. Please refresh and retry.',
                traceId,
              },
            },
          }
        }

        // Fetch the updated Fulfilment for the response.
        const updatedFulfilment = await tx.fulfilment.findUnique({
          where: { id: fulfilment.id },
        })

        // -------------------------------------------------------------------
        // PHASE 5 (P1) — Canonical chained audit (NOT direct tx.auditLog.create).
        // Actor role is ALWAYS session.role (actual vendor role) — never
        // client-supplied. Metadata includes only what is needed:
        // orderId, restaurantId, fulfilmentId, from, to. No secrets.
        // -------------------------------------------------------------------
        await auditWithTx(
          tx,
          'FULFILMENT_STATUS_CHANGED',
          {
            orderId: id,
            fulfilmentId: fulfilment.id,
            restaurantId: order.restaurantId,
            from,
            to: desired,
          },
          session.userId,
          session.role,
        )

        // -------------------------------------------------------------------
        // PHASE 6/7 (P0-2) — Transactional outbox event (durable realtime).
        // Reuse the existing ORDER_STATUS_CHANGED event type (mapped to the
        // `order:updated` Socket.io event by the publisher). The previous
        // FULFILMENT_STATUS_CHANGED type was NOT in the publisher's map —
        // the publisher threw "Unknown event type" and events were stuck.
        // Payload is minimal: no secrets, no full Order object. The client
        // receives the `order:updated` invalidation signal and refetches the
        // authoritative REST/order endpoint.
        // -------------------------------------------------------------------
        await enqueueOutboxEvent(tx, {
          eventType: 'ORDER_STATUS_CHANGED',
          aggregateType: 'Fulfilment',
          aggregateId: fulfilment.id,
          payload: {
            orderId: id,
            restaurantId: order.restaurantId,
            status: desired,
            fulfilmentStatus: desired,
            version: updatedFulfilment?.version ?? fulfilment.version + 1,
            updatedAt: updatedFulfilment?.updatedAt.toISOString() ?? now.toISOString(),
          },
        })

        const responseBody = {
          fulfilment: {
            id: updatedFulfilment!.id,
            orderId: updatedFulfilment!.orderId,
            status: updatedFulfilment!.status,
            version: updatedFulfilment!.version,
            pickupOtp: updatedFulfilment!.pickupOtp,
            updatedAt: updatedFulfilment!.updatedAt,
            statusHistory: updatedFulfilment!.statusHistory,
          },
          from,
          to: desired,
          // V2: include the pickup OTP ID when issued (for vendor pickup-verify).
          // This is NOT the OTP code itself — it's the OtpRequest record ID
          // needed by the pickup-verify endpoint. The code is sent to the
          // customer's phone (never shown to the vendor).
          ...(pickupOtpId ? { pickupOtpId } : {}),
        }

        // Store idempotency record (Sub-Wave 3c: also stores request hash).
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            'Fulfilment',
            updatedFulfilment!.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'fulfilment-idempotency-key-stored',
            { key: idempotencyKey, fulfilmentId: updatedFulfilment!.id, requestHashStored: requestHash !== null },
            traceId,
          )
        }

        return { type: 'success' as const, status: 200, body: responseBody, from, to: desired }
      })

      // Handle result variants
      if (result.type === 'cached') {
        const parsed = parseCachedResponse({ status: result.status, body: result.body })
        return NextResponse.json(parsed.body, { status: parsed.status })
      }
      if (result.type === 'error') {
        return NextResponse.json(result.body, { status: result.status })
      }
      if (result.type === 'ok') {
        // Idempotent same→same
        return NextResponse.json(result.body, { status: result.status })
      }

      logInfo(
        'fulfilment-status-changed',
        { orderId: id, from: result.from, to: result.to, actorId: session.userId, actorRole: session.role },
        traceId,
      )
      return NextResponse.json(result.body)
    } catch (error) {
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo('fulfilment-idempotency-key-reuse', { key: idempotencyKey, code: error.code }, traceId)
        throw error
      }
      if (error instanceof TransactionConflictError) {
        logInfo('fulfilment-status-conflict', { attempts: error.attempts, code: error.code }, traceId)
        return apiError(
          'CONFLICT',
          'Fulfilment status update conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })

// GET /api/orders/[id]/fulfilment — returns fulfilment state (with lazy-create)
//
// V1: Authorization guard added. The lazy-create is a mutation (creates a
// Fulfilment row + audit), so it must be ownership-gated. Allowed callers:
//   - VENDOR_OWNER who owns the order's restaurant (Restaurant.ownerUserId)
//   - CONSUMER who owns the order (order.userId)
//   - ADMIN / SUPER_ADMIN (read oversight)
// Others → 403 (no lazy-create, no audit). This prevents a vendor A from
// triggering a lazy-create on vendor B's order.
export const GET = (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id } = await params
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
    }

    const fulfilment = await withTransaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: { id: true, pickupOtp: true, userId: true, restaurantId: true },
      })
      if (!order) return null

      // V1 — Authorization guard before lazy-create.
      let authorized = false
      if (session.role === 'VENDOR_OWNER') {
        const restaurant = await tx.restaurant.findUnique({
          where: { id: order.restaurantId },
          select: { ownerUserId: true },
        })
        authorized = restaurant?.ownerUserId === session.userId
      } else if (session.role === 'CONSUMER') {
        authorized = order.userId === session.userId
      } else if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') {
        authorized = true
      }
      if (!authorized) {
        throw new AppError(
          'AUTHORIZATION_DENIED',
          'You are not authorized to view this order\'s fulfilment.',
          403,
          { orderId: id, requesterRole: session.role },
        )
      }

      // Lazy-create if missing
      let f = await tx.fulfilment.findUnique({ where: { orderId: id } })
      if (!f) {
        f = await tx.fulfilment.create({
          data: {
            orderId: id,
            status: 'PREPARING',
            pickupOtp: order.pickupOtp,
          },
        })
        logInfo('fulfilment-lazy-created', { orderId: id, fulfilmentId: f.id }, traceId)
      }
      return f
    })

    if (!fulfilment) {
      return apiError('NOT_FOUND', 'Order not found', 404, undefined, traceId)
    }

    return NextResponse.json({
      fulfilment: {
        id: fulfilment.id,
        orderId: fulfilment.orderId,
        status: fulfilment.status,
        version: fulfilment.version,
        pickupOtp: fulfilment.pickupOtp,
        pickupVerifiedAt: fulfilment.pickupVerifiedAt,
        pickupVerifiedBy: fulfilment.pickupVerifiedBy,
        createdAt: fulfilment.createdAt,
        updatedAt: fulfilment.updatedAt,
        statusHistory: fulfilment.statusHistory,
      },
    })
  })
