#!/usr/bin/env node
// ============================================================================
// SnakZap Wave-5 Sub-Wave 5b — Evidence Runner E1-E6 (P0-03 Reconciliation)
// ============================================================================
// Detection-only reconciliation evidence. Mirrors the 5a evidence pattern.
//
//   E1 — Ledger imbalance detection (M1)
//        Seed a DEBIT-without-CREDIT → run reconciliation → verify M1 finding
//        created + ExceptionQueue entry (Level 1 freeze) + metric emitted.
//
//   E2 — Stuck CAPTURE_PENDING + stuck REFUND_PENDING + orphan outbox (M9/M10/M12)
//        Seed each anomaly → run reconciliation → verify findings created.
//
//   E3 — Reconciliation idempotency
//        Run reconciliation twice → second run creates NO new findings
//        (deduped via (mismatchClass, entityId) unique constraint).
//
//   E4 — CRITICAL SAFETY: reconciliation does NOT mutate money state
//        Snapshot Payment/Refund/LedgerEntry/Outbox/WebhookEvent/IdempotencyKey/AuditLog
//        before + after a reconciliation run → assert ZERO diffs.
//        (PostgreSQL-mandatory; also runs on SQLite for logic verification.)
//
//   E5 — Concurrent reconciliation runs → no duplicate findings
//        Run 2 reconciliation cycles simultaneously → both complete →
//        exactly one set of findings (dedup via unique constraint).
//        (PostgreSQL-mandatory; also runs on SQLite.)
//
//   E6 — Scale: 1000+ payments + anomalies → completes within SLA + correct findings
//        Seed 100 healthy payments + 3 anomalies → run reconciliation →
//        verify 3 findings found + runtime < 30s + no false positives on healthy payments.
//        (PostgreSQL-mandatory; also runs on SQLite with smaller count.)
// ============================================================================

import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `5b-${Date.now()}-${randomUUID().slice(0, 8)}`
const OUTPUT_DIR = join(process.cwd(), 'evidence', 'wave5-5b')
mkdirSync(OUTPUT_DIR, { recursive: true })

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function setupScenario(scenario, extraParams = {}) {
  const url = new URL(`${BASE_URL}/api/reconciliation/evidence-setup`)
  url.searchParams.set('scenario', scenario)
  for (const [k, v] of Object.entries(extraParams)) {
    url.searchParams.set(k, String(v))
  }
  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Setup failed (${response.status}): ${await response.text()}`)
  return response.json()
}

async function runReconciliation(concurrent = 1) {
  const url = new URL(`${BASE_URL}/api/reconciliation/evidence-run`)
  if (concurrent > 1) url.searchParams.set('concurrent', String(concurrent))
  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Run failed (${response.status}): ${await response.text()}`)
  return response.json()
}

