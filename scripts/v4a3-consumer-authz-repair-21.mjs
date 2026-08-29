#!/usr/bin/env bun
// SNAKZAP-VENDOR-V4A3-CONSUMER-PICKUP-AUTHORIZATION-REPAIR-21
// Evidence gate: pre-repair reproduction + post-repair full matrix.
//
// Uses bun:sqlite (built-in, zero Prisma runtime overhead) for fixture setup +
// state verification, and fetch for API calls. This keeps the script's memory
// footprint minimal so it coexists with the dev server without killing it.
//
// Usage:
//   bun scripts/v4a3-consumer-authz-repair-21.mjs pre      # Phase 1: reproduce P0
//   bun scripts/v4a3-consumer-authz-repair-21.mjs post      # Phase 5-11: full matrix
//
// No raw OTP codes are printed in evidence output.

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

// ---- helpers -----------------------------------------------------------
function hashCode(code) {
  const salt = Buffer.from(OTP_SALT)
  return scryptSync(code, salt, KEY_LEN).toString('hex')
}
function newId() { return randomUUID().replace(/-/g, '').slice(0, 24) }
function newToken() { return randomBytes(32).toString('hex') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function insert(sql, params) { db.prepare(sql).run(...params) }
function one(sql, params) { return db.prepare(sql).get(...params) }
function all(sql, params) { return db.prepare(sql).all(...params) }

async function makeSession(userId, role) {
  const token = newToken()
  const csrf = newToken()
  insert(
    `INSERT INTO Session (token, userId, role, expiresAt, createdAt, lastActivityAt) VALUES (?,?,?,?,?,?)`,
    [token, userId, role, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString(), new Date().toISOString()],
  )
  return { token, csrf }
}

function headersFor(s) {
  if (!s) return { 'Content-Type': 'application/json' }
  return {
    'Content-Type': 'application/json',
    Cookie: `snakzap_session=${s.token}; snakzap_csrf=${s.csrf}`,
    'X-CSRF-Token': s.csrf,
  }
}

async function pickupVerify(orderId, otpId, code, s, qrToken) {
  const body = { otpId, code }
  if (qrToken) body.qrToken = qrToken
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/pickup/verify`, {
    method: 'POST', headers: headersFor(s), body: JSON.stringify(body),
  })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}

async function getFulfilment(orderId, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/fulfilment`, { headers: headersFor(s) })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}

// Snapshot DB state for an order — for side-effect verification.
function snapshot(orderId, otpId) {
  const order = one(`SELECT status, pickupOtp, version FROM "Order" WHERE id = ?`, [orderId]) || {}
  const ful = one(`SELECT status, version, pickupVerifiedAt, pickupVerifiedBy FROM Fulfilment WHERE orderId = ?`, [orderId]) || {}
  let otp = null
  if (otpId) {
    otp = one(`SELECT consumed, attemptCount, expiresAt, purpose FROM OtpRequest WHERE id = ?`, [otpId]) || null
  }
  // Total pickup audit (success + failure) — used for side-effect accounting.
  const auditCount = (one(
    `SELECT COUNT(*) as c FROM AuditLog WHERE action IN ('PICKUP_VERIFIED','PICKUP_VERIFICATION_FAILED') AND metadata LIKE ?`,
    [`%"orderId":"${orderId}"%`],
  ) || {}).c || 0
  // Terminal success audit only (PICKUP_VERIFIED) — used for concurrency gate
  // (the loser's PICKUP_VERIFICATION_FAILED is a non-terminal failure audit
  // written outside the txn, NOT a duplicate terminal transition).
  const terminalAuditCount = (one(
    `SELECT COUNT(*) as c FROM AuditLog WHERE action = 'PICKUP_VERIFIED' AND metadata LIKE ?`,
    [`%"orderId":"${orderId}"%`],
  ) || {}).c || 0
  const outboxCount = (one(
    `SELECT COUNT(*) as c FROM Outbox WHERE eventType = 'ORDER_STATUS_CHANGED' AND payload LIKE ?`,
    [`%"orderId":"${orderId}"%`],
  ) || {}).c || 0
  return { order, ful, otp: otp || {}, auditCount, terminalAuditCount, outboxCount }
}

