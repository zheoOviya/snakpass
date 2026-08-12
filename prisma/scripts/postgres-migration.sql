-- P0-27 / DEV-001 — PostgreSQL schema migration
-- Port of existing SQLite schema to PostgreSQL.
-- Run via: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/postgres-migration.sql
--
-- This migration:
--   1. Creates all 9 tables (User, OtpRequest, Session, Restaurant, MenuItem,
--      Order, OrderItem, AuditLog, KillSwitch) with PostgreSQL-compatible types.
--   2. Adds foreign keys + indexes matching the Prisma schema.
--   3. Creates WORM trigger functions (PostgreSQL syntax with CREATE FUNCTION).
--   4. Creates _prisma_migrations table for Prisma migration tracking.
--
-- IMPORTANT: This file is idempotent (uses IF NOT EXISTS / CREATE OR REPLACE).
-- It will NOT drop existing data.

BEGIN;

-- ========================================
-- 1. Identity context
-- ========================================

CREATE TABLE IF NOT EXISTS "User" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "phone"           TEXT NOT NULL UNIQUE,
    "email"           TEXT UNIQUE,
    "passwordHash"    TEXT,
    "name"            TEXT,
    "role"            TEXT NOT NULL DEFAULT 'CONSUMER',
    "spiceTolerance"  INTEGER NOT NULL DEFAULT 3,
    "walletBalance"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 2. Auth context (OTP + sessions)
-- ========================================

CREATE TABLE IF NOT EXISTS "OtpRequest" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "channel"   TEXT NOT NULL,
    "target"    TEXT NOT NULL,
    "purpose"   TEXT NOT NULL,
    "codeHash"  TEXT NOT NULL,
    "consumed"  BOOLEAN NOT NULL DEFAULT FALSE,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OtpRequest_target_purpose_idx" ON "OtpRequest"("target", "purpose");

CREATE TABLE IF NOT EXISTS "Session" (
    "token"     TEXT NOT NULL PRIMARY KEY,
    "userId"    TEXT NOT NULL,
    "role"      TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- ========================================
-- 3. Catalog context
-- ========================================

CREATE TABLE IF NOT EXISTS "Restaurant" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "cuisine"        TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "image"          TEXT NOT NULL,
    "rating"         DOUBLE PRECISION NOT NULL DEFAULT 4.5,
    "prepTimeMins"   INTEGER NOT NULL DEFAULT 20,
    "priceForTwo"    INTEGER NOT NULL DEFAULT 300,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "isActive"       BOOLEAN NOT NULL DEFAULT TRUE,
    "isSuspended"    BOOLEAN NOT NULL DEFAULT FALSE,
    "gstNumber"      TEXT NOT NULL DEFAULT '29ABCDE1234F1Z5',
    "address"        TEXT NOT NULL DEFAULT '',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "MenuItem" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "restaurantId" TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "description"  TEXT NOT NULL,
    "price"        INTEGER NOT NULL,
    "image"        TEXT NOT NULL,
    "spiceLevel"   INTEGER NOT NULL DEFAULT 1,
    "isVeg"        BOOLEAN NOT NULL DEFAULT TRUE,
    "isAvailable"  BOOLEAN NOT NULL DEFAULT TRUE,
    "category"     TEXT NOT NULL DEFAULT 'Mains',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MenuItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE
);

-- ========================================
-- 4. Ordering context
-- ========================================

CREATE TABLE IF NOT EXISTS "Order" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "userId"        TEXT NOT NULL,
    "restaurantId"  TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'CONFIRMED',
    "totalAmount"   INTEGER NOT NULL,
    "pickupOtp"     TEXT NOT NULL DEFAULT '000000',
    "isCatering"    BOOLEAN NOT NULL DEFAULT FALSE,
    "headcount"     INTEGER,
    "itemsCount"    INTEGER NOT NULL DEFAULT 0,
    "note"          TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusHistory" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id"),
    CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
);

CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "orderId"    TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "price"      INTEGER NOT NULL,
    "quantity"   INTEGER NOT NULL DEFAULT 1,
    "subtotal"   INTEGER NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE,
    CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id")
);

-- ========================================
-- 5. Governance context — AuditLog (WORM-protected)
-- ========================================

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "actorId"   TEXT,
    "actorRole" TEXT NOT NULL DEFAULT 'SYSTEM',
    "action"    TEXT NOT NULL,
    "metadata"  TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- DEV-001: Hash-chain tamper-evidence
    "prevHash"  TEXT NOT NULL DEFAULT 'GENESIS',
    "hash"      TEXT NOT NULL DEFAULT '',
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "KillSwitch" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "key"         TEXT NOT NULL UNIQUE,
    "label"       TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled"     BOOLEAN NOT NULL DEFAULT FALSE,
    "severity"    TEXT NOT NULL DEFAULT 'HIGH',
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 6. Prisma migration tracking table
-- ========================================

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                      TEXT NOT NULL PRIMARY KEY,
    "checksum"                TEXT NOT NULL,
    "finished_at"             TIMESTAMP(3) WITH TIME ZONE,
    "migration_name"          TEXT NOT NULL,
    "logs"                    TEXT,
    "rolled_back_at"          TIMESTAMP(3) WITH TIME ZONE,
    "started_at"              TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count"     INTEGER NOT NULL DEFAULT 0
);

-- ========================================
-- 7. WORM trigger functions (PostgreSQL syntax)
-- ========================================
-- These functions raise an exception on any UPDATE or DELETE attempt on AuditLog.
-- NOTE: In PostgreSQL, the application role will also have REVOKE on UPDATE/DELETE
-- at the table privilege level (see revoke-worm.sql). These triggers are a
-- secondary defense — they prevent even the table owner from accidental mutation.

CREATE OR REPLACE FUNCTION prevent_audit_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AUDIT_WORM: UPDATE rejected — audit log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AUDIT_WORM: DELETE rejected — audit log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_audit_update_trigger ON "AuditLog";
CREATE TRIGGER prevent_audit_update_trigger
    BEFORE UPDATE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_update();

DROP TRIGGER IF EXISTS prevent_audit_delete_trigger ON "AuditLog";
CREATE TRIGGER prevent_audit_delete_trigger
    BEFORE DELETE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_delete();

-- ========================================
-- 8. Updated_at trigger for Order table
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_order_updatedAt ON "Order";
CREATE TRIGGER update_order_updatedAt
    BEFORE UPDATE ON "Order"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_killswitch_updatedAt ON "KillSwitch";
CREATE TRIGGER update_killswitch_updatedAt
    BEFORE UPDATE ON "KillSwitch"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

COMMIT;

-- ========================================
-- Migration complete
-- ========================================
DO $$
BEGIN
    RAISE NOTICE 'PostgreSQL schema migration complete. Tables: User, OtpRequest, Session, Restaurant, MenuItem, Order, OrderItem, AuditLog, KillSwitch, _prisma_migrations.';
    RAISE NOTICE 'WORM trigger functions installed: prevent_audit_update, prevent_audit_delete.';
    RAISE NOTICE 'UpdatedAt triggers installed on Order + KillSwitch.';
END;
$$;
