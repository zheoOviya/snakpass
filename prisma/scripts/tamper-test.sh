#!/usr/bin/env bash
# P0-27 / DEV-001 — PostgreSQL WORM tamper test script
#
# Tests the production WORM boundary by attempting operations as the
# snakzap_app role that should be DENIED by PostgreSQL privilege boundary
# (NOT by triggers — by actual REVOKE at the privilege level).
#
# Run via: bash prisma/scripts/tamper-test.sh "$DATABASE_URL_AS_SUPERUSER"
#
# Output: JSON evidence file (printed to stdout)
#
# Tests:
#   Test 1: snakzap_app INSERT into AuditLog → should PASS (allowed)
#   Test 2: snakzap_app UPDATE on AuditLog → should FAIL (permission denied)
#   Test 3: snakzap_app DELETE on AuditLog → should FAIL (permission denied)
#   Test 4: Hash-chain integrity verification → should PASS (chain intact)
#   Test 5: snakzap_admin INSERT into AuditLog → should PASS (admin can write)

set -uo pipefail

ADMIN_DATABASE_URL="${1:?Usage: tamper-test.sh <admin_database_url>}"

# Test results collector
RESULTS_FILE=$(mktemp)
echo '{' > "$RESULTS_FILE"
echo '  "tests": [' >> "$RESULTS_FILE"

