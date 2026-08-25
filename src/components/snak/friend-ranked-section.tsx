'use client'

// src/components/snak/friend-ranked-section.tsx
//
// S5H2: "Popular among friends" discovery section.
//
// Fetches GET /api/restaurants/friend-ranked and displays ranked restaurant cards.
// Hidden when 0 results, loading, or API failure (existing "Popular Near You" remains).
//
// Privacy:
//   - friendCount + friendCountBucket only (no friend identities)
//   - Max 5 results (server-capped)
//   - No friend names, avatars, userIds

import * as React from 'react'
import { Users, ChevronRight } from 'lucide-react'
import { RestaurantCardV2 } from './restaurant-card-v2'
import { RestaurantCardSkeleton } from './skeleton-loader'
import { trackEvent } from '@/lib/analytics'
import { cn } from '@/lib/utils'

interface FriendRankedRestaurant {
  id: string
  name: string
  cuisine: string
  description: string
  image: string
  rating: number
  prepTimeMins: number
  priceForTwo: number
  address: string
  isOpen: boolean
  deal: { title: string; description: string } | null
  friendCount: number
  friendCountBucket: '1' | '2' | '3+'
  rankPosition: number
}

interface FriendRankedData {
  restaurants: FriendRankedRestaurant[]
  hasSocialSignal: boolean
}

export interface FriendRankedSectionProps {
  campusId?: string
  onOpenRestaurant: (restaurantId: string) => void
  className?: string
}

export function FriendRankedSection({ campusId, onOpenRestaurant, className }: FriendRankedSectionProps) {
  const [data, setData] = React.useState<FriendRankedData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const impressionFired = React.useRef(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    impressionFired.current = false

    const params = campusId ? `?campusId=${encodeURIComponent(campusId)}` : ''
    fetch(`/api/restaurants/friend-ranked${params}`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (!res.ok) return null
        return res.json()
      })
      .then((d: FriendRankedData | null) => {
        if (cancelled) return
        setData(d)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setData(null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [campusId])

  const isVisible = !loading && !!data && data.hasSocialSignal && data.restaurants.length > 0

  // S5H2: Track impression when section renders with ranked restaurants
  React.useEffect(() => {
    if (!isVisible || !data || impressionFired.current) return
    impressionFired.current = true
    trackEvent('FRIEND_RANKED_IMPRESSION', {
      experimentId: 's5h2-friend-ranked-discovery',
      variant: 'treatment',
      restaurantId: data.restaurants[0]?.id ?? '',
      friendCountBucket: data.restaurants[0]?.friendCountBucket ?? '1',
    })
  }, [isVisible, data])

  // Hidden states: loading, no data, 0 results, or error
  if (loading || !data || !data.hasSocialSignal || data.restaurants.length === 0) {
    return null
  }

  const restaurants = data.restaurants
  const sectionTitle = restaurants.length >= 2 ? 'Popular among friends' : 'Ordered by a friend'

  return (
    <section className={cn('mb-6', className)} aria-labelledby="home-friend-ranked">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Users className="h-4 w-4 text-violet-500" aria-hidden="true" />
          {sectionTitle}
        </h2>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {restaurants.map((r) => (
          <div key={r.id} className="relative">
            <RestaurantCardV2
              restaurant={{
                id: r.id,
                name: r.name,
                cuisine: r.cuisine,
                description: r.description,
                image: r.image,
                rating: r.rating,
                prepTimeMins: r.prepTimeMins,
                priceForTwo: r.priceForTwo,
                address: r.address,
                isOpen: r.isOpen,
                deal: r.deal,
              }}
              onPress={() => {
                // S5H2: Track restaurant open from friend-ranked section
                trackEvent('FRIEND_RANKED_RESTAURANT_OPEN', {
                  experimentId: 's5h2-friend-ranked-discovery',
                  variant: 'treatment',
                  restaurantId: r.id,
                  friendCountBucket: r.friendCountBucket,
                })
                onOpenRestaurant(r.id)
              }}
            />
            {/* Friend count badge */}
            <div className="absolute right-2 top-2 rounded-full bg-violet-500 px-2 py-0.5 text-xs font-bold text-white shadow-md">
              {r.friendCount === 1 ? '1 friend' : `${r.friendCount} friends`}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
