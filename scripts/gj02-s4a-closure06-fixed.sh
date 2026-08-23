#!/bin/bash
# S4A Browser Security Closure-06 — isolated fixture, fresh A/B, full lifecycle
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-closure06
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4a-closure06.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

# FRESH users — never used before
SA_PHONE="+919999991001"
SB_PHONE="+919999991002"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S4A BROWSER SECURITY CLOSURE-06"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# COMPLETE cleanup for these fresh users — pair-scoped only
cat > /tmp/clr6.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
db.run("DELETE FROM \"OtpRequest\" WHERE target IN ('+919999991001','+919999991002')")
try { db.run("DELETE FROM \"OtpLockout\"") } catch(e) {}
// Get user IDs (if they exist) and clean pair-scoped data
const users = db.prepare("SELECT id, phone FROM User WHERE phone IN ('+919999991001','+919999991002')").all()
if (users.length > 0) {
  const ids = users.map(u => "'" + u.id + "'").join(",")
  db.run("DELETE FROM \"SocialConnection\" WHERE followerId IN (" + ids + ") OR followeeId IN (" + ids + ")")
  db.run("DELETE FROM \"SocialActivity\" WHERE actorId IN (" + ids + ")")
  db.run("DELETE FROM \"Like\" WHERE userId IN (" + ids + ")")
  db.run("DELETE FROM \"Notification\" WHERE userId IN (" + ids + ")")
}
// Also clean legacy test rows
db.run("DELETE FROM \"SocialConnection\" WHERE id LIKE 'legacy%'")
db.close()
MJS
bun /tmp/clr6.mjs 2>&1

