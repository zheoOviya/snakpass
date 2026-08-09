# Critical Path to Launch

> **Artifact 3** of the SnakZap production-readiness chain.
> **Source:** P0 Dependency Graph (Artifact 2, ACCEPTED).
> **Purpose:** Compute what constrains the launch path — the longest blocking path(s), parallelizable clusters, slack branches, and risk-weighted criticality. Answer: "what blocks launch?" — NOT "what do we build first?"
> **Status:** Draft — path analysis.
> **Boundary (locked by stakeholder):** This artifact computes the critical path. It does NOT prescribe implementation sequence, assign sprints, or assign developers. That is Artifact 4 + Artifact 5.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Artifact | 3 of 5 (Traceability Map ✅ → Dependency Graph ✅ → **Critical Path** → Implementation Order → Sprint Plan) |
| Source | P0_DEPENDENCY_GRAPH.md (ACCEPTED) |
| Date | 2026-08-09 |
| Status | Draft — path analysis |
| Edges used for path computation | `--B-->` (blocking business) + `--F-->` (feature interactions) |
| Edges used for risk weighting only | `--P-->` (failure propagation) — never as path edges |
| P0-27 treatment | Isolated control node; excluded from business critical path |

---

## 1. Method

### 1.1 What "critical path" means here

The critical path is the **longest chain of blocking B-edges** from a root (no B-dependency) to a leaf (no B-dependent). Any P0 on this chain, if delayed, delays every downstream P0 on the chain — and thus delays launch (because launch requires all P0s at `Production-ready`).

**Path length** = number of B-edges in the chain (number of nodes minus one).

### 1.2 Rules (locked from Artifact 2 + stakeholder boundary)

1. **Only `--B[blocking]-->` edges** are path edges. `--B[non-blocking]-->` and `--B[parallelizable]-->` do not extend a path (the dependent can proceed without the dependency at `Production-ready`).
2. **`--F-->` feature interactions** are super-blocking nodes — all member P0s must be `Production-ready` AND the interaction test must pass. An F-node attaches to the path as a join: the path cannot complete the interaction until all members are ready.
3. **`--P-->` failure-propagation edges** are NEVER path edges. They weight risk/criticality only.
4. **P0-27 (Deployment)** is an isolated control node — excluded from the business critical path. It must reach `Production-ready` before launch (it is on the launch gate), but it does not block other P0s.
5. **Multiple co-critical paths are accepted.** If two or more paths share the maximum length, they are all critical. No forced compression into a single chain.

### 1.3 Computation

For each leaf, trace backward through blocking B-edges to roots. The longest such chain defines the critical path(s). Multiple leaves may share the maximum length → multiple co-critical paths.

---

## 2. Topological Layering (by blocking B-dependencies)

Layer = longest distance from any root. Roots are Layer 0. A node is in Layer N if its longest blocking-B dependency chain from a root is N edges.

| Layer | P0s | Rationale |
|-------|-----|-----------|
| **L0 (roots)** | P0-09, P0-13, P0-15, P0-16, P0-19, P0-20, P0-21, P0-22 | No blocking B-dependency. P0-27 omitted (isolated control). |
| **L1** | P0-10 (←P0-09), P0-11 (←P0-09; P0-13 is non-blocking), P0-17 (←P0-15), P0-25 (←P0-15), P0-24 (←P0-15; P0-25 in same layer — see note), P0-26 (←P0-16), P0-28 (←P0-19/20/21/22) | Direct blocking deps from L0. |
| **L2** | P0-01 (←P0-09, P0-17, P0-24) | Payment capture needs auth + idempotency + transactional integrity. |
| **L3** | P0-02 (←P0-01), P0-05 (←P0-01), P0-08 (←P0-24, P0-25) | Ledger + webhook depend on capture; order idempotency depends on transactional + concurrency (both L1). |
| **L4** | P0-04 (←P0-01, P0-02), P0-03 (←P0-01, P0-02), P0-06 (←P0-01, P0-02, P0-04, P0-05) | Refund + reconciliation depend on capture+ledger; state separation spans all four. |
| **L5** | P0-07 (←P0-06, P0-22) | State machine needs separated states (L4) + audit (L0). |

