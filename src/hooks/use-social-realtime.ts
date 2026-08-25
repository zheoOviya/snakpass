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

import { useEffect, useRef, useCallback } from 'react'
import { realtimeSocket } from './use-realtime'
import type { SocialRealtimeEnvelope, SocialRealtimeEventType } from '@/lib/social-realtime'
import { EVENT_INVALIDATION_MAP, SOCIAL_REALTIME_EVENT_TYPES } from '@/lib/social-realtime'

// Bounded LRU cache for event dedup (at-least-once delivery)
const MAX_DEDUP_CACHE = 100
const seenEventIds = new Set<string>()
const seenEventIdsArray: string[] = []

function isDuplicate(eventId: string): boolean {
  if (seenEventIds.has(eventId)) return true
  seenEventIds.add(eventId)
  seenEventIdsArray.push(eventId)
  // Evict oldest if over capacity
  if (seenEventIdsArray.length > MAX_DEDUP_CACHE) {
    const oldest = seenEventIdsArray.shift()
    if (oldest) seenEventIds.delete(oldest)
  }
  return false
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

  const handleEvent = useCallback((envelope: SocialRealtimeEnvelope) => {
    // Validate known event type
    if (!SOCIAL_REALTIME_EVENT_TYPES.includes(envelope.type)) return

    // Dedup by eventId
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
  }, [])

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
