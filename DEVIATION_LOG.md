# Deviation Log

> **Tracks architectural gaps discovered during implementation.**
> **Discipline (per stakeholder):** If implementation reveals a real architectural gap, it is recorded here as a **deviation** — NOT silently fit into an existing P0, invariant, or dependency. Each deviation is reviewed and either (a) accepted as-is with justification, (b) routed to a matrix v1.5 change, or (c) resolved by adjusting implementation to match the locked plan.

---

## Deviation entries

### DEV-001 — P0-22 Audit integrity: storage-level WORM not enforced (SQLite dev)

- **P0:** P0-22 (Audit trail integrity)
- **Invariant:** I-07 (Audit Integrity)
- **Matrix acceptance criteria:** "Audit entries immutable; every admin/financial action audited" + enforcement: "Storage-level WORM + reject on update/delete"
- **Closure actions taken:**
  1. Hash-chain tamper-evidence implemented: each audit entry includes `prevHash` (SHA-256 of previous entry) + `hash` (SHA-256 of own data). Schema migrated; seed updated.
  2. `auditIntegrityCheck()` walks the full chain chronologically, recomputes each hash, verifies chain linkage (prevHash matches) and hash integrity (stored hash matches recomputed).
  3. Test harness at `/api/audit-integrity-test` — 7 steps, all pass:
     - Write audit event ✅
     - Verify chain (pre-mutation): intact ✅
     - Attempt UPDATE mutation: applied ✅
     - Verify chain (post-mutation): tamper DETECTED (hash mismatch) ✅
     - Restore original value ✅
     - Delete detection: DELETE DETECTED (prevHash mismatch) ✅
     - Clean state restored: chain intact ✅
  4. Known limitation documented: "restore-to-original" after UPDATE is undetectable by hash-chain alone (hash recomputes to same value). This is inherent to hash-chain without external anchor. DELETE detection works (chain linkage breaks).
- **Remaining gap:** Hash-chain provides tamper-EVIDENCE (detection), NOT tamper-PREVENTION (blocking). Matrix acceptance demands "Storage-level WORM + reject on update/delete" — true prevention requires production storage (PostgreSQL REVOKE, QLDB, or separate audit DB). SQLite cannot enforce this.
- **Status:** OPEN — mitigation implemented (hash-chain tamper-evidence); acceptance criterion outstanding (storage-level WORM prevention).
  - Mitigation progress: hash-chain makes mutations DETECTABLE (UPDATE hash mismatch + DELETE chain-breakage both tested).
  - Outstanding acceptance: matrix demands "Storage-level WORM + reject on update/delete" — true PREVENTION (blocking mutations, not just detecting them) requires production-grade immutable storage (PostgreSQL REVOKE UPDATE/DELETE, AWS QLDB, or separate audit DB). SQLite cannot enforce this.
  - "Partially closed" is a PROGRESS label, NOT acceptance closure. Deviation remains OPEN until storage-level WORM is deployed and attempted-mutation-rejected evidence is produced.
- **Blocks:** P0-22 reaching `Production-ready` (S9). Does NOT block `Implemented` (S4).
- **Discovered:** Sprint 1, Wave 0. Mitigation added: Sprint 1, Wave 0 closure. Acceptance outstanding.

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
