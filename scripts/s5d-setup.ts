import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'

const PA = '+15550001S5D', PB = '+15550002S5D', PC = '+15550003S5D'

// Clean prior
const existing = await db.user.findMany({ where: { phone: { in: [PA, PB, PC] } }, select: { id: true } })
if (existing.length > 0) {
  await db.session.deleteMany({ where: { userId: { in: existing.map(u=>u.id) } } })
  await db.socialConnection.deleteMany({ where: { OR: [{followerId:{in:existing.map(u=>u.id)}},{followeeId:{in:existing.map(u=>u.id)}}] } })
  await db.notification.deleteMany({ where: { userId: { in: existing.map(u=>u.id) } } })
  await db.socialActivity.deleteMany({ where: { actorId: { in: existing.map(u=>u.id) } } })
  await db.user.deleteMany({ where: { id: { in: existing.map(u=>u.id) } } })
}

const campus = await db.campus.findFirst({ select: { id: true } })
const expiresAt = new Date(Date.now() + 7*24*60*60*1000)
const a = await db.user.create({ data: { phone: PA, name: 'S5D User A', role: 'CONSUMER', campusId: campus?.id } })
const b = await db.user.create({ data: { phone: PB, name: 'S5D User B', role: 'CONSUMER', campusId: campus?.id } })
const c = await db.user.create({ data: { phone: PC, name: 'S5D User C', role: 'CONSUMER', campusId: campus?.id } })
const sa = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: a.id, role: 'CONSUMER', expiresAt } })
const sb = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: b.id, role: 'CONSUMER', expiresAt } })
const sc = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: c.id, role: 'CONSUMER', expiresAt } })

// Establish A↔B friendship (bidirectional ACCEPTED)
await db.socialConnection.create({ data: { followerId: a.id, followeeId: b.id, status: 'ACCEPTED', acceptedAt: new Date() } })
await db.socialConnection.create({ data: { followerId: b.id, followeeId: a.id, status: 'ACCEPTED', acceptedAt: new Date() } })
// C is NOT friends with A

// Clean prior S5D outbox events
await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })

console.log(JSON.stringify({
  userA: { id: a.id, name: a.name, sessionToken: sa.token },
  userB: { id: b.id, name: b.name, sessionToken: sb.token },
  userC: { id: c.id, name: c.name, sessionToken: sc.token },
  friendship: 'A↔B ACCEPTED, C isolated',
}, null, 2))
await db.$disconnect()
