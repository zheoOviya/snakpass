// src/lib/group-order-store.ts
//
// Zustand store for the active group order — the order the user is currently
// participating in (as host or member).
//
// Wraps:
//   - GET   /api/group-orders/[id]            → GroupOrder + members + my items
//   - POST  /api/group-orders                 → host creates a new group order
//   - POST  /api/group-orders/[id]/join       → friend joins via share code
//   - POST  /api/group-orders/[id]/items      → add item to my cart
//   - PATCH /api/group-orders/[id]/items/[itemId]  → update my item quantity
//   - DELETE /api/group-orders/[id]/items/[itemId]  → remove my item
//   - POST  /api/group-orders/[id]/confirm    → host confirms → single merged Order
//   - POST  /api/group-orders/[id]/cancel     → host cancels (or member leaves)
//
// SSR safety: NOT persisted (group order state is server-authoritative).
//
// Type contract: uses the UI types from src/lib/types (Wave 1B — single source
// of truth for the client/server API shape).
//
// Governance (blueprint §20 GROUP ORDERING + plan §1.G):
//   - Model A only (host pays entire order) — split payment deferred
//   - Host creates → share code → friends join + add items → host confirm
//     creates a single merged Order via direct prisma call inside withTransaction
//     (NOT via /api/orders POST — avoids modifying that route)
//   - Concurrency: optimistic lock on GroupOrder.version (handled server-side)

'use client'

import { create } from 'zustand'
import type { MenuItem, GroupOrder, GroupOrderMember, GroupOrderItem } from '@/lib/types'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * Group order lifecycle states (blueprint §20). Used for type-safe status
 * comparisons. The GroupOrder.status field itself is `string` (per types.ts
 * Wave 1B) — assign a `GroupOrderStatus` value to compare.
 */
export type GroupOrderStatus = 'OPEN' | 'LOCKED' | 'PLACED' | 'CANCELLED'

// ---------------------------------------------------------------------------
// Store state + actions
// ---------------------------------------------------------------------------

export interface GroupOrderState {
  activeGroupOrder: GroupOrder | null
  members: GroupOrderMember[]
  /** Only the current user's items (the host's cart is also "my items" if host). */
  myItems: GroupOrderItem[]
  isLoading: boolean
  error: string | null

  /** Re-fetch the group order + members + my items by share code. */
  refresh: (shareCode: string) => Promise<void>

  /** Join an existing group order via its share code. */
  join: (shareCode: string) => Promise<void>

  /** Add a menu item to my cart in the active group order. */
  addItem: (menuItem: MenuItem, quantity?: number) => Promise<void>

  /** Remove an item from my cart by menuItemId. */
  removeItem: (menuItemId: string) => Promise<void>

  /** Host confirms → server creates a single merged Order. Returns the new order ID. */
  confirm: () => Promise<string>

  /** Host cancels the group order, OR a member leaves (removes their items + membership). */
  leave: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGroupOrder = create<GroupOrderState>()((set, get) => ({
  activeGroupOrder: null,
  members: [],
  myItems: [],
  isLoading: false,
  error: null,

  refresh: async (shareCode: string) => {
    if (!shareCode) {
      set({ error: 'shareCode required', isLoading: false })
      return
    }
    set({ isLoading: true, error: null })
    try {
      const res = await fetch(
        `/api/group-orders?shareCode=${encodeURIComponent(shareCode)}`,
        { headers: { 'Content-Type': 'application/json' } },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        set({
          isLoading: false,
          error: body?.error || `Failed to load group order (${res.status})`,
        })
        return
      }
      const data = (await res.json()) as {
        groupOrder?: GroupOrder
        members?: GroupOrderMember[]
        myItems?: GroupOrderItem[]
      }
      set({
        activeGroupOrder: data.groupOrder ?? null,
        members: data.members ?? [],
        myItems: data.myItems ?? [],
        isLoading: false,
        error: null,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to refresh group order',
      })
    }
  },

  join: async (shareCode: string) => {
    if (!shareCode) throw new Error('shareCode required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(
      `/api/group-orders/join?shareCode=${encodeURIComponent(shareCode)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to join group order (${res.status})`)
    }
    // After join, refresh full state.
    await get().refresh(shareCode)
  },

  addItem: async (menuItem: MenuItem, quantity = 1) => {
    const go = get().activeGroupOrder
    if (!go) throw new Error('No active group order — join or create one first')
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('quantity must be a positive integer')
    }
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    // Input payload uses `price` (in paise) per the Zod groupOrderItemSchema.
    // Server returns a GroupOrderItem with `pricePaise` + `subtotalPaise` fields.
    const res = await csrfFetch(`/api/group-orders/${go.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to add item (${res.status})`)
    }
    const data = (await res.json()) as { item: GroupOrderItem }
    // Optimistic: append or merge into my items.
    set((s) => {
      const existing = s.myItems.find((i) => i.menuItemId === menuItem.id)
      if (existing) {
        return {
          myItems: s.myItems.map((i) =>
            i.id === existing.id
              ? {
                  ...i,
                  quantity: i.quantity + quantity,
                  subtotalPaise: (i.pricePaise * (i.quantity + quantity)),
                  // updatedAt not in the UI type — server will refresh on next fetch.
                }
              : i,
          ),
        }
      }
      return { myItems: [...s.myItems, data.item] }
    })
  },

  removeItem: async (menuItemId: string) => {
    const go = get().activeGroupOrder
    if (!go) throw new Error('No active group order')
    const existing = get().myItems.find((i) => i.menuItemId === menuItemId)
    if (!existing) return // already removed — no-op
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(
      `/api/group-orders/${go.id}/items/${existing.id}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to remove item (${res.status})`)
    }
    // Optimistic: drop from my items.
    set((s) => ({
      myItems: s.myItems.filter((i) => i.menuItemId !== menuItemId),
    }))
  },

  confirm: async () => {
    const go = get().activeGroupOrder
    if (!go) throw new Error('No active group order')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/group-orders/${go.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to confirm group order (${res.status})`)
    }
    const data = (await res.json()) as { orderId: string; groupOrder: GroupOrder }
    // Update local state with the confirmed group order.
    set({ activeGroupOrder: data.groupOrder })
    return data.orderId
  },

  leave: async () => {
    const go = get().activeGroupOrder
    if (!go) return // nothing to leave
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/group-orders/${go.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to leave group order (${res.status})`)
    }
    // Clear local state.
    set({ activeGroupOrder: null, members: [], myItems: [], error: null })
  },
}))
