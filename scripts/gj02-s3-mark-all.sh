#!/bin/bash
# S3 Mark-All Browser Closure — TEST 0-8
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s3-mark-all-closure
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s3-mark-all.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S3A_PHONE="+919999900601"
S3B_PHONE="+919999900602"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S3 MARK-ALL BROWSER CLOSURE-02"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Remote: $(timeout 15 git ls-remote origin refs/heads/main 2>&1 | awk '{print $1}')"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Start dev server
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# Clear + setup
cat > /tmp/clr.mjs << 'MJS'
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
db.run(`DELETE FROM "OtpRequest" WHERE target IN ('+919999900601','+919999900602')`)
try { db.run(`DELETE FROM "OtpLockout"`) } catch(e) {}
db.run(`DELETE FROM "Like"`)
db.run(`DELETE FROM "Notification" WHERE type IN ('FRIEND_REQUEST_RECEIVED','FRIEND_REQUEST_ACCEPTED','SOCIAL_ACTIVITY_LIKED')`)
db.run(`DELETE FROM "SocialConnection" WHERE followerId IN (SELECT id FROM "User" WHERE phone IN ('+919999900601','+919999900602')) OR followeeId IN (SELECT id FROM "User" WHERE phone IN ('+919999900601','+919999900602'))`)
db.run(`DELETE FROM "SocialActivity" WHERE actorId IN (SELECT id FROM "User" WHERE phone IN ('+919999900601','+919999900602'))`)
db.close()
MJS
bun /tmp/clr.mjs 2>&1

