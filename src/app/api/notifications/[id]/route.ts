import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { enqueueSocialEvent } from '@/lib/social-realtime'

// GJ-02 S3: PATCH /api/notifications/[id] — mark one notification as read
// S5C: Now emits SOCIAL_NOTIFICATION_READ realtime event so OTHER tabs/devices
// of the same user refresh their authoritative unread count. The event targets
// session.userId (the owner) — cross-tab invalidation only, not cross-user.
export const PATCH = (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id } = await params
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    const notif = await db.notification.findUnique({ where: { id } })
    if (!notif) {
      return apiError('NOT_FOUND', 'Notification not found', 404, undefined, traceId) as unknown as NextResponse
    }
    if (notif.userId !== session.userId) {
      return apiError('AUTHORIZATION_DENIED', 'You can only mark your own notifications as read', 403, undefined, traceId) as unknown as NextResponse
    }

    // Idempotent: if already read, return 200 without mutation (no event)
    if (notif.readAt !== null) {
      return NextResponse.json({ id: notif.id, read: true, readAt: notif.readAt.toISOString() }) as unknown as NextResponse
    }

    // S5C: Wrap update + realtime event in a transaction (commit-before-publish).
    // If the update rolls back, no event is emitted (no phantom invalidation).
    await withTransaction(async (tx) => {
      await tx.notification.update({ where: { id }, data: { readAt: new Date() } })
      // S5C: Emit read invalidation to the SAME user (cross-tab). Other tabs
      // refetch GET /api/notifications to get authoritative unread count.
      // entityId = notificationId (minimal, no PII).
      await enqueueSocialEvent(tx, {
        type: 'SOCIAL_NOTIFICATION_READ',
        targetUserId: session.userId,
        entityId: id,
      })
    })

    const updated = await db.notification.findUnique({ where: { id }, select: { id: true, readAt: true } })
    return NextResponse.json({ id: updated!.id, read: true, readAt: updated!.readAt!.toISOString() }) as unknown as NextResponse
  })
