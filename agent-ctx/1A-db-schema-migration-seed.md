# Task 1A — DB schema additions + migration + seed

**Agent:** full-stack-developer (DB schema + migration + seed)
**Wave:** 1 (Foundation) — Task 1A
**Status:** ✅ COMPLETE — all acceptance criteria pass

## Scope delivered
- Appended 13 NEW Prisma models to `prisma/schema.prisma` (Campus, RestaurantCampus, RewardAccount, RewardRule, RewardLedgerEntry, RewardRedemption, Gift, GroupOrder, GroupOrderMember, GroupOrderItem, SocialConnection, SocialActivity, Notification).
- Added 4 additive nullable columns on existing models: `User.campusId`, `Restaurant.campusId`, `Restaurant.ownerUserId` (soft FK), `Fulfilment.acceptedAt` (with extensive comment: NOT a state-machine change per Decision #1).
- Added 4 additive back-relation fields on existing models (User.campus, Restaurant.campus/restaurantCampuses/groupOrders, MenuItem.gifts/groupOrderItems) — required for the new models' relations to compile. No columns added (Prisma relation metadata only).
- Created migration `prisma/migrations/20260820112909_product_foundation_additive/migration.sql` — strictly additive (14 CREATE TABLE + 3 ALTER TABLE ADD COLUMN + 41 CREATE INDEX + 2 PRAGMA foreign_keys). ZERO DROP, ZERO MODIFY COLUMN.
- Extended `prisma/seed.ts` additively (preserved existing 255 LOC seed) with: 4 campuses, 6 RestaurantCampus junctions, 4 ownerUserId updates, 1 consumer campus link, 2 new demo consumer friends (Priya, Rahul), 6 reward rules, 1 reward account (265 pts), 6 reward ledger entries, 2 gifts (AVAILABLE), 1 group order (OPEN, 2 members, 2 items), 5 social activities, 3 social connections, 6 notifications, 9 Fulfilment rows for existing demo orders.

## Files touched
- **CREATED** (1):
  - `prisma/migrations/20260820112909_product_foundation_additive/migration.sql` (15.8 KB)
- **MODIFIED** (2, additive only):
  - `prisma/schema.prisma` (689 → 1119 LOC)
  - `prisma/seed.ts` (255 → 769 LOC)
- **NOT MODIFIED** (governance boundary respected):
  - `prisma/migrations/20260809183236_initial_schema/` + `prisma/migrations/20260809185723_audit_hash_chain/` (untouched)
  - `prisma/migrations/migration_lock.toml` (untouched)
  - `prisma/scripts/*` (untouched)
  - `src/lib/deployment.ts` (untouched — feature flags not activated)
  - `src/lib/{razorpay,reconciliation,pickup-attribution,fulfilment-state,state-invariants}.ts` (untouched)
  - All `src/app/api/*` routes (untouched — verified via smoke test GET /api/restaurants returns 200)

## Migration strategy (resolved pre-existing drift)
The dev DB had two pre-existing drift issues discovered during this task:
1. **`_prisma_migrations` table missing** — the migration history table didn't exist (DB was set up via `db:push` at some point before P0-15 disabled it). This made `prisma migrate dev` refuse to proceed (would prompt to reset).
2. **`Fulfilment` table missing** — the Fulfilment model was added to schema.prisma in P0-06 Wave-6 but the table was never applied to the dev DB (would cause vendor "Mark Almost Ready" to error).

**Resolution** (additive, governance-compliant):
1. Hand-crafted the migration SQL to use simple `ALTER TABLE ... ADD COLUMN ... TEXT REFERENCES "Campus"("id")` (with `PRAGMA foreign_keys=OFF` during the ALTER) instead of Prisma's auto-generated shadow-table pattern (which involves DROP statements). This avoids DROP entirely.
2. Included `CREATE TABLE "Fulfilment"` in the migration (with `acceptedAt` column included in the CREATE) — incidentally fixes the pre-existing drift.
3. Applied via `bunx prisma db execute --file migration.sql --schema prisma/schema.prisma` → "Script executed successfully."
4. Marked all 3 migrations as applied via `bunx prisma migrate resolve --applied <name>` (initial_schema + audit_hash_chain + product_foundation_additive) — this created the missing `_prisma_migrations` table and brought the migration history in sync.
5. Verified `bun run db:status` reports "Database schema is up to date!" with 3 migrations found.

## Acceptance criteria — all PASS
- [✓] `bun run db:generate` exits 0
- [✓] Migration creates + applies cleanly (only CREATE TABLE + ADD COLUMN + CREATE INDEX in SQL — verified via grep, ZERO DROP)
- [✓] Seed runs without error (all seed data inserted; idempotent on re-run — verified by running twice in a row)
- [✓] Existing API routes still work (curl GET /api/restaurants returns HTTP 200)
- [✓] `bunx tsc --noEmit --skipLibCheck` shows ZERO new errors in `prisma/seed.ts` (174 pre-existing errors are all in protected/out-of-scope files: mini-services/*, src/app/api/*, skills/*, .next/dev/types/validator.ts)
- [✓] No existing model's existing columns modified (verified via migration SQL diff — only ADD COLUMN + CREATE TABLE + CREATE INDEX)

## Seed data summary (counts verified via Prisma count queries)
- 4 campuses (IIT Bombay, IIM Bangalore, BITS Pilani, Christ University)
- 6 RestaurantCampus junction rows (4 restaurants → IIM Bangalore primary + Dosa Den + Sweet Tooth Bakers also → Christ University secondary)
- 4 Restaurant.ownerUserId updates (all → vendorOwner.id — soft FK)
- 1 User.campusId update (Aarav → IIM Bangalore)
- 2 new demo consumer users (Priya Patel + Rahul Mehta — for gifts + social graph)
- 6 RewardRules (first_order=50, order_streak_3=30, off_peak_order=20, group_order=40, gift_sent=25, referral=100)
- 1 RewardAccount (Aarav: balance=265, lifetimeEarned=265, lifetimeRedeemed=0)
- 6 RewardLedgerEntry rows (all EARN, sum=265 pts, tied to existing demo orders + new gift/group order; each has unique idempotencyKey + 1-year expiry)
- 2 Gifts (both status=AVAILABLE, future expiresAt 30/25 days; paymentId as placeholder soft FK)
- 1 GroupOrder (status=OPEN, shareCode="AB12CD", closes in 24h, version=0; 2 members; 2 items)
- 5 SocialActivity entries (verbs: ordered_from ×2, earned_reward, gifted, joined_group; metadata NEVER includes payment amounts — governance)
- 3 SocialConnection rows (Aarav↔Priya ACCEPTED bidirectional, Rahul→Aarav PENDING with message)
- 6 Notifications (4 for Aarav: ORDER_READY/GIFT_RECEIVED/REWARD_EARNED/FRIEND_REQUEST; 2 for Priya: GIFT_RECEIVED/GROUP_ORDER_INVITE)
- 9 Fulfilment rows created for the existing 9 demo orders (parallel state machine mapped from Order.status; acceptedAt set for non-CONFIRMED orders)

## Key decisions
1. **Fulfilment.acceptedAt as additive timestamp (NOT enum value)** — per plan Decision #1. The Fulfilment.status enum remains PREPARING → ALMOST_READY → READY_FOR_PICKUP → PICKED_UP (P0-06 boundary preserved). Schema comment documents this extensively.
2. **Restaurant.ownerUserId as soft FK** — plain String? with NO Prisma relation, to avoid touching the User model with a back-relation. Comment in schema explains this is by design for vendor RBAC on the new POST /api/vendor/orders/[id]/accept endpoint (per plan Risk R10).
3. **Gift.paymentId + recipientOrderId as soft FKs** — plain String? with NO Prisma relations to Payment/Order, to avoid touching governance-protected money-state tables (Payment) and the Order model. Payment linkage via note encoding on the ghost Order (per plan Decision #6).
4. **GroupOrder.confirmedOrderId as soft FK** — plain String? with NO Prisma relation to Order, to avoid touching the Order model. Comment in schema explains.
5. **RewardLedgerEntry.redemption back-relation as 1:1** — fixed plan's `redemptions RewardRedemption[]` to proper `redemption RewardRedemption?` since `RewardRedemption.ledgerEntryId` is `@unique` (1:1 by design per plan comment).
6. **Composite FK on GroupOrderItem.member** — `@relation(fields: [groupOrderId, userId], references: [groupOrderId, userId])` references the `@@unique([groupOrderId, userId])` on GroupOrderMember. This enforces DB-level referential integrity (user adding an item must be a member of the group).
7. **PRAGMA foreign_keys=OFF/ON around seed delete phase** — pre-existing seed deleted Order without first deleting Payment/Refund/LedgerEntry (which FK-reference Order); without this disable, re-seed fails with P2003 FK violation when prior app runtime testing left Payment rows behind. Re-enabled before any creates run.
8. **Migration applied via `prisma db execute` + `prisma migrate resolve --applied`** — instead of `prisma migrate dev` (which would detect drift and prompt to reset, losing data). This preserves the existing dev DB state while bringing the migration history in sync.

## Dependencies unblocked
This task unblocks ALL other Wave 1 tasks (1B, 1C) and the entire Wave 2-9 critical path:
- Wave 1 Task 1B (Design system components) — can now reference the new models in TypeScript types
- Wave 1 Task 1C (Shared types + Zustand stores) — can now build reward/social/gift/group/notification stores backed by the new tables
- Wave 2-9 — all subsequent waves can build on the new schema

## Next steps for downstream agents
- Read this file + the migration SQL + the schema additions to understand the new models + columns.
- The Prisma client is regenerated (`bun run db:generate` ran successfully) — new models are available as `db.campus`, `db.rewardAccount`, `db.gift`, `db.groupOrder`, `db.socialActivity`, `db.notification`, etc.
- The dev DB has all seed data loaded (4 campuses, 6 reward rules, 1 reward account with 265 pts, 2 gifts, 1 group order, 5 social activities, 6 notifications, 9 fulfilment rows).
- The migration history is clean (`bun run db:status` reports "Database schema is up to date!").
- DO NOT modify the existing migration files (initial_schema + audit_hash_chain + product_foundation_additive) — they are governance-protected.
- DO NOT use `bun run db:push` (disabled per P0-15). Use `bun run db:migrate` for future schema changes.
