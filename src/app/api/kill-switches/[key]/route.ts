import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { emitKillSwitchToggled } from '@/lib/realtime'
import { validateBody, killSwitchToggleBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'

// PATCH /api/kill-switches/[key]  body: { enabled }
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ key: string }> }) =>
  withErrorHandler(req, async (traceId) => {
    const { key } = await params
    const session = await getSessionUser()
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
      return apiError('AUTHORIZATION_DENIED', 'Forbidden — admin only', 403, undefined, traceId)
    }
    const { enabled } = await validateBody(req, killSwitchToggleBodySchema)

    const ks = await db.killSwitch.update({
      where: { key },
      data: { enabled },
    })

    await db.auditLog.create({
      data: {
        actorId: session.userId,
        actorRole: session.role,
        action: 'KILL_SWITCH_TOGGLE',
        metadata: JSON.stringify({ key, enabled, label: ks.label }),
      },
    })

    emitKillSwitchToggled({ key, enabled })

    return NextResponse.json({ switch: ks })
  })
