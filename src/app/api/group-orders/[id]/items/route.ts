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
import { z } from 'zod'

// ----------------------------------------------------------------------------
// Wave 7 Task 7A — Group order items (my cart)
// ----------------------------------------------------------------------------
//   GET   /api/group-orders/[id]/items  — list the current user's items in
//                                        this group order.
//   POST  /api/group-orders/[id]/items  — add an item to the current user's
//                                        cart within this group order.
//
// Governance (plan §7A):
//   - Auth: getSessionUser() required (401 if no session).
//   - RBAC: caller must be a member of the group order (403 otherwise).
//   - The menu item is validated server-side: must exist + belong to the
//     group order's restaurant + be available + not soft-deleted. The name
//     + price are snapshot from the DB (the client may send name/price as a
//     backward-compat hint, but the DB lookup is authoritative).
//   - Idempotency-Key: supported on POST (resourceType='GroupOrderItem'). Same
//     key on retry returns the cached response.
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'GroupOrderItem'

// ---------------------------------------------------------------------------
// POST body schema — { menuItemId: string, quantity: number }
// ---------------------------------------------------------------------------
// Per the task spec, the body is { menuItemId, quantity } only. Name + price
// are looked up server-side from the MenuItem (validated against the group
// order's restaurant).
//
// For backward-compat with the existing group-order-store (Wave 1C), we ALSO
// accept optional `name` + `price` fields — they're ignored (the DB lookup is
// authoritative) but their presence doesn't fail validation.
// ---------------------------------------------------------------------------
const addItemBodySchema = z.object({
  menuItemId: z.string().min(1, 'menuItemId required'),
  quantity: z.number().int().positive('quantity must be a positive integer'),
  // Optional backward-compat fields (ignored — DB lookup is authoritative).
  name: z.string().max(200).optional(),
  price: z.number().int().nonnegative().optional(),
})

// ---------------------------------------------------------------------------
// GET /api/group-orders/[id]/items — current user's items in the group order.
// ---------------------------------------------------------------------------
export const GET = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: groupOrderId } = await params

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
    // Load + validate the group order + verify the user is a member.
    // -------------------------------------------------------------------------
    const groupOrder = await db.groupOrder.findUnique({
      where: { id: groupOrderId },
      select: {
        id: true,
        status: true,
        hostId: true,
        restaurantId: true,
        members: { select: { userId: true } },
      },
    })

    if (!groupOrder) {
      throw new AppError('NOT_FOUND', `Group order ${groupOrderId} not found`, 404, {
        groupOrderId,
      })
    }

    const isMember = groupOrder.members.some((m) => m.userId === session.userId)
    if (!isMember) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'You must join this group order before adding items',
        403,
        { groupOrderId, userId: session.userId },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Load the user's items in this group order.
    // -------------------------------------------------------------------------
    const items = await db.groupOrderItem.findMany({
      where: { groupOrderId, userId: session.userId },
      orderBy: { addedAt: 'asc' },
      select: {
        id: true,
        groupOrderId: true,
        userId: true,
        menuItemId: true,
        name: true,
        price: true,
        quantity: true,
        addedAt: true,
        updatedAt: true,
      },
    })

    const itemsView = items.map((i) => ({
      id: i.id,
      groupOrderId: i.groupOrderId,
      userId: i.userId,
      menuItemId: i.menuItemId,
      name: i.name,
      pricePaise: i.price,
      quantity: i.quantity,
      subtotalPaise: i.price * i.quantity,
      addedAt: i.addedAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    }))

    const subtotalPaise = itemsView.reduce((s, i) => s + i.subtotalPaise, 0)
    const totalQuantity = itemsView.reduce((s, i) => s + i.quantity, 0)

    return NextResponse.json({
      items: itemsView,
      totals: {
        itemCount: itemsView.length,
        totalQuantity,
        subtotalPaise,
      },
    })
  })

