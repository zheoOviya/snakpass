# Wave-1 Gate Review Report — SnakZap

**Review Date:** 2026-08-14
**Reviewer:** IDE (read-only, Orchestrator-authorized)
**Authorization:** READ-ONLY Wave-1 Gate Review ONLY
**Scope:** Answer 9 governance questions for Wave-1 execution planning. NO code changes, NO deployments, NO migrations, NO production modifications.
**Predecessor:** Wave-0 CLOSED ✅ (Task 63)

---

## Executive Summary

| # | Question | Answer |
|---|----------|--------|
| 1 | What P0/P1 items are in Wave-1? | **6 P0s** (not 3): P0-25, P0-17, P0-26, P0-28, P0-10, P0-11. **0 P1 items** (all P1 is post-launch). |
| 2 | Current actual status of each? | 3 GREENFIELD (P0-17, P0-25, P0-28); 1 MIXED (P0-26); 2 PARTIALLY-EXISTING (P0-10, P0-11). 0 at S4+ lifecycle. |
| 3 | Dependencies blocking Wave-1? | All 6 depend only on Wave-0 P0s (now CLOSED). No external blockers. Shared prerequisite: `withTransaction()` helper in `src/lib/db.ts`. |
| 4 | Already-complete tasks? | **0 of 6 Wave-1 P0s are complete.** All at S2 (Specified). Skeleton code exists for P0-10/P0-11 from Wave-0. |
| 5 | Obsolete/deferred tasks? | P0-25 Case C (payment duplicate) + P0-26 post-restore reconciliation **cannot fully close in Wave-1** — require Wave-3 Payment model (P0-01). |
| 6 | Production-impacting tasks? | **YES.** P0-26 (DR drill) is BOTH a Wave-1 P0 AND §14.1 launch-gate condition 4. P0-25 has CRITICAL blast radius (oversell / state-machine corruption). |
| 7 | Required authorization boundaries? | 5 boundaries identified (schema migrations, shared helper, P0-26 split, P0-16 pg_dump gate, Wave-1 closure gate). |
| 8 | Single-wave vs sub-waves? | **SUB-WAVES recommended.** 3 sub-waves: (1a) P0-25 + shared helper + P0-17; (1b) P0-28 + P0-10 + P0-11; (1c) P0-26 design only (drill deferred). |
| 9 | Per-task Do/Don't/Evidence/Exit? | Full matrix below. |

### Critical Governance Finding
**No documented Wave-1 closure gate exists** (parallel to `WAVE0_EVIDENCE.md` line 5). This is a governance documentation gap. Before Wave-1 execution, the Orchestrator should authorize creation of `WAVE1_EVIDENCE.md` defining the closure gate explicitly.

---

## Q1 — What P0/P1 items are in Wave-1?

### Authoritative Wave-1 Scope: 6 P0s

**Sources:** `IMPLEMENTATION_ORDER.md` §3 Wave 1; `SPRINT_PLAN.md` §2 Sprint 2; `worklog.md` lines 537, 667.

| # | P0 | Capability | Risk Tier | Wave-0 Predecessor |
|---|----|-----------|-----------|--------------------|
| 1 | **P0-25** | Concurrency + version fields (3 cases) | Tier 2 (HIGH) | P0-15 |
| 2 | **P0-17** | Idempotency on critical writes | Tier 4 | P0-15 |
| 3 | **P0-26** | Disaster recovery (business recovery) | Tier 3 | P0-16 |
| 4 | **P0-28** | Unknown-exception handling (3 blast-radius levels) | Tier 3 | P0-19/20/21/22 |
| 5 | **P0-10** | Session integrity (refresh, revoke, active sessions) | Tier 4 | P0-09 |
| 6 | **P0-11** | OTP retry limits + phone validation | Tier 4 | P0-09 (P0-13 non-blocking) |

### P1 items in Wave-1: NONE
Per `PRODUCTION_READINESS_MATRIX.md` §7.2, all 22 P1 capabilities are explicitly post-launch. The 8-wave implementation order assigns only P0s to waves 0-7.

