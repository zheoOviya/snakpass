# Fly.io Dockerfile for alert-evaluator
# Port: 3005
# Region: nrt (Tokyo — co-located with Supabase ap-northeast-1 + Vercel hnd1)
FROM oven/bun:1 AS base
WORKDIR /app

# Copy package.json + install deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source (mini-service + shared lib)
COPY mini-services/alert-evaluator/index.ts ./
COPY src/lib/ ./src/lib/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN bunx prisma generate

# Expose port
ENV PORT=3005
EXPOSE 3005

# Health check (service must have a GET / endpoint returning 200)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3005/ || exit 1

# Run the service
CMD ["bun", "run", "index.ts"]
