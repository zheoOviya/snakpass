import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// PATCH /api/menu/[id]
// ----------------------------------------------------------------------------
// Originally: body { isAvailable } — toggles a menu item's availability.
// Wave 4 Task 4B (additive): the body schema now ALSO accepts an optional
// `rewardMultiplier` (Float, 1.0–3.0). When present, the field is updated
// alongside `isAvailable`. All existing behavior is preserved:
//   - Both fields are optional; absent fields are NOT modified.
//   - At least one of { isAvailable, rewardMultiplier } must be provided.
//   - The update bumps `version` (P0-25 optimistic lock) — additive.
//   - The audit log action remains `MENU_AVAILABILITY` for backward
//     compatibility (existing consumers grep for this action); the metadata
//     payload is extended with `rewardMultiplier` when present.
//
// Backward-compat: callers that send the legacy { isAvailable } body still
// work — the new schema is a strict superset of the old menuAvailabilityBodySchema.
// ----------------------------------------------------------------------------

const menuPatchBodySchema = z
  .object({
    isAvailable: z.boolean().optional(),
    // Additive (Wave 4B): rewardMultiplier (Float, 1.0–3.0). Optional + absent
    // by default — legacy callers omitting this field are unaffected.
    rewardMultiplier: z.number().min(1.0).max(3.0).optional(),
  })
  .refine(
    (b) => b.isAvailable !== undefined || b.rewardMultiplier !== undefined,
    { message: 'At least one of { isAvailable, rewardMultiplier } must be provided' },
  )

export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id } = await params
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session || !['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
      return apiError('AUTHORIZATION_DENIED', 'Forbidden', 403, undefined, traceId)
    }

    const body = await validateBody(req, menuPatchBodySchema)

    // Build the update payload — only fields present in the body.
    const updateData: {
      isAvailable?: boolean
      rewardMultiplier?: number
      version?: { increment: number }
    } = {}
    if (body.isAvailable !== undefined) updateData.isAvailable = body.isAvailable
    if (body.rewardMultiplier !== undefined) updateData.rewardMultiplier = body.rewardMultiplier
    // Optimistic-lock version bump (P0-25 Case A) — additive.
    updateData.version = { increment: 1 }

    const item = await db.menuItem.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        isAvailable: true,
        rewardMultiplier: true,
        restaurantId: true,
      },
    })

    const metadata: Record<string, unknown> = {
      itemId: id,
      name: item.name,
      available: item.isAvailable,
    }
    if (body.rewardMultiplier !== undefined) {
      metadata.rewardMultiplier = item.rewardMultiplier
    }

    await db.auditLog.create({
      data: {
        actorId: session.userId,
        actorRole: session.role,
        action: 'MENU_AVAILABILITY',
        metadata: JSON.stringify(metadata),
      },
    })

    logInfo(
      'menu-availability-updated',
      { itemId: id, fields: Object.keys(body) },
      traceId,
    )

    return NextResponse.json({ item })
  })
