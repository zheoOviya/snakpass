# Independent G/H Review — DEV-001 / P0-22 Production WORM Closure

## Reviewer
- **Role:** Independent G/H Reviewer (sub-agent, no prior involvement in DEV-001 implementation)
- **Date:** 2026-08-13
- **Scope:** DEV-001 / P0-22 (Production WORM Closure)
- **Mandate:** Independently evaluate the IDE's PASS_CANDIDATE evidence chain and issue a formal verdict.
- **Independence statement:** I did NOT write any of the code under review, did NOT trigger any of the workflow runs, and have evaluated the evidence on its own merits. Where I could not independently verify a claim, I have said so explicitly.

---

## Evidence Reviewed

| # | Evidence item claimed by IDE | Verification method I used | Verification status |
|---|---|---|---|
| 1 | Supabase managed PostgreSQL project (ref `zmzqqcyapcezmaqvuzzd`, ap-northeast-1) provisioned via Management API | Cross-checked `PROJECT_REF: zmzqqcyapcezmaqvuzzd` is hardcoded in all three live workflows; cannot reach Supabase API directly (no token) but workflows using this ref produce 200-OK runs | ⚠️ INDIRECT — assumed live |
| 2 | Schema migration: all 9 tables + WORM trigger functions installed | Read `prisma/scripts/postgres-migration.sql` (242 lines). Verified tables, FKs, indexes, trigger functions | ✅ VERIFIED locally |
| 3 | Role separation: `snakzap_admin` (CREATEDB/CREATEROLE) + `snakzap_app` (NOCREATEDB/NOCREATEROLE) | Read `prisma/scripts/create-roles.sql` (126 lines). Verified CREATE ROLE attributes and GRANT statements | ✅ VERIFIED locally |
| 4 | REVOKE UPDATE/DELETE/TRUNCATE on `AuditLog` FROM `snakzap_app` | Read `prisma/scripts/revoke-worm.sql` (99 lines). Verified REVOKE statements + information_schema assertion logic | ✅ VERIFIED locally |
| 5 | information_schema.role_table_grants verification | Verified the SQL query is well-formed and the assertion `RAISE EXCEPTION` fires if UPDATE/DELETE/TRUNCATE is granted to `snakzap_app` | ✅ VERIFIED locally (logic correct) |
| 6 | Runtime ACL check via `has_table_privilege()` returning INSERT/SELECT ALLOWED, UPDATE/DELETE/TRUNCATE DENIED | Read workflow YAML `dev-001-gap-closure.yml`. Verified SQL is syntactically correct. **Could NOT verify the actual JSON output content** — requires artifact download (no PAT available; GitHub API rate limit exhausted during review) | ⚠️ PARTIALLY VERIFIED — workflow structure correct, run output content NOT independently inspected |
| 7 | Direct 42501 error not captured — IDE admits gap, claims `has_table_privilege()` is sufficient substitute | Reviewed the substitution reasoning and PostgreSQL semantics | ✅ Assessed below (Section F) |
| 8 | Workflow runs exist on GitHub Actions and concluded success | Pulled HTML pages of `https://github.com/zheoOviya/snakpass/actions` and individual run pages (unauthenticated, served via CDN, not rate-limited) | ✅ VERIFIED via HTML scrape |
| 9 | Commit SHAs traceable | Cross-referenced run-page commit SHAs with local `git log` and `git ls-remote origin` | ✅ VERIFIED |

---

## Assessment

### A. Schema Migration

**File:** `prisma/scripts/postgres-migration.sql` (242 lines)

**Findings:**
- All 9 required tables created with `CREATE TABLE IF NOT EXISTS`: User, OtpRequest, Session, Restaurant, MenuItem, Order, OrderItem, AuditLog, KillSwitch. Plus a `_prisma_migrations` tracking table.
- Foreign keys declared with explicit `CONSTRAINT` names matching the Prisma schema.
- Indexes on hot lookup paths (`OtpRequest_target_purpose_idx`, `Session_userId_idx`).
- `AuditLog` includes the hash-chain columns `prevHash` (default `'GENESIS'`) and `hash` — consistent with the application-level tamper-evidence layer.
- Two WORM trigger functions installed correctly in PostgreSQL syntax:
  - `prevent_audit_update()` — `BEFORE UPDATE … FOR EACH ROW`, raises `AUDIT_WORM: UPDATE rejected`.
  - `prevent_audit_delete()` — `BEFORE DELETE … FOR EACH ROW`, raises `AUDIT_WORM: DELETE rejected`.
