#!/bin/bash
# S4A Closure-09 — Browser Phases (2-10) with timeout protection
# Runs against the existing fixture (A=5001, B=5002, ACCEPTED pair, A's activities created)
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-closure09
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/closure09-browser.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

BASE="http://localhost:3000"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
A_PHONE="+919999995001"
B_PHONE="+919999995002"
A_ACT_NAME="S4A-Closure09-Secret-Dosa"
A_PUB_NAME="S4A-Closure09-Public-Samosa"

# Read tokens from DB
SESS_A=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT token FROM Session WHERE userId=(SELECT id FROM User WHERE phone='$A_PHONE') ORDER BY createdAt DESC LIMIT 1\").get(); console.log(r.token); db.close();" 2>/dev/null | tail -1)
CSRF_A=$(grep snakzap_csrf /tmp/c9_A.txt | awk '{print $NF}')
SESS_B=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT token FROM Session WHERE userId=(SELECT id FROM User WHERE phone='$B_PHONE') ORDER BY createdAt DESC LIMIT 1\").get(); console.log(r.token); db.close();" 2>/dev/null | tail -1)
CSRF_B=$(grep snakzap_csrf /tmp/c9_B.txt | awk '{print $NF}')
DBUID_A=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM User WHERE phone='$A_PHONE'\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)
DBUID_B=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM User WHERE phone='$B_PHONE'\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)
A_ACT_ID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM \\\"SocialActivity\\\" WHERE actorId='$DBUID_A' AND visibility='FRIENDS' ORDER BY createdAt DESC LIMIT 1\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)
A_PUB_ID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); const r = db.prepare(\"SELECT id FROM \\\"SocialActivity\\\" WHERE actorId='$DBUID_A' AND visibility='PUBLIC' ORDER BY createdAt DESC LIMIT 1\").get(); console.log(r.id); db.close();" 2>/dev/null | tail -1)

echo "SESS_A=${SESS_A:0:12}.. CSRF_A=${CSRF_A:0:8}.. DBUID_A=$DBUID_A"
echo "SESS_B=${SESS_B:0:12}.. CSRF_B=${CSRF_B:0:8}.. DBUID_B=$DBUID_B"
echo "A_ACT_ID=$A_ACT_ID (FRIENDS)"
echo "A_PUB_ID=$A_PUB_ID (PUBLIC)"

dbq() {
  cat > /tmp/c9bq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
  bun /tmp/c9bq.mjs 2>&1 | grep -v "^prisma"
}

# Wrapped agent-browser with timeout
ab() { timeout 30 agent-browser "$@" 2>&1 | tail -1; }

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
  local DOM=$(ab eval "(function(){return document.body.innerText.includes('Send OTP')?'LOGIN':'APP'})()")
  echo "    Consumer DOM: $DOM"
  # Reload
  ab open "$BASE/consumer" --timeout 25000
  sleep 4
  local ME2=$(ab eval "fetch('/api/auth/me').then(function(r){return r.json()}).then(function(d){return d.user?d.user.userId.substring(0,12):'NONE'}).catch(function(e){return'ERR:'+e.message})")
  echo "    Reload: $ME2"
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

goto_feed() {
  ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()"
  sleep 3
  for poll in $(seq 1 10); do
    local R=$(ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Feed')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()")
    if echo "$R" | grep -q "CLICKED"; then echo "    Feed: found at ${poll}s"; break; fi
    sleep 1
  done
  sleep 2
}

type_search() {
  ab eval "(function(){var i=document.querySelector('input[aria-label=\\\"Search for friends\\\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$1');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()"
  sleep 4
}

# =============================================================================
# PHASE 2 — BROWSER AUTH
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 2 — BROWSER AUTHENTICATION"
echo "============================================================================="
echo "  Auth A:"
browser_auth "A" "$SESS_A" "$CSRF_A" "$DBUID_A"
ab screenshot "$EVID_DIR/P2-A-auth.png"
echo "  Auth B:"
browser_auth "B" "$SESS_B" "$CSRF_B" "$DBUID_B"
ab screenshot "$EVID_DIR/P2-B-auth.png"

# =============================================================================
# PHASE 3 — ACCEPTED-FRIEND POSITIVE CONTROL (BROWSER A)
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 3 — ACCEPTED-FRIEND POSITIVE CONTROL"
echo "============================================================================="
browser_auth "A" "$SESS_A" "$CSRF_A" "$DBUID_A"
echo "  Navigate Social → Friends:"
goto_friends
ab screenshot "$EVID_DIR/P3-01-friends-accepted.png"
echo -n "  B visible (User 5002): "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'VISIBLE':'NOT_VISIBLE'})()"
echo -n "  Block control: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block ')===0&&a.indexOf('Unblock')<0)return'FOUND:'+a}return'NOT_FOUND'})()"
echo -n "  Unfriend control: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unfriend ')===0)return'FOUND'}return'NOT_FOUND'})()"
echo -n "  Network GET /api/social/connections: "
ab eval "fetch('/api/social/connections').then(function(r){return r.status}).catch(function(e){return'ERR'})"
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_friends
ab screenshot "$EVID_DIR/P3-02-after-reload.png"
echo -n "  Reload B visible: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'VISIBLE':'NOT_VISIBLE'})()"
echo -n "  DB A→B: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"
echo -n "  DB B→A: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"

