'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MenuItem } from '@/lib/types'

export interface CartLine {
  menuItemId: string
  name: string
  price: number
  isVeg: boolean
  quantity: number
}

interface CartState {
  restaurantId: string | null
  restaurantName: string | null
  lines: CartLine[]
  add: (item: MenuItem, restaurantId: string, restaurantName: string) => void
  increment: (menuItemId: string) => void
  decrement: (menuItemId: string) => void
  remove: (menuItemId: string) => void
  clear: () => void
  total: () => number
  count: () => number
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      restaurantId: null,
      restaurantName: null,
      lines: [],
      add: (item, restaurantId, restaurantName) => {
        const s = get()
        if (s.restaurantId && s.restaurantId !== restaurantId) {
          // switching restaurant — reset cart
          set({
            restaurantId,
            restaurantName,
            lines: [{ menuItemId: item.id, name: item.name, price: item.price, isVeg: item.isVeg, quantity: 1 }],
          })
          return
        }
        const existing = s.lines.find((l) => l.menuItemId === item.id)
        if (existing) {
          set({ lines: s.lines.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l)) })
        } else {
          set({ restaurantId, restaurantName, lines: [...s.lines, { menuItemId: item.id, name: item.name, price: item.price, isVeg: item.isVeg, quantity: 1 }] })
        }
      },
      increment: (menuItemId) =>
        set((s) => ({ lines: s.lines.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: l.quantity + 1 } : l)) })),
      decrement: (menuItemId) =>
        set((s) => ({
          lines: s.lines
            .map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: l.quantity - 1 } : l))
            .filter((l) => l.quantity > 0),
        })),
      remove: (menuItemId) => set((s) => ({ lines: s.lines.filter((l) => l.menuItemId !== menuItemId) })),
      clear: () => set({ restaurantId: null, restaurantName: null, lines: [] }),
      total: () => get().lines.reduce((s, l) => s + l.price * l.quantity, 0),
      count: () => get().lines.reduce((s, l) => s + l.quantity, 0),
    }),
    { name: 'snakzap-cart' },
  ),
)
