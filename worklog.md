# SnakZap Rebuild — Work Log

Original: `zheo-main.zip` (SnakZap — pickup-first food ordering platform, pnpm/turbo monorepo with consumer+vendor+admin apps, drizzle/redis/express).

Target: Rebuild as a **single Next.js 16 app** (port 3000, bun, Prisma+SQLite, shadcn/ui) with three switchable personas (Consumer / Vendor / Admin), real-time order tracking via a Socket.io mini-service (port 3003), teal theme (#0D9488).

---
Task ID: 1
Agent: main
Task: Define Prisma schema + seed demo data for SnakZap rebuild.

Work Log:
- Inspected original `packages/db/src/schema/*.ts` and `packages/types/src/domain.ts` to model bounded contexts (identity, catalog, ordering, payments, fulfillment, killswitches, supporttickets).
- Designed a SQLite-friendly Prisma schema capturing: User, Restaurant, MenuItem, Order, OrderItem, AuditLog, KillSwitch.
- OrderStatus + PaymentStatus stored as String (SQLite enum limitation).
- Seed script to populate 4 restaurants with menus + demo orders + audit logs + kill switches.

Stage Summary:
- Schema file: prisma/schema.prisma (written next)
- Seed script: prisma/seed.ts

---
Task ID: 2-9
Agent: main
Task: Build socket mini-service, API routes, full frontend (Consumer/Vendor/Admin), realtime tracking, images, verification.

Work Log:
- Installed socket.io + socket.io-client; created mini-services/realtime (port 3003) with room-based fanout (restaurant:*, vendor:all, admin:all, consumer:all).
- Created src/lib/realtime.ts server-side socket.io-client singleton so Next.js API routes emit order/killswitch events to the realtime service.
- Wrote 11 API routes: restaurants (list+detail+menu), orders (list/create/detail/status-patch with fulfillment state machine), menu availability, admin metrics (revenue/AOV/status breakdown/hourly/revenue-by-restaurant), kill-switches (list+toggle), audit-logs.
- Built teal-themed (#0D9488) globals.css with light+dark oklch palettes.
- Frontend: src/app/page.tsx with persona Tabs (Consumer/Vendor/Admin) + sticky header + sticky footer (min-h-screen flex, mt-auto).
- ConsumerView: search + veg filter, restaurant cards with AI food photos, grouped menu, zustand cart (persisted), checkout -> OrderTracking with status timeline + QRCodeSVG pickup OTP. Listens to order:updated for live refresh.
- VendorView: restaurant tabs, live order queue with status-advance buttons (state-machine aware), catering flag, menu availability toggles, realtime self-refresh.
- AdminView: 6 metric cards, recharts (hourly line, status pie, revenue-by-restaurant bar), kill switches with severity, filterable orders table (max-h-96 scroll), audit trail feed. 30s auto-refresh + realtime refresh.
- Generated 4 AI food cover images via z-ai image CLI (North Indian / South Indian / Indo-Chinese / Desserts) -> public/images/r1-4.png.
- Fixed cart bug (restaurantId empty string) by passing selected restaurant into MenuRow.
- Verified end-to-end with Agent Browser: browse -> menu -> cart -> place order -> OTP tracking; vendor status advance (realtime refresh); admin kill-switch toggle (audit log update); mobile responsive (390x844); dark mode toggle.

Stage Summary:
- Lint: clean (0 errors). Dev server: port 3000, no runtime errors. Realtime: port 3003, 1 client connected.
- Full-stack pickup-first food ordering platform operational in workspace preview.

---
Task ID: 3
Agent: general-purpose sub-agent
Task: Create 25 hand-crafted flat-design SVG food illustrations for SnakZap menu items.

Work Log:
- Read worklog.md to understand prior context (Tasks 1 and 2-9 covering schema, API, frontend, realtime, AI cover images).
- Created directory /home/z/my-project/public/images/svg/ (was absent).
- Authored 25 self-contained, hand-crafted SVG vector illustrations (NO image-generation tools used; every path/shape written manually). Each uses:
  - viewBox "0 0 400 300", xmlns set, single root <svg>.
  - Warm light gradient background, soft shadow ellipse under food.
  - A plate / bowl / saucer / glass / tumbler as the surface.
  - 3-8 solid-color shapes + simple linearGradient / radialGradient fills; small decorative garnish dots.
  - Distinct color palettes so the menu does not look repetitive.
  - File sizes 1.2 KB - 2.5 KB (within 1-4 KB target).
- Dishes created (filename -> dish):
  1. curry-chicken.svg     - Butter Chicken in copper katori, cream swirl + coriander + chicken piece
  2. curry-paneer.svg      - Paneer Tikka Masala, paneer cubes + bell pepper + char marks
  3. dal.svg               - Dal Makhani in black bowl, cream swirl + butter gloss
  4. naan.svg              - Butter Naan teardrop, butter brush + sesame
  5. naan-garlic.svg       - Garlic Naan teardrop, chopped garlic + coriander flecks
  6. gulab-jamun.svg       - 2 brown dumplings in saffron syrup saucer, sheen
  7. lassi.svg             - Sweet Lassi tall glass, frothy cream + mint leaf
  8. dosa.svg              - Masala Dosa roll on plate + coconut chutney + sambar bowls
  9. idli.svg              - 3 white idli cakes + sambar bowl + chutney bowl
  10. vada.svg             - 2 donut-shaped medu vadas + green chutney
  11. uttapam.svg          - Thick pancake with onion/tomato/pepper dots
  12. coffee.svg           - Filter coffee steel tumbler + dabarah + steam
  13. chutney.svg          - Coconut chutney bowl with red tempering + curry leaves
  14. chilli-paneer.svg    - Chilli Paneer in dark soy-chilli sauce + sesame
  15. noodles.svg          - Hakka noodles mound + veggies + chopsticks
  16. manchurian.svg       - Gobi Manchurian florets in glossy red-brown sauce + spring onion
  17. fried-rice.svg       - Schezwan fried rice red mound + chopsticks
  18. chilli-chicken.svg   - Chicken Chilli battered pieces + peppers in soy glaze
  19. spring-roll.svg      - 4 diagonally cut spring rolls + red dip bowl
  20. pastry-choco.svg     - Chocolate truffle pastry slice + ganache + chocolate curl
  21. pastry-redvelvet.svg - Red velvet slice with cream-cheese layers
  22. cheesecake.svg       - Blueberry cheesecake slice with purple compote + berries
  23. cappuccino.svg       - Cappuccino cup + saucer, latte art heart + cocoa + steam
  24. cold-coffee.svg      - Iced cold coffee glass, whipped cream + straw + condensation
  25. croissant.svg        - Golden flaky crescent croissant + crumbs
- Validation: parsed all 25 with Python xml.etree.ElementTree -> 25/25 valid, all carry viewBox="0 0 400 300", no raster refs, no <image>, no emoji as subject.

Stage Summary:
- All 25 SVG files written to /home/z/my-project/public/images/svg/ and confirmed non-empty via `ls -la` (sizes 1.2-2.5 KB).
- XML well-formedness verified programmatically (25 valid, 0 invalid).
- Ready to be referenced from menu UI via <img src="/images/svg/<filename>.svg">.

---
Task ID: 4-7
Agent: main
Task: Split into 3 separate pages with login (Consumer/Vendor phone OTP, Admin email+2FA), Firebase OTP technique everywhere, food SVGs, verify full order workflow.

Work Log:
- Installed `firebase` package; created `src/lib/firebase.ts` (client-side Firebase Auth, phone OTP, reCAPTCHA verifier; reads NEXT_PUBLIC_FIREBASE_* env; falls back to demo server-side OTP service when creds absent).
- Auth backend: `src/lib/password.ts` (scrypt hash/verify), `src/lib/otp-service.ts` (createOtp/verifyOtp with scrypt-hashed codes + 5min expiry, used for consumer_login, vendor_login, admin_2fa, pickup), `src/lib/session.ts` (DB-backed Session + httpOnly cookie).
- Added Prisma models: OtpRequest, Session; extended User with email + passwordHash. Reseeded with admin email admin@snakzap.com / admin123 (scrypt-hashed) + 25 menu items mapped to hand-crafted food SVGs.
- Auth API routes: /api/auth/otp/send, /api/auth/otp/verify, /api/auth/admin/login (email+password -> 2FA challenge), /api/auth/admin/verify, /api/auth/me, /api/auth/logout.
- Orders/menu/kill-switch APIs now require session + role guard; orders scoped to session userId for consumers.
- Pickup OTP now re-issued via the same Firebase/demo OTP service when an order transitions to READY_FOR_PICKUP (delivered to consumer's phone).
- Frontend: AuthProvider context (`useAuth`), `PhoneOtpLogin` (consumer+vendor), `AdminLogin` (email+password -> 2FA OTP), `AppShell` (header with persona badge + logout + home).
- Routes: `/` (landing with 3 portal cards + demo creds), `/consumer`, `/vendor`, `/admin` — each shows login when unauthed, role-gated app when authed.
- 25 hand-authored food SVGs created by subagent (Task 3) in public/images/svg/; wired into seed + MenuRow `<img>`.
- ConsumerView: added "My Orders" badge + orders list view (active/history) + realtime refresh of own orders.
- Agent Browser verified end-to-end: consumer OTP login -> place order -> vendor OTP login -> advance CONFIRMED→PREPARING→ALMOST_READY→READY_FOR_PICKUP→PICKED_UP (each realtime) -> consumer sees tracking update + pickup OTP -> admin email+2FA login -> console metrics reflect the completed order. All SVGs load. Mobile responsive. No console/runtime errors. Lint clean.

Stage Summary:
- 3 separate pages, each with its own login (phone OTP for consumer/vendor, email+2FA for admin).
- Firebase Auth integration code present; demo mode surfaces OTP for preview. Same OTP technique used for login + 2FA + pickup.
- 25 distinct food .svg illustrations on every menu item.
- Full order workflow verified working end-to-end across all three portals.

---
Task ID: 8-11
Agent: main
Task: Activate real Firebase SMS OTP with user-provided Firebase project config.

Work Log:
- Added NEXT_PUBLIC_FIREBASE_* env vars to .env (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId) for project snakzap-5a326.
- Updated src/lib/firebase.ts to read all config fields + set languageCode 'hi' for SMS OTP.
- Created /api/auth/firebase/session route — mints a SnakZap session cookie from a Firebase-verified phone (client calls this after confirmationResult.confirm succeeds). Logs AUTH_FIREBASE_OTP_LOGIN to audit trail. NOTE: production should verify the Firebase ID token server-side via Admin SDK (needs service-account key, not provided).
- Refactored PhoneOtpLogin component:
  - Detects isFirebaseConfigured at build time; shows "Firebase Authentication · Real SMS" badge when active.
  - Send OTP: attempts Firebase signInWithPhoneNumber (with invisible reCAPTCHA). On success, real SMS is sent and verify uses confirmationResult.confirm → /api/auth/firebase/session.
  - On Firebase failure (e.g. auth/configuration-not-found when Phone Auth not enabled, or billing not on Blaze), transparently falls back to demo OTP service and shows a banner explaining the fallback.
  - Verify step routes to Firebase confirm (real) or /api/auth/otp/verify (demo) based on active mode.
- Clean-restart dev server (env vars + .next clear). All routes return 200.
- Agent Browser verified: consumer login now shows "Firebase Authentication · Real SMS" badge; Send OTP triggers Firebase (reCAPTCHA Enterprise attempted, fell back to reCAPTCHA v2), Firebase returns auth/configuration-not-found (expected — Phone Auth sign-in method not yet enabled in the user's Firebase console), app transparently falls back to demo OTP, login completes, audit log records AUTH_OTP_LOGIN.
- Lint clean. No runtime errors.

Stage Summary:
- Firebase integration is LIVE: code correctly calls Firebase signInWithPhoneNumber with the user's project config.
- Real SMS will work as soon as the user enables Phone Authentication in the Firebase console (Authentication → Sign-in method → Phone → Enable) AND upgrades the project to the Blaze plan (required for phone auth billing). Until then, graceful demo fallback keeps the app fully usable.
- Console error observed: "Firebase: Error (auth/configuration-not-found)" — this is the exact Firebase signal that Phone Auth is not enabled; documented for the user.

---
Task ID: 12
Agent: main
Task: Add Firebase Analytics (matching the Firebase console snippet the user pasted) + verify full integration.

Work Log:
- Updated src/lib/firebase.ts: added lazy `getFirebaseAnalytics()` using firebase/analytics (getAnalytics + isSupported), guarded for SSR/unsupported browsers.
- Updated src/components/providers.tsx: calls getFirebaseAnalytics() once on client mount when isFirebaseConfigured.
- Lint clean. Agent Browser verified:
  - Consumer login page shows "Firebase Authentication · Real SMS" badge.
  - Firebase Analytics network calls confirmed: gtag/js?id=G-J8M7DEC12G loaded + page_view event sent to tid=G-J8M7DEC12G with ep.origin=firebase.
  - Phone OTP: Firebase signInWithPhoneNumber attempted, reCAPTCHA Enterprise → reCAPTCHA v2 fallback, returns auth/configuration-not-found (Phone Auth sign-in method still NOT enabled in the user's Firebase console), graceful demo OTP fallback completes login.
- No runtime/page errors.

Stage Summary:
- Firebase config (snakzap-5a326) fully wired: Auth + Analytics both initialized with the user's official console snippet values.
- Analytics: LIVE (page_view events flowing to G-J8M7DEC12G).
- Auth SMS: code path correct, blocked only by Firebase console setting (Phone Auth sign-in method must be enabled + Blaze plan). Demo fallback keeps app usable until then.

---
Task ID: 13
Agent: main
Task: Create SnakZap Production Readiness Matrix v1.0 — specification & decision document (no implementation).

Work Log:
- Authored PRODUCTION_READINESS_MATRIX.md at project root — a specification document, NOT an implementation plan.
- Structure: 13 sections covering Purpose, Scope, strict Priority Definitions (P0/P1/P2/P3 with entry rules), the 5-Question Framework (Happy/Failure/Recovery/Money-Trust/Observability), Actor's Worst Day dimension, Starting Inventory (50 gaps mapped from uploaded audit), the full Matrix (P0=23 capabilities, P1=22, P2=11, P3=9 inventory), detailed 5-question breakdowns for all P0 + condensed for P1, Cross-Cutting Concerns, Decision Log (10 open questions with defaults), Acceptance criteria, and Governance rules.
- Applied the strict entry rule: every P0/P1 capability has failure + recovery defined. P2/P3 listed as inventory only until promoted.
- Traced Actor's Worst Day scenarios (Consumer/Vendor/Admin/Backend/Finance) through implicated capabilities.
- No code changed. No implementation. Document only.

Stage Summary:
- Matrix v1.0 ready for stakeholder review and sign-off.
- Next step (only after sign-off): derive implementation order from P0 dependencies, then begin P0 work — not before.
- Key discipline enforced: "No code is written for a capability until it has a row in this matrix."

---
Task ID: 14
Agent: main
Task: Revise Production Readiness Matrix v1.0 → v1.1 per stakeholder preliminary review (7 corrections + capability lifecycle).

Work Log:
- Added Revision History section documenting v1.0 → v1.1 changes.
- Added 7 new inventory gaps (G51–G57): transactional integrity, concurrency, DR-split-from-backup, deployment/rollback, external-dependency failure strategy, business invariants, unknown-exception handling.
- Added 5 new P0 capabilities to the matrix (P0-24 to P0-28) with full rows (failure scenario, dependency, acceptance, test, owner).
- Added detailed 5-question breakdowns for all 5 new P0 capabilities (Happy/Failure/Recovery/Money-Trust/Observability).
- Added Section 9: Business Invariants — 12 laws (I1–I12) the system must never violate, with enforcement + violation-handling per invariant. Violations route to P0-28 unknown-exception handling.
- Added Section 10: External Dependency Failure Matrix — 14 dependency scenarios (Razorpay variants, Firebase, FCM, email, maps, DB, Redis, WebSocket, SMS) each with fail-open/closed/retry/queue strategy + user message + alert policy.
- Added Section 11: Capability Lifecycle — 8 states (Proposed → Specified → Dependency-ready → Implemented → Tested → Observed → Failure-tested → Production-ready) with explicit gates. Rule: "code merged" ≠ "production-ready"; no Production-ready without Failure-tested.
- Renumbered sections: old 9-13 → 12-16; added Section 17: Next Step (P0 Dependency Graph).
- Updated Section 14 (Acceptance) to reference new sections + lifecycle states; launch gate now explicitly "every P0 at Production-ready (state 8)".
- Updated Section 15 (Governance) with invariant-protection, lifecycle-enforcement, and external-dependency rules.
- Updated Section 16 (Summary) with 4 new "From → To" rows reflecting v1.1 shifts.
- Added 6 new open questions (Q11–Q16) to Decision Log covering CI/CD, DR region, feature flags, outbox impl, lock retry policy, exception-queue ownership.
- No code changed. No implementation. Document only.

Stage Summary:
- Matrix v1.1 ready for stakeholder sign-off review: 17 sections, 28 P0 capabilities, 22 P1, 12 business invariants, 14 external-dependency scenarios, 8-state capability lifecycle, 16 open questions.
- Next document after sign-off: P0 Dependency Graph (not implementation, not sprints).
- v1.1 explicitly addresses all 7 stakeholder corrections: transactional integrity (✅ P0-24), concurrency (✅ P0-25), DR≠backup (✅ P0-26), deployment/rollback (✅ P0-27), external dependency failure matrix (✅ Section 10), business invariants (✅ Section 9), unknown-failure handling (✅ P0-28) + capability lifecycle gate (✅ Section 11).

---
Task ID: 15
Agent: main
Task: Revise Production Readiness Matrix v1.1 → v1.2 per stakeholder architectural review (10 corrections + traceability map + Approved lifecycle state + 6-condition launch gate).

Work Log:
- Updated header/metadata to v1.2; added Revision History entry documenting all v1.2 changes.
- Refined 5 P0 capabilities' detailed 5-question breakdowns:
  - P0-24: idempotent business effect (not technical exactly-once) — outbox + idempotent consumers; key principle added.
  - P0-25: 3 concurrency cases (A inventory race / B state-transition race / C payment duplicate) + duplicate-execution control renamed.
  - P0-26: business recovery, not just DB restore — post-restore money-state reconciliation; NO-GO if unresolved money state.
  - P0-27: 3 deployment classes (backward-compatible / expand-migrate-contract / breaking); key principle: app rollback ≠ DB rollback.
  - P0-28: 3 blast-radius freeze levels (transaction / entity quarantine / system kill switch); smallest-sufficient scope; over-freeze-prevention audit.
- Added stable invariant IDs I-01..I-12 with Names (Payment Integrity, Order Integrity, etc.) in Section 9.
- Added `Protects` column to every P0 row in Section 7.1 matrix table linking capability → invariants.
- Added `Affected P0` column to every External Dependency row in Section 10 linking dependency failure → capabilities compromised. Also added 2 new dependency rows (Outbox publisher, CI/CD pipeline).
- Added lifecycle state `Approved` (business-owner sign-off) between `Reviewed` and `Production-ready` — lifecycle now 9 states. Added rule: automated tests necessary but not sufficient; human must accept residual risk.
- Added Section 14.1: P0 Launch Gate — 6 AND-conditions (all P0 Production-ready + all invariants verified + all critical dep scenarios tested + DR drill passed + rollback drill passed + no unresolved P0 exception). GO/NO-GO verdict.
- Added Section 18: P0 Traceability & Invariant Map — master chain (Capability → Invariant → Acceptance → Test → Failure-injection → Recovery → Observability → Dependency → Lifecycle gate), capability→invariant coverage table (18.2), dependency→capability impact table (18.3), test→capability mapping principle (18.4), v1.2 foundation status (18.5).
- Updated Section 17 (Next Step) with explicit chain: v1.2 → Traceability Map → Dependency Graph → Critical Path → Implementation Order → Sprint Plan. Noted business/feature dependencies must be preserved (Strategic Blueprint interactions).
- Updated Section 15 (Governance) with traceability rule + `Approved` reference.
- Updated Section 16 (Summary) with 6 new "From → To" rows reflecting v1.2 shifts (exactly-once→idempotent effect, DB restore→business recovery, blanket rollback→per-class, freeze-all→smallest-sufficient, parallel lists→traceability, tests-green→6-AND-gate).
- Added 4 new open questions (Q17–Q20): outbox idempotency key, freeze escalation policy, deployment class classification, Approved-state business owner.
- No code changed. No implementation. Document only.

Stage Summary:
- Matrix v1.2 ready for stakeholder traceability review: 18 sections, 28 P0 capabilities (each with Protects column), 12 business invariants (I-01..I-12), 16 external-dependency scenarios (each with Affected P0), 9-state capability lifecycle (including Approved), 6-condition launch gate, Section 18 traceability foundation, 20 open questions.
- v1.2 addresses all 10 stakeholder corrections: P0-24 idempotent effect (✅), P0-25 3 concurrency cases + duplicate execution (✅), P0-26 business recovery (✅), P0-27 3 deploy classes (✅), P0-28 3 blast-radius levels (✅), invariant IDs + Protects column (✅), dependency Affected-P0 column (✅), traceability matrix (✅ Section 18), Approved lifecycle state (✅), 6-AND launch gate (✅).
- Next document after sign-off: full P0 Traceability & Invariant Map (separate doc), then P0 Dependency Graph, then Critical Path, then Implementation Order, then Sprint Plan. Implementation only after that chain.

---
Task ID: 16
Agent: main
Task: Revise Production Readiness Matrix v1.2 → v1.3 per stakeholder conceptual-approval review (10 corrections: pickup integrity gap, vendor operational invariant, blueprint risk cross-link, observability cross-cutting, separation of duties, no-expired-waiver, business-recovery law, traceability-as-coverage-test, 8 coverage queries, strategic-blueprint feature mapping).

Work Log:
- Updated header/metadata/revision-history to v1.3.
- Added 2 invariants: I-13 Pickup/Handoff Integrity (right order → right customer via QR+OTP; genuine gap — I-08 covered vendor-side authorization, not customer-side handoff) and I-14 Vendor Operational Integrity (vendor workload ≤ capacity; protected by P1 busy-mode, linked to I-02). Coverage note added explaining the gap and the P1-protector exception.
- Updated P0-07 Protects column to include I-13 (PICKED_UP transition requires pickup verification); updated P0-28 to protect I-01..I-14 (all).
- Added Section 12.1: 5 Architectural Laws — (1) Business Recovery Coherence, (2) Idempotent Business Effect, (3) Freeze Precision, (4) Pickup Correctness, (5) Separation of Duties. Each references enforcing capability/invariant.
- Added Section 11 rule 4: Separation of duties — developer who wrote a P0 capability cannot be its Reviewed or Approved signatory.
- Added Section 14.1 launch-gate condition 7: No expired exception waiver (P0 waivers require owner + expiry ≤30d + mitigation + business-owner approval; expired waiver = unresolved exception). Added waiver-discipline note.
- Cross-linked Section 10 dependency matrix to Strategic Blueprint risk register: added `Blueprint Risk` column (R-msg91, R-razorpay-wh, R-db-pool, R-session-loss). Database failure mode expanded to include connection-pool exhaustion. SMS gateway row linked to I-13 (pickup handoff).
- Added Section 12.2 cross-cutting note: Operational Observability is ONE substrate (P0-19/P0-20/P0-21), not duplicated per-domain. Domain dashboards consume it.
- Expanded Section 18: added 18.5 (8 coverage queries A–H as pass/fail spec — every P0 → invariant, every invariant → P0, every P0 → failure test, every dependency → scenario, every failure → recovery, every P0 → observable signal, every P0 → approver, every P0 → evidence), 18.6 (Strategic Blueprint feature→capability→invariant mapping requirement with seed table + feature-interaction preservation), 18.7 (v1.3 status). Section heading updated to "coverage-test specification".
- Updated Section 17 (Next Step) with explicit 5-artifact chain: v1.3 → Artifact 1 Traceability Map (P0_TRACEABILITY_MAP.md, must pass 8 queries) → Artifact 2 Dependency Graph → Artifact 3 Critical Path → Artifact 4 Implementation Order → Artifact 5 Sprint Plan.
- Updated Section 16 (Summary) with 5 new "From → To" rows; corrected launch-gate reference from 6 to 7 AND-conditions.
- Added 4 open questions (Q21–Q24): pickup verification (QR+OTP both), vendor capacity adaptive, waiver max expiry, feature-mapping ownership.
- No code changed. No implementation. Document only.

Stage Summary:
- Matrix v1.3 ready: 18 sections, 28 P0 capabilities, 14 invariants (I-01..I-14), 5 architectural laws, 16 dependency scenarios (with Blueprint Risk cross-link), 9-state lifecycle (with separation of duties), 7-condition launch gate (with no-expired-waiver), 8 coverage queries (A–H), Strategic Blueprint feature-mapping spec, 24 open questions.
- v1.3 addresses all 10 stakeholder corrections: I-13 pickup integrity (✅), I-14 vendor operational (✅), blueprint risk cross-link (✅ Section 10), observability cross-cutting (✅ Section 12.2), separation of duties (✅ Section 11 rule 4), no-expired-waiver (✅ launch gate cond 7), business-recovery law (✅ Law 1), traceability-as-coverage-test (✅ Section 18.5), 8 coverage queries (✅ A–H), feature mapping (✅ Section 18.6).
- Conceptual approval received; formal sign-off blocked until Artifact 1 (P0 Traceability & Invariant Map) passes all 8 coverage queries.
- Next: Artifact 1 (P0_TRACEABILITY_MAP.md) — single table, one row per P0 capability, all columns, 8 queries green, feature mapping populated.

---
Task ID: 17
Agent: main
Task: Build Artifact 1 — P0 Traceability & Invariant Map (P0_TRACEABILITY_MAP.md); run 8 coverage queries honestly; classify gaps.

Work Log:
- Created P0_TRACEABILITY_MAP.md (219 lines) as Artifact 1 of the 5-artifact chain.
- Built single traceability table: 28 P0 rows × 11 columns (ID, Capability, Protects, Failure, Recovery, Test, Dependency, Observable signal, Approver, Test evidence, Lifecycle state, Blueprint feature).
- Mechanically extracted all data from v1.3 matrix — no new capabilities or invariants invented (per discipline rule).
- Built invariant coverage table (Section 2): all 14 invariants (I-01..I-14) with their protecting P0s.
- Ran all 8 coverage queries (A–H) honestly:
  - A (P0→invariant): PARTIAL PASS — 18/28 have specific I-xx; 10 are foundational (cross-cutting, no specific mapping).
  - B (invariant→P0): PARTIAL PASS — 13/14 have P0 protectors; I-14 has only P1 busy-mode + P0-28 backstop (accepted exception).
  - C (P0→failure test): STRUCTURAL PASS — all 28 have test criteria defined (not yet written).
  - D (dependency→scenario): PASS — 16 scenarios.
  - E (failure→recovery): STRUCTURAL PASS — all defined.
  - F (P0→observable signal): STRUCTURAL PASS — all defined.
  - G (P0→approver): FAIL — 0/28 approvers named.
  - H (P0→test evidence): FAIL — 0/28 evidence (nothing implemented).
- Identified 6 gaps (G-A1, G-B1, G-B2, G-G1, G-H1, G-F1) with honest classification:
  - G-B1: I-13 (Pickup Integrity) has thin P0 coverage (only P0-07 + P0-28); potential matrix defect — needs v1.4 decision (expand P0-07 scope vs new P0-29).
  - G-A1: 10 foundational P0s lack specific invariant mapping (accepted exception; rigor gap).
  - G-B2: I-14 P1-protected (accepted exception).
  - G-G1, G-H1: expected-empty-pending-implementation (not matrix defects).
  - G-F1: Blueprint feature mapping incomplete (only seed rows; needs Strategic Blueprint cross-reference).
- Proposed gate-split resolution: Gate 1 (matrix structural completeness, A–F) vs Gate 2 (per-capability Production-ready, G+H). This resolves the honest deadlock (map can't pass until implementation; implementation gated on map).
- v1.4 changes required: exactly 2 items (G-B1 decision + G-A1 annotations). No other changes — discipline holds.

Stage Summary:
- Artifact 1 complete. Formal sign-off BLOCKED on G-B1 (I-13 coverage decision).
- Single substantive question for stakeholder: expand P0-07 scope to include pickup-event attribution, OR create new P0-29 (Pickup Audit Attribution)?
- After G-B1 decision → v1.4 → Blueprint feature mapping (G-F1) → Artifact 2 (Dependency Graph).
- No implementation. No code. Document only.

---
Task ID: 18
Agent: main
Task: Apply v1.4 changes per stakeholder G-B1 decision (expand P0-07, no P0-29) + Query A reinterpretation (Direct Protector vs Control/Enabler); re-run Traceability Map coverage queries.

Work Log:
- Updated PRODUCTION_READINESS_MATRIX.md to v1.4 (1024 lines). Changes applied EXACTLY per stakeholder instruction — no extras:
  - P0-07 acceptance expanded: 8 pickup-attribution conditions for PICKED_UP transition (correct order_id, authorized collector, QR+OTP both, audit event with 5 fields, immutable trail linkage, duplicate-pickup idempotent reject, cross-credential prevention, attribution-failure blocks transition).
  - P0-07 test criteria expanded: 5 new tests (correct collector, wrong collector, QR/OTP failure, duplicate pickup, attribution/audit persistence).
  - P0-07 → I-13 mapping now fully owned; P0-07 → P0-22 evidence linkage defined (mechanism → truth → evidence).
  - P0-07 NOT renamed "Pickup Audit Attribution" — attribution is an integrity condition of the transition, owned by state-machine capability.
  - Direct Protector vs Control/Enabler classification added to Section 7.1. 10 foundational P0s (P0-12,13,14,15,16,18,19,20,21,27) reclassified as Control/Enablers; Protects notation updated from (foundational)/(observability) to (Control/Enabler).
  - Architectural Law 6 added: "An invariant describes a truth that must never be violated; a capability describes the mechanism that enforces or preserves that truth."
  - I-14 coverage note reworded per stakeholder text: "intentionally P1-protected because Vendor Operational Integrity is not a launch-blocking financial/security invariant; its P1 control must nevertheless be defined before the relevant vendor scale is enabled."
  - P0 count unchanged (28); invariant count unchanged (14); no P0-29; no new invariant; no Dependency Graph; no implementation.
- Re-ran P0_TRACEABILITY_MAP.md against v1.4 (159 lines). Coverage query results:
  - A (P0→invariant): PARTIAL → **PASS** (18 Direct Protectors + 10 Control/Enablers classified; "indirectly protects" framing eliminated)
  - B (invariant→P0): PARTIAL → **PASS** (I-14 explicitly documented P1-protected exception; not a silent rule)
  - C (P0→failure test): STRUCTURAL PASS (P0-07 now 7 tests)
  - D (dependency→scenario): PASS
  - E (failure→recovery): STRUCTURAL PASS
  - F (P0→observable signal): STRUCTURAL PASS
  - G (P0→approver): FAIL (0/28 — expected-empty-pending-implementation)
  - H (P0→test evidence): FAIL (0/28 — expected-empty-pending-implementation)
- Gap resolution: G-B1 RESOLVED (P0-07 expanded); G-A1 RESOLVED (classification); G-B2 RESOLVED (wording). G-G1, G-H1, G-F1 remain (not matrix defects — pending implementation/cross-reference).
- Gate 1 (Matrix Completion, A–F): **GREEN**. Matrix formal sign-off **UNBLOCKED**.
- Gate 2 (Production Readiness, G+H): remains pending implementation (blocks launch, not Artifact 2).

Stage Summary:
- Matrix v1.4 complete and formally sign-off-eligible (no matrix defects remain).
- Traceability Map v1.4 re-run: 3 PASS (A, B, D) + 3 STRUCTURAL PASS (C, E, F) + 2 FAIL (G, H — expected, pending implementation).
- Next: populate G-F1 (Strategic Blueprint feature mapping) → Artifact 2 (P0 Dependency Graph).
- No implementation. No code. Documents only.

---
Task ID: 19
Agent: main
Task: G-F1 Strategic Feature Mapping — finalize Artifact 1 by proving Strategic Blueprint features trace into the production-control architecture.

Work Log:
- Created STRATEGIC_FEATURE_MAPPING.md (242 lines) as G-F1, the finalization step of Artifact 1.
- Built feature inventory from SnakZap original README (Phase 1-4 + UX Sprints + Admin Governance) with stable IDs (O##, P##, V##, A##, L##, U##, G##, C##).
- Mapped ~45 named features + 8 feature-interaction nodes using the stakeholder-specified structure: Feature → Primary P0 → Supporting P0s → Invariant(s) → Business interaction → State → Disposition.
- Applied three mapping states: Mapped (13), Partially mapped (28), Unmapped (4).
- All 4 unmapped features have documented dispositions — 0 undisposed:
  - U08 Dark mode: future scope, pure UX, no P0 required.
  - U09 WCAG: separate compliance track, not a production-control invariant.
  - U10 i18n: P1 product surface, no P0 required.
  - A04 Sidebar nav: pure admin UX, no P0 required.
- None of the 4 unmapped is an architectural gap — no v1.5 escalation needed.
- Preserved 8 feature interactions from Strategic Blueprint as interaction nodes (Prepaid+Reorder, POS+Settlement, LiveKitchen+Push, Wallet+Loyalty, GroupOrder+Concurrency, Geo-fence+Pickup, Catering+StateMachine, KillSwitch+OrderIntake).
- Recorded 3 caution flags for P2/P3 (not current defects — forward-looking):
  - G04 geo-fence: if auto-triggers PICKED_UP, I-13 attribution must still hold.
  - C01 catering: needs own state machine extension; P0-07 PICKED_UP gate may not directly apply.
  - L02 stamp card: if points are ledger-backed, P0-02 applies; decision at P2.
- Discipline held: 0 new P0 capabilities, 0 new invariants added during mapping.
- Added new Coverage Query I (strategic feature → P0/invariant/disposition): PASS.
- Appended G-F1 finalization summary to P0_TRACEABILITY_MAP.md; marked Artifact 1 FINAL.

Stage Summary:
- Artifact 1 — P0 Traceability & Invariant Map: FINAL ✅
  - A–F: Green (matrix completion)
  - G, H: FAIL (pending implementation — expected, blocks launch not Artifact 2)
  - I (strategic feature coverage): PASS (0 undisposed features)
- No matrix defects remain. No v1.5 changes required by G-F1.
- Artifact 2 — P0 Dependency Graph: UNLOCKED. Will use v1.4 traceability table (technical deps) + G-F1 mapping (business deps + feature interactions).
- No implementation. No code. Documents only.

---
Task ID: 20
Agent: main
Task: Build Artifact 2 — P0 Dependency Graph (5 edge types, DAG, no implementation order derivation).

Work Log:
- Created P0_DEPENDENCY_GRAPH.md (400 lines) as Artifact 2.
- Defined 5 edge types: Technical (--T-->), Business (--B-->), Feature interaction (--F-->), Failure propagation (--P-->), Critical-path metadata (blocking/non-blocking/parallelizable).
- Built node catalog: all 28 P0s with lifecycle state (all S2), type (Direct Protector / Control/Enabler), protects, technical deps.
- Mapped Technical edges (~30): P0 → infrastructure (DB cluster = 16 P0s, Redis = 4, Razorpay = 3, observability = 3, Firebase = 1, CI/CD = 1). Identified DB as single largest shared dependency.
- Mapped Business edges (31): core flow Auth→Order→Payment→Fulfilment→Pickup→Settlement + cross-cutting integrity. 27 blocking, 2 non-blocking, 2 parallelizable clusters.
- Mapped Feature interaction edges (8 nodes from G-F1): Prepaid+Reorder, POS+Settlement, LiveKitchen+Push, Wallet+Loyalty, GroupOrder+Concurrency, Geo-fence+Pickup (caution), Catering+StateMachine (caution), KillSwitch+OrderIntake. Each imposes cross-P0 blocking requirement.
- Mapped Failure propagation (12 scenarios from matrix Section 10): dependency failure → affected P0s → invariants at risk → Blueprint Risk ID.
- Added Critical-path metadata per edge — characterized as blocking/non-blocking/parallelizable, NOT implementation sequence.
- Graph integrity checks: DAG verified (no cycles), 0 orphans, 11 roots identified (foundation layer), 6 leaves identified (top of stack), 11 mid-layer.
- Shared-infrastructure concentration analysis: DB = 16 P0s (highest leverage), Redis = 4, Razorpay = 3.
- Strict rule held: NO implementation order derived. Graph is structural fact, not a plan. Artifact 3 computes critical path; Artifact 4 sequences.
- No new P0/invariant added.

Stage Summary:
- Artifact 2 — P0 Dependency Graph: DRAFT COMPLETE. Pending stakeholder review.
- DAG confirmed: 28 nodes, 11 roots, 6 leaves, 0 cycles, 0 orphans.
- DB hardening cluster (P0-15, 16, 24, 25, 26) identified as highest-leverage — 16 P0s depend on DB.
- Artifact 3 — Critical Path to Launch: UNLOCKED. Will compute longest blocking path from roots to leaves, factoring feature-interaction nodes.
- No implementation. No code. Document only.

---
Task ID: 21
Agent: main
Task: Fix 4 graph integrity/semantics corrections in Artifact 2 per stakeholder conditional-acceptance review.

Work Log:
- Correction 1 — Root count: "11 roots" → "12 roots". The list (P0-12,13,14,15,16,18,19,20,21,22,23,27) had 12 items but summary said 11. Fixed in Section 8.2 and Section 9 summary table. Mid-layer recalculated: 11 (both B-in and B-out). Added "Isolated (both root and leaf — control only): 1 (P0-27)" row to summary.
- Correction 2 — P0-27 semantics: Added explicit clarification that P0-27 (Deployment & Rollback) is an "isolated control node" — it appears in both root and leaf lists because in the B-edge graph it has no B-in and no B-out. Its relationship to other P0s is a control/foundation dependency (enables safe rollout), NOT a business functional prerequisite. Added rule: "Artifact 3 must NOT treat P0-27 as an ordinary business critical-path edge — it must not force 'implement P0-27 before everything.'"
- Correction 3 — Failure-propagation edges: Added explicit rule in Section 6 that `--P-->` edges do NOT create implementation precedence. "A P-edge describes what is compromised when a dependency fails — it is a risk/criticality signal, not a build-order constraint." Added example: "Razorpay-failure --P--> P0-01 means 'if Razorpay fails, P0-01 is compromised'; it does NOT mean 'P0-01 must be implemented before Razorpay.'" Rule: "Artifact 3 must use P-edges to weight criticality/risk on the critical path, but must never treat them as dependency edges for longest-path calculation." Also added to Section 10 (What this graph does NOT do).
- Correction 4 — "single point of compromise" reworded: Changed to "highest-centrality shared dependency" (Section 6 insight) and "Highest-centrality shared dependency" (Section 8.5 risk column) and "highest-centrality cluster" (Section 8.5 insight). Also softened Section 8.5 insight to clarify it "informs risk weighting, not the path itself" — whether DB lands on the critical path is for Artifact 3 to compute from B-edges and F-edges.
- No architectural redesign. No new P0/invariant. Graph structure unchanged; only integrity/semantics corrections.

Stage Summary:
- Artifact 2 — P0 Dependency Graph: 4 corrections applied. Ready for re-review → ACCEPTED.
- Graph topology: 28 nodes, 12 roots (incl. P0-27 isolated), 6 leaves (incl. P0-27 isolated), 11 mid-layer, 0 cycles, 0 orphans.
- Edge semantics now explicit: B-edges and F-edges drive longest-path; P-edges inform risk only; P0-27 is control-only (parallel, not blocking).
- No implementation. No code. Document only.

---
Task ID: 22
Agent: main
Task: Build Artifact 3 — Critical Path to Launch (longest blocking path computation, no implementation sequence).

Work Log:
- Created CRITICAL_PATH.md (276 lines) as Artifact 3.
- Method: longest-chain computation using ONLY --B[blocking]--> edges; --F--> as joins (super-blocking); --P--> as risk-weighting only (never path edges); P0-27 excluded as isolated control node.
- Topological layering: L0 (8 roots: P0-09,13,15,16,19,20,21,22), L1 (P0-10,11,17,24,25,26,28), L2 (P0-01), L3 (P0-02,05,08), L4 (P0-03,04,06), L5 (P0-07). Leaves: P0-03,04,07,26,28.
- Computed longest blocking path: max length 5 edges (6 nodes). Found TWO leaves at this length → TWO CO-CRITICAL PATHS:
  - Path α (ends at P0-07 State Machine/Pickup): P0-15→P0-25→P0-24→P0-01→P0-06→P0-07 + join P0-22 + F-joins (LiveKitchen+Push, Geo-fence+Pickup, Prepaid+Reorder, KillSwitch+OrderIntake)
  - Path β (ends at P0-03 Reconciliation or P0-04 Refund): P0-15→P0-25→P0-24→P0-01→P0-02→P0-03/04 + F-joins (Prepaid+Reorder, KillSwitch+OrderIntake, POS+Settlement, Wallet+Loyalty)
- Identified shared critical prefix (the bottleneck): P0-15→P0-25→P0-24→P0-01 (4 edges). Both co-critical paths pass through it.
- Preserved co-critical paths WITHOUT forcing single chain (per stakeholder boundary).
- Mapped 4 feature-interaction F-nodes touching critical path as super-blocking joins.
- Identified 7 parallelizable clusters (observability trio, foundation trio, payment cluster, reconciliation+refund, auth cluster, DR pair, concurrency+transactional pair).
- Identified 9 P0s with slack (off critical path): P0-09,10,11,13,16,19,20,21,22,23,26,27,28.
- Applied P-edge risk weighting: P0-24 and P0-01 are HIGHEST risk (on critical prefix AND have own failure-propagation edges); DB-failure touches every node on both paths.
- Explicitly did NOT prescribe implementation sequence, sprints, or developer assignments.
- Launch gate (7 AND-conditions) unchanged — critical path tells which delays hurt most, does not reduce launch bar.

Stage Summary:
- Artifact 3 — Critical Path to Launch: DRAFT COMPLETE. Pending stakeholder review.
- Two co-critical paths of equal length (5 edges); shared bottleneck prefix P0-15→P0-25→P0-24→P0-01.
- Risk concentrates on critical prefix (P0-24 + P0-01 have direct failure-propagation edges).
- Artifact 4 — Implementation Order: UNLOCKED. Will sequence within critical-path constraint, interleaving slack branches into parallel slots, respecting F-node joins as sync points.
- No implementation. No code. Document only.

---
Task ID: 23
Agent: main
Task: Apply 3 graph-semantics corrections to Artifact 3 per stakeholder conditional-acceptance review.

Work Log:
- Correction 1 — Separate "longest path" from "launch-critical surface": Rewrote Section 8 into two explicit outputs:
  - 8.A Structural Critical Path (B/F topology → longest dependency chains) — pure graph-theoretic; the two co-critical paths + dependency-graph bottleneck prefix.
  - 8.B Risk-Critical Surface (P-edge weighting + launch-gate mandatory + F-sync → high-risk launch surface) — 4-tier risk ranking; Tier 1 (P0-24, P0-01, P0-07), Tier 2 (path members), Tier 3 (launch-mandatory despite slack: P0-26 DR, P0-28, P0-22, P0-23, P0-09), Tier 4 (lower-risk parallel).
  - 8.C Relationship: three distinct questions (topology / risk-concentration / launch-completeness). Critical path ≠ launch criticality ≠ launch gate.
  - Added explicit statement: "Longest dependency path ≠ complete launch criticality." A delay in P0-26 (DR drill, path length 1) can block launch even though it is not on the longest chain.
- Correction 2 — F-node classification: Replaced homogeneous "F-nodes are path-length-neutral joins" with 5-class framework:
  - Synergy (no path/sync effect)
  - Synchronization (joint readiness + interaction test; extends effective launch-readiness, not length)
  - Security/Integrity synchronization (subset of sync; upholds a security/integrity invariant)
  - Precedence (promoted to B-edge; DOES extend path length)
  - Interaction-test-only (launch-gate constraint at P2/P3)
  - Classified all 9 F-nodes (8 original + 1 new):
    - QR Pickup + OTP Pickup → Security/Integrity synchronization (NEW — added per stakeholder instruction; I-13 core promise; Blueprint treats QR+OTP as synergistic primary mechanisms)
    - Kill Switch + Order Intake → Precedence (promoted to B-edge: P0-01 --B--> P0-23)
    - Prepaid + Quick Reorder → Synchronization
    - Live Kitchen + Push → Synchronization
    - POS + Settlement → Synchronization (P0 part) + Interaction-test-only (P3 part)
    - Wallet + Loyalty → Interaction-test-only (P2)
    - Group Order + Concurrency → Interaction-test-only (P3)
    - Geo-fence + Pickup → Security/Integrity synchronization (caution flag G04)
    - Catering + State Machine → Interaction-test-only (P3, caution C01)
- Correction 3 — Soften "launch bottleneck" → "dependency-graph bottleneck": Replaced all 4 standalone "launch bottleneck"/"true bottleneck" usages with "dependency-graph bottleneck" + explicit wording-discipline note: "This is a dependency-graph bottleneck — a statement about topology, not schedule. Calling it 'the launch bottleneck' would be premature: actual launch bottleneck status depends on real duration/effort, readiness gates, and parallel capacity, which are modeled in Artifact 4."
- Softened Section 7 risk-weighting insight: "launch risk concentrates" → "dependency-graph risk concentration"; added pointer that full launch-risk surface is broader (Section 8.B).
- Updated Section 9 (what this does NOT do) with 3 new discipline items; updated Section 10 sign-off table with new criteria rows.
- No architectural redesign. No new P0/invariant. Graph topology unchanged; only semantics/integrity corrections.

Stage Summary:
- Artifact 3 — Critical Path to Launch: 3 corrections applied. Ready for re-review → ACCEPTED.
- Two explicit outputs: Structural Critical Path (8.A) + Risk-Critical Surface (8.B).
- F-nodes now classified into 5 types; QR+OTP is Security/Integrity synchronization (new); KillSwitch+OrderIntake promoted to Precedence (B-edge).
- "launch bottleneck" → "dependency-graph bottleneck" everywhere.
- No implementation. No code. Document only.

---
Task ID: 24
Agent: main
Task: Artifact 3 recompute — add P0-23→P0-01 B-edge to DAG, recompute longest path, fix original computation error (P0-06 depth).

Work Log:
- Stakeholder caught that promoting Kill Switch + Order Intake F-node to B-edge (P0-01 --B--> P0-23) changes graph topology. Previous "topology unchanged" claim was false. Acknowledged and corrected.
- Added P0-23 → P0-01 as new B-edge in the DAG. P0-23 is no longer isolated — it is now a pure L0 root with B-dependent P0-01.
- Recomputed topological layering from scratch. Discovered an ORIGINAL computation error: P0-06 (State Separation) depends on P0-04 (Refund) as a blocking B-edge, and P0-04 depends on P0-02 (Ledger) which depends on P0-01 (Capture). So P0-06's depth is 6 (via P0-04), NOT 4 (via P0-01 directly) as previously stated. This error propagated to the longest-path calculation.
- Correct layering: L0 (12 roots), L1 (6 P0s), L2 (P0-24), L3 (P0-01, P0-08), L4 (P0-02, P0-05), L5 (P0-03, P0-04), L6 (P0-06), L7 (P0-07). 8 layers (was 6).
- Correct longest path: SINGLE path of 7 edges (8 nodes), NOT two co-critical paths of 5.
  P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-04 → P0-06 → P0-07
- P0-03 (Reconciliation) is a shorter branch (5 edges) diverging at P0-02 — NOT co-critical.
- P0-04 and P0-05 are NOT leaves (P0-06 depends on them) — corrected misclassification.
- P0-04 (Refund) is now ON the critical path (internal node, not just a terminus) — promoted to Tier 1 risk.
- Updated Section 7 (risk-weighting table): all "path α/path β" labels replaced with "critical path"; P0-04 elevated to HIGHEST risk.
- Updated Section 8.A: single critical path (7 edges); removed "two co-critical paths"; updated bottleneck to note it's shared by critical path + P0-03 branch.
- Updated Section 8.B: P0-04 moved from Tier 2 to Tier 1; P0-03 moved to Tier 3 (shorter branch, launch-mandatory); P0-05, P0-08 moved to Tier 4.
- Updated sign-off table with 2 new criteria: "Topology change from F→B promotion acknowledged" and "Original computation error corrected".
- Updated unlock section (11) to reference single critical path as sequencing skeleton.
- Discipline held: old co-critical paths NOT forced into new result. Math gave one path; reported one path.
- No new P0/invariant. No implementation. Document only.

Stage Summary:
- Artifact 3 — Critical Path to Launch: recompute complete. Single critical path of 7 edges (8 nodes).
  P0-15 → P0-25 → P0-24 → P0-01 → P0-02 → P0-04 → P0-06 → P0-07
- Topology changed (P0-23→P0-01 B-edge added); original P0-06 depth error corrected.
- Ready for re-review → ACCEPTED.
- No implementation. No code. Document only.

---
Task ID: 25
Agent: main
Task: Artifact 3 final verification — mechanical depth recurrence per node (stakeholder's last consistency check).

Work Log:
- Applied recurrence depth(node) = 1 + max(depth of every blocking B-predecessor) to every P0 node.
- Built blocking B-predecessors map for all 15 non-root P0s (only blocking edges counted; P0-13→P0-11 non-blocking excluded).
- Computed depth table bottom-up for the 11 nodes requested + P0-07 terminus:
  - P0-09 (root, d=0), P0-15 (root, d=0), P0-23 (root, d=0)
  - P0-25 (d=1), P0-24 (d=2 via P0-25), P0-01 (d=3 via P0-24 max)
  - P0-02 (d=4), P0-05 (d=4), P0-04 (d=5 via P0-02 max)
  - P0-06 (d=6 via P0-04 max — corrected; P0-05 at d=4 does not extend)
  - P0-07 (d=7 via P0-06 max)
- Explicitly verified P0-05 off-path: depth 4, but P0-06's max predecessor is P0-04 (depth 5), not P0-05 (depth 4). P0-05 is a parallel join, not on the critical path. Correctly Tier 4.
- Explicitly verified P0-23 off-path: depth 0 root, predecessor of P0-01, but P0-01's max predecessor is P0-24 (depth 2), not P0-23 (depth 0). The promoted F→B edge is a JOIN (synchronization), not path-extending.
- Result mathematically confirmed: single critical path of 7 edges (8 nodes):
  P0-15 (d=0) → P0-25 (d=1) → P0-24 (d=2) → P0-01 (d=3) → P0-02 (d=4) → P0-04 (d=5) → P0-06 (d=6) → P0-07 (d=7)
- No other leaf reaches depth 7 (P0-03 d=5, P0-08 d=3, P0-26 d=1, P0-28 d=1).
- Added Section 2.A (Mechanical Depth Verification) with full predecessor map + depth table + key-verification notes for P0-05 and P0-23.
- Updated sign-off table with new criterion: "Mechanical depth recurrence verified per node".
- No architectural change. No new P0/invariant. Math verification only.

Stage Summary:
- Artifact 3 — Critical Path to Launch: mechanical verification COMPLETE. Single 7-edge critical path mathematically confirmed via per-node recurrence.
- P0-05 and P0-23 explicitly shown off-path with depth arithmetic (not assertion).
- Ready for FINAL ACCEPTED → Artifact 4 (Implementation Order) unlock.
- No implementation. No code. Math verification only.

---
Task ID: 26
Agent: main
Task: Build Artifact 4 — P0 Implementation Order (sequence of waves, not sprints).

Work Log:
- Created IMPLEMENTATION_ORDER.md (297 lines) as Artifact 4.
- Method: wave(P0) = depth(P0) from Artifact 3 Section 2.A mechanical verification. 8 waves (W0-W7), matching the 8 topological layers.
- Wave 0 (foundation, 12 P0s + P0-27 parallel-isolated): P0-15, 22, 23, 09, 16, 19, 20, 21, 12, 13, 14, 18, (27). All roots, all parallel.
- Wave 1 (6 P0s): P0-25, 17, 26, 28, 10, 11. Direct root-dependents.
- Wave 2 (1 P0): P0-24. First critical-path throttle (needs P0-15 + P0-25).
- Wave 3 (2 P0s): P0-01, P0-08. F-convergence: Prepaid+Reorder (P0-01, P0-08, P0-25). KillSwitch+OrderIntake already promoted to B-edge.
- Wave 4 (2 P0s): P0-02, P0-05. Ledger + webhook.
- Wave 5 (2 P0s): P0-04, P0-03. F-convergence: POS+Settlement (P0-02, P0-03).
- Wave 6 (1 P0): P0-06. State separation, 4-way convergence.
- Wave 7 (1 P0): P0-07. Critical path terminus. F-convergence: QR+OTP (security/integrity sync — highest gate), LiveKitchen+Push, Geo-fence+Pickup (caution G04).
- Within-wave ordering by Risk-Critical Surface tier: Tier 1 (HIGHEST) gets earliest attention within wave (NOT earliest in time — scrutiny priority, not schedule).
- Mapped 9 F-node convergence gates across waves (Section 5).
- Applied Risk-Critical Surface as hardening priority (Section 6): Tier 1 P0s (P0-24, P0-01, P0-04, P0-07) get maximum failure-injection coverage + dedicated review; built in their wave, not pulled earlier.
- Identified parallelization opportunities (Section 7): Wave 0 has 13 parallel slots (largest); critical-path singletons (waves 2, 6, 7) have no parallelization within wave.
- Discipline held: NO sprints, NO teams, NO dates, NO effort estimates. Output is sequence/order only.
- P-edges NOT used as precedence. P0-27 NOT universal prereq (parallel-isolated). Risk tier NOT schedule.

Stage Summary:
- Artifact 4 — P0 Implementation Order: DRAFT COMPLETE. 8 waves, 28 P0s placed, 9 convergence gates mapped.
- Critical path respected: waves 0→1→2→3→4→5→6→7 follow the 7-edge critical path.
- Convergence gates (especially QR+OTP security sync at wave 7) mark Production-ready synchronization points.
- Artifact 5 — Sprint Plan: UNLOCKED. Will assign waves to sprints, teams to within-wave parallel P0s, set dates based on effort+capacity.
- No implementation. No code. Document only.

---
Task ID: 27
Agent: main
Task: Build Artifact 5 — Sprint Plan (final planning artifact before implementation).

Work Log:
- Applied wording correction to Artifact 4: "28 P0s across 8 waves" → "28 unique P0s assigned across 8 implementation waves" (P0 references in tables are appearances, not additional P0s).
- Created SPRINT_PLAN.md (375 lines) as Artifact 5 — final planning artifact.
- Sprint framework: 2-week sprints; 3 engineers + 1 DevOps + 1 product owner; velocity ~8-10 P0-points/sprint; up to 3 P0s in active Implemented work per sprint.
- Mapped 8 waves to 10 sprints (20 weeks total): Wave 0 = Sprint 1; Wave 1 = Sprint 2; Wave 2 = Sprint 3 (throttle); Waves 3-7 = Sprints 4-8; Wave 7 completion + F-gates = Sprint 9; launch-gate verification = Sprint 10.
- Critical path timeline: Sprint 1 (P0-15) → Sprint 9 (P0-07 Production-ready). Minimum 20 weeks assuming no slippage.
- Lifecycle state progression per sprint: Tier 1 P0s advance 1-2 states/sprint (max scrutiny); Tier 2-4 advance 2-3 states/sprint.
- Scheduled 5 P0-level F-convergence gates: Prepaid+Reorder (Sprint 6 pass), POS+Settlement (Sprint 8), QR+OTP security/integrity sync (Sprint 9 — highest gate), LiveKitchen+Push (Sprint 9), Geo-fence+Pickup caution (Sprint 9 resolved). P2/P3 gates deferred.
- RESOLVED Coverage Query G (approvers): all 28 P0s now have named owner (implements) + reviewer (different engineer) + approver (product owner). Separation of duties enforced: developer ≠ reviewer ≠ approver.
- Built launch readiness checklist (9 items) mapping to the 7 launch-gate AND-conditions + F-gates + P2/P3 deferrals.
- Built sprint-level risk register (7 risks with mitigations): critical-path slippage, outbox bugs, Razorpay integration, pickup attribution complexity, DR drill failure, approver bottleneck, F-gate interaction-test failure.
- Discipline held: NO implementation started. NO launch-gate reduction. NO P0/invariant count change. P-edges remain risk signals only. P0-27 remains parallel-isolated.

Stage Summary:
- Artifact 5 — Sprint Plan: DRAFT COMPLETE. 10 sprints, 20 weeks, 28 P0s assigned, Coverage G resolved.
- Critical path drives minimum 20-week timeline to launch gate verification.
- All 5 artifacts now complete:
  - Artifact 1 Traceability Map: FINAL ✅
  - Artifact 2 Dependency Graph: ACCEPTED ✅
  - Artifact 3 Critical Path: FINAL ACCEPTED ✅
  - Artifact 4 Implementation Order: ACCEPTED ✅
  - Artifact 5 Sprint Plan: DRAFT (pending sign-off)
- Implementation UNLOCKED after Artifact 5 sign-off. Sprint 1 begins foundation wave.
- No code written yet. Planning artifacts only.