# =============================================================================
# PHASE 4 — A BLOCKS B
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 4 — A BLOCKS B"
echo "============================================================================="
ab eval "window.confirm=function(){return true};'OVERRIDE'"
echo "  Click Block B:"
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block ')===0&&a.indexOf('Unblock')<0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()"
sleep 5
ab screenshot "$EVID_DIR/P4-01-after-block.png"
echo -n "  DOM: Unblock control visible: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND'}return'NOT_FOUND'})()"
echo -n "  DOM: ordinary Block absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block ')===0&&a.indexOf('Unblock')<0)return'STILL_FOUND'}return'ABSENT'})()"
echo -n "  DB A→B: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"
echo -n "  DB B→A: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"
echo -n "  DB PENDING: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
echo "  Connection row IDs:"
dbq "const rows=db.prepare('SELECT id,followerId,followeeId,status,blockedBy FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').all();rows.forEach(function(r){console.log('    id='+r.id.substring(0,12)+'.. '+(r.followerId==='$DBUID_A'?'A→B':'B→A')+' status='+r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12))})"
# Reload
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_friends
ab screenshot "$EVID_DIR/P4-02-after-reload.png"
echo -n "  Reload: Unblock visible: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND'}return'NOT_FOUND'})()"
echo -n "  Reload DB: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"
CONN_ID=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
echo "  CONN_ID=$CONN_ID"

# =============================================================================
# PHASE 5 — B RECONNECT BLOCKED
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 5 — B RECONNECT BLOCKED"
echo "============================================================================="
browser_auth "B" "$SESS_B" "$CSRF_B" "$DBUID_B"
ab screenshot "$EVID_DIR/P5-01-B-auth.png"
goto_friends
ab screenshot "$EVID_DIR/P5-02-B-friends.png"
echo "  Search for A ($A_PHONE):"
type_search "$A_PHONE"
ab screenshot "$EVID_DIR/P5-03-B-search.png"
echo -n "  DOM: A in results: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5001')>=0?'FOUND':'EXCLUDED'})()"
echo -n "  DOM: Add friend control: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request to ')===0)return'FOUND'}return'NOT_FOUND'})()"
echo "  API: POST B→A (expect 403):"
REQ_BA=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}")
echo "    Status: $REQ_BA (expected 403)"
echo -n "  Pair still BLOCKED: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"
echo -n "  PENDING delta (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
echo -n "  New FRIEND_REQUEST_RECEIVED for A (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"

# =============================================================================
# PHASE 6 — FRIENDS PRIVACY ISOLATION
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 6 — FRIENDS PRIVACY ISOLATION"
echo "============================================================================="
goto_feed
ab screenshot "$EVID_DIR/P6-01-B-feed.png"
echo -n "  DOM: A's FRIENDS activity ($A_ACT_NAME): "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('$A_ACT_NAME')>=0?'PRESENT(FAIL)':'ABSENT(OK)'})()"
echo -n "  DOM: positive-control PUBLIC ($A_PUB_NAME): "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('$A_PUB_NAME')>=0?'PRESENT(OK)':'ABSENT'})()"
echo -n "  Network GET /api/social/feed: "
ab eval "fetch('/api/social/feed?limit=20').then(function(r){return r.status}).catch(function(e){return'ERR'})"
echo -n "  API: A's FRIENDS activity in B feed (expected 0): "
curl -s "$BASE/api/social/feed?limit=20" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); found=[a for a in acts if a.get('id')=='$A_ACT_ID']; print(f'{len(found)} found')"
echo -n "  API: PUBLIC activity in B feed (expected 1): "
curl -s "$BASE/api/social/feed?limit=20" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); found=[a for a in acts if a.get('id')=='$A_PUB_ID']; print(f'{len(found)} found')"
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_feed
ab screenshot "$EVID_DIR/P6-02-after-reload.png"
echo -n "  Reload: A's FRIENDS activity: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('$A_ACT_NAME')>=0?'PRESENT(FAIL)':'ABSENT(OK)'})()"
echo -n "  DB: pair BLOCKED: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"

# =============================================================================
# PHASE 7 — BLOCKED LIKE PROTECTION
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 7 — BLOCKED LIKE PROTECTION"
echo "============================================================================="
echo -n "  Browser: target FRIENDS activity absent: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('$A_ACT_NAME')>=0?'PRESENT(FAIL)':'ABSENT(OK)'})()"
echo -n "  Browser: Like control absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Like')>=0)return'FOUND'}return'ABSENT'})()"
ab screenshot "$EVID_DIR/P7-01-like-absent.png"
echo "  API: POST B likes A's FRIENDS activity (expect 403):"
LIKE_ST=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/social/activities/$A_ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "    Status: $LIKE_ST (expected 403)"
echo -n "  Like rows delta (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$A_ACT_ID\"').get().c)"
echo -n "  SOCIAL_ACTIVITY_LIKED notif for A (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"SOCIAL_ACTIVITY_LIKED\"').get().c)"
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_feed
ab screenshot "$EVID_DIR/P7-02-after-reload.png"
echo -n "  Reload: A's activity: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('$A_ACT_NAME')>=0?'PRESENT(FAIL)':'ABSENT(OK)'})()"

