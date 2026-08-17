#!/usr/bin/env node
// ============================================================================
// SnakZap Wave-3 Sub-Wave 3b — Evidence Runner (Order POST Idempotency)
// ============================================================================
// Runs 5 empirical evidence tests against the local dev server (which must be
// running with EVIDENCE_TEST_MODE=true on http://localhost:3000).
//
// Tests:
//   1. Order POST rollback (deliberate mid-tx failure → all writes rolled back)
//   2. Idempotency replay integrity (same key + same request → exactly 1 Order)
//   3. Idempotency conflict (same key + different restaurant/items → cached response, no 2nd order)
//   4. Concurrent duplicate requests (5 parallel same key → exactly 1 Order/outbox/idempotency)
//   5. Phantom-block prevention (failed txn + retry with same key → succeeds)
//
// Output: self-validating JSON with ok:true + runId + per-test PASS/FAIL
// Written to: evidence/wave3-3b/evidence-<runId>.json
// ============================================================================

import { randomUUID } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE_URL = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `3b-ev-${Date.now()}-${randomUUID().slice(0, 8)}`
const OUTPUT_DIR = join(process.cwd(), 'evidence', 'wave3-3b')

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

// --- Evidence setup: create test user + session + get restaurant/menuItem info ---
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

// --- Evidence verify: check full state of all Order-creation writes ---
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

// --- POST /api/orders (create order) ---
async function createOrder(orderBody, idempotencyKey, failAfterStep = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    'Idempotency-Key': idempotencyKey,
  }
  if (failAfterStep) {
    headers['X-Evidence-Fail-After'] = failAfterStep
  }

  const response = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(orderBody),
  })

  const body = await response.json().catch(() => ({ error: 'non-json response' }))
  return { status: response.status, body }
}

// Helper: build a standard order body from setup data
function buildOrderBody(setup, menuItemId = null, itemName = null, itemPrice = null) {
  const miId = menuItemId ?? setup.menuItemId
  const miName = itemName ?? setup.menuItemName
  const miPrice = itemPrice ?? setup.menuItemPrice
  return {
    restaurantId: setup.restaurantId,
    items: [{
      menuItemId: miId,
      name: miName,
      price: miPrice,
      quantity: 1,
    }],
  }
}