- Triggers `prevent_audit_update_trigger` and `prevent_audit_delete_trigger` are wired to the functions on `AuditLog`.
- Migration is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`) and wrapped in a single `BEGIN/COMMIT` transaction.
- Note in the comments is accurate: triggers are a *secondary* defense; the primary boundary is the REVOKE at the privilege level (see Section C).

**Verdict for A:** ✅ Correct. Migration is production-grade and consistent with the closure claim.

---

### B. Role Separation

**File:** `prisma/scripts/create-roles.sql` (126 lines)

**Findings:**
- Two roles created via idempotent `DO $$ … IF NOT EXISTS (SELECT FROM pg_roles …)` block:
  - `snakzap_admin`: `WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION_USE_SECRET_MANAGER' CREATEDB CREATEROLE` — full DDL + DML + privilege management.
  - `snakzap_app`: `WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION_USE_SECRET_MANAGER' NOCREATEDB NOCREATEROLE` — DML only, no DDL, no privilege management.
- `GRANT USAGE ON SCHEMA public` to both roles (required to access any object in `public`).
- `snakzap_admin` receives `ALL PRIVILEGES ON ALL TABLES` and `ALL PRIVILEGES ON ALL SEQUENCES`.
- `snakzap_app` receives explicit per-table grants:
  - `SELECT, INSERT, UPDATE, DELETE` on all operational tables (User, OtpRequest, Session, Restaurant, MenuItem, Order, OrderItem, KillSwitch).
  - `SELECT, INSERT` only on `AuditLog` — **this is the WORM boundary line**. UPDATE/DELETE are deliberately omitted.
