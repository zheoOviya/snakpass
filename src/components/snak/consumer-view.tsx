'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Leaf, ArrowLeft, ShoppingCart, Plus, Minus, Clock, MapPin, Loader2, Package } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useCart } from '@/lib/cart-store'
import { useRealtime, realtimeSocket } from '@/hooks/use-realtime'
import { inr } from '@/lib/snack'
import type { MenuItem, Order, Restaurant } from '@/lib/types'
import { VegBadge, SpiceDots, StarRating, CuisineIcon, cuisineGradient } from './bits'
import { OrderTracking } from './order-tracking'

type View = 'browse' | 'menu' | 'tracking'

export function ConsumerView() {
  const [view, setView] = useState<View>('browse')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [q, setQ] = useState('')
  const [vegOnly, setVegOnly] = useState(false)
  const [selected, setSelected] = useState<Restaurant | null>(null)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [loadingMenu, setLoadingMenu] = useState(false)
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [placing, setPlacing] = useState(false)
  const { toast } = useToast()
  const cart = useCart()
  const { connected } = useRealtime(['consumer:all'])

  // fetch restaurants
  const fetchRestaurants = useCallback(async () => {
    setLoadingList(true)
    const res = await fetch(`/api/restaurants?q=${encodeURIComponent(q)}&veg=${vegOnly ? '1' : '0'}`)
    const data = await res.json()
    setRestaurants(data.restaurants ?? [])
    setLoadingList(false)
  }, [q, vegOnly])

  useEffect(() => {
    const t = setTimeout(fetchRestaurants, 250)
    return () => clearTimeout(t)
  }, [fetchRestaurants])

  // fetch menu
  const openRestaurant = useCallback(async (r: Restaurant) => {
    setSelected(r)
    setView('menu')
    setLoadingMenu(true)
    setMenu([])
    const res = await fetch(`/api/restaurants/${r.id}/menu`)
    const data = await res.json()
    setMenu(data.items ?? [])
    setLoadingMenu(false)
  }, [])

  // place order
  const placeOrder = useCallback(async () => {
    if (!cart.restaurantId || cart.lines.length === 0) return
    setPlacing(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          restaurantId: cart.restaurantId,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, name: l.name, price: l.price, quantity: l.quantity })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to place order')
      setActiveOrder(data.order)
      cart.clear()
      setView('tracking')
      toast({ title: 'Order placed! 🎉', description: `Pickup OTP: ${data.order.pickupOtp}` })
    } catch (e) {
      toast({ title: 'Could not place order', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPlacing(false)
    }
  }, [cart, toast])

  // realtime: refresh active order on update
  useEffect(() => {
    const sock = realtimeSocket()
    const handler = (p: { orderId: string }) => {
      if (activeOrder && p.orderId === activeOrder.id) {
        fetch(`/api/orders/${activeOrder.id}`)
          .then((r) => r.json())
          .then((d) => d.order && setActiveOrder(d.order))
      }
    }
    sock.on('order:updated', handler)
    return () => {
      sock.off('order:updated', handler)
    }
  }, [activeOrder])

  const cartTotal = cart.total()
  const cartCount = cart.count()

  if (view === 'tracking' && activeOrder) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => { setView('browse'); setActiveOrder(null) }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to restaurants
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 snak-live-dot' : 'bg-muted-foreground'}`} />
            {connected ? 'Live' : 'Reconnecting…'}
          </div>
        </div>
        <OrderTracking order={activeOrder} />
        <Button className="mt-4 w-full" variant="outline" onClick={() => { setView('browse'); setActiveOrder(null) }}>
          Order something else
        </Button>
      </div>
    )
  }

  if (view === 'menu' && selected) {
    return (
      <div className="px-4 py-6 pb-40">
        <Button variant="ghost" size="sm" className="mb-3" onClick={() => setView('browse')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>

        {/* Restaurant hero */}
        <div className={`relative mb-5 flex items-end gap-4 overflow-hidden rounded-2xl bg-gradient-to-br ${cuisineGradient(selected.cuisine)} p-5 text-white shadow-lg`}>
          <img
            src={selected.image}
            alt={selected.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className={`absolute inset-0 bg-gradient-to-r ${cuisineGradient(selected.cuisine)} opacity-80`} />
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-xl bg-white/20 text-3xl backdrop-blur">
            <CuisineIcon cuisine={selected.cuisine} />
          </div>
          <div className="relative flex-1">
            <h2 className="text-2xl font-bold drop-shadow">{selected.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-white/90">
              <StarRating rating={selected.rating} className="text-white" />
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {selected.prepTimeMins} min</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {selected.address}</span>
            </div>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">{selected.description}</p>

        {/* Menu grouped */}
        {loadingMenu ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupByCategory(menu)).map(([cat, items]) => (
              <div key={cat}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h3>
                <div className="space-y-2">
                  {items.map((it) => (
                    <MenuRow key={it.id} item={it} restaurantId={selected.id} restaurantName={selected.name} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cart bar */}
        <AnimatePresence>
          {cartCount > 0 && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-16"
            >
              <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500 text-sm font-bold text-white">{cartCount}</span>
                  <div>
                    <p className="text-xs text-muted-foreground">{cart.restaurantName}</p>
                    <p className="font-semibold">{inr(cartTotal)}</p>
                  </div>
                </div>
                <Button onClick={placeOrder} disabled={placing} className="bg-teal-600 hover:bg-teal-700">
                  {placing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-1 h-4 w-4" />}
                  Place Order
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  // browse view
  return (
    <div className="px-4 py-6">
      {/* Search + filter */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search restaurants, cuisines…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Leaf className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-medium">Veg only</span>
            <Switch checked={vegOnly} onCheckedChange={setVegOnly} />
          </div>
        </div>
      </div>

      {/* Hero banner */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-700 p-6 text-white shadow-lg">
        <h2 className="text-2xl font-bold">Pickup-first. Zero waiting. 🔥</h2>
        <p className="mt-1 max-w-md text-sm text-teal-50/90">
          Order ahead, pay digitally, and walk in to pick up. Live kitchen tracking with OTP pickup code.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/20 px-3 py-1">⚡ Avg pickup 18 min</span>
          <span className="rounded-full bg-white/20 px-3 py-1">🛡 100% digital</span>
          <span className="rounded-full bg-white/20 px-3 py-1">📍 Bengaluru</span>
        </div>
      </div>

      {loadingList ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full rounded-2xl" />)}
        </div>
      ) : restaurants.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <Package className="mx-auto mb-2 h-8 w-8" />
          No restaurants match your search.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} onOpen={() => openRestaurant(r)} />
          ))}
        </div>
      )}
    </div>
  )
}

function RestaurantCard({ restaurant, onOpen }: { restaurant: Restaurant; onOpen: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition hover:shadow-md"
    >
      <div className={`relative h-32 overflow-hidden bg-gradient-to-br ${cuisineGradient(restaurant.cuisine)}`}>
        <img
          src={restaurant.image}
          alt={restaurant.name}
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className={`absolute inset-0 bg-gradient-to-t ${cuisineGradient(restaurant.cuisine)} opacity-25 mix-blend-multiply`} />
        <div className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 shadow-sm">
          <StarRating rating={restaurant.rating} />
        </div>
        <div className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
          <Clock className="mr-1 inline h-3 w-3" /> {restaurant.prepTimeMins} min
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{restaurant.name}</h3>
          <Badge variant="secondary" className="text-xs">{restaurant.cuisine}</Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{restaurant.description}</p>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {restaurant.address.split(',')[0]}</span>
          <span>{inr(restaurant.priceForTwo)} for two</span>
        </div>
      </div>
    </motion.button>
  )
}

function MenuRow({ item, restaurantId, restaurantName }: { item: MenuItem; restaurantId: string; restaurantName: string }) {
  const cart = useCart()
  const inCart = cart.lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0

  return (
    <Card className={item.isAvailable ? '' : 'opacity-50'}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br ${cuisineGradient('default')}`}>
          <div className="absolute inset-0 flex items-center justify-center text-2xl">🍽️</div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <VegBadge veg={item.isVeg} />
            <h4 className="font-medium">{item.name}</h4>
            {item.spiceLevel > 0 && <SpiceDots level={item.spiceLevel} />}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
          <p className="mt-1 text-sm font-semibold text-teal-700 dark:text-teal-300">{inr(item.price)}</p>
        </div>
        {item.isAvailable ? (
          inCart === 0 ? (
            <Button size="sm" variant="outline" className="border-teal-500 text-teal-700 hover:bg-teal-50 dark:text-teal-300" onClick={() => cart.add(item, restaurantId, restaurantName)}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          ) : (
            <div className="flex items-center gap-1 rounded-lg border border-teal-500">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-teal-700 dark:text-teal-300" onClick={() => cart.decrement(item.id)}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-5 text-center text-sm font-semibold">{inCart}</span>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-teal-700 dark:text-teal-300" onClick={() => cart.increment(item.id)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        ) : (
          <Badge variant="secondary" className="text-xs">Sold out</Badge>
        )}
      </CardContent>
    </Card>
  )
}

function groupByCategory(items: MenuItem[]): Record<string, MenuItem[]> {
  const g: Record<string, MenuItem[]> = {}
  for (const it of items) {
    if (!g[it.category]) g[it.category] = []
    g[it.category].push(it)
  }
  return g
}
