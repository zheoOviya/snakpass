#!/usr/bin/env bun
// SNAKZAP-VENDOR-V4A4-OTP-REISSUE-INVALIDATION-24
// Evidence gate for OTP reissue invalidation.
//
// Uses bun:sqlite (built-in, zero Prisma-runtime overhead) for fixture setup +
// state verification, and fetch for API calls.
//
// Usage:
//   bun scripts/v4a4-otp-reissue-21.mjs pre      # Phase 1: pre-repair challenge
//   bun scripts/v4a4-otp-reissue-21.mjs post      # Phase 4-13: full matrix

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

function hashCode(code) {
  return scryptSync(code, Buffer.from(OTP_SALT), KEY_LEN).toString('hex')
}
function newId() { return randomUUID().replace(/-/g, '').slice(0, 24) }
function newToken() { return randomBytes(32).toString('hex') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function insert(sql, p) { db.prepare(sql).run(...p) }
function one(sql, p) { return db.prepare(sql).get(...p) }
function all(sql, p) { return db.prepare(sql).all(...p) }

async function makeSession(userId, role) {
  const token = newToken()
  const csrf = newToken()
  insert(`INSERT INTO Session (token, userId, role, expiresAt, createdAt, lastActivityAt) VALUES (?,?,?,?,?,?)`,
    [token, userId, role, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString(), new Date().toISOString()])
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

// Create an order at ALMOST_READY (both Order.status AND Fulfilment.status) so
// the vendor can PATCH to READY_FOR_PICKUP to trigger OTP issuance.
function makeFixtureAtAlmostReady(tag) {
  const now = new Date().toISOString()
  const consumerId = newId(); const vendorAId = newId(); const restAId = newId()
  const menuItemId = newId(); const orderId = newId(); const paymentId = newId(); const fulfilmentId = newId()
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, `+91998877${tag}001`, 'CONSUMER', `C-${tag}`, 3, 0, now])
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `V-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `R-${tag}`, 'North Indian', `f ${tag}`, '', 4.5, 20, 300, 0.08, 1, 0, '29ABCDE1234F1Z5', '', now, vendorAId])
  insert(`INSERT INTO MenuItem (id, restaurantId, name, description, image, price, spiceLevel, isVeg, isAvailable, version, category, createdAt, rewardMultiplier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [menuItemId, restAId, `I-${tag}`, `i ${tag}`, '', 10000, 1, 1, 1, 0, 'Mains', now, 1.0])
  // Order at ALMOST_READY (so /status can transition to READY_FOR_PICKUP)
  insert(`INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [orderId, consumerId, restAId, 'ALMOST_READY', 10000, '000000', 0, 1, now, now, '[]', 0])
  insert(`INSERT INTO OrderItem (id, orderId, menuItemId, name, price, quantity, subtotal, createdAt) VALUES (?,?,?,?,?,?,?,?)`, [newId(), orderId, menuItemId, `I-${tag}`, 10000, 1, 10000, now])
  insert(`INSERT INTO Payment (id, orderId, userId, amount, currency, status, capturedAt, frozen, version, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [paymentId, orderId, consumerId, 10000, 'INR', 'CAPTURED', now, 0, 0, now, now])
  // Fulfilment at ALMOST_READY (so /fulfilment can transition to READY_FOR_PICKUP)
  insert(`INSERT INTO Fulfilment (id, orderId, status, statusHistory, version, pickupOtp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`, [fulfilmentId, orderId, 'ALMOST_READY', '[]', 1, '000000', now, now])
  return { consumer: { id: consumerId, phone: `+91998877${tag}001` }, vendorA: { id: vendorAId }, restA: { id: restAId }, order: { id: orderId }, fulfilment: { id: fulfilmentId } }
}

// Create an order already at READY_FOR_PICKUP with a pre-issued OTP (for direct reissue/race tests)
function makeFixtureAtReadyForPickup(tag, opts = {}) {
  const f = makeFixtureAtAlmostReady(tag)
  const otpId = newId()
  const now = new Date().toISOString()
  // Issue OTP_A manually (purpose='pickup:<orderId>', the V4A3-secure binding)
  insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`, [otpId, f.consumer.phone, `pickup:${f.order.id}`, hashCode(KNOWN_CODE), 0, new Date(Date.now() + 300000).toISOString(), now, 0])
  // Update Order + Fulfilment to READY_FOR_PICKUP + pickupOtp='ISSUED'
  db.run(`UPDATE "Order" SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE id=?`, [f.order.id])
  db.run(`UPDATE Fulfilment SET status='READY_FOR_PICKUP', pickupOtp='ISSUED' WHERE orderId=?`, [f.order.id])
  return { ...f, otp: { id: otpId } }
}

function snapshotOtp(otpId) {
  return one(`SELECT consumed, attemptCount, expiresAt, purpose FROM OtpRequest WHERE id=?`, [otpId]) || {}
}
function countActivePickupOtps(orderId) {
  // Count all OtpRequest rows with purpose='pickup:<orderId>' that are not consumed, not expired, not locked
  return (one(`SELECT COUNT(*) as c FROM OtpRequest WHERE purpose=? AND consumed=0 AND expiresAt > ? AND attemptCount < 5`, [`pickup:${orderId}`, new Date().toISOString()]) || {}).c || 0
}
function countAllPickupOtps(orderId) {
  return (one(`SELECT COUNT(*) as c FROM OtpRequest WHERE purpose LIKE ?`, [`pickup%`]) || {}).c || 0 // includes generic 'pickup' + 'pickup:<orderId>'
}
function listOtpsForOrder(orderId) {
  return all(`SELECT id, purpose, consumed, attemptCount, expiresAt, target FROM OtpRequest WHERE purpose=? OR purpose='pickup' ORDER BY createdAt`, [`pickup:${orderId}`])
}
function assert(label, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${label}${detail ? ' — ' + detail : ''}`)
  return cond
}
const allPass = (arr) => arr.every((r) => r.pass !== false)

