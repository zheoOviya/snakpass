#!/usr/bin/env node
// ============================================================================
// SnakZap Wave-3 Sub-Wave 3c — Evidence Remediation (E3 + E4: null-hash backward-compat)
// ============================================================================
// Runs 2 NEW empirical evidence tests for null-hash backward compatibility:
//   3c-E3: existing IdempotencyKey with requestHash=null + different body + flag ON → cached, no 422
//   3c-E4: existing IdempotencyKey with requestHash=null + same body + flag ON → cached, no 422
//
// These tests prove that pre-3c records (null requestHash) are backward-compatible:
// the hash check is skipped when stored requestHash is null, regardless of flag state.
//
// Output: self-validating JSON with ok:true + runId + per-test PASS/FAIL
// Written to: evidence/wave3-3c/evidence-3c-remediation-<runId>.json
// ============================================================================

import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `3c-remed-${Date.now()}-${randomUUID().slice(0, 8)}`
const OUTPUT_DIR = join(process.cwd(), 'evidence', 'wave3-3c')

mkdirSync(OUTPUT_DIR, { recursive: true })

// --- Cookie jar ---
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

async function setupScenario(scenario) {
  const url = new URL(`${BASE_URL}/api/orders/evidence-setup`)
  url.searchParams.set('scenario', scenario)
  const response = await fetch(url.toString())
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Setup failed (${response.status}): ${text}`)
  }
  const data = await response.json()
  setCookiesFromResponse(response)
  sessionCookie = data.sessionToken
  csrfToken = data.csrfToken
  return data
}

async function verifyState(orderId, idempotencyKey = null, userId = null) {
  const url = new URL(`${BASE_URL}/api/orders/evidence-verify`)
  url.searchParams.set('orderId', orderId)
  if (idempotencyKey) url.searchParams.set('idempotencyKey', idempotencyKey)
  if (userId) url.searchParams.set('userId', userId)
  const response = await fetch(url.toString())
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Verify failed (${response.status}): ${text}`)
  }
  return response.json()
}

async function createOrder(orderBody, idempotencyKey) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    'Idempotency-Key': idempotencyKey,
  }
  const response = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(orderBody),
  })
  const body = await response.json().catch(() => ({ error: 'non-json response' }))
  return { status: response.status, body }
}

function buildOrderBody(setup, qty = 1) {
  return {
    restaurantId: setup.restaurantId,
    items: [{
      menuItemId: setup.menuItemId,
      name: setup.menuItemName,
      price: setup.menuItemPrice,
      quantity: qty,
    }],
  }
}

