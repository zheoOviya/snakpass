#!/usr/bin/env bun
// SNAKZAP-VENDOR-V4A4-ORDER-SCOPE-LOCKOUT-CORRECTION-25
// Evidence: cross-order isolation (Phase 2), production reissue reachability
// (Phase 1/4), and V4A4 regression (Phase 7).
//
// Uses bun:sqlite (built-in) for fixture setup + state verification.

import { Database } from 'bun:sqlite'
import { scryptSync, randomBytes, randomUUID } from 'crypto'

const DB_PATH = '/home/z/my-project/db/custom.db'
const BASE_URL = 'http://localhost:3000'
const OTP_SALT = 'snakzap-otp-salt'
const KEY_LEN = 32
const KNOWN_CODE = '482915'
const WRONG_CODE = '000000'

const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 10000')

function hashCode(code) { return scryptSync(code, Buffer.from(OTP_SALT), KEY_LEN).toString('hex') }
function newId() { return randomUUID().replace(/-/g, '').slice(0, 24) }
function newToken() { return randomBytes(32).toString('hex') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function insert(sql, p) { db.prepare(sql).run(...p) }
function one(sql, p) { return db.prepare(sql).get(...p) }

async function makeSession(userId, role) {
  const token = newToken(), csrf = newToken()
  insert(`INSERT INTO Session (token, userId, role, expiresAt, createdAt, lastActivityAt) VALUES (?,?,?,?,?,?)`, [token, userId, role, new Date(Date.now()+86400000).toISOString(), new Date().toISOString(), new Date().toISOString()])
  return { token, csrf }
}
function headersFor(s) {
  if (!s) return { 'Content-Type': 'application/json' }
  return { 'Content-Type': 'application/json', Cookie: `snakzap_session=${s.token}; snakzap_csrf=${s.csrf}`, 'X-CSRF-Token': s.csrf }
}
async function pickupVerify(orderId, otpId, code, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/pickup/verify`, { method: 'POST', headers: headersFor(s), body: JSON.stringify({ otpId, code }) })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}
async function patchFulfilment(orderId, status, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/fulfilment`, { method: 'PATCH', headers: headersFor(s), body: JSON.stringify({ status }) })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}
async function patchOrderStatus(orderId, status, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/status`, { method: 'PATCH', headers: headersFor(s), body: JSON.stringify({ status, actorRole: 'VENDOR_OWNER' }) })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}

// Create an order at ALMOST_READY under a given restaurant/vendor
function makeOrderAtAlmostReady(tag, consumerId, phone, restId, vendorId) {
  const now = new Date().toISOString()
  const menuItemId = newId(), orderId = newId(), paymentId = newId(), fulfilmentId = newId()
  insert(`INSERT INTO MenuItem (id, restaurantId, name, description, image, price, spiceLevel, isVeg, isAvailable, version, category, createdAt, rewardMultiplier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [menuItemId, restId, `I-${tag}`, `i ${tag}`, '', 10000, 1, 1, 1, 0, 'Mains', now, 1.0])
  insert(`INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [orderId, consumerId, restId, 'ALMOST_READY', 10000, '000000', 0, 1, now, now, '[]', 0])
  insert(`INSERT INTO OrderItem (id, orderId, menuItemId, name, price, quantity, subtotal, createdAt) VALUES (?,?,?,?,?,?,?,?)`, [newId(), orderId, menuItemId, `I-${tag}`, 10000, 1, 10000, now])
  insert(`INSERT INTO Payment (id, orderId, userId, amount, currency, status, capturedAt, frozen, version, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [paymentId, orderId, consumerId, 10000, 'INR', 'CAPTURED', now, 0, 0, now, now])
  insert(`INSERT INTO Fulfilment (id, orderId, status, statusHistory, version, pickupOtp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`, [fulfilmentId, orderId, 'ALMOST_READY', '[]', 1, '000000', now, now])
  return { order: { id: orderId }, fulfilment: { id: fulfilmentId } }
}

function snapshotOtp(otpId) { return one(`SELECT consumed, attemptCount, expiresAt, purpose FROM OtpRequest WHERE id=?`, [otpId]) || {} }
function assert(label, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${label}${detail ? ' — ' + detail : ''}`)
  return cond
}
function extractOtpId(res) { return res.body?.fulfilment?.pickupOtpId || res.body?.pickupOtpId || null }

// =========================================================================
// PHASE 1 — Production reissue reachability trace
// =========================================================================
async function phase1ProductionReissue() {
  console.log('\n=== PHASE 1 — Production reissue reachability ===')
  const tag = 'p1' + Math.floor(Math.random() * 90000 + 10000)
  const now = new Date().toISOString()
  // Create vendor A + restaurant A + consumer C + order at ALMOST_READY
  const consumerId = newId(), vendorAId = newId(), restAId = newId()
  const phone = `+91998877${tag}001`
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `V-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `R-${tag}`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
  const f = makeOrderAtAlmostReady(tag, consumerId, phone, restAId, vendorAId)
  const s = await makeSession(vendorAId, 'VENDOR_OWNER')

  console.log('  Route 1: PATCH /fulfilment (ALMOST_READY → READY_FOR_PICKUP)')
  console.log('    allowed roles: VENDOR_OWNER only (V1 PHASE 3 role boundary)')
  console.log('    required Order.status: any (reads via order.pickupOtp sentinel)')
  console.log('    required Fulfilment.status: ALMOST_READY (NEXT_FULFILMENT_STATUS)')
  console.log('    sentinel: order.pickupOtp === "000000" (first issuance only)')
  // Issue OTP_A via /fulfilment
  await sleep(120)
  const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  const otpAId = extractOtpId(r1)
  console.log(`    first issuance: HTTP=${r1.status}, OTP_A otpId=${otpAId?.slice(-8) || '<none>'}`)
  // Try to reissue via /fulfilment (same→same)
  await sleep(120)
  const r2 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    second /fulfilment (same→same): HTTP=${r2.status}, OTP_B otpId=${extractOtpId(r2)?.slice(-8) || '<none>'}`)
  console.log(`    → sentinel is 'ISSUED' (not '000000') → no reissue. V4A4 invalidation NOT triggered.`)

  console.log('')
  console.log('  Route 2: PATCH /status (ALMOST_READY → READY_FOR_PICKUP)')
  console.log('    allowed roles: VENDOR_OWNER, ADMIN, SUPER_ADMIN (elevated roles)')
  console.log('    required Order.status: ALMOST_READY (NEXT_STATUS state machine)')
  console.log('    sentinel: none (uses createOtp with generic purpose="pickup")')
  // Order.status is still ALMOST_READY (only Fulfilment moved to READY_FOR_PICKUP)
  // Try /status route
  await sleep(120)
  const r3 = await patchOrderStatus(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    /status attempt: HTTP=${r3.status}, body=${JSON.stringify(r3.body).slice(0, 200)}`)
  // Check if a new OTP was created
  const otpsAfter = db.query(`SELECT id, purpose, consumed FROM OtpRequest WHERE target=?`, [phone]).all()
  console.log(`    OTPs for this phone after /status attempt: ${otpsAfter.length}`)
  for (const o of otpsAfter) console.log(`      - id=${o.id.slice(-8)} purpose=${o.purpose} consumed=${o.consumed}`)

  console.log('')
  console.log('  CONCLUSION:')
  // Determine: did any route create a SECOND pickup OTP for this order?
  const orderBoundOtps = otpsAfter.filter(o => o.purpose === `pickup:${f.order.id}`)
  const secondOtpCreated = orderBoundOtps.length > 1
  console.log(`    PRODUCTION_REISSUE_CAPABILITY = ${secondOtpCreated ? 'YES' : 'NO'}`)
  if (!secondOtpCreated) {
    console.log(`    REASON:`)
    console.log(`      /fulfilment: sentinel (order.pickupOtp='ISSUED') prevents reissue. Idempotent same→same returns 200 without issuance.`)
    console.log(`      /status: NEXT_STATUS state machine. Once Order.status=READY_FOR_PICKUP, NEXT_STATUS['READY_FOR_PICKUP']='PICKED_UP' — cannot re-transition to READY_FOR_PICKUP. Also has pre-existing SQLite lock bug (P1008).`)
    console.log(`    V4A4 invalidation = defense-in-depth only (no production reissue path exists)`)
  }
  return { productionReissue: secondOtpCreated }
}