### P0-24 (Transactional data integrity) is Wave-2 — confirmed
Depends on P0-15 (Wave-0) AND P0-25 (Wave-1). Cannot start until P0-25 reaches `Dependency-ready`.

---

## Q2 — Current Actual Status (Code-Level)

| P0 | Status | What exists | What is GREENFIELD |
|----|--------|-------------|---------------------|
| **P0-17** | 🔴 GREENFIELD | Nothing — no `IdempotencyKey` model, no header handling, no library file (`src/lib/idempotency.ts` absent), no API route accepts idempotency keys | Everything: schema model, library, header parsing, dedup lookup, retry-safe wrapper |
| **P0-25** | 🔴 GREENFIELD | Feature flag `concurrencyControl` exists in `src/lib/deployment.ts:39` but defaults OFF and is NEVER imported (dead code). No `version` fields on Order/MenuItem/KillSwitch. No `$transaction` usage in any route. | Cases A (inventory), B (state-transition), C (payment). Case C needs Wave-3 Payment model. |
| **P0-26** | 🟡 MIXED | `src/lib/backup.ts` (SQLite copy + SHA-256); `POST /api/backup` admin endpoint; `dr-drill-failed` alert rule (hardcoded to "passing"); `drDrillMode` feature flag (dead code); `docs/BACKUP_REPLACEMENT_PLAN.md` §3.6 pseudocode | `restoreFromBackup()`, `runRestoreDrill()`, post-restore reconciliation, restore runbook, monthly-drill CI workflow. SQLite backup incompatible with PostgreSQL. |
| **P0-28** | 🔴 GREENFIELD | Structural scaffolding only: `[P0-EXCEPTION]` log tag; `unknown-state-detected` alert rule. NO invariant-checker, NO ExceptionQueue model, NO freeze implementation. | Invariant-checker module; ExceptionQueue Prisma model; 3-level freeze state machine; over-freeze-prevention audit |
| **P0-10** | 🟡 PARTIALLY-EXISTING | `src/lib/session.ts` (92 lines): createSession, setSessionCookie (now sets CSRF too), getSessionUser, destroySession. `Session` model. `POST /api/auth/logout`. | revokeSession(token), revokeAllSessionsForUser, listActiveSessions endpoint, sliding refresh-token rotation, session-anomaly metric |
| **P0-11** | 🟡 PARTIALLY-EXISTING | `src/lib/otp-service.ts` (71 lines): createOtp, verifyOtp (consumed/expiry checks). `OtpRequest` model. phoneSchema E.164 validation. Per-IP rate limit (5 sends/window). | Per-target attempt counter (max 5/10min), per-target send counter (max 3/10min), 10-min lockout enforcement, OTP-attempt metric, brute-force alert rule |

### Lifecycle State
All 6 Wave-1 P0s are at **S2 (Specified)** per `P0_TRACEABILITY_MAP.md` line 30. 0 at S4 (Implemented) or beyond.

---

## Q3 — Dependencies That Block Wave-1

### External Dependencies (all satisfied — Wave-0 CLOSED)
All 6 Wave-1 P0s depend only on Wave-0 P0s (now CLOSED). No external blockers remain.

### Internal Dependencies Among Wave-1 P0s
- **P0-17 ↔ P0-25:** NO direct dependency. Both depend only on P0-15 (closed). Parallelizable.
- **P0-26:** Depends on P0-16 (backup). P0-26's post-restore reconciliation needs Payment model (Wave-3 P0-01).
- **P0-28:** Depends on P0-19/20/21/22 (all Wave-0, closed). No Wave-1 internal deps.
- **P0-10, P0-11:** Depend on P0-09 (Wave-0, closed). No Wave-1 internal deps.

### Shared Prerequisites (HIGH-PRIORITY)
| Shared infra | Needed by | Current state | Priority |
|--------------|-----------|----------------|----------|
| `withTransaction()` helper in `src/lib/db.ts` | P0-17 (key + write atomic), P0-25 (check-then-write atomic) | ❌ ABSENT (only PrismaClient singleton) | **AUTHOR FIRST** — foundational utility |
| Prisma migration framework | P0-17 (IdempotencyKey model), P0-25 (version fields) | ✅ Exists (P0-15 closed) | Coordinate migration order |
| `pg_dump` backup rewrite (P0-16 Phase-3 deferral) | P0-26 (DR drill needs restorable backup) | ❌ Not implemented | **P0-26 is GATED on this** — Orchestrator decision required |

