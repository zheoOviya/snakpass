# Sprint Plan

> **Artifact 5** of the SnakZap production-readiness chain — the **final planning artifact before implementation**.
> **Source:** Implementation Order (Artifact 4, ACCEPTED) + Critical Path (Artifact 3, FINAL ACCEPTED) + Production Readiness Matrix v1.4.
> **Purpose:** Convert the 8-wave implementation order into a sprint plan with capacity, ownership, sprint boundaries, effort, and dates. For the first time in this chain, scheduling concerns appear.
> **Output:** Sprint plan — the actionable plan that, when signed off, unlocks implementation.
> **Status:** Draft — sprint planning (v1.4 corrections applied: 20-week claim downgraded to provisional; assignment vs completion vs Production-ready distinguished; Wave-0 capacity constrained).

**⚠️ Important distinction (v1.4 stakeholder correction):** The critical path (Artifact 3) gives **7 dependency edges / 8 dependency stages** — it does NOT give a schedule. Sprint duration, engineering capacity, P0 effort, and parallel capacity are separate variables. Any timeline in this artifact is a **provisional schedule** derived from assumptions below, NOT a mathematically proven minimum. The 20-week figure is provisional and must be validated by the effort/capacity model in Section 1.3 once real estimation occurs.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Artifact | 5 of 5 (Traceability Map ✅ → Dependency Graph ✅ → Critical Path ✅ → Implementation Order ✅ → **Sprint Plan**) |
| Source | IMPLEMENTATION_ORDER.md (ACCEPTED) + CRITICAL_PATH.md (FINAL) + PRODUCTION_READINESS_MATRIX.md v1.4 |
| Date | 2026-08-09 |
| Status | Draft — sprint planning (v1.4 corrections applied) |
| Output | Sprint plan with capacity, ownership, boundaries, effort, provisional timeline |
| P0 count | **28 unique P0s**; sprint/lifecycle tables contain 66 references (appearances, not additional P0s) |

---

## 1. Sprint Framework

### 1.1 Sprint length

**2-week sprints.** Standard agile cadence; allows meaningful work per sprint without excessive planning overhead.

### 1.2 Capacity model (v1.4 — explicit constraints)

**Team size:** 3 engineers (1 backend-lead, 2 full-stack) + 1 part-time DevOps/DBA + 1 product owner (approver role).

**Concurrent engineering slots per sprint:**
- 3 engineer slots for active `Implemented` work (one P0 each, in parallel).
- 1 DevOps slot (part-time; ~0.5 effective) for infrastructure P0s (backup, health, metrics, alerting, rate-limiting, deployment).
- Product owner: `Approved` sign-off work (batched weekly; not a per-sprint blocking slot, but a per-P0 gate).
- Reviewer work (separation of duties): absorbed by the other 2 engineers + DevOps; not a separate slot but adds ~20% load to reviewers.

**Effective per-sprint capacity:** ~3.5 P0-equivalents in active `Implemented` progress + parallel `Tested`/`Production-ready` work on earlier P0s.

**⚠️ Wave-0 capacity check (v1.4 stakeholder correction):** Wave 0 has 13 P0s. At 3.5 P0-equivalents per sprint, Wave 0 CANNOT complete in a single sprint. The 13 P0s are assigned to Sprint 1 but will NOT all reach `Implemented` by Sprint 1's end. They will reach `Implemented`/`Tested` progressively across Sprints 1-2, with the critical-path root (P0-15) and key Wave-1 predecessors (P0-09, P0-22, P0-23) prioritized first. The original "Sprint 1 = Wave 0" mapping is therefore a **start-assignment**, not a completion commitment.

**Assignment vs completion vs Production-ready (v1.4 distinction):**
- **Assigned to sprint** = the P0 begins active work in that sprint.
- **Completed (Implemented/Tested)** = the P0 reaches `Implemented` or `Tested` by sprint end (may be a later sprint than assignment).
- **Production-ready** = the P0 reaches lifecycle state 9 (all gates passed, approver signed). This is typically 2-4 sprints AFTER assignment for Tier 1 P0s, 1-3 sprints for Tier 2-4.