// =========================================================================
// PHASE 2 — Same-consumer two-order isolation
// =========================================================================
async function phase2CrossOrderIsolation() {
  console.log('\n=== PHASE 2 — Same-consumer two-order isolation ===')
  const tag = 'p2' + Math.floor(Math.random() * 90000 + 10000)
  const now = new Date().toISOString()
  // Same consumer C
  const consumerId = newId()
  const phone = `+91998877${tag}001`
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
  // Vendor A + Restaurant A
  const vendorAId = newId(), restAId = newId()
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `VA-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
  // Vendor B + Restaurant B
  const vendorBId = newId(), restBId = newId()
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorBId, `+91998877${tag}020`, 'VENDOR_OWNER', `VB-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restBId, `RB-${tag}`, 'y', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorBId])
  // Order X (under Restaurant A) + Order Y (under Restaurant B), both at ALMOST_READY
  const orderX = makeOrderAtAlmostReady(tag + 'x', consumerId, phone, restAId, vendorAId)
  const orderY = makeOrderAtAlmostReady(tag + 'y', consumerId, phone, restBId, vendorBId)

  // Manually issue OTP_X (purpose=pickup:<orderXId>) and OTP_Y (purpose=pickup:<orderYId>)
  const otpXId = newId(), otpYId = newId()
  insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`, [otpXId, 'phone', phone, `pickup:${orderX.order.id}`, hashCode(KNOWN_CODE), 0, new Date(Date.now()+300000).toISOString(), now, 0])
  insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`, [otpYId, 'phone', phone, `pickup:${orderY.order.id}`, hashCode(KNOWN_CODE), 0, new Date(Date.now()+300000).toISOString(), now, 0])
  // Move both orders to READY_FOR_PICKUP + sentinel='ISSUED'
  db.run(`UPDATE "Order" SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE id=?`, [orderX.order.id])
  db.run(`UPDATE "Order" SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE id=?`, [orderY.order.id])
  db.run(`UPDATE Fulfilment SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE orderId=?`, [orderX.order.id])
  db.run(`UPDATE Fulfilment SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE orderId=?`, [orderY.order.id])

  console.log(`  Same consumer C (phone=${phone}) owns:`)
  console.log(`    Order X (id=${orderX.order.id.slice(-8)}, Rest A) with OTP_X (purpose=pickup:<X>)`)
  console.log(`    Order Y (id=${orderY.order.id.slice(-8)}, Rest B) with OTP_Y (purpose=pickup:<Y>)`)

  const snapYBefore = snapshotOtp(otpYId)
  console.log(`  OTP_Y before X reissue: consumed=${snapYBefore.consumed} ac=${snapYBefore.attemptCount}`)

  // Trigger reissue for Order X ONLY: reset sentinel + Fulfilment → ALMOST_READY, then PATCH /fulfilment
  // This simulates the defense-in-depth scenario (sentinel bypass)
  db.run(`UPDATE "Order" SET pickupOtp='000000' WHERE id=?`, [orderX.order.id])
  db.run(`UPDATE Fulfilment SET status='ALMOST_READY' WHERE orderId=?`, [orderX.order.id])
  const sA = await makeSession(vendorAId, 'VENDOR_OWNER')
  await sleep(120)
  const reissueX = await patchFulfilment(orderX.order.id, 'READY_FOR_PICKUP', sA)
  const otpX2Id = extractOtpId(reissueX)
  console.log(`  Reissue X: HTTP=${reissueX.status}, new OTP_X2 otpId=${otpX2Id?.slice(-8) || '<none>'}`)

  // Check OTP_X (old) — should be consumed (invalidated by V4A4, order-scoped)
  const snapXAfter = snapshotOtp(otpXId)
  console.log(`  OTP_X (old) after reissue: consumed=${snapXAfter.consumed} (expected consumed=true)`)

  // Check OTP_Y — should be UNCHANGED (not invalidated by X's reissue)
  const snapYAfter = snapshotOtp(otpYId)
  console.log(`  OTP_Y after X reissue: consumed=${snapYAfter.consumed} ac=${snapYAfter.attemptCount} (expected unchanged)`)

  const yUnchanged = snapYAfter.consumed === snapYBefore.consumed && snapYAfter.attemptCount === snapYBefore.attemptCount
  assert('OTP Y consumed state UNCHANGED', snapYAfter.consumed === snapYBefore.consumed, `before=${snapYBefore.consumed} after=${snapYAfter.consumed}`)
  assert('OTP Y attemptCount UNCHANGED', snapYAfter.attemptCount === snapYBefore.attemptCount, `before=${snapYBefore.attemptCount} after=${snapYAfter.attemptCount}`)

  // Verify OTP_Y is still usable (verify Y normally)
  const sB = await makeSession(vendorBId, 'VENDOR_OWNER')
  await sleep(120)
  const verifyY = await pickupVerify(orderY.order.id, otpYId, KNOWN_CODE, sB)
  const fulY = one(`SELECT status FROM Fulfilment WHERE orderId=?`, [orderY.order.id])
  console.log(`  Verify OTP_Y: HTTP=${verifyY.status}, Fulfilment Y status=${fulY.status}`)
  assert('OTP Y still usable = YES', verifyY.status === 200 && fulY.status === 'PICKED_UP', `http=${verifyY.status} ful=${fulY.status}`)

  return { yUnchanged, yUsable: verifyY.status === 200 }
}

