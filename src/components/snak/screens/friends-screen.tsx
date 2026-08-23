'use client'

// src/components/snak/screens/friends-screen.tsx
//
// FriendsScreen — Friends sub-tab content for the Social screen (Wave 6 Task 6B).
//
// Per blueprint §18 SOCIAL GRAPH + DESIGN_SYSTEM.md §5.2.7 (Friends list):
//  - Search bar (debounced 250ms) → GET /api/social/search?q=
//  - Pending requests section:
//      • Incoming (status === 'PENDING_RECEIVED') — Accept / Reject buttons
//      • Outgoing (status === 'PENDING_SENT') — "Pending" label
//  - Current friends list (status === 'ACCEPTED'):
//      avatar + name + phone + "Message" (placeholder toast) + "Unfriend" button
//  - Search results: each row shows "Add friend" button (calls sendRequest).
//    Already-connected users are excluded client-side.
//
// State sourcing:
//  - Reads `connections` + mutation methods from `useSocial` (Task 1C owns the
//    store — we CALL its methods, never modify it).
//  - Search results are fetched locally (the social-store has no `search`
//    method by design — search is a transient, non-cached query).
//
// Governance (Task 6B):
//  - Does NOT touch any API route (Task 6A owns /api/social/**).
//  - Does NOT touch social-store.ts (Task 1C owns).
//  - Does NOT touch consumer-view.tsx (Task 3A owns the tab routing).
//  - Resilient to missing endpoints — surfaces a soft "Couldn't load" toast.

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  Search,
  UserPlus,
  Check,
  X,
  MessageCircle,
  UserMinus,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useSocial } from '@/lib/social-store'
import { EmptyState } from '@/components/snak/empty-state'
import { SocialFeedSkeleton } from '@/components/snak/skeleton-loader'
import type { SocialConnection } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Motion presets — stagger pattern per DESIGN_SYSTEM.md §6.4
// ─────────────────────────────────────────────────────────────────────────────

const LIST_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
}
const LIST_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.3, 0, 0, 1] },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A user result from GET /api/social/search?q=. The backend may evolve the
 *  shape; we tolerate missing fields and only require `id` + `name`. */
export interface SocialSearchUser {
  id: string
  name: string
  phone?: string
  avatarUrl?: string
  campusName?: string
}

