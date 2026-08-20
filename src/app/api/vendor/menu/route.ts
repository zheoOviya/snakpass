import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { requireRole } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
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
// Wave 4 Task 4B — Vendor Menu Management
//   GET  /api/vendor/menu               — list vendor's menu items (grouped by category)
//   POST /api/vendor/menu               — create a new MenuItem
// ----------------------------------------------------------------------------
// Auth: getSessionUser() (401 if no session).
// RBAC: VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN only (CONSUMER → 403).
//
// Restaurant resolution:
//   - VENDOR_OWNER / VENDOR_STAFF → find Restaurant where ownerUserId === session.userId.
//     If multiple, pick the most recently created. If none, 404.
//   - ADMIN / SUPER_ADMIN → require `?restaurantId=X` query param (the vendor
//     they're impersonating). 400 if missing, 404 if not found.
//
// Idempotency (POST only):
//   - Idempotency-Key header honored (resourceType='MenuItem').
//   - Same key on retry returns cached response (201 + the created item).
//   - Same key + materially different body → 422 IdempotencyKeyReuseError.
//
// Audit: MENU_ITEM_CREATED on POST (actorId = session.userId, actorRole =
// session.role, metadata = { itemId, restaurantId, name, price, category }).
//
// Governance (blueprint §23 VENDOR MENU MANAGEMENT):
//   - Creates a MenuItem (additive — does NOT modify existing rows).
//   - rewardMultiplier defaults to 1.0 if not provided (the schema default).
//   - No money-state tables touched (Payment, Refund, LedgerEntry, etc.).
// ----------------------------------------------------------------------------

const ALLOWED_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']

// ---------------------------------------------------------------------------
// Menu item category enum (mirrors schema comment on MenuItem.category).
// ---------------------------------------------------------------------------
const MENU_CATEGORIES = [
  'Starters',
  'Mains',
  'Breads',
  'Rice',
  'Desserts',
  'Beverages',
] as const

// ---------------------------------------------------------------------------
// POST /api/vendor/menu — create menu item.
// Price is provided in rupees by the client (the form sends ₹X.YY); the
// server converts to paise (×100) before persisting. rewardMultiplier is
// validated to be 1.0–3.0 per blueprint §17 (rewards engine cap).
// ---------------------------------------------------------------------------
const createMenuItemBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long (max 200)'),
  description: z.string().max(2000).default(''),
  price: z.number().positive('Price must be positive').max(1_000_000, 'Price too high'),
  image: z.string().min(1, 'Image URL is required').max(2048),
  spiceLevel: z.number().int().min(0).max(3).default(1),
  isVeg: z.boolean().default(true),
  category: z.enum(MENU_CATEGORIES).default('Mains'),
  isAvailable: z.boolean().default(true),
  availableCount: z.number().int().positive().nullable().optional(),
  rewardMultiplier: z.number().min(1.0).max(3.0).default(1.0),
})

const IDEMPOTENCY_RESOURCE_TYPE = 'MenuItem'

// ---------------------------------------------------------------------------
// GET /api/vendor/menu?restaurantId=X
// Returns menu items grouped by category. Items are filtered to
// deletedAt IS NULL (soft-deleted items are excluded from the public
// catalog but preserved for historical OrderItem references).
// ---------------------------------------------------------------------------
export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    // requireRole throws AppError (401/403) on missing session / wrong role —
    // caught by withErrorHandler. This avoids the apiError early-return
    // pattern that breaks withErrorHandler's T inference.
    const session = await requireRole(ALLOWED_ROLES)

    const restaurantIdQuery = req.nextUrl.searchParams.get('restaurantId') ?? undefined
    const restaurant = await resolveVendorRestaurant(db, session, restaurantIdQuery)

    const items = await db.menuItem.findMany({
      where: {
        restaurantId: restaurant.id,
        deletedAt: null,
      },
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
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
        createdAt: true,
      },
    })

    // Group by category (preserves the MENU_CATEGORIES order).
    const byCategory: Record<string, typeof items> = {}
    for (const cat of MENU_CATEGORIES) byCategory[cat] = []
    for (const it of items) {
      const cat = byCategory[it.category] ?? (byCategory[it.category] = [])
      cat.push(it)
    }

    return NextResponse.json({
      restaurant: { id: restaurant.id, name: restaurant.name },
      categories: MENU_CATEGORIES,
      items: byCategory,
      total: items.length,
    })
  })

// ---------------------------------------------------------------------------
// POST /api/vendor/menu
// Creates a MenuItem. Price is converted from rupees → paise (×100, rounded
// to integer paise). rewardMultiplier is persisted as a Float (1.0 default).
// Audit log action: MENU_ITEM_CREATED.
// Idempotency-Key supported.
// ---------------------------------------------------------------------------
export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // AuthN + RBAC (requireRole throws AppError on failure — caught by
    // withErrorHandler).
    const session = await requireRole(ALLOWED_ROLES)

    const body = await validateBody(req, createMenuItemBodySchema)

    // Idempotency-Key (optional).
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        // P0-17: Check idempotency cache FIRST (inside txn).
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'vendor-menu-create-idempotency-dedup-hit',
              { key: idempotencyKey },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // Resolve vendor restaurant INSIDE the txn (so the read shares the
        // snapshot + locks with the write).
        const restaurant = await resolveVendorRestaurant(
          tx,
          session,
          req.nextUrl.searchParams.get('restaurantId') ?? undefined,
        )

        // Convert rupees → paise (×100, rounded to integer).
        const pricePaise = Math.round(body.price * 100)

        const item = await tx.menuItem.create({
          data: {
            restaurantId: restaurant.id,
            name: body.name,
            description: body.description,
            price: pricePaise,
            image: body.image,
            spiceLevel: body.spiceLevel,
            isVeg: body.isVeg,
            isAvailable: body.isAvailable,
            availableCount: body.availableCount ?? null,
            category: body.category,
            rewardMultiplier: body.rewardMultiplier,
          },
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
            createdAt: true,
          },
        })

        // Audit log — MENU_ITEM_CREATED.
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'MENU_ITEM_CREATED',
            metadata: JSON.stringify({
              itemId: item.id,
              restaurantId: restaurant.id,
              name: item.name,
              price: pricePaise,
              category: item.category,
              rewardMultiplier: item.rewardMultiplier,
            }),
          },
        })

        const responseBody = {
          item,
          restaurant: { id: restaurant.id, name: restaurant.name },
        }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            item.id,
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
            'vendor-menu-create-success',
            { itemId: result.body.item.id, restaurantId: result.body.restaurant.id },
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
          'vendor-menu-create-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Menu item creation conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
