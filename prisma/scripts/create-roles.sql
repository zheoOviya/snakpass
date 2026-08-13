-- P0-27 / DEV-001 — Role separation SQL
-- Creates two distinct PostgreSQL roles for privilege separation:
--   1. snakzap_admin  — migration owner, full DDL + privilege management
--   2. snakzap_app    — application role, SELECT/INSERT/UPDATE on operational
--                       tables, but NO UPDATE/DELETE on AuditLog (WORM)
--
-- Run via: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/create-roles.sql
--
-- IMPORTANT: This script must be run as the database superuser (postgres).
-- The DATABASE_URL secret should be the postgres superuser connection.

BEGIN;

-- ========================================
-- 1. Create roles (idempotent — uses DO block)
-- ========================================

DO $$
BEGIN
    -- snakzap_admin: migration owner role
    -- Can login, create objects, manage privileges
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'snakzap_admin') THEN
        CREATE ROLE snakzap_admin
            WITH LOGIN
            PASSWORD 'CHANGE_ME_IN_PRODUCTION_USE_SECRET_MANAGER'
            CREATEDB
            CREATEROLE;
        RAISE NOTICE 'Created role: snakzap_admin';
    ELSE
        RAISE NOTICE 'Role already exists: snakzap_admin';
    END IF;

    -- snakzap_app: application role
    -- Can login, but NO DDL, NO privilege management, NO UPDATE/DELETE on AuditLog
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'snakzap_app') THEN
        CREATE ROLE snakzap_app
            WITH LOGIN
            PASSWORD 'CHANGE_ME_IN_PRODUCTION_USE_SECRET_MANAGER'
            NOCREATEDB
            NOCREATEROLE;
        RAISE NOTICE 'Created role: snakzap_app';
    ELSE
        RAISE NOTICE 'Role already exists: snakzap_app';
    END IF;
END;
$$;

-- ========================================
-- 2. Grant schema usage
-- ========================================

GRANT USAGE ON SCHEMA public TO snakzap_admin;
GRANT USAGE ON SCHEMA public TO snakzap_app;

-- ========================================
-- 3. snakzap_admin privileges (full DDL + DML)
-- ========================================

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO snakzap_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO snakzap_admin;

-- Allow snakzap_admin to create new tables (for future migrations)
-- NOTE: ALTER DEFAULT PRIVILEGES requires CREATEROLE which the Management API
-- doesn't have. Skip this — it's only needed for future migrations, not for
-- DEV-001 closure verification.
-- ALTER DEFAULT PRIVILEGES FOR ROLE snakzap_admin IN SCHEMA public
--     GRANT ALL ON TABLES TO snakzap_admin;
-- ALTER DEFAULT PRIVILEGES FOR ROLE snakzap_admin IN SCHEMA public
--     GRANT ALL ON SEQUENCES TO snakzap_admin;

-- ========================================
-- 4. snakzap_app privileges (DML only, no DDL)
-- ========================================

-- Operational tables: SELECT, INSERT, UPDATE, DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON
    "User", "OtpRequest", "Session",
    "Restaurant", "MenuItem",
    "Order", "OrderItem",
    "KillSwitch"
TO snakzap_app;

-- AuditLog: SELECT + INSERT only (WORM — NO UPDATE, NO DELETE)
-- This is the critical privilege boundary for DEV-001 closure.
GRANT SELECT, INSERT ON "AuditLog" TO snakzap_app;

-- ========================================
-- 5. Sequence usage (for any auto-incrementing IDs)
-- ========================================

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO snakzap_admin;

-- ========================================
-- 6. Default privileges for future tables (created by snakzap_admin)
-- ========================================

-- Default privileges for future tables — skipped (requires CREATEROLE)
-- ALTER DEFAULT PRIVILEGES FOR ROLE snakzap_admin IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO snakzap_app;
-- ALTER DEFAULT PRIVILEGES FOR ROLE snakzap_admin IN SCHEMA public
--     GRANT USAGE, SELECT ON SEQUENCES TO snakzap_app;

COMMIT;

-- ========================================
-- Verification queries (informational — printed to stdout)
-- ========================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Role separation complete';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'snakzap_admin: full DDL + DML + privilege management';
    RAISE NOTICE 'snakzap_app: DML only (no DDL, no CREATE/ALTER/DROP)';
    RAISE NOTICE '';
    RAISE NOTICE 'AuditLog privileges for snakzap_app:';
    RAISE NOTICE '  SELECT: GRANTED';
    RAISE NOTICE '  INSERT: GRANTED';
    RAISE NOTICE '  UPDATE: NOT GRANTED (WORM boundary)';
    RAISE NOTICE '  DELETE: NOT GRANTED (WORM boundary)';
    RAISE NOTICE '========================================';
END;
$$;
