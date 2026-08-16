#!/bin/bash
set -e
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null || true
pkill -f "bun.*next" 2>/dev/null || true
sleep 2
rm -rf .next

cp prisma/schema.prisma /tmp/schema-4cE5.prisma.bak
sed -i 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma
cp .env /tmp/env-4cE5.bak
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db?connection_limit=1&busy_timeout=30000' > .env

echo "[wrapper] Pushing SQLite schema..."
bunx prisma db push --force-reset --skip-generate 2>&1 | tail -3
bunx prisma generate 2>&1 | tail -3
echo "[wrapper] Seeding..."
bun run prisma/seed.ts 2>&1 | tail -3

echo "[wrapper] Starting dev server (EVIDENCE_TEST_MODE=true)..."
EVIDENCE_TEST_MODE=true bun run dev > /tmp/dev-4cE5.log 2>&1 &
DEV_PID=$!

READY=0
for i in $(seq 1 45); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then echo "[wrapper] Server ready after ${i}s"; READY=1; break; fi
  if ! kill -0 $DEV_PID 2>/dev/null; then echo "[wrapper] Server died"; tail -30 /tmp/dev-4cE5.log; cp /tmp/schema-4cE5.prisma.bak prisma/schema.prisma; sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma; cp /tmp/env-4cE5.bak .env; echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env; bunx prisma generate > /dev/null 2>&1; exit 1; fi
  sleep 1
done

if [ "$READY" = "0" ]; then echo "[wrapper] Failed"; tail -30 /tmp/dev-4cE5.log; cp /tmp/schema-4cE5.prisma.bak prisma/schema.prisma; sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma; cp /tmp/env-4cE5.bak .env; echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env; bunx prisma generate > /dev/null 2>&1; exit 1; fi

echo "[wrapper] Running 4c-E5 evidence script..."
EVIDENCE_BASE_URL=http://127.0.0.1:3000 node scripts/wave4-4c-evidence-e5.mjs
EVIDENCE_EXIT=$?

echo "[wrapper] Stopping dev server..."
kill $DEV_PID 2>/dev/null || true
sleep 2
pkill -f "next dev" 2>/dev/null || true

echo "[wrapper] Restoring production state..."
cp /tmp/schema-4cE5.prisma.bak prisma/schema.prisma
sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
cp /tmp/env-4cE5.bak .env
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env
bunx prisma generate > /dev/null 2>&1
echo "[wrapper] Done."
exit $EVIDENCE_EXIT
