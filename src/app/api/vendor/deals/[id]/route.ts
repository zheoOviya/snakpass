import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { requireRole } from '@/lib/session'
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
// Wave 4 Task 4B — Vendor Deal Management (single-deal routes)
//   PATCH  /api/vendor/deals/[id]   — update deal fields
//   DELETE /api/vendor/deals/[id]   — hard-delete (deals are not order data)
// ----------------------------------------------------------------------------
// Auth: getSessionUser() (401 if no session) — via requireRole.
// RBAC: VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN only (CONSUMER → 403).
//
// Ownership check:
//   - Loads the VendorDeal by id (404 if not found).
//   - For VENDOR_OWNER / VENDOR_STAFF: verifies deal.restaurant.ownerUserId
//     === session.userId (403 if mismatch). ADMIN + SUPER_ADMIN bypass.
//
// Idempotency (PATCH only): resourceType='VendorDealUpdate'.
//
// Audit:
//   - PATCH → DEAL_UPDATED (metadata: changed fields + before/after).
//   - DELETE → DEAL_DELETED (metadata: dealId, restaurantId, title).
//
// Hard-delete rationale: VendorDeal is promotional metadata, NOT financial
// state. Hard-deleting a deal that has never been applied to an order is
// safe (no Payment/Refund/LedgerEntry rows reference it). If a deal has
// been applied to a past order, that order's snapshot is unaffected (we
// snapshot the discount amount into Order/PricingBreakdown at order time,
// not the VendorDeal FK). So hard-delete is safe + keeps the deals list
// clean (no zombie rows).
// ----------------------------------------------------------------------------

const ALLOWED_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']

const DEAL_TYPES = ['percentage', 'fixed', 'free_item'] as const

// ---------------------------------------------------------------------------
// PATCH body — every field is optional.
// ---------------------------------------------------------------------------
const updateDealBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    dealType: z.enum(DEAL_TYPES).optional(),
    dealValue: z.number().int().nonnegative().max(1_000_000).optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    isActive: z.boolean().optional(),
    menuItemId: z.string().min(1).max(200).nullable().optional(),
  })
  .refine(
    (b) => Object.keys(b).length > 0,
    { message: 'At least one field must be provided to update' },
  )

const IDEMPOTENCY_RESOURCE_TYPE = 'VendorDealUpdate'

// ---------------------------------------------------------------------------
// Shared ownership-check helper.
// ---------------------------------------------------------------------------
async function loadOwnedDeal(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  dealId: string,
  session: NonNullable<Awaited<ReturnType<typeof requireRole>>>,
) {
  const deal = await tx.vendorDeal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      restaurantId: true,
      title: true,
      description: true,
      dealType: true,
      dealValue: true,
      validFrom: true,
      validUntil: true,
      isActive: true,
      menuItemId: true,
      createdAt: true,
      updatedAt: true,
      restaurant: { select: { id: true, name: true, ownerUserId: true } },
    },
  })
  if (!deal) {
    throw new AppError('NOT_FOUND', 'Deal not found', 404, { dealId })
  }

  if (session.role === 'VENDOR_OWNER' || session.role === 'VENDOR_STAFF') {
    if (!deal.restaurant.ownerUserId || deal.restaurant.ownerUserId !== session.userId) {
      throw new AppError(
        'AUTHORIZATION_DENIED',
        'You can only manage deals for restaurants you own',
        403,
        {
          dealId,
          restaurantId: deal.restaurantId,
          restaurantOwnerId: deal.restaurant.ownerUserId ?? null,
          requesterId: session.userId,
        },
      )
    }
  }

  return deal
}

