# SnakZap — Full Source Code Package v2

## Archive
**File:** `snakzap-full-source-v2.tar.gz` (780 KB, 244 files)

## v1 → v2 changes
- **Port separation fix:** each portal now runs on its own port
- Added 3 standalone portal mini-services (consumer:3006, vendor:3007, admin:3008)
- Landing page updated with port badges + separate links
- Middleware (rate limiting + CSRF) added to request path

## Architecture (7 services on 7 ports)

```
Port 3000 → API server (Next.js — all /api/* routes + landing page)
Port 3003 → Realtime service (socket.io — order/killswitch events)
Port 3004 → Backup scheduler (daily backup + checksum verify)
Port 3005 → Alert evaluator (8 rules, 60s loop)
Port 3006 → Consumer portal (standalone — login + consumer UI)
Port 3007 → Vendor portal (standalone — login + vendor UI)
Port 3008 → Admin portal (standalone — login + admin UI)
```

## Setup in IDE

```bash
# 1. Extract
tar xzf snakzap-full-source-v2.tar.gz
cd snakzap-full-source-v2

# 2. Install main app dependencies
bun install
bun add firebase-admin

# 3. Generate Prisma client + migrate + seed
bun run db:generate
bun run db:migrate
bun run prisma/seed.ts

# 4. Start main app (port 3000)
bun run dev

# 5. Start mini-services (separate terminals)
cd mini-services/realtime && bun install && bun run dev          # port 3003
cd mini-services/backup-scheduler && bun run dev                  # port 3004
cd mini-services/alert-evaluator && bun install && bun run dev    # port 3005
cd mini-services/consumer-portal && bun run dev                   # port 3006
cd mini-services/vendor-portal && bun run dev                     # port 3007
cd mini-services/admin-portal && bun run dev                     # port 3008
```

## Demo credentials
- Consumer (port 3006): `+919876500001` (phone OTP)
- Vendor (port 3007): `+919876500002` (phone OTP)
- Admin (port 3008): `admin@snakzap.com` / `admin123` (email + 2FA)

## What's included (244 files)

### Application code (src/)
- 20+ API routes (auth, orders, restaurants, menu, kill-switches, health, backup, alerts)
- 8 SnakZap components (consumer-view, vendor-view, admin-view, phone-otp-login, admin-login, order-tracking, app-shell, bits)
- 50+ shadcn/ui components
- 17 lib modules (auth, audit, logging, validation, errors, rate-limit, csrf, backup, alerting, deployment, etc.)
- middleware.ts (rate limiting + CSRF in request path)
- 3 portal pages (/consumer, /vendor, /admin — each gated by auth)

### Mini-services (mini-services/)
- realtime/ — socket.io (port 3003)
- backup-scheduler/ — daily backup (port 3004)
- alert-evaluator/ — alert loop (port 3005)
- consumer-portal/ — standalone consumer portal (port 3006)
- vendor-portal/ — standalone vendor portal (port 3007)
- admin-portal/ — standalone admin portal (port 3008)

### Database (prisma/)
- 9 models (User, OtpRequest, Session, Restaurant, MenuItem, Order, OrderItem, AuditLog, KillSwitch)
- 2 migrations (initial_schema + audit_hash_chain)
- seed.ts (4 restaurants, 25 menu items with SVG, 9 orders, 5 kill switches, 6 audit logs)

### Assets (public/)
- 25 hand-crafted food SVG illustrations
- 4 AI-generated restaurant cover images

### Planning documents (governance chain)
- PRODUCTION_READINESS_MATRIX.md — v1.4 (28 P0s, 14 invariants, 5 architectural laws)
- P0_TRACEABILITY_MAP.md — Artifact 1 FINAL
- STRATEGIC_FEATURE_MAPPING.md — G-F1
- P0_DEPENDENCY_GRAPH.md — Artifact 2
- CRITICAL_PATH.md — Artifact 3
- IMPLEMENTATION_ORDER.md — Artifact 4
- SPRINT_PLAN.md — Artifact 5
- WAVE0_EVIDENCE.md — evidence packets
- IMPLEMENTATION_LOG.md — lifecycle tracker
- DEVIATION_LOG.md — DEV-001 + DEV-002

## 3 remaining gaps (require production environment)

### DEV-001 — P0-22 Audit WORM (OPEN)
- **Done:** hash-chain tamper-evidence + SQLite triggers
- **Needed:** PostgreSQL with REVOKE UPDATE/DELETE (SQLite triggers are bypassable)

### DEV-002 — P0-09 Firebase verification (OPEN)
- **Done:** firebase-admin SDK, verifyFirebaseToken(), demo-trust hard-disabled in production
- **Needed:** Firebase service-account JSON + 5 real-token tests

### P0-27 — CI/CD + rollback drill (OPEN)
- **Done:** feature flags, deployment classification, rollback procedures
- **Needed:** CI/CD pipeline + deployed environment + ≤10-min rollback drill