This distinction matters: a sprint table showing "P0-15: Tested" means the *target state by sprint end*, not that P0-15 was assigned and completed in the same sprint. Targets are provisional and subject to the effort/capacity model below.

### 1.3 Effort/capacity model (v1.4 — provisional, to be validated)

The 20-week provisional timeline assumes the following per-P0 effort estimates. **These are placeholders, NOT measured.** Real estimation must occur before Sprint 1 begins; if estimates exceed these, the timeline extends.

| P0 complexity tier | Effort estimate (engineer-weeks to `Implemented`) | Effort to `Production-ready` (incl. review/approval) |
|--------------------|---------------------------------------------------|------------------------------------------------------|
| Tier 1 (HIGHEST — P0-24, 01, 04, 07) | 2-3 weeks each | 4-6 weeks each (failure-injection + review + approval) |
| Tier 2 (HIGH — P0-15, 25, 02, 06) | 1.5-2 weeks each | 3-4 weeks each |
| Tier 3 (MEDIUM — P0-03, 26, 28, 22, 23, 09) | 1-1.5 weeks each | 2-3 weeks each |
| Tier 4 (lower — P0-05, 08, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 27) | 0.5-1 week each | 1.5-2.5 weeks each |

**Provisional timeline derivation (NOT a proof):** With ~3.5 concurrent slots and the effort estimates above, the critical-path P0s (8 nodes, mix of Tier 1-2) take roughly 8-10 sprints of dependency-respecting sequence. Adding the launch-gate verification sprint = ~10 sprints = ~20 weeks. **This is a back-of-envelope estimate, not a proven minimum.** Real scheduling must:
1. Validate each P0's effort estimate with the implementing engineer.
2. Confirm the 3.5-slot capacity is sustainable sprint-over-sprint.
3. Account for non-P0 work (bug fixes, P1/P2 features, meetings, leave).
4. Build in buffer for failure-test rework (Tier 1 P0s especially).

**Until these validations occur, the 20-week figure is provisional and should not be communicated as a commitment.**

### 1.4 Ownership rules (from matrix Section 11)

- **Separation of duties:** The developer who implements a P0 cannot be its `Reviewed` or `Approved` signatory.
- `Reviewed` = different engineer (technical review).
- `Approved` = product owner (business risk acceptance).
- Each P0 has a named owner assigned at sprint planning.

### 1.5 Lifecycle state progression per sprint

Each P0 moves through the 9 lifecycle states (matrix Section 11). A sprint advances P0s by 1-3 states depending on complexity and risk tier:

- Tier 1 (HIGHEST risk): 1-2 states per sprint (more scrutiny, more failure-injection).
- Tier 2 (HIGH): 2-3 states per sprint.
- Tier 3/4: 2-3 states per sprint (standard).

**Launch gate:** ALL 28 P0s must reach state 9 (`Production-ready`) + all 7 AND-conditions (matrix Section 14.1).

---

## 2. Wave-to-Sprint Mapping

The 8 implementation waves map to sprints. Because waves have different sizes and critical-path singletons throttle progress, the mapping is NOT 1:1.

### Sprint 1 (Weeks 1-2): Wave 0 — Foundation

**Goal:** Stand up the foundation layer. All 13 parallel P0s begin.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 1 |
|----|-----------|-------|-----------|--------------------------------|
| P0-15 | Migrations | Backend-lead | Tier 2 | `Tested` (critical-path root; max scrutiny) |
| P0-09 | Firebase verify | Full-stack 1 | Tier 3 | `Tested` |
| P0-22 | Audit integrity | Full-stack 2 | Tier 3 | `Tested` |
| P0-23 | Kill switch | Full-stack 1 | Tier 3 | `Tested` |
| P0-16 | Backup | DevOps | Tier 4 | `Implemented` |
| P0-19 | Structured logging | Full-stack 2 | Tier 4 | `Implemented` |
| P0-20 | Health + metrics | DevOps | Tier 4 | `Implemented` |
| P0-21 | Alerting | DevOps | Tier 4 | `Implemented` |
| P0-12 | Zod validation | Full-stack 1 | Tier 4 | `Tested` |
| P0-13 | Rate limiting | DevOps | Tier 4 | `Implemented` |
| P0-14 | CSRF protection | Full-stack 2 | Tier 4 | `Tested` |
| P0-18 | Error handling | Full-stack 1 | Tier 4 | `Tested` |
| P0-27 | Deployment & rollback | DevOps | (isolated) | `Implemented` (parallel-isolated) |

