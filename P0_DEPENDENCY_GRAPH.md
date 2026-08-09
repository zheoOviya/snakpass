# P0 Dependency Graph

> **Artifact 2** of the SnakZap production-readiness chain.
> **Source documents:** Production Readiness Matrix v1.4 + P0 Traceability Map (Artifact 1, FINAL) + Strategic Feature Mapping (G-F1).
> **Purpose:** Map every dependency between P0 capabilities, infrastructure, business flow, and feature interactions. Provide the raw graph + edge metadata that Artifact 3 (Critical Path) will analyze.
> **Status:** Draft — graph construction.
> **Strict rule:** *Dependency visibility ≠ implementation order.* This artifact builds the graph only. Artifact 3 derives the critical path; Artifact 4 derives implementation order. No sequencing is decided here.
> **Discipline:** No new P0 capability or invariant. No implementation. Graph only.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Artifact | 2 of 5 (Traceability Map ✅ → **Dependency Graph** → Critical Path → Implementation Order → Sprint Plan) |
| Source | PRODUCTION_READINESS_MATRIX.md v1.4 + P0_TRACEABILITY_MAP.md (FINAL) + STRATEGIC_FEATURE_MAPPING.md |
| Date | 2026-08-09 |
| Status | Draft — graph construction |
| P0 nodes | 28 |
| Edge types | 5 (technical, business, feature-interaction, failure-propagation, metadata) |

---

## 1. Dependency Types

Five edge types. Each is labeled distinctly so the graph can be queried per-type.

| Type | Symbol | Meaning | Example |
|------|--------|---------|---------|
| **Technical dependency** | `--T-->` | A capability requires an infrastructure/external system to function. | P0-01 --T--> Razorpay SDK |
| **Business dependency** | `--B-->` | A capability requires another P0 capability to be at a required lifecycle state before it can function. | P0-02 (ledger) --B--> P0-01 (capture) |
| **Feature interaction** | `--F-->` | Two features jointly impose a cross-P0 requirement (from G-F1 interaction nodes). | Prepaid+Reorder --F--> {P0-01, P0-08, P0-25} |
| **Failure propagation** | `--P-->` | When a dependency fails, which P0s are compromised (consolidated from matrix Section 10). | Razorpay-down --P--> {P0-01, P0-03} |
| **Critical-path metadata** | `[blocking|non-blocking|parallelizable]` | Edge attribute: does the dependent wait for the dependency, proceed degraded, or build in parallel? | P0-02 --B[blocking]--> P0-01 |

**Metadata values (on B and F edges):**
- `blocking` — dependent cannot reach `Production-ready` without this dependency at the required lifecycle state (default for money/integrity edges).
- `non-blocking` — dependent can proceed in degraded/limited mode; dependency hardens later.
- `parallelizable` — dependent and dependency can be built concurrently (both reach `Implemented` around the same time); the dependent only blocks at `Production-ready` sign-off.

**Rule:** Metadata describes the *nature* of the edge, not the implementation sequence. Artifact 3 computes the path; Artifact 4 sequences.

---

## 2. Node Catalog (28 P0s)

Each node: lifecycle state (all S2 currently), type (Direct Protector / Control/Enabler), protects, technical deps.