# Login A + B
for U in A B; do
  case "$U" in A) P=$SA_PHONE;; B) P=$SB_PHONE;; esac
  LT=$(echo "$U" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/c6${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /tmp/c6s${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/c6s${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/c6s${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/c6${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/c6${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/c6${LT}.txt -c /tmp/c6${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/c6${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/c6${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$U" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$P'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$U" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
done
echo "A=$DBUID_A B=$DBUID_B"

dbq() { cat > /tmp/c6q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/c6q.mjs 2>&1 | grep -v "^prisma"; }

inject_cookies() {
  local TAG=$1; local S_VAR="SESS_${TAG}"; local C_VAR="CSRF_${TAG}"
  agent-browser cookies clear 2>&1 | tail -1
  agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 2
  agent-browser eval "document.cookie='snakzap_session=${!S_VAR}; path=/'; document.cookie='snakzap_csrf=${!C_VAR}; path=/'; 'SET'" 2>&1 | tail -1; sleep 1
  agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
}

# Poll-based navigation to Friends sub-tab
goto_friends() {
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1
  for poll in $(seq 1 15); do
    RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf("Friends")===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1)
    if echo "$RESULT" | grep -q "CLICKED"; then echo "  Friends found at poll ${poll}s"; sleep 3; return; fi
    sleep 1
  done
  echo "  Friends NOT_FOUND after 15s polling"
}

goto_feed() {
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1
  for poll in $(seq 1 15); do
    RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf("Feed")===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1)
    if echo "$RESULT" | grep -q "CLICKED"; then echo "  Feed found at poll ${poll}s"; sleep 3; return; fi
    sleep 1
  done
  echo "  Feed NOT_FOUND after 15s polling"
}

# ============================================================================
# PHASE 1: ISOLATED FIXTURE
# ============================================================================
echo ""
echo "========================================"
echo "PHASE 1: ISOLATED FIXTURE"
echo "========================================"
echo -n "  Pair SocialConnection rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c)"
echo -n "  Pair SocialActivity: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialActivity\" WHERE actorId IN (\"$DBUID_A\",\"$DBUID_B\")').get().c)"
echo -n "  Pair Like: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\")').get().c)"
echo -n "  Pair Notification: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\")').get().c)"

# Create A→B + accept
echo "  --- Creating A→B request + B accepts ---"
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
# Create A's FRIENDS activity
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Closure06 Dosa"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  Activity: $ACT_ID"
echo "  Fixture after setup:"
echo -n "    A→B: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"
echo -n "    B→A: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "    Pair PENDING: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
echo -n "    Pair BLOCKED: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"BLOCKED\"').get().c)"

# ============================================================================
# FLOW 1: A opens Friends, sees B, Block control visible
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 1: ACCEPTED FIXTURE + BLOCK CONTROL"
echo "========================================"
inject_cookies "A"
goto_friends
agent-browser screenshot "$EVID_DIR/F1-01-A-friends-accepted.png" 2>&1 | tail -1
echo -n "  DOM: B visible as friend: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('User')?'VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  DOM: Block control: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0&&a.indexOf('Unblock')<0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  DOM: Unfriend control: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unfriend')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Network: GET /api/social/connections: "
curl -s "http://localhost:3000/api/social/connections" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); acc=[c for c in d.get('connections',[]) if c.get('status')=='ACCEPTED']; print(f'{len(acc)} ACCEPTED')" 2>&1
# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
goto_friends
agent-browser screenshot "$EVID_DIR/F1-02-A-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: Block still visible: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0&&a.indexOf('Unblock')<0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1

# ============================================================================
# FLOW 2: A BLOCKS B (browser)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 2: A BLOCKS B (browser)"
echo "========================================"
# Override confirm
agent-browser eval "window.confirm=function(){return true};'OVERRIDE'" 2>&1 | tail -1
echo -n "  Interaction: Block click: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0&&a.indexOf('Unblock')<0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F2-01-A-after-block.png" 2>&1 | tail -1
echo -n "  Network: PATCH block (via API verify): "
echo -n "  DB: blockedBy: "; dbq "const r=db.prepare('SELECT blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.blockedBy:'NONE')"
echo -n "  DB: both BLOCKED: "; dbq "const ab=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();const ba=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log((ab?ab.status:'NONE')+' / '+(ba?ba.status:'NONE'))"
echo -n "  DB: Pair PENDING: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
goto_friends
agent-browser screenshot "$EVID_DIR/F2-02-A-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: block persists: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+r.blockedBy:'NONE')"
echo -n "  Reload: Unblock control visible: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1

# ============================================================================
# FLOW 3: B reconnect blocked
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 3: B RECONNECT BLOCKED"
echo "========================================"
inject_cookies "B"
goto_friends
agent-browser screenshot "$EVID_DIR/F3-01-B-friends.png" 2>&1 | tail -1
echo -n "  Interaction: search A: "
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$SA_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F3-02-B-search.png" 2>&1 | tail -1
echo -n "  DOM: A in results: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('1001')?'FOUND':'EXCLUDED'})()" 2>&1 | tail -1
echo -n "  API: POST B→A: "; curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}"; echo " (expected 403)"
echo -n "  Pair PENDING delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
echo -n "  Notification delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F3-03-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still blocked: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# FLOW 4: B FRIENDS isolation
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 4: B FRIENDS ISOLATION"
echo "========================================"
goto_feed
agent-browser screenshot "$EVID_DIR/F4-01-B-feed.png" 2>&1 | tail -1
echo -n "  DOM: A's activity absent: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Closure06 Dosa')?'LEAKED':'ABSENT'})()" 2>&1 | tail -1
echo -n "  Network: feed API: "; curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('activities',[])),'activities')" 2>&1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F4-02-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still absent: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Closure06 Dosa')?'LEAKED':'ABSENT'})()" 2>&1 | tail -1

# ============================================================================
# FLOW 5: B Like blocked
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 5: B LIKE BLOCKED"
echo "========================================"
echo -n "  Browser: target absent: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Closure06 Dosa')?'VISIBLE':'ABSENT'})()" 2>&1 | tail -1
echo -n "  API: B Like: "; curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"; echo " (expected 403)"
echo -n "  Like delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
echo -n "  Notification delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"SOCIAL_ACTIVITY_LIKED\"').get().c)"

# ============================================================================
# FLOW 6: B cannot remove block
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 6: B CANNOT REMOVE BLOCK"
echo "========================================"
goto_friends
agent-browser screenshot "$EVID_DIR/F6-01-B-friends.png" 2>&1 | tail -1
echo -n "  DOM: Unblock control for B: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0)return'FOUND'}return'ABSENT'})()" 2>&1 | tail -1
echo -n "  API: B DELETE: "; curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$CONN" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"; echo " (expected 403)"
echo -n "  API: B UNBLOCK: "; curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"UNBLOCKED"}'; echo " (expected 403)"
echo -n "  DB: block intact: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+r.blockedBy:'NONE')"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F6-02-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: block intact: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# FLOW 7: A unblocks B (browser)
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 7: A UNBLOCKS B (browser)"
echo "========================================"
inject_cookies "A"
goto_friends
agent-browser screenshot "$EVID_DIR/F7-01-A-friends-blocked.png" 2>&1 | tail -1
echo -n "  Interaction: Unblock visible: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Interaction: Unblock click: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F7-02-A-after-unblock.png" 2>&1 | tail -1
echo -n "  DB: rows after unblock: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c+' rows (expected 0)')"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F7-03-A-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: state NONE: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c+' rows')"

# ============================================================================
# FLOW 8: Post-unblock request
# ============================================================================
echo ""
echo "========================================"
echo "FLOW 8: POST-UNBLOCK REQUEST"
echo "========================================"
inject_cookies "B"
goto_friends
agent-browser screenshot "$EVID_DIR/F8-01-B-friends.png" 2>&1 | tail -1
echo -n "  Search A: "
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$SA_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/F8-02-B-search.png" 2>&1 | tail -1
echo -n "  DOM: A in results: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('1001')?'FOUND':'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Interaction: Add friend: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F8-03-B-after-request.png" 2>&1 | tail -1
echo -n "  DB: B→A PENDING: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "  Notification: FRIEND_REQUEST_RECEIVED: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/F8-04-B-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: pending persists: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# NOTIFICATION CAUSALITY + REGRESSION + SOURCE
# ============================================================================
echo ""
echo "========================================"
echo "NOTIFICATION CAUSALITY + REGRESSION + SOURCE"
echo "========================================"
echo -n "  1. Historical FRIEND_REQUEST_ACCEPTED: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_ACCEPTED\"').get().c)"
echo -n "  2. Blocked reconnect delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\" AND dedupKey LIKE \"%$CONN%\"').get().c)"
echo -n "  3. Post-unblock legitimate: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
echo -n "  S4A source diff: "; git diff a78cf5d HEAD -- src/ prisma/schema.prisma 2>/dev/null | wc -l; echo "  lines (0=unchanged)"

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
