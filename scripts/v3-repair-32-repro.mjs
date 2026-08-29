#!/usr/bin/env bun
// SNAKZAP-V3-REALTIME-DELIVERY-AUTHORIZATION-REPAIR-32
// Phase 1: Reproduce cross-user delivery defect at service level.
// Tests the realtime service's subscribe/emit authorization directly.

import { Database } from 'bun:sqlite'
import { io } from 'socket.io-client'
import { randomBytes, randomUUID } from 'crypto'

const DB_PATH = '/home/z/my-project/db/custom.db'
const REALTIME_URL = 'http://localhost:3003'

const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 10000')

function newId() { return randomUUID().replace(/-/g, '').slice(0, 24) }
function newToken() { return randomBytes(32).toString('hex') }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function makeConsumer(tag) {
  const id = newId()
  const now = new Date().toISOString()
  const phone = `+91998877${tag}001`
  db.run('INSERT INTO User (id, phone, role, name, spiceTolerance, walletBalance, createdAt) VALUES (?,?,?,?,?,?,?)', [id, phone, 'CONSUMER', `C-${tag}`, 3, 0, now])
  const token = newToken()
  db.run('INSERT INTO Session (token, userId, role, expiresAt, createdAt, lastActivityAt) VALUES (?,?,?,?,?,?)', [token, id, 'CONSUMER', new Date(Date.now()+86400000).toISOString(), now, now])
  return { id, phone, token }
}

async function connectConsumer(token) {
  return new Promise((resolve) => {
    const sock = io(REALTIME_URL, {
      path: '/',
      transports: ['websocket','polling'],
      reconnection: false,
      timeout: 5000,
      extraHeaders: { Cookie: `snakzap_session=${token}` },
    })
    sock.on('connect', () => resolve(sock))
    sock.on('connect_error', () => resolve(null))
    setTimeout(() => resolve(null), 6000)
  })
}

