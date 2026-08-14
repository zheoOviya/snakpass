# Wave-0 Governance Decision Memo

**Date:** 2026-08-14
**Author:** IDE (read-only, Orchestrator-authorized)
**Scope:** READ-ONLY governance clarification on 3 Orchestrator questions + final recommendation.
**Constraint:** NO code changes, NO deployments, NO provisioning, NO migrations, NO production modifications, NO Wave-0 closure declaration, NO Wave-1 unlock.

---

## Executive Summary

A code-level investigation (Task WAVE0-GOV-1) uncovered a **CRITICAL active production-breaking bug in P0-14 (CSRF)** that was hidden by the GET-only smoke test suite. This bug, combined with the framing inconsistencies for the other 3 PARTIAL P0 items, means Wave-0 closure cannot be safely authorized at this time without remediation.

### Final Recommendation

```
REJECT_WAVE_0 — REMEDIATION_REQUIRED
```

**Reason:** P0-14 has an active production-breaking bug (CSRF cookie-setter never wired → all state-changing writes would 403). This is NOT a "library complete + integration deferred" situation — the validation IS wired, the cookie-setter is NOT. Accepting this as S9 Production-ready would be inappropriate. One focused remediation (wire `setCsrfCookie()` or disable CSRF middleware check) unblocks Wave-0.

---

## Question 1 — P0-13 / P0-14 / P0-16 / P0-21 Impact Matrix

### Code-Level Findings

The code-level investigation (Task WAVE0-GOV-1) revealed that the WAVE0_GATE_REVIEW.md (Task 59) classification of all 4 items as "library complete, NOT wired into middleware" is **INACCURATE** for P0-13 and P0-14. The actual state is more nuanced:

| P0 | Library | Library imported? | Runtime enforcement | Scheduler running? | Actual classification |
|----|---------|-------------------|---------------------|---------------------|------------------------|
| **P0-13** | ✅ `src/lib/rate-limit.ts:1-75` | ❌ NEVER imported | ✅ **Inline copy** in `src/middleware.ts:9-78, 138-168` — IS enforced on every `/api/*` request | N/A (per-request) | **(b) PARTIALLY INTEGRATED** — lib orphaned (dead code), but inline middleware WORKS |
| **P0-14** | ✅ `src/lib/csrf.ts:1-53` | ❌ NEVER imported | ⚠️ Validation IS wired (`middleware.ts:97-136`) BUT **`setCsrfCookie()` is NEVER CALLED anywhere** → all non-auth POST/PUT/PATCH/DELETE would 403 | N/A | **(b) PARTIALLY INTEGRATED + ACTIVE BUG** |
| **P0-16** | ✅ `src/lib/backup.ts:1-90` | ✅ `api/backup/route.ts:2` | ✅ On-demand `POST /api/backup` + `GET /api/backup` (admin-only) | ❌ Mini-service exists (`mini-services/backup-scheduler/`); NOT deployed; `vercel.json:45 crons=[]` | **(b) PARTIALLY INTEGRATED** (on-demand only; no scheduler) |
| **P0-21** | ✅ `src/lib/alerting.ts:1-142` | ✅ `api/alerts/evaluate/route.ts:2` | ✅ On-demand `GET /api/alerts/evaluate` (no auth gate) | ❌ Mini-service exists (`mini-services/alert-evaluator/`); NOT deployed; `vercel.json:45 crons=[]` | **(b) PARTIALLY INTEGRATED** (on-demand only; no continuous loop) |

### Impact Matrix — Accepting "library complete + integration deferred" for Wave-0

| P0 | Risk if accepted for Wave-0 | Why |
|----|------------------------------|-----|
| **P0-13** | 🟢 **LOW** | Rate limiting IS enforced in production via inline middleware. The library file being orphaned is a code-hygiene issue, NOT a capability gap. The framing "library complete + integration deferred" is misleading — re-classify as "✅ Operationally evidenced (inline middleware); Phase-3 Redis-backed distributed limiter pending." |
| **P0-14** | 🔴 **HIGH — ACTIVE PRODUCTION-BREAKING BUG** | The CSRF validation middleware IS wired (`middleware.ts:97-136`), but `setCsrfCookie()` is NEVER called anywhere in the codebase. This means: (a) no client can ever obtain a valid `snakzap_csrf` cookie; (b) every non-auth POST/PUT/PATCH/DELETE would be rejected with 403 "CSRF token required". This is NOT a deferred integration — it is an active bug. It is hidden by the GET-only smoke test suite (`scripts/smoke-test.sh:154-164` only tests GET endpoints). |
| **P0-16** | 🟢 **LOW** (Wave-0) / 🔴 **HIGH** (production) | On-demand backup API works. Daily scheduler not running. Acceptable for Wave-0 evidence; production-launch blocker (Phase 3). |
| **P0-21** | 🟢 **LOW** (Wave-0) / 🟡 **MEDIUM** (production) | On-demand alert evaluation works. Continuous loop not running. Acceptable for Wave-0 evidence; production-launch concern (Phase 3). |