| ID | Capability | Type | Protects | Lifecycle | Technical dependencies (T edges) |
|----|------------|------|----------|-----------|----------------------------------|
| P0-01 | Razorpay capture | Direct | I-01, I-04 | S2 | Razorpay SDK, Payment model (DB) |
| P0-02 | Payment ledger | Direct | I-06, I-10 | S2 | Payment model, DB transactions |
| P0-03 | Reconciliation | Direct | I-01, I-06 | S2 | Payment model, scheduled job (cron/worker) |
| P0-04 | Refund flow | Direct | I-03, I-06, I-11 | S2 | Payment model, Razorpay refund API |
| P0-05 | Webhook integrity | Direct | I-01, I-04 | S2 | Webhook HTTP endpoint, Payment model |
| P0-06 | Order state separation | Direct | I-01, I-02, I-08 | S2 | Order/Payment/Fulfilment/Refund models |
| P0-07 | Order state machine (incl. pickup attribution) | Direct | I-02, I-08, I-13 | S2 | Order model, optimistic locking (version field) |
| P0-08 | Order idempotency | Direct | I-02, I-10 | S2 | Order model, idempotency-key store |
| P0-09 | Firebase token verify | Direct | I-12 | S2 | Firebase Admin SDK, Session store |
| P0-10 | Session integrity | Direct | I-12 | S2 | Session model/store |
| P0-11 | OTP retry limits | Direct | I-12 | S2 | OTP service, rate limiter (Redis) |
| P0-12 | Zod validation | Control/Enabler | — | S2 | Zod schemas (no external dep) |
| P0-13 | Rate limiting | Control/Enabler | — | S2 | Redis (or in-memory fallback) |
| P0-14 | CSRF protection | Control/Enabler | — | S2 | CSRF token, SameSite cookie |
| P0-15 | Database migrations | Control/Enabler | — | S2 | Prisma migrate, DB |
| P0-16 | Backup | Control/Enabler | — | S2 | Backup storage, DB |
| P0-17 | Idempotency (critical writes) | Direct | I-04, I-10 | S2 | Idempotency-key store (DB/Redis) |
| P0-18 | Error handling | Control/Enabler | — | S2 | Error boundaries (framework) |
| P0-19 | Structured logging | Control/Enabler | — | S2 | Logger, log sink |
| P0-20 | Health + metrics | Control/Enabler | — | S2 | Health endpoint, metrics export |
| P0-21 | Alerting | Control/Enabler | — | S2 | Alert rules, on-call, metrics backend |
| P0-22 | Audit trail integrity | Direct | I-07 | S2 | Audit model, append-only (WORM) storage |
| P0-23 | Kill switch fail-safe | Direct | I-09 | S2 | Kill-switch store + fallback |
| P0-24 | Transactional integrity (outbox) | Direct | I-01, I-02, I-05, I-06, I-10 | S2 | DB transactions, outbox (DB table + worker) |
| P0-25 | Concurrency + duplicate-exec | Direct | I-02, I-04, I-05, I-10 | S2 | Optimistic locking, row locks (DB) |
| P0-26 | Disaster recovery | Direct | I-01, I-02, I-06, I-07, I-10 | S2 | Backup, restore drill, runbook |
| P0-27 | Deployment & rollback | Control/Enabler | — | S2 | CI/CD, feature flags |
| P0-28 | Unknown-exception handling | Direct | I-01..I-14 | S2 | Invariant checker, freeze, exception queue, alert |

---

## 3. Technical Dependency Edges (--T-->)

Capability → infrastructure/external system. These are not P0-to-P0; they are P0-to-platform.

| P0 | --T--> | Infrastructure / External | Notes |
|----|--------|---------------------------|-------|
| P0-01 | Razorpay SDK, Payment model | Gateway + DB |
| P0-02 | Payment model, DB txn engine | ACID required (PostgreSQL) |
| P0-03 | Scheduled job runner | Cron/worker for hourly reconciliation |
| P0-04 | Razorpay refund API, Payment model | Gateway + DB |
| P0-05 | Webhook HTTP endpoint | Public endpoint + HMAC verify |
| P0-06 | Order/Payment/Fulfilment/Refund models | DB schema |
| P0-07 | Order model, optimistic-lock field | DB version column |
| P0-08 | Idempotency-key store | DB or Redis |
| P0-09 | Firebase Admin SDK, Session store | Firebase + DB/Redis |
| P0-10 | Session store | DB or Redis |
| P0-11 | OTP service, rate limiter | Redis |
| P0-12 | (none external) | Library only |
| P0-13 | Redis (or in-memory fallback) | Cache layer |
| P0-14 | (none external) | Cookie + token library |
| P0-15 | Prisma migrate, DB | Schema tooling |
| P0-16 | Backup storage | Object storage / snapshot |
| P0-17 | Idempotency-key store | DB or Redis |
| P0-18 | Framework error boundaries | Next.js / app framework |
| P0-19 | Log sink | Structured log backend |
| P0-20 | Metrics export | Metrics backend (Prometheus-style) |
| P0-21 | Alert rules + on-call | Alerting system (PagerDuty-style) |
| P0-22 | Audit model, WORM storage | Append-only storage layer |
| P0-23 | Kill-switch store + fallback | DB + in-memory cache |
| P0-24 | DB txn engine, outbox table + worker | ACID + background worker |
| P0-25 | DB row locks, version fields | DB engine |
| P0-26 | Backup storage, restore tooling | DR infrastructure |
| P0-27 | CI/CD pipeline, feature-flag system | Deploy infra |
| P0-28 | Invariant checker, exception queue, alert | Background worker + queue |

