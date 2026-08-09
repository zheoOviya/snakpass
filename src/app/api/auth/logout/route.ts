import { NextResponse } from 'next/server'
import { destroySession, clearSessionCookie } from '@/lib/session'

// POST /api/auth/logout
export async function POST() {
  await destroySession()
  await clearSessionCookie()
  return NextResponse.json({ ok: true })
}
