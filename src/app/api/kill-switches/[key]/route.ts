import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { emitKillSwitchToggled } from '@/lib/realtime'
import { validateBody, killSwitchToggleBodySchema } from '@/lib/validation'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'

// PATCH /api/kill-switches/[key]  body: { enabled }
// P0-25: Kill-switch toggle uses optimistic locking to prevent concurrent
// admin toggles from silently overwriting each other.
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ key: string }> }) =>
  withErrorHandler(async () => {
    const { key } = await params
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
      return apiError('AUTHORIZATION_DENIED', 'Forbidden — admin only', 403)
    }
    const { enabled } = await validateBody(req, killSwitchToggleBodySchema)

    try {
      const result = await withTransaction(async (tx) => {
        // Read current kill switch + version
        const ks = await tx.killSwitch.findUnique({ where: { key } })
        if (!ks) {
          return {
            type: 'error' as const,
            status: 404,
            body: { error: { code: 'NOT_FOUND', message: `Kill switch '${key}' not found`, traceId } },
          }
        }

        // P0-25: Optimistic-lock conditional UPDATE.
        const updated = await tx.killSwitch.updateMany({
          where: { key, version: ks.version },
          data: { enabled, version: { increment: 1 } },
        })

        if (updated.count === 0) {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: 'Kill switch was modified by another admin. Please refresh and retry.',
                traceId,
              },
            },
          }
        }

        // Fetch the updated row for the response
        const updatedKs = await tx.killSwitch.findUnique({ where: { key } })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'KILL_SWITCH_TOGGLE',
            metadata: JSON.stringify({ key, enabled, label: ks.label }),
          },
        })

        // P0-24: Write outbox event INSIDE the same transaction.
        await enqueueOutboxEvent(tx, {
          eventType: 'KILL_SWITCH_TOGGLED',
          aggregateType: 'KillSwitch',
          aggregateId: key,
          payload: {
            key,
            enabled,
            label: ks.label,
          },
        })

        return { type: 'success' as const, switch: updatedKs }
      })

      if (result.type === 'error') {
        return NextResponse.json(result.body, { status: result.status })
      }

      emitKillSwitchToggled({ key, enabled })

      return NextResponse.json({ switch: result.switch })
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Kill switch toggle conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
