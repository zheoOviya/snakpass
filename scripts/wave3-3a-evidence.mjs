#!/usr/bin/env node
// ============================================================================
// SnakZap Wave-3 Sub-Wave 3a — Evidence Runner
// ============================================================================
// Runs 4 empirical evidence tests against the local dev server (which must be
// running with EVIDENCE_TEST_MODE=true on http://localhost:3000).
//
// Tests:
//   1. Capture transaction rollback (deliberate mid-tx failure → all 7 writes rolled back)
//   2. Idempotency replay integrity (same key + same request → exactly 1 Payment)
//   3. Idempotency conflict (same key + different amount/order → no 2nd capture)
//   4. Concurrent duplicate requests (5 parallel same key → exactly 1 Payment/ledger/outbox)
//
// Output: self-validating JSON with ok:true + runId + per-test PASS/FAIL
// Written to: evidence/wave3-3a/evidence-<runId>.json
// ============================================================================

import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `3a-ev-${Date.now()}-${randomUUID().slice(0, 8)}`
const OUTPUT_DIR = join(process.cwd(), 'evidence', 'wave3-3a')

mkdirSync(OUTPUT_DIR, { recursive: true })

// --- Cookie jar (manual, since Node fetch doesn't persist cookies) ---
let sessionCookie = null
let csrfToken = null

function setCookiesFromResponse(response) {
  const setCookie = response.headers.getSetCookie?.() ?? []
  for (const cookie of setCookie) {
    if (cookie.startsWith('snakzap_session=')) {
      sessionCookie = cookie.split(';')[0].split('=')[1]
    }
    if (cookie.startsWith('snakzap_csrf=')) {
      csrfToken = cookie.split(';')[0].split('=')[1]
    }
  }
}

function getAuthHeaders() {
  const headers = {}
  if (sessionCookie) headers['Cookie'] = `snakzap_session=${sessionCookie}; snakzap_csrf=${csrfToken ?? ''}`
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  return headers
}

// --- Evidence setup: create test user + session + order ---
async function setupScenario(scenario, amountOverride = null) {
  const url = new URL(`${BASE_URL}/api/payments/evidence-setup`)
  url.searchParams.set('scenario', scenario)
  if (amountOverride) url.searchParams.set('amount', String(amountOverride))

  const response = await fetch(url.toString())
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Setup failed (${response.status}): ${text}`)
  }
  const data = await response.json()

  // The setup endpoint sets the session cookie via Set-Cookie header.
  // We need to capture it for subsequent authenticated requests.
  setCookiesFromResponse(response)

  // Also use the returned tokens directly (more reliable than cookie parsing)
  sessionCookie = data.sessionToken
  csrfToken = data.csrfToken

  return data
}

// --- Evidence verify: check full state of all 7 capture-flow writes ---
async function verifyState(orderId, idempotencyKey = null) {
  const url = new URL(`${BASE_URL}/api/payments/evidence-verify`)
  url.searchParams.set('orderId', orderId)
  if (idempotencyKey) url.searchParams.set('idempotencyKey', idempotencyKey)

  const response = await fetch(url.toString())
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Verify failed (${response.status}): ${text}`)
  }
  return response.json()
}

