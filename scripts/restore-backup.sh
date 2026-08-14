#!/usr/bin/env bash
# =============================================================================
# SnakZap — DR Restore Script (AUTHORED — NOT EXECUTED)
# -----------------------------------------------------------------------------
# Implements the restore procedure from docs/DR_RUNBOOK.md §4.2.
#
# STATUS: AUTHORED — NOT EXECUTED
# This script has NOT been run against any database. Execution requires:
#   1. Phase-3 pg_dump backup mechanism to be operational
#   2. Warm-standby Supabase project to be provisioned
#   3. Orchestrator authorization for DR drill
#
# Usage (WHEN AUTHORIZED):
#   ./scripts/restore-backup.sh <backup-file-name> <target-database-url>
#
# Exit codes:
#   0 — restore successful + verification passed
#   1 — restore failed
#   2 — verification failed (restore completed but data integrity check failed)
# =============================================================================

set -euo pipefail

# ---- Args ------------------------------------------------------------------
BACKUP_FILE="${1:?Usage: restore-backup.sh <backup-file-name> <target-database-url>}"
TARGET_DB_URL="${2:?Usage: restore-backup.sh <backup-file-name> <target-database-url>}"

# ---- Config ----------------------------------------------------------------
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-zmzqqcyapcezmaqvuzzd}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY not set}"
STORAGE_BUCKET="${BACKUP_SUPABASE_BUCKET:-snakzap-backups}"
TEMP_DIR="${TEMP_DIR:-/tmp}"

echo "═══════════════════════════════════════════════════════════════"
echo "  SnakZap DR Restore — AUTHORED (NOT YET EXECUTED)"
echo "═══════════════════════════════════════════════════════════════"
echo "Backup file: $BACKUP_FILE"
echo "Target DB:   $TARGET_DB_URL (masked)"
echo ""

# ---- Step 1: Download backup from Supabase Storage -------------------------
echo "=== Step 1: Download backup ==="
BACKUP_PATH="$TEMP_DIR/$BACKUP_FILE"
curl -sS -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  "https://$SUPABASE_PROJECT_REF.supabase.co/storage/v1/object/$STORAGE_BUCKET/$BACKUP_FILE" \
  -o "$BACKUP_PATH"

if [ ! -s "$BACKUP_PATH" ]; then
  echo "❌ Backup download failed (empty file)"
  exit 1
fi
echo "✅ Backup downloaded: $BACKUP_PATH ($(wc -c < "$BACKUP_PATH") bytes)"

# ---- Step 2: Verify SHA-256 (if checksum exists) ---------------------------
echo ""
echo "=== Step 2: Verify SHA-256 ==="
CHECKSUM_FILE="$BACKUP_PATH.sha256"
if [ -f "$CHECKSUM_FILE" ]; then
  EXPECTED=$(cat "$CHECKSUM_FILE" | awk '{print $1}')
  ACTUAL=$(sha256sum "$BACKUP_PATH" | awk '{print $1}')
  if [ "$EXPECTED" = "$ACTUAL" ]; then
    echo "✅ SHA-256 matches: $ACTUAL"
  else
    echo "❌ SHA-256 mismatch: expected=$EXPECTED actual=$ACTUAL"
    exit 1
  fi
else
  echo "⚠️  No checksum file found — skipping verification"
fi

# ---- Step 3: Restore to target database ------------------------------------
echo ""
echo "=== Step 3: Restore to target database ==="
pg_restore --dbname="$TARGET_DB_URL" \
  --no-owner --no-privileges \
  --jobs=4 --clean --if-exists \
  "$BACKUP_PATH"

if [ $? -ne 0 ]; then
  echo "❌ pg_restore failed"
  exit 1
fi
echo "✅ Restore complete"

# ---- Step 4: Verify row counts ---------------------------------------------
echo ""
echo "=== Step 4: Verify row counts ==="
AUDIT_COUNT=$(psql "$TARGET_DB_URL" -t -c "SELECT COUNT(*) FROM \"AuditLog\";" 2>/dev/null | xargs)
ORDER_COUNT=$(psql "$TARGET_DB_URL" -t -c "SELECT COUNT(*) FROM \"Order\";" 2>/dev/null | xargs)
KS_COUNT=$(psql "$TARGET_DB_URL" -t -c "SELECT COUNT(*) FROM \"KillSwitch\";" 2>/dev/null | xargs)

echo "  AuditLog: $AUDIT_COUNT rows"
echo "  Order:    $ORDER_COUNT rows"
echo "  KillSwitch: $KS_COUNT rows"

if [ "$AUDIT_COUNT" -eq 0 ] || [ "$ORDER_COUNT" -eq 0 ]; then
  echo "❌ Verification failed — critical tables are empty"
  exit 2
fi
echo "✅ Row counts verified"

# ---- Step 5: Verify audit hash-chain integrity -----------------------------
echo ""
echo "=== Step 5: Verify audit hash-chain integrity ==="
# (This would run the audit-integrity-check.sql script)
# psql "$TARGET_DB_URL" -f prisma/scripts/audit-integrity-check.sql
echo "⚠️  Audit integrity check: SKIPPED (script not yet created — Phase 3)"

# ---- Step 6: Cleanup + summary --------------------------------------------
echo ""
echo "=== Step 6: Cleanup ==="
rm -f "$BACKUP_PATH" "$CHECKSUM_FILE"
echo "✅ Temp files cleaned up"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DR RESTORE COMPLETE (AUTHORED — NOT EXECUTED)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps (when authorized):"
echo "  1. Switch application DATABASE_URL to restored DB"
echo "  2. Run post-restore business-state reconciliation (see DR_RUNBOOK.md §5)"
echo "  3. Verify application health"
echo "  4. Record drill result"
echo "═══════════════════════════════════════════════════════════════"
