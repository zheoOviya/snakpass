'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { motion } from 'framer-motion'
import { Activity, IndianRupee, ShoppingBag, Store, TrendingUp, Users, Shield, AlertTriangle, ScrollText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { csrfFetch } from '@/lib/csrf-client'
import { STATUS_META, inr, timeAgo } from '@/lib/snack'
import type { AdminMetrics, AuditLog, KillSwitch, Order } from '@/lib/types'

interface MetricsResponse {
  metrics: AdminMetrics
  statusBreakdown: { status: string; count: number }[]
  revenueByRestaurant: { name: string; revenue: number; orders: number }[]
  hourly: { hour: string; orders: number }[]
}

const PIE_COLORS = ['#0d9488', '#f59e0b', '#6366f1', '#ef4444', '#10b981', '#8b5cf6']

export function AdminView() {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [switches, setSwitches] = useState<KillSwitch[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [loading, setLoading] = useState(true)
  const { connected } = useRealtime(['admin:all'])
  const { toast } = useToast()

  const refreshMetrics = useCallback(async () => {
    const res = await fetch('/api/admin/metrics')
    const d = await res.json()
    setData(d)
  }, [])

  const refreshOrders = useCallback(async () => {
    const res = await fetch('/api/orders?role=admin&limit=100')
    const d = await res.json()
    setOrders(d.orders ?? [])
  }, [])

  const refreshSwitches = useCallback(async () => {
    const res = await fetch('/api/kill-switches')
    const d = await res.json()
    setSwitches(d.switches ?? [])
  }, [])

  const refreshLogs = useCallback(async () => {
    const res = await fetch('/api/audit-logs?limit=30')
    const d = await res.json()
    setLogs(d.logs ?? [])
  }, [])

  useEffect(() => {
    let active = true
    // Initial data load — fetch helpers call setState; this is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        toast({ title: `${sw.label} ${next ? 'ENABLED' : 'disabled'}`, variant: next ? 'destructive' : 'default' })
        refreshLogs()
      } catch {
        setSwitches((s) => s.map((x) => (x.key === sw.key ? { ...x, enabled: !next } : x)))
      }
    },
    [toast, refreshLogs],
  )

  const filteredOrders = statusFilter === 'ALL' ? orders : orders.filter((o) => o.status === statusFilter)

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

  const m = data.metrics

  return (
    <div className="px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-teal-600" />
          <h2 className="text-lg font-semibold">Ops Console</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${connected ? 'snak-live-dot' : ''}`} /> {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { refreshMetrics(); refreshOrders(); refreshLogs() }}>
          <Activity className="mr-1 h-4 w-4" /> Refresh
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

      {/* Charts */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Orders — last 12 hours</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.hourly}>
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
                <Pie data={data.statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {data.statusBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.statusBreakdown.map((s, i) => (
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
            <BarChart data={data.revenueByRestaurant} layout="vertical">
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
          <div className="max-h-96 overflow-y-auto snak-scroll">
            <table className="w-full text-sm">
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

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${tone}`}>{icon}<span className="text-muted-foreground">{label}</span></div>
        <p className="text-xl font-bold">{value}</p>
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
