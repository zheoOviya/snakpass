# P0 Implementation Order

> **Artifact 4** of the SnakZap production-readiness chain.
> **Source:** Critical Path to Launch (Artifact 3, FINAL ACCEPTED) + P0 Dependency Graph (Artifact 2, ACCEPTED) + Production Readiness Matrix v1.4.
> **Purpose:** Derive an implementation *order* — a sequence of waves in which P0 capabilities can be built, respecting B-dependency precedence, F-node synchronization gates, and Risk-Critical Surface hardening priority.
> **Output type:** Sequence/order. **NOT** sprints, teams, dates, or effort estimates. That is Artifact 5 (Sprint Plan).
> **Status:** Draft — order derivation.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Artifact | 4 of 5 (Traceability Map ✅ → Dependency Graph ✅ → Critical Path ✅ → **Implementation Order** → Sprint Plan) |
| Source | CRITICAL_PATH.md (FINAL) + P0_DEPENDENCY_GRAPH.md (ACCEPTED) + PRODUCTION_READINESS_MATRIX.md v1.4 |
| Date | 2026-08-09 |
| Status | Draft — order derivation |
| Output | Sequence of implementation waves |
| NOT output | Sprints, teams, dates, effort |

---

## 1. Boundary (locked by stakeholder)

### Use
- 7-edge critical path (`P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-04 → P0-06 → P0-07`) as the sequencing skeleton.
- B-dependencies as actual precedence (a node's wave ≥ max of its blocking B-predecessors' waves).
- F-nodes as synchronization/interaction gates (convergence points where branches must meet).
- Risk-Critical Surface as hardening priority (Tier 1 P0s get most scrutiny within their wave).
- Slack branches as parallelization opportunities (off-critical-path P0s build in parallel with critical-path P0s of the same wave).

### Do NOT
- Treat P-edges as implementation precedence (they are risk signals only).
- Treat P0-27 as a universal prerequisite (it is an isolated control node — built in parallel, on launch gate separately).
- Treat risk ranking as schedule (Tier 1 ≠ "build first" — it means "most scrutiny when built").
- Derive sprints, teams, or dates (Artifact 5 does that).

---

## 2. Sequencing Method

### 2.1 Wave assignment

Each P0 is assigned to an **implementation wave**. Wave N contains P0s that can begin implementation once all their blocking B-predecessors have reached at least `Dependency-ready` (lifecycle state 3). The wave number equals the depth from Section 2.A of Artifact 3 — this is not a coincidence; depth *is* the topological wave.

```
wave(P0) = depth(P0)  [from Artifact 3 Section 2.A mechanical verification]
```

A P0 in wave N can begin implementation in parallel with other wave-N P0s. It cannot reach `Production-ready` until its blocking B-predecessors reach `Production-ready` — but it CAN reach `Implemented`/`Tested` once predecessors reach `Dependency-ready`. This overlap is what makes waves parallel rather than strictly sequential.

### 2.2 Within-wave ordering

Within a wave, P0s are ordered by **Risk-Critical Surface tier** (Artifact 3 Section 8.B):
- Tier 1 (HIGHEST) first — gets most review cycles, most scrutiny.
- Tier 2 (HIGH) next.
- Tier 3 (MEDIUM) next.
- Tier 4 (lower risk) last within the wave.

This is NOT "Tier 1 builds before Tier 2 in time" — it is "Tier 1 gets priority attention within the wave's parallel work." A wave is a parallel slot, not a sequence.

### 2.3 F-node convergence gates

Some F-nodes span multiple waves. These create **convergence gates** — points where branches must synchronize before progressing. A convergence gate at wave N means: no P0 downstream of the gate can reach `Production-ready` until ALL gate members reach `Production-ready` AND the interaction test passes.

---

## 3. Implementation Waves

### Wave 0 — Foundation roots (12 P0s, parallel)

All P0s with no blocking B-dependency. These can begin implementation immediately (modulo approver assignment — Coverage G).

