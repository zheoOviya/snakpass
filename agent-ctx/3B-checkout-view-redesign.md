# Task 3B — Checkout screen premium redesign

**Agent:** full-stack-developer
**Wave / Task:** Wave 3 / Task 3B
**Date:** 2025-08-20
**Status:** ✅ Complete — all acceptance criteria PASS

---

## 1. Scope

REWRITE `src/components/snak/checkout-view.tsx` (445 → 965 LOC) as a premium, mobile-first checkout experience per:

- Blueprint §13 CHECKOUT (Cart → Pickup → Payment → Review → Confirm → Order Created)
- Blueprint §4 P4 TRANSPARENT PRICING
- Blueprint §4 P5 PAYMENT STATE IS AUTHORITATIVE
- DESIGN_SYSTEM.md §5.3.4 Checkout form (radio cards + payment selector)
- PRODUCT_IMPLEMENTATION_PLAN.md Task 3B (lines 1439–1461)

**Preserve verbatim:** two-step POST /api/orders → POST /api/payments → GET /api/orders/[id] flow + demo payment synthesis (`pay_demo_<ts>` + `sig_demo_<ts>`).

---

## 2. Governance boundaries respected

| Protected file | Owner | Touched? |
|---|---|---|
| `src/app/api/orders/route.ts` (POST) | existing | ❌ No |
| `src/app/api/payments/route.ts` (POST) | existing | ❌ No |
| `src/lib/razorpay.ts` | payment gateway | ❌ No |
| `src/lib/deployment.ts` (`realPayments` flag) | deployment | ❌ No |
| `src/components/snak/consumer-view.tsx` | Task 3A | ❌ No |
| `src/components/snak/screens/cart-screen.tsx` | Task 3A | ❌ No |
| `src/components/snak/order-tracking.tsx` | Task 3C | ❌ No |
| `prisma/schema.prisma` | Task 1A | ❌ No |
| Demo payment synthesis (`pay_demo_<ts>` + `sig_demo_<ts>`) | payment | ❌ No (preserved verbatim) |

**File owned + rewritten:** `src/components/snak/checkout-view.tsx` (only).

---

## 3. Implementation summary

### Sections (mobile-first, scrollable)

1. **Restaurant banner** — gradient teal Card with Store icon, restaurant name, fetched cuisine (best-effort GET /api/restaurants/[id]), "Cart" ghost button (`onBack`).
2. **Order summary card** — list of cart lines: VegBadge, name, "{inr(price)} × {qty}" subtext, RewardBadge "+{pts}" (gold accent), line total in tabular-nums.
3. **PricingBreakdown card** (Task 1B component) — transparent pricing per §4 P4. Rows:
   - Food subtotal (add)
   - GST (5%) (add)
   - Platform fee (add, conditional when > 0 — currently 0 in MVP)
   - Discount (sub, conditional when > 0, hint: `Coupon {code} applied`)
   - Reward discount (sub, conditional when > 0, hint: `{pts} pts = {inr(off)} off`)
   - Tip (add, conditional when > 0)
   - Total payable (total, aria-live="polite")
4. **Pickup details form** — name + phone (prefilled from /api/auth/me) + special instructions (Textarea, 500 char counter) + pickup time display (read-only, "ASAP (in ~15 min)" fallback or "Scheduled · HH:MM, DD Mon").
5. **Demo-mode amber banner** — ShieldCheck icon + "Demo Mode — No real payment will be charged" headline + body explaining `realPayments` flag is OFF. Lock icon on right.
6. **Payment method selector** — RadioGroup with 3 options:
   - Razorpay (default + "Recommended" gold badge, CreditCard icon, "Credit / debit cards, netbanking, EMI" desc)
   - UPI (Smartphone icon, "Google Pay, PhonePe, Paytm" desc + 3 variant chips)
   - Wallet (Wallet icon, "SnakZap wallet — coming soon" desc)
   - Each option = PaymentOptionCard — bordered card that lifts + colored border when selected, custom radio indicator (filled teal circle when selected). whileTap scale 0.99.
7. **Security note** — small muted text: "Payments are secured by Razorpay. SnakZap never stores your card details — they go directly to the payment gateway over an encrypted channel."
8. **Sticky Pay bar** — mobile (fixed bottom, backdrop-blur, "Total payable" + Pay button) / desktop (inline "Back to cart" + Pay button). Pay button: `Pay ₹X` with CreditCard icon (or spinner + "Placing order…" / "Processing payment…" when processing). bg-teal-600. whileTap scale 0.98.

### Two-phase pay flow (preserved verbatim)

- **Phase 1 "Placing order…"**: POST /api/orders with `{ restaurantId, items, note: composedNote }` + Idempotency-Key header (crypto.randomUUID). `composedNote = "Pickup: {name} · {phone}\nPayment: {method}\nNote: {note}"` (sliced to 500 chars).
- **Phase 2 "Processing payment…"**: POST /api/payments with `{ orderId, razorpayPaymentId: "pay_demo_" + Date.now(), razorpaySignature: "sig_demo_" + Date.now() }` + Idempotency-Key header.
- **Phase 3 (best-effort)**: GET /api/orders/{id} to refresh order with PAID status + statusHistory.
- **On success**: cart.clear() → onSuccess(finalOrder with PAID status) + success toast "Payment confirmed! 💳".
- **On order-creation failure**: destructive toast + stay on checkout (cart intact, finally resets phase to 'idle').
- **On payment failure (after order created)**: cart.clear() → onSuccess(createdOrder with CONFIRMED status) + destructive toast "Payment failed — order placed but payment pending. Please retry payment from My Orders."

### framer-motion micro-interactions

