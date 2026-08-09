import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'

// GET /api/auth/me — returns the current session user or 401.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ user: null }, { status: 401 })
  return NextResponse.json({ user })
}
