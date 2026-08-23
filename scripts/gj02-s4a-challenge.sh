#!/bin/bash
# S4A Block Security Challenge — runtime reproduction of S-01, S-02, S-03
set +e
cd /home/z/my-project
EVID_DIR=/home/z/my-project/evidence/gj02-s4a-challenge
mkdir -p "$EVID_DIR"
LOG="$EVID_DIR/s4a-challenge.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

S4A_PHONE="+919999900701"
S4B_PHONE="+919999900702"
CAMPUS_ID="cmt1g6wpi0035rb67he4qotk8"
RESTAURANT_ID="cmt1g6wnj0004rb67aa935q3y"

echo "========================================"
echo "S4A BLOCK SECURITY CHALLENGE-01"
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
  curl -s -c /tmp/ch${LT}.txt -X POST "http://localhost:3000/api/auth/otp/send" -H "Content-Type: application/json" -d "{\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /tmp/chs${LT}.json
  OI=$(python3 -c "import sys,json; print(json.load(open('/tmp/chs${LT}.json')).get('otpId',''))" 2>/dev/null)
  OC=$(python3 -c "import sys,json; print(json.load(open('/tmp/chs${LT}.json')).get('code',''))" 2>/dev/null)
  SP=$(grep "snakzap_session" /tmp/ch${LT}.txt | awk '{print $NF}')
  CP=$(grep "snakzap_csrf" /tmp/ch${LT}.txt | awk '{print $NF}')
  curl -s -b /tmp/ch${LT}.txt -c /tmp/ch${LT}.txt -X POST "http://localhost:3000/api/auth/otp/verify" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SP; snakzap_csrf=$CP" -H "X-CSRF-Token: $CP" -d "{\"otpId\":\"$OI\",\"code\":\"$OC\",\"phone\":\"$P\",\"purpose\":\"consumer_login\"}" > /dev/null
  S=$(grep "snakzap_session" /tmp/ch${LT}.txt | awk '{print $NF}')
  C=$(grep "snakzap_csrf" /tmp/ch${LT}.txt | awk '{print $NF}')
  curl -s -X PATCH "http://localhost:3000/api/auth/me/campus" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$S; snakzap_csrf=$C" -H "X-CSRF-Token: $C" -d "{\"campusId\":\"$CAMPUS_ID\"}" > /dev/null
  case "$U" in A) SESS_A=$S; CSRF_A=$C;; B) SESS_B=$S; CSRF_B=$C;; esac
  DID=$(bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/z/my-project/db/custom.db'); const r = db.prepare('SELECT id FROM User WHERE phone=?').get('$P'); console.log(r ? r.id : ''); db.close();" 2>/dev/null | tail -1)
  case "$U" in A) DBUID_A=$DID;; B) DBUID_B=$DID;; esac
done
echo "A=$DBUID_A B=$DBUID_B"

dbq() { cat > /tmp/chq.mjs << MJS
import { Database } from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db')
$1
db.close()
MJS
bun /tmp/chq.mjs 2>&1 | grep -v "^prisma"; }

show_conns() {
  dbq "const rows=db.prepare('SELECT id,followerId,followeeId,status FROM \"SocialConnection\" WHERE followerId IN (\"$DBUID_A\",\"$DBUID_B\") OR followeeId IN (\"$DBUID_A\",\"$DBUID_B\")').all();if(rows.length===0)console.log('  (none)');for(const r of rows){const f=r.followerId===\"$DBUID_A\"?'A':(r.followerId===\"$DBUID_B\"?'B':r.followerId.substring(0,8));const e=r.followeeId===\"$DBUID_A\"?'A':(r.followeeId===\"$DBUID_B\"?'B':r.followeeId.substring(0,8));console.log('  '+f+'→'+e+' status='+r.status+' id='+r.id.substring(0,12))}"
}

show_notifs() {
  dbq "const rows=db.prepare('SELECT id,userId,type,dedupKey,readAt FROM \"Notification\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\") ORDER BY createdAt DESC').all();if(rows.length===0)console.log('  (none)');for(const r of rows){const u=r.userId===\"$DBUID_A\"?'A':'B';console.log('  user='+u+' type='+r.type+' dedupKey='+(r.dedupKey||'NULL')+' read='+(r.readAt?'YES':'NO'))}"
}

# ============================================================================
# SETUP: A→B friend request, B accepts, A blocks B
# ============================================================================
echo ""
echo "========================================"
echo "SETUP: A↔B ACCEPTED, then A blocks B"
echo "========================================"
echo "--- A sends friend request to B ---"
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN_AB=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
echo "  A→B connection: $CONN_AB"
echo "--- B accepts ---"
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
echo "  DB after accept:"
show_conns

