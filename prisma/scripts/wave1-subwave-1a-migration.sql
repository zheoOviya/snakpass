-- P0-25 + P0-17 — Wave-1 Sub-Wave 1a schema migration (Class-2 expand-migrate-contract, ADDITIVE ONLY)
-- Adds optimistic-lock version fields + IdempotencyKey model.
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
-- Safe to apply to staging + production (when authorized).
--
-- Run via: Supabase Management API (dev-001-sql-execution.yml pattern) OR psql as snakzap_admin.
-- NOT run as snakzap_app (role lacks DDL privileges by design).

BEGIN;

-- ========================================
-- P0-25 Case A: MenuItem inventory race protection
-- ========================================
-- availableCount: NULL = unlimited availability (default; existing items stay infinite)
-- version: optimistic-lock counter, starts at 0 for all existing rows
ALTER TABLE "MenuItem"
  ADD COLUMN IF NOT EXISTS "availableCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- ========================================
-- P0-25 Case B: Order state-transition race protection
-- ========================================
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- ========================================
-- P0-25: KillSwitch toggle race protection
-- ========================================
ALTER TABLE "KillSwitch"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- ========================================
-- P0-17: IdempotencyKey store
-- ========================================
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "responseBody" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on key (one response per idempotency key)
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- Index for resource lookup (by resourceType + resourceId)
CREATE INDEX IF NOT EXISTS "IdempotencyKey_resourceType_resourceId_idx" ON "IdempotencyKey"("resourceType", "resourceId");

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- snakzap_app needs SELECT + INSERT on IdempotencyKey (read cached + store new).
-- No UPDATE/DELETE needed (keys expire via TTL; cleanup is a Phase-3 cron task).
GRANT SELECT, INSERT ON "IdempotencyKey" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML (already granted by create-roles.sql, but
-- re-grant on the new table to be safe).
GRANT ALL PRIVILEGES ON "IdempotencyKey" TO snakzap_admin;

COMMIT;

-- ========================================
-- Verification queries (informational)
-- ========================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-25 + P0-17 migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MenuItem: + availableCount (nullable), + version (default 0)';
  RAISE NOTICE 'Order: + version (default 0)';
  RAISE NOTICE 'KillSwitch: + version (default 0)';
  RAISE NOTICE 'IdempotencyKey: new table (key unique, resourceType+resourceId indexed)';
  RAISE NOTICE '========================================';
END;
$$;
