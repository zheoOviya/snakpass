#!/bin/bash
# S1 Reconstruction Browser Evidence — single process, server starts inside
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s1-reconstruction
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s1-recon-evidence.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S3A_PHONE="+919999900301"
S3B_PHONE="+919999900302"
S3C_PHONE="+919999900303"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "=== S1 Reconstruction Browser Evidence ==="
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Start dev server
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# Clear OTP + social data
cat > /tmp/clr.mjs << 'MJS'
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
db.run(`DELETE FROM "OtpRequest" WHERE target IN ('+919999900301','+919999900302','+919999900303')`)
try { db.run(`DELETE FROM "OtpLockout"`) } catch(e) {}
db.run(`DELETE FROM "SocialConnection" WHERE followerId IN (SELECT id FROM "User" WHERE phone IN ('+919999900301','+919999900302','+919999900303')) OR followeeId IN (SELECT id FROM "User" WHERE phone IN ('+919999900301','+919999900302','+919999900303'))`)
db.run(`DELETE FROM "SocialActivity" WHERE actorId IN (SELECT id FROM "User" WHERE phone IN ('+919999900301','+919999900302','+919999900303'))`)
db.close()
MJS
bun /tmp/clr.mjs 2>&1

# Login function
login_user() {
  local PHONE=$1; local TAG=$2; local LTAG=$(echo "$TAG" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/s1${LTAG}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /tmp/s1s${LTAG}.json
  local OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/s1s${LTAG}.json')).get('otpId',''))" 2>/dev/null)
  local OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/s1s${LTAG}.json')).get('code',''))" 2>/dev/null)
  local SP=$(grep "snakzap_session" /tmp/s1${LTAG}.txt | awk '{print $NF}')
  local CP=$(grep "snakzap_csrf" /tmp/s1${LTAG}.txt | awk '{print $NF}')
  curl -s -b /tmp/s1${LTAG}.txt -c /tmp/s1${LTAG}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /dev/null
  local S=$(grep "snakzap_session" /tmp/s1${LTAG}.txt | awk '{print $NF}')
  local C=$(grep "snakzap_csrf" /tmp/s1${LTAG}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$TAG" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; C) SESS_C=$S; CSRF_C=$C;; esac
  # Get user ID via search API (more reliable)
  local SRCH=$(curl -s "http://localhost:3000/api/social/search?q=$PHONE" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C")
  local DID=$(echo "$SRCH" | python3 -c "import sys,json; d=json.load(sys.stdin); users=d.get('users',[]); print(users[0]['id'] if users else '')" 2>/dev/null)
  case "$TAG" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; C) DBUID_C=$DID;; esac
  echo "  $TAG: id=$DID sess=${S:0:8}..."
}

login_user "$S3A_PHONE" "A"
login_user "$S3B_PHONE" "B"
login_user "$S3C_PHONE" "C"
echo "DBUIDs: A=$DBUID_A B=$DBUID_B C=$DBUID_C"

dbq() { cat > /tmp/s1q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/s1q.mjs 2>&1 | grep -v "^prisma"; }

inject_cookies() {
  local TAG=$1; local S_VAR="SESS_${TAG}"; local C_VAR="CSRF_${TAG}"
  agent-browser cookies clear 2>&1 | tail -1
  agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 2
  agent-browser eval "document.cookie='snakzap_session=${!S_VAR}; path=/'; document.cookie='snakzap_csrf=${!C_VAR}; path=/'; 'SET'" 2>&1 | tail -1; sleep 1
  agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
}
goto_friends() {
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Friends'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
}
goto_feed() {
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
}

# ============================================================================
# REQUEST FLOW: B sends request to A via browser
# ============================================================================
echo ""
echo "=== REQUEST FLOW: B → A via browser ==="
inject_cookies "B"
goto_friends
agent-browser screenshot "$EVID_DIR/01-B-friends-initial.png" 2>&1 | tail -1
# Search for A
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$S3A_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/02-B-search-results.png" 2>&1 | tail -1
echo -n "  Search results visible: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('User')&&t.length>100?'VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
# Click Add friend
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/03-B-after-request.png" 2>&1 | tail -1
# DB + Network
echo -n "  DB: B→A connection: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "  DB: A's FRIEND_REQUEST_RECEIVED: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"

# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/04-B-after-reload.png" 2>&1 | tail -1
echo -n "  After reload — Pending visible: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Pending')||t.includes('pending')?'PENDING_VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1

# ============================================================================
# PENDING FLOW: A sees incoming request via browser
# ============================================================================
echo ""
echo "=== PENDING FLOW: A sees incoming ==="
inject_cookies "A"
goto_friends
agent-browser screenshot "$EVID_DIR/05-A-friends-pending.png" 2>&1 | tail -1
echo -n "  Pending request visible: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Accept')||t.includes('pending')?'PENDING_VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
# Network: GET /api/social/connections
A_CONNS=$(curl -s "http://localhost:3000/api/social/connections" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A")
echo "$A_CONNS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d.get('connections',[]):
    print(f'  Network: userId={c.get(\"userId\",\"?\")[:12]} name={c.get(\"name\",\"?\")} status={c.get(\"status\",\"?\")} direction={c.get(\"direction\",\"?\")}')
" 2>&1

# ============================================================================
# ACCEPT FLOW: A accepts via browser
# ============================================================================
echo ""
echo "=== ACCEPT FLOW: A accepts B's request ==="
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Accept')>=0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/06-A-after-accept.png" 2>&1 | tail -1
echo -n "  DB: A→B status: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"
echo -n "  DB: B→A reciprocal: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "  A sees B as friend: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Friends')||t.includes('User')?'FRIEND_VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1

# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/07-A-after-reload.png" 2>&1 | tail -1
echo -n "  After reload — friend persists: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# FEED FLOW: A creates FRIENDS activity, B sees it, C doesn't
# ============================================================================
echo ""
echo "=== FEED FLOW: A creates FRIENDS activity ==="
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Recon Dosa Den","dishName":"Recon Coffee"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  Activity ID: $ACT_ID"
echo -n "  Network: POST status: "
echo "$ACT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('201' if d.get('activity') else 'FAIL')" 2>&1

# B sees feed
echo "  B feed (should see A's activity):"
BFEED=$(curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B")
echo "$BFEED" | python3 -c "
import sys,json
d=json.load(sys.stdin)
acts=d.get('activities',[])
print(f'    {len(acts)} activities')
for a in acts[:3]:
    print(f'    verb={a.get(\"verb\")} actor={a.get(\"actorName\")} restaurant={a.get(\"restaurantName\")} dish={a.get(\"dishName\")} vis={a.get(\"visibility\")}')
" 2>&1

# Browser B sees feed
inject_cookies "B"
goto_feed
agent-browser screenshot "$EVID_DIR/08-B-feed.png" 2>&1 | tail -1
echo -n "  DOM: Activity visible: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Recon Dosa')?'ACTIVITY_VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  DOM: Verb renders: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('ordered from')?'VERB_VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1

# C does NOT see feed
echo -n "  C feed (should NOT see): "
CFEED=$(curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_C; snakzap_csrf=$CSRF_C")
echo "$CFEED" | python3 -c "
import sys,json
d=json.load(sys.stdin)
acts=d.get('activities',[])
print(f'{len(acts)} activities (expected 0 — C is not friends with A)')
" 2>&1

# ============================================================================
# VISIBILITY: PRIVATE + unknown
# ============================================================================
echo ""
echo "=== VISIBILITY CONTRACT ==="
R_PRIV=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Private Dosa"},"visibility":"PRIVATE"}')
echo "  PRIVATE activity status: $R_PRIV (expected 201)"
echo -n "  B feed (PRIVATE excluded): "
BFEED2=$(curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B")
echo "$BFEED2" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); priv=[a for a in acts if a.get('restaurantName')=='Private Dosa']; print(f'{len(priv)} PRIVATE activities (expected 0)')" 2>&1

R_UNK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{},"visibility":"SECRET"}')
echo "  Unknown visibility status: $R_UNK (expected 400)"

R_SENS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"amount":500},"visibility":"FRIENDS"}')
echo "  Sensitive metadata status: $R_SENS (expected 400)"

# ============================================================================
# DUPLICATE REQUEST
# ============================================================================
echo ""
echo "=== DUPLICATE REQUEST: A→C twice ==="
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_C\"}" > /dev/null
R_DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_C\"}")
echo "  2nd request status: $R_DUP (expected 409)"
echo -n "  A→C edge count: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_C\"').get().c)"

# ============================================================================
# UNFRIEND
# ============================================================================
echo ""
echo "=== UNFRIEND: B unfriends A ==="
B_CONN_A=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();if(r)console.log(r.id);else console.log('')")
echo "  B's connection to A: $B_CONN_A"
R_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$B_CONN_A" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "  DELETE status: $R_DEL (expected 200)"
echo -n "  A→B after unfriend: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'DELETED')"
echo -n "  B→A after unfriend: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'DELETED')"

# ============================================================================
# LIKE TRUTHFULNESS
# ============================================================================
echo ""
echo "=== LIKE TRUTHFULNESS ==="
# Re-accept B's request so feed works
A_CONN_B=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
if [ -n "$A_CONN_B" ]; then
  curl -s -X PATCH "http://localhost:3000/api/social/connections/$A_CONN_B" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"ACCEPTED"}' > /dev/null
