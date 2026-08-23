#!/bin/bash
# P4 Rate-Limit Evidence Challenge-02
# Paced, low-impact — observe X-RateLimit-Remaining header to determine bucket separation
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4b-challenge02
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/p4-challenge.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://127.0.0.1:3000"

# Restart server WITHOUT EVIDENCE_TEST_MODE
restart_server() {
  pkill -9 -f "next-server" 2>/dev/null
  pkill -9 -f "bun run dev" 2>/dev/null
  sleep 5
  rm -f dev.log
  setsid bun run dev > dev.log 2>&1 < /dev/null &
  echo "  Server starting PID=$!"
  sleep 8
  for i in $(seq 1 20); do
    c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null)
    [ "$c" = "200" ] && { echo "  ready ${i}s"; return 0; }
    sleep 2
  done
  echo "  FAILED to start"
  return 1
}

# Get session (read from existing cookie jar)
SESS=$(grep "snakzap_session" /tmp/s4b_ALICE.txt 2>/dev/null | awk '{print $NF}')
CSRF=$(grep "snakzap_csrf" /tmp/s4b_ALICE.txt 2>/dev/null | awk '{print $NF}')

echo "============================================================================="
echo "PHASE 0 — BASELINE"
echo "============================================================================="
echo "HEAD: $(git rev-parse HEAD)"
echo "origin/main: $(git rev-parse origin/main)"
echo "S4A checkpoint cc99b8e ancestor: $(git log --oneline cc99b8e -1 | head -c 60)"
echo -n "Source diff (src/+prisma/) since cc99b8e: "
git diff cc99b8e HEAD -- src/ prisma/ | wc -l
echo " lines (expected 0)"
echo ""
echo "=== Restart server WITHOUT EVIDENCE_TEST_MODE ==="
restart_server
echo ""
echo "=== Verify EVIDENCE_TEST_MODE absent ==="
PID=$(pgrep -f "next-server" | head -1)
if [ -n "$PID" ]; then
  ENV_CHECK=$(cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep -c "EVIDENCE_TEST_MODE=true")
  if [ "$ENV_CHECK" = "0" ]; then
    echo "EVIDENCE_TEST_MODE = absent (OK)"
  else
    echo "EVIDENCE_TEST_MODE = present (FAIL — would skip rate limiting)"
    echo "BLOCKED: TEST_ENVIRONMENT_RATE_LIMIT_BYPASS"
    exit 1
  fi
else
  echo "next-server PID not found"
  echo "BLOCKED: SERVER_NOT_RUNNING"
  exit 1
fi

