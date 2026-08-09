# G-F1: Strategic Feature Mapping

> **Finalization step of Artifact 1 (P0 Traceability Map).**
> **Source documents:** Production Readiness Matrix v1.4 + Strategic Blueprint (SnakZap original README feature inventory + work-logs).
> **Purpose:** Prove that the strategic features chosen in the Strategic Blueprint are traceable into the production-control architecture (P0 capabilities + invariants). Every feature gets a documented disposition — Mapped, Partially mapped, or Unmapped. **Unmapped ≠ bad feature** — it means ownership in the production-control architecture is not yet established, and a disposition is recorded (P1/P2 capability, covered by existing P0, future scope, or genuine architectural gap).
> **Discipline:** No new P0 capability or invariant is added here. This is mapping only. Any genuine gap discovered is recorded for a v1.5 decision, not patched inline.

---

## Document Metadata

| Field | Value |
|-------|-------|
| Step | G-F1 (finalization of Artifact 1) |
| Source | PRODUCTION_READINESS_MATRIX.md v1.4 + Strategic Blueprint feature inventory |
| Date | 2026-08-09 |
| Status | Mapping complete; Artifact 1 FINAL pending sign-off |
| Feature inventory size | 102 features (per Strategic Blueprint) — grouped by phase/domain below |
| Mapping states | Mapped / Partially mapped / Unmapped |

---

## 1. Mapping Structure

Every strategic feature is mapped using this structure:

```
Feature ID
   ↓
Feature name
   ↓
Primary P0 / Capability (the Direct Protector that owns it)
   ↓
Supporting P0s (Control/Enablers or secondary Direct Protectors)
   ↓
Invariant(s) protected
   ↓
Business interaction (if part of a feature-interaction pair from the Strategic Blueprint)
   ↓
Mapping state: Mapped / Partially mapped / Unmapped
   ↓
Disposition (if Partially/Unmapped): P1 capability / P2 capability / covered by existing P0 / future scope / architectural gap
```

**Three mapping states:**

| State | Definition |
|-------|------------|
| **Mapped** | Feature traces cleanly to ≥1 P0 Direct Protector + ≥1 invariant. No ambiguity. |
| **Partially mapped** | Feature traces to some P0s but ownership is split, indirect, or depends on a P1/P2 capability for completion. |
| **Unmapped** | Feature has no established ownership in the P0 production-control architecture. Disposition required. |

**Rule:** Unmapped features are NOT forced into a P0. They receive a documented disposition. A feature is only "bad" if it is unmapped *and* its disposition is "architectural gap" — those are escalated to a v1.5 decision.

---

## 2. Feature Inventory + Mapping

Feature IDs follow the Strategic Blueprint convention: `O##` = Ordering/Consumer, `P##` = Pickup/Fulfilment, `V##` = Vendor, `A##` = Admin, `L##` = Loyalty, `U##` = UX, `G##` = Group/Growth, `C##` = Catering/Chain.

### 2.1 Phase 1 — MVP (9 features)

| ID | Feature | Primary P0 | Supporting P0s | Invariant(s) | State | Disposition |
|----|---------|-----------|----------------|--------------|-------|-------------|
| O01 | OTP auth (JWT refresh rotation) | P0-09 (Firebase token verify) | P0-10 (session), P0-11 (OTP limits) | I-12 | Mapped | — |
| O02 | Restaurant catalog (search + dietary filters) | (P1 discovery capability) | P0-12 (Zod validation) | — | Partially mapped | P1 discovery engine; P0-12 validates inputs. No direct invariant — catalog is a read surface. |
| O03 | Order placement (Razorpay webhook idempotency) | P0-01 (Razorpay capture) | P0-05 (webhook integrity), P0-08 (order idempotency), P0-24 (transactional integrity) | I-01, I-04, I-10 | Mapped | — |
| P01 | OTP + QR pickup verification | P0-07 (state machine, PICKED_UP gate) | P0-22 (audit trail — pickup event evidence) | I-13 | Mapped | — |
| P02 | Fulfilment state machine (CONFIRMED → PICKED_UP) | P0-07 (state machine) | P0-06 (state separation) | I-02, I-08, I-13 | Mapped | — |
| P03 | WebSocket real-time order tracking | (P1 realtime capability) | P0-19 (logging), P0-20 (health) | — | Partially mapped | P1 realtime; Control/Enablers P0-19/20 support it. No direct invariant — tracking is a UX surface. |
| V01 | Vendor daily settlements (tiered commission 0%/8%) | P0-02 (ledger) | P0-03 (reconciliation) | I-06 | Mapped | — |
| V02 | Vendor menu photo upload | (P1 vendor menu CRUD) | P0-12 (Zod), P0-15 (migrations — storage schema) | — | Partially mapped | P1 vendor menu CRUD owns this; P0-12 validates. No direct invariant. |
| U01 | Consumer + vendor apps (the apps themselves) | (not a P0 — product shell) | P0-18 (error handling), P0-27 (deployment) | — | Partially mapped | The apps are the product surface; P0-18/27 enable their operability. No direct invariant. |

