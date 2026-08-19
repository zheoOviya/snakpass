# Code Review Checklist — Payment / Transaction Code

> This checklist is required for every PR touching `src/app/api/payments/` or any
> route that calls `captureRazorpayPayment()`, `createRazorpayOrder()`,
> `refundRazorpayPayment()`, or `enqueueOutboxEvent()`.
>
> Reference: `docs/TRANSACTION_RETRY_INVARIANT.md` §8.2 item 1 (HB-15)

## Mandatory Checklist

Before merging a PR that touches payment/transaction code, the reviewer MUST:

- [ ] **Cite this document** in the PR description with a link to
  `docs/CODE_REVIEW_CHECKLIST.md`.
- [ ] **Confirm external call placement** — verify that
  `captureRazorpayPayment()`, `createRazorpayOrder()`,
  `refundRazorpayPayment()`, and any other non-idempotent external HTTP call is
  NOT placed inside a `withTransaction(async (tx) => { ... })` body.
  - External calls must be deferred to the outbox publisher (Option C pattern).
  - If the call must be inside the transaction (e.g., `createRazorpayOrder()`
    which creates the gateway order ID), verify that a pre-generated
    `X-Idempotency-Key` header is passed so the gateway deduplicates on retry.
- [ ] **Verify outbox event** — if the PR introduces a new payment/transaction
  flow, confirm it enqueues an outbox event inside the same transaction.
- [ ] **Verify idempotency** — if the route accepts state-changing POST/PATCH,
  confirm it supports the `Idempotency-Key` header (P0-17 pattern).
- [ ] **Run `bun run lint`** — must pass (exit 0). The custom ESLint rule
  (`no-external-call-in-transaction`) will flag violations.
- [ ] **Run CI gate** — `scripts/check-transaction-invariant.sh` must pass
  (no `captureRazorpayPayment(` / `createRazorpayOrder(` /
  `refundRazorpayPayment(` inside `withTransaction(` blocks outside the
  publisher).

## What this checklist protects

The `TRANSACTION_RETRY_INVARIANT` states:

> Any non-idempotent external call inside a `withTransaction()` body will be
> re-executed on P2034 retry, causing duplicate side effects at the gateway
> (double-capture, double-refund, orphan orders).

This checklist is the human-review layer that complements:
- The ESLint rule (automated static analysis — item 2)
- The CI gate (automated grep-scan — item 5)
- The outbox publisher pattern (architectural mitigation — item 3, DONE)
- The pre-generated idempotency key (gateway mitigation — item 4, DONE)

## Scope

This checklist applies to:
- `src/app/api/payments/**/route.ts`
- `src/app/api/orders/**/route.ts` (if it calls payment functions)
- `mini-services/outbox-publisher/index.ts` (publisher — exempt from the
  "inside withTransaction" rule because the publisher calls are intentionally
  outside the transaction body)
- Any new file that imports from `src/lib/razorpay.ts`