// ============================================================================
// TEST 1: Order POST Transaction Rollback
// ============================================================================
// Deliberately fail mid-transaction (after idempotency-record, the last
// intermediate write before outbox) and verify ALL writes are rolled back:
//   Order + OrderItem + AuditLog + IdempotencyKey (Outbox not yet written)
// ============================================================================
async function test1_rollback() {
  const testId = 'test-1-rollback'
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('rollback')
  const { userId } = setup
  const idempotencyKey = `ev-3b-rollback-${randomUUID().slice(0, 12)}`

  const orderBody = buildOrderBody(setup)

  console.log(`[${testId}] Sending order POST with X-Evidence-Fail-After: idempotency-record`)
  const result = await createOrder(orderBody, idempotencyKey, 'idempotency-record')

  // We don't have an orderId yet (the order was rolled back). We need to find
  // what orderId WOULD have been — but since it was rolled back, no Order row exists.
  // Instead, verify by querying with a placeholder orderId + the idempotency key.
  // The verify endpoint will show order.exists=false + idempotencyRecordExists=false.

  console.log(`[${testId}] Order POST response status: ${result.status}`)
  console.log(`[${testId}] Verifying state (using idempotency key only)...`)

  // Use a dummy orderId — the verify endpoint will report order.exists=false
  // which is what we want for rollback verification
  const dummyOrderId = 'rolled-back-nonexistent'
  const state = await verifyState(dummyOrderId, idempotencyKey, userId)

  const isDeliberateFailure =
    result.status === 500 &&
    result.body?.error?.details?.evidenceFailureInjection === true &&
    result.body?.error?.details?.failedAfterStep === 'idempotency-record'

  // Verify ALL writes rolled back:
  // - No Order created (orderResourceCount should be 0 for 'Order' resourceType)
  // - No IdempotencyKey stored (phantom-block prevention)
  const orderResourceCount = state.orderResourceCount ?? 0
  const idempotencyRecordExists = state.idempotencyRecordExists
  const atomicRollback = state.atomicRollback === true

  const allRolledBack =
    orderResourceCount === 0 &&
    !idempotencyRecordExists &&
    atomicRollback

  const passed = isDeliberateFailure && allRolledBack

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Deliberate failure triggered: ${isDeliberateFailure}`)
  console.log(`[${testId}]   Order resource count (IdempotencyKey resourceType='Order'): ${orderResourceCount} (expected: 0)`)
  console.log(`[${testId}]   Idempotency record exists: ${idempotencyRecordExists} (expected: false)`)
  console.log(`[${testId}]   Atomic rollback (server-computed): ${atomicRollback}`)

  return {
    testId,
    testName: 'Order POST Transaction Rollback (deliberate mid-tx failure)',
    criterion: 'Order POST failure → no partial Order/AuditLog/IdempotencyKey/Outbox state (rollback + phantom-block prevention)',
    passed,
    setup: { idempotencyKey, failAfterStep: 'idempotency-record', userId },
    orderResponse: {
      status: result.status,
      errorDetails: result.body?.error?.details ?? null,
      errorMessage: result.body?.error?.message ?? null,
    },
    verification: {
      orderResourceCount,
      idempotencyRecordExists,
      atomicRollback,
    },
    expected: {
      orderResourceCount: 0,
      idempotencyRecordExists: false,
      atomicRollback: true,
    },
  }
}

// ============================================================================
// TEST 2: Idempotency Replay Integrity
// ============================================================================
// Same idempotency key + same request → exactly one Order created.
// The second request should return the cached response (same orderId).
// ============================================================================
async function test2_replay() {
  const testId = 'test-2-replay'
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('replay')
  const { userId } = setup
  const idempotencyKey = `ev-3b-replay-${randomUUID().slice(0, 12)}`

  const orderBody = buildOrderBody(setup)

  console.log(`[${testId}] Sending first order POST (key=${idempotencyKey})...`)
  const result1 = await createOrder(orderBody, idempotencyKey)
  const orderId1 = result1.body?.order?.id
  console.log(`[${testId}] First order: status=${result1.status}, orderId=${orderId1}`)

  console.log(`[${testId}] Sending replay order POST (same key, same request)...`)
  const result2 = await createOrder(orderBody, idempotencyKey)
  const orderId2 = result2.body?.order?.id
  console.log(`[${testId}] Replay order: status=${result2.status}, orderId=${orderId2}`)

  console.log(`[${testId}] Verifying state...`)
  const state = await verifyState(orderId1, idempotencyKey, userId)

  const sameOrderId = orderId1 === orderId2
  const bothSucceeded = result1.status === 200 && result2.status === 200
  const orderExists = state.order.exists
  const orderConfirmed = state.order.status === 'CONFIRMED'
  const auditLogExists = state.auditLogExists
  const outboxExists = state.outboxExists
  const idempotencyRecordExists = state.idempotencyRecordExists
  const exactlyOneOrder = state.exactlyOneOrder === true

  const passed =
    bothSucceeded &&
    sameOrderId &&
    orderExists &&
    orderConfirmed &&
    auditLogExists &&
    outboxExists &&
    idempotencyRecordExists &&
    exactlyOneOrder

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Both requests succeeded (200): ${bothSucceeded}`)
  console.log(`[${testId}]   Same orderId returned: ${sameOrderId}`)
  console.log(`[${testId}]   Order exists: ${orderExists}`)
  console.log(`[${testId}]   Order status CONFIRMED: ${orderConfirmed}`)
  console.log(`[${testId}]   AuditLog exists: ${auditLogExists}`)
  console.log(`[${testId}]   Outbox event exists: ${outboxExists}`)
  console.log(`[${testId}]   Idempotency record exists: ${idempotencyRecordExists}`)
  console.log(`[${testId}]   Server-computed exactlyOneOrder: ${exactlyOneOrder}`)

  return {
    testId,
    testName: 'Idempotency Replay Integrity (same key + same request → exactly 1 Order)',
    criterion: 'Same idempotency key → same Order row (dedup works)',
    passed,
    setup: { idempotencyKey, orderId: orderId1, userId },
    orderResponse1: { status: result1.status, orderId: orderId1 },
    orderResponse2: { status: result2.status, orderId: orderId2 },
    sameOrderId,
    verification: {
      orderExists,
      orderStatus: state.order.status,
      orderId: state.order.id,
      auditLogExists,
      outboxExists,
      idempotencyRecordExists,
      exactlyOneOrder,
    },
    expected: {
      sameOrderId: true,
      exactlyOneOrder: true,
    },
  }
}