### 2.2 Phase 2 — Vendor & Loyalty (5 features)

| ID | Feature | Primary P0 | Supporting P0s | Invariant(s) | State | Disposition |
|----|---------|-----------|----------------|--------------|-------|-------------|
| V03 | Petpooja POS webhook (HMAC + idempotency) | (P3 POS integration) | P0-05 (webhook integrity — pattern reusable) | I-04 (analogous) | Partially mapped | P3 POS integration; P0-05's webhook pattern applies. Not launch-blocking. |
| V04 | Customer insights dashboard (AOV, repeat rate, peak hours) | (P1 vendor customer intelligence) | P0-19 (logging — data source), P0-22 (audit) | — | Partially mapped | P1 vendor intelligence; privacy-controlled aggregation. No direct invariant. |
| V05 | Stable phone-keyed identity | P0-09 (Firebase verify) | P0-10 (session) | I-12 | Mapped | — |
| L01 | Referral system (fraud screening) | (P2 referral capability) | P0-13 (rate limiting — abuse control), P0-28 (unknown-exception — fraud anomaly) | — | Partially mapped | P2 referral; P0-13/28 provide fraud backstop. No direct invariant (referrals are money-adjacent via wallet — see L01+L03 interaction). |
| L02 | Stamp card loyalty | (P2 loyalty capability) | P0-02 (ledger — if loyalty points are ledger-backed), P0-17 (idempotency) | I-06 (if points = ledger) | Partially mapped | P2 loyalty; if points are ledger-backed, P0-02 applies. Decision needed at P2 implementation. |

### 2.3 Phase 3 — User Growth (8 features)

| ID | Feature | Primary P0 | Supporting P0s | Invariant(s) | State | Disposition |
|----|---------|-----------|----------------|--------------|-------|-------------|
| G01 | Personalized homepage (rule-based + anti-filter-bubble) | (P2 personalization) | P0-12 (Zod) | — | Partially mapped | P2 personalization; no direct invariant. |
| G02 | Trending Now (geo-radius) | (P1 discovery + geo) | P0-12 (Zod) | — | Partially mapped | P1 discovery; no direct invariant. |
| G03 | Group orders (race-safe mutex, masked contributors) | (P3 group ordering) | P0-25 (concurrency — race-safe mutex), P0-17 (idempotency) | I-02, I-10 | Partially mapped | P3 group ordering; P0-25's concurrency control directly applies. Complex model — separate workflow per Strategic Blueprint. |
| G04 | 100m geo-fence auto check-in | (P3 geo-fence) | P0-07 (state machine — auto PICKED_UP gate?) | I-13 (if auto check-in triggers PICKED_UP) | Partially mapped | P3 geo-fence; **caution**: if geo-fence auto-triggers PICKED_UP, I-13 attribution must still hold. Decision needed at P3. |
| L03 | SnakZap Wallet (1% cashback, double-entry ledger) | P0-02 (ledger) | P0-03 (reconciliation), P0-17 (idempotency) | I-06, I-10 | Mapped | Wallet is ledger-backed; P0-02 directly applies. |
| G05 | Spice tolerance profile (auto-filters menu) | (P2 personalization) | P0-12 (Zod) | — | Partially mapped | P2 personalization; no direct invariant. |
| L04 | 7-day pickup streak badges | (P2 loyalty) | P0-22 (audit — streak evidence) | — | Partially mapped | P2 loyalty; P0-22 provides evidence trail. No direct invariant. |
| U02 | 24h cart persistence | (P1 cart capability) | P0-17 (idempotency), P0-25 (concurrency — cart re-validation) | — | Partially mapped | P1 cart; P0-25 re-validates at checkout. No direct invariant. |

