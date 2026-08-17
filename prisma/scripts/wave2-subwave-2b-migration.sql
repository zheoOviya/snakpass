-- P0-24 Sub-Wave 2b — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds ProcessedEvent table + Outbox lease/claim fields.
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
--
-- Run via: Supabase Management API (wave2-2b-staging-migration.yml pattern) OR psql as snakzap_admin.

BEGIN;

-- ========================================
-- P0-24 2b-1: ProcessedEvent table (consumer-side idempotency)
-- ========================================
CREATE TABLE IF NOT EXISTS "ProcessedEvent" (
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "consumerId" TEXT NOT NULL DEFAULT 'default',
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadHash" TEXT,

  CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX IF NOT EXISTS "ProcessedEvent_consumerId_processedAt_idx"
  ON "ProcessedEvent"("consumerId", "processedAt");

-- ========================================
-- P0-24 2b-2: Outbox lease/claim fields (crash-safe publisher)
-- ========================================
ALTER TABLE "Outbox"
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "claimUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "workerId" TEXT;

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- ProcessedEvent: SELECT (check dedup) + INSERT (record processed) + DELETE (cleanup old)
GRANT SELECT, INSERT, DELETE ON "ProcessedEvent" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- Outbox: snakzap_app already has SELECT, INSERT, UPDATE from 2a migration.
-- The new columns (claimedAt, claimUntil, workerId) are covered by the existing GRANT.
-- snakzap_admin retains full DDL + DML on all new tables/columns.
GRANT ALL PRIVILEGES ON "ProcessedEvent" TO snakzap_admin;

COMMIT;

-- ========================================
-- Verification (informational)
-- ========================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-24 Sub-Wave 2b migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ProcessedEvent: new table (eventId PK, consumerId+processedAt indexed)';
  RAISE NOTICE 'Outbox: + claimedAt, + claimUntil, + workerId (lease/claim fields)';
  RAISE NOTICE '========================================';
END;
$$;
