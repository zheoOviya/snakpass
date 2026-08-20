'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Users, Lock, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatCountdown, timeAgo } from '@/lib/snack'
import type { GroupOrder, GroupOrderMember } from '@/lib/types'

/**
 * Group order bubble — friend-hosted group order you can join.
 *
 * Per DESIGN_SYSTEM.md §5.2.6:
 * - Avatar stack: host (32px) + up to 3 members overlapping (-8px offset) + "+N" chip.
 * - "[Host] is ordering from [Restaurant]" + member count + status.
 * - "Join" button (rose gradient) + status dot (rose pulse = open, muted = locked).
 *
 * States:
 * - Open — join button active, rose pulse dot.
 * - Joined — your avatar in stack, button becomes "Leave" ghost.
 * - Locked (host at checkout) — join button disabled, "Locked" pill.
 * - Closed (order placed) — fades, "Order placed ✓" success pill.
 *
 * Accessibility:
 * - role="region" with aria-label "[Host]'s group order at [Restaurant]".
 * - Join button aria-label includes host + restaurant context.
 *
 * Dark mode: uses CSS variables (rose-* ramp auto-flips).
 */

export interface GroupOrderBubbleProps {
  groupOrder: GroupOrder
  members: GroupOrderMember[]
  /** Has the current user joined? Controls button state. */
  hasJoined?: boolean
  /** Called when "Join" is tapped. */
  onJoin?: (g: GroupOrder) => void
  /** Called when "Leave" is tapped. */
  onLeave?: (g: GroupOrder) => void
  /** Whether the join/leave action is in flight. */
  actionLoading?: boolean
  className?: string
}

const MAX_VISIBLE_AVATARS = 4 // host + 3 members

export function GroupOrderBubble({
  groupOrder,
  members,
  hasJoined = false,
  onJoin,
  onLeave,
  actionLoading = false,
  className,
}: GroupOrderBubbleProps) {
  const prefersReduced = useReducedMotion()
  const g = groupOrder

  const isOpen = g.status === 'OPEN'
  const isLocked = g.status === 'LOCKED'
  const isPlaced = g.status === 'PLACED'
  const isCancelled = g.status === 'CANCELLED'

  const memberCount = members.length
  const visibleMembers = members.slice(0, MAX_VISIBLE_AVATARS - 1)
  const overflowCount = Math.max(0, memberCount - (MAX_VISIBLE_AVATARS - 1))

  const msToClose = new Date(g.closesAt).getTime() - Date.now()
  const closeCountdown = msToClose > 0 ? formatCountdown(msToClose) : null

  const hostInitials = g.hostName
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div
      role="region"
      aria-label={`${g.hostName}'s group order at ${g.restaurantName}`}
      className={cn(
        'snak-card flex items-center gap-3 rounded-2xl p-3',
        (isPlaced || isCancelled) && 'opacity-70',
        className,
      )}
    >
      {/* Avatar stack */}
      <div className="flex shrink-0 items-center">
        <Avatar className="h-9 w-9 ring-2 ring-rose-500 ring-offset-2 ring-offset-background">
          {g.hostAvatarUrl && <AvatarImage src={g.hostAvatarUrl} alt="" />}
          <AvatarFallback className="bg-rose-100 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {hostInitials || 'H'}
          </AvatarFallback>
        </Avatar>
        <AnimatePresence>
          {visibleMembers.map((m, i) => {
            const initials = m.userName
              .split(' ')
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
              .toUpperCase()
            return (
              <motion.div
                key={m.id}
                initial={prefersReduced ? false : { opacity: 0, x: 8, scale: 0.6 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 1 }}
                style={{ marginLeft: i === 0 ? -8 : -8 }}
              >
                <Avatar className="h-9 w-9 ring-2 ring-background">
                  {m.userAvatarUrl && <AvatarImage src={m.userAvatarUrl} alt="" />}
                  <AvatarFallback className="bg-muted text-xs font-bold text-foreground">
                    {initials || '?'}
                  </AvatarFallback>
                </Avatar>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {overflowCount > 0 && (
          <div
            className="ml-[-8px] flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-bold text-muted-foreground"
            aria-label={`${overflowCount} more member${overflowCount > 1 ? 's' : ''}`}
          >
            +{overflowCount}
          </div>
        )}
      </div>

      {/* Middle — host/restaurant + status */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-tight text-foreground">
          <span className="font-semibold">{g.hostName}</span>{' '}
          <span className="text-muted-foreground">is ordering from</span>
        </p>
        <p className="truncate text-sm font-medium text-foreground">{g.restaurantName}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            <span className="font-mono tabular-nums">{memberCount + 1}</span> joining
          </span>
          {isOpen && closeCountdown && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">closes in {closeCountdown}</span>
            </>
          )}
          {isLocked && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Locked
              </span>
            </>
          )}
          {isPlaced && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-success-700 dark:text-success-400">
                <Check className="h-3 w-3" aria-hidden="true" />
                Order placed
              </span>
            </>
          )}
          {isCancelled && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-muted-foreground">Cancelled</span>
            </>
          )}
        </div>
      </div>

      {/* Right — action button + status dot */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isOpen && (
          <Button
            type="button"
            onClick={() => (hasJoined ? onLeave?.(g) : onJoin?.(g))}
            disabled={actionLoading}
            aria-label={
              hasJoined
                ? `Leave ${g.hostName}'s group order at ${g.restaurantName}`
                : `Join ${g.hostName}'s group order at ${g.restaurantName}`
            }
            className={
              hasJoined
                ? 'h-8 px-3 text-xs'
                : 'snak-gradient-group h-8 gap-1.5 px-3 text-xs text-group-foreground hover:opacity-90'
            }
            variant={hasJoined ? 'ghost' : 'default'}
          >
            {actionLoading ? '…' : hasJoined ? 'Leave' : 'Join'}
          </Button>
        )}
        {isLocked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Locked
          </span>
        )}
        {isPlaced && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-950/60 dark:text-success-300">
            <Check className="h-3 w-3" aria-hidden="true" />
            Placed
          </span>
        )}

        {/* Status dot — rose pulse if open */}
        {isOpen ? (
          <span
            className="snak-pulse-ring h-2 w-2 rounded-full bg-rose-500"
            aria-label="Group order is open for joining"
          />
        ) : isPlaced ? (
          <span
            className="h-2 w-2 rounded-full bg-success-500"
            aria-label="Group order has been placed"
          />
        ) : (
          <span
            className="h-2 w-2 rounded-full bg-muted-foreground/50"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  )
}

export default GroupOrderBubble
