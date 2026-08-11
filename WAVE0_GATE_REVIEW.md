# Wave-0 Gate Review — SnakZap Rebuild (Post-P0-21 PASS)

**Document type:** Wave-0 acceptance gate review
**Date:** 2026-08-11
**Review scope:** 7 runtime-verifiable P0s + 2 environment-boundary gaps + residual risk
**Decision required:** Wave-0 CLOSE / HOLD

---

## 1. Executive summary

**7 of 10 Wave-0 P0s have PASSed with fresh runtime evidence** in this rebuild. The remaining 3 are environment-boundary gaps that cannot be closed in the current sandbox:

| P0 | Status | Type |
|----|--------|------|
| P0-20 Audit Integrity | ✅ PASS | Runtime-verifiable |
| P0-19 Structured Logging | ✅ PASS | Runtime-verifiable |
| P0-18 Error Handling | ✅ PASS | Runtime-verifiable |
| P0-23 Kill-Switch Fail-Safe | ✅ PASS | Runtime-verifiable |
| P0-13 Rate Limiting | ✅ PASS | Runtime-verifiable |
| P0-16 Daily Backup | ✅ PASS | Runtime-verifiable |
| P0-21 Alert Evaluation | ✅ PASS | Runtime-verifiable |
| P0-09 / DEV-002 (Supabase JWT) | ✅ CLOSED | Runtime-verifiable (closed in prior rebuild phase) |
| P0-22 / DEV-001 (Production WORM) | 🔴 OPEN | Environment-boundary |
| P0-27 (CI/CD + rollback drill) | 🔴 OPEN | Environment-boundary |

**Gate decision recommendation: HOLD** — Wave-0 cannot be closed because two environment-boundary gaps remain. The 7 PASSed P0s are sufficient for code-level acceptance, but production-grade Wave-0 closure requires DEV-001 and P0-27 closure in a real deployment environment.

---

## 2. Consolidated evidence — 7 PASSed P0s

Each P0 was verified with real runtime HTTP evidence, captured in `worklog.md` under specific Task IDs. The evidence is reproducible — every P0 has a permanent test fixture endpoint that re-runs the verification on demand.

### 2.1 P0-20 — Audit Integrity

| Field | Value |
|---|---|
| Worklog Task ID | 42 (operational evidence), 46 (re-verified post-P0-23 fix) |
| Test fixture | `GET /api/audit-integrity-test` |
| Acceptance criteria | Hash-chain tamper-evidence + WORM prevention |
| Evidence summary | 6-step test: write audit event → verify chain → attempt UPDATE (blocked by WORM trigger) → attempt DELETE (blocked by WORM trigger) → re-verify chain intact → append follow-up event → chain grows correctly. allPassed: true |
| Key traceIds | (multiple, captured per-cycle in dev.log) |
| Runtime re-verify (this review) | `curl /api/audit-integrity-test` → PASS |

### 2.2 P0-19 — Structured Logging

| Field | Value |
|---|---|
| Worklog Task ID | 45 (P0-18 task also covered P0-19 correlation) |
| Test fixture | Real request paths emit JSON logs with traceId correlation |
| Acceptance criteria | JSON output + timestamp + level + traceId + domain helpers |
| Evidence summary | Custom structured logger emits JSON to stdout/stderr. Every API request path logs with traceId. Happy + error paths verified. traceId matches across response header (`X-Trace-Id`), response body, and server log line. |
| Runtime re-verify (this review) | (covered by P0-18 test — traceId correlation verified) |

### 2.3 P0-18 — Error Handling

| Field | Value |
|---|---|
| Worklog Task ID | 45 |
| Test fixture | `GET /api/p0-18-test` (throws generic Error → verifies unhandled-500 path) |
| Acceptance criteria | Standard error envelope + traceId in response + same traceId in server log + no sensitive leakage |
| Evidence summary | Three error classes tested: (1) CSRF rejection → 403 with traceId in envelope + matching log line; (2) Validation error in route → 400 with traceId matching across header/body/log; (3) Unhandled 500 → 500 with generic message + traceId matching log; raw error message stays server-side only. |
| Key traceIds | `6d65b17e-...` (CSRF), `18e83159-...` (validation), `64113474-...` (unhandled) |
| Runtime re-verify (this review) | `curl /api/p0-18-test` → 500 with INTERNAL_ERROR envelope (confirmed reachable) |

