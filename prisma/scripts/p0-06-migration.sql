-- P0-06 Wave-6 — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds the Fulfilment table (1:1 to Order — parallel state machine).
--
-- This migration is ADDITIVE — no columns dropped, no types changed, no existing
-- data lost, no existing table modified. One new table is created for the
-- parallel Fulfilment state machine (NEXT_FULFILMENT_STATUS).
--
-- SAFETY CONTRACT (Orchestrator hard boundary — additive, parallel machine):
--   This migration does NOT modify the Order table beyond adding the
--   `fulfilment Fulfilment?` relation field (no schema column on Order —
--   the FK is on the Fulfilment side via `orderId @unique`).
--   Order.status (NEXT_STATUS) is UNTOUCHED. Payment/Refund/LedgerEntry/Outbox/
--   WebhookEvent/IdempotencyKey/AuditLog tables are UNTOUCHED.
--   No semantic change to existing tables.
--
-- P0-07 (pickup attribution) is INACTIVE in this wave — the pickupOtp /
-- pickupVerifiedAt / pickupVerifiedBy fields are present but unused. No
-- QR+OTP verification is performed; no RBAC on PICKED_UP.
--
-- Run via: Supabase Management API OR psql as snakzap_admin.
--          DO NOT run against production. Production remains LOCKED.

BEGIN;

-- ========================================
-- P0-06 Wave-6: Fulfilment table (1:1 to Order — parallel state machine)
-- ========================================
-- One row per Order (1:1 via @unique orderId). Parallel to Order.status —
-- has its own NEXT_FULFILMENT_STATUS machine (PREPARING → ALMOST_READY →
-- READY_FOR_PICKUP → PICKED_UP). Lazy-created on first access via
-- GET/PATCH /api/orders/[id]/fulfilment.
CREATE TABLE IF NOT EXISTS "Fulfilment" (
  "id" TEXT NOT NULL,
  -- 1:1 to Order — @unique ensures at most one Fulfilment per Order.
  "orderId" TEXT NOT NULL,
  -- Parallel state machine (NEXT_FULFILMENT_STATUS).
  "status" TEXT NOT NULL DEFAULT 'PREPARING', -- PREPARING | ALMOST_READY | READY_FOR_PICKUP | PICKED_UP
  -- JSON array of {status, at} — parallel to Order.statusHistory.
  "statusHistory" TEXT NOT NULL DEFAULT '[]',
  -- P0-25: Optimistic-locking version field. Incremented on every PATCH.
  "version" INTEGER NOT NULL DEFAULT 0,
  -- P0-07 future: pickup attribution fields (INACTIVE in this wave).
  "pickupOtp" TEXT,                       -- copied from Order.pickupOtp on lazy-create
  "pickupVerifiedAt" TIMESTAMP(3),         -- set when pickup is verified (P0-07 — not yet enforced)
  "pickupVerifiedBy" TEXT,                 -- actor who verified pickup (P0-07 — not yet enforced)
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Fulfilment_pkey" PRIMARY KEY ("id")
);

-- 1:1 unique constraint on orderId (at most one Fulfilment per Order)
CREATE UNIQUE INDEX IF NOT EXISTS "Fulfilment_orderId_key"
  ON "Fulfilment"("orderId");

-- Query index on status (for M20 detector + dashboard lookups)
CREATE INDEX IF NOT EXISTS "Fulfilment_status_idx"
  ON "Fulfilment"("status");

-- FK to Order (NO cascade — Fulfilment is audit-grade state; never silently deleted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Fulfilment_orderId_fkey'
      AND table_name = 'Fulfilment'
  ) THEN
    ALTER TABLE "Fulfilment"
      ADD CONSTRAINT "Fulfilment_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

