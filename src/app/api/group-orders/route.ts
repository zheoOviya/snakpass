import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import { createGroupOrder } from '@/lib/group-order-service'
import { z } from 'zod'

// ----------------------------------------------------------------------------
// Wave 7 Task 7A — Group orders list + create
// ----------------------------------------------------------------------------
//   GET  /api/group-orders          — list group orders where the current user
//                                    is host OR member (status=OPEN/CANCELLED
//                                    /CONFIRMED). Sorted newest first.
//   POST /api/group-orders          — host creates a new GroupOrder.
//
// Governance (plan §7A):
//   - Auth: getSessionUser() required (401 if no session).
//   - RBAC: POST is CONSUMER-only (vendors/admins don't place consumer orders).
//           GET is open to any authenticated user (returns only their own
//           group orders).
//   - Idempotency-Key: supported on POST (resourceType='GroupOrder'). Same key
//     on retry returns the cached response. shareCode collision (P2002) is
//     retried by withTransaction (a fresh code is generated on each retry).
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'GroupOrder'

// ---------------------------------------------------------------------------
// POST body schema — { restaurantId: string, name?: string }
// ---------------------------------------------------------------------------
// NOTE: We use a NEW schema here (not the existing groupOrderCreateSchema from
// src/lib/validation.ts) because the spec requires an optional `name` field.
// The existing schema only has `restaurantId`. We keep both — Task 7B may
// reconcile them. (Additive only — no existing schema modified.)
// ---------------------------------------------------------------------------
const createGroupOrderBodySchema = z.object({
  restaurantId: z.string().min(1, 'restaurantId required'),
  name: z.string().max(200, 'name too long (max 200 chars)').optional().nullable(),
})

// ---------------------------------------------------------------------------
// GroupOrderListView — the shape returned by GET for each group order row.
// ---------------------------------------------------------------------------
interface GroupOrderListView {
  id: string
  hostId: string
  hostName: string | null
  restaurantId: string
  restaurantName: string | null
  restaurantImageUrl: string | null
  status: string
  shareCode: string
  name: string | null
  closesAt: string
  confirmedAt: string | null
  confirmedOrderId: string | null
  memberCount: number
  myItemCount: number
  totalItems: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// GET /api/group-orders — list group orders where the current user is host
// or member.
// ---------------------------------------------------------------------------
export const GET = () =>
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

    // Load all group orders where the user is host OR a member.
    // Use findMany with OR — restaurant + host joined for display.
    const rows = await db.groupOrder.findMany({
      where: {
        OR: [
          { hostId: session.userId },
          { members: { some: { userId: session.userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        hostId: true,
        restaurantId: true,
        status: true,
        shareCode: true,
        name: true,
        closesAt: true,
        confirmedAt: true,
        confirmedOrderId: true,
        createdAt: true,
        updatedAt: true,
        restaurant: {
          select: { id: true, name: true, image: true },
        },
        members: {
          select: { id: true, userId: true },
        },
        items: {
          select: { id: true, userId: true, quantity: true },
        },
      },
    })

    // Resolve host names in a single batched query (GroupOrder doesn't snapshot them).
    const hostIds = Array.from(new Set(rows.map((r) => r.hostId)))
    const hosts = hostIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: hostIds } },
          select: { id: true, name: true },
        })
      : []
    const hostMap = new Map(hosts.map((u) => [u.id, u.name]))

    const groupOrders: GroupOrderListView[] = rows.map((r) => ({
      id: r.id,
      hostId: r.hostId,
      hostName: hostMap.get(r.hostId) ?? null,
      restaurantId: r.restaurantId,
      restaurantName: r.restaurant?.name ?? null,
      restaurantImageUrl: r.restaurant?.image ?? null,
      status: r.status,
      shareCode: r.shareCode,
      name: r.name,
      closesAt: r.closesAt.toISOString(),
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      confirmedOrderId: r.confirmedOrderId,
      memberCount: r.members.length,
      myItemCount: r.items.filter((i) => i.userId === session.userId).length,
      totalItems: r.items.reduce((s, i) => s + i.quantity, 0),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))

    return NextResponse.json({ groupOrders })
  })

