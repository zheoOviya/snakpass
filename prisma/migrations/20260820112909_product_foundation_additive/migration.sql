-- ============================================================================
-- Migration: product_foundation_additive (PLAN-01 / Wave 1 Task 1A)
-- ============================================================================
-- Adds new product surface models (Campus, Rewards, Gifts, Group orders,
-- Social, Notifications) + additive nullable columns on User (campusId),
-- Restaurant (campusId, ownerUserId) + Fulfilment.acceptedAt timestamp.
--
-- ALSO creates the missing Fulfilment table — pre-existing schema drift
-- (Fulfilment model exists in schema.prisma since P0-06 Wave-6 but was
-- never applied to the dev DB; db:push was used at the time, now disabled
-- per P0-15). Creating it here as part of the additive migration brings
-- the DB in sync with the schema. acceptedAt is included in the CREATE.
--
-- GOVERNANCE (blueprint §29, §50):
--   - This migration is ADDITIVE ONLY.
--   - Statements used: CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX.
--   - NO existing column is modified (no type change, no constraint change).
--   - NO existing constraint or index is altered.
--   - NO DROP statement (no DROP TABLE, no DROP COLUMN, no DROP INDEX).
--   - NO existing money-state table (Payment, Refund, LedgerEntry, Outbox,
--     WebhookEvent, IdempotencyKey, AuditLog) is touched.
--   - The fulfilment state machine (Fulfilment.status enum) is NOT modified
--     — acceptedAt is purely an informational timestamp (see schema comment).
-- ============================================================================

-- Disable FK enforcement during ALTER TABLE ADD COLUMN with REFERENCES clause
-- (SQLite restriction: cannot ADD COLUMN with REFERENCES when FK is enabled).
PRAGMA foreign_keys=OFF;

-- ===========================================================================
-- 1. CREATE TABLE — Campus (must exist before User.campusId / Restaurant.campusId)
-- ===========================================================================
CREATE TABLE "Campus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "domain" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- ===========================================================================
-- 2. ALTER TABLE ADD COLUMN — additive nullable FK columns on existing models
-- ===========================================================================
-- User.campusId (nullable FK to Campus.id)
ALTER TABLE "User" ADD COLUMN "campusId" TEXT REFERENCES "Campus" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Restaurant.campusId (nullable FK to Campus.id)
ALTER TABLE "Restaurant" ADD COLUMN "campusId" TEXT REFERENCES "Campus" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Restaurant.ownerUserId — soft FK to User.id (no REFERENCES clause BY DESIGN;
-- see schema comment: avoids touching User model with a back-relation field).
ALTER TABLE "Restaurant" ADD COLUMN "ownerUserId" TEXT;

-- ===========================================================================
-- 3. CREATE TABLE — Fulfilment (pre-existing schema drift fix)
-- ===========================================================================
-- The Fulfilment model exists in prisma/schema.prisma since P0-06 Wave-6
-- but the table was never applied to the dev DB (db:push was used at the
-- time, now disabled per P0-15). Creating it here brings the DB in sync.
-- `acceptedAt` is the new additive timestamp (Decision #1: NOT a state-
-- machine change — Fulfilment.status enum is unchanged).
CREATE TABLE "Fulfilment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "statusHistory" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "pickupOtp" TEXT,
    "pickupVerifiedAt" DATETIME,
    "pickupVerifiedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    CONSTRAINT "Fulfilment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ===========================================================================
-- 4. CREATE TABLE — Product foundation models (Campus junction, Rewards, Gift, Group, Social, Notification)
-- ===========================================================================
CREATE TABLE "RestaurantCampus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestaurantCampus_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RestaurantCampus_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RewardAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RewardRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointsFormula" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RewardLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "orderId" TEXT,
    "ruleId" TEXT,
    "giftId" TEXT,
    "groupOrderId" TEXT,
    "referralUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardLedgerEntry_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RewardRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RewardLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "RewardAccount" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "discountValue" TEXT NOT NULL,
    "orderId" TEXT,
    "redemptionCode" TEXT NOT NULL,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleRuleId" TEXT,
    CONSTRAINT "RewardRedemption_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "RewardLedgerEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_ruleRuleId_fkey" FOREIGN KEY ("ruleRuleId") REFERENCES "RewardRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Gift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "menuItemName" TEXT NOT NULL,
    "menuItemPrice" INTEGER NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "redemptionCode" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "paymentId" TEXT,
    "recipientOrderId" TEXT,
    "paidAt" DATETIME,
    "availableAt" DATETIME,
    "redeemedAt" DATETIME,
    "cancelledAt" DATETIME,
    "refundedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Gift_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "GroupOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "shareCode" TEXT NOT NULL,
    "closesAt" DATETIME NOT NULL,
    "confirmedAt" DATETIME,
    "confirmedOrderId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "GroupOrderMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupOrderMember_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GroupOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupOrderItem_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupOrderItem_groupOrderId_userId_fkey" FOREIGN KEY ("groupOrderId", "userId") REFERENCES "GroupOrderMember" ("groupOrderId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupOrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SocialConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "SocialActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'FRIENDS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Re-enable FK enforcement.
PRAGMA foreign_keys=ON;

