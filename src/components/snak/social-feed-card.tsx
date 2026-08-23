'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Heart, MessageCircle, Gift, Users, Sparkles, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/snack'
import type { SocialActivity } from '@/lib/types'

/**
 * Venmo-style social feed card.
 *
 * Per DESIGN_SYSTEM.md §5.2.7 + blueprint §6 P2:
 * - Actor avatar + name + verb + restaurant + timestamp.
 * - NEVER shows payment amount (Social should improve utility, not expose spending).
 * - Like + comment buttons with counts.
 *
 * Verbs supported (drives icon + copy) — UPPERCASE matching server VERBS constant:
 * - 'ORDERED' → "ordered from {restaurant}" (teal star)
 * - 'EARNED_REWARD' → "earned reward points" (gold sparkle)
 * - 'GIFTED' → "sent a gift to {target}" (violet gift)
 * - 'JOINED_GROUP' → "joined a group order at {restaurant}" (rose users)
 * - 'FRIEND_ADDED' → "is now friends with {target}" (violet gift)
 *
 * States:
 * - Default
 * - Liked — heart fills violet + count bumps with spring.
 *
 * Accessibility:
 * - role="article" with aria-label summarising the activity.
 * - Like button aria-pressed + aria-label.
 *
 * Dark mode: uses CSS variables (violet-* ramp auto-flips).
 */

export interface SocialFeedCardProps {
  activity: SocialActivity
  /** Called when the like button is tapped. Component does not toggle state itself. */
  onLike?: (activity: SocialActivity) => void
  /** Called when the comment button is tapped. */
  onComment?: (activity: SocialActivity) => void
  /** Called when the card body (restaurant thumbnail) is tapped. */
  onPress?: (activity: SocialActivity) => void
  className?: string
}

interface VerbConfig {
  /** Human-readable verb phrase. */
  text: (a: SocialActivity) => string
  /** Accent color class for the icon + ring. */
  accent: 'violet' | 'rose' | 'gold' | 'teal'
  /** Lucide icon component. */
  Icon: React.ComponentType<{ className?: string }>
}

// S1 Reconstruction: verb keys are UPPERCASE matching the server's VERBS constant
// (ORDERED, EARNED_REWARD, GIFTED, JOINED_GROUP, FRIEND_ADDED). The old snake_case
// keys (ordered_from, earned_reward, etc.) never matched → every activity rendered
// as the fallback. The fallback is 'ORDERED' (teal star, "ordered from a restaurant").
const VERBS: Record<string, VerbConfig> = {
  ORDERED: {
    text: (a) => `ordered from ${a.restaurantName ?? 'a restaurant'}`,
    accent: 'teal',
    Icon: Star,
  },
  EARNED_REWARD: {
    text: (a) =>
      a.dishName
        ? `earned reward points on ${a.dishName}`
        : 'earned reward points',
    accent: 'gold',
    Icon: Sparkles,
  },
  GIFTED: {
    text: (a) => `sent a gift to ${a.targetUserName ?? 'a friend'}`,
    accent: 'violet',
    Icon: Gift,
  },
  JOINED_GROUP: {
    text: (a) => `joined a group order at ${a.restaurantName ?? 'a restaurant'}`,
    accent: 'rose',
    Icon: Users,
  },
  FRIEND_ADDED: {
    text: (a) => `is now friends with ${a.targetUserName ?? 'a friend'}`,
    accent: 'violet',
    Icon: Gift,
  },
}

const ACCENT_CLASSES: Record<VerbConfig['accent'], { ring: string; icon: string }> = {
  violet: { ring: 'ring-violet-400', icon: 'text-violet-600 dark:text-violet-400' },
  rose: { ring: 'ring-rose-400', icon: 'text-rose-600 dark:text-rose-400' },
  gold: { ring: 'ring-gold-400', icon: 'text-gold-600 dark:text-gold-400' },
  teal: { ring: 'ring-teal-400', icon: 'text-teal-600 dark:text-teal-400' },
}

