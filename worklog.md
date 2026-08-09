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
