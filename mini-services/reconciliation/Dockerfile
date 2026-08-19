# Fly.io Dockerfile for reconciliation
# Port: 3010
# Region: nrt (Tokyo — co-located with Supabase ap-northeast-1 + Vercel hnd1)
FROM oven/bun:1 AS base
WORKDIR /app

# Copy package.json + install deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source (mini-service + shared lib)
COPY mini-services/reconciliation/index.ts ./
COPY src/lib/ ./src/lib/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN bunx prisma generate

# Expose port
ENV PORT=3010
EXPOSE 3010

# Health check (service must have a GET / endpoint returning 200)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3010/ || exit 1

# Run the service
CMD ["bun", "run", "index.ts"]