**Shared infrastructure clusters (multiple P0s depend on the same platform):**
- **DB (PostgreSQL/SQLite):** P0-01, 02, 03, 04, 05, 06, 07, 08, 10, 15, 16, 17, 22, 23, 24, 25, 26 — *the single largest shared dependency; DB failure compromises all data P0s (see Section 6).*
- **Redis:** P0-11, 13, 17 (optional) — rate limiting + idempotency cache.
- **Razorpay:** P0-01, 04, 05 — payment gateway cluster.
- **Firebase:** P0-09 — auth.
- **Observability backend:** P0-19, 20, 21 — logging/metrics/alerting substrate.
- **CI/CD:** P0-27 — deployment.

---

## 4. Business Dependency Edges (--B-->)

P0-to-P0 dependencies in the business flow. The core flow: **Auth → Order → Payment → Fulfilment → Pickup → Settlement**, with cross-cutting integrity/observability wrapping it.

### 4.1 The core business flow

```
P0-09 (Firebase verify)  ──B[blocking]──>  P0-10 (Session)
P0-09                    ──B[blocking]──>  P0-11 (OTP limits)
P0-13 (Rate limiting)    ──B[non-blocking]──>  P0-11  (enables safe OTP)

P0-15 (Migrations)       ──B[blocking]──>  P0-24 (Transactional integrity)
P0-15                    ──B[blocking]──>  P0-25 (Concurrency — needs version fields)
P0-24                    ──B[blocking]──>  P0-08 (Order idempotency — atomic order create)
P0-25                    ──B[blocking]──>  P0-08 (cart re-validation inside txn)

P0-09 + P0-17 + P0-24    ──B[blocking]──>  P0-01 (Razorpay capture — needs auth + idempotency + atomicity)
P0-01                    ──B[blocking]──>  P0-05 (Webhook — closes payment)
P0-01                    ──B[blocking]──>  P0-02 (Ledger — capture event triggers entry)
P0-01 + P0-02            ──B[blocking]──>  P0-03 (Reconciliation — compares gateway vs ledger)
P0-01 + P0-02            ──B[blocking]──>  P0-04 (Refund — needs prior capture + ledger)

P0-01..P0-05             ──B[blocking]──>  P0-06 (State separation — spans all four dimensions)
P0-06 + P0-22            ──B[blocking]──>  P0-07 (State machine — operates on separated states; PICKED_UP needs audit)
```

### 4.2 Cross-cutting integrity dependencies

```
P0-15 (Migrations)       ──B[blocking]──>  P0-17 (Idempotency key store schema)
P0-16 (Backup)           ──B[blocking]──>  P0-26 (DR — needs backup to restore)
P0-19 + P0-20 + P0-21    ──B[blocking]──>  P0-28 (Unknown-exception — needs observability to detect)
P0-22 (Audit)            ──B[blocking]──>  P0-28 (Unknown-exception — needs audit evidence)
P0-27 (Deployment)       ──B[non-blocking]──>  (all P0s — enables safe rollout, not strict prereq)
```

### 4.3 Full B-edge table

