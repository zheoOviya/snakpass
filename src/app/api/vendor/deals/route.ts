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
import { resolveVendorRestaurant } from '@/lib/vendor-rbac'

// ----------------------------------------------------------------------------
// Wave 4 Task 4B — Vendor Deal Management
//   GET  /api/vendor/deals             — list deals for vendor's restaurant
//   POST /api/vendor/deals             — create a new VendorDeal
// ----------------------------------------------------------------------------
// Auth: getSessionUser() (401 if no session).
// RBAC: VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN only (CONSUMER → 403).
//
// Restaurant resolution: see src/lib/vendor-rbac.ts → resolveVendorRestaurant.
//
// Idempotency (POST only): resourceType='VendorDeal'.
//
// Audit: DEAL_CREATED on POST.
// ----------------------------------------------------------------------------

const ALLOWED_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']

// ---------------------------------------------------------------------------
// Deal types: percentage off, fixed-amount off, or free-item grant.
// dealValue semantics depend on dealType (see schema comment).
// ---------------------------------------------------------------------------
const DEAL_TYPES = ['percentage', 'fixed', 'free_item'] as const

const createDealBodySchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  dealType: z.enum(DEAL_TYPES),
  // For "percentage": 0..100 (percent off). For "fixed": paise amount. For
  // "free_item": ignored (stored as 0; the menu-item ref is in menuItemId).
  dealValue: z.number().int().nonnegative().max(1_000_000, 'Value too high'),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
  // Optional menu-item scope. When provided, the deal applies only to that
  // item (e.g., "free samosa with thali" — menuItemId = the thali).
  menuItemId: z.string().min(1).max(200).optional(),
})

const IDEMPOTENCY_RESOURCE_TYPE = 'VendorDeal'

// ---------------------------------------------------------------------------
// GET /api/vendor/deals?restaurantId=X
// Returns all deals for the vendor's restaurant (active + inactive), sorted
// by createdAt desc.
// ---------------------------------------------------------------------------
export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    // requireRole throws AppError (401/403) on missing session / wrong role —
    // caught by withErrorHandler. Avoids apiError early-return pattern that
    // breaks withErrorHandler's T inference.
    const session = await requireRole(ALLOWED_ROLES)

    const restaurantIdQuery = req.nextUrl.searchParams.get('restaurantId') ?? undefined
    const restaurant = await resolveVendorRestaurant(db, session, restaurantIdQuery)

    const deals = await db.vendorDeal.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'desc' },
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

    const now = new Date()
    const active = deals.filter((d) => {
      if (!d.isActive) return false
      if (d.validFrom && d.validFrom > now) return false
      if (d.validUntil && d.validUntil < now) return false
      return true
    })

    return NextResponse.json({
      restaurant: { id: restaurant.id, name: restaurant.name },
      deals,
      active: deals.filter((d) => active.includes(d)),
      total: deals.length,
      activeCount: active.length,
    })
  })

// ---------------------------------------------------------------------------
// POST /api/vendor/deals
// Creates a VendorDeal linked to the vendor's restaurant.
// ---------------------------------------------------------------------------
export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    const session = await requireRole(ALLOWED_ROLES)
    const body = await validateBody(req, createDealBodySchema)

    // Validation: validUntil (if provided) must be after validFrom.
    if (body.validUntil && body.validUntil <= body.validFrom) {
      throw new AppError(
        'VALIDATION_ERROR',
        'validUntil must be after validFrom',
        400,
        { validFrom: body.validFrom.toISOString(), validUntil: body.validUntil.toISOString() },
      )
    }

    // For "percentage" type, dealValue must be 0..100.
    if (body.dealType === 'percentage' && body.dealValue > 100) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Percentage deal value must be 0..100',
        400,
        { dealValue: body.dealValue },
      )
    }

    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'vendor-deal-create-idempotency-dedup-hit',
              { key: idempotencyKey },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        const restaurant = await resolveVendorRestaurant(
          tx,
          session,
          req.nextUrl.searchParams.get('restaurantId') ?? undefined,
        )

        // If menuItemId provided, verify the item belongs to the same
        // restaurant + is not soft-deleted.
        if (body.menuItemId) {
          const scopedItem = await tx.menuItem.findUnique({
            where: { id: body.menuItemId },
            select: { id: true, restaurantId: true, deletedAt: true, name: true },
          })
          if (!scopedItem || scopedItem.deletedAt !== null || scopedItem.restaurantId !== restaurant.id) {
            throw new AppError(
              'VALIDATION_ERROR',
              'menuItemId must reference an active menu item in your restaurant',
              400,
              { menuItemId: body.menuItemId },
            )
          }
        }

        const deal = await tx.vendorDeal.create({
          data: {
            restaurantId: restaurant.id,
            title: body.title,
            description: body.description ?? null,
            dealType: body.dealType,
            dealValue: body.dealValue,
            validFrom: body.validFrom,
            validUntil: body.validUntil ?? null,
            isActive: body.isActive,
            menuItemId: body.menuItemId ?? null,
          },
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
            action: 'DEAL_CREATED',
            metadata: JSON.stringify({
              dealId: deal.id,
              restaurantId: restaurant.id,
              title: deal.title,
              dealType: deal.dealType,
              dealValue: deal.dealValue,
              menuItemId: deal.menuItemId ?? null,
            }),
          },
        })

        const responseBody = {
          deal,
          restaurant: { id: restaurant.id, name: restaurant.name },
        }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            deal.id,
            201,
            JSON.stringify(responseBody),
            requestHash,
          )
        }

        return { type: 'created' as const, status: 201, body: responseBody }
      })

      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'created': {
          logInfo(
            'vendor-deal-create-success',
            { dealId: result.body.deal.id, restaurantId: result.body.restaurant.id },
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
          'vendor-deal-create-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Deal creation conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
