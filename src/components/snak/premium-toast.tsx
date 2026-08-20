'use client'

import * as React from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'
import { useTheme } from 'next-themes'
import {
  CheckCircle2,
  AlertCircle,
  Info,
  Sparkles,
  Gift,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Premium toast — sonner wrapper with SnakZap variants.
 *
 * Per DESIGN_SYSTEM.md §5.4.1:
 * - success (emerald), error (red), info (teal),
 *   reward-earned (gold + sparkle), gift-received (violet), group-joined (rose).
 * - role="status" for success/info/reward, role="alert" for error.
 * - Auto-dismiss 4s default, 6s for reward.
 *
 * Usage:
 *   import { toast } from '@/components/snak/premium-toast'
 *   toast.success('Order placed!')
 *   toast.reward('You earned 24 pts')
 *
 * The <PremiumToaster /> component must be mounted once at the app root
 * (replaces or runs alongside the existing shadcn Toaster — both can
 * coexist because they use different libraries).
 */

type ToastVariant = 'success' | 'error' | 'info' | 'reward' | 'gift' | 'group'

interface VariantConfig {
  Icon: LucideIcon
  /** Sonner "style" key → returns CSS for the toast accent border + icon bg. */
  accent: string
  /** Foreground color class for the icon. */
  iconClass: string
  /** ARIA role for the toast — 'status' for non-critical, 'alert' for errors. */
  role: 'status' | 'alert'
  /** Auto-dismiss duration (ms). 0 = no auto-dismiss. */
  duration: number
}

const VARIANTS: Record<ToastVariant, VariantConfig> = {
  success: {
    Icon: CheckCircle2,
    accent: 'var(--success-token)',
    iconClass: 'text-success-token',
    role: 'status',
    duration: 4000,
  },
  error: {
    Icon: AlertCircle,
    accent: 'var(--danger-token)',
    iconClass: 'text-danger-token',
    role: 'alert',
    duration: 5000,
  },
  info: {
    Icon: Info,
    accent: 'var(--info)',
    iconClass: 'text-info',
    role: 'status',
    duration: 4000,
  },
  reward: {
    Icon: Sparkles,
    accent: 'var(--reward)',
    iconClass: 'text-reward',
    role: 'status',
    duration: 6000, // 6s for reward per spec
  },
  gift: {
    Icon: Gift,
    accent: 'var(--social)',
    iconClass: 'text-social',
    role: 'status',
    duration: 5000,
  },
  group: {
    Icon: Users,
    accent: 'var(--group)',
    iconClass: 'text-group',
    role: 'status',
    duration: 5000,
  },
}

/**
 * Mount this once at the app root (alongside the existing shadcn Toaster
 * is fine — they don't conflict). It registers our premium toast styles
 * as a sonner theme.
 */
export function PremiumToaster(props: React.ComponentProps<typeof SonnerToaster>) {
  const { theme = 'system' } = useTheme()

  return (
    <SonnerToaster
      theme={theme as React.ComponentProps<typeof SonnerToaster>['theme']}
      position="top-center"
      richColors={false}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'snak-card group rounded-xl border bg-card p-3 shadow-[var(--snak-shadow-popover)] text-foreground',
          title: 'text-sm font-semibold',
          description: 'text-xs text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          icon: 'mr-2',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--card-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

/**
 * Toast helper — drop-in replacement for sonner's `toast` with SnakZap variants.
 *
 * Each variant renders the lucide icon + accent left border + appropriate ARIA role.
 */
export const toast = Object.assign(
  (message: string, opts?: { description?: string; duration?: number; onAction?: () => void; actionLabel?: string }) => {
    return sonnerToast(message, {
      description: opts?.description,
      duration: opts?.duration ?? 4000,
      action: opts?.actionLabel
        ? { label: opts.actionLabel, onClick: () => opts.onAction?.() }
        : undefined,
    })
  },
  {
    success(message: string, opts?: { description?: string; duration?: number; actionLabel?: string; onAction?: () => void }) {
      const cfg = VARIANTS.success
      return sonnerToast.custom(
        (t) => <ToastContent t={t} variant="success" message={message} description={opts?.description} actionLabel={opts?.actionLabel} onAction={opts?.onAction} />,
        { duration: opts?.duration ?? cfg.duration },
      )
    },
    error(message: string, opts?: { description?: string; duration?: number; actionLabel?: string; onAction?: () => void }) {
      const cfg = VARIANTS.error
      return sonnerToast.custom(
        (t) => <ToastContent t={t} variant="error" message={message} description={opts?.description} actionLabel={opts?.actionLabel} onAction={opts?.onAction} />,
        { duration: opts?.duration ?? cfg.duration },
      )
    },
    info(message: string, opts?: { description?: string; duration?: number; actionLabel?: string; onAction?: () => void }) {
      const cfg = VARIANTS.info
      return sonnerToast.custom(
        (t) => <ToastContent t={t} variant="info" message={message} description={opts?.description} actionLabel={opts?.actionLabel} onAction={opts?.onAction} />,
        { duration: opts?.duration ?? cfg.duration },
      )
    },
    reward(message: string, opts?: { description?: string; duration?: number; actionLabel?: string; onAction?: () => void }) {
      const cfg = VARIANTS.reward
      return sonnerToast.custom(
        (t) => <ToastContent t={t} variant="reward" message={message} description={opts?.description} actionLabel={opts?.actionLabel} onAction={opts?.onAction} sparkle />,
        { duration: opts?.duration ?? cfg.duration },
      )
    },
    gift(message: string, opts?: { description?: string; duration?: number; actionLabel?: string; onAction?: () => void }) {
      const cfg = VARIANTS.gift
      return sonnerToast.custom(
        (t) => <ToastContent t={t} variant="gift" message={message} description={opts?.description} actionLabel={opts?.actionLabel} onAction={opts?.onAction} />,
        { duration: opts?.duration ?? cfg.duration },
      )
    },
    group(message: string, opts?: { description?: string; duration?: number; actionLabel?: string; onAction?: () => void }) {
      const cfg = VARIANTS.group
      return sonnerToast.custom(
        (t) => <ToastContent t={t} variant="group" message={message} description={opts?.description} actionLabel={opts?.actionLabel} onAction={opts?.onAction} />,
        { duration: opts?.duration ?? cfg.duration },
      )
    },
  },
)

interface ToastContentProps {
  /** Sonner's toast id — needed to dismiss on click. */
  t: string | number
  variant: ToastVariant
  message: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  sparkle?: boolean
}

function ToastContent({
  t,
  variant,
  message,
  description,
  actionLabel,
  onAction,
  sparkle = false,
}: ToastContentProps) {
  const cfg = VARIANTS[variant]
  const { Icon } = cfg

  return (
    <div
      role={cfg.role}
      aria-live={cfg.role === 'alert' ? 'assertive' : 'polite'}
      className="flex w-full items-start gap-3"
      style={{ borderLeft: `4px solid ${cfg.accent}` }}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.iconClass} ${sparkle ? 'snak-sparkle' : ''}`}
        style={{ backgroundColor: `color-mix(in oklch, ${cfg.accent} 18%, transparent)` }}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{message}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
        {actionLabel && (
          <button
            type="button"
            onClick={() => {
              onAction?.()
              sonnerToast.dismiss(t)
            }}
            className="snak-focus-ring mt-2 inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export default toast
