'use client'

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, animate } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Cell,
} from 'recharts'
import {
  ShoppingBag,
  IndianRupee,
  Clock,
  Hourglass,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  PieChart as PieChartIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { inr } from '@/lib/snack'

// ----------------------------------------------------------------------------
// Wave 4 Task 4C — VendorAnalyticsWidget
// ----------------------------------------------------------------------------
// Compact analytics widget rendered at the top of the vendor Orders tab
// (Task 4A reserved a `// Task 4C: VendorAnalyticsWidget here` slot in
// vendor-view.tsx — integration is left to a later task per the governance
// boundary "DO NOT touch src/components/snak/vendor-view.tsx"; this component
// is self-contained and ready to be imported).
//
// Sections (visually dense — does NOT take up the whole screen):
//   1. Metric cards row — Today's Orders / Today's Revenue / Avg Prep Time /
//      Orders Waiting (2×2 grid on mobile, 4×1 on desktop). Includes a
//      pulsing amber alert badge on the "Orders Waiting" card when count > 5.
//   2. Low-stock alerts — horizontal scroll of red chips for items with
//      availableCount < 5 or isAvailable = false. Hidden when none.
//   3. Status breakdown — mini horizontal bar chart of today's orders by
//      status (confirmed / preparing / almostReady / readyForPickup /
//      pickedUp / cancelled).
//   4. Revenue by hour — mini line chart of today's revenue (24 IST hours).
//
// States: skeleton cards on first load; toast + Retry button on error.
// Realtime: refreshes on `order:created` + `order:updated` socket events
// (debounced 400ms to coalesce bursts).
// Motion: framer-motion `animate()` count-up on each metric value.
// Reduced motion: count-up + chart entrance transitions are skipped when the
// user prefers reduced motion (instant snap to value).
// ----------------------------------------------------------------------------

export interface VendorAnalyticsWidgetProps {
  restaurantId: string
}

interface LowStockItemDto {
  id: string
  name: string
  availableCount: number | null
  isAvailable: boolean
}

interface StatusBreakdownDto {
  confirmed: number
  preparing: number
  almostReady: number
  readyForPickup: number
  pickedUp: number
  cancelled: number
}

interface RevenueByHourDto {
  hour: number
  revenue: number
}

interface VendorAnalyticsResponse {
  todayOrders: number
  todayRevenue: number
  avgPrepTimeMins: number
  ordersWaiting: number
  lowStockItems: LowStockItemDto[]
  statusBreakdown: StatusBreakdownDto
  revenueByHour: RevenueByHourDto[]
}

// Teal/amber/emerald/orange/red palette — matches DESIGN_SYSTEM.md vendor accent.
const STATUS_COLORS: Record<keyof StatusBreakdownDto, string> = {
  confirmed: '#3b82f6',     // blue (paid/confirmed)
  preparing: '#f59e0b',    // amber
  almostReady: '#fb923c',  // orange
  readyForPickup: '#14b8a6', // teal
  pickedUp: '#10b981',     // emerald
  cancelled: '#ef4444',    // red
}

const STATUS_LABELS: Record<keyof StatusBreakdownDto, string> = {
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  almostReady: 'Almost Ready',
  readyForPickup: 'Ready',
  pickedUp: 'Picked Up',
  cancelled: 'Cancelled',
}

export function VendorAnalyticsWidget({ restaurantId }: VendorAnalyticsWidgetProps) {
  const [data, setData] = useState<VendorAnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const { toast } = useToast()
  const prefersReduced = useReducedMotion()
  const { connected } = useRealtime(['vendor:all'])

  // ---------------------------------------------------------------------------
  // Fetch — GET /api/vendor/analytics?restaurantId=X (no date param defaults
  // to today IST server-side). We disable Next's fetch cache to ensure every
  // refresh returns fresh data.
  // ---------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/vendor/analytics?restaurantId=${encodeURIComponent(restaurantId)}`,
        { cache: 'no-store' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg =
          body?.error?.message ?? `Failed to load analytics (HTTP ${res.status})`
        throw new Error(msg)
      }
      const json: VendorAnalyticsResponse = await res.json()
      setData(json)
      setErrored(false)
    } catch (e) {
      setErrored(true)
      toast({
        title: 'Analytics load failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [restaurantId, toast])

  // ---------------------------------------------------------------------------
  // Initial load + re-fetch when restaurantId changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  // ---------------------------------------------------------------------------
  // Realtime refresh — listen for order:created + order:updated socket events
  // and refresh analytics (debounced 400ms to coalesce burst updates).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const sock = realtimeSocket()
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, 400)
    }
    const handler = () => schedule()
    sock.on('order:created', handler)
    sock.on('order:updated', handler)
    return () => {
      sock.off('order:created', handler)
      sock.off('order:updated', handler)
      if (timer) clearTimeout(timer)
    }
  }, [refresh])

  // ---------------------------------------------------------------------------
  // Auto-refresh every 60s — keeps avgPrepTimeMins + ordersWaiting fresh even
  // if no realtime events fire (vendor has the tab open passively).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => void refresh(), 60000)
    return () => clearInterval(t)
  }, [refresh])

  // ---------------------------------------------------------------------------
  // Derived chart data — memoised so recharts doesn't re-render unnecessarily.
  // ---------------------------------------------------------------------------
  const statusChartData = React.useMemo(() => {
    if (!data) return []
    const sb = data.statusBreakdown
    return (Object.keys(sb) as (keyof StatusBreakdownDto)[]).map((k) => ({
      key: k,
      label: STATUS_LABELS[k],
      count: sb[k],
      color: STATUS_COLORS[k],
    }))
  }, [data])

  const revenueChartData = React.useMemo(() => {
    if (!data) return []
    // Show only hours from 8 AM to 11 PM (typical ordering window) to keep
    // the chart compact. If no revenue today, still render an empty axis.
    return data.revenueByHour
      .filter((h) => h.hour >= 8 && h.hour <= 23)
      .map((h) => ({
        hour: `${h.hour}:00`,
        revenue: h.revenue,
      }))
  }, [data])

  const totalStatusCount = React.useMemo(
    () => statusChartData.reduce((s, x) => s + x.count, 0),
    [statusChartData],
  )

  // ---------------------------------------------------------------------------
  // Render — loading skeleton, error state, or content.
  // ---------------------------------------------------------------------------
  if (loading && !data) {
    return <WidgetSkeleton />
  }

  if (errored && !data) {
    return (
      <Card className="border-red-200 dark:border-red-900">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Couldn&apos;t load analytics.</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const lowStock = data.lowStockItems
  const showWaitingAlert = data.ordersWaiting > 5

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
      aria-label="Today's vendor analytics"
    >
      {/* Header row — title + live dot + manual refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <h3 className="text-sm font-semibold">Today&apos;s Pulse</h3>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              connected
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground'
            }`}
            aria-label={connected ? 'Live data' : 'Offline'}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${
                connected ? 'snak-live-dot' : ''
              }`}
            />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void refresh()}
          aria-label="Refresh analytics"
        >
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Metric cards — 2×2 on mobile, 4×1 on desktop */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard
          icon={<ShoppingBag className="h-3.5 w-3.5" />}
          label="Today's Orders"
          tone="text-teal-600"
          value={<CountUp value={data.todayOrders} prefersReduced={prefersReduced} />}
        />
        <MetricCard
          icon={<IndianRupee className="h-3.5 w-3.5" />}
          label="Today's Revenue"
          tone="text-emerald-600"
          value={
            <CountUp
              value={data.todayRevenue}
              prefersReduced={prefersReduced}
              format={(v) => inr(Math.round(v))}
            />
          }
        />
        <MetricCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Avg Prep Time"
          tone="text-amber-600"
          value={
            <span>
              <CountUp
                value={data.avgPrepTimeMins}
                prefersReduced={prefersReduced}
              />
              <span className="ml-1 text-xs font-normal text-muted-foreground">min</span>
            </span>
          }
        />
        <MetricCard
          icon={<Hourglass className="h-3.5 w-3.5" />}
          label="Orders Waiting"
          tone="text-orange-600"
          value={
            <span className="flex items-center gap-1.5">
              <CountUp
                value={data.ordersWaiting}
                prefersReduced={prefersReduced}
              />
              {showWaitingAlert && (
                <motion.span
                  initial={prefersReduced ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{
                    duration: 0.3,
                    repeat: prefersReduced ? 0 : Infinity,
                    repeatType: 'reverse',
                    repeatDelay: 0.8,
                  }}
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                  aria-label={`${data.ordersWaiting} orders waiting — above threshold`}
                >
                  !
                </motion.span>
              )}
            </span>
          }
        />
      </div>

      {/* Low-stock alerts — horizontal scroll of red chips (only if any) */}
      {lowStock.length > 0 && (
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1 snak-scroll"
          role="alert"
          aria-label="Low-stock items"
        >
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle className="h-3 w-3" />
            Low Stock
          </span>
          {lowStock.map((item) => {
            const label = !item.isAvailable
              ? `${item.name}: unavailable`
              : item.availableCount === null
                ? `${item.name}: low`
                : `${item.name}: ${item.availableCount} left`
            return (
              <span
                key={item.id}
                className="shrink-0 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                title={
                  !item.isAvailable
                    ? `${item.name} — vendor disabled`
                    : item.availableCount === null
                      ? `${item.name} — low stock`
                      : `${item.name} — ${item.availableCount} units left`
                }
              >
                {label}
              </span>
            )
          })}
        </div>
      )}

      {/* Mini charts — side-by-side on desktop, stacked on mobile */}
      <div className="grid gap-2 md:grid-cols-2">
        {/* Status breakdown — horizontal bar chart */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <PieChartIcon className="h-3.5 w-3.5" />
                Status Breakdown
              </div>
              <span className="text-[10px] text-muted-foreground">
                {totalStatusCount} orders
              </span>
            </div>
            {totalStatusCount === 0 ? (
              <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                No orders today
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart
                  data={statusChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="2 2"
                    stroke="oklch(0.92 0.01 180)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    stroke="oklch(0.55 0.02 190)"
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    stroke="oklch(0.55 0.02 190)"
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      fontSize: 11,
                      padding: '4px 8px',
                    }}
                    formatter={(v: number) => [`${v} orders`, 'Count']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {statusChartData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Revenue by hour — line chart (8 AM to 11 PM IST window) */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                Revenue by Hour
              </div>
              <span className="text-[10px] text-muted-foreground">IST</span>
            </div>
            {data.todayRevenue === 0 ? (
              <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                No revenue yet today
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <LineChart
                  data={revenueChartData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="2 2"
                    stroke="oklch(0.92 0.01 180)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10 }}
                    stroke="oklch(0.55 0.02 190)"
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="oklch(0.55 0.02 190)"
                    width={36}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      fontSize: 11,
                      padding: '4px 8px',
                    }}
                    formatter={(v: number) => [inr(v), 'Revenue']}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={{ r: 2, fill: '#0d9488' }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
// MetricCard — compact card with icon + label + value.
// ----------------------------------------------------------------------------
function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  tone: string
}) {
  return (
    <Card>
      <CardContent className="p-2.5">
        <div
          className={`mb-1 flex items-center gap-1 text-[11px] font-medium ${tone}`}
        >
          {icon}
          <span className="text-muted-foreground">{label}</span>
        </div>
        <p className="text-lg font-bold leading-tight tracking-tight">{value}</p>
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// CountUp — framer-motion-driven count-up animation for metric values.
// Writes the animated value directly to the DOM via a ref (text content) so
// the high-frequency animation updates bypass React's render cycle entirely
// (no per-frame setState — keeps the widget responsive on low-end devices).
// Supports a `format` function for currency / locale formatting.
// Honors prefersReducedMotion (instant snap to value).
// ----------------------------------------------------------------------------
function CountUp({
  value,
  format,
  prefersReduced = false,
}: {
  value: number
  format?: (v: number) => string
  // useReducedMotion() returns boolean | null; we accept both (null treated as
  // false — no preference expressed, default to animating).
  prefersReduced?: boolean | null
}) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const prevRef = useRef(value)
  // Normalize null → false for the animation control flow.
  const reduced = prefersReduced === true

  // Initial paint is rendered via JSX (below). Subsequent value changes are
  // written directly to the DOM via the ref inside the effect — no React
  // state, no re-renders during the 600ms animation.
  useEffect(() => {
    const el = spanRef.current
    if (!el) return

    const formatFn = format ?? ((v: number) => String(Math.round(v)))

    if (reduced || prevRef.current === value) {
      el.textContent = formatFn(value)
      prevRef.current = value
      return
    }

    const controls = animate(prevRef.current, value, {
      duration: 0.6,
      ease: 'easeOut',
      onUpdate: (v) => {
        el.textContent = formatFn(v)
      },
    })
    prevRef.current = value
    return () => controls.stop()
  }, [value, format, reduced])

  const initialFormat = format ?? ((v: number) => String(Math.round(v)))
  return (
    <span ref={spanRef} aria-label={initialFormat(value)}>
      {initialFormat(value)}
    </span>
  )
}

// ----------------------------------------------------------------------------
// WidgetSkeleton — loading state shown during initial fetch.
// ----------------------------------------------------------------------------
function WidgetSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading analytics">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  )
}