// ---- fixture factory (creates a full ready-for-pickup order + OTP) -----
function makeFixture(tag, opts = {}) {
  const consumerPhone = opts.consumerPhone || `+91998877${tag}001`
  const vendorPhone = opts.vendorPhone || `+91998877${tag}010`
  const now = new Date().toISOString()
  const consumerId = newId()
  const vendorAId = newId()
  const restAId = newId()
  const menuItemId = newId()
  const orderId = newId()
  const paymentId = newId()
  const fulfilmentId = newId()
  const otpId = newId()

  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`,
    [consumerId, consumerPhone, 'CONSUMER', `Consumer-${tag}`, 3, 0, now])
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`,
    [vendorAId, vendorPhone, 'VENDOR_OWNER', `VendorA-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [restAId, `RestA-${tag}`, 'North Indian', `fixture ${tag}`, '', 4.5, 20, 300, 0.08, 1, 0, '29ABCDE1234F1Z5', '', now, vendorAId])
  insert(`INSERT INTO MenuItem (id, restaurantId, name, description, image, price, spiceLevel, isVeg, isAvailable, version, category, createdAt, rewardMultiplier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [menuItemId, restAId, `Item-${tag}`, `item ${tag}`, '', 10000, 1, 1, 1, 0, 'Mains', now, 1.0])
  insert(`INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orderId, consumerId, restAId, 'READY_FOR_PICKUP', 10000, 'ISSUED', 0, 1, now, now, '[]', 0])
  insert(`INSERT INTO OrderItem (id, orderId, menuItemId, name, price, quantity, subtotal, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    [newId(), orderId, menuItemId, `Item-${tag}`, 10000, 1, 10000, now])
  insert(`INSERT INTO Payment (id, orderId, userId, amount, currency, status, capturedAt, frozen, version, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [paymentId, orderId, consumerId, 10000, 'INR', 'CAPTURED', now, 0, 0, now, now])
  insert(`INSERT INTO Fulfilment (id, orderId, status, statusHistory, version, pickupOtp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`,
    [fulfilmentId, orderId, 'READY_FOR_PICKUP', '[]', 1, 'ISSUED', now, now])
  insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`,
    [otpId, 'phone', consumerPhone, `pickup:${orderId}`, hashCode(KNOWN_CODE), 0, new Date(Date.now() + 300000).toISOString(), now, 0])

  return {
    consumer: { id: consumerId, phone: consumerPhone },
    vendorA: { id: vendorAId },
    restA: { id: restAId },
    menuItem: { id: menuItemId },
    order: { id: orderId },
    payment: { id: paymentId },
    fulfilment: { id: fulfilmentId },
    otp: { id: otpId },
  }
}

function makeSecondVendor(tag) {
  const now = new Date().toISOString()
  const vendorBId = newId()
  const restBId = newId()
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`,
    [vendorBId, `+91998877${tag}020`, 'VENDOR_OWNER', `VendorB-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [restBId, `RestB-${tag}`, 'Chinese', `fixture B ${tag}`, '', 4.5, 20, 300, 0.08, 1, 0, '29ABCDE1234F1Z5', '', now, vendorBId])
  return { vendorB: { id: vendorBId }, restB: { id: restBId } }
}

function makeAdmin(tag) {
  const id = newId()
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`,
    [id, `+91998877${tag}099`, 'SUPER_ADMIN', `Admin-${tag}`, 3, 0, new Date().toISOString()])
  return { id }
}

// build an order under restB (for cross-vendor success cases)
function makeOrderOnRest(tag, restId, vendorPhone) {
  const now = new Date().toISOString()
  const consumerId = newId()
  const orderId = newId()
  const menuItemId = newId()
  const paymentId = newId()
  const fulfilmentId = newId()
  const otpId = newId()
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`,
    [consumerId, `+91998877${tag}001`, 'CONSUMER', `C-${tag}`, 3, 0, now])
  insert(`INSERT INTO MenuItem (id, restaurantId, name, description, image, price, spiceLevel, isVeg, isAvailable, version, category, createdAt, rewardMultiplier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [menuItemId, restId, `Item-${tag}`, `item ${tag}`, '', 10000, 1, 1, 1, 0, 'Mains', now, 1.0])
  insert(`INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orderId, consumerId, restId, 'READY_FOR_PICKUP', 10000, 'ISSUED', 0, 1, now, now, '[]', 0])
  insert(`INSERT INTO OrderItem (id, orderId, menuItemId, name, price, quantity, subtotal, createdAt) VALUES (?,?,?,?,?,?,?,?)`,
    [newId(), orderId, menuItemId, `Item-${tag}`, 10000, 1, 10000, now])
  insert(`INSERT INTO Payment (id, orderId, userId, amount, currency, status, capturedAt, frozen, version, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [paymentId, orderId, consumerId, 10000, 'INR', 'CAPTURED', now, 0, 0, now, now])
  insert(`INSERT INTO Fulfilment (id, orderId, status, statusHistory, version, pickupOtp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`,
    [fulfilmentId, orderId, 'READY_FOR_PICKUP', '[]', 1, 'ISSUED', now, now])
  insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`,
    [otpId, 'phone', `+91998877${tag}001`, `pickup:${orderId}`, hashCode(KNOWN_CODE), 0, new Date(Date.now() + 300000).toISOString(), now, 0])
  return { consumer: { id: consumerId, phone: `+91998877${tag}001` }, order: { id: orderId }, otp: { id: otpId }, fulfilment: { id: fulfilmentId } }
}

function assert(label, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${label}${detail ? ' — ' + detail : ''}`)
  return cond
}
const allPass = (arr) => arr.every((r) => r.pass !== false)

// =========================================================================
// PHASE 1 — Pre-repair: reproduce the Consumer P0 exploit
// =========================================================================
async function phase1PreRepair() {
  console.log('\n=== PHASE 1 — PRE-REPAIR: reproduce Consumer P0 exploit ===')
  const tag = String(Math.floor(Math.random() * 900000 + 100000))
  const f = makeFixture(tag)
  const s = await makeSession(f.consumer.id, 'CONSUMER')
  const before = snapshot(f.order.id, f.otp.id)
  console.log('  Fixture: Consumer owns Order, status=READY_FOR_PICKUP, valid OTP bound to order')
  console.log(`  Caller: CONSUMER (session.userId === order.userId)`)
  console.log(`  Before: order.status=${before.order.status} ful.status=${before.ful.status} otp.consumed=${before.otp.consumed} ac=${before.otp.attemptCount} audit=${before.auditCount} outbox=${before.outboxCount}`)
  await sleep(150)
  const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s)
  const after = snapshot(f.order.id, f.otp.id)
  console.log(`  HTTP = ${res.status}`)
  console.log(`  After: order.status=${after.order.status} ful.status=${after.ful.status} otp.consumed=${after.otp.consumed} ac=${after.otp.attemptCount} audit=${after.auditCount} outbox=${after.outboxCount}`)
  const exploit = res.status === 200 && after.ful.status === 'PICKED_UP' && after.otp.consumed === 1 && after.auditCount === before.auditCount + 1 && after.outboxCount === before.outboxCount + 1
  if (exploit) {
    console.log('\n  >>> EXPLOIT REPRODUCED: Consumer performed terminal PICKED_UP mutation.')
    console.log('  >>> P0 authorization regression confirmed BEFORE repair.')
  } else {
    console.log('\n  >>> EXPLOIT NOT REPRODUCED — current code already rejects Consumer.')
    console.log('  >>> STOP: source/runtime contradiction (per directive Phase 1).')
  }
  console.log(`\n  fixture-tag=${tag} orderId=${f.order.id} otpId=${f.otp.id}`)
  return { exploit, tag, f }
}

// =========================================================================
// POST-REPAIR PHASES
// =========================================================================
async function phase5RoleMatrix() {
  console.log('\n=== PHASE 5 — Mandatory role matrix ===')
  const results = []
  const tag = 'r5' + Math.floor(Math.random() * 90000 + 10000)
  // Row 1: Owning Vendor + valid → success
  {
    const f = makeFixture(tag + '1'); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 200 && after.ful.status === 'PICKED_UP' && after.otp.consumed === 1 && after.auditCount === before.auditCount + 1 && after.outboxCount === before.outboxCount + 1
    results.push({ case: 'Owning Vendor + valid', status: res.status, pass })
    assert('Owning Vendor + valid → 200 + PICKED_UP + 1 audit + 1 outbox', pass, `http=${res.status}`)
  }
  // Row 2: Owning Vendor + wrong → 4xx
  {
    const f = makeFixture(tag + '2'); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status >= 400 && res.status < 500 && after.ful.status === 'READY_FOR_PICKUP' && after.otp.consumed === 0 && after.otp.attemptCount === before.otp.attemptCount + 1
    results.push({ case: 'Owning Vendor + wrong', status: res.status, pass })
    assert('Owning Vendor + wrong → 4xx, READY_FOR_PICKUP, ac+1, not consumed', pass, `http=${res.status} ac=${after.otp.attemptCount}`)
  }
  // Row 3: Foreign Vendor + valid → 403
  {
    const f = makeFixture(tag + '3'); const sec = makeSecondVendor(tag + '3'); const s = await makeSession(sec.vendorB.id, 'VENDOR_OWNER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 403 && after.ful.status === 'READY_FOR_PICKUP' && after.otp.consumed === 0 && after.otp.attemptCount === before.otp.attemptCount && after.auditCount === before.auditCount && after.outboxCount === before.outboxCount
    results.push({ case: 'Foreign Vendor + valid', status: res.status, pass })
    assert('Foreign Vendor + valid → 403, 0 mutation, 0 side-effect', pass, `http=${res.status}`)
  }
  // Row 4: Consumer owner + valid → reject (THE REPAIR)
  {
    const f = makeFixture(tag + '4'); const s = await makeSession(f.consumer.id, 'CONSUMER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 403 && after.ful.status === 'READY_FOR_PICKUP' && after.otp.consumed === 0 && after.otp.attemptCount === before.otp.attemptCount && after.auditCount === before.auditCount && after.outboxCount === before.outboxCount
    results.push({ case: 'Consumer owner + valid', status: res.status, pass })
    assert('Consumer owner + valid → 403, 0 mutation, OTP not consumed', pass, `http=${res.status}`)
  }
  // Row 5: Consumer owner + wrong → reject BEFORE OTP burn
  {
    const f = makeFixture(tag + '5'); const s = await makeSession(f.consumer.id, 'CONSUMER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 403 && after.otp.attemptCount === before.otp.attemptCount && after.otp.consumed === 0
    results.push({ case: 'Consumer owner + wrong', status: res.status, pass })
    assert('Consumer owner + wrong → 403, attemptCount Δ=0 (no burn)', pass, `http=${res.status} ac=${after.otp.attemptCount}`)
  }
  // Row 6: Different Consumer + valid → reject
  {
    const f = makeFixture(tag + '6')
    const otherId = newId()
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`,
      [otherId, `+91998877${tag}6030`, 'CONSUMER', `OtherC-${tag}`, 3, 0, new Date().toISOString()])
    const s = await makeSession(otherId, 'CONSUMER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 403 && after.otp.consumed === 0 && after.otp.attemptCount === before.otp.attemptCount
    results.push({ case: 'Different Consumer + valid', status: res.status, pass })
    assert('Different Consumer + valid → 403, OTP not consumed', pass, `http=${res.status}`)
  }
  // Row 7: Unauthenticated + valid-shaped → reject
  {
    const f = makeFixture(tag + '7')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, null)
    const after = snapshot(f.order.id, f.otp.id)
    const pass = (res.status === 401 || res.status === 403) && after.otp.consumed === 0 && after.otp.attemptCount === before.otp.attemptCount
    results.push({ case: 'Unauthenticated + valid', status: res.status, pass })
    assert('Unauthenticated + valid → 401/403, OTP not consumed', pass, `http=${res.status}`)
  }
  // Row 8: SUPER_ADMIN + valid → trace existing contract (report exact outcome)
  {
    const f = makeFixture(tag + '8'); const admin = makeAdmin(tag + '8')
    const s = await makeSession(admin.id, 'SUPER_ADMIN')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s)
    const after = snapshot(f.order.id, f.otp.id)
    console.log(`  [TRACE] SUPER_ADMIN + valid → http=${res.status} ful=${after.ful.status} consumed=${after.otp.consumed} auditΔ=${after.auditCount - before.auditCount} outboxΔ=${after.outboxCount - before.outboxCount}`)
    results.push({ case: 'SUPER_ADMIN + valid', status: res.status, pass: true, traceOnly: true,
      outcome: `http=${res.status} ful=${after.ful.status} consumed=${after.otp.consumed} auditΔ=${after.auditCount - before.auditCount} outboxΔ=${after.outboxCount - before.outboxCount}` })
  }
  return results
}

