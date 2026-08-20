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
// Wave 7 Task 7A — Single item update / remove
// ----------------------------------------------------------------------------
//   PATCH   /api/group-orders/[id]/items/[itemId]  — update the item's
//                                                    quantity (owner only).
//   DELETE  /api/group-orders/[id]/items/[itemId]  — remove the item from
//                                                    the user's cart (owner only).
//
// Governance (plan §7A):
//   - Auth: getSessionUser() required (401 if no session).
//   - Authorization: the item's owner (item.userId === session.userId) is the
//     only one who can modify or remove it. 403 otherwise. ADMIN/SUPER_ADMIN
//     bypass for incident response.
//   - Idempotency-Key: supported on PATCH (resourceType='GroupOrderItemUpdate').
//     DELETE is naturally idempotent (deleting a non-existent row is a no-op).
// ----------------------------------------------------------------------------

const PATCH_IDEMPOTENCY_RESOURCE_TYPE = 'GroupOrderItemUpdate'

// ---------------------------------------------------------------------------
// PATCH body schema — { quantity: number }
// ---------------------------------------------------------------------------
const updateItemBodySchema = z.object({
  quantity: z.number().int().positive('quantity must be a positive integer'),
})

// ---------------------------------------------------------------------------
// PATCH /api/group-orders/[id]/items/[itemId] — update the item's quantity.
// ---------------------------------------------------------------------------
// Body: { quantity: number }
//
// Returns: { item: { id, ..., quantity, subtotalPaise, updatedAt } }
//
// The user can set quantity to any positive integer (>=1). Setting quantity=0
// is rejected (use DELETE instead). The price snapshot is preserved (NOT
// refreshed from the menu item — the snapshot was captured at add time).
// ---------------------------------------------------------------------------
export const PATCH = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: groupOrderId, itemId } = await params

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
    const body = await validateUpdateItemBody(req)
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
              'group-order-item-update-idempotency-dedup-hit',
              { key: idempotencyKey, userId: session.userId, itemId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Load + validate the item (must exist in this group order).
        // -------------------------------------------------------------------
        const item = await tx.groupOrderItem.findUnique({
          where: { id: itemId },
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

        if (!item || item.groupOrderId !== groupOrderId) {
          throw new AppError(
            'NOT_FOUND',
            `Item ${itemId} not found in group order ${groupOrderId}`,
            404,
            { groupOrderId, itemId },
          )
        }

        // -------------------------------------------------------------------
        // Authorization — owner only (ADMIN/SUPER_ADMIN bypass).
        // -------------------------------------------------------------------
        const isOwner = item.userId === session.userId
        const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
        if (!isOwner && !isAdmin) {
          throw new AppError(
            'AUTHORIZATION_DENIED',
            'You can only modify your own items',
            403,
            { groupOrderId, itemId, itemUserId: item.userId, callerId: session.userId },
          )
        }

        // -------------------------------------------------------------------
        // Update the quantity (preserve the price snapshot).
        // -------------------------------------------------------------------
        const updated = await tx.groupOrderItem.update({
          where: { id: itemId },
          data: { quantity: body.quantity },
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

        // -------------------------------------------------------------------
        // AuditLog GROUP_ORDER_ITEM_UPDATED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'GROUP_ORDER_ITEM_UPDATED',
            metadata: JSON.stringify({
              groupOrderId,
              groupOrderItemId: itemId,
              userId: session.userId,
              menuItemId: item.menuItemId,
              previousQuantity: item.quantity,
              newQuantity: body.quantity,
            }),
          },
        })

        const responseBody = {
          item: {
            id: updated.id,
            groupOrderId: updated.groupOrderId,
            userId: updated.userId,
            menuItemId: updated.menuItemId,
            name: updated.name,
            pricePaise: updated.price,
            quantity: updated.quantity,
            subtotalPaise: updated.price * updated.quantity,
            addedAt: updated.addedAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            PATCH_IDEMPOTENCY_RESOURCE_TYPE,
            itemId,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'group-order-item-update-idempotency-key-stored',
            {
              key: idempotencyKey,
              itemId,
              requestHashStored: requestHash !== null,
            },
            traceId,
          )
        }

        return { type: 'updated' as const, status: 200, body: responseBody }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'updated': {
          logInfo(
            'group-order-item-update-success',
            { groupOrderId, itemId, userId: session.userId, quantity: body.quantity },
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
          'group-order-item-update-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // AppError (NOT_FOUND, AUTHORIZATION_DENIED, VALIDATION_ERROR) — propagate.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-item-update-conflict',
          {
            attempts: error.attempts,
            code: error.code,
            userId: session.userId,
            itemId,
          },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Item update conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// DELETE /api/group-orders/[id]/items/[itemId] — remove the item from the
// user's cart.
// ---------------------------------------------------------------------------
// Body: empty (itemId comes from URL).
//
// Returns: { deleted: true, item: { id } }
//
// Idempotent — deleting a non-existent item is a no-op (200 with the itemId).
// Owner-only (403 otherwise). ADMIN/SUPER_ADMIN bypass for incident response.
// ---------------------------------------------------------------------------
export const DELETE = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: groupOrderId, itemId } = await params

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

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // Load the item (must exist in this group order).
        // -------------------------------------------------------------------
        const item = await tx.groupOrderItem.findUnique({
          where: { id: itemId },
          select: {
            id: true,
            groupOrderId: true,
            userId: true,
            menuItemId: true,
            name: true,
            quantity: true,
            price: true,
          },
        })

        // -------------------------------------------------------------------
        // Idempotent — deleting a non-existent item is a no-op (200).
        // -------------------------------------------------------------------
        if (!item || item.groupOrderId !== groupOrderId) {
          return {
            type: 'deleted' as const,
            alreadyDeleted: true,
            itemId,
          }
        }

        // -------------------------------------------------------------------
        // Authorization — owner only (ADMIN/SUPER_ADMIN bypass).
        // -------------------------------------------------------------------
        const isOwner = item.userId === session.userId
        const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
        if (!isOwner && !isAdmin) {
          throw new AppError(
            'AUTHORIZATION_DENIED',
            'You can only remove your own items',
            403,
            { groupOrderId, itemId, itemUserId: item.userId, callerId: session.userId },
          )
        }

        // -------------------------------------------------------------------
        // Delete the item.
        // -------------------------------------------------------------------
        await tx.groupOrderItem.delete({ where: { id: itemId } })

        // -------------------------------------------------------------------
        // AuditLog GROUP_ORDER_ITEM_REMOVED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'GROUP_ORDER_ITEM_REMOVED',
            metadata: JSON.stringify({
              groupOrderId,
              groupOrderItemId: itemId,
              userId: session.userId,
              menuItemId: item.menuItemId,
              menuItemName: item.name,
              removedQuantity: item.quantity,
              removedSubtotalPaise: item.price * item.quantity,
            }),
          },
        })

        return {
          type: 'deleted' as const,
          alreadyDeleted: false,
          itemId,
        }
      })

      // Handle result variants — single variant (deleted), no exhaustiveness
      // guard needed since there is no 'cached'/'error' branch on DELETE.
      logInfo(
        'group-order-item-delete-success',
        {
          groupOrderId,
          itemId,
          userId: session.userId,
          alreadyDeleted: result.alreadyDeleted,
        },
        traceId,
      )
      return NextResponse.json({
        deleted: true,
        item: { id: itemId },
        alreadyDeleted: result.alreadyDeleted,
      })
    } catch (error) {
      // AppError (AUTHORIZATION_DENIED) — propagate.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-item-delete-conflict',
          {
            attempts: error.attempts,
            code: error.code,
            userId: session.userId,
            itemId,
          },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Item delete conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// Local validateBody — uses our local schema.
// ---------------------------------------------------------------------------
async function validateUpdateItemBody(
  req: NextRequest,
): Promise<z.infer<typeof updateItemBodySchema>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }
  const result = updateItemBodySchema.safeParse(body)
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
