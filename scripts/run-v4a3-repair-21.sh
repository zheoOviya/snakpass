#!/usr/bin/env bash
# Orchestrator: keeps dev server alive across V4A3 evidence phases.
# Restarts the server if it dies between phases, then runs the next phase.
set -u
cd /home/z/my-project
LOG=/home/z/my-project/dev.log
OUTDIR=/home/z/my-project/evidence/v4a3-consumer-authz-repair-21
mkdir -p "$OUTDIR"

start_server() {
  pkill -f "next dev" 2>/dev/null
  pkill -f "bun run dev" 2>/dev/null
  sleep 2
  : > "$LOG"
  nohup bun run dev > "$LOG" 2>&1 &
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -q "200"; then
      echo "  server ready after ${i}s"; return 0
    fi
    sleep 1
  done
  echo "  server FAILED to start"; return 1
}

server_alive() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null | grep -q "200"
}

warmup() {
  timeout 40 bun scripts/_warmup.mjs 2>&1 | grep -vE "^prisma:query" | grep -E "^warm"
}

run_phase() {
  local ph="$1"
  echo "=== running phase $ph ==="
  if ! server_alive; then
    echo "  server dead before $ph — restarting..."
    start_server || return 1
    sleep 2
    warmup || true
  fi
  timeout 120 bun scripts/v4a3-consumer-authz-repair-21.mjs "$ph" 2>&1 | grep -vE "^prisma:query" | tee "$OUTDIR/phase-${ph}.txt"
  if ! server_alive; then
    echo "  [warn] server died during $ph (output saved)"
  fi
}

echo "# V4A3-REPAIR-21 evidence orchestrator"
echo "# baseline=2adc9c8952b8c7c449e4e508d4d93a3a21d92dd0"

start_server || exit 1
sleep 2
echo "--- warming up routes (compile repaired code) ---"
warmup || true

for ph in p5 p6 p7 p8 p9 p10 p11; do
  run_phase "$ph"
  sleep 2
done

echo ""
echo "# All phases run. Outputs in $OUTDIR/phase-*.txt"
