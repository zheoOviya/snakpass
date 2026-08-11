// Shared SnakZap helpers: currency, status config, dietary labels.

export const ORDER_STATUSES = [
  'CONFIRMED',
  'PREPARING',
  'ALMOST_READY',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'CANCELLED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

// Status -> next allowed status (fulfillment state machine)
export const NEXT_STATUS: Record<string, string | null> = {
  CONFIRMED: 'PREPARING',
  PREPARING: 'ALMOST_READY',
  ALMOST_READY: 'READY_FOR_PICKUP',
  READY_FOR_PICKUP: 'PICKED_UP',
  PICKED_UP: null,
  CANCELLED: null,
}

export const STATUS_META: Record<
  string,
  { label: string; short: string; tone: string; step: number; emoji: string }
> = {
  CONFIRMED: { label: 'Order Confirmed', short: 'Confirmed', tone: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', step: 1, emoji: '✓' },
  PREPARING: { label: 'Preparing in Kitchen', short: 'Preparing', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', step: 2, emoji: '👨‍🍳' },
  ALMOST_READY: { label: 'Almost Ready', short: 'Almost Ready', tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', step: 3, emoji: '⏱️' },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', short: 'Ready', tone: 'bg-teal-500/15 text-teal-700 dark:text-teal-300', step: 4, emoji: '🔔' },
  PICKED_UP: { label: 'Picked Up', short: 'Picked Up', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', step: 5, emoji: '🎉' },
  CANCELLED: { label: 'Cancelled', short: 'Cancelled', tone: 'bg-red-500/15 text-red-700 dark:text-red-300', step: 0, emoji: '✕' },
}

// Paise -> ₹ string
export function inr(paise: number): string {
  const rupees = paise / 100
  return '₹' + rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 100 === 0 ? 0 : 2 })
}

export function spiceLabel(level: number): { label: string; emoji: string } {
  switch (level) {
    case 0:
      return { label: 'Mild', emoji: '🍃' }
    case 1:
      return { label: 'Medium', emoji: '🌶' }
    case 2:
      return { label: 'Hot', emoji: '🌶🌶' }
    default:
      return { label: 'Extra Hot', emoji: '🌶🌶🌶' }
  }
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function statusHistoryArray(raw: string | null): { status: string; at: string }[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr
  } catch {
    /* ignore */
  }
  return []
}