**Note on L1 P0-24:** P0-24 depends on P0-25 (same layer). This is a within-layer dependency — both must reach `Implemented` before either can progress; they are a tight parallelizable pair. Treated as L1 for path purposes (P0-25 is the path predecessor; P0-15 → P0-25 → P0-24 is length 2 to P0-24, so P0-24 is effectively L2 from P0-15's perspective). The path computation handles this correctly below.

**Leaves (no blocking B-dependent):** P0-03, P0-04, P0-07, P0-26, P0-28. (P0-27 omitted — isolated control.)

---

## 3. Longest Blocking Path(s) — Co-Critical Paths

Tracing each leaf back to roots via blocking B-edges, the maximum path length found is **6 edges (7 nodes)**. **Two leaves share this maximum → two co-critical paths.**

### 3.1 Co-Critical Path α — ends at P0-07 (Order State Machine / Pickup)

```
P0-15 (Migrations)
   ──B[blocking]──>  P0-25 (Concurrency + version fields)
   ──B[blocking]──>  P0-24 (Transactional integrity — needs concurrency)
   ──B[blocking]──>  P0-01 (Razorpay capture — needs idempotency + transactional)
   ──B[blocking]──>  P0-06 (State separation — spans payment+ledger+refund+webhook)
   ──B[blocking]──>  P0-07 (State machine incl. pickup attribution)
```
**Length: 5 edges, 6 nodes.** Ends at leaf P0-07.

**Extended via P0-22 join:** P0-07 also blocks on P0-22 (audit, L0) for I-13 attribution. P0-22 is a parallel L0 root, so it does not extend the linear length, but it is a **join dependency** — P0-07 cannot reach `Production-ready` until BOTH P0-06-chain AND P0-22 are ready.

### 3.2 Co-Critical Path β — ends at P0-03 (Reconciliation) or P0-04 (Refund)

```
P0-15 (Migrations)
   ──B[blocking]──>  P0-25 (Concurrency)
   ──B[blocking]──>  P0-24 (Transactional integrity)
   ──B[blocking]──>  P0-01 (Razorpay capture)
   ──B[blocking]──>  P0-02 (Ledger)
   ──B[blocking]──>  P0-03 (Reconciliation)   [leaf]
                   OR
   ──B[blocking]──>  P0-04 (Refund)            [leaf]
```
**Length: 5 edges, 6 nodes.** Ends at leaf P0-03 or P0-04.

### 3.3 Verdict: Two co-critical paths of equal length (5 edges / 6 nodes)

**Both paths share the prefix `P0-15 → P0-25 → P0-24 → P0-01`** (4 edges). They diverge at P0-01:
- Path α continues `→ P0-06 → P0-07` (state machine / pickup).
- Path β continues `→ P0-02 → P0-03` (ledger → reconciliation) or `→ P0-02 → P0-04` (ledger → refund).

**These are genuinely co-critical.** Forcing them into a single chain would misrepresent the graph — P0-06/P0-07 and P0-02/P0-03/P0-04 are parallel branches off P0-01, not sequential. Both must complete for launch; neither is subordinate.

### 3.4 The shared critical prefix (the true bottleneck)

```
P0-15 (Migrations) → P0-25 (Concurrency) → P0-24 (Transactional integrity) → P0-01 (Razorpay capture)
```

**This 4-edge prefix is the single most constraining chain in the entire graph.** Every co-critical path passes through it. Any delay in P0-15, P0-25, P0-24, or P0-01 delays both co-critical paths simultaneously. This is the **bottleneck** — but it is NOT an implementation order prescription; it is a structural fact about what constrains launch.

---

## 4. Feature-Interaction Joins on the Critical Path

Feature interactions (`--F-->`) impose super-blocking joins. The relevant ones touching the critical path:

| F-node | Members | Affects critical path? | Join effect |
|--------|---------|------------------------|-------------|
| Prepaid + Quick Reorder | P0-01, P0-08, P0-25 | **Yes** — P0-01 and P0-25 are on the critical prefix; P0-08 is L3 (off-prefix but on a parallel branch) | P0-01 cannot reach `Production-ready` via this interaction until P0-08 is also ready + interaction test passes |
| Kill Switch + Order Intake | P0-23, P0-01 | **Yes** — P0-01 on critical prefix | P0-01's launch-readiness gated by P0-23 + interaction test |
| Live Kitchen + Push | P0-06, P0-07, P0-24 | **Yes** — P0-06, P0-07 on path α; P0-24 on critical prefix | Path α's terminus (P0-07) gated by this interaction |
| POS + Settlement | P0-02, P0-03, (P3 POS) | **Yes** — P0-02, P0-03 on path β | Path β's terminus (P0-03) gated; P3 POS not launch-blocking |
| Wallet + Loyalty | P0-02, (P2 loyalty) | Partially — P0-02 on path β | P0-02's launch-readiness gated by ledger-backed loyalty decision (caution flag L02) |
| Group Order + Concurrency | P0-25, (P3 group) | Partially — P0-25 on critical prefix | P3 group not launch-blocking; interaction test deferred to P3 |
| Geo-fence + Pickup | P0-07, I-13 | **Yes** — P0-07 terminus of path α; caution flag | P0-07's launch-readiness gated by I-13 attribution holding under geo-fence (caution flag G04) |
| Catering + State Machine | P0-07 extension, (P3 catering) | Partially — P0-07 on path α | P3 catering not launch-blocking; caution flag C01 for future |

**F-node effect on critical path:** The critical path's termini (P0-07, P0-03, P0-04) cannot reach `Production-ready` until their respective F-node interaction tests pass. This extends the *effective* launch-readiness of the path but does not extend its *length* (F-nodes are joins, not chain extensions).

---

## 5. Parallelizable Clusters

Clusters of P0s that can be built concurrently (reach `Implemented` around the same time) and block each other only at `Production-ready` sign-off.

| Cluster | Members | Why parallelizable |
|---------|---------|--------------------|
| **Observability trio** | P0-19, P0-20, P0-21 | All roots (L0); all feed P0-28; no inter-deps |
| **Foundation trio** | P0-12 (Zod), P0-14 (CSRF), P0-18 (Error handling) | Roots, no inter-deps; built alongside anything |
| **Payment cluster** | P0-01, P0-02, P0-05 | After P0-24+P0-17 ready: capture+ledger+webhook converge; block each other only at sign-off |
| **Reconciliation + Refund** | P0-03, P0-04 | After P0-01+P0-02 ready: both can proceed concurrently |
| **Auth cluster** | P0-09, P0-10, P0-11 | P0-09 root; P0-10/P0-11 depend only on P0-09 (P0-13 to P0-11 is non-blocking) |
| **DR pair** | P0-16, P0-26 | P0-16 root → P0-26; but P0-26's restore drill can be developed alongside P0-16's backup |
| **Concurrency + Transactional pair** | P0-25, P0-24 | Within-layer pair; both depend on P0-15; P0-24 depends on P0-25 but both reach Implemented together |

**Parallelizable ≠ simultaneous launch.** It means development can overlap; sign-off still respects blocking semantics.

---

## 6. Slack / Non-Critical Branches

P0s NOT on any co-critical path. They have slack — they can be delayed (within their own constraints) without delaying launch, as long as they reach `Production-ready` before the launch gate.

| P0 | Why off critical path | Slack note |
|----|----------------------|------------|
| P0-09 (Firebase verify) | L0 root, but only feeds P0-01 (on path) and P0-10/P0-11 (off path) | Must be ready before P0-01, but is L0 — starts immediately |
| P0-10, P0-11 (Session, OTP) | L1, leaves of auth branch; not on payment/order critical path | Slack so long as P0-09 done; needed for auth UX but not for payment/order integrity |
| P0-13 (Rate limiting) | L0 root, non-blocking to P0-11 | Full slack — hardens P0-11 but doesn't block |
| P0-16, P0-26 (Backup, DR) | L0/L1, leaf P0-26; separate branch | Must reach Production-ready for launch gate, but independent of payment/order path |
| P0-19, P0-20, P0-21 (Observability) | L0 roots, feed P0-28 | Independent cluster; P0-28 is a leaf but its path is length 1 |
| P0-22 (Audit) | L0 root, feeds P0-07 + P0-28 | Join dependency on path α (P0-07 needs it), but itself is L0 — starts immediately |
| P0-23 (Kill switch) | L0 root, feeds only F-node (KillSwitch+OrderIntake) | Independent; needed for F-node join, not on linear path |
| P0-27 (Deployment) | Isolated control node | Excluded from business critical path; on launch gate separately |
| P0-28 (Unknown-exception) | L1 leaf (depends on L0 observability + audit) | Path length 1; high slack. But it is the system's safety net — risk-weighted high (see Section 7) |

---

## 7. Risk-Weighted Criticality (P-edge weighting)

`--P-->` edges do not change the path, but they weight which nodes on the path carry the most launch risk. A node on the critical path AND high on failure-propagation = highest criticality.

| Critical-path node | P-edges touching it | Failure-propagation exposure | Risk weight |
|--------------------|----------------------|------------------------------|-------------|
| P0-15 (Migrations) | (none direct — but DB-failure propagates to all data P0s) | Indirect: DB failure affects 16 P0s | **HIGH** — root of critical prefix; schema integrity gates everything |
| P0-25 (Concurrency) | DB-failure propagates | DB dependency | HIGH — on critical prefix |
| P0-24 (Transactional integrity) | DB-failure, Outbox-publisher-stall | Both DB + outbox worker | **HIGHEST** — on critical prefix AND has its own failure-propagation edge (outbox stall) |
| P0-01 (Razorpay capture) | Razorpay-timeout, capture-verify-mismatch | Razorpay cluster (3 P0s) | **HIGHEST** — on critical prefix AND Razorpay failure propagates here directly |
| P0-06 (State separation) | DB-failure | DB | HIGH — on path α |
| P0-07 (State machine) | DB-failure; Geo-fence+Pickup caution | DB + I-13 risk | **HIGHEST** — terminus of path α; I-13 + caution flag G04 |
| P0-02 (Ledger) | DB-failure | DB | HIGH — on path β |
| P0-03 (Reconciliation) | Razorpay-timeout (gateway ↔ ledger) | Razorpay + DB | HIGH — terminus of path β |
| P0-04 (Refund) | Razorpay-refund-down | Razorpay | HIGH — terminus of path β |

**Risk-weighting insight:** The critical prefix `P0-15 → P0-25 → P0-24 → P0-01` is not just the longest chain — it is also the highest-risk chain, because P0-24 and P0-01 each have their own direct failure-propagation edges (outbox stall, Razorpay timeout/mismatch). The DB-failure P-edge touches every node on both co-critical paths. This reinforces (without prescribing order) that the critical prefix is where launch risk concentrates.

---

## 8. Critical Path to Launch — Summary

### 8.1 The two co-critical paths

```
Co-Critical Path α (ends at Pickup/State Machine):
  P0-15 → P0-25 → P0-24 → P0-01 → P0-06 → P0-07
  [Migrations → Concurrency → Transactional → Capture → State-Sep → State-Machine]
  + join: P0-22 (Audit, L0) at P0-07
  + F-joins: Live-Kitchen+Push, Geo-fence+Pickup, Prepaid+Reorder, KillSwitch+OrderIntake

Co-Critical Path β (ends at Reconciliation / Refund):
  P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-03  (or → P0-04)
  [Migrations → Concurrency → Transactional → Capture → Ledger → Reconciliation/Refund]
  + F-joins: Prepaid+Reorder, KillSwitch+OrderIntake, POS+Settlement, Wallet+Loyalty
```

### 8.2 The bottleneck (shared critical prefix)

```
P0-15 → P0-25 → P0-24 → P0-01
[Migrations → Concurrency → Transactional → Capture]
```

Both co-critical paths pass through this 4-edge prefix. It is the single most constraining chain. Any delay in any of these four P0s delays both co-critical paths — and thus delays launch.

### 8.3 What is NOT on the critical path (slack)

P0-09 (auth), P0-10/P0-11 (session/OTP), P0-13 (rate limit), P0-16/P0-26 (backup/DR), P0-19/20/21 (observability), P0-22 (audit — L0 root, join only), P0-23 (kill switch), P0-27 (deployment — isolated), P0-28 (unknown-exception — leaf, length 1). These have slack but must still reach `Production-ready` for the launch gate.

### 8.4 The launch gate is unchanged

The critical path does NOT replace the 7-condition launch gate (matrix Section 14.1). ALL 28 P0s must reach `Production-ready` + all 7 AND-conditions. The critical path tells us *which delays hurt most*; it does not reduce the launch bar.

---

## 9. What This Artifact Does NOT Do (discipline)

- ❌ Does not prescribe implementation sequence (Artifact 4).
- ❌ Does not assign sprints (Artifact 5).
- ❌ Does not assign developers.
- ❌ Does not use `--P-->` edges as path edges (risk weighting only).
- ❌ Does not treat P0-27 as a business prerequisite.
- ❌ Does not compress co-critical paths into a single chain.
- ❌ Does not prioritize by "importance" — only by structural constraint + risk weighting.
- ❌ Does not reduce the launch gate.

The critical path is a **structural analysis**, not a plan. Artifact 4 will sequence implementation within this constraint; Artifact 5 will sprint-plan the sequence.

---

## 10. Sign-off Status

| Criterion | Status |
|-----------|--------|
| Longest blocking path(s) computed from B-edges | ✅ Two co-critical paths (length 5 each) |
| Co-critical paths preserved (not compressed) | ✅ |
| Shared critical prefix identified | ✅ (P0-15→P0-25→P0-24→P0-01) |
| Feature-interaction joins mapped on path | ✅ (4 F-nodes touch critical path) |
| Parallelizable clusters identified | ✅ (7 clusters) |
| Slack / non-critical branches identified | ✅ (9 P0s with slack) |
| P-edge risk weighting applied (not as path edges) | ✅ |
| P0-27 excluded from business critical path | ✅ |
| No implementation sequence prescribed | ✅ (discipline held) |
| No sprints / developer assignments | ✅ |

**Artifact 3 — Critical Path to Launch: DRAFT COMPLETE.** Pending stakeholder review.

---

## 11. Unlock for Artifact 4

With the critical path computed, **Artifact 4 — Implementation Order** is unlocked. It will:

1. Take the two co-critical paths + shared prefix as the sequencing skeleton.
2. Sequence the critical-prefix P0s first (they constrain everything).
3. Sequence the two divergent branches (α: P0-06→P0-07; β: P0-02→P0-03/04) — these can be parallel.
4. Interleave the slack-branch P0s (auth, observability, DR, etc.) into the available parallel slots.
5. Respect the feature-interaction joins as synchronization points.
6. Output an implementation order — NOT sprints (Artifact 5 does that).

**Artifact 4 sequences; Artifact 5 sprint-plans the sequence.**

---

*End of Critical Path to Launch (Artifact 3).*
