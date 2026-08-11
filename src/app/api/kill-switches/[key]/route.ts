import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { emitKillSwitchToggled } from '@/lib/realtime'
import { validateBody, killSwitchToggleBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { audit } from '@/lib/audit'

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

    await audit('KILL_SWITCH_TOGGLE', { key, enabled, label: ks.label }, session.userId, session.role)

    emitKillSwitchToggled({ key, enabled })

    return NextResponse.json({ switch: ks })
  })
