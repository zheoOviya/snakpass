'use client'

import * as React from 'react'
import { MapPin, Search, ChevronDown, Navigation, Loader2 } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { Campus } from '@/lib/types'

/**
 * Campus selector — top-bar chip + bottom-sheet picker.
 * Per DESIGN_SYSTEM.md §5.3.2:
 * - Mobile: chip in app bar, bottom-sheet on tap.
 * - Sheet anatomy: header + search + "use current location" + list + org-code link.
 *
 * States:
 * - Loading campuses → skeleton rows in sheet.
 * - Empty search → "No campus matches" + org-code suggestion.
 * - Geolocation denied → friendly hint.
 *
 * Accessibility:
 * - Chip is a `<button>` with aria-haspopup="dialog" + aria-expanded.
 * - Each campus row is a `<button>` with aria-label "Select {name}, {distance} km".
 * - Search input has label.
 * - Sheet has SheetTitle + SheetDescription for screen readers.
 *
 * Dark mode: uses CSS variables (no hardcoded colors).
 */

export interface CampusSelectorProps {
  /** All known campuses to display in the sheet. */
  campuses: Campus[]
  /** Currently-selected campus (controls the chip label). Null during onboarding. */
  selected: Campus | null
  /** Called when the user picks a campus. */
  onSelect: (campus: Campus) => void
  /** Whether the campus list is loading (controls skeleton rows). */
  loading?: boolean
  /** Called when "Use current location" is tapped. Should populate `campuses` with nearby. */
  onUseLocation?: () => void
  /** Whether geolocation is currently being requested. */
  locating?: boolean
  /** Optional className for the chip wrapper. */
  className?: string
  /** Compact chip — hides the chevron + reduces padding (used in app bar on mobile). */
  compact?: boolean
}

export function CampusSelector({
  campuses,
  selected,
  onSelect,
  loading = false,
  onUseLocation,
  locating = false,
  className,
  compact = false,
}: CampusSelectorProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const prefersReduced = useReducedMotion()

  const filtered = React.useMemo(() => {
    if (!query.trim()) return campuses
    const q = query.toLowerCase()
    return campuses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.shortName ?? '').toLowerCase().includes(q),
    )
  }, [campuses, query])

  function handleSelect(c: Campus) {
    onSelect(c)
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={selected ? `Change campus. Current: ${selected.name}` : 'Select your campus'}
        className={cn(
          'snak-focus-ring inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5',
          'text-sm font-medium text-foreground shadow-xs',
          'hover:bg-accent hover:text-accent-foreground transition-colors',
          'max-w-[200px] sm:max-w-[240px]',
          compact && 'px-2.5 py-1',
          className,
        )}
      >
        <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate">
          {selected ? selected.shortName ?? selected.name : 'Select campus'}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="flex flex-col gap-0 rounded-t-3xl p-0 sm:max-w-md"
          aria-describedby="campus-selector-desc"
        >
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-lg font-semibold">Select your campus</SheetTitle>
            <SheetDescription id="campus-selector-desc" className="text-sm text-muted-foreground">
              We&apos;ll show you restaurants and friends near your campus.
            </SheetDescription>
          </SheetHeader>

          {/* Search + use location */}
          <div className="space-y-3 px-5 pt-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search campus or city…"
                aria-label="Search campuses"
                className="pl-9"
              />
            </div>

            {onUseLocation && (
              <Button
                type="button"
                variant="outline"
                onClick={onUseLocation}
                disabled={locating}
                className="w-full justify-start gap-2"
                aria-label="Use my current location to find nearby campuses"
              >
                {locating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                )}
                {locating ? 'Locating…' : 'Use current location'}
              </Button>
            )}
          </div>

          {/* Campus list */}
          <div
            className="snak-scroll mt-2 flex-1 overflow-y-auto px-2 py-2"
            role="listbox"
            aria-label="Campuses"
          >
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div
                  key="loading"
                  initial={prefersReduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2 px-3 py-2"
                  aria-hidden="true"
                >
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : filtered.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={prefersReduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-5 py-8 text-center"
                >
                  <p className="text-sm font-medium text-foreground">
                    No campus matches &quot;{query}&quot;
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try a different name, or use an organisation code.
                  </p>
                </motion.div>
              ) : (
                <motion.ul
                  key="list"
                  initial={prefersReduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-1"
                >
                  {filtered.map((c) => {
                    const isSelected = selected?.id === c.id
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(c)}
                          aria-label={`Select ${c.name}${c.distanceKm ? `, ${c.distanceKm} km away` : ''}`}
                          className={cn(
                            'snak-focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                            isSelected ? 'bg-accent' : 'hover:bg-accent/60',
                          )}
                        >
                          <Avatar className="h-10 w-10">
                            {c.logoUrl ? (
                              <AvatarImage src={c.logoUrl} alt="" />
                            ) : null}
                            <AvatarFallback className="bg-gradient-to-br from-teal-400 to-emerald-500 text-xs font-bold text-white">
                              {c.shortName?.[0]?.toUpperCase() ?? c.name[0]?.toUpperCase() ?? 'C'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {c.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.city}
                              {c.state ? `, ${c.state}` : ''}
                              {typeof c.distanceKm === 'number' && (
                                <> · {c.distanceKm.toFixed(1)} km away</>
                              )}
                            </p>
                          </div>
                          {isSelected && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-primary"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default CampusSelector
