import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'

// Create N test users with sessions + friendships for scale testing
const N = 50 // target 50 simultaneous sockets (practical for SQLite dev)
const phones = Array.from({length: N}, (_, i) => `+15550${String(i+1).padStart(4,'0')}S5G`)

// Clean prior
const existing = await db.user.findMany({ where: { phone: { in: phones } }, select: { id: true } })
if (existing.length > 0) {
  await db.session.deleteMany({ where: { userId: { in: existing.map(u=>u.id) } } })
  await db.socialConnection.deleteMany({ where: { OR: [{followerId:{in:existing.map(u=>u.id)}},{followeeId:{in:existing.map(u=>u.id)}}] } })
  await db.notification.deleteMany({ where: { userId: { in: existing.map(u=>u.id) } } })
  await db.socialActivity.deleteMany({ where: { actorId: { in: existing.map(u=>u.id) } } })
  await db.like.deleteMany({ where: { userId: { in: existing.map(u=>u.id) } } })
  await db.user.deleteMany({ where: { id: { in: existing.map(u=>u.id) } } })
}

const campus = await db.campus.findFirst({ select: { id: true } })
const expiresAt = new Date(Date.now() + 7*24*60*60*1000)

// Create users
const users: {id:string, sessionToken:string, name:string}[] = []
for (let i = 0; i < N; i++) {
  const u = await db.user.create({ data: { phone: phones[i], name: `S5G User ${i+1}`, role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt } })
  users.push({ id: u.id, sessionToken: s.token, name: u.name! })
}

// User 1 is the "actor" — connect all others as friends of User 1
const actor = users[0]
for (let i = 1; i < N; i++) {
  const friend = users[i]
  await db.socialConnection.create({ data: { followerId: actor.id, followeeId: friend.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: friend.id, followeeId: actor.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}

await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })
console.log(JSON.stringify({ userCount: N, actorId: actor.id, actorSession: actor.sessionToken, firstFriendSession: users[1].sessionToken, lastFriendSession: users[N-1].sessionToken, friendship: `User 1 ↔ Users 2..${N} (all ACCEPTED)` }, null, 2))
await db.$disconnect()