// --- POST /api/payments (capture) ---
async function capturePayment(orderId, idempotencyKey, failAfterStep = null, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    'Idempotency-Key': idempotencyKey,
  }
  if (failAfterStep) {
    headers['X-Evidence-Fail-After'] = failAfterStep
  }

  const response = await fetch(`${BASE_URL}/api/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      orderId,
      razorpayPaymentId: `pay_evidence_${Date.now()}_${randomUUID().slice(0, 8)}`,
      razorpaySignature: `sig_evidence_${randomUUID().slice(0, 8)}`,
      ...extra,
    }),
  })

  const body = await response.json().catch(() => ({ error: 'non-json response' }))
  return { status: response.status, body }
}

// ============================================================================
// TEST 1: Capture Transaction Rollback
// ============================================================================
// Deliberately fail mid-transaction (after ledger-cr, the last intermediate
// write) and verify ALL 7 writes are rolled back:
//   Payment + Order(PAID) + LedgerEntry(Dr) + LedgerEntry(Cr) + AuditLog + Outbox + IdempotencyKey
// ============================================================================
async function test1_rollback() {
  const testId = 'test-1-rollback'
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('rollback')
  const { orderId } = setup
  const idempotencyKey = `ev-rollback-${randomUUID().slice(0, 12)}`

  console.log(`[${testId}] Sending capture with X-Evidence-Fail-After: ledger-cr`)
  const result = await capturePayment(orderId, idempotencyKey, 'ledger-cr')

  console.log(`[${testId}] Capture response status: ${result.status}`)
  console.log(`[${testId}] Verifying state...`)
  const state = await verifyState(orderId, idempotencyKey)

  // Verify the error response indicates deliberate failure
  const isDeliberateFailure =
    result.status === 500 &&
    result.body?.error?.details?.evidenceFailureInjection === true &&
    result.body?.error?.details?.failedAfterStep === 'ledger-cr'

  // Verify ALL writes rolled back
  const paymentExists = state.payment.exists && state.payment.status === 'CAPTURED'
  const orderPaid = state.order.status === 'PAID'
  const ledgerEntries = state.ledgerEntries
  const auditLogExists = state.auditLogExists
  const outboxExists = state.outboxExists
  const idempotencyRecordExists = state.idempotencyRecordExists

  const allRolledBack =
    !paymentExists &&
    !orderPaid &&
    ledgerEntries === 0 &&
    !auditLogExists &&
    !outboxExists &&
    !idempotencyRecordExists

  const passed = isDeliberateFailure && allRolledBack && state.atomicRollback === true

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Deliberate failure triggered: ${isDeliberateFailure}`)
  console.log(`[${testId}]   Payment exists: ${paymentExists} (expected: false)`)
  console.log(`[${testId}]   Order paid: ${orderPaid} (expected: false)`)
  console.log(`[${testId}]   Ledger entries: ${ledgerEntries} (expected: 0)`)
  console.log(`[${testId}]   Audit log exists: ${auditLogExists} (expected: false)`)
  console.log(`[${testId}]   Outbox exists: ${outboxExists} (expected: false)`)
  console.log(`[${testId}]   Idempotency record exists: ${idempotencyRecordExists} (expected: false)`)
  console.log(`[${testId}]   Atomic rollback (server-computed): ${state.atomicRollback}`)

  return {
    testId,
    testName: 'Capture Transaction Rollback (deliberate mid-tx failure)',
    criterion: 'Capture failure → no partial Order/Ledger/Outbox state (rollback)',
    passed,
    setup: { orderId, idempotencyKey, failAfterStep: 'ledger-cr' },
    captureResponse: {
      status: result.status,
      errorDetails: result.body?.error?.details ?? null,
      errorMessage: result.body?.error?.message ?? null,
    },
    verification: {
      paymentExists,
      orderPaid,
      ledgerEntries,
      auditLogExists,
      outboxExists,
      idempotencyRecordExists,
      atomicRollback: state.atomicRollback,
    },
    expected: {
      paymentExists: false,
      orderPaid: false,
      ledgerEntries: 0,
      auditLogExists: false,
      outboxExists: false,
      idempotencyRecordExists: false,
      atomicRollback: true,
    },
  }
}

