'use client'

// =============================================================================
//  SnakZap — Checkout screen (premium redesign — Wave 3 Task 3B)
// -----------------------------------------------------------------------------
//  Reference: blueprint §13 CHECKOUT (Cart → Pickup → Payment → Review →
//  Confirm → Order Created), §4 P4 TRANSPARENT PRICING, §4 P5 PAYMENT STATE
//  IS AUTHORITATIVE. DESIGN_SYSTEM.md §5.3.4 Checkout form.
//
//  Two-phase payment flow (preserved verbatim from previous impl):
//    Phase 1 — POST /api/orders           (creates CONFIRMED order + pickupOtp)
//    Phase 2 — POST /api/payments          (captures payment → order becomes PAID)
//    Phase 3 — GET  /api/orders/[id]       (refresh order with PAID status)
//
//  Governance boundaries respected:
//    - DO NOT modify /api/orders (POST) — order creation contract.
//    - DO NOT modify /api/payments (POST) — payment capture contract.
//    - DO NOT modify src/lib/razorpay.ts — gateway abstraction.
//    - DO NOT modify demo-mode synthesis (pay_demo_<ts> + sig_demo_<ts>).
//    - DO NOT activate realPayments flag (always OFF — see src/lib/deployment.ts).
//
//  Sections (mobile-first, scrollable):
//    1. Restaurant banner (name + cuisine + back-to-cart link)
//    2. Order summary card (cart lines w/ image, qty, price, reward pts badge)
//    3. PricingBreakdown card (Task 1B component, transparent pricing per §4 P4)
//    3.5 Reward redemption card (Task 5B additive — apply points → discount)
//    4. Pickup details form (name + phone + special instructions + pickup time)
//    5. Demo-mode amber banner (realPayments flag is OFF)
//    6. Payment method selector (Razorpay / UPI / Wallet — radio group)
//    7. Security note (Razorpay + never stores card details)
//    8. Sticky Pay bar (Pay ₹X with two-phase loading state)
//
//  Reward redemption (Task 5B additive):
//    - The cart already supports client-side reward discount via
//      `cart.setRewardPoints(N)` → `cart.pricing().rewardDiscount` (Task 1C).
//      This screen adds the UI to apply points to the cart + a server-side
//      ledger deduction via POST /api/rewards/redeem during checkout (Task 5A).
//    - The redeem call fires AFTER order creation (Step A) + BEFORE payment
//      (Step B) — only when `cart.rewardPointsToRedeem > 0`. If the redeem
//      call fails, checkout continues with payment anyway (logged, non-blocking
//      per Task 5B acceptance criteria).
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  Lock,
  MessageSquare,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Timer,
  User,
  Wallet,
  X,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useCart } from '@/lib/cart-store'
import { csrfFetch } from '@/lib/csrf-client'
import { useToast } from '@/hooks/use-toast'
import { inr, pointsEarnedFor, pointsToDiscountRupees } from '@/lib/snack'
import { paiseToRewardPoints } from '@/lib/reward-rules'
import { useRewards } from '@/lib/rewards-store'
import { VegBadge, RewardBadge, CuisineIcon } from './bits'
import { Slider } from '@/components/ui/slider'
import { PricingBreakdown, type PricingRow } from './pricing-breakdown'
import type { Order } from '@/lib/types'

// -----------------------------------------------------------------------------
//  Types + constants
// -----------------------------------------------------------------------------

interface CheckoutViewProps {
  /** Return to the cart / restaurant menu. */
  onBack: () => void
  /** Order successfully placed (+ payment captured or pending) → switch to tracking. */
  onSuccess: (order: Order) => void
}

type Phase = 'idle' | 'placing' | 'paying'

type PaymentMethod = 'razorpay' | 'upi' | 'wallet'

interface PaymentMethodOption {
  key: PaymentMethod
  label: string
  description: string
  icon: typeof CreditCard
  /** Mark Razorpay as the default selection. */
  default?: boolean
  /** Optional small chips rendered under the label (e.g. GPay / PhonePe / Paytm). */
  variants?: string[]
}

