#!/bin/bash
# Phases 12-13: Legacy NULL + Regression smoke
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-closure09
LOG="$EVID_DIR/closure09-api2.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://localhost:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

api_login() {
  local PHONE=$1; local TAG=$2
  bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"$PHONE\"'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
  local SD=$(curl -s -c /tmp/c9_$TAG.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}")
  local OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
  local OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
  curl -s -b /tmp/c9_$TAG.txt -c /tmp/c9_$TAG.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /dev/null
  local SS=$(grep snakzap_session /tmp/c9_$TAG.txt | awk '{print $NF}')
  local CS=$(grep snakzap_csrf /tmp/c9_$TAG.txt | awk '{print $NF}')
  curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SS; snakzap_csrf=$CS" -H "X-CSRF-Token: $CS" -d "{\"campusId\":\"$CAMPUS_ID\"}"
  local DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM User WHERE phone='$PHONE'\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)
  eval "SESS_$TAG=\$SS; CSRF_$TAG=\$CS; DBUID_$TAG=\$DID"
  echo "    $TAG: dbuid=${DID:0:12}.."
}

dbq() {
  cat > /tmp/c9q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
  bun /tmp/c9q.mjs 2>&1 | grep -v "^prisma" | grep -v "^Bun "
}

echo "============================================================================="
echo "PHASE 12 — LEGACY NULL FAIL-CLOSED"
echo "============================================================================="
C_PHONE="+919999996001"
D_PHONE="+919999996002"
echo "  Setup fresh pair C/D:"
api_login "$C_PHONE" "C"
api_login "$D_PHONE" "D"
echo "  C sends request to D, D accepts:"
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C" -d "{\"followeeId\":\"$DBUID_D\"}"
CONN_CD=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_C' AND followeeId='$DBUID_D'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_CD" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_D; snakzap_csrf=$CSRF_D" -H "X-CSRF-Token: $CSRF_D" -d '{"status":"ACCEPTED"}'
echo "  C↔D ACCEPTED. CONN_CD=$CONN_CD"
echo "  Set legacy NULL state (BLOCKED, blockedBy=NULL):"
dbq "db.run(\"UPDATE \\\"SocialConnection\\\" SET status='BLOCKED', blockedBy=NULL WHERE id='$CONN_CD' OR (followerId='$DBUID_D' AND followeeId='$DBUID_C')\"); const r=db.prepare(\"SELECT status, blockedBy FROM \\\"SocialConnection\\\" WHERE id='$CONN_CD'\").get(); console.log('  State: ' + r.status + ' blockedBy=' + (r.blockedBy===null?'NULL':r.blockedBy))"
echo "  Challenges (all expected 403):"
echo -n "    C request → D: " && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C" -d "{\"followeeId\":\"$DBUID_D\"}"
echo -n "    D request → C: " && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_D; snakzap_csrf=$CSRF_D" -H "X-CSRF-Token: $CSRF_D" -d "{\"followeeId\":\"$DBUID_C\"}"
echo -n "    C DELETE blocked: " && curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/api/social/connections/$CONN_CD" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C"
echo -n "    D DELETE blocked: " && curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/api/social/connections/$CONN_CD" -H "Cookie: snakzap_session=$SESS_D; snakzap_csrf=$CSRF_D" -H "X-CSRF-Token: $CSRF_D"
echo -n "    C UNBLOCK: " && curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE/api/social/connections/$CONN_CD" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C" -d '{"action":"UNBLOCK"}'
echo -n "    D UNBLOCK: " && curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE/api/social/connections/$CONN_CD" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_D; snakzap_csrf=$CSRF_D" -H "X-CSRF-Token: $CSRF_D" -d '{"action":"UNBLOCK"}'
echo -n "  DB unchanged: " && dbq "const r=db.prepare(\"SELECT status, blockedBy FROM \\\"SocialConnection\\\" WHERE id='$CONN_CD'\").get(); console.log(r.status + ' blockedBy=' + (r.blockedBy===null?'NULL':r.blockedBy))"

echo ""
echo "============================================================================="
echo "PHASE 13 — CLOSED-WAVE REGRESSION SMOKE"
echo "============================================================================="
E_PHONE="+919999997001"
F_PHONE="+919999997002"
echo "  --- S1: fresh pair E/F ---"
api_login "$E_PHONE" "E"
api_login "$F_PHONE" "F"
echo -n "  E sends request to F: " && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_E; snakzap_csrf=$CSRF_E" -H "X-CSRF-Token: $CSRF_E" -d "{\"followeeId\":\"$DBUID_F\"}"
CONN_EF=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_E' AND followeeId='$DBUID_F'\").get();if(r)console.log(r.id);else console.log('')")
echo -n "  F accepts: " && curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE/api/social/connections/$CONN_EF" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_F; snakzap_csrf=$CSRF_F" -H "X-CSRF-Token: $CSRF_F" -d '{"status":"ACCEPTED"}'
echo -n "  E→F: " && dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_E' AND followeeId='$DBUID_F'\").get();console.log(r?r.status:'NONE')"
echo -n "  F→E: " && dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_F' AND followeeId='$DBUID_E'\").get();console.log(r?r.status:'NONE')"
EF_ACT=$(curl -s -X POST "$BASE/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_E; snakzap_csrf=$CSRF_E" -H "X-CSRF-Token: $CSRF_E" -d "{\"verb\":\"ORDERED\",\"objectType\":\"Restaurant\",\"objectId\":\"$RESTAURANT_ID\",\"metadata\":{\"restaurantName\":\"S4A-S1-Reg-Dosa\"},\"visibility\":\"FRIENDS\"}")
EF_ACT_ID=$(echo "$EF_ACT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  E's FRIENDS activity: $EF_ACT_ID"
echo -n "  F sees E's FRIENDS activity (expected 1): " && curl -s "$BASE/api/social/feed?limit=20" -H "Cookie: snakzap_session=$SESS_F; snakzap_csrf=$CSRF_F" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); found=[a for a in acts if a.get('id')=='$EF_ACT_ID']; print(f'{len(found)} found')"
echo -n "  C (unrelated) sees E's FRIENDS activity (expected 0): " && curl -s "$BASE/api/social/feed?limit=20" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); found=[a for a in acts if a.get('id')=='$EF_ACT_ID']; print(f'{len(found)} found')"

echo "  --- S2: Like/unlike on E's activity (by F) ---"
echo -n "  F likes E's activity: " && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/activities/$EF_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_F; snakzap_csrf=$CSRF_F" -H "X-CSRF-Token: $CSRF_F"
echo -n "  Like persists (expected 1): " && dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$EF_ACT_ID' AND userId='$DBUID_F'\").get().c)"
echo -n "  Duplicate like (status): " && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/activities/$EF_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_F; snakzap_csrf=$CSRF_F" -H "X-CSRF-Token: $CSRF_F"
echo -n "  Like count still 1: " && dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$EF_ACT_ID' AND userId='$DBUID_F'\").get().c)"
echo -n "  F unlikes: " && curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/api/social/activities/$EF_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_F; snakzap_csrf=$CSRF_F" -H "X-CSRF-Token: $CSRF_F"
echo -n "  Like count now 0: " && dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$EF_ACT_ID' AND userId='$DBUID_F'\").get().c)"

echo "  --- S3: deterministic FRIEND_REQUEST_RECEIVED ---"
echo -n "  F's FRIEND_REQUEST_RECEIVED count (expected 1): " && dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_F' AND type='FRIEND_REQUEST_RECEIVED'\").get().c)"
echo -n "  F's FRIEND_REQUEST_RECEIVED dedupKey: " && dbq "const r=db.prepare(\"SELECT dedupKey FROM \\\"Notification\\\" WHERE userId='$DBUID_F' AND type='FRIEND_REQUEST_RECEIVED'\").get();console.log(r?r.dedupKey:'NONE')"

echo ""
echo "=== PHASES 12-13 COMPLETE ==="
