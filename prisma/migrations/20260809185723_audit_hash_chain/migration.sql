-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT NOT NULL DEFAULT 'GENESIS';
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT NOT NULL DEFAULT '';

-- DEV-001 mitigation: SQLite DB triggers to reject UPDATE/DELETE on audit log.
-- NOTE: These are NOT storage-level WORM (bypassable via DROP TRIGGER).
-- Production must use PostgreSQL REVOKE or WORM storage service.
CREATE TRIGGER IF NOT EXISTS prevent_audit_update
BEFORE UPDATE ON AuditLog
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_WORM: UPDATE rejected — audit log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
BEFORE DELETE ON AuditLog
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_WORM: DELETE rejected — audit log is append-only');
END;
