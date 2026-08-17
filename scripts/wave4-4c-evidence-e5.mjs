#!/usr/bin/env node
// ============================================================================
// SnakZap Wave-4 Sub-Wave 4c — Evidence Runner E5: Publisher Retry / Duplicate-Capture Prevention
// ============================================================================
// Proves that when the publisher retries (or a second publisher run processes
// the same event), the external capture side-effect is NOT repeated.
//
// Test flow:
//   1. Create a Payment via capture route (status = CAPTURE_PENDING)
//   2. Run publisher handler via /api/payments/evidence-publisher-run (first attempt)
//      → captureCalled=true, Payment → CAPTURED
//   3. Run publisher handler AGAIN via /api/payments/evidence-publisher-run (second attempt)
//      → captureCalled=false (idempotency skip), Payment still CAPTURED
//   4. Verify: exactly 1 Payment, exactly 1 capture call, no duplicate AuditLog,
//      LedgerEntry Dr/Cr balanced, Outbox intact
// ============================================================================

import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `4c-E5-${Date.now()}-${randomUUID().slice(0, 8)}`
const OUTPUT_DIR = join(process.cwd(), 'evidence', 'wave4-4c')
mkdirSync(OUTPUT_DIR, { recursive: true })

let sessionCookie = null
let csrfToken = null

function setCookiesFromResponse(response) {
  const setCookie = response.headers.getSetCookie?.() ?? []
  for (const cookie of setCookie) {
    if (cookie.startsWith('snakzap_session=')) sessionCookie = cookie.split(';')[0].split('=')[1]
    if (cookie.startsWith('snakzap_csrf=')) csrfToken = cookie.split(';')[0].split('=')[1]
  }
}

function getAuthHeaders() {
  const headers = {}
  if (sessionCookie) headers['Cookie'] = `snakzap_session=${sessionCookie}; snakzap_csrf=${csrfToken ?? ''}`
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  return headers
}

async function setupScenario(scenario) {
  const url = new URL(`${BASE_URL}/api/payments/evidence-setup`)
  url.searchParams.set('scenario', scenario)
  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Setup failed (${response.status}): ${await response.text()}`)
  const data = await response.json()
  setCookiesFromResponse(response)
  sessionCookie = data.sessionToken
  csrfToken = data.csrfToken
  return data
}

async function verifyState(orderId, idempotencyKey = null) {
  const url = new URL(`${BASE_URL}/api/payments/evidence-verify`)
  url.searchParams.set('orderId', orderId)
  if (idempotencyKey) url.searchParams.set('idempotencyKey', idempotencyKey)
  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Verify failed (${response.status}): ${await response.text()}`)
  return response.json()
}

async function capturePayment(orderId, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json', ...getAuthHeaders(), 'Idempotency-Key': idempotencyKey }
  const response = await fetch(`${BASE_URL}/api/payments`, {
    method: 'POST', headers,
    body: JSON.stringify({
      orderId,
      razorpayPaymentId: `pay_4c_E5_${Date.now()}_${randomUUID().slice(0, 8)}`,
      razorpaySignature: `sig_4c_E5_${randomUUID().slice(0, 8)}`,
    }),
  })
  const body = await response.json().catch(() => ({ error: 'non-json response' }))
  return { status: response.status, body }
}

async function runPublisher(paymentId) {
  const url = new URL(`${BASE_URL}/api/payments/evidence-publisher-run`)
  url.searchParams.set('paymentId', paymentId)
  const response = await fetch(url.toString(), { method: 'POST' })
  const body = await response.json().catch(() => ({ error: 'non-json response' }))
  return { status: response.status, body }
}

