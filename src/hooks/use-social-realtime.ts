'use client'

// src/hooks/use-social-realtime.ts
//
// S5A Realtime Foundation — Social client hook.
//
// Responsibilities:
//   - Connect to authenticated realtime transport
//   - Receive Social event envelopes
//   - Deduplicate by eventId (bounded LRU cache)
//   - Invoke invalidation callbacks (refetch REST resources)
//   - Reconnect → authoritative REST refresh
//
// REALTIME IS AN INVALIDATION SIGNAL:
//   This hook does NOT directly mutate complex client state from event payloads.
//   On event receipt, it calls the provided invalidation callbacks which
//   refetch authoritative REST resources.

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { realtimeSocket } from './use-realtime'
import type { SocialRealtimeEnvelope, SocialRealtimeEventType } from '@/lib/social-realtime'
import { EVENT_INVALIDATION_MAP, SOCIAL_REALTIME_EVENT_TYPES } from '@/lib/social-realtime'

// Bounded LRU cache for event dedup (at-least-once delivery)
// S5D FIX: Each hook instance gets its OWN dedup cache. Previously the cache
// was module-level (shared across all instances), which meant that when both
// NotificationBell and SocialScreen mounted the hook, the first instance to
// process an event would add its eventId to the shared cache, causing the
// second instance to skip it as a "duplicate" — even though the second
// instance needed a different invalidation callback (e.g., feed vs notifications).
// This caused SOCIAL_ACTIVITY_CREATED events to be silently dropped by the
// SocialScreen instance when NotificationBell processed them first.
const MAX_DEDUP_CACHE = 100

/** Per-instance LRU dedup cache (bounded). */
function createDedupCache() {
  const seen = new Set<string>()
  const ordered: string[] = []
  return function isDuplicate(eventId: string): boolean {
    if (seen.has(eventId)) return true
    seen.add(eventId)
    ordered.push(eventId)
    if (ordered.length > MAX_DEDUP_CACHE) {
      const oldest = ordered.shift()
      if (oldest) seen.delete(oldest)
    }
    return false
  }
}

export interface SocialRealtimeCallbacks {
  /** Refetch connections from REST */
  onInvalidateConnections?: () => void
  /** Refetch feed from REST */
  onInvalidateFeed?: () => void
  /** Refetch notifications from REST */
  onInvalidateNotifications?: () => void
  /** Called on reconnect — should refresh ALL stores */
  onReconnect?: () => void
}

/**
 * S5A: Subscribe to social realtime events.
 *
 * The hook connects to the existing realtime socket (from use-realtime.ts),
 * listens for 'social:event' messages, deduplicates by eventId, and invokes
 * the appropriate invalidation callbacks based on the event type.
 *
 * On reconnect, calls onReconnect (which should refresh all stores).
 *
 * S5D FIX: Each hook instance has its own dedup cache so that multiple
 * mounted instances (NotificationBell + SocialScreen) don't interfere
 * with each other.
 *
 * Usage:
 *   useSocialRealtime({
 *     onInvalidateConnections: () => refresh(),
 *     onInvalidateFeed: () => refresh(),
 *     onInvalidateNotifications: () => refreshNotifications(),
 *     onReconnect: () => { refresh(); refreshNotifications(); },
 *   })
 */
export function useSocialRealtime(callbacks: SocialRealtimeCallbacks) {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks // eslint-disable-line react-hooks/refs

  // S5D: Per-instance dedup cache (not shared across hook instances).
  // useMemo with empty deps creates the cache once per hook instance lifetime.
  const isDuplicate = useMemo(() => createDedupCache(), [])

  const handleEvent = useCallback((envelope: SocialRealtimeEnvelope) => {
    // Validate known event type
    if (!SOCIAL_REALTIME_EVENT_TYPES.includes(envelope.type)) return

    // Dedup by eventId (per-instance)
    if (isDuplicate(envelope.eventId)) return

    // Look up which resources to invalidate
    const invalidation = EVENT_INVALIDATION_MAP[envelope.type]
    if (!invalidation) return

    // Invoke invalidation callbacks (each triggers a REST refetch)
    if (invalidation.connections && callbacksRef.current.onInvalidateConnections) {
      callbacksRef.current.onInvalidateConnections()
    }
    if (invalidation.feed && callbacksRef.current.onInvalidateFeed) {
      callbacksRef.current.onInvalidateFeed()
    }
    if (invalidation.notifications && callbacksRef.current.onInvalidateNotifications) {
      callbacksRef.current.onInvalidateNotifications()
    }
  }, [isDuplicate])

  useEffect(() => {
    const sock = realtimeSocket()

    // Listen for social events
    sock.on('social:event', handleEvent)

    // On reconnect: refresh all stores (REST reconciles missed events)
    const onReconnect = () => {
      if (callbacksRef.current.onReconnect) {
        callbacksRef.current.onReconnect()
      }
    }
    sock.on('connect', onReconnect)

    return () => {
      sock.off('social:event', handleEvent)
      sock.off('connect', onReconnect)
    }
  }, [handleEvent])
}
