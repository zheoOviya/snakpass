import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminId } from '@/lib/auth'

// PATCH /api/menu/[id]  body: { isAvailable }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (typeof body?.isAvailable !== 'boolean') {
    return NextResponse.json({ error: 'isAvailable boolean required' }, { status: 400 })
  }

  const item = await db.menuItem.update({
    where: { id },
    data: { isAvailable: body.isAvailable },
    select: { id: true, name: true, isAvailable: true, restaurantId: true },
  })

  const adminId = await getAdminId()
  await db.auditLog.create({
    data: {
      actorId: adminId,
      actorRole: 'VENDOR_OWNER',
      action: 'MENU_AVAILABILITY',
      metadata: JSON.stringify({ itemId: id, name: item.name, available: body.isAvailable }),
    },
  })

  return NextResponse.json({ item })
}
