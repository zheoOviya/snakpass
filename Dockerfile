# P0-27 — Dockerfile for SnakZap Next.js app
# Multi-stage build: install deps → build → minimal runtime image.
#
# This is part of P0-27 closure (containerization for reproducible deploys).
# Full P0-27 closure additionally requires:
#   - CI/CD pipeline (see .github/workflows/ci.yml) ✅
#   - Deployment target (staging + production) — OPEN
#   - Rollback drill with ≤10min evidence — OPEN

# ----- Stage 1: deps -----
FROM oven/bun:1 AS deps
WORKDIR /app

# Copy lockfile + package.json first for cache
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production=false

# ----- Stage 2: build -----
FROM oven/bun:1 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ----- Stage 3: runtime -----
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Copy built artifacts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Create db directory (SQLite will be created on first run via prisma migrate)
RUN mkdir -p /app/db && chown nextjs:nodejs /app/db

USER nextjs

EXPOSE 3000

# Healthcheck (P0-20 endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "start"]