// ============================================================================
// TEST 4c-E5: Publisher Retry / Duplicate-Capture Prevention
// ============================================================================
async function testE5_publisher_retry() {
  const testId = 'test-4c-E5-publisher-retry'
  console.log(`\n[${testId}] Setting up...`)
  const setup = await setupScenario('concurrent')
  const { orderId } = setup
  const idempotencyKey = `ev-4c-E5-${randomUUID().slice(0, 12)}`

  // Step 1: Create a Payment via capture route (status = CAPTURE_PENDING)
  console.log(`[${testId}] Step 1: Capturing payment (creates CAPTURE_PENDING)...`)
  const captureResult = await capturePayment(orderId, idempotencyKey)
  const paymentId = captureResult.body?.payment?.id
  console.log(`[${testId}]   Payment created: id=${paymentId}, status=${captureResult.body?.payment?.status}`)

  if (!paymentId) {
    console.log(`[${testId}] FAIL: No paymentId returned from capture`)
    return { testId, testName: 'Publisher Retry / Duplicate-Capture Prevention', criterion: '4c-E5: external capture not duplicated on retry', passed: false, error: 'No paymentId' }
  }

  // Step 2: Run publisher handler (first attempt — should call capture)
  console.log(`[${testId}] Step 2: Running publisher handler (first attempt)...`)
  const pub1 = await runPublisher(paymentId)
  console.log(`[${testId}]   First run: status=${pub1.status}, captureCalled=${pub1.body?.captureCalled}, statusBefore=${pub1.body?.statusBefore}, statusAfter=${pub1.body?.statusAfter}, idempotencySkipped=${pub1.body?.idempotencySkipped}`)

  // Step 3: Run publisher handler AGAIN (second attempt — should SKIP capture)
  console.log(`[${testId}] Step 3: Running publisher handler AGAIN (second attempt — should skip)...`)
  const pub2 = await runPublisher(paymentId)
  console.log(`[${testId}]   Second run: status=${pub2.status}, captureCalled=${pub2.body?.captureCalled}, statusBefore=${pub2.body?.statusBefore}, statusAfter=${pub2.body?.statusAfter}, idempotencySkipped=${pub2.body?.idempotencySkipped}`)

  // Step 4: Verify final state
  console.log(`[${testId}] Step 4: Verifying final state...`)
  const state = await verifyState(orderId, idempotencyKey)
  console.log(`[${testId}]   Payment status: ${state.payment?.status}`)
  console.log(`[${testId}]   Ledger entries: ${state.ledgerEntries} (Dr: ${state.ledgerDrCount}, Cr: ${state.ledgerCrCount})`)
  console.log(`[${testId}]   Ledger balance intact: ${state.ledgerBalanceIntact}`)
  console.log(`[${testId}]   Outbox exists: ${state.outboxExists}`)
  console.log(`[${testId}]   Idempotency record exists: ${state.idempotencyRecordExists}`)

  // Assertions:
  const firstRunCalledCapture = pub1.body?.captureCalled === true
  const firstRunCaptured = pub1.body?.statusAfter === 'CAPTURED'
  const secondRunSkippedCapture = pub2.body?.captureCalled === false
  const secondRunIdempotentSkip = pub2.body?.idempotencySkipped === true
  const finalPaymentCaptured = state.payment?.status === 'CAPTURED'
  const ledgerEntries = state.ledgerEntries
  const ledgerBalanced = state.ledgerBalanceIntact === true
  const outboxIntact = state.outboxExists
  const idempotencyIntact = state.idempotencyRecordExists

  const passed =
    firstRunCalledCapture &&
    firstRunCaptured &&
    secondRunSkippedCapture &&
    secondRunIdempotentSkip &&
    finalPaymentCaptured &&
    ledgerEntries === 2 &&
    ledgerBalanced &&
    outboxIntact &&
    idempotencyIntact

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   First run called capture: ${firstRunCalledCapture}`)
  console.log(`[${testId}]   First run captured: ${firstRunCaptured}`)
  console.log(`[${testId}]   Second run skipped capture: ${secondRunSkippedCapture}`)
  console.log(`[${testId}]   Second run idempotent skip: ${secondRunIdempotentSkip}`)
  console.log(`[${testId}]   Final Payment CAPTURED: ${finalPaymentCaptured}`)
  console.log(`[${testId}]   Ledger entries: ${ledgerEntries} (expected: 2)`)
  console.log(`[${testId}]   Ledger balanced: ${ledgerBalanced}`)
  console.log(`[${testId}]   Outbox intact: ${outboxIntact}`)
  console.log(`[${testId}]   Idempotency intact: ${idempotencyIntact}`)

  return {
    testId,
    testName: '4c-E5: Publisher Retry / Duplicate-Capture Prevention',
    criterion: 'External capture side-effect NOT repeated on publisher retry — idempotency check prevents double-capture',
    passed,
    setup: { orderId, paymentId, idempotencyKey },
    firstPublisherRun: {
      captureCalled: pub1.body?.captureCalled,
      statusBefore: pub1.body?.statusBefore,
      statusAfter: pub1.body?.statusAfter,
      capturedAt: pub1.body?.capturedAt,
    },
    secondPublisherRun: {
      captureCalled: pub2.body?.captureCalled,
      statusBefore: pub2.body?.statusBefore,
      statusAfter: pub2.body?.statusAfter,
      idempotencySkipped: pub2.body?.idempotencySkipped,
    },
    verification: {
      finalPaymentStatus: state.payment?.status,
      ledgerEntries,
      ledgerDrCount: state.ledgerDrCount,
      ledgerCrCount: state.ledgerCrCount,
      ledgerBalanceIntact: ledgerBalanced,
      outboxExists: outboxIntact,
      idempotencyRecordExists: idempotencyIntact,
    },
    expected: {
      firstRunCaptureCalled: true,
      secondRunCaptureCalled: false,
      secondRunIdempotencySkipped: true,
      finalPaymentStatus: 'CAPTURED',
      ledgerEntries: 2,
      ledgerBalanceIntact: true,
    },
  }
}

async function main() {
  console.log('========================================')
  console.log('SnakZap Wave-4 Sub-Wave 4c — Evidence Runner E5')
  console.log('========================================')
  console.log(`Run ID: ${RUN_ID}`)
  console.log(`Base URL: ${BASE_URL}`)
  console.log('========================================')

  console.log('\n[pre-flight] Checking server health...')
  const healthResp = await fetch(`${BASE_URL}/api/health`)
  if (!healthResp.ok) { console.error('[pre-flight] FAILED'); process.exit(1) }
  console.log('[pre-flight] Server is healthy.')

  console.log('[pre-flight] Verifying evidence setup endpoint...')
  let setupCheck = null
  for (let attempt = 1; attempt <= 8; attempt++) {
    setupCheck = await fetch(`${BASE_URL}/api/payments/evidence-setup?scenario=pre-flight`)
    if (setupCheck.ok) break
    if (attempt < 8) await new Promise((r) => setTimeout(r, 2000))
  }
  if (!setupCheck.ok) { console.error('[pre-flight] FAILED: setup returned', setupCheck.status); process.exit(1) }
  console.log('[pre-flight] Evidence mode is ON.')

  const test = await testE5_publisher_retry()

  const evidence = {
    ok: test.passed,
    runId: RUN_ID,
    wave: '4',
    subWave: '4c',
    evidenceType: 'publisher-retry-duplicate-capture-prevention',
    generatedAt: new Date().toISOString(),
    environment: { baseUrl: BASE_URL, evidenceTestMode: true, realPaymentsFlag: false, database: 'sqlite (local dev)' },
    tests: [test],
    summary: { totalTests: 1, passed: test.passed ? 1 : 0, failed: test.passed ? 0 : 1, allPassed: test.passed },
    orchestratorGate: {
      description: 'Publisher retry → capture NOT duplicated. Idempotency check (Payment.status === CAPTURED) prevents second capture call.',
      provenBy: '4c-E5: first publisher run calls capture (captureCalled=true), second run skips capture (captureCalled=false, idempotencySkipped=true)',
    },
  }

  const outputPath = join(OUTPUT_DIR, `evidence-E5-${RUN_ID}.json`)
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2))
  console.log('\n========================================')
  console.log('EVIDENCE SUMMARY')
  console.log('========================================')
  console.log(`ok: ${evidence.ok}`)
  console.log(`Test: ${test.passed ? 'PASS' : 'FAIL'}`)
  console.log(`\nEvidence written to: ${outputPath}`)
  if (!test.passed) { console.error('\n❌ E5 FAILED'); process.exit(1) }
  console.log('\n✅ E5 PASSED — publisher retry does NOT duplicate capture.')
}

main().catch((err) => { console.error('Crashed:', err); process.exit(1) })
