-- P0-01 Wave-3 Sub-Wave 3a — Schema migration (Class-2 ADDITIVE ONLY)
-- Adds Payment, LedgerEntry, WebhookEvent models + Order.payment relation.
-- This migration is ADDITIVE — no columns dropped, no types changed, no data lost.
--
-- Run via: Supabase Management API (wave3-3a-staging-migration.yml pattern) OR psql as snakzap_admin.

BEGIN;

-- ========================================
-- P0-01: Payment table (Razorpay capture lifecycle)
-- ========================================
CREATE TABLE IF NOT EXISTS "Payment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gatewayOrderId" TEXT,
  "gatewayPaymentId" TEXT,
  "gatewaySignature" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'PAYMENT_PENDING',
  "capturedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT,
  "frozen" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_orderId_key" ON "Payment"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- Add Payment relation to Order (no ALTER TABLE needed — Prisma uses implicit relation)

-- ========================================
-- P0-02/P0-24: LedgerEntry table (double-entry, append-only)
-- ========================================
CREATE TABLE IF NOT EXISTS "LedgerEntry" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "traceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LedgerEntry_paymentId_entryType_idx" ON "LedgerEntry"("paymentId", "entryType");
CREATE INDEX IF NOT EXISTS "LedgerEntry_accountType_createdAt_idx" ON "LedgerEntry"("accountType", "createdAt");

-- ========================================
-- P0-05: WebhookEvent table (schema-only, handler in Wave-4)
-- ========================================
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "paymentId" TEXT,
  "payload" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "processedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_eventType_receivedAt_idx" ON "WebhookEvent"("eventType", "receivedAt");
CREATE INDEX IF NOT EXISTS "WebhookEvent_processed_receivedAt_idx" ON "WebhookEvent"("processed", "receivedAt");

-- ========================================
-- Grant permissions to snakzap_app (runtime role)
-- ========================================
-- Payment: SELECT, INSERT, UPDATE (capture updates status + capturedAt)
GRANT SELECT, INSERT, UPDATE ON "Payment" TO snakzap_app;
-- LedgerEntry: SELECT, INSERT only (append-only — NO UPDATE, NO DELETE)
GRANT SELECT, INSERT ON "LedgerEntry" TO snakzap_app;
-- WebhookEvent: SELECT, INSERT, UPDATE (mark processed)
GRANT SELECT, INSERT, UPDATE ON "WebhookEvent" TO snakzap_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;

-- snakzap_admin retains full DDL + DML
GRANT ALL PRIVILEGES ON "Payment" TO snakzap_admin;
GRANT ALL PRIVILEGES ON "LedgerEntry" TO snakzap_admin;
GRANT ALL PRIVILEGES ON "WebhookEvent" TO snakzap_admin;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0-01 Wave-3 Sub-Wave 3a migration complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Payment: new table (orderId unique, idempotencyKey unique, status lifecycle)';
  RAISE NOTICE 'LedgerEntry: new table (append-only, Dr/Cr pairs, paymentId indexed)';
  RAISE NOTICE 'WebhookEvent: new table (eventId unique, HMAC verification, processed flag)';
  RAISE NOTICE '========================================';
END;
$$;