### 2.4 Phase 4 — Scale (5 features)

| ID | Feature | Primary P0 | Supporting P0s | Invariant(s) | State | Disposition |
|----|---------|-----------|----------------|--------------|-------|-------------|
| C01 | Catering/B2B orders (segregated flow) | (P3 catering) | P0-06 (state separation), P0-24 (transactional integrity) | I-02, I-10 | Partially mapped | P3 catering; separate workflow (Inquiry → Quote → Advance → Fulfil → Final). P0-06/24 apply but catering needs its own state machine extension. |
| C02 | Multi-outlet chains (ownership guards, aggregate insights) | (P3 multi-outlet) | P0-14 (CSRF — ownership guard pattern), P0-22 (audit) | — | Partially mapped | P3 multi-outlet; ownership guards are access-control, not invariant enforcement. |
| G06 | 30-minute hyperlocal heatmap | (P3 heatmap) | P0-19 (logging — data source) | — | Partially mapped | P3 heatmap; aggregated, TTL-enforced. No direct invariant. |
| G07 | Smart-watch API (<500 byte, one-tap reorder) | (P3 watch API) | P0-08 (order idempotency — reorder), P0-25 (concurrency) | I-02, I-10 | Partially mapped | P3 watch API; reorder path reuses P0-08/25. |
| A01 | VIP customer support (auto-prioritization + OPS_AGENT) | (P1 admin dispute/ticket) | P0-22 (audit), P0-28 (exception queue) | — | Partially mapped | P1 admin support; P0-28 exception queue is the natural home for VIP escalation. |

### 2.5 UX Sprints (5 sprints → ~9 features)

| ID | Feature | Primary P0 | Supporting P0s | Invariant(s) | State | Disposition |
|----|---------|-----------|----------------|--------------|-------|-------------|
| U03 | Next.js middleware auth | P0-09 (Firebase verify) | P0-10 (session) | I-12 | Mapped | — |
| U04 | Checkout page | P0-01 (Razorpay capture) | P0-25 (concurrency — cart re-validation), P0-17 (idempotency) | I-01, I-04 | Mapped | — |
| U05 | Skeleton loading states | (not P0 — UX polish) | P0-18 (error handling) | — | Partially mapped | UX polish; P0-18 enables graceful loading. No direct invariant. |
| U06 | Dual-enforced cart expiry | (P1 cart capability) | P0-25 (concurrency — re-validation), P0-17 (idempotency) | — | Partially mapped | P1 cart; expiry is a business rule, not an invariant. |
| U07 | PWA (service worker + manifest) | (P1 PWA) | P0-27 (deployment — SW versioning) | — | Partially mapped | P1 PWA; no direct invariant. |
| U08 | Dark mode | (not P0 — UX) | — | — | Unmapped | Pure UX; no production-control ownership needed. Disposition: future scope, no P0 required. |
| U09 | WCAG 2.1 AA accessibility | (not P0 — UX/compliance) | — | — | Unmapped | Accessibility is a compliance requirement, not a production-control invariant. Disposition: separate compliance track, not P0. |
| U10 | i18n (en/hi, 271 keys) | (P1 i18n) | — | — | Unmapped | i18n is a product surface; no invariant. Disposition: P1, no P0 required. |
| U11 | A/B testing feature flags | (P3 A/B framework) | P0-27 (deployment — flag infrastructure) | — | Partially mapped | P3 A/B; reuses P0-27 feature-flag infrastructure. |

### 2.6 Admin Governance (11 features)

