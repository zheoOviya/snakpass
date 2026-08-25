import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
const N = 100
const phones = Array.from({length: N}, (_, i) => `+1555${String(i+1).padStart(5,'0')}S5G`)
// Clean prior S5G users
const existing = await db.user.findMany({ where: { phone: { startsWith: '+1555', endsWith: 'S5G' } }, select: { id: true } })
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
const users: {id:string, sessionToken:string}[] = []
for (let i = 0; i < N; i++) {
  const u = await db.user.create({ data: { phone: phones[i], name: `S5G U${i+1}`, role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt } })
  users.push({ id: u.id, sessionToken: s.token })
}
// Actor = user 0, friends = users 1..99
const actor = users[0]
for (let i = 1; i < N; i++) {
  await db.socialConnection.create({ data: { followerId: actor.id, followeeId: users[i].id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: users[i].id, followeeId: actor.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}
await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })
console.log(JSON.stringify({ userCount: N, actorId: actor.id, actorSession: actor.sessionToken, friends: N-1 }))
await db.$disconnect()
