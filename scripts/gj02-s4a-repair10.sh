#!/bin/bash
# S4A Unblock-UI-Reachability Repair-10 — Targeted Browser Closure
# Tests: A blocks B → reload → Blocked section + Unblock visible → click → PATCH 2xx → DOM removal → reload → DB=0
# Plus: B-side negative (B reload → no Unblock/Unfriend → PATCH UNBLOCK 403 → DELETE 403)
# Plus: targeted S1/S2/S3 smoke
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-repair10
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/repair10.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://localhost:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"
A_PHONE="+919999995001"
B_PHONE="+919999995002"

ab() { timeout 30 agent-browser "$@" 2>&1 | tail -1; }

dbq() {
  cat > /tmp/r10q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
  bun /tmp/r10q.mjs 2>&1 | grep -v "^prisma" | grep -v "^Bun "
}

api_login() {
  local PHONE=$1; local TAG=$2
  bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"$PHONE\"'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
  local SD=$(curl -s -c /tmp/r10_$TAG.txt -X POST "$BASE/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}")
  local OI=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('otpId',''))" 2>/dev/null)
  local OC=$(echo "$SD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
  curl -s -b /tmp/r10_$TAG.txt -c /tmp/r10_$TAG.txt -X POST "$BASE/api/auth/otp/verify" -H "Content-Type: application/json" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /dev/null
  local SS=$(grep snakzap_session /tmp/r10_$TAG.txt | awk '{print $NF}')
  local CS=$(grep snakzap_csrf /tmp/r10_$TAG.txt | awk '{print $NF}')
  curl -s -o /dev/null -X PATCH "$BASE/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SS; snakzap_csrf=$CS" -H "X-CSRF-Token: $CS" -d "{\"campusId\":\"$CAMPUS_ID\"}"
  local DID=$(dbq "const r=db.prepare(\"SELECT id FROM User WHERE phone='$PHONE'\").get();if(r)console.log(r.id);else console.log('')")
  eval "SESS_$TAG=\$SS; CSRF_$TAG=\$CS; DBUID_$TAG=\$DID"
  echo "    $TAG: dbuid=${DID:0:12}.."
}

browser_auth() {
  local TAG=$1 SESS=$2 CSRF=$3 EXPECTED=$4
  echo "  --- Browser auth $TAG ---"
  ab cookies clear
  ab cookies set snakzap_session "$SESS" --url "$BASE/" --httpOnly --sameSite Lax --path "/"
  ab cookies set snakzap_csrf "$CSRF" --url "$BASE/" --sameSite Lax --path "/"
  ab open "$BASE/consumer" --timeout 25000
  sleep 5
  local ME=$(ab eval "fetch('/api/auth/me').then(function(r){return r.json()}).then(function(d){return d.user?d.user.userId.substring(0,12):'NONE'}).catch(function(e){return'ERR:'+e.message})")
  echo "    /api/auth/me: $ME (expected ${EXPECTED:0:12})"
}

goto_friends() {
  ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()"
  sleep 3
  for poll in $(seq 1 10); do
    local R=$(ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Friends')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()")
    if echo "$R" | grep -q "CLICKED"; then echo "    Friends: found at ${poll}s"; break; fi
    sleep 1
  done
  sleep 2
}

echo "============================================================================="
echo "S4A UNBLOCK-UI-REACHABILITY REPAIR-10 — TARGETED CLOSURE"
echo "============================================================================="
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo ""
echo "=== FIXTURE SETUP ==="
api_login "$A_PHONE" "A"
api_login "$B_PHONE" "B"
echo "  DBUID_A=$DBUID_A"
echo "  DBUID_B=$DBUID_B"
# A→B friend request + B accepts
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo -n "  A→B: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status:'NONE')"
echo -n "  B→A: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A'\").get();console.log(r?r.status:'NONE')"

# ============================================================================
# FLOW 1: A blocks B via browser → reload → Blocked section + Unblock visible → click → PATCH 2xx → DOM removal → reload → DB=0
# ============================================================================
echo ""
echo "============================================================================="
echo "FLOW 1: A BLOCKS B → RELOAD → BLOCKED SECTION → UNBLOCK CLICK → DB=0"
echo "============================================================================="
browser_auth "A" "$SESS_A" "$CSRF_A" "$DBUID_A"
ab screenshot "$EVID_DIR/F1-01-A-authed.png"

# Navigate to Friends
echo "  Navigate Social → Friends:"
goto_friends
ab screenshot "$EVID_DIR/F1-02-friends-accepted.png"
echo -n "  B visible: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'VISIBLE':'NOT_VISIBLE'})()"

# Click Block B
ab eval "window.confirm=function(){return true};'OVERRIDE'"
echo "  Click Block B:"
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block ')===0&&a.indexOf('Unblock')<0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()"
sleep 5
ab screenshot "$EVID_DIR/F1-03-after-block.png"
echo -n "  DB A→B: "; dbq "const r=db.prepare(\"SELECT status,blockedBy FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"
echo -n "  DB B→A: "; dbq "const r=db.prepare(\"SELECT status,blockedBy FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A'\").get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"

# RELOAD — the critical test
echo ""
echo "  === RELOAD (the critical test) ==="
ab open "$BASE/consumer" --timeout 25000; sleep 5
goto_friends
ab screenshot "$EVID_DIR/F1-04-after-reload.png"
echo -n "  DOM: Blocked section visible: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('Blocked')>=0?'VISIBLE(OK)':'ABSENT(FAIL)'})()"
echo -n "  DOM: B visible in Blocked section: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'VISIBLE(OK)':'ABSENT(FAIL)'})()"
echo -n "  DOM: Unblock control for B visible (aria-label): "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND:'+a}return'NOT_FOUND(FAIL)'})()"
echo -n "  API: blockedBy exposed in GET /api/social/connections: "
curl -s "$BASE/api/social/connections" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); blocked=[c for c in d.get('connections',[]) if c.get('status')=='BLOCKED']; print(f'{len(blocked)} blocked, blockedBy={blocked[0].get(\"blockedBy\",\"MISSING\")[:12] if blocked else \"NONE\"}')"