export interface FriendsScreenProps {
  /** Optional className override (host can wrap with extra padding). */
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// FriendsScreen
// ─────────────────────────────────────────────────────────────────────────────

export function FriendsScreen({ className }: FriendsScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()

  // ── social-store hooks (Task 1C) ─────────────────────────────────────────
  const connections = useSocial((s) => s.connections)
  const isLoading = useSocial((s) => s.isLoading)
  const refresh = useSocial((s) => s.refresh)
  const sendRequest = useSocial((s) => s.sendRequest)
  const acceptRequest = useSocial((s) => s.acceptRequest)
  const declineRequest = useSocial((s) => s.declineRequest)
  const unfollow = useSocial((s) => s.unfollow)

  // ── Derived slices ─────────────────────────────────────────────────────────
  const pendingIn = React.useMemo(
    // S1 Reconstruction: server returns 'PENDING_RECEIVED' (they sent to me)
    () => connections.filter((c) => c.status === 'PENDING_RECEIVED'),
    [connections],
  )
  const pendingOut = React.useMemo(
    // S1 Reconstruction: server returns 'PENDING_SENT' (I sent to them)
    () => connections.filter((c) => c.status === 'PENDING_SENT'),
    [connections],
  )
  const friends = React.useMemo(
    () =>
      connections
        .filter((c) => c.status === 'ACCEPTED')
        // newest accepted first (acceptedAt ?? createdAt fallback)
        .sort((a, b) => {
          const at = (t?: string | null) => (t ? new Date(t).getTime() : 0)
          return at(b.acceptedAt) - at(a.acceptedAt)
        }),
    [connections],
  )

  // Set of friend IDs (any status) for client-side exclusion of search results.
  const connectedIds = React.useMemo(
    () => new Set(connections.map((c) => c.userId)),
    [connections],
  )

  // ── Search state (local — not in social-store by design) ───────────────────
  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [results, setResults] = React.useState<SocialSearchUser[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)
  // Track outgoing requests that succeeded locally so we can flip the row's
  // button to "Pending" without waiting for a refresh.
  const [pendingSentIds, setPendingSentIds] = React.useState<Set<string>>(new Set())

  // 250ms debounce — only triggers a fetch when query length ≥ 2.
  React.useEffect(() => {
    const q = query.trim()
    if (q === debounced) return
    const t = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(t)
  }, [query, debounced])

  // Fetch search results whenever the debounced query changes.
  React.useEffect(() => {
    const q = debounced.trim()
    if (q.length < 2) {
      setResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    setSearchError(null)
    fetch(`/api/social/search?q=${encodeURIComponent(q)}`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Search failed (${res.status})`)
        }
        const data = (await res.json()) as { users?: SocialSearchUser[] }
        if (!cancelled) {
          setResults(data.users ?? [])
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSearchError(err instanceof Error ? err.message : 'Search failed')
          setResults([])
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  // ── Action handlers ─────────────────────────────────────────────────────────
  async function handleAccept(conn: SocialConnection) {
    try {
      await acceptRequest(conn.id)
      toast({
        title: 'Friend request accepted',
        description: `${conn.name} is now your friend.`,
      })
    } catch (e) {
      toast({
        title: 'Could not accept request',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  async function handleReject(conn: SocialConnection) {
    try {
      await declineRequest(conn.id)
      toast({
        title: 'Request declined',
        description: `${conn.name}'s request was dismissed.`,
      })
    } catch (e) {
      toast({
        title: 'Could not decline request',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  async function handleUnfriend(conn: SocialConnection) {
    // Optimistic confirmation — friend removal is destructive.
    const ok = window.confirm(
      `Unfriend ${conn.name}? They won't be notified, but you'll need to send a new request to reconnect.`,
    )
    if (!ok) return
    try {
      await unfollow(conn.userId)
      toast({
        title: 'Unfriended',
        description: `${conn.name} is no longer your friend.`,
      })
    } catch (e) {
      toast({
        title: 'Could not unfriend',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  // S4A: Block + Unblock handlers (authorized by S4A repair directive Phase 7)
  async function handleBlock(conn: SocialConnection) {
    const ok = window.confirm(`Block ${conn.name}? They won't be able to send you requests or see your friends-only content.`)
    if (!ok) return
    try {
      const csrfFetch = (await import('@/lib/csrf-client')).csrfFetch
      const res = await csrfFetch(`/api/social/connections/${conn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'BLOCK' }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      toast({ title: 'Blocked', description: `${conn.name} has been blocked.` })
      await refresh()
    } catch (e) {
      toast({ title: 'Could not block', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function handleUnblock(conn: SocialConnection) {
    try {
      const csrfFetch = (await import('@/lib/csrf-client')).csrfFetch
      const res = await csrfFetch(`/api/social/connections/${conn.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UNBLOCK' }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      toast({ title: 'Unblocked', description: `${conn.name} has been unblocked.` })
      await refresh()
    } catch (e) {
      toast({ title: 'Could not unblock', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function handleSendMessage(conn: SocialConnection) {
    // Placeholder — messaging is on the Wave 8+ roadmap (blueprint §22).
    toast({
      title: 'Messaging coming soon',
      description: `You'll be able to message ${conn.name} in a future release.`,
    })
  }

  async function handleAddFriend(user: SocialSearchUser) {
    try {
      await sendRequest(user.id)
      setPendingSentIds((s) => new Set(s).add(user.id))
      toast({
        title: 'Friend request sent',
        description: `Waiting for ${user.name} to accept.`,
      })
    } catch (e) {
      toast({
        title: 'Could not send request',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  function handleRefresh() {
    refresh().catch(() => {
      /* best-effort — store surfaces its own error */
    })
  }

  const hasSearchQuery = debounced.trim().length >= 2
  const filteredResults = React.useMemo(
    () => results.filter((u) => !connectedIds.has(u.id) && !pendingSentIds.has(u.id)),
    [results, connectedIds, pendingSentIds],
  )

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (isLoading && connections.length === 0) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading friends">
        <span className="sr-only">Loading your friends…</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <SocialFeedSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className={cn('space-y-5', className)}>
      {/* ── Search bar ─────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone…"
          aria-label="Search for friends"
          className="h-11 rounded-xl pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="snak-focus-ring absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ── SEARCH RESULTS mode ─────────────────────────────────────────────── */}
      {hasSearchQuery && (
        <section aria-label="Search results" className="space-y-2">
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {searching
                ? 'Searching…'
                : `${filteredResults.length} ${filteredResults.length === 1 ? 'result' : 'results'}`}
            </h2>
          </header>

          {searching ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <SocialFeedSkeleton key={i} />
              ))}
            </div>
          ) : searchError ? (
            <Card>
              <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4 text-danger-600" aria-hidden="true" />
                <span>{searchError}</span>
              </CardContent>
            </Card>
          ) : filteredResults.length === 0 ? (
            <EmptyState
              variant="no-friends"
              title="No users found"
              description={
                results.length === 0
                  ? `No one matching "${debounced}". Try a different name or phone.`
                  : 'Everyone matching your search is already your friend or has a pending request.'
              }
              className="py-8"
            />
          ) : (
            <motion.ul
              variants={LIST_CONTAINER}
              initial={prefersReduced ? false : 'hidden'}
              animate="show"
              className="space-y-2"
            >
              <AnimatePresence>
                {filteredResults.map((u) => (
                  <motion.li key={u.id} variants={LIST_ITEM} exit={{ opacity: 0 }}>
                    <SearchResultRow
                      user={u}
                      pending={pendingSentIds.has(u.id)}
                      onAdd={() => handleAddFriend(u)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </section>
      )}

      {/* ── DEFAULT mode (no active search) ────────────────────────────────── */}
      {!hasSearchQuery && (
        <motion.div
          variants={LIST_CONTAINER}
          initial={prefersReduced ? false : 'hidden'}
          animate="show"
          className="space-y-5"
        >
          {/* Pending incoming requests */}
          <section aria-labelledby="friends-pending-in">
            <header className="mb-2 flex items-center justify-between gap-2">
              <h2
                id="friends-pending-in"
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden="true" />
                Incoming Requests
                {pendingIn.length > 0 && (
                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                    {pendingIn.length}
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={handleRefresh}
                className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
                aria-label="Refresh friends list"
              >
                Refresh
              </button>
            </header>

            {pendingIn.length === 0 ? (
              <p className="rounded-lg bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
                No pending requests.
              </p>
            ) : (
              <motion.ul variants={LIST_CONTAINER} className="space-y-2">
                {pendingIn.map((c) => (
                  <motion.li key={c.id} variants={LIST_ITEM}>
                    <PendingRequestRow
                      conn={c}
                      direction="in"
                      onAccept={() => handleAccept(c)}
                      onReject={() => handleReject(c)}
                    />
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </section>

          {/* Pending outgoing requests */}
          {pendingOut.length > 0 && (
            <section aria-labelledby="friends-pending-out">
              <h2
                id="friends-pending-out"
                className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                Sent Requests
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {pendingOut.length}
                </span>
              </h2>
              <motion.ul variants={LIST_CONTAINER} className="space-y-2">
                {pendingOut.map((c) => (
                  <motion.li key={c.id} variants={LIST_ITEM}>
                    <PendingRequestRow conn={c} direction="out" />
                  </motion.li>
                ))}
              </motion.ul>
            </section>
          )}

          {/* Current friends list */}
          <section aria-labelledby="friends-list">
            <h2
              id="friends-list"
              className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              Your Friends
              {friends.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {friends.length}
                </span>
              )}
            </h2>

            {friends.length === 0 ? (
              <EmptyState
                variant="no-friends"
                title="No friends yet"
                description="Search by name or phone above to find people you know on SnakZap."
                className="py-6"
              />
            ) : (
              <motion.ul variants={LIST_CONTAINER} className="space-y-2">
                {friends.map((c) => (
                  <motion.li key={c.id} variants={LIST_ITEM}>
                    <FriendRow
                      conn={c}
                      onMessage={() => handleSendMessage(c)}
                      onUnfriend={() => handleUnfriend(c)}
                      onBlock={() => handleBlock(c)}
                      onUnblock={() => handleUnblock(c)}
                    />
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </section>
        </motion.div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Row components
// ═══════════════════════════════════════════════════════════════════════════

interface PendingRequestRowProps {
  conn: SocialConnection
  direction: 'in' | 'out'
  onAccept?: () => void
  onReject?: () => void
}

function PendingRequestRow({ conn, direction, onAccept, onReject }: PendingRequestRowProps) {
  const [busy, setBusy] = React.useState<'accept' | 'reject' | null>(null)

  async function run(action: 'accept' | 'reject') {
    setBusy(action)
    try {
      if (action === 'accept') await onAccept?.()
      else await onReject?.()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-3">
        <Avatar className="h-10 w-10 ring-2 ring-violet-300 ring-offset-2 ring-offset-background">
          <AvatarFallback className="bg-gradient-to-br from-violet-400 to-violet-600 text-xs font-bold text-white">
            {initials(conn.name) || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{conn.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {conn.phone ?? 'SnakZap user'}
          </p>
        </div>
        {direction === 'in' ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => run('accept')}
              disabled={busy !== null}
              className="h-8 bg-violet-600 px-3 text-xs hover:bg-violet-700"
              aria-label={`Accept ${conn.name}'s friend request`}
            >
              {busy === 'accept' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => run('reject')}
              disabled={busy !== null}
              className="h-8 px-3 text-xs"
              aria-label={`Decline ${conn.name}'s friend request`}
            >
              {busy === 'reject' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Reject
            </Button>
          </div>
        ) : (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            aria-label="Waiting for response"
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            Pending
          </span>
        )}
      </CardContent>
    </Card>
  )
}

interface FriendRowProps {
  conn: SocialConnection
  onMessage: () => void
  onUnfriend: () => void
  onBlock: () => void
  onUnblock: () => void
}

function FriendRow({ conn, onMessage, onUnfriend, onBlock, onUnblock }: FriendRowProps) {
  const [busy, setBusy] = React.useState(false)
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-3">
        <Avatar className="h-10 w-10 ring-2 ring-teal-300 ring-offset-2 ring-offset-background">
          <AvatarFallback className="bg-gradient-to-br from-teal-400 to-emerald-600 text-xs font-bold text-white">
            {initials(conn.name) || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{conn.name}</p>
          {conn.phone && (
            <p className="truncate text-xs text-muted-foreground">{conn.phone}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onMessage}
            className="h-8 px-2.5 text-xs"
            aria-label={`Message ${conn.name}`}
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only sm:inline">Message</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={async () => {
              setBusy(true)
              try {
                await onUnfriend()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="h-8 px-2.5 text-xs text-muted-foreground hover:bg-danger-50 hover:text-danger-700 dark:hover:bg-danger-950/30 dark:hover:text-danger-300"
            aria-label={`Unfriend ${conn.name}`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="sr-only sm:inline">Unfriend</span>
          </Button>
          {conn.status === 'BLOCKED' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => { setBusy(true); try { await onUnblock() } finally { setBusy(false) } }}
              disabled={busy}
              className="h-8 px-2.5 text-xs"
              aria-label={`Unblock ${conn.name}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              <span className="sr-only sm:inline">Unblock</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => { setBusy(true); try { await onBlock() } finally { setBusy(false) } }}
              disabled={busy}
              className="h-8 px-2.5 text-xs"
              aria-label={`Block ${conn.name}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              <span className="sr-only sm:inline">Block</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

interface SearchResultRowProps {
  user: SocialSearchUser
  pending: boolean
  onAdd: () => void
}

function SearchResultRow({ user, pending, onAdd }: SearchResultRowProps) {
  const [busy, setBusy] = React.useState(false)
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-3">
        <Avatar className="h-10 w-10">
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
          <AvatarFallback className="bg-muted text-xs font-bold text-foreground">
            {initials(user.name) || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {user.phone ?? user.campusName ?? 'SnakZap user'}
          </p>
        </div>
        {pending ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
            aria-label="Request sent, waiting for response"
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            Pending
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              setBusy(true)
              try {
                await onAdd()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            className="h-8 shrink-0 bg-violet-600 px-3 text-xs hover:bg-violet-700"
            aria-label={`Send friend request to ${user.name}`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Add friend
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default FriendsScreen
