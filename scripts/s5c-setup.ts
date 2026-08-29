// S5C setup: assign campus to test users, output config for test scripts
import { db } from '../src/lib/db'
const campus = await db.campus.findFirst({ select: { id: true } })
if (campus) {
  await db.user.update({ where: { id: 'cmt88zbm00000mbwgo6vhssdj' }, data: { campusId: campus.id } })
  await db.user.update({ where: { id: 'cmt88zbm20001mbwgbq6qv8ck' }, data: { campusId: campus.id } })
}
// Clean any prior connections/notifications for these users
await db.socialConnection.deleteMany({ where: { OR: [{ followerId: 'cmt88zbm00000mbwgo6vhssdj' }, { followeeId: 'cmt88zbm00000mbwgo6vhssdj' }, { followerId: 'cmt88zbm20001mbwgbq6qv8ck' }, { followeeId: 'cmt88zbm20001mbwgbq6qv8ck' }] } })
await db.notification.deleteMany({ where: { userId: { in: ['cmt88zbm00000mbwgo6vhssdj', 'cmt88zbm20001mbwgbq6qv8ck'] } } })
await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })
console.log(JSON.stringify({
  userA: { id: 'cmt88zbm00000mbwgo6vhssdj', sessionToken: 'c2f4252722fded6b12279fc4147c5cee5cd795c5acb08ae1b222b78ec6f35051' },
  userB: { id: 'cmt88zbm20001mbwgbq6qv8ck', sessionToken: 'f78ec31a4ea534134d68b1abd8f48e9703803628ab5f0d351956b1310a8e0c84' },
}, null, 2))
await db.$disconnect()
