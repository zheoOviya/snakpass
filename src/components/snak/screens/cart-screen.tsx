'use client'

// src/components/snak/screens/cart-screen.tsx
//
// Cart screen — Task 3A (Wave 3 Order lifecycle).
//
// Implements blueprint §12 CART:
//   items, quantity, modifiers (placeholder), subtotal, taxes (5% GST),
//   fees (₹0 MVP — SnakZap low-fee model), discount (10% placeholder coupon),
//   rewards applied (1 pt = ₹0.10), final total, pickup location, pickup
//   estimate, prep time. Plus tip section (additive) per the screen brief.
//
// Per blueprint §4 P4 (Transparent pricing):
//   subtotal + tax + platform fee − discount − reward + tip = total
//   "Never surprise the user at payment."
//
// Anatomy (mobile-first, scrollable):
//   1. Restaurant banner — name + cuisine + "Change" link
//   2. Cart lines list — image, name, spice dots, reward pts, price, qty stepper,
//      remove, "Edit modifiers" placeholder
//   3. Coupon section — input + Apply → cart.setCoupon (10% placeholder discount)
//   4. Rewards section — slider to redeem points → cart.setRewardPoints
//   5. Tip section — presets (₹0/₹10/₹20/₹30/Custom) → cart.setTip
//   6. Pickup details — time selector + restaurant address
//   7. PricingBreakdown card — transparent breakdown (Task 1B component)
//   8. Sticky checkout bar — total + "Proceed to Checkout"
//   9. Empty cart state — illustration + "Browse restaurants" CTA
//
// Governance (Task 3A):
//   - Cart is client-side state ONLY — no API mutations, just reads of
//     /api/restaurants/[id] + /api/restaurants/[id]/menu + /api/rewards/account.
//   - Does NOT touch cart-store's existing API (Task 1C owns). Only calls
//     cart.add/increment/decrement/remove/setCoupon/setRewardPoints/setTip/
//     setPickupTime/pricing() — all defined by Task 1C.
//   - Does NOT touch checkout-view.tsx (Task 3B), order-tracking.tsx (Task 3C),
//     my-orders-screen.tsx (Task 3D), payment/fulfilment/pickup governance files,
//     prisma/schema.prisma, or any /api/** route.

import * as React from 'react'
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion'
import {
  ArrowLeft,
  Trash2,
  Minus,
  Plus,
  Tag,
  Sparkles,
  Heart,
  Clock,
  MapPin,
  ChevronRight,
  Pencil,
  AlertCircle,
  Store,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useCart, type CartLine } from '@/lib/cart-store'
import { useRewards } from '@/lib/rewards-store'
import { useAuth } from '@/hooks/use-auth'
import {
  inr,
  pointsEarnedFor,
} from '@/lib/snack'
import {
  rewardDiscountPaise,
  paiseToRewardPoints,
} from '@/lib/reward-rules'
import { cn } from '@/lib/utils'
import type { MenuItem, Restaurant } from '@/lib/types'

import {
  CuisineIcon,
  cuisineGradient,
  VegBadge,
  SpiceDots,
  RewardBadge,
} from '../bits'
import { PricingBreakdown, type PricingRow } from '../pricing-breakdown'
import { EmptyState } from '../empty-state'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Coupon validation: alphanumeric, 4-20 chars (placeholder until Wave 5). */
const COUPON_PATTERN = /^[a-zA-Z0-9]{4,20}$/

/**
 * Placeholder coupon discount — 10% of subtotal. The cart-store also applies
 * 10% internally when `couponCode` is set, so this matches the pricing output.
 * Real coupon validation is deferred to Wave 5 (/api/coupons/validate).
 */
const PLACEHOLDER_COUPON_RATE = 0.1

/** Tip presets in rupees — converted to paise before calling cart.setTip(). */
const TIP_PRESETS_RUPEES = [0, 10, 20, 30] as const

/**
 * Pickup-time options (blueprint §12 "choose pickup time where supported").
 * The cart-store stores `pickupTime: string | null` — null means ASAP.
 * We use simple short labels for the stored value so checkout-view (Task 3B)
 * can read them without coupling to this screen's enum.
 */
