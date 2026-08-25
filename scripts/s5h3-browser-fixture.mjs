import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const CSRF = 's5b-test-csrf-token-fixed'
async function api(session, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type':'application/json','cookie':`snakzap_session=${session};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
  return { status: res.status, json: await res.json().catch(()=>({})) }
}

// Clean ALL prior s5h3 test data
await db.session.deleteMany({ where: { user: { phone: { contains: 's5h3' } } } }).catch(()=>{})
await db.socialActivity.deleteMany({ where: { actor: { phone: { contains: 's5h3' } } } }).catch(()=>{})
await db.like.deleteMany({ where: { user: { phone: { contains: 's5h3' } } } }).catch(()=>{})
await db.socialConnection.deleteMany({ where: { OR: [{ follower: { phone: { contains: 's5h3' } } }, { followee: { phone: { contains: 's5h3' } } }] } }).catch(()=>{})
await db.notification.deleteMany({ where: { user: { phone: { contains: 's5h3' } } } }).catch(()=>{})
await db.order.deleteMany({ where: { user: { phone: { contains: 's5h3' } } } }).catch(()=>{})
await db.user.deleteMany({ where: { phone: { contains: 's5h3' } } }).catch(()=>{})

const campus = await db.campus.findFirst({ select: { id: true } })
const exp = new Date(Date.now() + 86400000)

// Users: A (viewer, 2 friends), B+C (A's friends), D/E/F/G/H/I (candidates)
// To get C=3 mutuals: A needs 3 friends. But A must have <=2 friends (eligible).
// Solution: A has 2 friends (B1, B2). C is connected to B1, B2, and B3 (who is NOT A's friend but IS C's friend)
// Wait — mutual count = how many of A's friends are also C's friends.
// A has 2 friends (B1, B2). So max mutuals = 2 for any candidate.
// 
// Actually the contract says C=3 mutuals, but A can only have 2 friends for eligibility.
// So we need A to have exactly 2 friends, and:
// - C connects to BOTH of A's friends → C has 2 mutuals (max possible with 2 friends)
// - D connects to 1 of A's friends → D has 1 mutual
// - E connects to 1 of A's friends → E has 1 mutual
//
// With 2 friends, max mutuals = 2. So the fixture is:
// C(2 mutuals) > D(1 mutual) > E(1 mutual, by id tiebreaker)
//
// For a proper 3-mutual test, A would need 3 friends — but then A is ineligible.
// This is a fundamental constraint: eligibility (<=2 friends) limits mutuals to max 2.
//
// So the correct fixture is: D(2 mutuals) rank 1, E(1 mutual) rank 2
// The contract's "C=3, D=2, E=1" was hypothetical — not achievable with <=2 friends.

// Create users: A + B1 + B2 (A's friends) + D + E + F (blocked) + G (pending)
const users = []
for (let i = 0; i < 7; i++) {
  const name = ['Viewer A', 'Friend B1', 'Friend B2', 'Candidate D (2 mutuals)', 'Candidate E (1 mutual)', 'Candidate F (blocked)', 'Candidate G (pending)'][i]
  const u = await db.user.create({ data: { phone: `+s5h3br${i}`, name, role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt: exp } })
  users.push({ id: u.id, session: s.token, name })
}
const [A, B1, B2, D, E, F, G] = users

// A→B1 (accepted), A→B2 (accepted) = 2 friends = eligible
for (const fr of [B1, B2]) {
  await db.socialConnection.create({ data: { followerId: A.id, followeeId: fr.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: fr.id, followeeId: A.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}

// D connects to BOTH B1 and B2 → D has 2 mutuals
for (const fr of [B1, B2]) {
  await db.socialConnection.create({ data: { followerId: fr.id, followeeId: D.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: D.id, followeeId: fr.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}

// E connects to B1 only → E has 1 mutual
await db.socialConnection.create({ data: { followerId: B1.id, followeeId: E.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: E.id, followeeId: B1.id, status: 'ACCEPTED', acceptedAt: new Date() } })

// F connects to B1 and B2 → would have 2 mutuals, but A blocks F
await db.socialConnection.create({ data: { followerId: B1.id, followeeId: F.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: F.id, followeeId: B1.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: B2.id, followeeId: F.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: F.id, followeeId: B2.id, status: 'ACCEPTED', acceptedAt: new Date() } })
// A blocks F
await db.socialConnection.create({ data: { followerId: A.id, followeeId: F.id, status: 'BLOCKED', blockedBy: A.id } })

// G has pending request from A → excluded
await db.socialConnection.create({ data: { followerId: A.id, followeeId: G.id, status: 'PENDING' } })

// Verify API
const seed = await api(A.session, 'GET', '/api/social/friend-seed')
console.log('Seed:', seed.status, JSON.stringify(seed.json?.candidates?.map(c => ({ name: c.name, mutuals: c.mutualCountBucket, reason: c.reason })), null, 2))

writeFileSync('/tmp/s5h3-br-fixture.json', JSON.stringify({ A: A.session, D: D.name, E: E.name, F: F.name, G: G.name }, null, 2))
console.log('Fixture written')
await db.$disconnect()
