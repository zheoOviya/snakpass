# SnakZap — Product Implementation Plan (PLAN-01)

**Author:** Plan subagent (master planner)
**Date:** derived from session start
**Status:** PLAN APPROVED — ready for Wave 1 dispatch
**Governance:** Blueprint §0, §29, §50 — preserve all existing governance baseline; additive only
**Reference:** `upload/SNAKZAP_IDE_MASTER_IMPLEMENTATION_BLUEPRINT.md` (§1–§62)

---

## 0. Executive summary

SnakZap is a Snackpass-inspired social food-ordering app for Indian college campuses and local restaurants. The existing codebase already has a working vertical slice (login → browse → menu → cart → checkout → demo pay → vendor fulfilment → pickup QR), a 21-model Prisma schema with strict payment / fulfilment / audit governance, and 58 API routes — most of which are governed by hard boundaries (P0-06, P0-07, M9/M10 prohibition, realPayments OFF, invariantChecker OFF).

This plan documents:
1. The brainstorming decisions for each of the 9 product pillars (campus, rewards, social, gifting, group ordering, meal plans, UI, IA, lifecycle).
2. The reuse decision for every existing file (KEEP / MODIFY / REWRITE / DO NOT TOUCH).
3. The full set of additive Prisma models required (Campus, RewardAccount, RewardLedgerEntry, RewardRule, RewardRedemption, Gift, GroupOrder, GroupOrderMember, GroupOrderItem, SocialConnection, SocialActivity, Notification, RestaurantCampus, MenuModifier, MenuModifierOption, Coupon, VendorDeal) plus two additive nullable columns on existing models (`User.campusId`, `Restaurant.campusId`, `Fulfilment.acceptedAt`, `Fulfilment.acceptedBy`, `MenuItem.rewardMultiplier`).
4. A 9-wave subagent task breakdown, each task with explicit scope, files to create/modify, governance boundaries, dependencies, and acceptance criteria.
5. A governance boundary checklist.
6. A risk register.
7. The execution order + critical path.
8. The Definition of Done per blueprint §56.

**Critical product decision:** the Snackpass "ACCEPTED" state in the conceptual order lifecycle (blueprint §14) is **NOT** added as a new enum value to `Order.status` or `Fulfilment.status` — that would trip P0-06 governance. Instead it is modelled additively as `Fulfilment.acceptedAt: DateTime?` + `Fulfilment.acceptedBy: String?` plus a NEW `POST /api/vendor/orders/[id]/accept` endpoint that sets the timestamp + emits an `ORDER_ACCEPTED` outbox event. The fulfilment state machine (`PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP`) is **untouched**. This is the cleanest additive resolution.

---

## Part 1 — Brainstorming notes

### A. Product differentiation vs Snackpass

**Where SnakZap improves on Snackpass (per blueprint §3):**

| Snackpass weakness | SnakZap improvement | Existing asset / new work |
|---|---|---|
| Weak pickup verification (just QR scan) | P0-07 enforced: QR + OTP + cross-credential + idempotent pickup attribution (flag-gated, architecturally complete) | `src/lib/pickup-attribution.ts`, `src/app/api/orders/[id]/pickup/verify/route.ts` — DO NOT TOUCH |
| Payment / fulfilment state conflation | P0-06 separates `Payment` (PAYMENT_PENDING → CAPTURE_PENDING → CAPTURED → REFUND_PENDING → REFUNDED), `Fulfilment` (PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP), and `Order.status` (CONFIRMED → PAID → PREPARING → …) | `src/lib/fulfilment-state.ts`, `src/lib/state-invariants.ts`, `prisma/schema.prisma` — DO NOT TOUCH |
| Weak audit trail | Hash-chained `AuditLog` (tamper-evident) + immutable `LedgerEntry` + `IdempotencyKey` + `Outbox` + `ProcessedEvent` | existing |
| US-centric payments (Stripe) | Razorpay abstraction (replaceable gateway) + UPI native | `src/lib/razorpay.ts` — DO NOT TOUCH |
| Loosely tied campus identity | Campus model with email-suffix domain validation + organization code + User.campusId FK | NEW: `Campus` model + `/api/campuses` routes |
| Hidden fees | Transparent pricing breakdown per blueprint §4 P4: subtotal + tax + platform fee − discount − rewards = total | NEW: `cart-store.pricing()` method + checkout UI |
| Limited merchant operational controls | Vendor menu management + deals + reward multiplier + prep time setter + accept/reject + analytics | NEW: vendor module enhancements + `MenuModifier`, `VendorDeal` models |
| Basic group-order coordination | Host-pays Model A with share code + individual carts merged into single order + GroupOrderItem ledger per member | NEW: `GroupOrder`, `GroupOrderMember`, `GroupOrderItem` models + `/api/group-orders` routes |
| Weak rewards fraud prevention | Ledger-based immutable `RewardLedgerEntry` + idempotency key per event + one reward per rule per event + balance derived from sum | NEW: rewards engine |
| Loose gifting controls | Recipient binding + expiry + redemption audit + no double redemption + payment/refund separation | NEW: `Gift` model + `/api/gifts` routes |
| Implicit order lifecycle | Event-driven outbox (`Outbox` + `ProcessedEvent` + socket.io realtime fanout) | existing |
| No production evidence gates | Feature flags (`realPayments`, `invariantChecker`, `pickupAttributionEnforcement`, `webhookHandler`, `reconciliationAutoRepair`) — all default OFF | `src/lib/deployment.ts` — DO NOT TOUCH |

**Indian college market wedge:**

1. **UPI payments**: Razorpay supports UPI natively; India's dominant digital payment rail (60%+ of digital tx volume). Snackpass relies on Apple Pay/Stripe — useless in India.
2. **Regional food**: North Indian / South Indian / Indo-Chinese / Desserts already seeded. Future expansion to regional cuisines (Bengali, Rajasthani, Andhra, Chettinad).
3. **Campus identity via college email**: validate `*.ac.in` / `*.edu.in` email suffix against `Campus.domain`. Students verify once at onboarding.
4. **Lower fees**: max 10% commission vs Swiggy/Zomato 22-28%. No delivery fleet = lowest cost structure. SnakZap passes savings to students.
5. **Vernacular support (later)**: i18n via next-intl (already installed); phase 9+, post-MVP. Initial focus on English.
6. **No delivery fleet**: matches hostel/PG/campus walking-distance reality; removes the cost centre that breaks DoorDash/UberEats unit economics.
7. **Group ordering for mess-splitting**: common in Indian hostels where 4-8 students share a meal; the host-pays Model A aligns with the "one person pays, others transfer their share via UPI later" cultural pattern.
8. **Gifting culture**: festivals (Diwali sweets, Rakhi sweets, Pongal), birthdays, exam-end celebrations. The gifting flow leans into existing Indian gifting culture.
9. **Student discounts + campus promotions**: campus-specific deals (e.g., IIT-B orientation week: free cold coffee with every order).

### B. Information architecture (blueprint §7)

**MVP consumer bottom-nav (5-tab):**

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│  Home   │ Explore │ Orders  │ Rewards │ Profile │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

**Reasoning:**
- Blueprint §7 offers two options: 5-tab (Home/Explore/Orders/Rewards/Profile) or 6-tab (with Social).
- MVP chooses **5-tab** because:
  - Social is P2 priority per blueprint §53 (group ordering, social feed, referrals all P2).
  - Adding a Social tab with no content feels empty (blueprint §45: "no empty screen without explanation").
  - Social signals (friends ordering nearby) are **woven into Home** as cards during MVP — gives the social warmth without committing to a dedicated feed surface.
- Social becomes a 6th tab in Wave 6 once the social graph has enough density.
- The `Orders` tab consolidates active orders, history, and reorder.

**Social: woven into Home OR dedicated tab?**

Decision: **woven into Home during MVP**, dedicated tab in Wave 6.