// ============================================================================
// TEST 3: Idempotency Conflict (same key + materially different request)
// ============================================================================
// Request A: idempotencyKey=K, items=[m1, qty=1] → Order O1 created
// Request B: idempotencyKey=K, items=[m1, qty=2] (different quantity) → MUST NOT
//            create a second order. Should return cached response (O1).
// Orchestrator Decision D1: Option A — cached response semantics (no 422).
// ============================================================================
async function test3_conflict() {
  const testId = 'test-3-conflict'
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('conflict')
  const { userId, restaurantId, menuItemId, menuItemName, menuItemPrice } = setup
  const idempotencyKey = `ev-3b-conflict-${randomUUID().slice(0, 12)}`

  // Build TWO materially different request bodies using the SAME menu item
  // but different quantity (or different item if available).
  // Body A: qty=1
  // Body B: qty=3 (materially different — different total, different subtotal)
  const bodyA = {
    restaurantId,
    items: [{ menuItemId, name: menuItemName, price: menuItemPrice, quantity: 1 }],
  }
  const bodyB = {
    restaurantId,
    items: [{ menuItemId, name: menuItemName, price: menuItemPrice, quantity: 3 }],
  }

  const differentBodies = JSON.stringify(bodyA) !== JSON.stringify(bodyB)

  console.log(`[${testId}] Request A: key=${idempotencyKey}, qty=1`)
  const resultA = await createOrder(bodyA, idempotencyKey)
  const orderIdA = resultA.body?.order?.id
  console.log(`[${testId}] Request A result: status=${resultA.status}, orderId=${orderIdA}`)

  console.log(`[${testId}] Request B: same key=${idempotencyKey}, qty=3 (materially different)`)
  const resultB = await createOrder(bodyB, idempotencyKey)
  const orderIdB = resultB.body?.order?.id
  console.log(`[${testId}] Request B result: status=${resultB.status}, orderId=${orderIdB}`)

  console.log(`[${testId}] Verifying state of order A...`)
  const stateA = await verifyState(orderIdA, idempotencyKey, userId)

  console.log(`[${testId}] Verifying state of order B (should NOT exist)...`)
  const stateB = orderIdB ? await verifyState(orderIdB, null, userId) : { order: { exists: false } }

  const sameOrderId = orderIdA === orderIdB
  const cachedResponseReturned = resultB.status === 200 && sameOrderId
  const orderAExists = stateA.order.exists
  // Order B "exists" check: if orderIdB === orderIdA (cached response), then
  // verifying orderIdB will find orderA (which exists). This is CORRECT — the
  // cached response returned the SAME orderId, so there's still only 1 order.
  // The real check is: did a SECOND order get created? That's `exactlyOneOrder`.
  const orderBExists = orderIdB && orderIdB !== orderIdA ? stateB.order.exists : false
  const exactlyOneOrder = stateA.exactlyOneOrder === true

  // Option A (Orchestrator D1): cached response returned, no 2nd order
  const passed =
    differentBodies &&
    cachedResponseReturned &&
    orderAExists &&
    !orderBExists &&
    exactlyOneOrder

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Different request bodies: ${differentBodies}`)
  console.log(`[${testId}]   Cached response returned (200 + same orderId): ${cachedResponseReturned}`)
  console.log(`[${testId}]   Order A exists: ${orderAExists}`)
  console.log(`[${testId}]   Order B exists (expected false): ${orderBExists}`)
  console.log(`[${testId}]   Server-computed exactlyOneOrder: ${exactlyOneOrder}`)

  return {
    testId,
    testName: 'Idempotency Conflict (same key + materially different request → cached response, no 2nd order)',
    criterion: 'Same key + materially different request → existing cached-response semantics (Option A)',
    passed,
    setup: {
      idempotencyKey,
      restaurantId,
      menuItemId,
      differentBodies,
      bodyASummary: 'qty=1',
      bodyBSummary: 'qty=3 (materially different)',
    },
    orderResponseA: { status: resultA.status, orderId: orderIdA },
    orderResponseB: { status: resultB.status, orderId: orderIdB },
    sameOrderId,
    cachedResponseReturned,
    verificationA: {
      orderExists: orderAExists,
      orderStatus: stateA.order.status,
      exactlyOneOrder: stateA.exactlyOneOrder,
    },
    verificationB: {
      orderExists: orderBExists,
    },
    expected: {
      cachedResponseReturned: true,
      orderBExists: false,
      exactlyOneOrder: true,
    },
  }
}

// ============================================================================
// TEST 4: Concurrent Duplicate Requests
// ============================================================================
// Fire N=5 parallel POST /api/orders with the SAME idempotency key + same body.
// Verify exactly 1 Order is created, 1 outbox event, 1 idempotency record.
// ============================================================================
async function test4_concurrent() {
  const testId = 'test-4-concurrent'
  const CONCURRENCY = 5
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('concurrent')
  const { userId } = setup
  const idempotencyKey = `ev-3b-concurrent-${randomUUID().slice(0, 12)}`

  const orderBody = buildOrderBody(setup)

  console.log(`[${testId}] Firing ${CONCURRENCY} concurrent order POSTs with same key=${idempotencyKey}`)
  const promises = []
  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(createOrder(orderBody, idempotencyKey))
  }
  const results = await Promise.all(promises)

  console.log(`[${testId}] Concurrent results:`)
  for (let i = 0; i < results.length; i++) {
    console.log(`[${testId}]   Request ${i + 1}: status=${results[i].status}, orderId=${results[i].body?.order?.id ?? 'N/A'}, error=${results[i].body?.error?.code ?? 'none'}`)
  }

  const successCount = results.filter((r) => r.status === 200).length
  const errorCount = results.filter((r) => r.status !== 200).length
  const uniqueOrderIds = new Set(
    results
      .map((r) => r.body?.order?.id)
      .filter((id) => id !== undefined && id !== null)
  )
  const uniqueOrderIdsCount = uniqueOrderIds.size

  // Pick the winning orderId (should be only 1)
  const winningOrderId = [...uniqueOrderIds][0] ?? null

  console.log(`[${testId}] Verifying state (orderId=${winningOrderId})...`)
  const state = winningOrderId
    ? await verifyState(winningOrderId, idempotencyKey, userId)
    : { order: { exists: false }, exactlyOneOrder: false, auditLogExists: false, outboxExists: false, idempotencyRecordExists: false }

  const orderExists = state.order?.exists === true
  const orderConfirmed = state.order?.status === 'CONFIRMED'
  const auditLogExists = state.auditLogExists
  const outboxExists = state.outboxExists
  const idempotencyRecordExists = state.idempotencyRecordExists
  const exactlyOneOrder = state.exactlyOneOrder === true

  const passed =
    uniqueOrderIdsCount === 1 &&
    orderExists &&
    orderConfirmed &&
    auditLogExists &&
    outboxExists &&
    idempotencyRecordExists &&
    exactlyOneOrder

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Success responses: ${successCount}`)
  console.log(`[${testId}]   Error responses: ${errorCount}`)
  console.log(`[${testId}]   Unique orderIds in responses: ${uniqueOrderIdsCount} (expected: 1)`)
  console.log(`[${testId}]   Order exists: ${orderExists}`)
  console.log(`[${testId}]   Order status CONFIRMED: ${orderConfirmed}`)
  console.log(`[${testId}]   AuditLog exists: ${auditLogExists}`)
  console.log(`[${testId}]   Outbox event exists: ${outboxExists}`)
  console.log(`[${testId}]   Idempotency record exists: ${idempotencyRecordExists}`)
  console.log(`[${testId}]   Server-computed exactlyOneOrder: ${exactlyOneOrder}`)

  return {
    testId,
    testName: 'Concurrent Duplicate Requests (N parallel same key → exactly 1 Order)',
    criterion: 'Multiple simultaneous requests same key → exactly one Order, one outbox event, one idempotency record',
    passed,
    setup: { idempotencyKey, userId, concurrency: CONCURRENCY },
    concurrentResponses: results.map((r, i) => ({
      requestIndex: i + 1,
      status: r.status,
      orderId: r.body?.order?.id ?? null,
      errorCode: r.body?.error?.code ?? null,
    })),
    summary: {
      successCount,
      errorCount,
      uniqueOrderIdsCount,
      winningOrderId,
    },
    verification: {
      orderExists,
      orderStatus: state.order?.status ?? null,
      orderId: state.order?.id ?? null,
      auditLogExists,
      outboxExists,
      idempotencyRecordExists,
      exactlyOneOrder,
    },
    expected: {
      uniqueOrderIdsCount: 1,
      exactlyOneOrder: true,
    },
  }
}

