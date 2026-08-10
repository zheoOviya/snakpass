# SnakZap — Full Source Code Package

## Archive
**File:** `snakzap-full-source.tar.gz` (777 KB, 235 files)

## What's included

### Application code (`src/`)
- `src/app/` — Next.js 16 App Router pages + API routes
  - `page.tsx` — landing page (3 portal cards)
  - `consumer/page.tsx` — consumer portal (OTP login gate)
  - `vendor/page.tsx` — vendor portal (OTP login gate)
  - `admin/page.tsx` — admin portal (email+2FA login gate)
  - `api/` — 20+ API routes (auth, orders, restaurants, menu, kill-switches, health, backup, alerts, audit)
  - `middleware.ts` — rate limiting (P0-13) + CSRF (P0-14) in request path
  - `globals.css` — teal theme (#0D9488), light/dark mode
  - `layout.tsx` — root layout with AuthProvider + ThemeProvider
- `src/components/` — shadcn/ui (50+ components) + SnakZap-specific:
  - `snak/consumer-view.tsx` — restaurant catalog, menu, cart, order tracking
  - `snak/vendor-view.tsx` — live order queue, menu management
  - `snak/admin-view.tsx` — metrics dashboard, charts, kill switches, audit trail
  - `snak/phone-otp-login.tsx` — Firebase OTP login (consumer/vendor)
  - `snak/admin-login.tsx` — email + 2FA login
  - `snak/order-tracking.tsx` — timeline + QR + OTP pickup tracking
  - `snak/app-shell.tsx` — shared header/footer/persona badge
  - `snak/bits.tsx` — veg badges, spice dots, star ratings
- `src/lib/` — 17 library modules:
  - `db.ts` — Prisma client
  - `session.ts` — DB-backed session + httpOnly cookie
  - `otp-service.ts` — OTP create/verify (scrypt-hashed, 5min expiry)
  - `password.ts` — scrypt hash/verify
  - `firebase.ts` — client-side Firebase Auth (phone OTP)
  - `firebase-admin.ts` — server-side Admin SDK token verification (P0-09)
  - `audit.ts` — append-only audit with hash-chain tamper-evidence (P0-22)
  - `killswitch.ts` — fail-safe kill switch with safe defaults (P0-23)
  - `rate-limit.ts` — rate limiter with fail-closed/fail-open (P0-13)
  - `csrf.ts` — double-submit cookie CSRF (P0-14)
  - `backup.ts` — backup with SHA-256 checksum (P0-16)
  - `alerting.ts` — 8 alert rules with cooldown (P0-21)
  - `deployment.ts` — feature flags + 3 deployment classes (P0-27)
  - `errors.ts` — consistent error envelope with traceId (P0-18)
  - `logger.ts` — structured JSON logging (P0-19)
  - `validation.ts` — Zod schemas for all API routes (P0-12)
  - `realtime.ts` — server-side socket.io emit helper
  - `cart-store.ts` — zustand cart with persistence
  - `snack.ts` — status metadata, currency, time-ago helpers
  - `types.ts` — shared TypeScript types
- `src/hooks/` — use-auth, use-realtime, use-toast, use-mobile
- `src/middleware.ts` — rate limiting + CSRF in request path

### Database (`prisma/`)
- `schema.prisma` — 9 models (User, OtpRequest, Session, Restaurant, MenuItem, Order, OrderItem, AuditLog, KillSwitch)
- `seed.ts` — demo data (4 restaurants, 25 menu items with SVG images, 9 orders, 5 kill switches, 6 audit logs)
- `migrations/` — 2 migrations (initial_schema + audit_hash_chain)

### Mini-services (`mini-services/`)
- `realtime/` — socket.io service (port 3003) — real-time order/killswitch events
- `backup-scheduler/` — scheduled backup service (port 3004) — daily backup + checksum verify
- `alert-evaluator/` — alert evaluation loop (port 3005) — 8 rules, 60s interval

### Assets (`public/`)
- `images/svg/` — 25 hand-crafted food SVG illustrations
- `images/r1-4.png` — 4 AI-generated restaurant cover images
- `logo.svg`

### Configuration
- `.env` — Firebase config (NEXT_PUBLIC_FIREBASE_*), DATABASE_URL
- `package.json` — all dependencies (Next.js 16, React 19, Prisma, Firebase, socket.io, zod, etc.)
- `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`
- `eslint.config.mjs`, `components.json`
- `Caddyfile` — gateway config (port 81 → port 3000 + XTransformPort forwarding)

### Planning documents (governance chain)
- `PRODUCTION_READINESS_MATRIX.md` — v1.4 (28 P0 capabilities, 14 invariants, 5 architectural laws, 9-state lifecycle, 7-condition launch gate)
- `P0_TRACEABILITY_MAP.md` — Artifact 1 FINAL (capability ↔ invariant ↔ dependency ↔ test ↔ observability)
- `STRATEGIC_FEATURE_MAPPING.md` — G-F1 (102 features → capability → invariant mapping)
- `P0_DEPENDENCY_GRAPH.md` — Artifact 2 (DAG, 5 edge types, 12 roots, 6 leaves)
- `CRITICAL_PATH.md` — Artifact 3 (7-edge critical path, 8 waves, risk surface)
- `IMPLEMENTATION_ORDER.md` — Artifact 4 (8 implementation waves)
- `SPRINT_PLAN.md` — Artifact 5 (10 sprints, ~20 weeks provisional)
- `WAVE0_EVIDENCE.md` — pre-acceptance evidence for 11 P0s
- `IMPLEMENTATION_LOG.md` — lifecycle state tracker + governance lock
- `DEVIATION_LOG.md` — DEV-001 (WORM) + DEV-002 (Firebase) open deviations
- `worklog.md` — complete execution log (42 task entries)

## How to set up in IDE

```bash
# 1. Extract
tar xzf snakzap-full-source.tar.gz
cd snakzap-full-source

# 2. Install dependencies
bun install

# 3. Install Firebase Admin SDK
bun add firebase-admin

# 4. Generate Prisma client
bun run db:generate

# 5. Push schema to fresh SQLite DB (or use existing db/custom.db)
bun run db:migrate

# 6. Seed demo data
bun run prisma/seed.ts

# 7. Start main app (port 3000)
bun run dev

# 8. Start mini-services (separate terminals)
cd mini-services/realtime && bun install && bun run dev    # port 3003
cd mini-services/backup-scheduler && bun run dev            # port 3004
cd mini-services/alert-evaluator && bun install && bun run dev  # port 3005
```

## What's remaining (3 open gaps — all require production environment)

### DEV-001 — P0-22 Audit WORM (OPEN)
- **What's done:** hash-chain tamper-evidence + SQLite triggers (UPDATE/DELETE rejected)
- **What's needed:** PostgreSQL with `REVOKE UPDATE, DELETE ON audit_logs FROM app_user` — SQLite triggers are bypassable (DROP TRIGGER + mutate)
- **How to close:** deploy PostgreSQL, apply REVOKE, run attempted-mutation test (should be rejected at permission level, not just trigger level)

### DEV-002 — P0-09 Firebase verification (OPEN)
- **What's done:** firebase-admin SDK installed, verifyFirebaseToken() code-ready, demo-trust hard-disabled in production
- **What's needed:** Firebase service-account JSON (from Firebase Console → Project Settings → Service Accounts → Generate new private key)
- **How to close:**
  1. Set `FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json` in `.env`
  2. Enable Phone Authentication in Firebase Console
  3. Upgrade to Blaze plan (required for phone auth)
  4. Run 5 token tests: valid (accept), expired (reject), malformed (reject), wrong-project (reject), revoked (reject)

### P0-27 — CI/CD + rollback drill (OPEN)
- **What's done:** feature flags, deployment classification (3 classes), rollback procedures documented
- **What's needed:** actual CI/CD pipeline (GitHub Actions / GitLab CI) + deployed environment with traffic
- **How to close:**
  1. Set up CI/CD pipeline (lint + test + build + deploy)
  2. Deploy to staging/production
  3. Run rollback drill: deploy new version → verify health → rollback → verify ≤10 min
  4. Record drill evidence (timestamp + duration + health check results)

## Demo credentials
- Consumer: `+919876500001` (phone OTP)
- Vendor: `+919876500002` (phone OTP)
- Admin: `admin@snakzap.com` / `admin123` (email + 2FA)

## Tech stack
- Next.js 16 (App Router, RSC), React 19, TypeScript 5
- Tailwind CSS 4, shadcn/ui (New York style), Lucide icons
- Prisma ORM (SQLite client), Zustand, TanStack Query
- Socket.io (real-time), Firebase (Auth + Analytics)
- Zod (validation), framer-motion (animations), recharts (charts)
- qrcode.react (QR codes), next-themes (dark mode)
