'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { SessionUser } from '@/lib/session'

// Mirrors SessionUser shape (kept client-safe).
//
// ADDITIVE (Wave 2 Task 2A): `campusId` + `campusName` are populated by
// GET /api/auth/me (which joins Campus). Both are null when the user hasn't
// picked a campus yet — the consumer page reads `campusId` to redirect to
// /onboarding/campus on first run.
export interface AuthUser {
  userId: string
  role: string
  name: string | null
  phone: string
  email: string | null
  campusId?: string | null
  campusName?: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      const data = await res.json()
      setUser(data.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