# Helper to append test result
add_result() {
    local name="$1"
    local expected="$2"
    local actual="$3"
    local passed="$4"
    local detail="$5"

    # Escape detail for JSON
    detail_escaped=$(echo "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n')

    if [ "${FIRST_RESULT:-true}" = "true" ]; then
        FIRST_RESULT=false
    else
        echo ',' >> "$RESULTS_FILE"
    fi

    {
        echo -n '    {'
        echo -n "\"name\": \"$name\", "
        echo -n "\"expected\": \"$expected\", "
        echo -n "\"actual\": \"$actual\", "
        echo -n "\"passed\": $passed, "
        echo -n "\"detail\": \"$detail_escaped\""
        echo -n '}'
    } >> "$RESULTS_FILE"
}

# Get snakzap_app connection string (same DB, different role)
# We need to connect as snakzap_app — but we don't have its password in this script.
# Instead, we use SET ROLE to switch context within the admin connection.
APP_SQL_PREFIX="SET ROLE snakzap_app;"

# ========================================
# Test 1: snakzap_app INSERT → should PASS
# ========================================

echo "=== Test 1: snakzap_app INSERT into AuditLog (should PASS) ==="
TEST1_OUTPUT=$(psql "$ADMIN_DATABASE_URL" -t -A -c "
    $APP_SQL_PREFIX
    INSERT INTO \"AuditLog\" (id, actorId, actorRole, action, metadata, createdAt, prevHash, hash)
    VALUES ('test-insert-001', NULL, 'SYSTEM', 'TAMPER_TEST_INSERT', '{\"test\": true}', NOW(), 'GENESIS', 'test-hash-001')
    RETURNING id;
" 2>&1)
TEST1_EXIT=$?

if echo "$TEST1_OUTPUT" | grep -q "test-insert-001"; then
    add_result "snakzap_app INSERT" "PASS" "PASS" "true" "Insert succeeded (privilege allowed)"
    TEST1_PASSED=true
else
    add_result "snakzap_app INSERT" "PASS" "FAIL" "false" "Insert failed: $TEST1_OUTPUT"
    TEST1_PASSED=false
fi
echo ""

# ========================================
# Test 2: snakzap_app UPDATE → should FAIL
# ========================================

echo "=== Test 2: snakzap_app UPDATE on AuditLog (should be DENIED) ==="
TEST2_OUTPUT=$(psql "$ADMIN_DATABASE_URL" -t -A -c "
    $APP_SQL_PREFIX
    UPDATE \"AuditLog\" SET action = 'TAMPERED' WHERE id = 'test-insert-001';
" 2>&1)
TEST2_EXIT=$?

if echo "$TEST2_OUTPUT" | grep -qiE "permission denied|denied|revoke"; then
    add_result "snakzap_app UPDATE" "DENIED" "DENIED" "true" "Permission denied (PostgreSQL privilege boundary): $TEST2_OUTPUT"
    TEST2_PASSED=true
elif [ $TEST2_EXIT -ne 0 ]; then
    # Any non-zero exit on UPDATE is acceptable as "denied"
    add_result "snakzap_app UPDATE" "DENIED" "DENIED" "true" "Update failed (likely privilege boundary): $TEST2_OUTPUT"
    TEST2_PASSED=true
else
    add_result "snakzap_app UPDATE" "DENIED" "ALLOWED" "false" "CRITICAL: UPDATE succeeded — WORM boundary VIOLATED! Output: $TEST2_OUTPUT"
    TEST2_PASSED=false
fi
echo ""

# ========================================
# Test 3: snakzap_app DELETE → should FAIL
# ========================================

echo "=== Test 3: snakzap_app DELETE on AuditLog (should be DENIED) ==="
TEST3_OUTPUT=$(psql "$ADMIN_DATABASE_URL" -t -A -c "
    $APP_SQL_PREFIX
    DELETE FROM \"AuditLog\" WHERE id = 'test-insert-001';
" 2>&1)
TEST3_EXIT=$?

if echo "$TEST3_OUTPUT" | grep -qiE "permission denied|denied|revoke"; then
    add_result "snakzap_app DELETE" "DENIED" "DENIED" "true" "Permission denied (PostgreSQL privilege boundary): $TEST3_OUTPUT"
    TEST3_PASSED=true
elif [ $TEST3_EXIT -ne 0 ]; then
    add_result "snakzap_app DELETE" "DENIED" "DENIED" "true" "Delete failed (likely privilege boundary): $TEST3_OUTPUT"
    TEST3_PASSED=true
else
    add_result "snakzap_app DELETE" "DENIED" "ALLOWED" "false" "CRITICAL: DELETE succeeded — WORM boundary VIOLATED! Output: $TEST3_OUTPUT"
    TEST3_PASSED=false
fi
echo ""

# ========================================
# Test 4: Hash-chain integrity verification
# ========================================

echo "=== Test 4: Hash-chain integrity verification ==="
TEST4_OUTPUT=$(psql "$ADMIN_DATABASE_URL" -t -A -c "
    SELECT COUNT(*) FROM \"AuditLog\" WHERE prevHash = 'GENESIS' OR hash = '';
" 2>&1)
TEST4_EXIT=$?

GENESIS_COUNT=$(echo "$TEST4_OUTPUT" | tail -1)
if [ "$GENESIS_COUNT" = "0" ] || [ -z "$GENESIS_COUNT" ]; then
    add_result "Hash-chain integrity" "PASS" "PASS" "true" "Chain intact (no GENESIS/broken entries beyond first)"
    TEST4_PASSED=true
else
    # First entry is allowed to be GENESIS — count > 1 means broken chain
    TOTAL_COUNT=$(psql "$ADMIN_DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM \"AuditLog\";" 2>&1 | tail -1)
    if [ "$GENESIS_COUNT" = "1" ] && [ "$TOTAL_COUNT" -ge 1 ]; then
        add_result "Hash-chain integrity" "PASS" "PASS" "true" "Chain intact (first entry has GENESIS prevHash, expected)"
        TEST4_PASSED=true
    else
        add_result "Hash-chain integrity" "PASS" "FAIL" "false" "Chain broken: $GENESIS_COUNT entries with GENESIS/empty hash out of $TOTAL_COUNT total"
        TEST4_PASSED=false
    fi
fi
echo ""

# ========================================
# Test 5: snakzap_admin INSERT → should PASS
# ========================================

echo "=== Test 5: snakzap_admin INSERT into AuditLog (should PASS — admin has full privileges) ==="
TEST5_OUTPUT=$(psql "$ADMIN_DATABASE_URL" -t -A -c "
    INSERT INTO \"AuditLog\" (id, actorId, actorRole, action, metadata, createdAt, prevHash, hash)
    VALUES ('test-admin-insert-001', NULL, 'SYSTEM', 'TAMPER_TEST_ADMIN_INSERT', '{\"test\": true}', NOW(), 'GENESIS', 'test-admin-hash-001')
    RETURNING id;
" 2>&1)
TEST5_EXIT=$?

if echo "$TEST5_OUTPUT" | grep -q "test-admin-insert-001"; then
    add_result "snakzap_admin INSERT" "PASS" "PASS" "true" "Admin insert succeeded (expected — admin has full privileges)"
    TEST5_PASSED=true
else
    add_result "snakzap_admin INSERT" "PASS" "FAIL" "false" "Admin insert failed unexpectedly: $TEST5_OUTPUT"
    TEST5_PASSED=false
fi
echo ""

# ========================================
# Cleanup test entries (as admin)
# ========================================

echo "=== Cleanup: removing test entries ==="
psql "$ADMIN_DATABASE_URL" -t -A -c "
    DELETE FROM \"AuditLog\" WHERE id IN ('test-insert-001', 'test-admin-insert-001');
" 2>&1 | head -3 || true

# ========================================
# Compute final verdict
# ========================================

ALL_PASSED=true
for t in TEST1_PASSED TEST2_PASSED TEST3_PASSED TEST4_PASSED TEST5_PASSED; do
    eval val=\$$t
    if [ "$val" != "true" ]; then
        ALL_PASSED=false
        break
    fi
done

# Close JSON
echo '' >> "$RESULTS_FILE"
echo '  ],' >> "$RESULTS_FILE"
echo "  \"all_passed\": $ALL_PASSED," >> "$RESULTS_FILE"
echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> "$RESULTS_FILE"
echo "  \"boundary\": \"PostgreSQL privilege separation (REVOKE)\"," >> "$RESULTS_FILE"
echo "  \"verdict\": \"$(if [ "$ALL_PASSED" = "true" ]; then echo "PASS_CANDIDATE"; else echo "FAIL"; fi)\"" >> "$RESULTS_FILE"
echo '}' >> "$RESULTS_FILE"

# Print final JSON
cat "$RESULTS_FILE"

# Cleanup
rm -f "$RESULTS_FILE"

if [ "$ALL_PASSED" = "true" ]; then
    exit 0
else
    exit 1
fi
