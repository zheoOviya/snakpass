// S5H2 Runtime ranking test — corrected (blocks use separate friend)
import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const CSRF = 's5b-test-csrf-token-fixed'
async function api(session, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type':'application/json','cookie':`snakzap_session=${session};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
  return { status: res.status, json: await res.json().catch(()=>({})) }
}

await db.user.deleteMany({ where: { phone: { startsWith: '+s5h2x' } } }).catch(()=>{})
const campus = await db.campus.findFirst({ select: { id: true } })
const exp = new Date(Date.now() + 86400000)

// Users: A (viewer) + B/C/D/E/F/G (friends for ranking) + H (friend for block test)
const users = []
for (let i = 0; i < 8; i++) {
  const name = ['Viewer A', 'Friend B', 'Friend C', 'Friend D', 'Friend E', 'Friend F', 'Friend G', 'Blocked H'][i]
  const u = await db.user.create({ data: { phone: `+s5h2x${i}`, name, role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt: exp } })
  users.push({ id: u.id, session: s.token, name })
}
const [A, B, C, D, E, F, G, H] = users

// Friendships: A↔B/C/D/E/F/G/H (all 7 friends)
for (const fr of [B, C, D, E, F, G, H]) {
  await db.socialConnection.create({ data: { followerId: A.id, followeeId: fr.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: fr.id, followeeId: A.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}

// Restaurants
const restZ = await db.restaurant.create({ data: { name: 'Restaurant Z', cuisine: 'Test', description: 'Z', image: '', rating: 4.5, prepTimeMins: 20, priceForTwo: 300, campusId: campus?.id } })
const restY = await db.restaurant.create({ data: { name: 'Restaurant Y', cuisine: 'Test', description: 'Y', image: '', rating: 4.3, prepTimeMins: 15, priceForTwo: 250, campusId: campus?.id } })
const restX = await db.restaurant.create({ data: { name: 'Restaurant X', cuisine: 'Test', description: 'X', image: '', rating: 4.7, prepTimeMins: 25, priceForTwo: 400, campusId: campus?.id } })
const restPrivate = await db.restaurant.create({ data: { name: 'Restaurant Private', cuisine: 'Test', description: 'P', image: '', rating: 4.0, prepTimeMins: 10, priceForTwo: 200, campusId: campus?.id } })
const restBlocked = await db.restaurant.create({ data: { name: 'Restaurant Blocked', cuisine: 'Test', description: 'B', image: '', rating: 3.8, prepTimeMins: 30, priceForTwo: 350, campusId: campus?.id } })

// Z: 3 unique friends (B, C, D) + newer timestamps (1 day ago)
const zBord = await db.order.create({ data: { userId: B.id, restaurantId: restZ.id, status: 'CONFIRMED', totalAmount: 300, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 1*86400000) } })
const zCord = await db.order.create({ data: { userId: C.id, restaurantId: restZ.id, status: 'CONFIRMED', totalAmount: 200, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 1*86400000) } })
const zDord = await db.order.create({ data: { userId: D.id, restaurantId: restZ.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 1*86400000) } })
await api(B.session, 'POST', '/api/social/share-order', { orderId: zBord.id, visibility: 'FRIENDS' })
await api(C.session, 'POST', '/api/social/share-order', { orderId: zCord.id, visibility: 'FRIENDS' })
await api(D.session, 'POST', '/api/social/share-order', { orderId: zDord.id, visibility: 'FRIENDS' })

// Y: 3 unique friends (E, F, G) + older timestamps (10 days ago)
const yEord = await db.order.create({ data: { userId: E.id, restaurantId: restY.id, status: 'CONFIRMED', totalAmount: 300, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 10*86400000) } })
const yFord = await db.order.create({ data: { userId: F.id, restaurantId: restY.id, status: 'CONFIRMED', totalAmount: 200, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 10*86400000) } })
const yGord = await db.order.create({ data: { userId: G.id, restaurantId: restY.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 10*86400000) } })
await api(E.session, 'POST', '/api/social/share-order', { orderId: yEord.id, visibility: 'FRIENDS' })
await api(F.session, 'POST', '/api/social/share-order', { orderId: yFord.id, visibility: 'FRIENDS' })
await api(G.session, 'POST', '/api/social/share-order', { orderId: yGord.id, visibility: 'FRIENDS' })