**Sprint 1 exit criteria:** P0-15, P0-09, P0-22, P0-23 at `Tested` (so Wave 1 can begin in Sprint 2). All others at `Implemented` minimum.

### Sprint 2 (Weeks 3-4): Wave 1 — Direct root-dependents + Wave 0 completion

**Goal:** Begin Wave 1; complete Wave 0 P0s to `Production-ready`.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 2 |
|----|-----------|-------|-----------|--------------------------------|
| P0-25 | Concurrency + version fields | Backend-lead | Tier 2 | `Tested` (critical-path; gates P0-24) |
| P0-17 | Idempotency (critical writes) | Full-stack 1 | Tier 4 | `Tested` |
| P0-26 | Disaster recovery | DevOps | Tier 3 | `Tested` (DR drill starts) |
| P0-28 | Unknown-exception handling | Full-stack 2 | Tier 3 | `Implemented` |
| P0-10 | Session integrity | Full-stack 1 | Tier 4 | `Tested` |
| P0-11 | OTP retry limits | Full-stack 2 | Tier 4 | `Tested` |
| (Wave 0 completions) | P0-15, 09, 22, 23, 12, 14, 18 → `Production-ready`; P0-16, 19, 20, 21, 13, 27 → `Tested` | various | | `Production-ready` / `Tested` |

**Sprint 2 exit criteria:** P0-25 at `Tested` (so Wave 2/P0-24 can begin in Sprint 3). P0-15 at `Production-ready` (critical-path root done).

### Sprint 3 (Weeks 5-6): Wave 2 — Transactional integrity (critical-path throttle)

**Goal:** P0-24 — the first critical-path singleton. Maximum scrutiny (Tier 1).

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 3 |
|----|-----------|-------|-----------|--------------------------------|
| P0-24 | Transactional integrity (outbox) | Backend-lead | Tier 1 | `Observed` (failure-tested next sprint) |
| (parallel) | P0-26 DR drill continues | DevOps | Tier 3 | `Failure-tested` (DR drill complete) |
| (parallel) | P0-28 → `Tested` | Full-stack 2 | Tier 3 | `Tested` |
| (Wave 1 completions) | P0-17, 10, 11 → `Production-ready` | various | | `Production-ready` |

**Sprint 3 exit criteria:** P0-24 at `Observed` (so P0-01 can begin `Implemented` in Sprint 4 — `Dependency-ready` reached). DR drill (P0-26) passing.

### Sprint 4 (Weeks 7-8): Wave 3 — Capture + order idempotency (F-convergence)

**Goal:** P0-01 (Tier 1) + P0-08. F-convergence gate: Prepaid+Reorder.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 4 |
|----|-----------|-------|-----------|--------------------------------|
| P0-01 | Razorpay capture | Backend-lead | Tier 1 | `Observed` |
| P0-08 | Order idempotency | Full-stack 1 | Tier 4 | `Tested` |
| P0-24 | (completes) | Backend-lead | Tier 1 | `Failure-tested` → `Reviewed` |
| (parallel) | P0-28 → `Production-ready` | Full-stack 2 | Tier 3 | `Production-ready` |

**F-convergence gate this sprint:** Prepaid+Reorder (P0-01, P0-08, P0-25) — interaction test planning begins; gate targets `Production-ready` synchronization in Sprint 6.

**Sprint 4 exit criteria:** P0-01 at `Observed` (so P0-02, P0-05 can begin in Sprint 5). P0-24 at `Reviewed` (Tier 1 — `Approved` pending).

### Sprint 5 (Weeks 9-10): Wave 4 — Ledger + webhook