- MVP Home includes a "Friends ordering nearby" section (visible only if the user has ≥ 1 friend with an active order).
- When Wave 6 ships the social graph + activity feed, a 6th "Social" tab is added between Orders and Rewards (per blueprint §7's optional variant).

**Campus selector: global top-bar OR first-run onboarding step?**

Decision: **both — first-run onboarding step (required) + global top-bar chip (always editable)**.

- First-run onboarding (blueprint §8.1): required step after phone OTP login. User selects campus from searchable list or enters organization code. Stored as `User.campusId`.
- Global top-bar chip: shows current campus as a chip in the consumer app shell (e.g., "🎓 IIT Bombay"). Tapping opens a bottom sheet to switch campuses (relevant when a student visits another campus).
- This matches blueprint §8.1: "Campus selection should support: search, nearby campus, invite/deep link, organization code."

### C. Order lifecycle (blueprint §14, P0-06 boundary)

**Existing state machines (DO NOT TOUCH per blueprint §50):**

```
Order.status:       CONFIRMED → PAID → PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP
                    (terminal: CANCELLED, PAYMENT_PENDING, FROZEN)

Payment.status:     PAYMENT_PENDING → CAPTURE_PENDING → CAPTURED → REFUND_PENDING → REFUNDED
                    (terminal: FAILED, FROZEN)

Fulfilment.status:  PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP
                    (lazy-created on first GET/PATCH /api/orders/[id]/fulfilment)
```

**Blueprint §14 conceptual lifecycle:**

```
CREATED → PAYMENT_PENDING → PAYMENT_AUTHORIZED → PAYMENT_CAPTURED → ACCEPTED
       → PREPARING → READY_FOR_PICKUP → PICKED_UP
```

**Mapping to existing state:**

| Blueprint §14 conceptual state | SnakZap implementation |
|---|---|
| CREATED | `Order.status = CONFIRMED` (POST /api/orders) |
| PAYMENT_PENDING | `Payment.status = PAYMENT_PENDING` (order created, no payment yet) |
| PAYMENT_AUTHORIZED | (deferred — Razorpay capture flow is auto-capture; AUTHORIZED state collapsed into CAPTURE_PENDING) |
| PAYMENT_CAPTURED | `Payment.status = CAPTURED` + `Order.status = PAID` (POST /api/payments) |
| ACCEPTED | **NEW additive field** `Fulfilment.acceptedAt: DateTime?` set by `POST /api/vendor/orders/[id]/accept` (see below) |
| PREPARING | `Fulfilment.status = PREPARING` (lazy-created) |
| READY_FOR_PICKUP | `Fulfilment.status = READY_FOR_PICKUP` |
| PICKED_UP | `Fulfilment.status = PICKED_UP` + `Order.status = PICKED_UP` |

**Governance STOP condition (blueprint §50):**

> Cannot change payment/fulfilment state semantics.

**Resolution: ACCEPTED as an additive Fulfilment pre-state — cleanest approach.**

Adding a new `ACCEPTED` enum value to `Fulfilment.status` would either:
1. (Option X) modify `FULFILMENT_STATUSES` + `NEXT_FULFILMENT_STATUS` in `src/lib/fulfilment-state.ts` → trips P0-06 governance STOP.
2. (Option Y) lazy-create the Fulfilment row at `ACCEPTED` instead of `PREPARING` → same problem + breaks the existing lazy-create contract.

The cleanest additive resolution is **Option Z — additive timestamp columns**:

```prisma
model Fulfilment {
  // existing fields unchanged ...
  status        String   @default("PREPARING")  // unchanged enum
  // NEW additive columns (P0-06-compatible — nullable, default null)
  acceptedAt    DateTime?  // set when vendor explicitly accepts the order
  acceptedBy    String?    // userId of the vendor who accepted
  acceptedNote  String?    // optional vendor note (e.g., "starting in 5 min")
}
```

The new endpoint `POST /api/vendor/orders/[id]/accept`:
- Sets `Fulfilment.acceptedAt = now()`, `acceptedBy = session.userId`
- Emits `ORDER_ACCEPTED` outbox event (consumed by socket.io realtime fanout + notification)
- Idempotent: if `acceptedAt` is already set, returns 200 with `idempotent: true`
- Does NOT modify `Fulfilment.status` (still PREPARING)
- Does NOT modify `Order.status`
- Does NOT touch Payment/Refund/LedgerEntry/IdempotencyKey/AuditLog semantics

UI surface: the consumer order-tracking timeline renders an extra "Restaurant accepted" dot between "Payment Confirmed" and "Preparing" — driven by `acceptedAt IS NOT NULL`. The vendor card shows "Accept" + "Start Preparing" buttons in sequence. This achieves the Snackpass "ACCEPTED" UX without breaking P0-06.

**This approach has zero governance impact.**

### D. Rewards engine (blueprint §17)

**Points model:**

- **Earn rate**: 1 point per ₹10 spent (10 points per ₹100). Rationale: gives round psychological numbers. A ₹140 Masala Dosa earns 14 points; a ₹500 order earns 50 points.
- **Redemption rate**: 100 points = ₹10 discount (10% back on first purchase, configurable). Goal: drives repeat behavior without unit-economics breakage.

**Bonus rules (configurable via `RewardRule` table):**

| Rule key | Trigger | Points | One-time? | Notes |
|---|---|---|---|---|
| `EARN_BASE` | Every ₹10 spent on PICKED_UP order | 1 per ₹10 | no | Always-on |
| `FIRST_ORDER` | First PICKED_UP order | +50 | yes (per user) | Idempotency key: `FIRST_ORDER:${userId}` |
| `SECOND_ORDER` | Second PICKED_UP order | +25 | yes | Idempotency key: `SECOND_ORDER:${userId}` |
| `STREAK_3` | 3 consecutive days with order | +20 | yes (per streak) | Idempotency key: `STREAK_3:${userId}:${streakId}` |
| `STREAK_7` | 7 consecutive days with order | +100 | yes (per streak) | Idempotency key: `STREAK_7:${userId}:${streakId}` |
| `REFERRAL` | Referee's first PICKED_UP order | +100 to referrer | yes (per referral) | Idempotency key: `REFERRAL:${refereeUserId}` |
| `OFF_PEAK` | Order PICKED_UP 3-5 PM or 9-11 PM IST | +10 | no | Idempotency key: `OFF_PEAK:${orderId}` |
| `GROUP_ORDER` | Host confirms + pays a group order that reaches PICKED_UP | +25 to host | no | Idempotency key: `GROUP_ORDER:${orderId}` |
| `GIFT_SENT` | Sender pays for a gift | +5 | no | Idempotency key: `GIFT_SENT:${giftId}` |
| `GIFT_RECEIVED` | Recipient redeems a gift | +5 | no | Idempotency key: `GIFT_RECEIVED:${giftId}` |
| `CAMPUS_EVENT` | Configurable per campus + date range | +50 (default) | no | Idempotency key: `CAMPUS_EVENT:${campusId}:${eventKey}:${orderId}` |

**Redemption:**

- `PERCENT_DISCOUNT`: 100 points = 5% off (max 20%); 200 points = 10% off; configurable
- `FIXED_DISCOUNT`: 200 points = ₹20 off; 500 points = ₹50 off
- `FREE_ITEM`: vendor-specific (e.g., 300 points = free cold coffee at Sweet Tooth Bakers)
- `VENDOR_SPECIFIC`: configurable per restaurant deal

**Fraud controls:**

1. **Ledger-based**: balance = `SUM(points) WHERE type=EARN` − `SUM(points) WHERE type IN (REDEEM, EXPIRE, ADJUST)`. Never stored on a mutable counter — always derived from immutable ledger entries.
2. **Idempotent issuance**: each `RewardLedgerEntry` has a unique `idempotencyKey` constructed as `${ruleId}:${eventId}`. Duplicate attempts to issue the same bonus return the cached entry.
3. **One reward per eligible event**: enforced by the `@@unique([userId, idempotencyKey])` constraint on `RewardLedgerEntry`.
4. **Earn on PICKED_UP only**: prevents cancellation farming (order PAID → earn points → cancel → refund → keep points).
5. **Append-only**: `RewardLedgerEntry` has no `updatedAt` field. REDEEM entries reference the original EARN entry id (audit trail).
6. **Expiry via cron**: a scheduled job marks EARN entries older than 365 days as EXPIRE (creates new RewardLedgerEntry with type=EXPIRE, points=−original, references original entry).

**DB schema (additive — see Part 3 for full Prisma definitions):**

- `RewardAccount` (userId unique, balance derived, lifetimeEarned, updatedAt)
- `RewardLedgerEntry` (userId, type EARN/REDEEM/EXPIRE/ADJUST, points ±, orderId?, ruleId?, giftId?, idempotencyKey unique, expiresAt?, createdAt)
- `RewardRule` (key unique, name, pointsFormula JSON, isActive, createdAt, updatedAt)
- `RewardRedemption` (ledgerEntryId, orderId?, rewardType PERCENT_DISCOUNT/FIXED_DISCOUNT/FREE_ITEM/VENDOR_SPECIFIC, discountValue, appliedAt)

### E. Social graph (blueprint §18)

**Friend model: bidirectional follow = friendship request + accept.**

- Two records per mutual friendship: `SocialConnection(followerId=A, followeeId=B, status=ACCEPTED)` and `SocialConnection(followerId=B, followeeId=A, status=ACCEPTED)`.
- Stored as two rows (not one) because: (a) easier to query "who do I follow" (`followerId=me`), (b) easier to query "who follows me" (`followeeId=me`), (c) symmetric operations (block, unfriend) just flip both rows.
- Request lifecycle: A sends request → row (A→B, PENDING). B accepts → row (A→B, ACCEPTED) + row (B→A, ACCEPTED) created in same transaction. B rejects → row (A→B, REJECTED) — A can re-request after cooldown. B blocks → row (A→B, BLOCKED) — A cannot re-request.

**Activity feed (Venmo-style — never expose payment amount):**

Activity verbs:
- `ORDERED` — "Aarav ordered from Dosa Den" — actor=user, object=restaurant, metadata `{ restaurantName }`
- `ORDERED_ITEM` (opt-in) — "Aarav got a Masala Dosa" — actor=user, object=menuItem, metadata `{ itemName, restaurantName }`
- `GIFTED` — "Priya sent a gift to Riya" — actor=user, object=gift, metadata `{ recipientName, menuItemName }`
- `GROUP_ORDERED` — "Karan started a group order at Wok & Roll" — actor=user, object=groupOrder, metadata `{ restaurantName, memberCount }`
- `REWARDED` — "Aarav earned 50 reward points" — actor=user, object=rewardLedgerEntry, metadata `{ points, ruleName }`
- `REDEEMED` — "Aarav redeemed 200 points for ₹20 off" — actor=user, object=rewardRedemption, metadata `{ points, rewardType }`

**NEVER expose payment amount** (blueprint §18).
**NEVER expose order items unless the user has opted-in** (privacy setting `shareOrderItems`).

**Privacy:**

- `SocialActivity.visibility`: `FRIENDS` (default), `PUBLIC`, `PRIVATE`
- `User.privacySettings` (JSON column): `{ shareOrderItems: false, shareLocation: false, shareActivityFeed: true }`
- Friends-only feed: `WHERE actorId IN (SELECT followeeId FROM SocialConnection WHERE followerId=me AND status='ACCEPTED') AND visibility IN ('FRIENDS', 'PUBLIC')`

**DB schema:**

- `SocialConnection` (followerId, followeeId, status PENDING/ACCEPTED/REJECTED/BLOCKED, requestedAt, acceptedAt?, @@unique([followerId, followeeId]))
- `SocialActivity` (actorId, verb, objectType, objectId, metadata JSON, visibility, createdAt, @@index([actorId, createdAt]))

### F. Food gifting (blueprint §19)

**Gift flow:**

```
Sender: Select food → Select friend (recipient) → Optional note → Pay
        ↓
Gift: CREATED → PAID → AVAILABLE
        ↓
Recipient: Receives notification → Sees gift in app → Redeems at vendor
        ↓
Gift: AVAILABLE → REDEEMED (creates Order with totalAmount=0, recipientId as userId)
        ↓
Vendor: sees Order, prepares, recipient picks up using their own pickup OTP
```

**Gift states:** CREATED → PAID → AVAILABLE → REDEEMED / EXPIRED / CANCELLED / REFUNDED

- CREATED: gift object created, no payment yet
- PAID: sender's payment captured (separate Payment record linked via `gift.paymentId`)
- AVAILABLE: gift is redeemable by recipient (visible in their gifts inbox)
- REDEEMED: recipient has redeemed → Order created with totalAmount=0
- EXPIRED: passed `expiresAt` (30 days default) → auto-refund to sender
- CANCELLED: sender cancelled before redemption → refund to sender
- REFUNDED: refund processed (after CANCELLED or EXPIRED)

**Fraud controls (blueprint §19):**

- **Recipient binding**: gift scoped to one `recipientId`. Cannot be transferred.
- **Expiry**: `expiresAt = createdAt + 30 days` (configurable per campus).
- **Redemption audit**: each redemption creates a new `Order` linked via `gift.orderId`. The redemption code is single-use.
- **No double redemption**: `Gift.status = REDEEMED` is terminal. Subsequent redemption attempts return 409 with the original order id.
- **Payment/refund separation**: gift's Payment record is independent of the redeemed Order's (non-existent) Payment. The sender's payment flows through the normal Razorpay capture lifecycle; the recipient's redemption creates a zero-amount Order that does NOT require payment.

**DB schema:**

- `Gift` (senderId, recipientId, menuItemId, message?, status, redemptionCode unique, expiresAt, paymentId?, orderId?, createdAt, redeemedAt?, cancelledAt?, refundedAt?)
- Payment flows through existing `/api/payments` route (creates `Payment` linked via `gift.paymentId`) — DO NOT TOUCH the payments route. The gift creation API creates a Payment with `orderId=null` (or a placeholder) — but actually we need to handle this carefully. **Resolution:** Gift payment reuses the existing /api/payments route by creating a "ghost order" first (a placeholder Order with `isGift=true` flag, totalAmount = menuItem.price). This ghost order is cancelled once the gift is redeemed and the real Order is created for the recipient. This keeps payment flow within the existing governance boundary.

  Actually, even cleaner: Gift creates a real Order with userId=senderId, isGift=true (new additive boolean on Order? — but that modifies Order model). To stay strictly additive, we model the gift payment via a separate `GiftPayment` link table OR by reusing the existing Payment with `orderId` pointing to a placeholder.

  **Final decision (cleanest additive):** Sender pays via a normal Order (their own userId, with the gift item). That Order's `note` field carries `GIFT:${giftId}:for:${recipientId}`. The Order is created in CONFIRMED → PAID as normal. The Payment captures. The gift's `paymentId` links to this Payment. The Order is then marked as "fulfilled via gift" by setting `Order.status = PICKED_UP` immediately (no fulfilment needed) — OR we add a new additive column `Order.giftId String?` (nullable FK, additive) that signals "this order was a gift purchase; do not create a Fulfilment". When recipient redeems, a NEW Order is created for them with totalAmount=0, isGift=true (existing nullable flag — wait, isGift doesn't exist on Order).

  **Simplest strictly-additive approach:** Don't modify the Order model at all. Use the existing `note` field to encode gift metadata. The sender's payment is a normal Order (note includes `GIFT_TO:${recipientUserId}`). The recipient's redemption creates a NEW Order with totalAmount=0 (note: `GIFT_FROM:${senderUserId}:${giftId}`). The vendor sees this redemption Order in their queue and prepares normally. No schema change to Order needed. The `Gift` model itself tracks the linkage via `senderOrderId` and `recipientOrderId` columns.

  This is the approach we'll use — fully additive, no Order model change.

### G. Group ordering (blueprint §20, Model A — host pays)

**Flow:**

```
Host: Creates GroupOrder at restaurant R → Gets share code/link
        ↓
Friends: Open share link → Join group → Each adds items to their own cart
        ↓
Host: Reviews all member carts → Confirms & Pays → Single Order created with all items
        ↓
Vendor: Receives one merged Order → Prepares → Pickup
```

**Model A only (host pays entire order) per blueprint §20:**

> Implement Model A first unless business requirements demand split payments.

**DB schema:**

- `GroupOrder` (hostId, restaurantId, status OPEN/CONFIRMED/CLOSED/CANCELLED, shareCode unique, closesAt?, confirmedAt?, createdAt, updatedAt)
- `GroupOrderMember` (groupOrderId, userId, joinedAt, @@unique([groupOrderId, userId]))
- `GroupOrderItem` (groupOrderId, userId, menuItemId, name, price, quantity, addedAt)

**Confirmation flow:**

1. Host clicks "Confirm & Pay" on the group order detail page.
2. Backend `POST /api/group-orders/[id]/confirm`:
   - Validates all members have ≥ 1 item.
   - Creates a single Order with userId=hostId, restaurantId=group.restaurantId, items=[...all GroupOrderItems merged by menuItemId].
   - Sets `GroupOrder.status = CONFIRMED`, `confirmedAt = now()`.
   - Returns the created Order's id.
3. Host's checkout flow runs normally on this Order (POST /api/payments, etc.).
4. Vendor sees the Order in their queue (single order, not group-aware).

**Concurrency:** Member carts can be modified up until host confirm. Locking: the confirm endpoint uses `withTransaction` + optimistic locking on `GroupOrder.version` to prevent race between confirm and member-add.

**Cleanup:** Group orders in OPEN status auto-close after `closesAt` (default 24 hours after creation) via cron. Closed group orders cannot accept new members or items.

### H. Campus economy (blueprint §40, §21 — reserve schema, defer implementation)

**Schema reserved now; implementation deferred to Wave 9+ (post-MVP).**

- `Campus` (name, domain, city, state, isActive, settings JSON, createdAt)
- `RestaurantCampus` (restaurantId, campusId, @@unique([restaurantId, campusId])) — many-to-many junction
- `User.campusId String?` (nullable FK, additive)
- `Restaurant.campusId String?` (nullable FK — primary campus; many-to-many via RestaurantCampus for secondary)
- `MealPlan` (parentId, studentId, dailyLimit, weeklyLimit, monthlyLimit, expiresAt, merchantRestrictions JSON, isActive) — RESERVED, not implemented in MVP

**Campus selection mechanics:**

- Onboarding: user enters organization code OR selects from searchable list. If email suffix matches `Campus.domain`, auto-suggest.
- `Campus.settings`: JSON for campus-specific config (e.g., `{ "defaultCurrency": "INR", "commissionRate": 0.06, "mealPlanEnabled": false, "studentDiscountPercent": 5 }`).

### I. Premium UI direction (blueprint §33, §45)

**Visual identity:**

> Modern campus food app — warm, social, vibrant. NOT a Snackpass copy.

**Color palette (preserve existing teal/emerald primary):**

| Role | Color | Tailwind class | Usage |
|---|---|---|---|
| Primary | Teal 600 #0D9488 | `teal-600` | Main CTA, active nav, primary brand |
| Primary gradient | Teal 500 → Emerald 600 | `from-teal-500 to-emerald-600` | Hero, logo, active state |
| Accent — Social/Gifting | Fuchsia 500 / Purple 600 | `fuchsia-500` / `purple-600` | Gift cards, friend avatars, social feed |
| Accent — Rewards | Amber 500 #F59E0B | `amber-500` | Points balance, streaks, reward ring |
| Accent — Group | Indigo 500 #6366F1 | `indigo-500` | Group order bubble, share code |
| Accent — Success | Emerald 500 | `emerald-500` | Pickup complete, payment captured |
| Accent — Warning | Orange 500 | `orange-500` | Almost ready, low stock |
| Accent — Danger | Red 500 | `red-500` | Cancelled, kill switch on |
| Background | `hsl(var(--background))` | existing | Page bg |
| Card | `hsl(var(--card))` | existing | Card bg |

**Typography:**

- Font family: `Inter` (existing system default) — bold headings, readable body
- Heading scale: text-3xl (hero) / text-2xl (page) / text-xl (section) / text-lg (card title) / text-sm (label)
- Body: text-sm (default) / text-xs (caption) / text-[11px] (micro)
- Tabular numbers: `tabular-nums` on all prices + OTP codes (prevents layout shift during countdowns)

**New components (Wave 1B):**

1. `BottomNav` — mobile-first 5-tab bar (fixed bottom, 44px touch targets, active state with teal pill + icon fill, framer-motion spring on tab change)
2. `CampusSelector` — top-bar chip with dropdown bottom-sheet (search, nearby, organization code)
3. `RewardProgressRing` — circular SVG progress (amber fill, points balance in center, tier label)
4. `GiftCard` — fuchsia/purple gradient card (sender avatar, recipient avatar, message preview, redeem button, expiry countdown)
5. `SocialFeedCard` — friend avatar + verb + object card (like/comment placeholder, privacy badge)
6. `GroupOrderBubble` — indigo card (restaurant logo, member avatar stack, host crown, share CTA)
7. `PremiumToast` — sonner toast wrapper with teal accent (success) / amber (warning) / red (danger)
8. `BottomSheet` — vaul-based swipeable sheet (already have `drawer.tsx` — wrap as `BottomSheet`)
9. `RestaurantCardV2` — image + logo + name + cuisine + distance + open/closed + prep time + rating + offer + reward multiplier + popular item
10. `MenuItemCardV2` — image + name + description + price + dietary tags + reward points + customization placeholder + add button
11. `OrderTimelineV2` — estimated ready time + live status dots + restaurant contact + pickup instructions + receipt download
12. `EmptyState` — illustration (SVG) + helpful copy + CTA button
13. `SkeletonLoader` — shimmer teal placeholder (existing Skeleton enhanced with shimmer animation)
14. `PricingBreakdown` — transparent price card per blueprint §4 P4 (subtotal + tax + fee − discount − rewards = total)

**Mobile-first principles (blueprint §45):**

- 44px touch targets minimum (Apple HIG)
- Bottom sheets > modals on mobile
- Pull-to-refresh on Home + Orders + Rewards
- Sticky pay bar on Cart + Checkout
- No horizontal overflow (mobile-first grid)
- Accessibility: aria-label on icon buttons, role="status" on toasts, focus-visible rings

**Micro-interactions:**

- framer-motion `layout` on order cards (reorder without jump)
- `AnimatePresence` on cart bar (slide up from bottom)
- Spring physics on bottom-nav active indicator
- Subtle haptic-like scale (1.02) on card tap (`whileTap={{ scale: 0.98 }}`)

---

## Part 2 — Existing code reuse decisions

### 2.1 Decision legend

- **KEEP** — file aligns with blueprint; no changes needed
- **KEEP (minor)** — file works; small additive tweaks only
- **MODIFY** — partial alignment; needs extension (additive only)
- **REWRITE** — misaligned with new ideology; full rewrite
- **DO NOT TOUCH** — governance boundary (blueprint §29, §50)
- **DELETE** — cruft not needed for product

### 2.2 App pages

| File | LOC | Decision | Rationale |
|---|---|---|---|
| `src/app/page.tsx` (landing) | 175 | REWRITE | Currently shows 3 portals with demo credentials in production UI (violates blueprint §45 "no demo credentials displayed in production UI"). New version: marketing landing → "Get the app" CTA → consumer login. Demo creds only shown when `NODE_ENV !== 'production'`. |
| `src/app/consumer/page.tsx` | 53 | MODIFY | Add campus onboarding step between login and ConsumerView (route to `/onboarding/campus` if `user.campusId` is null). |
| `src/app/vendor/page.tsx` | 50 | KEEP (minor) | Already fine — login gate + role check. No changes needed. |
| `src/app/admin/page.tsx` | 40 | KEEP (minor) | Already fine — login gate + role check. No changes needed. |
| `src/app/layout.tsx` | — | KEEP | Root layout. |
| `src/app/globals.css` | — | MODIFY (additive) | Add CSS for new components (bottom-nav active pill, reward ring, gift card shimmer, group order glow, social feed avatar). Preserve all existing classes. |

### 2.3 Components (snak)

| File | LOC | Decision | Rationale |
|---|---|---|---|
| `src/components/snak/app-shell.tsx` | 81 | MODIFY | Add `BottomNav` for consumer (5-tab), top-bar `CampusSelector` chip. Vendor + admin keep simple top bar. Add notifications bell icon. |
| `src/components/snak/consumer-view.tsx` | 462 | REWRITE | Single-file approach outgrown. Split into: `HomeScreen`, `ExploreScreen`, `RestaurantDetailScreen`, `CartScreen`, `MyOrdersScreen`, `RewardsScreen`, `ProfileScreen`, `NotificationsScreen`. Reuse `bits.tsx`, `cart-store`, `snack.ts`, `OrderTracking`, `CheckoutView`. Use bottom-nav to switch screens. |
| `src/components/snak/vendor-view.tsx` | 450 | MODIFY | Already aligned with P0-06 /fulfilment route. Add: ACCEPTED button (calls new `/api/vendor/orders/[id]/accept`), prep-time setter, deal creation UI, basic analytics widget. |
| `src/components/snak/admin-view.tsx` | 361 | MODIFY | Already aligned. Add admin modules per blueprint §24: Rewards, Fraud/Risk, Support, Feature Flags. Keep Overview/Users/Vendors/Orders/Payments/Refunds/Audit modules. |
| `src/components/snak/admin-login.tsx` | 143 | KEEP | Already works (2FA flow). |
| `src/components/snak/phone-otp-login.tsx` | 220 | MODIFY | Add campus email capture step after phone OTP (first-run only). Preserve Supabase + demo mode dual path. |
| `src/components/snak/order-tracking.tsx` | 116 | MODIFY | Add: "Restaurant accepted" timeline step (driven by `Fulfilment.acceptedAt`), estimated ready time, restaurant contact button, pickup instructions card, receipt download placeholder. |
| `src/components/snak/checkout-view.tsx` | 446 | MODIFY | Add: transparent pricing breakdown (subtotal + tax + platform fee − discount − rewards = total per blueprint §12), payment method selector UI (Razorpay/UPI/card radio group — demo-mode aware), reward redemption step (apply points). Preserve the two-step (create order → pay) flow. |
| `src/components/snak/bits.tsx` | 57 | MODIFY | Add: `RewardBadge`, `GiftIcon`, `GroupIcon`, `CampusBadge`, `OpenClosedBadge`, `DistanceBadge`, `PrepTimeBadge`. Preserve existing `VegBadge`, `SpiceDots`, `StarRating`, `CuisineIcon`, `cuisineGradient`. |
| NEW: `src/components/snak/bottom-nav.tsx` | — | CREATE | Mobile-first 5-tab bar. |
| NEW: `src/components/snak/campus-selector.tsx` | — | CREATE | Top-bar chip + bottom-sheet. |
| NEW: `src/components/snak/reward-progress-ring.tsx` | — | CREATE | Circular SVG progress. |
| NEW: `src/components/snak/gift-card.tsx` | — | CREATE | Fuchsia/purple gradient gift card. |
| NEW: `src/components/snak/social-feed-card.tsx` | — | CREATE | Friend activity card. |
| NEW: `src/components/snak/group-order-bubble.tsx` | — | CREATE | Indigo group order card. |
| NEW: `src/components/snak/pricing-breakdown.tsx` | — | CREATE | Transparent price card. |
| NEW: `src/components/snak/empty-state.tsx` | — | CREATE | Illustration + helpful copy + CTA. |
| NEW: `src/components/snak/restaurant-card-v2.tsx` | — | CREATE | Upgraded restaurant card. |
| NEW: `src/components/snak/menu-item-card-v2.tsx` | — | CREATE | Upgraded menu item card. |
| NEW: `src/components/snak/order-timeline-v2.tsx` | — | CREATE | Upgraded order timeline. |
| NEW: `src/components/snak/onboarding/campus-step.tsx` | — | CREATE | First-run campus onboarding. |
| NEW: `src/components/snak/screens/home-screen.tsx` | — | CREATE | Home screen. |
| NEW: `src/components/snak/screens/explore-screen.tsx` | — | CREATE | Explore screen. |
| NEW: `src/components/snak/screens/restaurant-detail-screen.tsx` | — | CREATE | Restaurant detail. |
| NEW: `src/components/snak/screens/cart-screen.tsx` | — | CREATE | Cart screen. |
| NEW: `src/components/snak/screens/my-orders-screen.tsx` | — | CREATE | Orders + history + reorder. |
| NEW: `src/components/snak/screens/rewards-screen.tsx` | — | CREATE | Rewards tab. |
| NEW: `src/components/snak/screens/profile-screen.tsx` | — | CREATE | Profile + settings. |
| NEW: `src/components/snak/screens/notifications-screen.tsx` | — | CREATE | Notifications inbox. |
| NEW: `src/components/snak/screens/social-screen.tsx` | — | CREATE (Wave 6) | Social feed + friends. |
| NEW: `src/components/snak/screens/gifts-screen.tsx` | — | CREATE (Wave 6) | Gifts inbox + send flow. |
| NEW: `src/components/snak/screens/group-order-screen.tsx` | — | CREATE (Wave 7) | Group order detail + member carts. |

### 2.4 Lib files

| File | LOC | Decision | Rationale |
|---|---|---|---|
| `src/lib/cart-store.ts` | 67 | MODIFY | Add: `couponCode`, `rewardPointsToRedeem`, `pickupTime`, `tipAmount` fields. Expose `pricing()` method that returns the transparent breakdown per blueprint §4 P4. Preserve existing add/increment/decrement/remove/clear/total/count API. |
| `src/lib/snack.ts` | 78 | MODIFY | Add: `REWARD_MULTIPLIER_DEFAULT`, `GIFT_EXPIRY_DAYS = 30`, `GROUP_ORDER_CLOSES_HOURS = 24`, `REWARD_POINTS_PER_RUPEE = 0.1` (1 pt per ₹10). Preserve `STATUS_META`, `NEXT_STATUS`, `inr`, `spiceLabel`, `timeAgo`, `statusHistoryArray` unchanged. |
| `src/lib/types.ts` | 89 | MODIFY | Add new interfaces: `Campus`, `RewardAccount`, `RewardLedgerEntry`, `RewardRule`, `RewardRedemption`, `Gift`, `GroupOrder`, `GroupOrderMember`, `GroupOrderItem`, `SocialConnection`, `SocialActivity`, `Notification`. Add `campusId?: string` to `Restaurant`. Add `rewardMultiplier?: number` + `rewardPoints?: number` to `MenuItem`. Preserve all existing interfaces unchanged. |
| `src/lib/deployment.ts` | 134 | DO NOT TOUCH | Governance boundary — feature flags. |
| `src/lib/razorpay.ts` | — | DO NOT TOUCH | Governance boundary — E1-E9. |
| `src/lib/reconciliation.ts` | — | DO NOT TOUCH | Governance boundary — M1-M17. |
| `src/lib/pickup-attribution.ts` | — | DO NOT TOUCH | Governance boundary — P0-07, I-13. |
| `src/lib/fulfilment-state.ts` | 126 | DO NOT TOUCH | P0-06 state machine. (New additive column `Fulfilment.acceptedAt` is schema-only; does NOT modify the state machine.) |
| `src/lib/state-invariants.ts` | — | DO NOT TOUCH | P0-06 invariants. |
| `src/lib/csrf-client.ts` | — | KEEP | CSRF + idempotency-key auto-injection. Reused by all new PATCH/POST routes. |
| `src/lib/csrf.ts` | — | KEEP | Server-side CSRF. |
| `src/lib/session.ts` | — | KEEP | Session helpers. |
| `src/lib/db.ts` | — | KEEP | Prisma + withTransaction. Reused by all new routes. |
| `src/lib/idempotency.ts` | — | KEEP | Reused by all new POST routes (gifts, group-orders, rewards redeem, social). |
| `src/lib/outbox.ts` | — | KEEP | Reused by all new routes that emit events. |
| `src/lib/audit.ts` | — | KEEP | Reused. |
| `src/lib/errors.ts` | — | KEEP | Reused. |
| `src/lib/logger.ts` | — | KEEP | Reused. |
| `src/lib/otp-service.ts` | — | KEEP | Reused. |
| `src/lib/otp-lockout.ts` | — | KEEP | Reused. |
| `src/lib/realtime.ts` | — | KEEP | Reused by new emit calls. |
| `src/lib/killswitch.ts` | — | KEEP | Reused. |
| `src/lib/password.ts` | — | KEEP | Reused by admin login. |
| `src/lib/rate-limit.ts` | — | KEEP | Reused. |
| `src/lib/validation.ts` | 129 | MODIFY (additive) | Add new Zod schemas: `createGiftBodySchema`, `redeemGiftBodySchema`, `createGroupOrderBodySchema`, `joinGroupOrderBodySchema`, `addGroupOrderItemBodySchema`, `confirmGroupOrderBodySchema`, `sendFriendRequestBodySchema`, `createRewardRedemptionBodySchema`, `createCampusBodySchema`. Preserve all existing schemas. |
| `src/lib/webhook-processor.ts` | — | DO NOT TOUCH | Governance boundary. |
| `src/lib/event-consumer.ts` | — | DO NOT TOUCH | Governance boundary. |
| `src/lib/invariant-checker.ts` | — | DO NOT TOUCH | Governance boundary. |
| `src/lib/backup.ts` | — | KEEP | Reused. |
| `src/lib/alerting.ts` | — | KEEP | Reused. |
| `src/lib/supabase.ts` | — | KEEP | Reused (lazy-init pattern). |
| `src/lib/supabase-admin.ts` | — | KEEP | Reused. |
| `src/lib/utils.ts` | — | KEEP | Reused. |
| NEW: `src/lib/reward-rules.ts` | — | CREATE | Reward rule definitions + idempotency key construction helpers. |
| NEW: `src/lib/rewards-engine.ts` | — | CREATE | Server-side reward issuance + redemption logic (transactional, idempotent). |
| NEW: `src/lib/campus-store.ts` | — | CREATE | Zustand store for selected campus (persisted). |
| NEW: `src/lib/rewards-store.ts` | — | CREATE | Zustand store for reward account + recent ledger entries. |
| NEW: `src/lib/social-store.ts` | — | CREATE | Zustand store for friends list + activity feed cache. |
| NEW: `src/lib/gift-store.ts` | — | CREATE | Zustand store for gifts inbox + sent gifts. |
| NEW: `src/lib/group-order-store.ts` | — | CREATE | Zustand store for active group order + member cart. |
| NEW: `src/lib/notification-store.ts` | — | CREATE | Zustand store for notifications inbox. |

### 2.5 Hooks

| File | LOC | Decision | Rationale |
|---|---|---|---|
| `src/hooks/use-auth.tsx` | — | KEEP | Auth context. |
| `src/hooks/use-realtime.ts` | — | KEEP | Socket.io hook. Reused by new screens. |
| `src/hooks/use-mobile.ts` | — | KEEP | Mobile detection. |
| `src/hooks/use-toast.ts` | — | KEEP | Toast hook (legacy). Migrate to sonner for new components. |

### 2.6 Prisma

| File | LOC | Decision | Rationale |
|---|---|---|---|
| `prisma/schema.prisma` | 688 | MODIFY (additive only) | Add new models: Campus, RestaurantCampus, RewardAccount, RewardLedgerEntry, RewardRule, RewardRedemption, Gift, GroupOrder, GroupOrderMember, GroupOrderItem, SocialConnection, SocialActivity, Notification, MenuModifier, MenuModifierOption, Coupon, VendorDeal. Add nullable additive columns: `User.campusId String?`, `Restaurant.campusId String?`, `Fulfilment.acceptedAt DateTime?`, `Fulfilment.acceptedBy String?`, `Fulfilment.acceptedNote String?`, `MenuItem.rewardMultiplier Float? @default(1.0)`, `MenuItem.modifiers String? @default("[]")` (JSON), `User.privacySettings String? @default("{}")` (JSON), `User.shareOrderItems Boolean? @default(false)`. DO NOT modify existing fields, constraints, or indexes on existing models. |
| `prisma/seed.ts` | 255 | MODIFY (additive) | Add: campuses (IIT Bombay, IIM Bangalore, Christ University, RV College of Engineering), reward rules (EARN_BASE, FIRST_ORDER, etc.), sample gifts, sample group orders, sample social activities, sample notifications. Preserve existing users/restaurants/menus/orders/audit logs/kill switches. |
| `prisma/scripts/*` | — | DO NOT TOUCH | Existing governance migration scripts. |
| `prisma/migrations/*` | — | DO NOT TOUCH | Existing migrations (don't modify; new migration for additive changes goes in `prisma/migrations/<timestamp>_product_foundation_additive/`). |

### 2.7 API routes

| Route | LOC | Decision | Rationale |
|---|---|---|---|
| `/api/orders/route.ts` (GET/POST) | 410 | KEEP | Already aligned (creates CONFIRMED order, supports idempotency, audit, outbox). |
| `/api/orders/[id]/route.ts` (GET) | — | KEEP | Works. |
| `/api/orders/[id]/status/route.ts` (PATCH) | — | DO NOT TOUCH | Legacy status route (still used by cancel + admin). Read the existing code; do not modify. |
| `/api/orders/[id]/fulfilment/route.ts` (GET/PATCH) | 427 | DO NOT TOUCH | P0-06 governance boundary. |
| `/api/orders/[id]/pickup/verify/route.ts` (POST) | — | DO NOT TOUCH | P0-07 governance boundary. |
| `/api/payments/route.ts` (POST) | — | DO NOT TOUCH | Payment governance boundary. |
| `/api/payments/refund/route.ts` (POST) | — | DO NOT TOUCH | Payment governance boundary. |
| `/api/payments/evidence-*` | — | DO NOT TOUCH | Evidence routes. |
| `/api/webhooks/razorpay/route.ts` | — | DO NOT TOUCH | Webhook governance. |
| `/api/webhooks/evidence-*` | — | DO NOT TOUCH | Evidence routes. |
| `/api/reconciliation/*` (15 routes) | — | DO NOT TOUCH | Reconciliation governance. |
| `/api/orders/evidence-*` | — | DO NOT TOUCH | Evidence routes. |
| `/api/restaurants/route.ts` (GET) | 52 | MODIFY (additive) | Add: `campusId` query param filter, `rewardMultiplier` field in response, `open/closed` derived from hours (placeholder — defer hours-of-operation to Wave 4+), `popularItems` count. Preserve existing response shape — only ADD fields. |
| `/api/restaurants/[id]/route.ts` (GET) | — | MODIFY (additive) | Add: `rewardMultiplier`, `deals`, `popularItems`, `acceptedCampusIds`. |
| `/api/restaurants/[id]/menu/route.ts` (GET) | — | MODIFY (additive) | Add: `rewardPoints` per item (derived from `price × REWARD_POINTS_PER_RUPEE × rewardMultiplier`), `modifiers` placeholder. |
| `/api/menu/[id]/route.ts` (PATCH) | — | MODIFY (additive) | Add: `rewardMultiplier` field support. |
| `/api/admin/metrics/route.ts` (GET) | — | MODIFY (additive) | Add: rewards metrics (total points issued, redeemed, outstanding), gift metrics, group order metrics. Preserve existing metrics. |
| `/api/audit-logs/route.ts` (GET) | — | KEEP | Works. |
| `/api/kill-switches/route.ts` + `/[key]/route.ts` | — | KEEP | Works. |
| `/api/auth/*` (9 routes) | — | KEEP | Works (Supabase + demo). |
| `/api/health/route.ts` | — | KEEP | Works. |
| `/api/backup/route.ts` | — | KEEP | Works. |
| `/api/exceptions/route.ts` | — | KEEP | Works. |
| `/api/alerts/*` | — | KEEP | Works. |
| `/api/audit-integrity-test/route.ts` | — | KEEP (dev) | Test route. |
| `/api/p0-13-test/route.ts`, `/api/p0-18-test/route.ts`, `/api/p0-23-test/route.ts` | — | KEEP (dev) | Test routes. |
| `/api/test/*` | — | KEEP (dev) | Test routes. |
| NEW: `/api/campuses/route.ts` (GET/POST) | — | CREATE | List + create campuses. |
| NEW: `/api/campuses/[id]/route.ts` (GET/PATCH) | — | CREATE | Get + update campus. |
| NEW: `/api/campuses/[id]/restaurants/route.ts` (GET) | — | CREATE | Restaurants for campus. |
| NEW: `/api/rewards/account/route.ts` (GET) | — | CREATE | Current user's RewardAccount. |
| NEW: `/api/rewards/ledger/route.ts` (GET) | — | CREATE | Paginated ledger. |
| NEW: `/api/rewards/redeem/route.ts` (POST) | — | CREATE | Redeem points → returns discount code (idempotent). |
| NEW: `/api/rewards/rules/route.ts` (GET/PATCH) | — | CREATE | List rules; admin PATCH. |
| NEW: `/api/gifts/route.ts` (GET/POST) | — | CREATE | List my gifts + create gift. |
| NEW: `/api/gifts/[id]/route.ts` (GET) | — | CREATE | Gift details. |
| NEW: `/api/gifts/[id]/redeem/route.ts` (POST) | — | CREATE | Recipient redeems. |
| NEW: `/api/gifts/[id]/cancel/route.ts` (POST) | — | CREATE | Sender cancels. |
| NEW: `/api/group-orders/route.ts` (GET/POST) | — | CREATE | List + create group order. |
| NEW: `/api/group-orders/[id]/route.ts` (GET) | — | CREATE | Group order details. |
| NEW: `/api/group-orders/[id]/join/route.ts` (POST) | — | CREATE | Friend joins via share code. |
| NEW: `/api/group-orders/[id]/items/route.ts` (GET/POST) | — | CREATE | List + add items to my cart. |
| NEW: `/api/group-orders/[id]/items/[itemId]/route.ts` (PATCH/DELETE) | — | CREATE | Update my item. |
| NEW: `/api/group-orders/[id]/confirm/route.ts` (POST) | — | CREATE | Host confirms → creates single Order. |
| NEW: `/api/group-orders/[id]/cancel/route.ts` (POST) | — | CREATE | Host cancels. |
| NEW: `/api/social/connections/route.ts` (GET/POST) | — | CREATE | List connections + send friend request. |
| NEW: `/api/social/connections/[id]/route.ts` (PATCH/DELETE) | — | CREATE | Accept/reject + unfriend/block. |
| NEW: `/api/social/feed/route.ts` (GET) | — | CREATE | Paginated friend activity feed. |
| NEW: `/api/social/search/route.ts` (GET) | — | CREATE | Search users. |
| NEW: `/api/notifications/route.ts` (GET) | — | CREATE | My notifications. |
| NEW: `/api/notifications/[id]/route.ts` (PATCH) | — | CREATE | Mark read. |
| NEW: `/api/vendor/orders/[id]/accept/route.ts` (POST) | — | CREATE | Sets Fulfilment.acceptedAt + emits ORDER_ACCEPTED. (Additive — does NOT modify fulfilment state machine.) |
| NEW: `/api/vendor/menu/route.ts` (POST) | — | CREATE | Create menu item. |
| NEW: `/api/vendor/deals/route.ts` (GET/POST) | — | CREATE | List + create deals. |
| NEW: `/api/vendor/deals/[id]/route.ts` (PATCH/DELETE) | — | CREATE | Update/delete deal. |
| NEW: `/api/vendor/analytics/route.ts` (GET) | — | CREATE | Today's orders, revenue, avg prep time, low-stock. |

### 2.8 Misc

| File | Decision | Rationale |
|---|---|---|
| `next.config.ts` | KEEP | Works. |
| `tsconfig.json` | KEEP | Works. |
| `tailwind.config.ts` | KEEP | Works (uses CSS variables — extendable via globals.css). |
| `postcss.config.mjs` | KEEP | Works. |
| `eslint.config.mjs` | KEEP | Works. |
| `Caddyfile` | KEEP | Gateway config. |
| `Dockerfile` | KEEP | Build config. |
| `vercel.json` | KEEP | Deployment config. |
| `components.json` | KEEP | shadcn/ui config. |
| `mini-services/*` | KEEP | Realtime, reconciliation, invariant-checker, outbox-publisher, alert-evaluator, backup-scheduler. DO NOT TOUCH (governance boundaries). |
| `eslint-rules/no-external-call-in-transaction.js` | KEEP | Custom lint rule. |
| `scripts/*` | KEEP | Evidence scripts. |
| `tests/*` | KEEP | Runtime build tests. |
| `docs/*` | KEEP | Existing docs. |
| `public/*` | KEEP | Static assets (SVG food images, restaurant images, logo). |
| `agent-ctx/*` | KEEP | Prior context files. |
| `evidence/*` | KEEP | Evidence artifacts. |

---

## Part 3 — DB schema additions (additive only)

### 3.1 New Prisma models (appended to `prisma/schema.prisma`)

```prisma
// ============================================================================
// PRODUCT FOUNDATION — ADDITIVE MODELS (PLAN-01)
// ============================================================================
// All models below are NEW and ADDITIVE. No existing model is modified
// except for nullable additive columns listed in §3.2.
//
// Governance: blueprint §29, §50. Do not touch existing money-state tables
// (Payment, Refund, LedgerEntry, Outbox, WebhookEvent, IdempotencyKey, AuditLog)
// or fulfilment state machine (Fulfilment.status enum).
// ============================================================================

// ---------------------------------------------------------------------------
// Campus context (blueprint §40)
// ---------------------------------------------------------------------------
model Campus {
  id          String   @id @default(cuid())
  name        String   @unique
  shortName   String?  // e.g. "IIT-B"
  domain      String?  @unique // email suffix e.g. "iitb.ac.in"
  city        String
  state       String
  pincode     String?
  latitude    Float?
  longitude   Float?
  isActive    Boolean  @default(true)
  // JSON: { defaultCurrency, commissionRate, mealPlanEnabled, studentDiscountPercent }
  settings    String   @default("{}")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users       User[]
  restaurantCampuses RestaurantCampus[]

  @@index([city, state])
  @@index([isActive])
}

// Many-to-many junction: a restaurant can serve multiple campuses
// (e.g., a chain with 5 outlets near 3 campuses).
model RestaurantCampus {
  id           String   @id @default(cuid())
  restaurantId String
  campusId     String
  isPrimary    Boolean  @default(false)
  createdAt    DateTime @default(now())

  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  campus       Campus     @relation(fields: [campusId], references: [id], onDelete: Cascade)

  @@unique([restaurantId, campusId])
  @@index([campusId])
}

// ---------------------------------------------------------------------------
// Rewards context (blueprint §17)
// ---------------------------------------------------------------------------
model RewardAccount {
  id              String   @id @default(cuid())
  userId          String   @unique
  // Balance is DERIVED from RewardLedgerEntry sum, but cached here for fast reads.
  // Refreshed after every ledger mutation inside the same transaction.
  balance         Int      @default(0) // points (positive integer)
  lifetimeEarned  Int      @default(0) // points (sum of all EARN entries)
  lifetimeRedeemed Int     @default(0) // points (sum of all REDEEM entries, positive number)
  updatedAt       DateTime @updatedAt

  ledgerEntries   RewardLedgerEntry[]

  @@index([userId])
}

model RewardRule {
  id            String   @id @default(cuid())
  key           String   @unique // e.g. "EARN_BASE", "FIRST_ORDER", "STREAK_3"
  name          String
  description   String?
  // JSON formula spec — interpreted by src/lib/rewards-engine.ts:
  //   { "type": "perRupee", "rate": 0.1 } — 1 pt per ₹10
  //   { "type": "fixed", "points": 50 }
  //   { "type": "multiplier", "multiplier": 2 } — doubles base earn
  pointsFormula  String
  isActive      Boolean  @default(true)
  // Optional window for time-bound rules (e.g., campus event)
  startsAt      DateTime?
  endsAt        DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  ledgerEntries RewardLedgerEntry[]
  redemptions   RewardRedemption[]

  @@index([isActive])
}

model RewardLedgerEntry {
  id             String   @id @default(cuid())
  userId         String
  // EARN (positive) | REDEEM (negative) | EXPIRE (negative) | ADJUST (±)
  type           String
  points         Int      // signed: + for EARN, - for REDEEM/EXPIRE
  // Optional context — set depending on rule type
  orderId        String?
  ruleId         String?
  rule           RewardRule? @relation(fields: [ruleId], references: [id])
  giftId         String?
  groupOrderId   String?
  referralUserId String? // for REFERRAL rule — the referee userId
  // Idempotency: one entry per (userId, idempotencyKey). Constructed as
  // `${ruleKey}:${eventId}` by src/lib/rewards-engine.ts.
  idempotencyKey String   @unique
  // Optional expiry (EARN entries only) — when this timestamp passes,
  // a cron job creates a matching EXPIRE entry.
  expiresAt      DateTime?
  createdAt      DateTime @default(now())

  account        RewardAccount @relation(fields: [userId], references: [userId])
  redemptions    RewardRedemption[]

  @@index([userId, createdAt])
  @@index([type, createdAt])
  @@index([orderId])
  @@index([ruleId])
}

model RewardRedemption {
  id            String   @id @default(cuid())
  userId        String
  ledgerEntryId String   @unique // the REDEEM ledger entry (1:1)
  ledgerEntry   RewardLedgerEntry @relation(fields: [ledgerEntryId], references: [id])
  // PERCENT_DISCOUNT | FIXED_DISCOUNT | FREE_ITEM | VENDOR_SPECIFIC
  rewardType    String
  // For PERCENT_DISCOUNT: percent value (e.g., 5 = 5% off)
  // For FIXED_DISCOUNT: paise amount (e.g., 2000 = ₹20 off)
  // For FREE_ITEM: menuItemId
  // For VENDOR_SPECIFIC: dealId
  discountValue String
  // If redeemed against an order, the orderId; else null (generic redemption code)
  orderId       String?
  // Generated redemption code (e.g., "SNZ-RWD-AB12CD") — single-use
  redemptionCode String @unique
  redeemedAt    DateTime @default(now())

  rule          RewardRule? @relation(fields: [ruleRuleId], references: [id])
  ruleRuleId    String?

  @@index([userId, redeemedAt])
  @@index([orderId])
}

// ---------------------------------------------------------------------------
// Gift context (blueprint §19)
// ---------------------------------------------------------------------------
model Gift {
  id             String   @id @default(cuid())
  senderId       String
  recipientId    String
  menuItemId     String
  menuItem       MenuItem @relation(fields: [menuItemId], references: [id])
  // Snapshot at creation time (price + name — protects against later menu edits)
  menuItemName   String
  menuItemPrice  Int      // paise
  message        String?
  // CREATED → PAID → AVAILABLE → REDEEMED | EXPIRED | CANCELLED | REFUNDED
  status         String   @default("CREATED")
  // Single-use code the recipient uses to redeem
  redemptionCode String   @unique
  // 30-day default expiry (set when status → AVAILABLE)
  expiresAt      DateTime
  // Payment linkage (sender's payment)
  paymentId      String?
  // Recipient's order (set when recipient redeems)
  recipientOrderId String?
  // Lifecycle timestamps
  paidAt         DateTime?
  availableAt    DateTime?
  redeemedAt     DateTime?
  cancelledAt    DateTime?
  refundedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([senderId, createdAt])
  @@index([recipientId, status])
  @@index([status, expiresAt])
}

// ---------------------------------------------------------------------------
// Group ordering context (blueprint §20 — Model A: host pays)
// ---------------------------------------------------------------------------
model GroupOrder {
  id            String   @id @default(cuid())
  hostId        String
  restaurantId  String
  restaurant    Restaurant @relation(fields: [restaurantId], references: [id])
  // OPEN (members joining) | CONFIRMED (host confirmed + paid) | CLOSED (auto-closed) | CANCELLED
  status        String   @default("OPEN")
  // 6-character human-readable share code (e.g., "AB12CD")
  shareCode     String   @unique
  // Auto-close time (default createdAt + 24h)
  closesAt      DateTime
  // Host's confirmation
  confirmedAt   DateTime?
  // The single Order created on confirm
  confirmedOrderId String?
  // Group name (optional — e.g., "Tuesday lunch")
  name          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  members       GroupOrderMember[]
  items         GroupOrderItem[]

  @@index([hostId, status])
  @@index([restaurantId, status])
  @@index([status, closesAt])
}

model GroupOrderMember {
  id            String   @id @default(cuid())
  groupOrderId  String
  groupOrder    GroupOrder @relation(fields: [groupOrderId], references: [id], onDelete: Cascade)
  userId        String
  joinedAt      DateTime @default(now())

  items         GroupOrderItem[]

  @@unique([groupOrderId, userId])
  @@index([userId])
}

model GroupOrderItem {
  id            String   @id @default(cuid())
  groupOrderId  String
  groupOrder    GroupOrder @relation(fields: [groupOrderId], references: [id], onDelete: Cascade)
  userId        String
  member        GroupOrderMember @relation(fields: [groupOrderId, userId], references: [groupOrderId, userId])
  menuItemId    String
  menuItem      MenuItem @relation(fields: [menuItemId], references: [id])
  name          String   // snapshot
  price         Int      // paise snapshot
  quantity      Int      @default(1)
  addedAt       DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([groupOrderId, userId])
  @@index([menuItemId])
}

// ---------------------------------------------------------------------------
// Social context (blueprint §18)
// ---------------------------------------------------------------------------
model SocialConnection {
  id            String   @id @default(cuid())
  followerId    String   // the user who initiated
  followeeId    String   // the user being followed
  // PENDING (request sent) | ACCEPTED | REJECTED | BLOCKED
  status        String   @default("PENDING")
  requestedAt   DateTime @default(now())
  acceptedAt    DateTime?
  // Optional message with friend request
  message       String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([followerId, followeeId])
  @@index([followeeId, status])
  @@index([followerId, status])
}

model SocialActivity {
  id            String   @id @default(cuid())
  actorId       String   // the user who performed the action
  // ORDERED | ORDERED_ITEM | GIFTED | GROUP_ORDERED | REWARDED | REDEEMED
  verb          String
  // Restaurant | MenuItem | Gift | GroupOrder | RewardLedgerEntry | RewardRedemption
  objectType   String
  objectId      String
  // JSON metadata — NEVER includes payment amount
  // e.g., { restaurantName, itemName?, recipientName? }
  metadata      String   @default("{}")
  // FRIENDS (default) | PUBLIC | PRIVATE
  visibility    String   @default("FRIENDS")
  createdAt     DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([createdAt])
  @@index([verb, createdAt])
}

// ---------------------------------------------------------------------------
// Notification context
// ---------------------------------------------------------------------------
model Notification {
  id            String   @id @default(cuid())
  userId        String   // recipient
  // ORDER_READY | GIFT_RECEIVED | GIFT_REDEEMED | FRIEND_REQUEST | GROUP_ORDER_INVITE | REWARD_EARNED | REWARD_EXPIRING | ORDER_ACCEPTED | SYSTEM
  type          String
  title         String
  body          String
  // JSON: deep link + action buttons + context
  data          String   @default("{}")
  readAt        DateTime?
  createdAt     DateTime @default(now())

  @@index([userId, readAt])
  @@index([type, createdAt])
}

// ---------------------------------------------------------------------------
// Menu modifiers (blueprint §11, §23 — future-ready, additive)
// ---------------------------------------------------------------------------
model MenuModifier {
  id            String   @id @default(cuid())
  menuItemId    String
  menuItem      MenuItem  @relation(fields: [menuItemId], references: [id], onDelete: Cascade)
  name          String   // e.g., "Spice Level", "Size", "Extra Toppings"
  // SINGLE | MULTIPLE
  selectionType String   @default("SINGLE")
  isRequired    Boolean  @default(false)
  sortOrder     Int      @default(0)
  createdAt     DateTime @default(now())

  options       MenuModifierOption[]

  @@index([menuItemId])
}

model MenuModifierOption {
  id            String   @id @default(cuid())
  modifierId    String
  modifier      MenuModifier @relation(fields: [modifierId], references: [id], onDelete: Cascade)
  name          String   // e.g., "Medium", "Large +₹20", "Extra Cheese +₹30"
  priceDelta    Int      @default(0) // paise — added to base price
  isDefault     Boolean  @default(false)
  sortOrder     Int      @default(0)
  createdAt     DateTime @default(now())

  @@index([modifierId])
}

// ---------------------------------------------------------------------------
// Coupons + vendor deals (blueprint §23)
// ---------------------------------------------------------------------------
model Coupon {
  id            String   @id @default(cuid())
  code          String   @unique // e.g., "WELCOME50"
  description   String?
  // PERCENT | FIXED | FREE_ITEM
  discountType  String
  // For PERCENT: 5 = 5% off; for FIXED: 2000 = ₹20 off; for FREE_ITEM: menuItemId
  discountValue String
  // Min cart total in paise to qualify
  minOrderValue Int      @default(0)
  maxDiscount   Int?     // paise — cap for PERCENT
  // Usage limits
  maxRedemptions Int?    // null = unlimited
  currentRedemptions Int @default(0)
  // Validity window
  startsAt      DateTime
  endsAt        DateTime
  isActive      Boolean  @default(true)
  // Optional restaurant restriction (null = any restaurant)
  restaurantId  String?
  createdAt      DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([isActive, startsAt, endsAt])
  @@index([code])
}

model VendorDeal {
  id            String   @id @default(cuid())
  restaurantId  String
  restaurant    Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  title         String   // e.g., "20% off all desserts"
  description   String?
  // PERCENT | FIXED | FREE_ITEM | REWARD_MULTIPLIER
  dealType      String
  dealValue     String   // e.g., "20" (percent), "500" (paise), menuItemId, or "2.0" (multiplier)
  // Optional menu item scope (null = whole menu)
  menuItemId    String?
  // Validity window
  startsAt      DateTime
  endsAt        DateTime
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([restaurantId, isActive])
  @@index([isActive, startsAt, endsAt])
}

// ---------------------------------------------------------------------------
// Reserved for future: MealPlan (blueprint §21) — schema only, no implementation
// ---------------------------------------------------------------------------
model MealPlan {
  id            String   @id @default(cuid())
  // The user funding the plan (parent/guardian)
  sponsorId     String
  // The student whose food budget this funds
  studentId     String
  campusId      String?
  // Daily / weekly / monthly limits in paise
  dailyLimit    Int      @default(0)
  weeklyLimit   Int      @default(0)
  monthlyLimit  Int      @default(0)
  // Restriction JSON: { allowedRestaurantIds, allowedCategories, blockedItems }
  merchantRestrictions String @default("{}")
  // Validity window
  startsAt      DateTime
  endsAt        DateTime?
  isActive      Boolean  @default(true)
  // Balance tracking (derived from ledger; cached for fast reads)
  balanceToday  Int      @default(0)
  balanceThisWeek Int    @default(0)
  balanceThisMonth Int  @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([studentId, isActive])
  @@index([sponsorId])
}
```

### 3.2 Additive columns on EXISTING models (strictly backward-compatible)

```prisma
// ----------------------------------------------------------------------------
// ADDITIVE COLUMNS ON EXISTING MODELS (PLAN-01)
// ----------------------------------------------------------------------------
// All columns below are NULLABLE with sensible defaults, so existing rows
// remain valid without backfill. No existing column is modified or removed.
// No existing constraint or index is altered.
// ----------------------------------------------------------------------------

model User {
  // ... existing fields ...
  // NEW: campus linkage (nullable for backward compat)
  campusId         String?
  campus           Campus?  @relation(fields: [campusId], references: [id])
  // NEW: privacy settings (JSON — defaults to "{}")
  privacySettings  String   @default("{}")
  // NEW: opt-in to share order items in social feed
  shareOrderItems  Boolean  @default(false)
  // NEW: avatar URL (for social feed rendering)
  avatarUrl        String?
  // NEW: referral code (for REFERRAL reward rule)
  referralCode     String?  @unique
  // NEW: referred by (the referrer's userId, set at signup)
  referredById     String?
}

model Restaurant {
  // ... existing fields ...
  // NEW: primary campus (nullable for backward compat — existing restaurants have no campus yet)
  campusId         String?
  campus           Campus?  @relation(fields: [campusId], references: [id])
  restaurantCampuses RestaurantCampus[]
  vendorDeals      VendorDeal[]
  groupOrders      GroupOrder[]
}

model MenuItem {
  // ... existing fields ...
  // NEW: reward multiplier (1.0 = standard; 2.0 = double points during deals)
  rewardMultiplier Float    @default(1.0)
  // NEW: optional modifiers JSON (cached for fast read; canonical source = MenuModifier table)
  // When null or empty array, the item has no modifiers.
  modifiers        String?  @default("[]")
  // NEW: relations
  menuModifiers    MenuModifier[]
  gifts            Gift[]
  groupOrderItems  GroupOrderItem[]
}

model Order {
  // ... existing fields ...
  // NEW: gift linkage (nullable — set when this order was created as a gift redemption)
  giftId           String?
}

model Fulfilment {
  // ... existing fields ...
  // NEW: vendor acceptance timestamp (additive — does NOT modify status state machine)
  // Set by POST /api/vendor/orders/[id]/accept. The status enum remains
  // PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP (P0-06 boundary preserved).
  acceptedAt       DateTime?
  acceptedBy       String?
  acceptedNote     String?
}
```

### 3.3 Migration strategy

**Create a new additive migration:**

```
prisma/migrations/<timestamp>_product_foundation_additive/migration.sql
```

- All `CREATE TABLE` statements for new models.
- All `ALTER TABLE ... ADD COLUMN` statements for additive columns (nullable, with defaults so existing rows are valid).
- All `CREATE INDEX` statements for new indexes.
- DO NOT include any `DROP` or `ALTER TABLE ... MODIFY COLUMN` (which would trip governance).

**Apply via:** `bun run db:migrate --name product_foundation_additive`

(P0-15 governance: `db:push` is disabled — `bun run db:push` returns exit 1. Use `db:migrate` only.)

### 3.4 Seed additions

Add to `prisma/seed.ts` (additive — preserve existing seed):

- **4 campuses**: IIT Bombay (`iitb.ac.in`, Mumbai, MH), IIM Bangalore (`iimb.ac.in`, Bengaluru, KA), Christ University (`christuniversity.in`, Bengaluru, KA), RV College of Engineering (`rvce.edu.in`, Bengaluru, KA).
- **Campus-restaurant links**: link the 4 existing restaurants to nearby campuses via `RestaurantCampus`.
- **11 reward rules**: EARN_BASE, FIRST_ORDER, SECOND_ORDER, STREAK_3, STREAK_7, REFERRAL, OFF_PEAK, GROUP_ORDER, GIFT_SENT, GIFT_RECEIVED, CAMPUS_EVENT.
- **Sample rewards**: Aarav (consumer) has a RewardAccount with balance=150 points + 3 EARN ledger entries (FIRST_ORDER +50, EARN_BASE +75, OFF_PEAK +25).
- **Sample gifts**: 1 PAID gift from Aarav → another demo user (CREATED + 1 REDEEMED gift).
- **Sample group order**: 1 OPEN group order hosted by Aarav at Dosa Den with 2 members.
- **Sample social activities**: 5 SocialActivity rows for Aarav (ORDERED, REWARDED, REDEEMED, GIFTED, GROUP_ORDERED).
- **Sample notifications**: 3 Notification rows for Aarav (ORDER_READY, GIFT_RECEIVED, REWARD_EARNED).

---

## Part 4 — Wave-by-wave subagent task breakdown

Each task below has: **scope** (what to do), **files to create/modify**, **governance boundaries** (what NOT to touch), **acceptance criteria**, **dependencies** (prior waves that must complete first).

### Wave 1 — Foundation (3 parallel tasks)

#### Task 1A — DB schema additions + migration + seed

**Scope:**
- Append all new Prisma models from Part 3.1 to `prisma/schema.prisma`.
- Append additive columns from Part 3.2 to existing models in `prisma/schema.prisma`.
- Create new migration `prisma/migrations/<timestamp>_product_foundation_additive/migration.sql`.
- Extend `prisma/seed.ts` with campuses, reward rules, sample rewards, gifts, group orders, social activities, notifications.
- Run `bun run db:migrate --name product_foundation_additive` to apply.
- Run `bun run db:reset && bun run prisma/seed.ts` to reseed.

**Files to create:**
- `prisma/migrations/<timestamp>_product_foundation_additive/migration.sql`
- `prisma/migrations/<timestamp>_product_foundation_additive/migration.toml` (lock file)

**Files to modify (additive only):**
- `prisma/schema.prisma` (append new models + additive nullable columns on existing models)
- `prisma/seed.ts` (append new seed data; preserve existing)

**Governance boundaries:**
- DO NOT touch any existing model's existing fields, constraints, or indexes.
- DO NOT touch `prisma/migrations/20260809183236_initial_schema/` or `prisma/migrations/20260809185723_audit_hash_chain/`.
- DO NOT modify `prisma/scripts/*` (existing governance migration scripts).
- DO NOT enable `bun run db:push` (P0-15 disabled — use `db:migrate`).
- DO NOT touch `src/lib/deployment.ts` (feature flags).
- DO NOT activate any feature flag.

**Acceptance criteria:**
- [ ] `bun run db:generate` exits 0.
- [ ] `bun run db:migrate --name product_foundation_additive` creates + applies the migration cleanly.
- [ ] `bun run db:reset && bun run prisma/seed.ts` exits 0 with all seed data inserted.
- [ ] All existing API routes still work (smoke-test `GET /api/restaurants` returns 200).
- [ ] No existing model's existing columns are modified — verified via migration diff (only `ADD COLUMN` + `CREATE TABLE` + `CREATE INDEX`).
- [ ] TypeScript compilation: `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in modified files (existing 171 errors in protected files are out of scope).

**Dependencies:** None — this is Wave 1's foundation task; all other Wave 1 tasks can run in parallel.

---

#### Task 1B — Design system upgrade (premium UI components)

**Scope:**
- Build the 14 new components listed in Part 1.I.
- Add CSS for new components to `src/app/globals.css` (additive — preserve existing).
- Use existing shadcn/ui primitives where possible (Card, Button, Badge, Avatar, Progress, Drawer/Sheet).
- Use framer-motion for micro-interactions (already installed).
- Use lucide-react icons (already installed).
- Use sonner for premium toasts (already installed).
- All components must be mobile-first (44px touch targets, bottom-sheet patterns, no horizontal overflow).
- All components must have loading + empty + error states (blueprint §45).

**Files to create:**
- `src/components/snak/bottom-nav.tsx`
- `src/components/snak/campus-selector.tsx`
- `src/components/snak/reward-progress-ring.tsx`
- `src/components/snak/gift-card.tsx`
- `src/components/snak/social-feed-card.tsx`
- `src/components/snak/group-order-bubble.tsx`
- `src/components/snak/pricing-breakdown.tsx`
- `src/components/snak/empty-state.tsx`
- `src/components/snak/restaurant-card-v2.tsx`
- `src/components/snak/menu-item-card-v2.tsx`
- `src/components/snak/order-timeline-v2.tsx`
- `src/components/snak/premium-toast.tsx` (sonner wrapper)
- `src/components/snak/skeleton-loader.tsx` (shimmer variant of existing Skeleton)

**Files to modify (additive only):**
- `src/app/globals.css` (append CSS for new components — preserve existing)
- `src/components/snak/bits.tsx` (append new badges: `RewardBadge`, `GiftIcon`, `GroupIcon`, `CampusBadge`, `OpenClosedBadge`, `DistanceBadge`, `PrepTimeBadge`)
- `src/lib/snack.ts` (append constants: `REWARD_MULTIPLIER_DEFAULT`, `GIFT_EXPIRY_DAYS`, `GROUP_ORDER_CLOSES_HOURS`, `REWARD_POINTS_PER_RUPEE` — preserve existing exports)
- `src/lib/types.ts` (append new interfaces from Part 2 — preserve existing)

**Governance boundaries:**
- DO NOT touch `src/lib/deployment.ts`.
- DO NOT touch `tailwind.config.ts` (use existing CSS variables + Tailwind classes).
- DO NOT modify any API route.
- DO NOT touch `prisma/schema.prisma` (Task 1A owns schema).
- DO NOT touch existing components (`consumer-view.tsx`, `vendor-view.tsx`, etc.) — they're rewritten in Wave 2/3.

**Acceptance criteria:**
- [ ] All 13 new component files exist and export the named component.
- [ ] Each component renders without error in isolation (smoke-test via a temp demo page or storybook-style imports).
- [ ] `bun run lint` exits 0 on all new files.
- [ ] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in new files.
- [ ] Mobile-first: each component renders correctly at 375px viewport width.
- [ ] Accessibility: aria-labels on icon-only buttons, role="status" on toasts, focus-visible rings.
- [ ] Dark mode: each component renders correctly in dark mode (uses CSS variables, not hardcoded colors).
- [ ] Reuses existing primitives: ≥ 70% of new components use shadcn/ui Card/Button/Badge/Avatar/Progress/Sheet.

**Dependencies:** None — runs in parallel with 1A + 1C.

---

#### Task 1C — Shared types + Zustand stores

**Scope:**
- Build 6 new Zustand stores for the new product surfaces.
- All stores use `persist` middleware (local storage) where appropriate.
- All stores expose loading + error states.
- All stores integrate with the new API routes (defined in Wave 2+).

**Files to create:**
- `src/lib/campus-store.ts` (selectedCampusId, selectedCampusName, setCampus, clearCampus — persisted)
- `src/lib/rewards-store.ts` (account, recentLedger, isLoading, error, refresh, redeem)
- `src/lib/social-store.ts` (connections, feed, isLoading, error, refresh, sendRequest, acceptRequest)
- `src/lib/gift-store.ts` (sentGifts, receivedGifts, isLoading, error, refresh, createGift, redeemGift)
- `src/lib/group-order-store.ts` (activeGroupOrder, members, myItems, isLoading, error, refresh, join, addItem, confirm)
- `src/lib/notification-store.ts` (notifications, unreadCount, isLoading, refresh, markRead)
- `src/lib/reward-rules.ts` (server-side rule definitions + idempotency-key construction helpers — pure functions, no state)
- `src/lib/rewards-engine.ts` (server-side reward issuance + redemption logic — transactional, idempotent; called by `/api/rewards/redeem` + by fulfillment-webhook-equivalent that fires on PICKED_UP)

**Files to modify (additive only):**
- `src/lib/cart-store.ts` (add `couponCode`, `rewardPointsToRedeem`, `pickupTime`, `tipAmount` fields + `pricing()` method — preserve existing API)
- `src/lib/validation.ts` (append new Zod schemas from Part 2 — preserve existing)

**Governance boundaries:**
- DO NOT touch `src/lib/deployment.ts`.
- DO NOT touch `src/lib/razorpay.ts`, `src/lib/reconciliation.ts`, `src/lib/pickup-attribution.ts`, `src/lib/fulfilment-state.ts`, `src/lib/state-invariants.ts`, `src/lib/webhook-processor.ts`, `src/lib/event-consumer.ts`, `src/lib/invariant-checker.ts`.
- DO NOT touch any existing API route.
- DO NOT touch `prisma/schema.prisma` (Task 1A owns schema).
- DO NOT modify existing Zustand stores or hooks.

**Acceptance criteria:**
- [ ] All 8 new lib files exist and export the named symbols.
- [ ] Each Zustand store has TypeScript types for state + actions.
- [ ] `bun run lint` exits 0 on all new files.
- [ ] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in new files.
- [ ] Stores handle SSR (no `window`/`localStorage` access at module load — guarded via `typeof window !== 'undefined'`).
- [ ] `cart-store.pricing()` returns: `{ subtotal, tax, platformFee, discount, rewardDiscount, tip, total }` per blueprint §4 P4.

**Dependencies:** None — runs in parallel with 1A + 1B. (Type interfaces in `types.ts` are owned by Task 1B.)

---

### Wave 2 — Consumer MVP completion (4 parallel tasks; depends on Wave 1)

#### Task 2A — Campus selection onboarding flow + campus selector

**Scope:**
- Build first-run campus onboarding screen (shown after phone OTP if `user.campusId` is null).
- Build top-bar campus selector chip in app-shell (always editable).
- Build `/onboarding/campus` route.

**Files to create:**
- `src/components/snak/onboarding/campus-step.tsx`
- `src/app/onboarding/campus/page.tsx`
- `src/app/api/campuses/route.ts` (GET — list + search campuses)
- `src/app/api/campuses/[id]/route.ts` (GET — single campus)
- `src/app/api/campuses/[id]/restaurants/route.ts` (GET — restaurants for campus)
- `src/app/api/auth/me/route.ts` (MODIFY additive — return `campusId` in user response)

**Files to modify (additive only):**
- `src/app/consumer/page.tsx` (redirect to `/onboarding/campus` if `user.campusId` is null)
- `src/components/snak/app-shell.tsx` (add `CampusSelector` chip in header for consumer persona)
- `src/components/snak/phone-otp-login.tsx` (after OTP verify, if `user.campusId` is null, navigate to `/onboarding/campus`)

**Governance boundaries:**
- DO NOT touch `src/app/api/auth/otp/send/route.ts` or `src/app/api/auth/otp/verify/route.ts` (existing auth routes — READ only).
- DO NOT touch `src/lib/supabase.ts` or `src/lib/supabase-admin.ts`.
- DO NOT touch any payment/fulfilment/pickup route.

**Acceptance criteria:**
- [ ] First-time consumer login → redirected to campus onboarding → selects campus → lands on Home.
- [ ] Returning consumer login with `campusId` set → goes straight to Home.
- [ ] Campus selector chip in app-shell header → tap opens bottom-sheet → can switch campus → Home refreshes.
- [ ] `GET /api/campuses?q=` returns matching campuses by name/city/domain.
- [ ] `GET /api/campuses/[id]/restaurants` returns restaurants linked to that campus.
- [ ] Lint + tsc clean on all new/modified files.

**Dependencies:** Wave 1 (1A: schema; 1B: campus-selector component; 1C: campus-store).

---

#### Task 2B — Home screen redesign

**Scope:**
- Build the new Home screen per blueprint §9 (campus selector, search, quick reorder, open now, popular near you, deals, rewards progress, friends ordering nearby, gift CTA, group order CTA, recently ordered).
- Wire to existing + new API routes.

**Files to create:**
- `src/components/snak/screens/home-screen.tsx`

**Files to modify (additive only):**
- `src/components/snak/consumer-view.tsx` (rewrite to use new screen architecture — split into multiple screens with bottom-nav routing; OR use as the host component that switches between new screen components based on active tab)
- `src/components/snak/app-shell.tsx` (add `BottomNav` for consumer)

**Governance boundaries:**
- DO NOT touch any API route.
- DO NOT touch `src/lib/cart-store.ts`'s existing API (Task 1C owns additive extension).
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Home screen renders: campus selector chip, search bar, "Quick Reorder" carousel, "Open Now" grid, "Popular Near You" grid, "Deals" carousel, "Rewards Progress" card (with `RewardProgressRing`), "Friends Ordering Nearby" card (only if user has friends with active orders), "Gift a Friend" CTA, "Start Group Order" CTA, "Recently Ordered" list.
- [ ] Each card uses the new `RestaurantCardV2` from Task 1B.
- [ ] Pull-to-refresh on Home (mobile gesture).
- [ ] Loading skeletons (`SkeletonLoader`), empty state (`EmptyState`), error state.
- [ ] Tapping a restaurant → navigates to Restaurant Detail screen.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: schema; 1B: components; 1C: stores); Task 2A (campus selector).

---

#### Task 2C — Restaurant discovery redesign (Explore screen)

**Scope:**
- Build the new Explore screen with filters per blueprint §10 (open now, pickup time, price, cuisine, vegetarian, vegan, halal, offers, campus, rating).
- Wire to existing `/api/restaurants` route (additively extended with campusId filter).

**Files to create:**
- `src/components/snak/screens/explore-screen.tsx`

**Files to modify (additive only):**
- `src/app/api/restaurants/route.ts` (add `campusId` query param + `rewardMultiplier` field in response — preserve existing fields)
- `src/app/api/restaurants/[id]/route.ts` (add `rewardMultiplier`, `deals`, `popularItems` — preserve existing fields)
- `src/app/api/restaurants/[id]/menu/route.ts` (add `rewardPoints` per item derived from `price × REWARD_POINTS_PER_RUPEE × rewardMultiplier`, `modifiers` placeholder)

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/*`, `src/app/api/payments/*`, `src/app/api/webhooks/*`, `src/app/api/reconciliation/*`.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Explore screen renders: search bar + filter chips (open now, veg, cuisine dropdown, price range, campus, offers, rating ≥ 4.0).
- [ ] Restaurant cards use `RestaurantCardV2` with all blueprint §10 fields (logo, name, cuisine, distance, open/closed, prep time, rating, offer, reward multiplier, popular item).
- [ ] Filters update results in real-time (debounced search, 250ms).
- [ ] `GET /api/restaurants?campusId=X` returns restaurants linked to campus X.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: schema with RestaurantCampus junction; 1B: restaurant-card-v2); Task 2A (campus context).

---

#### Task 2D — Restaurant detail + menu redesign

**Scope:**
- Build the new Restaurant Detail screen per blueprint §11 (header, pickup estimate, deals, categories, menu, popular items, reviews placeholder).
- Build the new Menu Item Card with reward points display.

**Files to create:**
- `src/components/snak/screens/restaurant-detail-screen.tsx`

**Files to modify (additive only):**
- `src/components/snak/consumer-view.tsx` (route to new screen when restaurant is selected)

**Governance boundaries:**
- DO NOT touch any API route that handles orders/payments/fulfilment.
- DO NOT touch `src/lib/cart-store.ts`'s existing API.

**Acceptance criteria:**
- [ ] Restaurant detail screen renders: hero with image + name + cuisine + rating + prep time + address + distance, "Deals" section (if any), categories sidebar/tabs, menu grouped by category, popular items carousel, reviews placeholder ("Reviews coming soon").
- [ ] Menu item cards use `MenuItemCardV2` with image, name, description, price, dietary tags, reward points (computed as `price × 0.1 × rewardMultiplier` rounded down), add button.
- [ ] Adding item to cart → cart bar slides up from bottom (AnimatePresence).
- [ ] Tapping "Proceed to Checkout" → navigates to Cart screen.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: menu-item-card-v2); Task 2C (restaurant discovery for navigation).

---

### Wave 3 — Order lifecycle completion (4 parallel tasks; depends on Wave 2)

#### Task 3A — Cart redesign

**Scope:**
- Build the new Cart screen per blueprint §12 (items, quantity, modifiers, subtotal, taxes, fees, discount, rewards applied, final total, pickup location, pickup estimate, restaurant prep time).
- Use the `cart-store.pricing()` method from Task 1C for transparent breakdown.

**Files to create:**
- `src/components/snak/screens/cart-screen.tsx`

**Files to modify (additive only):**
- `src/components/snak/consumer-view.tsx` (route to Cart screen when "Proceed to Checkout" tapped from menu)

**Governance boundaries:**
- DO NOT touch any API route (cart is client-side state; no API yet).
- DO NOT touch `src/lib/cart-store.ts`'s existing API (Task 1C owns additive extension).
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Cart screen renders: restaurant banner, cart lines with quantity controls + remove + edit modifiers (placeholder), `PricingBreakdown` card with subtotal + tax (5% GST) + platform fee (₹5) − discount − reward points applied + tip (optional) = total, pickup location card, pickup estimate, prep time.
- [ ] Apply coupon: input field → validates against `/api/coupons/validate` (deferred to Wave 5) → applies discount.
- [ ] Apply rewards: tap "Apply X points" → deducts from total (1 point = ₹0.10).
- [ ] Empty cart state: illustration + "Browse restaurants" CTA.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: pricing-breakdown component; 1C: cart-store.pricing()); Wave 2 (Task 2D: navigation from restaurant detail).

