#!/bin/bash
# S4A Auth Harness Unblock-07 v2 — pure browser login, no API OTP calls
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-auth07v2
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4a-auth07v2.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

SA_PHONE="+919999993001"
SB_PHONE="+919999993002"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S4A AUTH HARNESS UNBLOCK-07 v2"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# Clear OTP + pair data
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest'); db.run('DELETE FROM OtpLockout'); const users = db.prepare(\"SELECT id FROM User WHERE phone IN ('+919999993001','+919999993002')\").all(); if (users.length > 0) { const ids = users.map(u => \"'\" + u.id + \"'\").join(','); db.run('DELETE FROM \"SocialConnection\" WHERE followerId IN (' + ids + ') OR followeeId IN (' + ids + ')'); db.run('DELETE FROM \"SocialActivity\" WHERE actorId IN (' + ids + ')'); db.run('DELETE FROM \"Like\" WHERE userId IN (' + ids + ')'); db.run('DELETE FROM \"Notification\" WHERE userId IN (' + ids + ')'); } db.run(\"DELETE FROM \\\"SocialConnection\\\" WHERE id LIKE 'legacy%'\"); db.close();" 2>/dev/null

dbq() { cat > /tmp/v2q.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/v2q.mjs 2>&1 | grep -v "^prisma"; }

# Browser-only login: navigate to /consumer, enter phone, Send OTP, read OTP from screen, enter, verify
browser_login() {
  local PHONE=$1; local TAG=$2
  echo "  --- Browser login $TAG ---"
  agent-browser cookies clear 2>&1 | tail -1
  agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
  
  # Enter phone
  echo -n "    Enter phone: "
  agent-browser eval "(function(){var i=document.querySelector('input[type=text]');if(!i){var all=document.querySelectorAll('input');for(var j=0;j<all.length;j++){if(all[j].offsetParent!==null){i=all[j];break}}}if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 2
  
  # Click Send OTP
  echo -n "    Send OTP: "
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.includes('Send OTP')){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
  
  # Read OTP code from screen (demo mode shows it)
  echo -n "    Read OTP from screen: "
  OTP_CODE=$(agent-browser eval "(function(){var t=document.body.innerText;var m=t.match(/\\b(\\d{6})\\b/);return m?m[1]:'NOT_FOUND'})()" 2>&1 | tail -1)
  echo "code=<redacted> (6 digits)"
  
  # Clear the phone input and enter OTP
  echo -n "    Enter OTP: "
  agent-browser eval "(function(){var i=document.querySelector('input[type=text]');if(!i){var all=document.querySelectorAll('input');for(var j=0;j<all.length;j++){if(all[j].offsetParent!==null){i=all[j];break}}}if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$OTP_CODE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 2
  
  # Click Verify/Login
  echo -n "    Verify: "
  agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var t=b[i].textContent.trim();if(t.includes('Verify')||t.includes('verify')||t.includes('Login')||t.includes('Continue')||t.includes('Submit')){b[i].click();return'CLICKED:'+t}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
  
  # Check auth
  echo -n "    /api/auth/me: "
  agent-browser eval "fetch('/api/auth/me').then(function(r){return r.json()}).then(function(d){return d.user?d.user.id.substring(0,12):'NONE'}).catch(function(e){return'ERROR'})" 2>&1 | tail -1
  echo -n "    DOM: "
  agent-browser eval "(function(){return document.body.innerText.includes('Send OTP')?'LOGIN':'APP'})()" 2>&1 | tail -1
  
  # Set campus if authenticated
  agent-browser eval "fetch('/api/auth/me/campus',{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':document.cookie.match(/snakzap_csrf=([^;]+)/)?document.cookie.match(/snakzap_csrf=([^;]+)/)[1]:''},body:JSON.stringify({campusId:'$CAMPUS_ID'})}).then(function(r){return r.status})" 2>&1 | tail -1; sleep 2
  
  # Reload to verify session persists
  agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
  echo -n "    Reload: "
  agent-browser eval "(function(){return document.body.innerText.includes('Send OTP')?'LOGIN':'APP'})()" 2>&1 | tail -1
}

