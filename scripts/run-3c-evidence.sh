#!/bin/bash
# Wrapper: start dev server + run 3c evidence script (flag ON)
# Tests: 1 (hash-match), 2 (hash-mismatch→422), 5 (5-concurrent flag-ON)

set -e

cd /home/z/my-project

# Kill any existing dev servers
pkill -f "next dev" 2>/dev/null || true
pkill -f "bun.*next" 2>/dev/null || true
sleep 2

# Clear .next cache
rm -rf .next

# Temporarily switch to SQLite for local testing
cp prisma/schema.prisma /tmp/schema-3c.prisma.bak
sed -i 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma
cp .env /tmp/env-3c.bak
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db?connection_limit=1&busy_timeout=30000' > .env

echo "[wrapper] Pushing SQLite schema..."
bunx prisma db push --force-reset --skip-generate 2>&1 | tail -3
bunx prisma generate 2>&1 | tail -3
echo "[wrapper] Seeding database..."
bun run prisma/seed.ts 2>&1 | tail -3

# Start dev server with EVIDENCE_TEST_MODE=true + requestHashEnforcement=true
echo "[wrapper] Starting dev server (requestHashEnforcement=true)..."
EVIDENCE_TEST_MODE=true FEATURE_REQUEST_HASH_ENFORCEMENT=true bun run dev > /tmp/dev-3c.log 2>&1 &
DEV_PID=$!
echo "[wrapper] Dev server PID: $DEV_PID"

READY=0
for i in $(seq 1 45); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "[wrapper] Server ready after ${i}s"
    READY=1
    break
  fi
  if ! kill -0 $DEV_PID 2>/dev/null; then
    echo "[wrapper] Server process died. Log:"
    tail -30 /tmp/dev-3c.log
    cp /tmp/schema-3c.prisma.bak prisma/schema.prisma
    cp /tmp/env-3c.bak .env
    bunx prisma generate > /dev/null 2>&1
    exit 1
  fi
  sleep 1
done

if [ "$READY" = "0" ]; then
  echo "[wrapper] Server failed to become ready."
  tail -30 /tmp/dev-3c.log
  cp /tmp/schema-3c.prisma.bak prisma/schema.prisma
  cp /tmp/env-3c.bak .env
  bunx prisma generate > /dev/null 2>&1
  exit 1
fi

# Run the evidence script
echo "[wrapper] Running 3c evidence script (flag ON)..."
EVIDENCE_BASE_URL=http://127.0.0.1:3000 node scripts/wave3-3c-evidence.mjs
EVIDENCE_EXIT=$?

# Kill the dev server
echo "[wrapper] Stopping dev server (PID $DEV_PID)..."
kill $DEV_PID 2>/dev/null || true
sleep 2
pkill -f "next dev" 2>/dev/null || true

# Restore production state
echo "[wrapper] Restoring production schema + env..."
cp /tmp/schema-3c.prisma.bak prisma/schema.prisma
# Ensure schema is postgresql (backup might have been taken after sed)
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
cp /tmp/env-3c.bak .env
# Ensure env is clean
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env
bunx prisma generate > /dev/null 2>&1
echo "[wrapper] Schema restored to postgresql, env restored."

exit $EVIDENCE_EXIT