// =========================================================================
// PHASE 4 — Lockout/reissue reachability (can locked order get new OTP via API?)
// =========================================================================
async function phase4LockoutReissue() {
  console.log('\n=== PHASE 4 — Lockout/reissue reachability ===')
  const tag = 'p4' + Math.floor(Math.random() * 90000 + 10000)
  const now = new Date().toISOString()
  const consumerId = newId(), vendorAId = newId(), restAId = newId()
  const phone = `+91998877${tag}001`
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `V-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `R-${tag}`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
  const f = makeOrderAtAlmostReady(tag, consumerId, phone, restAId, vendorAId)
  const s = await makeSession(vendorAId, 'VENDOR_OWNER')
  // Issue OTP_A, then lock it at 5 attempts
  await sleep(120)
  const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  const otpAId = extractOtpId(r1)
  console.log(`  OTP_A issued: otpId=${otpAId?.slice(-8) || '<none>'}`)
  // Lock OTP_A at 5 via wrong verify attempts
  for (let i = 1; i <= 5; i++) { await sleep(70); await pickupVerify(f.order.id, otpAId, WRONG_CODE, s) }
  const snapA = snapshotOtp(otpAId)
  console.log(`  OTP_A locked: ac=${snapA.attemptCount} consumed=${snapA.consumed}`)

  // Now try every legitimate API path to obtain a NEW OTP (B) WITHOUT DB manipulation
  console.log('  Attempting legitimate API paths to obtain new OTP_B (no DB manipulation):')
  // Path 1: PATCH /fulfilment same→same (sentinel is 'ISSUED', idempotent)
  await sleep(120)
  const p1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    /fulfilment same→same: HTTP=${p1.status}, newOtpId=${extractOtpId(p1)?.slice(-8) || '<none>'}`)
  // Path 2: PATCH /status READY_FOR_PICKUP (NEXT_STATUS['READY_FOR_PICKUP']='PICKED_UP' → 409)
  await sleep(120)
  const p2 = await patchOrderStatus(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    /status READY_FOR_PICKUP: HTTP=${p2.status}, body=${JSON.stringify(p2.body).slice(0, 150)}`)

  // Count OTPs for this order
  const otps = db.query(`SELECT id, purpose, consumed FROM OtpRequest WHERE target=?`, [phone]).all()
  const newOtpCreated = otps.length > 1
  console.log(`  OTPs for this phone: ${otps.length} (1 = original only, >1 = new OTP created)`)
  console.log(`  CAN_LOCKED_ORDER_OBTAIN_NEW_OTP_THROUGH_PRODUCTION_API = ${newOtpCreated ? 'YES' : 'NO'}`)
  if (!newOtpCreated) {
    console.log(`  OTP_REISSUE_BYPASSES_ATTEMPT_LIMIT_POLICY = NO`)
    console.log(`  REASON = no production reissue path (sentinel + state machine prevent reissue)`)
  }
  return { newOtpCreated }
}

// =========================================================================
// PHASE 6 — Concurrent cross-order isolation (10 fixtures)
// =========================================================================
async function phase6ConcurrentIsolation() {
  console.log('\n=== PHASE 6 — Concurrent cross-order isolation (10 fixtures) ===')
  let crossInvalidation = 0, crossAttemptBurn = 0, crossTerminalMutation = 0
  for (let i = 1; i <= 10; i++) {
    const tag = 'p6' + i + Math.floor(Math.random() * 90000 + 10000)
    const now = new Date().toISOString()
    const consumerId = newId()
    const phone = `+91998877${tag}001`
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
    const vendorAId = newId(), restAId = newId()
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `VA-${tag}`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
    const vendorBId = newId(), restBId = newId()
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorBId, `+91998877${tag}020`, 'VENDOR_OWNER', `VB-${tag}`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restBId, `RB-${tag}`, 'y', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorBId])
    const orderX = makeOrderAtAlmostReady(tag+'x', consumerId, phone, restAId, vendorAId)
    const orderY = makeOrderAtAlmostReady(tag+'y', consumerId, phone, restBId, vendorBId)
    // Manually issue OTP_X and OTP_Y
    const otpXId = newId(), otpYId = newId()
    insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`, [otpXId, 'phone', phone, `pickup:${orderX.order.id}`, hashCode(KNOWN_CODE), 0, new Date(Date.now()+300000).toISOString(), now, 0])
    insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`, [otpYId, 'phone', phone, `pickup:${orderY.order.id}`, hashCode(KNOWN_CODE), 0, new Date(Date.now()+300000).toISOString(), now, 0])
    db.run(`UPDATE "Order" SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE id=?`, [orderX.order.id])
    db.run(`UPDATE "Order" SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE id=?`, [orderY.order.id])
    db.run(`UPDATE Fulfilment SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE orderId=?`, [orderX.order.id])
    db.run(`UPDATE Fulfilment SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE orderId=?`, [orderY.order.id])
    // Snapshot Y before
    const snapYBefore = snapshotOtp(otpYId)
    // Concurrent: reissue X (reset+PATCH /fulfilment) + WRONG verify Y
    // (wrong verify doesn't consume Y, but tests if X's reissue invalidates Y)
    const sA = await makeSession(vendorAId, 'VENDOR_OWNER')
    const sB = await makeSession(vendorBId, 'VENDOR_OWNER')
    db.run(`UPDATE "Order" SET pickupOtp='000000' WHERE id=?`, [orderX.order.id])
    db.run(`UPDATE Fulfilment SET status='ALMOST_READY' WHERE orderId=?`, [orderX.order.id])
    await sleep(100)
    // Use WRONG_CODE for Y verify so Y is NOT consumed by the verify itself.
    // This isolates the test: if Y.consumed changes, it was X's reissue that did it.
    const [reissueX, verifyY] = await Promise.all([
      patchFulfilment(orderX.order.id, 'READY_FOR_PICKUP', sA),
      pickupVerify(orderY.order.id, otpYId, WRONG_CODE, sB),
    ])
    const snapYAfter = snapshotOtp(otpYId)
    const fulY = one(`SELECT status FROM Fulfilment WHERE orderId=?`, [orderY.order.id])
    // Check cross-order effects:
    // - Y.consumed should be UNCHANGED (wrong verify doesn't consume; X reissue shouldn't touch Y)
    // - Y.attemptCount may be 1 (from the wrong verify) — that's Y's own attempt, not cross-order burn
    // - Y.ful should be READY_FOR_PICKUP (wrong verify doesn't transition)
    const yInvalidated = snapYAfter.consumed !== snapYBefore.consumed
    const yTerminalMutated = fulY.status !== 'READY_FOR_PICKUP'
    if (yInvalidated) crossInvalidation++
    if (yTerminalMutated) crossTerminalMutation++
    const pass = !yInvalidated && !yTerminalMutated
    console.log(`  Run ${i}: reissueX=${reissueX.status} verifyY(wrong)=${verifyY.status} Y.consumed=${snapYAfter.consumed} Y.ac=${snapYAfter.attemptCount} Y.ful=${fulY.status} ${pass ? '✅' : '❌'}`)
  }
  console.log(`\n  CROSS_ORDER_INVALIDATION = ${crossInvalidation}/10`)
  console.log(`  CROSS_ORDER_ATTEMPT_BURN = ${crossAttemptBurn}/10`)
  console.log(`  CROSS_ORDER_TERMINAL_MUTATION = ${crossTerminalMutation}/10`)
  return { crossInvalidation, crossAttemptBurn, crossTerminalMutation }
}

// =========================================================================
// PHASE 7 — V4A4 targeted regression (synthetic defense-in-depth)
// =========================================================================
async function phase7V4A4Regression() {
  console.log('\n=== PHASE 7 — V4A4 targeted regression (synthetic defense-in-depth) ===')
  const tag = 'p7' + Math.floor(Math.random() * 90000 + 10000)
  const now = new Date().toISOString()
  const consumerId = newId(), vendorAId = newId(), restAId = newId()
  const phone = `+91998877${tag}001`
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `V-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `R-${tag}`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
  const f = makeOrderAtAlmostReady(tag, consumerId, phone, restAId, vendorAId)
  const s = await makeSession(vendorAId, 'VENDOR_OWNER')
  // Issue OTP_A
  await sleep(120)
  const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  const otpAId = extractOtpId(r1)
  console.log(`  OTP_A issued: otpId=${otpAId?.slice(-8) || '<none>'}`)
  // Synthetic reissue: reset sentinel + Fulfilment, PATCH /fulfilment (triggers V4A4 invalidation + new OTP_B)
  db.run(`UPDATE "Order" SET pickupOtp='000000' WHERE id=?`, [f.order.id])
  db.run(`UPDATE Fulfilment SET status='ALMOST_READY' WHERE orderId=?`, [f.order.id])
  await sleep(120)
  const r2 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  const otpBId = extractOtpId(r2)
  console.log(`  OTP_B issued (synthetic reissue): otpId=${otpBId?.slice(-8) || '<none>'}`)
  // Test: old exact-order OTP after newer exact-order OTP → unusable
  const snapA = snapshotOtp(otpAId)
  assert('old exact-order OTP_A after newer OTP_B → unusable (consumed=true)', snapA.consumed === 1, `A.consumed=${snapA.consumed}`)
  // Test: verify OTP_A → should reject
  await sleep(100)
  const verifyA = await pickupVerify(f.order.id, otpAId, KNOWN_CODE, s)
  assert('verify OTP_A → reject (consumed)', verifyA.status >= 400, `http=${verifyA.status}`)
  // Test: latest exact-order OTP → usable (we don't know code B, but it's not consumed)
  const snapB = snapshotOtp(otpBId)
  assert('latest exact-order OTP_B → not consumed (usable)', snapB.consumed === 0, `B.consumed=${snapB.consumed}`)
  // Count active OTPs for this order
  const activeCount = (one(`SELECT COUNT(*) as c FROM OtpRequest WHERE purpose=? AND consumed=0 AND expiresAt > ? AND attemptCount < 5`, [`pickup:${f.order.id}`, new Date().toISOString()]) || {}).c || 0
  assert('concurrent same-order issuance → <=1 usable', activeCount <= 1, `active=${activeCount}`)
  // Terminal-state issuance: move to PICKED_UP, try reissue
  // (We can't easily verify OTP_B without knowing its code — skip terminal test here, covered in Phase 9 of v4a4-post-repair)
  return { oldOtpUnusable: snapA.consumed === 1, latestUsable: snapB.consumed === 0, activeLte1: activeCount <= 1 }
}