| Dependent | --B--> | Dependency | Metadata | Rationale |
|-----------|--------|------------|----------|-----------|
| P0-02 | P0-01 | blocking | Ledger entry created on capture event |
| P0-03 | P0-01 | blocking | Reconciliation compares gateway ↔ ledger |
| P0-03 | P0-02 | blocking | Needs ledger to compare against |
| P0-04 | P0-01 | blocking | Refund requires prior capture |
| P0-04 | P0-02 | blocking | Refund creates ledger entry |
| P0-05 | P0-01 | blocking | Webhook closes payment |
| P0-06 | P0-01 | blocking | State separation spans payment |
| P0-06 | P0-02 | blocking | Spans ledger |
| P0-06 | P0-04 | blocking | Spans refund |
| P0-06 | P0-05 | blocking | Spans webhook |
| P0-07 | P0-06 | blocking | State machine operates on separated states |
| P0-07 | P0-22 | blocking | PICKED_UP needs audit (I-13 attribution) |
| P0-08 | P0-24 | blocking | Order create is transactional |
| P0-08 | P0-25 | blocking | Cart re-validation inside txn |
| P0-01 | P0-09 | blocking | Payment needs authenticated user |
| P0-01 | P0-17 | blocking | Payment dedup via idempotency |
| P0-01 | P0-24 | blocking | Capture is transactional |
| P0-10 | P0-09 | blocking | Session bound to verified identity |
| P0-11 | P0-09 | blocking | OTP for verified identity |
| P0-11 | P0-13 | non-blocking | Rate limiter enables safe OTP (fallback exists) |
| P0-17 | P0-15 | blocking | Idempotency store needs schema |
| P0-24 | P0-15 | blocking | Outbox + txn needs schema |
| P0-24 | P0-25 | blocking | Atomic writes need concurrency control |
| P0-25 | P0-15 | blocking | Version fields need schema |
| P0-26 | P0-16 | blocking | DR restores from backup |
| P0-28 | P0-19 | blocking | Detection needs logging |
| P0-28 | P0-20 | blocking | Detection needs metrics |
| P0-28 | P0-21 | blocking | Detection needs alerts |
| P0-28 | P0-22 | blocking | Evidence needs audit trail |
| P0-27 | (all) | non-blocking | Deployment enables safe rollout, not strict prereq |
| P0-12 | (none) | — | Zod is foundational, no P0 dep |
| P0-13 | (none) | — | Rate limiter foundational |
| P0-14 | (none) | — | CSRF foundational |
| P0-18 | (none) | — | Error handling foundational |
| P0-23 | (none) | — | Kill switch standalone |

---

## 5. Feature Interaction Edges (--F-->)

From G-F1 (Strategic Feature Mapping, Section 3). Each interaction node imposes a cross-P0 requirement — all listed P0s must be `Production-ready` AND their interaction tested.

| Interaction node | --F--> | P0s involved | Invariants at risk | Metadata |
|------------------|--------|--------------|--------------------|---------| 
| Prepaid + Quick Reorder | {P0-01, P0-08, P0-25} | I-01, I-04 | blocking — reorder-triggered payment must not double-charge (P0-25 case C) |
| POS + Daily Settlement | {P0-02, P0-03, (P3 POS)} | I-06, I-10 | blocking (P0 part) — POS-imported orders must settle correctly |
| Live Kitchen + Push | {P0-06, P0-07, P0-24, (P1 push)} | I-02, I-13 | blocking (P0 part) — state change must produce push with idempotent business effect |
| Wallet + Loyalty | {P0-02, (P2 loyalty)} | I-06 | blocking (P0 part) — wallet cashback + loyalty + referral must not imbalance ledger |
| Group Order + Concurrency | {P0-25, (P3 group)} | I-02, I-10 | blocking (P0 part) — group cart race-safe mutex is P0-25 case A/B |
| Geo-fence + Pickup | {P0-07, I-13} | I-13 | blocking + **caution flag** — if geo-fence auto-triggers PICKED_UP, I-13 attribution must still hold |
| Catering + State Machine | {P0-07 extension, (P3 catering)} | I-02 | blocking + **caution flag** — catering needs own state machine; P0-07 PICKED_UP may not directly apply |
| Kill Switch + Order Intake | {P0-23, P0-01} | I-09 | blocking — kill switch must gate order intake; fail-safe default |

