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

- **Closure attempt — assessment against 5 criteria:**

  **1. Production configuration:**
  - Firebase service-account credentials (`FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`): **NOT SET** in this environment.
  - Only client-side config (`NEXT_PUBLIC_FIREBASE_*`) is available — these are public-by-design Firebase web config, NOT server-side credentials.
  - Service-account JSON (which contains `private_key`) requires generation from Firebase Console → Project Settings → Service Accounts → Generate new private key. This file is NOT available in this sandbox.
  - **Production hard-disable verified:** `NODE_ENV=production` + no credentials → `verifyFirebaseToken()` throws `FIREBASE_ADMIN_NOT_CONFIGURED`. Demo-trust fallback is IMPOSSIBLE in production. ✅

  **2. Real-token verification:**
  - Cannot run. No service-account credentials configured.
  - The 5 required token tests (valid/expired/malformed/wrong-project/revoked) CANNOT be executed with real Firebase tokens.
  - Dev-mode tests (demo-trust) pass — but these are **simulation evidence**, NOT production evidence.
  - `verifyIdToken(idToken, true)` with `checkRevoked=true` is code-ready but NOT exercised. ❌

  **3. Server-side trust boundary:**
  - `firebase/session` route calls `verifyFirebaseToken(idToken)` — phone comes from VERIFIED token. ✅
  - Client-provided phone field is IGNORED (verified: `phone: '+919999999999'` in body → session created with token's phone `+919876500001`). ✅
  - Forged token (non-demo, non-real): REJECTED (401). ✅
  - Role boundary: non-vendor phone with `vendor_login` purpose: REJECTED (403). ✅
  - **Trust boundary holds in dev mode.** But: in production without credentials, ALL tokens are rejected (hard-fail) — which means NO authentication works at all. This is correct fail-closed behavior, but means the system is non-functional for real auth until credentials are provided.

  **4. Negative/security evidence:**
  - Forged client claims cannot bypass authentication (phone from token, not client body). ✅
  - Verification failures return consistent error envelope (`AUTHENTICATION_REQUIRED` 401 with traceId). ✅
  - Credentials not exposed: service-account env vars not set; `.env*` in `.gitignore`; client-side vars are public-by-design. ✅
  - Test endpoint production-guarded (403 in prod). ✅

  **5. Production test evidence:**
  - **NOT AVAILABLE.** No real Firebase service-account credentials in this environment.
  - All tests above are **dev/simulation evidence** only.
  - Real production-token tests require: (a) Firebase service-account JSON file, (b) Phone Auth enabled in Firebase Console, (c) Blaze plan for SMS, (d) real phone number with OTP for token generation.

- **Decision rule applied:**
  ```
  Real credentials + all required token tests pass → DEV-002 CLOSED
  NO real credentials → DEV-002 OPEN (evidence gap documented)
  ```

- **Status:** **OPEN** — production hard-disable works; trust boundary holds; dev tests pass. BUT: no real Firebase service-account credentials → real-token verification tests CANNOT run → production evidence NOT available.
  - What works: demo-trust disabled in production ✅, trust boundary ✅, dev-mode tests ✅, security/credential isolation ✅
  - What's outstanding: real Firebase service-account credentials + 5 real-token verification tests (valid/expired/malformed/wrong-project/revoked) with recorded evidence
- **Blocks:** P0-09 reaching `Production-ready` (S9). Does NOT block `Implemented` (S4).
- **Discovered:** Sprint 1, Wave 0. Closure attempt: Sprint 1, Wave 0. Evidence gap: no service-account credentials in this environment.