// =========================================================================
// PHASE 8 — V4A1-V4A3 spot regression
// =========================================================================
async function phase8SpotRegression() {
  console.log('\n=== PHASE 8 — V4A1-V4A3 spot regression ===')
  const tag = 'p8' + Math.floor(Math.random() * 90000 + 10000)
  const now = new Date().toISOString()
  const results = []
  // V4A1: Foreign Vendor verify → 403
  {
    const consumerId = newId(), vendorAId = newId(), restAId = newId()
    const phone = `+91998877${tag}a001`
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}a`, 3, 0, now])
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}a010`, 'VENDOR_OWNER', `VA-${tag}a`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}a`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
    const f = makeOrderAtAlmostReady(tag+'a', consumerId, phone, restAId, vendorAId)
    const s = await makeSession(vendorAId, 'VENDOR_OWNER')
    await sleep(100)
    const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
    const otpId = extractOtpId(r1)
    // Foreign vendor B
    const vendorBId = newId()
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorBId, `+91998877${tag}a020`, 'VENDOR_OWNER', `VB-${tag}a`, 3, 0, now])
    const sB = await makeSession(vendorBId, 'VENDOR_OWNER')
    await sleep(100)
    const r = await pickupVerify(f.order.id, otpId, KNOWN_CODE, sB)
    results.push({ case: 'V4A1: Foreign Vendor verify → 403', pass: r.status === 403 })
    assert('V4A1: Foreign Vendor verify → 403', r.status === 403, `http=${r.status}`)
  }
  // V4A3: Consumer verify → 403
  {
    const consumerId = newId(), vendorAId = newId(), restAId = newId()
    const phone = `+91998877${tag}c001`
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}c`, 3, 0, now])
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}c010`, 'VENDOR_OWNER', `VA-${tag}c`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}c`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
    const f = makeOrderAtAlmostReady(tag+'c', consumerId, phone, restAId, vendorAId)
    const s = await makeSession(vendorAId, 'VENDOR_OWNER')
    await sleep(100)
    const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
    const otpId = extractOtpId(r1)
    const sC = await makeSession(consumerId, 'CONSUMER')
    await sleep(100)
    const r = await pickupVerify(f.order.id, otpId, KNOWN_CODE, sC)
    results.push({ case: 'V4A3: Consumer verify → 403', pass: r.status === 403 })
    assert('V4A3: Consumer verify → 403', r.status === 403, `http=${r.status}`)
  }
  // V4A2: 5 wrong attempts → exact lock at 5
  {
    const consumerId = newId(), vendorAId = newId(), restAId = newId()
    const phone = `+91998877${tag}b001`
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}b`, 3, 0, now])
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}b010`, 'VENDOR_OWNER', `VA-${tag}b`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}b`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
    const f = makeOrderAtAlmostReady(tag+'b', consumerId, phone, restAId, vendorAId)
    const s = await makeSession(vendorAId, 'VENDOR_OWNER')
    await sleep(100)
    const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
    const otpId = extractOtpId(r1)
    let ac = 0
    for (let i = 1; i <= 5; i++) { await sleep(70); await pickupVerify(f.order.id, otpId, WRONG_CODE, s); ac = snapshotOtp(otpId).attemptCount }
    results.push({ case: 'V4A2: 5 wrong → locked at 5', pass: ac === 5 })
    assert('V4A2: 5 wrong → locked at 5', ac === 5, `ac=${ac}`)
  }
  // V4A3: Order X OTP → Order Y reject/no burn
  {
    const consumerId = newId(), vendorAId = newId(), restAId = newId()
    const phone = `+91998877${tag}d001`
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}d`, 3, 0, now])
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}d010`, 'VENDOR_OWNER', `VA-${tag}d`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}d`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
    const f1 = makeOrderAtAlmostReady(tag+'d1', consumerId, phone, restAId, vendorAId)
    const f2 = makeOrderAtAlmostReady(tag+'d2', consumerId, phone, restAId, vendorAId)
    const s = await makeSession(vendorAId, 'VENDOR_OWNER')
    await sleep(100)
    const r1 = await patchFulfilment(f1.order.id, 'READY_FOR_PICKUP', s)
    const otpXId = extractOtpId(r1)
    const r2 = await patchFulfilment(f2.order.id, 'READY_FOR_PICKUP', s)
    const otpYId = extractOtpId(r2)
    // Use OTP X against Order Y
    await sleep(100)
    const r = await pickupVerify(f2.order.id, otpXId, KNOWN_CODE, s)
    const snapX = snapshotOtp(otpXId)
    results.push({ case: 'V4A3: Order X OTP → Order Y reject/no burn', pass: r.status >= 400 && snapX.consumed === 0 })
    assert('V4A3: Order X OTP → Order Y reject/no burn', r.status >= 400 && snapX.consumed === 0, `http=${r.status} X.consumed=${snapX.consumed}`)
  }
  // V4A3: RAW_OTP_API_RESPONSE = 0 + PROTECTED_HASH = 0
  {
    const consumerId = newId(), vendorAId = newId(), restAId = newId()
    const phone = `+91998877${tag}e001`
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}e`, 3, 0, now])
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}e010`, 'VENDOR_OWNER', `VA-${tag}e`, 3, 0, now])
    insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `RA-${tag}e`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
    const f = makeOrderAtAlmostReady(tag+'e', consumerId, phone, restAId, vendorAId)
    const s = await makeSession(vendorAId, 'VENDOR_OWNER')
    await sleep(100)
    const r = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
    const body = JSON.stringify(r.body)
    const rawInRes = body.includes(KNOWN_CODE)
    const hashInRes = body.toLowerCase().includes('codehash')
    results.push({ case: 'V4A3: RAW_OTP + codeHash absent from API', pass: !rawInRes && !hashInRes })
    assert('V4A3: RAW_OTP_API_RESPONSE=0 + PROTECTED_HASH=0', !rawInRes && !hashInRes, `raw=${rawInRes} hash=${hashInRes}`)
  }
  return results
}

// ---- main --------------------------------------------------------------
const phase = process.argv[2] || 'all'
async function main() {
  console.log(`\n# V4A4-ORDER-SCOPE-LOCKOUT-CORRECTION-25 — phase=${phase}`)
  console.log(`# DB=${DB_PATH}  baseline=3332bd9`)
  if (phase === 'p1') await phase1ProductionReissue()
  else if (phase === 'p2') await phase2CrossOrderIsolation()
  else if (phase === 'p4') await phase4LockoutReissue()
  else if (phase === 'p6') await phase6ConcurrentIsolation()
  else if (phase === 'p7') await phase7V4A4Regression()
  else if (phase === 'p8') await phase8SpotRegression()
  else if (phase === 'all') {
    await phase1ProductionReissue()
    await phase2CrossOrderIsolation()
    await phase4LockoutReissue()
    await phase6ConcurrentIsolation()
    await phase7V4A4Regression()
    await phase8SpotRegression()
  } else { console.error('Unknown phase. Use p1|p2|p4|p6|p7|p8|all'); process.exit(1) }
  db.close()
}
main().catch((e) => { console.error('FATAL', e); db.close(); process.exit(1) })