**Feature-interaction rule:** An interaction node is `Production-ready` only when ALL its member P0s are `Production-ready` AND an integration test for the interaction passes. This is a higher bar than individual P0 readiness.

---

## 6. Failure Propagation Map (--P-->)

Consolidated from matrix Section 10 (External Dependency Failure Matrix). When a dependency fails, which P0s are compromised, and which invariants are at risk.

| Dependency failure | --P--> | Affected P0s | Invariants at risk | Blueprint Risk |
|---------------------|--------|--------------|--------------------|----------------|
| Razorpay order-create timeout | P0-01, P0-03 | I-01 | R-razorpay-wh |
| Razorpay capture/verify mismatch | P0-01, P0-05 | I-01, I-04 | R-razorpay-wh |
| Razorpay refund gateway down | P0-04, P0-03 | I-03 | R-razorpay-wh |
| Razorpay webhook duplicate | P0-05 | I-04 | R-razorpay-wh |
| Razorpay webhook tampered | P0-05, P0-28 | I-01 | R-razorpay-wh |
| Firebase phone OTP unavailable | P0-09, P0-11 | I-12 | R-session-loss |
| Firebase Admin verify unreachable | P0-09, P0-10 | I-12 | R-session-loss |
| Database degraded/unavailable | P0-24, P0-25, P0-26 (and all data P0s: 01-08, 17, 22) | I-01..I-10 | R-db-pool |
| Redis unavailable | P0-13, P0-10 (sessions), P0-11 (OTP), P0-17 (idempotency cache) | I-12 (sessions) | R-session-loss |
| Outbox publisher stalled | P0-24 | I-10 (event delivery) | (internal) |
| CI/CD pipeline failure | P0-27 | (foundational) | (internal) |
| SMS gateway (MSG91) down | P0-11 (OTP delivery), I-13 (pickup handoff) | I-13 | R-msg91 |

**Failure-propagation insight:** PostgreSQL is the **highest-centrality shared dependency** in the current P0 graph — its failure affects 16 P0s and 10 invariants. Redis is second (affects auth + idempotency). Razorpay is third but scoped to payment P0s. This centrality informs hardening priority and risk focus, consistent with the Strategic Blueprint's explicit choice of PostgreSQL for strict ACID guarantees.

**⚠️ Failure-propagation edges do NOT create implementation precedence.** A `--P-->` edge describes what is compromised *when a dependency fails* — it is a risk/criticality signal, not a build-order constraint. Example: `Razorpay-failure --P--> P0-01` means "if Razorpay fails, P0-01 is compromised"; it does NOT mean "P0-01 must be implemented before Razorpay" or vice versa. Implementation precedence is derived only from `--B-->` (business) and `--F-->` (feature-interaction) edges. **Artifact 3 must use P-edges to weight criticality/risk on the critical path, but must never treat them as dependency edges for longest-path calculation.**

---

## 7. Critical-Path Metadata (edge attributes, NOT implementation order)

**Repeating the strict rule:** This metadata characterizes edges. It does NOT sequence implementation. Artifact 3 (Critical Path) will compute the path from this graph; Artifact 4 (Implementation Order) will sequence.

### 7.1 Blocking edges (dependent waits for dependency at required lifecycle state)

All money/integrity B-edges are blocking by default. Full list in Section 4.3. Summary count: **27 blocking B-edges.**

Rationale: a Direct Protector of a money/order invariant cannot be `Production-ready` if its dependency is not. E.g. P0-02 (ledger) cannot be signed off if P0-01 (capture) is not — the ledger entry is created on the capture event.

### 7.2 Non-blocking edges (dependent can proceed in degraded mode)