# =============================================================================
# PHASE 8 — B CANNOT REMOVE A'S BLOCK
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 8 — B CANNOT REMOVE A'S BLOCK"
echo "============================================================================="
browser_auth "B" "$SESS_B" "$CSRF_B" "$DBUID_B"
goto_friends
ab screenshot "$EVID_DIR/P8-01-B-friends.png"
echo -n "  DOM: Unblock A absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND(FAIL)'}return'ABSENT(OK)'})()"
echo -n "  DOM: Unfriend A absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unfriend ')===0)return'FOUND'}return'ABSENT'})()"
echo "  API: DELETE blocked (expect 403):"
DEL_ST=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/social/connections/$CONN_ID" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "    Status: $DEL_ST (expected 403)"
echo "  API: PATCH UNBLOCK by B (expect 403):"
UNB_ST=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/social/connections/$CONN_ID" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"action":"UNBLOCK"}')
echo "    Status: $UNB_ST (expected 403)"
echo -n "  DB: pair BLOCKED intact: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_friends
ab screenshot "$EVID_DIR/P8-02-after-reload.png"
echo -n "  Reload: Unblock absent: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND(FAIL)'}return'ABSENT(OK)'})()"
echo -n "  Reload DB: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+(r.blockedBy||'NULL').substring(0,12):'NONE')"

# =============================================================================
# PHASE 9 — A UNBLOCKS B
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 9 — A UNBLOCKS B"
echo "============================================================================="
browser_auth "A" "$SESS_A" "$CSRF_A" "$DBUID_A"
goto_friends
ab screenshot "$EVID_DIR/P9-01-A-friends-blocked.png"
echo -n "  Unblock B visible: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'FOUND:'+a}return'NOT_FOUND'})()"
echo "  Click Unblock B:"
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()"
sleep 5
ab screenshot "$EVID_DIR/P9-02-after-unblock.png"
echo -n "  DOM: blocked relationship gone: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock ')===0)return'STILL_BLOCKED(FAIL)'}return'UNBLOCKED(OK)'})()"
echo -n "  DB pair rows (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c)"
echo -n "  DB PENDING (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
echo -n "  DB ACCEPTED (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"ACCEPTED\"').get().c)"
echo -n "  DB BLOCKED (expected 0): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"BLOCKED\"').get().c)"
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_friends
ab screenshot "$EVID_DIR/P9-03-after-reload.png"
echo -n "  Reload: no B visible: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5002')>=0?'VISIBLE(FAIL)':'ABSENT(OK)'})()"
echo -n "  Reload DB: pair rows = 0: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c)"

# =============================================================================
# PHASE 10 — POST-UNBLOCK RECOVERY
# =============================================================================
echo ""
echo "============================================================================="
echo "PHASE 10 — POST-UNBLOCK RECOVERY"
echo "============================================================================="
NOTIF_A_PRE=$(dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\"').get().c)")
echo "  A's notification count pre-request: $NOTIF_A_PRE"
browser_auth "B" "$SESS_B" "$CSRF_B" "$DBUID_B"
goto_friends
ab screenshot "$EVID_DIR/P10-01-B-friends.png"
echo "  Search for A ($A_PHONE):"
type_search "$A_PHONE"
ab screenshot "$EVID_DIR/P10-02-B-search.png"
echo -n "  DOM: A in results: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('5001')>=0?'FOUND':'NOT_FOUND'})()"
echo -n "  Add friend control visible: "
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request to ')===0)return'FOUND'}return'NOT_FOUND'})()"
echo "  Click Send friend request to A:"
ab eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request to ')===0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()"
sleep 5
ab screenshot "$EVID_DIR/P10-03-after-request.png"
echo -n "  DOM: Pending state: "
ab eval "(function(){var t=document.body.innerText;return t.indexOf('Pending')>=0?'PENDING(OK)':'NO_PENDING'})()"
echo -n "  DB B→A: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "  DB PENDING (expected 1): "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
ab open "$BASE/consumer" --timeout 25000; sleep 4
goto_friends
ab screenshot "$EVID_DIR/P10-04-after-reload.png"
echo -n "  Reload: B→A: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
NOTIF_A_POST=$(dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\"').get().c)")
echo "  New FRIEND_REQUEST_RECEIVED for A: $((NOTIF_A_POST - NOTIF_A_PRE)) new (expected 1)"

echo ""
echo "============================================================================="
echo "BROWSER PHASES COMPLETE"
echo "============================================================================="
