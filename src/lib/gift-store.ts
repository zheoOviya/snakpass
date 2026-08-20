// src/lib/gift-store.ts
//
// Zustand store for food gifting — sent + received gifts, with create /
// redeem / cancel actions.
//
// Wraps:
//   - GET   /api/gifts                   → { sent: Gift[], received: Gift[] }
//   - POST  /api/gifts                   → create gift (sender pays via /api/payments)
//   - POST  /api/gifts/[id]/redeem       → recipient redeems (creates ghost Order)
//   - POST  /api/gifts/[id]/cancel       → sender cancels (before payment settles)
//
// SSR safety: NOT persisted (gift state is server-authoritative).
//
// Type contract: uses the UI types from src/lib/types (Wave 1B — single source
// of truth for the client/server API shape).
//
// Governance (blueprint §19 FOOD GIFTING + plan §1.F):
//   - States: CREATED → PAID → AVAILABLE → REDEEMED | EXPIRED | CANCELLED | REFUNDED
//   - Recipient binding + 30-day expiry + single-use redemption code
//   - No double redemption (server-enforced via unique redemptionCode constraint)
//   - Payment/refund separation — sender pays via the EXISTING /api/payments route
//     (no payment-route modification); the Order.note encodes the gift linkage.

'use client'

import { create } from 'zustand'
import type { Gift } from '@/lib/types'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * Gift lifecycle states (blueprint §19). Used for type-safe status comparisons
 * in the UI. The Gift.status field itself is `string` (per types.ts Wave 1B)
 * — assign a `GiftStatus` value to compare.
 */
export type GiftStatus =
  | 'CREATED'
  | 'PAID'
  | 'AVAILABLE'
  | 'REDEEMED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'

/** Payload for createGift — sent to POST /api/gifts. */
export interface CreateGiftPayload {
  recipientId: string
  menuItemId: string
  message?: string
}

// ---------------------------------------------------------------------------
// Store state + actions
// ---------------------------------------------------------------------------

export interface GiftState {
  sentGifts: Gift[]
  receivedGifts: Gift[]
  isLoading: boolean
  error: string | null

  /** Re-fetch sent + received gifts. Idempotent read. */
  refresh: () => Promise<void>

  /**
   * Create a new gift. Returns the CREATED gift row (status === 'CREATED');
   * the caller then pays via /api/payments (referencing the gift in Order.note)
   * to transition it to PAID → AVAILABLE.
   */
  createGift: (payload: CreateGiftPayload) => Promise<Gift>

  /**
   * Recipient redeems a gift by submitting its single-use code. Server creates
   * a NEW zero-amount Order (gift redemption) and transitions the gift to REDEEMED.
   *
   * @throws If the code is invalid, already redeemed, or expired.
   */
  redeemGift: (giftId: string, redemptionCode: string) => Promise<Gift>

  /**
   * Sender cancels a gift (only valid while status === CREATED or PAID —
   * server enforces; throws otherwise). Refund flow is separate (blueprint §19).
   */
  cancelGift: (giftId: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGifts = create<GiftState>()((set, get) => ({
  sentGifts: [],
  receivedGifts: [],
  isLoading: false,
  error: null,

  refresh: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch('/api/gifts', { headers: { 'Content-Type': 'application/json' } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        set({
          isLoading: false,
          error: body?.error || `Failed to load gifts (${res.status})`,
        })
        return
      }
      const data = (await res.json()) as {
        sent?: Gift[]
        received?: Gift[]
      }
      set({
        sentGifts: data.sent ?? [],
        receivedGifts: data.received ?? [],
        isLoading: false,
        error: null,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to refresh gifts',
      })
    }
  },

  createGift: async (payload: CreateGiftPayload) => {
    if (!payload.recipientId) throw new Error('recipientId required')
    if (!payload.menuItemId) throw new Error('menuItemId required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch('/api/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to create gift (${res.status})`)
    }
    const data = (await res.json()) as { gift: Gift }
    // Optimistic: prepend to sent gifts.
    set((s) => ({ sentGifts: [data.gift, ...s.sentGifts] }))
    return data.gift
  },

  redeemGift: async (giftId: string, redemptionCode: string) => {
    if (!giftId) throw new Error('giftId required')
    if (!redemptionCode) throw new Error('redemptionCode required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/gifts/${giftId}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redemptionCode }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to redeem gift (${res.status})`)
    }
    const data = (await res.json()) as { gift: Gift }
    // Optimistic: replace in received gifts.
    set((s) => ({
      receivedGifts: s.receivedGifts.map((g) => (g.id === giftId ? data.gift : g)),
    }))
    return data.gift
  },

  cancelGift: async (giftId: string) => {
    if (!giftId) throw new Error('giftId required')
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch(`/api/gifts/${giftId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Failed to cancel gift (${res.status})`)
    }
    const data = (await res.json()) as { gift: Gift }
    // Optimistic: update the cancelled gift in sent gifts.
    set((s) => ({
      sentGifts: s.sentGifts.map((g) => (g.id === giftId ? data.gift : g)),
    }))
  },
}))