---

#### Task 3B — Checkout redesign

**Scope:**
- Redesign `checkout-view.tsx` to add transparent pricing breakdown + payment method selector + reward redemption step.

**Files to modify:**
- `src/components/snak/checkout-view.tsx` (rewrite with new design — preserve the two-step POST /api/orders → POST /api/payments flow)

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/route.ts` (POST) — existing order creation works.
- DO NOT touch `src/app/api/payments/route.ts` (POST) — payment governance boundary.
- DO NOT touch `src/lib/razorpay.ts`.
- DO NOT modify the demo-mode payment synthesis (pay_demo_<ts> + sig_demo_<ts>).
- DO NOT activate `realPayments` flag.

**Acceptance criteria:**
- [ ] Checkout screen renders: restaurant banner, order summary, `PricingBreakdown` (subtotal + tax + platform fee − discount − rewards = total), pickup details (name + phone + note), payment method selector (Razorpay / UPI / Card radio group — demo-mode aware, all show "Demo Mode" banner when `realPayments` flag is OFF).
- [ ] Pay button: shows `Pay ₹X` (transparent total).
- [ ] Two-step flow preserved: POST /api/orders → POST /api/payments → GET /api/orders/[id].
- [ ] Error handling: order-creation failure → toast + stay on checkout; payment failure → cart cleared + transition to tracking with CONFIRMED order + destructive toast.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: pricing-breakdown; 1C: cart-store.pricing); Wave 3 (Task 3A: cart).

---

#### Task 3C — Order tracking redesign

**Scope:**
- Redesign `order-tracking.tsx` to add: "Restaurant Accepted" timeline step (driven by `Fulfilment.acceptedAt`), estimated ready time, restaurant contact button, pickup instructions card, receipt download placeholder.

**Files to modify:**
- `src/components/snak/order-tracking.tsx` (rewrite as `OrderTimelineV2` from Task 1B — but actually keep `order-tracking.tsx` file name + upgrade in-place to preserve existing imports)

**Files to create:**
- `src/app/api/vendor/orders/[id]/accept/route.ts` (POST — sets Fulfilment.acceptedAt + emits ORDER_ACCEPTED outbox event; idempotent)

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/[id]/fulfilment/route.ts` (P0-06 boundary).
- DO NOT touch `src/lib/fulfilment-state.ts` (P0-06 state machine — acceptedAt is a separate nullable column, not a new enum value).
- DO NOT touch `src/lib/pickup-attribution.ts`, `src/app/api/orders/[id]/pickup/verify/route.ts` (P0-07 boundary).
- DO NOT touch `src/app/api/orders/[id]/status/route.ts` (legacy).