---

## Q4 — Already-Complete Tasks

**0 of 6 Wave-1 P0s are complete.** All at S2 (Specified).

### Partially-Existing Skeleton Code (from Wave-0)
- P0-10: session.ts skeleton (createSession, getSessionUser, destroySession) — Wave-0 basics
- P0-11: otp-service.ts skeleton (createOtp, verifyOtp) — Wave-0 basics
- P0-26: backup.ts (SQLite copy) — Wave-0 P0-16 partial

These are Wave-0 leftovers that Wave-1 will harden/extend, not full implementations.

---

## Q5 — Obsolete / Deferred Tasks

### Cannot Fully Close in Wave-1 (require Wave-3)
| Task | Why deferred | Wave-1 actionable part |
|------|--------------|----------------------|
| **P0-25 Case C** (payment duplicate) | Needs Payment model + Razorpay SDK (Wave-3 P0-01) | P0-17 idempotency infrastructure (the dedup mechanism) — prepares for P0-01 wiring |
| **P0-26 post-restore reconciliation** | Needs Payment model to reconcile money state | DR design + runbook + restore script (without reconciliation) |

### P0-26 DR Drill Execution — Gated on P0-16 pg_dump Rewrite
P0-16's backup is SQLite-coupled and returns 500 on Vercel serverless. The `pg_dump` rewrite was deferred to Phase 3. P0-26's DR drill **cannot execute** without a restorable backup.

**Orchestrator decision required:**
- **(a)** Bring P0-16's `pg_dump` rewrite forward into Wave-1 (unblocks P0-26 fully), OR
- **(b)** Split P0-26 into "design + runbook" (Wave-1 closeable) vs "drill execution + reconciliation" (Phase 3 / post-P0-01)

### Obsolete: NONE
No Wave-1 P0s are obsolete. All 6 remain launch-mandatory per `PRODUCTION_READINESS_MATRIX.md` §14.1.

---

## Q6 — Production-Impacting Tasks

### YES — Multiple Wave-1 Tasks Have Production Impact

