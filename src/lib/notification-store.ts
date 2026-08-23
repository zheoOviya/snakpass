'use client'

import { create } from 'zustand'
import type { Notification } from '@/lib/types'

// GJ-02 S3: Notification store — connected to real API
// GET /api/notifications → list + unread count
// PATCH /api/notifications/[id] → mark as read
// POST /api/notifications/mark-all-read → mark all as read
// Bell open = READ-ONLY toggle (NO auto-mutation)

export interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  isLoading: boolean
  error: string | null

  refresh: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

export const useNotifications = create<NotificationState>()((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  refresh: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch('/api/notifications?limit=50', { headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || `Failed (${res.status})`)
      set({
        notifications: data.notifications ?? [],
        unreadCount: data.unreadCount ?? 0,
        isLoading: false,
        error: null,
      })
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to load notifications' })
    }
  },

  markAsRead: async (id: string) => {
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    // Optimistic: decrement unread + mark local
    const prev = get()
    set({
      notifications: prev.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, prev.unreadCount - 1),
    })
    try {
      const res = await csrfFetch(`/api/notifications/${id}`, { method: 'PATCH' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
    } catch {
      // Rollback — refresh from server
      void get().refresh()
    }
  },

  markAllAsRead: async () => {
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    // Optimistic: set all as read + zero badge
    set({
      notifications: get().notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })
    try {
      const res = await csrfFetch('/api/notifications/mark-all-read', { method: 'POST' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
    } catch {
      // Rollback
      void get().refresh()
    }
  },
}))
