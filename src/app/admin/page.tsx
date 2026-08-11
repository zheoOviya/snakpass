'use client'

import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { AdminLogin } from '@/components/snak/admin-login'
import { AppShell } from '@/components/snak/app-shell'
import { AdminView } from '@/components/snak/admin-view'

export default function AdminPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-700" />
      </div>
    )
  }

  if (!user) {
    return <AdminLogin onDone={() => router.refresh()} />
  }

  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">This portal is for admins only. Your role: <strong>{user.role}</strong></p>
        <button onClick={() => router.push('/')} className="text-slate-700 underline">Back to home</button>
      </div>
    )
  }

  return (
    <AppShell persona="admin">
      <AdminView />
    </AppShell>
  )
}
