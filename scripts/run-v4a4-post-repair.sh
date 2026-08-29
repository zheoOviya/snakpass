#!/usr/bin/env bash
# Orchestrator for V4A4 post-repair evidence phases.
set -u
cd /home/z/my-project
LOG=dev.log
OUTDIR=evidence/v4a4-otp-reissue-invalidation-24
mkdir -p "$OUTDIR"

start_server() {
  pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 2
  : > "$LOG"
  nohup bun run dev > "$LOG" 2>&1 &
  for i in $(seq 1 30); do
    curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -q "200" && { echo "  server ready ${i}s"; return 0; }
    sleep 1
  done
  echo "  server FAILED"; return 1
}
server_alive() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null | grep -q "200"; }
warmup() { timeout 40 bun scripts/_warmup.mjs 2>&1 | grep -E "^warm"; }

run_phase() {
  local ph="$1"
  echo "=== phase $ph ==="
  if ! server_alive; then
    echo "  server dead — restarting..."
    start_server || return 1; sleep 2; warmup || true
  fi
  timeout 150 bun scripts/v4a4-post-repair.mjs "$ph" 2>&1 | grep -vE "^prisma:query" | tee "$OUTDIR/phase-${ph}.txt"
}

echo "# V4A4 post-repair evidence orchestrator"
echo "# baseline=5f2f71ecf2b99cb25e6de22ee942ef420df25128"
start_server || exit 1; sleep 2; warmup || true

for ph in p4 p5 p6 p7 p8 p9 p10 p11 p12 p13; do
  run_phase "$ph"; sleep 2
done
echo ""; echo "# Done. Outputs in $OUTDIR/"