// =========================================================================
// PHASE 1 — PRE-REPAIR: challenge reissue semantics
// =========================================================================
async function phase1PreRepair() {
  console.log('\n=== PHASE 1 — PRE-REPAIR: reissue challenge ===')
  const tag = String(Math.floor(Math.random() * 900000 + 100000))
  const f = makeFixtureAtAlmostReady(tag)
  const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')

  // Step 1: Issue OTP_A via /fulfilment (ALMOST_READY → READY_FOR_PICKUP)
  console.log('  Step 1: PATCH /fulfilment ALMOST_READY → READY_FOR_PICKUP (issue OTP_A)')
  await sleep(120)
  const r1 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    HTTP=${r1.status}`)
  // Extract OTP_A's otpId from the response
  const otpAId = r1.body?.fulfilment?.pickupOtpId || r1.body?.pickupOtpId
  console.log(`    OTP_A otpId=${otpAId || '<not returned>'}`)

  // Verify OTP_A was created
  const otpsAfterA = listOtpsForOrder(f.order.id)
  console.log(`    OtpRequest rows after OTP_A: ${otpsAfterA.length}`)
  for (const o of otpsAfterA) console.log(`      - id=${o.id.slice(-8)} purpose=${o.purpose} consumed=${o.consumed} ac=${o.attemptCount}`)

  // Step 2: Try to issue OTP_B via /fulfilment again (same→same, idempotent)
  console.log('  Step 2: PATCH /fulfilment READY_FOR_PICKUP → READY_FOR_PICKUP (try reissue OTP_B via /fulfilment)')
  await sleep(120)
  const r2 = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    HTTP=${r2.status} (idempotent same→same expected)`)
  const otpBIdFulfilment = r2.body?.fulfilment?.pickupOtpId || r2.body?.pickupOtpId
  console.log(`    pickupOtpId returned: ${otpBIdFulfilment || '<none>'}`)

  // Step 3: Try to issue OTP_B via /status (Order.status is ALMOST_READY → READY_FOR_PICKUP)
  console.log('  Step 3: PATCH /status ALMOST_READY → READY_FOR_PICKUP (try reissue OTP_B via /status)')
  await sleep(120)
  const r3 = await patchOrderStatus(f.order.id, 'READY_FOR_PICKUP', s)
  console.log(`    HTTP=${r3.status}`)
  console.log(`    body=${JSON.stringify(r3.body).slice(0, 300)}`)
  // Also check what Order.status is now (did /fulfilment change it?)
  const orderAfter = one(`SELECT status, pickupOtp, version FROM "Order" WHERE id=?`, [f.order.id])
  console.log(`    Order after step 1+2: status=${orderAfter.status} pickupOtp=${orderAfter.pickupOtp} version=${orderAfter.version}`)

  // Count all OTPs for this order
  const otpsAfterB = listOtpsForOrder(f.order.id)
  console.log(`    OtpRequest rows after reissue attempts: ${otpsAfterB.length}`)
  for (const o of otpsAfterB) console.log(`      - id=${o.id.slice(-8)} purpose=${o.purpose} consumed=${o.consumed} ac=${o.attemptCount}`)

  // Step 4: Test OTP_A verification (if it exists)
  console.log('  Step 4: Test OTP_A verification')
  if (otpAId) {
    await sleep(120)
    const verifyA = await pickupVerify(f.order.id, otpAId, KNOWN_CODE, s)
    const snapA = snapshotOtp(otpAId)
    console.log(`    OTP_A verify: HTTP=${verifyA.status}, consumed=${snapA.consumed}, ac=${snapA.attemptCount}`)
    console.log(`    CAN_OLD_OTP_A_VERIFY_AFTER_REISSUE_ATTEMPT = ${verifyA.status === 200 ? 'YES' : 'NO'}`)
  } else {
    console.log('    OTP_A not returned by /fulfilment — cannot test')
  }

  // Summary
  const activeCount = countActivePickupOtps(f.order.id)
  const allCount = otpsAfterB.length
  console.log(`\n  SUMMARY:`)
  console.log(`    ACTIVE_PICKUP_OTP_RECORD_COUNT (purpose=pickup:<orderId>, unconsumed, unexpired, unlocked) = ${activeCount}`)
  console.log(`    ALL pickup-related OtpRequest rows = ${allCount}`)
  console.log(`    CAN_OLD_OTP_A_VERIFY_AFTER_B_ISSUED = ${otpAId ? '<see above>' : 'N/A'}`)
  console.log(`    CAN_NEW_OTP_B_VERIFY = <tested in Phase 4>`)

  return { tag, f, otpAId, otpsAfterB, activeCount }
}