interface PickupTimeOption {
  /** Stored in cart.pickupTime. null = ASAP. */
  value: string | null
  /** Display label. */
  label: string
  /** Approximate minutes from now (used for the "Pickup estimate" hint). */
  inMinutes: number
}
const PICKUP_TIME_OPTIONS: PickupTimeOption[] = [
  { value: null, label: 'ASAP', inMinutes: 0 },
  { value: '+15min', label: 'In 15 min', inMinutes: 15 },
  { value: '+30min', label: 'In 30 min', inMinutes: 30 },
  { value: '+60min', label: 'In 1 hour', inMinutes: 60 },
]

/** Maximum reward points the user can redeem (50% of subtotal cap). */
function maxRedeemablePoints(subtotalPaise: number): number {
  const halfSubtotalPaise = Math.floor(subtotalPaise * 0.5)
  return paiseToRewardPoints(halfSubtotalPaise)
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion presets (DESIGN_SYSTEM.md §6.4 stagger)
// ─────────────────────────────────────────────────────────────────────────────

const LIST_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
}
const LIST_ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.3, 0, 0, 1] } },
  exit: { opacity: 0, x: -16, transition: { duration: 0.18, ease: [0.3, 0, 0, 1] } },
}

// ════════════════════════════════════════════════════════════════════════════
// CartScreen — props
// ════════════════════════════════════════════════════════════════════════════

export interface CartScreenProps {
  /** Called when the user taps "Proceed to Checkout" — host swaps to checkout. */
  onCheckout: () => void
  /**
   * Called when the user wants to leave the cart to keep browsing
   * (the "Change" link on the restaurant banner, or the "Browse restaurants"
   * CTA in the empty-cart state).
   */
  onContinueShopping: () => void
  /**
   * Optional back button label — defaults to "Back to menu". The host (Task
   * 2B's consumer-view) wires this to closeCart() (which falls back to the
   * active tab or restaurant-detail overlay).
   */
  onBack?: () => void
}

// ════════════════════════════════════════════════════════════════════════════
// CartScreen — component
// ════════════════════════════════════════════════════════════════════════════