**Goal:** P0-02 (critical path) + P0-05.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 5 |
|----|-----------|-------|-----------|--------------------------------|
| P0-02 | Payment ledger (double-entry) | Backend-lead | Tier 2 | `Tested` |
| P0-05 | Webhook integrity | Full-stack 1 | Tier 4 | `Tested` |
| P0-01 | (completes) | Backend-lead | Tier 1 | `Failure-tested` → `Reviewed` |
| P0-08 | (completes) | Full-stack 2 | Tier 4 | `Production-ready` |
| (parallel) | P0-24 → `Approved` → `Production-ready` | Product owner | Tier 1 | `Production-ready` |

**Sprint 5 exit criteria:** P0-02 at `Tested` (so P0-04, P0-03 can begin in Sprint 6). P0-01 at `Reviewed` (Tier 1 — `Approved` pending).

### Sprint 6 (Weeks 11-12): Wave 5 — Refund + reconciliation (F-convergence)

**Goal:** P0-04 (Tier 1, critical path) + P0-03. F-convergence: POS+Settlement.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 6 |
|----|-----------|-------|-----------|--------------------------------|
| P0-04 | Refund flow | Backend-lead | Tier 1 | `Observed` |
| P0-03 | Reconciliation | Full-stack 1 | Tier 3 | `Tested` |
| P0-02 | (completes) | Backend-lead | Tier 2 | `Failure-tested` → `Reviewed` |
| P0-05 | (completes) | Full-stack 2 | Tier 4 | `Production-ready` |
| (parallel) | P0-01 → `Approved` → `Production-ready` | Product owner | Tier 1 | `Production-ready` |

**F-convergence gate this sprint:** POS+Settlement (P0-02, P0-03) — interaction test planning; gate targets `Production-ready` synchronization in Sprint 8.

**Sprint 6 exit criteria:** P0-04 at `Observed` (so P0-06 can begin in Sprint 7). P0-02 at `Reviewed`.

### Sprint 7 (Weeks 13-14): Wave 6 — State separation (4-way convergence)

**Goal:** P0-06 — integration point for all four state dimensions.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 7 |
|----|-----------|-------|-----------|--------------------------------|
| P0-06 | Order state separation | Backend-lead | Tier 2 | `Tested` |
| P0-04 | (completes) | Backend-lead | Tier 1 | `Failure-tested` → `Reviewed` |
| P0-03 | (completes) | Full-stack 1 | Tier 3 | `Production-ready` |
| (parallel) | P0-02 → `Approved` → `Production-ready` | Product owner | Tier 2 | `Production-ready` |

**Sprint 7 exit criteria:** P0-06 at `Tested` (so P0-07 can begin in Sprint 8). P0-04 at `Reviewed`.

### Sprint 8 (Weeks 15-16): Wave 7 — State machine + pickup (critical path terminus, multi-F-sync)

**Goal:** P0-07 — the critical path terminus. Highest-integrity gate (QR+OTP security sync). Maximum scrutiny (Tier 1).

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 8 |
|----|-----------|-------|-----------|--------------------------------|
| P0-07 | Order state machine (incl. pickup attribution) | Backend-lead | Tier 1 | `Observed` |
| P0-06 | (completes) | Backend-lead | Tier 2 | `Failure-tested` → `Reviewed` |
| (parallel) | P0-04 → `Approved` → `Production-ready` | Product owner | Tier 1 | `Production-ready` |

**F-convergence gates this sprint:**
- QR+OTP (Security/Integrity sync) — baked into P0-07's 8 attribution conditions; verification test design begins.
- LiveKitchen+Push — interaction test planning (P0-06, P0-07, P0-24; P1 push).
- Geo-fence+Pickup (caution G04) — caution flag review; P0-07 acceptance must not be weakened.

**Sprint 8 exit criteria:** P0-07 at `Observed`. P0-06 at `Reviewed`.

### Sprint 9 (Weeks 17-18): Wave 7 completion + launch readiness

**Goal:** P0-07 to `Production-ready`. All F-convergence gates pass. Launch gate check.