export function SocialFeedCard({
  activity,
  onLike,
  onComment,
  onPress,
  className,
}: SocialFeedCardProps) {
  const prefersReduced = useReducedMotion()
  const verb = VERBS[activity.verb] ?? VERBS.ORDERED!
  const accent = ACCENT_CLASSES[verb.accent]
  const liked = !!activity.likedByMe
  const likeCount = activity.likeCount ?? 0
  const commentCount = activity.commentCount ?? 0

  const initials = activity.actorName
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <Card
      role="article"
      aria-label={`${activity.actorName} ${verb.text(activity)}`}
      className={cn('rounded-xl p-4', className)}
    >
      {/* Top row — actor + verb + timestamp */}
      <div className="flex items-start gap-3">
        <Avatar className={cn('h-9 w-9 ring-2', accent.ring, 'ring-offset-2 ring-offset-background')}>
          {activity.actorAvatarUrl && <AvatarImage src={activity.actorAvatarUrl} alt="" />}
          <AvatarFallback className="bg-muted text-xs font-bold text-foreground">
            {initials || '?'}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-foreground">
            <span className="font-semibold">{activity.actorName}</span>{' '}
            <span className="text-muted-foreground">{verb.text(activity)}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(activity.createdAt)}</p>
        </div>

        <verb.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', accent.icon)} aria-hidden="true" />
      </div>

      {/* Body — restaurant thumbnail + dish name (tap = view restaurant) */}
      {(activity.restaurantName || activity.dishName) && (
        <button
          type="button"
          onClick={() => onPress?.(activity)}
          aria-label={
            activity.restaurantName
              ? `View ${activity.restaurantName}`
              : 'View activity detail'
          }
          className="snak-focus-ring mt-3 flex w-full items-center gap-3 rounded-xl bg-muted/50 p-2 text-left transition-colors hover:bg-muted"
        >
          {activity.restaurantImageUrl ? (
            <img
              src={activity.restaurantImageUrl}
              alt={activity.restaurantName ?? 'Restaurant'}
              className="h-12 w-12 shrink-0 rounded-lg object-cover"
              loading="lazy"
            />
          ) : (
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-violet-600 text-lg"
              aria-hidden="true"
            >
              🍽
            </div>
          )}
          <div className="min-w-0 flex-1">
            {activity.restaurantName && (
              <p className="truncate text-sm font-medium text-foreground">
                {activity.restaurantName}
              </p>
            )}
            {activity.dishName && (
              <p className="truncate text-xs text-muted-foreground">{activity.dishName}</p>
            )}
          </div>
        </button>
      )}

      {/* Bottom row — like + comment */}
      <div className="mt-3 flex items-center gap-1 border-t pt-3">
        <button
          type="button"
          onClick={() => onLike?.(activity)}
          aria-pressed={liked}
          aria-label={liked ? `Unlike ${activity.actorName}'s activity` : `Like ${activity.actorName}'s activity`}
          className="snak-focus-ring inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          <motion.span
            key={liked ? 'liked' : 'unliked'}
            initial={prefersReduced ? false : { scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 180, damping: 14, mass: 1 }}
            className={cn(liked && 'text-violet-600 dark:text-violet-400')}
          >
            <Heart
              className={cn('h-4 w-4', liked && 'fill-current')}
              aria-hidden="true"
            />
          </motion.span>
          {likeCount > 0 && (
            <span className="font-mono tabular-nums text-muted-foreground">{likeCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onComment?.(activity)}
          aria-label={`Comment on ${activity.actorName}'s activity`}
          className="snak-focus-ring inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {commentCount > 0 && (
            <span className="font-mono tabular-nums">{commentCount}</span>
          )}
        </button>
      </div>

      {/* Mututal-friends preview line */}
      <AnimatePresence>
        {likeCount >= 3 && (
          <motion.p
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-2 text-xs text-muted-foreground"
          >
            Liked by {likeCount} {likeCount === 1 ? 'person' : 'people'}
          </motion.p>
        )}
      </AnimatePresence>
    </Card>
  )
}

export default SocialFeedCard
