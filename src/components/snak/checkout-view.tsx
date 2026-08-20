'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  Lock,
  MessageSquare,
  Phone,
  ShieldCheck,
  Store,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useCart } from '@/lib/cart-store'
import { csrfFetch } from '@/lib/csrf-client'
import { useToast } from '@/hooks/use-toast'
import { inr } from '@/lib/snack'
import { VegBadge } from './bits'
import type { Order } from '@/lib/types'

interface CheckoutViewProps {
  /** Return to the restaurant menu. */
  onBack: () => void
  /** Order successfully placed + payment captured → switch to order tracking. */
  onSuccess: (order: Order) => void
}

type Phase = 'idle' | 'placing' | 'paying'

const MAX_NOTE = 500

export function CheckoutView({ onBack, onSuccess }: CheckoutViewProps) {
  const cart = useCart()
  const { toast } = useToast()
  const [pickupName, setPickupName] = useState('')
  const [pickupPhone, setPickupPhone] = useState('')
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [prefillLoaded, setPrefillLoaded] = useState(false)

  // Prefill pickup name + phone from the active session if available.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.user) return
        if (d.user.phone) setPickupPhone(d.user.phone)
        if (d.user.name) setPickupName(d.user.name)
      })
      .catch(() => {
        /* session fetch best-effort — user may be unauthenticated */
      })
      .finally(() => !cancelled && setPrefillLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  const cartTotal = cart.total()
  const cartCount = cart.count()
  const itemTotal = cart.lines.reduce((s, l) => s + l.price * l.quantity, 0)

  // 10-digit Indian mobile (strip non-digits before validating).
  const phoneDigits = pickupPhone.replace(/\D/g, '').slice(-10)
  const phoneValid = phoneDigits.length === 10
  const nameValid = pickupName.trim().length >= 2
  const canPay =
    phase === 'idle' &&
    cartCount > 0 &&
    !!cart.restaurantId &&
    phoneValid &&
    nameValid

  const handlePay = async () => {
    if (!cart.restaurantId || cart.lines.length === 0) {
      toast({ title: 'Your cart is empty', description: 'Add an item before checking out.', variant: 'destructive' })
      return
    }
    if (!nameValid) {
      toast({ title: 'Pickup name required', description: 'Please tell us who is picking up the order.', variant: 'destructive' })
      return
    }
    if (!phoneValid) {
      toast({ title: 'Valid phone required', description: 'Enter a 10-digit Indian mobile number.', variant: 'destructive' })
      return
    }

    // Combine pickup details + free-form note into a single note string.
    // The order schema has one `note` field (max 500 chars), so we pack the
    // pickup contact details + instructions together.
    const pickupBlock = `Pickup: ${pickupName.trim()} · ${phoneDigits}`
    const noteBlock = note.trim() ? `Note: ${note.trim()}` : null
    const composedNote = [pickupBlock, noteBlock].filter(Boolean).join('\n').slice(0, MAX_NOTE)

    setPhase('placing')
    let createdOrder: Order | null = null

    try {
      // === Step A: create the order (status CONFIRMED, returns pickupOtp) ===
      const orderRes = await csrfFetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          restaurantId: cart.restaurantId,
          items: cart.lines.map((l) => ({
            menuItemId: l.menuItemId,
            name: l.name,
            price: l.price,
            quantity: l.quantity,
          })),
          note: composedNote,
        }),
        idempotencyKey: crypto.randomUUID(),
      })
      const orderData = await orderRes.json().catch(() => ({}))
      if (!orderRes.ok) {
        throw new Error(
          orderData?.error?.message ??
            (typeof orderData?.error === 'string' ? orderData.error : null) ??
            'Could not place order. Please try again.',
        )
      }
      createdOrder = orderData.order as Order

      // === Step B: capture payment (DEMO mode — realPayments flag is OFF) ===
      // In demo mode the backend accepts any non-empty razorpaySignature, so we
      // synthesise a deterministic demo payment id + signature. No real money
      // moves — this is purely to drive the order into the PAID state.
      setPhase('paying')
      const payRes = await csrfFetch('/api/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: createdOrder.id,
          razorpayPaymentId: `pay_demo_${Date.now()}`,
          razorpaySignature: `sig_demo_${Date.now()}`,
        }),
        idempotencyKey: crypto.randomUUID(),
      })
      const payData = await payRes.json().catch(() => ({}))
      if (!payRes.ok) {
        // Order was created but payment failed — surface the error but still
        // transition to tracking so the user can see the CONFIRMED order and
        // (in a future iteration) retry payment from "My Orders".
        cart.clear()
        toast({
          title: 'Order placed, but payment failed',
          description:
            payData?.error?.message ??
              (typeof payData?.error === 'string' ? payData.error : null) ??
              'Your order is confirmed — please contact support to retry payment.',
          variant: 'destructive',
        })
        onSuccess(createdOrder)
        return
      }

      // The payments route updates order.status to 'PAID' inside its
      // transaction, but the response only returns the Payment object — so
      // re-fetch the order to surface the fresh PAID status + statusHistory.
      let finalOrder: Order = createdOrder
      try {
        const r = await fetch(`/api/orders/${createdOrder.id}`)
        const d = await r.json()
        if (d?.order) finalOrder = d.order as Order
      } catch {
        /* best-effort refresh — fall back to createdOrder */
      }

      cart.clear()
      toast({
        title: 'Payment confirmed! 💳',
        description: `Pickup OTP ${finalOrder.pickupOtp} · ${inr(finalOrder.totalAmount)}`,
      })
      onSuccess(finalOrder)
    } catch (e) {
      // Order creation (or pre-order validation) failed — keep the cart so
      // the user can adjust and try again.
      toast({
        title: createdOrder ? 'Payment failed' : 'Checkout failed',
        description: (e as Error).message ?? 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setPhase('idle')
    }
  }

  // Empty-cart safety: shouldn't normally happen (cart bar is hidden when
  // empty), but route to it directly would land here.
  if (cartCount === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Button variant="ghost" size="sm" className="mb-3" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to menu
        </Button>
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <Store className="mx-auto mb-2 h-8 w-8" />
          Your cart is empty. Add some items before checking out.
        </div>
      </div>
    )
  }

  const processing = phase !== 'idle'
  const phaseLabel = phase === 'placing' ? 'Placing order…' : phase === 'paying' ? 'Processing payment…' : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-40">
      <Button variant="ghost" size="sm" className="mb-3" onClick={onBack} disabled={processing}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to menu
      </Button>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-4"
      >
        <h2 className="text-xl font-bold">Checkout</h2>
        <p className="text-sm text-muted-foreground">
          Review your order, share pickup details, and pay securely.
        </p>
      </motion.div>

      {/* Restaurant banner */}
      <Card className="mb-4 overflow-hidden border-teal-200 dark:border-teal-900">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10 text-teal-700 dark:text-teal-300">
            <Store className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Pickup from</p>
            <p className="font-semibold leading-tight">{cart.restaurantName ?? 'Restaurant'}</p>
          </div>
          <Badge variant="secondary" className="text-xs">Self-pickup</Badge>
        </CardContent>
      </Card>

      {/* Order summary */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Order summary</h3>
            <Badge variant="secondary" className="text-xs">{cartCount} item{cartCount === 1 ? '' : 's'}</Badge>
          </div>
          <div className="space-y-2">
            {cart.lines.map((l) => (
              <div key={l.menuItemId} className="flex items-center gap-3">
                <VegBadge veg={l.isVeg} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {inr(l.price)} × {l.quantity}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{inr(l.price * l.quantity)}</p>
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium tabular-nums">{inr(itemTotal)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums text-teal-700 dark:text-teal-300">{inr(cartTotal)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Pickup details */}
      <Card className="mb-4">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            <h3 className="text-sm font-semibold">Pickup details</h3>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup-name">Pickup name</Label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pickup-name"
                placeholder="e.g. Aarav Sharma"
                value={pickupName}
                onChange={(e) => setPickupName(e.target.value)}
                className="pl-9"
                disabled={processing}
                autoComplete="name"
                maxLength={80}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup-phone">Phone number</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pickup-phone"
                placeholder="10-digit mobile"
                value={pickupPhone}
                onChange={(e) => setPickupPhone(e.target.value)}
                className="pl-9"
                inputMode="tel"
                disabled={processing}
                autoComplete="tel-national"
                aria-invalid={prefillLoaded && !phoneValid && pickupPhone.length > 0}
              />
            </div>
            {prefillLoaded && pickupPhone.length > 0 && !phoneValid && (
              <p className="text-xs text-destructive">Enter a valid 10-digit Indian mobile number.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup-note">Special instructions (optional)</Label>
            <div className="relative">
              <MessageSquare className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Textarea
                id="pickup-note"
                placeholder="e.g. less spicy, pack extra chutney, call on arrival…"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                className="pl-9"
                rows={3}
                disabled={processing}
                maxLength={MAX_NOTE}
              />
            </div>
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {note.length}/{MAX_NOTE}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Demo-mode payment banner */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-emerald-800 dark:text-emerald-200">Test Payment (Demo Mode)</p>
          <p className="mt-0.5 text-xs text-emerald-700/90 dark:text-emerald-300/80">
            No real money is charged. SnakZap is running in demo mode — the
            payment is captured instantly and your order moves to the kitchen.
          </p>
        </div>
        <Lock className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
      </motion.div>

      {/* Sticky pay bar (mobile) / inline actions (desktop) */}
      <PayBar
        processing={processing}
        phaseLabel={phaseLabel}
        canPay={canPay}
        total={cartTotal}
        onPay={handlePay}
        onBack={onBack}
      />
    </div>
  )
}

/** Pay bar — sticky on mobile (bottom), inline at the end on desktop. */
function PayBar({
  processing,
  phaseLabel,
  canPay,
  total,
  onPay,
  onBack,
}: {
  processing: boolean
  phaseLabel: string | null
  canPay: boolean
  total: number
  onPay: () => void
  onBack: () => void
}) {
  const payButton = (
    <Button
      onClick={onPay}
      disabled={!canPay}
      className="flex-1 bg-teal-600 text-base hover:bg-teal-700 disabled:opacity-60"
      size="lg"
      aria-busy={processing}
    >
      {processing ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {phaseLabel}
        </>
      ) : (
        <>
          <CreditCard className="mr-2 h-4 w-4" />
          Pay {inr(total)}
        </>
      )}
    </Button>
  )

  return (
    <>
      {/* Desktop inline actions */}
      <div className="hidden md:flex md:items-center md:gap-3">
        <Button variant="outline" onClick={onBack} disabled={processing}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {payButton}
      </div>

      {/* Mobile sticky bar */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Total payable</p>
            <p className="font-semibold tabular-nums">{inr(total)}</p>
          </div>
          {payButton}
        </div>
      </motion.div>
    </>
  )
}
