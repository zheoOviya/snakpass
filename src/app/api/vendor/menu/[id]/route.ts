import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser, requireRole } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'

// ----------------------------------------------------------------------------
// Wave 4 Task 4B — Vendor Menu Management (single-item routes)
//   PATCH  /api/vendor/menu/[id]   — update fields (incl. rewardMultiplier)
//   DELETE /api/vendor/menu/[id]   — soft-delete (isAvailable=false + deletedAt)
// ----------------------------------------------------------------------------
// Auth: getSessionUser() (401 if no session).
// RBAC: VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN only (CONSUMER → 403).
//
// Ownership check:
//   - Loads the MenuItem by id (404 if not found OR if deletedAt is non-null
//     — soft-deleted items are not addressable by this route).
//   - For VENDOR_OWNER / VENDOR_STAFF: verifies item.restaurant.ownerUserId
//     === session.userId (403 if mismatch). ADMIN + SUPER_ADMIN bypass.
//
// Idempotency (PATCH only):
//   - Idempotency-Key header honored (resourceType='MenuItemUpdate').
//   - Same key on retry returns the cached response.
//
// Audit:
//   - PATCH → MENU_ITEM_UPDATED (metadata: changed fields + before/after).
//   - DELETE → MENU_ITEM_DELETED (metadata: itemId, name, restaurantId).
// ----------------------------------------------------------------------------

const ALLOWED_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']

const MENU_CATEGORIES = [
  'Starters',
  'Mains',
  'Breads',
  'Rice',
  'Desserts',
  'Beverages',
] as const

// ---------------------------------------------------------------------------
// PATCH body — every field is optional. Only the provided fields are
// updated; absent fields are preserved. `price` is provided in rupees by
// the client and converted to paise (×100) server-side.
// ---------------------------------------------------------------------------
const updateMenuItemBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    // Price is in RUPEES on the wire (UI sends ₹X.YY) — converted to paise.
    price: z.number().positive().max(1_000_000).optional(),
    image: z.string().min(1).max(2048).optional(),
    spiceLevel: z.number().int().min(0).max(3).optional(),
    isVeg: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    availableCount: z.number().int().positive().nullable().optional(),
    category: z.enum(MENU_CATEGORIES).optional(),
    // rewardMultiplier: 1.0–3.0 per blueprint §17.
    rewardMultiplier: z.number().min(1.0).max(3.0).optional(),
  })
  .refine(
    (b) => Object.keys(b).length > 0,
    { message: 'At least one field must be provided to update' },
  )

const IDEMPOTENCY_RESOURCE_TYPE = 'MenuItemUpdate'

// ---------------------------------------------------------------------------
// Shared ownership-check helper. Loads the MenuItem (with its Restaurant for
// ownerUserId verification). Returns the item or throws AppError.
// ---------------------------------------------------------------------------
async function loadOwnedMenuItem(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  itemId: string,
  session: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
) {
  const item = await tx.menuItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      restaurantId: true,
      name: true,
      description: true,
      price: true,
      image: true,
      spiceLevel: true,
      isVeg: true,
      isAvailable: true,
      availableCount: true,
      category: true,
      rewardMultiplier: true,
      version: true,
      deletedAt: true,
      createdAt: true,
      restaurant: { select: { id: true, name: true, ownerUserId: true } },
    },
  })
  if (!item || item.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 'Menu item not found', 404, { itemId })
  }

  if (session.role === 'VENDOR_OWNER' || session.role === 'VENDOR_STAFF') {
    if (!item.restaurant.ownerUserId || item.restaurant.ownerUserId !== session.userId) {
      throw new AppError(
        'AUTHORIZATION_DENIED',
        'You can only manage menu items for restaurants you own',
        403,
        {
          itemId,
          restaurantId: item.restaurantId,
          restaurantOwnerId: item.restaurant.ownerUserId ?? null,
          requesterId: session.userId,
        },
      )
    }
  }

  return item
}

