# SnakZap

**Pickup-first food ordering platform for the Indian market.** Consumer + Vendor + Admin portals, live kitchen tracking, OTP pickup, vendor POS, kill-switch governance.

## Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript 5
- **Styling:** Tailwind CSS 4 + shadcn/ui (New York style) + Lucide icons
- **Database:** Prisma ORM (SQLite in dev, PostgreSQL in production)
- **Auth:** Supabase (Phone OTP + JWT via JWKS) + NextAuth session cookies
- **Realtime:** Socket.io (separate mini-service on port 3003)
- **Background services:** backup-scheduler (3004), alert-evaluator (3005), consumer-portal (3006), vendor-portal (3007), admin-portal (3008)

## Architecture

```text
┌──────────────────────────────────────────────────┐
│  Next.js API + Landing (port 3000)              │
│  - All /api/* routes                             │
│  - Edge middleware (rate-limit + CSRF + trace)  │
└──────────────────────────────────────────────────┘
         │
         ├── mini-services/realtime (3003)
         ├── mini-services/backup-scheduler (3004)
         ├── mini-services/alert-evaluator (3005)
         ├── mini-services/consumer-portal (3006)
         ├── mini-services/vendor-portal (3007)
         └── mini-services/admin-portal (3008)
```

## Local Development

```bash
# Install deps
bun install

# Set up database
cp .env.example .env  # then edit DATABASE_URL
bunx prisma migrate dev
bunx prisma db seed

# Run main app
bun run dev  # starts on port 3000

# Run mini-services (each in its own terminal)
cd mini-services/backup-scheduler && bun run dev
cd mini-services/alert-evaluator && bun run dev
cd mini-services/realtime && bun run dev
cd mini-services/consumer-portal && bun run dev
cd mini-services/vendor-portal && bun run dev
cd mini-services/admin-portal && bun run dev
```

## Demo Credentials

- **Consumer:** phone `+919876500001` (OTP auto-generated in dev)
- **Vendor Owner:** phone `+919876500002` (OTP auto-generated in dev)
- **Admin:** email `admin@snakzap.com` + password `admin123` (then 2FA OTP auto-generated in dev)

## Production Readiness Matrix

| P0 | Capability | Status |
|----|------------|--------|
| P0-20 | Audit Integrity (hash-chain + WORM) | ✅ PASS (SQLite dev) |
| P0-19 | Structured Logging (JSON + traceId) | ✅ PASS |
| P0-18 | Error Handling (envelope + traceId) | ✅ PASS |
| P0-23 | Kill-Switch Fail-Safe (fail-closed) | ✅ PASS |
| P0-13 | Rate Limiting (per-class + fail-closed) | ✅ PASS |
| P0-16 | Daily Backup (scheduler + checksum) | ✅ PASS |
| P0-21 | Alert Evaluation (8 rules + cooldown) | ✅ PASS |
| P0-09 / DEV-002 | Supabase JWT Verification | ✅ CLOSED |
| P0-27 Phase 1 | CI Pipeline | ✅ COMPLETE (`.github/workflows/ci.yml`) |
| DEV-001 / P0-22 | Production WORM (PostgreSQL REVOKE) | 🔴 OPEN — see `DEV-001-CLOSURE.md` |
| P0-27 Phase 2 | CD + Deployment + Rollback Drill | 🔴 OPEN |

## Wave-0 Gate Status

**🔴 HOLD** — pending DEV-001 closure + P0-27 Phase 2 + independent G/H review.

See `WAVE0_GATE_REVIEW.md` for full evidence package.

## DEV-001 Closure (Production WORM)

DEV-001 closure requires PostgreSQL with restricted application role:

```text
snakzap_admin (migration owner)
  ├── CREATE / ALTER / DROP
  └── REVOKE / GRANT privileges

snakzap_app (application role)
  ├── SELECT / INSERT on all tables
  ├── USAGE on sequences
  ├── ❌ UPDATE on audit_log (REVOKE'd)
  └── ❌ DELETE on audit_log (REVOKE'd)
```

This boundary cannot be proven in SQLite (triggers are bypassable via `DROP TRIGGER`). PostgreSQL privilege separation is required.

### DEV-001 Closure Artifacts

See `DEV-001-CLOSURE.md` for step-by-step closure instructions using GitHub Actions workflow + SQL scripts in `prisma/scripts/`.

## CI/CD

- **CI Pipeline:** `.github/workflows/ci.yml` — lint + typecheck + prisma generate + build + mini-services syntax check
- **DEV-001 Closure Workflow:** `.github/workflows/dev-001-closure.yml` — provisions PostgreSQL, runs migrations, executes REVOKE + tamper tests, captures evidence

## Documentation

- `PRODUCTION_READINESS_MATRIX.md` — 28 P0 capabilities + 14 invariants
- `P0_TRACEABILITY_MAP.md` — capability ↔ invariant ↔ dependency ↔ test mapping
- `P0_DEPENDENCY_GRAPH.md` — DAG of P0 dependencies
- `IMPLEMENTATION_ORDER.md` — 8-wave implementation sequence
- `SPRINT_PLAN.md` — 10-sprint, ~20-week plan
- `CRITICAL_PATH.md` — single critical path through dependency graph
- `WAVE0_GATE_REVIEW.md` — consolidated Wave-0 evidence + governance decision

## License

Private. SnakZap project.