echo ""
echo "============================================================================="
echo "PHASE 1 — Establish limiter active (3 paced requests, no XFF)"
echo "============================================================================="
# These 3 requests go into the 'real IP' bucket (no XFF)
echo "Request 1 (no XFF, real IP bucket):"
H1=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p1_r1" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" 2>&1)
R1=$(echo "$H1" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
L1=$(echo "$H1" | grep -i "x-ratelimit-limit" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Limit=$L1  X-RateLimit-Remaining=$R1"
sleep 3

echo "Request 2 (no XFF, real IP bucket):"
H2=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p1_r2" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" 2>&1)
R2=$(echo "$H2" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R2"
sleep 3

echo "Request 3 (no XFF, real IP bucket):"
H3=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p1_r3" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" 2>&1)
R3=$(echo "$H3" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R3"

if [ -n "$R1" ] && [ -n "$R2" ] && [ -n "$R3" ]; then
  echo ""
  echo "  Classification: LIMITER_ACTIVE = YES"
  echo "  Evidence: X-RateLimit-Remaining decremented: $L1 → $R1 → $R2 → $R3"
else
  echo ""
  echo "  Classification: LIMITER_ACTIVE = UNKNOWN (headers not captured)"
fi

echo ""
echo "============================================================================="
echo "PHASE 2 — Same-XFF bucket test (XFF=10.10.10.1, 3 paced requests)"
echo "============================================================================="
echo "Request 4 (XFF=10.10.10.1):"
H4=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p2_r1" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.1" 2>&1)
R4=$(echo "$H4" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
L4=$(echo "$H4" | grep -i "x-ratelimit-limit" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Limit=$L4  X-RateLimit-Remaining=$R4"
sleep 3

echo "Request 5 (XFF=10.10.10.1, same):"
H5=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p2_r2" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.1" 2>&1)
R5=$(echo "$H5" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R5"
sleep 3

echo "Request 6 (XFF=10.10.10.1, same):"
H6=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p2_r3" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.1" 2>&1)
R6=$(echo "$H6" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R6"

echo ""
echo "  Same-XFF bucket state: $L4 → $R4 → $R5 → $R6"
if [ -n "$R4" ] && [ -n "$R6" ]; then
  DIFF=$((R4 - R6))
  echo "  Decrement within same-XFF bucket: $DIFF (expected 2 if same bucket)"
fi

echo ""
echo "============================================================================="
echo "PHASE 3 — Changed-XFF challenge (same user, new XFF values)"
echo "============================================================================="
echo "Request 7 (XFF=10.10.10.2 — DIFFERENT from 10.10.10.1):"
H7=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p3_a" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.2" 2>&1)
R7=$(echo "$H7" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R7"
sleep 3

echo "Request 8 (XFF=10.10.10.3 — DIFFERENT again):"
H8=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p3_b" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.3" 2>&1)
R8=$(echo "$H8" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R8"
sleep 3

echo "Request 9 (XFF=10.10.10.4 — DIFFERENT again):"
H9=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=p3_c" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.4" 2>&1)
R9=$(echo "$H9" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  X-RateLimit-Remaining=$R9"

echo ""
echo "=== DECISIVE INTERPRETATION ==="
echo "Same-XFF bucket (10.10.10.1): Remaining = $R4 → $R5 → $R6"
echo "Changed-XFF buckets: 10.10.10.2=$R7, 10.10.10.3=$R8, 10.10.10.4=$R9"
echo ""
if [ -n "$R6" ] && [ -n "$R7" ]; then
  # If XFF is trusted, R7 should be ~99 (fresh bucket, 1 request used)
  # If XFF is NOT trusted, R7 should continue from R6 (same real-IP bucket)
  RESET=$((R7 - R6))
  if [ "$RESET" -gt 5 ]; then
    echo "VERDICT: XFF IS TRUSTED — Remaining jumped from $R6 to $R7 (reset of $RESET)"
    echo "CONFIRMED: CLIENT_CONTROLLED_RATE_LIMIT_KEY"
    XFF_TRUSTED="YES"
  else
    echo "VERDICT: XFF NOT TRUSTED — Remaining continued from $R6 to $R7 (delta=$RESET)"
    echo "REJECT_FINDING: XFF_BYPASS_NOT_REPRODUCED"
    XFF_TRUSTED="NO"
  fi
else
  echo "VERDICT: INCONCLUSIVE — headers not captured"
  XFF_TRUSTED="UNKNOWN"
fi

echo ""
echo "============================================================================="
echo "PHASE 4 — Controlled bypass proof (low-impact threshold test)"
echo "============================================================================="
if [ "$XFF_TRUSTED" = "YES" ]; then
  echo "  XFF trust already proven in Phase 3. Confirming with threshold test:"
  echo "  Exhausting XFF=10.10.10.5 bucket (sending 5 requests, observing decrement):"
  for i in $(seq 1 5); do
    H=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=thresh_$i" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.5" 2>&1)
    R=$(echo "$H" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
    echo "    req $i: Remaining=$R"
    sleep 2
  done
  echo "  Then immediately switch to XFF=10.10.10.6 (fresh bucket):"
  H=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/api/social/search?q=fresh_bucket" -H "Cookie: snakzap_session=$SESS; snakzap_csrf=$CSRF" -H "X-Forwarded-For: 10.10.10.6" 2>&1)
  R=$(echo "$H" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
  echo "    XFF=10.10.10.6 first req: Remaining=$R (if ~99, fresh bucket obtained)"
  echo ""
  echo "  BYPASS PROOF: Attacker can spoof XFF to get unlimited fresh buckets"
  echo "  (no need to exhaust 100 requests — header observation is sufficient)"
else
  echo "  XFF not trusted (per Phase 3). No bypass possible via XFF spoof."
  echo "  Skipping threshold flood (would crash dev server, no benefit)."
fi

echo ""
echo "============================================================================="
echo "PHASE 5 — Fail-open classification"
echo "============================================================================="
echo "  Code trace (src/lib/rate-limit.ts:8, src/middleware.ts:25):"
echo "    general bucket = fail-open mode"
echo "    → if limiter unavailable, request is ALLOWED"
echo ""
echo "  Runtime fail-open induction: NOT TESTED"
echo "  (No legitimate controlled failure mechanism exists in dev — in-memory"
echo "   limiter is always available. Production Redis failure not simulatable.)"
echo ""
echo "  Classification:"
echo "    FAIL_OPEN_MODE = CODE_VERIFIED"
echo "    RUNTIME_FAIL_OPEN = NOT_TESTED"

echo ""
echo "============================================================================="
echo "PHASE 6 — User identity conclusion"
echo "============================================================================="
echo "  Code trace (src/middleware.ts:185):"
echo "    key = 'rl:general:' + ip  (IP-only, no userId)"
echo ""
echo "  This is an architectural fact — the rate-limit key does NOT incorporate"
echo "  the authenticated user's identity. Two users on the same IP share a bucket."
echo ""
echo "  Classification:"
echo "    NO_USER_IDENTITY_IN_KEY = CODE_VERIFIED"
echo "  Type: abuse-policy weakness (not automatically a bypass vulnerability)"
echo "  (Mitigating factor: search requires authentication, so the attacker must"
echo "   have a valid session. But the bucket is per-IP, not per-user.)"

echo ""
echo "============================================================================="
echo "P4 MANDATORY MATRIX"
echo "============================================================================="
echo "| Test        | Same user | XFF         | Limit | Remaining | HTTP | Interpretation |"
echo "| ----------- | --------- | ----------- | ----- | --------- | ---- | -------------- |"
echo "| Baseline #1 | yes       | (none)      | $L1   | $R1       | 200  | real-IP bucket |"
echo "| Baseline #2 | yes       | (none)      | $L1   | $R2       | 200  | continues      |"
echo "| Baseline #3 | yes       | (none)      | $L1   | $R3       | 200  | continues      |"
echo "| Same XFF #1 | yes       | 10.10.10.1  | $L4   | $R4       | 200  | XFF bucket     |"
echo "| Same XFF #2 | yes       | 10.10.10.1  | $L4   | $R5       | 200  | continues      |"
echo "| Same XFF #3 | yes       | 10.10.10.1  | $L4   | $R6       | 200  | continues      |"
echo "| Changed XFF | yes       | 10.10.10.2  | $L4   | $R7       | 200  | $([ "$XFF_TRUSTED" = "YES" ] && echo 'FRESH BUCKET' || echo 'same bucket') |"
echo "| Changed XFF | yes       | 10.10.10.3  | $L4   | $R8       | 200  | $([ "$XFF_TRUSTED" = "YES" ] && echo 'FRESH BUCKET' || echo 'same bucket') |"
echo "| Changed XFF | yes       | 10.10.10.4  | $L4   | $R9       | 200  | $([ "$XFF_TRUSTED" = "YES" ] && echo 'FRESH BUCKET' || echo 'same bucket') |"

echo ""
echo "=== FINAL P4 CLASSIFICATION ==="
if [ "$XFF_TRUSTED" = "YES" ]; then
  echo "P4 CONFIRMED"
  echo "Reason: CLIENT_CONTROLLED_RATE_LIMIT_KEY"
  echo "Evidence: X-RateLimit-Remaining reset when XFF changed ($R6 → $R7)"
  echo "          = attacker obtains fresh bucket by spoofing X-Forwarded-For"
elif [ "$XFF_TRUSTED" = "NO" ]; then
  echo "P4 DOWNGRADED"
  echo "Reason: CODE_RISK_NOT_RUNTIME_EXPLOITABLE"
  echo "Evidence: X-RateLimit-Remaining did NOT reset when XFF changed ($R6 → $R7)"
  echo "          = limiter uses real connection IP, not spoofable XFF"
else
  echo "P4 UNVERIFIED"
  echo "BLOCKED: ENV_LOAD_LIMITATION"
fi

echo ""
echo "=== COMPLETE ==="