### Why P0-14 Cannot Be Accepted as "Library Complete + Integration Deferred"

1. **The bug is ACTIVE, not deferred.** The validation middleware IS wired and IS enforcing the check on every state-changing request. The cookie-setter is NOT wired. This is a half-implemented feature with a broken round-trip, not a deferred integration.
2. **It is hidden by the smoke test suite.** `scripts/smoke-test.sh:154-164` only tests 4 GET endpoints. CSRF check at `middleware.ts:100` only fires on POST/PUT/PATCH/DELETE — so GET smoke tests bypass CSRF entirely. This means the staging deployment "passes" smoke tests while being broken for all writes.
3. **It would make the platform non-functional for state-changing operations.** Orders, kill-switch toggles, menu changes, backups, alert evaluations — all would 403 in production.
4. **No responsible business owner would approve this as S9 Production-ready.** S9 requires business-owner sign-off (per `PRODUCTION_READINESS_MATRIX.md` §11 line 831). A capability where all writes are broken cannot be signed off.
5. **It contradicts the earlier WAVE0_EVIDENCE.md classification.** Task 41 (`WAVE0_EVIDENCE.md:461-462`) classified P0-14 as "operationally evidenced ✅ (CSRF middleware in request path)" — but that evidence only tested the validation half (POST without token → 403), not the cookie-setter half.

### P0-14 Remediation Options (for Phase-3 / pre-Wave-0-closure)

**Option A (preferred):** Wire `setCsrfCookie()` into login/session-creation paths so the cookie is actually set. Then update the frontend to read the cookie and send the `X-CSRF-Token` header on state-changing requests. Extend `smoke-test.sh` to include an authenticated POST that verifies the CSRF round-trip.

**Option B (interim):** Disable the CSRF middleware check (comment out `middleware.ts:97-136`) until the cookie-setter is wired. This removes the false sense of security but unblocks writes.

**Option C (minimal):** Add a CSRF cookie-setter route (e.g., `GET /api/auth/csrf-token` that calls `setCsrfCookie()` and returns the token) + update frontend to fetch + send the token.

---

## Question 2 — Class-2 / Class-3 Rollback Drill Requirement

### Findings

Per `src/lib/deployment.ts:1-89` (read-only):
- **Class-1 (backward-compatible):** `classifyDeployment({ schemaBreaking: false, apiBreaking: false, hasMigration: false })` → `getRollbackProcedure()` returns `maxRollbackTime: '10 min'`, `safeByDefault: true`. **DRILL PERFORMED** ✅ (Task 58 — 71s vs 600s budget).
- **Class-2 (expand-migrate-contract):** `classifyDeployment({ hasMigration: true, schemaBreaking: false, apiBreaking: false })` → `getRollbackProcedure()` returns `maxRollbackTime: '15 min'`, `safeByDefault: true`. **DRILL NOT PERFORMED** ❌.
- **Class-3 (breaking):** `classifyDeployment({ schemaBreaking: true } | { apiBreaking: true })` → `getRollbackProcedure()` returns `maxRollbackTime: 'variable'`, `safeByDefault: false`, `procedure: 'Forward-fix only. DB rollback may be unsafe.'`. **DRILL NOT PERFORMED** ❌.

### Wave-0 Closure Criteria for Rollback Drills

Per `PRODUCTION_READINESS_MATRIX.md` §14.1 (P0 Launch Gate, 7 AND-conditions), condition 5:
> "Rollback drill passed (per deployment class) | P0-27 rollback-drill report; **Class 1 ≤ 10 min verified**"

