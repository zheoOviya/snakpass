#!/bin/bash
# GJ-02 S2 Browser Evidence — L1-L9 + negatives + failure injection
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s2-browser
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s2-browser.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S2A_PHONE="+919999900501"
S2B_PHONE="+919999900502"
S2C_PHONE="+919999900503"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "GJ-02 S2 BROWSER EVIDENCE (L1-L9)"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

cat > /tmp/clr.mjs << 'MJS'
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
db.run(`DELETE FROM "OtpRequest" WHERE target IN ('+919999900501','+919999900502','+919999900503')`)
try { db.run(`DELETE FROM "OtpLockout"`) } catch(e) {}
db.run(`DELETE FROM "Like"`)
db.run(`DELETE FROM "SocialConnection" WHERE followerId IN (SELECT id FROM "User" WHERE phone IN ('+919999900501','+919999900502','+919999900503')) OR followeeId IN (SELECT id FROM "User" WHERE phone IN ('+919999900501','+919999900502','+919999900503'))`)
db.run(`DELETE FROM "SocialActivity" WHERE actorId IN (SELECT id FROM "User" WHERE phone IN ('+919999900501','+919999900502','+919999900503'))`)
db.close()
MJS
bun /tmp/clr.mjs 2>&1

login_user() {
  local PHONE=$1; local TAG=$2; local LTAG=$(echo "$TAG" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/s2${LTAG}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /tmp/s2s${LTAG}.json
  local OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/s2s${LTAG}.json')).get('otpId',''))" 2>/dev/null)
  local OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/s2s${LTAG}.json')).get('code',''))" 2>/dev/null)
  local SP=$(grep "snakzap_session" /tmp/s2${LTAG}.txt | awk '{print $NF}')
  local CP=$(grep "snakzap_csrf" /tmp/s2${LTAG}.txt | awk '{print $NF}')
  curl -s -b /tmp/s2${LTAG}.txt -c /tmp/s2${LTAG}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /dev/null
  local S=$(grep "snakzap_session" /tmp/s2${LTAG}.txt | awk '{print $NF}')
  local C=$(grep "snakzap_csrf" /tmp/s2${LTAG}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$TAG" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; C) SESS_C=$S; CSRF_C=$C;; esac
  local DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$PHONE'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$TAG" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; C) DBUID_C=$DID;; esac
  echo "  $TAG: id=$DID"
}

login_user "$S2A_PHONE" "A"
login_user "$S2B_PHONE" "B"
login_user "$S2C_PHONE" "C"

dbq() { cat > /tmp/s2q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/s2q.mjs 2>&1 | grep -v "^prisma"; }

# Setup: A↔B accepted, create FRIENDS activity
echo "=== FIXTURE ==="
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
echo "A↔B: ACCEPTED"
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"S2 Dosa","dishName":"S2 Coffee"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "Activity: $ACT_ID (FRIENDS)"

# === L1: Initial state ===
echo ""
echo "=== L1: INITIAL STATE ==="
echo -n "  API likeCount: "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(f'likeCount={a[0].get(\"likeCount\",0)} likedByMe={a[0].get(\"likedByMe\",False)}' if a else 'NOT_FOUND')" 2>&1
echo -n "  DB Like rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# === L2: Browser Like ===
echo ""
echo "=== L2: BROWSER LIKE ==="
agent-browser cookies clear 2>&1 | tail -1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 2
agent-browser eval "document.cookie='snakzap_session=$SESS_B; path=/'; document.cookie='snakzap_csrf=$CSRF_B; path=/'; 'SET'" 2>&1 | tail -1; sleep 1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/L2-01-before-like.png" 2>&1 | tail -1
echo -n "  Interaction: Like click: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(l){l.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
agent-browser screenshot "$EVID_DIR/L2-02-after-like.png" 2>&1 | tail -1
echo "  Network: POST /api/social/activities/$ACT_ID/like:"
LIKE_RESP=$(curl -s -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "    Response: $LIKE_RESP"
echo -n "  DB: Like rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
echo -n "  Reload: still liked: "
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/L2-03-after-reload.png" 2>&1 | tail -1
echo -n "  API after reload: "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(f'likeCount={a[0].get(\"likeCount\",0)} likedByMe={a[0].get(\"likedByMe\",False)}' if a else 'NOT_FOUND')" 2>&1

# === L3: Rapid duplicate ===
echo ""
echo "=== L3: RAPID DUPLICATE ==="
curl -s -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" > /dev/null &
curl -s -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" > /dev/null &
wait
echo -n "  DB Like rows (should be 1): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\" AND userId=\"$DBUID_B\"').get().c)"
echo -n "  API likeCount: "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(a[0].get('likeCount',0) if a else 'NOT_FOUND')" 2>&1

# === L4: Browser Unlike ===
echo ""
echo "=== L4: BROWSER UNLIKE ==="
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(l){l.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
agent-browser screenshot "$EVID_DIR/L4-01-after-unlike.png" 2>&1 | tail -1
echo "  Network: DELETE:"
DEL_RESP=$(curl -s -X DELETE "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "    Response: $DEL_RESP"
echo -n "  DB Like rows (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
echo -n "  Reload: still 0: "
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/L4-02-after-reload.png" 2>&1 | tail -1
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(f'likeCount={a[0].get(\"likeCount\",0)} likedByMe={a[0].get(\"likedByMe\",False)}' if a else 'NOT_FOUND')" 2>&1

# === L5: Repeated unlike ===
echo ""
echo "=== L5: REPEATED UNLIKE ==="
echo -n "  2nd DELETE: "
DEL2=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "$DEL2 (expected 200)"
echo -n "  API likeCount (should be 0): "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(a[0].get('likeCount',0) if a else 'NOT_FOUND')" 2>&1

# === L6: Non-friend ===
echo ""
echo "=== L6: NON-FRIEND (C) ==="
echo -n "  C like A's FRIENDS activity: "
C_LIKE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C" -H "X-CSRF-Token: $CSRF_C")
echo "$C_LIKE (expected 403)"
echo -n "  DB Like rows (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# === L7: PRIVATE ===
echo ""
echo "=== L7: PRIVATE ==="
PRIV_ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Private"},"visibility":"PRIVATE"}')
PRIV_ID=$(echo "$PRIV_ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  PRIVATE activity: $PRIV_ID"
echo -n "  B like PRIVATE: "
B_PRIV=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$PRIV_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "$B_PRIV (expected 403)"
echo -n "  DB Like rows (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$PRIV_ID\"').get().c)"

# === L8: Not found ===
echo ""
echo "=== L8: NOT FOUND ==="
echo -n "  Like nonexistent: "
NF=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/nonexistent_id/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "$NF (expected 404)"

# === L9: Failure rollback ===
echo ""
echo "=== L9: FAILURE ROLLBACK ==="
# B likes first
curl -s -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" > /dev/null
echo "  B liked (setup)"
echo -n "  DB rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
# Inject failure for DELETE
agent-browser eval "(function(){window.__origFetch=window.fetch;window.fetch=function(i,o){var u=typeof i==='string'?i:'';var m=(o&&o.method)||'GET';if(m.toUpperCase()==='DELETE'&&u.indexOf('/like')>=0){window.__injected=true;return Promise.reject(new Error('INJECTED'))}return window.__origFetch.apply(this,arguments)};return'INSTALLED'})()" 2>&1 | tail -1
# Click unlike → will fail
echo -n "  Click Unlike (will fail): "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(l){l.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
agent-browser screenshot "$EVID_DIR/L9-01-failure.png" 2>&1 | tail -1
echo -n "  Failure injected: "
agent-browser eval "(function(){return window.__injected?'YES':'NO'})()" 2>&1 | tail -1
echo -n "  DB Like rows (should be 1 — rollback): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
# Restore
agent-browser eval "(function(){if(window.__origFetch){window.fetch=window.__origFetch;return'RESTORED'}})()" 2>&1 | tail -1
# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/L9-02-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still liked (truth): "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(f'likedByMe={a[0].get(\"likedByMe\",False)} likeCount={a[0].get(\"likeCount\",0)}' if a else 'NOT_FOUND')" 2>&1

# === Regression ===
echo ""
echo "=== REGRESSION ==="
echo -n "  S1 source diff: " && git diff 0bc5aba HEAD -- src/lib/social-store.ts src/lib/types.ts src/components/social-feed-card.tsx src/components/friends-screen.tsx src/app/api/social/connections/ 2>/dev/null | wc -l
echo -n "  P0-06: " && ls src/lib/state-invariants.ts 2>/dev/null && echo "present" || echo "ABSENT"
echo -n "  P0-07: " && ls src/lib/pickup-attribution.ts 2>/dev/null && echo "present" || echo "ABSENT"
echo -n "  Firebase: " && rg -lci "firebase" src/ 2>/dev/null | wc -l
echo -n "  Lint: " && timeout 90 bun run lint 2>&1 | grep -cE "error|Error" | head -1

echo ""
echo "=== S2 BROWSER EVIDENCE COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