| Order | P0 | Capability | Risk Tier | Notes |
|-------|-----|-----------|-----------|-------|
| 1 | P0-15 | Database migrations | Tier 2 (HIGH) | Root of critical path; schema gates everything downstream |
| 2 | P0-22 | Audit trail integrity | Tier 3 (MEDIUM) | Join dep on P0-07 (I-13); WORM storage |
| 3 | P0-23 | Kill switch fail-safe | Tier 3 (MEDIUM) | Predecessor of P0-01 (promoted F→B); I-09 |
| 4 | P0-09 | Firebase token verify | Tier 3 (MEDIUM) | Root of auth chain; I-12 |
| 5 | P0-16 | Backup | Tier 4 | Predecessor of P0-26 (DR) |
| 6 | P0-19 | Structured logging | Tier 4 | Observability substrate |
| 7 | P0-20 | Health + metrics | Tier 4 | Observability substrate |
| 8 | P0-21 | Alerting | Tier 4 | Observability substrate |
| 9 | P0-12 | Zod validation | Tier 4 | Control/Enabler; foundational |
| 10 | P0-13 | Rate limiting | Tier 4 | Control/Enabler |
| 11 | P0-14 | CSRF protection | Tier 4 | Control/Enabler |
| 12 | P0-18 | Error handling | Tier 4 | Control/Enabler |
| (parallel) | P0-27 | Deployment & rollback | (isolated) | Isolated control node — built in parallel, on launch gate separately. NOT a universal prereq. |

**Within-wave priority:** P0-15 (Tier 2) gets earliest attention — it's the root of the critical path. The rest proceed in parallel.

### Wave 1 — Direct root-dependents (6 P0s, parallel)

P0s whose only blocking B-predecessors are Wave 0 roots.

| Order | P0 | Capability | Risk Tier | Predecessors (wave 0) |
|-------|-----|-----------|-----------|----------------------|
| 1 | P0-25 | Concurrency + version fields | Tier 2 (HIGH) | P0-15 |
| 2 | P0-17 | Idempotency (critical writes) | Tier 4 | P0-15 |
| 3 | P0-26 | Disaster recovery (business recovery) | Tier 3 (MEDIUM) | P0-16 |
| 4 | P0-28 | Unknown-exception handling | Tier 3 (MEDIUM) | P0-19, P0-20, P0-21, P0-22 |
| 5 | P0-10 | Session integrity | Tier 4 | P0-09 |
| 6 | P0-11 | OTP retry limits | Tier 4 | P0-09 (P0-13 is non-blocking) |

**Within-wave priority:** P0-25 (Tier 2, on critical path) gets earliest attention.

### Wave 2 — Transactional layer (1 P0)

| Order | P0 | Capability | Risk Tier | Predecessors |
|-------|-----|-----------|-----------|-------------|
| 1 | P0-24 | Transactional data integrity (outbox) | Tier 1 (HIGHEST) | P0-15 (wave 0), P0-25 (wave 1) |

**Convergence gate:** P0-24 requires BOTH P0-15 AND P0-25 at `Dependency-ready`. Since P0-25 is wave 1, P0-24 begins once wave 1's P0-25 is far enough along. This is the first wave where the critical path "throttles" — P0-24 cannot start until P0-25 is ready.

**Within-wave priority:** P0-24 is Tier 1 (HIGHEST) — it has its own failure-propagation edge (outbox stall). Maximum scrutiny.

### Wave 3 — Capture layer (2 P0s, parallel)

| Order | P0 | Capability | Risk Tier | Predecessors |
|-------|-----|-----------|-----------|-------------|
| 1 | P0-01 | Razorpay capture | Tier 1 (HIGHEST) | P0-09 (w0), P0-17 (w1), P0-24 (w2), P0-23 (w0) |
| 2 | P0-08 | Order idempotency | Tier 4 | P0-24 (w2), P0-25 (w1) |

**Convergence gate:** P0-01 has FOUR predecessors across three waves (P0-09 w0, P0-17 w1, P0-24 w2, P0-23 w0). All must reach `Dependency-ready` before P0-01 begins. This is the most convergence-heavy node — it is where the auth chain, idempotency chain, transactional chain, and kill-switch chain all meet.