// ---------------------------------------------------------------------------
// PATCH /api/vendor/menu/[id]
// ---------------------------------------------------------------------------
export const PATCH = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const { id: itemId } = await params
    const traceId = newTraceId()

    const session = await requireRole(ALLOWED_ROLES)
    const body = await validateBody(req, updateMenuItemBodySchema)

    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'vendor-menu-update-idempotency-dedup-hit',
              { key: idempotencyKey, itemId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        const existing = await loadOwnedMenuItem(tx, itemId, session)

        // Build the update payload. Only fields that are present in the body
        // are included; absent fields are preserved. `price` (rupees) is
        // converted to paise.
        const updateData: Record<string, unknown> = {}
        if (body.name !== undefined) updateData.name = body.name
        if (body.description !== undefined) updateData.description = body.description
        if (body.price !== undefined) updateData.price = Math.round(body.price * 100)
        if (body.image !== undefined) updateData.image = body.image
        if (body.spiceLevel !== undefined) updateData.spiceLevel = body.spiceLevel
        if (body.isVeg !== undefined) updateData.isVeg = body.isVeg
        if (body.isAvailable !== undefined) updateData.isAvailable = body.isAvailable
        if (body.availableCount !== undefined) updateData.availableCount = body.availableCount
        if (body.category !== undefined) updateData.category = body.category
        if (body.rewardMultiplier !== undefined) updateData.rewardMultiplier = body.rewardMultiplier
        // Optimistic-lock: bump the version on every update so concurrent
        // writes are detected (P0-25 Case A). The conditional update uses
        // version = existing.version in the WHERE clause.
        updateData.version = { increment: 1 }

        const updated = await tx.menuItem.update({
          where: { id: itemId, version: existing.version },
          data: updateData,
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            image: true,
            spiceLevel: true,
            isVeg: true,
            isAvailable: true,
            availableCount: true,
            category: true,
            rewardMultiplier: true,
            version: true,
            createdAt: true,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'MENU_ITEM_UPDATED',
            metadata: JSON.stringify({
              itemId,
              restaurantId: existing.restaurantId,
              changedFields: Object.keys(body),
              before: {
                name: existing.name,
                price: existing.price,
                isAvailable: existing.isAvailable,
                rewardMultiplier: existing.rewardMultiplier,
                category: existing.category,
              },
              after: {
                name: updated.name,
                price: updated.price,
                isAvailable: updated.isAvailable,
                rewardMultiplier: updated.rewardMultiplier,
                category: updated.category,
              },
            }),
          },
        })

        const responseBody = { item: updated }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            itemId,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
        }

        return { type: 'updated' as const, status: 200, body: responseBody }
      })

      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'updated': {
          logInfo(
            'vendor-menu-update-success',
            { itemId, changedFields: Object.keys(body) },
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
          'vendor-menu-update-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Menu item update conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// DELETE /api/vendor/menu/[id] — soft-delete.
// Sets isAvailable=false + deletedAt=now(). The row is preserved for
// historical OrderItem references but excluded from public catalog reads
// (catalog queries filter `deletedAt IS NULL`).
// ---------------------------------------------------------------------------
export const DELETE = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  // Explicit <unknown> widens T so the inner return-type union
  // (NextResponse<{ item }> | NextResponse<ApiError>) is assignable to
  // Promise<NextResponse<unknown>>. This is the same trick accept/route.ts
  // achieves implicitly via parseCachedResponse returning `body: unknown`.
  withErrorHandler<unknown>(async () => {
    const { id: itemId } = await params
    const traceId = newTraceId()

    const session = await requireRole(ALLOWED_ROLES)

    try {
      const result = await withTransaction(async (tx) => {
        const existing = await loadOwnedMenuItem(tx, itemId, session)
        const now = new Date()

        const updated = await tx.menuItem.update({
          where: { id: itemId, version: existing.version },
          data: {
            isAvailable: false,
            deletedAt: now,
            version: { increment: 1 },
          },
          select: {
            id: true,
            name: true,
            isAvailable: true,
            deletedAt: true,
            version: true,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'MENU_ITEM_DELETED',
            metadata: JSON.stringify({
              itemId,
              restaurantId: existing.restaurantId,
              name: existing.name,
              deletedAt: now.toISOString(),
              softDelete: true,
            }),
          },
        })

        return { type: 'deleted' as const, status: 200, body: { item: updated } }
      })

      logInfo(
        'vendor-menu-delete-success',
        { itemId, restaurantId: result.body.item.id },
        traceId,
      )
      return NextResponse.json(result.body, { status: result.status })
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Menu item delete conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
