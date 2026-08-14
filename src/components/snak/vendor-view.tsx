'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Store, Clock, CheckCircle2, ChefHat, Bell, X, UtensilsCrossed, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { csrfFetch } from '@/lib/csrf-client'
import { STATUS_META, NEXT_STATUS, inr, timeAgo } from '@/lib/snack'
import type { MenuItem, Order, Restaurant } from '@/lib/types'
import { VegBadge, SpiceDots } from './bits'

export function VendorView() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [orders, setOrders] = useState<Order[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'orders' | 'menu'>('orders')
  const { connected } = useRealtime(['vendor:all'])
  const { toast } = useToast()

  // load restaurants
  useEffect(() => {
    fetch('/api/restaurants')
      .then((r) => r.json())
      .then((d) => {
        setRestaurants(d.restaurants ?? [])
        if (d.restaurants?.[0]) setActiveId(d.restaurants[0].id)
      })
  }, [])

  const refreshOrders = useCallback(async () => {
    if (!activeId) return
    const res = await fetch(`/api/orders?role=vendor&restaurantId=${activeId}&limit=50`)
    const data = await res.json()
    setOrders(data.orders ?? [])
  }, [activeId])

  const refreshMenu = useCallback(async () => {
    if (!activeId) return
    const res = await fetch(`/api/restaurants/${activeId}/menu`)
    const data = await res.json()
    setMenu(data.items ?? [])
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    setLoading(true)
    Promise.all([refreshOrders(), refreshMenu()]).finally(() => setLoading(false))
  }, [activeId, refreshOrders, refreshMenu])

  // realtime updates
  useEffect(() => {
    const sock = realtimeSocket()
    const handler = (p: { restaurantId: string; orderId: string }) => {
      if (p.restaurantId === activeId) refreshOrders()
    }
    sock.on('order:updated', handler)
    sock.on('order:created', handler)
    return () => {
      sock.off('order:updated', handler)
      sock.off('order:created', handler)
    }
  }, [activeId, refreshOrders])

  const advance = useCallback(
    async (order: Order) => {
      const next = NEXT_STATUS[order.status]
      if (!next) return
      try {
        const res = await csrfFetch(`/api/orders/${order.id}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: next, actorRole: 'VENDOR_OWNER' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        toast({ title: `${order.restaurant.name} → ${STATUS_META[next].short}` })
        refreshOrders()
      } catch (e) {
        toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
      }
    },
    [refreshOrders, toast],
  )

  const cancel = useCallback(
    async (order: Order) => {
      try {
        await csrfFetch(`/api/orders/${order.id}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'CANCELLED', actorRole: 'VENDOR_OWNER' }),
        })
        toast({ title: 'Order cancelled' })
        refreshOrders()
      } catch (e) {
        toast({ title: 'Cancel failed', description: (e as Error).message, variant: 'destructive' })
      }
    },
    [refreshOrders, toast],
  )

  const toggleAvailability = useCallback(
    async (item: MenuItem) => {
      const next = !item.isAvailable
      setMenu((m) => m.map((x) => (x.id === item.id ? { ...x, isAvailable: next } : x)))
      try {
        await csrfFetch(`/api/menu/${item.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isAvailable: next }),
        })
        toast({ title: `${item.name} ${next ? 'available' : 'unavailable'}` })
      } catch (e) {
        setMenu((m) => m.map((x) => (x.id === item.id ? { ...x, isAvailable: !next } : x)))
        toast({ title: 'Update failed', variant: 'destructive' })
      }
    },
    [toast],
  )

  const active = restaurants.find((r) => r.id === activeId)
  const activeOrders = orders.filter((o) => o.status !== 'PICKED_UP' && o.status !== 'CANCELLED')
  const completed = orders.filter((o) => o.status === 'PICKED_UP')

  return (
    <div className="px-4 py-6">
      {/* Restaurant selector */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-teal-600" />
          <h2 className="text-lg font-semibold">Vendor Console</h2>
          <span className={`ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${connected ? 'snak-live-dot' : ''}`} /> {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'orders' | 'menu')}>
          <TabsList>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="menu">Menu</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {restaurants.length > 1 && (
        <Tabs value={activeId} onValueChange={setActiveId}>
          <TabsList className="mb-4 flex h-auto flex-wrap">
            {restaurants.map((r) => (
              <TabsTrigger key={r.id} value={r.id} className="text-xs">
                {r.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {tab === 'orders' ? (
        loading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
        ) : activeOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            <ChefHat className="mx-auto mb-2 h-8 w-8" /> No active orders right now.
          </div>
        ) : (
          <div className="space-y-3">
            {activeOrders.map((o) => (
              <VendorOrderCard key={o.id} order={o} onAdvance={() => advance(o)} onCancel={() => cancel(o)} />
            ))}
            {completed.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed today ({completed.length})</h3>
                <div className="space-y-2">
                  {completed.slice(0, 5).map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">#{o.id.slice(-6).toUpperCase()} · {o.itemsCount} items</span>
                      <span className="font-medium">{inr(o.totalAmount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        // Menu management
        loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UtensilsCrossed className="h-4 w-4 text-teal-600" /> {active?.name} Menu
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {menu.map((it) => (
                <div key={it.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <VegBadge veg={it.isVeg} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{it.name}</span>
                      {it.spiceLevel > 0 && <SpiceDots level={it.spiceLevel} />}
                    </div>
                    <span className="text-xs text-muted-foreground">{inr(it.price)} · {it.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${it.isAvailable ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {it.isAvailable ? 'Available' : 'Sold out'}
                    </span>
                    <Switch checked={it.isAvailable} onCheckedChange={() => toggleAvailability(it)} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      )}
    </div>
  )
}

function VendorOrderCard({ order, onAdvance, onCancel }: { order: Order; onAdvance: () => void; onCancel: () => void }) {
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED
  const next = NEXT_STATUS[order.status]
  const nextMeta = next ? STATUS_META[next] : null
  const isReady = order.status === 'READY_FOR_PICKUP'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={isReady ? 'border-teal-400 shadow-md' : ''}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(-6).toUpperCase()}</span>
                {order.isCatering && <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-950 dark:text-purple-300">Catering</Badge>}
                <Badge className={meta.tone}>{meta.emoji} {meta.short}</Badge>
              </div>
              {order.isCatering && order.headcount && (
                <p className="mt-1 text-xs text-purple-600 dark:text-purple-400">👥 Headcount: {order.headcount} · {order.note}</p>
              )}
              <div className="mt-2 space-y-0.5">
                {order.items.map((it, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{it.quantity}×</span> {it.name}
                  </div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{inr(order.totalAmount)}</p>
              <p className="text-xs text-muted-foreground">
                <Clock className="mr-1 inline h-3 w-3" />
                {timeAgo(order.createdAt)}
              </p>
            </div>
          </div>

          {isReady && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-teal-50 px-3 py-2 dark:bg-teal-950/40">
              <span className="text-xs text-muted-foreground">Pickup OTP</span>
              <span className="font-mono text-xl font-bold tracking-[0.25em] text-teal-700 dark:text-teal-300">{order.pickupOtp}</span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            {next && (
              <Button onClick={onAdvance} className="flex-1 bg-teal-600 hover:bg-teal-700">
                {next === 'PREPARING' && <ChefHat className="mr-1 h-4 w-4" />}
                {next === 'ALMOST_READY' && <Clock className="mr-1 h-4 w-4" />}
                {next === 'READY_FOR_PICKUP' && <Bell className="mr-1 h-4 w-4" />}
                {next === 'PICKED_UP' && <CheckCircle2 className="mr-1 h-4 w-4" />}
                Mark {nextMeta?.short}
              </Button>
            )}
            {order.status !== 'CANCELLED' && order.status !== 'PICKED_UP' && (
              <Button variant="outline" size="icon" onClick={onCancel} title="Cancel order">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