// ============================================================================
// TEST 5: Phantom-Block Prevention (failed txn + retry with same key)
// ============================================================================
// 1. POST /api/orders with key=K + body requesting an item that will fail
//    (use X-Evidence-Fail-After: order-create to fail mid-txn)
// 2. Verify: 0 Orders, 0 IdempotencyKey rows (txn rolled back)
// 3. Client retries with SAME key K + valid body → 200, order created
// 4. Verify: 1 Order, 1 IdempotencyKey (the key was NOT phantom-blocked)
// ============================================================================
async function test5_phantom_block() {
  const testId = 'test-5-phantom-block'
  console.log(`\n[${testId}] Setting up scenario...`)
  const setup = await setupScenario('phantom-block')
  const { userId } = setup
  const idempotencyKey = `ev-3b-phantom-${randomUUID().slice(0, 12)}`

  const orderBody = buildOrderBody(setup)

  console.log(`[${testId}] Step 1: POST order with key=K + X-Evidence-Fail-After: order-create (will fail mid-txn)`)
  const result1 = await createOrder(orderBody, idempotencyKey, 'order-create')
  console.log(`[${testId}]   First POST: status=${result1.status} (expected: 500 — deliberate failure)`)
  console.log(`[${testId}]   Error details: ${JSON.stringify(result1.body?.error?.details ?? {})}`)

  console.log(`[${testId}] Step 2: Verify phantom-block prevention — no Order, no IdempotencyKey stored`)
  // Use a dummy orderId (the order was rolled back, so no real ID)
  const dummyOrderId = 'phantom-failed-nonexistent'
  const state1 = await verifyState(dummyOrderId, idempotencyKey, userId)
  // The KEY check: the IdempotencyKey record for THIS key must NOT exist
  // (the txn rolled back, so the key was NOT stored → retry is safe).
  // Note: orderResourceCount counts ALL IdempotencyKey rows with resourceType='Order'
  // (from previous tests), so it's not the right check for phantom-block.
  // The right check is: idempotencyRecordExists for THIS specific key.
  const idempotencyRecordExists1 = state1.idempotencyRecordExists
  const atomicRollback1 = state1.atomicRollback === true

  console.log(`[${testId}]   Idempotency record exists for key=${idempotencyKey}: ${idempotencyRecordExists1} (expected: false)`)
  console.log(`[${testId}]   Atomic rollback: ${atomicRollback1}`)

  console.log(`[${testId}] Step 3: Retry with SAME key=K + valid body (should succeed — key was NOT phantom-blocked)`)
  const result2 = await createOrder(orderBody, idempotencyKey)
  const orderId2 = result2.body?.order?.id
  console.log(`[${testId}]   Retry POST: status=${result2.status}, orderId=${orderId2} (expected: 200)`)

  console.log(`[${testId}] Step 4: Verify retry succeeded — 1 Order, 1 IdempotencyKey`)
  const state2 = await verifyState(orderId2, idempotencyKey, userId)
  const orderExists2 = state2.order.exists
  const orderConfirmed2 = state2.order.status === 'CONFIRMED'
  const idempotencyRecordExists2 = state2.idempotencyRecordExists
  const exactlyOneOrder2 = state2.exactlyOneOrder === true

  console.log(`[${testId}]   Order exists: ${orderExists2} (expected: true)`)
  console.log(`[${testId}]   Order status CONFIRMED: ${orderConfirmed2} (expected: true)`)
  console.log(`[${testId}]   Idempotency record exists: ${idempotencyRecordExists2} (expected: true)`)
  console.log(`[${testId}]   Server-computed exactlyOneOrder: ${exactlyOneOrder2} (expected: true)`)

  const isDeliberateFailure =
    result1.status === 500 &&
    result1.body?.error?.details?.evidenceFailureInjection === true

  const phantomBlockPrevented = !idempotencyRecordExists1 && atomicRollback1
  const retrySucceeded = result2.status === 200 && orderExists2 && orderConfirmed2 && idempotencyRecordExists2

  const passed =
    isDeliberateFailure &&
    phantomBlockPrevented &&
    retrySucceeded &&
    exactlyOneOrder2

  console.log(`[${testId}] Result: ${passed ? 'PASS' : 'FAIL'}`)
  console.log(`[${testId}]   Deliberate failure triggered: ${isDeliberateFailure}`)
  console.log(`[${testId}]   Phantom-block prevented (0 IdempotencyKey after failed txn): ${phantomBlockPrevented}`)
  console.log(`[${testId}]   Retry succeeded (200 + Order created + key stored): ${retrySucceeded}`)
  console.log(`[${testId}]   Exactly 1 Order after retry: ${exactlyOneOrder2}`)

  return {
    testId,
    testName: 'Phantom-Block Prevention (failed txn + retry with same key → succeeds)',
    criterion: 'Failed order POST does NOT store IdempotencyKey; retry with same key creates a new order successfully',
    passed,
    setup: { idempotencyKey, userId, failAfterStep: 'order-create' },
    firstPostResponse: {
      status: result1.status,
      errorDetails: result1.body?.error?.details ?? null,
    },
    phantomBlockVerification: {
      idempotencyRecordExists: idempotencyRecordExists1,
      atomicRollback: atomicRollback1,
    },
    retryPostResponse: {
      status: result2.status,
      orderId: orderId2,
    },
    retryVerification: {
      orderExists: orderExists2,
      orderStatus: state2.order.status,
      idempotencyRecordExists: idempotencyRecordExists2,
      exactlyOneOrder: exactlyOneOrder2,
    },
    expected: {
      phantomBlockPrevented: true,
      retrySucceeded: true,
      exactlyOneOrder: true,
    },
  }
}