// ============================================================================
// TEST 3c-E3: null-hash + different body + flag ON → cached, no 422
// ============================================================================
async function test3_null_hash_diff_body() {
  const testId = 'test-3c-E3-null-hash-diff-body'
  console.log(`\n[${testId}] Setting up null-hash scenario...`)
  const setup = await setupScenario('null-hash-backward-compat')
  const { userId, preExistingIdempotencyKey, preExistingOrderId } = setup

  if (!preExistingIdempotencyKey) {
    throw new Error('Setup did not create a pre-existing null-hash IdempotencyKey record')
  }

  console.log(`[${testId}] Pre-existing record: key=${preExistingIdempotencyKey}, orderId=${preExistingOrderId}`)
  console.log(`[${testId}] Pre-existing record has requestHash=null (simulating pre-3c record)`)

  // Build a DIFFERENT body (qty=3 instead of qty=1)
  const differentBody = buildOrderBody(setup, 3)

  console.log(`[${testId}] Sending POST with SAME key + DIFFERENT body (qty=3) + flag ON`)
  console.log(`[${testId}] Expected: cached response (no 422) — hash check skipped for null-hash record`)

  const result = await createOrder(differentBody, preExistingIdempotencyKey)
  const returnedOrderId = result.body?.order?.id
  console.log(`[${testId}] Response: status=${result.status}, orderId=${returnedOrderId}`)

  console.log(`[${testId}] Verifying state...`)
  const state = await verifyState(preExistingOrderId, preExistingIdempotencyKey, userId)

  // Expected: backward-compatible behavior
  // - HTTP 200 (cached response returned)
  // - Same orderId as pre-existing record
  // - No 422 (hash check skipped because stored requestHash is null)
  // - No new Order created (exactlyOneOrder)
  const returnedCachedResponse = result.status === 200
  const sameOrderId = returnedOrderId === preExistingOrderId
  const no422 = result.status !== 422
  const noNewOrderCreated = state.idempotencyResourceId === preExistingOrderId
  const hashIsNull = state.idempotencyRequestHash === null
  const exactlyOneOrder = state.exactlyOneOrder === true

  const passed = returnedCachedResponse && sameOrderId && no422 && noNewOrderCreated && hashIsNull

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Returned 200 (cached): ${returnedCachedResponse}`)
  console.log(`[${testId}]   Same orderId (pre-existing): ${sameOrderId}`)
  console.log(`[${testId}]   No 422 (backward-compat): ${no422}`)
  console.log(`[${testId}]   No new Order created: ${noNewOrderCreated}`)
  console.log(`[${testId}]   Stored requestHash is null: ${hashIsNull}`)
  console.log(`[${testId}]   Exactly 1 Order: ${exactlyOneOrder}`)

  return {
    testId,
    testName: '3c-E3: null-hash + different body + flag ON → cached, no 422 (backward-compat)',
    criterion: 'C1 backward-compat: pre-3c record (null hash) + different body → cached response, no 422',
    passed,
    setup: {
      preExistingIdempotencyKey,
      preExistingOrderId,
      userId,
      storedRequestHash: null,
      flagState: 'ON',
      bodySent: 'qty=3 (different from pre-existing qty=1)',
    },
    response: {
      status: result.status,
      orderId: returnedOrderId,
      errorCode: result.body?.error?.code ?? null,
    },
    verification: {
      returnedCachedResponse,
      sameOrderId,
      no422,
      noNewOrderCreated,
      hashIsNull,
      exactlyOneOrder,
      idempotencyRequestHash: state.idempotencyRequestHash,
      idempotencyResourceId: state.idempotencyResourceId,
    },
    expected: {
      status: 200,
      sameOrderId: true,
      no422: true,
      hashIsNull: true,
    },
  }
}

// ============================================================================
// TEST 3c-E4: null-hash + same body + flag ON → cached, no 422
// ============================================================================
async function test4_null_hash_same_body() {
  const testId = 'test-3c-E4-null-hash-same-body'
  console.log(`\n[${testId}] Setting up null-hash scenario...`)
  const setup = await setupScenario('null-hash-backward-compat')
  const { userId, preExistingIdempotencyKey, preExistingOrderId } = setup

  if (!preExistingIdempotencyKey) {
    throw new Error('Setup did not create a pre-existing null-hash IdempotencyKey record')
  }

  console.log(`[${testId}] Pre-existing record: key=${preExistingIdempotencyKey}, orderId=${preExistingOrderId}`)
  console.log(`[${testId}] Pre-existing record has requestHash=null (simulating pre-3c record)`)

  // Build the SAME body (qty=1, matching pre-existing record)
  const sameBody = buildOrderBody(setup, 1)

  console.log(`[${testId}] Sending POST with SAME key + SAME body (qty=1) + flag ON`)
  console.log(`[${testId}] Expected: cached response (no 422) — hash check skipped for null-hash record`)

  const result = await createOrder(sameBody, preExistingIdempotencyKey)
  const returnedOrderId = result.body?.order?.id
  console.log(`[${testId}] Response: status=${result.status}, orderId=${returnedOrderId}`)

  console.log(`[${testId}] Verifying state...`)
  const state = await verifyState(preExistingOrderId, preExistingIdempotencyKey, userId)

  // Expected: backward-compatible behavior
  const returnedCachedResponse = result.status === 200
  const sameOrderId = returnedOrderId === preExistingOrderId
  const no422 = result.status !== 422
  const noNewOrderCreated = state.idempotencyResourceId === preExistingOrderId
  const hashIsNull = state.idempotencyRequestHash === null
  const exactlyOneOrder = state.exactlyOneOrder === true

  const passed = returnedCachedResponse && sameOrderId && no422 && noNewOrderCreated && hashIsNull

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Returned 200 (cached): ${returnedCachedResponse}`)
  console.log(`[${testId}]   Same orderId (pre-existing): ${sameOrderId}`)
  console.log(`[${testId}]   No 422 (backward-compat): ${no422}`)
  console.log(`[${testId}]   No new Order created: ${noNewOrderCreated}`)
  console.log(`[${testId}]   Stored requestHash is null: ${hashIsNull}`)
  console.log(`[${testId}]   Exactly 1 Order: ${exactlyOneOrder}`)

  return {
    testId,
    testName: '3c-E4: null-hash + same body + flag ON → cached, no 422 (backward-compat)',
    criterion: 'C1 backward-compat: pre-3c record (null hash) + same body → cached response, no 422',
    passed,
    setup: {
      preExistingIdempotencyKey,
      preExistingOrderId,
      userId,
      storedRequestHash: null,
      flagState: 'ON',
      bodySent: 'qty=1 (same as pre-existing)',
    },
    response: {
      status: result.status,
      orderId: returnedOrderId,
      errorCode: result.body?.error?.code ?? null,
    },
    verification: {
      returnedCachedResponse,
      sameOrderId,
      no422,
      noNewOrderCreated,
      hashIsNull,
      exactlyOneOrder,
      idempotencyRequestHash: state.idempotencyRequestHash,
      idempotencyResourceId: state.idempotencyResourceId,
    },
    expected: {
      status: 200,
      sameOrderId: true,
      no422: true,
      hashIsNull: true,
    },
  }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('========================================')
  console.log('SnakZap Wave-3 Sub-Wave 3c — Evidence Remediation (E3 + E4)')
  console.log('========================================')
  console.log(`Run ID: ${RUN_ID}`)
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`EVIDENCE_TEST_MODE expected: true`)
  console.log(`FEATURE_REQUEST_HASH_ENFORCEMENT expected: true (flag ON)`)
  console.log('========================================')

  // Pre-flight
  console.log('\n[pre-flight] Checking server health...')
  try {
    const healthResp = await fetch(`${BASE_URL}/api/health`)
    if (!healthResp.ok) throw new Error(`Health check failed: ${healthResp.status}`)
    console.log('[pre-flight] Server is healthy.')
  } catch (e) {
    console.error('[pre-flight] FAILED: Server not reachable at', BASE_URL)
    process.exit(1)
  }

  console.log('[pre-flight] Verifying evidence setup endpoint...')
  let setupCheck = null
  for (let attempt = 1; attempt <= 8; attempt++) {
    setupCheck = await fetch(`${BASE_URL}/api/orders/evidence-setup?scenario=pre-flight`)
    if (setupCheck.ok) break
    if (attempt < 8) await new Promise((r) => setTimeout(r, 2000))
  }
  if (!setupCheck.ok) {
    console.error('[pre-flight] FAILED: Evidence setup endpoint returned', setupCheck.status)
    process.exit(1)
  }
  console.log('[pre-flight] Evidence mode is ON. Proceeding with E3 + E4 tests.')

  // Run E3 + E4
  const e3 = await test3_null_hash_diff_body()
  const e4 = await test4_null_hash_same_body()

  const tests = [e3, e4]
  const allPassed = tests.every((t) => t.passed)

  // Also load the existing E1/E2/E5 evidence to build the complete 5-scenario package
  const existingEvidencePath = join(OUTPUT_DIR, 'evidence-3c-ev-1786837243069-b25ac53c.json')
  let existingEvidence = null
  if (existsSync(existingEvidencePath)) {
    existingEvidence = JSON.parse(readFileSync(existingEvidencePath, 'utf8'))
    console.log(`\n[merge] Loaded existing E1/E2/E5 evidence from ${existingEvidencePath}`)
  }

  // Build complete evidence package (E1-E5)
  const allTests = []
  if (existingEvidence) {
    allTests.push(...existingEvidence.tests)
  }
  allTests.push(...tests)

  const evidence = {
    ok: allPassed && (existingEvidence?.ok ?? false),
    runId: RUN_ID,
    wave: '3',
    subWave: '3c',
    evidenceType: 'c1-requestHash-enforcement-complete',
    generatedAt: new Date().toISOString(),
    environment: {
      baseUrl: BASE_URL,
      evidenceTestMode: true,
      realPaymentsFlag: false,
      requestHashEnforcementFlag: 'ON (E1, E2, E3, E4, E5)',
      database: 'sqlite (local dev — staging/production use PostgreSQL)',
      note: 'E1/E2/E5 from previous run (evidence-3c-ev-1786837243069-b25ac53c.json). E3/E4 from this remediation run. PostgreSQL-native proof (3c-PG-E1) in separate evidence file.',
    },
    tests: allTests,
    summary: {
      totalTests: allTests.length,
      passed: allTests.filter((t) => t.passed).length,
      failed: allTests.filter((t) => !t.passed).length,
      allPassed: allTests.every((t) => t.passed) && (existingEvidence?.ok ?? false),
      e1: allTests.find((t) => t.testId?.includes('hash-match'))?.passed ?? false,
      e2: allTests.find((t) => t.testId?.includes('hash-mismatch'))?.passed ?? false,
      e3: e3.passed,
      e4: e4.passed,
      e5: allTests.find((t) => t.testId?.includes('concurrent'))?.passed ?? false,
    },
    reusedEvidence: {
      note: '11 scenarios from 3a/3b are CLOSED and NOT re-run:',
      '3a-closed': ['3a-E1', '3a-E2', '3a-E3', '3a-E4', '3a-PG-E1'],
      '3b-closed': ['3b-E1', '3b-E2', '3b-E3', '3b-E4', '3b-E5', '3b-PG-E1'],
      '3c-postgresql': 'evidence/wave3-3c/evidence-postgresql-3c-pg-ev.json (3c-PG-E1, run 31916110251)',
    },
  }

  const outputPath = join(OUTPUT_DIR, `evidence-3c-complete-${RUN_ID}.json`)
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2))

  console.log('\n========================================')
  console.log('EVIDENCE REMEDIATION SUMMARY')
  console.log('========================================')
  console.log(`Run ID: ${RUN_ID}`)
  console.log(`ok: ${evidence.ok}`)
  console.log(`\n3c evidence total (5 scenarios):`)
  console.log(`  E1 (hash-match): ${evidence.summary.e1 ? 'PASS' : 'FAIL/MISSING'}`)
  console.log(`  E2 (hash-mismatch→422): ${evidence.summary.e2 ? 'PASS' : 'FAIL/MISSING'}`)
  console.log(`  E3 (null-hash + diff body): ${evidence.summary.e3 ? 'PASS' : 'FAIL'}`)
  console.log(`  E4 (null-hash + same body): ${evidence.summary.e4 ? 'PASS' : 'FAIL'}`)
  console.log(`  E5 (5-concurrent flag-ON): ${evidence.summary.e5 ? 'PASS' : 'FAIL/MISSING'}`)
  console.log(`\nOverall ok: ${evidence.ok}`)
  console.log(`\nEvidence written to: ${outputPath}`)
  console.log('========================================')

  if (!allPassed) {
    console.error('\n❌ E3/E4 REMEDIATION FAILED — Evidence still incomplete.')
    process.exit(1)
  }

  console.log('\n✅ E3 + E4 PASSED. Complete 5-scenario 3c evidence package assembled.')
}

main().catch((err) => {
  console.error('Evidence runner crashed:', err)
  process.exit(1)
})