### 2.4 P0-23 — Kill-Switch Fail-Safe

| Field | Value |
|---|---|
| Worklog Task ID | 46 |
| Test fixture | `GET/POST /api/p0-23-test` (toggle DB-failure simulation + verify fail-safe) |
| Acceptance criteria | Fail-closed on DB read failure (NOT fail-open) + structured log + audited fail-safe event |
| Evidence summary | 5-step test: (1) Normal state — order created; (2) Kill-switch ON — order blocked (503); (3) Fail-safe — DB failure simulated, order blocked with `killSwitchSource:"safe-default"` (NOT fail-open); (4) Recovery — DB restored, order succeeds; (5) Bypass — 5 vectors attempted (3 portal ports + isCatering flag + GET method), all blocked. |
| Key traceIds | `7463550b-...` (normal), `e00bdbdb-...` (active), `80915172-...` (fail-safe), `05db7da1-...` (recovery) |
| Runtime re-verify (this review) | `curl /api/p0-23-test` → simulateDbFailure:false, source:"db" (clean state) |

### 2.5 P0-13 — Rate Limiting

| Field | Value |
|---|---|
| Worklog Task ID | 47 |
| Test fixture | `GET/POST /api/p0-13-test` (toggle limiter-failure simulation + reset state) |
| Acceptance criteria | Per-class thresholds + fail-closed on limiter-unavailable + health-check bypass + per-IP isolation |
| Evidence summary | 12-step test: (1) Pre-threshold 3 requests pass with X-RateLimit-Remaining decrement; (2) Over-threshold 4th+5th blocked with 503 (fail-closed, not 429); (3) Fail-closed on limiter-unavailable — 503 + handler NOT reached (no INSERT query); (4) Fail-open on general class — allowed through; (5) Health-check bypass — no rate-limit applied; (6) Recovery — normal request succeeds; (7) Per-class enforcement — otpSend/auth/general distinct limits; (8) IP isolation — same-class requests from different IPs counted separately; (9) traceId correlation across header/body/log. |
| Key traceIds | `9ed0cafc-...` (pre-threshold), `dc943552-...` (over-threshold), `08efcbea-...` (fail-closed), `cccb8d40-...` (correlation) |
| Runtime re-verify (this review) | `curl /api/p0-13-test` → simulateLimiterFailure:false (clean state) |

### 2.6 P0-16 — Daily Backup

| Field | Value |
|---|---|
| Worklog Task ID | 48 |
| Test fixture | `mini-services/backup-scheduler` (port 3004) — `/health`, `/trigger`, `/evidence` |
| Acceptance criteria | Real scheduler process + scheduled execution + backup artifact + SHA-256 checksum + restore verification + failure path + recovery |
| Evidence summary | 10-step test: (1) Real standalone bun process (PID 6507, PPID 1); (2) Immediate backup on startup succeeded; (3) Backup artifact created (.db + .sha256 files); (4) SHA-256 verified 3 ways (scheduler-stored, sha256sum CLI, Python hashlib — all match); (5) Restore verification — opened as valid SQLite, all 10 tables + WORM triggers + row counts match LIVE; (6) Failure path — DB unavailable → graceful failure logged, no crash; (7) Recovery — DB restored, next backup succeeds; (8) Trace/log evidence — structured JSON in execution-log.jsonl; (9) Retention/duplicate/concurrency — duplicates don't overwrite, 3 parallel triggers all succeed; (10) Clean state + P0-20 re-verified. |
| Key checksum | `0821a4f964a921c74a717c55c7ed1e9f7fd75d849575550349fb706f79aea4b2` (current DB content hash) |
| Runtime re-verify (this review) | `curl http://localhost:3004/health` → ok:true (scheduler alive) |

### 2.7 P0-21 — Alert Evaluation

