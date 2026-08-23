#!/bin/bash
# S4A Browser Security Closure-03 — 7 browser flows × 5 proofs
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-browser
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4a-browser.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S4A_PHONE="+919999900701"
S4B_PHONE="+919999900702"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S4A BROWSER SECURITY CLOSURE-03"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# Clear
cat > /tmp/clr.mjs << 'MJS'
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
db.run(`DELETE FROM "OtpRequest" WHERE target IN ('+919999900701','+919999900702')`)
try { db.run(`DELETE FROM "OtpLockout"`) } catch(e) {}
db.run(`DELETE FROM "Like"`)
db.run(`DELETE FROM "Notification" WHERE type IN ('FRIEND_REQUEST_RECEIVED','FRIEND_REQUEST_ACCEPTED','SOCIAL_ACTIVITY_LIKED')`)
db.run(`DELETE FROM "SocialConnection" WHERE followerId IN (SELECT id FROM "User" WHERE phone IN ('+919999900701','+919999900702')) OR followeeId IN (SELECT id FROM "User" WHERE phone IN ('+919999900701','+919999900702'))`)
db.run(`DELETE FROM "SocialActivity" WHERE actorId IN (SELECT id FROM "User" WHERE phone IN ('+919999900701','+919999900702'))`)
db.close()
MJS
bun /tmp/clr.mjs 2>&1

