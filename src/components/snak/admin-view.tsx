'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  IndianRupee,
  LayoutDashboard,
  ListOrdered,
  Menu,
  Receipt,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Shield,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Headphones,
  Flag,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { csrfFetch } from '@/lib/csrf-client'
import { STATUS_META, inr, timeAgo } from '@/lib/snack'
import type { AdminMetrics, AuditLog, KillSwitch, Order } from '@/lib/types'
import { RewardsModule } from './admin/modules/rewards-module'
import { FraudRiskModule } from './admin/modules/fraud-risk-module'
import { SupportModule } from './admin/modules/support-module'
import { FeatureFlagsModule } from './admin/modules/feature-flags-module'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — AdminView with sidebar navigation + module routing
// ----------------------------------------------------------------------------
// Adds a left sidebar (desktop) / hamburger Sheet (mobile) with 11 module
// links per blueprint §24:
//   Overview · Users · Vendors · Orders · Payments · Refunds · Rewards ·
//   Fraud/Risk · Audit · Feature Flags · Support
//
// Additive: preserves ALL existing Overview functionality (metrics, charts,
// kill switches, orders table, audit log). New modules reuse existing API
// calls + 3 new admin endpoints (Wave 8 Task 8 additive).
// ----------------------------------------------------------------------------

interface MetricsResponse {
  metrics: AdminMetrics
  // Wave 8 Task 8 additive — new metric buckets.
  rewards?: { totalIssued: number; totalRedeemed: number; activeAccounts: number }
  gifts?: { totalSent: number; totalRedeemed: number; totalCancelled: number }
  groupOrders?: { totalCreated: number; totalConfirmed: number; totalCancelled: number }
  statusBreakdown: { status: string; count: number }[]
  revenueByRestaurant: { name: string; revenue: number; orders: number }[]
  hourly: { hour: string; orders: number }[]
}

type ModuleKey =
  | 'overview'
  | 'users'
  | 'vendors'
  | 'orders'
  | 'payments'
  | 'refunds'
  | 'rewards'
  | 'fraud'
  | 'audit'
  | 'feature-flags'
  | 'support'

interface NavItem {
  key: ModuleKey
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { key: 'overview',      label: 'Overview',     icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'users',         label: 'Users',        icon: <Users className="h-4 w-4" /> },
  { key: 'vendors',       label: 'Vendors',      icon: <Store className="h-4 w-4" /> },
  { key: 'orders',        label: 'Orders',        icon: <ShoppingBag className="h-4 w-4" /> },
  { key: 'payments',      label: 'Payments',     icon: <IndianRupee className="h-4 w-4" /> },
  { key: 'refunds',       label: 'Refunds',      icon: <RotateCcw className="h-4 w-4" /> },
  { key: 'rewards',       label: 'Rewards',      icon: <Sparkles className="h-4 w-4" /> },
  { key: 'fraud',         label: 'Fraud / Risk', icon: <ShieldAlert className="h-4 w-4" /> },
  { key: 'audit',         label: 'Audit',        icon: <ScrollText className="h-4 w-4" /> },
  { key: 'feature-flags', label: 'Feature Flags', icon: <Flag className="h-4 w-4" /> },
  { key: 'support',       label: 'Support',      icon: <Headphones className="h-4 w-4" /> },
]

const PIE_COLORS = ['#0d9488', '#f59e0b', '#6366f1', '#ef4444', '#10b981', '#8b5cf6']

