import { db } from '../src/lib/db'
const users = await db.user.findMany({ select: { id: true, phone: true, name: true, role: true }, take: 15 })
console.log('USERS:', JSON.stringify(users, null, 2))
const sessions = await db.session.findMany({ select: { token: true, userId: true, expiresAt: true }, take: 15 })
console.log('SESSIONS:', JSON.stringify(sessions, null, 2))
await db.$disconnect()
