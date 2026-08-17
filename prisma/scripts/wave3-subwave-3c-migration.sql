-- P0-01 Wave-3 Sub-Wave 3c — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds requestHash column to IdempotencyKey table for materially-different-request detection.
--
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
-- The new column is NULLABLE, so existing records (with null requestHash) remain
-- backward-compatible (hash check is skipped when requestHash is null).
--
-- Run via: Supabase Management API (wave3-3c-staging-migration.yml pattern) OR psql as snakzap_admin.

BEGIN;

-- ========================================
-- P0-08 Wave-3 Sub-Wave 3c: Add requestHash column to IdempotencyKey
-- ========================================
ALTER TABLE "IdempotencyKey" ADD COLUMN IF NOT EXISTS "requestHash" TEXT;

-- Grant permissions to snakzap_app (runtime role)
-- IdempotencyKey: already has SELECT, INSERT, UPDATE (from Wave-1 1a migration)
-- The new column inherits the table-level grants, so no additional GRANT needed.
-- But we re-grant to be explicit:
GRANT SELECT, INSERT, UPDATE ON "IdempotencyKey" TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "IdempotencyKey" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-08 Wave-3 Sub-Wave 3c migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'IdempotencyKey: + requestHash TEXT (nullable, backward-compatible)';
  RAISE NOTICE 'When requestHashEnforcement flag is ON and requestHash is non-null,';
  RAISE NOTICE 'a hash mismatch throws IdempotencyKeyReuseError (HTTP 422).';
  RAISE NOTICE '========================================';
END;
$$;
