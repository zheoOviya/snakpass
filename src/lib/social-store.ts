// src/lib/social-store.ts
//
// Zustand store for the user's social graph — friends (bidirectional follows)
// + friend activity feed.
//
// Wraps:
//   - GET   /api/social/connections           → SocialConnection[]
//   - GET   /api/social/feed                  → SocialActivity[] (paginated)
//   - POST  /api/social/connections           → send friend request
//   - PATCH /api/social/connections/[id]      → accept/decline friend request
//   - DELETE /api/social/connections/[id]     → unfollow / unfriend
//
// SSR safety: NOT persisted (social graph is server-authoritative). Re-fetched
// on every mount.
//
// Type contract: uses the UI types from src/lib/types (Wave 1B — single source
// of truth for the client/server API shape).
//
// Governance (blueprint §18 SOCIAL GRAPH + plan §1.E):
//   - Bidirectional follow = friend request + accept (server creates both edges)
//   - Activity feed NEVER exposes payment amounts (server-enforced via Zod)
//   - Privacy: FRIENDS default, PUBLIC opt-in, PRIVATE
//   - shareOrderItems is a user setting (per-user opt-in for item-level activity)

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

  /** S2: Allow direct feed updates (optimistic + reconcile for likes). */
  setFeed: (updater: (prev: SocialActivity[]) => SocialActivity[]) => void

  /** Re-fetch connections + feed. Idempotent read; safe to call repeatedly. */
  refresh: () => Promise<void>

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

      if (connRes.ok) {
        const data = (await connRes.json()) as { connections?: SocialConnection[] }
        connections = data.connections ?? []
      } else {
        const body = await connRes.json().catch(() => ({}))
        errors.push(body?.error || `connections (${connRes.status})`)
      }

      if (feedRes.ok) {
        // S1 Reconstruction: server returns { activities: [...] }, NOT { feed: [...] }.
        // The old `data.feed` key never matched → feed was permanently empty.
        const data = (await feedRes.json()) as { activities?: SocialActivity[] }
        feed = data.activities ?? []
      } else {
        const body = await feedRes.json().catch(() => ({}))
        errors.push(body?.error || `feed (${feedRes.status})`)
      }

      set({
        connections,
        feed,
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
    // Optimistic: append the returned connection so the UI updates immediately.
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
    // Optimistic: flip the local connection status to ACCEPTED.
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
    // Optimistic: remove the declined request from the local list.
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== requestId),
    }))
  },

  unfollow: async (targetUserId: string) => {
    if (!targetUserId) throw new Error('targetUserId required')
    // S1 Reconstruction: use canonical `userId` field (NOT `friendId`).
    // The server returns connections with `userId` = the OTHER user's id.
    const conn = get().connections.find((c) => c.userId === targetUserId)
    if (!conn) {
      throw new Error('Connection not found — refresh and try again')
    }
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    // DELETE /api/social/connections/[id] — requires connection id in path.
    // The old query-param fallback (`?targetUserId=`) was never handled by the route.
    const res = await csrfFetch(`/api/social/connections/${conn.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to unfollow (${res.status})`)
    }
    // Optimistic: remove the edge to this peer (friendships are bidirectional —
    // server deletes both rows; we only have the local edge in state).
    set((s) => ({
      connections: s.connections.filter((c) => c.userId !== targetUserId),
    }))
  },
}))
