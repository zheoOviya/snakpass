# Task 1C — Zustand stores + types (full-stack-developer)

**Wave:** 1 (Foundation)
**Scope:** 6 new Zustand stores + 2 new lib helpers + additive extension to cart-store.ts + additive Zod schemas in validation.ts.
**Dependencies:** None (runs in parallel with 1A schema + 1B components/types).

## What I did

### Created (8 new lib files)

1. **`src/lib/reward-rules.ts`** — Pure reward-rule definitions + idempotency-key construction helpers. NO DB access, no side effects, no `'use server'` (must be importable from both client and server). Exports:
   - Constants: `REWARD_POINTS_PER_RUPEE = 0.1`, `REWARD_REDEMPTION_RATE = 0.1`, `GIFT_EXPIRY_DAYS = 30`, `GROUP_ORDER_CLOSES_HOURS = 24`, `REWARD_EXPIRY_DAYS = 365`
   - `RewardRuleKey` union (11 keys: EARN_BASE, FIRST_ORDER, SECOND_ORDER, STREAK_3, STREAK_7, REFERRAL, OFF_PEAK, GROUP_ORDER, GIFT_SENT, GIFT_RECEIVED, CAMPUS_EVENT)
   - `PointsFormula`, `RewardRuleDef` interfaces
   - `REWARD_RULES` catalog (Record<RewardRuleKey, RewardRuleDef>)
   - `REWARD_RULE_KEYS` array
   - `computeOrderPoints(orderAmountPaise, ruleKey, context)` — pure computation for 3 formula types (perRupee/fixed/multiplier)
   - `buildIdempotencyKey(userId, ruleKey, orderId?, nonce?)` — deterministic key for idempotent issuance (format `${ruleKey}:order:${orderId}` or `${ruleKey}:user:${userId}[:${nonce}]`)
   - `rewardDiscountPaise(points)` — converts points → paise (100 pts = 1000 paise = ₹10)
   - `paiseToRewardPoints(paise)` — inverse helper for "apply max available points" UX

2. **`src/lib/rewards-engine.ts`** — Server-side, transactional + idempotent. Accepts `tx: RewardTx` (NOT opening its own transaction). Exports:
   - `RewardPrismaModels` interface (permissive `any` delegates for the new product-foundation models until Task 1A lands)
   - `RewardTx = Prisma.TransactionClient & RewardPrismaModels` (type helper for route handlers — cast `tx as unknown as RewardTx` when calling)
   - Row types: `RewardAccountRow`, `RewardLedgerEntryRow`, `RewardRedemptionRow`
   - Param/result types: `IssueRewardParams`, `IssueRewardResult`, `RedeemRewardParams`, `RedeemRewardResult`
   - `issueReward(tx, params)` — idempotent via `RewardLedgerEntry.idempotencyKey` @@unique constraint; returns deduplicated flag
   - `redeemReward(tx, params)` — validates balance inside the caller's transaction; creates REDEEM ledger entry + RewardRedemption row; atomic balance decrement
   - `expireStaleRewards()` — PLACEHOLDER (TODO; returns `{0,0}`); full impl deferred to plan §1.D "365-day expiry via cron"

3. **`src/lib/campus-store.ts`** — Zustand store with `persist`. State: `selectedCampusId, selectedCampusName, isLoading, error`. Actions: `setCampus(id, name)`, `clearCampus()`, `refresh()` (re-validates persisted campus via GET /api/campuses/[id]; clears on 404). SSR-safe: `storage: typeof window !== 'undefined' ? createJSONStorage(() => localStorage) : undefined` + `partialize` to persist only the selection (transient isLoading/error excluded).

4. **`src/lib/rewards-store.ts`** — Zustand store (NOT persisted — server-authoritative). State: `account, recentLedger, isLoading, error`. Actions: `refresh(userId)` (parallel fetch account + ledger), `redeem(points, orderId?)` (optimistic decrement + prepend synthetic REDEEM ledger entry). Uses Task 1B's `RewardAccount` + `RewardLedgerEntry` types from `@/lib/types`. Defines local `RewardRedemption` type (not in shared types.ts).

5. **`src/lib/social-store.ts`** — Zustand store (NOT persisted). State: `connections, feed, isLoading, error`. Actions: `refresh()`, `sendRequest(targetUserId, message?)`, `acceptRequest(requestId)`, `declineRequest(requestId)`, `unfollow(targetUserId)`. All actions optimistic + use `csrfFetch`. Uses Task 1B's `SocialConnection` + `SocialActivity` types.

6. **`src/lib/gift-store.ts`** — Zustand store (NOT persisted). State: `sentGifts, receivedGifts, isLoading, error`. Actions: `refresh()`, `createGift(payload)`, `redeemGift(giftId, redemptionCode)`, `cancelGift(giftId)`. Exports local `GiftStatus` union (CREATED/PAID/AVAILABLE/REDEEMED/EXPIRED/CANCELLED/REFUNDED) + `CreateGiftPayload` interface. Uses Task 1B's `Gift` type.