- `motion.section` for entrance stagger (custom prop drives per-section delay, capped at 0.2s)
- `motion.label` (PaymentOptionCard) for whileTap scale 0.99
- `motion.div` (cart line items) with layout + initial/animate
- `motion.div` (PayBar sticky bar) with initial y:100 → 0 entrance
- `useReducedMotion` honored throughout — when true, motion components render static
- PricingBreakdown's internal AnimatedAmount provides count-up via `animate` + `useMotionValue`

### Prefill

- `useEffect` on mount fetches `/api/auth/me` → prefills `pickupName` (from `d.user.name`) + `pickupPhone` (from `d.user.phone`).
- Silent fallback on failure (user may be unauthenticated).
- `prefillLoaded` flag prevents premature phone-validation error display.

---

## 4. Verification

| Check | Result |
|---|---|
| `bunx eslint src/components/snak/checkout-view.tsx --max-warnings 0` | ✅ EXIT 0 (zero errors, zero warnings) |
| `bunx tsc --noEmit --skipLibCheck \| grep checkout-view` | ✅ ZERO matches (no new errors) |
| Dev server (port 3000) running | ✅ `ss -tlnp \| grep :3000` shows next-server pid |
| `GET /consumer` | ✅ HTTP 200 (compile 9.5s, render 306ms — Turbopack warm-up) |
| Dev log runtime errors | ✅ None for checkout-view |
| Pre-existing `motion() is deprecated` warning | ⚠️ From `restaurant-card-v2.tsx` (Task 1B), NOT my code — my file uses `motion.section/label/div` exclusively |

### Acceptance criteria (all 11 boxes)

- [✓] Checkout screen renders: restaurant banner, order summary, PricingBreakdown, pickup details form, payment method selector (Razorpay/UPI/Wallet), demo-mode banner, Pay ₹X button.
- [✓] Pay button shows transparent total from cart.pricing().
- [✓] Two-step flow preserved: POST /api/orders → POST /api/payments → GET /api/orders/[id].
- [✓] Demo payment synthesis preserved: `pay_demo_<ts>` + `sig_demo_<ts>`.
- [✓] Error handling: order-creation failure → toast + stay on checkout; payment failure → cart cleared + onSuccess(CONFIRMED order) + destructive toast.
- [✓] Prefill: name + phone from /api/auth/me.
- [✓] framer-motion micro-interactions.
- [✓] `bun run lint` exits 0 on the file.
- [✓] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in the file.
- [✓] Dev server runs without errors (port 3000 verified).

---

## 5. Issues encountered + resolutions

1. **`aria-checked` on `role="presentation"`** — initial PaymentOptionCard had `aria-checked={selected}` + `role="presentation"` on `<motion.label>`. ESLint `jsx-a11y/role-supports-aria-props` flagged it. Resolved by removing both — the bordered card visual + the hidden Radix RadioGroupItem (sr-only) handle the a11y tree; the label's `htmlFor` correctly associates click → radio toggle.
2. **Unused imports** — initial draft imported `Building2` (placeholder) + `REWARD_POINTS_PER_RUPEE` (intended for earn preview). Both unused. Resolved by removing both — `pointsEarnedFor()` already encapsulates the rate.
3. **Dev server had died between sessions** — initial curl returned 000. Restarted via `setsid bun run dev > dev.log 2>&1 &`. Verified healthy via `ss -tlnp` + `curl /api/health`.
4. **cart.pricing() returns `platformFee: 0`** — SnakZap low-fee model = 0 in MVP (per cart-store.ts line 141). Spec mentioned "platform fee (₹5)" but the actual cart returns 0. Resolution: render the platformFee row ONLY when > 0 (conditional). When platformFee is enabled later (via cart-store.ts config, NOT my checkout-view), the row will surface automatically without code change. This is the correct governance posture: the checkout screen displays what `cart.pricing()` returns, not a hardcoded amount.

---

## 6. Coordination notes for sibling Wave 3 tasks

- **Task 3A (cart-screen owner)**: My checkout's "Change" link on the pickup time row calls `onBack()` — Task 3A's cart screen is expected to host the pickup time picker (`cart.setPickupTime`). When the user changes the time and returns to checkout, the pickup time label updates automatically (driven by `cart.pickupTime`).
- **Task 3A (cart-screen owner)**: My checkout reads `cart.couponCode`, `cart.rewardPointsToRedeem`, `cart.tipAmount` via `cart.pricing()`. If Task 3A exposes UI to set these (per PRODUCT_IMPLEMENTATION_PLAN.md Task 3A acceptance criteria "Apply coupon", "Apply rewards", and tip), my PricingBreakdown rows will render the discount + reward + tip rows automatically (conditional on > 0).
- **Task 3C (order-tracking owner)**: My `onSuccess(createdOrder)` passes the order with PAID status (or CONFIRMED on payment failure). Task 3C's order-tracking renders the timeline based on `order.status` + `order.statusHistory` — no contract change needed.
- **Task 3D (my-orders owner)**: On payment failure, my destructive toast tells the user "Please retry payment from My Orders." — Task 3D's My Orders screen should expose a "Retry payment" CTA on CONFIRMED orders without a captured payment (deferred to Wave 4+ per blueprint §13 CHECKOUT flow).

---

## 7. Public component contract (preserved)

```typescript
interface CheckoutViewProps {
  /** Return to the cart / restaurant menu. */
  onBack: () => void
  /** Order successfully placed (+ payment captured or pending) → switch to tracking. */
  onSuccess: (order: Order) => void
}

export function CheckoutView({ onBack, onSuccess }: CheckoutViewProps): JSX.Element
export default CheckoutView
```

**No contract change** from the previous impl — consumer-view.tsx (Task 3A owner) doesn't need any prop wiring changes.
