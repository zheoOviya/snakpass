#!/usr/bin/env bun
// SNAKZAP-V3-CONSUMER-REALTIME-CORRELATION-31
// Prisma-based outbox verification (WAL-visible reads).
// Tests cross-order outbox isolation + payload minimization.

import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes, randomUUID } from 'crypto'

const BASE_URL = 'http://localhost:3000'
const OTP_SALT = 'snakzap-otp-salt'
const KEY_LEN = 32
const KNOWN_CODE = '482915'

const db = new PrismaClient()

function hashCode(code) { return scryptSync(code, Buffer.from(OTP_SALT), KEY_LEN).toString('hex') }
function newId() { return randomUUID().replace(/-/g, '').slice(0, 24) }
function newToken() { return randomBytes(32).toString('hex') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function makeSession(userId, role) {
  const token = newToken(), csrf = newToken()
  await db.session.create({ data: { token, userId, role, expiresAt: new Date(Date.now()+86400000), lastActivityAt: new Date() } })
  return { token, csrf }
}
function cookieStr(s) { return `snakzap_session=${s.token}; snakzap_csrf=${s.csrf}` }
function headersFor(s) { return { 'Content-Type': 'application/json', Cookie: cookieStr(s), 'X-CSRF-Token': s.csrf } }

async function makeFixture(tag, opts = {}) {
  const now = new Date()
  const phone = `+91998877${tag}001`
  const consumer = await db.user.create({ data: { phone, role: 'CONSUMER', name: `C-${tag}`, spiceTolerance: 3, walletBalance: 0 } })
  const vendorA = await db.user.create({ data: { phone: `+91998877${tag}010`, role: 'VENDOR_OWNER', name: `V-${tag}`, spiceTolerance: 3, walletBalance: 0 } })
  const restA = await db.restaurant.create({ data: { name: `R-${tag}`, cuisine: 'x', description: '', image: '', ownerUserId: vendorA.id } })
  const menuItem = await db.menuItem.create({ data: { restaurantId: restA.id, name: `I-${tag}`, description: '', image: '', price: 10000, category: 'Mains' } })
  const order = await db.order.create({ data: { userId: consumer.id, restaurantId: restA.id, status: opts.orderStatus || 'READY_FOR_PICKUP', totalAmount: 10000, pickupOtp: 'ISSUED', itemsCount: 1 } })
  await db.orderItem.create({ data: { orderId: order.id, menuItemId: menuItem.id, name: `I-${tag}`, price: 10000, quantity: 1, subtotal: 10000 } })
  await db.payment.create({ data: { orderId: order.id, userId: consumer.id, amount: 10000, status: 'CAPTURED', capturedAt: now } })
  const fulfilment = await db.fulfilment.create({ data: { orderId: order.id, status: opts.fulfilmentStatus || 'READY_FOR_PICKUP', version: 1, pickupOtp: 'ISSUED' } })
  const otp = await db.otpRequest.create({ data: { channel: 'phone', target: phone, purpose: `pickup:${order.id}`, codeHash: hashCode(KNOWN_CODE), expiresAt: new Date(Date.now()+300000) } })
  return { consumer, vendorA, restA, order, fulfilment, otp }
}

async function pickupVerify(orderId, otpId, code, s) {
  const r = await fetch(`${BASE_URL}/api/orders/${orderId}/pickup/verify`, { method: 'POST', headers: headersFor(s), body: JSON.stringify({ otpId, code }) })
  let b; try { b = await r.json() } catch { b = await r.text() }
  return { status: r.status, body: b }
}

async function outboxEventsFor(orderId) {
  return db.outbox.findMany({ where: { payload: { contains: orderId } }, orderBy: { createdAt: 'asc' } })
}
function assert(label, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${label}${detail ? ' — ' + detail : ''}`)
  return cond
}

// ===== PHASE 2: Correlation contract (outbox isolation) =====
async function phase2() {
  console.log('\n=== PHASE 2 — Correlation contract (outbox isolation) ===')
  const tag = 'p2' + Math.floor(Math.random() * 90000 + 10000)
  const fA = await makeFixture(tag + 'a')
  const fB = await makeFixture(tag + 'b')
  const vendorSess = await makeSession(fA.vendorA.id, 'VENDOR_OWNER')

  await sleep(200)
  const verifyRes = await pickupVerify(fA.order.id, fA.otp.id, KNOWN_CODE, vendorSess)
  console.log(`  pickupVerify A: HTTP=${verifyRes.status}`)
  await sleep(800)

  const eventsA = await outboxEventsFor(fA.order.id)
  const eventsB = await outboxEventsFor(fB.order.id)
  console.log(`  Order A outbox events: ${eventsA.length} (expected >=1)`)
  console.log(`  Order B outbox events: ${eventsB.length} (expected 0)`)

  for (const e of eventsA) {
    const p = JSON.parse(e.payload)
    console.log(`    A event: type=${e.eventType} orderId=${p.orderId} status=${p.status}`)
    assert('Order A event payload orderId matches Order A', p.orderId === fA.order.id, `got ${p.orderId}`)
  }
  assert('Order B has 0 outbox events (cross-order isolation)', eventsB.length === 0, `count=${eventsB.length}`)

  const orderB = await db.order.findUnique({ where: { id: fB.order.id }, select: { status: true } })
  const fulB = await db.fulfilment.findUnique({ where: { orderId: fB.order.id }, select: { status: true } })
  const otpB = await db.otpRequest.findUnique({ where: { id: fB.otp.id }, select: { consumed: true, attemptCount: true } })
  assert('Order B unchanged (READY_FOR_PICKUP)', orderB.status === 'READY_FOR_PICKUP', `status=${orderB.status}`)
  assert('Fulfilment B unchanged (READY_FOR_PICKUP)', fulB.status === 'READY_FOR_PICKUP', `status=${fulB.status}`)
  assert('Order B OTP not consumed', otpB.consumed === false, `consumed=${otpB.consumed}`)

  return { pass: eventsA.length >= 1 && eventsB.length === 0 && orderB.status === 'READY_FOR_PICKUP' && otpB.consumed === false }
}

// ===== PHASE 6: Payload minimization =====
async function phase6() {
  console.log('\n=== PHASE 6 — Payload minimization ===')
  const tag = 'p6' + Math.floor(Math.random() * 90000 + 10000)
  const f = await makeFixture(tag)
  const vendorSess = await makeSession(f.vendorA.id, 'VENDOR_OWNER')

  await sleep(200)
  await pickupVerify(f.order.id, f.otp.id, KNOWN_CODE, vendorSess)
  await sleep(800)

  const events = await outboxEventsFor(f.order.id)
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

// ---- main --------------------------------------------------------------
const phase = process.argv[2] || 'all'
async function main() {
  console.log(`\n# V3-CONSUMER-REALTIME-CORRELATION-31 (Prisma) — phase=${phase}`)
  console.log(`# baseline=b751ac6`)
  if (phase === 'p2') await phase2()
  else if (phase === 'p6') await phase6()
  else { console.error('Use p2|p6'); process.exit(1) }
  await db.$disconnect()
}
main().catch(async (e) => { console.error('FATAL', e); await db.$disconnect(); process.exit(1) })
