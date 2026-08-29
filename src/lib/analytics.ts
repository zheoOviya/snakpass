'use client'

import { csrfFetch } from './csrf-client'

// src/lib/analytics.ts
//
// S5H1/S5H2: Minimal privacy-safe analytics event tracking.
//
// This is NOT a full analytics platform — it's a lightweight client-side
// event logger that sends structured events to a server endpoint for
// collection. No third-party SDKs (no gtag, mixpanel, amplitude).
//
// PRIVACY CONTRACT:
//   - Only safe dimensions are logged (experimentId, variant, restaurantId, friendCountBucket, rankPosition)
//   - NO friend userId, name, phone, email, orderId, sourceOrderId, blockedBy, session/token
//   - Events are deduplicated on the client side to prevent React rerender spam
//
// EVENTS:
//   SOCIAL_PROOF_IMPRESSION — fires when social proof badge renders with >0 friends
//   SOCIAL_PROOF_RESTAURANT_ENGAGEMENT — fires when user interacts with menu after proof impression
//   SOCIAL_PROOF_ORDER_START — fires when user starts checkout after proof impression
//   FRIEND_RANKED_IMPRESSION — fires when friend-ranked section renders with >0 restaurants
//   FRIEND_RANKED_RESTAURANT_OPEN — fires when user clicks a friend-ranked restaurant card
//
// CSRF: Uses csrfFetch (canonical CSRF helper) to include X-CSRF-Token header
// required by middleware for POST requests.

export type AnalyticsEvent =
  | 'FRIEND_RANKED_IMPRESSION'
  | 'FRIEND_RANKED_RESTAURANT_OPEN'
  | 'FRIEND_SEED_IMPRESSION'
  | 'FRIEND_SEED_REQUEST'
  | 'SOCIAL_PROOF_IMPRESSION'
  | 'SOCIAL_PROOF_RESTAURANT_ENGAGEMENT'
  | 'SOCIAL_PROOF_ORDER_START'

export interface SafeAnalyticsDimensions {
  experimentId: string
  variant: 'treatment' | 'control'
  restaurantId: string
  friendCountBucket: '0' | '1' | '2' | '3+'
}

// Bounded dedup cache — prevents duplicate impressions from React rerenders
const seenEvents = new Set<string>()
const MAX_DEDUP = 50

function shouldDedup(eventKey: string): boolean {
  if (seenEvents.has(eventKey)) return true
  seenEvents.add(eventKey)
  if (seenEvents.size > MAX_DEDUP) {
    // Clear oldest (Set preserves insertion order in JS)
    const first = seenEvents.values().next().value
    if (first) seenEvents.delete(first)
  }
  return false
}

/**
 * Track a privacy-safe analytics event.
 * Deduplicates by (event + restaurantId + session) to prevent React rerender spam.
 */
export function trackEvent(
  event: AnalyticsEvent,
  dimensions: SafeAnalyticsDimensions,
): void {
  // Dedup key: event + restaurantId (one impression per restaurant per session)
  const dedupKey = `${event}:${dimensions.restaurantId}`
  if (shouldDedup(dedupKey)) return

  // Fire-and-forget — analytics should never block UI
  // Use csrfFetch to include X-CSRF-Token header (required by middleware for POST)
  try {
    void csrfFetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        ...dimensions,
        timestamp: Date.now(),
      }),
      keepalive: true, // allow event to fire even if page unloads
      // Analytics doesn't need idempotency keys — dedup is client-side.
      // Pass null to skip auto-generated Idempotency-Key header.
      idempotencyKey: null,
    }).catch(() => {
      // swallow — analytics failure must not affect UX
    })
  } catch {
    // swallow
  }
}

/**
 * Reset dedup cache (for testing).
 */
export function _resetAnalyticsDedup(): void {
  seenEvents.clear()
}
