import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
const campus = await db.campus.findFirst({ select: { id: true } })
const a = await db.user.create({ data: { phone: '+s5h4regA3', name: 'RegA', role: 'CONSUMER', campusId: campus?.id } })
const b = await db.user.create({ data: { phone: '+s5h4regB3', name: 'RegB', role: 'CONSUMER', campusId: campus?.id } })
const sa = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: a.id, role: 'CONSUMER', expiresAt: new Date(Date.now()+86400000) } })
const CSRF = 's5b-test-csrf-token-fixed'
const res = await fetch('http://localhost:3000/api/social/connections', {
  method: 'POST',
  headers: { 'content-type':'application/json','cookie':'snakzap_session='+sa.token+';snakzap_csrf='+CSRF,'x-csrf-token':CSRF },
  body: JSON.stringify({ followeeId: b.id })
})
console.log('Status:', res.status)
const j = await res.json()
console.log(JSON.stringify(j).substring(0,200))
await db.session.deleteMany({ where: { userId: { in: [a.id, b.id] } } })
await db.user.deleteMany({ where: { id: { in: [a.id, b.id] } } })
await db.$disconnect()
