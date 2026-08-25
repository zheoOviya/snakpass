import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { enqueueSocialEvent } from '@/lib/social-realtime'

// GJ-02 S3: POST /api/notifications/mark-all-read — mark all unread as read
// S5C: Now emits SOCIAL_NOTIFICATION_READ realtime event so OTHER tabs/devices
// of the same user refresh their authoritative unread count (which becomes 0).
export const POST = (_req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    // S5C: Wrap updateMany + realtime event in a transaction.
    // Only emit event if at least one row was actually updated (markedRead > 0).
    // If no unread notifications exist, no mutation → no event (no phantom).
    let markedRead = 0
    await withTransaction(async (tx) => {
      const result = await tx.notification.updateMany({
        where: { userId: session.userId, readAt: null },
        data: { readAt: new Date() },
      })
      markedRead = result.count
      if (markedRead > 0) {
        // S5C: Emit read invalidation to the SAME user (cross-tab). Other tabs
        // refetch GET /api/notifications → unread count = 0.
        await enqueueSocialEvent(tx, {
          type: 'SOCIAL_NOTIFICATION_READ',
          targetUserId: session.userId,
          entityId: 'mark-all',
        })
      }
    })

    return NextResponse.json({ markedRead }) as unknown as NextResponse
  })