| P0 | Capability | Owner | Risk Tier | Target state by end of Sprint 9 |
|----|-----------|-------|-----------|--------------------------------|
| P0-07 | (completes) | Backend-lead | Tier 1 | `Failure-tested` → `Reviewed` → `Approved` → `Production-ready` |
| P0-06 | (completes) | Backend-lead | Tier 2 | `Approved` → `Production-ready` |
| (all F-gates) | QR+OTP, LiveKitchen+Push, Prepaid+Reorder, POS+Settlement, Geo-fence+Pickup (caution), Wallet+Loyalty (P2 defer), Group+Concurrency (P3 defer), Catering (P3 defer) | various | | Interaction tests pass for P0-level gates |

**Sprint 9 exit criteria:** P0-07 at `Production-ready`. All P0-level F-convergence gates pass.

### Sprint 10 (Weeks 19-20, provisional): Launch gate verification + NO-GO remediation

**Goal:** Verify all 7 launch-gate AND-conditions. This is a **verification sprint**, NOT an assumption that prior sprints left everything green. If any gate fails, the output is **NO-GO + remediation plan**, not automatic Production Go.

| Launch-gate condition | Status check |
|----------------------|--------------|
| 1. All 28 P0s at `Production-ready` | Verify all 28 green |
| 2. All 14 invariants verified | Invariant-checker suite green; 0 violations |
| 3. All critical external-dependency scenarios tested | All P0-linked dependency rows failure-injected |
| 4. DR drill passed (incl. post-restore reconciliation) | P0-26 drill report; 0 unresolved money state |
| 5. Rollback drill passed (per deployment class) | P0-27 drill report; Class 1 ≤ 10 min |
| 6. No unresolved P0 exception | Exception queue empty |
| 7. No expired exception waiver | All waivers within expiry; 0 expired |

**Sprint 10 exit:** All 7 conditions green → **PRODUCTION GO**. Any red → **NO-GO + remediation plan** (re-sprint the failing items; re-verify; do NOT launch until all green). This sprint does not assume automatic success — it verifies.

---

## 3. Critical Path Timeline

The critical path (7 edges, 8 nodes) drives the minimum timeline:

```
Sprint 1: P0-15 (Wave 0) → Tested
Sprint 2: P0-25 (Wave 1) → Tested
Sprint 3: P0-24 (Wave 2) → Observed
Sprint 4: P0-01 (Wave 3) → Observed
Sprint 5: P0-02 (Wave 4) → Tested
Sprint 6: P0-04 (Wave 5) → Observed
Sprint 7: P0-06 (Wave 6) → Tested
Sprint 8-9: P0-07 (Wave 7) → Observed → Production-ready
Sprint 10: Launch gate verification
```

**Provisional timeline: ~20 weeks (10 sprints × 2 weeks)** from Sprint 1 start to launch gate verification. **This is provisional, NOT a proven minimum.** It depends on the effort estimates in Section 1.3 (placeholders, not measured) and assumes no slippage on the critical path. Real scheduling must validate effort estimates with implementing engineers before this timeline can be committed. If any P0's real effort exceeds the placeholder, the timeline extends. Slack branches (Tier 3/4 P0s) build in parallel and must reach `Production-ready` by Sprint 9.

---

## 4. Convergence Gate Schedule

| Gate | Sprint interaction test begins | Sprint gate must pass |
|------|-------------------------------|----------------------|
| Prepaid+Reorder | Sprint 4 (P0-01, P0-08 both in progress) | Sprint 6 (both at `Production-ready`) |
| KillSwitch+OrderIntake | (already B-edge; not a sync gate) | (respected as precedence) |
| POS+Settlement | Sprint 6 (P0-02, P0-03 both in progress) | Sprint 8 (both at `Production-ready`) |
| **QR+OTP (security/integrity)** | Sprint 8 (P0-07 in progress) | Sprint 9 (P0-07 at `Production-ready`) |
| LiveKitchen+Push | Sprint 8 (P0-06, P0-07 in progress) | Sprint 9 (P0-07 at `Production-ready`; P1 push parallel) |
| Geo-fence+Pickup (caution) | Sprint 8 (caution review) | Sprint 9 (caution flag resolved — P0-07 not weakened) |
| Wallet+Loyalty (P2) | Deferred to P2 | P2 sprint |
| Group+Concurrency (P3) | Deferred to P3 | P3 sprint |
| Catering+StateMachine (P3) | Deferred to P3 | P3 sprint |