export function CartScreen({ onCheckout, onContinueShopping, onBack }: CartScreenProps) {
  const prefersReduced = useReducedMotion()
  const { toast } = useToast()

  // ── Cart store (read-only consumer of Task 1C's API) ──────────────────────
  const cart = useCart()
  const lines = cart.lines
  const restaurantId = cart.restaurantId
  const restaurantName = cart.restaurantName ?? 'Restaurant'
  const couponCode = cart.couponCode
  const rewardPointsToRedeem = cart.rewardPointsToRedeem
  const tipAmount = cart.tipAmount
  const pickupTime = cart.pickupTime
  const pricing = cart.pricing()

  // ── Restaurant details (cuisine + address + prepTime) ─────────────────────
  const [restaurant, setRestaurant] = React.useState<Restaurant | null>(null)
  const [restaurantLoading, setRestaurantLoading] = React.useState(false)
  const [restaurantError, setRestaurantError] = React.useState<string | null>(null)

  // ── Menu items (resolve image + spiceLevel + rewardPoints per cart line) ──
  const [menuLookup, setMenuLookup] = React.useState<Record<string, MenuItem>>({})
  const [menuLoading, setMenuLoading] = React.useState(false)

  // ── Coupon input (controlled; mirrors cart.couponCode when applied) ────────
  const [couponInput, setCouponInput] = React.useState('')
  const [couponError, setCouponError] = React.useState<string | null>(null)

  // ── Tip custom input ──────────────────────────────────────────────────────
  const [tipCustomMode, setTipCustomMode] = React.useState(false)
  const [tipCustomInput, setTipCustomInput] = React.useState('')

  // ── Rewards account (read-only) ────────────────────────────────────────────
  const { user } = useAuth()
  const rewardsAccount = useRewards((s) => s.account)
  const rewardsLoading = useRewards((s) => s.isLoading)
  const rewardsRefresh = useRewards((s) => s.refresh)

  // ── Fetch restaurant details + menu (single pass) ─────────────────────────
  React.useEffect(() => {
    if (!restaurantId) {
      setRestaurant(null)
      setMenuLookup({})
      return
    }
    let cancelled = false
    setRestaurantLoading(true)
    setRestaurantError(null)
    setMenuLoading(true)
    Promise.all([
      fetch(`/api/restaurants/${restaurantId}`, { cache: 'no-store' }).then((r) =>
        r.json().catch(() => ({})),
      ),
      fetch(`/api/restaurants/${restaurantId}/menu`, { cache: 'no-store' }).then((r) =>
        r.json().catch(() => ({})),
      ),
    ])
      .then(([rJson, mJson]) => {
        if (cancelled) return
        if (rJson?.restaurant) {
          setRestaurant(rJson.restaurant as Restaurant)
        } else {
          setRestaurantError('Could not load this restaurant.')
        }
        const items = (mJson?.items ?? []) as MenuItem[]
        const lookup: Record<string, MenuItem> = {}
        for (const it of items) lookup[it.id] = it
        setMenuLookup(lookup)
      })
      .catch(() => {
        if (cancelled) return
        setRestaurantError('Could not load this restaurant.')
      })
      .finally(() => {
        if (cancelled) return
        setRestaurantLoading(false)
        setMenuLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  // ── Rewards account — refresh on mount if user is loaded but no account ────
  React.useEffect(() => {
    if (user?.userId && !rewardsAccount && !rewardsLoading) {
      void rewardsRefresh(user.userId)
    }
  }, [user?.userId, rewardsAccount, rewardsLoading, rewardsRefresh])

  const rewardsBalance = rewardsAccount?.pointsBalance ?? 0
  const maxRedeem = Math.min(rewardsBalance, maxRedeemablePoints(pricing.subtotal))

  // ── Sync coupon input field when couponCode changes externally ─────────────
  React.useEffect(() => {
    if (couponCode) setCouponInput(couponCode)
  }, [couponCode])

  // ═══════════════════════════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleApplyCoupon = React.useCallback(() => {
    const code = couponInput.trim().toUpperCase()
    if (!COUPON_PATTERN.test(code)) {
      setCouponError('Enter a valid code (4-20 letters or numbers).')
      return
    }
    cart.setCoupon(code)
    setCouponError(null)
    toast({
      title: 'Coupon applied',
      description: `${code} · ${Math.round(PLACEHOLDER_COUPON_RATE * 100)}% off applied.`,
    })
  }, [couponInput, cart, toast])

  const handleRemoveCoupon = React.useCallback(() => {
    cart.setCoupon(null)
    setCouponInput('')
    setCouponError(null)
    toast({ title: 'Coupon removed' })
  }, [cart, toast])

  const handleRewardsChange = React.useCallback(
    (value: number[]) => {
      const pts = value[0] ?? 0
      cart.setRewardPoints(pts)
    },
    [cart],
  )

  const handleApplyMaxRewards = React.useCallback(() => {
    if (maxRedeem <= 0) return
    cart.setRewardPoints(maxRedeem)
    toast({
      title: 'Rewards applied',
      description: `${maxRedeem} pts = ${inr(rewardDiscountPaise(maxRedeem))} off.`,
    })
  }, [cart, maxRedeem, toast])

  const handleClearRewards = React.useCallback(() => {
    cart.setRewardPoints(0)
  }, [cart])

  // Note: tip handlers below are declared without `useCallback` because the
  // React Compiler optimizes them automatically. Manual memoization with the
  // local setState setters (`setTipCustomMode`, `setTipCustomInput`) triggered
  // a `react-hooks/preserve-manual-memoization` lint error — letting the
  // compiler handle memoization is the recommended pattern.
  const handleTipPreset = (rupees: number) => {
    setTipCustomMode(false)
    cart.setTip(rupees * 100)
  }

  const handleTipCustomChange = (raw: string) => {
    setTipCustomInput(raw)
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      cart.setTip(Math.round(parsed * 100))
    } else if (raw === '') {
      cart.setTip(0)
    }
  }

  const handlePickupTime = React.useCallback(
    (value: string | null) => {
      cart.setPickupTime(value)
    },
    [cart],
  )

  const handleEditModifiers = React.useCallback(() => {
    toast({
      title: 'Customization coming soon',
      description: 'Modifier editing will arrive with menu item options in a later wave.',
    })
  }, [toast])

  // ── Empty cart state ───────────────────────────────────────────────────────
  if (lines.length === 0 || !restaurantId) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
        <Header onBack={onBack} />
        <EmptyState
          variant="no-orders"
          title="Your cart is empty"
          description="Browse restaurants and add items to your cart to get started."
          actionLabel="Browse restaurants"
          onAction={onContinueShopping}
          className="py-16"
        />
      </div>
    )
  }

  // ── Pricing breakdown rows ─────────────────────────────────────────────────
  const pricingRows: PricingRow[] = [
    { key: 'subtotal', label: 'Subtotal', amountPaise: pricing.subtotal, kind: 'add' },
    {
      key: 'tax',
      label: 'GST (5%)',
      amountPaise: pricing.tax,
      kind: 'add',
      hint: 'Taxes estimated at 5% GST.',
    },
    {
      key: 'platformFee',
      label: 'Platform fee',
      amountPaise: pricing.platformFee,
      kind: 'add',
      hint: pricing.platformFee === 0 ? 'Free for our campus MVP' : undefined,
    },
  ]
  if (pricing.discount > 0) {
    pricingRows.push({
      key: 'discount',
      label: `Discount (${couponCode ?? 'coupon'})`,
      amountPaise: -pricing.discount,
      kind: 'sub',
      hint: 'Placeholder 10% off — real coupons land in Wave 5.',
    })
  }
  if (pricing.rewardDiscount > 0) {
    pricingRows.push({
      key: 'reward',
      label: 'Reward points',
      amountPaise: -pricing.rewardDiscount,
      kind: 'sub',
      hint: `${rewardPointsToRedeem} pts · 1 pt = ₹0.10`,
    })
  }
  if (pricing.tip > 0) {
    pricingRows.push({
      key: 'tip',
      label: 'Tip',
      amountPaise: pricing.tip,
      kind: 'add',
      hint: '100% goes to the kitchen staff.',
    })
  }
  pricingRows.push({
    key: 'total',
    label: 'Total',
    amountPaise: pricing.total,
    kind: 'total',
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-40">
      <Header onBack={onBack} />

      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
        className="mb-4"
      >
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Your Cart
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Review your items, apply coupons or rewards, then proceed to checkout.
        </p>
      </motion.div>

      {/* ── Restaurant banner ───────────────────────────────────────────────── */}
      <Card className="mb-4 overflow-hidden border-teal-200 dark:border-teal-900">
        <CardContent className="flex items-center gap-3 p-4">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-lg',
              cuisineGradient(restaurant?.cuisine ?? ''),
            )}
            aria-hidden="true"
          >
            <CuisineIcon cuisine={restaurant?.cuisine ?? ''} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Picking up from
            </p>
            <p className="truncate font-semibold leading-tight text-foreground">
              {restaurantName}
            </p>
            {restaurant?.cuisine && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {restaurant.cuisine}
                {typeof restaurant.prepTimeMins === 'number' && (
                  <> · ~{restaurant.prepTimeMins} min prep</>
                )}
              </p>
            )}
            {restaurantError && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-danger-600 dark:text-danger-400">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {restaurantError}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-primary"
            onClick={onContinueShopping}
          >
            Change
            <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>

      {/* ── Cart lines ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="cart-items" className="mb-4">
        <h2
          id="cart-items"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Items ({lines.length})
        </h2>
        <Card>
          <CardContent className="p-0">
            <motion.ul
              variants={LIST_CONTAINER}
              initial={prefersReduced ? false : 'hidden'}
              animate="show"
              className="divide-y"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {lines.map((line) => (
                  <motion.li
                    key={line.menuItemId}
                    variants={LIST_ITEM}
                    initial={prefersReduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
                  >
                    <CartLineRow
                      line={line}
                      menuItem={menuLookup[line.menuItemId]}
                      menuLoading={menuLoading}
                      onIncrement={() => cart.increment(line.menuItemId)}
                      onDecrement={() => cart.decrement(line.menuItemId)}
                      onRemove={() => cart.remove(line.menuItemId)}
                      onEditModifiers={handleEditModifiers}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          </CardContent>
        </Card>
      </section>

      {/* ── Coupon section ─────────────────────────────────────────────────── */}
      <section aria-labelledby="cart-coupon" className="mb-4">
        <h2
          id="cart-coupon"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Coupon
        </h2>
        <Card>
          <CardContent className="p-4">
            {couponCode ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Tag className="h-4 w-4 shrink-0 text-success-600 dark:text-success-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {couponCode} applied
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round(PLACEHOLDER_COUPON_RATE * 100)}% off ·{' '}
                      <span className="font-mono tabular-nums">
                        {inr(pricing.discount)}
                      </span>{' '}
                      saved
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveCoupon}
                  aria-label={`Remove coupon ${couponCode}`}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="cart-coupon-input" className="sr-only">
                  Coupon code
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cart-coupon-input"
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value)
                      if (couponError) setCouponError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleApplyCoupon()
                      }
                    }}
                    placeholder="Enter coupon code"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    aria-invalid={!!couponError}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleApplyCoupon}
                    disabled={!couponInput.trim()}
                  >
                    Apply
                  </Button>
                </div>
                {couponError ? (
                  <p className="flex items-center gap-1 text-xs text-danger-600 dark:text-danger-400">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    {couponError}
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Info className="h-3 w-3" aria-hidden="true" />
                    Any valid-format code applies a 10% placeholder discount.
                    Real coupons arrive in Wave 5.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Rewards section ────────────────────────────────────────────────── */}
      <section aria-labelledby="cart-rewards" className="mb-4">
        <h2
          id="cart-rewards"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Rewards
        </h2>
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-100 dark:bg-gold-950/60">
                  <Sparkles
                    className="h-4 w-4 text-gold-600 dark:text-gold-400"
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    <span className="font-mono tabular-nums">
                      {rewardsBalance.toLocaleString('en-IN')}
                    </span>{' '}
                    pts available
                  </p>
                  <p className="text-xs text-muted-foreground">
                    1 pt = ₹0.10 · max 50% of subtotal
                  </p>
                </div>
              </div>
              {rewardPointsToRedeem > 0 && (
                <Badge className="bg-gold-100 text-gold-700 dark:bg-gold-950/60 dark:text-gold-300">
                  {rewardPointsToRedeem} pts · {inr(pricing.rewardDiscount)} off
                </Badge>
              )}
            </div>

            {rewardsBalance > 0 && maxRedeem > 0 ? (
              <div className="space-y-3">
                <div className="px-1">
                  <Slider
                    value={[Math.min(rewardPointsToRedeem, maxRedeem)]}
                    min={0}
                    max={maxRedeem}
                    step={1}
                    onValueChange={handleRewardsChange}
                    aria-label="Reward points to redeem"
                    disabled={pricing.subtotal <= 0}
                  />
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>0 pts</span>
                    <span className="font-mono tabular-nums">
                      {Math.min(rewardPointsToRedeem, maxRedeem).toLocaleString('en-IN')} pts
                    </span>
                    <span className="font-mono tabular-nums">{maxRedeem.toLocaleString('en-IN')} pts</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleApplyMaxRewards}
                    disabled={pricing.subtotal <= 0}
                  >
                    Apply max ({maxRedeem.toLocaleString('en-IN')} pts = {inr(rewardDiscountPaise(maxRedeem))})
                  </Button>
                  {rewardPointsToRedeem > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearRewards}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="h-3 w-3" aria-hidden="true" />
                  Points will be deducted at checkout.
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Info className="h-3 w-3" aria-hidden="true" />
                {rewardsBalance === 0
                  ? 'No points yet — earn 1 pt per ₹10 spent on every order.'
                  : 'Add items to your cart to redeem points.'}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Tip section ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="cart-tip" className="mb-4">
        <h2
          id="cart-tip"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Tip <span className="font-normal normal-case text-muted-foreground/70">(optional)</span>
        </h2>
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              {TIP_PRESETS_RUPEES.map((rupees) => {
                const isActive = !tipCustomMode && tipAmount === rupees * 100
                return (
                  <Button
                    key={rupees}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleTipPreset(rupees)}
                    aria-pressed={isActive}
                    className={cn(isActive && 'bg-teal-600 hover:bg-teal-700')}
                  >
                    {rupees === 0 ? 'No tip' : `₹${rupees}`}
                  </Button>
                )
              })}
              <Button
                type="button"
                variant={tipCustomMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setTipCustomMode(true)
                  // Sync the custom input with the current tip (if any preset was
                  // active, the custom box starts at ₹0 — user types a value).
                  if (tipAmount > 0 && !TIP_PRESETS_RUPEES.includes((tipAmount / 100) as 0 | 10 | 20 | 30)) {
                    setTipCustomInput(String(tipAmount / 100))
                  } else {
                    setTipCustomInput('')
                  }
                }}
                aria-pressed={tipCustomMode}
                className={cn(tipCustomMode && 'bg-teal-600 hover:bg-teal-700')}
              >
                Custom
              </Button>
            </div>
            {tipCustomMode && (
              <div className="mt-3 flex items-center gap-2">
                <Label htmlFor="cart-tip-custom" className="sr-only">
                  Custom tip amount in rupees
                </Label>
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    ₹
                  </span>
                  <Input
                    id="cart-tip-custom"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={tipCustomInput}
                    onChange={(e) => handleTipCustomChange(e.target.value)}
                    placeholder="0"
                    className="pl-7"
                    aria-label="Custom tip in rupees"
                  />
                </div>
                {tipAmount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    = <span className="font-mono tabular-nums">{inr(tipAmount)}</span>
                  </span>
                )}
              </div>
            )}
            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <Heart
                className="h-3 w-3 text-rose-500 dark:text-rose-400"
                aria-hidden="true"
              />
              100% of your tip goes to the kitchen staff.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── Pickup details ──────────────────────────────────────────────────── */}
      <section aria-labelledby="cart-pickup" className="mb-4">
        <h2
          id="cart-pickup"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Pickup details
        </h2>
        <Card>
          <CardContent className="p-4 space-y-3">
            {/* Pickup time */}
            <div>
              <Label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Pickup time
              </Label>
              <div className="flex flex-wrap gap-2">
                {PICKUP_TIME_OPTIONS.map((opt) => {
                  const isActive = pickupTime === opt.value
                  return (
                    <Button
                      key={opt.label}
                      type="button"
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePickupTime(opt.value)}
                      aria-pressed={isActive}
                      className={cn(isActive && 'bg-teal-600 hover:bg-teal-700')}
                    >
                      {opt.label}
                    </Button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Estimate:{' '}
                <span className="font-mono tabular-nums">
                  {(() => {
                    const opt = PICKUP_TIME_OPTIONS.find((o) => o.value === pickupTime) ??
                      PICKUP_TIME_OPTIONS[0]!
                    const base = restaurant?.prepTimeMins ?? 20
                    const mins = opt.inMinutes === 0 ? base : Math.max(opt.inMinutes, base)
                    return `~${mins} min`
                  })()}
                </span>{' '}
                from order confirmation.
              </p>
            </div>
            <Separator />
            {/* Pickup location */}
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-300">
                <MapPin className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Pickup at
                </p>
                <p className="text-sm font-medium text-foreground">{restaurantName}</p>
                {restaurant?.address ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{restaurant.address}</p>
                ) : restaurantLoading ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">Loading address…</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Pricing breakdown (Task 1B component) ───────────────────────────── */}
      <Card className="mb-4 border-teal-200 dark:border-teal-900">
        <CardContent className="p-4">
          <PricingBreakdown
            title="Bill details"
            rows={pricingRows}
          />
        </CardContent>
      </Card>

      {/* ── Pricing breakdown note (transparency) ───────────────────────────── */}
      <p className="mb-2 flex items-center gap-1 px-1 text-xs text-muted-foreground">
        <Store className="h-3 w-3" aria-hidden="true" />
        SnakZap charges no platform fee during our campus MVP. Final amount is
        confirmed at checkout.
      </p>

      {/* ── Sticky checkout bar (rendered fixed at the bottom by the host CSS) ─ */}
      <StickyCheckoutBar
        total={pricing.total}
        count={cart.count()}
        onCheckout={onCheckout}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Header — back button (host wires to closeCart).
// ════════════════════════════════════════════════════════════════════════════

function Header({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null
  return (
    <Button variant="ghost" size="sm" className="mb-2" onClick={onBack}>
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
      Back to menu
    </Button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CartLineRow — single cart line (image + meta + qty stepper + remove).
// ════════════════════════════════════════════════════════════════════════════

interface CartLineRowProps {
  line: CartLine
  /** Resolved MenuItem (image + spiceLevel). Undefined while loading or if the
   *  item was deleted from the menu after being added to cart. */
  menuItem?: MenuItem
  menuLoading: boolean
  onIncrement: () => void
  onDecrement: () => void
  onRemove: () => void
  onEditModifiers: () => void
}

function CartLineRow({
  line,
  menuItem,
  menuLoading,
  onIncrement,
  onDecrement,
  onRemove,
  onEditModifiers,
}: CartLineRowProps) {
  const unitPaise = line.price
  const subtotalPaise = line.price * line.quantity
  const spiceLevel = menuItem?.spiceLevel ?? 0
  const image = menuItem?.image
  const rewardPts = pointsEarnedFor(line.price / 100)

  return (
    <div className="flex gap-3 p-3">
      {/* Image + veg badge */}
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {image ? (
          <img
            src={image}
            alt={line.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center bg-gradient-to-br text-2xl',
              cuisineGradient('Default'),
            )}
            aria-hidden="true"
          >
            <CuisineIcon cuisine="" />
          </div>
        )}
        <span className="absolute left-1 top-1">
          <VegBadge veg={line.isVeg} />
        </span>
      </div>

      {/* Meta + actions */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{line.name}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {spiceLevel > 0 && <SpiceDots level={spiceLevel} />}
              <span className="font-mono tabular-nums">{inr(unitPaise)}</span>
              <span aria-hidden="true">·</span>
              <RewardBadge>{rewardPts * line.quantity}</RewardBadge>
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${line.name} from cart`}
            className="snak-focus-ring rounded-md p-1 text-muted-foreground transition hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-950/40 dark:hover:text-danger-400"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Subtotal + qty stepper */}
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {inr(subtotalPaise)}
          </p>
          <div className="flex items-center gap-2">
            <Stepper
              quantity={line.quantity}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              ariaLabel={line.name}
            />
          </div>
        </div>

        {/* Edit modifiers link */}
        <button
          type="button"
          onClick={onEditModifiers}
          className="snak-focus-ring -ml-0.5 inline-flex w-fit items-center gap-1 rounded px-0.5 py-0.5 text-xs text-primary transition hover:underline"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
          Edit modifiers
        </button>
      </div>

      {/* Hidden while-loading affordance for screen readers — keeps the row
          accessible even if the menu hasn't resolved yet. */}
      {menuLoading && !menuItem && (
        <span className="sr-only" aria-live="polite">
          Loading item details for {line.name}.
        </span>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Stepper — quantity stepper (− count +).
// ════════════════════════════════════════════════════════════════════════════

function Stepper({
  quantity,
  onIncrement,
  onDecrement,
  ariaLabel,
}: {
  quantity: number
  onIncrement: () => void
  onDecrement: () => void
  ariaLabel: string
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-full border bg-background p-0.5"
      role="group"
      aria-label={`Quantity for ${ariaLabel}`}
    >
      <button
        type="button"
        onClick={onDecrement}
        aria-label={`Decrease quantity of ${ariaLabel}`}
        className="snak-focus-ring flex h-7 w-7 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        className="min-w-[2ch] text-center font-mono text-sm font-semibold tabular-nums text-foreground"
        aria-live="polite"
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        aria-label={`Increase quantity of ${ariaLabel}`}
        className="snak-focus-ring flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-white transition hover:bg-teal-700"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// StickyCheckoutBar — fixed bottom bar with total + "Proceed to Checkout".
// Rendered fixed at the bottom of the viewport (above the BottomNav chrome).
// ════════════════════════════════════════════════════════════════════════════

function StickyCheckoutBar({
  total,
  count,
  onCheckout,
}: {
  total: number
  count: number
  onCheckout: () => void
}) {
  const prefersReduced = useReducedMotion()
  return (
    <AnimatePresence>
      <motion.div
        initial={prefersReduced ? false : { y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.3, 0, 0, 1] }}
        // Positioned above the BottomNav (var(--height-bottom-nav-safe) on
        // mobile; 16px from the viewport bottom on md+ where BottomNav hides).
        className="fixed inset-x-0 bottom-[var(--height-bottom-nav-safe)] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-4"
        role="region"
        aria-label="Checkout"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Total ({count} {count === 1 ? 'item' : 'items'})
            </p>
            <p className="font-mono text-lg font-bold tabular-nums text-foreground">
              {inr(total)}
            </p>
          </div>
          <Button
            type="button"
            onClick={onCheckout}
            className="bg-teal-600 px-6 hover:bg-teal-700"
          >
            Proceed to Checkout
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export default CartScreen
