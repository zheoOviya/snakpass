#!/bin/bash
# Wrapper: start dev server + run evidence script, all in one process group.
# The sandbox kills background processes when the bash tool call ends,
# so we keep everything alive within a single bash invocation.

set -e

cd /home/z/my-project

# Kill any existing dev servers
pkill -f "next dev" 2>/dev/null || true
pkill -f "bun.*next" 2>/dev/null || true
sleep 2

# Start dev server with EVIDENCE_TEST_MODE=true
echo "[wrapper] Starting dev server..."
EVIDENCE_TEST_MODE=true bun run dev > /tmp/dev-evidence.log 2>&1 &
DEV_PID=$!
echo "[wrapper] Dev server PID: $DEV_PID"

# Wait for server to be ready (up to 45s)
READY=0
for i in $(seq 1 45); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "[wrapper] Server ready after ${i}s"
    READY=1
    break
  fi
  # Check if server process is still alive
  if ! kill -0 $DEV_PID 2>/dev/null; then
    echo "[wrapper] Server process died during startup. Log:"
    tail -30 /tmp/dev-evidence.log
    exit 1
  fi
  sleep 1
done

if [ "$READY" = "0" ]; then
  echo "[wrapper] Server failed to become ready. Log:"
  tail -30 /tmp/dev-evidence.log
  exit 1
fi

# Run the evidence script
echo "[wrapper] Running evidence script..."
EVIDENCE_BASE_URL=http://127.0.0.1:3000 node scripts/wave3-3a-evidence.mjs
EVIDENCE_EXIT=$?

# Kill the dev server
echo "[wrapper] Stopping dev server (PID $DEV_PID)..."
kill $DEV_PID 2>/dev/null || true
sleep 1
pkill -f "next dev" 2>/dev/null || true

exit $EVIDENCE_EXIT