**Acceptance criteria:**
- [ ] Order tracking timeline shows 7 steps when vendor has accepted: Order Placed → Payment Confirmed → Restaurant Accepted → Preparing → Almost Ready → Ready for Pickup → Picked Up.
- [ ] When `Fulfilment.acceptedAt` is null, timeline shows 6 steps (skips "Restaurant Accepted").
- [ ] Estimated ready time: `createdAt + prepTimeMins` displayed as countdown.
- [ ] Restaurant contact button: opens `tel:` link.
- [ ] Pickup instructions card: shows when status ≥ READY_FOR_PICKUP.
- [ ] Receipt download placeholder: button (deferred — shows toast "Receipt coming soon").
- [ ] `POST /api/vendor/orders/[id]/accept` sets `acceptedAt` + `acceptedBy` + emits ORDER_ACCEPTED outbox event + creates Notification for consumer. Idempotent (returns 200 if already accepted).
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: Fulfilment.acceptedAt column; 1B: order-timeline-v2 component); Wave 2 (Task 2D: navigation).

---

#### Task 3D — Order history + reorder

**Scope:**
- Build the new My Orders screen per blueprint §12 (active + history, quick reorder).

**Files to create:**
- `src/components/snak/screens/my-orders-screen.tsx`

**Files to modify (additive only):**
- `src/components/snak/consumer-view.tsx` (route to My Orders screen when "Orders" tab tapped)

