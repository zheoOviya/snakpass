'use client'

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Gift, Check, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { inr, formatCountdown, timeAgo } from '@/lib/snack'
import type { Gift as GiftType } from '@/lib/types'

/**
 * Gift card — a received food gift with redeem action + expiry countdown.
 *
 * Per DESIGN_SYSTEM.md §5.2.5:
 * - rounded-2xl with violet-tinted border.
 * - Top: item image (16:9 crop).
 * - Body: sender avatar + "From [name]" + message + item details.
 * - Footer: "Redeem gift" button + expiry countdown (warning color if < 2h).
 *
 * States:
 * - Pending (unredeemed) — full styling, redeem button active.
 * - Redeemed — "Redeemed ✓" success pill, border fades to muted.
 * - Expired — grayscale, "Expired" danger pill, redeem disabled.
 * - Expiring soon (< 2h) — countdown pulses warning.
 *
 * Accessibility:
 * - role="region" with aria-label "Gift from [sender]".
 * - Countdown aria-live="polite" only when expiring soon.
 * - Image alt = item name.
 *
 * Dark mode: uses CSS variables (violet-* ramp auto-flips).
 */

export interface GiftCardProps {
  gift: GiftType
  /** Called when "Redeem gift" is tapped. Component does not mutate state itself. */
  onRedeem?: (gift: GiftType) => void
  /** Whether the redeem action is currently in flight (shows spinner). */
  redeeming?: boolean
  /** Optional CTA label override (default: "Redeem gift"). */
  redeemLabel?: string
  className?: string
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

export function GiftCard({
  gift,
  onRedeem,
  redeeming = false,
  redeemLabel = 'Redeem gift',
  className,
}: GiftCardProps) {
  const prefersReduced = useReducedMotion()
  const [now, setNow] = React.useState(() => Date.now())

  // Tick every minute to refresh countdown — but only while pending.
  React.useEffect(() => {
    if (gift.status !== 'PENDING') return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [gift.status])

  const isRedeemed = gift.status === 'REDEEMED'
  const isExpired = gift.status === 'EXPIRED' || new Date(gift.expiresAt).getTime() < now
  const isCancelled = gift.status === 'CANCELLED'
  const isPending = gift.status === 'PENDING' && !isExpired

  const msRemaining = new Date(gift.expiresAt).getTime() - now
  const expiringSoon = isPending && msRemaining < TWO_HOURS_MS && msRemaining > 0

  const initials = gift.senderName
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <Card
      role="region"
      aria-label={`Gift from ${gift.senderName}`}
      className={cn(
        'overflow-hidden p-0 rounded-2xl',
        isPending && 'border-2 border-violet-300 dark:border-violet-800',
        (isRedeemed || isCancelled) && 'border-muted opacity-80',
        isExpired && 'border-danger-300 grayscale dark:border-danger-800',
        className,
      )}
    >
      {/* Item image — 16:9 with violet gradient fallback */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {gift.itemImageUrl ? (
          <img
            src={gift.itemImageUrl}
            alt={gift.itemName}
            className={cn(
              'h-full w-full object-cover transition-transform',
              !prefersReduced && 'group-hover:scale-105',
              (isRedeemed || isExpired || isCancelled) && 'grayscale',
            )}
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-violet-400 to-violet-600" />
        )}

        {/* Gift icon overlay */}
        <div className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-white shadow-sm">
          <Gift className="h-4 w-4" aria-hidden="true" />
        </div>

        {/* Status pill — top right */}
        {(isRedeemed || isExpired || isCancelled) && (
          <div className="absolute right-3 top-3">
            {isRedeemed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-500 px-2 py-0.5 text-[11px] font-semibold text-success-foreground">
                <Check className="h-3 w-3" aria-hidden="true" />
                Redeemed
              </span>
            )}
            {isExpired && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger-500 px-2 py-0.5 text-[11px] font-semibold text-danger-foreground">
                Expired
              </span>
            )}
            {isCancelled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                Cancelled
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="space-y-3 p-4">
        {/* Sender row */}
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 ring-2 ring-violet-500 ring-offset-2 ring-offset-background">
            {gift.senderAvatarUrl && <AvatarImage src={gift.senderAvatarUrl} alt="" />}
            <AvatarFallback className="bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              {initials || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              From <span className="font-semibold">{gift.senderName}</span>
            </p>
            <p className="text-xs text-muted-foreground">{timeAgo(gift.createdAt)}</p>
          </div>
        </div>

        {/* Message */}
        {gift.message && (
          <p className="line-clamp-3 border-l-2 border-violet-300 pl-3 text-sm italic text-foreground dark:border-violet-800">
            &ldquo;{gift.message}&rdquo;
          </p>
        )}

        {/* Item details */}
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{gift.itemName}</p>
            <p className="truncate text-xs text-muted-foreground">{gift.restaurantName}</p>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold text-foreground">
            {inr(gift.valuePaise)}
          </span>
        </div>

        {/* Footer — redeem + expiry */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {isPending ? (
            <Button
              type="button"
              onClick={() => onRedeem?.(gift)}
              disabled={redeeming}
              className="snak-gradient-social gap-2 text-social-foreground hover:opacity-90"
              aria-label={`${redeemLabel} from ${gift.senderName}`}
            >
              <AnimatePresence mode="wait" initial={false}>
                {redeeming ? (
                  <motion.span
                    key="redeeming"
                    initial={prefersReduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    Redeeming…
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={prefersReduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="inline-flex items-center gap-2"
                  >
                    <Gift className="h-4 w-4" aria-hidden="true" />
                    {redeemLabel}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                isRedeemed && 'text-success-700 dark:text-success-400',
                isExpired && 'text-danger-700 dark:text-danger-400',
                isCancelled && 'text-muted-foreground',
              )}
            >
              {isRedeemed && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {isRedeemed ? 'Redeemed' : isExpired ? 'Expired' : 'Cancelled'}
              {gift.redeemedAt && ` · ${timeAgo(gift.redeemedAt)}`}
            </span>
          )}

          {isPending && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                expiringSoon ? 'font-semibold text-warning' : 'text-muted-foreground',
              )}
              aria-live={expiringSoon ? 'polite' : undefined}
              aria-label={`Expires in ${formatCountdown(msRemaining)}`}
            >
              <Clock className={cn('h-3.5 w-3.5', expiringSoon && 'snak-sparkle')} aria-hidden="true" />
              {expiringSoon ? 'Expires in ' : ''}
              {formatCountdown(msRemaining)}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

export default GiftCard
