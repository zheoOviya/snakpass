'use client'

// src/components/snak/screens/social-screen.tsx
//
// SocialScreen — Wave 6 Task 6B.
//
// Hosts the Social tab (blueprint §18 SOCIAL GRAPH + §7 IA "Social as optional
// 6th tab"). Renders an internal sub-tab bar with two panes:
//
//   • Feed     — Venmo-style activity feed from friends.
//                  - Each item renders Task 1B's SocialFeedCard.
//                  - Pull-to-refresh (RefreshCw button — desktop PTR is fiddly).
//                  - "Load more" paginates client-side over the store's 30-item
//                    window (true cursor-based pagination lands with Task 6A's
//                    /api/social/feed?cursor= extension).
//                  - Empty state: "No activity yet — add friends to see their
//                    orders here!" with a CTA that switches to the Friends pane.
//
//   • Friends  — Renders FriendsScreen (pending requests + friends list +
//                search). The sub-component is imported + owned here; see
//                friends-screen.tsx for its governance notes.
//
// State sourcing:
//   - Reads feed + connections + isLoading from useSocial (Task 1C owns the
//     store — we CALL its methods, never modify it).
//   - The host subscribes to `refresh` so both panes get re-fetched on pull.
//
// Governance (Task 6B):
//   - Does NOT touch any API route (Task 6A owns /api/social/**).
//   - Does NOT touch social-store.ts (Task 1C owns).
//   - Does NOT touch consumer-view.tsx (Task 3A owns the tab routing — it
//     imports SocialScreen from this file and renders it for the 'social' tab).
//   - Does NOT touch home-screen.tsx (Task 6D may add a Gift CTA — never here).

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import { RefreshCw, Users, Newspaper, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useSocial } from '@/lib/social-store'
import { useUI } from '@/lib/ui-store'
import { SocialFeedCard } from '@/components/snak/social-feed-card'
import { EmptyState } from '@/components/snak/empty-state'
import { SocialFeedSkeleton } from '@/components/snak/skeleton-loader'
import { FriendsScreen } from './friends-screen'
import type { SocialActivity } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants + motion
// ─────────────────────────────────────────────────────────────────────────────

/** Initial visible feed items. Pagination grows by this on each "Load more". */
const FEED_PAGE_SIZE = 8

const FEED_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
}
const FEED_ITEM: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: [0.3, 0, 0, 1] },
  },
}

type SubTab = 'feed' | 'friends'

// ─────────────────────────────────────────────────────────────────────────────
// SocialScreen
// ─────────────────────────────────────────────────────────────────────────────

export interface SocialScreenProps {
  /** Initial sub-tab to show on mount. Defaults to 'feed'. */
  initialSubTab?: SubTab
  className?: string
}