7. **`src/lib/group-order-store.ts`** — Zustand store (NOT persisted). State: `activeGroupOrder, members, myItems, isLoading, error`. Actions: `refresh(shareCode)`, `join(shareCode)`, `addItem(menuItem, quantity?)`, `removeItem(menuItemId)`, `confirm()`, `leave()`. Exports local `GroupOrderStatus` union (OPEN/LOCKED/PLACED/CANCELLED). Uses Task 1B's `GroupOrder` + `GroupOrderMember` + `GroupOrderItem` types + imports `MenuItem` for addItem signature.

8. **`src/lib/notification-store.ts`** — Zustand store (NOT persisted). State: `notifications, unreadCount, isLoading` (no `error` field per spec — failures are silent non-fatal). Actions: `refresh()`, `markRead(id)`, `markAllRead()`. All actions optimistic with revert on failure. Uses Task 1B's `Notification` type.

### Modified (additive only)

9. **`src/lib/cart-store.ts`** — Added:
   - `CartPricing` interface (7 fields: subtotal, tax, platformFee, discount, rewardDiscount, tip, total — all in paise)
   - 4 new state fields: `couponCode: string | null`, `rewardPointsToRedeem: number`, `pickupTime: string | null`, `tipAmount: number`
   - 4 new actions: `setCoupon(code)`, `setRewardPoints(points)` (validates positive integer), `setPickupTime(time)`, `setTip(amount)` (validates positive integer)
   - `pricing()` method implementing blueprint §4 P4 transparent breakdown:
     - subtotal = sum(line.price × line.quantity)
     - tax = floor(subtotal × 0.05) — 5% GST placeholder
     - platformFee = 0 — SnakZap low-fee model MVP
     - discount = couponCode ? floor(subtotal × 0.1) : 0 — 10% placeholder
     - rewardDiscount = `rewardDiscountPaise(rewardPointsToRedeem)` — uses helper from reward-rules.ts (100 pts × 0.1 × 100 = 1000 paise = ₹10)
     - tip = tipAmount
     - total = subtotal + tax + platformFee − discount − rewardDiscount + tip
   - Updated `clear()` to also reset the 4 new fields (REQUIRED for consistency — clear() must reset all cart add-ons)
   - Updated `add()` restaurant-switch branch to also reset the 4 new fields (coupon was tied to old restaurant)
   - Imports `rewardDiscountPaise` from `@/lib/reward-rules` (pure helper — safe for client bundle)
   - ALL existing exports (`CartLine`, `useCart`) + API signatures (`add`, `increment`, `decrement`, `remove`, `clear`, `total`, `count`) preserved unchanged

10. **`src/lib/validation.ts`** — Appended 9 new Zod schemas (preserved all existing):
    - `campusIdSchema` (alias for uuidSchema)
    - `rewardRedeemSchema = { points: int positive, orderId?: uuid }`
    - `giftCreateSchema = { recipientId: uuid, menuItemId: uuid, message?: string max 500 }`
    - `giftRedeemSchema = { redemptionCode: string min 1 }`
    - `groupOrderCreateSchema = { restaurantId: uuid }`
    - `groupOrderJoinSchema = { shareCode: string min 1 }`
    - `groupOrderItemSchema = { menuItemId: uuid, name: string 1-200, price: int nonneg, quantity: int positive }`
    - `socialRequestSchema = { targetUserId: uuid, message?: string max 500 }`
    - `socialActionSchema = { requestId: uuid, action: 'ACCEPT' | 'REJECT' }`
    - `notificationMarkReadSchema = { id: uuid, read?: boolean default true }`

## Governance boundaries respected

- ❌ Did NOT touch: `src/lib/deployment.ts`, `src/lib/razorpay.ts`, `src/lib/reconciliation.ts`, `src/lib/pickup-attribution.ts`, `src/lib/fulfilment-state.ts`, `src/lib/state-invariants.ts`, `src/lib/webhook-processor.ts`, `src/lib/event-consumer.ts`, `src/lib/invariant-checker.ts`, `src/lib/outbox.ts`, `src/lib/idempotency.ts`, `src/lib/otp-service.ts`, `src/lib/session.ts`, `src/lib/alerting.ts`, `src/lib/logger.ts`, `src/lib/errors.ts`
- ❌ Did NOT touch any existing API route (`src/app/api/**`)
- ❌ Did NOT touch `prisma/schema.prisma` (Task 1A owns schema)
- ❌ Did NOT touch existing Zustand stores' existing API (only ADDITIVE to cart-store.ts)
- ❌ Did NOT touch existing hooks (`use-auth.tsx`, `use-realtime.ts`, `use-toast.ts`, `use-mobile.ts`)
- ❌ Did NOT touch `src/lib/types.ts` (Task 1B owns types — they had already added the UI types when I started; I CONSUMED those types from `@/lib/types` instead of redefining them locally)
- ❌ Did NOT touch `src/lib/snack.ts` (Task 1B owns — REWARD_POINTS_PER_RUPEE lives in reward-rules.ts per my orchestrator's spec; snack.ts duplication is Task 1B's call)
- ✅ Created new files only in `src/lib/`
- ✅ Appended additively to `cart-store.ts` + `validation.ts` only