**Governance boundaries:**
- DO NOT touch any API route.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] My Orders screen renders: active orders section (with live status badges) + history section.
- [ ] Tapping an active order → opens OrderTracking.
- [ ] Tapping a history order → opens order detail (with reorder CTA).
- [ ] "Reorder" button on history orders → adds all items to cart + navigates to restaurant detail.
- [ ] Empty state: illustration + "Browse restaurants" CTA.
- [ ] Pull-to-refresh.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: empty-state, restaurant-card-v2); Wave 3 (Task 3C: order tracking).

---

### Wave 4 — Vendor MVP (3 parallel tasks; depends on Wave 3)

#### Task 4A — Vendor order queue redesign

**Scope:**
- Add "Accept" button to vendor order card (calls new `/api/vendor/orders/[id]/accept`).
- Add prep-time setter (vendor can adjust estimated prep time per order).
- Improve order card layout (more info, better visual hierarchy).

**Files to modify:**
- `src/components/snak/vendor-view.tsx` (add Accept button + prep-time setter + improved card layout)

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/[id]/fulfilment/route.ts` (P0-06 boundary).
- DO NOT touch `src/lib/fulfilment-state.ts`.
- DO NOT touch `src/app/api/orders/[id]/status/route.ts` (legacy — used by cancel only).
- DO NOT modify the existing `advance()` function that calls PATCH /fulfilment — preserve it.

**Acceptance criteria:**
- [ ] Vendor order card shows: order #, status badge, items list, total, time ago, prep-time setter (input + save button), Accept button (when `acceptedAt` is null) + Advance button (Mark Almost Ready / Ready / Picked Up) + Cancel button.
- [ ] Tapping "Accept" → calls POST /api/vendor/orders/[id]/accept → success toast → card re-renders with "Accepted" badge.
- [ ] Prep-time setter: input minutes → save → updates UI (estimated ready time on consumer side updates via realtime).
- [ ] Lint + tsc clean.

**Dependencies:** Wave 3 (Task 3C: /api/vendor/orders/[id]/accept endpoint).

---

#### Task 4B — Vendor menu management

**Scope:**
- Build vendor menu management UI (create/edit items, categories, pricing, availability toggle, image upload placeholder, deal creation).

**Files to create:**
- `src/app/api/vendor/menu/route.ts` (POST — create menu item; GET — list vendor's menu items)
- `src/app/api/vendor/menu/[id]/route.ts` (PATCH — update menu item; DELETE — soft-delete)
- `src/app/api/vendor/deals/route.ts` (GET — list deals; POST — create deal)
- `src/app/api/vendor/deals/[id]/route.ts` (PATCH — update deal; DELETE — delete deal)

**Files to modify:**
- `src/components/snak/vendor-view.tsx` (enhance the Menu tab with full CRUD UI)

**Governance boundaries:**
- DO NOT touch `src/app/api/menu/[id]/route.ts` (existing PATCH — additive only, can extend with `rewardMultiplier` field).
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Vendor can: create menu item (name, description, price, image URL, spice level, veg/non-veg, category), edit existing items, toggle availability, set reward multiplier (1.0-3.0), create deal (title, type, value, validity window, optional menu item scope).
- [ ] `POST /api/vendor/menu` creates a MenuItem linked to vendor's restaurant.
- [ ] `PATCH /api/vendor/menu/[id]` updates fields; supports `rewardMultiplier`.
- [ ] `POST /api/vendor/deals` creates a VendorDeal.
- [ ] All mutations are RBAC-gated (VENDOR_OWNER + VENDOR_STAFF only).
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: VendorDeal model + MenuItem.rewardMultiplier column).

---

#### Task 4C — Vendor analytics dashboard

**Scope:**
- Build vendor analytics widget (today's orders, revenue, avg prep time, low-stock alerts).

**Files to create:**
- `src/app/api/vendor/analytics/route.ts` (GET — returns today's metrics for vendor's restaurant)

**Files to modify:**
- `src/components/snak/vendor-view.tsx` (add analytics widget at top of Orders tab)

**Governance boundaries:**
- DO NOT touch existing `/api/admin/metrics/route.ts` (separate concerns — vendor analytics is restaurant-scoped, admin is platform-wide).
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Vendor analytics widget shows: today's orders count, today's revenue, avg prep time, low-stock items list (items with `availableCount < 5` or marked unavailable).
- [ ] `GET /api/vendor/analytics` returns JSON: `{ todayOrders, todayRevenue, avgPrepTimeMins, lowStockItems: [{ id, name, availableCount }] }`.
- [ ] RBAC-gated (VENDOR_OWNER + VENDOR_STAFF only).
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: schema); Wave 4 (Task 4B for menu item context).

---

### Wave 5 — Rewards (2 parallel tasks; depends on Wave 4)

#### Task 5A — Rewards backend

**Scope:**
- Build rewards backend: RewardAccount, RewardLedgerEntry, earn rules, idempotent issuance on order PICKED_UP, redemption endpoint.
- Wire reward issuance to fire when `Order.status` transitions to `PICKED_UP` (via outbox event consumer — additive, does NOT modify the fulfilment route).

**Files to create:**
- `src/app/api/rewards/account/route.ts` (GET — current user's RewardAccount)
- `src/app/api/rewards/ledger/route.ts` (GET — paginated ledger entries)
- `src/app/api/rewards/redeem/route.ts` (POST — redeem points → returns discount code; idempotent)
- `src/app/api/rewards/rules/route.ts` (GET — list active rules; PATCH — admin only)
- `src/lib/rewards-engine.ts` (server-side: `issueReward(userId, ruleKey, eventId, context)` + `redeemReward(userId, points, rewardType, discountValue)` — transactional, idempotent)

**Files to modify (additive only):**
- `src/lib/event-consumer.ts` — DO NOT TOUCH (governance boundary). Instead, create a NEW consumer `src/lib/rewards-event-consumer.ts` that subscribes to `ORDER_PICKED_UP` outbox events and triggers `issueReward` for EARN_BASE + applicable bonus rules. This consumer is read-only with respect to existing money-state tables — it only writes to RewardAccount + RewardLedgerEntry + Notification.

Actually wait — `src/lib/event-consumer.ts` is in the governance boundary list. So we MUST NOT touch it. Resolution: hook reward issuance into a NEW endpoint that the fulfilment route calls ADDITIVELY. But we cannot touch `/api/orders/[id]/fulfilment/route.ts` either.

**Better resolution:** The reward issuance is triggered by a NEW additive endpoint `POST /api/rewards/on-picked-up` that is called by the **frontend** (vendor-view) when the vendor taps "Mark Picked Up". The vendor-view already calls `PATCH /api/orders/[id]/fulfilment` to transition to PICKED_UP — after that succeeds, it ALSO calls `POST /api/rewards/on-picked-up?orderId=X`. The endpoint is idempotent (uses `idempotencyKey = ORDER_PICKED_UP:${orderId}`) so double-calls are safe.

This keeps reward issuance entirely additive — no existing route modified, no event-consumer modified.

**Files to create (final):**
- `src/app/api/rewards/on-picked-up/route.ts` (POST — idempotent; body: `{ orderId }`; validates order is PICKED_UP; issues EARN_BASE + applicable bonus rules)
- `src/app/api/rewards/account/route.ts`
- `src/app/api/rewards/ledger/route.ts`
- `src/app/api/rewards/redeem/route.ts`
- `src/app/api/rewards/rules/route.ts`
- `src/lib/rewards-engine.ts`

**Files to modify (additive only):**
- `src/components/snak/vendor-view.tsx` (after successful PATCH /fulfilment to PICKED_UP, also call POST /api/rewards/on-picked-up?orderId=X — fire-and-forget with idempotency-key header)

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/[id]/fulfilment/route.ts` (P0-06 boundary).
- DO NOT touch `src/lib/event-consumer.ts` (governance).
- DO NOT touch `src/lib/webhook-processor.ts` (governance).
- DO NOT touch any payment/refund route.
- DO NOT modify the fulfilment state machine.
- DO NOT touch `src/lib/fulfilment-state.ts`.