- Sequence usage granted to both roles (required for any `SERIAL`/`IDENTITY` columns — though the schema uses `TEXT` PKs, this is harmless).
- `ALTER DEFAULT PRIVILEGES` is intentionally skipped (requires CREATEROLE which the Management API doesn't grant).

**Caveats / weaknesses:**
- Passwords are hardcoded placeholders `'CHANGE_ME_IN_PRODUCTION_USE_SECRET_MANAGER'`. This is documented and the comment says they must be rotated via a secret manager, but the script does not enforce rotation. A real production deployment must source these from secrets. **Not a blocker for DEV-001 closure** (the privilege boundary is what matters, not the password strength), but worth flagging.
- There is no `REVOKE` of default `PUBLIC` grants — though PostgreSQL grants nothing on user-created tables to `PUBLIC` by default, so this is not a material issue here.
- The role separation is **meaningful, not cosmetic**: `snakzap_app` cannot `DROP TABLE`, cannot `CREATE ROLE`, cannot `GRANT` privileges to itself or others. The AuditLog boundary is enforced at the GRANT level (only SELECT+INSERT granted) and *reinforced* at the REVOKE level (see Section C).

**Verdict for B:** ✅ Correct and meaningful. Role separation is real and auditable.

---

### C. REVOKE Boundary

**File:** `prisma/scripts/revoke-worm.sql` (99 lines)

**Findings:**
- Three explicit REVOKEs:
  - `REVOKE UPDATE ON "AuditLog" FROM snakzap_app;`
  - `REVOKE DELETE ON "AuditLog" FROM snakzap_app;`
  - `REVOKE TRUNCATE ON "AuditLog" FROM snakzap_app;`
- TRUNCATE is correctly called out as a separate PostgreSQL privilege (unlike SQLite, where TRUNCATE doesn't exist as a distinct permission).
- The script wraps an inline verification block using `information_schema.role_table_grants`:
  - Queries each privilege type (UPDATE, DELETE, TRUNCATE, INSERT, SELECT) for `grantee = 'snakzap_app'` on `table_name = 'AuditLog'`.
  - Prints a NOTICE for each, marking the WORM-critical privileges (UPDATE/DELETE/TRUNCATE) with "NOT GRANTED ✅ (WORM boundary)" or "GRANTED ⚠️ (WORM violation!)".
  - **Crucially**, the block ends with `IF has_update OR has_delete OR has_truncate THEN RAISE EXCEPTION 'WORM boundary VIOLATED …'`. This is an executable assertion that fails the transaction if the boundary is broken.
- Final `SELECT … GROUP BY grantee, table_name` prints the effective grants for evidence capture.

**Verdict for C:** ✅ Correct and self-asserting. The REVOKE is explicit, and the verification step both documents and enforces the boundary.

---

### D. information_schema Evidence

**Mechanism:** `SELECT … FROM information_schema.role_table_grants WHERE table_name = 'AuditLog' AND grantee IN ('snakzap_admin', 'snakzap_app')`

**Assessment:**
- This is a valid, standard way to inspect effective privileges on a table. `information_schema.role_table_grants` is the ANSI-compliant view of `pg_class.relacl` (parsed into rows).
- It reflects the current ACL state — same source that PostgreSQL consults at statement-execution time.
- It distinguishes explicit grants (what `GRANT` produced) from inherited/implicit privileges.
- **Limitations:**
  - It shows *granted* privileges, not the *effective* runtime privilege a statement would encounter. Effective privilege combines grants with role memberships, default privileges, column-level overrides, row-security policies, and SECURITY DEFINER context. For our case (no row-security policies, no column-level overrides on AuditLog, no role memberships on `snakzap_app`), the granted-vs-effective distinction collapses — so this is a non-issue here.
  - It does not test what happens when an actual `UPDATE` statement is issued. It only inspects the catalog. This is exactly the gap Section F addresses.
- Combined with the inline `RAISE EXCEPTION` assertion, this query provides strong **static** evidence that the privilege boundary is in place.

**Verdict for D:** ✅ Valid and sufficient as static evidence. Not sufficient alone as runtime evidence (see Section E + F).

---

### E. has_table_privilege() Runtime ACL Check

**Workflow:** `.github/workflows/dev-001-gap-closure.yml`

**Mechanism:**
```sql
SELECT 'INSERT' AS operation, 'ALLOWED' AS expected,
       CASE WHEN has_table_privilege('snakzap_app', '"AuditLog"', 'INSERT')
            THEN 'ALLOWED' ELSE 'DENIED' END AS actual
UNION ALL … (SELECT, UPDATE, DELETE, TRUNCATE)
```

**Assessment of `has_table_privilege()` semantics:**
- `has_table_privilege(role, table, privilege)` is a **built-in runtime function**, not a static catalog view.
- Internally it calls the same `pg_class_aclcheck()` machinery that PostgreSQL's parser/executor invokes when validating a statement. The function consults `pg_class.relacl`, role memberships (`pg_auth_members`), and SUPERUSER status — exactly the same inputs that the executor uses to decide whether to raise `ERROR: permission denied for table "AuditLog"` (SQLSTATE 42501).
- **Therefore:** if `has_table_privilege('snakzap_app', '"AuditLog"', 'UPDATE')` returns `false`, attempting `UPDATE "AuditLog" …` as `snakzap_app` *will* raise SQLSTATE 42501. The two are functionally equivalent — they consult the same code path with the same inputs. The function is the literal ACL predicate the executor uses.

**Limitations of this approach:**
1. **It does not prove the application actually connects as `snakzap_app`.** If the application's connection string uses a different role (e.g., `postgres` superuser, or the Supabase pooler's `authenticator` role), the privilege boundary doesn't apply at runtime. This is a deployment-configuration concern, not a closure-acceptance concern — but it should be verified before production launch.
2. **It does not exercise the trigger layer.** A defensive-in-depth claim (triggers + REVOKE) requires testing both. The REVOKE path is exercised by `has_table_privilege()`. The trigger path is *not* exercised by this workflow — only declared present in `postgres-migration.sql`. The IDE's previous evidence (worklog Task 47, hash-chain + SQLite triggers) is bypass-evidence in SQLite, not PostgreSQL.
3. **It does not produce an actual `42501` error code as evidence.** The function returns boolean `true/false`, not a SQLSTATE. See Section F.
4. **Table-name quoting:** the SQL uses `'"AuditLog"'` (literal double quotes inside the string) because the table was created with quoted camelCase. The IDE's commit `67eea8c` ("Fix: use heredoc for SQL + correct table name quoting for has_table_privilege") confirms this was iterated on. The final form is syntactically correct.

**Verdict for E:** ✅ `has_table_privilege()` is a valid runtime ACL check — functionally equivalent to attempting the operation and observing 42501. It is the strongest evidence available *given the Supabase Management API's SET ROLE limitation*. The substitution is technically sound.

---

### F. Accepted Evidence Gap (Direct 42501)

**The gap:**
- No captured PostgreSQL error log showing `ERROR: permission denied for table "AuditLog"` with SQLSTATE `42501` produced by an actual `UPDATE`/`DELETE`/`TRUNCATE` statement issued as `snakzap_app`.
- The IDE tried multiple approaches and they all failed:
  1. Direct DB connection via psql — fails because Supabase pooler/direct host is IPv6-only and GitHub Actions runners don't have IPv6.
  2. `SET ROLE snakzap_app` inside a `DO $$ … EXCEPTION WHEN insufficient_privilege THEN … END $$` block via the Management API SQL endpoint — fails because the Management API's underlying role (likely `authenticator` or `anon`) is not a member of `snakzap_app` and therefore cannot `SET ROLE` to it (PostgreSQL restricts `SET ROLE` to roles the current user is a member of).
  3. `CREATE FUNCTION dev_001_tamper_test() SECURITY DEFINER` that internally does `SET ROLE snakzap_app` (commit `9eda8b2`) — abandoned in commit `bd0db3f` ("Fix: use has_table_privilege() instead of complex PL/pgSQL function"). The IDE's commit message is vague about the specific failure mode. (Condition #4 below asks the IDE to clarify.)
  4. Final fallback: `has_table_privilege()` (no SET ROLE required).

**Substitution validity — independent analysis:**
- PostgreSQL's executor consults `pg_class_aclcheck()` to decide whether to allow a DML statement. If that returns false, the executor raises `ERRCODE_INSUFFICIENT_PRIVILEGE` (42501).
- `has_table_privilege()` calls the same `pg_class_aclcheck()` function with the same role OID and the same ACL.
- Therefore `has_table_privilege('snakzap_app', '"AuditLog"', 'UPDATE') == false` **is** the same predicate the executor uses to raise 42501. The two cannot disagree.
- The substitution is **technically equivalent** — not a workaround, not an approximation.

**What the substitution does NOT prove:**
- That the application's runtime connection actually uses `snakzap_app`. (Deployment-config concern.)
- That the *combination* of trigger + REVOKE works together (only REVOKE is exercised).
- That there is no path *other than* UPDATE/DELETE/TRUNCATE (e.g., a SQL injection in the application that uses a superuser connection, or a migration that runs as `snakzap_admin` and `DROP`s the trigger before mutating). These are out-of-scope for DEV-001 (which is specifically about the privilege boundary at the app role), but they're worth noting.

**Would an independent auditor accept this substitution?**
- A *strict* auditor (e.g., SOC 2 / PCI-DSS evidence collection) would likely request the actual 42501 capture as the gold-standard artifact. Most auditors would accept `has_table_privilege()` *as supporting evidence* but not as the sole artifact — they'd want the trigger+REVOKE combination shown working end-to-end.
- A *pragmatic* auditor (which is the right frame for this project's maturity level — pre-launch, single-tenant, single-region) would accept `has_table_privilege()` given (a) the documented environmental constraint (Supabase Management API cannot SET ROLE), (b) the verification that the SQL endpoint itself works (HTTP 200/201 on prior runs), and (c) the orthogonal information_schema evidence showing the same grants.

**Risk assessment of accepting the substitution:**
- **Low residual risk** for the specific claim being verified (PostgreSQL privileges deny UPDATE/DELETE/TRUNCATE to `snakzap_app` on `AuditLog`). The function call IS the executor's predicate — they cannot disagree.
- **Higher residual risk** for the broader claim ("the audit log is un-mutable from the application"). That depends on the application's runtime connection string using `snakzap_app`, which is not in scope for this evidence chain but is in scope for production launch.

**Verdict for F:** ⚠️ Acceptable substitution for the *specific* claim, **provided** an independent party (Orchestrator with GitHub PAT) confirms the actual artifact JSON content shows the expected DENIED values for UPDATE/DELETE/TRUNCATE. Without that confirmation, I am taking the IDE's claim at face value, which my independence mandate does not permit me to do unconditionally.

---

### G. Reproducibility

**Assessment:**
- ✅ **Workflow YAML files committed to repo** (verified locally + via `raw.githubusercontent.com` byte-identical to remote `origin/main`). Anyone with repo access can re-trigger them.
- ✅ **SQL scripts committed to repo** (4 files in `prisma/scripts/`). Idempotent, can be re-applied.
- ✅ **Workflow runs traceable** — 9 successful runs across 3 workflows, each with a stable GitHub Actions Run URL (e.g., `https://github.com/zheoOviya/snakpass/actions/runs/31703708419` for gap-closure Run 4) and a stable commit SHA (`67eea8c2ad5f67a8930e6204b64d4e39d673a2d0`).
- ✅ **Supabase project ref hardcoded** as `zmzqqcyapcezmaqvuzzd` in all three workflows — reproducibility requires the `SUPABASE_ACCESS_TOKEN` secret to remain valid and the project to remain active. The IDE has not produced explicit evidence the project is still ACTIVE_HEALTHY at the time of review, but the workflow runs succeeding in the recent past (Run 4 of gap-closure) is strong indirect evidence.
- ✅ **`git ls-remote origin` confirms** local HEAD (`67eea8c2…`) equals remote `origin/main` HEAD — the IDE has pushed everything; no local-only commits pending.
- ⚠️ **Artifacts not pre-downloaded.** The IDE has not stored the `tamper-test-results.json` artifact content anywhere locally (no `download/*.json`, no `tool-results/*.json` containing it). Reproducibility *of the artifact content* therefore requires re-running the workflow or fetching the artifact via API.

**Verdict for G:** ✅ Strong reproducibility for the *workflow + scripts*. ⚠️ The artifact content itself is not pre-captured locally — must be re-fetched or re-run to verify.

---

## Strengths

1. **Iterative honest disclosure.** The commit history (`git log origin/main..HEAD` — though actually these are all pushed now) shows 5+ iterations of the approach (direct DB → socat proxy → Management API SQL endpoint with SET ROLE → SECURITY DEFINER function → has_table_privilege). The IDE did not hide the failures — they are documented in commit messages.
2. **Defense-in-depth.** Two independent mechanisms enforce WORM: (a) REVOKE at the privilege level (primary, unbypassable by the app role), (b) BEFORE UPDATE/DELETE triggers (secondary, catches even table-owner mutations). The `postgres-migration.sql` comments correctly identify the trigger as the *secondary* defense.
3. **Self-asserting SQL.** `revoke-worm.sql` doesn't just REVOKE — it raises an exception if the boundary is broken. This means a misconfigured deployment cannot silently pass.
4. **Runtime ACL check chosen over catalog inspection.** `has_table_privilege()` is the *strongest* available evidence given the SET ROLE constraint. It is functionally equivalent to the executor's own predicate. This is a better choice than relying solely on `information_schema` static inspection.
5. **Real PostgreSQL privilege semantics respected.** The IDE correctly identified that TRUNCATE is a separate privilege from DELETE in PostgreSQL (unlike SQLite), and explicitly REVOKEd it.
6. **Workflow traceability.** 9 successful runs across 3 workflows, each traceable to a specific commit SHA. The most recent gap-closure run (Run 4, ID `31703708419`) is at commit `67eea8c2` — the same commit that's on `origin/main` HEAD.
7. **Idempotent scripts.** All SQL scripts use `IF NOT EXISTS` / `CREATE OR REPLACE` / `ON CONFLICT DO NOTHING` — safe to re-run, which is what makes the closure reproducible.

---

## Weaknesses

1. **Artifact content not independently verified by me.** I could not download the `tamper-test-results.json` artifact (no GitHub PAT, rate limit exhausted). I am taking the IDE's claim that the artifact shows "UPDATE/DELETE/TRUNCATE → DENIED" at face value — which my independence mandate requires me to flag.
2. **Workflow "success" conclusion does not prove SQL executed.** The `dev-001-gap-closure.yml` workflow prints "PASS_CANDIDATE" or "FAIL" but **does not exit non-zero on FAIL** — so even if `has_table_privilege()` returned `true` for UPDATE (WORM broken), the workflow would still conclude "success" on GitHub Actions. The "completed successfully:" labels I observed via HTML therefore *prove the workflow ran*, not *prove the WORM boundary holds*. (The same is true for `dev-001-sql-execution.yml`: all 5 SQL execution steps are gated on `if: steps.test-sql.outputs.sql_endpoint == 'works'` — if the endpoint test fails, all 5 SQL steps are SKIPPED, the fallback "Manual SQL instructions" step runs, and the workflow still concludes success. The IDE's SQL-execution workflow runs being "success" doesn't prove SQL was executed.)
3. **The SECURITY DEFINER function approach (commit `9eda8b2`) was abandoned without a documented reason.** The commit message for `bd0db3f` ("Fix: use has_table_privilege() instead of complex PL/pgSQL function") is vague. If the function actually worked and produced real 42501 error codes, that would have been strictly stronger evidence than `has_table_privilege()`. The IDE should clarify why it was abandoned (did `CREATE FUNCTION` fail? Did `SET ROLE` inside the function fail? Did the function return an unexpected result?).
4. **Documentation drift.** As of review time, the project's formal artifacts still record DEV-001 as OPEN:
   - `DEVIATION_LOG.md` line 38: "**Status:** **OPEN** — mitigation layers implemented … acceptance criterion outstanding."
   - `WAVE0_EVIDENCE.md` line 487: "P0-22 → OPEN (DEV-001) 🔴"
   - `worklog.md` ends at Task 53 (workflow-status-checker) which reported "Zero DEV-001 Closure workflow runs exist on GitHub" — this is now stale (the new workflows have 9 successful runs), but no follow-up worklog entry has been appended.
   The IDE's PASS_CANDIDATE status therefore lives only in the task description and the workflow artifacts — not in any project-tracked document. An independent reviewer scanning the project files would conclude DEV-001 is still OPEN.
5. **No local copy of the evidence artifact.** The IDE did not commit the downloaded `tamper-test-results.json` to the repo (nor should they — it could contain identifying info). But this means the closure evidence is *only* retrievable via the GitHub Actions artifacts API (which expires — `retention-days: 365`), not via the repo. Long-term auditability depends on someone downloading and archiving the artifact.
6. **Supabase project liveness not explicitly verified.** The IDE has not produced evidence that `zmzqqcyapcezmaqvuzzd` is currently ACTIVE_HEALTHY. The successful recent runs are indirect evidence, but the project could be paused/deleted between runs.
7. **No verification that the application's runtime connection uses `snakzap_app`.** This is out-of-scope for the privilege-boundary claim, but in-scope for the broader "audit log is un-mutable from the application" claim. The evidence chain proves the boundary exists; it does not prove the application respects it.

---

## Risk Assessment

If DEV-001 is declared FINAL PASS with the current evidence:

| Risk | Likelihood | Impact | Mitigation already in place |
|---|---|---|---|
| `has_table_privilege()` returns DENIED but actual UPDATE as `snakzap_app` succeeds (ACL discrepancy) | Very Low — they consult the same code path; would be a PostgreSQL bug | High — false closure | The same ACL is consulted by both; cannot disagree |
| Artifact JSON actually shows ALLOWED for UPDATE (IDE misreported) | Low-Medium — possible but unlikely given the SQL is correctly written and the workflow ran without crashing | High — false closure | **Not mitigated** — requires independent artifact inspection (Condition 1) |
| Application connects with a different role, bypassing the boundary | Medium — depends on deployment config not yet verified | High — boundary doesn't apply at runtime | Out of scope for DEV-001; flagged as production-launch prerequisite |
| Supabase project deleted between runs | Low — IDE has the access token, project was created for this purpose | Medium — closure no longer reproducible | Project ref is hardcoded; can be recreated if needed |
| Documentation drift causes future reviewer to re-open DEV-001 | High — current state has 3 stale documents | Low — easily corrected by updating the docs | **Not mitigated** — requires Conditions 2 + 3 |
| GitHub Actions artifact expires (365-day retention) before archival | Low — 365 days is long | Medium — re-running the workflow would re-produce the artifact | Workflow is reproducible; artifact can be regenerated |

**Overall risk:** LOW-to-MODERATE. The technical evidence is sound. The residual risk is mostly in the *verification gap* (I couldn't independently inspect the artifact) and the *documentation drift* (project artifacts are stale).

---

## Verdict

# **ACCEPT_WITH_CONDITIONS**

The technical evidence chain is sufficient for the *specific* claim (PostgreSQL privileges deny UPDATE/DELETE/TRUNCATE to `snakzap_app` on `AuditLog`), and the substitution of `has_table_privilege()` for the direct 42501 capture is functionally equivalent and technically sound. However, FINAL PASS is contingent on the Orchestrator (or another party with GitHub PAT access) independently confirming the actual artifact content and the IDE updating the project's formal documentation to reflect the closure.

The conditions below are not arbitrary bureaucracy — each one addresses a specific weakness identified above.

---

## Conditions

**Condition 1 (BLOCKING — required for FINAL PASS):**
The Orchestrator (or a delegated party with a GitHub PAT) MUST download the `dev-001-gap-closure-evidence` artifact from the most recent successful run of the `DEV-001 Evidence Gap Closure` workflow — **Run 4, GitHub Run ID `31703708419`**, at commit `67eea8c2ad5f67a8930e6204b64d4e39d673a2d0` (URL: `https://github.com/zheoOviya/snakpass/actions/runs/31703708419`).

The artifact contains a single file `tamper-test-results.json` whose content MUST be verified to contain an array of 5 rows with these exact (operation, expected, actual) tuples:
```
[{"operation":"INSERT",  "expected":"ALLOWED", "actual":"ALLOWED"},
 {"operation":"SELECT",  "expected":"ALLOWED", "actual":"ALLOWED"},
 {"operation":"UPDATE",  "expected":"DENIED",   "actual":"DENIED"},
 {"operation":"DELETE",  "expected":"DENIED",   "actual":"DENIED"},
 {"operation":"TRUNCATE","expected":"DENIED",   "actual":"DENIED"}]
```
If the artifact content matches this expected shape → **Condition 1 satisfied**, proceed to FINAL PASS.
If the artifact content does NOT match (e.g., shows `"actual":"ALLOWED"` for UPDATE/DELETE/TRUNCATE, or shows a non-array error object, or is empty) → **DEV-001 REOPENED**, REJECT verdict issued.

**Condition 2 (BLOCKING — required for FINAL PASS):**
The `DEVIATION_LOG.md` file MUST be updated. The DEV-001 entry (currently "Status: OPEN") MUST be revised to:
- Status: **CLOSED** (or **PASS_CANDIDATE → FINAL PASS** with the G/H review reference)
- Closure evidence: link to this `GH_REVIEW_DEV001.md` document, the workflow Run URL, the artifact name, and the verified JSON content from Condition 1
- Closure mechanism: PostgreSQL REVOKE + role separation (Supabase), verified via `has_table_privilege()` runtime ACL check

**Condition 3 (NON-BLOCKING — required for archival completeness, may be done in parallel with FINAL PASS declaration):**
A new entry MUST be appended to `worklog.md` (after the existing Task 53 entry) documenting:
- The three new workflows (`dev-001-sql-execution.yml`, `dev-001-hardening.yml`, `dev-001-gap-closure.yml`) and their commit SHAs
- The 9 successful workflow runs (3 + 2 + 4) with Run URLs and conclusion=success
- The actual `tamper-test-results.json` content (from Condition 1)
- The accepted evidence gap (no direct 42501 capture) and the rationale for the `has_table_privilege()` substitution
- Cross-reference to this `GH_REVIEW_DEV001.md`

**Condition 4 (NON-BLOCKING — recommended for evidence quality):**
The IDE SHOULD clarify (in the worklog entry from Condition 3) why the SECURITY DEFINER `dev_001_tamper_test()` function approach (commit `9eda8b2`) was abandoned in favor of `has_table_privilege()` (commit `bd0db3f`). Specifically: did `CREATE FUNCTION` succeed? Did `SET ROLE snakzap_app` inside the SECURITY DEFINER function raise an error? If the function actually worked and captured real 42501 error codes, that evidence would be strictly stronger than the current `has_table_privilege()` substitution, and the IDE should consider re-running it.

**Condition 5 (NON-BLOCKING — recommended for production launch, NOT for DEV-001 closure):**
Before production launch (separate gate from DEV-001 closure), the IDE MUST verify that the application's runtime DATABASE_URL connection string uses the `snakzap_app` role (not the postgres superuser, not the Supabase pooler's `authenticator` role). The WORM privilege boundary only applies if the application actually connects as `snakzap_app`. This is out of scope for DEV-001 (which is about the privilege boundary existing) but is a prerequisite for the broader "audit log is un-mutable from the application" claim.

---

## Recommendation

**Immediate next action:** Orchestrator to download the `dev-001-gap-closure-evidence` artifact from Run 4 (ID `31703708419`) and verify the JSON content matches the expected shape in Condition 1. This is the single most important verification step remaining.

**If Condition 1 is satisfied (artifact content verified):**
1. Orchestrator declares DEV-001 → **FINAL PASS**.
2. Orchestrator instructs IDE to fulfill Conditions 2 and 3 (update `DEVIATION_LOG.md` + append `worklog.md` entry).
3. Wave-0 gate can proceed to evaluate P0-22 acceptance with DEV-001 closed.
4. Wave-1 unlock remains gated on Wave-0 closure + P0-27 (CI/CD) closure.
5. Production launch remains gated on Condition 5 (application actually connects as `snakzap_app`).

**If Condition 1 fails (artifact content does not match):**
1. Orchestrator declares DEV-001 → **REOPENED**, REJECT verdict.
2. IDE must diagnose why `has_table_privilege()` returned an unexpected value (possible causes: SQL endpoint returned an error, role `snakzap_app` not actually created, REVOKE not actually applied, table name quoting issue still present).
3. IDE must re-run the gap-closure workflow with debug logging and capture the actual SQL response.
4. Independent G/H review must be re-triggered after IDE produces corrected evidence.

**If the artifact cannot be downloaded (e.g., expired, deleted):**
1. Orchestrator instructs IDE to re-trigger the `DEV-001 Evidence Gap Closure` workflow at `https://github.com/zheoOviya/snakpass/actions/workflows/dev-001-gap-closure.yml` with input `confirm=CLOSE-GAP`.
2. New run produces a new artifact; Orchestrator downloads and inspects that one.
3. This re-run IS the reproducibility check (Section G) — it should produce the same result if the Supabase project is still configured correctly.

---

## Reviewer's Final Note

The IDE has done diligent, honest work here. The substitution of `has_table_privilege()` for the direct 42501 capture is not a workaround — it's the same predicate PostgreSQL uses internally, and the IDE correctly identified it as the strongest available evidence given the Supabase Management API's SET ROLE limitation. The acceptance gap is real but narrow, and the conditions I've listed close it cleanly without requiring the IDE to chase an unreachable gold standard.

The main residual concern is *not* technical — it's that I could not independently inspect the artifact content (verification limitation due to no GitHub PAT + rate-limit exhaustion during review). The Orchestrator's inspection of the artifact is the keystone condition. If that confirms the expected DENIED values, this closure stands.

— Independent G/H Reviewer, 2026-08-13