// ---------------------------------------------------------------------------
// POST /api/group-orders — host creates a new GroupOrder.
// ---------------------------------------------------------------------------
// Body: { restaurantId: string, name?: string }
//
// Returns: { groupOrder: { id, hostId, restaurantId, status, shareCode,
//            closesAt, name, createdAt, ... } }
//
// The host is automatically added as the first GroupOrderMember (so the host
// can also add items to the group cart).
// ---------------------------------------------------------------------------
export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
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
    // RBAC — CONSUMER only (vendors + admins have separate identities).
    // -------------------------------------------------------------------------
    if (session.role !== 'CONSUMER') {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only consumers can create group orders',
        403,
        { requiredRoles: ['CONSUMER'], actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Validate body
    // -------------------------------------------------------------------------
    const body = await validateCreateBody(req)
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
              'group-order-create-idempotency-dedup-hit',
              { key: idempotencyKey, userId: session.userId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Delegate to group-order-service.createGroupOrder for the atomic
        // mutation. Throws AppError on validation/business failures
        // (NOT_FOUND, VALIDATION_ERROR).
        // -------------------------------------------------------------------
        const created = await createGroupOrder(tx, {
          hostId: session.userId,
          hostRole: session.role,
          restaurantId: body.restaurantId,
          name: body.name ?? null,
          traceId,
        })

        const responseBody = {
          groupOrder: {
            id: created.groupOrder.id,
            hostId: created.groupOrder.hostId,
            restaurantId: created.groupOrder.restaurantId,
            status: created.groupOrder.status,
            shareCode: created.groupOrder.shareCode,
            name: created.groupOrder.name,
            closesAt: created.groupOrder.closesAt.toISOString(),
            confirmedAt: created.groupOrder.confirmedAt?.toISOString() ?? null,
            confirmedOrderId: created.groupOrder.confirmedOrderId,
            version: created.groupOrder.version,
            createdAt: created.groupOrder.createdAt.toISOString(),
            updatedAt: created.groupOrder.updatedAt.toISOString(),
            shareUrl: `/group/${created.groupOrder.shareCode}`,
          },
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            created.groupOrder.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'group-order-create-idempotency-key-stored',
            {
              key: idempotencyKey,
              groupOrderId: created.groupOrder.id,
              requestHashStored: requestHash !== null,
            },
            traceId,
          )
        }

        return {
          type: 'created' as const,
          status: 200,
          body: responseBody,
          groupOrderId: created.groupOrder.id,
        }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'created': {
          logInfo(
            'group-order-create-success',
            {
              groupOrderId: result.groupOrderId,
              hostId: session.userId,
              restaurantId: body.restaurantId,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          // Exhaustiveness guard
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      // Sub-Wave 3c: IdempotencyKeyReuseError — same key + different body.
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'group-order-create-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // AppError from createGroupOrder (NOT_FOUND, VALIDATION_ERROR) —
      // propagate to withErrorHandler for status mapping.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted (e.g., shareCode P2002
      // collision after all retries — astronomically unlikely).
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-create-conflict',
          {
            attempts: error.attempts,
            code: error.code,
            userId: session.userId,
          },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Group order creation conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// Local validateBody — wraps validateBody but uses our local schema (avoids
// importing a new schema from validation.ts — additive only).
// ---------------------------------------------------------------------------
async function validateCreateBody(
  req: NextRequest,
): Promise<z.infer<typeof createGroupOrderBodySchema>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }
  const result = createGroupOrderBodySchema.safeParse(body)
  if (!result.success) {
    const details: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_'
      details[path] = issue.message
    }
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400, details)
  }
  return result.data
}