const MAX_NOTE = 500
const PHONE_DIGITS = 10

// realPayments flag is OFF in dev (see src/lib/deployment.ts FEATURE_FLAGS.realPayments).
// We unconditionally render the demo-mode banner — no need to fetch /api/health on
// every checkout mount. When the flag is flipped ON in production, this component
// will be updated to fetch the flag and conditionally hide the banner.
const REAL_PAYMENTS_ENABLED = false

const PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    key: 'razorpay',
    label: 'Razorpay',
    description: 'Credit / debit cards, netbanking, EMI',
    icon: CreditCard,
    default: true,
  },
  {
    key: 'upi',
    label: 'UPI',
    description: 'Google Pay, PhonePe, Paytm',
    icon: Smartphone,
    variants: ['GPay', 'PhonePe', 'Paytm'],
  },
  {
    key: 'wallet',
    label: 'Wallet',
    description: 'SnakZap wallet — coming soon',
    icon: Wallet,
  },
]

// Motion variants — section entrance + reduced-motion respect.
const sectionEnter = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.3, 0, 0, 1] as const, delay: Math.min(i * 0.04, 0.2) },
  }),
}

// =============================================================================
//  Component
// =============================================================================

export function CheckoutView({ onBack, onSuccess }: CheckoutViewProps) {
  const cart = useCart()
  const { toast } = useToast()
  const prefersReduced = useReducedMotion()
  // Task 5B additive: rewards store — used to fetch balance + redeem points.
  const rewardsAccount = useRewards((s) => s.account)
  const rewardsRefresh = useRewards((s) => s.refresh)
  const rewardsRedeem = useRewards((s) => s.redeem)

  // ---- Form state ----------------------------------------------------------
  const [pickupName, setPickupName] = useState('')
  const [pickupPhone, setPickupPhone] = useState('')
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [prefillLoaded, setPrefillLoaded] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('razorpay')
  const [restaurantCuisine, setRestaurantCuisine] = useState<string | null>(null)
  // Task 5B additive: local slider state for the reward redemption stepper.
  // Mirrors `cart.rewardPointsToRedeem` while the user is dragging; only commits
  // to the cart via `cart.setRewardPoints(N)` when they tap "Apply".
  const [rewardPointsDraft, setRewardPointsDraft] = useState(0)

  // ---- Prefill pickup name + phone from the active session -----------------
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

  // ---- Best-effort fetch of restaurant cuisine for the banner --------------
  // cart-store only persists restaurantName (not cuisine). We do a single
  // GET /api/restaurants/[id] on mount to surface the cuisine tag. Failure
  // is silent — the banner falls back to just the name.
  useEffect(() => {
    if (!cart.restaurantId) return
    let cancelled = false
    fetch(`/api/restaurants/${cart.restaurantId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.cuisine) return
        setRestaurantCuisine(d.cuisine)
      })
      .catch(() => {
        /* cuisine is decorative — silent fallback */
      })
    return () => {
      cancelled = true
    }
  }, [cart.restaurantId])

  // ---- Task 5B additive: fetch rewards account on mount --------------------
  // Best-effort — failure is silent (the redemption card just shows the
  // "Earn rewards" placeholder). The /api/rewards/account endpoint is owned
  // by Task 5A; we only read the balance + ledger slice here.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.user?.userId) return
        rewardsRefresh(d.user.userId).catch(() => {
          /* best-effort — silent */
        })
      })
      .catch(() => {
        /* session fetch best-effort — silent */
      })
    return () => {
      cancelled = true
    }
  }, [rewardsRefresh])

  // ---- Derived pricing -----------------------------------------------------
  const pricing = useMemo(() => cart.pricing(), [cart])
  const cartCount = cart.count()
  const itemsCount = cart.lines.reduce((s, l) => s + l.quantity, 0)

  // ---- Task 5B additive: reward redemption derived state --------------------
  // Reward points are capped at 50% of the food subtotal (per cart-store
  // convention + paiseToRewardPoints helper from reward-rules.ts).
  const maxRedeemablePoints = useMemo(() => {
    const capPaise = Math.floor(pricing.subtotal * 0.5)
    const fromCap = paiseToRewardPoints(capPaise)
    const balance = rewardsAccount?.pointsBalance ?? 0
    return Math.max(0, Math.min(balance, fromCap))
  }, [pricing.subtotal, rewardsAccount?.pointsBalance])

  const rewardPointsApplied = cart.rewardPointsToRedeem
  const rewardPointsDraftValue = Math.min(rewardPointsDraft, maxRedeemablePoints)
  const rewardDraftDiscountRupees = pointsToDiscountRupees(rewardPointsDraftValue)
  const rewardAppliedDiscountRupees = pointsToDiscountRupees(rewardPointsApplied)
  const hasRewardBalance = !!rewardsAccount && rewardsAccount.pointsBalance > 0

  // 10-digit Indian mobile (strip non-digits before validating).
  const phoneDigits = pickupPhone.replace(/\D/g, '').slice(-PHONE_DIGITS)
  const phoneValid = phoneDigits.length === PHONE_DIGITS
  const nameValid = pickupName.trim().length >= 2
  const canPay =
    phase === 'idle' &&
    cartCount > 0 &&
    !!cart.restaurantId &&
    phoneValid &&
    nameValid

  // ---- Build PricingBreakdown rows (blueprint §4 P4) -----------------------
  // Food subtotal + tax + platform fee − discount − reward + tip = total.
  const pricingRows: PricingRow[] = useMemo(() => {
    const rows: PricingRow[] = []
    rows.push({
      key: 'subtotal',
      label: 'Food subtotal',
      amountPaise: pricing.subtotal,
      kind: 'add',
    })
    rows.push({
      key: 'tax',
      label: 'GST (5%)',
      amountPaise: pricing.tax,
      kind: 'add',
    })
    // Platform fee only rendered when non-zero (SnakZap low-fee model = 0 in MVP).
    if (pricing.platformFee > 0) {
      rows.push({
        key: 'platform-fee',
        label: 'Platform fee',
        amountPaise: pricing.platformFee,
        kind: 'add',
      })
    }
    if (pricing.discount > 0) {
      rows.push({
        key: 'discount',
        label: 'Discount',
        amountPaise: -pricing.discount,
        kind: 'sub',
        hint: cart.couponCode ? `Coupon ${cart.couponCode} applied` : undefined,
      })
    }
    if (pricing.rewardDiscount > 0) {
      const pts = cart.rewardPointsToRedeem
      rows.push({
        key: 'reward-discount',
        label: 'Reward discount',
        amountPaise: -pricing.rewardDiscount,
        kind: 'sub',
        hint: `${pts} pts = ${inr(pricing.rewardDiscount)} off`,
      })
    }
    if (pricing.tip > 0) {
      rows.push({
        key: 'tip',
        label: 'Tip',
        amountPaise: pricing.tip,
        kind: 'add',
      })
    }
    rows.push({
      key: 'total',
      label: 'Total payable',
      amountPaise: pricing.total,
      kind: 'total',
    })
    return rows
  }, [pricing, cart.couponCode, cart.rewardPointsToRedeem])

  // ---- Pickup time display (from cart.pickupTime) --------------------------
  const pickupTimeLabel = useMemo(() => {
    if (!cart.pickupTime) return 'ASAP (in ~15 min)'
    // cart.pickupTime is an ISO time string or null for ASAP. We surface a
    // friendlier label — the actual scheduling UI lives in the Cart screen
    // (Task 3A).
    try {
      const d = new Date(cart.pickupTime)
      if (!isNaN(d.getTime())) {
        return `Scheduled · ${d.toLocaleString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'short',
        })}`
      }
    } catch {
      /* fall through to ASAP */
    }
    return 'ASAP (in ~15 min)'
  }, [cart.pickupTime])

  // ---- Two-phase pay handler (PRESERVED VERBATIM) --------------------------
  const handlePay = async () => {
    if (!cart.restaurantId || cart.lines.length === 0) {
      toast({
        title: 'Your cart is empty',
        description: 'Add an item before checking out.',
        variant: 'destructive',
      })
      return
    }
    if (!nameValid) {
      toast({
        title: 'Pickup name required',
        description: 'Please tell us who is picking up the order.',
        variant: 'destructive',
      })
      return
    }
    if (!phoneValid) {
      toast({
        title: 'Valid phone required',
        description: 'Enter a 10-digit Indian mobile number.',
        variant: 'destructive',
      })
      return
    }

    // Combine pickup details + free-form note into a single note string.
    // The order schema has one `note` field (max 500 chars), so we pack the
    // pickup contact details + instructions together.
    const pickupBlock = `Pickup: ${pickupName.trim()} · ${phoneDigits}`
    const methodBlock = `Payment: ${paymentMethod.toUpperCase()}`
    const noteBlock = note.trim() ? `Note: ${note.trim()}` : null
    const composedNote = [pickupBlock, methodBlock, noteBlock]
      .filter(Boolean)
      .join('\n')
      .slice(0, MAX_NOTE)

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

      // === Step A.5 (Task 5B additive): redeem reward points if applied ===
      // If the user opted to redeem points on this order, we deduct the points
      // from their account ledger via POST /api/rewards/redeem. This MUST
      // happen after the order is created (so we can attach the orderId to the
      // ledger entry for auditability) and BEFORE payment (so the discount is
      // reflected in the user's account before the charge).
      //
      // Failure here is NON-BLOCKING per Task 5B acceptance criteria — we log
      // the error and continue with payment. The cart's rewardPointsToRedeem
      // already factored into the order total via cart.pricing() on the client
      // (the server-side order total is computed independently — if the redeem
      // fails, the order total is unaffected but the user retains their points;
      // a follow-up reconciliation can issue a coupon for the missed discount).
      if (cart.rewardPointsToRedeem > 0) {
        try {
          await rewardsRedeem(cart.rewardPointsToRedeem, createdOrder.id)
        } catch (redeemErr) {
          // Logged but non-blocking — checkout continues to payment.
          console.error(
            '[checkout] reward redemption failed (non-blocking):',
            redeemErr,
          )
        }
      }

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
          title: 'Payment failed — order placed but payment pending',
          description:
            payData?.error?.message ??
              (typeof payData?.error === 'string' ? payData.error : null) ??
              'Your order is confirmed — please retry payment from My Orders.',
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

  // ---- Empty-cart safety ---------------------------------------------------
  // Shouldn't normally happen (cart bar is hidden when empty), but a direct
  // route hit would land here.
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
  const phaseLabel =
    phase === 'placing'
      ? 'Placing order…'
      : phase === 'paying'
        ? 'Processing payment…'
        : null

  // Stagger index helper — increments per section.
  let sectionIndex = 0
  const nextSection = () => sectionIndex++

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-40">
      {/* ─────────────────────────────────────────────────────────────────
          1. Restaurant banner
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
      >
        <Card className="overflow-hidden border-teal-200 bg-gradient-to-br from-teal-50 via-white to-white dark:border-teal-900 dark:from-teal-950/30 dark:via-card dark:to-card">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <Store className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pickup from
              </p>
              <p className="truncate font-bold leading-tight">
                {cart.restaurantName ?? 'Restaurant'}
              </p>
              {restaurantCuisine && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <CuisineIcon cuisine={restaurantCuisine} />
                  <span>{restaurantCuisine}</span>
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={processing}
              className="text-teal-700 hover:bg-teal-500/10 hover:text-teal-800 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Cart
            </Button>
          </CardContent>
        </Card>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          2. Order summary
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
      >
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Order summary</h3>
              <Badge variant="secondary" className="text-xs">
                {itemsCount} item{itemsCount === 1 ? '' : 's'}
              </Badge>
            </div>
            <div className="space-y-2.5">
              {cart.lines.map((l) => {
                const linePaise = l.price * l.quantity
                const pts = pointsEarnedFor(linePaise / 100)
                return (
                  <motion.div
                    key={l.menuItemId}
                    layout={!prefersReduced}
                    initial={prefersReduced ? false : { opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, ease: [0.3, 0, 0, 1] as const }}
                    className="flex items-center gap-3"
                  >
                    <VegBadge veg={l.isVeg} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {inr(l.price)} × {l.quantity}
                        </p>
                        {pts > 0 && (
                          <RewardBadge className="!px-1.5 !py-0 !text-[10px]">
                            +{pts}
                          </RewardBadge>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">
                      {inr(linePaise)}
                    </p>
                  </motion.div>
                )
              })}
            </div>
            <Separator className="my-3" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium tabular-nums">
                {inr(pricing.subtotal)}
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          3. Pricing breakdown (Task 1B component — transparent pricing)
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
      >
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              <h3 className="text-sm font-semibold">Price breakdown</h3>
            </div>
            <PricingBreakdown rows={pricingRows} />
          </CardContent>
        </Card>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          3.5 Reward redemption (Task 5B additive)
          — Apply reward points to reduce the total. Skipped when the user has
            no rewards account or a zero balance. Updates cart.rewardPointsToRedeem
            which feeds back into the PricingBreakdown above via cart.pricing().
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
      >
        <Card className="border-gold-200 bg-gradient-to-br from-gold-50/60 to-card dark:border-gold-900/40 dark:from-gold-950/20 dark:to-card">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-gold-600 dark:text-gold-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold">Reward redemption</h3>
              </div>
              {hasRewardBalance && rewardsAccount ? (
                <Badge
                  className="bg-gold-100 text-[10px] text-gold-700 dark:bg-gold-950/60 dark:text-gold-300"
                  variant="secondary"
                >
                  {rewardsAccount.pointsBalance.toLocaleString('en-IN')} pts
                </Badge>
              ) : null}
            </div>

            {!hasRewardBalance ? (
              <div className="flex items-start gap-3 rounded-lg border border-dashed border-gold-300 bg-gold-50/40 p-3 text-xs text-muted-foreground dark:border-gold-800/60 dark:bg-gold-950/20">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold-600 dark:text-gold-400" aria-hidden="true" />
                <p>
                  Earn rewards on this order! Place this order to start earning
                  points — every ₹10 spent earns 1 pt, redeemable for discounts
                  on future orders.
                </p>
              </div>
            ) : rewardPointsApplied > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg border border-gold-300 bg-gold-50/60 p-3 dark:border-gold-800/60 dark:bg-gold-950/30">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {rewardPointsApplied.toLocaleString('en-IN')} points applied
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      = {inr(rewardAppliedDiscountRupees * 100)} off this order
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      cart.setRewardPoints(0)
                      setRewardPointsDraft(0)
                    }}
                    disabled={processing}
                    aria-label="Remove reward redemption"
                  >
                    <X className="mr-1 h-4 w-4" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Points will be deducted from your rewards balance when the
                  order is placed.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Apply points to reduce your total
                  </p>
                  <p className="text-xs font-medium text-foreground tabular-nums">
                    {rewardPointsDraftValue.toLocaleString('en-IN')} pts ={' '}
                    <span className="text-gold-700 dark:text-gold-400">
                      {inr(rewardDraftDiscountRupees * 100)}
                    </span>{' '}
                    off
                  </p>
                </div>
                <Slider
                  value={[rewardPointsDraftValue]}
                  min={0}
                  max={maxRedeemablePoints}
                  step={1}
                  onValueChange={(vals) => {
                    const v = vals[0] ?? 0
                    setRewardPointsDraft(
                      Math.max(0, Math.min(v, maxRedeemablePoints)),
                    )
                  }}
                  disabled={processing || maxRedeemablePoints <= 0}
                  aria-label="Reward points to redeem"
                  className="py-1"
                />
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>0 pts</span>
                  <button
                    type="button"
                    className="text-gold-700 underline-offset-2 hover:underline dark:text-gold-400 disabled:opacity-50"
                    onClick={() =>
                      setRewardPointsDraft(maxRedeemablePoints)
                    }
                    disabled={processing || maxRedeemablePoints <= 0}
                  >
                    Apply max ({maxRedeemablePoints.toLocaleString('en-IN')} pts)
                  </button>
                  <span>{maxRedeemablePoints.toLocaleString('en-IN')} pts</span>
                </div>
                <Button
                  size="sm"
                  className="w-full bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-50"
                  onClick={() => {
                    cart.setRewardPoints(rewardPointsDraftValue)
                    toast({
                      title: 'Reward applied',
                      description: `${rewardPointsDraftValue.toLocaleString('en-IN')} pts = ${inr(rewardDraftDiscountRupees * 100)} off`,
                    })
                  }}
                  disabled={
                    processing ||
                    rewardPointsDraftValue <= 0 ||
                    maxRedeemablePoints <= 0
                  }
                >
                  <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
                  Apply {rewardPointsDraftValue.toLocaleString('en-IN')} pts
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Max redeemable is capped at 50% of your food subtotal.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          4. Pickup details form
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
      >
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              <h3 className="text-sm font-semibold">Pickup details</h3>
            </div>

            {/* Pickup name */}
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

            {/* Phone number */}
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
                  aria-invalid={
                    prefillLoaded && !phoneValid && pickupPhone.length > 0
                  }
                />
              </div>
              {prefillLoaded && pickupPhone.length > 0 && !phoneValid && (
                <p className="text-xs text-destructive">
                  Enter a valid 10-digit Indian mobile number.
                </p>
              )}
            </div>

            {/* Special instructions */}
            <div className="space-y-2">
              <Label htmlFor="pickup-note">
                Special instructions (optional)
              </Label>
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

            {/* Pickup time (read-only display — driven by cart.pickupTime) */}
            <div className="space-y-2">
              <Label htmlFor="pickup-time-readonly">Pickup time</Label>
              <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
                <Timer className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                <p id="pickup-time-readonly" className="flex-1 text-sm font-medium">
                  {pickupTimeLabel}
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs text-teal-700 dark:text-teal-300"
                  onClick={onBack}
                  disabled={processing}
                >
                  Change
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          5. Demo-mode banner (amber — realPayments flag is OFF)
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
        aria-live="polite"
      >
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Demo Mode — No real payment will be charged
            </p>
            <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-300/80">
              SnakZap is running with{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/60">
                realPayments
              </code>{' '}
              disabled. All payment methods below will go through demo payment
              synthesis — no money moves and no card is charged.
            </p>
          </div>
          <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        </div>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          6. Payment method selector (radio group with icons)
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4"
      >
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-teal-700 dark:text-teal-300" />
                <h3 className="text-sm font-semibold">Payment method</h3>
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Demo
              </span>
            </div>

            <RadioGroup
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              disabled={processing}
              className="gap-2.5"
              aria-label="Choose payment method"
            >
              {PAYMENT_METHODS.map((m) => (
                <PaymentOptionCard
                  key={m.key}
                  option={m}
                  selected={paymentMethod === m.key}
                />
              ))}
            </RadioGroup>
          </CardContent>
        </Card>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          7. Security note
         ───────────────────────────────────────────────────────────────── */}
      <motion.section
        custom={nextSection()}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
        variants={sectionEnter}
        className="mb-4 flex items-start gap-2 px-1 text-xs text-muted-foreground"
      >
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          Payments are secured by Razorpay. SnakZap never stores your card
          details — they go directly to the payment gateway over an encrypted
          channel.
        </p>
      </motion.section>

      {/* ─────────────────────────────────────────────────────────────────
          8. Sticky Pay bar (mobile) / inline actions (desktop)
         ───────────────────────────────────────────────────────────────── */}
      <PayBar
        processing={processing}
        phaseLabel={phaseLabel}
        canPay={canPay}
        total={pricing.total}
        onPay={handlePay}
        onBack={onBack}
      />

      {/* Hidden flag marker — makes the demo-mode toggle discoverable for
          future enablement without a code search. */}
      <span className="sr-only" aria-hidden="true">
        realPaymentsEnabled: {String(REAL_PAYMENTS_ENABLED)}
      </span>
    </div>
  )
}

// =============================================================================
//  PaymentOptionCard — radio card with icon + name + description + variants
// =============================================================================

interface PaymentOptionCardProps {
  option: PaymentMethodOption
  selected: boolean
}

function PaymentOptionCard({ option, selected }: PaymentOptionCardProps) {
  const Icon = option.icon
  const prefersReduced = useReducedMotion()
  // Razorpay is the recommended option — surface a "Recommended" pill.
  const recommended = option.default

  return (
    <motion.label
      htmlFor={`pay-${option.key}`}
      whileTap={prefersReduced ? undefined : { scale: 0.99 }}
      className={[
        'relative flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors duration-200',
        selected
          ? 'border-teal-500 bg-teal-500/5 shadow-sm'
          : 'border-input bg-background hover:bg-muted/40',
      ].join(' ')}
    >
      <RadioGroupItem
        value={option.key}
        id={`pay-${option.key}`}
        className="sr-only"
        // Visible radio indicator is the bordered card itself — but we keep
        // the Radix radio in the a11y tree for screen readers.
      />
      {/* Custom radio indicator (replaces the visible Radix circle) */}
      <span
        aria-hidden="true"
        className={[
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200',
          selected
            ? 'border-teal-600 bg-teal-600'
            : 'border-muted-foreground/40 bg-background',
        ].join(' ')}
      >
        {selected && (
          <span className="h-2 w-2 rounded-full bg-white" aria-hidden="true" />
        )}
      </span>

      <div
        className={[
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
          selected
            ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
            : 'bg-muted text-muted-foreground',
        ].join(' ')}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{option.label}</p>
          {recommended && (
            <Badge
              variant="secondary"
              className="bg-gold-100 text-[10px] text-gold-700 dark:bg-gold-950/60 dark:text-gold-300"
            >
              Recommended
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {option.description}
        </p>
        {option.variants && option.variants.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {option.variants.map((v) => (
              <span
                key={v}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {v}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.label>
  )
}

// =============================================================================
//  PayBar — sticky on mobile (bottom), inline at the end on desktop
// =============================================================================

interface PayBarProps {
  processing: boolean
  phaseLabel: string | null
  canPay: boolean
  total: number
  onPay: () => void
  onBack: () => void
}

function PayBar({
  processing,
  phaseLabel,
  canPay,
  total,
  onPay,
  onBack,
}: PayBarProps) {
  const prefersReduced = useReducedMotion()
  const payButton = (
    <motion.div
      whileTap={prefersReduced ? undefined : { scale: 0.98 }}
      className="flex-1"
    >
      <Button
        onClick={onPay}
        disabled={!canPay}
        className="w-full bg-teal-600 text-base font-semibold hover:bg-teal-700 disabled:opacity-60"
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
    </motion.div>
  )

  return (
    <>
      {/* Desktop inline actions */}
      <div className="hidden md:flex md:items-center md:gap-3">
        <Button variant="outline" onClick={onBack} disabled={processing}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to cart
        </Button>
        {payButton}
      </div>

      {/* Mobile sticky bar */}
      <motion.div
        initial={prefersReduced ? false : { y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.3, 0, 0, 1] as const }}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Total payable</p>
            <p className="font-bold tabular-nums">{inr(total)}</p>
          </div>
          {payButton}
        </div>
      </motion.div>
    </>
  )
}

export default CheckoutView
