import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// GJ-02 S3: GET /api/notifications — list user's notifications + unread count
export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId) as unknown as NextResponse
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const cursor = searchParams.get('cursor')

    const where: Record<string, unknown> = { userId: session.userId }
    if (cursor) { where.createdAt = { lt: new Date(cursor) } }

    const [rows, unreadCount] = await Promise.all([
      db.notification.findMany({ where: where as never, orderBy: { createdAt: 'desc' }, take: limit }),
      db.notification.count({ where: { userId: session.userId, readAt: null } }),
    ])

    const notifications = rows.map((r) => {
      let parsedData: Record<string, unknown> = {}
      try { parsedData = JSON.parse(r.data) } catch { parsedData = {} }
      return {
        id: r.id, type: r.type, title: r.title, body: r.body, data: parsedData,
        readAt: r.readAt?.toISOString() ?? null, read: r.readAt !== null,
        createdAt: r.createdAt.toISOString(),
      }
    })

    const hasMore = rows.length === limit
    const nextCursor = hasMore && rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null

    return NextResponse.json({ notifications, unreadCount, hasMore, nextCursor }) as unknown as NextResponse
  })