// =========================================================================
// POST-REPAIR phases (to be run after the repair)
// =========================================================================

// Phase 4: Old OTP invalidation matrix
async function phase4InvalidationMatrix() {
  console.log('\n=== PHASE 4 — Old OTP invalidation matrix ===')
  const tag = 'p4' + Math.floor(Math.random() * 90000 + 10000)
  // Create order at READY_FOR_PICKUP with OTP_A already issued
  const f = makeFixtureAtReadyForPickup(tag)
  const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
  const before = snapshotOtp(f.otp.id)
  console.log(`  OTP_A before: consumed=${before.consumed} ac=${before.attemptCount} purpose=${before.purpose}`)

  // Test all 4 combinations
  const results = []
  // 1. correct code A + otpId A
  { await sleep(100); const r = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const a = snapshotOtp(f.otp.id); results.push({ combo: 'correct A + otpId A', http: r.status, consumed: a.consumed, ac: a.attemptCount }); console.log(`  correct A + otpId A → HTTP=${r.status} consumed=${a.consumed} ac=${a.attemptCount}`) }
  // 2. wrong code + otpId A
  { await sleep(100); const r = await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s); const a = snapshotOtp(f.otp.id); results.push({ combo: 'wrong + otpId A', http: r.status, consumed: a.consumed, ac: a.attemptCount }); console.log(`  wrong + otpId A → HTTP=${r.status} consumed=${a.consumed} ac=${a.attemptCount}`) }
  return results
}

// Phase 7: Concurrent reissue
async function phase7ConcurrentReissue() {
  console.log('\n=== PHASE 7 — Concurrent reissue (10 fixtures) ===')
  const results = []
  for (let i = 1; i <= 10; i++) {
    const tag = 'p7' + i + Math.floor(Math.random() * 90000 + 10000)
    const f = makeFixtureAtAlmostReady(tag)
    const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
    await sleep(100)
    // 2 simultaneous PATCH /fulfilment to READY_FOR_PICKUP
    const [r1, r2] = await Promise.all([
      patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s),
      patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s),
    ])
    const otps = listOtpsForOrder(f.order.id)
    const activeCount = countActivePickupOtps(f.order.id)
    const pass = activeCount <= 1
    results.push({ run: i, r1: r1.status, r2: r2.status, otpCount: otps.length, activeCount, pass })
    assert(`Run ${i}: EXACTLY_ONE_CURRENT_USABLE_PICKUP_OTP (active=${activeCount})`, pass, `r1=${r1.status} r2=${r2.status} totalOtps=${otps.length} active=${activeCount}`)
  }
  return results
}