**F-node convergence at this wave:**
- **Prepaid + Quick Reorder** (Synchronization): members P0-01 (wave 3), P0-08 (wave 3), P0-25 (wave 1). All three converge here. P0-01 cannot reach `Production-ready` until P0-08 is also ready + interaction test passes (reorder-triggered payment must not double-charge).
- **Kill Switch + Order Intake** (Precedence, already promoted to B-edge): P0-23 (wave 0) → P0-01 (wave 3). Already respected as a B-edge.

**Within-wave priority:** P0-01 is Tier 1 (HIGHEST) — Razorpay failure propagates here directly. Maximum scrutiny.

### Wave 4 — Ledger + webhook (2 P0s, parallel)

| Order | P0 | Capability | Risk Tier | Predecessors |
|-------|-----|-----------|-----------|-------------|
| 1 | P0-02 | Payment ledger (double-entry) | Tier 2 (HIGH) | P0-01 (wave 3) |
| 2 | P0-05 | Webhook integrity (HMAC + idempotent) | Tier 4 | P0-01 (wave 3) |

**Within-wave priority:** P0-02 (Tier 2, on critical path) first.

### Wave 5 — Reconciliation + refund (2 P0s, parallel)

| Order | P0 | Capability | Risk Tier | Predecessors |
|-------|-----|-----------|-----------|-------------|
| 1 | P0-04 | Refund flow (full + partial) | Tier 1 (HIGHEST) | P0-01 (w3), P0-02 (w4) |
| 2 | P0-03 | Payment reconciliation | Tier 3 (MEDIUM) | P0-01 (w3), P0-02 (w4) |

**F-node convergence at this wave:**
- **POS + Settlement** (Synchronization, P0 part): members P0-02 (wave 4), P0-03 (wave 5). P0-03 cannot reach `Production-ready` until P0-02 is ready + interaction test (POS-imported orders settle correctly). P3 POS part is deferred.

**Within-wave priority:** P0-04 (Tier 1, on critical path AND has direct P-edge: Razorpay refund gateway) first.

### Wave 6 — State separation (1 P0)

| Order | P0 | Capability | Risk Tier | Predecessors |
|-------|-----|-----------|-----------|-------------|
| 1 | P0-06 | Order state separation (Order/Payment/Fulfilment/Refund) | Tier 2 (HIGH) | P0-01 (w3), P0-02 (w4), P0-04 (w5), P0-05 (w4) |

**Convergence gate:** P0-06 has FOUR predecessors across three waves. All must reach `Dependency-ready`. P0-06 is the integration point where the four state dimensions (Order, Payment, Fulfilment, Refund) are separated and made to coexist.

### Wave 7 — State machine + pickup (1 P0 — critical path terminus)

| Order | P0 | Capability | Risk Tier | Predecessors |
|-------|-----|-----------|-----------|-------------|
| 1 | P0-07 | Order state machine hardening (incl. pickup attribution) | Tier 1 (HIGHEST) | P0-06 (wave 6), P0-22 (wave 0) |

**Convergence gate:** P0-07 requires P0-06 (wave 6) AND P0-22 (wave 0, audit). This is the critical path terminus — the last P0 on the longest dependency chain.

**F-node convergence at this wave (multiple security/integrity synchronizations):**
- **QR Pickup + OTP Pickup** (Security/Integrity synchronization): both required together for I-13. P0-07's 8 attribution conditions include QR+OTP verification. This is already baked into P0-07's acceptance — no separate convergence, but it IS the highest-integrity gate in the system.
- **Live Kitchen + Push** (Synchronization): members P0-06 (w6), P0-07 (w7), P0-24 (w2), P1 push. P0-07 cannot reach `Production-ready` until interaction test passes (state change produces push with idempotent business effect).
- **Geo-fence + Pickup** (Security/Integrity synchronization, caution G04): P0-07 + I-13. If geo-fence auto-triggers PICKED_UP at P3, I-13 attribution must still hold. Caution flag — not launch-blocking at P0, but P0-07's acceptance must not be weakened.

**Within-wave priority:** P0-07 is Tier 1 (HIGHEST) — terminus of critical path, I-13 core promise, QR+OTP security sync, geo-fence caution. Maximum scrutiny.

---

## 4. Full Implementation Order Summary