export function AdminView() {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [switches, setSwitches] = useState<KillSwitch[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<ModuleKey>('overview')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { connected } = useRealtime(['admin:all'])
  const { toast } = useToast()

  const refreshMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/metrics', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to load metrics (${res.status})`)
      const d = await res.json()
      setData(d)
    } catch (e) {
      toast({ title: 'Metrics load failed', description: (e as Error).message, variant: 'destructive' })
    }
  }, [toast])

  const refreshOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/orders?role=admin&limit=100', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to load orders (${res.status})`)
      const d = await res.json()
      setOrders(d.orders ?? [])
    } catch (e) {
      toast({ title: 'Orders load failed', description: (e as Error).message, variant: 'destructive' })
    }
  }, [toast])

  const refreshSwitches = useCallback(async () => {
    try {
      const res = await fetch('/api/kill-switches', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to load kill switches (${res.status})`)
      const d = await res.json()
      setSwitches(d.switches ?? [])
    } catch (e) {
      toast({ title: 'Kill switches load failed', description: (e as Error).message, variant: 'destructive' })
    }
  }, [toast])

  const refreshLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/audit-logs?limit=30', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to load audit logs (${res.status})`)
      const d = await res.json()
      setLogs(d.logs ?? [])
    } catch (e) {
      toast({ title: 'Audit logs load failed', description: (e as Error).message, variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => {
    let active = true
    // Initial data load — fetch helpers call setState; this is intentional.
    Promise.all([refreshMetrics(), refreshOrders(), refreshSwitches(), refreshLogs()]).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [refreshMetrics, refreshOrders, refreshSwitches, refreshLogs])

  // realtime refresh
  useEffect(() => {
    const sock = realtimeSocket()
    const onOrder = () => { refreshOrders(); refreshMetrics() }
    const onKs = () => { refreshSwitches(); refreshLogs() }
    sock.on('order:updated', onOrder)
    sock.on('order:created', onOrder)
    sock.on('killswitch:toggled', onKs)
    return () => {
      sock.off('order:updated', onOrder)
      sock.off('order:created', onOrder)
      sock.off('killswitch:toggled', onKs)
    }
  }, [refreshOrders, refreshMetrics, refreshSwitches, refreshLogs])

  // auto-refresh metrics every 30s
  useEffect(() => {
    const t = setInterval(refreshMetrics, 30000)
    return () => clearInterval(t)
  }, [refreshMetrics])

  const toggleSwitch = useCallback(
    async (sw: KillSwitch) => {
      const next = !sw.enabled
      setSwitches((s) => s.map((x) => (x.key === sw.key ? { ...x, enabled: next } : x)))
      try {
        await csrfFetch(`/api/kill-switches/${sw.key}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
        toast({ title: `${sw.label} ${next ? 'enabled' : 'disabled'}`, variant: next ? 'destructive' : 'default' })
        void refreshLogs()
      } catch (e) {
        setSwitches((s) => s.map((x) => (x.key === sw.key ? { ...x, enabled: !next } : x)))
        toast({ title: 'Toggle failed', description: (e as Error).message, variant: 'destructive' })
      }
    },
    [toast, refreshLogs],
  )

  const filteredOrders = statusFilter === 'ALL' ? orders : orders.filter((o) => o.status === statusFilter)

  // -------------------------------------------------------------------------
  // Loading state — only the Overview module needs full data on first paint.
  // Other modules fetch their own data.
  // -------------------------------------------------------------------------
  if (loading || !data) {
    return (
      <div className="px-4 py-6">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  // Wave 8: capture the narrowed (non-null) data so inner module closures
  // (defined below) see the narrowed MetricsResponse type, not the
  // `MetricsResponse | null` from useState.
  const d = data
  const m = d.metrics
  const refreshAll = () => { void refreshMetrics(); void refreshOrders(); void refreshSwitches(); void refreshLogs() }

  // -------------------------------------------------------------------------
  // Sidebar — shared between desktop + mobile (Sheet).
  // -------------------------------------------------------------------------
  const renderNavItems = (onSelect: () => void) => (
    <nav className="space-y-1" aria-label="Admin modules">
      {NAV_ITEMS.map((item) => {
        const isActive = activeModule === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setActiveModule(item.key)
              onSelect()
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
              isActive
                ? 'bg-teal-600 text-white shadow-sm'
                : 'text-foreground hover:bg-accent'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className={isActive ? 'text-white' : 'text-muted-foreground'}>{item.icon}</span>
            <span className="font-medium">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )

  const desktopSidebar = (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r bg-card md:block">
      <div className="flex items-center gap-2 border-b p-4">
        <Shield className="h-5 w-5 text-teal-600" />
        <span className="text-sm font-semibold">Ops Console</span>
      </div>
      <div className="p-3">{renderNavItems(() => {})}</div>
      <div className="mt-auto px-4 py-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${connected ? 'snak-live-dot' : ''}`} /> {connected ? 'Live' : 'Offline'}
        </span>
      </div>
    </aside>
  )

  const mobileHeader = (
    <header className="flex items-center justify-between border-b bg-card px-4 py-2 md:hidden">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-teal-600" />
        <span className="text-sm font-semibold">Ops Console</span>
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Open navigation menu">
            <Menu className="h-4 w-4" /> Modules
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-teal-600" /> Admin modules
            </SheetTitle>
          </SheetHeader>
          <div className="p-3">{renderNavItems(() => setMobileNavOpen(false))}</div>
        </SheetContent>
      </Sheet>
    </header>
  )

  // -------------------------------------------------------------------------
  // Render the active module.
  // -------------------------------------------------------------------------
  const renderModule = () => {
    switch (activeModule) {
      case 'overview':
        return <OverviewModule />
      case 'users':
        return <UsersModule />
      case 'vendors':
        return <VendorsModule />
      case 'orders':
        return <OrdersModule />
      case 'payments':
        return <PaymentsModule />
      case 'refunds':
        return <RefundsModule />
      case 'rewards':
        return <RewardsModule />
      case 'fraud':
        return <FraudRiskModule />
      case 'audit':
        return <AuditModule />
      case 'feature-flags':
        return <FeatureFlagsModule />
      case 'support':
        return <SupportModule />
      default:
        return <OverviewModule />
    }
  }

  // =========================================================================
  // Inner modules — Overview uses closure-scoped state. Others receive data
  // via props (passed below). Each is defined as a sub-component closure that
  // captures the AdminView state.
  // =========================================================================
  function OverviewModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-teal-600" />
            <h2 className="text-lg font-semibold">Overview</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${connected ? 'snak-live-dot' : ''}`} /> {connected ? 'Live' : 'Offline'}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={refreshAll}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Metric cards */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard icon={<ShoppingBag className="h-4 w-4" />} label="Total Orders" value={String(m.totalOrders)} tone="text-teal-600" />
          <MetricCard icon={<Activity className="h-4 w-4" />} label="Active" value={String(m.activeOrders)} tone="text-amber-600" />
          <MetricCard icon={<IndianRupee className="h-4 w-4" />} label="Revenue" value={inr(m.revenue)} tone="text-emerald-600" />
          <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Avg Order" value={inr(m.aov)} tone="text-blue-600" />
          <MetricCard icon={<Store className="h-4 w-4" />} label="Restaurants" value={String(m.activeRestaurants)} tone="text-purple-600" />
          <MetricCard icon={<Users className="h-4 w-4" />} label="Consumers" value={String(m.consumers)} tone="text-pink-600" />
        </div>

        {/* Wave 8 additive — rewards / gifts / groupOrders mini metrics */}
        {(d.rewards || d.gifts || d.groupOrders) && (
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            {d.rewards && (
              <MetricCard
                icon={<Sparkles className="h-4 w-4" />}
                label="Rewards · Issued"
                value={String(d.rewards.totalIssued)}
                sub={`${d.rewards.activeAccounts} active · ${d.rewards.totalRedeemed} redeemed`}
                tone="text-amber-600"
              />
            )}
            {d.gifts && (
              <MetricCard
                icon={<Receipt className="h-4 w-4" />}
                label="Gifts · Sent"
                value={String(d.gifts.totalSent)}
                sub={`${d.gifts.totalRedeemed} redeemed · ${d.gifts.totalCancelled} cancelled`}
                tone="text-pink-600"
              />
            )}
            {d.groupOrders && (
              <MetricCard
                icon={<Users className="h-4 w-4" />}
                label="Group Orders"
                value={String(d.groupOrders.totalCreated)}
                sub={`${d.groupOrders.totalConfirmed} confirmed · ${d.groupOrders.totalCancelled} cancelled`}
                tone="text-teal-600"
              />
            )}
          </div>
        )}

        {/* Charts */}
        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Orders — last 12 hours</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 180)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="oklch(0.5 0.02 190)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="oklch(0.5 0.02 190)" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="orders" stroke="#0d9488" strokeWidth={2} dot={{ r: 3, fill: '#0d9488' }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={d.statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {d.statusBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-2">
                {d.statusBreakdown.map((s, i) => (
                  <span key={s.status} className="inline-flex items-center gap-1 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {STATUS_META[s.status]?.short ?? s.status}: {s.count}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-sm">Revenue by restaurant</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.revenueByRestaurant} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 180)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="oklch(0.5 0.02 190)" tickFormatter={(v) => '₹' + (v / 100).toFixed(0) + 'k'} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="oklch(0.5 0.02 190)" width={120} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v: number) => inr(v)} />
                <Bar dataKey="revenue" fill="#0d9488" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Kill switches */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Kill Switches
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {switches.map((sw) => (
              <div key={sw.key} className={`flex items-center justify-between rounded-lg border p-3 ${sw.enabled ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : ''}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{sw.label}</span>
                    <Badge variant={sw.severity === 'CRITICAL' ? 'destructive' : 'secondary'} className="text-[10px]">{sw.severity}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{sw.description}</p>
                </div>
                <Switch checked={sw.enabled} onCheckedChange={() => toggleSwitch(sw)} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Orders table */}
        <Card className="mb-5">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">All Orders ({filteredOrders.length})</CardTitle>
              <div className="flex flex-wrap gap-1">
                {['ALL', 'CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? 'default' : 'outline'}
                    className={`h-7 px-2 text-xs ${statusFilter === s ? 'bg-teal-600 hover:bg-teal-700' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'ALL' ? 'All' : STATUS_META[s]?.short ?? s}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto snak-scroll">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Order</th>
                    <th className="py-2 pr-2 font-medium">Restaurant</th>
                    <th className="py-2 pr-2 font-medium">Status</th>
                    <th className="py-2 pr-2 text-right font-medium">Total</th>
                    <th className="py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const meta = STATUS_META[o.status] ?? STATUS_META.CONFIRMED
                    return (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-mono text-xs">#{o.id.slice(-6).toUpperCase()}{o.isCatering && ' 🎉'}</td>
                        <td className="py-2 pr-2">{o.restaurant.name}</td>
                        <td className="py-2 pr-2"><Badge className={meta.tone}>{meta.short}</Badge></td>
                        <td className="py-2 pr-2 text-right font-medium">{inr(o.totalAmount)}</td>
                        <td className="py-2 text-right text-xs text-muted-foreground">{timeAgo(o.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Audit log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScrollText className="h-4 w-4 text-teal-600" /> Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 space-y-2 overflow-y-auto snak-scroll">
              {logs.map((l) => (
                <motion.div key={l.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3 border-b pb-2 last:border-0">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                    {l.actorRole === 'SUPER_ADMIN' ? 'SA' : l.actorRole === 'VENDOR_OWNER' ? 'VO' : l.actorRole === 'CONSUMER' ? 'C' : 'SY'}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{l.actorName}</span>
                      <span className="ml-2 font-mono text-xs text-teal-600">{l.action}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{prettyMeta(l.metadata)} · {timeAgo(l.createdAt)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -- Users --------------------------------------------------------------
  function UsersModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-pink-600" />
          <h2 className="text-lg font-semibold">Users</h2>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Users className="h-4 w-4" />} label="Consumers" value={String(m.consumers)} tone="text-pink-600" />
          <MetricCard icon={<Store className="h-4 w-4" />} label="Restaurants" value={String(m.restaurants)} tone="text-purple-600" />
          <MetricCard icon={<ShoppingBag className="h-4 w-4" />} label="Total Orders" value={String(m.totalOrders)} tone="text-teal-600" />
          <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="AOV" value={inr(m.aov)} tone="text-blue-600" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Per-user breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Full per-user admin list (search · filter · suspend) deferred to Wave 9+. Aggregate user counts come from{' '}
              <code className="font-mono">/api/admin/metrics</code> (consumers, restaurants).
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -- Vendors ------------------------------------------------------------
  function VendorsModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center gap-2">
          <Store className="h-5 w-5 text-purple-600" />
          <h2 className="text-lg font-semibold">Vendors</h2>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCard icon={<Store className="h-4 w-4" />} label="Total" value={String(m.restaurants)} tone="text-purple-600" />
          <MetricCard icon={<Activity className="h-4 w-4" />} label="Active" value={String(m.activeRestaurants)} tone="text-emerald-600" />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="Suspended" value={String(Math.max(0, m.restaurants - m.activeRestaurants))} tone="text-red-600" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Revenue by restaurant</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto snak-scroll">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Restaurant</th>
                    <th className="py-2 pr-2 text-right font-medium">Revenue</th>
                    <th className="py-2 text-right font-medium">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {d.revenueByRestaurant.map((r) => (
                    <tr key={r.name} className="border-b last:border-0">
                      <td className="py-2 pr-2">{r.name}</td>
                      <td className="py-2 pr-2 text-right font-medium">{inr(r.revenue)}</td>
                      <td className="py-2 text-right">{r.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -- Orders -------------------------------------------------------------
  function OrdersModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-teal-600" />
            <h2 className="text-lg font-semibold">Orders</h2>
            <Badge variant="secondary" className="text-[10px]">{orders.length} loaded</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refreshOrders()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </div>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">All Orders ({filteredOrders.length})</CardTitle>
              <div className="flex flex-wrap gap-1">
                {['ALL', 'CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? 'default' : 'outline'}
                    className={`h-7 px-2 text-xs ${statusFilter === s ? 'bg-teal-600 hover:bg-teal-700' : ''}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'ALL' ? 'All' : STATUS_META[s]?.short ?? s}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-auto snak-scroll">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Order</th>
                    <th className="py-2 pr-2 font-medium">Restaurant</th>
                    <th className="py-2 pr-2 font-medium">Status</th>
                    <th className="py-2 pr-2 text-right font-medium">Total</th>
                    <th className="py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const meta = STATUS_META[o.status] ?? STATUS_META.CONFIRMED
                    return (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-mono text-xs">#{o.id.slice(-6).toUpperCase()}{o.isCatering && ' 🎉'}</td>
                        <td className="py-2 pr-2">{o.restaurant.name}</td>
                        <td className="py-2 pr-2"><Badge className={meta.tone}>{meta.short}</Badge></td>
                        <td className="py-2 pr-2 text-right font-medium">{inr(o.totalAmount)}</td>
                        <td className="py-2 text-right text-xs text-muted-foreground">{timeAgo(o.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -- Payments -----------------------------------------------------------
  function PaymentsModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center gap-2">
          <IndianRupee className="h-5 w-5 text-emerald-600" />
          <h2 className="text-lg font-semibold">Payments</h2>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<IndianRupee className="h-4 w-4" />} label="Revenue" value={inr(m.revenue)} tone="text-emerald-600" />
          <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Avg Order" value={inr(m.aov)} tone="text-blue-600" />
          <MetricCard icon={<Receipt className="h-4 w-4" />} label="Settled" value={inr(m.settled)} tone="text-teal-600" />
          <MetricCard icon={<ShoppingBag className="h-4 w-4" />} label="Picked Up" value={String(m.pickedUp)} tone="text-purple-600" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Payment ledger</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Payment ledger detail view (per-order capture, settlement batch, gateway webhook evidence) is
              governed by the Wave-3a payment hardening — read-only inspection surface deferred to Wave 9+.
              Aggregate totals come from <code className="font-mono">/api/admin/metrics</code>.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -- Refunds ------------------------------------------------------------
  function RefundsModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-amber-600" />
          <h2 className="text-lg font-semibold">Refunds</h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Refund processing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Refunds are processed via{' '}
              <code className="font-mono">POST /api/payments/refund</code> (Wave 3a P0-04 — governance-protected).
              A read-only refund ledger surface will ship in Wave 9+. The{' '}
              <span className="font-medium text-foreground">Fraud / Risk</span> module surfaces reconciliation
              findings + exception queue entries that may include refund anomalies.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -- Audit --------------------------------------------------------------
  function AuditModule() {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-teal-600" />
            <h2 className="text-lg font-semibold">Audit Trail</h2>
            <Badge variant="secondary" className="text-[10px]">{logs.length} recent</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refreshLogs()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </div>
        <Card>
          <CardContent className="pt-4">
            <div className="max-h-[70vh] space-y-2 overflow-y-auto snak-scroll">
              {logs.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No audit entries yet.
                </div>
              ) : (
                logs.map((l) => (
                  <motion.div key={l.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3 border-b pb-2 last:border-0">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                      {l.actorRole === 'SUPER_ADMIN' ? 'SA' : l.actorRole === 'VENDOR_OWNER' ? 'VO' : l.actorRole === 'CONSUMER' ? 'C' : 'SY'}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{l.actorName}</span>
                        <span className="ml-2 font-mono text-xs text-teal-600">{l.action}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{prettyMeta(l.metadata)} · {timeAgo(l.createdAt)}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Shell layout — sidebar + main panel.
  // -------------------------------------------------------------------------
  return (
    <div className="flex min-h-screen w-full bg-background">
      {desktopSidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {mobileHeader}
        <main className="min-w-0 flex-1">{renderModule()}</main>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone: string
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${tone}`}>{icon}<span className="text-muted-foreground">{label}</span></div>
        <p className="text-xl font-bold">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function prettyMeta(raw: string): string {
  try {
    const o = JSON.parse(raw)
    return Object.entries(o)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ')
  } catch {
    return raw
  }
}
