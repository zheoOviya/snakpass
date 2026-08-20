'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MenuItem } from '@/lib/types'
import { rewardDiscountPaise } from '@/lib/reward-rules'

export interface CartLine {
  menuItemId: string
  name: string
  price: number
  isVeg: boolean
  quantity: number
}

/**
 * Transparent pricing breakdown (blueprint §4 P4 + §12 CART).
 * All amounts are in PAISE (1 ₹ = 100 paise). Use `inr()` to format for display.
 */
export interface CartPricing {
  /** Sum of (line.price × line.quantity) across all lines. */
  subtotal: number
  /** GST placeholder — 5% of subtotal. */
  tax: number
  /** SnakZap low-fee model — 0 for MVP. */
  platformFee: number
  /** Coupon discount — 10% placeholder when couponCode is set. */
  discount: number
  /** Reward points redeemed, converted to paise via rewardDiscountPaise(). */
  rewardDiscount: number
  /** Tip amount (in paise). */
  tip: number
  /** Final total = subtotal + tax + platformFee - discount - rewardDiscount + tip. */
  total: number
}

interface CartState {
  restaurantId: string | null
  restaurantName: string | null
  lines: CartLine[]
  // Additive pricing/cart fields (blueprint §12 CART) -------------------
  /** Applied coupon code (null = no coupon). Server validates at checkout. */
  couponCode: string | null
  /** Reward points the user has chosen to redeem at checkout. */
  rewardPointsToRedeem: number
  /** Requested pickup time (ISO time string or null for ASAP). */
  pickupTime: string | null
  /** Tip amount in PAISE (0 = no tip). */
  tipAmount: number

  // Existing actions ----------------------------------------------------
  add: (item: MenuItem, restaurantId: string, restaurantName: string) => void
  increment: (menuItemId: string) => void
  decrement: (menuItemId: string) => void
  remove: (menuItemId: string) => void
  clear: () => void
  total: () => number
  count: () => number

  // Additive actions (blueprint §12) ------------------------------------
  /** Apply (or clear with null) a coupon code. */
  setCoupon: (code: string | null) => void
  /** Set the number of reward points to redeem at checkout. */
  setRewardPoints: (points: number) => void
  /** Set the requested pickup time (null for ASAP). */
  setPickupTime: (time: string | null) => void
  /** Set the tip amount in paise. */
  setTip: (amount: number) => void
  /** Transparent pricing breakdown per blueprint §4 P4 + §12. */
  pricing: () => CartPricing
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      restaurantId: null,
      restaurantName: null,
      lines: [],
      // Additive pricing/cart fields (blueprint §12) ----------------------
      couponCode: null,
      rewardPointsToRedeem: 0,
      pickupTime: null,
      tipAmount: 0,

      add: (item, restaurantId, restaurantName) => {
        const s = get()
        if (s.restaurantId && s.restaurantId !== restaurantId) {
          // switching restaurant — reset cart + all pricing/cart add-ons
          set({
            restaurantId,
            restaurantName,
            lines: [{ menuItemId: item.id, name: item.name, price: item.price, isVeg: item.isVeg, quantity: 1 }],
            couponCode: null,
            rewardPointsToRedeem: 0,
            pickupTime: null,
            tipAmount: 0,
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
      clear: () => set({
        restaurantId: null,
        restaurantName: null,
        lines: [],
        couponCode: null,
        rewardPointsToRedeem: 0,
        pickupTime: null,
        tipAmount: 0,
      }),
      total: () => get().lines.reduce((s, l) => s + l.price * l.quantity, 0),
      count: () => get().lines.reduce((s, l) => s + l.quantity, 0),

      // Additive actions --------------------------------------------------
      setCoupon: (code) => set({ couponCode: code }),
      setRewardPoints: (points) => set({
        rewardPointsToRedeem: Number.isFinite(points) && points > 0 ? Math.floor(points) : 0,
      }),
      setPickupTime: (time) => set({ pickupTime: time }),
      setTip: (amount) => set({
        tipAmount: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0,
      }),
      pricing: () => {
        const s = get()
        const subtotal = s.lines.reduce((sum, l) => sum + l.price * l.quantity, 0)
        const tax = Math.floor(subtotal * 0.05) // 5% GST placeholder
        const platformFee = 0 // SnakZap low-fee model — 0 for MVP
        const discount = s.couponCode ? Math.floor(subtotal * 0.1) : 0 // 10% placeholder
        const rewardDiscount = rewardDiscountPaise(s.rewardPointsToRedeem)
        const tip = s.tipAmount
        const total = subtotal + tax + platformFee - discount - rewardDiscount + tip
        return { subtotal, tax, platformFee, discount, rewardDiscount, tip, total }
      },
    }),
    { name: 'snakzap-cart' },
  ),
)
