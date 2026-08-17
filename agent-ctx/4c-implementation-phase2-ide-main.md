# Task 4c-implementation-phase2 — Outbox Publisher PAYMENT_CAPTURE_REQUESTED Handler

**Agent**: IDE (main)
**Date**: 2026-08-16
**Wave**: 4 (Sub-Wave 4c, Phase 2)
**Predecessor**: `4c-implementation-phase1` (capture route moved captureRazorpayPayment out of withTransaction body; writes Payment CAPTURE_PENDING + Outbox PAYMENT_CAPTURE_REQUESTED).

---

## Task

Add a `PAYMENT_CAPTURE_REQUESTED` event handler to `mini-services/outbox-publisher/index.ts` so the publisher consumes the command event emitted by the capture route in Phase 1 and performs the actual Razorpay capture (safely OUTSIDE any transaction body).

Required behavior (per task spec):
1. Read the Payment from DB (using the aggregateId from the outbox event payload — aggregateId == payment.id).
2. Idempotency check: if `Payment.status === 'CAPTURED'` → mark outbox event PUBLISHED (capture already happened, e.g., webhook raced ahead).
3. If `CAPTURE_PENDING` → call `captureRazorpayPayment()` OUTSIDE any txn.
4. On success → open a NEW `withTransaction()` (here: `db.$transaction()`) → update Payment.status to CAPTURED + capturedAt + AuditLog (PAYMENT_CAPTURED) → mark outbox event PUBLISHED.
5. On failure → increment Payment.retryCount, set failureReason, leave status as CAPTURE_PENDING, mark outbox event as still PENDING (via throw → publisher's existing retry/backoff/FAILED catch block).

Constraints:
- Do NOT enable `realPayments` (still OFF — demo mode).
- Do NOT modify `db.ts` or `idempotency.ts`.
- Do NOT start Wave-5.
- Use Prisma client directly (publisher imports its own `new PrismaClient()`).
- Keep the existing publisher pattern (claim/lease, process, mark PUBLISHED).

## What I Read (Prior Agent Context)

The Phase 1 worklog entry (in `/home/z/my-project/worklog.md`, Task ID `4c-implementation-phase1`) establishes:
- `src/app/api/payments/route.ts` now writes Payment with `status: 'CAPTURE_PENDING'` and `capturedAt: null`.
- Outbox event: `eventType: 'PAYMENT_CAPTURE_REQUESTED'`, `aggregateType: 'Payment'`, `aggregateId: payment.id`, `payload: { paymentId, orderId, gatewayPaymentId, amount }`.
- AuditLog action: `PAYMENT_CAPTURE_PENDING`.
- Capture is deferred to the publisher (Phase 2 = this task).
- `realPayments=false` (demo mode), so `captureRazorpayPayment()` returns mock success.

Other reads:
- `mini-services/outbox-publisher/index.ts` (pre-change): cron-triggered, lease-based atomic claim (`PENDING → CLAIMED`), dispatch via `EVENT_TYPE_TO_SOCKET` lookup that THREW on unknown event types — meaning `PAYMENT_CAPTURE_REQUESTED` would have been marked FAILED after MAX_RETRIES.
- `src/lib/razorpay.ts`: `captureRazorpayPayment(razorpayPaymentId, amount, currency)` → `{ captured, gatewayPaymentId, signature }`. Demo mode returns hardcoded `{ captured: true, ... }`.
- `src/lib/db.ts` + `src/lib/idempotency.ts`: confirmed NOT to modify.
- `prisma/schema.prisma`: Payment.status is plain String (CAPTURE_PENDING is just a value — no migration).
- `src/lib/webhook-processor.ts`: reference pattern for `tx.auditLog.create()` without explicit hash-chain fields (relies on schema defaults `prevHash='GENESIS'`, `hash=''`).

## What I Changed

**File**: `mini-services/outbox-publisher/index.ts` (+297 lines, single file, single commit `185826d`).

1. **Import** `captureRazorpayPayment` via relative path `../../src/lib/razorpay` (publisher is a standalone Bun service — cannot use the Next.js `@/lib/*` tsconfig alias).

2. **`COMMAND_EVENT_TYPES` set** (`new Set(['PAYMENT_CAPTURE_REQUESTED'])`) — distinguishes command events (trigger a business op) from transport events (realtime fanout). Command events are routed to dedicated handlers and intentionally NOT added to `EVENT_TYPE_TO_SOCKET`.

3. **Extended `LogEntry` interface** with optional `paymentId`, `orderId`, `count` fields for capture-handler log lines.

4. **`processPaymentCaptureRequested(event)` function** (~235 lines incl. doc comments):
   - Parses payload → reads Payment by `event.aggregateId`.
   - Idempotency: `status === 'CAPTURED'` → mark outbox PUBLISHED + return.
   - If status ≠ CAPTURE_PENDING (e.g., FAILED, FROZEN) → throw.
   - Calls `captureRazorpayPayment()` **OUTSIDE any transaction body** (the Wave-4 4c safety improvement).
   - On capture-call exception OR `captured=false`: increment Payment.retryCount + set failureReason → rethrow (publisher catch handles outbox retry/backoff).
   - On success: NEW `db.$transaction()` atomically commits (a) Payment `CAPTURE_PENDING → CAPTURED` + capturedAt (race-safe conditional `updateMany` WHERE status='CAPTURE_PENDING'), (b) AuditLog `PAYMENT_CAPTURED` if `updated.count > 0` (skip if webhook raced ahead — webhook writes its own `WEBHOOK_PAYMENT_CAPTURED`), (c) Outbox.status=PUBLISHED (always — capture command effect achieved).

5. **Dispatch wiring** in `publishPendingEvents()` event loop: added `if (COMMAND_EVENT_TYPES.has(event.eventType)) { await processPaymentCaptureRequested(event); result.published++; continue }` BEFORE the `EVENT_TYPE_TO_SOCKET` lookup. The `continue` is critical: the handler owns its own outbox state transitions; the post-transport PUBLISHED marking must be skipped.

## Verification

- `bun run lint` → **PASS** (no errors, no warnings). Confirmed mini-services/ IS in the eslint scope (eslint.config.mjs `ignores` does not list mini-services).
- TypeScript strict check via `bunx tsc --noEmit` reports 4 pre-existing errors in this file (all unrelated to Phase 2: `import.meta.dir`, `Bun.serve`, `consumerProcessed`, `result` — all pre-existing) + 1 pre-existing in src/lib/razorpay.ts. None introduced by my changes; none affect Next.js build (publisher is a standalone Bun service).
- Dev server (auto on port 3000) hot-reloaded without errors.

## Constraints Honored

- ✅ realPayments stays OFF (demo mode — captureRazorpayPayment returns mock success).
- ✅ db.ts untouched.
- ✅ idempotency.ts untouched.
- ✅ schema.prisma untouched (CAPTURE_PENDING is a String value).
- ✅ Capture route untouched (already writes PAYMENT_CAPTURE_REQUESTED per Phase 1).
- ✅ Wave-5 NOT started.
- ✅ Existing publisher pattern preserved (cron-triggered, lease-based atomic claim, BATCH_SIZE=10, MAX_RETRIES=5, BACKOFF_SCHEDULE_MS, stale-CLAIMED recovery).

## Design Decisions (Non-Obvious)

- **No retry-on-conflict on the success txn**: `db.$transaction()` used directly (not `withTransaction()`). The publisher can't import `withTransaction` without dragging in the Next.js `db` singleton. The success txn is short (3 writes, no row contention expected). If a P2034 conflict happens, the throw → publisher retry → next iteration finds Payment CAPTURED (webhook raced ahead OR prior retry's txn committed before the throw) → idempotency path → mark PUBLISHED. Self-healing.
- **AuditLog hash-chain**: handler uses `tx.auditLog.create({ ... })` directly (NOT the `audit()` helper from src/lib/audit.ts, which would pull in the Next.js `db` singleton). Schema defaults `prevHash='GENESIS'`, `hash=''` apply. Consistent with `webhook-processor.ts` pattern. Hash-chain weakness is a pre-existing known condition.
- **`capturedAt` only when we win the race**: `updateMany WHERE status='CAPTURE_PENDING'` is conditional; if webhook already set CAPTURED, `updated.count === 0` and we skip the AuditLog (webhook writes its own). Outbox PUBLISHED is marked in both branches.
- **Demo-mode gap from Phase 1 is now CLOSED**: Payments now transition CAPTURE_PENDING → CAPTURED on the publisher's next cycle (within ~1 minute of the capture route committing).

## Known Limitations (Real-Mode Only — NOT Demo)

If the success-path txn fails to commit AFTER a real capture succeeded, the next publisher retry calls `captureRazorpayPayment()` again. Razorpay's capture API rejects re-capture ("already captured") → surfaces as capture-call failure → Payment.retryCount++. Self-healing in real mode relies on (a) the webhook arriving in the interim OR (b) manual reconciliation via the alerting system. This is a real-mode concern; demo mode is unaffected. Full real-mode reconciliation is Wave-5 scope.

## Commit

- `185826d` — Wave-4 4c Phase 2: PAYMENT_CAPTURE_REQUESTED handler in outbox publisher
- Pushed to `origin/main` (zheoOviya/snakpass).

## Next

Phase 2 complete. Awaiting Orchestrator direction on:
- 4c evidence runner (if required) — can now verify CAPTURE_PENDING → CAPTURED end-to-end without a publisher stub.
- Wave-5 (NOT started — explicitly out of scope).