// ============================================================================
// Main: run all 5 tests + generate self-validating evidence JSON
// ============================================================================
async function main() {
  console.log('========================================')
  console.log('SnakZap Wave-3 Sub-Wave 3b — Evidence Runner')
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
  let setupCheck = null
  for (let attempt = 1; attempt <= 8; attempt++) {
    setupCheck = await fetch(`${BASE_URL}/api/orders/evidence-setup?scenario=pre-flight`)
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

  // Run all 5 tests
  const test1 = await test1_rollback()
  const test2 = await test2_replay()
  const test3 = await test3_conflict()
  const test4 = await test4_concurrent()
  const test5 = await test5_phantom_block()

  const tests = [test1, test2, test3, test4, test5]
  const allPassed = tests.every((t) => t.passed)

  // Generate self-validating evidence JSON
  const evidence = {
    ok: allPassed,
    runId: RUN_ID,
    wave: '3',
    subWave: '3b',
    evidenceType: 'order-post-idempotency',
    generatedAt: new Date().toISOString(),
    environment: {
      baseUrl: BASE_URL,
      evidenceTestMode: true,
      realPaymentsFlag: false,
      database: 'sqlite (local dev — staging/production use PostgreSQL)',
      note: 'Transaction rollback + unique-constraint semantics are identical on SQLite and PostgreSQL. Concurrency test on SQLite uses database-level locking; the same invariant (exactly 1 Order) holds on PostgreSQL via row-level locks + unique constraints. PostgreSQL-native concurrency proof is captured by 3b-PG-E1 in a separate workflow.',
    },
    orchestratorCriteria: {
      '1-rollback': 'Order POST failure → no partial Order/AuditLog/IdempotencyKey/Outbox state (rollback + phantom-block prevention)',
      '2-replay': 'Same idempotency key → same Order row (dedup works)',
      '3-conflict': 'Same key + materially different request → existing cached-response semantics (Option A)',
      '4-concurrent': '5 parallel same key → exactly 1 Order/outbox/idempotency',
      '5-phantom-block': 'Failed txn does NOT store IdempotencyKey; retry with same key succeeds',
    },
    tests,
    summary: {
      totalTests: tests.length,
      passed: tests.filter((t) => t.passed).length,
      failed: tests.filter((t) => !t.passed).length,
      allPassed,
    },
    atomicBoundaryProof: {
      description: 'Order POST writes 6 entities in a single transaction. A deliberate mid-transaction failure rolls back ALL writes including the IdempotencyKey (phantom-block prevention).',
      writes: [
        'MenuItem availableCount decrement (if availableCount set)',
        'Order (CONFIRMED status)',
        'OrderItem (1+ rows)',
        'AuditLog (ORDER_CREATED)',
        'IdempotencyKey (cached response)',
        'Outbox (ORDER_CREATED event)',
      ],
      failurePath: 'mid-tx failure → ROLLBACK → no partial order/auditlog/idempotency/orphan outbox',
      provenBy: 'test-1-rollback (deliberate failure after idempotency-record → 0 IdempotencyKey, 0 Order)',
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

  console.log('\n✅ All 5 evidence tests PASSED. PostgreSQL concurrent test (3b-PG-E1) to be run via workflow.')
}

main().catch((err) => {
  console.error('Evidence runner crashed:', err)
  process.exit(1)
})
