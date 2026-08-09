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

### 3.4 The shared longest-path prefix (dependency-graph bottleneck)

```
P0-15 (Migrations) → P0-25 (Concurrency) → P0-24 (Transactional integrity) → P0-01 (Razorpay capture)
```

**This 4-edge prefix is the dependency-graph bottleneck.** Every co-critical longest path passes through it. Any delay in P0-15, P0-25, P0-24, or P0-01 delays both co-critical paths simultaneously.

**Wording discipline (v1.4 stakeholder correction):** This is a **dependency-graph bottleneck** — a statement about topology, not schedule. Calling it "the launch bottleneck" would be premature: actual launch bottleneck status depends on real duration/effort, readiness gates, and parallel capacity, which are modeled in Artifact 4. Here we have dependency topology, not a schedule. The bottleneck label applies to the *graph*, not yet to the *launch*.

This is NOT an implementation order prescription; it is a structural fact about what constrains the dependency graph.

---

## 4. Feature-Interaction Classification (F-nodes)

Feature interactions (`--F-->`) are NOT homogeneous. Per the Strategic Blueprint's explicit treatment of synergistic features (Prepaid + Quick Reorder, QR Pickup + OTP Pickup, Live Kitchen + Push, POS + Settlement), each F-node must be classified into one of four categories, because each has a different effect on the critical path:

### 4.1 F-node classification framework

| Class | Definition | Critical-path effect | Example |
|-------|------------|----------------------|---------|
| **Synergy** | Two features enhance each other but neither technically requires the other; can ship independently | Does NOT extend path length; NOT a synchronization gate | (none currently identified at P0 — most P0-relevant interactions are stronger) |
| **Synchronization (joint readiness required)** | Both features must reach `Production-ready` together AND an interaction test must pass; one cannot launch without the other | Synchronization gate — extends *effective* launch-readiness but NOT path *length* | Live Kitchen + Push (state change must produce push with idempotent business effect) |
| **Security/Integrity synchronization** | Subset of Synchronization where the interaction upholds a security or integrity invariant; both mechanisms are required together for the invariant to hold | Synchronization gate + invariant-critical; failure of either compromises the invariant | **QR Pickup + OTP Pickup** (both required together for I-13 Pickup/Handoff Integrity — Blueprint explicitly treats them as synergistic primary mechanisms) |
| **Precedence** | One feature technically depends on another; the dependency is a true build-order edge (should be promoted to a B-edge) | Promoted to B-edge; DOES extend path length | Kill Switch + Order Intake (P0-23 must gate P0-01; effectively a B-edge) |
| **Interaction test only (launch-gate constraint)** | Features coexist but only an integration test is required at launch, not joint readiness | Launch-gate constraint; does not extend path or sync | Group Order + Concurrency (P3 group deferred; interaction test at P3) |

### 4.2 F-node classification (all 8 + 1 new)