## SSR safety

- `campus-store.ts`: uses `persist` with `storage: typeof window !== 'undefined' ? createJSONStorage(() => localStorage) : undefined` + `partialize` to persist only `selectedCampusId, selectedCampusName` (transient `isLoading, error` excluded)
- `rewards-store.ts`, `social-store.ts`, `gift-store.ts`, `group-order-store.ts`, `notification-store.ts`: NO `persist` middleware (server-authoritative state — re-fetched on every mount). No `window`/`localStorage` access at module load.
- `cart-store.ts`: keeps existing `persist` with `name: 'snakzap-cart'` (Zustand's default storage is localStorage with built-in SSR guard). New fields auto-persisted (couponCode, rewardPointsToRedeem, pickupTime, tipAmount).
- All `csrfFetch` dynamic imports inside action bodies (NOT at module top-level) — keeps the stores' module load lightweight.

## Acceptance criteria verification

- [x] All 8 new lib files exist and export the named symbols
- [x] Each Zustand store has TypeScript types for state + actions (explicit `XxxState` interfaces)
- [x] `bun run lint` exits 0 on all new files (project-level lint shows 1 pre-existing error in `src/components/snak/restaurant-card-v2.tsx` — Task 1B's file, NOT mine)
- [x] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in new files (verified per-file: all 10 touched files have 0 errors; total 173 errors are all in pre-existing/Task 1B/protected files)
- [x] Stores handle SSR (no `window`/`localStorage` access at module load — guarded or skipped)
- [x] `cart-store.pricing()` returns `{ subtotal, tax, platformFee, discount, rewardDiscount, tip, total }` per blueprint §4 P4 (verified)
- [x] `rewards-engine.ts` is transactional (accepts `tx` param, doesn't open own transaction — caller wraps in `withTransaction`)
- [x] `reward-rules.ts` is pure (no DB access, no side effects, no I/O — only pure computation + deterministic key construction)

## Lint + tsc evidence

```
$ bunx eslint src/lib/{reward-rules,rewards-engine,campus-store,rewards-store,social-store,gift-store,group-order-store,notification-store,cart-store,validation}.ts
# (only the pre-existing Node MODULE_TYPELESS_PACKAGE_JSON warning — not from my code)
# EXIT 0 (zero errors, zero warnings on my files)

$ bunx tsc --noEmit --skipLibCheck 2>&1 | grep -E "(reward-rules|rewards-engine|campus-store|rewards-store|social-store|gift-store|group-order-store|notification-store|cart-store|validation)\.ts"
# (zero matches — my files have ZERO TypeScript errors)
```

## Issues / coordination notes for Wave 2+

1. **Type contract alignment**: Task 1B's types.ts uses UI-shaped types (denormalized with names, avatar URLs, tier names). My stores consume these types directly (no local redefinition of `RewardAccount`, `Gift`, etc.). The only local types I added are `GiftStatus`, `GroupOrderStatus`, `NotificationType` union types (for type-safe status comparisons — these are covariant to the `string` field on the imported types) and the `RewardRedemption` row type (which Task 1B didn't define since it's only briefly displayed).

2. **Type divergence note**: Task 1B's `RewardAccount` uses `pointsBalance / lifetimePoints / tierName`, while the Prisma schema (Task 1A) uses `balance / lifetimeEarned / lifetimeRedeemed`. Wave 2+ Task 5A (Rewards API routes) will need to MAP between these in the route handler — return Task 1B's UI shape to the client, persist Prisma's shape server-side. This is a normal pattern (UI DTO vs persistence model).

3. **rewards-engine.ts forward-compatibility**: Until Task 1A applies the schema migration + runs `bun run db:generate`, `Prisma.TransactionClient` doesn't have `rewardAccount`, `rewardLedgerEntry`, `rewardRedemption` delegates. I declared a `RewardPrismaModels` extension interface with `any`-typed delegates so the engine compiles. Route handlers (Task 5A) cast their `tx` to `RewardTx` when calling `issueReward` / `redeemReward` — once Task 1A lands, the cast becomes a strict no-op.

4. **No dev.log**: dev server isn't running in this session; verified via `bun run lint` + `bunx tsc --noEmit` static checks.

5. **cart-store.ts clear() / add() behavior change**: I extended `clear()` and `add()`'s restaurant-switch branch to also reset the new pricing fields (couponCode, rewardPointsToRedeem, pickupTime, tipAmount). Function signatures are unchanged; this is a behavior augmentation required for correctness (otherwise stale coupon/tip would survive a cart reset).