// ---------------------------------------------------------------------------
// PATCH /api/vendor/deals/[id]
// ---------------------------------------------------------------------------
export const PATCH = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const { id: dealId } = await params
    const traceId = newTraceId()

    const session = await requireRole(ALLOWED_ROLES)
    const body = await validateBody(req, updateDealBodySchema)

    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'vendor-deal-update-idempotency-dedup-hit',
              { key: idempotencyKey, dealId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        const existing = await loadOwnedDeal(tx, dealId, session)

        // Cross-field validation: validUntil (if provided) must be after
        // validFrom (which may be the existing value or the new one).
        const newValidFrom = body.validFrom ?? existing.validFrom
        const newValidUntil = body.validUntil !== undefined ? body.validUntil : existing.validUntil
        if (newValidUntil && newValidUntil <= newValidFrom) {
          throw new AppError(
            'VALIDATION_ERROR',
            'validUntil must be after validFrom',
            400,
            {
              validFrom: newValidFrom.toISOString(),
              validUntil: newValidUntil.toISOString(),
            },
          )
        }

        if (body.dealType === 'percentage' && body.dealValue !== undefined && body.dealValue > 100) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Percentage deal value must be 0..100',
            400,
            { dealValue: body.dealValue },
          )
        }

        // If a new menuItemId is provided, verify it belongs to the same
        // restaurant + is not soft-deleted. Setting menuItemId to null
        // (restaurant-wide) is allowed.
        if (body.menuItemId !== undefined && body.menuItemId !== null) {
          const scopedItem = await tx.menuItem.findUnique({
            where: { id: body.menuItemId },
            select: { id: true, restaurantId: true, deletedAt: true },
          })
          if (
            !scopedItem ||
            scopedItem.deletedAt !== null ||
            scopedItem.restaurantId !== existing.restaurantId
          ) {
            throw new AppError(
              'VALIDATION_ERROR',
              'menuItemId must reference an active menu item in your restaurant',
              400,
              { menuItemId: body.menuItemId },
            )
          }
        }

        // Build the update payload — only fields present in the body.
        const updateData: Record<string, unknown> = {}
        if (body.title !== undefined) updateData.title = body.title
        if (body.description !== undefined) updateData.description = body.description
        if (body.dealType !== undefined) updateData.dealType = body.dealType
        if (body.dealValue !== undefined) updateData.dealValue = body.dealValue
        if (body.validFrom !== undefined) updateData.validFrom = body.validFrom
        if (body.validUntil !== undefined) updateData.validUntil = body.validUntil
        if (body.isActive !== undefined) updateData.isActive = body.isActive
        if (body.menuItemId !== undefined) updateData.menuItemId = body.menuItemId

        const updated = await tx.vendorDeal.update({
          where: { id: dealId },
          data: updateData,
          select: {
            id: true,
            title: true,
            description: true,
            dealType: true,
            dealValue: true,
            validFrom: true,
            validUntil: true,
            isActive: true,
            menuItemId: true,
            createdAt: true,
            updatedAt: true,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'DEAL_UPDATED',
            metadata: JSON.stringify({
              dealId,
              restaurantId: existing.restaurantId,
              changedFields: Object.keys(body),
              before: {
                title: existing.title,
                dealType: existing.dealType,
                dealValue: existing.dealValue,
                isActive: existing.isActive,
                validFrom: existing.validFrom.toISOString(),
                validUntil: existing.validUntil?.toISOString() ?? null,
              },
              after: {
                title: updated.title,
                dealType: updated.dealType,
                dealValue: updated.dealValue,
                isActive: updated.isActive,
                validFrom: updated.validFrom.toISOString(),
                validUntil: updated.validUntil?.toISOString() ?? null,
              },
            }),
          },
        })

        const responseBody = { deal: updated }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            dealId,
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
            'vendor-deal-update-success',
            { dealId, changedFields: Object.keys(body) },
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
          'vendor-deal-update-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Deal update conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// DELETE /api/vendor/deals/[id] — hard-delete.
// See header comment for the safety rationale.
// ---------------------------------------------------------------------------
export const DELETE = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  // Explicit <unknown> widens T so the inner return-type union
  // (NextResponse<{ deleted }> | NextResponse<ApiError>) is assignable to
  // Promise<NextResponse<unknown>>. Same trick accept/route.ts achieves
  // implicitly via parseCachedResponse returning `body: unknown`.
  withErrorHandler<unknown>(async () => {
    const { id: dealId } = await params
    const traceId = newTraceId()

    const session = await requireRole(ALLOWED_ROLES)

    try {
      const result = await withTransaction(async (tx) => {
        const existing = await loadOwnedDeal(tx, dealId, session)

        await tx.vendorDeal.delete({
          where: { id: dealId },
        })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'DEAL_DELETED',
            metadata: JSON.stringify({
              dealId,
              restaurantId: existing.restaurantId,
              title: existing.title,
              dealType: existing.dealType,
              hardDelete: true,
            }),
          },
        })

        return { type: 'deleted' as const, status: 200, body: { deleted: true, dealId } }
      })

      logInfo(
        'vendor-deal-delete-success',
        { dealId },
        traceId,
      )
      return NextResponse.json(result.body, { status: result.status })
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Deal delete conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
