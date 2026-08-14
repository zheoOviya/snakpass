# Task 4 — Stateful Services Hosting Design

**Task ID:** 56
**Agent:** `deployment-infrastructure-specialist`
**Date:** 2026-08-13
**Scope:** Hosting design for the 6 SnakZap mini-services. Determines stateful vs stateless, long-lived vs request-driven, Vercel-eligible vs external-platform-required. **NO provisioning is performed.**

---

## 1. Mini-service inventory (per-service analysis)

For each service, this section answers:
1. Stateful or stateless?
2. Long-lived connection (socket.io)?
3. Required env vars
4. Vercel serverless eligible?
5. Port
6. Docker containerization status

### 1.1 `realtime` (port 3003)

| Property | Value |
|---|---|
| **Source** | `mini-services/realtime/index.ts` |
| **Dependencies** | `socket.io@^4.8.3` |
| **Stateful?** | **YES** — maintains in-memory `socket.io` rooms (`restaurant:<id>`, `order:<id>`, `vendor:all`, `admin:all`, `consumer:all`). Each connected browser client holds a long-lived WebSocket. |
| **Long-lived connection?** | **YES** — `socket.io` Server with `path: '/'`, `pingTimeout: 60000`, `pingInterval: 25000`. |
| **Env vars required** | None currently. Future: `REALTIME_URL` (consumed by the Next.js app — see §1.1.1). |
| **Vercel serverless eligible?** | **NO**. Vercel serverless functions have a max duration of 10-300 seconds (depending on plan) and do not hold WebSocket connections between invocations. The `socket.io` Server object MUST live in a long-lived process. |
| **Docker containerization status** | **NONE** — no `Dockerfile` in `mini-services/realtime/`. The main project `Dockerfile` does NOT include mini-services. |
| **Recommended platform** | **Fly.io** (preferred — supports WebSockets natively, supports persistent volumes if needed in future, has Tokyo region `nrt` close to Supabase `ap-northeast-1`). Alternative: **Railway** (simpler config, supports WebSockets, has Tokyo region). Fallback: **Render** (supports WebSockets, slightly higher cold-start latency). |
| **Recommended region** | `nrt` (Tokyo, Fly.io) — same region as Supabase `ap-northeast-1` to minimize cross-region latency for `socket.io` event fan-out (the service itself does NOT touch the DB, but the Next.js app's `socket.io-client` connection does, and that client runs on Vercel `hnd1` Tokyo which is also low-latency to `nrt`). |

#### 1.1.1 Frontend coupling

The Next.js app connects to this service via `src/lib/realtime.ts:7`:

```typescript
const REALTIME_URL = 'http://localhost:3003'  // HARDCODED
```

This works in dev. In production (Vercel → Fly.io), this MUST be replaced with `process.env.REALTIME_URL`. **Flagged as follow-up §12 #9 in `P0-27-PHASE2-REMEDIATION.md`** — Phase 3 refactor.

#### 1.1.2 Browser client connection

The browser-side `socket.io-client` connects via the **Caddyfile gateway** at `:81` with `?XTransformPort=3003` query param. In production, the Caddyfile is NOT used (Vercel handles HTTP routing). The browser must connect DIRECTLY to the Fly.io realtime service URL:

```typescript
io('https://realtime-snakzap.fly.dev', { path: '/' })
```

This is a Phase 3 frontend refactor — the current `use-realtime.ts` hook (in `src/hooks/use-realtime.ts`) likely hardcodes a path that needs updating.

### 1.2 `alert-evaluator` (port 3005)

| Property | Value |
|---|---|
| **Source** | `mini-services/alert-evaluator/index.ts` |
| **Dependencies** | `@prisma/client@^6.11.1` |
| **Stateful?** | **YES** — maintains in-memory `lastFired` Map for alert cooldown tracking. Holds a single long-lived `PrismaClient` instance. |
| **Long-lived connection?** | **NO** (no WebSocket) — but it runs a continuous `setInterval` loop (default 60s). It DOES expose an HTTP server (Bun.serve on port 3005) for `/health`, `/trigger`, `/evidence`. |
| **Env vars required** | `DATABASE_URL` (Prisma — must be Supabase Session Pooler, port 5432, role `snakzap_app` for read-only access). `ALERT_INTERVAL_MS` (default `60000`). |
| **Vercel serverless eligible?** | **NO**. The `setInterval` loop needs a long-lived process. Vercel Cron could trigger `/trigger` periodically, but the `lastFired` cooldown state would be lost between invocations (each Vercel function invocation is fresh). |
| **Docker containerization status** | **NONE** — no `Dockerfile` in `mini-services/alert-evaluator/`. |
| **Recommended platform** | **Fly.io** (preferred — same region as realtime for consistency). Alternative: **Railway**. **NOT Vercel**. |
| **Recommended region** | `nrt` (Tokyo, Fly.io) — same region as Supabase for low-latency DB queries. |
| **DB connection notes** | Must use **Session Pooler** (port 5432) NOT Transaction Pooler (port 6543). The Session Pooler allows for connection reuse across the long-lived process. Prisma 6.x supports this natively. The role MUST be `snakzap_app` (read-only on `AuditLog` due to WORM — alert-evaluator only reads audit logs, never writes; this is compatible). |

#### 1.2.1 State migration concern

If the alert-evaluator restarts, the `lastFired` Map is reset, which means every alert rule may re-fire immediately after restart (cooldown timer is lost). For Phase 2 launch this is acceptable (it just produces transient alert noise). For Phase 3, the `lastFired` Map should be persisted to a Redis or Postgres table.

### 1.3 `backup-scheduler` (port 3004)

| Property | Value |
|---|---|
| **Source** | `mini-services/backup-scheduler/index.ts` |
| **Dependencies** | None (uses only Node built-ins `crypto`, `fs/promises`). |
| **Stateful?** | **NO** (stateless per-cycle) — but it maintains a long-lived `setInterval` loop. The state it WOULD need to persist (last backup time, last backup path) is stored on the filesystem under `db/backups/execution-log.jsonl`. |
| **Long-lived connection?** | **NO** — HTTP server on port 3004 for `/health`, `/trigger`, `/evidence`. |
| **Env vars required** | `BACKUP_INTERVAL_MS` (default `86400000` = 24h). Future: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (for pg_dump → S3 — see `BACKUP_REPLACEMENT_PLAN.md`). |
| **Vercel serverless eligible?** | **PARTIAL** — the current implementation reads `db/custom.db` (SQLite file) which does NOT exist on Vercel. The logic itself (file copy + checksum) is incompatible with PostgreSQL. **MUST be re-implemented** for production. See `BACKUP_REPLACEMENT_PLAN.md` for the replacement design. |
| **Docker containerization status** | **NONE**. |
| **Recommended platform** | **Two options:** (a) **Vercel Cron** with a single serverless function that runs `pg_dump` → uploads to S3. (b) **Fly.io** with a `setInterval` loop (same pattern as current). Option (a) is preferred because it requires zero long-lived infrastructure and matches Vercel's cron model. |
| **Recommended region** | N/A for option (a) — Vercel Cron runs in the project's primary region (`hnd1` Tokyo). For option (b) — `nrt` (Tokyo, Fly.io) close to Supabase. |

### 1.4 `consumer-portal` (port 3006)

| Property | Value |
|---|---|
| **Source** | `mini-services/consumer-portal/index.ts` |
| **Dependencies** | None (uses only `Bun.serve` + `fetch`). |
| **Stateful?** | **NO** — pure HTTP proxy. No state, no DB, no WebSocket. |
| **Long-lived connection?** | **NO** — but `Bun.serve` keeps the process alive to accept HTTP requests. |
| **Env vars required** | None. Hardcoded `NEXTJS_URL = 'http://localhost:3000'`. |
| **Vercel serverless eligible?** | **REDUNDANT on Vercel** — Vercel handles path routing natively. The `/consumer` path is already a Next.js route (`src/app/consumer/page.tsx`). The portal shim exists for the dev sandbox (where Caddyfile routes `/consumer` to port 3006 → which proxies to `localhost:3000/consumer`). On Vercel, `https://snakzap.vercel.app/consumer` is served directly by the Next.js app. |
| **Docker containerization status** | **NONE**. |
| **Recommended platform** | **DO NOT DEPLOY** — retire on Vercel. Marked as Phase 3 follow-up #12 in `P0-27-PHASE2-REMEDIATION.md` §12. |
| **Recommended region** | N/A. |

### 1.5 `vendor-portal` (port 3007)

| Property | Value |
|---|---|
| **Source** | `mini-services/vendor-portal/index.ts` |
| **Dependencies** | None. |
| **Stateful?** | **NO** — pure HTTP proxy. Identical structure to `consumer-portal`. |
| **Long-lived connection?** | **NO**. |
| **Env vars required** | None. Hardcoded `NEXTJS_URL = 'http://localhost:3000'`. |
| **Vercel serverless eligible?** | **REDUNDANT on Vercel** — `/vendor` is a Next.js route (`src/app/vendor/page.tsx`). |
| **Docker containerization status** | **NONE**. |
| **Recommended platform** | **DO NOT DEPLOY** — retire on Vercel. Phase 3 follow-up #12. |
| **Recommended region** | N/A. |

### 1.6 `admin-portal` (port 3008)

| Property | Value |
|---|---|
| **Source** | `mini-services/admin-portal/index.ts` |
| **Dependencies** | None. |
| **Stateful?** | **NO** — pure HTTP proxy. Identical structure to `consumer-portal` + `vendor-portal`. |
| **Long-lived connection?** | **NO**. |
| **Env vars required** | None. Hardcoded `NEXTJS_URL = 'http://localhost:3000'`. |
| **Vercel serverless eligible?** | **REDUNDANT on Vercel** — `/admin` is a Next.js route (`src/app/admin/page.tsx`). |
| **Docker containerization status** | **NONE**. |
| **Recommended platform** | **DO NOT DEPLOY** — retire on Vercel. Phase 3 follow-up #12. |
| **Recommended region** | N/A. |

---

## 2. Summary matrix

| Service | Port | Stateful? | Long-lived conn? | Vercel-eligible? | Production platform | Container status |
|---|---|---|---|---|---|---|
| `realtime` | 3003 | YES | YES (WebSocket) | NO | Fly.io (`nrt`) | None — needs Dockerfile |
| `alert-evaluator` | 3005 | YES (in-memory cooldown) | NO (setInterval loop) | NO | Fly.io (`nrt`) | None — needs Dockerfile |
| `backup-scheduler` | 3004 | NO (filesystem state) | NO (setInterval loop) | PARTIAL — needs `pg_dump` rewrite | **Vercel Cron** (preferred) or Fly.io | None — needs Dockerfile if Fly.io |
| `consumer-portal` | 3006 | NO | NO | REDUNDANT | Retire on Vercel | N/A |
| `vendor-portal` | 3007 | NO | NO | REDUNDANT | Retire on Vercel | N/A |
| `admin-portal` | 3008 | NO | NO | REDUNDANT | Retire on Vercel | N/A |

---

## 3. Recommended hosting topology

```
                          ┌──────────────────────────────────┐
                          │       Supabase (managed)          │
                          │   PostgreSQL + Auth + Storage     │
                          │   region: ap-northeast-1 (Tokyo)   │
                          │   project-ref: <project-ref>      │
                          └────────────┬─────────────────────┬┘
                                       │                     │
                                       │                     │
                Transaction Pooler     │                     │   Session Pooler
                (port 6543)            │                     │   (port 5432)
                role: snakzap_app      │                     │   role: snakzap_app
                                       │                     │
                                       │                     │
                ┌──────────────────────┴─┐         ┌──────────┴───────────┐
                │                        │         │                      │
                │   Vercel (Next.js)     │         │   Fly.io              │
                │   region: hnd1 (Tokyo)│         │   region: nrt (Tokyo) │
                │                        │         │                      │
                │   • Main Next.js app   │         │   • realtime (3003)   │
                │   • /consumer          │         │     socket.io Server  │
                │   • /vendor            │         │                      │
                │   • /admin             │         │   • alert-evaluator   │
                │   • /api/*            │         │     (3005)            │
                │                        │         │     PrismaClient      │
                │   Vercel Cron:         │         │                      │
                │   • backup (pg_dump    │         └──────────────────────┘
                │     → Supabase Storage)│
                └───────────┬────────────┘
                            │
                            │ socket.io-client (server-side)
                            │ to Fly.io realtime URL
                            │
                            ▼
                    ┌─────── Fly.io realtime ────┐
                    │   fans out events to       │
                    │   browser clients          │
                    └────────────────────────────┘
```

### 3.1 Why this topology

1. **Vercel hosts the Next.js app + 3 portal routes natively.** The 3 portal shims (`consumer-portal`, `vendor-portal`, `admin-portal`) are redundant — Vercel handles `/consumer`, `/vendor`, `/admin` path routing without a proxy.
2. **Fly.io hosts the 2 long-lived services** (`realtime`, `alert-evaluator`). Both need a persistent process — Vercel serverless cannot satisfy this. Fly.io's `nrt` region is in Tokyo, same metro as Supabase `ap-northeast-1` and Vercel `hnd1` (Tokyo). All three are in the same AWS ap-northeast-1 region or close to it, giving <5ms RTT between Vercel ↔ Supabase ↔ Fly.io.
3. **Vercel Cron hosts the backup job** (after `pg_dump` rewrite per `BACKUP_REPLACEMENT_PLAN.md`). This avoids needing a 3rd Fly.io service for what is fundamentally a periodic task.
4. **Supabase is the single source of truth for DB + auth + storage.** The Transaction Pooler (6543) is for Vercel serverless (connection multiplexing). The Session Pooler (5432) is for Fly.io long-lived processes (connection reuse).

### 3.2 Network reachability

| From → To | Path | Auth |
|---|---|---|
| Browser → Vercel | HTTPS | TLS (Vercel-managed cert) |
| Browser → Fly.io realtime | HTTPS/WSS | TLS (Fly.io-managed cert). Note: requires CORS config (`cors: { origin: 'https://snakzap.vercel.app' }` — currently `origin: '*'` in `mini-services/realtime/index.ts:28`, MUST be tightened for production). |
| Vercel serverless → Supabase Transaction Pooler | HTTPS/TLS (port 6543 TLS) | Database password (role `snakzap_app`) |
| Fly.io alert-evaluator → Supabase Session Pooler | HTTPS/TLS (port 5432 TLS) | Database password (role `snakzap_app`) |
| Vercel serverless → Fly.io realtime | HTTP (port 80) — `socket.io-client` connects to `https://realtime-snakzap.fly.dev` | None (the socket.io protocol is unauthenticated; access control is via CORS origin check). |
| Vercel Cron (backup) → Supabase pg_dump | TCP 5432 (Session Pooler, role `snakzap_admin` for pg_dump) | Database password (role `snakzap_admin`). Note: the cron function is the migration runner exception — it can use `snakzap_admin` because it's a trusted serverless function with no user-facing surface. |
| Vercel Cron (backup) → Supabase Storage | HTTPS | Supabase service-role key (server-only). |

### 3.3 CORS hardening (Phase 3 follow-up)

`mini-services/realtime/index.ts:28` currently allows all origins:

```typescript
cors: { origin: '*', methods: ['GET', 'POST'] },
```

For production, this MUST be tightened to:

```typescript
cors: {
  origin: (origin, cb) => {
    const allowed = ['https://snakzap.vercel.app', 'https://snakzap-staging.vercel.app'];
    if (!origin || allowed.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
},
```

**Flagged as Phase 3 follow-up** — not blocking Phase 2 staging (staging URL is unknown until Vercel project is provisioned).

---

## 4. Dockerfile requirements (for the 2 Fly.io services)

Neither `realtime` nor `alert-evaluator` has a `Dockerfile` today. For Fly.io deployment, each needs one. Below are the recommended shapes (NOT created as files — documentation only).

### 4.1 `mini-services/realtime/Dockerfile` (recommended shape)

```dockerfile
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock* index.ts ./
RUN bun install --frozen-lockfile --production
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3003/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "index.ts"]
```

### 4.2 `mini-services/alert-evaluator/Dockerfile` (recommended shape)

```dockerfile
FROM oven/bun:1-slim
WORKDIR /app
# Copy Prisma schema + generated client (must be generated at build time)
COPY package.json bun.lock* index.ts ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile --production
RUN bunx prisma generate
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3005/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "index.ts"]
```

**Note:** `alert-evaluator`'s `package.json` only lists `@prisma/client` as a dependency — it does NOT list `prisma` (the CLI). The `RUN bunx prisma generate` step uses `bunx` to fetch the CLI on-demand. Alternative: add `prisma` to `devDependencies` and run `bun run db:generate`.

### 4.3 Prisma client sharing concern

`alert-evaluator` imports `@prisma/client` from its own `node_modules`. This means the Prisma client is generated PER mini-service. After the `prisma/schema.prisma` provider switch (Step 7 of `POSTGRESQL_CUTOVER_PLAN.md`), the `alert-evaluator`'s build pipeline must regenerate the client against the PostgreSQL schema. The Dockerfile's `RUN bunx prisma generate` handles this.

---

## 5. Fly.io-specific configuration (documentation only)

### 5.1 `fly.toml` for `realtime` (recommended shape)

```toml
app = "snakzap-realtime"
primary_region = "nrt"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3003
  force_https = true
  auto_stop_machines = false   # MUST stay running — WebSocket clients depend on it
  auto_start_machines = false
  min_machines_running = 1     # Always-on

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/"
  timeout = "5s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

### 5.2 `fly.toml` for `alert-evaluator` (recommended shape)

```toml
app = "snakzap-alert-evaluator"
primary_region = "nrt"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3005
  force_https = true
  auto_stop_machines = false
  auto_start_machines = false
  min_machines_running = 1

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/health"
  timeout = "5s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"

[env]
  ALERT_INTERVAL_MS = "60000"
  DATABASE_URL = "postgresql://snakzap_app:<app-password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

### 5.3 Secrets on Fly.io

Both services need `DATABASE_URL` set as a Fly.io secret (for `alert-evaluator`):

```bash
fly secrets set DATABASE_URL="postgresql://snakzap_app:<app-password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" --app snakzap-alert-evaluator
```

`realtime` currently needs NO secrets (it doesn't touch the DB).

---

## 6. Estimated hosting cost (monthly)

| Service | Platform | Estimated cost / month |
|---|---|---|
| Next.js main app | Vercel Hobby (or Pro if needed) | $0 (Hobby) — $20 (Pro) |
| `realtime` (Fly.io) | shared-cpu-1x, 512MB, always-on | ~$2-3 |
| `alert-evaluator` (Fly.io) | shared-cpu-1x, 512MB, always-on | ~$2-3 |
| `backup-scheduler` (Vercel Cron) | Vercel Hobby (1 cron allowed on Hobby) | $0 |
| Supabase (existing project) | Free tier or Pro | $0 (Free) — $25 (Pro) |
| **Total Phase 2 staging** | | **~$0-25/month** |

Three portal shims (`consumer-portal`, `vendor-portal`, `admin-portal`) cost $0 because they are NOT deployed (retired on Vercel).

---

## 7. What this design does NOT do

Per the task constraints (FORBIDDEN list):

- ❌ Does NOT provision Fly.io or Railway.
- ❌ Does NOT provision S3.
- ❌ Does NOT create Dockerfiles for mini-services (only recommends their shape).
- ❌ Does NOT modify any mini-service source code.
- ❌ Does NOT commit or push.
- ❌ Does NOT execute any external API call.

This is documentation only. The Orchestrator can use this design as a runbook to provision the 2 Fly.io services + Vercel Cron at production cutover time.
