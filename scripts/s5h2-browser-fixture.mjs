// S5H2 Browser fixture — Z/Y/X ranking + negatives + zero-signal + cap
import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const CSRF = 's5b-test-csrf-token-fixed'
async function api(session, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type':'application/json','cookie':`snakzap_session=${session};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
  return { status: res.status, json: await res.json().catch(()=>({})) }
}

// Clean ALL prior s5h2 test data
await db.session.deleteMany({ where: { user: { phone: { contains: 's5h2' } } } }).catch(()=>{})
await db.socialActivity.deleteMany({ where: { actor: { phone: { contains: 's5h2' } } } }).catch(()=>{})
await db.like.deleteMany({ where: { user: { phone: { contains: 's5h2' } } } }).catch(()=>{})
await db.socialConnection.deleteMany({ where: { OR: [{ follower: { phone: { contains: 's5h2' } } }, { followee: { phone: { contains: 's5h2' } } }] } }).catch(()=>{})
await db.notification.deleteMany({ where: { user: { phone: { contains: 's5h2' } } } }).catch(()=>{})
await db.order.deleteMany({ where: { user: { phone: { contains: 's5h2' } } } }).catch(()=>{})
await db.user.deleteMany({ where: { phone: { contains: 's5h2' } } }).catch(()=>{})
// Clean old restaurants
await db.restaurant.deleteMany({ where: { name: { contains: 'Restaurant Z' } } }).catch(()=>{})
await db.restaurant.deleteMany({ where: { name: { contains: 'Restaurant Y' } } }).catch(()=>{})
await db.restaurant.deleteMany({ where: { name: { contains: 'Restaurant X' } } }).catch(()=>{})
await db.restaurant.deleteMany({ where: { name: { contains: 'Restaurant Private' } } }).catch(()=>{})
await db.restaurant.deleteMany({ where: { name: { contains: 'Restaurant Blocked' } } }).catch(()=>{})
await db.restaurant.deleteMany({ where: { name: { contains: 'Restaurant NoShare' } } }).catch(()=>{})

const campus = await db.campus.findFirst({ select: { id: true } })
const exp = new Date(Date.now() + 86400000)

// Create users: A (viewer) + B/C/D/E/F/G (friends) + H (blocked friend)
const users = []
for (let i = 0; i < 8; i++) {
  const name = ['Viewer A', 'Friend B', 'Friend C', 'Friend D', 'Friend E', 'Friend F', 'Friend G', 'Blocked H'][i]
  const u = await db.user.create({ data: { phone: `+s5h2br${i}`, name, role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt: exp } })
  users.push({ id: u.id, session: s.token, name })
}
const [A, B, C, D, E, F, G, H] = users

// Friendships: A↔B/C/D/E/F/G/H
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
const restNoShare = await db.restaurant.create({ data: { name: 'Restaurant NoShare', cuisine: 'Test', description: 'N', image: '', rating: 4.2, prepTimeMins: 12, priceForTwo: 280, campusId: campus?.id } })

// Z: 3 friends (B,C,D) + newer (1 day ago)
for (const fr of [B, C, D]) {
  const ord = await db.order.create({ data: { userId: fr.id, restaurantId: restZ.id, status: 'CONFIRMED', totalAmount: 200, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 1*86400000) } })
  await api(fr.session, 'POST', '/api/social/share-order', { orderId: ord.id, visibility: 'FRIENDS' })
}

// Y: 3 friends (E,F,G) + older (10 days ago)
for (const fr of [E, F, G]) {
  const ord = await db.order.create({ data: { userId: fr.id, restaurantId: restY.id, status: 'CONFIRMED', totalAmount: 200, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 10*86400000) } })
  await api(fr.session, 'POST', '/api/social/share-order', { orderId: ord.id, visibility: 'FRIENDS' })
}

// X: 2 friends (B,C) but B has 8 orders
for (let i = 0; i < 8; i++) {
  const ord = await db.order.create({ data: { userId: B.id, restaurantId: restX.id, status: 'CONFIRMED', totalAmount: 150, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 5*86400000 + i*1000) } })
  await api(B.session, 'POST', '/api/social/share-order', { orderId: ord.id, visibility: 'FRIENDS' })
}
const xCord = await db.order.create({ data: { userId: C.id, restaurantId: restX.id, status: 'CONFIRMED', totalAmount: 150, pickupOtp: '000', itemsCount: 1, statusHistory: '[]', createdAt: new Date(Date.now() - 5*86400000) } })
await api(C.session, 'POST', '/api/social/share-order', { orderId: xCord.id, visibility: 'FRIENDS' })

// Private: B has PRIVATE share
const pOrd = await db.order.create({ data: { userId: B.id, restaurantId: restPrivate.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]' } })
await api(B.session, 'POST', '/api/social/share-order', { orderId: pOrd.id, visibility: 'PRIVATE' })

// Blocked: H shares, then A blocks H
const hOrd = await db.order.create({ data: { userId: H.id, restaurantId: restBlocked.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]' } })
await api(H.session, 'POST', '/api/social/share-order', { orderId: hOrd.id, visibility: 'FRIENDS' })
const hConn = await db.socialConnection.findFirst({ where: { followerId: A.id, followeeId: H.id } })
if (hConn) await api(A.session, 'DELETE', `/api/social/connections/${hConn.id}`, { block: true })

// NoShare: B has real order but NO share
const nsOrd = await db.order.create({ data: { userId: B.id, restaurantId: restNoShare.id, status: 'CONFIRMED', totalAmount: 100, pickupOtp: '000', itemsCount: 1, statusHistory: '[]' } })

// Verify API
const proof = await api(A.session, 'GET', '/api/restaurants/friend-ranked')
console.log('Friend-ranked API:', proof.status, JSON.stringify(proof.json?.restaurants?.map(r => ({ name: r.name, friendCount: r.friendCount, rank: r.rankPosition })), null, 2))

writeFileSync('/tmp/s5h2-browser-fixture.json', JSON.stringify({
  A: { id: A.id, session: A.session },
  restZ: restZ.id, restY: restY.id, restX: restX.id,
  restPrivate: restPrivate.id, restBlocked: restBlocked.id, restNoShare: restNoShare.id,
  expectedRank: ['Restaurant Z', 'Restaurant Y', 'Restaurant X'],
  expectedFriendCounts: { Z: 3, Y: 3, X: 2 }
}, null, 2))
console.log('Fixture written')
await db.$disconnect()