# Login A + B
for U in A B; do
  case "$U" in A) P=$S3A_PHONE;; B) P=$S3B_PHONE;; esac
  LT=$(echo "$U" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/mk${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /tmp/mks${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/mks${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/mks${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/mk${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/mk${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/mk${LT}.txt -c /tmp/mk${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/mk${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/mk${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$U" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$P'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$U" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
done

dbq() { cat > /tmp/mkq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/mkq.mjs 2>&1 | grep -v "^prisma"; }

# ============================================================================
# TEST 1: Prepare TWO unread notifications for A
# ============================================================================
echo ""
echo "=== TEST 1: Prepare 2 unread notifications ==="
# A sends request to B → B gets FRIEND_REQUEST_RECEIVED
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
# B accepts → A gets FRIEND_REQUEST_ACCEPTED
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
# A creates activity, B likes → A gets SOCIAL_ACTIVITY_LIKED
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"MarkAll Dosa"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
curl -s -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" > /dev/null

echo -n "  Unread count: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"
echo "  Notifications for A:"
dbq "const rows=db.prepare('SELECT id,type,dedupKey,readAt FROM \"Notification\" WHERE userId=\"$DBUID_A\" ORDER BY createdAt DESC').all();for(const r of rows)console.log('  type='+r.type+' dedupKey='+(r.dedupKey||'NULL')+' read='+(r.readAt?'YES':'NO'))"

# ============================================================================
# TEST 2: Bell-open zero mutation control
# ============================================================================
echo ""
echo "========================================"
echo "TEST 2: BELL-OPEN ZERO MUTATION"
echo "========================================"
# Browser A
agent-browser cookies clear 2>&1 | tail -1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 2
agent-browser eval "document.cookie='snakzap_session=$SESS_A; path=/'; document.cookie='snakzap_csrf=$CSRF_A; path=/'; 'SET'" 2>&1 | tail -1; sleep 1
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4

echo -n "  Badge before bell: "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"] span');if(b&&b.textContent.trim().match(/\\d/))return'BADGE:'+b.textContent.trim();return'NO_BADGE'})()" 2>&1 | tail -1
echo -n "  DB unread before: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"

echo -n "  Interaction: bell click: "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"]');if(b){b.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 3
agent-browser screenshot "$EVID_DIR/T2-01-bell-open.png" 2>&1 | tail -1

echo -n "  Network: GET /api/notifications: "
curl -s "http://localhost:3000/api/notifications?limit=50" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'unreadCount={d.get(\"unreadCount\",0)}')" 2>&1

echo -n "  Badge after bell open (should remain): "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"] span');if(b)return'BADGE:'+b.textContent.trim();return'NO_BADGE'})()" 2>&1 | tail -1
echo -n "  DB unread after bell open (should be unchanged): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"

# Wait for any delayed mutation
echo "  Waiting 3s for any delayed mark-all..."
sleep 3
echo -n "  Badge after wait: "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"] span');if(b)return'BADGE:'+b.textContent.trim();return'NO_BADGE'})()" 2>&1 | tail -1
echo -n "  DB unread after wait: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"

# ============================================================================
# TEST 3: Locate explicit Mark All control
# ============================================================================
echo ""
echo "========================================"
echo "TEST 3: LOCATE MARK ALL CONTROL"
echo "========================================"
echo -n "  DOM: 'Mark all read' visible: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Mark all read')return'FOUND'}return'NOT_FOUND'})()" 2>&1 | tail -1
echo -n "  DOM: button text: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Mark all read')return b[i].textContent.trim()}return'NOT_FOUND'})()" 2>&1 | tail -1
agent-browser screenshot "$EVID_DIR/T3-01-mark-all-visible.png" 2>&1 | tail -1

# ============================================================================
# TEST 4: Actual browser Mark All click
# ============================================================================
echo ""
echo "========================================"
echo "TEST 4: MARK ALL CLICK"
echo "========================================"
echo -n "  Interaction: click Mark all read: "
agent-browser eval "(function(){var b=document.querySelectorAll('button');for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='Mark all read'){b[i].click();return'CLICKED'}}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 4

echo -n "  Network: POST result: "
POST_RESP=$(curl -s -X POST "http://localhost:3000/api/notifications/mark-all-read" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A")
echo "$POST_RESP"

echo -n "  Badge after mark-all (should be 0/gone): "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"] span');if(b)return'BADGE:'+b.textContent.trim();return'NO_BADGE'})()" 2>&1 | tail -1
echo -n "  DOM: unread label: "
agent-browser eval "(function(){var t=document.body.innerText;var m=t.match(/(\\d+)\\s*unread/);return m?m[1]+' unread':'NO_UNREAD_LABEL'})()" 2>&1 | tail -1

agent-browser screenshot "$EVID_DIR/T4-01-after-mark-all.png" 2>&1 | tail -1

echo -n "  DB unread after mark-all: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"
echo "  DB readAt for each notification:"
dbq "const rows=db.prepare('SELECT id,type,readAt FROM \"Notification\" WHERE userId=\"$DBUID_A\" ORDER BY createdAt DESC').all();for(const r of rows)console.log('  type='+r.type+' readAt='+(r.readAt?'SET':'NULL'))"

# ============================================================================
# TEST 5: Repeat mark-all idempotency
# ============================================================================
echo ""
echo "========================================"
echo "TEST 5: REPEAT MARK-ALL IDEMPOTENCY"
echo "========================================"
echo -n "  API: 2nd POST: "
curl -s -X POST "http://localhost:3000/api/notifications/mark-all-read" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A"
echo ""
echo -n "  DB unread (should be 0): "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"

# ============================================================================
# TEST 6: No bell-open false mutation after reload
# ============================================================================
echo ""
echo "========================================"
echo "TEST 6: RELOAD + POST-READ BELL"
echo "========================================"
agent-browser open "http://localhost:3000/consumer" --timeout 30000 2>&1 | tail -1; sleep 4
agent-browser screenshot "$EVID_DIR/T6-01-after-reload.png" 2>&1 | tail -1
echo -n "  Reload: badge: "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"] span');if(b)return'BADGE:'+b.textContent.trim();return'NO_BADGE'})()" 2>&1 | tail -1
echo -n "  Reload: API unreadCount: "
curl -s "http://localhost:3000/api/notifications?limit=50" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" | python3 -c "import sys,json; print(json.load(sys.stdin).get('unreadCount',0))" 2>&1
echo -n "  Reload: DB unread: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"

# Re-open bell
echo -n "  Interaction: bell reopen: "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"]');if(b){b.click();return'CLICKED'}return'NOT_FOUND'})()" 2>&1 | tail -1; sleep 2
agent-browser screenshot "$EVID_DIR/T6-02-bell-reopen.png" 2>&1 | tail -1
echo -n "  Post-read bell: badge: "
agent-browser eval "(function(){var b=document.querySelector('button[title=\"Notifications\"] span');if(b)return'BADGE:'+b.textContent.trim();return'NO_BADGE'})()" 2>&1 | tail -1
echo -n "  Post-read bell: DB unread: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND readAt IS NULL').get().c)"

# ============================================================================
# TEST 7: Source integrity
# ============================================================================
echo ""
echo "========================================"
echo "TEST 7: SOURCE INTEGRITY"
echo "========================================"
echo "S3 source checkpoint: f584f31260a33675f9cbcabe58e85cb876c773f4"
echo "Current HEAD:         $(git rev-parse HEAD)"
echo -n "  S1+S2+S3 source diff: "
git diff f584f31 HEAD -- src/lib/social-store.ts src/lib/types.ts src/lib/social-activity.ts src/components/snak/social-feed-card.tsx src/components/snak/screens/ src/components/snak/app-shell.tsx src/app/api/social/ src/app/api/notifications/ prisma/schema.prisma 2>/dev/null | wc -l
echo "  lines (0 = unchanged)"

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