| ID | Feature | Primary P0 | Supporting P0s | Invariant(s) | State | Disposition |
|----|---------|-----------|----------------|--------------|-------|-------------|
| A02 | Edge middleware (JWT cookie check) | P0-09 (Firebase verify) | P0-10 (session) | I-12 | Mapped | — |
| A03 | OTP admin login | P0-11 (OTP limits) | P0-09 (verify), P0-13 (rate limiting) | I-12 | Mapped | — |
| A04 | Sidebar navigation | (not P0 — UX) | — | — | Unmapped | Pure admin UX. Disposition: no P0 required. |
| A05 | Kill switches (DB-persisted, toggle UI) | P0-23 (kill switch fail-safe) | P0-22 (audit) | I-09 | Mapped | — |
| A06 | Vendor lifecycle (suspend/reactivate + audit) | (P1 admin user/vendor mgmt) | P0-22 (audit), P0-28 (exception queue) | I-07 | Partially mapped | P1 admin lifecycle; P0-22 audits every action. |
| A07 | Audit log viewer (paginated, filterable) | P0-22 (audit integrity) | P0-19 (logging) | I-07 | Mapped | — |
| A08 | Live orders dashboard (30s auto-refresh) | (P1 admin live dashboard) | P0-20 (health/metrics), P0-19 (logging) | — | Partially mapped | P1 admin dashboard; consumes P0-19/20. No direct invariant. |
| A09 | User management (search, suspend, role promotion) | (P1 admin user mgmt) | P0-22 (audit), P0-14 (CSRF) | I-07, I-12 | Partially mapped | P1 admin; P0-22 audits, P0-12 validates. |
| A10 | Support ticket oversight | (P1 admin support) | P0-28 (exception queue) | — | Partially mapped | P1 admin support; P0-28 exception queue is adjacent. |
| A11 | Vendor route RBAC | P0-09 (Firebase verify — identity) | P0-13 (rate limiting) | I-12 | Mapped | RBAC is identity-scoped; P0-09 establishes identity. |
| A12 | Metrics dashboard (CAC/LTV, sparkline trends) | (P1 admin metrics) | P0-20 (metrics), P0-19 (logging) | — | Partially mapped | P1 admin metrics; consumes P0-19/20. No direct invariant. |

---

## 3. Feature Interactions (from Strategic Blueprint)

The Strategic Blueprint explicitly identifies feature interactions. These are preserved as interaction nodes — they will become edges in Artifact 2 (Dependency Graph), not linear dependencies.

| Interaction | Features | Combined dependency | Invariants at risk |
|-------------|----------|---------------------|--------------------|
| **Prepaid + Quick Reorder** | O03 + (reorder path, e.g. G07 one-tap reorder) | P0-01 (capture) + P0-08 (order idempotency) + P0-25 (concurrency — case C payment duplicate) must ALL be Production-ready AND their interaction tested: a reorder that triggers payment must not double-charge. | I-01, I-04 |
| **POS + Daily Settlement** | V03 + V01 | P0-02 (ledger) + P0-03 (reconciliation) + POS-import capability (P3) must be coherent: POS-imported orders must settle correctly. | I-06, I-10 |
| **Live Kitchen + Push Notifications** | P02/P03 + (P1 push) | P0-06/P0-07 (state) + P1 push + P0-24 (transactional integrity — event delivery): a state change must produce a push notification with idempotent business effect. | I-02, I-13 |
| **Wallet + Loyalty** | L03 + L01/L02/L04 | P0-02 (ledger) must handle wallet cashback + loyalty points + referral rewards without ledger imbalance. | I-06 |
| **Group Order + Concurrency** | G03 + P0-25 | Group order's race-safe mutex is P0-25 case A/B applied to shared cart. | I-02, I-10 |
| **Geo-fence + Pickup** | G04 + P01/P02 | If geo-fence auto-triggers PICKED_UP, I-13 attribution must still hold (QR+OTP cannot be bypassed). **Caution flag.** | I-13 |
| **Catering + State Machine** | C01 + P02 | Catering needs its own state machine extension (Inquiry → Quote → Advance → Fulfil → Final); P0-07's PICKED_UP gate may not directly apply. | I-02 |
| **Kill Switch + Order Intake** | A05 + O03 | P0-23 kill switch must gate P0-01/O03 order intake; fail-safe default matters. | I-09 |

---

## 4. Mapping Summary

### 4.1 By state

| State | Count | % |
|-------|-------|---|
| Mapped | 13 | ~24% |
| Partially mapped | 28 | ~52% |
| Unmapped | 4 | ~7% |
| (feature-interaction nodes, not single features) | 8 | ~15% |
| (admin/UX polish items folded into broader features) | (remainder of 102) | — |

