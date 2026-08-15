-- P0-24 — Wave-2 Sub-Wave 2a schema migration (Class-2 ADDITIVE ONLY)
-- Adds the Outbox table for transactional event persistence.
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
-- Safe to apply to staging + production (when authorized).
--
-- Run via: Supabase Management API (wave2-2a-staging-migration.yml pattern) OR psql as snakzap_admin.

BEGIN;

-- ========================================
-- P0-24: Outbox table (transactional event queue)
-- ========================================
-- The Outbox table stores events committed INSIDE the same transaction as
-- the business write. The outbox publisher worker (Sub-Wave 2b) later reads
-- PENDING rows and delivers them via Socket.io.
CREATE TABLE IF NOT EXISTS "Outbox" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),

  CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- Unique index on eventId (consumer-side idempotency key)
CREATE UNIQUE INDEX IF NOT EXISTS "Outbox_eventId_key" ON "Outbox"("eventId");

-- Index for publisher polling: WHERE status='PENDING' ORDER BY createdAt
CREATE INDEX IF NOT EXISTS "Outbox_status_createdAt_idx" ON "Outbox"("status", "createdAt");

-- Index for aggregate lookup (by aggregateType + aggregateId)
CREATE INDEX IF NOT EXISTS "Outbox_aggregateType_aggregateId_idx" ON "Outbox"("aggregateType", "aggregateId");

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- snakzap_app needs: SELECT (publisher reads), INSERT (routes write), UPDATE (publisher marks published)
GRANT SELECT, INSERT, UPDATE ON "Outbox" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "Outbox" TO snakzap_admin;

COMMIT;

-- ========================================
-- Verification (informational)
-- ========================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-24 Outbox migration complete (Sub-Wave 2a)';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Outbox: new table (eventId unique, status+createdAt indexed, aggregateType+aggregateId indexed)';
  RAISE NOTICE '========================================';
END;
$$;
