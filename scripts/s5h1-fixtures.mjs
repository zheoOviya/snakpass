// S5H1 Browser Test Fixtures — create test data via DB + API
import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'

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

// Clean prior
await db.user.deleteMany({ where: { phone: { startsWith: '+s5h1br' } } }).catch(()=>{})

const campus = await db.campus.findFirst({ select: { id: true } })
const exp = new Date(Date.now() + 86400000)

// Create 6 users: A (viewer), B/C/D/E (friends), F (non-friend)
const users = []
for (let i = 0; i < 6; i++) {
  const name = ['Viewer A', 'Friend B', 'Friend C', 'Friend D', 'Friend E', 'NonFriend F'][i]
  const u = await db.user.create({ data: { phone: `+s5h1br${i}`, name, role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt: exp } })
  users.push({ id: u.id, session: s.token, name })
}

const [A, B, C, D, E, F] = users

// Create restaurant
const rest = await db.restaurant.create({ data: { name: 'S5H1 Browser Test Dosa Den', cuisine: 'South Indian', description: 'Test restaurant', image: '', rating: 4.5, prepTimeMins: 20, priceForTwo: 300, campusId: campus?.id } })

// Establish friendships: A↔B, A↔C, A↔D, A↔E (F is non-friend)
for (const friend of [B, C, D, E]) {
  await db.socialConnection.create({ data: { followerId: A.id, followeeId: friend.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: friend.id, followeeId: A.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}

// Create real orders for B, C, D, E at this restaurant (all CONFIRMED)
const orders = {}
for (const friend of [B, C, D, E]) {
  orders[friend.name] = await db.order.create({ data: { userId: friend.id, restaurantId: rest.id, status: 'CONFIRMED', totalAmount: 500, pickupOtp: '123456', itemsCount: 2, statusHistory: '[]' } })
}

// B also has a CANCELLED order (should not count)
const cancelledOrder = await db.order.create({ data: { userId: B.id, restaurantId: rest.id, status: 'CANCELLED', totalAmount: 300, pickupOtp: '000000', itemsCount: 1, statusHistory: '[]' } })

// Share orders:
// B → FRIENDS share
await api(B.session, 'POST', '/api/social/share-order', { orderId: orders['Friend B'].id, visibility: 'FRIENDS' })
// C → PUBLIC share
await api(C.session, 'POST', '/api/social/share-order', { orderId: orders['Friend C'].id, visibility: 'PUBLIC' })
// D → PRIVATE share (should NOT be visible)
await api(D.session, 'POST', '/api/social/share-order', { orderId: orders['Friend D'].id, visibility: 'PRIVATE' })
// E → NO share (order exists but no SocialActivity)

// F (non-friend) also has an order and shared it FRIENDS
const ford = await db.order.create({ data: { userId: F.id, restaurantId: rest.id, status: 'CONFIRMED', totalAmount: 200, pickupOtp: '000000', itemsCount: 1, statusHistory: '[]' } })
await api(F.session, 'POST', '/api/social/share-order', { orderId: ford.id, visibility: 'FRIENDS' })

// Write fixture data for browser tests
const fixture = {
  A: { id: A.id, session: A.session, name: A.name },
  B: { id: B.id, session: B.session, name: B.name },
  C: { id: C.id, session: C.session, name: C.name },
  D: { id: D.id, session: D.session, name: D.name },
  E: { id: E.id, session: E.session, name: E.name },
  F: { id: F.id, session: F.session, name: F.name },
  restaurantId: rest.id,
  restaurantName: 'S5H1 Browser Test Dosa Den',
  // Expected: B (FRIENDS), C (PUBLIC) visible. D (PRIVATE), E (no share), F (non-friend) excluded.
  expectedFriendCount: 2, // B + C
  cancelledOrderId: cancelledOrder.id,
}

writeFileSync('/tmp/s5h1-fixture.json', JSON.stringify(fixture, null, 2))
console.log(JSON.stringify(fixture, null, 2))
await db.$disconnect()