| Field | Value |
|---|---|
| Worklog Task ID | 49 |
| Test fixture | `mini-services/alert-evaluator` (port 3005) — `/health`, `/trigger`, `/evidence` |
| Acceptance criteria | Real evaluator process + 8 rules + clean baseline + real alert condition + cooldown + recovery + per-rule enforcement |
| Evidence summary | 10-step test: (1) Real standalone bun process (PID 7632, PPID 1); (2) Immediate evaluation on startup — 8 rules, 0 alerts, cleanBaseline:true; (3) Clean baseline — 188+ cycles all clean, 0 false positives; (4) Real alert condition — audit chain tampered → invariant-violation + unknown-state-detected rules FIRED; (5) Structured JSON alert log with severity + ruleId + name + context; (6) Cooldown — payment-success-rate fires once, suppressed on subsequent cycle within 300s window (1 ALERT JSON line, not 2 — verified post-fix); (7) Recovery — condition cleared → cleanBaseline:true; (8) Per-rule enforcement — 3 distinct rule classes fired (no-cooldown, 30s, 300s); (9) Trace/log evidence — 209 cycles in evaluation-log.jsonl + ALERT lines in stderr; (10) Clean state + P0-20 re-verified. |
| Gap fixed during testing | `alertFired` flag was lying (set to `triggered` directly, reported True even when cooldown suppressed). Fixed: `fireAlert()` now returns boolean; `alertFired` reflects actual emit state. |
| Runtime re-verify (this review) | `curl http://localhost:3005/evidence` → totalCycles:242, lastClean:true |

### 2.8 P0-09 / DEV-002 — Supabase JWT (CLOSED in prior phase)

| Field | Value |
|---|---|
| Worklog Task ID | 44 |
| Test fixture | `src/lib/supabase-admin.ts` + `/api/auth/supabase/session` route |
| Acceptance criteria | Server-side JWT verification via Supabase JWKS |
| Evidence summary | 8 JWT verification tests all PASS: valid-token accept, malformed-token reject, malformed-jwt-structure reject, empty-token reject, tampered-token reject (signature verification failed), wrong-issuer reject, wrong-audience reject, expiry-check reject (jose verifies automatically). |

---

## 3. Open gap analysis

### 3.1 DEV-001 / P0-22 — Production WORM boundary

**What's PASSed locally:**
- SQLite `BEFORE UPDATE` + `BEFORE DELETE` triggers on `AuditLog` table (migration `20260809185723_audit_hash_chain`)
- Triggers raise `AUDIT_WORM: UPDATE/DELETE rejected` ABORT
- Verified: direct Prisma UPDATE + DELETE blocked (P0-20 audit-integrity-test steps 3+4)
- Hash-chain tamper-evidence: each entry's `hash` = SHA-256(prevHash + entry data); broken linkage detected by `auditIntegrityCheck()`

**What's NOT PASSed (the gap):**
- **Trigger can be DROPPED by anyone with DB admin access** — verified during this review:
  ```sql
  DROP TRIGGER IF EXISTS prevent_audit_update;  -- succeeds, no auth check
  ```
  After DROP, UPDATE/DELETE succeed — WORM bypassed.
- SQLite has no row-level privilege model (`GRANT`/`REVOKE` not supported)
- No separate WORM storage service (e.g. AWS QLDB, append-only S3 bucket)

**What production boundary requires:**
- PostgreSQL with `REVOKE UPDATE, DELETE ON AuditLog FROM application_role;` — application cannot DROP triggers (only superuser can)
- OR managed WORM storage (AWS QLDB, Azure Immutable Blob, GCP Bucket Lock)
- OR separate audit database with restricted admin access

**Residual risk if Wave-0 closed without DEV-001 closure:**
- Insider threat: anyone with SQLite file access (or DB admin) can tamper audit logs without detection-beyond-hash-chain (hash-chain detects mutation but cannot prevent it if triggers are dropped)
- Compliance: regulatory audits may reject SQLite-based WORM as insufficient

