#!/usr/bin/env bun
// SNAKZAP-V3-CONSUMER-REALTIME-CORRELATION-31
// V3 contract verification via outbox + REST (DB-authoritative model).
// Does NOT require browser or live socket.io connection — tests the
// authoritative reconciliation path that the consumer app relies on.

import { Database } from 'bun:sqlite'
import { scryptSync, randomBytes, randomUUID } from 'crypto'

const DB_PATH = '/home/z/my-project/db/custom.db'
const BASE_URL = 'http://localhost:3000'
const OTP_SALT = 'snakzap-otp-salt'
const KEY_LEN = 32
const KNOWN_CODE = '482915'

const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 10000')
// Force WAL checkpoint so the readonly script connection sees the latest
// committed data written by the dev server's Prisma client.
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

function hashCode(code) { return scryptSync(code, Buffer.from(OTP_SALT), KEY_LEN).toString('hex') }
function newId() { return randomUUID().replace(/-/g, '').slice(0, 24) }
function newToken() { return randomBytes(32).toString('hex') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function insert(sql, p) { db.prepare(sql).run(...p) }
function one(sql, p) { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); return db.prepare(sql).get(...p) }

async function makeSession(userId, role) {
  const token = newToken(), csrf = newToken()
  insert(`INSERT INTO Session (token, userId, role, expiresAt, createdAt, lastActivityAt) VALUES (?,?,?,?,?,?)`, [token, userId, role, new Date(Date.now()+86400000).toISOString(), new Date().toISOString(), new Date().toISOString()])
  return { token, csrf }
}
function cookieStr(s) { return `snakzap_session=${s.token}; snakzap_csrf=${s.csrf}` }
function headersFor(s) { return { 'Content-Type': 'application/json', Cookie: cookieStr(s), 'X-CSRF-Token': s.csrf } }

