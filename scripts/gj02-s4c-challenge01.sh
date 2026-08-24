#!/bin/bash
# S4C Integrity/Concurrency Challenge — C3 + C4 runtime tests
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4c-challenge01
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4c-challenge.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://127.0.0.1:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

dbq() {
  cat > /tmp/s4cq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
  bun /tmp/s4cq.mjs 2>&1 | grep -v "^prisma" | grep -v "^Bun "
}

api_login() {
  local PHONE=$1; local TAG=$2
  bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"$PHONE\"'); db.run('DELETE FROM OtpLockout WHERE target=\"$PHONE\"'); db.close();" 2>/dev/null
  sleep 1
  local SD=$(curl -s -c /tmp/s4c_$TAG.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" --max-time 15)
  local OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
  local OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
  if [ -z "$OI" ] || [ -z "$OC" ]; then
    echo "  $TAG: OTP send FAILED"
    eval "SESS_$TAG=''; CSRF_$TAG=''; DBUID_$TAG=''"
    return 1
  fi
  curl -s -b /tmp/s4c_$TAG.txt -c /tmp/s4c_$TAG.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" --max-time 15 > /dev/null
  sleep 1
  local SS=$(grep "snakzap_session" /tmp/s4c_$TAG.txt | awk '{print $NF}')
  local CS=$(grep "snakzap_csrf" /tmp/s4c_$TAG.txt | awk '{print $NF}')
  curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SS; snakzap_csrf=$CS" -H "X-CSRF-Token: $CS" -d "{\"campusId\":\"$CAMPUS_ID\"}" --max-time 10
  local DID=$(dbq "const r=db.prepare(\"SELECT id FROM User WHERE phone='$PHONE'\").get();if(r)console.log(r.id);else console.log('')")
  eval "SESS_$TAG=\$SS; CSRF_$TAG=\$CS; DBUID_$TAG=\$DID"
  echo "  $TAG: dbuid=${DID:0:12}.."
  sleep 2
}

echo "============================================================================="
echo "SETUP — Fresh A/B users for C3/C4"
echo "============================================================================="
# Clean
bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/custom.db')
const phones = ['+919999997001','+919999997002','+919999997003','+919999997004']
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

api_login "+919999997001" "A"
api_login "+919999997002" "B"
api_login "+919999997003" "C"
api_login "+919999997004" "D"

# ============================================================================
# C3 — CONNECTION RECIPROCAL INTEGRITY
# ============================================================================
echo ""
echo "============================================================================="
echo "C3 — CONNECTION RECIPROCAL INTEGRITY"
echo "============================================================================="

echo ""
echo "  --- C3.1: Fresh request + accept → exactly 2 ACCEPTED rows ---"
echo "  A sends request to B:"
curl -s -o /dev/null -w "    POST: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
echo "  B accepts:"
curl -s -o /dev/null -w "    PATCH: %{http_code}\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo ""
echo "  Final DB state:"
echo -n "    A→B ACCEPTED count: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B' AND status='ACCEPTED'\").get().c)"
echo -n "    B→A ACCEPTED count: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A' AND status='ACCEPTED'\").get().c)"
echo -n "    Total A↔B rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "  --- C3.2: Repeated ACCEPT (B accepts again — already ACCEPTED) ---"
echo "  B tries to ACCEPT again:"
curl -s -o /dev/null -w "    PATCH: %{http_code}\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo -n "    A→B ACCEPTED count (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B' AND status='ACCEPTED'\").get().c)"
echo -n "    B→A ACCEPTED count (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A' AND status='ACCEPTED'\").get().c)"
echo -n "    Total A↔B rows (expected 2): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "  --- C3.3: A tries to accept own request (A is follower, not followee) ---"
echo "  A tries to ACCEPT (should 403 — only followee can accept):"
curl -s -o /dev/null -w "    PATCH: %{http_code} (expected 403)\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"ACCEPTED"}'

echo ""
echo "  --- C3.4: Duplicate request after ACCEPT (A sends again) ---"
echo "  A sends another request to B (already ACCEPTED):"
curl -s -o /dev/null -w "    POST: %{http_code} (expected 409 conflict)\n" --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
echo -n "    Total A↔B rows (expected 2): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "  --- C3.5: Unfriend (DELETE) → both rows removed ---"
echo "  A unfriends B:"
curl -s -o /dev/null -w "    DELETE: %{http_code}\n" --max-time 10 -X DELETE "$BASE/api/social/connections/$CONN_AB" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A"
echo -n "    Total A↔B rows (expected 0): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "  --- C3.6: Block after re-establishing ACCEPTED ---"
echo "  Re-establish A→B + accept:"
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB2=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo "  A blocks B:"
curl -s -o /dev/null -w "    PATCH BLOCK: %{http_code}\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"BLOCK"}'
echo -n "    A→B status: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status:'NONE')"
echo -n "    B→A status: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A'\").get();console.log(r?r.status:'NONE')"
echo -n "    Total A↔B rows (expected 2): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

# ============================================================================
# C4 — CONCURRENCY / IDEMPOTENCY
# ============================================================================
echo ""
echo "============================================================================="
echo "C4 — CONCURRENCY / IDEMPOTENCY"
echo "============================================================================="

# Clean up C3 state first — unblock
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"UNBLOCK"}'
# Re-establish ACCEPTED
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB3=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB3" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo "  Re-established A↔B ACCEPTED for C4"

# A creates an activity for Like tests
ACT_RESP=$(curl -s --max-time 10 -X POST "$BASE/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"verb\":\"ORDERED\",\"objectType\":\"Restaurant\",\"objectId\":\"$RESTAURANT_ID\",\"metadata\":{\"restaurantName\":\"S4C-Test\"},\"visibility\":\"FRIENDS\"}")
ACT_ID=$(echo "$ACT_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  A's activity: $ACT_ID"
echo -n "  Notifications for A before C4: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_A'\").get().c)"

echo ""
echo "  --- C4.1: Double Like (concurrent POST Like from B) ---"
echo "  B sends 2 POST Like requests concurrently:"
RESP1=$(curl -s -w "\n%{http_code}" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" &)
RESP2=$(curl -s -w "\n%{http_code}" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" &)
wait
echo "    Response 1: $(echo "$RESP1" | tail -1)"
echo "    Response 2: $(echo "$RESP2" | tail -1)"
echo -n "    Like rows (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$ACT_ID' AND userId='$DBUID_B'\").get().c)"
echo -n "    SOCIAL_ACTIVITY_LIKED notifications for A (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_A' AND type='SOCIAL_ACTIVITY_LIKED' AND data LIKE '%$DBUID_B%'\").get().c)"

echo ""
echo "  --- C4.2: Double Unlike (concurrent DELETE Like from B) ---"
echo "  B sends 2 DELETE Like requests concurrently:"
RESP1=$(curl -s -w "\n%{http_code}" --max-time 10 -X DELETE "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" &)
RESP2=$(curl -s -w "\n%{http_code}" --max-time 10 -X DELETE "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" &)
wait
echo "    Response 1: $(echo "$RESP1" | tail -1)"
echo "    Response 2: $(echo "$RESP2" | tail -1)"
echo -n "    Like rows (expected 0): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$ACT_ID' AND userId='$DBUID_B'\").get().c)"

echo ""
echo "  --- C4.3: Double Accept (concurrent PATCH ACCEPT from B on new request) ---"
# A sends request to C (fresh pair)
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_C\"}"
CONN_AC=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_C'\").get();if(r)console.log(r.id);else console.log('')")
echo "  C sends 2 concurrent PATCH ACCEPT:"
RESP1=$(curl -s -w "\n%{http_code}" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C" -d '{"status":"ACCEPTED"}' &)
RESP2=$(curl -s -w "\n%{http_code}" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C" -d '{"status":"ACCEPTED"}' &)
wait
echo "    Response 1: $(echo "$RESP1" | tail -1)"
echo "    Response 2: $(echo "$RESP2" | tail -1)"
echo -n "    A→C ACCEPTED count (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_C' AND status='ACCEPTED'\").get().c)"
echo -n "    C→A ACCEPTED count (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_C' AND followeeId='$DBUID_A' AND status='ACCEPTED'\").get().c)"
echo -n "    Total A↔C rows (expected 2): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_C') OR (followerId='$DBUID_C' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "  --- C4.4: Idempotent sequential Like (B likes, then likes again) ---"
echo "  B likes A's activity:"
curl -s -o /dev/null -w "    POST 1: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo "  B likes again (idempotent):"
curl -s -o /dev/null -w "    POST 2: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "    Like rows (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$ACT_ID' AND userId='$DBUID_B'\").get().c)"
echo -n "    SOCIAL_ACTIVITY_LIKED notifications for A (expected 1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_A' AND type='SOCIAL_ACTIVITY_LIKED' AND data LIKE '%$DBUID_B%'\").get().c)"

# ============================================================================
# REGRESSION GUARD
# ============================================================================
echo ""
echo "============================================================================="
echo "REGRESSION GUARD"
echo "============================================================================="
echo "  S4A: Block authorization (C blocked pair)"
# A blocks C
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AC" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"BLOCK"}'
echo -n "    A→C status: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_C'\").get();console.log(r?r.status:'NONE')"
echo -n "    C POST request to A (expect 403): "; curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C" -d "{\"followeeId\":\"$DBUID_A\"}"; echo

echo "  S4B: No phone disclosure"
echo -n "    Search response has phone: "; curl -s --max-time 10 "$BASE/api/social/search?q=Use" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); us=d.get('users',[]); print('YES' if any('phone' in u for u in us) else 'NO')"
echo "  S4B: canUnblock projection"
echo -n "    A connections has raw blockedBy: "; curl -s --max-time 10 "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); cs=d.get('connections',[]); print('YES' if any('blockedBy' in c for c in cs) else 'NO')"
echo "  S4B: XFF spoof (rate limit)"
echo -n "    Search rate-limit bucket: "; curl -s -D - -o /dev/null --max-time 10 "$BASE/api/social/search?q=regen" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-Forwarded-For: 9.9.9.9" | grep -i "x-ratelimit-limit" | tr -d '\r' | awk '{print $2}'

echo ""
echo "=== COMPLETE ==="