**Acceptance criteria:**
- [ ] `POST /api/rewards/on-picked-up { orderId }` issues EARN_BASE points (1 pt per ₹10 of `order.totalAmount`) + applicable bonus rules (FIRST_ORDER, SECOND_ORDER, OFF_PEAK) — all idempotent (same orderId retried returns same ledger entries).
- [ ] `GET /api/rewards/account` returns `{ balance, lifetimeEarned, lifetimeRedeemed }`.
- [ ] `GET /api/rewards/ledger?page=1&limit=20` returns paginated ledger entries.
- [ ] `POST /api/rewards/redeem { points, rewardType, discountValue }` creates a REDEEM ledger entry (negative points) + a RewardRedemption with a generated `redemptionCode` (e.g., "SNZ-RWD-AB12CD"). Idempotent (idempotency-key header).
- [ ] Balance check: if `points > account.balance`, return 400 `INSUFFICIENT_POINTS`.
- [ ] Vendor "Mark Picked Up" flow triggers reward issuance (idempotent — multiple taps don't double-issue).
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: RewardAccount, RewardLedgerEntry, RewardRule, RewardRedemption models; 1C: rewards-engine.ts stub); Wave 4 (Task 4A: vendor-view integration).

---

#### Task 5B — Rewards UI

**Scope:**
- Build the Rewards tab screen (progress ring, history, redeem at checkout, bonus rules display).

**Files to create:**
- `src/components/snak/screens/rewards-screen.tsx`

**Files to modify (additive only):**
- `src/components/snak/checkout-view.tsx` (add reward redemption step — apply points to cart total; checkout already touched by Task 3B, additive again)

**Governance boundaries:**
- DO NOT touch any API route.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Rewards screen renders: `RewardProgressRing` (current balance, tier label), "How to earn" section (lists all active RewardRules with examples), "Recent activity" list (paginated ledger entries), "Redeem" CTA → opens bottom sheet with redemption options (PERCENT_DISCOUNT, FIXED_DISCOUNT, FREE_ITEM).
- [ ] Redeeming points → creates redemption code → shown to user with copy button.
- [ ] Checkout reward redemption: tap "Apply X points" → deducts from total → updates `PricingBreakdown`.
- [ ] Empty state: "No rewards yet — place your first order to start earning!"
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: reward-progress-ring component; 1C: rewards-store); Wave 5 (Task 5A: rewards backend).

---

### Wave 6 — Social + Gifting (4 parallel tasks; depends on Wave 5)

#### Task 6A — Social backend

**Scope:**
- Build social backend: friend request/accept, activity feed generation, privacy.

**Files to create:**
- `src/app/api/social/connections/route.ts` (GET — my connections; POST — send friend request)
- `src/app/api/social/connections/[id]/route.ts` (PATCH — accept/reject; DELETE — unfriend/block)
- `src/app/api/social/feed/route.ts` (GET — paginated friend activity feed)
- `src/app/api/social/search/route.ts` (GET — search users by name/phone)
- `src/lib/social-activity.ts` (server-side: `recordActivity(actorId, verb, objectType, objectId, metadata, visibility)` — used by other routes to emit activities; called from order creation, gift creation, group order creation, reward issuance)