| Wave | P0s (in within-wave priority order) | Convergence / sync notes |
|------|--------------------------------------|--------------------------|
| **0** | P0-15, P0-22, P0-23, P0-09, P0-16, P0-19, P0-20, P0-21, P0-12, P0-13, P0-14, P0-18, (P0-27 parallel-isolated) | Foundation; all parallel |
| **1** | P0-25, P0-17, P0-26, P0-28, P0-10, P0-11 | Direct root-dependents |
| **2** | P0-24 | First critical-path throttle (needs P0-15 + P0-25) |
| **3** | P0-01, P0-08 | **F-convergence: Prepaid+Reorder** (P0-01, P0-08, P0-25) |
| **4** | P0-02, P0-05 | Ledger + webhook |
| **5** | P0-04, P0-03 | **F-convergence: POS+Settlement** (P0-02, P0-03) |
| **6** | P0-06 | State separation (4-way convergence) |
| **7** | P0-07 | **F-convergence: QR+OTP (security), LiveKitchen+Push, Geo-fence+Pickup (caution)** |

**Total: 28 P0s across 8 waves.** Critical path runs through waves 0→1→2→3→4→5→6→7 (one P0 per wave on the critical path, except wave 0 which has the root).

---

## 5. Convergence Gates (F-node synchronization points)

These are the points where parallel branches must synchronize before downstream P0s can reach `Production-ready`. They do NOT block `Implemented`/`Tested` — only `Production-ready` sign-off.

| Gate | Wave | Members (all must be Production-ready + interaction test) | Downstream effect |
|------|------|----------------------------------------------------------|-------------------|
| Prepaid + Quick Reorder | 3 | P0-01 (w3), P0-08 (w3), P0-25 (w1) | P0-01 cannot be Production-ready until gate passes |
| Kill Switch + Order Intake | 3 | P0-23 (w0) → P0-01 (w3) [promoted to B-edge] | Already a B-edge; respected as precedence |
| POS + Settlement | 5 | P0-02 (w4), P0-03 (w5), (P3 POS deferred) | P0-03 cannot be Production-ready until gate passes (P0 part) |
| Wallet + Loyalty | 4-5 | P0-02 (w4), (P2 loyalty deferred) | Interaction-test-only at P2; P0-02 independent |
| Group Order + Concurrency | 1 | P0-25 (w1), (P3 group deferred) | Interaction-test-only at P3; P0-25 independent |
| **QR Pickup + OTP Pickup** | 7 | P0-07 (w7), I-13 | **Security/Integrity sync** — baked into P0-07's 8 attribution conditions; highest-integrity gate |
| Live Kitchen + Push | 6-7 | P0-06 (w6), P0-07 (w7), P0-24 (w2), (P1 push) | P0-07 cannot be Production-ready until gate passes |
| Geo-fence + Pickup | 7 | P0-07 (w7), I-13, (P3 geo-fence deferred) | **Caution flag G04** — P0-07 must not be weakened at P3 |
| Catering + State Machine | 7 | P0-07 extension (w7), (P3 catering deferred) | Caution flag C01; interaction-test-only at P3 |

---

## 6. Risk-Critical Surface → Hardening Priority

The Risk-Critical Surface (Artifact 3 Section 8.B) does NOT change the wave order — it changes the **scrutiny** within each wave. Tier 1 P0s get the most review cycles, the most failure-injection tests, the most observability wiring.

| Tier | P0s | Wave | Hardening treatment |
|------|-----|------|---------------------|
| **Tier 1 (HIGHEST)** | P0-24 (w2), P0-01 (w3), P0-04 (w5), P0-07 (w7) | Each on critical path | Maximum failure-injection coverage; dedicated review; observability wired before `Tested` |
| **Tier 2 (HIGH)** | P0-15 (w0), P0-25 (w1), P0-02 (w4), P0-06 (w6) | Each on critical path | High failure-injection coverage; standard review |
| **Tier 3 (MEDIUM)** | P0-03 (w5), P0-26 (w1), P0-28 (w1), P0-22 (w0), P0-23 (w0), P0-09 (w0) | Slack branches | Standard coverage; launch-mandatory despite slack |
| **Tier 4 (lower)** | P0-05 (w4), P0-08 (w3), P0-10 (w1), P0-11 (w1), P0-13 (w0), P0-16 (w0), P0-17 (w1), P0-19 (w0), P0-20 (w0), P0-21 (w0), P0-27 (w0) | Parallel/parallelizable | Standard coverage; parallelizable for efficiency |

