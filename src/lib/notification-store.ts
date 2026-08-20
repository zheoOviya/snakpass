// src/lib/notification-store.ts
//
// Zustand store for the user's notification inbox.
//
// Wraps:
//   - GET   /api/notifications            → Notification[] (most recent first)
//   - PATCH /api/notifications/[id]      → mark single notification as read
//   - POST  /api/notifications/mark-all-read → mark all as read
//
// SSR safety: NOT persisted (notifications are server-authoritative + can
// change between sessions — the unread count must reflect server truth).
//
// Type contract: uses the UI types from src/lib/types (Wave 1B — single source
// of truth for the client/server API shape).
//
// Governance (blueprint §18 SOCIAL GRAPH + plan §1.E):
//   - Notification types: order, reward, gift, social, group, system, campus
//   - Unread count is derived from `notifications.filter((n) => !n.read).length`
//   - markAllRead fires a single POST (server-side bulk update)

'use client'

import { create } from 'zustand'
import type { Notification } from '@/lib/types'

// ---------------------------------------------------------------------------
// Store state + actions
// ---------------------------------------------------------------------------

export interface NotificationState {
  notifications: Notification[]
  /** Derived: notifications.filter((n) => !n.read).length — kept in sync by reducers. */
  unreadCount: number
  isLoading: boolean

  /** Re-fetch notifications. Idempotent read; safe to call repeatedly. */
  refresh: () => Promise<void>

  /** Mark a single notification as read. Optimistic local update + server PATCH. */
  markRead: (id: string) => Promise<void>

  /** Mark all notifications as read. Single bulk POST. */
  markAllRead: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function recount(notifications: Notification[]): number {
  return notifications.reduce((sum, n) => (n.read ? sum : sum + 1), 0)
}

export const useNotifications = create<NotificationState>()((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/notifications?limit=50', {
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        // Non-fatal — leave existing notifications in place (don't blank on blip).
        set({ isLoading: false })
        return
      }
      const data = (await res.json()) as { notifications?: Notification[] }
      const notifications = data.notifications ?? []
      set({
        notifications,
        unreadCount: recount(notifications),
        isLoading: false,
      })
    } catch {
      // Network error — silent fail (notifications are non-critical UI).
      set({ isLoading: false })
    }
  },

  markRead: async (id: string) => {
    if (!id) return
    // Optimistic: flip the local read flag first so the UI updates instantly.
    const prev = get().notifications
    const updated = prev.map((n) =>
      n.id === id && !n.read ? { ...n, read: true } : n,
    )
    set({ notifications: updated, unreadCount: recount(updated) })

    // Fire server PATCH (csrfFetch auto-injects CSRF + idempotency key).
    try {
      const csrfFetch = (await import('./csrf-client')).csrfFetch
      const res = await csrfFetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, read: true }),
      })
      if (!res.ok) {
        // Revert on failure — restore the previous unread state.
        set({ notifications: prev, unreadCount: recount(prev) })
      }
    } catch {
      // Network error — revert.
      set({ notifications: prev, unreadCount: recount(prev) })
    }
  },

  markAllRead: async () => {
    const prev = get().notifications
    if (prev.length === 0 || get().unreadCount === 0) return

    // Optimistic: flip all unread to read.
    const updated = prev.map((n) => (n.read ? n : { ...n, read: true }))
    set({ notifications: updated, unreadCount: 0 })

    try {
      const csrfFetch = (await import('./csrf-client')).csrfFetch
      const res = await csrfFetch('/api/notifications/mark-all-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        // Revert on failure.
        set({ notifications: prev, unreadCount: recount(prev) })
      }
    } catch {
      // Network error — revert.
      set({ notifications: prev, unreadCount: recount(prev) })
    }
  },
}))
