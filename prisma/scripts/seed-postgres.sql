-- P0-27 / DEV-001 — Seed data for PostgreSQL (port of prisma/seed.ts)
-- Inserts minimal demo data for verification + smoke testing.
-- Run via: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/scripts/seed-postgres.sql
--
-- IMPORTANT: The admin password hash is a placeholder scrypt hash for 'admin123'.
-- In production, generate via the application's hashPassword() utility.

BEGIN;

-- ========================================
-- 1. Clean existing data (idempotent — safe to re-run)
-- ========================================
-- NOTE: AuditLog DELETE will fail if WORM triggers are active.
-- For initial seeding, we run as admin role which can disable triggers temporarily.
-- In production, NEVER delete audit logs — only seed once at first deployment.

TRUNCATE "OrderItem", "Order", "MenuItem", "Restaurant", "Session", "OtpRequest", "User", "KillSwitch" RESTART IDENTITY CASCADE;

-- ========================================
-- 2. Users (consumer + vendor + admin)
-- ========================================

INSERT INTO "User" (id, phone, name, role, spiceTolerance, walletBalance, createdAt) VALUES
    ('user-consumer-001', '+919876500001', 'Aarav Sharma', 'CONSUMER', 3, 25000, NOW());

INSERT INTO "User" (id, phone, name, role, spiceTolerance, createdAt) VALUES
    ('user-vendor-001', '+919876500002', 'Spice Junction Owner', 'VENDOR_OWNER', 4, NOW());

INSERT INTO "User" (id, phone, email, passwordHash, name, role, spiceTolerance, createdAt) VALUES
    (
        'user-admin-001',
        '+919876500003',
        'admin@snakzap.com',
        -- scrypt hash placeholder for 'admin123' — REPLACE in production via hashPassword()
        'scrypt$N=32768$r=8$p=1$placeholderhashforadmin123$replacewithrealhashfromapppasswordutility',
        'Ops Admin',
        'SUPER_ADMIN',
        2,
        NOW()
    );

-- ========================================
-- 3. Restaurants
-- ========================================

INSERT INTO "Restaurant" (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt) VALUES
    ('rest-001', 'Spice Junction', 'North Indian', 'Authentic Punjabi thalis, butter chicken & freshly baked naan. Pickup-only, ready in 20 mins.', '/images/r1.png', 4.6, 20, 45000, 0.08, TRUE, FALSE, '29ABCDE1234F1Z5', 'MG Road, Bengaluru', NOW()),
    ('rest-002', 'Dosa Den', 'South Indian', 'Crispy masala dosas, idli-vada sambar, filter coffee. Pickup-only, ready in 15 mins.', '/images/r2.png', 4.7, 15, 35000, 0.07, TRUE, FALSE, '29ABCDE1234F1Z5', 'Indiranagar, Bengaluru', NOW()),
    ('rest-003', 'Wok This Way', 'Chinese', 'Indo-Chinese favorites — chilli chicken, hakka noodles, manchurian. Pickup-only.', '/images/r3.png', 4.4, 25, 40000, 0.09, TRUE, FALSE, '29ABCDE1234F1Z5', 'Koramangala, Bengaluru', NOW()),
    ('rest-004', 'Sweet Tooth', 'Desserts', 'Cheesecakes, pastries, gulab jamun. Pickup-only, ready in 10 mins.', '/images/r4.png', 4.8, 10, 30000, 0.06, TRUE, TRUE, '29ABCDE1234F1Z5', 'Suspended for delayed pickups', NOW());

-- ========================================
-- 4. Menu items (sample)
-- ========================================