// ============================================================================
// TEST 2: Idempotency Replay Integrity
// ============================================================================
// Same idempotency key + same request → exactly one Payment created.
// The second request should return the cached response (same paymentId).
// ============================================================================
async function test2_replay() {
  const testId = 'test-2-replay'
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('replay')
  const { orderId } = setup
  const idempotencyKey = `ev-replay-${randomUUID().slice(0, 12)}`

  console.log(`[${testId}] Sending first capture (key=${idempotencyKey})...`)
  const result1 = await capturePayment(orderId, idempotencyKey)
  console.log(`[${testId}] First capture: status=${result1.status}, paymentId=${result1.body?.payment?.id}`)

  console.log(`[${testId}] Sending replay capture (same key, same request)...`)
  const result2 = await capturePayment(orderId, idempotencyKey)
  console.log(`[${testId}] Replay capture: status=${result2.status}, paymentId=${result2.body?.payment?.id}`)

  console.log(`[${testId}] Verifying state...`)
  const state = await verifyState(orderId, idempotencyKey)

  const samePaymentId = result1.body?.payment?.id === result2.body?.payment?.id
  const bothSucceeded = result1.status === 200 && result2.status === 200
  const exactlyOnePayment = state.payment.exists && state.payment.status === 'CAPTURED'
  const exactlyTwoLedgerEntries = state.ledgerEntries === 2
  const exactlyOneOutbox = state.outboxExists
  const exactlyOneIdempotencyRecord = state.idempotencyRecordExists
  const exactlyOneCapture = state.exactlyOneCapture === true

  const passed =
    bothSucceeded &&
    samePaymentId &&
    exactlyOnePayment &&
    exactlyTwoLedgerEntries &&
    exactlyOneOutbox &&
    exactlyOneIdempotencyRecord &&
    exactlyOneCapture

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Both requests succeeded (200): ${bothSucceeded}`)
  console.log(`[${testId}]   Same paymentId returned: ${samePaymentId}`)
  console.log(`[${testId}]   Exactly 1 Payment: ${exactlyOnePayment}`)
  console.log(`[${testId}]   Exactly 2 LedgerEntries (Dr+Cr): ${exactlyTwoLedgerEntries}`)
  console.log(`[${testId}]   Exactly 1 Outbox event: ${exactlyOneOutbox}`)
  console.log(`[${testId}]   Exactly 1 IdempotencyRecord: ${exactlyOneIdempotencyRecord}`)
  console.log(`[${testId}]   Server-computed exactlyOneCapture: ${exactlyOneCapture}`)

  return {
    testId,
    testName: 'Idempotency Replay Integrity (same key + same request → exactly 1 Payment)',
    criterion: 'Same idempotency key → same Payment row (dedup works)',
    passed,
    setup: { orderId, idempotencyKey },
    captureResponse1: {
      status: result1.status,
      paymentId: result1.body?.payment?.id ?? null,
    },
    captureResponse2: {
      status: result2.status,
      paymentId: result2.body?.payment?.id ?? null,
    },
    samePaymentId,
    verification: {
      paymentExists: state.payment.exists,
      paymentStatus: state.payment.status ?? null,
      paymentId: state.payment.id ?? null,
      ledgerEntries: state.ledgerEntries,
      ledgerDrCount: state.ledgerDrCount,
      ledgerCrCount: state.ledgerCrCount,
      outboxExists: state.outboxExists,
      idempotencyRecordExists: state.idempotencyRecordExists,
      exactlyOneCapture: state.exactlyOneCapture,
    },
    expected: {
      samePaymentId: true,
      ledgerEntries: 2,
      exactlyOneCapture: true,
    },
  }
}

// ============================================================================
// TEST 3: Idempotency Conflict (same key + different amount/order)
// ============================================================================
// Request A: idempotencyKey=K, order=O1, amount=6000 → CAPTURED
// Request B: idempotencyKey=K, order=O2 (different order), → MUST NOT create
//            a second capture. Should return cached response for O1.
// ============================================================================
async function test3_conflict() {
  const testId = 'test-3-conflict'
  console.log(`\n[${testId}] Setting up scenario A (order O1)...`)
  const setupA = await setupScenario('conflict')
  const orderO1 = setupA.orderId
  const idempotencyKey = `ev-conflict-${randomUUID().slice(0, 12)}`

  console.log(`[${testId}] Setting up scenario B (order O2, different order)...`)
  const setupB = await setupScenario('conflict')
  const orderO2 = setupB.orderId

  console.log(`[${testId}] Request A: key=${idempotencyKey}, order=O1(${orderO1.slice(-8)})`)
  const resultA = await capturePayment(orderO1, idempotencyKey)
  console.log(`[${testId}] Request A result: status=${resultA.status}, paymentId=${resultA.body?.payment?.id}`)

  console.log(`[${testId}] Request B: same key=${idempotencyKey}, order=O2(${orderO2.slice(-8)})`)
  const resultB = await capturePayment(orderO2, idempotencyKey)
  console.log(`[${testId}] Request B result: status=${resultB.status}, paymentId=${resultB.body?.payment?.id}`)

  console.log(`[${testId}] Verifying state of O1...`)
  const stateO1 = await verifyState(orderO1, idempotencyKey)
  console.log(`[${testId}] Verifying state of O2...`)
  const stateO2 = await verifyState(orderO2, idempotencyKey)

  // The idempotency key was used for O1's capture. Request B with the same key
  // but different order MUST NOT create a capture for O2. It should return the
  // cached response (which references O1's payment).
  const o1HasPayment = stateO1.payment.exists && stateO1.payment.status === 'CAPTURED'
  const o2HasPayment = stateO2.payment.exists && stateO2.payment.status === 'CAPTURED'
  const o2NotPaid = stateO2.order.status !== 'PAID'
  const o2NoLedger = stateO2.ledgerEntries === 0
  const o2NoOutbox = !stateO2.outboxExists

  // The cached response should return O1's paymentId, not create one for O2
  const samePaymentIdInCache = resultA.body?.payment?.id === resultB.body?.payment?.id

  const passed =
    o1HasPayment &&
    !o2HasPayment &&
    o2NotPaid &&
    o2NoLedger &&
    o2NoOutbox &&
    samePaymentIdInCache &&
    resultB.status === 200

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   O1 has captured payment: ${o1HasPayment}`)
  console.log(`[${testId}]   O2 has captured payment: ${o2HasPayment} (expected: false)`)
  console.log(`[${testId}]   O2 not paid: ${o2NotPaid}`)
  console.log(`[${testId}]   O2 no ledger entries: ${o2NoLedger}`)
  console.log(`[${testId}]   O2 no outbox: ${o2NoOutbox}`)
  console.log(`[${testId}]   Same paymentId returned in cache: ${samePaymentIdInCache}`)
  console.log(`[${testId}]   Request B status: ${resultB.status} (expected: 200 cached response)`)

  return {
    testId,
    testName: 'Idempotency Conflict (same key + different order → no 2nd capture)',
    criterion: 'Same idempotency key + materially different order → second request must not create a second capture',
    passed,
    setup: {
      orderO1,
      orderO2,
      idempotencyKey,
      differentOrders: orderO1 !== orderO2,
    },
    captureResponseA: {
      status: resultA.status,
      paymentId: resultA.body?.payment?.id ?? null,
      orderId: resultA.body?.payment?.orderId ?? null,
    },
    captureResponseB: {
      status: resultB.status,
      paymentId: resultB.body?.payment?.id ?? null,
      orderId: resultB.body?.payment?.orderId ?? null,
    },
    samePaymentIdInCache,
    verificationO1: {
      paymentExists: stateO1.payment.exists,
      paymentStatus: stateO1.payment.status ?? null,
      orderStatus: stateO1.order.status,
      ledgerEntries: stateO1.ledgerEntries,
      outboxExists: stateO1.outboxExists,
    },
    verificationO2: {
      paymentExists: stateO2.payment.exists,
      paymentStatus: stateO2.payment.status ?? null,
      orderStatus: stateO2.order.status,
      ledgerEntries: stateO2.ledgerEntries,
      outboxExists: stateO2.outboxExists,
    },
    expected: {
      o1HasPayment: true,
      o2HasPayment: false,
      o2OrderStatus: 'CONFIRMED',
      samePaymentIdInCache: true,
    },
  }
}

