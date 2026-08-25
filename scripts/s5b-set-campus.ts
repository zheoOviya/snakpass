import { db } from '../src/lib/db'
// Assign a campus to both test users (app requires campus selection)
const campus = await db.campus.findFirst({ select: { id: true, name: true } })
console.log('Campus:', JSON.stringify(campus))
if (campus) {
  await db.user.update({ where: { id: 'cmt869z0c0000mbp5anxn5bpf' }, data: { campusId: campus.id } })
  await db.user.update({ where: { id: 'cmt869z0e0001mbp534g2ca2j' }, data: { campusId: campus.id } })
  console.log('Campus assigned to both test users')
}
await db.$disconnect()