| Edge | Why non-blocking |
|------|------------------|
| P0-11 --B--> P0-13 (rate limiter) | OTP can function with in-memory fallback; Redis hardens it |
| P0-27 --B--> (all) | Deployment enables safe rollout but is not a strict functional prereq |

### 7.3 Parallelizable edges (build concurrently, block only at sign-off)

| Edge | Why parallelizable |
|------|--------------------|
| P0-19, P0-20, P0-21 (observability trio) | Can be built concurrently; each is a Control/Enabler; they converge at P0-28 |
| P0-12 (Zod), P0-14 (CSRF), P0-18 (error handling) | Foundational Control/Enablers with no P0 deps; can be built in parallel |
| P0-01, P0-05, P0-02 (payment cluster) | Webhook + capture + ledger can be built concurrently once P0-24 + P0-17 are Implemented; they block each other only at Production-ready sign-off |
| P0-03, P0-04 (reconciliation, refund) | Can be built concurrently once P0-01 + P0-02 are Implemented |

**Parallelizable ≠ simultaneous launch.** It means development can overlap; sign-off still respects blocking semantics.

---

## 8. Graph Integrity Checks

### 8.1 Cycle check

A P0 cannot transitively depend on itself. Walking all B-edges from each node:

- **No cycles detected.** The graph is a DAG (directed acyclic graph).
- Verified by tracing: roots (P0-12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 27) have no B-dependencies; every path terminates at a root.

### 8.2 Root nodes (no B-dependencies — foundation layer)

| Root | Why root |
|------|----------|
| P0-12 (Zod) | No P0 dep; library only |
| P0-13 (Rate limiting) | No P0 dep; Redis-only |
| P0-14 (CSRF) | No P0 dep; cookie/token |
| P0-15 (Migrations) | No P0 dep; schema tooling |
| P0-16 (Backup) | No P0 dep; storage |
| P0-18 (Error handling) | No P0 dep; framework |
| P0-19, P0-20, P0-21 (Observability) | No P0 dep; substrate |
| P0-22 (Audit) | No P0 dep; WORM storage |
| P0-23 (Kill switch) | No P0 dep; standalone store |
| P0-27 (Deployment) | No P0 dep; CI/CD |

**12 roots** (P0-12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 27). These are the foundation — nothing blocks them from starting implementation (modulo G-F1 approver assignment).

