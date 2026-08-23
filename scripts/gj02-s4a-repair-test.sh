#!/bin/bash
# S4A Block Security Repair — Negative Suite N1-N13 + Browser journeys
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-repair
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4a-repair.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S4A_PHONE="+919999900701"
S4B_PHONE="+919999900702"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S4A BLOCK SECURITY REPAIR — N1-N13 + BROWSER"
echo "========================================"
echo "HEAD: $(git rev-parse HEAD)"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 2; rm -f dev.log
EVIDENCE_TEST_MODE=true setsid bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null); [ "$c" = "200" ] && { echo "ready ${i}s"; break; }; sleep 2; done

# Clear + setup
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

# Login A + B
for U in A B; do
  case "$U" in A) P=$S4A_PHONE;; B) P=$S4B_PHONE;; esac
  LT=$(echo "$U" | tr 'A-Z' 'a-z')
  curl -s -c /tmp/rp${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /tmp/rps${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/rps${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/rps${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/rp${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/rp${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/rp${LT}.txt -c /tmp/rp${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/rp${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/rp${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$U" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$P'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$U" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
done
echo "A=$DBUID_A B=$DBUID_B"

dbq() { cat > /tmp/rpq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/rpq.mjs 2>&1 | grep -v "^prisma"; }

show_conns() {
  dbq "const rows=db.prepare('SELECT id,followerId,followeeId,status,blockedBy FROM \"SocialConnection\" WHERE followerId IN (\"$DBUID_A\",\"$DBUID_B\") OR followeeId IN (\"$DBUID_A\",\"$DBUID_B\")').all();if(rows.length===0)console.log('  (none)');for(const r of rows){const f=r.followerId===\"$DBUID_A\"?'A':(r.followerId===\"$DBUID_B\"?'B':r.followerId.substring(0,8));const e=r.followeeId===\"$DBUID_A\"?'A':(r.followeeId===\"$DBUID_B\"?'B':r.followeeId.substring(0,8));console.log('  '+f+'→'+e+' status='+r.status+' blockedBy='+(r.blockedBy||'NULL'))}"
}

show_notifs() {
  dbq "const rows=db.prepare('SELECT id,userId,type,dedupKey FROM \"Notification\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\") ORDER BY createdAt DESC').all();if(rows.length===0)console.log('  (none)');for(const r of rows){const u=r.userId===\"$DBUID_A\"?'A':'B';console.log('  user='+u+' type='+r.type+' dedupKey='+(r.dedupKey||'NULL'))}"
}

# Setup: A→B request, B accepts, A blocks B
echo ""
echo "=== SETUP: A↔B ACCEPTED → A blocks B ==="
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
echo "  A↔B ACCEPTED"
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"BLOCKED"}' > /dev/null
echo "  A blocked B"
show_conns

# ============================================================================
# NEGATIVE SUITE N1-N13
# ============================================================================
echo ""
echo "========================================"
echo "NEGATIVE SUITE N1-N13"
echo "========================================"

echo "--- N1: B request A after block ---"
echo -n "  HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}"
echo " (expected 403)"
echo -n "  DB new connection rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\" AND status=\"PENDING\"').get().c)"
echo -n "  New notifications: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\" AND createdAt > datetime('now','-10 seconds')').get().c)"
show_conns

echo "--- N2: A request B while block active ---"
echo -n "  HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}"
echo " (expected 403 — blocked pair, both directions)"

echo "--- N3: B generic DELETE on A-owned BLOCKED row ---"
echo -n "  HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$CONN" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo " (expected 403)"
echo "  DB after (block intact):"
show_conns

echo "--- N4: B explicit UNBLOCK attempt ---"
echo -n "  HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"UNBLOCKED"}'
echo " (expected 403)"
echo "  DB after (block intact):"
show_conns

echo "--- N5: A explicit UNBLOCK ---"
echo -n "  HTTP: "
curl -s -w "\n%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"UNBLOCKED"}'
echo ""
echo "  DB after unblock:"
show_conns

echo "--- N6: B request A after legitimate unblock ---"
echo -n "  HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}"
echo " (expected 201 — allowed after unblock)"
show_conns

# Re-setup for N7-N9
echo ""
echo "--- Re-setup: A→B + accept + block ---"
dbq "db.run('DELETE FROM \"SocialConnection\" WHERE followerId IN (\"$DBUID_A\",\"$DBUID_B\") OR followeeId IN (\"$DBUID_A\",\"$DBUID_B\")');db.run('DELETE FROM \"Notification\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\")')"
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN2=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
# Create activity before block
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Block Test"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"BLOCKED"}' > /dev/null
echo "  Blocked. DB:"
show_conns

echo "--- N7: B GET FRIENDS activity ---"
echo -n "  Feed activities: "
curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('activities',[])))" 2>&1

echo "--- N8: B Like FRIENDS activity ---"
echo -n "  HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo " (expected 403)"
echo -n "  Like rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT_ID\"').get().c)"
echo -n "  Like notifications: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"SOCIAL_ACTIVITY_LIKED\"').get().c)"

echo "--- N9: Post-block notification check ---"
echo -n "  A's FRIEND_REQUEST_RECEIVED count: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)"
echo "  (should be 0 — S-01 fix prevents new request)"

echo "--- N10: Historical notification retained ---"
echo -n "  A's FRIEND_REQUEST_ACCEPTED count: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_ACCEPTED\"').get().c)"
echo "  (should be 1 — historical, not deleted)"

echo "--- N11: Repeated block (idempotent) ---"
echo -n "  2nd block HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"BLOCKED"}'
echo " (expected 409 — already BLOCKED)"

echo "--- N12: Repeated unblock (idempotent) ---"
# A unblocks first
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"UNBLOCKED"}' > /dev/null
echo "  A unblocked"
echo -n "  2nd unblock HTTP: "
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/$CONN2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"UNBLOCKED"}'
echo " (expected 404 — connection deleted after unblock)"

echo "--- N13: Legacy blockedBy=NULL fail-closed ---"
# Create a legacy BLOCKED row with NULL blockedBy
dbq "db.run('INSERT INTO \"SocialConnection\" (id,followerId,followeeId,status,blockedBy,createdAt,updatedAt) VALUES (\"legacy_test_001\",\"$DBUID_A\",\"$DBUID_B\",\"BLOCKED\",NULL,datetime(\"now\"),datetime(\"now\"))')"
echo "  Legacy BLOCKED row created (blockedBy=NULL)"
echo -n "  B DELETE attempt: "
curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/legacy_test_001" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B"
echo " (expected 403 — fail-closed)"
echo -n "  B UNBLOCK attempt: "
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/legacy_test_001" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"UNBLOCKED"}'
echo " (expected 403 — blockedBy=NULL, neither party can unblock)"
echo -n "  A UNBLOCK attempt: "
curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3000/api/social/connections/legacy_test_001" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"UNBLOCKED"}'
echo " (expected 403 — blockedBy=NULL, fail-closed for both)"

# ============================================================================
# S1/S2/S3 REGRESSION
# ============================================================================
echo ""
echo "========================================"
echo "S1/S2/S3 REGRESSION"
echo "========================================"
# Clear and re-setup for regression
dbq "db.run('DELETE FROM \"SocialConnection\" WHERE followerId IN (\"$DBUID_A\",\"$DBUID_B\") OR followeeId IN (\"$DBUID_A\",\"$DBUID_B\")');db.run('DELETE FROM \"Notification\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\")')"
# S1: request + accept
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN3=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN3" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
echo -n "  S1: A↔B ACCEPTED: "
dbq "const ab=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();const ba=db.prepare('SELECT status FROM \"SocialConnection\" WHERE followerId=\"$DBUID_B\" AND followeeId=\"$DBUID_A\"').get();console.log((ab?ab.status:'NONE')+' / '+(ba?ba.status:'NONE'))"
echo -n "  S1: A's FRIEND_REQUEST_ACCEPTED notif: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_ACCEPTED\"').get().c)"
# S2: like
ACT2=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Reg Dosa"},"visibility":"FRIENDS"}')
ACT2_ID=$(echo "$ACT2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
curl -s -X POST "http://localhost:3000/api/social/activities/$ACT2_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" > /dev/null
echo -n "  S2: Like rows: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Like\" WHERE activityId=\"$ACT2_ID\"').get().c)"
echo -n "  S2: Like notification: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"SOCIAL_ACTIVITY_LIKED\"').get().c)"
# S3: notification check
echo -n "  S3: A's notifications: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\"').get().c)"
echo -n "  S3: B's notifications: "
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_B\"').get().c)"

echo ""
echo "=== STATIC ==="
echo -n "  Lint: " && timeout 90 bun run lint 2>&1 | grep -cE "error|Error" | head -1
echo -n "  TS (S4A files): " && timeout 120 bunx tsc --noEmit 2>&1 | grep -E "error TS" | grep -E "connections" | wc -l

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
