// src/lib/social-store.ts
//
// Zustand store for the user's social graph — friends (bidirectional follows)
// + friend activity feed.
//
// S4D Repair-03: Cursor-based pagination for feed.
//   - refresh(): fetches first page (no cursor), replaces feed
//   - loadNextFeedPage(): fetches next page using stored nextCursor, appends
//
// Wraps:
//   - GET   /api/social/connections           → SocialConnection[]
//   - GET   /api/social/feed?cursor=...        → { activities, nextCursor, hasMore }
//   - POST  /api/social/connections            → send friend request
//   - PATCH /api/social/connections/[id]      → accept/decline friend request
//   - DELETE /api/social/connections/[id]      → unfollow / unfriend

'use client'

import { create } from 'zustand'
import type { SocialConnection, SocialActivity } from '@/lib/types'

// ---------------------------------------------------------------------------
// Store state + actions
// ---------------------------------------------------------------------------

export interface SocialState {
  connections: SocialConnection[]
  feed: SocialActivity[]
  isLoading: boolean
  error: string | null

  // S4D: Cursor pagination state
  nextCursor: string | null
  hasMore: boolean
  loadingMore: boolean

  /** S2: Allow direct feed updates (optimistic + reconcile for likes). */
  setFeed: (updater: (prev: SocialActivity[]) => SocialActivity[]) => void

  /** Re-fetch connections + feed (first page). Replaces existing feed. */
  refresh: () => Promise<void>

  /** S4D: Load next feed page using cursor. Appends to existing feed. */
  loadNextFeedPage: () => Promise<void>

  /** Send a friend request to a target user. Server creates a PENDING connection. */
  sendRequest: (targetUserId: string, message?: string) => Promise<void>

  /** Accept a pending friend request. Server flips status → ACCEPTED + creates the reverse edge. */
  acceptRequest: (requestId: string) => Promise<void>

  /** Decline a pending friend request. Server flips status → REJECTED. */
  declineRequest: (requestId: string) => Promise<void>

  /** Unfollow / unfriend a user. Server deletes the connection (both edges for friendships). */
  unfollow: (targetUserId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSocial = create<SocialState>()((set, get) => ({
  connections: [],
  feed: [],
  isLoading: false,
  error: null,

  // S4D: Cursor pagination state
  nextCursor: null,
  hasMore: false,
  loadingMore: false,

  setFeed: (updater) => set((state) => ({ feed: updater(state.feed) })),

  refresh: async () => {
    set({ isLoading: true, error: null })
    try {
      const [connRes, feedRes] = await Promise.all([
        fetch('/api/social/connections', { headers: { 'Content-Type': 'application/json' } }),
        fetch('/api/social/feed?limit=30', { headers: { 'Content-Type': 'application/json' } }),
      ])

      const errors: string[] = []
      let connections: SocialConnection[] = []
      let feed: SocialActivity[] = []
      let nextCursor: string | null = null
      let hasMore = false

      if (connRes.ok) {
        const data = (await connRes.json()) as { connections?: SocialConnection[] }
        connections = data.connections ?? []
      } else {
        const body = await connRes.json().catch(() => ({}))
        errors.push(body?.error || `connections (${connRes.status})`)
      }

      if (feedRes.ok) {
        const data = (await feedRes.json()) as {
          activities?: SocialActivity[]
          nextCursor?: string | null
          hasMore?: boolean
        }
        feed = data.activities ?? []
        nextCursor = data.nextCursor ?? null
        hasMore = data.hasMore ?? false
      } else {
        const body = await feedRes.json().catch(() => ({}))
        errors.push(body?.error || `feed (${feedRes.status})`)
      }

      set({
        connections,
        feed,
        nextCursor,
        hasMore,
        isLoading: false,
        error: errors.length > 0 ? `Partial failure: ${errors.join('; ')}` : null,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to refresh social feed',
      })
    }
  },

  // S4D: Load next feed page using cursor — appends, never replaces
  loadNextFeedPage: async () => {
    const state = get()
    if (!state.hasMore || !state.nextCursor || state.loadingMore) return

    set({ loadingMore: true })
    try {
      const feedRes = await fetch(
        `/api/social/feed?limit=30&cursor=${encodeURIComponent(state.nextCursor)}`,
        { headers: { 'Content-Type': 'application/json' } },
      )

      if (feedRes.ok) {
        const data = (await feedRes.json()) as {
          activities?: SocialActivity[]
          nextCursor?: string | null
          hasMore?: boolean
        }
        const newActivities = data.activities ?? []
        // Append to existing feed, dedup by ID (defensive — API guarantees no duplicates)
        const existingIds = new Set(state.feed.map((a) => a.id))
        const uniqueNew = newActivities.filter((a) => !existingIds.has(a.id))

        set((s) => ({
          feed: [...s.feed, ...uniqueNew],
          nextCursor: data.nextCursor ?? null,
          hasMore: data.hasMore ?? false,
          loadingMore: false,
        }))
      } else {
        const body = await feedRes.json().catch(() => ({}))
        set({
          loadingMore: false,
          error: body?.error || `Failed to load more (${feedRes.status})`,
        })
      }
    } catch (err) {
      set({
        loadingMore: false,
        error: err instanceof Error ? err.message : 'Failed to load more',
      })
    }
  },

  sendRequest: async (targetUserId: string, message?: string) => {
    if (!targetUserId) throw new Error('targetUserId required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch('/api/social/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId, message }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to send request (${res.status})`)
    }
    const data = (await res.json()) as { connection?: SocialConnection }
    if (data.connection) {
      set((s) => ({
        connections: [...s.connections, data.connection!],
      }))
    }
  },

  acceptRequest: async (requestId: string) => {
    if (!requestId) throw new Error('requestId required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/social/connections/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ACCEPT' }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to accept request (${res.status})`)
    }
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === requestId
          ? { ...c, status: 'ACCEPTED', acceptedAt: new Date().toISOString() }
          : c,
      ),
    }))
  },

  declineRequest: async (requestId: string) => {
    if (!requestId) throw new Error('requestId required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/social/connections/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'REJECT' }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to decline request (${res.status})`)
    }
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== requestId),
    }))
  },

  unfollow: async (targetUserId: string) => {
    if (!targetUserId) throw new Error('targetUserId required')
    const conn = get().connections.find((c) => c.userId === targetUserId)
    if (!conn) {
      throw new Error('Connection not found — refresh and try again')
    }
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/social/connections/${conn.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to unfollow (${res.status})`)
    }
    set((s) => ({
      connections: s.connections.filter((c) => c.userId !== targetUserId),
    }))
  },
}))
