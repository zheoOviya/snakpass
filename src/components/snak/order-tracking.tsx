'use client'

import { QRCodeSVG } from 'qrcode.react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { STATUS_META, inr, statusHistoryArray, timeAgo } from '@/lib/snack'
import type { Order } from '@/lib/types'

const FLOW = ['CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP']

export function OrderTracking({ order }: { order: Order }) {
  const meta = STATUS_META[order.status] ?? STATUS_META.CONFIRMED
  const currentStep = FLOW.indexOf(order.status)
  const history = statusHistoryArray(order.statusHistory)
  const readyAt = history.find((h) => h.status === 'READY_FOR_PICKUP')?.at
  const isReady = order.status === 'READY_FOR_PICKUP'
  const isPickedUp = order.status === 'PICKED_UP'

  return (
    <Card className="overflow-hidden border-teal-200 dark:border-teal-900">
      <div className="bg-gradient-to-br from-teal-500 to-emerald-600 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-teal-50/80">Pickup Order</p>
            <h3 className="text-lg font-bold">{order.restaurant.name}</h3>
          </div>
          <Badge className="bg-white/20 text-white hover:bg-white/30">{meta.short}</Badge>
        </div>
        <p className="mt-1 text-sm text-teal-50/90">{order.restaurant.address}</p>
      </div>

      <CardContent className="p-5">
        {/* Timeline */}
        <ol className="relative space-y-4">
          {FLOW.map((status, i) => {
            const m = STATUS_META[status]
            const done = i < currentStep || isPickedUp
            const active = i === currentStep && !isPickedUp
            return (
              <li key={status} className="flex items-start gap-3">
                <div className="relative flex flex-col items-center">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition ${
                      done
                        ? 'bg-emerald-500 text-white'
                        : active
                          ? 'bg-teal-500 text-white snak-live-dot'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {done ? '✓' : m.emoji}
                  </span>
                  {i < FLOW.length - 1 && (
                    <span className={`mt-1 h-6 w-0.5 ${done ? 'bg-emerald-400' : 'bg-border'}`} />
                  )}
                </div>
                <div className="pt-1">
                  <p className={`text-sm font-medium ${active ? 'text-teal-700 dark:text-teal-300' : done ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {m.label}
                  </p>
                  {active && <p className="text-xs text-muted-foreground">In progress…</p>}
                  {done && history.find((h) => h.status === status) && (
                    <p className="text-xs text-muted-foreground">{timeAgo(history.find((h) => h.status === status)!.at)}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {/* Pickup code */}
        {!isPickedUp && (
          <div className="mt-5 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-white p-2 shadow-sm dark:bg-background">
                <QRCodeSVG value={`snakzap:pickup:${order.id}:otp:${order.pickupOtp}`} size={84} level="M" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pickup OTP</p>
                <p className="font-mono text-3xl font-bold tracking-[0.3em] text-teal-700 dark:text-teal-300">
                  {order.pickupOtp}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isReady ? 'Show this code at the counter to collect your order.' : readyAt ? 'Your order is ready!' : 'Show this code when you arrive for pickup.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Items */}
        <div className="mt-4 space-y-1.5">
          {order.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{it.quantity}×</span> {it.name}
              </span>
              <span className="font-medium">{inr(it.subtotal)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold">
            <span>Total Paid</span>
            <span>{inr(order.totalAmount)}</span>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">Order placed {timeAgo(order.createdAt)} · #{order.id.slice(-6).toUpperCase()}</p>
      </CardContent>
    </Card>
  )
}
