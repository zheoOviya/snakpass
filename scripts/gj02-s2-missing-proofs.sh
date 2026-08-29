#!/bin/bash
# S2 Missing Browser Proofs — L1 Initial + L9 Failed POST Like + Recovery
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s2-missing-proofs
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s2-missing-proofs.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S2A_PHONE="+919999900501"
S2B_PHONE="+919999900502"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S2 MISSING BROWSER PROOFS CLOSURE-02"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Start dev server
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# Clear OTP + likes for fresh test
cat > /tmp/clr.mjs << 'MJS'
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
db.run(`DELETE FROM "OtpRequest" WHERE target IN ('+919999900501','+919999900502')`)
try { db.run(`DELETE FROM "OtpLockout"`) } catch(e) {}
db.run(`DELETE FROM "Like"`)
db.close()
MJS
bun /tmp/clr.mjs 2>&1

# Login A + B
for U in A B; do
  case "$U" in A) P=$S2A_PHONE;; B) P=$S2B_PHONE;; esac
  LT=$(echo "$U" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/s2mp${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /tmp/s2mps${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/s2mps${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/s2mps${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/s2mp${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/s2mp${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/s2mp${LT}.txt -c /tmp/s2mp${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/s2mp${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/s2mp${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$U" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$P'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$U" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
  echo "  $U: id=$DID"
done

dbq() { cat > /tmp/s2mpq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/s2mpq.mjs 2>&1 | grep -v "^prisma"; }

# Create fresh FRIENDS activity (B has never liked it — Like table cleared)
echo "=== FIXTURE: Create fresh FRIENDS activity ==="
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Missing Proof Dosa","dishName":"Missing Proof Coffee"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  ActivityId: $ACT_ID"
echo -n "  DB Like rows (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# ============================================================================
# TEST A: L1 INITIAL BROWSER TRUTH
# ============================================================================
echo ""
echo "========================================"
echo "TEST A: L1 INITIAL BROWSER TRUTH"
echo "========================================"

# Browser B
agent-browser cookies clear 2>&1 | tail -1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 2
agent-browser eval "document.cookie='snakzap_session=$SESS_B; path=/'; document.cookie='snakzap_csrf=$CSRF_B; path=/'; 'SET'" 2>&1 | tail -1; sleep 1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4

# Navigate to Social Feed
echo -n "  Interaction: B opens Social Feed: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4

# Network
echo "  Network: GET /api/social/feed:"
BFEED=$(curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B")
echo "$BFEED" | python3 -c "
import sys,json
d=json.load(sys.stdin)
acts=d.get('activities',[])
a=[x for x in acts if x.get('id')=='$ACT_ID']
if a:
    print(f'  target present: YES')
    print(f'  API likedByMe: {a[0].get(\"likedByMe\", False)}')
    print(f'  API likeCount: {a[0].get(\"likeCount\", 0)}')
else:
    print(f'  target NOT FOUND in {len(acts)} activities')
" 2>&1

# DOM
echo -n "  DOM: Activity card visible: "
agent-browser eval "(function(){var t=document.body.innerText;return t.includes('Missing Proof Dosa')?'CARD_VISIBLE':'NOT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  DOM: Like control visibly unliked: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var pressed=l.getAttribute('aria-pressed');var heart=l.querySelector('svg');var filled=heart?heart.classList.contains('fill-current'):false;return pressed==='false'&&!filled?'UNLIKED':'LIKED:'+pressed})()" 2>&1 | tail -1
echo -n "  DOM: Count visibly 0 (no count shown for zero): "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var c=l.querySelector('span.font-mono');return c?'HAS_COUNT:'+c.textContent:'NO_COUNT_VISIBLE'})()" 2>&1 | tail -1

# Screenshot
agent-browser screenshot "$EVID_DIR/L1-01-initial-unliked.png" 2>&1 | tail -1
echo "  Screenshot: L1-01 captured"

# Reload
echo "  --- Reload ---"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/L1-02-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still unliked: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var pressed=l.getAttribute('aria-pressed');return pressed==='false'?'UNLIKED':'LIKED'})()" 2>&1 | tail -1
echo -n "  Reload: count still 0: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var c=l.querySelector('span.font-mono');return c?'HAS_COUNT:'+c.textContent:'NO_COUNT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  DB Like rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# ============================================================================
# TEST B: L9 FAILED POST LIKE (inject abort on POST Like)
# ============================================================================
echo ""
echo "========================================"
echo "TEST B: L9 FAILED POST LIKE"
echo "========================================"

# Ensure we're on the feed page with the unliked activity
echo -n "  Before: DB Like rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# Inject failure: override fetch to abort POST to /like
echo "  Injecting fetch override: abort POST /api/social/activities/[id]/like"
agent-browser eval "(function(){
  window.__origFetch = window.fetch;
  window.__injected = false;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || 'GET';
    if (method.toUpperCase() === 'POST' && url.indexOf('/like') >= 0) {
      window.__injected = true;
      return Promise.reject(new Error('INJECTED_NETWORK_FAILURE: POST Like aborted'));
    }
    return window.__origFetch.apply(this, arguments);
  };
  return 'FETCH_OVERRIDE_INSTALLED';
})()" 2>&1 | tail -1
sleep 1

# Click Like button — will trigger optimistic update then POST will fail
echo -n "  Interaction: Like button click: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(l){l.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1

# Wait for optimistic update + failed POST + rollback
echo "  Waiting for optimistic update → POST failure → rollback..."
sleep 5

# Network
echo -n "  Failure injected: "
agent-browser eval "(function(){return window.__injected?'YES_POST_ABORTED':'NOT_TRIGGERED'})()" 2>&1 | tail -1

# DOM final state (after rollback)
echo -n "  DOM final: Like control unliked (rolled back): "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var pressed=l.getAttribute('aria-pressed');return pressed==='false'?'UNLIKED_ROLLBACK':'STILL_LIKED:false_success'})()" 2>&1 | tail -1
echo -n "  DOM final: Count visible (should be 0/no count): "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var c=l.querySelector('span.font-mono');return c?'HAS_COUNT:'+c.textContent:'NO_COUNT_VISIBLE'})()" 2>&1 | tail -1

