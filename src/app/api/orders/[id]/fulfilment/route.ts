import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { validateBody } from '@/lib/validation'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'
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

// ----------------------------------------------------------------------------
// P0-06 Wave-6 — Fulfilment route (parallel state machine — additive-only)
// ----------------------------------------------------------------------------
// PATCH /api/orders/[id]/fulfilment   body: { status, actorRole? }
// GET  /api/orders/[id]/fulfilment
//
// Mirrors src/app/api/orders/[id]/status/route.ts (withTransaction, optimistic
// locking, audit, outbox) but operates on the parallel Fulfilment model —
// NOT on Order.status. Order.status (NEXT_STATUS) is untouched.
//
// Lazy-create: if no Fulfilment row exists for the Order, one is created with
// status='PREPARING' + pickupOtp copied from Order.pickupOtp (P0-07 future use).
//
// P0-07 (pickup attribution) is INACTIVE in this wave:
//   - No QR+OTP verification is performed on the PICKED_UP transition.
//   - No RBAC on the PICKED_UP actor (any authenticated user can transition).
// Activation is a separate Orchestrator directive.
//
// Optimistic locking: PATCH uses `tx.fulfilment.updateMany({ where: { id, version } })`
// — 0 rows updated means another PATCH won the race → 409 Conflict (P0-25 Case B).
//
// Idempotency (P0-17): Idempotency-Key header is honored — same key on retry
// returns the cached response. resourceType='Fulfilment'.
// ----------------------------------------------------------------------------

const fulfilmentStatusSchema = z.enum(FULFILMENT_STATUSES)
const fulfilmentUpdateBodySchema = z.object({
  status: fulfilmentStatusSchema,
  actorRole: z.string().optional(),
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
        const order = await tx.order.findUnique({
          where: { id },
          select: { id: true, pickupOtp: true, status: true, restaurantId: true },
        })
        if (!order) {
          return {
            type: 'error' as const,
            status: 404,
            body: { error: { code: 'NOT_FOUND', message: 'Order not found', traceId } },
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

          // Audit the lazy-create (so we have a record even if the PATCH itself
          // is rejected by the transition check below).
          await tx.auditLog.create({
            data: {
              actorId: session.userId,
              actorRole: session.role,
              action: 'FULFILMENT_CREATED',
              metadata: JSON.stringify({
                orderId: id,
                fulfilmentId: fulfilment.id,
                initialStatus: 'PREPARING',
              }),
            },
          })
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

        // Validate the transition against NEXT_FULFILMENT_STATUS.
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

        // AuditLog: FULFILMENT_STATUS_CHANGED (additive action type — does NOT
        // affect existing audit routing).
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: body.actorRole ?? session.role,
            action: 'FULFILMENT_STATUS_CHANGED',
            metadata: JSON.stringify({
              orderId: id,
              fulfilmentId: fulfilment.id,
              from,
              to: desired,
            }),
          },
        })

        // Outbox: FULFILMENT_STATUS_CHANGED event (additive event type — does
        // NOT affect existing routing in outbox.ts — no socket-event mapping
        // added for this type; consumers can subscribe if/when needed).
        await enqueueOutboxEvent(tx, {
          eventType: 'FULFILMENT_STATUS_CHANGED',
          aggregateType: 'Fulfilment',
          aggregateId: fulfilment.id,
          payload: {
            orderId: id,
            fulfilmentId: fulfilment.id,
            from,
            to: desired,
            restaurantId: order.restaurantId,
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
        { orderId: id, from: result.from, to: result.to },
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
        select: { id: true, pickupOtp: true },
      })
      if (!order) return null

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
