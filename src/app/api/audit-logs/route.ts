import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/audit-logs?limit=
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '30'), 100)
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { name: true, phone: true } } },
  })
  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      actorId: l.actorId,
      actorName: l.actor?.name ?? 'System',
      actorRole: l.actorRole,
      action: l.action,
      metadata: l.metadata,
      createdAt: l.createdAt,
    })),
  })
}