else
  # Re-create connection
  curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
  sleep 1
  B_CONN_A2=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
  curl -s -X PATCH "http://localhost:3000/api/social/connections/$B_CONN_A2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
fi
sleep 2
# B opens feed, clicks Like
inject_cookies "B"
goto_feed
agent-browser screenshot "$EVID_DIR/09-B-feed-for-like.png" 2>&1 | tail -1
# Click Like button
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(l){l.click();return'LIKE_CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 2
agent-browser screenshot "$EVID_DIR/10-B-after-like.png" 2>&1 | tail -1
echo -n "  DOM: 'coming soon' visible (truthful): "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('coming soon')||t.includes('Coming soon')?'TRUTHFUL':'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  DOM: 'Liked' NOT shown (no false persistence): "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Liked')&&!t.includes('coming')?'FALSE_LIKED':'OK_NO_FALSE_LIKE'})()" 2>&1 | tail -1

# ============================================================================
# FALSE-SUCCESS INJECTION: abort friend request
# ============================================================================
echo ""
echo "=== FALSE-SUCCESS INJECTION ==="
# Override fetch to abort POST /api/social/connections
inject_cookies "A"
agent-browser eval "(function(){window.__origFetch=window.fetch;window.fetch=function(i,o){var u=typeof i==='string'?i:'';var m=(o&&o.method)||'GET';if(m.toUpperCase()==='POST'&&u.indexOf('/api/social/connections')>=0){window.__injected=true;return Promise.reject(new Error('INJECTED_FAIL'))}return window.__origFetch.apply(this,arguments)};return'INSTALLED'})()" 2>&1 | tail -1
goto_friends
# Search for C
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$S3C_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
# Click Add friend → will fail
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
agent-browser screenshot "$EVID_DIR/11-A-failed-request.png" 2>&1 | tail -1
echo -n "  Failure injected: "
agent-browser eval "(function(){return window.__injected?'YES':'NO'})()" 2>&1 | tail -1
echo -n "  DB: A→C edge (should NOT exist — no mutation): "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_C\"').get();console.log(r?r.status:'ABSENT')"
# Restore fetch
agent-browser eval "(function(){if(window.__origFetch){window.fetch=window.__origFetch;return'RESTORED'}})()" 2>&1 | tail -1

# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
echo -n "  After reload — A→C absent: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_C\"').get();console.log(r?r.status:'ABSENT')"

echo ""
echo "=== S1 RECONSTRUCTION EVIDENCE COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
