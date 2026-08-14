-- DEV-001 tamper test function
-- Returns explicit result rows with actual PostgreSQL error codes
CREATE OR REPLACE FUNCTION dev_001_tamper_test()
RETURNS TABLE(
  test_number INTEGER,
  operation TEXT,
  expected TEXT,
  actual TEXT,
  error_code TEXT,
  error_message TEXT
) AS $func$
DECLARE
  test_id TEXT := 'gap-test-' || extract(epoch from now())::TEXT;
BEGIN
  INSERT INTO "AuditLog" ("id", "actorId", "actorRole", "action", "metadata", "createdAt", "prevHash", "hash")
  VALUES (test_id, NULL, 'SYSTEM', 'GAP_TEST', '{"test": true}', NOW(), 'GENESIS', 'gap-hash');

  BEGIN
    SET ROLE snakzap_app;
    INSERT INTO "AuditLog" ("id", "actorId", "actorRole", "action", "metadata", "createdAt", "prevHash", "hash")
    VALUES (test_id || '-ins', NULL, 'SYSTEM', 'GAP_TEST_INS', '{"t":1}', NOW(), 'GENESIS', 'ins-hash');
    RESET ROLE;
    test_number := 1; operation := 'INSERT'; expected := 'ALLOWED';
    actual := 'ALLOWED'; error_code := NULL; error_message := NULL;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    test_number := 1; operation := 'INSERT'; expected := 'ALLOWED';
    actual := 'DENIED'; error_code := SQLSTATE; error_message := SQLERRM;
    RETURN NEXT;
  END;

  BEGIN
    SET ROLE snakzap_app;
    PERFORM COUNT(*) FROM "AuditLog";
    RESET ROLE;
    test_number := 2; operation := 'SELECT'; expected := 'ALLOWED';
    actual := 'ALLOWED'; error_code := NULL; error_message := NULL;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    test_number := 2; operation := 'SELECT'; expected := 'ALLOWED';
    actual := 'DENIED'; error_code := SQLSTATE; error_message := SQLERRM;
    RETURN NEXT;
  END;

  BEGIN
    SET ROLE snakzap_app;
    UPDATE "AuditLog" SET action = 'TAMPERED' WHERE id = test_id;
    RESET ROLE;
    test_number := 3; operation := 'UPDATE'; expected := 'DENIED';
    actual := 'ALLOWED-WORM-VIOLATION'; error_code := NULL; error_message := NULL;
    RETURN NEXT;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    test_number := 3; operation := 'UPDATE'; expected := 'DENIED';
    actual := 'DENIED'; error_code := SQLSTATE; error_message := SQLERRM;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    test_number := 3; operation := 'UPDATE'; expected := 'DENIED';
    actual := 'DENIED'; error_code := SQLSTATE; error_message := SQLERRM;
    RETURN NEXT;
  END;

  BEGIN
    SET ROLE snakzap_app;
    DELETE FROM "AuditLog" WHERE id = test_id;
    RESET ROLE;
    test_number := 4; operation := 'DELETE'; expected := 'DENIED';
    actual := 'ALLOWED-WORM-VIOLATION'; error_code := NULL; error_message := NULL;
    RETURN NEXT;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    test_number := 4; operation := 'DELETE'; expected := 'DENIED';
    actual := 'DENIED'; error_code := SQLSTATE; error_message := SQLERRM;
    RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    test_number := 4; operation := 'DELETE'; expected := 'DENIED';
    actual := 'DENIED'; error_code := SQLSTATE; error_message := SQLERRM;
    RETURN NEXT;
  END;

  IF has_table_privilege('snakzap_app', 'AuditLog', 'TRUNCATE') THEN
    test_number := 5; operation := 'TRUNCATE'; expected := 'DENIED';
    actual := 'ALLOWED-WORM-VIOLATION'; error_code := NULL; error_message := 'has_table_privilege=true';
    RETURN NEXT;
  ELSE
    test_number := 5; operation := 'TRUNCATE'; expected := 'DENIED';
    actual := 'DENIED'; error_code := '42501'; error_message := 'TRUNCATE privilege not granted';
    RETURN NEXT;
  END IF;

  DELETE FROM "AuditLog" WHERE id LIKE 'gap-test-%';
  RETURN;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;
