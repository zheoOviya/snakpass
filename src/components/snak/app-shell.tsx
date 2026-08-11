'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Zap, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'

const PERSONAS = {
  consumer: { label: 'Consumer', color: 'from-teal-500 to-emerald-600' },
  vendor: { label: 'Vendor', color: 'from-orange-500 to-amber-600' },
  admin: { label: 'Ops Admin', color: 'from-slate-700 to-slate-900' },
} as const

export function AppShell({ persona, children }: { persona: keyof typeof PERSONAS; children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()
  const p = PERSONAS[persona]

  async function handleLogout() {
    await logout()
    toast({ title: 'Logged out' })
    router.push('/')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
                <Zap className="h-5 w-5" fill="currentColor" />
              </div>
              <div className="leading-none">
                <h1 className="text-lg font-bold tracking-tight">Snak<span className="text-teal-600">Zap</span></h1>
              </div>
            </Link>
            <span className={`hidden rounded-full bg-gradient-to-r ${p.color} px-2.5 py-1 text-xs font-semibold text-white sm:inline`}>
              {p.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium leading-tight">{user.name ?? 'User'}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{user.email ?? user.phone}</p>
              </div>
            )}
            <Button asChild variant="ghost" size="icon" className="h-9 w-9" title="Home">
              <Link href="/"><Home className="h-4 w-4" /></Link>
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleLogout} title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1">{children}</main>
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 text-white">
              <Zap className="h-3.5 w-3.5" fill="currentColor" />
            </div>
            <span><strong className="text-foreground">SnakZap</strong> — Pickup-first food ordering platform</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>🎯 North Star: <strong className="text-foreground">Time from order to first bite</strong></span>
            <span>🚫 No delivery</span>
            <span>💳 Max 10% commission</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
