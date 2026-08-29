// S5B Phase 1: Create two dedicated test users (A, B) with valid sessions.
// These users are isolated for S5B evidence and won't interfere with existing data.
import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'

const PHONE_A = '+15550001A5B'
const PHONE_B = '+15550002A5B'

// Clean up any prior S5B users (idempotent re-run)
const existing = await db.user.findMany({ where: { phone: { in: [PHONE_A, PHONE_B] } }, select: { id: true } })
if (existing.length > 0) {
  await db.session.deleteMany({ where: { userId: { in: existing.map(u => u.id) } } })
  await db.socialConnection.deleteMany({ where: { OR: [{ followerId: { in: existing.map(u => u.id) } }, { followeeId: { in: existing.map(u => u.id) } }] } })
  await db.user.deleteMany({ where: { id: { in: existing.map(u => u.id) } } })
  console.log('Cleaned up prior S5B users')
}

// Create User A and User B
const userA = await db.user.create({ data: { phone: PHONE_A, name: 'S5B User A', role: 'CONSUMER' } })
const userB = await db.user.create({ data: { phone: PHONE_B, name: 'S5B User B', role: 'CONSUMER' } })

// Create sessions (valid for 7 days)
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const sessionA = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: userA.id, role: 'CONSUMER', expiresAt } })
const sessionB = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: userB.id, role: 'CONSUMER', expiresAt } })

// Output for capture
const result = {
  userA: { id: userA.id, name: userA.name, phone: userA.phone, sessionToken: sessionA.token },
  userB: { id: userB.id, name: userB.name, phone: userB.phone, sessionToken: sessionB.token },
}
console.log(JSON.stringify(result, null, 2))

await db.$disconnect()
