import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminId } from '@/lib/auth'
import { emitKillSwitchToggled } from '@/lib/realtime'

// PATCH /api/kill-switches/[key]  body: { enabled }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const body = await req.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled boolean required' }, { status: 400 })
  }

  const ks = await db.killSwitch.update({
    where: { key },
    data: { enabled: body.enabled },
  })

  const adminId = await getAdminId()
  await db.auditLog.create({
    data: {
      actorId: adminId,
      actorRole: 'SUPER_ADMIN',
      action: 'KILL_SWITCH_TOGGLE',
      metadata: JSON.stringify({ key, enabled: body.enabled, label: ks.label }),
    },
  })

  emitKillSwitchToggled({ key, enabled: body.enabled })

  return NextResponse.json({ switch: ks })
}