# Click Unblock B via browser
echo ""
echo "  === CLICK UNBLOCK (browser UI) ==="
echo -n "  Unblock click: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()"
sleep 6
ab screenshot "$EVID_DIR/F1-05-after-unblock-click.png"
echo -n "  DOM: Blocked section gone: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('Blocked')>=0?'STILL_VISIBLE(FAIL)':'GONE(OK)'})()"
echo -n "  DOM: B gone from view: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'STILL_VISIBLE(FAIL)':'GONE(OK)'})()"
echo -n "  DB pair rows (expected 0): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"
echo -n "  DB PENDING: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE ((followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')) AND status='PENDING'\").get().c)"
echo -n "  DB ACCEPTED: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE ((followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')) AND status='ACCEPTED'\").get().c)"
echo -n "  DB BLOCKED: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE ((followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')) AND status='BLOCKED'\").get().c)"

# Reload persistence
echo ""
echo "  === RELOAD PERSISTENCE ==="
ab open "$BASE/consumer" --timeout 25000; sleep 5
goto_friends
ab screenshot "$EVID_DIR/F1-06-after-reload.png"
echo -n "  Reload: Blocked section absent: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('Blocked')>=0?'VISIBLE(FAIL)':'ABSENT(OK)'})()"
echo -n "  Reload: B absent: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'VISIBLE(FAIL)':'ABSENT(OK)'})()"
echo -n "  Reload DB: pair rows = 0: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"
echo -n "  No new notifications created by unblock: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_A' OR userId='$DBUID_B'\").get().c + ' total (expected 1 = original FRIEND_REQUEST_ACCEPTED)')"

# ============================================================================
# FLOW 2: B-side negative — re-block, then B reload → no Unblock/Unfriend → API 403
# ============================================================================
echo ""
echo "============================================================================="
echo "FLOW 2: RE-BLOCK + B-SIDE NEGATIVE"
echo "============================================================================="
echo "  Re-establish fixture (A→B request + accept + A blocks B):"
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_AB2=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
# A blocks B via API
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"BLOCK"}'
echo -n "  DB: "; dbq "const r=db.prepare(\"SELECT status,blockedBy FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"

# B browser auth + reload
echo "  B browser auth + reload:"
browser_auth "B" "$SESS_B" "$CSRF_B" "$DBUID_B"
ab screenshot "$EVID_DIR/F2-01-B-authed.png"
goto_friends
ab screenshot "$EVID_DIR/F2-02-B-friends.png"
echo -n "  DOM: Blocked section visible (B sees it): "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('Blocked')>=0?'VISIBLE':'ABSENT'})()"
echo -n "  DOM: A (5001) visible in Blocked section: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5001')>=0?'VISIBLE':'ABSENT'})()"
echo -n "  DOM: Unblock A control absent (B is NOT the blocker): "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND(FAIL)'}return'ABSENT(OK)'})()"
echo -n "  DOM: Unfriend A control absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unfriend ')===0)return'FOUND(FAIL)'}return'ABSENT(OK)'})()"
echo -n "  DOM: 'Blocked' label visible (read-only): "
ab eval "(function(){var b=document.querySelectorAll('[aria-label=\\\"Blocked by them\\\"]');return b.length>0?'FOUND(OK)':'NOT_FOUND'})()"

