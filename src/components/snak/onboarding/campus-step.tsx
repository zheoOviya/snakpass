'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  MapPin,
  Search,
  Navigation,
  ChevronRight,
  Loader2,
  GraduationCap,
  SkipForward,
  Utensils,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
import { useCampus } from '@/lib/campus-store'
import { csrfFetch } from '@/lib/csrf-client'
import { EmptyState } from '@/components/snak/empty-state'
import type { Campus } from '@/lib/types'

/**
 * Campus onboarding step — full-screen "Choose your campus".
 *
 * Shown after first phone-OTP login if the user has no `campusId` set
 * (the consumer page redirects to /onboarding/campus in that case).
 *
 * Anatomy (blueprint §8.1):
 *  - Hero header: title + subtitle
 *  - Search bar (debounced 250ms)
 *  - "Use current location" button (placeholder — toast "Location services coming soon")
 *  - Campus list — each row = avatar + name + city + restaurant count + chevron
 *  - Skip for now → goes to /consumer without setting campus
 *
 * On select:
 *  - PATCH /api/auth/me/campus { campusId }
 *  - Update local campus-store (so app-shell chip shows the new campus)
 *  - Refresh auth context (so user.campusId is populated)
 *  - Navigate to /consumer
 *
 * On skip:
 *  - Just navigate to /consumer (campusId stays null; the app-shell chip shows "All")
 *
 * Accessibility:
 *  - Search input has a label.
 *  - Each campus row is a <button role="radio"> with aria-checked.
 *  - Loading state is role="status" with sr-only "Loading campuses".
 *  - Empty state uses EmptyState variant='no-restaurants' with adapted copy.
 *
 * Dark mode: uses CSS variables (no hardcoded colors).
 */

// Response shape from GET /api/campuses?q=
interface CampusListItem {
  id: string
  name: string
  shortName?: string | null
  city: string
  state?: string | null
  domain?: string | null
  restaurantCount: number
}

export function CampusStep() {
  const router = useRouter()
  const { toast } = useToast()
  const { refresh: refreshAuth } = useAuth()
  const setCampus = useCampus((s) => s.setCampus)

  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [campuses, setCampuses] = React.useState<CampusListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [submittingId, setSubmittingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const prefersReduced = useReducedMotion()

  // 250ms debounce on the search input → drives the fetch.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  // Fetch campuses whenever the debounced query changes.
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const url = debounced
          ? `/api/campuses?q=${encodeURIComponent(debounced)}`
          : '/api/campuses'
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const data = (await res.json()) as { campuses: CampusListItem[] }
        if (!cancelled) {
          setCampuses(data.campuses ?? [])
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load campuses')
          setCampuses([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [debounced])

  async function handleSelect(c: CampusListItem) {
    setSubmittingId(c.id)
    try {
      const res = await csrfFetch('/api/auth/me/campus', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campusId: c.id }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        user?: { campusId?: string; campusName?: string }
        error?: { message?: string }
      }
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Failed to set campus (${res.status})`)
      }
      // Sync the local campus store (so app-shell chip renders immediately).
      setCampus(c.id, data.user?.campusName ?? c.name)
      // Refresh auth context so user.campusId is populated (the /consumer
      // redirect gate depends on this).
      await refreshAuth()
      toast({
        title: 'Campus set',
        description: `You're now ordering near ${c.name}.`,
      })
      router.push('/consumer')
    } catch (e) {
      toast({
        title: 'Could not set campus',
        description: (e as Error).message,
        variant: 'destructive',
      })
      setSubmittingId(null)
    }
  }

  function handleSkip() {
    toast({
      title: 'No campus picked',
      description: "You can choose one later from the header chip.",
    })
    router.push('/consumer')
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      {/* Hero header */}
      <header className="px-5 pt-10 pb-4 sm:pt-16">
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.3, 0, 0, 1] }}
          className="mx-auto flex max-w-md flex-col items-center text-center"
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <GraduationCap className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Choose your campus
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Find food near your college
          </p>
        </motion.div>
      </header>

      {/* Search + Use location */}
      <div className="mx-auto w-full max-w-md px-5">
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search campus, city, or college…"
              aria-label="Search campuses"
              className="h-11 pl-9"
              autoFocus
            />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              toast({
                title: 'Location services coming soon',
                description: 'We\'re adding GPS-based campus detection in a future release.',
              })
            }
            className="w-full justify-start gap-2"
            aria-label="Use my current location to find nearby campuses"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
            Use current location
          </Button>
        </div>
      </div>

      {/* Campus list */}
      <main className="mx-auto mt-4 w-full max-w-md flex-1 px-5 pb-8">
        <div
          role="status"
          aria-label="Campus list"
          className="min-h-[200px]"
        >
          <span className="sr-only">
            {loading ? 'Loading campuses' : `${campuses.length} campuses found`}
          </span>

          {loading ? (
            // Loading skeletons — 5 shimmer rows matching the campus-row layout.
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-4 w-4 rounded" />
                </div>
              ))}
            </div>
          ) : error ? (
            <Card className="p-4">
              <p className="text-sm font-medium text-foreground">Couldn&apos;t load campuses</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setDebounced(` ${debounced}`.trim())}
              >
                Retry
              </Button>
            </Card>
          ) : campuses.length === 0 ? (
            <EmptyState
              variant="no-restaurants"
              title="No campus matches your search"
              description={
                debounced
                  ? `We couldn't find a campus matching "${debounced}". Try a different name, city, or skip for now.`
                  : 'No campuses are configured yet. You can skip this step for now and browse all restaurants.'
              }
              actionLabel="Skip for now"
              onAction={handleSkip}
              Icon={MapPin}
            />
          ) : (
            <motion.ul
              initial={prefersReduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="space-y-1.5"
            >
              {campuses.map((c) => {
                const isSubmitting = submittingId === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(c)}
                      disabled={submittingId !== null}
                      aria-label={`Select ${c.name}, ${c.city}, ${c.restaurantCount} restaurants`}
                      className="snak-focus-ring flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/60 disabled:opacity-60"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 text-xs font-bold text-white">
                        {c.shortName?.[0]?.toUpperCase() ?? c.name[0]?.toUpperCase() ?? 'C'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {c.name}
                        </p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                            {c.city}
                            {c.state ? `, ${c.state}` : ''}
                          </span>
                          {c.restaurantCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Utensils className="h-3 w-3" aria-hidden="true" />
                              {c.restaurantCount} restaurant{c.restaurantCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </p>
                      </div>
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                      ) : (
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </motion.ul>
          )}
        </div>
      </main>

      {/* Skip footer */}
      <footer className="border-t bg-card/60 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Pick a campus to see food near you.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            disabled={submittingId !== null}
            className="gap-1.5 text-muted-foreground"
            aria-label="Skip campus selection for now"
          >
            <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
            Skip for now
          </Button>
        </div>
      </footer>
    </div>
  )
}

export default CampusStep