**Closure path:**
- Provision PostgreSQL instance (managed RDS or self-hosted)
- Update `prisma/schema.prisma` datasource from `sqlite` → `postgresql`
- Run `prisma migrate deploy`
- `REVOKE UPDATE, DELETE ON audit_log FROM snakzap_app;`
- Re-run P0-20 audit-integrity-test in production environment
- Capture fresh runtime evidence

### 3.2 P0-27 — CI/CD + rollback drill

**What's implemented (code-level):**
- `src/lib/deployment.ts` — feature flags (env-based), deployment class classifier (3 classes: backward-compatible, expand-migrate-contract, breaking), rollback procedure documentation per class
- Feature flags: `realPayments`, `pickupAttributionEnforcement`, `drDrillMode`, `outboxPublisher`, `concurrencyControl`
- 49 git commits (local history, no remote)

**What's NOT implemented (the gap):**
- **No CI/CD pipeline** — no `.github/workflows/`, no `.gitlab-ci.yml`, no Jenkinsfile
- **No deployment target** — no production URL, no staging environment
- **No Dockerfile** — no containerization
- **No deploy scripts** — no `deploy.sh`, no `make deploy`
- **No git remote** — `git remote -v` returns empty (no `git push` target)
- **No `gh` CLI** — cannot create PRs or trigger GitHub Actions
- **No actual rollback drill evidence** — ≤10min rollback criterion never exercised against real deployed environment with traffic

**Residual risk if Wave-0 closed without P0-27 closure:**
- Deployment is manual + unrepeatable — no CI guarantees lint/test/build before deploy
- Rollback time unverified — could exceed 10min in real incident
- No canary/staging — bad deploy goes straight to production
- No audit trail of deploys (no CI logs)

**Closure path:**
- Provision CI/CD environment (GitHub Actions recommended)
- Create `.github/workflows/ci.yml` (lint + test + build on every PR)
- Create `.github/workflows/deploy.yml` (deploy to staging on merge to main, manual promote to prod)
- Create Dockerfile + docker-compose
- Provision staging + production environments (Vercel/Railway/Fly.io for Next.js + managed Postgres)
- Run rollback drill: deploy v1 → deploy v2 (broken) → trigger rollback → measure time ≤10min
- Capture fresh runtime evidence (deploy logs + rollback timing)

---

## 4. Residual risk assessment

Even if Wave-0 were closed today, the following residual risks remain:

### 4.1 High-severity risks (block production launch)

| Risk | Cause | Mitigation |
|---|---|---|
| Audit log tamperable by DB admin | DEV-001 not closed | Do NOT launch in regulated industries (fintech, healthcare) until PostgreSQL WORM deployed |
| No automated deploy pipeline | P0-27 not closed | Do NOT launch at scale until CI/CD + rollback drill verified |
| No production traffic evidence | All P0s tested in dev only | Beta launch with limited users before full launch |

### 4.2 Medium-severity risks (acceptable for beta)

| Risk | Cause | Mitigation |
|---|---|---|
| In-memory rate limiter (not Redis) | Single-instance dev only | Acceptable for single-instance beta; add Redis before multi-instance |
| In-memory session store (not Redis) | Single-instance dev only | Same as above |
| No real payment integration | Razorpay not wired | P0-01 not yet implemented (out of Wave-0 scope) |
| No real-time pickup attribution | QR+OTP not enforced | P0-07 not yet implemented (out of Wave-0 scope) |

### 4.3 Low-severity risks (acceptable for dev/staging)

| Risk | Cause | Mitigation |
|---|---|---|
| Demo OTP codes returned in API response | Dev mode only | Disabled in production via `NODE_ENV=production` guard |
| No backup retention policy | P1 enhancement | Add 30-day retention before production |
| Test fixture endpoints accessible in dev | Required for verification | All return 403 in production via `NODE_ENV=production` guard |

---

## 5. Independence claim

**Historical G/H reviews were lost in the rebuild.** The prior rebuild (pre-Task ID 40) had consolidated G (governance) and H (handoff/acceptance) reviews that are NOT reconstructable from the current `worklog.md`. Per governance rule: "Rebuild 前的 historical approvals/reviews 不可重建" — they cannot be reused.

