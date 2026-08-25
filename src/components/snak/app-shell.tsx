'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, LogOut, Zap, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { useCampus } from '@/lib/campus-store'
import { useUI } from '@/lib/ui-store'
import { useSocial } from '@/lib/social-store'
import { csrfFetch } from '@/lib/csrf-client'
import { useNotifications } from '@/lib/notification-store'
import { useSocialRealtime } from '@/hooks/use-social-realtime'
import { CampusSelector } from '@/components/snak/campus-selector'
import { BottomNav } from '@/components/snak/bottom-nav'
import type { Campus } from '@/lib/types'

const PERSONAS = {
  consumer: { label: 'Consumer', color: 'from-teal-500 to-emerald-600' },
  vendor: { label: 'Vendor', color: 'from-orange-500 to-amber-600' },
  admin: { label: 'Ops Admin', color: 'from-slate-700 to-slate-900' },
} as const

export function AppShell({ persona, children }: { persona: keyof typeof PERSONAS; children: React.ReactNode }) {
  const { user, logout, refresh: refreshAuth } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const p = PERSONAS[persona]

  // ADDITIVE (Wave 2 Task 2B): BottomNav for the consumer persona only.
  // Vendor + admin personas keep their existing chrome. The BottomNav reads
  // the active tab from the shared ui-store — so ConsumerView + AppShell stay
  // decoupled (AppShell renders the nav, ConsumerView renders the screens).
  const activeTab = useUI((s) => s.activeTab)
  const setActiveTab = useUI((s) => s.setActiveTab)

  // ADDITIVE (Wave 6 Task 6B): wire the Social tab's violet activity dot to
  // the social-store. The dot fires when there are pending incoming friend
  // requests — surfaces social activity the user hasn't acknowledged yet.
  // Read-only — the store itself is owned by Task 1C and refreshed by
  // HomeScreen + SocialScreen mounts.
  const hasPendingSocial = useSocial(
    (s) => s.connections.some((c) => c.status === 'PENDING_RECEIVED'),
  )

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
            {/* ADDITIVE (Wave 2 Task 2A): campus-selector chip in the header.
                Consumer persona only — vendor/admin don't have a campus concept. */}
            {persona === 'consumer' && (
              <CampusChip onSwitched={() => refreshAuth()} />
            )}
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium leading-tight">{user.name ?? 'User'}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{user.email ?? user.phone}</p>
              </div>
            )}
            {/* GJ-02 S3: Notification bell with unread badge */}
            <NotificationBell />
            <Button asChild variant="ghost" size="icon" className="h-9 w-9" title="Home">
              <Link href="/"><Home className="h-4 w-4" /></Link>
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleLogout} title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      {/* pb-16 + safe-area inset for the consumer BottomNav (mobile-only).
          On md+ the BottomNav is hidden so we keep the default padding. */}
      <main className={`mx-auto w-full max-w-6xl flex-1 ${persona === 'consumer' ? 'pb-[var(--height-bottom-nav-safe)] md:pb-0' : ''}`}>{children}</main>
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

      {/* ADDITIVE (Wave 2 Task 2B): Consumer bottom-nav. Renders below the
          footer visually (fixed bottom-0), mobile-only. Hidden for vendor +
          admin personas (no screens to route to). */}
      {persona === 'consumer' && (
        <BottomNav
          active={activeTab}
          onChange={setActiveTab}
          socialActivity={hasPendingSocial}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CampusChip — wrapper around Task 1B's CampusSelector that wires it to the
// /api/campuses list + /api/auth/me/campus PATCH. Renders inline in the header
// for the consumer persona only.
// ---------------------------------------------------------------------------

function CampusChip({ onSwitched }: { onSwitched?: () => void }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const selectedCampusId = useCampus((s) => s.selectedCampusId)
  const selectedCampusName = useCampus((s) => s.selectedCampusName)
  const setCampus = useCampus((s) => s.setCampus)

  const [campuses, setCampuses] = React.useState<Campus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)

  // Load the campus list once on mount (full list — the sheet does
  // client-side filtering via the CampusSelector component).
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/campuses', { cache: 'no-store' })
        const data = (await res.json().catch(() => ({}))) as {
          campuses?: Array<{
            id: string
            name: string
            shortName?: string | null
            city: string
            state?: string | null
          }>
        }
        if (!cancelled && data.campuses) {
          setCampuses(
            data.campuses.map((c) => ({
              id: c.id,
              name: c.name,
              shortName: c.shortName ?? undefined,
              city: c.city,
              state: c.state ?? undefined,
            })),
          )
        }
      } catch {
        // Soft-fail — the chip still renders with whatever cached selection we have.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Sync the campus-store from the server-side user record on first mount
  // (so the chip shows the right label even before the user opens the sheet).
  React.useEffect(() => {
    if (user?.campusId && user.campusName && !selectedCampusId) {
      setCampus(user.campusId, user.campusName)
    }
  }, [user, selectedCampusId, setCampus])

  const selected: Campus | null = React.useMemo(() => {
    if (selectedCampusId && selectedCampusName) {
      return {
        id: selectedCampusId,
        name: selectedCampusName,
        city: campuses.find((c) => c.id === selectedCampusId)?.city ?? '',
      }
    }
    return null
  }, [selectedCampusId, selectedCampusName, campuses])

  async function handleSelect(c: Campus) {
    setSubmitting(true)
    try {
      const res = await csrfFetch('/api/auth/me/campus', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campusId: c.id }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        user?: { campusName?: string }
        error?: { message?: string }
      }
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Failed (${res.status})`)
      }
      setCampus(c.id, data.user?.campusName ?? c.name)
      toast({
        title: 'Campus switched',
        description: `Now ordering near ${c.name}.`,
      })
      onSwitched?.()
      // Trigger a refresh of the underlying screen so the new restaurant list loads.
      router.refresh()
    } catch (e) {
      toast({
        title: 'Could not switch campus',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <CampusSelector
      campuses={campuses}
      selected={selected}
      onSelect={handleSelect}
      loading={loading || submitting}
      onUseLocation={() =>
        toast({
          title: 'Location services coming soon',
          description: 'GPS-based campus detection is on the roadmap.',
        })
      }
      compact
    />
  )
}

// GJ-02 S3: NotificationBell — bell icon with unread badge
// Repair-C: Bell open is a READ-ONLY toggle. It must NOT mutate server state.
// S5C: Wired to useSocialRealtime — refreshes GET /api/notifications on
// SOCIAL_NOTIFICATION_CREATED events (invalidation signal, NOT state mutation).
// The bell badge + list always reflect authoritative REST/DB truth.
function NotificationBell() {
  const { unreadCount, refresh } = useNotifications()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => { refresh() }, [refresh])

  // S5C: Realtime invalidation for the notification bell.
  // On SOCIAL_NOTIFICATION_CREATED → refresh() refetches authoritative unread count + list.
  // On reconnect → refresh() reconciles any events missed during disconnect.
  // The realtime event is an INVALIDATION SIGNAL ONLY — it does NOT carry
  // unread count or notification body. REST is authoritative.
  useSocialRealtime({
    onInvalidateNotifications: () => {
      void refresh()
    },
    onReconnect: () => {
      void refresh()
    },
  })

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 relative"
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        onClick={() => setOpen(!open)}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50">
          <NotificationList />
        </div>
      )}
    </div>
  )
}

function NotificationList() {
  const { notifications, isLoading, unreadCount, markAsRead, markAllAsRead } = useNotifications()

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>
  if (notifications.length === 0) return <div className="p-4 text-sm text-muted-foreground">No notifications</div>

  return (
    <div>
      {unreadCount > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-popover px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{unreadCount} unread</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs hover:bg-accent" onClick={() => markAllAsRead()}>
            Mark all read
          </Button>
        </div>
      )}
      <div className="divide-y">
        {notifications.slice(0, 10).map((n) => (
          <button
            key={n.id}
            className={`w-full p-3 text-left hover:bg-accent ${!n.read ? 'bg-teal-50 dark:bg-teal-950/20' : ''}`}
            onClick={() => markAsRead(n.id)}
          >
            <p className="text-sm font-medium">{n.title}</p>
            <p className="text-xs text-muted-foreground">{n.body}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
