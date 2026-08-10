# Deviation Log

> **Tracks architectural gaps discovered during implementation.**
> **Discipline (per stakeholder):** If implementation reveals a real architectural gap, it is recorded here as a **deviation** — NOT silently fit into an existing P0, invariant, or dependency. Each deviation is reviewed and either (a) accepted as-is with justification, (b) routed to a matrix v1.5 change, or (c) resolved by adjusting implementation to match the locked plan.

---

## Deviation entries

### DEV-001 — P0-22 Audit integrity: storage-level WORM not enforced (SQLite dev)

- **P0:** P0-22 (Audit trail integrity)
- **Invariant:** I-07 (Audit Integrity)
- **Matrix acceptance criteria:** "Audit entries immutable; every admin/financial action audited" + enforcement: "Storage-level WORM + reject on update/delete"

- **Mitigation layers implemented (progress, NOT acceptance closure):**
  1. **Application-level append-only** (`src/lib/audit.ts`): single sanctioned write path; all other access read-only.
  2. **Hash-chain tamper-evidence**: each entry includes `prevHash` + `hash` (SHA-256). `auditIntegrityCheck()` verifies full chain. 7-step test harness passes — UPDATE and DELETE mutations are DETECTED.
  3. **SQLite DB triggers** (`prevent_audit_update`, `prevent_audit_delete`): `BEFORE UPDATE` and `BEFORE DELETE` triggers with `RAISE(ABORT)` reject mutations at the DB engine level. Tested:
     - ✅ Authorized INSERT works (audit write succeeds)
     - ✅ Unauthorized UPDATE: REJECTED by DB trigger
     - ✅ Unauthorized DELETE: REJECTED by DB trigger

- **Critical finding — SQLite CANNOT faithfully enforce storage-level WORM:**
  - **BYPASS TEST PASSED**: `DROP TRIGGER prevent_audit_update; UPDATE AuditLog SET action='BYPASSED';` — SUCCEEDED.
  - Anyone with DB write access can DROP the triggers, mutate audit entries, and re-create triggers.
  - SQLite has no permission system (no GRANT/REVOKE like PostgreSQL) to prevent trigger dropping.
  - **This is NOT storage-level WORM.** Storage-level WORM must be UN-BYPASSABLE even by someone with DB access.
  - Per stakeholder governance constraint: "If SQLite cannot faithfully enforce storage-level WORM, do NOT declare it implemented."

- **Closure criterion (production storage architecture):**
  DEV-001 can only be CLOSED when ONE of the following is deployed AND tested with attempted-mutation-rejected evidence:
  1. **PostgreSQL with `REVOKE UPDATE, DELETE ON audit_logs FROM app_user`** — DB permission prevents mutation even from application user; DBA retains access but audit trail is separate from app credentials.
  2. **AWS QLDB or equivalent WORM storage service** — immutable by design; mutations impossible at storage level.
  3. **Separate audit database** with no mutation API exposed — application can only INSERT; no UPDATE/DELETE path exists.
  In all cases: unauthorized UPDATE/DELETE attempt must be REJECTED (not just detected), and the rejection must be at the storage/permission level (not bypassable by DB write access).

- **Status:** **OPEN** — mitigation layers implemented (hash-chain + SQLite triggers); acceptance criterion outstanding (production storage-level WORM).
  - Mitigation layers: hash-chain (detection) + SQLite triggers (DB-level rejection, but bypassable).
  - Outstanding: production storage architecture that provides un-bypassable WORM enforcement.
  - SQLite dev environment CANNOT faithfully enforce storage-level WORM — bypass test proves it.
- **Blocks:** P0-22 reaching `Production-ready` (S9). Does NOT block `Implemented` (S4).
- **Discovered:** Sprint 1, Wave 0. Bypass test: Sprint 1, Wave 0 closure attempt.

### DEV-002 — P0-09 Firebase verify: demo-trust mode (no service-account credentials)

- **P0:** P0-09 (Server-side Firebase ID token verification)
- **Invariant:** I-12 (Session Revocation)
- **Matrix acceptance criteria:** "Server rejects unverified identity; sessions bound to verified phone" + dependency: "Firebase Admin SDK + session"
- **Implementation state:** `src/lib/firebase-admin.ts` with `verifyFirebaseToken()` via Firebase Admin SDK.
- **Closure actions taken:**
  1. Demo-trust mode is now HARD-DISABLED in production (`NODE_ENV=production` → throws `FIREBASE_ADMIN_NOT_CONFIGURED` error; no fallback to trusting client claims).
  2. `firebase/session` route now calls `verifyFirebaseToken(idToken)` — phone number comes from the VERIFIED token, NOT from client claim.
  3. Verification test harness at `/api/auth/firebase/verify-test` — 5 dev-mode tests all pass:
     - missing-token → reject ✅
     - malformed-token → reject ✅
     - malformed-demo-format → reject ✅
     - valid-demo-token → accept ✅
     - demo-token-no-phone → reject ✅
  4. Production verification path (`verifyIdToken(idToken, true)` with `checkRevoked=true`) is code-ready — verifies signature, expiry, issuer, audience, revocation.
  5. Production-mode tests (valid/expired/malformed/wrong-project/revoked tokens) are documented as manual tests requiring real Firebase service-account credentials.
- **Remaining gap:** Production verification path is CODE-READY but NOT EXERCISED with real credentials. Firebase service-account key not configured in this environment.
- **Status:** OPEN — production fallback disabled; production verification evidence outstanding.
  - Mitigation progress: demo-trust HARD-DISABLED in production (NODE_ENV=production → throws, no fallback). Route now calls verifyFirebaseToken() — phone from VERIFIED token, not client claim. Dev-mode test harness passes 5 tests.
  - Outstanding acceptance: real Firebase service-account credentials not configured. Production verification path (verifyIdToken with checkRevoked=true) is code-ready but NOT EXERCISED with real tokens. Manual production-token tests (valid/expired/malformed/wrong-project/revoked) not yet run.
  - "Partially closed" is a PROGRESS label, NOT acceptance closure. Deviation remains OPEN until real credentials are configured and all production-token verification tests pass with evidence.
- **Blocks:** P0-09 reaching `Production-ready` (S9). Does NOT block `Implemented` (S4).
- **Discovered:** Sprint 1, Wave 0. Mitigation added: Sprint 1, Wave 0 closure. Acceptance outstanding.