---

## 5. Ownership Assignment (Coverage G resolution)

This sprint plan resolves Coverage Query G (approvers). Each P0 now has a named owner + approver.

**Owner assignment rules:**
- Backend-lead owns critical-path P0s (P0-15, 25, 24, 01, 02, 04, 06, 07) + high-complexity integrity P0s (P0-22, 23, 28, 26).
- Full-stack engineers own auth, idempotency, webhook, error-handling, validation P0s.
- DevOps owns backup, health/metrics, alerting, rate-limiting, deployment P0s.
- Product owner is the `Approved` signatory for ALL P0s (separation of duties — product owner is not the developer).

| P0 | Owner (implements) | Reviewer (different engineer) | Approver (product owner) |
|----|-------------------|------------------------------|--------------------------|
| P0-15 | Backend-lead | Full-stack 1 | Product owner |
| P0-09 | Full-stack 1 | Full-stack 2 | Product owner |
| P0-22 | Full-stack 2 | Full-stack 1 | Product owner |
| P0-23 | Full-stack 1 | Backend-lead | Product owner |
| P0-16 | DevOps | Backend-lead | Product owner |
| P0-19 | Full-stack 2 | DevOps | Product owner |
| P0-20 | DevOps | Full-stack 1 | Product owner |
| P0-21 | DevOps | Full-stack 2 | Product owner |
| P0-12 | Full-stack 1 | Full-stack 2 | Product owner |
| P0-13 | DevOps | Backend-lead | Product owner |
| P0-14 | Full-stack 2 | Full-stack 1 | Product owner |
| P0-18 | Full-stack 1 | Backend-lead | Product owner |
| P0-27 | DevOps | Backend-lead | Product owner |
| P0-25 | Backend-lead | Full-stack 1 | Product owner |
| P0-17 | Full-stack 1 | Backend-lead | Product owner |
| P0-26 | DevOps | Backend-lead | Product owner |
| P0-28 | Full-stack 2 | Backend-lead | Product owner |
| P0-10 | Full-stack 1 | Full-stack 2 | Product owner |
| P0-11 | Full-stack 2 | Full-stack 1 | Product owner |
| P0-24 | Backend-lead | Full-stack 2 | Product owner |
| P0-01 | Backend-lead | Full-stack 1 | Product owner |
| P0-08 | Full-stack 1 | Backend-lead | Product owner |
| P0-02 | Backend-lead | Full-stack 2 | Product owner |
| P0-05 | Full-stack 1 | Backend-lead | Product owner |
| P0-04 | Backend-lead | Full-stack 2 | Product owner |
| P0-03 | Full-stack 1 | Backend-lead | Product owner |
| P0-06 | Backend-lead | Full-stack 2 | Product owner |
| P0-07 | Backend-lead | Full-stack 1 | Product owner |

**Coverage G status:** ✅ RESOLVED. All 28 P0s have named owner + reviewer + approver. Separation of duties enforced (developer ≠ reviewer ≠ approver).

---

## 6. Launch Readiness Checklist

The final sprint (Sprint 10) verifies the 7 launch-gate AND-conditions. This checklist is the operational form of that gate:

- [ ] All 28 P0s at lifecycle state 9 (`Production-ready`) — verify via lifecycle tracker
- [ ] All 14 invariants (I-01..I-14) verified — invariant-checker suite green; 0 unresolved violations
- [ ] All critical external-dependency scenarios tested — every P0-linked dependency row failure-injected (Section 10 of matrix)
- [ ] DR drill passed (incl. post-restore business-state reconciliation) — P0-26 restore-drill report; 0 unresolved money state
- [ ] Rollback drill passed (per deployment class) — P0-27 rollback-drill report; Class 1 ≤ 10 min verified
- [ ] No unresolved P0 exception in exception queue — queue empty of P0-class entries
- [ ] No expired exception waiver — every waiver has owner + expiry (≤30d) + mitigation + approval; 0 expired
- [ ] All P0-level F-convergence gates passed — QR+OTP, Prepaid+Reorder, POS+Settlement, LiveKitchen+Push, Geo-fence+Pickup (caution resolved)
- [ ] P2/P3 deferrals documented — Wallet+Loyalty, Group+Concurrency, Catering deferred with target sprint

