import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// GJ-02 S3: POST /api/notifications/mark-all-read — mark all unread as read
export const POST = (_req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    const result = await db.notification.updateMany({
      where: { userId: session.userId, readAt: null },
      data: { readAt: new Date() },
    })

    return NextResponse.json({ markedRead: result.count }) as unknown as NextResponse
  })