echo "--- A blocks B (via PATCH on A→B connection with status=BLOCKED) ---"
BLOCK_RESP=$(curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN_AB" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"BLOCKED"}')
echo "  PATCH response: $BLOCK_RESP"
echo "  DB after block:"
show_conns
echo "  Notifications:"
show_notifs

# ============================================================================
# S-01: Block bypass — can B send friend request to A after being blocked?
# ============================================================================
echo ""
echo "========================================"
echo "S-01: BLOCK BYPASS REPRODUCTION"
echo "========================================"
echo "--- B attempts friend request to A ---"
echo "  DB before B's request:"
show_conns
S01_RESP=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}")
S01_BODY=$(echo "$S01_RESP" | head -n -1)
S01_HTTP=$(echo "$S01_RESP" | tail -1)
echo "  HTTP: $S01_HTTP"
echo "  Body: $S01_BODY"
echo "  DB after B's request:"
show_conns
echo "  Notifications after B's request:"
show_notifs

echo ""
echo "--- B attempts search for A ---"
S01_SEARCH=$(curl -s "http://localhost:3000/api/social/search?q=$S4A_PHONE" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B")
echo "  Search response: $S01_SEARCH" | head -c 200; echo

echo ""
echo "--- B attempts GET feed (should NOT see A's activities) ---"
S01_FEED=$(curl -s "http://localhost:3000/api/social/feed?limit=10" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B")
echo "  Feed activities: $(echo $S01_FEED | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('activities',[])))" 2>&1)"

# ============================================================================
# S-02: Self-unblock — can B DELETE the BLOCKED row?
# ============================================================================
echo ""
echo "========================================"
echo "S-02: SELF-UNBLOCK EXPLOIT"
echo "========================================"
# Get the connection ID that B can see
B_CONNS=$(curl -s "http://localhost:3000/api/social/connections" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B")
echo "  B's connections:"
echo "$B_CONNS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d.get('connections',[]):
    print(f'  id={c.get(\"id\",\"?\")[:12]} userId={c.get(\"userId\",\"?\")[:12]} status={c.get(\"status\",\"?\")} direction={c.get(\"direction\",\"?\")}')
" 2>&1

# B attempts DELETE on the BLOCKED connection
B_CONN_ID=$(echo "$B_CONNS" | python3 -c "import sys,json; d=json.load(sys.stdin); cs=[c for c in d.get('connections',[]) if c.get('status')=='BLOCKED']; print(cs[0]['id'] if cs else '')" 2>/dev/null)
echo "  B's BLOCKED connection ID: $B_CONN_ID"
echo "  DB before B's DELETE:"
show_conns

if [ -n "$B_CONN_ID" ]; then
  echo "  --- B calls DELETE /api/social/connections/$B_CONN_ID ---"
  S02_RESP=$(curl -s -w "\n%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$B_CONN_ID" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
  S02_BODY=$(echo "$S02_RESP" | head -n -1)
  S02_HTTP=$(echo "$S02_RESP" | tail -1)
  echo "  HTTP: $S02_HTTP"
  echo "  Body: $S02_BODY"
  echo "  DB after B's DELETE:"
  show_conns

  # Check if B can now send a new friend request
  echo "  --- B attempts friend request to A after DELETE ---"
  S02_REQ=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}")
  S02_REQ_BODY=$(echo "$S02_REQ" | head -n -1)
  S02_REQ_HTTP=$(echo "$S02_REQ" | tail -1)
  echo "  HTTP: $S02_REQ_HTTP"
  echo "  Body: $S02_REQ_BODY"
  echo "  DB after B's 2nd request:"
  show_conns
  echo "  Notifications after B's 2nd request:"
  show_notifs
  echo "  Capability regained: $(if [ "$S02_REQ_HTTP" = "201" ]; then echo 'YES — B can send request after self-unblock'; else echo 'NO — request rejected'; fi)"
else
  echo "  No BLOCKED connection found for B — checking if B has any connection..."
  B_ANY_CONN=$(echo "$B_CONNS" | python3 -c "import sys,json; d=json.load(sys.stdin); cs=d.get('connections',[]); print(cs[0]['id'] if cs else '')" 2>/dev/null)
  if [ -n "$B_ANY_CONN" ]; then
    echo "  B has connection: $B_ANY_CONN — attempting DELETE..."
    S02_RESP=$(curl -s -w "\n%{http_code}" -X DELETE "http://localhost:3000/api/social/connections/$B_ANY_CONN" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
    echo "  HTTP: $(echo "$S02_RESP" | tail -1)"
    echo "  DB after:"
    show_conns
  else
    echo "  B has no connections at all"
  fi
fi

# ============================================================================
# S-03: Notification leak after block
# ============================================================================
echo ""
echo "========================================"
echo "S-03: NOTIFICATION LEAK AFTER BLOCK"
echo "========================================"
# Re-setup: A→B request, B accepts, A blocks
echo "--- Re-setup: clear + A→B + accept + block ---"
dbq "db.run('DELETE FROM \"SocialConnection\" WHERE followerId IN (\"$DBUID_A\",\"$DBUID_B\") OR followeeId IN (\"$DBUID_A\",\"$DBUID_B\")');db.run('DELETE FROM \"Notification\" WHERE userId IN (\"$DBUID_A\",\"$DBUID_B\")')"
curl -s -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d "{\"followeeId\":\"$DBUID_B\"}" > /dev/null
CONN_AB2=$(dbq "const r=db.prepare('SELECT id FROM \"SocialConnection\" WHERE followerId=\"$DBUID_A\" AND followeeId=\"$DBUID_B\"').get();if(r)console.log(r.id);else console.log('')")
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d '{"status":"ACCEPTED"}' > /dev/null
echo "  A↔B ACCEPTED"
echo "  Notifications before block:"
show_notifs

# A blocks B
curl -s -X PATCH "http://localhost:3000/api/social/connections/$CONN_AB2" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"status":"BLOCKED"}' > /dev/null
echo "  A blocked B"
echo "  DB after block:"
show_conns
echo "  Notifications after block (should be same as before — no NEW):"
show_notifs

# B attempts friend request to A (S-01 bypass attempt)
echo ""
echo "--- B attempts friend request to A after block ---"
S03_RESP=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3000/api/social/connections" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B" -d "{\"followeeId\":\"$DBUID_A\"}")
S03_BODY=$(echo "$S03_RESP" | head -n -1)
S03_HTTP=$(echo "$S03_RESP" | tail -1)
echo "  HTTP: $S03_HTTP"
echo "  Body: $S03_BODY"
echo "  DB after B's attempt:"
show_conns
echo "  Notifications after B's attempt:"
show_notifs

echo ""
echo "--- Checking if NEW notification was created ---"
NEW_NOTIFS=$(dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"FRIEND_REQUEST_RECEIVED\"').get().c)")
echo "  A's FRIEND_REQUEST_RECEIVED count: $NEW_NOTIFS"
echo "  (if >0 AND B's request succeeded → CONFIRMED: notification leak after block)"
echo "  (if 0 OR B's request was rejected → NOT REPRODUCED at notification level)"

# B attempts Like on A's activity
echo ""
echo "--- B attempts Like on A's FRIENDS activity ---"
ACT=$(curl -s -X POST "http://localhost:3000/api/social/activities" -H "Content-Type: application/json" -H "Cookie: snakzap_session=$SESS_A; snakzap_csrf=$CSRF_A" -H "X-CSRF-Token: $CSRF_A" -d '{"verb":"ORDERED","objectType":"Restaurant","objectId":"'"$RESTAURANT_ID"'","metadata":{"restaurantName":"Block Test"},"visibility":"FRIENDS"}')
ACT_ID=$(echo "$ACT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activity',{}).get('id',''))" 2>/dev/null)
echo "  A's activity: $ACT_ID"
echo "  B attempts Like:"
S03_LIKE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3000/api/social/activities/$ACT_ID/like" -H "Cookie: snakzap_session=$SESS_B; snakzap_csrf=$CSRF_B" -H "X-CSRF-Token: $CSRF_B")
echo "  HTTP: $S03_LIKE (expected 403 — blocked, no ACCEPTED connection)"
echo "  Like notification count for A:"
dbq "console.log(db.prepare('SELECT COUNT(*) as c FROM \"Notification\" WHERE userId=\"$DBUID_A\" AND type=\"SOCIAL_ACTIVITY_LIKED\"').get().c)"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "========================================"
echo "SUMMARY"
echo "========================================"
echo "S-01 Block bypass: HTTP=$S01_HTTP"
echo "  DB after B's request:"
show_conns
echo ""
echo "S-02 Self-unblock: HTTP=$S02_HTTP"
echo "  B's 2nd request HTTP=$S02_REQ_HTTP"
echo ""
echo "S-03 Notification leak: B's request HTTP=$S03_HTTP"
echo "  A's FRIEND_REQUEST_RECEIVED count=$NEW_NOTIFS"

echo ""
echo "=== COMPLETE ==="
echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
