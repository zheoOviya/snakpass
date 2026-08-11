import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/kill-switches
export async function GET() {
  const switches = await db.killSwitch.findMany({ orderBy: { severity: 'desc' } })
  return NextResponse.json({ switches })
}