-- ===========================================================================
-- 5. CREATE INDEX — Fulfilment indexes
-- ===========================================================================
CREATE UNIQUE INDEX "Fulfilment_orderId_key" ON "Fulfilment"("orderId");
CREATE INDEX "Fulfilment_status_idx" ON "Fulfilment"("status");

-- ===========================================================================
-- 6. CREATE INDEX — Campus indexes
-- ===========================================================================
CREATE UNIQUE INDEX "Campus_name_key" ON "Campus"("name");
CREATE UNIQUE INDEX "Campus_domain_key" ON "Campus"("domain");
CREATE INDEX "Campus_city_state_idx" ON "Campus"("city", "state");
CREATE INDEX "Campus_isActive_idx" ON "Campus"("isActive");

-- ===========================================================================
-- 7. CREATE INDEX — RestaurantCampus indexes
-- ===========================================================================
CREATE INDEX "RestaurantCampus_campusId_idx" ON "RestaurantCampus"("campusId");
CREATE UNIQUE INDEX "RestaurantCampus_restaurantId_campusId_key" ON "RestaurantCampus"("restaurantId", "campusId");

-- ===========================================================================
-- 8. CREATE INDEX — Rewards indexes
-- ===========================================================================
CREATE UNIQUE INDEX "RewardAccount_userId_key" ON "RewardAccount"("userId");
CREATE INDEX "RewardAccount_userId_idx" ON "RewardAccount"("userId");

CREATE UNIQUE INDEX "RewardRule_key_key" ON "RewardRule"("key");
CREATE INDEX "RewardRule_isActive_idx" ON "RewardRule"("isActive");

CREATE UNIQUE INDEX "RewardLedgerEntry_idempotencyKey_key" ON "RewardLedgerEntry"("idempotencyKey");
CREATE INDEX "RewardLedgerEntry_userId_createdAt_idx" ON "RewardLedgerEntry"("userId", "createdAt");
CREATE INDEX "RewardLedgerEntry_type_createdAt_idx" ON "RewardLedgerEntry"("type", "createdAt");
CREATE INDEX "RewardLedgerEntry_orderId_idx" ON "RewardLedgerEntry"("orderId");
CREATE INDEX "RewardLedgerEntry_ruleId_idx" ON "RewardLedgerEntry"("ruleId");

CREATE UNIQUE INDEX "RewardRedemption_ledgerEntryId_key" ON "RewardRedemption"("ledgerEntryId");
CREATE UNIQUE INDEX "RewardRedemption_redemptionCode_key" ON "RewardRedemption"("redemptionCode");
CREATE INDEX "RewardRedemption_userId_redeemedAt_idx" ON "RewardRedemption"("userId", "redeemedAt");
CREATE INDEX "RewardRedemption_orderId_idx" ON "RewardRedemption"("orderId");

-- ===========================================================================
-- 9. CREATE INDEX — Gift indexes
-- ===========================================================================
CREATE UNIQUE INDEX "Gift_redemptionCode_key" ON "Gift"("redemptionCode");
CREATE INDEX "Gift_senderId_createdAt_idx" ON "Gift"("senderId", "createdAt");
CREATE INDEX "Gift_recipientId_status_idx" ON "Gift"("recipientId", "status");
CREATE INDEX "Gift_status_expiresAt_idx" ON "Gift"("status", "expiresAt");

-- ===========================================================================
-- 10. CREATE INDEX — GroupOrder indexes
-- ===========================================================================
CREATE UNIQUE INDEX "GroupOrder_shareCode_key" ON "GroupOrder"("shareCode");
CREATE INDEX "GroupOrder_hostId_status_idx" ON "GroupOrder"("hostId", "status");
CREATE INDEX "GroupOrder_restaurantId_status_idx" ON "GroupOrder"("restaurantId", "status");
CREATE INDEX "GroupOrder_status_closesAt_idx" ON "GroupOrder"("status", "closesAt");
CREATE INDEX "GroupOrderMember_userId_idx" ON "GroupOrderMember"("userId");
CREATE UNIQUE INDEX "GroupOrderMember_groupOrderId_userId_key" ON "GroupOrderMember"("groupOrderId", "userId");
CREATE INDEX "GroupOrderItem_groupOrderId_userId_idx" ON "GroupOrderItem"("groupOrderId", "userId");
CREATE INDEX "GroupOrderItem_menuItemId_idx" ON "GroupOrderItem"("menuItemId");

-- ===========================================================================
-- 11. CREATE INDEX — Social indexes
-- ===========================================================================
CREATE INDEX "SocialConnection_followeeId_status_idx" ON "SocialConnection"("followeeId", "status");
CREATE INDEX "SocialConnection_followerId_status_idx" ON "SocialConnection"("followerId", "status");
CREATE UNIQUE INDEX "SocialConnection_followerId_followeeId_key" ON "SocialConnection"("followerId", "followeeId");
CREATE INDEX "SocialActivity_actorId_createdAt_idx" ON "SocialActivity"("actorId", "createdAt");
CREATE INDEX "SocialActivity_createdAt_idx" ON "SocialActivity"("createdAt");
CREATE INDEX "SocialActivity_verb_createdAt_idx" ON "SocialActivity"("verb", "createdAt");

-- ===========================================================================
-- 12. CREATE INDEX — Notification indexes
-- ===========================================================================
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");
