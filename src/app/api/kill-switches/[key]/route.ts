import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { emitKillSwitchToggled } from '@/lib/realtime'

// PATCH /api/kill-switches/[key]  body: { enabled }
// Requires SUPER_ADMIN session.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const session = await getSessionUser()
  if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled boolean required' }, { status: 400 })
  }

  const ks = await db.killSwitch.update({
    where: { key },
    data: { enabled: body.enabled },
  })

  await db.auditLog.create({
    data: {
      actorId: session.userId,
      actorRole: session.role,
      action: 'KILL_SWITCH_TOGGLE',
      metadata: JSON.stringify({ key, enabled: body.enabled, label: ks.label }),
    },
  })

  emitKillSwitchToggled({ key, enabled: body.enabled })

  return NextResponse.json({ switch: ks })
}