**Rule:** Tier 1 P0s are NOT "built first" — they are built in their wave, but with the most rigor. A Tier 1 P0 in wave 7 (P0-07) is still built in wave 7, not pulled earlier. Risk tier informs scrutiny, not sequence.

---

## 7. Parallelization Opportunities

Within each wave, P0s can be built in parallel (different engineers/teams). The waves with the most parallelization opportunity:

| Wave | Parallelizable P0s | Count | Notes |
|------|-------------------|-------|-------|
| 0 | P0-15, 22, 23, 09, 16, 19, 20, 21, 12, 13, 14, 18, (27) | 13 | Largest parallel slot — foundation |
| 1 | P0-25, 17, 26, 28, 10, 11 | 6 | Direct root-dependents |
| 3 | P0-01, P0-08 | 2 | Capture + order idempotency (but F-convergent) |
| 4 | P0-02, P0-05 | 2 | Ledger + webhook |
| 5 | P0-04, P0-03 | 2 | Refund + reconciliation |
| 2, 6, 7 | P0-24, P0-06, P0-07 | 1 each | Critical-path singletons — no parallelization within wave |

**Slack branches that can build ahead:** Tier 3/4 P0s in early waves (P0-26 DR, P0-28 unknown-exception, P0-10/11 auth, P0-19/20/21 observability) can be built in parallel with the critical-path P0s of their wave. They have slack but must still reach `Production-ready` for the launch gate.

---

## 8. What This Artifact Does NOT Do (discipline)

- ❌ Does not assign sprints (Artifact 5).
- ❌ Does not assign teams or developers.
- ❌ Does not estimate effort or duration.
- ❌ Does not set dates.
- ❌ Does not use P-edges as precedence (risk signals only).
- ❌ Does not treat P0-27 as a universal prerequisite (parallel-isolated).
- ❌ Does not treat risk tier as schedule (Tier 1 ≠ "first in time"; it means "most scrutiny in wave").
- ❌ Does not compress waves into a single chain (waves are parallel slots).
- ❌ Does not reduce the launch gate (all 28 P0s still required).

The output is **an implementation order** — a sequence of parallel-capable waves with convergence gates. Artifact 5 (Sprint Plan) will assign this order to sprints, teams, and dates.

---

## 9. Sign-off Status

| Criterion | Status |
|-----------|--------|
| Critical path (7 edges) used as sequencing skeleton | ✅ |
| B-dependencies respected as precedence (wave = depth) | ✅ |
| F-nodes treated as convergence/synchronization gates | ✅ (9 gates mapped) |
| Risk-Critical Surface applied as hardening priority (not schedule) | ✅ (4 tiers, within-wave scrutiny) |
| Slack branches identified as parallelization opportunities | ✅ |
| P-edges NOT used as precedence | ✅ |
| P0-27 NOT treated as universal prereq | ✅ (parallel-isolated) |
| No sprints/teams/dates derived | ✅ (discipline held) |
| No new P0/invariant | ✅ |
| All 28 P0s placed in a wave | ✅ |
| Launch gate unchanged (all 28 still required) | ✅ |

**Artifact 4 — P0 Implementation Order: DRAFT COMPLETE.** Pending stakeholder review.

---

## 10. Unlock for Artifact 5

With the implementation order derived, **Artifact 5 — Sprint Plan** is unlocked. It will:

1. Take the 8 waves as the sequencing input.
2. Assign waves to sprints (multiple waves may fit in one sprint, or one wave may span multiple sprints, depending on effort estimation — which Artifact 5 does, not Artifact 4).
3. Assign teams/developers to within-wave parallel P0s.
4. Set dates based on effort + team capacity.
5. Factor convergence gates as sprint synchronization points.
6. Output a sprint plan — the final artifact before implementation begins.

**Artifact 5 sprint-plans; only then does implementation begin.**

---

*End of P0 Implementation Order (Artifact 4).*