async function phase6ConsumerOracle() {
  console.log('\n=== PHASE 6 — Consumer oracle test (uniform rejection) ===')
  const tag = 'o6' + Math.floor(Math.random() * 90000 + 10000)
  const statuses = new Set()
  // valid
  { const f = makeFixture(tag + 'v'); const s = await makeSession(f.consumer.id, 'CONSUMER'); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    statuses.add(res.status); assert('Consumer + valid OTP → 403 uniform', res.status === 403 && after.otp.consumed === 0, `http=${res.status}`) }
  // wrong
  { const f = makeFixture(tag + 'w'); const s = await makeSession(f.consumer.id, 'CONSUMER'); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    statuses.add(res.status); assert('Consumer + wrong OTP → 403 uniform', res.status === 403 && after.otp.attemptCount === 0, `http=${res.status} ac=${after.otp.attemptCount}`) }
  // expired
  { const f = makeFixture(tag + 'e'); db.run(`UPDATE OtpRequest SET expiresAt = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), f.otp.id])
    const s = await makeSession(f.consumer.id, 'CONSUMER'); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    statuses.add(res.status); assert('Consumer + expired OTP → 403 uniform', res.status === 403 && after.otp.consumed === 0, `http=${res.status}`) }
  // consumed
  { const f = makeFixture(tag + 'c'); db.run(`UPDATE OtpRequest SET consumed = 1 WHERE id = ?`, [f.otp.id])
    const s = await makeSession(f.consumer.id, 'CONSUMER'); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    statuses.add(res.status); assert('Consumer + consumed OTP → 403 uniform', res.status === 403, `http=${res.status}`) }
  // locked
  { const f = makeFixture(tag + 'l'); db.run(`UPDATE OtpRequest SET attemptCount = 5 WHERE id = ?`, [f.otp.id])
    const s = await makeSession(f.consumer.id, 'CONSUMER'); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    statuses.add(res.status); assert('Consumer + locked OTP → 403 uniform', res.status === 403, `http=${res.status}`) }
  const uniform = statuses.size === 1 && [...statuses][0] === 403
  console.log(`\n  Uniform rejection statuses: ${[...statuses].join(', ')}`)
  console.log(`  Uniform = ${uniform ? 'YES' : 'NO'}`)
  return { statuses: [...statuses], uniform }
}

async function phase7V4A1Ownership() {
  console.log('\n=== PHASE 7 — V4A1 ownership regression ===')
  const tag = 'p7' + Math.floor(Math.random() * 90000 + 10000)
  const results = []
  // Vendor A → own order → success
  { const f = makeFixture(tag + 'a'); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER'); await sleep(100)
    const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 200 && after.ful.status === 'PICKED_UP'
    results.push({ case: 'Vendor A → own Order A', status: res.status, pass }); assert('Vendor A → own Order A → success', pass, `http=${res.status}`) }
  // Vendor B → Vendor A order → 403
  { const f = makeFixture(tag + 'b'); const sec = makeSecondVendor(tag + 'b'); const s = await makeSession(sec.vendorB.id, 'VENDOR_OWNER'); await sleep(100)
    const before = snapshot(f.order.id, f.otp.id); const res = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const after = snapshot(f.order.id, f.otp.id)
    const pass = res.status === 403 && after.ful.status === 'READY_FOR_PICKUP' && after.otp.consumed === 0
    results.push({ case: 'Vendor B → Vendor A Order', status: res.status, pass }); assert('Vendor B → Vendor A Order → 403, no burn', pass, `http=${res.status}`) }
  // Vendor B → own order (on restB) → success
  { const sec = makeSecondVendor(tag + 'c'); const o = makeOrderOnRest(tag + 'c', sec.restB.id); const s = await makeSession(sec.vendorB.id, 'VENDOR_OWNER'); await sleep(100)
    const res = await pickupVerify(o.order.id, o.otp.id, KNOWN_CODE, s); const after = snapshot(o.order.id, o.otp.id)
    const pass = res.status === 200 && after.ful.status === 'PICKED_UP'
    results.push({ case: 'Vendor B → own Order B', status: res.status, pass }); assert('Vendor B → own Order B → success', pass, `http=${res.status}`) }
  // Vendor A → Vendor B order → 403
  { const sec = makeSecondVendor(tag + 'd'); const o = makeOrderOnRest(tag + 'd', sec.restB.id)
    const vaId = newId(); const now = new Date().toISOString()
    insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vaId, `+91998877${tag}d015`, 'VENDOR_OWNER', `VA-${tag}d`, 3, 0, now])
    const s = await makeSession(vaId, 'VENDOR_OWNER'); await sleep(100)
    const res = await pickupVerify(o.order.id, o.otp.id, KNOWN_CODE, s); const after = snapshot(o.order.id, o.otp.id)
    const pass = res.status === 403 && after.ful.status === 'READY_FOR_PICKUP' && after.otp.consumed === 0
    results.push({ case: 'Vendor A → Vendor B Order', status: res.status, pass }); assert('Vendor A → Vendor B Order → 403, no burn', pass, `http=${res.status}`) }
  return results
}

async function phase8AttemptLimit() {
  console.log('\n=== PHASE 8 — V4A2 attempt-limit regression (authorized Vendor only) ===')
  const tag = 'p8' + Math.floor(Math.random() * 90000 + 10000)
  const results = []
  // Authorized vendor: 5 wrongs → locked, 6th capped, correct after lock rejected
  {
    const f = makeFixture(tag + '1'); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
    let ac = 0
    for (let i = 1; i <= 5; i++) { await sleep(80); await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s); const after = snapshot(f.order.id, f.otp.id); ac = after.otp.attemptCount; console.log(`  wrong #${i} → ac=${ac}`) }
    const lockedPass = ac === 5; results.push({ step: '5 wrong → locked at 5', pass: lockedPass }); assert('Authorized Vendor wrong #5 → attemptCount=5 (locked)', lockedPass, `ac=${ac}`)
    await sleep(80); await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s); const after6 = snapshot(f.order.id, f.otp.id)
    const cappedPass = after6.otp.attemptCount === 5; results.push({ step: '6th wrong → capped at 5', pass: cappedPass }); assert('Authorized Vendor wrong #6 → capped at 5', cappedPass, `ac=${after6.otp.attemptCount}`)
    await sleep(80); const resC = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const afterC = snapshot(f.order.id, f.otp.id)
    const rejectPass = resC.status >= 400 && afterC.ful.status === 'READY_FOR_PICKUP' && afterC.otp.consumed === 0
    results.push({ step: 'correct after lock → reject', pass: rejectPass }); assert('Authorized Vendor correct-after-lock → reject, READY_FOR_PICKUP', rejectPass, `http=${resC.status}`)
  }
  // Consumer wrong attempts must NOT increment attemptCount
  {
    const f = makeFixture(tag + '2'); const s = await makeSession(f.consumer.id, 'CONSUMER')
    const before = snapshot(f.order.id, f.otp.id)
    for (let i = 1; i <= 3; i++) { await sleep(80); await pickupVerify(f.order.id, f.otp.id, WRONG_CODE, s) }
    const after = snapshot(f.order.id, f.otp.id)
    const pass = after.otp.attemptCount === before.otp.attemptCount && after.otp.consumed === 0
    results.push({ step: 'Consumer 3 wrong → attemptCount Δ=0', pass }); assert('Consumer wrong attempts do NOT increment attemptCount', pass, `ac before=${before.otp.attemptCount} after=${after.otp.attemptCount}`)
  }
  return results
}