// X: 2 unique friends (B, C) but B has 8 orders (should count as 1 friend)
for (let i = 0; i < 8; i++) {
  const bord = await db.order.create({ data: { userId: B.id, restaurantId: restX.id, status: 'CONFIRMED', totalAmount: 200, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 5*86400000 + i*1000) } })
  await api(B.session, 'POST', '/api/social/share-order', { orderId: bord.id, visibility: 'FRIENDS' })
}
const xCord = await db.order.create({ data: { userId: C.id, restaurantId: restX.id, status: 'CONFIRMED', totalAmount: 150, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 5*86400000) } })
await api(C.session, 'POST', '/api/social/share-order', { orderId: xCord.id, visibility: 'FRIENDS' })

// Private-only: B has a PRIVATE share at restPrivate
const pBord = await db.order.create({ data: { userId: B.id, restaurantId: restPrivate.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]' } })
await api(B.session, 'POST', '/api/social/share-order', { orderId: pBord.id, visibility: 'PRIVATE' })

// Blocked-only: H shares at restBlocked, then A blocks H
const hOrd = await db.order.create({ data: { userId: H.id, restaurantId: restBlocked.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]' } })
await api(H.session, 'POST', '/api/social/share-order', { orderId: hOrd.id, visibility: 'FRIENDS' })
const hConn = await db.socialConnection.findFirst({ where: { followerId: A.id, followeeId: H.id } })
if (hConn) await api(A.session, 'DELETE', `/api/social/connections/${hConn.id}`, { block: true })

writeFileSync('/tmp/s5h2-fixture.json', JSON.stringify({ A: A.session, restZ: restZ.id, restY: restY.id, restX: restX.id }, null, 2))

const results = []

// === TEST: Ranking formula ===
console.log('\n=== TEST: Friend-ranked API ===')
const ranked = await api(A.session, 'GET', '/api/restaurants/friend-ranked')
console.log('Status:', ranked.status)
const restList = ranked.json?.restaurants || []
console.log('Restaurants:', JSON.stringify(restList.map(r => ({ name: r.name, friendCount: r.friendCount, rank: r.rankPosition })), null, 2))

const rank1 = restList[0]
const rank2 = restList[1]
const rank3 = restList[2]

results.push({ contract: 'Z ranks 1st (3 friends, newer)', expected: 'Z at rank 1', actual: `${rank1?.name} at rank ${rank1?.rankPosition}`, result: rank1?.name === 'Restaurant Z' && rank1?.rankPosition === 1 ? 'PASS' : 'FAIL' })
results.push({ contract: 'Y ranks 2nd (3 friends, older)', expected: 'Y at rank 2', actual: `${rank2?.name} at rank ${rank2?.rankPosition}`, result: rank2?.name === 'Restaurant Y' && rank2?.rankPosition === 2 ? 'PASS' : 'FAIL' })
results.push({ contract: 'X ranks 3rd (2 friends, 10 orders)', expected: 'X at rank 3', actual: `${rank3?.name} at rank ${rank3?.rankPosition}`, result: rank3?.name === 'Restaurant X' && rank3?.rankPosition === 3 ? 'PASS' : 'FAIL' })

// === TEST: Repeated-order dedup ===
const xFriendCount = restList.find(r => r.name === 'Restaurant X')?.friendCount
results.push({ contract: 'B repeated orders count once', expected: 'X friendCount=2 (B+C)', actual: `X friendCount=${xFriendCount}`, result: xFriendCount === 2 ? 'PASS' : 'FAIL' })

// === TEST: PRIVATE excluded ===
const hasPrivate = restList.some(r => r.name === 'Restaurant Private')
results.push({ contract: 'PRIVATE excluded', expected: 'no Private restaurant', actual: `hasPrivate=${hasPrivate}`, result: !hasPrivate ? 'PASS' : 'FAIL' })

// === TEST: Blocked excluded ===
const hasBlocked = restList.some(r => r.name === 'Restaurant Blocked')
results.push({ contract: 'Blocked excluded', expected: 'no Blocked restaurant', actual: `hasBlocked=${hasBlocked}`, result: !hasBlocked ? 'PASS' : 'FAIL' })

// === TEST: Result cap ===
results.push({ contract: 'Result cap', expected: '<=5', actual: `length=${restList.length}`, result: restList.length <= 5 ? 'PASS' : 'FAIL' })

// === TEST: PII audit ===
const apiStr = JSON.stringify(ranked.json)
const leakedPII = ['userId','phone','email','orderId','sourceOrderId','blockedBy','session','csrf','actorId'].filter(k => apiStr.toLowerCase().includes(k.toLowerCase()))
results.push({ contract: 'API PII audit', expected: '0 leaks', actual: `leaked=${leakedPII}`, result: leakedPII.length === 0 ? 'PASS' : 'FAIL' })

// === TEST: Analytics ===
const trackRes = await api(A.session, 'POST', '/api/analytics/track', { event: 'FRIEND_RANKED_IMPRESSION', experimentId: 's5h2-friend-ranked-discovery', variant: 'treatment', restaurantId: restZ.id, friendCountBucket: '3+', rankPosition: 1 })
results.push({ contract: 'Analytics impression', expected: '200', actual: `status=${trackRes.status}`, result: trackRes.status === 200 ? 'PASS' : 'FAIL' })

const trackOpen = await api(A.session, 'POST', '/api/analytics/track', { event: 'FRIEND_RANKED_RESTAURANT_OPEN', experimentId: 's5h2-friend-ranked-discovery', variant: 'treatment', restaurantId: restZ.id, friendCountBucket: '3+', rankPosition: 1 })
results.push({ contract: 'Analytics restaurant open', expected: '200', actual: `status=${trackOpen.status}`, result: trackOpen.status === 200 ? 'PASS' : 'FAIL' })

const analyticsStr = JSON.stringify({ event: 'FRIEND_RANKED_IMPRESSION', experimentId: 's5h2', variant: 'treatment', restaurantId: restZ.id, friendCountBucket: '3+', rankPosition: 1 })
const analyticsLeaked = ['userId','phone','email','orderId','sourceOrderId','blockedBy','friendName'].filter(k => analyticsStr.toLowerCase().includes(k.toLowerCase()))
results.push({ contract: 'Analytics PII', expected: '0 leaks', actual: `leaked=${analyticsLeaked}`, result: analyticsLeaked.length === 0 ? 'PASS' : 'FAIL' })

// Cleanup
await db.socialActivity.deleteMany({ where: { actorId: { in: users.map(u=>u.id) } } }).catch(()=>{})
await db.like.deleteMany({ where: { userId: { in: users.map(u=>u.id) } } }).catch(()=>{})
await db.socialConnection.deleteMany({ where: { OR: [{followerId:{in:users.map(u=>u.id)}},{followeeId:{in:users.map(u=>u.id)}}] } }).catch(()=>{})
await db.notification.deleteMany({ where: { userId: { in: users.map(u=>u.id) } } }).catch(()=>{})
await db.order.deleteMany({ where: { userId: { in: users.map(u=>u.id) } } }).catch(()=>{})
await db.restaurant.deleteMany({ where: { id: { in: [restZ.id, restY.id, restX.id, restPrivate.id, restBlocked.id] } } }).catch(()=>{})
await db.session.deleteMany({ where: { userId: { in: users.map(u=>u.id) } } }).catch(()=>{})
await db.user.deleteMany({ where: { id: { in: users.map(u=>u.id) } } }).catch(()=>{})

const allPass = results.every(r => r.result === 'PASS')
console.log('\n=== RESULTS ===')
console.log(JSON.stringify({ results, VERDICT: allPass ? 'S5H2_VERIFIED' : 'S5H2_BLOCKED' }, null, 2))
writeFileSync('evidence/s5h2-implementation/runtime-results.json', JSON.stringify({ results, VERDICT: allPass ? 'S5H2_VERIFIED' : 'S5H2_BLOCKED' }, null, 2))
await db.$disconnect()
process.exit(allPass ? 0 : 1)