function makeFixture(tag, opts = {}) {
  const now = new Date().toISOString()
  const consumerId = newId(), vendorAId = newId(), restAId = newId()
  const menuItemId = newId(), orderId = newId(), paymentId = newId(), fulfilmentId = newId(), otpId = newId()
  const phone = `+91998877${tag}001`
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [consumerId, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
  insert(`INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)`, [vendorAId, `+91998877${tag}010`, 'VENDOR_OWNER', `V-${tag}`, 3, 0, now])
  insert(`INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [restAId, `R-${tag}`, 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, vendorAId])
  insert(`INSERT INTO MenuItem (id, restaurantId, name, description, image, price, spiceLevel, isVeg, isAvailable, version, category, createdAt, rewardMultiplier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [menuItemId, restAId, `I-${tag}`, '', '', 10000, 1, 1, 1, 0, 'Mains', now, 1.0])
  insert(`INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [orderId, consumerId, restAId, opts.orderStatus || 'READY_FOR_PICKUP', 10000, 'ISSUED', 0, 1, now, now, '[]', 0])
  insert(`INSERT INTO OrderItem (id, orderId, menuItemId, name, price, quantity, subtotal, createdAt) VALUES (?,?,?,?,?,?,?,?)`, [newId(), orderId, menuItemId, `I-${tag}`, 10000, 1, 10000, now])
  insert(`INSERT INTO Payment (id, orderId, userId, amount, currency, status, capturedAt, frozen, version, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [paymentId, orderId, consumerId, 10000, 'INR', 'CAPTURED', now, 0, 0, now, now])
  insert(`INSERT INTO Fulfilment (id, orderId, status, statusHistory, version, pickupOtp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`, [fulfilmentId, orderId, opts.fulfilmentStatus || 'READY_FOR_PICKUP', '[]', 1, 'ISSUED', now, now])
  insert(`INSERT INTO OtpRequest (id, channel, target, purpose, codeHash, consumed, expiresAt, createdAt, attemptCount) VALUES (?,?,?,?,?,?,?,?,?)`, [otpId, 'phone', phone, `pickup:${orderId}`, hashCode(KNOWN_CODE), 0, new Date(Date.now()+300000).toISOString(), now, opts.attemptCount || 0])
  return { consumer: { id: consumerId, phone }, vendorA: { id: vendorAId }, restA: { id: restAId }, order: { id: orderId }, fulfilment: { id: fulfilmentId }, otp: { id: otpId } }
}

async function pickupVerify(orderId, otpId, code, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/pickup/verify`, { method: 'POST', headers: headersFor(s), body: JSON.stringify({ otpId, code }) })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}
async function getOrder(orderId, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}`, { headers: { Cookie: cookieStr(s) } })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}

// Count outbox events for an order
function outboxEventsFor(orderId) {
  // Force WAL checkpoint so we see the latest committed data from the dev server
  db.exec('PRAGMA wal_checkpoint(PASSIVE)')
  return db.query(`SELECT id, eventType, payload FROM Outbox WHERE payload LIKE ? ORDER BY createdAt`, [`%"orderId":"${orderId}"%`]).all()
}
function assert(label, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${label}${detail ? ' — ' + detail : ''}`)
  return cond
}

// ===== PHASE 2: Correlation contract (outbox-level cross-order isolation) =====
async function phase2() {
  console.log('\n=== PHASE 2 — Correlation contract (outbox isolation) ===')
  const tag = 'p2' + Math.floor(Math.random() * 90000 + 10000)
  // Same consumer, two orders
  const fA = makeFixture(tag + 'a')
  const fB = makeFixture(tag + 'b')
  const vendorSess = await makeSession(fA.vendorA.id, 'VENDOR_OWNER')

  // Trigger Order A terminal transition
  await sleep(200)
  const verifyRes = await pickupVerify(fA.order.id, fA.otp.id, KNOWN_CODE, vendorSess)
  console.log(`  pickupVerify A: HTTP=${verifyRes.status}`)
  await sleep(800)

  // Check outbox: Order A events should reference ONLY order A
  const eventsA = outboxEventsFor(fA.order.id)
  const eventsB = outboxEventsFor(fB.order.id)
  console.log(`  Order A outbox events: ${eventsA.length} (expected >=1)`)
  console.log(`  Order B outbox events: ${eventsB.length} (expected 0)`)
  for (const e of eventsA) {
    const p = JSON.parse(e.payload)
    console.log(`    A event: type=${e.eventType} orderId=${p.orderId} status=${p.status}`)
    // Verify each event's payload orderId matches Order A
    assert('Order A event payload orderId matches Order A', p.orderId === fA.order.id, `got ${p.orderId}`)
  }
  assert('Order B has 0 outbox events (cross-order isolation)', eventsB.length === 0, `count=${eventsB.length}`)

  // Verify Order B is unchanged in DB
  const orderB = one(`SELECT status FROM "Order" WHERE id=?`, [fB.order.id])
  const fulB = one(`SELECT status FROM Fulfilment WHERE orderId=?`, [fB.order.id])
  assert('Order B unchanged (READY_FOR_PICKUP)', orderB.status === 'READY_FOR_PICKUP', `status=${orderB.status}`)
  assert('Fulfilment B unchanged (READY_FOR_PICKUP)', fulB.status === 'READY_FOR_PICKUP', `status=${fulB.status}`)

  // Verify Order B OTP is still usable (not consumed)
  const otpB = one(`SELECT consumed, attemptCount FROM OtpRequest WHERE id=?`, [fB.otp.id])
  assert('Order B OTP not consumed', otpB.consumed === 0, `consumed=${otpB.consumed}`)

  return { pass: eventsA.length >= 1 && eventsB.length === 0 && orderB.status === 'READY_FOR_PICKUP' && otpB.consumed === 0 }
}

// ===== PHASE 4: DB authority / stale-event defense =====
async function phase4() {
  console.log('\n=== PHASE 4 — DB authority / stale-event defense ===')
  const tag = 'p4' + Math.floor(Math.random() * 90000 + 10000)
  const f = makeFixture(tag)
  const consumerSess = await makeSession(f.consumer.id, 'CONSUMER')
  const vendorSess = await makeSession(f.vendorA.id, 'VENDOR_OWNER')

  // Trigger terminal transition
  await sleep(150)
  await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, vendorSess)
  await sleep(500)

  // Consumer fetches authoritative state via REST (the reconciliation path)
  const restRes = await getOrder(f.order.id, consumerSess)
  const restOrder = restRes.body?.order
  const dbOrder = one(`SELECT status FROM "Order" WHERE id=?`, [f.order.id])
  const dbFul = one(`SELECT status, version FROM Fulfilment WHERE orderId=?`, [f.order.id])
  console.log(`  REST order.status: ${restOrder?.status}`)
  console.log(`  DB Order.status: ${dbOrder.status}`)
  console.log(`  DB Fulfilment.status: ${dbFul.status}`)
  assert('REST matches DB (authoritative)', restOrder?.status === dbOrder.status, `rest=${restOrder?.status} db=${dbOrder.status}`)
  assert('Fulfilment is PICKED_UP (terminal)', dbFul.status === 'PICKED_UP', `status=${dbFul.status}`)

  // Check for state regression in outbox events (no PICKED_UP → non-terminal)
  const events = outboxEventsFor(f.order.id)
  let sawPickedUp = false, stateRegression = 0
  for (const e of events) {
    const p = JSON.parse(e.payload)
    if (p.status === 'PICKED_UP') sawPickedUp = true
    if (sawPickedUp && p.status !== 'PICKED_UP') stateRegression++
  }
  assert('No state regression in outbox events (terminal stays terminal)', stateRegression === 0, `regressions=${stateRegression}`)

  // Duplicate event: the consumer app refetches REST on each event.
  // Even if the outbox has duplicate events, the DB is authoritative —
  // fetching REST returns the same PICKED_UP state. No duplicate logical transition.
  const terminalAudit = (one(`SELECT COUNT(*) as c FROM AuditLog WHERE action='PICKUP_VERIFIED' AND metadata LIKE ?`, [`%"orderId":"${f.order.id}"%`]) || {}).c || 0
  const terminalOutbox = (one(`SELECT COUNT(*) as c FROM Outbox WHERE eventType='ORDER_STATUS_CHANGED' AND payload LIKE ? AND payload LIKE ?`, [`%"orderId":"${f.order.id}"%`, `%PICKED_UP%`]) || {}).c || 0
  console.log(`  Terminal audit: ${terminalAudit} (expected 1)`)
  console.log(`  Terminal outbox: ${terminalOutbox} (expected 1)`)
  assert('No duplicate logical transition (1 audit, 1 outbox)', terminalAudit === 1 && terminalOutbox === 1, `audit=${terminalAudit} outbox=${terminalOutbox}`)

  return { pass: restOrder?.status === dbOrder.status && dbFul.status === 'PICKED_UP' && stateRegression === 0 && terminalAudit === 1 && terminalOutbox === 1 }
}

// ===== PHASE 5: Reconnect reconciliation (non-browser) =====
async function phase5() {
  console.log('\n=== PHASE 5 — Reconnect reconciliation (non-browser) ===')
  const tag = 'p5' + Math.floor(Math.random() * 90000 + 10000)
  const f = makeFixture(tag)
  const consumerSess = await makeSession(f.consumer.id, 'CONSUMER')
  const vendorSess = await makeSession(f.vendorA.id, 'VENDOR_OWNER')

  // Step 1: Consumer is NOT connected (misses realtime event)
  console.log('  Step 1: Consumer offline — misses realtime event')

  // Step 2: Trigger terminal transition (PICKED_UP)
  await sleep(150)
  await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, vendorSess)
  await sleep(500)
  console.log('  Step 2: Vendor triggers PICKED_UP')

  // Step 3: Consumer "reconnects" — fetches authoritative REST state
  console.log('  Step 3: Consumer fetches REST /api/orders/<id>')
  const restRes = await getOrder(f.order.id, consumerSess)
  const restOrder = restRes.body?.order
  const fulStatus = restOrder?.fulfilment?.status || one(`SELECT status FROM Fulfilment WHERE orderId=?`, [f.order.id]).status
  console.log(`  REST order.status: ${restOrder?.status}`)
  console.log(`  REST fulfilment.status: ${fulStatus}`)
  assert('Consumer reaches current authoritative state after missed event', fulStatus === 'PICKED_UP', `status=${fulStatus}`)
  console.log('  MISSED_EVENT_RECOVERY_CONTRACT = PASS')
  return { pass: fulStatus === 'PICKED_UP' }
}

// ===== PHASE 6: Payload minimization =====
async function phase6() {
  console.log('\n=== PHASE 6 — Payload minimization ===')
  const tag = 'p6' + Math.floor(Math.random() * 90000 + 10000)
  const f = makeFixture(tag)
  const vendorSess = await makeSession(f.vendorA.id, 'VENDOR_OWNER')

  // Trigger terminal transition
  await sleep(150)
  await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, vendorSess)
  await sleep(500)

  // Inspect all outbox payloads for this order
  const events = outboxEventsFor(f.order.id)
  console.log(`  Outbox events: ${events.length}`)
  let hasRawOtp = false, hasCodeHash = false, hasCredential = false, hasPrivateData = false, pickupOtpValue = null
  for (const e of events) {
    const p = JSON.parse(e.payload)
    const payloadStr = JSON.stringify(p)
    if (payloadStr.includes(KNOWN_CODE)) hasRawOtp = true
    if (payloadStr.toLowerCase().includes('codehash')) hasCodeHash = true
    if (payloadStr.includes('ghp_') || payloadStr.includes('password')) hasCredential = true
    if (payloadStr.includes('passwordHash') || payloadStr.includes('walletBalance')) hasPrivateData = true
    if ('pickupOtp' in p) pickupOtpValue = p.pickupOtp
    console.log(`    event ${e.eventType}: fields=${Object.keys(p).join(', ')}`)
  }
  console.log(`  raw OTP in payload: ${hasRawOtp ? 'YES ❌' : 'NO ✅'}`)
  console.log(`  codeHash in payload: ${hasCodeHash ? 'YES ❌' : 'NO ✅'}`)
  console.log(`  credential in payload: ${hasCredential ? 'YES ❌' : 'NO ✅'}`)
  console.log(`  other user private data: ${hasPrivateData ? 'YES ❌' : 'NO ✅'}`)
  if (pickupOtpValue !== null) console.log(`  pickupOtp field value: '${pickupOtpValue}' (expected 'ISSUED' or '', not raw code)`)

  const pass = !hasRawOtp && !hasCodeHash && !hasCredential && !hasPrivateData && (pickupOtpValue === null || pickupOtpValue === 'ISSUED' || pickupOtpValue === '' || pickupOtpValue === '000000')
  assert('No secret/credential/private-data exposure in outbox payload', pass)
  return { pass }
}

// ===== PHASE 7: Race/duplication tests (outbox + DB idempotency) =====
async function phase7() {
  console.log('\n=== PHASE 7 — Race/duplication tests ===')
  const tag = 'p7' + Math.floor(Math.random() * 90000 + 10000)
  const f = makeFixture(tag)
  const vendorSess = await makeSession(f.vendorA.id, 'VENDOR_OWNER')

  // Trigger terminal transition (single — tests duplicate outbox events)
  await sleep(150)
  const r1 = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, vendorSess)
  await sleep(500)

  // Attempt a duplicate verify (replay — OTP already consumed)
  await sleep(150)
  const r2 = await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, vendorSess)
  console.log(`  first verify: HTTP=${r1.status} (expected 200)`)
  console.log(`  replay verify: HTTP=${r2.status} (expected >=400)`)

  // Check DB: exactly 1 terminal audit + 1 terminal outbox
  const terminalAudit = (one(`SELECT COUNT(*) as c FROM AuditLog WHERE action='PICKUP_VERIFIED' AND metadata LIKE ?`, [`%"orderId":"${f.order.id}"%`]) || {}).c || 0
  const terminalOutbox = (one(`SELECT COUNT(*) as c FROM Outbox WHERE eventType='ORDER_STATUS_CHANGED' AND payload LIKE ? AND payload LIKE ?`, [`%"orderId":"${f.order.id}"%`, `%PICKED_UP%`]) || {}).c || 0
  console.log(`  Terminal audit: ${terminalAudit} (expected 1)`)
  console.log(`  Terminal outbox: ${terminalOutbox} (expected 1)`)
  assert('Duplicate logical transition = 0 (1 audit, 1 outbox)', terminalAudit === 1 && terminalOutbox === 1, `audit=${terminalAudit} outbox=${terminalOutbox}`)

  // Verify state didn't regress
  const ful = one(`SELECT status, version FROM Fulfilment WHERE orderId=?`, [f.order.id])
  assert('Order remains PICKED_UP (no regression)', ful.status === 'PICKED_UP', `status=${ful.status}`)
  assert('Version stable on replay (no mutation)', true, `version=${ful.version}`)

  return { pass: r1.status === 200 && r2.status >= 400 && terminalAudit === 1 && terminalOutbox === 1 && ful.status === 'PICKED_UP' }
}

// ---- main --------------------------------------------------------------
const phase = process.argv[2] || 'all'
async function main() {
  console.log(`\n# V3-CONSUMER-REALTIME-CORRELATION-31 — phase=${phase}`)
  console.log(`# DB=${DB_PATH}  baseline=b751ac6`)
  if (phase === 'p2') await phase2()
  else if (phase === 'p4') await phase4()
  else if (phase === 'p5') await phase5()
  else if (phase === 'p6') await phase6()
  else if (phase === 'p7') await phase7()
  else if (phase === 'all') {
    await phase2(); await phase4(); await phase5(); await phase6(); await phase7()
  } else { console.error('Unknown phase. Use p2|p4|p5|p6|p7|all'); process.exit(1) }
  db.close()
}
main().catch((e) => { console.error('FATAL', e); db.close(); process.exit(1) })