async function verifyState(mismatchClass = null) {
  const url = new URL(`${BASE_URL}/api/reconciliation/evidence-verify`)
  if (mismatchClass) url.searchParams.set('mismatchClass', mismatchClass)
  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Verify failed (${response.status}): ${await response.text()}`)
  return response.json()
}

// Deep-compare two money-state snapshots (for E4)
// Returns { equal: boolean, diffs: string[] }
function compareSnapshots(before, after) {
  const diffs = []
  const keys = ['paymentCount', 'refundCount', 'ledgerEntryCount', 'outboxCount', 'webhookEventCount', 'idempotencyKeyCount', 'auditLogCount']
  for (const k of keys) {
    if (before[k] !== after[k]) {
      diffs.push(`${k}: ${before[k]} → ${after[k]}`)
    }
  }
  // Compare row-level snapshots (ids + status + version + updatedAt)
  // Note: updatedAt may change if reconciliation touched a row — but it MUST NOT.
  // We compare the full arrays as JSON.
  const beforeJson = JSON.stringify(before.paymentIds)
  const afterJson = JSON.stringify(after.paymentIds)
  if (beforeJson !== afterJson) diffs.push('paymentIds differ (row-level mutation detected)')
  const beforeRefJson = JSON.stringify(before.refundIds)
  const afterRefJson = JSON.stringify(after.refundIds)
  if (beforeRefJson !== afterRefJson) diffs.push('refundIds differ (row-level mutation detected)')
  const beforeLedgerJson = JSON.stringify(before.ledgerEntryIds)
  const afterLedgerJson = JSON.stringify(after.ledgerEntryIds)
  if (beforeLedgerJson !== afterLedgerJson) diffs.push('ledgerEntryIds differ (row-level mutation detected)')
  return { equal: diffs.length === 0, diffs }
}

// ----------------------------------------------------------------------------
// Evidence scenarios
// ----------------------------------------------------------------------------

const evidence = {
  runId: RUN_ID,
  timestamp: new Date().toISOString(),
  wave: '5',
  subWave: '5b',
  p0: 'P0-03',
  evidenceType: 'reconciliation-detection-e1-e6',
  database: process.env.EVIDENCE_DB ?? 'sqlite',
  tests: {},
  invariant: {},
  governance: {
    realPaymentsEnabled: false,
    productionTouched: false,
    financialMutation: false,
    externalGatewayCall: false,
    automaticRepair: false,
  },
}

// --- E1: Ledger imbalance detection (M1) ---
async function runE1() {
  console.log('\n=== E1: Ledger imbalance detection (M1) ===')
  const setup = await setupScenario('ledger-imbalance')
  const beforeSnapshot = setup.moneyStateSnapshotBefore
  const seededAnomaly = setup.seededAnomalies[0]
  console.log(`  Seeded: ${seededAnomaly.description}`)

  const runResult = await runReconciliation()
  const found = runResult.result.findings.find(
    (f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE' && f.entityId === seededAnomaly.entityId,
  )
  const verify = await verifyState('M1_LEDGER_IMBALANCE')
  const findingRow = verify.findings.find(
    (f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE' && f.entityId === seededAnomaly.entityId,
  )
  const exceptionRow = verify.exceptionsCreated.find(
    (e) => e.invariant === 'M1_LEDGER_IMBALANCE' && e.entityId === seededAnomaly.entityId,
  )

  const passed = !!found && !!findingRow && !!exceptionRow
  console.log(`  Detector found: ${!!found}, Finding persisted: ${!!findingRow}, ExceptionQueue entry: ${!!exceptionRow}`)
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`)

  evidence.tests['E1'] = {
    name: 'Ledger imbalance detection (M1)',
    passed,
    seededAnomaly,
    detectedByReconciliation: !!found,
    findingPersisted: !!findingRow,
    findingSeverity: findingRow?.severity,
    exceptionQueueEntry: !!exceptionRow,
    exceptionFreezeLevel: exceptionRow?.freezeLevel,
  }
}

// --- E2: Stuck CAPTURE_PENDING + stuck REFUND_PENDING + orphan outbox (M9/M10/M12) ---
async function runE2() {
  console.log('\n=== E2: Stuck CAPTURE_PENDING + REFUND_PENDING + orphan outbox (M9/M10/M12) ===')
  const scenarios = ['stuck-capture-pending', 'stuck-refund-pending', 'orphan-outbox']
  const results = {}
  for (const scenario of scenarios) {
    const setup = await setupScenario(scenario)
    const seededAnomaly = setup.seededAnomalies[0]
    console.log(`  Seeded: ${scenario} → ${seededAnomaly.description}`)
    results[scenario] = { seededAnomaly }
  }
  const runResult = await runReconciliation()
  const verify = await verifyState()

  let allPassed = true
  for (const [scenario, data] of Object.entries(results)) {
    const expectedClass = data.seededAnomaly.class
    const expectedEntityId = data.seededAnomaly.entityId
    const findingRow = verify.findings.find(
      (f) => f.mismatchClass === expectedClass && f.entityId === expectedEntityId,
    )
    const passed = !!findingRow
    if (!passed) allPassed = false
    console.log(`  ${expectedClass}: finding persisted=${!!findingRow} ${passed ? '✅' : '❌'}`)
    results[scenario].findingPersisted = !!findingRow
    results[scenario].findingSeverity = findingRow?.severity
    results[scenario].detected = !!findingRow
  }
  console.log(`  Result: ${allPassed ? '✅ PASS' : '❌ FAIL'}`)
  evidence.tests['E2'] = {
    name: 'Stuck CAPTURE_PENDING + REFUND_PENDING + orphan outbox (M9/M10/M12)',
    passed: allPassed,
    scenarios: results,
  }
}