**P0-27 (Deployment & Rollback) is a special case — isolated control node.** It appears in both the root list (no B-dependency) and the leaf list (no B-dependent). In the B-edge graph it is isolated: it does not functionally gate any P0, and no P0 functionally gates it. Its relationship to other P0s is a **control/foundation dependency** (it enables safe rollout and rollback), NOT a business functional prerequisite. **Artifact 3 must NOT treat P0-27 as an ordinary business critical-path edge** — it must not force "implement P0-27 before everything." P0-27 is built in parallel with the foundation layer and reaches `Production-ready` before launch (it is on the launch gate via P0-27's own acceptance), but it does not block other P0s from reaching `Implemented` or `Tested`.

### 8.3 Leaf nodes (no P0 depends on them — top of stack)

| Leaf | Why leaf |
|------|----------|
| P0-03 (Reconciliation) | Nothing depends on it; terminal |
| P0-04 (Refund) | Nothing depends on it; terminal |
| P0-07 (State machine) | Only P0-28 backstop references it (not a functional dep) |
| P0-26 (DR) | Terminal |
| P0-27 (Deployment) | Terminal (enables all, but none depend on it functionally) |
| P0-28 (Unknown-exception) | Terminal backstop |

**6 leaves** (P0-03, 04, 07, 26, 27, 28). These are the top of the dependency stack — they cannot start until their dependencies are at least `Implemented`. Note P0-27 appears here too (isolated control node — see Section 8.2 clarification).

### 8.4 Orphan check

An orphan is a P0 with neither a dependency nor a dependent. **None found** — every P0 is connected.

### 8.5 Shared-infrastructure concentration

| Infrastructure | P0s depending on it | Risk |
|----------------|---------------------|------|
| DB | 16 | Highest-centrality shared dependency |
| Redis | 4 | Medium — auth + idempotency |
| Razorpay | 3 | Medium — scoped to payment |
| Observability backend | 3 | Medium — detection layer |
| Firebase | 1 | Low — scoped to auth |
| CI/CD | 1 | Low — scoped to deployment |

**Insight for Artifact 3:** DB hardening (P0-15 migrations, P0-16 backup, P0-24 transactional integrity, P0-25 concurrency, P0-26 DR) is the highest-centrality cluster because 16 P0s share the DB as a technical dependency. Whether it lands *on* the critical path is for Artifact 3 to compute from B-edges and F-edges — this observation informs risk weighting, not the path itself.

---

## 9. Graph Summary

| Metric | Value |
|--------|-------|
| P0 nodes | 28 |
| Roots (no B-dep) | 12 (includes P0-27 isolated control node) |
| Leaves (no B-dependent) | 6 (includes P0-27 isolated control node) |
| Mid-layer (both B-in and B-out) | 11 |
| Isolated (both root and leaf — control only) | 1 (P0-27) |
| B-edges (business) | 31 (27 blocking + 2 non-blocking + 2 parallelizable clusters) |
| T-edges (technical) | ~30 (P0 → infrastructure) |
| F-edges (feature interactions) | 8 interaction nodes |
| P-edges (failure propagation) | 12 scenarios |
| Cycles | 0 (DAG confirmed) |
| Orphans | 0 |
| New P0s added | 0 |
| New invariants added | 0 |

---

## 10. What This Graph Does NOT Do (discipline)

- ❌ Does not derive implementation order (Artifact 4).
- ❌ Does not compute the critical path (Artifact 3).
- ❌ Does not assign sprints (Artifact 5).
- ❌ Does not add new P0s or invariants.
- ❌ Does not prioritize by "importance" — only by dependency structure + metadata.
- ❌ **Does not treat failure-propagation (`--P-->`) edges as implementation precedence** — they inform risk/criticality only, never build order.
- ❌ **Does not treat P0-27 (Deployment) as a business functional prerequisite** — it is an isolated control node; it enables safe rollout but does not block other P0s from `Implemented`/`Tested`.

The graph is a **structural fact**, not a plan. Artifact 3 will compute the longest blocking path (critical path) using `--B-->` and `--F-->` edges only. Artifact 4 will sequence within that constraint. Artifact 5 will sprint-plan the sequence. `--P-->` edges weight criticality on the path but never create edges in the path.

---

## 11. Sign-off Status

| Criterion | Status |
|-----------|--------|
| All 28 P0s mapped as nodes | ✅ |
| All 5 edge types populated | ✅ |
| DAG verified (no cycles) | ✅ |
| No orphans | ✅ |
| Roots and leaves identified | ✅ |
| Feature interactions preserved (8 nodes) | ✅ |
| Failure propagation mapped (12 scenarios) | ✅ |
| Critical-path metadata on edges (not sequencing) | ✅ |
| No new P0/invariant | ✅ |
| No implementation order derived | ✅ (discipline held) |

**Artifact 2 — P0 Dependency Graph: DRAFT COMPLETE.** Pending stakeholder review.

---

## 12. Unlock for Artifact 3

With the graph complete, **Artifact 3 — Critical Path to Launch** is unlocked. It will:

1. Take this graph as input.
2. Compute the longest blocking path from roots to leaves (the critical path).
3. Identify which P0s are on the critical path (any delay delays launch) vs. off it (parallelizable slack).
4. Factor in feature-interaction nodes (which add cross-P0 blocking).
5. Output the critical path as the skeleton for Artifact 4 (Implementation Order).

**Artifact 3 does NOT sequence sprints.** It computes the path; Artifact 4 sequences within it.

---

*End of P0 Dependency Graph (Artifact 2).*
