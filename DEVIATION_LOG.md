# Deviation Log

> **Tracks architectural gaps discovered during implementation.**
> **Discipline (per stakeholder):** If implementation reveals a real architectural gap, it is recorded here as a **deviation** — NOT silently fit into an existing P0, invariant, or dependency. Each deviation is reviewed and either (a) accepted as-is with justification, (b) routed to a matrix v1.5 change, or (c) resolved by adjusting implementation to match the locked plan.

---

## Deviation entries

### DEV-001 — P0-22 Audit integrity: storage-level WORM not enforced (SQLite dev)

- **P0:** P0-22 (Audit trail integrity)
- **Invariant:** I-07 (Audit Integrity)
- **Matrix acceptance criteria:** "Audit entries immutable; every admin/financial action audited" + enforcement: "Storage-level WORM + reject on update/delete"
- **Implementation state:** Application-level append-only via `src/lib/audit.ts` (single sanctioned write path; read-only elsewhere). However, SQLite (dev DB) does NOT support row-level immutability — any code with DB access could UPDATE/DELETE audit rows.
- **Gap:** Storage-level WORM enforcement is NOT satisfied in the current dev environment. The application helper prevents accidental mutation via the API, but does not prevent direct DB access from mutating the audit table.
- **Classification:** Acceptance evidence gap (NOT a silent fit). The implementation is correct for the application layer; the gap is in the storage layer, which requires production-grade infrastructure (PostgreSQL with REVOKE UPDATE/DELETE, or a WORM storage service like AWS QLDB, or a separate audit database).
- **Status:** OPEN — must be resolved before P0-22 can reach `Production-ready`. Resolution options:
  1. PostgreSQL with `REVOKE UPDATE, DELETE ON audit_logs FROM app_user` (production deployment)
  2. Hash-chained append-only log (each audit entry includes hash of previous entry — tamper-evident)
  3. Separate audit database with no mutation API exposed
- **Does NOT block:** P0-22 reaching `Implemented` (S4) — code is written and functional. DOES block P0-22 reaching `Production-ready` (S9).
- **Discovered:** Sprint 1, Wave 0 implementation.

### DEV-002 — P0-09 Firebase verify: demo-trust mode (no service-account credentials)

- **P0:** P0-09 (Server-side Firebase ID token verification)
- **Invariant:** I-12 (Session Revocation)
- **Matrix acceptance criteria:** "Server rejects unverified identity; sessions bound to verified phone" + dependency: "Firebase Admin SDK + session"
- **Implementation state:** `src/lib/firebase-admin.ts` installed with `verifyFirebaseToken()` via Firebase Admin SDK. The verification path is fully implemented and activates when `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON` env var is set. However, NO service-account credentials are currently configured — the system runs in "demo-trust mode" where client claims are accepted without server-side verification.
- **Gap:** Server-side ID token verification is NOT executing. The code path exists but is inactive. In demo-trust mode, a forged client claim (any phone number) would be accepted — this is a direct I-12 violation risk.
- **Classification:** Acceptance evidence gap (NOT a silent fit). The implementation is architecturally correct; the gap is the missing production credential configuration.
- **Status:** OPEN — must be resolved before P0-09 can reach `Production-ready`. Resolution: configure Firebase service-account key in production environment; verify with real/expired/malformed/cross-project token tests.
- **Does NOT block:** P0-09 reaching `Implemented` (S4) — code is written and the verification path is ready. DOES block P0-09 reaching `Production-ready` (S9).
- **Discovered:** Sprint 1, Wave 0 implementation.
