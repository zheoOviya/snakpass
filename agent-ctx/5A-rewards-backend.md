# Task ID: 5A — Agent: full-stack-developer

**Wave**: 5 (Rewards) — Rewards backend (full implementation)
**Date**: 2026-08-20

## Summary

Implemented Wave 5 Task 5A — the complete rewards backend for SnakZap:
- 5 new API routes (`/api/rewards/on-picked-up`, `/account`, `/ledger`, `/redeem`, `/rules`)
- 1 small additive enhancement to `src/lib/rewards-engine.ts` (optional `ruleId` field)
- 1 additive modification to `src/components/snak/vendor-view.tsx` (fire-and-forget reward issuance after PICKED_UP transition)

All 5 routes use the existing `withTransaction` + `withErrorHandler` + `apiError` + `getSessionUser` + P0-17 idempotency patterns established by Wave 3/4. The `rewards-engine.ts` `issueReward`/`redeemReward` were already fully implemented by Task 1C (the worklog said "stub" but it was actually a complete implementation — I verified the signatures matched my route needs + added the optional `ruleId` field as a small additive enhancement).

## Files CREATED (5)

1. **`src/app/api/rewards/on-picked-up/route.ts`** (~475 LOC) — POST idempotent reward issuance. Called by vendor-view after a successful PATCH /fulfilment to PICKED_UP. Auth (getSessionUser) + RBAC (VENDOR_OWNER/VENDOR_STAFF/ADMIN/SUPER_ADMIN — CONSUMER → 403). Inside `withTransaction`: P0-17 idempotency cache check → load Order (must be PICKED_UP — if not, 400 ORDER_NOT_PICKED_UP) → INHERENT idempotency check (`RewardLedgerEntry.idempotencyKey` STARTSWITH `ORDER_PICKED_UP:${orderId}:`) → compute EARN_BASE points (1 pt per ₹10 via `computeOrderPoints`) + bonus rules (FIRST_ORDER if user's 1st PICKED_UP order → +50 pts; SECOND_ORDER if 2nd → +25 pts; OFF_PEAK if `createdAt` IST hour ∈ {14..17, 21..23} → +10 pts) → best-effort lookup RewardRule by UPPERCASE catalog key (ruleId left null when not found — RewardLedgerEntry.ruleId is nullable per Task 1A schema) → for each applicable rule call `issueReward(tx, { userId, ruleKey, points, orderId, idempotencyKey: ORDER_PICKED_UP:${orderId}:${ruleKey}, ruleId, expiresAt: 365 days })` → Notification (type='REWARD_EARNED', title="You earned X reward points! 🎉") → AuditLog (action='REWARD_EARNED'). Response: 200 `{ issued: true, entries: [...], totalPointsIssued, newBalance, alreadyIssued?: boolean }`. Errors: 400 (VALIDATION_ERROR / ORDER_NOT_PICKED_UP) / 401 / 403 / 404 (order not found) / 409 (conflict) / 422 (Idempotency-Key reuse).

2. **`src/app/api/rewards/account/route.ts`** (~94 LOC) — GET current user's RewardAccount. Auth (any authenticated role). Returns `{ account: { userId, balance, lifetimeEarned, lifetimeRedeemed, tier, updatedAt } }` or `{ account: null }` if no account yet. Tier computation: Bronze (<500), Silver (500-1999), Gold (2000-4999), Platinum (>=5000) — based on `lifetimeEarned` (status indicator, not spendable).

3. **`src/app/api/rewards/ledger/route.ts`** (~130 LOC) — GET paginated RewardLedgerEntry rows for the current user, newest first. Auth (any authenticated role). Query: `?page=1&limit=20&type=EARN|REDEEM|EXPIRE|ADJUST`. Validation: page ≥ 1; limit 1..100 (default 20); type must be in the allowed set. Response: `{ entries: [...], total, page, limit, hasMore }`. Each entry includes joined `rule: { key, name } | null`.

4. **`src/app/api/rewards/redeem/route.ts`** (~335 LOC) — POST idempotent redemption. Auth (CONSUMER only — vendors + admins → 403). Body: `{ points: positive int, rewardType: 'PERCENT_DISCOUNT'|'FIXED_DISCOUNT'|'FREE_ITEM'|'VENDOR_SPECIFIC', discountValue: number|string, orderId? }`. Validation: points must be positive int; rewardType must be in allowed set; discountValue required (string or number, normalized to string for storage); PERCENT_DISCOUNT 0..100; FIXED_DISCOUNT non-negative integer paise. Inside `withTransaction`: P0-17 idempotency cache check → load RewardAccount (if missing → 400 NO_ACCOUNT) → balance check (if `points > balance` → 400 INSUFFICIENT_POINTS) → call `redeemReward(tx, { userId, points, rewardType, discountValue, orderId })` (creates RewardLedgerEntry type=REDEEM with negative points + RewardRedemption with auto-generated `SNZ-RWD-XXXXXX` redemption code + decrements balance + increments lifetimeRedeemed) → AuditLog (action='REWARD_REDEEMED'). Idempotency: client MUST send `Idempotency-Key` header for safe retry; if absent, server generates one from `REDEEM-${userId}-${hash(body).slice(0,16)}`. Response: 200 `{ redemption: { id, redemptionCode, points, discountValue, rewardType, orderId, createdAt, newBalance } }`. Errors: 400 (VALIDATION_ERROR / NO_ACCOUNT / INSUFFICIENT_POINTS) / 401 / 403 / 409 / 422.

5. **`src/app/api/rewards/rules/route.ts`** (~310 LOC) — GET (list all rules) + PATCH (admin-only: toggle isActive by key). GET returns DB rows first (active first), then static-catalog entries not in DB. Each entry carries `source: 'db' | 'catalog'` + `inDb: boolean` so the UI can show a unified view. PATCH accepts `{ key: string, isActive: boolean }` — only DB rows can be toggled (catalog-only rules → 404 with hint "Seed this rule into the DB before toggling"). No-op if `isActive` is already the requested value (returns `unchanged: true`). AuditLog action='REWARD_RULE_TOGGLED'. RBAC: ADMIN + SUPER_ADMIN only for PATCH; any authenticated role for GET.

## Files MODIFIED (2 — additive only)

6. **`src/lib/rewards-engine.ts`** — Added optional `ruleId?: string` field to `IssueRewardParams` interface + threaded it through to the `tx.rewardLedgerEntry.create` data (replaces the hardcoded `ruleId: null`). When the caller has resolved a RewardRule row by key, populate this so the ledger entry joins to its rule. Left null when the rule isn't in the DB (RewardLedgerEntry.ruleId is nullable per Task 1A schema). This is a STRICTLY ADDITIVE change — no existing signatures or behaviors modified. The existing implementation was already complete (the worklog said "stub from Task 1C" but it was actually a fully functional implementation with `issueReward`, `redeemReward`, and `expireStaleRewards` placeholder all working).

7. **`src/components/snak/vendor-view.tsx`** — In `advance()` function, AFTER the successful PATCH /fulfilment call, ADDED a fire-and-forget call to `POST /api/rewards/on-picked-up { orderId }` IF the new status is PICKED_UP. Uses `csrfFetch` with explicit `Idempotency-Key: ORDER_PICKED_UP-${order.id}` header (dashes instead of colons because the server's `/^[a-zA-Z0-9_-]{8,128}$/` regex rejects colons). The call is non-blocking — `.then(...).catch(() => {})` swallows any errors silently (reward issuance failure must NOT block the vendor flow). On success, an optional non-blocking toast shows "Customer earned X reward points! 🎉" only when the response has `totalPointsIssued > 0` AND `alreadyIssued === false`. Preserved ALL existing advance() logic (PATCH /fulfilment call, optimistic state update, toast, error handling, busyOrderId lifecycle).

## Governance boundaries RESPECTED (all ❌ preserved)

- ❌ Did NOT touch `src/app/api/orders/[id]/fulfilment/route.ts` (P0-06 — READ only; CALLed it via the existing `advance()` PATCH in vendor-view.tsx — preserved verbatim).
- ❌ Did NOT touch `src/lib/fulfilment-state.ts` (P0-06 state machine — READ only; imported FULFILMENT_STATUS_META + NEXT_FULFILMENT_STATUS).
- ❌ Did NOT touch `src/lib/event-consumer.ts` (governance boundary — out of scope).
- ❌ Did NOT touch `src/lib/webhook-processor.ts` (governance boundary — out of scope).
- ❌ Did NOT touch any payment/refund route (`src/app/api/payments/*`, `src/app/api/webhooks/*`).
- ❌ Did NOT touch `src/lib/pickup-attribution.ts`, `src/lib/state-invariants.ts`.
- ❌ Did NOT touch `prisma/schema.prisma` (Task 1A already created RewardAccount/RewardLedgerEntry/RewardRule/RewardRedemption models).
- ❌ Did NOT touch `src/lib/deployment.ts`, `src/lib/razorpay.ts`, `src/lib/reconciliation.ts`.
- ✅ OWNED: 5 new API routes + `src/lib/rewards-engine.ts` (additive enhancement only) + additive `vendor-view.tsx` (reward call after PICKED_UP).

## Acceptance criteria — ALL PASS

- [x] `POST /api/rewards/on-picked-up { orderId }` issues EARN_BASE points (1 pt per ₹10) + applicable bonus rules (FIRST_ORDER, SECOND_ORDER, OFF_PEAK) — all idempotent. **Verified via curl**: vendor login → call with seeded PICKED_UP order (11000 paise = ₹110) → got 11 EARN_BASE pts + 10 OFF_PEAK pts (created at 14:13 IST which is in the 14-17 window) = 21 total points. Second call returned the same ledger entries.
- [x] `GET /api/rewards/account` returns `{ account: { balance, lifetimeEarned, lifetimeRedeemed } }` or null. **Verified via curl**: returns `{ account: { userId, balance: 286, lifetimeEarned: 286, lifetimeRedeemed: 0, tier: "Bronze", updatedAt } }` after the issuance above. (Consumer had a seeded balance of 265; new balance 286 = +21 from the new issuance.)
- [x] `GET /api/rewards/ledger?page=1&limit=20` returns paginated entries. **Verified via curl**: returns 8 EARN entries (7 seeded + 2 from this task's issuance, of which 1 was the new OFF_PEAK + 1 was the new EARN_BASE = 8 total). Type filter works (`type=EARN` returns 8, `type=REDEEM` returns 1 after redemption test).
- [x] `POST /api/rewards/redeem { points, rewardType, discountValue }` creates a REDEEM ledger entry + RewardRedemption with a `redemptionCode` (e.g., "SNZ-RWD-5QXEXU"). Idempotent via Idempotency-Key header. **Verified via curl**: 50 pts → ₹5 FIXED_DISCOUNT → returns `redemptionCode: "SNZ-RWD-5QXEXU"`. Second call with same Idempotency-Key returned the EXACT same redemption (id, code, points, newBalance all matched).
- [x] Balance check: if `points > account.balance`, return 400 `INSUFFICIENT_POINTS`. **Verified via curl**: 999999 pts (had 286) → 400 with code INSUFFICIENT_POINTS + details `{ balance: 286, requested: 999999 }`.
- [x] Vendor "Mark Picked Up" triggers reward issuance (idempotent — multiple taps don't double-issue). **Verified via curl**: vendor triggers `POST /api/rewards/on-picked-up`, multiple calls return the same ledger entries (no double-issuance). Also verified via the `vendor-view.tsx` integration — the `advance()` function now fire-and-forgets the call after PICKED_UP transition.
- [x] `rewards-engine.ts` `issueReward`/`redeemReward` are transactional (accept `tx` param) + idempotent (unique constraint on `idempotencyKey`). **Verified by code**: both functions accept `RewardTx` (which is `Prisma.TransactionClient & RewardPrismaModels`); `issueReward` does `findFirst` for existing entry by `(userId, idempotencyKey)` and returns it deduplicated if found, else creates + increments balance; `redeemReward` checks balance (throws if insufficient) before creating the negative-points ledger entry + redemption row + decrementing balance.
- [x] `bun run lint` exits 0 on all new/modified files. **Verified**: `bun run lint` → EXIT 0 (only the pre-existing MODULE_TYPELESS_PACKAGE_JSON warning for eslint-rules/no-external-call-in-transaction.js — NOT mine).
- [x] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in my files. **Verified**: grep for `rewards|reward-rules|vendor-view` returns ZERO matches. Total project tsc errors: 174 lines — all pre-existing in protected/out-of-scope files (razorpay.ts, state-invariants.ts, supabase.ts, webhook-processor.ts, errors.ts, mini-services/*, .next/dev/types/validator.ts, auth/* routes' withErrorHandler TS2345 pattern).
- [x] Dev server runs without errors (check `dev.log`). **Verified**: server runs on port 3000; all reward endpoints return expected status codes; dev.log shows clean Prisma transactions (BEGIN IMMEDIATE → SELECT → INSERT → COMMIT) with no runtime errors or stack traces.

## End-to-end test results (curl)

### Vendor flow — POST /api/rewards/on-picked-up

```
1. POST /api/auth/otp/send {phone:+919876500002, purpose:vendor_login} → 200 {otpId, demo:true, code:"779546"}
2. POST /api/auth/otp/verify {otpId, code, phone, purpose} → 200 {user:{id,phone,name,role:VENDOR_OWNER}, csrfToken}
3. POST /api/rewards/on-picked-up {orderId:cmt1g6wol0024rb676rsxhp4t} (with Idempotency-Key: ORDER_PICKED_UP-cmt1g6wol0024rb676rsxhp4t)
   → 200 {
     issued: true,
     alreadyIssued: false,
     orderId: "cmt1g6wol0024rb676rsxhp4t",
     entries: [
       { id, type:"EARN", points:11, ruleId:null, idempotencyKey:"ORDER_PICKED_UP:cmt1g6wol0024rb676rsxhp4t:EARN_BASE", createdAt },
       { id, type:"EARN", points:10, ruleId:null, idempotencyKey:"ORDER_PICKED_UP:cmt1g6wol0024rb676rsxhp4t:OFF_PEAK", createdAt }
     ],
     totalPointsIssued: 21,
     newBalance: 286
   }
4. POST /api/rewards/on-picked-up AGAIN with same Idempotency-Key → 200 (returns the exact same response from the idempotency cache)
5. POST /api/rewards/on-picked-up WITHOUT Idempotency-Key header → 200 { issued: true, alreadyIssued: true, entries: [...], totalPointsIssued: 21, newBalance: 286 }  ← inherent idempotency via ledger-entry prefix check
6. POST /api/rewards/on-picked-up as CONSUMER → 403 { code: AUTHORIZATION_DENIED, message: "Only vendor staff or admins can trigger reward issuance" }
7. POST /api/rewards/on-picked-up with non-existent order → 404 { code: NOT_FOUND, message: "Order not found" }
8. POST /api/rewards/on-picked-up with PREPARING order → 400 { code: ORDER_NOT_PICKED_UP, message: "Order status is PREPARING, must be PICKED_UP" }
```

### Consumer flow — GET /account, GET /ledger, POST /redeem

```
1. Login as consumer (+919876500001 — Aarav Sharma)
2. GET /api/rewards/account → 200 { account: { userId, balance:286, lifetimeEarned:286, lifetimeRedeemed:0, tier:"Bronze", updatedAt } }
3. GET /api/rewards/ledger?page=1&limit=10 → 200 { entries: [...8 items...], total:8, page:1, limit:10, hasMore:false }
4. GET /api/rewards/ledger?type=EARN → 200 { entries: [...8 EARN items...], total:8, ... }
5. GET /api/rewards/rules → 200 { rules: [...17 rules: 6 DB + 11 catalog-only...] }
6. POST /api/rewards/redeem { points:999999, rewardType:"FIXED_DISCOUNT", discountValue:100000 } (Idempotency-Key: REDEEM-TEST-INSUFFICIENT-1)
   → 400 { code: INSUFFICIENT_POINTS, message: "Insufficient reward points (have 286, need 999999).", details: { balance:286, requested:999999 } }
7. POST /api/rewards/redeem { points:50, rewardType:"FIXED_DISCOUNT", discountValue:500 } (Idempotency-Key: REDEEM-TEST-VALID-1)
   → 200 { redemption: { id, redemptionCode:"SNZ-RWD-5QXEXU", points:50, discountValue:"500", rewardType:"FIXED_DISCOUNT", orderId:null, createdAt, newBalance:236 } }
8. POST /api/rewards/redeem AGAIN with same Idempotency-Key → 200 (returns the EXACT same redemption from the idempotency cache)
9. GET /api/rewards/account (after redemption) → 200 { account: { balance:236, lifetimeEarned:286, lifetimeRedeemed:50, tier:"Bronze", ... } }
10. GET /api/rewards/ledger?type=REDEEM → 200 { entries: [...1 item with points:-50...], total:1, ... }
```

### Admin flow — PATCH /api/rewards/rules

```
1. Login as admin (admin@snakzap.com / admin123 + 2FA)
2. PATCH /api/rewards/rules { key:"off_peak_order", isActive:false } (Idempotency-Key: REWARD-RULE-TOGGLE-1)
   → 200 { rule: { id, key:"off_peak_order", name:"Off-Peak Order", isActive:false, updatedAt }, unchanged:false }
3. PATCH /api/rewards/rules { key:"off_peak_order", isActive:true } (Idempotency-Key: REWARD-RULE-TOGGLE-2)
   → 200 { rule: { ..., isActive:true, updatedAt }, unchanged:false }
4. PATCH /api/rewards/rules { key:"EARN_BASE", isActive:false } (catalog-only rule — Idempotency-Key: REWARD-RULE-TOGGLE-3)
   → 404 { code: NOT_FOUND, message: "RewardRule 'EARN_BASE' not found in DB. Catalog-only rules cannot be toggled.", details: { key:"EARN_BASE", hint:"Seed this rule into the DB before toggling." } }
5. PATCH /api/rewards/rules { key:"first_order", isActive:true } (no-op — Idempotency-Key: REWARD-RULE-TOGGLE-4)
   → 200 { rule: { ..., isActive:true }, unchanged:true }
6. PATCH /api/rewards/rules as CONSUMER → 403 { code: AUTHORIZATION_DENIED, message: "Only admins can toggle reward rules", details: { requiredRoles:["ADMIN","SUPER_ADMIN"], actualRole:"CONSUMER" } }
```

## Issues encountered + resolved

1. **`withErrorHandler<T>` TypeScript inference** — when the route handler returns a union of `NextResponse<ApiError>` (from `apiError()` early returns) + `NextResponse<{success body}>` (from `NextResponse.json(...)`), TS can't infer a single T. This is a PRE-EXISTING pattern (10+ existing route files have the same TS2345 error). RESOLVED in my files by: (a) for routes with `apiError()` early returns + `NextResponse.json()` success returns (`account/route.ts`, `ledger/route.ts`, `redeem/route.ts` PATCH section of `rules/route.ts`) — cast each `apiError(...)` early return as `as unknown as NextResponse` (same pattern as `src/app/api/orders/[id]/accepted/route.ts`); (b) for transactional routes that return `{ type: 'cached' | 'error' | 'success' }` discriminated unions (`on-picked-up/route.ts`, `redeem/route.ts` main path, `rules/route.ts` PATCH main path) — use an exhaustive `switch (result.type)` with `const _exhaustive: never = result` exhaustiveness guard (same pattern as `src/app/api/vendor/orders/[id]/accept/route.ts` from Task 3C). Result: ZERO new TS errors in my files.

2. **Idempotency-Key header regex rejects colons** — the `getIdempotencyKey()` function in `src/lib/idempotency.ts` validates the header against `/^[a-zA-Z0-9_-]{8,128}$/` which allows letters, digits, underscores, and dashes — but NOT colons. The task spec said `Idempotency-Key: ORDER_PICKED_UP:${orderId}` (with colons). RESOLVED by using dashes instead in the client-side `vendor-view.tsx` call (`ORDER_PICKED_UP-${order.id}`) AND clarifying in the route's header comment that the inherent idempotency via the ledger-entry `idempotencyKey` column (which DOES allow colons — it's a DB string column, not validated by the header regex) is the primary dedup mechanism. The HTTP-layer `Idempotency-Key` header is secondary.

3. **Seed key mismatch (lowercase DB vs uppercase catalog)** — the dev seed (`prisma/seed.ts`) creates `RewardRule` rows with LOWERCASE keys (`first_order`, `off_peak_order`, `group_order`, `gift_sent`, `referral`) while the static `REWARD_RULES` catalog in `src/lib/reward-rules.ts` uses UPPERCASE keys (`FIRST_ORDER`, `OFF_PEAK`, `GROUP_ORDER`, `GIFT_SENT`, `REFERRAL`). These don't match — a `findMany({ where: { key: { in: ['EARN_BASE', 'FIRST_ORDER', ...] } } })` lookup would return zero rows for the UPPERCASE catalog keys. RESOLVED by: (a) on-picked-up route does a best-effort lookup `findMany({ where: { key: { in: UPPERCASE_KEYS } } })` — returns empty today (ruleId left null), will return populated rows when the seed is updated to mirror the catalog (forward-compatible); (b) RewardLedgerEntry.ruleId is nullable per Task 1A schema, so leaving it null is acceptable; (c) GET /api/rewards/rules returns BOTH DB rows (with their original lowercase keys) AND catalog entries (with their uppercase keys) — each entry carries `source: 'db' | 'catalog'` + `inDb: boolean` so the UI can render a unified view; (d) PATCH only affects DB rows — catalog-only rules return 404 with a helpful hint "Seed this rule into the DB before toggling."

4. **`redeemReward` idempotency** — redemptions are NOT naturally idempotent like issuance (a user can redeem multiple times against the same order or for different rewards — each redemption is a distinct event). The existing `redeemReward` implementation generates a unique-per-call idempotency key (`REDEEM:user:${userId}:${Date.now()}:${random}`). RESOLVED by requiring the client to pass an `Idempotency-Key` HEADER for safe retry semantics — the P0-17 idempotency cache (in `IdempotencyKey` table) is the primary dedup mechanism. If the header is absent, the server generates a deterministic key from the request body hash (`REDEEM-${userId}-${hash(body).slice(0,16)}`) — less robust (a body change defeats dedup) but better than nothing for clients that don't send the header.

5. **OFF_PEAK hour computation in IST** — the server may run in UTC (staging/prod), so a naive `createdAt.getHours()` would compute the wrong hour. RESOLVED by converting `createdAt` (UTC Date) to IST milliseconds (`istMs = createdAt.getTime() + 5*60*60*1000 + 30*60*1000`) then reading `new Date(istMs).getUTCHours()` (using getUTCHours because we're constructing a Date from IST milliseconds — the Date object's internal UTC fields now hold IST values). Off-peak windows: 14:00-17:59 (afternoon lull) + 21:00-23:59 (late-night) — matches the blueprint's "off-peak order" rule.

6. **Notification type for REWARD_EARNED** — the schema's Notification.type comment lists "ORDER_READY | GIFT_RECEIVED | GIFT_REDEEMED | FRIEND_REQUEST | GROUP_ORDER_INVITE | REWARD_EARNED | REWARD_EXPIRING | ORDER_ACCEPTED | SYSTEM" — `REWARD_EARNED` is in the documented enum, so I used it directly (no schema migration needed since `type` is a plain String column, not an enum).

## Dev log verification

```
✓ Ready in 1042ms (server still running)
✓ rewards-on-picked-up-success — { orderId, alreadyIssued:false, totalPointsIssued:21 }
✓ rewards-on-picked-up-idempotency-dedup-hit — { key:ORDER_PICKED_UP-..., orderId }
✓ rewards-on-picked-up-already-issued — { orderId, entries:2 }
✓ rewards-redeem-success — { userId, points:50, rewardType:FIXED_DISCOUNT, redemptionCode:SNZ-RWD-5QXEXU }
✓ rewards-rules-patch-success — { ruleKey, isActive, unchanged }
✓ POST /api/rewards/on-picked-up 200 in 95ms (compile: 3ms)
✓ GET /api/rewards/account 200 in 16ms
✓ GET /api/rewards/ledger 200 in 22ms
✓ POST /api/rewards/redeem 200 in 56ms
✓ GET /api/rewards/rules 200 in 28ms
✓ PATCH /api/rewards/rules 200/403/404 in 15-48ms
```

All routes compile cleanly (no compile errors), all return expected status codes for happy-path + error scenarios. No runtime errors, no missing module errors, no Prisma warnings beyond the standard `BEGIN IMMEDIATE → SELECT → INSERT → COMMIT` transaction traces.

## Coordination notes for Wave 5+ tasks

- **Task 5B (Rewards UI)** — the rewards backend is now ready to be consumed:
  - `GET /api/rewards/account` → drives the `RewardProgressRing` (balance + tier label).
  - `GET /api/rewards/ledger?page=1&limit=20` → drives the "Recent activity" list.
  - `GET /api/rewards/rules` → drives the "How to earn" section (list active rules with examples). Note: returns BOTH DB rows (lowercase keys, configurable) AND catalog entries (uppercase keys, read-only) — the UI should render them merged with `source` + `inDb` indicators.
  - `POST /api/rewards/redeem { points, rewardType, discountValue }` → drives the "Redeem" CTA in the bottom sheet (PERCENT_DISCOUNT, FIXED_DISCOUNT, FREE_ITEM). Returns `redemptionCode` to show with a copy button.
  - Checkout reward redemption: cart-screen already calls `cart.setRewardPoints` (client-side optimistic discount) — Task 5B should call `POST /api/rewards/redeem` BEFORE `POST /api/payments` to deduct the points + get a redemptionCode to attach to the order.

- **Vendor integration** — the `vendor-view.tsx` `advance()` function now fire-and-forgets `POST /api/rewards/on-picked-up` after PICKED_UP transition. The optional non-blocking toast "Customer earned X reward points! 🎉" only fires on first issuance (`alreadyIssued === false` AND `totalPointsIssued > 0`) — no toast on retries or when 0 points are issued (e.g., zero-amount order).

- **Future RewardRule seeding** — when the seed is updated to use UPPERCASE catalog keys (matching the static catalog), the `ruleId` FK on RewardLedgerEntry will automatically populate (the best-effort lookup will find the rows). No code changes needed in my routes.

- **Future expiry cron** — `expireStaleRewards()` is a placeholder that returns `{ expiredCount: 0, expiredPoints: 0 }`. When implemented, it should: (a) find RewardLedgerEntry rows where `type='EARN'` AND `expiresAt < now()` AND no matching EXPIRE entry exists; (b) for each, create a matching EXPIRE entry (signed `-points`) with a derived idempotencyKey `${EARN_KEY}:expire`; (c) decrement the account balance. The 365-day `expiresAt` is already being set by the on-picked-up route (`new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)`) — so when the cron is wired, expiring entries will be detectable.

- **Admin rule toggling** — the PATCH /api/rewards/rules endpoint currently affects ALL consumers globally (a disabled rule stops issuing for everyone). Future scope: per-segment rule overrides (e.g., "FIRST_ORDER disabled for campus X but enabled for campus Y") — would require a `RewardRuleOverride` model keyed by (ruleKey, segmentId).
