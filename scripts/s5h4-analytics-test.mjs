import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const CSRF = 's5b-test-csrf-token-fixed'
async function api(session, method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type':'application/json','cookie':`snakzap_session=${session};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
  return { status: res.status, json: await res.json().catch(()=>({})) }
}

await db.user.deleteMany({ where: { phone: '+s5h4test' } }).catch(()=>{})
const campus = await db.campus.findFirst({ select: { id: true } })
const u = await db.user.create({ data: { phone: '+s5h4test', name: 'S5H4 Test', role: 'CONSUMER', campusId: campus?.id } })
const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt: new Date(Date.now()+86400000) } })

const events = [
  { event: 'SOCIAL_PROOF_IMPRESSION', payload: { event: 'SOCIAL_PROOF_IMPRESSION', experimentId: 's5h1', variant: 'treatment', restaurantId: 'rest1', friendCountBucket: '2' } },
  { event: 'SOCIAL_PROOF_RESTAURANT_ENGAGEMENT', payload: { event: 'SOCIAL_PROOF_RESTAURANT_ENGAGEMENT', experimentId: 's5h1', variant: 'treatment', restaurantId: 'rest1', friendCountBucket: '2' } },
  { event: 'SOCIAL_PROOF_ORDER_START', payload: { event: 'SOCIAL_PROOF_ORDER_START', experimentId: 's5h1', variant: 'treatment', restaurantId: 'rest1', friendCountBucket: '2' } },
  { event: 'FRIEND_RANKED_IMPRESSION', payload: { event: 'FRIEND_RANKED_IMPRESSION', experimentId: 's5h2', variant: 'treatment', restaurantId: 'rest2', friendCountBucket: '3+', rankPosition: 1 } },
  { event: 'FRIEND_RANKED_RESTAURANT_OPEN', payload: { event: 'FRIEND_RANKED_RESTAURANT_OPEN', experimentId: 's5h2', variant: 'treatment', restaurantId: 'rest2', friendCountBucket: '3+', rankPosition: 1 } },
  { event: 'FRIEND_SEED_IMPRESSION', payload: { event: 'FRIEND_SEED_IMPRESSION', experimentId: 's5h3', variant: 'treatment', restaurantId: 'rest3', friendCountBucket: '1' } },
  { event: 'FRIEND_SEED_REQUEST', payload: { event: 'FRIEND_SEED_REQUEST', experimentId: 's5h3', variant: 'treatment', restaurantId: 'rest3', friendCountBucket: '1' } },
]

const results = []
const forbidden = ['userId','phone','email','orderId','sourceOrderId','blockedBy','session','csrf','token','friendName','candidateId','mutualId','graphPath']

for (const e of events) {
  const res = await api(s.token, 'POST', '/api/analytics/track', e.payload)
  const payloadStr = JSON.stringify(e.payload)
  const leaked = forbidden.filter(k => payloadStr.toLowerCase().includes(k.toLowerCase()))
  results.push({
    event: e.event,
    httpStatus: res.status,
    piiLeak: leaked.length === 0 ? 'NONE' : leaked.join(','),
    result: res.status === 200 && leaked.length === 0 ? 'PASS' : 'FAIL'
  })
}

await db.session.deleteMany({ where: { userId: u.id } })
await db.user.deleteMany({ where: { id: u.id } })

const allPass = results.every(r => r.result === 'PASS')
console.log(JSON.stringify({ results, VERDICT: allPass ? 'ANALYTICS_GATE_PASS' : 'BLOCKED' }, null, 2))
writeFileSync('evidence/s5h4-closure/analytics-gate.json', JSON.stringify({ results, VERDICT: allPass ? 'PASS' : 'BLOCKED' }, null, 2))
await db.$disconnect()
process.exit(allPass ? 0 : 1)