**Fresh G/H review required for Wave-0 closure:**
- G (governance) review: independent reviewer must verify the 7 PASSed P0s against their matrix acceptance criteria, not against the IDE's self-reported evidence
- H (handoff/acceptance) review: independent reviewer must confirm operational readiness + sign-off

**This document (WAVE0_GATE_REVIEW.md) is the IDE's consolidated evidence submission for G/H review. It is NOT itself the G/H review — that requires an independent reviewer.**

**Named approval field (Section 7) is intentionally left blank pending independent review.**

---

## 6. Wave-0 gate criteria check

Per Production Readiness Matrix v1.4, Wave-0 gate requires ALL 7 conditions met:

| # | Condition | Status |
|---|---|---|
| 1 | All P0 Production-ready | ❌ 7/10 PASSed, 3 OPEN (DEV-001, P0-27, P0-09 CLOSED) |
| 2 | All invariants validated | ✅ I-07 (audit integrity) validated via P0-20; I-09 (kill-switch monotonicity) via P0-23 |
| 3 | All dependency scenarios tested | ✅ P0-23 fail-safe, P0-13 fail-closed, P0-16 failure path, P0-21 recovery |
| 4 | DR drill passed | ❌ P0-26 not yet implemented (out of Wave-0 scope per matrix) |
| 5 | Rollback drill passed | ❌ P0-27 OPEN — no deployment environment |
| 6 | No unresolved exceptions | ✅ All exceptions handled via P0-18 withErrorHandler |
| 7 | No expired exemptions | ✅ No exemptions recorded |

**Wave-0 gate: NOT CLOSED** — conditions 1, 4, 5 not met.

---

## 7. Named approval (pending independent review)

| Field | Value |
|---|---|
| Independent reviewer | _(awaiting assignment)_ |
| Review date | _(awaiting)_ |
| G review result | _(awaiting)_ |
| H review result | _(awaiting)_ |
| Conditions for closure | DEV-001 closure (PostgreSQL WORM) + P0-27 closure (CI/CD + rollback drill) |
| Decision | **HOLD** — Wave-0 cannot be closed until environment-boundary gaps resolved |

---

## 8. Recommended next actions

### 8.1 Immediate (this week)
- [ ] Submit this document for independent G/H review
- [ ] Capture reviewer name + decision in Section 7
- [ ] If HOLD confirmed: proceed to environment-boundary closures

### 8.2 Environment-boundary closures (next sprint)
- [ ] **DEV-001 closure**: provision PostgreSQL, update Prisma datasource, run migrations, `REVOKE UPDATE/DELETE`, re-verify P0-20 in production
- [ ] **P0-27 closure**: provision CI/CD (GitHub Actions), create Dockerfile, deploy to staging, run rollback drill with ≤10min evidence

### 8.3 Post-Wave-0 (next wave)
- [ ] Wave-1 UNLOCKED only after Wave-0 CLOSE
- [ ] P0-25 (concurrency control) implementation can begin after Wave-1 unlock
- [ ] P0-01 (payments), P0-07 (pickup attribution), P0-26 (DR drill) — out of Wave-0 scope, scheduled for later waves

---

## 9. Conclusion

**Wave-0 Gate Review decision: HOLD**

The 7 runtime-verifiable P0s have PASSed with fresh, reproducible runtime evidence. The IDE's verification work is complete for the code-level acceptance criteria. However, Wave-0 closure requires two environment-boundary gaps to be resolved in a real deployment environment:

1. **DEV-001 / P0-22** — production WORM (PostgreSQL `REVOKE` or QLDB)
2. **P0-27** — CI/CD pipeline + ≤10min rollback drill evidence

These cannot be closed in the current sandbox. They require:
- A managed PostgreSQL instance (for DEV-001)
- A CI/CD environment with deployment target (for P0-27)
- An independent G/H reviewer to sign off

**No P0-25 implementation. No Wave-1 unlock. No production launch until Wave-0 CLOSE.**

---

**Document end.**
