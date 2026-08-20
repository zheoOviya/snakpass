// src/lib/ui-store.ts
//
// Zustand store for the consumer app's active bottom-nav tab + screen-host
// coordination (blueprint §7 IA + Task 2B consumer-view rewrite).
//
// The BottomNav (Task 1B) lives in the AppShell header/footer chrome, while
// the screen-routing logic lives in ConsumerView. Both need to read/write
// the active tab without prop-drilling through app-shell → consumer-view →
// every nested screen. A tiny Zustand store is the cleanest decoupling.
//
// SSR safety: NOT persisted (the active tab is a transient UX state — on
// reload we want to land back on Home, not wherever the user last was).
// The store is module-level so the value survives React re-renders but
// not page reloads, which is the desired behaviour.
//
// Tab model: matches Task 1B's BottomNavTab exactly (home / explore / social
// / orders / rewards / profile).
//
// Wave 6 expansion (Task 6B): Profile is split out from the Social tab so the
// bar grows to 6 items. The Social tab now hosts the real social feed
// (Task 6B's SocialScreen with Feed + Friends sub-tabs); the Profile tab
// hosts the user's ProfileScreen (Task 2B's existing placeholder).
//
// Earlier (Wave 2) the 'social' tab hosted a ProfileScreen placeholder while
// the social graph had no density. Wave 6 swaps in the real social screen and
// moves Profile to its own tab so both surfaces coexist.
//
// Governance (Task 2B):
//   - This store is the single client-side source of truth for the active tab.
//   - Deep-linking (?tab=orders) writes to this store on ConsumerView mount.
//   - Realtime order updates + checkout-success may set the tab to 'orders' or
//     'tracking' overlay via setSelectedRestaurantId / setOverlay.

'use client'

import { create } from 'zustand'
import type { BottomNavTab } from '@/components/snak/bottom-nav'

// Overlay = a full-screen takeover on top of the active tab.
// - 'tracking'  → OrderTracking component when an active order is selected.
// - 'menu'      → Restaurant detail screen (Task 2D) when a restaurant is selected.
// - 'cart'      → Cart screen (Task 3A) when the user reviews their cart
//                 before checkout. Opened from restaurant-detail or the
//                 global CartBar's "Checkout" CTA.
// - null        → no overlay; show the active tab's screen.
//
// Task 3A (additive): 'cart' is a new overlay kind. Existing 'tracking' +
// 'menu' consumers are untouched — they keep reading the same `overlay` value
// and only react to their own kind.
export type ConsumerOverlay = 'tracking' | 'menu' | 'cart' | 'group-order' | null

export interface UIState {
  /** Currently-active bottom-nav tab. */
  activeTab: BottomNavTab
  /** Task 7B: Selected group order id (drives the 'group-order' overlay). */
  selectedGroupOrderId: string | null
  /** Active overlay (full-screen takeover). Null = show active tab's screen. */
  overlay: ConsumerOverlay
  /** Selected restaurant id (drives the 'menu' overlay → restaurant detail). */
  selectedRestaurantId: string | null
  /** Selected order id (drives the 'tracking' overlay → OrderTracking). */
  selectedOrderId: string | null
  /**
   * Task 3A (additive): whether the cart overlay is open. Mirrors
   * `overlay === 'cart'` — provided as its own boolean for ergonomic selector
   * hooks (e.g., `useUI(s => s.cartOpen)`) without breaking the existing
   * `overlay` API used by Tasks 2B/2D.
   */
  cartOpen: boolean

  /** Switch the active tab. Does not clear overlays. */
  setActiveTab: (tab: BottomNavTab) => void

  /** Open the restaurant-detail overlay (Task 2D's screen). */
  openRestaurant: (restaurantId: string) => void
  /** Close the restaurant-detail overlay (back to the previous tab screen). */
  closeRestaurant: () => void

  /** Open the order-tracking overlay for a specific order id. */
  openTracking: (orderId: string) => void
  /** Close the tracking overlay. */
  closeTracking: () => void

  /** Task 3A: Open the cart review overlay (caller passes nothing — the cart
   *  already knows its restaurantId from cart-store). The cart screen reads
   *  cart.restaurantId to drive its restaurant banner. */
  openCart: () => void
  /** Task 3A: Close the cart overlay (back to the active tab or restaurant
   *  detail, depending on where the user came from). */
  closeCart: () => void

  /** Task 7B: Open the group-order overlay for a specific group order id. */
  openGroupOrder: (groupOrderId: string) => void
  /** Task 7B: Close the group-order overlay. */
  closeGroupOrder: () => void
  /** Task 7B: Selected group order id (drives the 'group-order' overlay). */
  selectedGroupOrderId: string | null
}

export const useUI = create<UIState>()((set) => ({
  activeTab: 'home',
  overlay: null,
  selectedRestaurantId: null,
  selectedOrderId: null,
  // Task 3A additive default — cart overlay starts closed.
  cartOpen: false,

  setActiveTab: (tab) => set({ activeTab: tab }),

  openRestaurant: (restaurantId) =>
    set({ selectedRestaurantId: restaurantId, overlay: 'menu' }),
  closeRestaurant: () =>
    set({ selectedRestaurantId: null, overlay: null }),

  openTracking: (orderId) =>
    set({ selectedOrderId: orderId, overlay: 'tracking' }),
  closeTracking: () =>
    set({ selectedOrderId: null, overlay: null }),

  // Task 3A additive actions. `overlay` + `cartOpen` are kept in sync — the
  // former is the existing overlay-state source-of-truth that the
  // consumer-view host switches on; the latter is a convenience selector.
  openCart: () => set({ overlay: 'cart', cartOpen: true }),
  closeCart: () => set({ overlay: null, cartOpen: false }),

  // Task 7B additive actions for the group-order overlay.
  selectedGroupOrderId: null,
  openGroupOrder: (groupOrderId) =>
    set({ selectedGroupOrderId: groupOrderId, overlay: 'group-order' }),
  closeGroupOrder: () =>
    set({ selectedGroupOrderId: null, overlay: null }),
}))