// ---------------------------------------------------------------------------
// POST /api/group-orders/[id]/items — add an item to the user's cart.
// ---------------------------------------------------------------------------
// Body: { menuItemId: string, quantity: number }
//
// Returns: { item: { id, groupOrderId, userId, menuItemId, name, pricePaise,
//            quantity, subtotalPaise, addedAt, updatedAt } }
//
// The menu item is looked up server-side — name + price are snapshot from the
// DB (NOT trusted from the client). The menu item must:
//   - Exist + not soft-deleted
//   - Belong to the group order's restaurant
//   - Be available
// If the user already has an item with the same menuItemId in this group
// order, the quantity is INCREMENTED (cart-merge semantics — matches the
// client store's optimistic update pattern). This is done atomically inside
// the same transaction.
// ---------------------------------------------------------------------------
export const POST = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: groupOrderId } = await params

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
    // Validate body
    // -------------------------------------------------------------------------
    const body = await validateAddItemBody(req)
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
              'group-order-item-add-idempotency-dedup-hit',
              { key: idempotencyKey, userId: session.userId, groupOrderId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Load + validate the group order.
        // -------------------------------------------------------------------
        const groupOrder = await tx.groupOrder.findUnique({
          where: { id: groupOrderId },
          select: {
            id: true,
            status: true,
            hostId: true,
            restaurantId: true,
            closesAt: true,
            members: { select: { userId: true } },
          },
        })
        if (!groupOrder) {
          throw new AppError(
            'NOT_FOUND',
            `Group order ${groupOrderId} not found`,
            404,
            { groupOrderId },
          )
        }

        // Member-only check.
        const isMember = groupOrder.members.some((m) => m.userId === session.userId)
        if (!isMember) {
          throw new AppError(
            'AUTHORIZATION_DENIED',
            'You must join this group order before adding items',
            403,
            { groupOrderId, userId: session.userId },
          )
        }

        // Group order must be OPEN (can't add items to CONFIRMED/CANCELLED).
        if (groupOrder.status !== 'OPEN') {
          throw new AppError(
            'CONFLICT',
            `Cannot add items to a ${groupOrder.status} group order`,
            409,
            { groupOrderId, status: groupOrder.status },
          )
        }

        // -------------------------------------------------------------------
        // Validate menu item: exists + belongs to the group order's
        // restaurant + is available + not soft-deleted. Name + price are
        // snapshot from the DB (NOT trusted from the client).
        // -------------------------------------------------------------------
        const menuItem = await tx.menuItem.findUnique({
          where: { id: body.menuItemId },
          select: {
            id: true,
            restaurantId: true,
            name: true,
            price: true,
            isAvailable: true,
            deletedAt: true,
          },
        })
        if (!menuItem || menuItem.deletedAt !== null) {
          throw new AppError(
            'NOT_FOUND',
            `Menu item ${body.menuItemId} not found`,
            404,
            { menuItemId: body.menuItemId },
          )
        }
        if (menuItem.restaurantId !== groupOrder.restaurantId) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Menu item does not belong to this group order\'s restaurant',
            400,
            {
              menuItemId: body.menuItemId,
              menuItemRestaurantId: menuItem.restaurantId,
              groupOrderRestaurantId: groupOrder.restaurantId,
            },
          )
        }
        if (!menuItem.isAvailable) {
          throw new AppError(
            'VALIDATION_ERROR',
            `${menuItem.name} is no longer available`,
            400,
            { menuItemId: body.menuItemId, isAvailable: menuItem.isAvailable },
          )
        }

        // -------------------------------------------------------------------
        // Cart-merge semantics — if the user already has an item with the
        // same menuItemId in this group order, INCREMENT the quantity.
        // Otherwise, create a new GroupOrderItem.
        // -------------------------------------------------------------------
        const existing = await tx.groupOrderItem.findFirst({
          where: {
            groupOrderId,
            userId: session.userId,
            menuItemId: body.menuItemId,
          },
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true,
            addedAt: true,
            updatedAt: true,
          },
        })

        let itemRow: {
          id: string
          groupOrderId: string
          userId: string
          menuItemId: string
          name: string
          price: number
          quantity: number
          addedAt: Date
          updatedAt: Date
        }

        if (existing) {
          // Merge — increment quantity (preserve the snapshot name/price from
          // the existing row; the menu item snapshot was captured at first add).
          const updated = await tx.groupOrderItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + body.quantity },
            select: {
              id: true,
              groupOrderId: true,
              userId: true,
              menuItemId: true,
              name: true,
              price: true,
              quantity: true,
              addedAt: true,
              updatedAt: true,
            },
          })
          itemRow = updated
        } else {
          // Create new — snapshot name + price from the DB.
          const created = await tx.groupOrderItem.create({
            data: {
              groupOrderId,
              userId: session.userId,
              menuItemId: body.menuItemId,
              name: menuItem.name,
              price: menuItem.price,
              quantity: body.quantity,
            },
            select: {
              id: true,
              groupOrderId: true,
              userId: true,
              menuItemId: true,
              name: true,
              price: true,
              quantity: true,
              addedAt: true,
              updatedAt: true,
            },
          })
          itemRow = created
        }

        // -------------------------------------------------------------------
        // AuditLog GROUP_ORDER_ITEM_ADDED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'GROUP_ORDER_ITEM_ADDED',
            metadata: JSON.stringify({
              groupOrderId,
              groupOrderItemId: itemRow.id,
              userId: session.userId,
              menuItemId: body.menuItemId,
              menuItemName: menuItem.name,
              menuItemPrice: menuItem.price,
              quantity: body.quantity,
              merged: existing !== null,
              newTotalQuantity: itemRow.quantity,
            }),
          },
        })

        const responseBody = {
          item: {
            id: itemRow.id,
            groupOrderId: itemRow.groupOrderId,
            userId: itemRow.userId,
            menuItemId: itemRow.menuItemId,
            name: itemRow.name,
            pricePaise: itemRow.price,
            quantity: itemRow.quantity,
            subtotalPaise: itemRow.price * itemRow.quantity,
            addedAt: itemRow.addedAt.toISOString(),
            updatedAt: itemRow.updatedAt.toISOString(),
            merged: existing !== null,
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
            itemRow.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'group-order-item-add-idempotency-key-stored',
            {
              key: idempotencyKey,
              groupOrderItemId: itemRow.id,
              requestHashStored: requestHash !== null,
            },
            traceId,
          )
        }

        return {
          type: 'created' as const,
          status: 200,
          body: responseBody,
          itemId: itemRow.id,
          merged: existing !== null,
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
            'group-order-item-add-success',
            {
              groupOrderId,
              groupOrderItemId: result.itemId,
              userId: session.userId,
              merged: result.merged,
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
          'group-order-item-add-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // AppError (NOT_FOUND, AUTHORIZATION_DENIED, VALIDATION_ERROR, CONFLICT) — propagate.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-item-add-conflict',
          {
            attempts: error.attempts,
            code: error.code,
            userId: session.userId,
            groupOrderId,
          },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Item add conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// Local validateBody — wraps validateBody but uses our local schema.
// ---------------------------------------------------------------------------
async function validateAddItemBody(
  req: NextRequest,
): Promise<z.infer<typeof addItemBodySchema>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }
  const result = addItemBodySchema.safeParse(body)
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
