# SnakZap — Disaster Recovery Runbook

**Status:** DESIGN ONLY (Wave-1 Sub-Wave 1c)
**Date:** 2026-08-14
**Scope:** DR architecture + backup/restore runbook + restore procedure + reconciliation design
**NOT authorized:** Actual DR drill, production backup, production restore, production DB migration

---

## 1. DR Architecture Overview

### 1.1 Current State (Phase 2 — Staging)
- **Database:** Supabase managed PostgreSQL (project `zmzqqcyapcezmaqvuzzd`, region `ap-northeast-1`)
- **Backup mechanism:** Supabase Pro tier daily automated backups (if Pro tier) OR on-demand `pg_dump` (Phase 3)
- **Restore target:** Same Supabase project (Phase 2) or warm-standby project (Phase 3)
- **Application:** Vercel serverless (region `hnd1`) — stateless, no restore needed
- **Stateful services:** `realtime` + `alert-evaluator` NOT deployed yet (Phase 3 — Fly.io)

### 1.2 Target State (Phase 3 — Production)
- **Database:** Separate Supabase project for production (isolated from staging)
- **Backup mechanism:** `pg_dump --format=custom --compress=9` → Supabase Storage bucket `snakzap-backups`
- **Restore target:** Warm-standby Supabase project (provisioned in advance, same region)
- **Application:** Vercel production deployment
- **Stateful services:** Fly.io `nrt` (realtime + alert-evaluator)

---

## 2. Recovery Objectives

| Metric | Target | Current Capability |
|--------|--------|-------------------|
| **RPO** (Recovery Point Objective) | ≤ 24 hours | Supabase Pro daily backups (if Pro tier); on-demand `pg_dump` (manual) |
| **RTO** (Recovery Time Objective) | ≤ 4 hours | ~30 min with warm standby (Phase 3); ~2-4 hours with cold provisioning |
| **Retention** | 30 days | Supabase Pro 7-day retention (if Pro); manual `pg_dump` files (Phase 3) |
| **Drill frequency** | Monthly | NOT YET EXECUTED (Phase 3) |

---

## 3. Backup Procedure

### 3.1 Phase 2 (Current — Staging)
- Rely on Supabase Pro tier daily automated backups (if Pro tier).
- On-demand backup via `POST /api/backup` (admin-only; currently SQLite-coupled, returns 500 on Vercel — Phase 3 rewrite needed).

### 3.2 Phase 3 (Target — Production)
```bash
# pg_dump → Supabase Storage (streamed, not buffered)
pg_dump --format=custom --no-owner --no-privileges --compress=9 \
  --dbname="$BACKUP_AUDIT_ROLE_DATABASE_URL" \
  --file=- | \
  tee >(sha256sum > backup.sha256) | \
  curl -X PUT \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/octet-stream" \
    "https://$PROJECT_REF.supabase.co/storage/v1/object/snakzap-backups/backup-$(date +%Y%m%d-%H%M%S).dump" \
    --data-binary @-
```

**Role:** `snakzap_admin` (Session Pooler, port 5432 — `pg_dump` needs catalog access that `snakzap_app` lacks).
**WORM preservation:** Backup uses `snakzap_admin` for `pg_dump` BUT a SEPARATE `snakzap_app` connection for the audit log INSERT (defense-in-depth).

---

## 4. Restore Procedure (DESIGN ONLY — NOT EXECUTED)

### 4.1 Pre-restore Checklist
- [ ] Confirm the restore is necessary (data loss vs. corruption vs. DR drill)
- [ ] Notify stakeholders (Orchestrator approval required for production restore)
- [ ] Verify the backup file exists + SHA-256 matches
- [ ] Identify the restore target (warm-standby project OR same project after wipe)

### 4.2 Restore Steps
```bash
# Step 1: Download the backup from Supabase Storage
curl -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  "https://$PROJECT_REF.supabase.co/storage/v1/object/snakzap-backups/backup-YYYYMMDD-HHMMSS.dump" \
  -o /tmp/restore.dump

# Step 2: Verify SHA-256
sha256sum /tmp/restore.dump  # must match stored checksum

# Step 3: Restore to warm-standby Supabase project (NEW project, NOT the corrupted one)
pg_restore --dbname="$DIRECT_URL_NEW" \
  --no-owner --no-privileges \
  --jobs=4 --clean --if-exists \
  /tmp/restore.dump

# Step 4: Verify restore (row counts + hash-chain integrity)
psql "$DIRECT_URL_NEW" -c "SELECT COUNT(*) FROM \"AuditLog\";"
psql "$DIRECT_URL_NEW" -c "SELECT COUNT(*) FROM \"Order\";"
psql "$DIRECT_URL_NEW" -c "SELECT COUNT(*) FROM \"KillSwitch\";"
# Run audit hash-chain integrity check
psql "$DIRECT_URL_NEW" -f prisma/scripts/audit-integrity-check.sql

# Step 5: Switch application DATABASE_URL to the restored project
# (Vercel env var update — requires Orchestrator authorization)

# Step 6: Verify application health
curl https://restored-app.vercel.app/api/health
curl https://restored-app.vercel.app/api/restaurants
curl https://restored-app.vercel.app/api/kill-switches
```

