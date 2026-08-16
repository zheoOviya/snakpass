-- P0-05 Wave-4 Sub-Wave 4a — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds processedBy + processingNotes columns to WebhookEvent table.
--
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
-- The new columns are NULLABLE, so existing records (with null values) remain
-- backward-compatible (webhook handler works without them).
--
-- Run via: Supabase Management API (wave4-4a-staging-migration.yml pattern) OR psql as snakzap_admin.

BEGIN;

-- ========================================
-- P0-05 Wave-4 Sub-Wave 4a: Add processedBy + processingNotes to WebhookEvent
-- ========================================
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "processedBy" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "processingNotes" TEXT;

-- Grant permissions to snakzap_app (runtime role)
-- WebhookEvent: already has SELECT, INSERT, UPDATE (from Wave-3a migration)
-- The new columns inherit the table-level grants, so no additional GRANT needed.
-- But we re-grant to be explicit:
GRANT SELECT, INSERT, UPDATE ON "WebhookEvent" TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "WebhookEvent" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-05 Wave-4 Sub-Wave 4a migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'WebhookEvent: + processedBy TEXT (nullable), + processingNotes TEXT (nullable)';
  RAISE NOTICE 'Handler implementation will use these for idempotent processing metadata.';
  RAISE NOTICE '========================================';
END;
$$;