| P0 | Production impact | Blast radius if wrong |
|----|-------------------|----------------------|
| **P0-26** (DR) | **DUAL OBLIGATION** — Wave-1 P0 AND §14.1 launch-gate condition 4 ("DR drill passed including post-restore business-state reconciliation") | CRITICAL — drill against stale/partial backup = NO-GO for production launch |
| **P0-25 Case A** (inventory) | Schema change (`availableCount` + `version` on MenuItem) | CRITICAL — oversell (vendor can't fulfil → refund + trust loss) OR false 409 (lost sale) |
| **P0-25 Case B** (state-transition) | Schema change (`version` on Order + KillSwitch) | CRITICAL — last-writer-wins = silent state-machine corruption; statusHistory accumulates conflicting transitions |
| **P0-17** (idempotency) | Schema change (`IdempotencyKey` model); Class-2 expand-migrate-contract migration | HIGH — if idempotency check + business write NOT in same txn, crash between them creates "phantom block" (key consumed but write failed → user cannot retry) |
| **P0-28** (exception handling) | New ExceptionQueue model; freeze state machine | MEDIUM — over-freeze (Level 3 when Level 1 would suffice) stops the platform; under-freeze lets corruption spread |
| **P0-10** (session) | New endpoints; sliding refresh | MEDIUM — refresh-token bug = session loss OR session hijack |
| **P0-11** (OTP) | Per-target counters; lockout | LOW-MEDIUM — brute-force vulnerability if counters fail |

### Database Schema Changes Required
- P0-17: new `IdempotencyKey` model
- P0-25: `version` + `availableCount` fields on MenuItem; `version` on Order + KillSwitch
- P0-28: new `ExceptionQueue` model
- P0-10, P0-11, P0-26: optional schema additions (active-sessions view, lockout fields, DrDrillResult)

**All schema migrations are Class-2 (expand-migrate-contract)** per P0-27's 3-class framework. They must be applied via the documented 11-step cutover sequence, NOT via `prisma migrate dev` directly against production.

---

## Q7 — Required Authorization Boundaries for Wave-1 Execution

### Boundary 1: Schema Migrations (Class-2 expand-migrate-contract)
All P0-17, P0-25, P0-28 schema changes MUST follow the expand-migrate-contract pattern. The Orchestrator must authorize:
- Migration script creation (repository-local)
- Staging migration application (against staging Supabase — `snakzap_admin` role)
- **NO production migration** (production DATABASE_URL still uses `postgres` superuser — must be fixed to `snakzap_app` first per Wave-0 governance review)

### Boundary 2: Shared `withTransaction()` Helper
Must be authored FIRST as a foundational utility before P0-17 or P0-25. Orchestrator should authorize this as a standalone task before the P0-17/P0-25 implementation tasks.

### Boundary 3: P0-26 Split Decision
Orchestrator must choose:
- **(a)** Bring P0-16 `pg_dump` rewrite forward into Wave-1 (unblocks full P0-26), OR
- **(b)** Split P0-26 into "design + runbook" (Wave-1) vs "drill execution + reconciliation" (Phase 3)

### Boundary 4: P0-25 Case C + P0-26 Reconciliation Deferral
Explicitly mark these as "Wave-1 prepares infrastructure; full verification deferred to Wave-3 (post-P0-01)". Do NOT attempt to fully close them in Wave-1.

### Boundary 5: Wave-1 Closure Gate Documentation (GOVERNANCE GAP)
**No `WAVE1_EVIDENCE.md` exists.** Before Wave-1 execution, authorize creation of this document defining:
1. What lifecycle state must each Wave-1 P0 reach? (Likely S9 Production-ready, parallel to Wave-0)
2. Does Wave-1 closure require the DR drill to PASS (§14.1 condition 4), or is DR drill deferred to production launch gate?
3. Does Wave-1 closure require all 6 P0s at S9, or only P0-25 (the Wave-2 critical-path unlock)?
4. What deviations are anticipated, and what's their closure path?

---

## Q8 — Single-Wave vs Sub-Waves Execution Strategy

### Recommendation: SUB-WAVES (3 sub-waves)

**Rationale:** The 6 Wave-1 P0s have different risk profiles, dependencies, and blast radii. A single execution wave would mix CRITICAL schema changes (P0-25) with LOW-RISK hardening (P0-10, P0-11). Sub-waves allow:
- Controlled schema migration sequencing
- Shared helper authoring before dependent P0s
- P0-26 split (design vs drill) without blocking the other 5 P0s
- Earlier Wave-2 unlock (P0-24 only needs P0-25, not all 6)

### Sub-Wave 1a — Foundation + Critical Path (P0-25 + P0-17 + shared helper)
**Scope:**
1. Author `withTransaction()` helper in `src/lib/db.ts` (shared prerequisite)
2. P0-25 Cases A + B (inventory race + state-transition race)
3. P0-17 (idempotency infrastructure — schema + library + header parsing)
4. Single coordinated Prisma migration (version fields + IdempotencyKey model)

**Exit criteria:**
- `withTransaction()` helper exists + tested
- P0-25 Case A: concurrent POST /api/orders with 1 remaining item → exactly 1 succeeds, other gets 409
- P0-25 Case B: concurrent PATCH /api/orders/[id]/status with conflicting transitions → exactly 1 succeeds, other gets 409
- P0-17: POST /api/orders with same Idempotency-Key → same response (dedup works)
- Staging smoke tests still PASS (4 original + CSRF round-trip)
- **This sub-wave unblocks Wave-2 (P0-24 needs P0-25)**

**Estimated effort:** P0-25 = 1.5-2 weeks (Tier 2); P0-17 = 0.5-1 week (Tier 4); shared helper = 1-2 days. **~2-3 weeks total.**

### Sub-Wave 1b — Hardening (P0-28 + P0-10 + P0-11)
**Scope:**
1. P0-28 (unknown-exception handling: invariant-checker + ExceptionQueue model + 3-level freeze)
2. P0-10 (session integrity: revoke + active-sessions + refresh rotation)
3. P0-11 (OTP retry limits: per-target counters + lockout + brute-force alert)

**Exit criteria:**
- P0-28: unknown-state injection at each blast-radius level → correct freeze level applied; over-freeze-prevention test passes
- P0-10: session revoke works; active-sessions list returns correct data; refresh rotation doesn't log out active sessions
- P0-11: 6th OTP attempt → 429/lockout; 4th send per 10min → 429; brute-force alert fires
- Staging smoke tests still PASS

**Estimated effort:** P0-28 = 1-1.5 weeks (Tier 3); P0-10 = 0.5-1 week (Tier 4); P0-11 = 0.5-1 week (Tier 4). **~2-3 weeks total. Can run in parallel with Sub-Wave 1a if separate engineers.**

### Sub-Wave 1c — DR Design Only (P0-26 design + runbook)
**Scope:**
1. P0-26 design document (restore runbook, post-restore reconciliation procedure)
2. ExceptionQueue integration with DR (freeze state preserved across restore)
3. **NO drill execution** (gated on P0-16 pg_dump rewrite — Orchestrator decision required)

**Exit criteria:**
- DR runbook documented
- Restore script authored (but not executed against production)
- Post-restore reconciliation procedure documented (implementation deferred to Wave-3 post-P0-01)
- **P0-26 marked as "Design complete; drill execution deferred to Phase 3"** (requires Orchestrator authorization for the split)

**Estimated effort:** 0.5-1 week (design only).

### Why NOT Single-Wave
- P0-25 has CRITICAL blast radius (oversell, state corruption) — needs focused attention
- P0-26 cannot fully close in Wave-1 (needs Wave-3 Payment model)
- Mixing all 6 at once risks migration conflicts + makes rollback harder
- Wave-2 (P0-24) only needs P0-25 — Sub-Wave 1a alone unblocks Wave-2

---

## Q9 — Per-Task Do / Don't / Evidence / Exit Criteria

### Shared Helper: `withTransaction()` in `src/lib/db.ts`

| Aspect | Detail |
|--------|--------|
| **DO** | Author a `withTransaction(fn)` wrapper that calls `prisma.$transaction(fn)` + handles retry-on-conflict (Prisma's built-in retry for transaction conflicts). Export from `src/lib/db.ts`. |
| **DON'T** | Don't add Redis-based distributed locks (DB-only is acceptable for Phase 2 staging). Don't make it a class — keep it a simple function. |
| **Evidence** | Unit test: 2 concurrent transactions on same row → one succeeds, one retries or gets 409. |
| **Exit Criteria** | Helper exists, tested, imported by at least one P0-25/P0-17 route. |

---

### P0-25 — Concurrency + Duplicate-Execution (Cases A + B)

| Aspect | Detail |
|--------|--------|
| **DO** | Add `version Int @default(0)` to Order + KillSwitch (Case B) + `availableCount Int @default(0)` + `version Int @default(0)` to MenuItem (Case A). Wrap POST /api/orders in `withTransaction()` with `SELECT ... FOR UPDATE` on MenuItem rows. Use conditional UPDATE (`WHERE version = X`) for PATCH /api/orders/[id]/status. On conflict → 409 with retry guidance. |
| **DON'T** | Don't implement Case C (payment duplicate) — needs Wave-3 Payment model. Don't use `db.order.update({ where: { id } })` without version check (current bug at `orders/[id]/status/route.ts:42`). Don't add Redis (DB-only acceptable). |
| **Evidence** | Case A test: 2 concurrent POST /api/orders for last available item → 1 succeeds (201), 1 fails (409). Case B test: 2 concurrent PATCH with conflicting transitions → 1 succeeds, 1 fails (409). |
| **Exit Criteria** | Both cases tested; no oversell possible; conflicts surface as 409 (not silent corruption). Staging smoke tests PASS. |

---

### P0-17 — Idempotency on Critical Writes

| Aspect | Detail |
|--------|--------|
| **DO** | Add `IdempotencyKey` model (id, key, resourceType, resourceId, responsePayload, createdAt, expiresAt) with `@unique` on key. Accept `Idempotency-Key` header on POST /api/orders (and future payment routes). In `withTransaction()`: (1) check if key exists → return cached response; (2) else execute write + store key + response. TTL: 24h. |
| **DON'T** | Don't implement for Payment/refund routes (don't exist yet — Wave-3). Don't store full response payload if it contains sensitive data (store hash + status only). Don't make the idempotency check outside the transaction (phantom-block risk). |
| **Evidence** | Test: POST /api/orders with same Idempotency-Key twice → same response + same orderId (dedup works). Test: POST with different keys → different orders. Test: crash between check + write → retry succeeds (no phantom block). |
| **Exit Criteria** | IdempotencyKey model exists; header accepted on POST /api/orders; dedup works; phantom-block-prevention test passes. |

---

### P0-28 — Unknown-Exception Handling (3 Blast-Radius Levels)

| Aspect | Detail |
|--------|--------|
| **DO** | Add `ExceptionQueue` model (id, invariantViolated, entityType, entityId, freezeLevel, stateSnapshot, traceId, createdAt, resolvedAt). Author invariant-checker module that validates state transitions (e.g., order status must be in valid set; payment amount must match order total). 3 freeze levels: Level 1 (transaction freeze — set `frozen` flag on single order/payment); Level 2 (entity quarantine — set `quarantined` flag on Restaurant/User); Level 3 (system kill switch — link to P0-23 KillSwitch). Over-freeze-prevention audit log. |
| **DON'T** | Don't auto-escalate to Level 3 unless I-01/I-04 (money) violation. Don't freeze without preserving evidence (full state snapshot + trace + invariant). Don't silently ignore unknown states. |
| **Evidence** | Test: inject unknown order status → Level 1 freeze + ExceptionQueue entry + alert. Test: inject payment amount mismatch → Level 1 or 2 freeze. Test: over-freeze-prevention (Level 1 would suffice → Level 3 NOT used). |
| **Exit Criteria** | ExceptionQueue model exists; invariant-checker runs on state transitions; 3 freeze levels tested; over-freeze-prevention audit passes. |

---

### P0-10 — Session Integrity

| Aspect | Detail |
|--------|--------|
| **DO** | Add `revokeSession(token)` + `revokeAllSessionsForUser(userId)` to `src/lib/session.ts`. Add `GET /api/auth/sessions` (list active sessions for current user). Add sliding refresh-token rotation (extend expiry on each request, up to max 7 days). Add session-anomaly metric (geo/IP change detection). |
| **DON'T** | Don't implement concurrent-session limits (not a Wave-1 requirement). Don't break existing `getSessionUser()` — extend it. Don't store refresh tokens in localStorage (use httpOnly cookie). |
| **Evidence** | Test: revokeSession(token) → next request with that token → 401. Test: revokeAllSessionsForUser → all user's sessions invalidated. Test: active-sessions list returns correct count. Test: sliding refresh extends expiry. |
| **Exit Criteria** | Revoke functions work; active-sessions endpoint exists; sliding refresh implemented; session-anomaly metric produced. |

---

### P0-11 — OTP Retry Limits

| Aspect | Detail |
|--------|--------|
| **DO** | Add per-target attempt counter (max 5 failed verify attempts / 10 min). Add per-target send counter (max 3 sends / 10 min). Add `lockoutUntil DateTime?` field on OtpRequest (or per-target store). Add `otp-attempt` metric. Add `otp-brute-force` alert rule to `src/lib/alerting.ts`. |
| **DON'T** | Don't remove the existing per-IP rate limit (keep as defense-in-depth). Don't lock out without preserving the OTP record (for audit). Don't make lockout indefinite (10-min TTL). |
| **Evidence** | Test: 6th verify attempt → 429/lockout. Test: 4th send per 10min → 429. Test: after 10 min → lockout cleared. Test: brute-force alert fires after threshold. |
| **Exit Criteria** | Per-target counters work; lockout enforced; brute-force alert defined + fires. |

---

### P0-26 — DR Design Only (Split Recommended)

| Aspect | Detail |
|--------|--------|
| **DO** | Author DR runbook (`docs/DR_RUNBOOK.md`). Author restore script (`scripts/restore-backup.sh`) — but do NOT execute against production. Document post-restore reconciliation procedure (implementation deferred to Wave-3 post-P0-01). Add `DrDrillResult` model (optional — records monthly drill outcomes). |
| **DON'T** | Don't execute DR drill (gated on P0-16 pg_dump rewrite). Don't implement post-restore money-state reconciliation (needs Wave-3 Payment model). Don't provision Supabase Storage bucket (Phase 3). |
| **Evidence** | DR runbook exists. Restore script authored. Post-restore reconciliation procedure documented. |
| **Exit Criteria** | Design + runbook complete. Mark P0-26 as "Design complete; drill execution deferred to Phase 3" (requires Orchestrator authorization for the split). |

---

## Governance Documentation Gap

### Missing: WAVE1_EVIDENCE.md

Wave-0 had an explicit closure gate in `WAVE0_EVIDENCE.md` line 5:
> "Wave-0 Gate remains NOT CLOSED until ALL 13 P0s (including P0-09, P0-22) have complete G/H evidence AND both deviations are CLOSED."

**No equivalent exists for Wave-1.** Before Wave-1 execution, the Orchestrator should authorize creation of `WAVE1_EVIDENCE.md` defining:

1. What lifecycle state must each Wave-1 P0 reach? (S9 Production-ready?)
2. Does Wave-1 closure require the DR drill to PASS (§14.1 condition 4)?
3. Does Wave-1 closure require all 6 P0s at S9, or only P0-25 (Wave-2 critical-path unlock)?
4. What deviations are anticipated, and what's their closure path?

### P0-26 Dual Obligation
P0-26 is BOTH a Wave-1 P0 AND a §14.1 launch-gate condition. Its closure criteria are stricter than the other 5 Wave-1 P0s. The Orchestrator must decide whether P0-26's drill execution is a Wave-1 closure prerequisite or a production-launch prerequisite.

---

## Current Governance State

```
DEV-001 / P0-22          ✅ CLOSED
P0-27 Phase 1            ✅ COMPLETE
P0-27 Phase 2            ✅ COMPLETE
Rollback Drill           ✅ VERIFIED
P0-14                    ✅ REMEDIATED
Wave-0 Gate Review       ✅ COMPLETE
Wave-0                   ✅ CLOSED
Wave-1                   🔓 UNLOCKED
Wave-1 Gate Review       ✅ COMPLETE (this report)
Wave-1 Execution         🟡 AWAITING ORCHESTRATOR PLAN + AUTHORIZATION
Wave-2                   🔒 LOCKED (gated on Wave-1 Sub-Wave 1a — P0-25)
Production               🚫 NOT AUTHORIZED
```

---

## Recommendation to Orchestrator

1. **Acknowledge Wave-1 scope = 6 P0s** (not 3). The 3 missed P0s (P0-28, P0-10, P0-11) are launch-mandatory.

2. **Authorize creation of `WAVE1_EVIDENCE.md`** defining the Wave-1 closure gate explicitly (parallel to `WAVE0_EVIDENCE.md`). This is a governance documentation task, NOT a code task.

3. **Decide P0-26 split:** (a) bring P0-16 pg_dump rewrite forward into Wave-1, OR (b) split P0-26 into design (Wave-1) vs drill (Phase 3).

4. **Authorize Sub-Wave 1a first** (shared helper + P0-25 + P0-17). This unblocks Wave-2 (P0-24 needs P0-25). Sub-Waves 1b and 1c can follow in parallel.

5. **Do NOT authorize production migration** until production DATABASE_URL is fixed to `snakzap_app` (Wave-0 governance gap — Phase 3 production-launch blocker).

6. **Do NOT attempt to fully close P0-25 Case C or P0-26 post-restore reconciliation in Wave-1** — these require Wave-3 Payment model (P0-01). Mark them as "infrastructure prepared; full verification deferred to Wave-3."

**STOP.** This report is READ-ONLY evidence for the Orchestrator's Wave-1 execution planning. It does NOT authorize any code changes, deployments, migrations, or production modifications. Awaiting Orchestrator's execution plan + explicit task authorization.
