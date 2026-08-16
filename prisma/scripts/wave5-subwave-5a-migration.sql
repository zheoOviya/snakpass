-- P0-04 Wave-5 Sub-Wave 5a — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds the Refund model + Payment.refunds 1:N relation.
--
-- This migration is ADDITIVE — no columns dropped, no types changed, no existing
-- data lost. The Payment model gains a `refunds Refund[]` relation (virtual —
-- Prisma relations are implicit, no ALTER TABLE needed on Payment). The new
-- Refund table is nullable-rich so existing payment records remain fully
-- backward-compatible.
--
-- Lifecycle states introduced (values of the String-typed `status` columns):
--   Refund.status:  REFUND_PENDING → REFUNDED | FAILED
--   Payment.status: gains REFUND_PENDING + REFUNDED as new valid values
--                  (no NOT NULL constraint change, no enum — String-typed)
--
-- Run via: Supabase Management API (wave5-5a-staging-migration.yml pattern)
--          OR psql as snakzap_admin.
--          DO NOT run against production. Production remains LOCKED.

BEGIN;

-- ========================================
-- P0-04 Wave-5 Sub-Wave 5a: Refund table
-- ========================================
-- Mirrors the capture flow's 4c pattern: the route writes Refund + reversal
-- LedgerEntry pair + AuditLog + Outbox event INSIDE one txn (atomic), and the
-- publisher later calls refundRazorpayPayment() OUTSIDE any txn (per the
-- TRANSACTION_RETRY_INVARIANT).
CREATE TABLE IF NOT EXISTS "Refund" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'REFUND_PENDING',
  "gatewayRefundId" TEXT,
  "idempotencyKey" TEXT,
  "failureReason" TEXT,
  "refundedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- 1:1 idempotency-key linkage (refund double-click dedup). NULL for refunds
-- created without an Idempotency-Key header (still allowed — dedup is opt-in).
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- Publisher polls WHERE status='REFUND_PENDING' ORDER BY createdAt for refunds
-- that need processing. Also used by the verify endpoint for state checks.
CREATE INDEX IF NOT EXISTS "Refund_paymentId_status_idx" ON "Refund"("paymentId", "status");
CREATE INDEX IF NOT EXISTS "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- Foreign key to Payment. ON DELETE RESTRICT — never allow deleting a Payment
-- that has Refunds (preserve audit trail). Refunds are append-only financial
-- records.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Refund_paymentId_fkey'
      AND table_name = 'Refund'
  ) THEN
    ALTER TABLE "Refund"
      ADD CONSTRAINT "Refund_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- Refund: SELECT, INSERT, UPDATE (publisher transitions status REFUND_PENDING → REFUNDED)
GRANT SELECT, INSERT, UPDATE ON "Refund" TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "Refund" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-04 Wave-5 Sub-Wave 5a migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Refund: new table (paymentId FK → Payment, idempotencyKey unique, status lifecycle)';
  RAISE NOTICE 'Payment.refunds 1:N relation is implicit (no ALTER TABLE on Payment).';
  RAISE NOTICE 'realPayments remains OFF — refundRazorpayPayment() returns mock success in demo mode.';
  RAISE NOTICE '========================================';
END;
$$;