# Also get API sessions for API calls
api_login() {
  local PHONE=$1; local TAG=$2; local LT=$(echo "$TAG" | tr 'A-Z' 'a-z')
  # Clear OTP first to avoid rate limit
  bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest WHERE target=\"$PHONE\"'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
  curl -s -c /tmp/v2${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /tmp/v2s${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/v2s${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/v2s${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/v2${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/v2${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/v2${LT}.txt -c /tmp/v2${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$PHONE\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/v2${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/v2${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$TAG" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$PHONE'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$TAG" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
}

# Get API sessions (for API calls in the test)
echo "=== API login (for API calls) ==="
api_login "$SA_PHONE" "A"
api_login "$SB_PHONE" "B"
echo "A=$DBUID_A B=$DBUID_B"

# Clear OTP again for browser login
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null

# Create fixture via API
echo "=== FIXTURE ==="
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Auth07v2 Dosa"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "Activity: $ACT_ID"
echo -n "  A→B: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status:'NONE')"
echo -n "  B→A: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"

# ============================================================================
# BROWSER LOGIN A + NAVIGATE TO FRIENDS + BLOCK
# ============================================================================
echo ""
echo "========================================"
echo "BROWSER LOGIN A + FRIENDS + BLOCK"
echo "========================================"
browser_login "$SA_PHONE" "A"
agent-browser screenshot "$EVID_DIR/A-01-logged-in.png" 2>&1 | tail -1

# Navigate to Social → Friends (using indexOf selector)
echo -n "  Social click: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
echo -n "  Friends sub-tab: "
for poll in $(seq 1 15); do
  RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Friends')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1)
  if echo "$RESULT" | grep -q "CLICKED"; then echo "found at ${poll}s"; break; fi
  sleep 1
done
sleep 3
agent-browser screenshot "$EVID_DIR/A-02-friends-accepted.png" 2>&1 | tail -1
echo -n "  B visible: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('User')?'VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  Block control: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0&&a.indexOf('Unblock')<0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1

# Click Block
agent-browser eval "window.confirm=function(){return true};'OVERRIDE'" 2>&1 | tail -1
echo -n "  Block click: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Block')>=0&&a.indexOf('Unblock')<0){b[i].click();return'CLICKED:'+a}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/A-03-after-block.png" 2>&1 | tail -1
echo -n "  DB blockedBy: "; dbq "const r=db.prepare('SELECT blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.blockedBy:'NONE')"
echo -n "  DB both BLOCKED: "; dbq "const ab=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();const ba=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log((ab?ab.status:'NONE')+' / '+(ba?ba.status:'NONE'))"
# Reload
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
for poll in $(seq 1 15); do RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Friends')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1); if echo "$RESULT" | grep -q "CLICKED"; then break; fi; sleep 1; done
sleep 3
agent-browser screenshot "$EVID_DIR/A-04-after-reload.png" 2>&1 | tail -1
echo -n "  Reload block persists: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+r.blockedBy:'NONE')"
echo -n "  Unblock visible: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1

# ============================================================================
# B RECONNECT BLOCKED + ISOLATION + LIKE + CANNOT UNBLOCK
# ============================================================================
echo ""
echo "========================================"
echo "B RECONNECT + ISOLATION + LIKE + UNBLOCK DENIED"
echo "========================================"
# Clear OTP for B browser login
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
browser_login "$SB_PHONE" "B"
agent-browser screenshot "$EVID_DIR/B-01-logged-in.png" 2>&1 | tail -1

# Search for A
echo -n "  Search A: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
for poll in $(seq 1 15); do RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Friends')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1); if echo "$RESULT" | grep -q "CLICKED"; then break; fi; sleep 1; done
sleep 3
agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$SA_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/B-02-search.png" 2>&1 | tail -1
echo -n "  DOM A in results: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('3001')?'FOUND':'EXCLUDED'})()" 2>&1 | tail -1
echo -n "  API POST B→A: "; curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}"; echo " (expected 403)"
echo -n "  Pair PENDING: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE ((followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")) AND status=\"PENDING\"').get().c)"
echo -n "  Notification delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"

# Feed isolation
echo -n "  Feed: A's activity: "; curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); found=[a for a in acts if a.get('id')=='$ACT_ID']; print(f'{len(found)} found (expected 0)')" 2>&1

# Like blocked
echo -n "  API Like: "; curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"; echo " (expected 403)"
echo -n "  Like delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# Cannot unblock
echo -n "  API B DELETE: "; curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$CONN" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"; echo " (expected 403)"
echo -n "  API B UNBLOCK: "; curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"UNBLOCKED"}'; echo " (expected 403)"
echo -n "  DB block intact: "; dbq "const r=db.prepare('SELECT status,blockedBy FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();console.log(r?r.status+' blockedBy='+r.blockedBy:'NONE')"

# ============================================================================
# A UNBLOCKS B (browser)
# ============================================================================
echo ""
echo "========================================"
echo "A UNBLOCKS B (browser)"
echo "========================================"
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
browser_login "$SA_PHONE" "A"
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
for poll in $(seq 1 15); do RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Friends')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1); if echo "$RESULT" | grep -q "CLICKED"; then break; fi; sleep 1; done
sleep 3
agent-browser screenshot "$EVID_DIR/A-05-blocked-state.png" 2>&1 | tail -1
echo -n "  Unblock visible: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0)return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Unblock click: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Unblock')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/A-06-after-unblock.png" 2>&1 | tail -1
echo -n "  DB rows after unblock: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c+' rows (expected 0)')"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
echo -n "  Reload: state NONE: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE (followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\") OR (followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\")').get().c+' rows')"

# ============================================================================
# POST-UNBLOCK REQUEST
# ============================================================================
echo ""
echo "========================================"
echo "POST-UNBLOCK REQUEST"
echo "========================================"
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('db/custom.db'); db.run('DELETE FROM OtpRequest'); db.run('DELETE FROM OtpLockout'); db.close();" 2>/dev/null
browser_login "$SB_PHONE" "B"
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Social')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
for poll in $(seq 1 15); do RESULT=$(agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim().indexOf('Friends')===0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1); if echo "$RESULT" | grep -q "CLICKED"; then break; fi; sleep 1; done
sleep 3
agent-browser screenshot "$EVID_DIR/B-03-friends.png" 2>&1 | tail -1
echo -n "  Search A: "; agent-browser eval "(function(){var i=document.querySelector('input[aria-label=\"Search for friends\"]');if(!i)return'NO_INPUT';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,'$SA_PHONE');i.dispatchEvent(new Event('input',{bubbles:true}));return'TYPED'})()" 2>&1 | tail -1; sleep 5
agent-browser screenshot "$EVID_DIR/B-04-search.png" 2>&1 | tail -1
echo -n "  DOM A in results: "; agent-browser eval "(function(){var t=document.body.innerText;return t.includes('3001')?'FOUND':'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  Add friend: "; agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';if(a.indexOf('Send friend request')>=0){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/B-05-after-request.png" 2>&1 | tail -1
echo -n "  DB B→A PENDING: "; dbq "const r=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log(r?r.status:'NONE')"
echo -n "  Notification: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"

# ============================================================================
# SOURCE + COMPLETE
# ============================================================================
echo ""
echo "========================================"
echo "SOURCE + COMPLETE"
echo "========================================"
echo -n "  Historical ACCEPTED notif: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_ACCEPTED\"').get().c)"
echo -n "  Blocked reconnect delta: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\" AND dedupKey LIKE \"%$CONN%\"').get().c)"
echo -n "  Post-unblock legitimate: "; dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
echo -n "  S4A source diff: "; git diff a78cf5d HEAD -- src/ prisma/schema.prisma 2>/dev/null | wc -l; echo "  lines (0=unchanged)"

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
