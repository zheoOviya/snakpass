-- P0-28 + P0-10 + P0-11 — Wave-1 Sub-Wave 1b schema migration (Class-2 ADDITIVE ONLY)
-- Adds ExceptionQueue model (P0-28), Session fields (P0-10), OtpLockout model + OtpRequest field (P0-11).
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
-- Safe to apply to staging + production (when authorized).
--
-- Run via: Supabase Management API (wave1-1b-staging-migration.yml pattern) OR psql as snakzap_admin.

BEGIN;

-- ========================================
-- P0-28: ExceptionQueue table (unknown-exception handling)
-- ========================================
CREATE TABLE IF NOT EXISTS "ExceptionQueue" (
  "id" TEXT NOT NULL,
  "invariant" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "freezeLevel" INTEGER NOT NULL DEFAULT 1,
  "stateSnapshot" TEXT NOT NULL,
  "traceId" TEXT,
  "description" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExceptionQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExceptionQueue_entityType_entityId_idx" ON "ExceptionQueue"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "ExceptionQueue_freezeLevel_resolvedAt_idx" ON "ExceptionQueue"("freezeLevel", "resolvedAt");

-- ========================================
-- P0-10: Session fields (lastIp, lastActivityAt for anomaly detection + sliding refresh)
-- ========================================
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "lastIp" TEXT,
  ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ========================================
-- P0-11: OtpRequest.attemptCount (per-OTP failed verify counter)
-- ========================================
ALTER TABLE "OtpRequest"
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- ========================================
-- P0-11: OtpLockout table (per-target send/verify counters + lockout)
-- ========================================
CREATE TABLE IF NOT EXISTS "OtpLockout" (
  "id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "verifyFailCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OtpLockout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtpLockout_target_key" ON "OtpLockout"("target");

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- ExceptionQueue: SELECT (list) + INSERT (create on violation) + UPDATE (resolve)
GRANT SELECT, INSERT, UPDATE ON "ExceptionQueue" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- OtpLockout: SELECT + INSERT + UPDATE (check + record + lock)
GRANT SELECT, INSERT, UPDATE ON "OtpLockout" TO snakzap_app;

-- Session: snakzap_app already has SELECT/INSERT/UPDATE/DELETE from create-roles.sql
-- (Session is in the operational tables list). The new columns are covered by the
-- existing GRANT SELECT, INSERT, UPDATE, DELETE ON "Session" TO snakzap_app.

-- OtpRequest: snakzap_app already has permissions. New column (attemptCount) is covered.

-- snakzap_admin retains full DDL + DML on all new tables.
GRANT ALL PRIVILEGES ON "ExceptionQueue" TO snakzap_admin;
GRANT ALL PRIVILEGES ON "OtpLockout" TO snakzap_admin;

COMMIT;

-- ========================================
-- Verification queries (informational)
-- ========================================
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-28 + P0-10 + P0-11 migration complete (Sub-Wave 1b)';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ExceptionQueue: new table (invariant, entityType, entityId, freezeLevel, stateSnapshot)';
  RAISE NOTICE 'Session: + lastIp, + lastActivityAt (anomaly detection + sliding refresh)';
  RAISE NOTICE 'OtpRequest: + attemptCount (per-OTP failed verify counter)';
  RAISE NOTICE 'OtpLockout: new table (target unique, sendCount, verifyFailCount, lockedUntil)';
  RAISE NOTICE '========================================';
END;
$$;
