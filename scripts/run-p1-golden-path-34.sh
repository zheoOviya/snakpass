#!/usr/bin/env bash
set -u
cd /home/z/my-project
LOG=dev.log
OUTDIR=evidence/p1-golden-path-34
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
  if ! server_alive; then start_server || return 1; sleep 2; warmup || true; fi
  timeout 90 bun scripts/p1-golden-path-34.mjs "$ph" 2>&1 | grep -vE "^prisma:query" | tee "$OUTDIR/phase-${ph}.txt"
}

echo "# P1 golden path evidence orchestrator"
echo "# baseline=29390cae781cf523f01c914d3ad1cb86d52dfcba"
start_server || exit 1; sleep 2; warmup || true

for ph in p2 p3 p5 p6 p7 p8 p12; do
  run_phase "$ph"; sleep 3
done
echo ""; echo "# Done. Outputs in $OUTDIR/"
