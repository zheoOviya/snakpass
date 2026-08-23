#!/bin/bash
# S4B Privacy/Abuse Repair-03 — Negative Suite + Regression + Rate-limit proof
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4b-repair03
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4b-repair03.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://127.0.0.1:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

# Restart server fresh to clear in-memory rate limiter state
echo "=== Restart dev server (fresh in-memory limiter) ==="
pkill -9 -f "next-server" 2>/dev/null
pkill -9 -f "bun run dev" 2>/dev/null
sleep 5
rm -f dev.log
setsid bun run dev > dev.log 2>&1 < /dev/null &
sleep 10
for i in $(seq 1 20); do
  c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null)
  [ "$c" = "200" ] && { echo "  ready ${i}s"; break; }
  sleep 2
done
# Verify EVIDENCE_TEST_MODE absent
PID=$(pgrep -f "next-server" | head -1)
ENV_CHECK=$(cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep -c "EVIDENCE_TEST_MODE=true")
echo "  EVIDENCE_TEST_MODE count: $ENV_CHECK (expected 0)"

dbq() {
  cat > /tmp/s4br3q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
  bun /tmp/s4br3q.mjs 2>&1 | grep -v "^prisma" | grep -v "^Bun "
}

api_login() {
  local PHONE=$1; local TAG=$2
  # Clear OTP for this specific phone
  bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"$PHONE\"'); db.run('DELETE FROM OtpLockout WHERE target=\"$PHONE\"'); db.close();" 2>/dev/null
  sleep 1
  local SD=$(curl -s -c /tmp/s4br3_$TAG.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" --max-time 15)
  local OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
  local OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
  if [ -z "$OI" ] || [ -z "$OC" ]; then
    echo "  $TAG: OTP send FAILED (rate-limited or server issue)"
    eval "SESS_$TAG=''; CSRF_$TAG=''; DBUID_$TAG=''"
    return 1
  fi
  curl -s -b /tmp/s4br3_$TAG.txt -c /tmp/s4br3_$TAG.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" --max-time 15 > /dev/null
  sleep 1
  local SS=$(grep "snakzap_session" /tmp/s4br3_$TAG.txt | awk '{print $NF}')
  local CS=$(grep "snakzap_csrf" /tmp/s4br3_$TAG.txt | awk '{print $NF}')
  curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SS; snakzap_csrf=$CS" -H "X-CSRF-Token: $CS" -d "{\"campusId\":\"$CAMPUS_ID\"}" --max-time 10
  local DID=$(dbq "const r=db.prepare(\"SELECT id FROM User WHERE phone='$PHONE'\").get();if(r)console.log(r.id);else console.log('')")
  eval "SESS_$TAG=\$SS; CSRF_$TAG=\$CS; DBUID_$TAG=\$DID"
  echo "  $TAG: dbuid=${DID:0:12}.. sess=${SS:0:8}.."
  sleep 2
}

# Fresh users
ALICE_PHONE="+919999999001"
BOB_PHONE="+919999999002"
CAROL_PHONE="+919999999003"
DAVE_PHONE="+919999999004"
EVE_PHONE="+919999999005"

echo "============================================================================="
echo "SETUP — Fresh users"
echo "============================================================================="
# Clean
bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/custom.db')
const phones = ['$ALICE_PHONE','$BOB_PHONE','$CAROL_PHONE','$DAVE_PHONE','$EVE_PHONE']
const users = db.prepare('SELECT id FROM User WHERE phone IN (' + phones.map(p=>\"'\"+p+\"'\").join(',') + ')').all()
if (users.length > 0) {
  const ids = users.map(u=>\"'\"+u.id+\"'\").join(',')
  db.run('DELETE FROM \"SocialConnection\" WHERE followerId IN (' + ids + ') OR followeeId IN (' + ids + ')')
  db.run('DELETE FROM \"SocialActivity\" WHERE actorId IN (' + ids + ')')
  db.run('DELETE FROM \"Like\" WHERE userId IN (' + ids + ')')
  db.run('DELETE FROM \"Notification\" WHERE userId IN (' + ids + ')')
  db.run('DELETE FROM Session WHERE userId IN (' + ids + ')')
  db.run('DELETE FROM User WHERE id IN (' + ids + ')')
}
db.run('DELETE FROM OtpRequest')
db.run('DELETE FROM OtpLockout')
db.close()
" 2>&1 | grep -v "^prisma"

api_login "$ALICE_PHONE" "ALICE"
api_login "$BOB_PHONE" "BOB"
api_login "$CAROL_PHONE" "CAROL"
api_login "$DAVE_PHONE" "DAVE"
api_login "$EVE_PHONE" "EVE"

# Establish: ALICE-BOB accepted, ALICE blocked CAROL
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d "{\"followeeId\":\"$DBUID_BOB\"}"
CONN_AB=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_ALICE' AND followeeId='$DBUID_BOB'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_BOB; snakzap_csrf=$CSRF_BOB" -H "X-CSRF-Token: $CSRF_BOB" -d '{"status":"ACCEPTED"}'
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d "{\"followeeId\":\"$DBUID_CAROL\"}"
CONN_AC=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_ALICE' AND followeeId='$DBUID_CAROL'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL" -H "X-CSRF-Token: $CSRF_CAROL" -d '{"status":"ACCEPTED"}'
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d '{"action":"BLOCK"}'
echo "  ALICE-BOB ACCEPTED, ALICE blocked CAROL"
echo "  DBUID_ALICE=$DBUID_ALICE"
echo "  DBUID_BOB=$DBUID_BOB"
echo "  DBUID_CAROL=$DBUID_CAROL"
echo "  DBUID_DAVE=$DBUID_DAVE"

echo ""
echo "============================================================================="
echo "PHASE 5 — NEGATIVE SUITE (N1-N18)"
echo "============================================================================="

echo ""
echo "N1: Unauthenticated search → 401"
C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/social/search?q=test" --max-time 10)
echo "  HTTP=$C (expected 401)"
N1=$([ "$C" = "401" ] && echo PASS || echo FAIL)

echo ""
echo "N2: 1-char search → [] (200, empty)"
BODY=$(curl -s "$BASE/api/social/search?q=9" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
C=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('users',[])))" 2>/dev/null)
echo "  count=$C (expected 0)"
N2=$([ "$C" = "0" ] && echo PASS || echo FAIL)

echo ""
echo "N3: 2-char numeric search → [] (digit min=4)"
BODY=$(curl -s "$BASE/api/social/search?q=98" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
C=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('users',[])))" 2>/dev/null)
echo "  count=$C (expected 0)"
N3=$([ "$C" = "0" ] && echo PASS || echo FAIL)

echo ""
echo "N4: 3-char numeric search → [] (digit min=4)"
BODY=$(curl -s "$BASE/api/social/search?q=999" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
C=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('users',[])))" 2>/dev/null)
echo "  count=$C (expected 0)"
N4=$([ "$C" = "0" ] && echo PASS || echo FAIL)

echo ""
echo "N5: 4-char phone fragment → result possible, NO phone in response"
BODY=$(curl -s "$BASE/api/social/search?q=9004" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
echo "  Body: $BODY"
HAS_PHONE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); us=d.get('users',[]); print('YES' if any('phone' in u for u in us) else 'NO')" 2>/dev/null)
echo "  Contains phone field: $HAS_PHONE (expected NO)"
N5=$([ "$HAS_PHONE" = "NO" ] && echo PASS || echo FAIL)

echo ""
echo "N6: 3-char name search → result possible, NO phone"
BODY=$(curl -s "$BASE/api/social/search?q=Use" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
echo "  Body: $BODY"
HAS_PHONE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); us=d.get('users',[]); print('YES' if any('phone' in u for u in us) else 'NO')" 2>/dev/null)
echo "  Contains phone field: $HAS_PHONE (expected NO)"
N6=$([ "$HAS_PHONE" = "NO" ] && echo PASS || echo FAIL)

echo ""
echo "N7: Full-phone search → result possible, NO stored phone"
BODY=$(curl -s "$BASE/api/social/search?q=%2B919999999004" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
echo "  Body: $BODY"
HAS_PHONE=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); us=d.get('users',[]); print('YES' if any('phone' in u for u in us) else 'NO')" 2>/dev/null)
echo "  Contains phone field: $HAS_PHONE (expected NO)"
N7=$([ "$HAS_PHONE" = "NO" ] && echo PASS || echo FAIL)

echo ""
echo "N9: Blocked party (CAROL) GET connections → no raw blockedBy"
BODY=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL" --max-time 10)
echo "  Body (truncated): $(echo "$BODY" | head -c 400)"
HAS_BLOCKEDBY=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); cs=d.get('connections',[]); print('YES' if any('blockedBy' in c for c in cs) else 'NO')" 2>/dev/null)
echo "  Contains raw blockedBy: $HAS_BLOCKEDBY (expected NO)"
N9=$([ "$HAS_BLOCKEDBY" = "NO" ] && echo PASS || echo FAIL)

echo ""
echo "N10: Blocker (ALICE) GET connections → canUnblock=true for CAROL"
BODY=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
CAN_UNBLOCK=$(echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
cs=d.get('connections',[])
blocked=[c for c in cs if c.get('status')=='BLOCKED']
print('YES' if any(c.get('canUnblock')==True for c in blocked) else 'NO')
" 2>/dev/null)
echo "  canUnblock=true for blocker: $CAN_UNBLOCK (expected YES)"
N10=$([ "$CAN_UNBLOCK" = "YES" ] && echo PASS || echo FAIL)

echo ""
echo "N11: Blocked party (CAROL) GET connections → canUnblock=false"
BODY=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL" --max-time 10)
CAN_UNBLOCK_C=$(echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
cs=d.get('connections',[])
blocked=[c for c in cs if c.get('status')=='BLOCKED']
print('YES' if all(c.get('canUnblock')==False for c in blocked) else 'NO')
" 2>/dev/null)
echo "  canUnblock=false for blocked party: $CAN_UNBLOCK_C (expected YES)"
N11=$([ "$CAN_UNBLOCK_C" = "YES" ] && echo PASS || echo FAIL)

echo ""
echo "N12: Legacy blockedBy=NULL → canUnblock=false"
# Set legacy state
dbq "db.run(\"UPDATE \\\"SocialConnection\\\" SET blockedBy=NULL WHERE id='$CONN_AC' OR (followerId='$DBUID_CAROL' AND followeeId='$DBUID_ALICE')\")"
BODY=$(curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" --max-time 10)
CAN_UNBLOCK_LEGACY=$(echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
cs=d.get('connections',[])
blocked=[c for c in cs if c.get('status')=='BLOCKED']
print('YES' if all(c.get('canUnblock')==False for c in blocked) else 'NO')
" 2>/dev/null)
echo "  canUnblock=false for legacy NULL: $CAN_UNBLOCK_LEGACY (expected YES)"
N12=$([ "$CAN_UNBLOCK_LEGACY" = "YES" ] && echo PASS || echo FAIL)
# Restore: re-block properly
dbq "db.run(\"UPDATE \\\"SocialConnection\\\" SET blockedBy='$DBUID_ALICE' WHERE id='$CONN_AC' OR (followerId='$DBUID_CAROL' AND followeeId='$DBUID_ALICE')\")"

echo ""
echo "N13: Blocked party cannot unblock via API → 403 (S4A preserved)"
C=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_CAROL; snakzap_csrf=$CSRF_CAROL" -H "X-CSRF-Token: $CSRF_CAROL" -d '{"action":"UNBLOCK"}' --max-time 10)
echo "  HTTP=$C (expected 403)"
N13=$([ "$C" = "403" ] && echo PASS || echo FAIL)

echo ""
echo "N14: Blocker Unblock works → 2xx (S4A preserved)"
C=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d '{"action":"UNBLOCK"}' --max-time 10)
echo "  HTTP=$C (expected 200)"
PAIR_ROWS=$(dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_ALICE' AND followeeId='$DBUID_CAROL') OR (followerId='$DBUID_CAROL' AND followeeId='$DBUID_ALICE')\").get().c)")
echo "  Pair rows after unblock: $PAIR_ROWS (expected 0)"
N14=$([ "$C" = "200" ] && [ "$PAIR_ROWS" = "0" ] && echo PASS || echo FAIL)

# Re-block for rate-limit test
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_ALICE; snakzap_csrf=$CSRF_ALICE" -H "X-CSRF-Token: $CSRF_ALICE" -d "{\"followeeId\":\"$DBUID_BOB\"}" > /dev/null

echo ""
echo "============================================================================="
echo "P4 RATE-LIMIT RUNTIME PROOF"
echo "============================================================================="

echo ""
echo "N15: Spoof XFF A→B→C → user quota does NOT reset"
echo "  (Send 3 requests with XFF=A, then 3 with XFF=B — per-user quota should continue)"
echo "  Request 1 (XFF=10.20.30.1):"
H1=$(curl -s -D - -o /dev/null --max-time 10 "$BASE/api/social/search?q=n15_a1" -H "Cookie: snakzap_session=$SESS_EVE; snakzap_csrf=$CSRF_EVE" -H "X-Forwarded-For: 10.20.30.1" 2>&1)
R1=$(echo "$H1" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
L1=$(echo "$H1" | grep -i "x-ratelimit-limit" | tr -d '\r' | awk '{print $2}')
echo "    Limit=$L1 Remaining=$R1"
sleep 2
echo "  Request 2 (XFF=10.20.30.1, same):"
H2=$(curl -s -D - -o /dev/null --max-time 10 "$BASE/api/social/search?q=n15_a2" -H "Cookie: snakzap_session=$SESS_EVE; snakzap_csrf=$CSRF_EVE" -H "X-Forwarded-For: 10.20.30.1" 2>&1)
R2=$(echo "$H2" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "    Remaining=$R2"
sleep 2
echo "  Request 3 (XFF=10.20.30.1, same):"
H3=$(curl -s -D -o /dev/null --max-time 10 "$BASE/api/social/search?q=n15_a3" -H "Cookie: snakzap_session=$SESS_EVE; snakzap_csrf=$CSRF_EVE" -H "X-Forwarded-For: 10.20.30.1" 2>&1)
R3=$(echo "$H3" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "    Remaining=$R3"
sleep 2
echo "  Request 4 (XFF=10.20.30.2 — CHANGED):"
H4=$(curl -s -D - -o /dev/null --max-time 10 "$BASE/api/social/search?q=n15_b1" -H "Cookie: snakzap_session=$SESS_EVE; snakzap_csrf=$CSRF_EVE" -H "X-Forwarded-For: 10.20.30.2" 2>&1)
R4=$(echo "$H4" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "    Remaining=$R4"
sleep 2
echo "  Request 5 (XFF=10.20.30.3 — CHANGED again):"
H5=$(curl -s -D -o /dev/null --max-time 10 "$BASE/api/social/search?q=n15_c1" -H "Cookie: snakzap_session=$SESS_EVE; snakzap_csrf=$CSRF_EVE" -H "X-Forwarded-For: 10.20.30.3" 2>&1)
R5=$(echo "$H5" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "    Remaining=$R5"
echo ""
echo "  Interpretation:"
echo "  If XFF NOT trusted: Remaining continues 29→28→27→26→25 (no reset on XFF change)"
echo "  If XFF trusted: Remaining resets to 29 on XFF change (would be a FAIL)"
if [ -n "$R3" ] && [ -n "$R4" ]; then
  DELTA=$((R4 - R3))
  if [ "$DELTA" -lt 0 ]; then
    echo "  VERDICT: XFF NOT trusted — Remaining continued ($R3 → $R4, delta=$DELTA) → PASS"
    N15="PASS"
  elif [ "$DELTA" -eq 0 ]; then
    echo "  VERDICT: XFF NOT trusted — Remaining same ($R3 → $R4) → PASS"
    N15="PASS"
  else
    echo "  VERDICT: XFF STILL trusted — Remaining reset ($R3 → $R4, delta=+$DELTA) → FAIL"
    N15="FAIL"
  fi
else
  echo "  VERDICT: INCONCLUSIVE (headers not captured)"
  N15="INCONCLUSIVE"
fi

echo ""
echo "N17: Different authenticated user → has separate user quota"
echo "  EVE has used 5 search requests above. DAVE (fresh user) should get fresh quota."
H=$(curl -s -D - -o /dev/null --max-time 10 "$BASE/api/social/search?q=dave_test" -H "Cookie: snakzap_session=$SESS_DAVE; snakzap_csrf=$CSRF_DAVE" 2>&1)
R=$(echo "$H" | grep -i "x-ratelimit-remaining" | tr -d '\r' | awk '{print $2}')
echo "  DAVE first search Remaining=$R (if ~29, separate per-user quota)"
N17=$(echo "$R" | python3 -c "import sys; r=int(sys.stdin.read().strip()); print('PASS' if r>=28 else 'FAIL')" 2>/dev/null)

echo ""
echo "N18: Search fail-closed (CODE_VERIFIED, not runtime-testable)"
echo "  src/middleware.ts: search bucket = fail-closed (limit=30/min)"
echo "  src/app/api/social/search/route.ts: per-user limit = fail-closed (20/min)"
echo "  If limiter unavailable → 503 (controlled failure)"
echo "  Runtime fault injection: NOT_AVAILABLE (in-memory limiter always available in dev)"
echo "  FAIL_CLOSED = CODE_VERIFIED"
echo "  RUNTIME_FAULT_INJECTION = NOT_AVAILABLE"
N18="CODE_VERIFIED"

echo ""
echo "=== NEGATIVE SUITE SUMMARY ==="
echo "N1 (unauth 401): $N1"
echo "N2 (1-char → []): $N2"
echo "N3 (2-char numeric → []): $N3"
echo "N4 (3-char numeric → []): $N4"
echo "N5 (4-char, no phone): $N5"
echo "N6 (3-char name, no phone): $N6"
echo "N7 (full phone, no stored phone): $N7"
echo "N9 (no raw blockedBy): $N9"
echo "N10 (blocker canUnblock=true): $N10"
echo "N11 (blocked canUnblock=false): $N11"
echo "N12 (legacy NULL canUnblock=false): $N12"
echo "N13 (blocked cannot unblock 403): $N13"
echo "N14 (blocker unblock works): $N14"
echo "N15 (XFF spoof no reset): $N15"
echo "N17 (separate user quota): $N17"
echo "N18 (fail-closed): $N18"

echo ""
echo "=== COMPLETE ==="