async function phase9BindingSecret() {
  console.log('\n=== PHASE 9 — V4A3 binding/secret regression ===')
  const tag = 'p9' + Math.floor(Math.random() * 90000 + 10000)
  const results = []
  // cross-order OTP → reject, no burn
  { const f1 = makeFixture(tag + 'a'); const f2 = makeFixture(tag + 'b'); const s = await makeSession(f1.vendorA.id, 'VENDOR_OWNER')
    const before = snapshot(f1.order.id, f2.otp.id); await sleep(100)
    const res = await pickupVerify(f1.order.id, f2.otp.id, KNOWN_CODE, s); const after = snapshot(f1.order.id, f2.otp.id)
    const pass = res.status >= 400 && after.otp.consumed === 0 && after.otp.attemptCount === before.otp.attemptCount
    results.push({ case: 'cross-order OTP → reject no burn', status: res.status, pass }); assert('Cross-order OTP → reject, OTP NOT consumed, ac unchanged', pass, `http=${res.status}`) }
  // random otpId + valid code → reject
  { const f = makeFixture(tag + 'c'); const fakeOtpId = newId()
    insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`,
      [fakeOtpId, 'phone', f.consumer.phone, 'pickup:nonexistent-order', hashCode(KNOWN_CODE), 0, new Date(Date.now() + 300000).toISOString(), new Date().toISOString(), 0])
    const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER'); const before = snapshot(f.order.id, fakeOtpId); await sleep(100)
    const res = await pickupVerify(f.order.id, fakeOtpId, KNOWN_CODE, s); const after = snapshot(f.order.id, fakeOtpId)
    const pass = res.status >= 400 && after.otp.consumed === 0
    results.push({ case: 'random otpId + valid code → reject', status: res.status, pass }); assert('Random otpId + valid code → reject, no burn', pass, `http=${res.status}`) }
  // raw OTP absent from API
  { const f = makeFixture(tag + 'd'); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER'); await sleep(100)
    const getRes = await getFulfilment(f.order.id, s); const getBody = JSON.stringify(getRes.body)
    const rawInGet = getBody.includes(KNOWN_CODE)
    const verRes = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s); const verBody = JSON.stringify(verRes.body)
    const rawInVer = verBody.includes(KNOWN_CODE)
    const pass = !rawInGet && !rawInVer
    results.push({ case: 'raw OTP absent from API', pass }); assert('Raw OTP absent from GET + verify API responses', pass, `getHas=${rawInGet} verifyHas=${rawInVer}`) }
  // codeHash absent from API
  { const f = makeFixture(tag + 'e'); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER'); await sleep(100)
    const getRes = await getFulfilment(f.order.id, s); const body = JSON.stringify(getRes.body).toLowerCase()
    const hashInGet = body.includes('codehash')
    results.push({ case: 'codeHash absent', pass: !hashInGet }); assert('codeHash absent from API response', !hashInGet, `hashInGet=${hashInGet}`) }
  return results
}

async function phase10Concurrency() {
  console.log('\n=== PHASE 10 — Concurrency regression (authorized Vendor) ===')
  const results = []
  for (let run = 1; run <= 5; run++) {
    const tag = 'p10' + run + Math.floor(Math.random() * 90000 + 10000)
    const f = makeFixture(tag); const s = await makeSession(f.vendorA.id, 'VENDOR_OWNER')
    const before = snapshot(f.order.id, f.otp.id); await sleep(100)
    const [r1, r2] = await Promise.all([
      pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s, null),
      pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, s, null),
    ])
    const after = snapshot(f.order.id, f.otp.id)
    const auditDelta = after.auditCount - before.auditCount; const outboxDelta = after.outboxCount - before.outboxCount
    const terminalAuditDelta = after.terminalAuditCount - before.terminalAuditCount
    const winner = (r1.status === 200 ? 1 : 0) + (r2.status === 200 ? 1 : 0)
    // "one audit" = one TERMINAL PICKUP_VERIFIED audit. The loser writes a
    // PICKUP_VERIFICATION_FAILED audit (outside txn, non-terminal) — that is a
    // failure record, NOT a duplicate terminal transition. So we assert on
    // terminalAuditDelta === 1, while auditDelta may be 2 (1 success + 1 fail).
    const pass = winner === 1 && after.ful.status === 'PICKED_UP' && after.otp.consumed === 1 && terminalAuditDelta === 1 && outboxDelta === 1
    results.push({ run, r1: r1.status, r2: r2.status, pass, auditDelta, terminalAuditDelta, outboxDelta })
    assert(`Run ${run}: 1 winner, 1 PICKED_UP, 1 terminal audit, 1 outbox`, pass, `r1=${r1.status} r2=${r2.status} auditΔ=${auditDelta} terminalΔ=${terminalAuditDelta} outboxΔ=${outboxDelta}`)
  }
  return results
}

async function phase11SideEffectMatrix() {
  console.log('\n=== PHASE 11 — Side-effect evidence matrix ===')
  const tag = 'p11' + Math.floor(Math.random() * 90000 + 10000)
  const rows = []
  // setup() is async so the session (a DB insert) is fully resolved before fetch.
  const run = async (label, setup) => {
    const { order, otp, session } = await setup(); const before = snapshot(order.id, otp.id); await sleep(100)
    const res = await pickupVerify(order.id, otp.id, KNOWN_CODE, session); const after = snapshot(order.id, otp.id)
    rows.push({ caller: label, http: res.status, consumed: after.otp.consumed, acDelta: after.otp.attemptCount - before.otp.attemptCount, order: after.ful.status, audit: after.auditCount - before.auditCount, outbox: after.outboxCount - before.outboxCount })
  }
  await run('Consumer + valid',     async () => { const f = makeFixture(tag+'1'); return { order: f.order, otp: f.otp, session: await makeSession(f.consumer.id,'CONSUMER') } })
  await run('Consumer + wrong',    async () => { const f = makeFixture(tag+'2'); return { order: f.order, otp: f.otp, session: await makeSession(f.consumer.id,'CONSUMER') } })
  await run('Foreign Vendor + val',async () => { const f = makeFixture(tag+'3'); const sec = makeSecondVendor(tag+'3'); return { order: f.order, otp: f.otp, session: await makeSession(sec.vendorB.id,'VENDOR_OWNER') } })
  await run('Owner Vendor + valid',async () => { const f = makeFixture(tag+'4'); return { order: f.order, otp: f.otp, session: await makeSession(f.vendorA.id,'VENDOR_OWNER') } })
  await run('Unauthenticated',     async () => { const f = makeFixture(tag+'5'); return { order: f.order, otp: f.otp, session: null } })
  console.log('')
  console.log('  | Caller                  | HTTP | consumed | acΔ | order          | audit | outbox |')
  console.log('  |-------------------------|------|----------|-----|----------------|-------|--------|')
  for (const r of rows) console.log(`  | ${r.caller.padEnd(23)} | ${String(r.http).padEnd(4)} | ${String(r.consumed).padEnd(8)} | ${String(r.acDelta).padEnd(3)} | ${r.order.padEnd(14)} | ${String(r.audit).padEnd(5)} | ${String(r.outbox).padEnd(6)} |`)
  return rows
}

// ---- main --------------------------------------------------------------
const phase = process.argv[2] || 'post'
async function main() {
  console.log(`\n# V4A3-CONSUMER-PICKUP-AUTHORIZATION-REPAIR-21 — phase=${phase}`)
  console.log(`# DB=${DB_PATH}  baseline=2adc9c8952b8c7c449e4e508d4d93a3a21d92dd0`)
  if (phase === 'pre') {
    await phase1PreRepair()
  } else if (phase === 'post') {
    const p5 = await phase5RoleMatrix()
    const p6 = await phase6ConsumerOracle()
    const p7 = await phase7V4A1Ownership()
    const p8 = await phase8AttemptLimit()
    const p9 = await phase9BindingSecret()
    const p10 = await phase10Concurrency()
    const p11 = await phase11SideEffectMatrix()
    const actionable = [...p5.filter(r=>!r.traceOnly), ...p7, ...p8, ...p9, ...p10]
    const ok = allPass(actionable) && p6.uniform
    console.log(`\n# SUMMARY`)
    console.log(`  Phase 5 (role matrix):        ${allPass(p5.filter(r=>!r.traceOnly)) ? 'PASS' : 'FAIL'}`)
    console.log(`  Phase 6 (consumer oracle):     ${p6.uniform ? 'PASS' : 'FAIL'} (statuses=${p6.statuses.join(',')})`)
    console.log(`  Phase 7 (V4A1 ownership):      ${allPass(p7) ? 'PASS' : 'FAIL'}`)
    console.log(`  Phase 8 (V4A2 attempt-limit): ${allPass(p8) ? 'PASS' : 'FAIL'}`)
    console.log(`  Phase 9 (V4A3 binding/secret):${allPass(p9) ? 'PASS' : 'FAIL'}`)
    console.log(`  Phase 10 (concurrency 5/5):   ${allPass(p10) ? 'PASS' : 'FAIL'}`)
    console.log(`  Phase 11 (side-effect matrix): see table above`)
    console.log(`\n  OVERALL = ${ok ? 'VERIFIED' : 'BLOCKED'}`)
  } else if (phase === 'p5') { await phase5RoleMatrix() }
    else if (phase === 'p6') { await phase6ConsumerOracle() }
    else if (phase === 'p7') { await phase7V4A1Ownership() }
    else if (phase === 'p8') { await phase8AttemptLimit() }
    else if (phase === 'p9') { await phase9BindingSecret() }
    else if (phase === 'p10') { await phase10Concurrency() }
    else if (phase === 'p11') { await phase11SideEffectMatrix() }
    else { console.error('Unknown phase. Use pre|post|p5..p11.'); process.exit(1) }
  db.close()
}
main().catch((e) => { console.error('FATAL', e); db.close(); process.exit(1) })