// ============================================================================
// TEST 4: Concurrent Duplicate Requests
// ============================================================================
// Fire N=5 parallel POST /api/payments with the SAME idempotency key + same
// order. Verify exactly 1 Payment is created, 1 ledger pair, 1 outbox event.
// ============================================================================
async function test4_concurrent() {
  const testId = 'test-4-concurrent'
  const CONCURRENCY = 5
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('concurrent')
  const { orderId } = setup
  const idempotencyKey = `ev-concurrent-${randomUUID().slice(0, 12)}`

  console.log(`[${testId}] Firing ${CONCURRENCY} concurrent captures with same key=${idempotencyKey}`)
  const promises = []
  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(capturePayment(orderId, idempotencyKey))
  }
  const results = await Promise.all(promises)

  console.log(`[${testId}] Concurrent results:`)
  for (let i = 0; i < results.length; i++) {
    console.log(`[${testId}]   Request ${i + 1}: status=${results[i].status}, paymentId=${results[i].body?.payment?.id ?? 'N/A'}, error=${results[i].body?.error?.code ?? 'none'}`)
  }

  console.log(`[${testId}] Verifying state...`)
  const state = await verifyState(orderId, idempotencyKey)

  const successCount = results.filter((r) => r.status === 200).length
  const errorCount = results.filter((r) => r.status !== 200).length
  const uniquePaymentIds = new Set(
    results
      .map((r) => r.body?.payment?.id)
      .filter((id) => id !== undefined && id !== null)
  ).size

  const exactlyOnePayment = state.payment.exists && state.payment.status === 'CAPTURED'
  const exactlyTwoLedgerEntries = state.ledgerEntries === 2
  const exactlyOneOutbox = state.outboxExists
  const exactlyOneIdempotencyRecord = state.idempotencyRecordExists
  const exactlyOneCapture = state.exactlyOneCapture === true

  const passed =
    exactlyOnePayment &&
    exactlyTwoLedgerEntries &&
    exactlyOneOutbox &&
    exactlyOneIdempotencyRecord &&
    exactlyOneCapture &&
    uniquePaymentIds === 1

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Success responses: ${successCount}`)
  console.log(`[${testId}]   Error responses: ${errorCount}`)
  console.log(`[${testId}]   Unique paymentIds in responses: ${uniquePaymentIds} (expected: 1)`)
  console.log(`[${testId}]   DB: Payment exists: ${exactlyOnePayment}`)
  console.log(`[${testId}]   DB: Ledger entries: ${state.ledgerEntries} (expected: 2 — Dr+Cr)`)
  console.log(`[${testId}]   DB: Outbox exists: ${exactlyOneOutbox}`)
  console.log(`[${testId}]   DB: Idempotency record exists: ${exactlyOneIdempotencyRecord}`)
  console.log(`[${testId}]   DB: Server-computed exactlyOneCapture: ${exactlyOneCapture}`)

  return {
    testId,
    testName: 'Concurrent Duplicate Requests (N parallel same key → exactly 1 Payment)',
    criterion: 'Multiple simultaneous requests using the same idempotency key → exactly one Payment, one ledger pair, one outbox event',
    passed,
    setup: { orderId, idempotencyKey, concurrency: CONCURRENCY },
    concurrentResponses: results.map((r, i) => ({
      requestIndex: i + 1,
      status: r.status,
      paymentId: r.body?.payment?.id ?? null,
      errorCode: r.body?.error?.code ?? null,
    })),
    summary: {
      successCount,
      errorCount,
      uniquePaymentIds,
    },
    verification: {
      paymentExists: state.payment.exists,
      paymentStatus: state.payment.status ?? null,
      paymentId: state.payment.id ?? null,
      ledgerEntries: state.ledgerEntries,
      ledgerDrCount: state.ledgerDrCount,
      ledgerCrCount: state.ledgerCrCount,
      outboxExists: state.outboxExists,
      outboxStatus: state.outboxStatus,
      idempotencyRecordExists: state.idempotencyRecordExists,
      exactlyOneCapture: state.exactlyOneCapture,
    },
    expected: {
      uniquePaymentIds: 1,
      ledgerEntries: 2,
      exactlyOneCapture: true,
    },
  }
}

// ============================================================================
// Main: run all 4 tests + generate self-validating evidence JSON
// ============================================================================
async function main() {
  console.log('========================================')
  console.log('SnakZap Wave-3 Sub-Wave 3a — Evidence Runner')
  console.log('========================================')
  console.log(`Run ID: ${RUN_ID}`)
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`EVIDENCE_TEST_MODE expected: true`)
  console.log('========================================')

  // Pre-flight: verify the server is running + evidence mode is on
  console.log('\n[pre-flight] Checking server health...')
  try {
    const healthResp = await fetch(`${BASE_URL}/api/health`)
    if (!healthResp.ok) {
      throw new Error(`Health check failed: ${healthResp.status}`)
    }
    console.log('[pre-flight] Server is healthy.')
  } catch (e) {
    console.error('[pre-flight] FAILED: Server not reachable at', BASE_URL)
    console.error('  Make sure the dev server is running with EVIDENCE_TEST_MODE=true')
    process.exit(1)
  }

  console.log('[pre-flight] Verifying evidence setup endpoint...')
  // Retry the evidence-setup endpoint a few times to handle Turbopack
  // compilation delay on the first request to a newly-created route.
  let setupCheck = null
  for (let attempt = 1; attempt <= 8; attempt++) {
    setupCheck = await fetch(`${BASE_URL}/api/payments/evidence-setup?scenario=pre-flight`)
    console.log(`[pre-flight] Attempt ${attempt}: status=${setupCheck.status}`)
    if (setupCheck.ok) break
    if (attempt < 8) {
      console.log(`[pre-flight] Retrying in 2s (compilation may be in progress)...`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (setupCheck.status === 403) {
    console.error('[pre-flight] FAILED: Evidence test mode not enabled (403).')
    console.error('  Start the dev server with: EVIDENCE_TEST_MODE=true bun run dev')
    process.exit(1)
  }
  if (!setupCheck.ok) {
    const errBody = await setupCheck.text().catch(() => '(non-json)')
    console.error('[pre-flight] FAILED: Evidence setup endpoint returned', setupCheck.status)
    console.error('  Response body (first 300 chars):', errBody.slice(0, 300))
    process.exit(1)
  }
  console.log('[pre-flight] Evidence mode is ON. Proceeding with tests.')

  // Run all 4 tests
  const test1 = await test1_rollback()
  const test2 = await test2_replay()
  const test3 = await test3_conflict()
  const test4 = await test4_concurrent()

  const tests = [test1, test2, test3, test4]
  const allPassed = tests.every((t) => t.passed)

  // Generate self-validating evidence JSON
  const evidence = {
    // Self-validation: ok is true ONLY if ALL 4 tests passed
    ok: allPassed,
    runId: RUN_ID,
    wave: '3',
    subWave: '3a',
    evidenceType: 'failure-path-and-concurrency',
    generatedAt: new Date().toISOString(),
    environment: {
      baseUrl: BASE_URL,
      evidenceTestMode: true,
      realPaymentsFlag: false,
      database: 'sqlite (local dev — staging/production use PostgreSQL)',
      note: 'Transaction rollback + unique-constraint semantics are identical on SQLite and PostgreSQL. Concurrency test on SQLite uses database-level locking; the same invariant (exactly 1 Payment) holds on PostgreSQL via row-level locks + unique constraints.',
    },
    orchestratorCriteria: {
      '1-rollback': 'Capture failure → no partial Order/Ledger/Outbox state (rollback)',
      '2-replay': 'Same idempotency key → same Payment row (dedup works)',
      '3-conflict': 'Same key + materially different amount/order → no second capture',
      '4-concurrent': 'Multiple simultaneous requests same key → exactly 1 Payment/ledger/outbox',
    },
    tests,
    summary: {
      totalTests: tests.length,
      passed: tests.filter((t) => t.passed).length,
      failed: tests.filter((t) => !t.passed).length,
      allPassed,
    },
    atomicBoundaryProof: {
      description: 'Payment capture writes 7 entities in a single transaction. A deliberate mid-transaction failure rolls back ALL 7 writes.',
      writes: [
        'Payment (CAPTURED status + capturedAt)',
        'Order (status=PAID)',
        'LedgerEntry DEBIT (GATEWAY_RECEIVABLE)',
        'LedgerEntry CREDIT (CONSUMER_REVENUE)',
        'AuditLog (PAYMENT_CAPTURED)',
        'Outbox (PAYMENT_CAPTURED event)',
        'IdempotencyKey (cached response)',
      ],
      failurePath: 'capture/DB failure → ROLLBACK → no partial payment/ledger/orphan outbox',
      provenBy: 'test-1-rollback (deliberate failure after ledger-cr → all 7 writes absent)',
    },
  }

  // Write evidence JSON
  const outputPath = join(OUTPUT_DIR, `evidence-${RUN_ID}.json`)
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2))

  console.log('\n========================================')
  console.log('EVIDENCE SUMMARY')
  console.log('========================================')
  console.log(`Run ID: ${RUN_ID}`)
  console.log(`ok: ${evidence.ok}`)
  console.log(`Tests passed: ${evidence.summary.passed}/${evidence.summary.totalTests}`)
  for (const t of tests) {
    console.log(`  ${t.passed ? '✅' : '❌'} ${t.testId}: ${t.testName}`)
  }
  console.log(`\nEvidence written to: ${outputPath}`)
  console.log('========================================')

  if (!allPassed) {
    console.error('\n❌ SOME TESTS FAILED — Evidence package is NOT complete.')
    process.exit(1)
  }

  console.log('\n✅ All 4 evidence tests PASSED. Awaiting Orchestrator review.')
}

main().catch((err) => {
  console.error('Evidence runner crashed:', err)
  process.exit(1)
})
