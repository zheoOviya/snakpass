import { db } from '../src/lib/db'
await db.socialConnection.deleteMany({ where: { OR: [{ followerId: 'cmt869z0c0000mbp5anxn5bpf' }, { followeeId: 'cmt869z0c0000mbp5anxn5bpf' }, { followerId: 'cmt869z0e0001mbp534g2ca2j' }, { followeeId: 'cmt869z0e0001mbp534g2ca2j' }] } })
await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })
console.log('Cleaned up connections + outbox for S5B test users')
await db.$disconnect()