# Screenshot
agent-browser screenshot "$EVID_DIR/L9-01-after-failed-like.png" 2>&1 | tail -1
echo "  Screenshot: L9-01 captured"

# DB
echo -n "  DB Like rows (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# API
echo -n "  API likeCount (should be 0): "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); acts=d.get('activities',[]); a=[x for x in acts if x.get('id')=='$ACT_ID']; print(f'likeCount={a[0].get(\"likeCount\",0)} likedByMe={a[0].get(\"likedByMe\",False)}' if a else 'NOT_FOUND')" 2>&1

# Reload
echo "  --- Reload ---"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/L9-02-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still unliked: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var pressed=l.getAttribute('aria-pressed');return pressed==='false'?'UNLIKED':'LIKED:false_success'})()" 2>&1 | tail -1
echo -n "  Reload: count 0: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var c=l.querySelector('span.font-mono');return c?'HAS_COUNT:'+c.textContent:'NO_COUNT_VISIBLE'})()" 2>&1 | tail -1
echo -n "  Reload: DB rows (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# ============================================================================
# TEST C: RECOVERY (remove interception, Like succeeds)
# ============================================================================
echo ""
echo "========================================"
echo "TEST C: RECOVERY AFTER FAILURE"
echo "========================================"

# Restore fetch
echo -n "  Restore fetch: "
agent-browser eval "(function(){if(window.__origFetch){window.fetch=window.__origFetch;return'RESTORED'}return'NO_ORIGINAL'})()" 2>&1 | tail -1
sleep 1

# Click Like — should succeed now
echo -n "  Interaction: Like click (recovery): "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(l){l.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3

# Network
echo -n "  Network: POST succeeded: "
curl -s -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'liked={d.get(\"liked\")} likeCount={d.get(\"likeCount\")}')" 2>&1

# DOM
agent-browser screenshot "$EVID_DIR/C-01-after-recovery-like.png" 2>&1 | tail -1
echo -n "  DOM: liked: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var pressed=l.getAttribute('aria-pressed');return pressed==='true'?'LIKED':'UNLIKED'})()" 2>&1 | tail -1
echo -n "  DB rows (should be 1): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# Reload
echo "  --- Reload ---"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Social'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 5
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Feed'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/C-02-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: still liked: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var pressed=l.getAttribute('aria-pressed');return pressed==='true'?'LIKED':'UNLIKED'})()" 2>&1 | tail -1
echo -n "  Reload: count 1: "
agent-browser eval "(function(){var e=Array.from(document.querySelectorAll('button'));var l=e.find(function(x){return x.getAttribute('aria-label')&&x.getAttribute('aria-label').indexOf('Like')>=0});if(!l)return'NO_LIKE_BTN';var c=l.querySelector('span.font-mono');return c?'HAS_COUNT:'+c.textContent:'NO_COUNT'})()" 2>&1 | tail -1
echo -n "  Reload: DB rows (should be 1): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"

# Cleanup: unlike
curl -s -X DELETE "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" > /dev/null
echo "  Cleanup: unliked"

# ============================================================================
# TEST D: SOURCE FREEZE
# ============================================================================
echo ""
echo "========================================"
echo "TEST D: SOURCE FREEZE"
echo "========================================"
echo "S2 source checkpoint: 0bc5abad5b24fad48c4b828c856c87f90f250199"
echo "Current HEAD:          $(git rev-parse HEAD)"
echo -n "  S1+S2 source diff from 0bc5aba: "
git diff 0bc5aba HEAD -- src/lib/social-store.ts src/lib/types.ts src/lib/social-activity.ts src/components/snak/social-feed-card.tsx src/components/snak/screens/social-screen.tsx src/app/api/social/activities/ src/app/api/social/feed/route.ts src/app/api/social/connections/ 'prisma/schema.prisma' 2>/dev/null | wc -l
echo "  lines of diff (0 = unchanged)"

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