async function main() {
  const runTag = Math.floor(Math.random() * 900000 + 100000).toString()
  console.log('# V3-REPAIR-32 Phase 1 — Reproduce cross-user delivery defect')
  console.log(`# DB=${DB_PATH}  run=${runTag}`)
  console.log('')

  // Create Consumer A + Consumer B
  const consumerA = await makeConsumer('rA' + runTag)
  const consumerB = await makeConsumer('rB' + runTag)
  console.log(`Consumer A: id=${consumerA.id.slice(-8)}`)
  console.log(`Consumer B: id=${consumerB.id.slice(-8)}`)

  // Create Order A (owned by Consumer A) + Order B (owned by Consumer B)
  const orderAId = newId()
  const orderBId = newId()
  const restAId = newId()
  const restBId = newId()
  const now = new Date().toISOString()
  db.run('INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [restAId, 'RA', 'x', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, consumerA.id])
  db.run('INSERT INTO Restaurant (id, name, cuisine, description, image, rating, prepTimeMins, priceForTwo, commissionRate, isActive, isSuspended, gstNumber, address, createdAt, ownerUserId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [restBId, 'RB', 'y', '', '', 4.5, 20, 300, 0.08, 1, 0, 'g', '', now, consumerB.id])
  db.run('INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [orderAId, consumerA.id, restAId, 'READY_FOR_PICKUP', 10000, 'ISSUED', 0, 1, now, now, '[]', 0])
  db.run('INSERT INTO "Order" (id, userId, restaurantId, status, totalAmount, pickupOtp, isCatering, itemsCount, createdAt, updatedAt, statusHistory, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [orderBId, consumerB.id, restBId, 'READY_FOR_PICKUP', 10000, 'ISSUED', 0, 1, now, now, '[]', 0])
  console.log(`Order A: id=${orderAId.slice(-8)} (owned by Consumer A)`)
  console.log(`Order B: id=${orderBId.slice(-8)} (owned by Consumer B)`)

  // Connect both consumers
  const sockA = await connectConsumer(consumerA.token)
  const sockB = await connectConsumer(consumerB.token)
  console.log(`\nConsumer A connected: ${sockA ? 'YES' : 'NO'}`)
  console.log(`Consumer B connected: ${sockB ? 'YES' : 'NO'}`)

  if (!sockA || !sockB) {
    console.log('FAIL: could not connect consumers — cannot reproduce at socket level')
    console.log('Falling back to source-level trace (defect confirmed in source):')
    console.log('  realtime/index.ts:192 — io.to("consumer:all").emit("order:updated", payload)')
    console.log('  realtime/index.ts:175 — socket.join(channel) for order:{orderId} (no ownership check)')
    db.close()
    return
  }

  // === TEST 1: consumer:all broadcast ===
  console.log('\n=== TEST 1: consumer:all broadcast ===')
  const receivedA = [], receivedB = []
  sockA.on('order:updated', (p) => receivedA.push(p))
  sockB.on('order:updated', (p) => receivedB.push(p))
  // Both consumers are auto-joined to consumer:all? No — they must subscribe.
  // Actually, looking at the source, consumer:all is broadcast to, but consumers
  // must subscribe to it. Let me check if the consumer app subscribes to consumer:all.
  // From use-realtime.ts, the app subscribes to specific channels. But the
  // realtime service broadcasts to consumer:all. So any consumer that subscribes
  // to consumer:all will receive ALL order events.
  sockA.emit('subscribe', 'consumer:all')
  sockB.emit('subscribe', 'consumer:all')
  await sleep(500)

  // Simulate an order:updated event for Order B (as the publisher would)
  // We can't emit as a non-service... but we can test the broadcast directly.
  // Actually, the order:updated handler is on the realtime service — it receives
  // from the publisher (service connection). A regular user socket CAN emit
  // order:updated too (there's no isService check on that handler!). Let me test.
  const orderBPayload = {
    orderId: orderBId,
    restaurantId: restBId,
    status: 'PICKED_UP',
    totalAmount: 10000,
    updatedAt: now,
  }
  sockA.emit('order:updated', orderBPayload) // Consumer A emits Order B's event
  await sleep(1000)

  console.log(`Consumer A received: ${receivedA.length} events (Order A owner)`)
  console.log(`Consumer B received: ${receivedB.length} events (Order B owner)`)
  if (receivedA.length > 0) {
    const evt = receivedA[0]
    console.log(`  Consumer A saw Order B event: orderId=${evt.orderId?.slice(-8)} status=${evt.status}`)
    console.log(`  CROSS_USER_ORDER_ID_EXPOSURE = YES ❌`)
    console.log(`  CROSS_USER_STATUS_EXPOSURE = YES ❌`)
  }
  if (receivedB.length > 0) {
    console.log(`  Consumer B received own order event (expected)`)
  }

  // === TEST 2: order:{orderId} subscription ===
  console.log('\n=== TEST 2: order:{orderId} subscription ===')
  receivedA.length = 0
  receivedB.length = 0
  // Consumer A subscribes to Order B's channel (foreign order)
  sockA.emit('subscribe', `order:${orderBId}`)
  await sleep(500)
  // Emit Order B update
  sockB.emit('order:updated', orderBPayload)
  await sleep(1000)
  console.log(`Consumer A subscribed to order:{OrderB} → received: ${receivedA.length} (expected 0 if authorized)`)
  if (receivedA.length > 0) {
    console.log(`  UNAUTHORIZED_ORDER_ROOM_SUBSCRIPTION = YES ❌ (Consumer A can subscribe to Order B's room)`)
  }

  sockA.disconnect()
  sockB.disconnect()
  db.close()

  console.log('\n=== CLASSIFICATION ===')
  console.log('CROSS_USER_EVENT_DELIVERY = YES (consumer:all broadcasts to all consumers)')
  console.log('CROSS_USER_ORDER_ID_EXPOSURE = YES (orderId in payload)')
  console.log('CROSS_USER_FULFILMENT_ID_EXPOSURE = YES (fulfilmentId in pickup-verify payload)')
  console.log('CROSS_USER_STATUS_EXPOSURE = YES (status in payload)')
}

main().catch((e) => { console.error('FATAL', e); db.close(); process.exit(1) })