The matrix's own P0-27 detailed breakdown (line 556) clarifies the design philosophy:
> "Key principle (v1.2): Application rollback and DB rollback are different problems. **The 10-minute rollback guarantee applies to backward-compatible (Class 1) deploys only.** Schema changes must use expand-migrate-contract so rollback is always safe. Breaking changes accept forward-fix as the recovery path."

### Conclusion

**Class-2/3 rollback drills are NOT a Wave-0 closure prerequisite per the documented criteria.**

- **Class-2:** Rollback is "always safe by design" (expand-migrate-contract pattern ensures schema compatibility across phases). No drill is needed to verify safety — the design guarantees it.
- **Class-3:** Rollback is "not the recovery path" (forward-fix is). A drill of rollback would not apply.

Class-2/3 drills are appropriately Phase-3 production-launch prerequisites (if the Orchestrator wants them at all — the design philosophy says they're unnecessary).

### Caveat

`src/lib/deployment.ts` is **NEVER IMPORTED ANYWHERE** — `from '@/lib/deployment'` returns ZERO matches in the codebase. The 3-class framework is documentation-as-code; it is NOT invoked by any runtime path (no CD workflow calls `classifyDeployment()`, no API route imports it). The framework is verified only by manual unit tests. This is a code-hygiene issue but not a Wave-0 blocker — the framework exists as design documentation in code form.

---

## Question 3 — Wave-0 Closure Purpose

### Stated Purpose Per Governance Docs

**`WAVE0_EVIDENCE.md` line 5 (most explicit):**
> "Wave-0 Gate remains NOT CLOSED until **ALL 13 P0s (including P0-09, P0-22) have complete G/H evidence AND both deviations are CLOSED.**"

**`IMPLEMENTATION_LOG.md` lines 21-29 (governance lock):**
> "Wave-0 acceptance requires evidence + review + approval for EVERY P0 (all 13). No architectural gap silently closed."

**`PRODUCTION_READINESS_MATRIX.md` §11 (Capability Lifecycle):** S2 → ... → S8 Approved (business owner accepts residual risk) → S9 Production-ready.

**`PRODUCTION_READINESS_MATRIX.md` §14.1 (P0 Launch Gate):** 7 AND-conditions for production launch — Wave-0 closure is NECESSARY but NOT SUFFICIENT for production launch.

### Classification

**Answer: (b) "All 13 P0 items have passed their Wave-0 acceptance criteria"** — where the Wave-0 acceptance criteria = each P0 reaches **S9 Production-ready** (G/H evidence complete + business-owner approval + deviations CLOSED).

- **Wave-0 closure ≠ production launch.** Wave-0 closure is necessary but not sufficient for production launch.
- **Wave-0 closure enables Wave-1 unlock** (per worklog Task 37 execution order step 6).
- The 7 §14.1 launch-gate conditions (invariants, dependency scenarios, DR drill, exceptions, waivers) are production-launch prerequisites, NOT Wave-0 closure prerequisites.

### Key Distinction

- **Wave-0 closure** = each of the 13 Wave-0 P0s reaches S9 Production-ready (G/H evidence + business-owner approval + deviations CLOSED).
- **Production launch** = Wave-0 closure + 6 other §14.1 conditions.

A P0 can be S9 Production-ready (Wave-0 closed) without the platform being production-launched. The business owner CAN accept residual risk (Phase-3 integration deferral) as part of S8 Approved → S9 Production-ready — **EXCEPT when there is an active production-breaking bug** (P0-14 CSRF).

---

## Final Recommendation

### Decision

```
REJECT_WAVE_0 — REMEDIATION_REQUIRED
```

### Rationale

Wave-0 closure requires all 13 Wave-0 P0s to reach S9 Production-ready (G/H evidence + business-owner approval + deviations CLOSED). The code-level investigation (Task WAVE0-GOV-1) uncovered that:

1. **P0-14 (CSRF) has an ACTIVE production-breaking bug** — the validation middleware IS wired, but `setCsrfCookie()` is NEVER called. All state-changing writes (orders, kill-switch toggles, menu changes, backups, alert evaluations) would be rejected with 403 in production. This is hidden by the GET-only smoke test suite. This is NOT a "library complete + integration deferred" situation — it is a half-implemented feature with a broken round-trip. No responsible business owner would approve this as S9 Production-ready.

2. **P0-13, P0-16, P0-21 are acceptable for Wave-0** under the "library complete + on-demand API wired + scheduler deferred to Phase 3" framing — BUT only if P0-14 is remediated first. The P0-13 framing in WAVE0_GATE_REVIEW.md (Task 59) is misleading (rate limiting IS enforced via inline middleware); the P0-16/P0-21 framing is accurate (on-demand API works; continuous loop deferred).

3. **Class-2/3 rollback drills are NOT a Wave-0 closure prerequisite** per the documented criteria. The matrix explicitly states the 10-minute rollback guarantee applies to Class-1 only. Class-2 is "safe by design"; Class-3 uses forward-fix.

4. **Wave-0 closure purpose is (b)** — all 13 P0s reach S9 Production-ready. This is the correct interpretation per WAVE0_EVIDENCE.md line 5.

### Required Remediation (minimal, focused)

**ONE remediation unblocks Wave-0 closure:**

**P0-14 CSRF cookie-setter fix:**
- Wire `setCsrfCookie()` into login/session-creation paths (so the cookie is actually set), OR
- Disable the CSRF middleware check (`middleware.ts:97-136`) until the cookie-setter is wired, OR
- Add a CSRF token endpoint (`GET /api/auth/csrf-token` that calls `setCsrfCookie()` and returns the token) + update frontend.

**Plus (recommended but not blocking):**
- Extend `scripts/smoke-test.sh` to include at least one authenticated POST/PUT to verify the CSRF round-trip works (or fails expectedly). This prevents future hidden bugs.
- Re-classify P0-13 in WAVE0_GATE_REVIEW.md from "library complete, not wired" to "✅ Operationally evidenced (inline middleware); Phase-3 Redis-backed distributed limiter pending."

### After Remediation

Once P0-14 is remediated:
- P0-13: ✅ Operationally evidenced (inline middleware)
- P0-14: ✅ Operationally evidenced (validation + cookie-setter both wired)
- P0-16: ✅ On-demand API evidenced; Phase-3 scheduler pending (acceptable for Wave-0)
- P0-21: ✅ On-demand API evidenced; Phase-3 continuous loop pending (acceptable for Wave-0)
- All other Wave-0 P0s: unchanged (7 PASS, 4 NOT-STARTED/LOCKED Wave-1/Wave-2 items)

**Then Wave-0 can be CLOSED** (pending Orchestrator's separate closure decision).

### What This Recommendation Does NOT Require

- ❌ No Class-2/3 rollback drill (not a Wave-0 prerequisite)
- ❌ No production DATABASE_URL fix (Phase-3 production-launch blocker, not Wave-0)
- ❌ No Fly.io/Railway provisioning (Phase-3)
- ❌ No pg_dump backup rewrite (Phase-3)
- ❌ No Wave-1 unlock (gated on Wave-0 closure)
- ❌ No production deployment (not authorized)

### What This Recommendation DOES Require

- ✅ P0-14 CSRF cookie-setter remediation (ONE focused code change)
- ✅ Extended smoke test (recommended, to prevent future hidden bugs)
- ✅ P0-13 re-classification (recommended, to fix the misleading framing)

---

## Constraint Compliance Verification

| Constraint | Status |
|-----------|--------|
| READ-ONLY review (no code changes) | ✅ No files modified (only this memo + worklog append) |
| No deployments | ✅ |
| No migrations | ✅ |
| No production modifications | ✅ |
| No Wave-0 closure declaration | ✅ (this memo provides a recommendation; Orchestrator retains closure decision) |
| No Wave-1 unlock | ✅ |
| No DEV-001 / P0-22 file changes | ✅ |
| No governance file changes | ✅ |

---

## Current Governance State

```
DEV-001 / P0-22       ✅ FINAL PASS — CLOSED
P0-27 Phase 1         ✅ COMPLETE
P0-27 Phase 2         ✅ COMPLETE (STAGING_DEPLOYED + ROLLBACK_VERIFIED)
Infrastructure Gate   ✅ STAGING PASS
Rollback Drill        ✅ PASS (71s / 600s budget)
Wave-0 Gate Review    ✅ COMPLETE
Wave-0 Closure        🔴 REJECT — REMEDIATION_REQUIRED (P0-14 CSRF cookie-setter bug)
Wave-1                🔒 LOCKED
Production            🚫 NOT AUTHORIZED
```

**STOP.** This memo provides the code-level evidence + impact matrix + final recommendation (`REJECT_WAVE_0 — REMEDIATION_REQUIRED`). The Orchestrator retains the Wave-0 closure decision.
