#!/bin/bash
# S4C Challenge — condensed, single-invocation, no chaining failures
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4c-challenge01
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4c-runtime.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://127.0.0.1:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

dbq() {
  bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/custom.db')
$1
db.close()
" 2>&1 | grep -v "^prisma" | grep -v "^Bun "
}

# Create A
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"+919999997001\"'); db.run('DELETE FROM OtpLockout WHERE target=\"+919999997001\"'); db.close();" 2>/dev/null
SD=$(curl -s -c /tmp/s4c_A.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d '{"phone":"+919999997001","purpose":"consumer_login"}' --max-time 15)
OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
curl -s -b /tmp/s4c_A.txt -c /tmp/s4c_A.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"+919999997001\",\"purpose\":\"consumer_login\"}" --max-time 15 > /dev/null
SESS_A=$(grep "snakzap_session" /tmp/s4c_A.txt | awk '{print $NF}')
CSRF_A=$(grep "snakzap_csrf" /tmp/s4c_A.txt | awk '{print $NF}')
curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"campusId\":\"$CAMPUS_ID\"}" --max-time 10
DBUID_A=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM User WHERE phone='+919999997001'\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)
echo "A: ${DBUID_A:0:12} sess=${SESS_A:0:8}.."
sleep 3

# Create B
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"+919999997002\"'); db.run('DELETE FROM OtpLockout WHERE target=\"+919999997002\"'); db.close();" 2>/dev/null
SD=$(curl -s -c /tmp/s4c_B.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d '{"phone":"+919999997002","purpose":"consumer_login"}' --max-time 15)
OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
curl -s -b /tmp/s4c_B.txt -c /tmp/s4c_B.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"+919999997002\",\"purpose\":\"consumer_login\"}" --max-time 15 > /dev/null
SESS_B=$(grep "snakzap_session" /tmp/s4c_B.txt | awk '{print $NF}')
CSRF_B=$(grep "snakzap_csrf" /tmp/s4c_B.txt | awk '{print $NF}')
curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"campusId\":\"$CAMPUS_ID\"}" --max-time 10
DBUID_B=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM User WHERE phone='+919999997002'\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)
echo "B: ${DBUID_B:0:12} sess=${SESS_B:0:8}.."

echo ""
echo "============================================================================="
echo "C3 — CONNECTION RECIPROCAL INTEGRITY"
echo "============================================================================="

echo ""
echo "C3.1: Fresh request + accept"
curl -s -o /dev/null -w "  POST: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
echo "  CONN_AB=$CONN_AB"
curl -s -o /dev/null -w "  PATCH ACCEPT: %{http_code}\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo -n "  A→B ACCEPTED: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B' AND status='ACCEPTED'\").get().c)"
echo -n "  B→A ACCEPTED: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A' AND status='ACCEPTED'\").get().c)"
echo -n "  Total rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "C3.2: Repeated ACCEPT (B accepts again)"
curl -s -o /dev/null -w "  PATCH: %{http_code} (expected 409 conflict)\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo -n "  Total rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "C3.3: A tries to ACCEPT own request (should 403)"
curl -s -o /dev/null -w "  PATCH: %{http_code} (expected 403)\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"ACCEPTED"}'

echo ""
echo "C3.4: Duplicate request after ACCEPT (A sends again)"
curl -s -o /dev/null -w "  POST: %{http_code} (expected 409)\n" --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
echo -n "  Total rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "C3.5: Unfriend (DELETE)"
curl -s -o /dev/null -w "  DELETE: %{http_code}\n" --max-time 10 -X DELETE "$BASE/api/social/connections/$CONN_AB" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A"
echo -n "  Total rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "C3.6: Block after re-establishing ACCEPTED"
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB2=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
curl -s -o /dev/null -w "  PATCH BLOCK: %{http_code}\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"BLOCK"}'
echo -n "  A→B: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status:'NONE')"
echo -n "  B→A: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A'\").get();console.log(r?r.status:'NONE')"
echo -n "  Total rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "============================================================================="
echo "C4 — CONCURRENCY / IDEMPOTENCY"
echo "============================================================================="

# Unblock + re-establish for C4
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"UNBLOCK"}'
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB3=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB3" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo "  Re-established A↔B ACCEPTED"

# Create activity
ACT_RESP=$(curl -s --max-time 10 -X POST "$BASE/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"verb\":\"ORDERED\",\"objectType\":\"Restaurant\",\"objectId\":\"$RESTAURANT_ID\",\"metadata\":{\"restaurantName\":\"S4C-Test\"},\"visibility\":\"FRIENDS\"}")
ACT_ID=$(echo "$ACT_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  Activity: $ACT_ID"

echo ""
echo "C4.1: Double Like (sequential, idempotent)"
curl -s -o /dev/null -w "  POST 1: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
curl -s -o /dev/null -w "  POST 2: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "  Like rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$ACT_ID' AND userId='$DBUID_B'\").get().c)"
echo -n "  SOCIAL_ACTIVITY_LIKED notif for A: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_A' AND type='SOCIAL_ACTIVITY_LIKED'\").get().c)"

echo ""
echo "C4.2: Double Unlike (sequential, idempotent)"
curl -s -o /dev/null -w "  DELETE 1: %{http_code}\n" --max-time 10 -X DELETE "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
curl -s -o /dev/null -w "  DELETE 2: %{http_code}\n" --max-time 10 -X DELETE "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "  Like rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$ACT_ID' AND userId='$DBUID_B'\").get().c)"

echo ""
echo "C4.3: Double Accept (sequential, idempotent on same PENDING)"
# Need fresh pair — use A→D... but we only have A/B. Use A→B again after unfriend.
curl -s -o /dev/null --max-time 10 -X DELETE "$BASE/api/social/connections/$CONN_AB3" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A"
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB4=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -w "  ACCEPT 1: %{http_code}\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB4" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
curl -s -o /dev/null -w "  ACCEPT 2: %{http_code} (expected 409)\n" --max-time 10 -X PATCH "$BASE/api/social/connections/$CONN_AB4" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo -n "  A→B ACCEPTED: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B' AND status='ACCEPTED'\").get().c)"
echo -n "  B→A ACCEPTED: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A' AND status='ACCEPTED'\").get().c)"
echo -n "  Total rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

echo ""
echo "C4.4: Concurrent Like (2 parallel POST)"
# Re-like
curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
# Unlike first
curl -s -o /dev/null --max-time 10 -X DELETE "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo "  2 concurrent POST Like:"
curl -s -o /dev/null -w "  R1: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" &
curl -s -o /dev/null -w "  R2: %{http_code}\n" --max-time 10 -X POST "$BASE/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" &
wait
echo -n "  Like rows: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$ACT_ID' AND userId='$DBUID_B'\").get().c)"
echo -n "  SOCIAL_ACTIVITY_LIKED notif for A: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_A' AND type='SOCIAL_ACTIVITY_LIKED'\").get().c)"

echo ""
echo "============================================================================="
echo "REGRESSION GUARD"
echo "============================================================================="
echo -n "  S4B: Search has phone: "; curl -s --max-time 10 "$BASE/api/social/search?q=Use" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); us=d.get('users',[]); print('YES' if any('phone' in u for u in us) else 'NO')"
echo -n "  S4B: Connections has raw blockedBy: "; curl -s --max-time 10 "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); cs=d.get('connections',[]); print('YES' if any('blockedBy' in c for c in cs) else 'NO')"

echo ""
echo "=== COMPLETE ==="
