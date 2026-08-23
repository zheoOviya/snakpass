#!/bin/bash
# S4B Privacy/Abuse Challenge — P1/P2/P3/P4 runtime tests
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4b-challenge01
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4b-challenge.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://localhost:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"

dbq() {
  cat > /tmp/s4bq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
  bun /tmp/s4bq.mjs 2>&1 | grep -v "^prisma" | grep -v "^Bun "
}

api_login() {
  local PHONE=$1; local TAG=$2
  bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"$PHONE\"'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
  local SD=$(curl -s -c /tmp/s4b_$TAG.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}")
  local OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
  local OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
  curl -s -b /tmp/s4b_$TAG.txt -c /tmp/s4b_$TAG.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /dev/null
  local SS=$(grep "snakzap_session" /tmp/s4b_$TAG.txt | awk '{print $NF}')
  local CS=$(grep "snakzap_csrf" /tmp/s4b_$TAG.txt | awk '{print $NF}')
  curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SS; snakzap_csrf=$CS" -H "X-CSRF-Token: $CS" -d "{\"campusId\":\"$CAMPUS_ID\"}"
  local DID=$(dbq "const r=db.prepare(\"SELECT id FROM User WHERE phone='$PHONE'\").get();if(r)console.log(r.id);else console.log('')")
  eval "SESS_$TAG=\$SS; CSRF_$TAG=\$CS; DBUID_$TAG=\$DID"
  echo "  $TAG: dbuid=${DID:0:12}.."
}

# Create fresh users
ALICE_PHONE="+919999998001"
BOB_PHONE="+919999998002"
CAROL_PHONE="+919999998003"
DAVE_PHONE="+919999998004"

echo "============================================================================="
echo "BASELINE"
echo "============================================================================="
echo "HEAD: $(git rev-parse HEAD)"
echo "origin/main: $(git rev-parse origin/main)"
echo "S4A checkpoint cc99b8e ancestor: $(git log --oneline cc99b8e -1 | head -c 60)"
echo -n "Source diff (src/+prisma/) since cc99b8e: "
git diff cc99b8e HEAD -- src/ prisma/ | wc -l
echo " lines (expected 0)"

echo ""
echo "=== Setup fresh users ==="
api_login "$ALICE_PHONE" "ALICE"
api_login "$BOB_PHONE" "BOB"
api_login "$CAROL_PHONE" "CAROL"
api_login "$DAVE_PHONE" "DAVE"

# Make ALICE-BOB accepted friends, ALICE-CAROL blocked pair
echo ""
echo "=== Establish relationships ==="
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d "{\"followeeId\":\"$DBUID_BOB\"}"
CONN_AB=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_ALICE' AND followeeId='$DBUID_BOB'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_BOB; snakzap_csrf=$CSRF_BOB" -H "X-CSRF-Token: $CSRF_BOB" -d '{"status":"ACCEPTED"}'
echo "  ALICE→BOB ACCEPTED"

# ALICE blocks CAROL (need a connection first)
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d "{\"followeeId\":\"$DBUID_CAROL\"}"
CONN_AC=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_ALICE' AND followeeId='$DBUID_CAROL'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL" -H "X-CSRF-Token: $CSRF_CAROL" -d '{"status":"ACCEPTED"}'
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d '{"action":"BLOCK"}'
echo "  ALICE blocked CAROL"
echo -n "  DB ALICE→CAROL: "; dbq "const r=db.prepare(\"SELECT status, blockedBy FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_ALICE' AND followeeId='$DBUID_CAROL'\").get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"

# =============================================================================
# P1 — SEARCH PHONE EXPOSURE + ENUMERATION
# =============================================================================
echo ""
echo "============================================================================="
echo "P1 — SEARCH PHONE EXPOSURE + ENUMERATION"
echo "============================================================================="

echo ""
echo "  --- P1.1: ALICE searches BOB's full phone (BOB is a friend) ---"
RESP=$(curl -s -w "\nHTTP=%{http_code} T=%{time_total}s" "$BASE/api/social/search?q=%2B919999998002" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"

echo ""
echo "  --- P1.2: ALICE searches CAROL's full phone (CAROL is BLOCKED) ---"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=%2B919999998003" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"

echo ""
echo "  --- P1.3: ALICE searches DAVE's full phone (DAVE is unrelated) ---"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=%2B919999998004" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"
echo "  (Is DAVE's full phone exposed?)"

echo ""
echo "  --- P1.4: ALICE searches partial phone '98004' (last 5 digits) ---"
RESP=$(curl -s "$BASE/api/social/search?q=98004" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"

echo ""
echo "  --- P1.5: ALICE searches '98' (2-char broad query) ---"
RESP=$(curl -s "$BASE/api/social/search?q=98" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); u=d.get('users',[]); print(f'count={len(u)}'); [print(f'  {x[\"id\"][:12]}.. {x[\"name\"]} phone={x[\"phone\"]}') for x in u[:3]]" 2>&1)
echo "  $COUNT"

echo ""
echo "  --- P1.6: ALICE searches '999' (common substring, enumeration attempt) ---"
RESP=$(curl -s "$BASE/api/social/search?q=999" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); u=d.get('users',[]); print(f'count={len(u)}')" 2>&1)
echo "  $COUNT"

echo ""
echo "  --- P1.7: Unauthenticated search (no cookie) ---"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=999")
echo "  Response: $RESP"

echo ""
echo "  --- P1.8: Empty query ---"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"

echo ""
echo "  --- P1.9: 1-char query ---"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=9" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"

# =============================================================================
# P2 — BLOCK METADATA DISCLOSURE
# =============================================================================
echo ""
echo "============================================================================="
echo "P2 — BLOCK METADATA DISCLOSURE"
echo "============================================================================="
echo "  Context: ALICE blocked CAROL. ALICE is the blocker, CAROL is the blocked party."
echo ""
echo "  --- P2.1: CAROL (blocked party) GET /api/social/connections ---"
RESP=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL")
echo "  Response:"
echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
conns = d.get('connections', [])
print(f'  CAROL sees {len(conns)} connections:')
for c in conns:
    blocked_by = c.get('blockedBy')
    print(f'    id={c[\"id\"][:12]}.. userId={c[\"userId\"][:12]}.. name={c[\"name\"]} status={c[\"status\"]} blockedBy={blocked_by[:12] if blocked_by else \"NULL/missing\"}')
"

echo ""
echo "  --- P2.2: ALICE (blocker) GET /api/social/connections ---"
RESP=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response:"
echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
conns = d.get('connections', [])
print(f'  ALICE sees {len(conns)} connections:')
for c in conns:
    blocked_by = c.get('blockedBy')
    print(f'    id={c[\"id\"][:12]}.. userId={c[\"userId\"][:12]}.. name={c[\"name\"]} status={c[\"status\"]} blockedBy={blocked_by[:12] if blocked_by else \"NULL/missing\"}')
"

echo ""
echo "  --- P2.3: Does CAROL's response reveal ALICE's userId as the blocker? ---"
echo "$RESP" >/dev/null
CAROL_RESP=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL")
echo "  CAROL response blockedBy values:"
echo "$CAROL_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
conns = d.get('connections', [])
for c in conns:
    if c.get('status') == 'BLOCKED':
        bb = c.get('blockedBy')
        print(f'    conn {c[\"id\"][:12]}.. blockedBy={bb[:12] if bb else \"NULL\"}')
"
echo "  ALICE's actual userId: ${DBUID_ALICE:0:12}.."
echo "  (Does CAROL learn ALICE's userId from blockedBy field?)"

# =============================================================================
# P3 — SEARCH INPUT ABUSE
# =============================================================================
echo ""
echo "============================================================================="
echo "P3 — SEARCH INPUT ABUSE"
echo "============================================================================="

echo ""
echo "  --- P3.1: Very large query (10,000 chars) ---"
BIG=$(python3 -c "print('a'*10000)")
RESP=$(curl -s -w "\nHTTP=%{http_code} T=%{time_total}s" "$BASE/api/social/search?q=$BIG" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
echo "  Response: $(echo "$RESP" | tail -2 | head -1)"
echo "  $(echo "$RESP" | tail -1)"

echo ""
echo "  --- P3.2: Unicode-heavy query ---"
RESP=$(curl -s -w "\nHTTP=%{http_code} T=%{time_total}s" "$BASE/api/social/search?q=%E0%A4%A6%E0%A5%8B%E0%A4%B8%E0%A4%BE" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
echo "  Response: $RESP"

echo ""
echo "  --- P3.3: Special chars / SQL-injection-like ---"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=%27%20OR%201%3D1--" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response: $RESP"

echo ""
echo "  --- P3.4: Repeated rapid queries (20 in succession, same IP) ---"
echo "  (general rate limit is 100/min — should all pass)"
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "    query $i: HTTP=%{http_code} T=%{time_total}s\n" "$BASE/api/social/search?q=999" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 5
done

echo ""
echo "  --- P3.5: 110 rapid queries (exceed general 100/min limit) ---"
echo "  (EVIDENCE_TEST_MODE may skip rate limiting — check headers)"
CODES=""
for i in $(seq 1 110); do
  C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/social/search?q=999" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 5)
  CODES="$CODES$C "
done
echo "  Status codes: $CODES"
echo "  Unique codes: $(echo $CODES | tr ' ' '\n' | sort -u | tr '\n' ' ')"

echo ""
echo "  --- P3.6: Response header check (rate-limit headers) ---"
curl -s -D - -o /dev/null "$BASE/api/social/search?q=999" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" | grep -iE "ratelimit|x-ratelimit|x-trace" | head -5

# =============================================================================
# P4 — RATE LIMIT IDENTITY CHALLENGE
# =============================================================================
echo ""
echo "============================================================================="
echo "P4 — RATE LIMIT IDENTITY CHALLENGE"
echo "============================================================================="
echo "  --- P4.1: Code trace ---"
echo "  getClientIP (src/lib/rate-limit.ts:69-75 + src/middleware.ts:63-69):"
echo "    - Reads x-forwarded-for header FIRST (trusted blindly)"
echo "    - Takes first value after split by comma"
echo "    - Falls back to x-real-ip, then 'unknown'"
echo ""
echo "  classifyPath('/api/social/search') → 'general' (line 60)"
echo "    → fail-open mode (general limit = 100/min, but allows if limiter fails)"
echo ""
echo "  Rate-limit key: 'rl:general:<ip>' (IP-only, no authenticated user identity)"

echo ""
echo "  --- P4.2: X-Forwarded-For spoof test ---"
echo "  Send 5 queries with XFF=1.2.3.4, then 5 with XFF=5.6.7.8 — do they share a bucket?"
echo "  (EVIDENCE_TEST_MODE check: if rate limiting skipped, this test is inconclusive)"
echo ""
echo "  First, check if rate limiting is active:"
RESP_HEADERS=$(curl -s -D - -o /dev/null "$BASE/api/social/search?q=test123" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE")
echo "  Response headers:"
echo "$RESP_HEADERS" | grep -iE "ratelimit|skip|x-trace" | head -3
echo ""
echo "  Send 5 queries with XFF=1.2.3.4:"
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "    $i: HTTP=%{http_code}\n" "$BASE/api/social/search?q=test$i" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-Forwarded-For: 1.2.3.4" --max-time 5
done
echo "  Send 5 queries with XFF=5.6.7.8 (different spoofed IP):"
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "    $i: HTTP=%{http_code}\n" "$BASE/api/social/search?q=test$i" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-Forwarded-For: 5.6.7.8" --max-time 5
done
echo "  Send 5 queries with NO XFF (real IP):"
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "    $i: HTTP=%{http_code}\n" "$BASE/api/social/search?q=test$i" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 5
done

echo ""
echo "  --- P4.3: Multiple XFF values (comma-separated) ---"
echo "  X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3 (which value is used?)"
echo "  Code: forwarded.split(',')[0].trim() → takes FIRST value (1.1.1.1)"
curl -s -o /dev/null -w "  HTTP=%{http_code}\n" "$BASE/api/social/search?q=multi" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-Forwarded-For: 1.1.1.1, 2.2.2.2, 3.3.3.3" --max-time 5

echo ""
echo "  --- P4.4: Does rate limit apply to authenticated-user identity or IP? ---"
echo "  Run 100 requests rapidly from ALICE, then check if BOB (different user, same IP) can still search:"
echo "  (If IP-keyed, ALICE's 100 requests would block BOB too)"
echo "  Sending 100 ALICE requests..."
for i in $(seq 1 100); do
  curl -s -o /dev/null "$BASE/api/social/search?q=flood$i" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 3
done
echo "  Now BOB (different user, same IP) tries to search:"
RESP=$(curl -s -w "\nHTTP=%{http_code}" "$BASE/api/social/search?q=999" -H "Cookie: snakzap_session=$SESS_BOB; snakzap_csrf=$CSRF_BOB" --max-time 5)
echo "  BOB response: $RESP"
echo "  (If BOB gets 200, then either rate limit skipped (test mode) or IP-bucketing not blocking)"

echo ""
echo "=== S4B CHALLENGE COMPLETE ==="
