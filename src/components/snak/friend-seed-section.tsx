'use client'

import * as React from 'react'
import { UserPlus, Users, MapPin } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useSocial } from '@/lib/social-store'
import { trackEvent } from '@/lib/analytics'

interface FriendSeedCandidate {
  id: string
  name: string
  avatarColor: string
  reason: 'MUTUAL' | 'CAMPUS'
  mutualCountBucket: '0' | '1' | '2' | '3+'
}

interface FriendSeedData {
  eligible: boolean
  candidates: FriendSeedCandidate[]
}

export function FriendSeedSection({ className }: { className?: string }) {
  const [data, setData] = React.useState<FriendSeedData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [requestingIds, setRequestingIds] = React.useState<Set<string>>(new Set())
  const { toast } = useToast()
  const refresh = useSocial((s) => s.refresh)
  const impressionFired = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    impressionFired.current = false

    fetch('/api/social/friend-seed', {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => { if (!res.ok) return null; return res.json() })
      .then((d: FriendSeedData | null) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })

    return () => { cancelled = true }
  }, [])

  const isVisible = !loading && !!data && data.eligible && data.candidates.length > 0

  React.useEffect(() => {
    if (!isVisible || !data || impressionFired.current) return
    impressionFired.current = true
    trackEvent('FRIEND_SEED_IMPRESSION', {
      experimentId: 's5h3-new-user-friend-seed',
      variant: 'treatment',
      restaurantId: data.candidates[0]?.id ?? '',
      friendCountBucket: data.candidates[0]?.mutualCountBucket ?? '0',
    })
  }, [isVisible, data])

  if (loading || !data || !data.eligible || data.candidates.length === 0) {
    return null
  }

  const handleAddFriend = async (candidate: FriendSeedCandidate, rankPosition: number) => {
    if (requestingIds.has(candidate.id)) return
    setRequestingIds(prev => new Set(prev).add(candidate.id))

    trackEvent('FRIEND_SEED_REQUEST', {
      experimentId: 's5h3-new-user-friend-seed',
      variant: 'treatment',
      restaurantId: candidate.id,
      friendCountBucket: candidate.mutualCountBucket,
    })

    try {
      const csrfFetch = (await import('@/lib/csrf-client')).csrfFetch
      const res = await csrfFetch('/api/social/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: candidate.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message || `Failed (${res.status})`)
      }
      toast({ title: 'Friend request sent!', description: `Request sent to ${candidate.name}` })
      // Refresh connections to update pending state
      void refresh()
    } catch (err) {
      toast({
        title: 'Could not send request',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setRequestingIds(prev => { const next = new Set(prev); next.delete(candidate.id); return next })
    }
  }

  return (
    <section className={cn('mb-6', className)} aria-labelledby="friend-seed">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <UserPlus className="h-4 w-4 text-violet-500" aria-hidden="true" />
        People you may know
      </h2>
      <div className="space-y-3">
        {data.candidates.map((candidate, idx) => (
          <div
            key={candidate.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
          >
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className={cn('text-white', `bg-${candidate.avatarColor}-500`)}>
                {(candidate.name?.[0] ?? '?').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{candidate.name}</p>
              {candidate.reason === 'MUTUAL' && candidate.mutualCountBucket !== '0' && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {candidate.mutualCountBucket === '1'
                    ? '1 mutual connection'
                    : `${candidate.mutualCountBucket} mutual connections`}
                </p>
              )}
              {candidate.reason === 'CAMPUS' && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  From your campus
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={requestingIds.has(candidate.id)}
              onClick={() => handleAddFriend(candidate, idx + 1)}
            >
              {requestingIds.has(candidate.id) ? '...' : 'Add Friend'}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