# Reload
ab open "$BASE/consumer" --timeout 25000; sleep 5
goto_friends
ab screenshot "$EVID_DIR/F2-03-B-after-reload.png"
echo -n "  Reload: Unblock A absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND(FAIL)'}return'ABSENT(OK)'})()"
echo -n "  Reload: Unfriend A absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unfriend ')===0)return'FOUND(FAIL)'}return'ABSENT(OK)'})()"

# API challenges
echo "  API challenges (expect 403):"
echo -n "    B PATCH UNBLOCK: "
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"action":"UNBLOCK"}'
echo -n "    B DELETE blocked: "
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/api/social/connections/$CONN_AB2" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "  DB: BLOCKED intact: "; dbq "const r=db.prepare(\"SELECT status,blockedBy FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"

# Cleanup: A unblocks B via API for next phase
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"action":"UNBLOCK"}'
echo -n "  Cleanup: pair rows after A unblock: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"SocialConnection\\\" WHERE (followerId='$DBUID_A' AND followeeId='$DBUID_B') OR (followerId='$DBUID_B' AND followeeId='$DBUID_A')\").get().c)"

# ============================================================================
# FLOW 3: Targeted S1/S2/S3 smoke
# ============================================================================
echo ""
echo "============================================================================="
echo "FLOW 3: TARGETED S1/S2/S3 SMOKE"
echo "============================================================================="
echo "  --- S1: request → accept → reciprocal ACCEPTED ---"
# A→B request
curl -s -o /dev/null -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
CONN_S1=$(dbq "const r=db.prepare(\"SELECT id FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();if(r)console.log(r.id);else console.log('')")
curl -s -o /dev/null -X PATCH "$BASE/api/social/connections/$CONN_S1" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}'
echo -n "  E→F: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_A' AND followeeId='$DBUID_B'\").get();console.log(r?r.status:'NONE')"
echo -n "  F→E: "; dbq "const r=db.prepare(\"SELECT status FROM \\\"SocialConnection\\\" WHERE followerId='$DBUID_B' AND followeeId='$DBUID_A'\").get();console.log(r?r.status:'NONE')"

echo "  --- S2: Like → persist → duplicate → unlike ---"
S2_ACT=$(curl -s -X POST "$BASE/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"verb\":\"ORDERED\",\"objectType\":\"Restaurant\",\"objectId\":\"$RESTAURANT_ID\",\"metadata\":{\"restaurantName\":\"S4A-R10-S2\"},\"visibility\":\"FRIENDS\"}")
S2_ACT_ID=$(echo "$S2_ACT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  Activity: $S2_ACT_ID"
echo -n "  B likes: "; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/activities/$S2_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "  Like count (1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$S2_ACT_ID' AND userId='$DBUID_B'\").get().c)"
echo -n "  Duplicate like: "; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/social/activities/$S2_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "  Like count still 1: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$S2_ACT_ID' AND userId='$DBUID_B'\").get().c)"
echo -n "  B unlikes: "; curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/api/social/activities/$S2_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo -n "  Like count now 0: "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Like\\\" WHERE activityId='$S2_ACT_ID' AND userId='$DBUID_B'\").get().c)"

echo "  --- S3: deterministic FRIEND_REQUEST_RECEIVED ---"
echo -n "  B's FRIEND_REQUEST_RECEIVED count (1): "; dbq "console.log(db.prepare(\"SELECT COUNT(*) as c FROM \\\"Notification\\\" WHERE userId='$DBUID_B' AND type='FRIEND_REQUEST_RECEIVED'\").get().c)"
echo -n "  dedupKey: "; dbq "const r=db.prepare(\"SELECT dedupKey FROM \\\"Notification\\\" WHERE userId='$DBUID_B' AND type='FRIEND_REQUEST_RECEIVED'\").get();console.log(r?r.dedupKey:'NONE')"

# ============================================================================
# SOURCE + LINT CHECK
# ============================================================================
echo ""
echo "============================================================================="
echo "SOURCE + LINT CHECK"
echo "============================================================================="
echo "  Changed files:"
git diff --name-only HEAD
echo "  Lint:"
bun run lint 2>&1 | tail -5
echo ""
echo "=== REPAIR-10 COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