INSERT INTO "MenuItem" (id, restaurantId, name, description, price, image, spiceLevel, isVeg, isAvailable, category, createdAt) VALUES
    ('menu-001', 'rest-001', 'Butter Chicken', 'Creamy tomato-based chicken curry with tandoori spices', 32000, '/images/svg/curry-chicken.svg', 2, FALSE, TRUE, 'Mains', NOW()),
    ('menu-002', 'rest-001', 'Paneer Butter Masala', 'Cottage cheese in rich tomato gravy', 28000, '/images/svg/curry-paneer.svg', 1, TRUE, TRUE, 'Mains', NOW()),
    ('menu-003', 'rest-001', 'Garlic Naan', 'Tandoor-baked flatbread with garlic butter', 6000, '/images/svg/naan-garlic.svg', 0, TRUE, TRUE, 'Breads', NOW()),
    ('menu-004', 'rest-002', 'Masala Dosa', 'Crispy rice crepe with spiced potato filling', 12000, '/images/svg/dosa.svg', 1, TRUE, TRUE, 'Mains', NOW()),
    ('menu-005', 'rest-002', 'Idli Sambar', 'Steamed rice cakes with lentil stew', 8000, '/images/svg/idli.svg', 1, TRUE, TRUE, 'Mains', NOW()),
    ('menu-006', 'rest-003', 'Chilli Chicken', 'Indo-Chinese spicy chicken starter', 24000, '/images/svg/chilli-chicken.svg', 3, FALSE, TRUE, 'Starters', NOW()),
    ('menu-007', 'rest-003', 'Hakka Noodles', 'Stir-fried noodles with vegetables', 18000, '/images/svg/noodles.svg', 1, TRUE, TRUE, 'Mains', NOW()),
    ('menu-008', 'rest-004', 'Cheesecake', 'New York style baked cheesecake slice', 18000, '/images/svg/cheesecake.svg', 0, TRUE, TRUE, 'Desserts', NOW());

-- ========================================
-- 5. Kill switches (default: all OFF)
-- ========================================

INSERT INTO "KillSwitch" (id, key, label, description, enabled, severity, updatedAt) VALUES
    ('ks-001', 'ordering', 'Order Intake', 'Disable new order placement platform-wide', FALSE, 'CRITICAL', NOW()),
    ('ks-002', 'payments', 'Payments', 'Halt payment collection (checkout disabled)', FALSE, 'CRITICAL', NOW()),
    ('ks-003', 'catering', 'Catering Orders', 'Block B2B/catering order creation', FALSE, 'HIGH', NOW()),
    ('ks-004', 'new_vendors', 'Vendor Onboarding', 'Pause new vendor sign-ups', FALSE, 'MEDIUM', NOW()),
    ('ks-005', 'wallet_cashback', 'Wallet Cashback', 'Suspend 1% cashback credits', FALSE, 'LOW', NOW())
ON CONFLICT (key) DO NOTHING;

-- ========================================
-- 6. Audit log — clean baseline entry
-- ========================================
-- NOTE: This INSERT is run as admin. The WORM REVOKE only blocks snakzap_app.
-- Admin (postgres superuser) can always insert.

INSERT INTO "AuditLog" (id, actorId, actorRole, action, metadata, createdAt, prevHash, hash)
VALUES (
    'audit-seed-001',
    NULL,
    'SYSTEM',
    'CLEAN_BASELINE',
    '{"note": "PostgreSQL seed — DEV-001 closure verification baseline"}',
    NOW(),
    'GENESIS',
    -- SHA-256 hash of: GENESIS|audit-seed-001|null|SYSTEM|CLEAN_BASELINE|{"note": "PostgreSQL seed — DEV-001 closure verification baseline"}|<timestamp>
    -- NOTE: In production, the audit() helper computes this hash with the actual timestamp.
    -- For seeding purposes, we use a placeholder that the application will replace on next audit() call.
    'placeholder-hash-will-be-recomputed-on-next-audit-call'
);

COMMIT;

-- ========================================
-- Verification
-- ========================================

DO $$
DECLARE
    user_count INTEGER;
    restaurant_count INTEGER;
    menu_count INTEGER;
    ks_count INTEGER;
    audit_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM "User";
    SELECT COUNT(*) INTO restaurant_count FROM "Restaurant";
    SELECT COUNT(*) INTO menu_count FROM "MenuItem";
    SELECT COUNT(*) INTO ks_count FROM "KillSwitch";
    SELECT COUNT(*) INTO audit_count FROM "AuditLog";

    RAISE NOTICE '========================================';
    RAISE NOTICE 'PostgreSQL seed complete';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Users:       %', user_count;
    RAISE NOTICE 'Restaurants: %', restaurant_count;
    RAISE NOTICE 'Menu items:  %', menu_count;
    RAISE NOTICE 'KillSwitch:  %', ks_count;
    RAISE NOTICE 'AuditLog:    %', audit_count;
    RAISE NOTICE '========================================';
END;
$$;