-- ========================================
-- Backfill: create a Fulfilment row for every existing Order
-- ========================================
-- Derive status from Order.status using CASE statement (per task spec):
--   CONFIRMED, PREPARING, CANCELLED, PAID, PAYMENT_PENDING, FROZEN → PREPARING
--   ALMOST_READY       → ALMOST_READY
--   READY_FOR_PICKUP   → READY_FOR_PICKUP
--   PICKED_UP          → PICKED_UP
-- pickupOtp is copied from Order.pickupOtp (P0-07 future use).
-- Idempotent: WHERE NOT EXISTS guard prevents double-insert on re-run.
INSERT INTO "Fulfilment" ("id", "orderId", "status", "statusHistory", "version", "pickupOtp", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,                          -- Prisma uses cuid(); here we use uuid for portability
  o."id",
  CASE o."status"
    WHEN 'ALMOST_READY'      THEN 'ALMOST_READY'
    WHEN 'READY_FOR_PICKUP'  THEN 'READY_FOR_PICKUP'
    WHEN 'PICKED_UP'         THEN 'PICKED_UP'
    ELSE 'PREPARING'                                  -- CONFIRMED, PREPARING, CANCELLED, PAID, PAYMENT_PENDING, FROZEN, unknown
  END,
  '[]'::text,                                       -- empty history (backfill is not a transition)
  0,                                                 -- version 0 (initial)
  o."pickupOtp",                                     -- copy from Order.pickupOtp (P0-07 future use)
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Order" o
WHERE NOT EXISTS (
  SELECT 1 FROM "Fulfilment" f WHERE f."orderId" = o."id"
);

-- ========================================
-- Verification: every Order has exactly one Fulfilment row
-- ========================================
-- DO block that RAISES EXCEPTION if any Order lacks a Fulfilment row OR has
-- duplicate Fulfilments. Catches backfill bugs.
DO $$
DECLARE
  missing_count INTEGER;
  duplicate_count INTEGER;
BEGIN
  -- Count Orders without a Fulfilment row
  SELECT COUNT(*) INTO missing_count
  FROM "Order" o
  WHERE NOT EXISTS (SELECT 1 FROM "Fulfilment" f WHERE f."orderId" = o."id");

  -- Count Orders with more than one Fulfilment row (should be 0 due to @unique,
  -- but verify defensively in case the unique index was not applied)
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT f."orderId", COUNT(*) AS cnt
    FROM "Fulfilment" f
    GROUP BY f."orderId"
    HAVING COUNT(*) > 1
  ) dup;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'P0-06 backfill verification FAILED: % Order(s) missing a Fulfilment row', missing_count;
  END IF;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'P0-06 backfill verification FAILED: % Order(s) have duplicate Fulfilment rows', duplicate_count;
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-06 Wave-6 migration verification PASSED';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Every Order has exactly one Fulfilment row.';
  RAISE NOTICE '========================================';
END;
$$;

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- Fulfilment: SELECT, INSERT, UPDATE (status transitions + version increment)
GRANT SELECT, INSERT, UPDATE ON "Fulfilment" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "Fulfilment" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-06 Wave-6 migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Fulfilment: new table (1:1 to Order — parallel state machine).';
  RAISE NOTICE 'Backfill: one Fulfilment row per existing Order, status derived from Order.status.';
  RAISE NOTICE 'SAFETY: Order.status (NEXT_STATUS) is untouched. No Payment/Refund/Ledger mutation.';
  RAISE NOTICE 'P0-07: pickupOtp/pickupVerifiedAt/pickupVerifiedBy fields PRESENT but INACTIVE.';
  RAISE NOTICE '========================================';
END;
$$;

-- ========================================
-- Down migration (commented — reversible)
-- ========================================
-- To roll back this migration (assuming no Fulfilment rows reference any
-- outbox event with type FULFILMENT_STATUS_CHANGED — those events are
-- informational-only and have no consumer in this wave):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "Fulfilment";
-- COMMIT;
--
-- NOTE: Rolling back will lose the backfilled Fulfilment rows. Re-running the
-- migration will re-create them from current Order.status (which may have
-- changed in the meantime — backfill uses Order.status AT migration time).
-- The Order table itself is unchanged by either forward or reverse migration.
