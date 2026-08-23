import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// GJ-02 S3: PATCH /api/notifications/[id] — mark one notification as read
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

    // Idempotent: if already read, return 200 without mutation
    if (notif.readAt !== null) {
      return NextResponse.json({ id: notif.id, read: true, readAt: notif.readAt.toISOString() }) as unknown as NextResponse
    }

    const updated = await db.notification.update({ where: { id }, data: { readAt: new Date() } })
    return NextResponse.json({ id: updated.id, read: true, readAt: updated.readAt!.toISOString() }) as unknown as NextResponse
  })