**Files to modify (additive only):**
- `src/app/api/orders/route.ts` — DO NOT TOUCH (governance). Instead, record `ORDERED` activity via a NEW additive endpoint `POST /api/social/record-activity` called by the consumer-view after successful order creation. Or even simpler: have the consumer-view call `POST /api/social/activities` directly with `{ verb: 'ORDERED', objectType: 'Restaurant', objectId: restaurantId, metadata: { restaurantName } }` — RBAC-gated to CONSUMER only.
- `src/app/api/rewards/on-picked-up/route.ts` — additive: also record `REWARDED` activity.

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/route.ts` (POST).
- DO NOT touch `src/app/api/orders/[id]/fulfilment/route.ts`.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] `POST /api/social/connections { followeeId, message? }` creates a PENDING SocialConnection + sends a Notification to the followee.
- [ ] `PATCH /api/social/connections/[id] { status: 'ACCEPTED' }` accepts the request + creates the reverse SocialConnection (B→A, ACCEPTED) in the same transaction.
- [ ] `DELETE /api/social/connections/[id]` removes both rows (unfriend).
- [ ] `GET /api/social/feed?page=1&limit=20` returns activities from accepted friends, paginated, never exposes payment amounts.
- [ ] `GET /api/social/search?q=Aarav` returns matching users (excluding self + already-connected).
- [ ] `POST /api/social/activities` records an activity (called by consumer-view after order creation, gift creation, etc.).
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: SocialConnection, SocialActivity, Notification models; 1C: social-store).

---

#### Task 6B — Social UI

**Scope:**
- Build the Social tab screen (friends list, social feed, friend search, follow/unfollow).

**Files to create:**
- `src/components/snak/screens/social-screen.tsx`
- `src/components/snak/screens/friends-screen.tsx` (sub-tab: friends list + search + requests)

**Files to modify (additive only):**
- `src/components/snak/app-shell.tsx` (add "Social" as 6th bottom-nav tab — consumer persona only)

**Governance boundaries:**
- DO NOT touch any API route.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] Social screen renders: 2 sub-tabs — "Feed" (activity feed) + "Friends" (friends list + search + pending requests).
- [ ] Feed shows `SocialFeedCard` items (friend avatar + verb + object + timestamp).
- [ ] Friends sub-tab shows: pending requests (accept/reject buttons), current friends (with message/unfriend actions), search bar.
- [ ] Search results show users with "Add friend" button.
- [ ] Empty state for feed: "No activity yet — add friends to see their orders here!"
- [ ] Empty state for friends: "No friends yet — search by name or phone to find them."
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: social-feed-card component; 1C: social-store); Wave 6 (Task 6A: social backend).

---

#### Task 6C — Gifting backend

**Scope:**
- Build gifting backend: Gift model, create gift → pay → recipient notification → redeem flow, expiry, idempotency.

**Files to create:**
- `src/app/api/gifts/route.ts` (GET — my gifts sent + received; POST — create gift + pay)
- `src/app/api/gifts/[id]/route.ts` (GET — gift details)
- `src/app/api/gifts/[id]/redeem/route.ts` (POST — recipient redeems available gift → creates Order with totalAmount=0)
- `src/app/api/gifts/[id]/cancel/route.ts` (POST — sender cancels unclaimed gift)
- `src/lib/gift-service.ts` (server-side: `createGift(senderId, recipientId, menuItemId, message)` + `redeemGift(giftId, recipientId)` — transactional, idempotent)

**Governance boundaries:**
- DO NOT touch `src/app/api/payments/route.ts` (POST). Instead, gift payment uses the existing /api/payments route by first creating a "ghost order" for the sender (via existing /api/orders route) → paying it → marking it as "gift purchase" via the gift's `paymentId` field. The ghost order's `note` field encodes `GIFT:${giftId}:for:${recipientId}`. **No payment route modified.**
- DO NOT touch `src/app/api/orders/route.ts` (POST). The ghost order uses the existing route.
- DO NOT touch fulfilment/pickup governance files.
- DO NOT modify the Order model (gift linkage via Order.note string encoding — additive only).

**Acceptance criteria:**
- [ ] `POST /api/gifts { recipientId, menuItemId, message? }` creates a Gift in CREATED state → creates ghost Order (senderId, items=[giftItem], note encodes gift) → calls /api/payments → on success updates Gift.status=PAID → AVAILABLE + sets expiresAt (30 days) → sends Notification to recipient.
- [ ] `GET /api/gifts` returns sent + received gifts for the current user.
- [ ] `POST /api/gifts/[id]/redeem` (recipient only) creates a NEW Order with totalAmount=0, userId=recipientId, items=[{ menuItemId, name, price=0, quantity=1 }], note encodes `GIFT_FROM:${senderId}:${giftId}`. Sets Gift.status=REDEEMED + recipientOrderId. Idempotent (returns existing order if already redeemed).
- [ ] `POST /api/gifts/[id]/cancel` (sender only, gift must be AVAILABLE) sets Gift.status=CANCELLED + triggers refund flow via existing /api/payments/refund route.
- [ ] Expiry: cron job (or lazy check on read) sets Gift.status=EXPIRED when `expiresAt < now` + triggers refund.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: Gift model; 1C: gift-store); Wave 6 (Task 6A: social-activity for GIFTED activity recording).

---

#### Task 6D — Gifting UI

**Scope:**
- Build the gifting UI: gift a friend flow, gift card component, redeem gift, gift history.

**Files to create:**
- `src/components/snak/screens/gifts-screen.tsx`
- `src/components/snak/screens/send-gift-flow.tsx` (modal/bottom-sheet flow: select friend → select menu item → message → pay)

**Files to modify (additive only):**
- `src/components/snak/screens/home-screen.tsx` (add "Gift a Friend" CTA → opens send-gift-flow)
- `src/components/snak/screens/restaurant-detail-screen.tsx` (add "Gift this" button on menu items → opens send-gift-flow with item preselected)

**Governance boundaries:**
- DO NOT touch any API route.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] "Gift a Friend" CTA on Home opens the send-gift flow.
- [ ] Send-gift flow: 3 steps — (1) select friend (search + pick from friends list), (2) select menu item (pick from any restaurant's menu — full menu browser), (3) add message + pay.
- [ ] Gift card component (`GiftCard` from Task 1B) shows: sender avatar, recipient avatar, message preview, redeem button (if recipient + AVAILABLE), expiry countdown.
- [ ] Gifts screen: 2 sub-tabs — "Received" (with redeem buttons) + "Sent" (with cancel buttons for unclaimed).
- [ ] Redeeming a gift → navigates to OrderTracking for the newly created zero-amount Order.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: gift-card component; 1C: gift-store); Wave 6 (Task 6C: gifts backend).

---

### Wave 7 — Group ordering (2 parallel tasks; depends on Wave 6)

#### Task 7A — Group order backend

**Scope:**
- Build group order backend: create, join via share code, individual carts, host confirm, single order creation.

**Files to create:**
- `src/app/api/group-orders/route.ts` (GET — my group orders; POST — host creates)
- `src/app/api/group-orders/[id]/route.ts` (GET — group order details + members + items)
- `src/app/api/group-orders/[id]/join/route.ts` (POST — friend joins via share code)
- `src/app/api/group-orders/[id]/items/route.ts` (GET — my items in group; POST — add item to my cart)
- `src/app/api/group-orders/[id]/items/[itemId]/route.ts` (PATCH — update my item; DELETE — remove my item)
- `src/app/api/group-orders/[id]/confirm/route.ts` (POST — host confirms → creates single Order with all items)
- `src/app/api/group-orders/[id]/cancel/route.ts` (POST — host cancels)
- `src/lib/group-order-service.ts` (server-side: `createGroupOrder(hostId, restaurantId, name?)` + `confirmGroupOrder(groupOrderId, hostId)` — transactional, idempotent)

**Governance boundaries:**
- DO NOT touch `src/app/api/orders/route.ts` (POST). The confirm endpoint creates the final Order via the existing /api/orders route OR via a direct prisma call inside a transaction. **Resolution:** direct prisma call inside `withTransaction` — same pattern as the existing /api/orders POST route, but without the idempotency/outbox indirection (the group-order confirm endpoint itself is idempotent via GroupOrder.status check).
- DO NOT touch `src/app/api/payments/route.ts` (POST). The host pays via the existing route on the confirmed Order.
- DO NOT touch fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] `POST /api/group-orders { restaurantId, name? }` creates a GroupOrder with status=OPEN + 6-char shareCode + closesAt = createdAt + 24h. Adds host as first member.
- [ ] `POST /api/group-orders/[id]/join` (auth user, not already a member) adds the user as a member.
- [ ] `POST /api/group-orders/[id]/items { menuItemId, quantity }` adds an item to the user's cart within the group.
- [ ] `PATCH /api/group-orders/[id]/items/[itemId] { quantity }` updates the user's item.
- [ ] `POST /api/group-orders/[id]/confirm` (host only, status=OPEN) creates a single Order with all members' items merged by menuItemId → sets GroupOrder.status=CONFIRMED + confirmedOrderId. Idempotent (returns existing order if already confirmed).
- [ ] Host's checkout flow runs normally on the confirmed Order.
- [ ] `POST /api/group-orders/[id]/cancel` (host only) sets status=CANCELLED.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: GroupOrder, GroupOrderMember, GroupOrderItem models; 1C: group-order-store); Wave 6 (Task 6A: GROUP_ORDERED activity).

---

#### Task 7B — Group order UI

**Scope:**
- Build group order UI: create flow, share link, join flow, member carts, host confirm.

**Files to create:**
- `src/components/snak/screens/group-order-screen.tsx` (detail view: members list + each member's items + confirm/cancel buttons for host)
- `src/components/snak/screens/create-group-order-flow.tsx` (modal: select restaurant → set name → create → show share code)

**Files to modify (additive only):**
- `src/components/snak/screens/home-screen.tsx` (add "Start Group Order" CTA → opens create flow)
- `src/components/snak/screens/restaurant-detail-screen.tsx` (add "Start Group Order Here" button → opens create flow with restaurant preselected)

**Governance boundaries:**
- DO NOT touch any API route.
- DO NOT touch payment/fulfilment/pickup governance files.

**Acceptance criteria:**
- [ ] "Start Group Order" CTA on Home opens the create flow.
- [ ] Create flow: select restaurant → optional name → "Create" → success screen shows share code + copy link button + "Open Group Order" button.
- [ ] Group order screen: shows restaurant banner + share code + member list (with avatars) + each member's items (read-only for non-host, editable for own items) + "Add Items" button (navigates to restaurant menu in "group order mode") + "Confirm & Pay" button (host only).
- [ ] Host clicks "Confirm & Pay" → creates single Order → navigates to CheckoutView with the merged Order.
- [ ] Join flow: deep link `/group/[shareCode]` → calls /join → navigates to group order screen.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1B: group-order-bubble component; 1C: group-order-store); Wave 7 (Task 7A: group order backend).

---

### Wave 8 — Admin polish (1 parallel task; depends on Wave 5)

#### Task 8 — Admin modules per blueprint §24

**Scope:**
- Add admin modules: Rewards, Fraud/Risk, Support, Feature Flags (in addition to existing Overview/Users/Vendors/Orders/Payments/Refunds/Audit).
- Each module is a sub-screen accessible via a left sidebar (desktop) or hamburger menu (mobile).

**Files to create:**
- `src/components/snak/admin/modules/rewards-module.tsx` (list of all reward ledger entries with filters; redeem code lookup; rule management)
- `src/components/snak/admin/modules/fraud-risk-module.tsx` (ExceptionQueue list + resolution workflow; suspicious activity flags)
- `src/components/snak/admin/modules/support-module.tsx` (placeholder — support tickets deferred to Wave 9+)
- `src/components/snak/admin/modules/feature-flags-module.tsx` (read-only display of feature flags from `src/lib/deployment.ts` — DO NOT toggle from UI per governance; show "OFF" / "ON" status with description + "Toggle requires Orchestrator authorization" notice)

**Files to modify (additive only):**
- `src/components/snak/admin-view.tsx` (add sidebar navigation + module routing)
- `src/app/api/admin/metrics/route.ts` (additive: add rewards metrics, gift metrics, group order metrics)

**Governance boundaries:**
- DO NOT touch `src/lib/deployment.ts` — admin can VIEW feature flags but NOT TOGGLE them (governance: blueprint §50 — production flag activation requires Orchestrator authorization).
- DO NOT touch payment/fulfilment/pickup governance files.
- DO NOT touch reconciliation routes.

**Acceptance criteria:**
- [ ] Admin view shows sidebar with 11 modules: Overview, Users, Vendors, Orders, Payments, Refunds, Rewards, Fraud/Risk, Audit, Feature Flags, Support.
- [ ] Rewards module: paginated list of all reward ledger entries with filters (userId, type, date range); redeem code lookup; rule management (PATCH /api/rewards/rules).
- [ ] Fraud/Risk module: ExceptionQueue list with resolution workflow (assign, resolve with note).
- [ ] Feature Flags module: read-only display of all flags with "Toggle requires Orchestrator authorization" notice.
- [ ] Support module: placeholder with "Coming soon" message.
- [ ] Lint + tsc clean.

**Dependencies:** Wave 1 (1A: schema); Wave 5 (Task 5A: rewards backend); can run in parallel with Waves 6-7.

---

### Wave 9 — Integration + golden journey (1 sequential task; depends on all prior waves)

#### Task 9 — End-to-end golden journey test (blueprint §43)

**Scope:**
- Run the full golden journey test via Agent Browser.
- Verify positive + negative journeys per blueprints §43 + §44.

**Test script (agent-browser):**

1. **Signup + campus selection** — new user OTP login → campus onboarding → land on Home.
2. **Restaurant discovery** — search + filter → tap restaurant → see menu.
3. **Cart + transparent pricing** — add items → cart shows breakdown.
4. **Checkout + payment** — checkout → demo pay → order PAID.
5. **Vendor accept + prep** — switch to vendor → accept order → mark preparing → almost ready → ready.
6. **Pickup** — switch back to consumer → see "Ready for Pickup" → show QR.
7. **Reward issuance** — vendor marks PICKED_UP → consumer receives reward notification → rewards tab shows new points.
8. **Gift** — consumer sends gift to friend → friend receives notification → friend redeems → orders food.
9. **Group order** — host creates group → friend joins + adds items → host confirms + pays → vendor sees merged order.
10. **Social feed** — friend's order appears in social feed.
11. **Reorder** — from history, reorder previous order.
12. **Admin** — admin sees all orders, payments, rewards, audit trail.

**Negative journeys (blueprint §44):**
- N1: Wrong QR → rejected.
- N2: Wrong OTP → rejected.
- N3: Wrong order credential → rejected.
- N4: Duplicate pickup → idempotent.
- N5: Duplicate payment request → exactly one financial effect.
- N6: Webhook replay → no duplicate payment mutation.
- N7: Unauthorized vendor → rejected.
- N8: Customer attempts vendor mutation → rejected.
- N9: Cancelled order pickup → rejected.
- N10: Payment captured but pickup absent → order remains not picked up.

**Files to create:**
- `tests/golden-journey.mjs` (agent-browser test script)
- `evidence/golden-journey/evidence-golden-journey-<timestamp>.json` (test results artifact)

**Governance boundaries:**
- DO NOT modify any governance file.
- DO NOT activate any feature flag.
- DO NOT touch production data (use dev DB only).

**Acceptance criteria:**
- [ ] All 12 positive journey steps pass.
- [ ] All 10 negative journeys pass (or are documented as deferred with reasoning).
- [ ] Evidence artifact saved to `evidence/golden-journey/`.
- [ ] No governance regression (P0-06, P0-07, I-13, M9/M10, Firebase=0, Supabase auth, production flags OFF).
- [ ] Final report appended to `worklog.md`.

**Dependencies:** All prior waves (1-8) must be complete.

---

## Part 5 — Governance boundary checklist

Each subagent MUST NOT touch the following files:

### 5.1 Hard governance boundaries (blueprint §29, §50)

| File | Reason |
|---|---|
| `src/lib/razorpay.ts` | Payment gateway abstraction (E1-E9 governance) |
| `src/lib/reconciliation.ts` | M1-M17 detectors, M9/M10 prohibition |
| `src/lib/pickup-attribution.ts` | P0-07, I-13 pickup attribution logic |
| `src/lib/fulfilment-state.ts` | P0-06 fulfilment state machine (NEXT_FULFILMENT_STATUS enum) |
| `src/lib/state-invariants.ts` | P0-06 invariants |
| `src/lib/webhook-processor.ts` | Webhook processing governance |
| `src/lib/event-consumer.ts` | Event consumer governance |
| `src/lib/invariant-checker.ts` | P0-28 invariant checker |
| `src/lib/deployment.ts` | Feature flags (all default OFF) |
| `src/lib/idempotency.ts` | P0-17 idempotency key handling |
| `src/lib/outbox.ts` | P0-24 outbox publisher pattern |
| `src/lib/audit.ts` | Audit log governance (hash-chain) |

### 5.2 Hard route boundaries (cannot modify existing route logic)

| Route | Reason |
|---|---|
| `src/app/api/orders/route.ts` (POST) | Order creation — uses idempotency, transaction, outbox (governance-complete) |
| `src/app/api/orders/[id]/route.ts` (GET) | Order fetch — works |
| `src/app/api/orders/[id]/status/route.ts` (PATCH) | Legacy status route — used by cancel + admin |
| `src/app/api/orders/[id]/fulfilment/route.ts` (GET/PATCH) | **P0-06 boundary — DO NOT TOUCH** |
| `src/app/api/orders/[id]/pickup/verify/route.ts` (POST) | **P0-07 boundary — DO NOT TOUCH** |
| `src/app/api/payments/route.ts` (POST) | **Payment governance — DO NOT TOUCH** |
| `src/app/api/payments/refund/route.ts` (POST) | **Refund governance — DO NOT TOUCH** |
| `src/app/api/payments/evidence-*.ts` | Evidence routes |
| `src/app/api/webhooks/razorpay/route.ts` | Webhook governance |
| `src/app/api/webhooks/evidence-*.ts` | Evidence routes |
| `src/app/api/reconciliation/*` (15 routes) | **Reconciliation governance — DO NOT TOUCH** |
| `src/app/api/orders/evidence-*.ts` | Evidence routes |
| `src/app/api/audit-logs/route.ts` | Audit log read |
| `src/app/api/kill-switches/*` | Kill switch governance |
| `src/app/api/auth/*` (9 routes) | Auth (Supabase + demo) |
| `src/app/api/health/route.ts` | Health check |
| `src/app/api/backup/route.ts` | Backup governance |
| `src/app/api/exceptions/route.ts` | Exception queue |
| `src/app/api/alerts/*` | Alerting |
| `src/app/api/audit-integrity-test/route.ts` | Test route |
| `src/app/api/p0-*-test/route.ts` | Test routes |
| `src/app/api/test/*` | Test routes |

### 5.3 Prisma governance

| Action | Allowed? |
|---|---|
| Add a new model to `prisma/schema.prisma` | ✅ YES (additive) |
| Add a nullable column to an existing model | ✅ YES (additive, with default) |
| Modify an existing column's type/nullable/constraint | ❌ NO |
| Remove an existing column | ❌ NO |
| Drop a model | ❌ NO |
| Modify `prisma/migrations/20260809183236_initial_schema/` | ❌ NO |
| Modify `prisma/migrations/20260809185723_audit_hash_chain/` | ❌ NO |
| Modify `prisma/scripts/*` | ❌ NO |
| Create a new migration directory | ✅ YES (additive) |
| Run `bun run db:push` | ❌ NO (P0-15 disabled — use `db:migrate`) |
| Run `bun run db:migrate` | ✅ YES |
| Run `bun run db:reset` (in dev) | ✅ YES (dev only) |

### 5.4 Feature flag governance (blueprint §50)

| Action | Allowed? |
|---|---|
| View feature flag status in admin UI | ✅ YES (read-only) |
| Toggle feature flag from admin UI | ❌ NO (requires Orchestrator authorization) |
| Activate `realPayments` flag | ❌ NO |
| Activate `invariantChecker` flag | ❌ NO |
| Activate `pickupAttributionEnforcement` flag | ❌ NO |
| Activate `webhookHandler` flag | ❌ NO |
| Activate `outboxPublisher` flag | ❌ NO |
| Activate `concurrencyControl` flag | ❌ NO |
| Activate `requestHashEnforcement` flag | ❌ NO |
| Activate `drDrillMode` flag | ❌ NO |
| Activate `reconciliationAutoRepair` flag | ❌ NO |

### 5.5 What CAN be added (per blueprint §50)

| Action | Allowed? |
|---|---|
| Create new Prisma models | ✅ YES |
| Add nullable additive columns to existing models | ✅ YES |
| Create new API routes (under `/api/campuses`, `/api/rewards`, `/api/social`, `/api/gifts`, `/api/group-orders`, `/api/notifications`, `/api/vendor/*`) | ✅ YES |
| Create new UI components under `src/components/snak/` | ✅ YES |
| Create new Zustand stores under `src/lib/` | ✅ YES |
| Create new shared types in `src/lib/types.ts` (additive) | ✅ YES |
| Create new Zod schemas in `src/lib/validation.ts` (additive) | ✅ YES |
| Modify `prisma/seed.ts` (additive — preserve existing seed) | ✅ YES |
| Modify `src/components/snak/*.tsx` (additive — preserve existing exports) | ✅ YES |
| Modify `src/app/api/restaurants/*` (additive — add fields/params, preserve existing) | ✅ YES |
| Modify `src/app/api/admin/metrics/route.ts` (additive — add metrics, preserve existing) | ✅ YES |
| Modify `src/components/snak/consumer-view.tsx` (rewrite — split into screens) | ✅ YES (Wave 2 owns) |
| Modify `src/components/snak/vendor-view.tsx` (additive — Accept button, prep-time, analytics) | ✅ YES (Wave 4 owns) |
| Modify `src/components/snak/admin-view.tsx` (additive — new modules) | ✅ YES (Wave 8 owns) |
| Modify `src/components/snak/checkout-view.tsx` (additive — pricing breakdown, payment selector) | ✅ YES (Wave 3 owns) |
| Modify `src/components/snak/order-tracking.tsx` (additive — accepted step, ETA, contact) | ✅ YES (Wave 3 owns) |
| Modify `src/app/page.tsx` (rewrite — marketing landing) | ✅ YES (Wave 2 owns) |
| Modify `src/app/consumer/page.tsx` (additive — campus onboarding redirect) | ✅ YES (Wave 2 owns) |
| Modify `src/app/globals.css` (additive — new component styles) | ✅ YES |
| Modify `src/lib/snack.ts` (additive — new constants) | ✅ YES |
| Modify `src/lib/cart-store.ts` (additive — new fields + pricing method) | ✅ YES (Wave 1C owns) |
| Modify `src/lib/types.ts` (additive — new interfaces) | ✅ YES |
| Modify `src/lib/validation.ts` (additive — new schemas) | ✅ YES |
| Modify `src/components/snak/bits.tsx` (additive — new badges) | ✅ YES |
| Modify `src/components/snak/phone-otp-login.tsx` (additive — campus email capture) | ✅ YES (Wave 2 owns) |
| Modify `src/components/snak/app-shell.tsx` (additive — bottom-nav, campus selector) | ✅ YES |

---

## Part 6 — Risk register

| ID | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Adding `Fulfilment.acceptedAt` column is misread by reviewer as P0-06 violation | Medium | Medium | Document explicitly in PR description + schema comment that acceptedAt is an additive nullable column that does NOT modify the Fulfilment.status enum or NEXT_FULFILMENT_STATUS state machine. Reference blueprint §50 governance STOP conditions. |
| R2 | Reward issuance double-fires on vendor double-tap of "Mark Picked Up" | Medium | High | Use idempotency-key header (auto-injected by csrfFetch) + `@@unique([userId, idempotencyKey])` constraint on RewardLedgerEntry. Test: tap "Mark Picked Up" 5 times rapidly → only 1 set of ledger entries created. |
| R3 | Gift ghost-order pattern (sender pays for ghost Order, recipient gets real Order) leaks confusion in order history | Medium | Medium | Mark ghost orders in UI via `note` field encoding (`GIFT:...:for:...`). Filter ghost orders from consumer "My Orders" list (hide if note starts with `GIFT:`). |
| R4 | Group order confirm race: host confirms while member is mid-add | Low | High | Use `withTransaction` + optimistic lock on `GroupOrder.version`. When confirm succeeds, all subsequent `POST /items` return 409 (group already confirmed). |
| R5 | Social feed leaks payment amounts | Low | Critical | `SocialActivity.metadata` JSON schema explicitly forbids `amount`/`total`/`price` fields. Code review checkpoint in Task 6A acceptance criteria. |
| R6 | New bottom-nav breaks mobile viewport on small screens (iPhone SE 1st gen) | Low | Medium | Test on 320px viewport (smallest supported). Bottom-nav uses `safe-area-inset-bottom` for iPhone notch. |
| R7 | Migration fails on existing dev DB due to column conflicts | Low | Medium | Test migration on a fresh DB + on the existing dev DB. If conflict, write a fix-up migration (NEVER modify existing migration files). |
| R8 | Reward rule formula JSON parsing fails on malformed input | Medium | Low | Validate `RewardRule.pointsFormula` against a Zod schema on write (admin only). Validate again on read in `rewards-engine.ts`. Fall back to EARN_BASE default if formula is unparseable. |
| R9 | Gift expiry cron doesn't run (no scheduler) → gifts never expire | High | Medium | Use lazy expiry: check `expiresAt < now` on every `GET /api/gifts/[id]` + `GET /api/gifts`. If expired, transition to EXPIRED + trigger refund in the same request. Defer cron job to Wave 10+. |
| R10 | New `/api/vendor/orders/[id]/accept` endpoint is called by consumer (RBAC bypass) | Low | High | RBAC check: `session.role in ['VENDOR_OWNER', 'VENDOR_STAFF']` + verify session.userId owns the restaurant (via Restaurant.ownerId — needs new additive column `Restaurant.ownerUserId String?`). |
| R11 | `Restaurant` model has no `ownerUserId` field → vendor RBAC cannot verify ownership | High | High | Add nullable additive column `Restaurant.ownerUserId String?` in Wave 1A. Set during seed (link Spice Junction Owner to r1). Migrate existing restaurants to have ownerUserId set to seed vendor owner. |
| R12 | Campus onboarding blocks user from app if campus list is empty | Low | Medium | Seed at least 4 campuses in Wave 1A. If `GET /api/campuses` returns empty, show "No campuses yet — skip for now" button. |
| R13 | Real-time socket.io disconnects during vendor order flow → vendor misses new orders | Medium | Medium | Existing `useRealtime` hook already handles reconnect. Add toasts on reconnect ("Reconnected — refreshing orders"). |
| R14 | Migration on production Postgres differs from SQLite dev | Medium | High | Test migration on both SQLite (dev) + Postgres (staging) before production. Document any DB-specific syntax differences. (Production is NO-GO per blueprint §51 — this is dev/staging only.) |
| R15 | Wave 9 golden journey test fails on negative paths (N6 webhook replay) because webhookHandler flag is OFF | High | Low | Document as deferred: N6 requires webhookHandler flag ON (Orchestrator authorization). Test passes if response is 503 (handler not enabled). |
| R16 | Consumer-view rewrite (Task 2B-2D) breaks existing checkout flow | Medium | High | Preserve `CheckoutView` import + `handleCheckoutSuccess` callback signature. Add integration test: browse → menu → cart → checkout → pay → tracking (existing flow from PRODUCT-FOUNDATION-IMPLEMENT-01 worklog entry). |
| R17 | Reward issuance on PICKED_UP fires before order status is committed to PICKED_UP | Low | Medium | `POST /api/rewards/on-picked-up` validates `Order.status === 'PICKED_UP' || Fulfilment.status === 'PICKED_UP'` BEFORE issuing rewards. Returns 409 if not yet PICKED_UP. Frontend retries after 1s. |
| R18 | Gift payment via ghost order creates confusion in reconciliation (Payment linked to non-existent fulfilment) | Medium | Medium | Ghost orders have `note` starting with `GIFT:` — reconciliation detects these + excludes from pickup SLA metrics. Document in reconciliation README (additive doc, not modifying reconciliation.ts). |
| R19 | Social feed N+1 queries (1 query per activity to fetch actor + object) | High | Low | Use Prisma `include` to eager-load actor + object in a single query. Add `@@index([actorId, createdAt])` + `@@index([createdAt])` (already in schema). |
| R20 | Bottom-nav conflicts with existing sticky cart bar (both fixed at bottom) | High | Medium | Bottom-nav is `position: fixed; bottom: 0`. Cart bar uses `md:bottom-16` (above bottom-nav) — already handled in existing code. Verify in Wave 2B. |

---

## Part 7 — Execution order + critical path

### 7.1 Wave dependency graph

```
Wave 1 (Foundation — 3 parallel)
  1A: DB schema + migration + seed
  1B: Design system components
  1C: Shared types + Zustand stores
       │
       ▼
Wave 2 (Consumer MVP — 4 parallel)
  2A: Campus onboarding
  2B: Home screen
  2C: Restaurant discovery
  2D: Restaurant detail + menu
       │
       ▼
Wave 3 (Order lifecycle — 4 parallel)
  3A: Cart redesign
  3B: Checkout redesign
  3C: Order tracking redesign (+ /api/vendor/orders/[id]/accept)
  3D: Order history + reorder
       │
       ▼
Wave 4 (Vendor MVP — 3 parallel)
  4A: Vendor order queue redesign
  4B: Vendor menu management
  4C: Vendor analytics dashboard
       │
       ▼
Wave 5 (Rewards — 2 parallel)
  5A: Rewards backend
  5B: Rewards UI
       │
       ▼
Wave 6 (Social + Gifting — 4 parallel)
  6A: Social backend
  6B: Social UI
  6C: Gifting backend
  6D: Gifting UI
       │
       ▼
Wave 7 (Group ordering — 2 parallel)
  7A: Group order backend
  7B: Group order UI
       │
       ▼
Wave 8 (Admin polish — 1 task; can run parallel with Wave 6-7)
  8: Admin modules
       │
       ▼
Wave 9 (Integration — 1 sequential)
  9: End-to-end golden journey test
```

### 7.2 Critical path

The critical path is the longest dependency chain:

```
1A → 2C → 2D → 3B → 3C → 4A → 5A → 6C → 6D → 7A → 7B → 9
```

This is 12 tasks long. With each task taking ~2-4 hours of subagent work, the critical path is ~24-48 hours of sequential subagent work.

### 7.3 Parallelization opportunities

- **Wave 1**: 3 tasks in parallel (1A, 1B, 1C).
- **Wave 2**: 4 tasks in parallel (2A, 2B, 2C, 2D) — but 2B depends on 2A's campus selector + 2C's restaurant cards, so practically 2A || 2C first, then 2B || 2D.
- **Wave 3**: 4 tasks in parallel (3A, 3B, 3C, 3D) — 3B depends on 3A's cart pricing, so 3A first, then 3B || 3C || 3D.
- **Wave 4**: 3 tasks in parallel.
- **Wave 5**: 2 tasks in parallel.
- **Wave 6**: 4 tasks in parallel.
- **Wave 7**: 2 tasks in parallel.
- **Wave 8**: 1 task; can run in parallel with Wave 6 + Wave 7 (independent of social/gift/group).
- **Wave 9**: 1 sequential task (after all prior waves).

**Maximum theoretical parallelism**: 4 tasks (Waves 2, 3, 6).

### 7.4 Estimated total work

- Wave 1: ~8-12 hours (3 parallel × 3-4 hours each)
- Wave 2: ~12-16 hours (4 parallel × 3-4 hours)
- Wave 3: ~12-16 hours (4 parallel × 3-4 hours)
- Wave 4: ~9-12 hours (3 parallel × 3-4 hours)
- Wave 5: ~6-8 hours (2 parallel × 3-4 hours)
- Wave 6: ~12-16 hours (4 parallel × 3-4 hours)
- Wave 7: ~6-8 hours (2 parallel × 3-4 hours)
- Wave 8: ~3-4 hours (1 task)
- Wave 9: ~4-6 hours (1 sequential test)

**Total wall-clock time with 4-way parallelism:** ~70-100 hours of subagent work, but with parallelism the wall-clock time is ~24-36 hours of orchestrator time (assuming each wave takes ~3-4 hours wall-clock with parallelism).

---

## Part 8 — Definition of Done per blueprint §56 (adapted per wave)

### 8.1 Wave 1 DoD

```text
[ ] All new Prisma models created + migration applied
[ ] All additive columns on existing models added (nullable, with defaults)
[ ] Seed extended with campuses, reward rules, sample data
[ ] All new UI components render without error
[ ] All new Zustand stores have TypeScript types
[ ] Lint: ZERO new errors in new files
[ ] TypeScript: ZERO new errors in new files
[ ] Governance preserved: no existing model field modified, no flag activated
[ ] Smoke test: GET /api/restaurants returns 200, GET /api/health returns 200
[ ] Worklog entry appended per established protocol
```

### 8.2 Wave 2 DoD

```text
[ ] First-run consumer can complete campus onboarding
[ ] Home screen renders all 10 sections (blueprint §9)
[ ] Explore screen with filters works
[ ] Restaurant detail + menu renders
[ ] Mobile-first: 375px viewport verified
[ ] Each screen has loading + empty + error states
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: no API route modified (except additive extensions to /api/restaurants/*)
[ ] Worklog entry appended
```

### 8.3 Wave 3 DoD

```text
[ ] Cart screen shows transparent pricing breakdown
[ ] Checkout screen with payment method selector works
[ ] Two-step order + payment flow preserved (no payment route modified)
[ ] Order tracking shows 7-step timeline with "Restaurant Accepted"
[ ] Order history with reorder works
[ ] POST /api/vendor/orders/[id]/accept works (sets acceptedAt, idempotent)
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: P0-06 (Fulfilment.status enum) UNCHANGED, P0-07 UNCHANGED, payment routes UNCHANGED
[ ] Worklog entry appended
```

### 8.4 Wave 4 DoD

```text
[ ] Vendor can: accept order, set prep time, advance fulfilment, cancel, manage menu, create deals, view analytics
[ ] All vendor routes RBAC-gated (VENDOR_OWNER + VENDOR_STAFF)
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: P0-06 fulfilment route UNCHANGED, existing /api/menu/[id] PATCH only additively extended
[ ] Worklog entry appended
```

### 8.5 Wave 5 DoD

```text
[ ] Reward issuance fires on order PICKED_UP (idempotent)
[ ] Reward balance is ledger-derived (not a mutable counter)
[ ] Reward redemption creates a unique redemption code
[ ] Rewards tab shows progress ring + history + redeem options
[ ] Checkout reward redemption works
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: no payment/fulfilment route modified
[ ] Fraud controls: idempotent issuance, one reward per event, ledger-based balance
[ ] Worklog entry appended
```

### 8.6 Wave 6 DoD

```text
[ ] Friend request/accept flow works (bidirectional)
[ ] Social feed renders friend activities (no payment amounts)
[ ] Gift creation + payment + recipient notification + redemption works
[ ] Gift expiry (lazy) + cancellation + refund works
[ ] Privacy: friends-only feed default; never exposes payment amounts
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: no payment route modified (gift uses ghost order + existing /api/payments)
[ ] Fraud controls: recipient binding, expiry, no double redemption
[ ] Worklog entry appended
```

### 8.7 Wave 7 DoD

```text
[ ] Host can create group order + get share code
[ ] Friends can join via share code + add items to their cart
[ ] Host can confirm + pay (creates single Order with all items merged)
[ ] Vendor sees single merged Order in queue
[ ] Concurrency: optimistic locking prevents race between confirm + member-add
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: no order creation route modified (group confirm uses direct prisma call inside transaction)
[ ] Worklog entry appended
```

### 8.8 Wave 8 DoD

```text
[ ] Admin sidebar shows 11 modules (blueprint §24)
[ ] Rewards module: list + filters + redeem code lookup + rule management
[ ] Fraud/Risk module: ExceptionQueue list + resolution workflow
[ ] Feature Flags module: read-only display (NO toggle)
[ ] Support module: placeholder
[ ] Lint: ZERO new errors
[ ] TypeScript: ZERO new errors
[ ] Governance: NO feature flag activated from admin UI; requires Orchestrator authorization
[ ] Worklog entry appended
```

### 8.9 Wave 9 DoD

```text
[ ] 12 positive golden journey steps pass (blueprint §43)
[ ] 10 negative golden journeys pass or are documented as deferred with reasoning (blueprint §44)
[ ] Evidence artifact saved to evidence/golden-journey/
[ ] Governance regression: P0-06 PASS, P0-07 PASS, I-13 PASS, M9/M10 PROHIBITED, Firebase=0, Supabase auth PASS, production flags OFF
[ ] No governance file modified
[ ] No feature flag activated
[ ] Final report appended to worklog.md
```

---

## Appendix A — Subagent dispatch template

When dispatching each task to a subagent, use this template:

```text
Task ID: <TASK-ID> (e.g., 1A, 2B, 5A)
Agent: full-stack-developer (or specialist as appropriate)
Task: <one-line summary>

Read first (mandatory):
- /home/z/my-project/PRODUCT_IMPLEMENTATION_PLAN.md (this document) — Part 4, Task <TASK-ID> section
- /home/z/my-project/upload/SNAKZAP_IDE_MASTER_IMPLEMENTATION_BLUEPRINT.md — relevant sections (cited in task)
- /home/z/my-project/worklog.md — tail (last 200 lines) for prior context

Scope:
<copy the Task scope from Part 4>

Files to create:
<list from Part 4>

Files to modify (additive only):
<list from Part 4>

Governance boundaries (DO NOT TOUCH):
<list from Part 5>

Acceptance criteria:
<copy from Part 4>

Dependencies:
<copy from Part 4>

Worklog protocol:
- Append a Stage Summary entry to /home/z/my-project/worklog.md per the established template.
- Include: files created, files modified, governance boundary respected (yes/no per item), lint status, tsc status, smoke test result, blockers encountered.
```

---

## Appendix B — Critical decisions summary

| # | Decision | Rationale |
|---|---|---|
| 1 | ACCEPTED state modelled as `Fulfilment.acceptedAt` (additive column), NOT as new enum value | Avoids P0-06 governance STOP condition |
| 2 | Reward issuance triggered by frontend calling `POST /api/rewards/on-picked-up` after vendor marks PICKED_UP | Avoids modifying /api/orders/[id]/fulfilment/route.ts (P0-06) or src/lib/event-consumer.ts (governance) |
| 3 | Gift payment uses ghost Order + existing /api/payments route | Avoids modifying payment route; ghost order's `note` field encodes gift metadata |
| 4 | Group order confirm uses direct prisma call inside transaction (NOT /api/orders POST) | Avoids modifying /api/orders POST route; same pattern but simpler (group-order endpoint is itself idempotent) |
| 5 | 5-tab consumer bottom-nav (Home / Explore / Orders / Rewards / Profile); Social added as 6th tab in Wave 6 | Matches blueprint §7; avoids empty Social tab in MVP |
| 6 | Campus selector: first-run onboarding + global top-bar chip (always editable) | Matches blueprint §8.1 |
| 7 | Rewards: 1 point per ₹10 spent; 100 points = ₹10 discount | Round psychological numbers; 10% back on first purchase |
| 8 | Social graph: bidirectional follow (friend request + accept), stored as 2 rows per mutual friendship | Easier queries for follower/following; symmetric operations |
| 9 | Activity feed: never exposes payment amounts; opt-in for order items | Blueprint §18 privacy requirement |
| 10 | Group ordering: Model A only (host pays) | Blueprint §20 — defer split payments |
| 11 | MealPlan: schema reserved, not implemented | Blueprint §21 — future, do not implement prematurely |
| 12 | Feature flags: read-only in admin UI | Blueprint §50 — Orchestrator authorization required for activation |

---

## Appendix C — File count summary

**New files to create (total ~75):**

- Prisma: 1 migration directory + 1 migration SQL = 2 files
- Components (`src/components/snak/`): ~25 new files (bottom-nav, campus-selector, reward-progress-ring, gift-card, social-feed-card, group-order-bubble, pricing-breakdown, empty-state, restaurant-card-v2, menu-item-card-v2, order-timeline-v2, premium-toast, skeleton-loader, onboarding/campus-step, screens/home, explore, restaurant-detail, cart, my-orders, rewards, profile, notifications, social, gifts, group-order, send-gift-flow, create-group-order-flow, admin/modules/* × 4)
- Lib (`src/lib/`): ~10 new files (campus-store, rewards-store, social-store, gift-store, group-order-store, notification-store, reward-rules, rewards-engine, social-activity, gift-service, group-order-service)
- API routes (`src/app/api/`): ~30 new route files
- Tests: 1 golden journey script + 1 evidence artifact = 2 files

**Existing files to modify (additive only) (total ~25):**

- Prisma: `schema.prisma`, `seed.ts`
- Lib: `cart-store.ts`, `snack.ts`, `types.ts`, `validation.ts`, `bits.tsx`
- Components: `consumer-view.tsx` (rewrite), `vendor-view.tsx`, `admin-view.tsx`, `checkout-view.tsx`, `order-tracking.tsx`, `app-shell.tsx`, `phone-otp-login.tsx`, `bits.tsx`
- Pages: `page.tsx` (rewrite), `consumer/page.tsx`
- API: `restaurants/route.ts`, `restaurants/[id]/route.ts`, `restaurants/[id]/menu/route.ts`, `menu/[id]/route.ts`, `admin/metrics/route.ts`, `auth/me/route.ts`
- CSS: `globals.css`

**Files NOT to touch (total ~30):**

- 12 lib files (governance boundaries)
- ~20 API routes (governance boundaries — payments, fulfilment, pickup, reconciliation, webhooks, evidence, kill-switches, auth, audit, exceptions, alerts, backup)
- 2 migration directories (existing)
- Existing prisma scripts

---

**END OF PRODUCT_IMPLEMENTATION_PLAN.md**