**All boxes checked → PRODUCTION GO. Any unchecked → NO-GO.**

---

## 7. Risk Register (sprint-level)

Sprint-level risks that could delay the critical path:

| Risk | Sprint | Mitigation |
|------|--------|------------|
| P0-15 (migrations) slippage delays Wave 1 | Sprint 1 | Backend-lead dedicated; Tier 2 scrutiny from day 1 |
| P0-24 (outbox) failure-testing reveals deep bug | Sprint 3-4 | Tier 1 scrutiny; buffer in Sprint 4 for rework |
| P0-01 (Razorpay) integration issues | Sprint 4 | Razorpay test keys; fail-closed semantics tested early |
| P0-07 (pickup attribution) 8-condition complexity | Sprint 8-9 | Tier 1 scrutiny; QR+OTP security sync baked into acceptance; failure-injection for all 5 pickup-verification tests |
| DR drill (P0-26) fails post-restore reconciliation | Sprint 2-3 | DR drill starts Sprint 2; re-run until 0 unresolved money state |
| Approver bottleneck (product owner single point) | All sprints | Product owner dedicates review slots per sprint; `Approved` batched weekly |
| F-convergence gate fails interaction test | Sprint 6, 8, 9 | Interaction test design begins 1 sprint before gate target; rework buffer |

---

## 8. What This Artifact Does NOT Do

- ❌ Does not start implementation (that begins only after this plan is signed off).
- ❌ Does not reduce the launch gate (all 7 AND-conditions still required).
- ❌ Does not change P0/invariant count (28 P0s, 14 invariants — stable since v1.4).
- ❌ Does not bypass separation of duties (developer ≠ reviewer ≠ approver).
- ❌ Does not treat P-edges as precedence (risk signals only).
- ❌ Does not treat P0-27 as universal prereq (parallel-isolated).

This is the **final planning artifact**. Sign-off unlocks implementation.

---

## 9. Sign-off Status

| Criterion | Status |
|-----------|--------|
| 8 waves mapped to sprints | ✅ (10 sprints; ~20 weeks PROVISIONAL) |
| Critical path timeline derived | ✅ (provisional — pending effort validation per Section 1.3) |
| Wave-0 capacity constrained (13 P0s ≠ 1 sprint) | ✅ (3.5 slots/sprint; Wave 0 spans Sprints 1-2) |
| Assignment vs completion vs Production-ready distinguished | ✅ (Section 1.2 explicit) |
| Sprint 10 = verification (not automatic GO) | ✅ (NO-GO + remediation if any gate fails) |
| Convergence gates scheduled | ✅ (5 P0-level gates; P2/P3 deferred) |
| Ownership assigned (Coverage G resolved) | ✅ (all 28 P0s have owner + reviewer + approver) |
| Lifecycle state progression per sprint | ✅ (Tier 1: 1-2 states/sprint; Tier 2-4: 2-3) |
| Launch readiness checklist | ✅ (9-item checklist mapping to 7 launch-gate conditions) |
| Risk register | ✅ (7 sprint-level risks with mitigations) |
| No implementation started | ✅ (discipline held — plan only) |

**Artifact 5 — Sprint Plan: DRAFT COMPLETE.** Pending stakeholder sign-off.

---

## 10. Unlock for Implementation

With the sprint plan signed off, **implementation begins**. Sprint 1 starts the foundation wave. The critical path drives the **provisional** ~20-week timeline to launch gate verification — this must be validated against real effort estimates before being committed as a schedule.

The entire chain is now complete:
```
v1.4 Matrix ✅ → Artifact 1 Traceability Map ✅ FINAL
   → Artifact 2 Dependency Graph ✅ ACCEPTED
   → Artifact 3 Critical Path ✅ FINAL ACCEPTED
   → Artifact 4 Implementation Order ✅ ACCEPTED
   → Artifact 5 Sprint Plan ✅ DRAFT (pending sign-off)
   → IMPLEMENTATION (unlocked after Artifact 5 sign-off)
```

---

*End of Sprint Plan (Artifact 5).*