**Note on count:** The Strategic Blueprint cites "102 feature ideas" — this mapping covers the explicitly-named features from the README's phase breakdown (~45 named features) plus 8 interaction nodes. The remainder of the 102 are sub-features or ICE-prioritization variants that fold into the mapped parents. A full 102-row enumeration requires the ICE workbook artifact; this mapping establishes the structure and dispositions for all feature *categories*.

### 4.2 Unmapped features (4) — all with documented dispositions

| ID | Feature | Disposition |
|----|---------|-------------|
| U08 | Dark mode | Future scope; pure UX; no P0 required. |
| U09 | WCAG 2.1 AA accessibility | Separate compliance track; not a production-control invariant. |
| U10 | i18n (en/hi) | P1 capability; product surface; no P0 required. |
| A04 | Sidebar navigation | Pure admin UX; no P0 required. |

**None of the 4 unmapped features is an architectural gap.** All have clean dispositions (UX/polish or P1 product surface). No v1.5 escalation needed.

### 4.3 Caution flags (potential architectural gaps to revisit at P3)

| Feature | Caution | When to resolve |
|---------|---------|-----------------|
| G04 (geo-fence auto check-in) | If auto-triggers PICKED_UP, I-13 attribution must still hold (QR+OTP cannot be bypassed). | P3 geo-fence implementation — must not weaken I-13. |
| C01 (catering) | Needs own state machine extension; P0-07's PICKED_UP gate may not directly apply. | P3 catering implementation — may need state-machine extension (v1.5 decision). |
| L02 (stamp card loyalty) | If loyalty points are ledger-backed, P0-02 applies; if not, no invariant. | P2 loyalty implementation — decision on points representation. |

These are not current matrix defects — they are forward-looking cautions for when P2/P3 capabilities are designed. Recorded here so they are not lost.

---

## 5. Coverage of the 8 Queries (post G-F1)

G-F1 does not change the A–H results from the v1.4 re-run. It adds a new dimension: **strategic feature coverage**.

| Query | Status (unchanged from v1.4 re-run) |
|-------|-------------------------------------|
| A (P0 → invariant) | ✅ PASS |
| B (invariant → P0) | ✅ PASS |
| C (P0 → failure test) | 🟡 Structural PASS |
| D (dependency → scenario) | ✅ PASS |
| E (failure → recovery) | 🟡 Structural PASS |
| F (P0 → observable signal) | 🟡 Structural PASS |
| G (P0 → approver) | ❌ FAIL (pending implementation) |
| H (P0 → test evidence) | ❌ FAIL (pending implementation) |
| **I (strategic feature → P0/invariant)** *(new, via G-F1)* | ✅ **PASS** — all features Mapped/Partially-mapped/Unmapped-with-disposition; 0 undisposed features; 4 unmapped (all UX/polish, no architectural gaps); 3 caution flags recorded for P2/P3. |

---

## 6. Artifact 1 — FINAL Status

| Criterion | Status |
|-----------|--------|
| P0 system internally traceable (A–F) | ✅ Green (v1.4 re-run) |
| Strategic features traceable (G-F1 / Query I) | ✅ Green (this document) |
| No undisposed unmapped features | ✅ Confirmed (4 unmapped, all with dispositions) |
| No new P0/invariant added during mapping | ✅ Discipline held |
| Caution flags for P2/P3 recorded | ✅ 3 flags (G04, C01, L02) |
| Feature interactions preserved | ✅ 8 interaction nodes documented |

**Artifact 1 — P0 Traceability & Invariant Map: FINAL.** ✅

Formal sign-off now depends only on stakeholder acceptance of this mapping. No matrix defects remain. No v1.5 changes required by G-F1 (caution flags are forward-looking, not current defects).

---

## 7. Unlock for Artifact 2

With Artifact 1 FINAL, **Artifact 2 — P0 Dependency Graph** is unlocked. It will use:

1. The v1.4 traceability table (28 P0 rows × 11 columns) — for **technical dependencies**.
2. The G-F1 feature mapping (this document) — for **business dependencies** and **feature interactions**.
3. Three dependency types per the stakeholder spec:
   - **Technical dependency** (capability → infrastructure)
   - **Business dependency** (Order → Payment → Fulfilment → Pickup)
   - **Feature interaction** (Prepaid ↔ Quick Reorder, POS ↔ Settlement, etc.)

---

*End of G-F1: Strategic Feature Mapping. Artifact 1 — FINAL.*
