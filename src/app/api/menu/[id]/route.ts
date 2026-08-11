import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody, menuAvailabilityBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { audit } from '@/lib/audit'

// PATCH /api/menu/[id]  body: { isAvailable }
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(req, async (traceId) => {
    const { id } = await params
    const session = await getSessionUser()
    if (!session || !['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
      return apiError('AUTHORIZATION_DENIED', 'Forbidden', 403, undefined, traceId)
    }
    const { isAvailable } = await validateBody(req, menuAvailabilityBodySchema)

    const item = await db.menuItem.update({
      where: { id },
      data: { isAvailable },
      select: { id: true, name: true, isAvailable: true, restaurantId: true },
    })

    await audit('MENU_AVAILABILITY', { itemId: id, name: item.name, available: isAvailable }, session.userId, session.role)

    return NextResponse.json({ item })
  })