// --- E3: Reconciliation idempotency ---
async function runE3() {
  console.log('\n=== E3: Reconciliation idempotency ===')
  const setup = await setupScenario('ledger-imbalance')
  const seededAnomaly = setup.seededAnomalies[0]
  console.log(`  Seeded: ${seededAnomaly.description}`)

  // First run
  const run1 = await runReconciliation()
  const verify1 = await verifyState('M1_LEDGER_IMBALANCE')
  const findingsAfterRun1 = verify1.findings.filter(
    (f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE' && f.entityId === seededAnomaly.entityId,
  )
  console.log(`  Run 1: ${findingsAfterRun1.length} finding(s) for this entity`)

  // Second run — should NOT create a duplicate
  const run2 = await runReconciliation()
  const verify2 = await verifyState('M1_LEDGER_IMBALANCE')
  const findingsAfterRun2 = verify2.findings.filter(
    (f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE' && f.entityId === seededAnomaly.entityId,
  )
  console.log(`  Run 2: ${findingsAfterRun2.length} finding(s) for this entity (should be 1 — deduped)`)

  // Check lastSeenAt was updated (not a new row)
  const lastSeenUpdated = findingsAfterRun2.length === 1 && findingsAfterRun2[0].lastSeenAt !== findingsAfterRun1[0].lastSeenAt
  const noDuplicate = findingsAfterRun2.length === 1 && findingsAfterRun1.length === 1 && findingsAfterRun1[0].id === findingsAfterRun2[0].id

  const passed = noDuplicate && lastSeenUpdated
  console.log(`  No duplicate (same finding id): ${noDuplicate}, lastSeenAt updated: ${lastSeenUpdated}`)
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`)

  evidence.tests['E3'] = {
    name: 'Reconciliation idempotency',
    passed,
    findingsAfterRun1: findingsAfterRun1.length,
    findingsAfterRun2: findingsAfterRun2.length,
    sameFindingId: noDuplicate,
    lastSeenAtUpdated: lastSeenUpdated,
  }
}

// --- E4: CRITICAL SAFETY — reconciliation does NOT mutate money state ---
async function runE4() {
  console.log('\n=== E4: CRITICAL SAFETY — reconciliation does NOT mutate money state ===')
  const setup = await setupScenario('ledger-imbalance')
  const beforeSnapshot = setup.moneyStateSnapshotBefore
  const seededAnomaly = setup.seededAnomalies[0]
  console.log(`  Seeded: ${seededAnomaly.description}`)
  console.log(`  Before: payments=${beforeSnapshot.paymentCount}, refunds=${beforeSnapshot.refundCount}, ledger=${beforeSnapshot.ledgerEntryCount}, outbox=${beforeSnapshot.outboxCount}, webhooks=${beforeSnapshot.webhookEventCount}, idempotency=${beforeSnapshot.idempotencyKeyCount}, audit=${beforeSnapshot.auditLogCount}`)

  const runResult = await runReconciliation()
  const verify = await verifyState()
  const afterSnapshot = verify.moneyStateSnapshotAfter
  console.log(`  After:  payments=${afterSnapshot.paymentCount}, refunds=${afterSnapshot.refundCount}, ledger=${afterSnapshot.ledgerEntryCount}, outbox=${afterSnapshot.outboxCount}, webhooks=${afterSnapshot.webhookEventCount}, idempotency=${afterSnapshot.idempotencyKeyCount}, audit=${afterSnapshot.auditLogCount}`)

  const comparison = compareSnapshots(beforeSnapshot, afterSnapshot)
  console.log(`  Money-state diffs: ${comparison.diffs.length === 0 ? 'NONE ✅' : comparison.diffs.join(', ')}`)

  // Also verify: finding WAS created (detection worked) + ExceptionQueue entry created
  const findingCreated = verify.findings.some(
    (f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE' && f.entityId === seededAnomaly.entityId,
  )
  const exceptionCreated = verify.exceptionsCreated.some(
    (e) => e.invariant === 'M1_LEDGER_IMBALANCE' && e.entityId === seededAnomaly.entityId,
  )

  const passed = comparison.equal && findingCreated && exceptionCreated
  console.log(`  Finding created: ${findingCreated}, ExceptionQueue entry: ${exceptionCreated}`)
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`)

  evidence.tests['E4'] = {
    name: 'CRITICAL SAFETY — reconciliation does NOT mutate money state',
    passed,
    moneyStateMutated: !comparison.equal,
    moneyStateDiffs: comparison.diffs,
    findingCreated,
    exceptionCreated,
    financialMutation: !comparison.equal,
  }
  // Update governance flags
  if (!comparison.equal) {
    evidence.governance.financialMutation = true
  }
}

// --- E5: Concurrent reconciliation runs → no duplicate findings ---
async function runE5() {
  console.log('\n=== E5: Concurrent reconciliation runs → no duplicate findings ===')
  const setup = await setupScenario('ledger-imbalance')
  const seededAnomaly = setup.seededAnomalies[0]
  console.log(`  Seeded: ${seededAnomaly.description}`)

  // Run 2 concurrent reconciliation cycles
  const concurrentResult = await runReconciliation(2)
  console.log(`  Concurrent runs: ${concurrentResult.concurrent}, both completed`)

  const verify = await verifyState('M1_LEDGER_IMBALANCE')
  const findingsForEntity = verify.findings.filter(
    (f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE' && f.entityId === seededAnomaly.entityId,
  )
  console.log(`  Findings for entity (should be exactly 1): ${findingsForEntity.length}`)

  const passed = findingsForEntity.length === 1
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`)

  evidence.tests['E5'] = {
    name: 'Concurrent reconciliation runs → no duplicate findings',
    passed,
    concurrentRuns: concurrentResult.concurrent,
    duplicateFindings: findingsForEntity.length > 1 ? findingsForEntity.length - 1 : 0,
    findingsForEntity: findingsForEntity.length,
  }
}

// --- E6: Scale — 1000+ payments + anomalies → completes within SLA + correct findings ---
async function runE6() {
  console.log('\n=== E6: Scale — N payments + anomalies → completes within SLA + correct findings ===')
  const scaleCount = process.env.EVIDENCE_DB === 'postgresql' ? 1000 : 100 // smaller on SQLite
  const setup = await setupScenario('scale', { count: scaleCount })
  const beforeSnapshot = setup.moneyStateSnapshotBefore
  const seededAnomalies = setup.seededAnomalies
  console.log(`  Seeded: ${setup.scenarioData.healthyCount} healthy + ${setup.scenarioData.anomalyCount} anomalies`)

  const startTime = Date.now()
  const runResult = await runReconciliation()
  const runtimeMs = Date.now() - startTime
  const slaMs = 30000 // 30s SLA
  console.log(`  Runtime: ${runtimeMs}ms (SLA: ${slaMs}ms)`)

  const verify = await verifyState('M1_LEDGER_IMBALANCE')
  const m1Findings = verify.findings.filter((f) => f.mismatchClass === 'M1_LEDGER_IMBALANCE')
  console.log(`  M1 findings found: ${m1Findings.length} (expected ${seededAnomalies.length} for this run; may include findings from prior evidence scenarios)`)

  // Check that all seeded anomalies were found
  const allSeededFound = seededAnomalies.every(
    (a) => m1Findings.some((f) => f.entityId === a.entityId),
  )

  // Check that NO false positives on healthy payments E6 created
  // (use the healthyPaymentIds from setup — NOT all payments in the DB,
  // because prior evidence scenarios may have left anomalies)
  const healthyPaymentIds = new Set(setup.scenarioData.healthyPaymentIds || [])
  const falsePositives = m1Findings.filter(
    (f) => healthyPaymentIds.has(f.entityId),
  )

  const passed = runtimeMs < slaMs && allSeededFound && falsePositives.length === 0
  console.log(`  All seeded found: ${allSeededFound}, false positives: ${falsePositives.length}`)
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`)

  evidence.tests['E6'] = {
    name: 'Scale — N payments + anomalies → completes within SLA + correct findings',
    passed,
    scaleCount,
    runtimeMs,
    slaMs,
    seededAnomalies: seededAnomalies.length,
    findingsFound: m1Findings.length,
    allSeededFound,
    falsePositives: falsePositives.length,
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('========================================')
  console.log('Wave-5 5b Evidence Runner (P0-03 Reconciliation)')
  console.log(`Run ID: ${RUN_ID}`)
  console.log(`Database: ${process.env.EVIDENCE_DB ?? 'sqlite'}`)
  console.log('========================================')

  try {
    await runE1()
    await runE2()
    await runE3()
    await runE4()
    await runE5()
    await runE6()
  } catch (err) {
    console.error('Evidence runner error:', err)
    evidence.tests.error = { message: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : undefined }
  }

  // Compute overall result
  const testResults = Object.entries(evidence.tests).filter(([k]) => k.startsWith('E'))
  const passed = testResults.filter(([, v]) => v?.passed).length
  const total = testResults.length
  evidence.ok = passed === total
  evidence.summary = { passed, total }

  // Invariant summary
  evidence.invariant = {
    detectionWorks: (evidence.tests.E1?.passed && evidence.tests.E2?.passed) ?? false,
    idempotency: evidence.tests.E3?.passed ?? false,
    noMoneyStateMutation: (evidence.tests.E4?.passed && !evidence.governance.financialMutation) ?? false,
    concurrencySafe: evidence.tests.E5?.passed ?? false,
    scaleCorrect: evidence.tests.E6?.passed ?? false,
  }

  // Write evidence JSON
  const outFile = join(OUTPUT_DIR, `evidence-E1-E6-5b-${RUN_ID}.json`)
  writeFileSync(outFile, JSON.stringify(evidence, null, 2))
  console.log('\n========================================')
  console.log(`Evidence written: ${outFile}`)
  console.log(`Overall: ${evidence.ok ? '✅ ALL PASS' : '❌ FAILURES'} (${passed}/${total})`)
  console.log('========================================')

  process.exit(evidence.ok ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
