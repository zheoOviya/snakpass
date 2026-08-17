-- P0-03 Wave-5 Sub-Wave 5C — Schema migration (Class-2 ADDITIVE ONLY — M16 scoped)
-- Adds the RemediationAction table for remediation audit trail.
--
-- This migration is ADDITIVE — no columns dropped, no types changed, no existing
-- data lost, no existing table modified. One new table is created for the
-- remediation audit trail.
--
-- SAFETY CONTRACT (Orchestrator hard boundary for 5C-M16):
--   M16 remediation NEVER writes to Payment, Refund, LedgerEntry, Outbox,
--   WebhookEvent, IdempotencyKey, or AuditLog.
--   M16 remediation NEVER makes external Razorpay API calls.
--   M16 remediation's only "external" action is an HTTP call to the outbox
--   publisher's /trigger endpoint (operational restart — no financial mutation).
--   M16 remediation's only DB writes are to RemediationAction +
--   ReconciliationFinding (resolves the finding).
--
-- Scope: ONLY M16 is authorized for remediation. M3/M9/M10 + CLASS B/D/E are
--        NOT authorized — they require separate Orchestrator directives.
--
-- Run via: Supabase Management API (wave5-5c-staging-migration.yml pattern)
--          OR psql as snakzap_admin.
--          DO NOT run against production. Production remains LOCKED.

BEGIN;

-- ========================================
-- P0-03 Wave-5 Sub-Wave 5C: RemediationAction table
-- ========================================
-- Audit trail for remediation/repair actions. Currently ONLY M16 (outbox lag —
-- operational, non-financial) remediation is authorized.
CREATE TABLE IF NOT EXISTS "RemediationAction" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "repairType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ATTEMPTED',
  "actionSnapshot" TEXT NOT NULL,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "error" TEXT,

  CONSTRAINT "RemediationAction_pkey" PRIMARY KEY ("id")
);

-- FK to ReconciliationFinding (ON DELETE CASCADE — if a finding is deleted,
-- its remediation actions are deleted too).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'RemediationAction_findingId_fkey'
      AND table_name = 'RemediationAction'
  ) THEN
    ALTER TABLE "RemediationAction"
      ADD CONSTRAINT "RemediationAction_findingId_fkey"
      FOREIGN KEY ("findingId") REFERENCES "ReconciliationFinding"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Idempotency: one repair action per (findingId, repairType). A second attempt
-- to repair the same finding with the same repairType throws P2002 (unique
-- constraint) — the handler catches this and skips (SI-2: Repair Idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS "RemediationAction_findingId_repairType_key"
  ON "RemediationAction"("findingId", "repairType");

-- Query indexes for admin/dashboard lookups
CREATE INDEX IF NOT EXISTS "RemediationAction_status_attemptedAt_idx"
  ON "RemediationAction"("status", "attemptedAt");
CREATE INDEX IF NOT EXISTS "RemediationAction_repairType_idx"
  ON "RemediationAction"("repairType");

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- RemediationAction: SELECT, INSERT, UPDATE (status ATTEMPTED → SUCCEEDED/FAILED)
GRANT SELECT, INSERT, UPDATE ON "RemediationAction" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "RemediationAction" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-03 Wave-5 Sub-Wave 5C (M16-only) migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RemediationAction: new table (findingId FK → ReconciliationFinding, repairType unique per finding).';
  RAISE NOTICE 'SAFETY: M16 remediation is operational only — no money-state mutation.';
  RAISE NOTICE 'No Payment/Refund/LedgerEntry/Outbox/WebhookEvent/IdempotencyKey/AuditLog mutation.';
  RAISE NOTICE 'No external Razorpay API calls. M3/M9/M10 + CLASS B/D/E NOT authorized.';
  RAISE NOTICE '========================================';
END;
$$;
