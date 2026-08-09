import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

// PATCH /api/menu/[id]  body: { isAvailable }
// Requires an authenticated vendor/admin session.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  if (!session || !['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (typeof body?.isAvailable !== 'boolean') {
    return NextResponse.json({ error: 'isAvailable boolean required' }, { status: 400 })
  }

  const item = await db.menuItem.update({
    where: { id },
    data: { isAvailable: body.isAvailable },
    select: { id: true, name: true, isAvailable: true, restaurantId: true },
  })

  await db.auditLog.create({
    data: {
      actorId: session.userId,
      actorRole: session.role,
      action: 'MENU_AVAILABILITY',
      metadata: JSON.stringify({ itemId: id, name: item.name, available: body.isAvailable }),
    },
  })

  return NextResponse.json({ item })
}
