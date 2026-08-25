// S5H1 Runtime Trust Matrix Test
import { randomBytes } from 'crypto'
import { readFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const CSRF = 's5b-test-csrf-token-fixed'

async function api(session, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type':'application/json','cookie':`snakzap_session=${session};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  })
  return { status: res.status, json: await res.json().catch(()=>({})) }
}

// Step 1: Create test users + sessions + restaurant + order via DB
const { db } = await import('../src/lib/db')

const PA = '+s5h1testA', PB = '+s5h1testB'
// Clean
await db.user.deleteMany({ where: { phone: { in: [PA, PB] } } }).catch(()=>{})
const campus = await db.campus.findFirst({ select: { id: true } })
const exp = new Date(Date.now() + 86400000)

const a = await db.user.create({ data: { phone: PA, name: 'S5H1 A', role: 'CONSUMER', campusId: campus?.id } })
const b = await db.user.create({ data: { phone: PB, name: 'S5H1 B', role: 'CONSUMER', campusId: campus?.id } })
const sa = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: a.id, role: 'CONSUMER', expiresAt: exp } })
const sb = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: b.id, role: 'CONSUMER', expiresAt: exp } })

// Create restaurant
const rest = await db.restaurant.create({ data: { name: 'S5H1 Test Restaurant', cuisine: 'Test', description: 'Test', image: '', rating: 4.5, prepTimeMins: 20, priceForTwo: 300, campusId: campus?.id } })

// Create real order for B at this restaurant (status=CONFIRMED)
const order = await db.order.create({ data: { userId: b.id, restaurantId: rest.id, status: 'CONFIRMED', totalAmount: 500, pickupOtp: '123456', itemsCount: 2, statusHistory: '[]' } })

// Create friendship A↔B
await db.socialConnection.create({ data: { followerId: a.id, followeeId: b.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: b.id, followeeId: a.id, status: 'ACCEPTED', acceptedAt: new Date() } })

console.log('Setup: A='+a.id.substring(0,8)+', B='+b.id.substring(0,8)+', Rest='+rest.id.substring(0,8)+', Order='+order.id.substring(0,8))

const results = []

// === TEST 1: B shares order (FRIENDS) → A sees social proof ===
console.log('\n=== TEST 1: B shares order (FRIENDS) ===')
const share1 = await api(sb.token, 'POST', '/api/social/share-order', { orderId: order.id, visibility: 'FRIENDS' })
console.log('Share:', share1.status, JSON.stringify(share1.json))
const proof1 = await api(sa.token, 'GET', `/api/restaurants/${rest.id}/social-proof`)
console.log('Proof (A sees):', proof1.status, JSON.stringify(proof1.json))
results.push({ test: 'T1_share_FRIENDS_A_sees', shareStatus: share1.status, proofStatus: proof1.status, friendCount: proof1.json?.friendOrderCount, hasB: proof1.json?.friends?.some(f => f.name === 'S5H1 B'), result: share1.status === 201 && proof1.json?.friendOrderCount === 1 && proof1.json?.friends?.some(f => f.name === 'S5H1 B') ? 'PASS' : 'FAIL' })

// === TEST 2: B shares same order again (idempotent) ===
console.log('\n=== TEST 2: B shares same order again (idempotent) ===')
const share2 = await api(sb.token, 'POST', '/api/social/share-order', { orderId: order.id, visibility: 'FRIENDS' })
console.log('Share2:', share2.status, JSON.stringify(share2.json))
results.push({ test: 'T2_idempotent_share', status: share2.status, idempotent: share2.json?.idempotent, result: share2.status === 200 && share2.json?.idempotent === true ? 'PASS' : 'FAIL' })

// === TEST 3: A tries to share B's order (403 — not owner) ===
console.log('\n=== TEST 3: A tries to share B order (403) ===')
const share3 = await api(sa.token, 'POST', '/api/social/share-order', { orderId: order.id })
console.log('Share3:', share3.status, JSON.stringify(share3.json))
results.push({ test: 'T3_not_owner_403', status: share3.status, result: share3.status === 403 ? 'PASS' : 'FAIL' })

// === TEST 4: B shares non-existent order (404) ===
console.log('\n=== TEST 4: B shares non-existent order (404) ===')
const share4 = await api(sb.token, 'POST', '/api/social/share-order', { orderId: 'nonexistent-order' })
console.log('Share4:', share4.status, JSON.stringify(share4.json))
results.push({ test: 'T4_not_found_404', status: share4.status, result: share4.status === 404 ? 'PASS' : 'FAIL' })