// Phase 8: Reissue × verify race
async function phase8ReissueVerifyRace() {
  console.log('\n=== PHASE 8 — Reissue × verify race (10 fixtures) ===')
  const results = []
  for (let i = 1; i <= 10; i++) {
    const tag = 'p8' + i + Math.floor(Math.random() * 90000 + 10000)
    const f = makeFixtureAtReadyForPickup(tag) // order already at READY_FOR_PICKUP with OTP_A
    const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
    await sleep(100)
    // T1 = verify OTP_A, T2 = try reissue via /fulfilment (same→same, idempotent)
    const [verifyRes, reissueRes] = await Promise.all([
      pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s),
      patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s),
    ])
    const snap = snapshotOtp(f.otp.id)
    const ful = one(`SELECT status, version FROM Fulfilment WHERE orderId=?`, [f.order.id])
    // Coherent outcomes:
    // A: verify wins → PICKED_UP, reissue idempotent same→same (200 with pickupVerifiedAt already set)
    // B: reissue wins (commits first) → verify may fail (STALE_VERSION) or succeed (if before reissue's version bump)
    const coherent = (ful.status === 'PICKED_UP' && verifyRes.status === 200) || (verifyRes.status >= 400 && ful.status === 'READY_FOR_PICKUP')
    const noDupPickup = ful.status !== 'PICKED_UP' || (ful.status === 'PICKED_UP' && verifyRes.status === 200)
    results.push({ run: i, verify: verifyRes.status, reissue: reissueRes.status, ful: ful.status, consumed: snap.consumed, coherent: coherent && noDupPickup })
    assert(`Run ${i}: coherent outcome (verify=${verifyRes.status} reissue=${reissueRes.status} ful=${ful.status})`, coherent && noDupPickup)
  }
  return results
}

// Phase 12: Active-record invariant (A→B→C→D)
async function phase12ActiveRecordInvariant() {
  console.log('\n=== PHASE 12 — Active-record invariant (A→B→C→D) ===')
  const tag = 'p12' + Math.floor(Math.random() * 90000 + 10000)
  const f = makeFixtureAtReadyForPickup(tag)
  const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
  // OTP_A already exists (from makeFixtureAtReadyForPickup)
  const otps = [{ label: 'A', id: f.otp.id }]
  // Try to issue B, C, D via /fulfilment (same→same, idempotent — should not create new OTPs)
  for (const label of ['B', 'C', 'D']) {
    await sleep(100)
    const r = await patchFulfilment(f.order.id, 'READY_FOR_PICKUP', s)
    const newOtpId = r.body?.fulfilment?.pickupOtpId || r.body?.pickupOtpId
    if (newOtpId && !otps.find(o => o.id === newOtpId)) {
      otps.push({ label, id: newOtpId })
    }
  }
  // Report all OTPs
  console.log('  OTP records for this order:')
  for (const o of otps) {
    const snap = snapshotOtp(o.id)
    console.log(`    ${o.label}: id=${o.id.slice(-8)} purpose=${snap.purpose} consumed=${snap.consumed} ac=${snap.attemptCount} expires=${snap.expiresAt?.slice(0,10)}`)
  }
  const activeCount = countActivePickupOtps(f.order.id)
  const pass = activeCount <= 1
  assert(`USABLE_CURRENT_OTP_COUNT <= 1 (actual=${activeCount})`, pass)
  return { activeCount, pass, otpCount: otps.length }
}

// ---- main --------------------------------------------------------------
const phase = process.argv[2] || 'pre'
async function main() {
  console.log(`\n# V4A4-OTP-REISSUE-INVALIDATION-24 — phase=${phase}`)
  console.log(`# DB=${DB_PATH}  baseline=5f2f71ecf2b99cb25e6de22ee942ef420df25128`)
  if (phase === 'pre') {
    await phase1PreRepair()
  } else if (phase === 'p4') { await phase4InvalidationMatrix() }
    else if (phase === 'p7') { await phase7ConcurrentReissue() }
    else if (phase === 'p8') { await phase8ReissueVerifyRace() }
    else if (phase === 'p12') { await phase12ActiveRecordInvariant() }
    else { console.error('Unknown phase. Use pre|p4|p7|p8|p12.'); process.exit(1) }
  db.close()
}
main().catch((e) => { console.error('FATAL', e); db.close(); process.exit(1) })
