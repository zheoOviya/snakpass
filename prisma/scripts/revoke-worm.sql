-- P0-27 / DEV-001 — Explicit REVOKE for production WORM boundary
--
-- This script explicitly revokes UPDATE and DELETE privileges on AuditLog
-- from snakzap_app. This is the CRITICAL PostgreSQL privilege boundary
-- that proves DEV-001 closure: the application role cannot mutate audit
-- history at the database privilege level (not just at the trigger level).
--
-- Run via: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/revoke-worm.sql
--
-- IMPORTANT: This script must be run as the database superuser (postgres)
-- or as snakzap_admin (which has CREATEROLE privilege).

BEGIN;

-- ========================================
-- 1. Explicit REVOKE on AuditLog (WORM boundary)
-- ========================================

-- REVOKE UPDATE — application role cannot modify audit entries
REVOKE UPDATE ON "AuditLog" FROM snakzap_app;

-- REVOKE DELETE — application role cannot delete audit entries
REVOKE DELETE ON "AuditLog" FROM snakzap_app;

-- REVOKE TRUNCATE — application role cannot truncate the audit table
-- (TRUNCATE is a separate privilege in PostgreSQL)
REVOKE TRUNCATE ON "AuditLog" FROM snakzap_app;

-- ========================================
-- 2. Verify revocation via system catalog
-- ========================================

DO $$
DECLARE
    has_update BOOLEAN;
    has_delete BOOLEAN;
    has_truncate BOOLEAN;
    has_insert BOOLEAN;
    has_select BOOLEAN;
BEGIN
    SELECT
        BOOL_OR(privilege_type = 'UPDATE' AND grantee = 'snakzap_app') INTO has_update
    FROM information_schema.role_table_grants
    WHERE table_name = 'AuditLog' AND grantee = 'snakzap_app';

    SELECT
        BOOL_OR(privilege_type = 'DELETE' AND grantee = 'snakzap_app') INTO has_delete
    FROM information_schema.role_table_grants
    WHERE table_name = 'AuditLog' AND grantee = 'snakzap_app';

    SELECT
        BOOL_OR(privilege_type = 'TRUNCATE' AND grantee = 'snakzap_app') INTO has_truncate
    FROM information_schema.role_table_grants
    WHERE table_name = 'AuditLog' AND grantee = 'snakzap_app';

    SELECT
        BOOL_OR(privilege_type = 'INSERT' AND grantee = 'snakzap_app') INTO has_insert
    FROM information_schema.role_table_grants
    WHERE table_name = 'AuditLog' AND grantee = 'snakzap_app';

    SELECT
        BOOL_OR(privilege_type = 'SELECT' AND grantee = 'snakzap_app') INTO has_select
    FROM information_schema.role_table_grants
    WHERE table_name = 'AuditLog' AND grantee = 'snakzap_app';

    RAISE NOTICE '========================================';
    RAISE NOTICE 'DEV-001 / P0-22 — WORM privilege verification';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'AuditLog privileges for snakzap_app:';
    RAISE NOTICE '  SELECT:  %', CASE WHEN has_select THEN 'GRANTED ✅' ELSE 'NOT GRANTED ❌' END;
    RAISE NOTICE '  INSERT:  %', CASE WHEN has_insert THEN 'GRANTED ✅' ELSE 'NOT GRANTED ❌' END;
    RAISE NOTICE '  UPDATE:  %', CASE WHEN has_update THEN 'GRANTED ⚠️  (WORM violation!)' ELSE 'NOT GRANTED ✅ (WORM boundary)' END;
    RAISE NOTICE '  DELETE:  %', CASE WHEN has_delete THEN 'GRANTED ⚠️  (WORM violation!)' ELSE 'NOT GRANTED ✅ (WORM boundary)' END;
    RAISE NOTICE '  TRUNCATE: %', CASE WHEN has_truncate THEN 'GRANTED ⚠️  (WORM violation!)' ELSE 'NOT GRANTED ✅ (WORM boundary)' END;
    RAISE NOTICE '========================================';

    -- Assertion: WORM boundary must be enforced
    IF has_update OR has_delete OR has_truncate THEN
        RAISE EXCEPTION 'WORM boundary VIOLATED: snakzap_app has UPDATE/DELETE/TRUNCATE on AuditLog';
    END IF;
END;
$$;

COMMIT;

-- ========================================
-- 3. Print current grants (for evidence capture)
-- ========================================

SELECT
    grantee,
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_name = 'AuditLog'
    AND grantee IN ('snakzap_admin', 'snakzap_app')
GROUP BY grantee, table_name
ORDER BY grantee;