export function SocialScreen({ initialSubTab = 'feed', className }: SocialScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()
  const openRestaurant = useUI((s) => s.openRestaurant)

  // ── social-store hooks (Task 1C) ─────────────────────────────────────────
  const feed = useSocial((s) => s.feed)
  const setFeed = useSocial((s) => s.setFeed)
  const connections = useSocial((s) => s.connections)
  const isLoading = useSocial((s) => s.isLoading)
  const error = useSocial((s) => s.error)
  const refresh = useSocial((s) => s.refresh)

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [subTab, setSubTab] = React.useState<SubTab>(initialSubTab)
  const [visibleCount, setVisibleCount] = React.useState(FEED_PAGE_SIZE)
  const [refreshing, setRefreshing] = React.useState(false)
  const [likingId, setLikingId] = React.useState<string | null>(null)

  // Pull a fresh feed when the screen first mounts. The social-store caches
  // results so additional mounts coalesce (Task 1C handles the dedupe).
  React.useEffect(() => {
    refresh().catch(() => {
      /* best-effort — store surfaces its own error string */
    })
  }, [refresh])

  // Reset visibleCount when the feed list reference changes (refresh / re-fetch).
  React.useEffect(() => {
    setVisibleCount(FEED_PAGE_SIZE)
  }, [feed])

  const friendCount = React.useMemo(
    () => connections.filter((c) => c.status === 'ACCEPTED').length,
    [connections],
  )

  const visibleFeed = React.useMemo(
    () => feed.slice(0, visibleCount),
    [feed, visibleCount],
  )
  const hasMore = feed.length > visibleCount

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await refresh()
      toast({ title: 'Feed refreshed' })
    } catch (e) {
      toast({
        title: 'Could not refresh',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setRefreshing(false)
    }
  }

  async function handleLike(activity: SocialActivity) {
    // S2: Real persistent Like via POST/DELETE /api/social/activities/[id]/like
    if (likingId) return
    setLikingId(activity.id)

    const wasLiked = !!activity.likedByMe
    const oldCount = activity.likeCount ?? 0

    // Optimistic update
    setFeed((prev) =>
      prev.map((a) =>
        a.id === activity.id
          ? { ...a, likedByMe: !wasLiked, likeCount: wasLiked ? oldCount - 1 : oldCount + 1 }
          : a,
      ),
    )

    try {
      const csrfFetch = (await import('@/lib/csrf-client')).csrfFetch
      const method = wasLiked ? 'DELETE' : 'POST'
      const res = await csrfFetch(`/api/social/activities/${activity.id}/like`, { method })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = await res.json()
      // Reconcile with server truth
      setFeed((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? { ...a, likedByMe: data.liked, likeCount: data.likeCount }
            : a,
        ),
      )
    } catch {
      // Rollback to pre-optimistic state
      setFeed((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? { ...a, likedByMe: wasLiked, likeCount: oldCount }
            : a,
        ),
      )
      toast({
        title: 'Could not update like',
        description: 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLikingId(null)
    }
  }

  function handleComment(activity: SocialActivity) {
    toast({
      title: 'Comments coming soon',
      description: `You'll be able to reply to ${activity.actorName}'s activity in a future release.`,
    })
  }

  function handlePress(activity: SocialActivity) {
    if (activity.restaurantId) {
      openRestaurant(activity.restaurantId)
    } else {
      toast({ title: 'Activity detail', description: activity.verb })
    }
  }

  function handleLoadMore() {
    setVisibleCount((c) => c + FEED_PAGE_SIZE)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={cn('mx-auto w-full max-w-2xl px-4 py-6 pb-24', className)}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Social
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            See what your friends are ordering.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh social feed"
          className="shrink-0"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </header>

      {/* ── Sub-tab bar (Feed | Friends) ────────────────────────────────────── */}
      <SubTabBar
        active={subTab}
        onChange={setSubTab}
        feedCount={feed.length}
        friendCount={friendCount}
      />

      {/* ── Partial-failure banner (connections OK, feed 404'd) ───────────────── */}
      {error && subTab === 'feed' && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Some content couldn’t load: {error}. Showing what we have.
          </span>
        </div>
      )}

      {/* ── Pane: Feed ─────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {subTab === 'feed' ? (
          <motion.div
            key="feed"
            initial={prefersReduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.3, 0, 0, 1] }}
            className="mt-4"
          >
            <FeedPane
              feed={visibleFeed}
              loading={isLoading && feed.length === 0}
              refreshing={refreshing}
              hasMore={hasMore}
              hasFriends={friendCount > 0}
              onLike={handleLike}
              onComment={handleComment}
              onPress={handlePress}
              onLoadMore={handleLoadMore}
              onGoToFriends={() => setSubTab('friends')}
              likingId={likingId}
            />
          </motion.div>
        ) : (
          <motion.div
            key="friends"
            initial={prefersReduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.3, 0, 0, 1] }}
            className="mt-4"
          >
            <FriendsScreen />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SubTabBar — internal tab bar with violet accent for active state.
// ═══════════════════════════════════════════════════════════════════════════

interface SubTabBarProps {
  active: SubTab
  onChange: (tab: SubTab) => void
  feedCount: number
  friendCount: number
}

function SubTabBar({ active, onChange, feedCount, friendCount }: SubTabBarProps) {
  const tabs: Array<{ id: SubTab; label: string; Icon: typeof Newspaper; count: number }> = [
    { id: 'feed', label: 'Feed', Icon: Newspaper, count: feedCount },
    { id: 'friends', label: 'Friends', Icon: Users, count: friendCount },
  ]
  return (
    <div
      role="tablist"
      aria-label="Social sub-tabs"
      className="inline-flex h-10 w-full items-center gap-1 rounded-xl bg-muted/60 p-1"
    >
      {tabs.map((t) => {
        const isActive = active === t.id
        const { Icon } = t
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(t.id)}
            className={cn(
              'snak-focus-ring relative inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {t.label}
            {t.count > 0 && (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
                  isActive
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300'
                    : 'bg-muted-foreground/15 text-muted-foreground',
                )}
              >
                {t.count > 99 ? '99+' : t.count}
              </span>
            )}
            {isActive && (
              <motion.span
                layoutId="subtab-underline"
                aria-hidden="true"
                className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-violet-500"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// FeedPane — the Feed sub-tab content.
// ═══════════════════════════════════════════════════════════════════════════

interface FeedPaneProps {
  feed: SocialActivity[]
  loading: boolean
  refreshing: boolean
  hasMore: boolean
  hasFriends: boolean
  onLike: (a: SocialActivity) => void
  onComment: (a: SocialActivity) => void
  onPress: (a: SocialActivity) => void
  onLoadMore: () => void
  onGoToFriends: () => void
  likingId: string | null
}

function FeedPane({
  feed,
  loading,
  refreshing,
  hasMore,
  hasFriends,
  onLike,
  onComment,
  onPress,
  onLoadMore,
  onGoToFriends,
  likingId,
}: FeedPaneProps) {
  const prefersReduced = useReducedMotion()

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading social feed">
        <span className="sr-only">Loading your friends’ activity…</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <SocialFeedSkeleton key={i} />
        ))}
      </div>
    )
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (feed.length === 0) {
    return (
      <EmptyState
        variant="no-friends"
        title="No activity yet"
        description={
          hasFriends
            ? "Your friends haven't ordered yet — check back later for fresh activity here."
            : 'Add friends to see their orders here! Search by name or phone to find people you know.'
        }
        actionLabel={hasFriends ? undefined : 'Find friends'}
        onAction={hasFriends ? undefined : onGoToFriends}
        className="py-10"
      />
    )
  }

  // ── Feed list ───────────────────────────────────────────────────────────────
  return (
    <div>
      {refreshing && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Refreshing…
        </div>
      )}

      <motion.ul
        variants={FEED_CONTAINER}
        initial={prefersReduced ? false : 'hidden'}
        animate="show"
        className="space-y-3"
      >
        {feed.map((a) => (
          <motion.li key={a.id} variants={FEED_ITEM}>
            <SocialFeedCard
              activity={a}
              onLike={onLike}
              onComment={onComment}
              onPress={onPress}
              className={cn(likingId === a.id && 'opacity-60')}
            />
          </motion.li>
        ))}
      </motion.ul>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={onLoadMore}
            className="min-w-[140px]"
          >
            Load more
          </Button>
        </div>
      )}

      {!hasMore && feed.length > FEED_PAGE_SIZE && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          You’re all caught up · {feed.length} {feed.length === 1 ? 'activity' : 'activities'}
        </p>
      )}
    </div>
  )
}

export default SocialScreen
