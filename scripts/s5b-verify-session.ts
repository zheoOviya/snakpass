import { db } from '../src/lib/db'
const s = await db.session.findUnique({ where: { token: 'e0a2ba5b2955092267e2d908aca3989294cde80244095a5d2f88a35f6119c375' }, select: { token: true, userId: true, expiresAt: true } })
console.log('Session A:', JSON.stringify(s))
const s2 = await db.session.findUnique({ where: { token: '1ed7c025a237d739225894682166bfb9753250a093a84ca353fda33c2eebbe7d' }, select: { token: true, userId: true, expiresAt: true } })
console.log('Session B:', JSON.stringify(s2))
await db.$disconnect()
