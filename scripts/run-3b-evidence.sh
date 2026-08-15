#!/bin/bash
# Wrapper: start dev server + run 3b evidence script, all in one process group.
# The sandbox kills background processes when the bash tool call ends,
# so we keep everything alive within a single bash invocation.

set -e

cd /home/z/my-project

# Kill any existing dev servers
pkill -f "next dev" 2>/dev/null || true
pkill -f "bun.*next" 2>/dev/null || true
sleep 2

# Clear .next cache (to ensure evidence endpoints are picked up)
rm -rf .next

# Start dev server with EVIDENCE_TEST_MODE=true + SQLite for local testing
echo "[wrapper] Switching to SQLite for local evidence run..."
# Temporarily switch provider to sqlite for local testing
cp prisma/schema.prisma /tmp/schema.prisma.bak
sed -i 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma
# Temporarily set connection params for SQLite concurrency
cp .env /tmp/env.bak
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db?connection_limit=1&busy_timeout=30000' > .env

echo "[wrapper] Pushing SQLite schema..."
bunx prisma db push --force-reset --skip-generate 2>&1 | tail -3
bunx prisma generate 2>&1 | tail -3
echo "[wrapper] Seeding database..."
bun run prisma/seed.ts 2>&1 | tail -3

# Start dev server with EVIDENCE_TEST_MODE=true
echo "[wrapper] Starting dev server..."
EVIDENCE_TEST_MODE=true bun run dev > /tmp/dev-3b-evidence.log 2>&1 &
DEV_PID=$!
echo "[wrapper] Dev server PID: $DEV_PID"

# Wait for server to be ready
READY=0
for i in $(seq 1 45); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "[wrapper] Server ready after ${i}s"
    READY=1
    break
  fi
  if ! kill -0 $DEV_PID 2>/dev/null; then
    echo "[wrapper] Server process died during startup. Log:"
    tail -30 /tmp/dev-3b-evidence.log
    # Restore schema
    cp /tmp/schema.prisma.bak prisma/schema.prisma
    cp /tmp/env.bak .env
    bunx prisma generate > /dev/null 2>&1
    exit 1
  fi
  sleep 1
done

if [ "$READY" = "0" ]; then
  echo "[wrapper] Server failed to become ready. Log:"
  tail -30 /tmp/dev-3b-evidence.log
  # Restore schema
  cp /tmp/schema.prisma.bak prisma/schema.prisma
  cp /tmp/env.bak .env
  bunx prisma generate > /dev/null 2>&1
  exit 1
fi

# Run the evidence script
echo "[wrapper] Running 3b evidence script..."
EVIDENCE_BASE_URL=http://127.0.0.1:3000 node scripts/wave3-3b-evidence.mjs
EVIDENCE_EXIT=$?

# Kill the dev server
echo "[wrapper] Stopping dev server (PID $DEV_PID)..."
kill $DEV_PID 2>/dev/null || true
sleep 1
pkill -f "next dev" 2>/dev/null || true

# Restore schema + env (production state)
echo "[wrapper] Restoring production schema + env..."
cp /tmp/schema.prisma.bak prisma/schema.prisma
cp /tmp/env.bak .env
bunx prisma generate > /dev/null 2>&1
echo "[wrapper] Schema restored to postgresql, env restored."

exit $EVIDENCE_EXIT
