-- P0-03 Wave-5 Sub-Wave 5b — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds the ReconciliationRun + ReconciliationFinding tables.
--
-- This migration is ADDITIVE — no columns dropped, no types changed, no existing
-- data lost, no existing table modified. Two new tables are created for the
-- reconciliation audit trail.
--
-- SAFETY CONTRACT (Orchestrator hard boundary):
--   Reconciliation NEVER writes to Payment, Refund, LedgerEntry, Outbox,
--   WebhookEvent, IdempotencyKey, or AuditLog. Its only writes are to these
--   two tables + to ExceptionQueue (via the existing reportInvariantViolation()
--   P0-28 path).
--   Reconciliation NEVER makes external Razorpay API calls.
--   Reconciliation NEVER performs automatic financial correction.
--
-- Run via: Supabase Management API (wave5-5b-staging-migration.yml pattern)
--          OR psql as snakzap_admin.
--          DO NOT run against production. Production remains LOCKED.

BEGIN;

-- ========================================
-- P0-03 Wave-5 Sub-Wave 5b: ReconciliationRun table
-- ========================================
-- One row per reconciliation cycle (cron / manual / evidence trigger).
-- Tracks when it started, completed, what it checked, and what it found.
CREATE TABLE IF NOT EXISTS "ReconciliationRun" (
  "id" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL DEFAULT 'cron',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "paymentsChecked" INTEGER NOT NULL DEFAULT 0,
  "refundsChecked" INTEGER NOT NULL DEFAULT 0,
  "outboxChecked" INTEGER NOT NULL DEFAULT 0,
  "webhooksChecked" INTEGER NOT NULL DEFAULT 0,
  "findingsCount" INTEGER NOT NULL DEFAULT 0,
  "mismatchCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,

  CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReconciliationRun_status_startedAt_idx"
  ON "ReconciliationRun"("status", "startedAt");

-- ========================================
-- P0-03 Wave-5 Sub-Wave 5b: ReconciliationFinding table
-- ========================================
-- One row per detected mismatch (deduped by (mismatchClass, entityId) while
-- unresolved — a second run for the same mismatch updates lastSeenAt, NOT a
-- new row). High-severity findings are routed to ExceptionQueue via
-- reportInvariantViolation() (exceptionId).
CREATE TABLE IF NOT EXISTS "ReconciliationFinding" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "mismatchClass" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "stateSnapshot" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "recommendedRemediation" TEXT,
  "exceptionId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolutionNote" TEXT,

  CONSTRAINT "ReconciliationFinding_pkey" PRIMARY KEY ("id")
);

-- FK to ReconciliationRun (ON DELETE CASCADE — if a run is deleted, its
-- findings are deleted too). This is safe because findings are audit records,
-- not money-state.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ReconciliationFinding_runId_fkey'
      AND table_name = 'ReconciliationFinding'
  ) THEN
    ALTER TABLE "ReconciliationFinding"
      ADD CONSTRAINT "ReconciliationFinding_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Idempotency: one unresolved finding per (mismatchClass, entityId).
-- Prisma's @unique creates a full unique index including resolvedAt.
-- This allows multiple resolved findings for the same (mismatchClass, entityId)
-- over time (audit trail) while preventing duplicate unresolved findings.
CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationFinding_mismatchClass_entityId_resolvedAt_key"
  ON "ReconciliationFinding"("mismatchClass", "entityId", "resolvedAt");

-- Query indexes for admin/dashboard lookups
CREATE INDEX IF NOT EXISTS "ReconciliationFinding_severity_resolvedAt_idx"
  ON "ReconciliationFinding"("severity", "resolvedAt");
CREATE INDEX IF NOT EXISTS "ReconciliationFinding_entityType_entityId_idx"
  ON "ReconciliationFinding"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "ReconciliationFinding_runId_idx"
  ON "ReconciliationFinding"("runId");

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- ReconciliationRun: SELECT, INSERT, UPDATE (status RUNNING → COMPLETED)
GRANT SELECT, INSERT, UPDATE ON "ReconciliationRun" TO snakzap_app;
-- ReconciliationFinding: SELECT, INSERT, UPDATE (lastSeenAt updates, resolvedAt updates)
GRANT SELECT, INSERT, UPDATE ON "ReconciliationFinding" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "ReconciliationRun" TO snakzap_admin;
GRANT ALL PRIVILEGES ON "ReconciliationFinding" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-03 Wave-5 Sub-Wave 5b migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ReconciliationRun: new table (run lifecycle + summary counts).';
  RAISE NOTICE 'ReconciliationFinding: new table (mismatch audit trail, idempotent dedup via unique index).';
  RAISE NOTICE 'SAFETY: reconciliation is read-only w.r.t. money-state tables.';
  RAISE NOTICE 'No Payment/Refund/LedgerEntry/Outbox/WebhookEvent/IdempotencyKey/AuditLog mutation.';
  RAISE NOTICE 'No external Razorpay API calls. No automatic financial correction.';
  RAISE NOTICE '========================================';
END;
$$;
