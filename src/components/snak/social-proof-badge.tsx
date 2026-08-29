'use client'

// src/components/snak/social-proof-badge.tsx
//
// S5H1: "Friends Ordered Here" social proof component.
//
// Fetches GET /api/restaurants/[id]/social-proof and displays a compact
// avatar stack + friend count. Hidden when 0 friends, loading, or API failure
// (never shows fake social proof).
//
// Privacy:
//   - Max 3 avatars (server-capped)
//   - No userId, phone, email — only name + avatarColor
//   - friendOrderCount = unique friends (not order count)
//   - hasMore = true if > 3 friends

import * as React from 'react'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/analytics'

interface SocialProofFriend {
  name: string
  avatarColor: string
}

interface SocialProofData {
  friendOrderCount: number
  friends: SocialProofFriend[]
  hasMore: boolean
}

export interface SocialProofBadgeProps {
  restaurantId: string
  className?: string
}

const AVATAR_COLORS: Record<string, string> = {
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
}

function getAvatarClass(color: string): string {
  return AVATAR_COLORS[color] ?? 'bg-teal-500'
}

function getInitial(name: string): string {
  return (name?.[0] ?? '?').toUpperCase()
}

export function SocialProofBadge({ restaurantId, className }: SocialProofBadgeProps) {
  const [proof, setProof] = React.useState<SocialProofData | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetch(`/api/restaurants/${restaurantId}/social-proof`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (!res.ok) return null
        return res.json()
      })
      .then((data: SocialProofData | null) => {
        if (cancelled) return
        setProof(data)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // On any error, hide the component (no fake proof)
        setProof(null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [restaurantId])

  // Hidden states: loading, no data, 0 friends, or error
  const isVisible = !loading && !!proof && proof.friendOrderCount > 0

  // S5H1: Track privacy-safe impression event (deduped by restaurantId)
  const friendOrderCount = proof?.friendOrderCount ?? 0
  const friendCountBucket: '1' | '2' | '3+' = friendOrderCount >= 3 ? '3+' : String(friendOrderCount) as '1' | '2'
  React.useEffect(() => {
    if (!isVisible) return
    trackEvent('SOCIAL_PROOF_IMPRESSION', {
      experimentId: 's5h1-friends-ordered-here',
      variant: 'treatment',
      restaurantId,
      friendCountBucket,
    })
  }, [restaurantId, friendCountBucket, isVisible])

  if (!isVisible || !proof) {
    return null
  }

  const { friends, hasMore } = proof
  const displayCount = hasMore ? '3+' : String(friendOrderCount)
  const friendText = friendOrderCount === 1 ? 'friend' : 'friends'

  return (
    <section
      className={cn('mb-4', className)}
      aria-label={`${friendOrderCount} ${friendText} ordered here`}
      role="status"
    >
      <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-950/20">
        {/* Avatar stack */}
        <div className="flex -space-x-2">
          {friends.map((friend, idx) => (
            <div
              key={idx}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border-2 border-background text-xs font-bold text-white',
                getAvatarClass(friend.avatarColor),
              )}
              title={friend.name}
            >
              {getInitial(friend.name)}
            </div>
          ))}
          {hasMore && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-bold text-muted-foreground">
              +
            </div>
          )}
        </div>

        {/* Text */}
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            <span className="font-bold text-violet-600 dark:text-violet-400">{displayCount}</span>{' '}
            {friendText} ordered here
          </p>
        </div>
      </div>
    </section>
  )
}