| F-node | Members | Class | Critical-path effect | Notes |
|--------|---------|-------|----------------------|-------|
| **QR Pickup + OTP Pickup** | P0-07 (QR + OTP both required per I-13), I-13 | **Security/Integrity synchronization** | Synchronization gate + I-13 invariant-critical. P0-07 cannot reach `Production-ready` without BOTH QR and OTP verified together (already in P0-07's 8 conditions). Blueprint explicitly treats QR and OTP as synergistic primary pickup mechanisms. | **New** — added per stakeholder instruction. This is the strongest F-node class because I-13 (Pickup/Handoff Integrity) is a core product promise. |
| Kill Switch + Order Intake | P0-23, P0-01 | **Precedence** (promote to B-edge) | P0-23 must gate P0-01's order intake. Effectively a B-edge: P0-01 --B--> P0-23 (kill switch must exist before capture can be safely gated). Extends path: P0-23 → P0-01 adds P0-23 as a join on the critical prefix. | Reclassified from "synergy" to precedence. P0-23 is L0 root, so this is a join, not a chain extension — but it is a true dependency. |
| Prepaid + Quick Reorder | P0-01, P0-08, P0-25 | **Synchronization** | P0-01 and P0-25 on critical prefix; P0-08 (L3) on parallel branch. Joint readiness + interaction test (reorder-triggered payment must not double-charge — P0-25 case C). Sync gate on P0-01's launch-readiness. | |
| Live Kitchen + Push | P0-06, P0-07, P0-24, (P1 push) | **Synchronization** | P0-06/P0-07 on path α; P0-24 on critical prefix. State change must produce push with idempotent business effect. Sync gate on path α's terminus (P0-07). | |
| POS + Settlement | P0-02, P0-03, (P3 POS) | **Synchronization (P0 part)** / Interaction-test-only (P3 part) | P0-02/P0-03 on path β must sync; P3 POS interaction test deferred to P3. | |
| Wallet + Loyalty | P0-02, (P2 loyalty) | **Interaction-test-only** (P2 part) | P0-02 launch-ready independently; loyalty interaction tested at P2. Caution flag L02 (ledger-backed decision). | |
| Group Order + Concurrency | P0-25, (P3 group) | **Interaction-test-only** (P3 part) | P0-25 launch-ready independently; group interaction tested at P3. | |
| Geo-fence + Pickup | P0-07, I-13 | **Security/Integrity synchronization (caution)** | If geo-fence auto-triggers PICKED_UP, I-13 attribution must still hold (QR+OTP cannot be bypassed). Sync gate + caution flag G04. | **Caution flag** — must not weaken I-13 at P3. |
| Catering + State Machine | P0-07 extension, (P3 catering) | **Interaction-test-only** (P3 part) | P0-07 launch-ready independently; catering state-machine extension tested at P3. Caution flag C01. | |

### 4.3 F-node effect on critical path (corrected)

- **Synergy:** No effect on path length or launch-readiness gating.
- **Synchronization (incl. Security/Integrity sync):** Synchronization gate — extends *effective* launch-readiness (the terminus cannot be `Production-ready` until all members are ready + interaction test passes) but does NOT extend path *length* (it is a join, not a chain extension).
- **Precedence:** Promoted to B-edge — DOES extend path length. (Kill Switch + Order Intake → P0-01 --B--> P0-23.)
- **Interaction-test-only:** Launch-gate constraint at the relevant priority level (P2/P3); does not affect P0 critical path.

**Key correction (v1.4 stakeholder):** F-nodes are not blindly path-length-neutral. Precedence-class F-nodes DO extend the path (promoted to B-edges). Synchronization-class F-nodes add gates without extending length. The classification must be applied per F-node, not assumed uniformly.

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

**Risk-weighting insight:** The dependency-graph bottleneck prefix `P0-15 → P0-25 → P0-24 → P0-01` is not just the longest chain — it also carries the highest dependency-graph risk, because P0-24 and P0-01 each have their own direct failure-propagation edges (outbox stall, Razorpay timeout/mismatch). The DB-failure P-edge touches every node on both co-critical paths. This is a *dependency-graph risk* concentration — the full launch-risk surface is broader (see Section 8.B, which includes launch-mandatory P0s off the longest path like P0-26 DR).

---

## 8. Two Separate Outputs (v1.4 stakeholder correction)

**Critical correction:** "Longest dependency path" and "launch-critical surface" are NOT the same thing. The launch gate (matrix Section 14.1) requires ALL 28 P0s at `Production-ready`. A P0 with a short dependency branch (e.g. P0-26 Disaster Recovery, path length 1) is still launch-mandatory. Therefore:

> **Longest dependency path ≠ complete launch criticality.**

This section separates the two outputs explicitly.

### 8.A Structural Critical Path (from B/F topology → longest dependency chains)

This is a pure graph-theoretic output: the longest chain(s) of blocking B-edges, with F-node precedence promotions and synchronization joins applied.

```
Co-Critical Path α (ends at Pickup/State Machine):
  P0-15 → P0-25 → P0-24 → P0-01 → P0-06 → P0-07
  [Migrations → Concurrency → Transactional → Capture → State-Sep → State-Machine]
  + B-join: P0-22 (Audit, L0) at P0-07 (PICKED_UP needs audit per I-13)
  + B-join: P0-23 (Kill Switch, L0) at P0-01 (Precedence promotion from F-node)
  + Sync gates: QR+OTP (Security/Integrity), Live-Kitchen+Push, Geo-fence+Pickup, Prepaid+Reorder

Co-Critical Path β (ends at Reconciliation / Refund):
  P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-03  (or → P0-04)
  [Migrations → Concurrency → Transactional → Capture → Ledger → Reconciliation/Refund]
  + B-join: P0-23 (Kill Switch) at P0-01
  + Sync gates: Prepaid+Reorder, POS+Settlement (P0 part), Wallet+Loyalty (P2 part — interaction test only)
```

**Structural bottleneck (dependency-graph bottleneck, NOT launch bottleneck):**
```
P0-15 → P0-25 → P0-24 → P0-01
[Migrations → Concurrency → Transactional → Capture]
```
Both co-critical paths pass through this 4-edge prefix. It is the dependency-graph bottleneck — the single most constraining chain *topologically*. Whether it becomes the *launch* bottleneck depends on real durations and parallel capacity (Artifact 4).

**Slack branches (off longest path, but still launch-mandatory):** P0-09, P0-10, P0-11, P0-13, P0-16, P0-19, P0-20, P0-21, P0-22, P0-26, P0-27, P0-28. These have topological slack (shorter dependency chains) but are NOT optional — all must reach `Production-ready` for the launch gate.

### 8.B Risk-Critical Surface (P-edge weighting + launch-gate mandatory + F-sync → high-risk launch surface)

This output combines three inputs to identify the *high-risk launch surface* — the set of P0s where launch risk concentrates, regardless of their position on the longest path.

**Three inputs:**
1. **P-edge weighting** (Section 7): which P0s have direct failure-propagation exposure.
2. **Launch-gate mandatory** (all 28 P0s): every P0 must be `Production-ready`; the question is which carry the most risk.
3. **F-node synchronization gates** (Section 4): which P0s are gated by security/integrity sync or precedence joins.

**Risk-Critical Surface — P0s ranked by combined risk:**

| Tier | P0s | Why high-risk |
|------|-----|---------------|
| **Tier 1 (HIGHEST)** | P0-24 (Transactional), P0-01 (Capture), P0-07 (State Machine/Pickup) | On dependency-graph bottleneck prefix (P0-24, P0-01) OR terminus of path α (P0-07) AND have direct P-edge exposure (outbox stall, Razorpay mismatch, I-13+geo-fence caution). P0-07 additionally gated by QR+OTP security/integrity sync (I-13 core promise). |
| **Tier 2 (HIGH)** | P0-15 (Migrations), P0-25 (Concurrency), P0-06 (State Sep), P0-02 (Ledger), P0-03 (Reconciliation), P0-04 (Refund) | On co-critical paths; P-edge exposure via DB-failure (touches all). P0-03/P0-04 termini of path β. |
| **Tier 3 (MEDIUM — launch-mandatory despite slack)** | P0-26 (DR), P0-28 (Unknown-exception), P0-22 (Audit), P0-23 (Kill Switch), P0-09 (Firebase) | Off longest path but launch-critical: P0-26 is the launch-gate DR drill; P0-28 is the system safety net; P0-22 holds audit evidence for I-13; P0-23 gates order intake (precedence F-node); P0-09 roots the auth chain. Short topological path ≠ low launch risk. |
| **Tier 4 (lower risk, parallel)** | P0-10, P0-11, P0-13, P0-16, P0-17, P0-19, P0-20, P0-21, P0-27 | Auth/session/OTP/rate-limit/backup/idempotency/observability/deployment — important but independent; parallelizable; lower concentration of launch risk. |

**Key insight:** The Risk-Critical Surface (8.B) is LARGER than the Structural Critical Path (8.A). P0-26, P0-28, P0-22, P0-23, P0-09 are NOT on the longest path but ARE high-risk for launch because they are launch-mandatory AND carry specific risk (DR drill, safety net, audit evidence, intake gate, auth root). **A delay in P0-26 (DR drill) can block launch even though it is not on the longest dependency chain.**

### 8.C Relationship between the two outputs

- **Structural Critical Path (8.A)** answers: "which dependency chains are longest?" — a topology question.
- **Risk-Critical Surface (8.B)** answers: "where does launch risk concentrate?" — a risk + mandatory + sync question.
- **The launch gate (matrix Section 14.1)** answers: "what must ALL be green to launch?" — a completeness question.

These three are distinct. The critical path does NOT reduce the launch gate; the risk surface does NOT equal the critical path. Artifact 4 (Implementation Order) will use BOTH: the structural path to sequence dependencies, the risk surface to prioritize hardening within the sequence.

### 8.D The launch gate is unchanged

The critical path and risk surface do NOT replace the 7-condition launch gate (matrix Section 14.1). ALL 28 P0s must reach `Production-ready` + all 7 AND-conditions. The two outputs tell us *which delays hurt most* (structural) and *where risk concentrates* (surface); neither reduces the launch bar.

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
- ❌ Does not equate "longest dependency path" with "complete launch criticality" — the two are separate outputs (8.A vs 8.B).
- ❌ Does not treat all F-nodes as path-length-neutral — F-nodes are classified (synergy / synchronization / security-integrity-sync / precedence / interaction-test-only) and each class has a distinct effect.
- ❌ Does not call the shared prefix "the launch bottleneck" — it is the *dependency-graph* bottleneck; launch-bottleneck status requires schedule modeling (Artifact 4).

This artifact produces **two separate outputs** (Structural Critical Path + Risk-Critical Surface), not a single merged "critical path." Artifact 4 will use BOTH: structural path to sequence dependencies, risk surface to prioritize hardening within the sequence.

---

## 10. Sign-off Status

| Criterion | Status |
|-----------|--------|
| Longest blocking path(s) computed from B-edges | ✅ Two co-critical paths (length 5 each) |
| Co-critical paths preserved (not compressed) | ✅ |
| Shared dependency-graph prefix identified (NOT "launch bottleneck") | ✅ (P0-15→P0-25→P0-24→P0-01) |
| F-nodes classified (synergy/sync/security-sync/precedence/interaction-test) | ✅ (9 F-nodes incl. new QR+OTP security-integrity sync) |
| Structural Critical Path (8.A) separated from Risk-Critical Surface (8.B) | ✅ |
| All P0s remain launch-required (longest path ≠ launch criticality) | ✅ Explicitly stated |
| Parallelizable clusters identified | ✅ (7 clusters) |
| Slack / non-critical branches identified (still launch-mandatory) | ✅ |
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
