// src/lib/rewards-store.ts
//
// Zustand store for the user's reward account + recent ledger entries.
//
// Wraps:
//   - GET  /api/rewards/account   → RewardAccount + recent ledger slice
//   - GET  /api/rewards/ledger    → paginated RewardLedgerEntry[]
//   - POST /api/rewards/redeem    → RewardRedemption (idempotent, single-use code)
//
// SSR safety: NOT persisted (rewards state is server-authoritative —
// re-fetched on every mount). Persist middleware is omitted intentionally.
//
// Type contract: uses the UI types from src/lib/types (Wave 1B — single source
// of truth for the client/server API shape). Wave 2+ API routes MUST return
// these shapes (mapping from Prisma rows in the route handler).
//
// Governance (blueprint §17 REWARDS ENGINE + plan §1.D):
//   - Balance is server-derived from the immutable ledger; this store is a
//     client cache only. The canonical truth is GET /api/rewards/account.
//   - Redeem calls POST /api/rewards/redeem with an idempotency key (csrfFetch
//     auto-injects one) — duplicate calls return the same redemption code.

'use client'

import { create } from 'zustand'
import type { RewardAccount, RewardLedgerEntry } from '@/lib/types'

// ---------------------------------------------------------------------------
// Local types (server-only response shape — not in shared types.ts)
// ---------------------------------------------------------------------------

/**
 * A reward redemption row (1:1 with a REDEEM ledger entry).
 * Not in shared types.ts because Task 1B scoped types.ts to UI-rendered
 * entities; the redemption row is created/returned by the redeem API and
 * shown only briefly (the user copies the code + applies it at checkout).
 */
export interface RewardRedemption {
  id: string
  userId: string
  ledgerEntryId: string
  /** 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT' | 'FREE_ITEM' | 'VENDOR_SPECIFIC' */
  rewardType: string
  discountValue: string
  orderId: string | null
  /** Single-use code (e.g., 'SNZ-RWD-AB12CD'). */
  redemptionCode: string
  redeemedAt: string // ISO datetime
}

// ---------------------------------------------------------------------------
// Store state + actions
// ---------------------------------------------------------------------------

export interface RewardsState {
  account: RewardAccount | null
  recentLedger: RewardLedgerEntry[]
  isLoading: boolean
  error: string | null

  /**
   * Re-fetch the reward account + recent ledger slice for the given user.
   * Safe to call repeatedly (idempotent read). On error, `account` is left
   * unchanged (so the UI doesn't blank out on a transient blip).
   */
  refresh: (userId: string) => Promise<void>

  /**
   * Redeem points for a single-use discount code. On success, optimistically
   * decrements the cached balance (the server is authoritative; the next
   * `refresh()` will reconcile).
   *
   * @returns  The created RewardRedemption (including the code).
   * @throws   If the API rejects (insufficient balance, network error, etc.).
   */
  redeem: (points: number, orderId?: string) => Promise<RewardRedemption>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRewards = create<RewardsState>()((set, get) => ({
  account: null,
  recentLedger: [],
  isLoading: false,
  error: null,

  refresh: async (userId: string) => {
    if (!userId) {
      set({ account: null, recentLedger: [], isLoading: false, error: null })
      return
    }
    set({ isLoading: true, error: null })
    try {
      // Parallel fetch: account summary + recent ledger slice.
      const [accountRes, ledgerRes] = await Promise.all([
        fetch(`/api/rewards/account?userId=${encodeURIComponent(userId)}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch(`/api/rewards/ledger?userId=${encodeURIComponent(userId)}&limit=20`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ])

      if (!accountRes.ok) {
        const body = await accountRes.json().catch(() => ({}))
        set({
          isLoading: false,
          error: body?.error || `Failed to load rewards (${accountRes.status})`,
        })
        return
      }

      const accountData = (await accountRes.json()) as {
        account?: RewardAccount
      }
      // Ledger endpoint failure is non-fatal — keep account, surface a soft warning.
      let ledger: RewardLedgerEntry[] = []
      if (ledgerRes.ok) {
        const ledgerData = (await ledgerRes.json()) as { entries?: RewardLedgerEntry[] }
        ledger = ledgerData.entries ?? []
      }

      set({
        account: accountData.account ?? null,
        recentLedger: ledger,
        isLoading: false,
        error: null,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to refresh rewards',
      })
    }
  },

  redeem: async (points: number, orderId?: string) => {
    if (!Number.isInteger(points) || points <= 0) {
      throw new Error('Points must be a positive integer')
    }
    const current = get().account
    if (current && current.pointsBalance < points) {
      throw new Error(`Insufficient balance (have ${current.pointsBalance}, need ${points})`)
    }

    // CSRF + Idempotency-Key auto-injected by csrfFetch.
    const csrfFetch = (await import('./csrf-client')).csrfFetch
    const res = await csrfFetch('/api/rewards/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, orderId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error || `Redemption failed (${res.status})`)
    }

    const data = (await res.json()) as { redemption: RewardRedemption }

    // Optimistic local decrement — server is authoritative; refresh() reconciles.
    if (current) {
      set({
        account: {
          ...current,
          pointsBalance: Math.max(0, current.pointsBalance - points),
          // lifetimePoints is unchanged on redeem (it tracks lifetime EARN, not net).
          updatedAt: new Date().toISOString(),
        },
        // Prepend a synthetic REDEEM ledger entry so the feed updates immediately.
        recentLedger: [
          {
            id: data.redemption.ledgerEntryId,
            accountId: current.id,
            type: 'REDEEM',
            points: -points,
            balanceAfter: Math.max(0, current.pointsBalance - points),
            reason: orderId ? `redemption:order:${orderId}` : 'redemption:checkout',
            orderId: orderId ?? undefined,
            createdAt: data.redemption.redeemedAt,
          },
          ...get().recentLedger,
        ].slice(0, 50),
      })
    }

    return data.redemption
  },
}))
