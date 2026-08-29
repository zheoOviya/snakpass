import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'

const PA = '+15550001S5E', PB = '+15550002S5E', PC = '+15550003S5E'
// Clean prior
const existing = await db.user.findMany({ where: { phone: { in: [PA, PB, PC] } }, select: { id: true } })
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
const a = await db.user.create({ data: { phone: PA, name: 'S5E User A', role: 'CONSUMER', campusId: campus?.id } })
const b = await db.user.create({ data: { phone: PB, name: 'S5E User B', role: 'CONSUMER', campusId: campus?.id } })
const c = await db.user.create({ data: { phone: PC, name: 'S5E User C', role: 'CONSUMER', campusId: campus?.id } })
const sa = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: a.id, role: 'CONSUMER', expiresAt } })
const sb = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: b.id, role: 'CONSUMER', expiresAt } })
const sc = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: c.id, role: 'CONSUMER', expiresAt } })
// A↔B friendship (bidirectional)
await db.socialConnection.create({ data: { followerId: a.id, followeeId: b.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: b.id, followeeId: a.id, status: 'ACCEPTED', acceptedAt: new Date() } })
// A↔C friendship (for multi-actor test — C is also a friend)
await db.socialConnection.create({ data: { followerId: a.id, followeeId: c.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: c.id, followeeId: a.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })
console.log(JSON.stringify({
  userA: { id: a.id, sessionToken: sa.token },
  userB: { id: b.id, sessionToken: sb.token },
  userC: { id: c.id, sessionToken: sc.token },
}, null, 2))
await db.$disconnect()
