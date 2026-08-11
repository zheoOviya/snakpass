'use client'

import { spiceLabel } from '@/lib/snack'

// Veg / non-veg square indicator
export function VegBadge({ veg, className = '' }: { veg: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-sm ${veg ? 'veg-dot' : 'nonveg-dot'} ${className}`}
      title={veg ? 'Vegetarian' : 'Non-vegetarian'}
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
    >
      <span className={`h-2 w-2 rounded-full ${veg ? 'bg-emerald-600' : 'bg-red-600'}`} />
    </span>
  )
}

export function SpiceDots({ level }: { level: number }) {
  if (level === 0) return null
  const { label, emoji } = spiceLabel(level)
  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400" title={label}>
      <span className="text-[10px]">{emoji}</span>
    </span>
  )
}

export function StarRating({ rating, className = '' }: { rating: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${className}`}>
      <span className="text-amber-500">★</span>
      <span>{rating.toFixed(1)}</span>
    </span>
  )
}

// Cuisine -> emoji
export function CuisineIcon({ cuisine, className = '' }: { cuisine: string; className?: string }) {
  const map: Record<string, string> = {
    'North Indian': '🍛',
    'South Indian': '🥞',
    'Indo-Chinese': '🥡',
    Desserts: '🍰',
  }
  return <span className={className}>{map[cuisine] ?? '🍽️'}</span>
}

// Deterministic gradient for a restaurant/dish card image placeholder
export function cuisineGradient(cuisine: string): string {
  const map: Record<string, string> = {
    'North Indian': 'from-amber-400 via-orange-500 to-red-500',
    'South Indian': 'from-yellow-300 via-amber-400 to-orange-400',
    'Indo-Chinese': 'from-red-500 via-rose-500 to-orange-500',
    Desserts: 'from-pink-400 via-fuchsia-400 to-purple-400',
  }
  return map[cuisine] ?? 'from-teal-400 via-emerald-500 to-green-500'
}