// === TEST 5: Block B → A no longer sees social proof ===
console.log('\n=== TEST 5: A blocks B → proof disappears ===')
const conn = await db.socialConnection.findFirst({ where: { followerId: a.id, followeeId: b.id } })
await api(sa.token, 'DELETE', `/api/social/connections/${conn.id}`, { block: true })
await new Promise(r => setTimeout(r, 500))
const proof5 = await api(sa.token, 'GET', `/api/restaurants/${rest.id}/social-proof`)
console.log('Proof after block:', proof5.status, JSON.stringify(proof5.json))
results.push({ test: 'T5_block_excludes', friendCount: proof5.json?.friendOrderCount, result: proof5.json?.friendOrderCount === 0 ? 'PASS' : 'FAIL' })

// === TEST 6: Unblock (no refriend) → still excluded ===
console.log('\n=== TEST 6: Unblock (no refriend) → still excluded ===')
await api(sa.token, 'PATCH', `/api/social/connections/${conn.id}`, { status: 'UNBLOCKED' })
await new Promise(r => setTimeout(r, 500))
const proof6 = await api(sa.token, 'GET', `/api/restaurants/${rest.id}/social-proof`)
console.log('Proof after unblock:', proof6.status, JSON.stringify(proof6.json))
results.push({ test: 'T6_unblock_no_refriend_excluded', friendCount: proof6.json?.friendOrderCount, result: proof6.json?.friendOrderCount === 0 ? 'PASS' : 'FAIL' })

// === TEST 7: Re-friend → proof reappears ===
console.log('\n=== TEST 7: Re-friend → proof reappears ===')
await db.socialConnection.create({ data: { followerId: a.id, followeeId: b.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: b.id, followeeId: a.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await new Promise(r => setTimeout(r, 500))
const proof7 = await api(sa.token, 'GET', `/api/restaurants/${rest.id}/social-proof`)
console.log('Proof after refriend:', proof7.status, JSON.stringify(proof7.json))
results.push({ test: 'T7_refriend_proof_reappears', friendCount: proof7.json?.friendOrderCount, result: proof7.json?.friendOrderCount === 1 ? 'PASS' : 'FAIL' })

// === TEST 8: Fake activity (POST /api/social/activities without sourceOrderId) → excluded ===
console.log('\n=== TEST 8: Fake activity (no sourceOrderId) → excluded ===')
const fakeAct = await api(sb.token, 'POST', '/api/social/activities', { verb: 'ORDERED', objectType: 'Restaurant', objectId: rest.id, visibility: 'FRIENDS', metadata: { restaurantName: 'Fake' } })
console.log('Fake activity:', fakeAct.status, JSON.stringify(fakeAct.json))
const proof8 = await api(sa.token, 'GET', `/api/restaurants/${rest.id}/social-proof`)
console.log('Proof (fake excluded):', proof8.status, JSON.stringify(proof8.json))
// Should still be 1 (real share), not 2 (fake doesn't count)
results.push({ test: 'T8_fake_activity_excluded', friendCount: proof8.json?.friendOrderCount, result: proof8.json?.friendOrderCount === 1 ? 'PASS' : 'FAIL' })

// === TEST 9: PII audit — no userId/phone/email in response ===
console.log('\n=== TEST 9: PII audit ===')
const proofStr = JSON.stringify(proof7.json)
const leaked = ['userId','phone','email','blockedBy','orderId','paymentId','amount'].filter(k => proofStr.toLowerCase().includes(k.toLowerCase()))
console.log('Leaked PII:', leaked)
results.push({ test: 'T9_pii_audit', leakedPII: leaked, result: leaked.length === 0 ? 'PASS' : 'FAIL' })

// Cleanup
await db.socialActivity.deleteMany({ where: { actorId: { in: [a.id, b.id] } } })
await db.like.deleteMany({ where: { userId: { in: [a.id, b.id] } } })
await db.socialConnection.deleteMany({ where: { OR: [{followerId:a.id},{followeeId:a.id},{followerId:b.id},{followeeId:b.id}] } })
await db.notification.deleteMany({ where: { userId: { in: [a.id, b.id] } } })
await db.order.deleteMany({ where: { id: order.id } })
await db.restaurant.deleteMany({ where: { id: rest.id } })
await db.session.deleteMany({ where: { userId: { in: [a.id, b.id] } } })
await db.user.deleteMany({ where: { id: { in: [a.id, b.id] } } })

const allPass = results.every(r => r.result === 'PASS')
console.log('\n=== RESULTS ===')
console.log(JSON.stringify({ results, VERDICT: allPass ? 'S5H1_VERIFIED' : 'S5H1_BLOCKED' }, null, 2))
await db.$disconnect()
process.exit(allPass ? 0 : 1)