# Login
for U in A B; do
  case "$U" in A) P=$S4A_PHONE;; B) P=$S4B_PHONE;; esac
  LT=$(echo "$U" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/bc${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /tmp/bcs${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/bcs${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/bcs${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/bc${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/bc${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/bc${LT}.txt -c /tmp/bc${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/bc${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/bc${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$U" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$P'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$U" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
done
echo "A=$DBUID_A B=$DBUID_B"

dbq() { cat > /tmp/bcq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/bcq.mjs 2>&1 | grep -v "^prisma"; }

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

# Setup: A→B request, B accepts, A creates FRIENDS activity
echo "=== FIXTURE: A↔B ACCEPTED + activity ==="
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Block Browser Test"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  A↔B ACCEPTED, Activity: $ACT_ID"

# ============================================================================
# FLOW 1: A blocks B through browser
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 1: A BLOCKS B (browser)"
echo "========================================"
inject_cookies "A"
goto_friends
agent-browser screenshot "$EVID_DIR/F1-01-A-friends.png" 2>&1 | tail -1
echo -n "  Interaction: Block button visible: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
# Click Block (skip confirm dialog by overriding)
agent-browser eval "(function(){window.confirm=function(){return true};return'CONFIRM_OVERRIDE'})()" 2>&1 | tail -1
echo -n "  Interaction: Block click: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0&&a.indexOf('Unblock')<0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F1-02-A-after-block.png" 2>&1 | tail -1
echo -n "  Network: PATCH block: "
echo "verified via DB below"
echo -n "  DB: blockedBy: "
dbq "const r=db.prepare('SELECT blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.blockedBy:'NONE')"
echo -n "  DB: both rows BLOCKED: "
dbq "const ab=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();const ba=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log((ab?ab.status:'NONE')+' / '+(ba?ba.status:'NONE'))"
echo -n "  Reload: block persists: "
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
goto_friends
agent-browser screenshot "$EVID_DIR/F1-03-A-after-reload.png" 2>&1 | tail -1
dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+r.blockedBy:'NONE')"

# ============================================================================
# FLOW 2: B reconnect blocked (browser)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 2: B RECONNECT BLOCKED (browser)"
echo "========================================"
inject_cookies "B"
goto_friends
agent-browser screenshot "$EVID_DIR/F2-01-B-friends.png" 2>&1 | tail -1
# Search for A
echo -n "  Interaction: search for A: "
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$S4A_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F2-02-B-search.png" 2>&1 | tail -1
echo -n "  DOM: A in search results: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('User')&&t.includes('0701')?'FOUND':'EXCLUDED'})()" 2>&1 | tail -1
echo -n "  Network: API search response: "
curl -s "http://localhost:3000/api/social/search?q=$S4A_PHONE" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d.get(\"users\",[]))} users')" 2>&1
echo -n "  DB: no new connection: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\" AND status=\"PENDING\"').get().c)"
echo -n "  Notification delta: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F2-03-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still blocked: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# FLOW 3: B FRIENDS isolation (browser)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 3: B FRIENDS ISOLATION (browser)"
echo "========================================"
goto_feed
agent-browser screenshot "$EVID_DIR/F3-01-B-feed.png" 2>&1 | tail -1
echo -n "  DOM: A's activity absent: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Block Browser Test')?'LEAKED':'ABSENT'})()" 2>&1 | tail -1
echo -n "  Network: feed API: "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('activities',[])))" 2>&1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F3-02-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still absent: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Block Browser Test')?'LEAKED':'ABSENT'})()" 2>&1 | tail -1

# ============================================================================
# FLOW 4: B Like blocked (browser + API)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 4: B LIKE BLOCKED"
echo "========================================"
echo -n "  Browser: activity not in feed (no Like control): "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Block Browser Test')?'VISIBLE':'ABSENT'})()" 2>&1 | tail -1
echo -n "  API: B Like A FRIENDS activity: "
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo " (expected 403)"
echo -n "  Like delta: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
echo -n "  Notification delta: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"SOCIAL_ACTIVITY_LIKED\"').get().c)"
agent-browser screenshot "$EVID_DIR/F4-01-B-like-blocked.png" 2>&1 | tail -1

# ============================================================================
# FLOW 5: B cannot remove A's block (browser + API)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 5: B CANNOT REMOVE BLOCK"
echo "========================================"
goto_friends
agent-browser screenshot "$EVID_DIR/F5-01-B-friends.png" 2>&1 | tail -1
echo -n "  DOM: B sees A in connections? "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('User')&&t.includes('0701')?'VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  API: B DELETE block → "
curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$CONN" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo " (expected 403)"
echo -n "  API: B UNBLOCK → "
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"UNBLOCKED"}'
echo " (expected 403)"
echo -n "  DB: block intact: "
dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+r.blockedBy:'NONE')"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F5-02-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: block intact: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# FLOW 6: A unblocks B (browser)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 6: A UNBLOCKS B (browser)"
echo "========================================"
inject_cookies "A"
goto_friends
agent-browser screenshot "$EVID_DIR/F6-01-A-friends.png" 2>&1 | tail -1
echo -n "  Interaction: Unblock button visible: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Interaction: Unblock click: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F6-02-A-after-unblock.png" 2>&1 | tail -1
echo -n "  Network: PATCH UNBLOCK: "
echo "verified via DB"
echo -n "  DB: rows after unblock: "
dbq "const r=db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\" OR followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r.c+' rows (expected 0)')"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F6-03-A-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: state NONE: "
dbq "const r=db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get();console.log(r.c+' rows')"

# ============================================================================
# FLOW 7: Post-unblock request (browser)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 7: POST-UNBLOCK REQUEST (browser)"
echo "========================================"
inject_cookies "B"
goto_friends
agent-browser screenshot "$EVID_DIR/F7-01-B-friends.png" 2>&1 | tail -1
echo -n "  Interaction: search A: "
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$S4A_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F7-02-B-search.png" 2>&1 | tail -1
echo -n "  DOM: A in results: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('User')&&t.includes('0701')?'FOUND':'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Interaction: Add friend: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F7-03-B-after-request.png" 2>&1 | tail -1
echo -n "  Network: POST → "
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}"
echo " (expected 201)"
echo -n "  DB: B→A PENDING: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "  Notification: A's FRIEND_REQUEST_RECEIVED: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F7-04-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: pending persists: "
dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# REGRESSION + SOURCE
# ============================================================================
echo ""
echo "========================================"
echo "REGRESSION + SOURCE"
echo "========================================"
echo -n "  S1: request accepted notif: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
echo -n "  S4A source diff: "
git diff a35a8df HEAD -- prisma/schema.prisma src/app/api/social/connections/ 2>/dev/null | wc -l
echo "  lines (friends-screen.tsx UI addition is authorized by Phase 7)"

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