### 4.3 Estimated Restore Time
- Backup download: ~2-5 min (depending on size)
- `pg_restore`: ~5-15 min (depending on size + `--jobs=4`)
- Verification: ~5 min
- DNS/env switch: ~5 min
- **Total RTO: ~20-30 min** (with warm standby; well within 4-hour target)

---

## 5. Post-Restore Business-State Reconciliation (DESIGN ONLY)

### 5.1 Why Reconciliation Is Needed
A DB restore alone is NOT recovery (Architectural Law 1 — Business Recovery Coherence). After restore:
- **Payment state** may be inconsistent (gateway captured payment but DB didn't record it → captured-but-DB-pending)
- **Order state** may be inconsistent (vendor accepted order but DB didn't record the status change)
- **Audit log** may have gaps (events between backup + failure are lost)

### 5.2 Reconciliation Procedure
```text
Step 1: Compare DB state vs. payment gateway state
  - For each payment in DB with status != 'CAPTURED', query gateway API
  - If gateway shows CAPTURED → reconcile (update DB + audit log)
  - If gateway shows FAILED → no action (DB is correct)
  - If gateway shows PENDING → wait + retry

Step 2: Compare DB state vs. order state (vendor portals)
  - For each order in DB with status = 'CONFIRMED' older than X min,
    query vendor portal for actual status
  - If vendor shows 'PREPARING' but DB shows 'CONFIRMED' → update DB + audit

Step 3: Verify audit hash-chain integrity
  - Run audit-integrity-check.sql
  - If chain is broken → reportInvariantViolation (P0-28)

Step 4: Verify exception queue is clean
  - GET /api/exceptions → should be empty (or all resolved)
  - If unresolved exceptions exist → investigate before declaring "recovered"
```

### 5.3 NO-GO Conditions
Per `PRODUCTION_READINESS_MATRIX.md` §7.1 P0-26:
> "NO-GO if any money state unresolved post-restore."

If Step 1 reconciliation finds ANY unresolved payment discrepancy, the system is NOT recovered. The Orchestrator must be notified + the discrepancy must be resolved before declaring recovery complete.

### 5.4 Reconciliation Implementation Status
- **Wave-3 dependency:** Full reconciliation requires Payment model + Razorpay SDK (P0-01, Wave-3)
- **Wave-1 deliverable:** Reconciliation PROCEDURE documented (this file) — implementation deferred to Wave-3

---

## 6. DR Drill Procedure (NOT AUTHORIZED — Phase 3)

### 6.1 Monthly DR Drill
- **Trigger:** `workflow_dispatch` on `dr-drill.yml` workflow (to be created in Phase 3)
- **Steps:**
  1. Create a fresh backup (Phase 3 `pg_dump` mechanism)
  2. Restore to a disposable "drill" Supabase project
  3. Run reconciliation procedure against the restored DB
  4. Verify all checks pass
  5. Tear down the drill project
  6. Record drill result in `DrDrillResult` model (or audit log)

### 6.2 Drill Success Criteria
- Backup created successfully (SHA-256 computed)
- Restore completed within RTO (≤ 4 hours, target 30 min)
- All row counts match pre-restore
- Audit hash-chain integrity verified
- Reconciliation found no unresolved money state
- Drill result recorded

### 6.3 Drill Failure
- If ANY criterion fails → `fireAlert('dr-drill-failed')`
- Mark P0-26 as NOT production-ready
- Orchestrator must investigate before production launch

---

## 7. Evidence Schema (for Wave-1 closure)

### 7.1 What Wave-1 Closes
- ✅ DR architecture documented (this file)
- ✅ Backup/restore runbook documented
- ✅ Restore procedure documented (NOT executed)
- ✅ Post-restore reconciliation procedure documented
- ✅ DR acceptance criteria defined

### 7.2 What Wave-1 Does NOT Close (Phase 3)
- ❌ Actual DR drill execution
- ❌ Production-grade backup (`pg_dump` rewrite)
- ❌ Production restore
- ❌ Payment reconciliation implementation (needs Wave-3 P0-01)
- ❌ Warm-standby Supabase project provisioning

### 7.3 Wave-1 Closure Statement
P0-26 is **S4 (Implemented) for the design + runbook layer**, and **NOT STARTED for the drill execution layer**. This split is authorized by Orchestrator Decision O-3 (Option B — split P0-26 into Wave-1 design vs Phase-3 drill).

---

## 8. Restore Script (AUTHORED — NOT EXECUTED)

A companion script `scripts/restore-backup.sh` is authored but NOT executed. It implements the restore procedure in §4.2. Execution requires:
1. Phase-3 `pg_dump` backup mechanism to be operational
2. Warm-standby Supabase project to be provisioned
3. Orchestrator authorization for DR drill

---

## 9. References
- `docs/BACKUP_REPLACEMENT_PLAN.md` — 22-item SQLite dependency inventory + pg_dump design
- `PRODUCTION_READINESS_MATRIX.md` §7.1 P0-26 — RPO/RTO + reconciliation requirements
- `PRODUCTION_READINESS_MATRIX.md` §14.1 condition 4 — "DR drill passed" launch gate
- `prisma/scripts/wave1-subwave-1b-migration.sql` — ExceptionQueue table (for P0-28 freeze evidence)
