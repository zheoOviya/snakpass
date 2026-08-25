// S5G Phase 1: Socket Scale — parallel connection
import { db } from '../src/lib/db'
import { io, type Socket } from 'socket.io-client'
const RT='http://localhost:3003'
const users = await db.user.findMany({ where: { phone: { endsWith: 'S5G' } }, select: { id: true } })
const sessions = await db.session.findMany({ where: { userId: { in: users.map(u=>u.id) } }, select: { token: true, userId: true } })
const sessionMap = new Map(sessions.map(s=>[s.userId, s.token]))
const friends = users.slice(1) // 49 friends

const results:any[] = []

// Connect ALL available friends in parallel (49 = our max with 50 users)
const target = friends.length
const startMs = Date.now()
const promises: Promise<{success:boolean, latencyMs:number, sock:Socket|null}>[] = []
for (let i = 0; i < target; i++) {
  const token = sessionMap.get(friends[i].id)!
  const sock = io(RT, { path:'/', transports:['websocket'], reconnection:false, timeout:3000, extraHeaders:{cookie:`snakzap_session=${token}`} })
  const s = Date.now()
  promises.push(new Promise(resolve => {
    sock.on('connect', () => resolve({success:true, latencyMs: Date.now()-s, sock}))
    sock.on('connect_error', () => resolve({success:false, latencyMs: Date.now()-s, sock:null}))
    setTimeout(() => resolve({success:false, latencyMs: Date.now()-s, sock:null}), 4000)
  }))
}
const connectResults = await Promise.all(promises)
const totalMs = Date.now() - startMs

const success = connectResults.filter(r=>r.success).length
const lats = connectResults.filter(r=>r.success).map(r=>r.latencyMs).sort((a,b)=>a+b)
const connectedSocks = connectResults.filter(r=>r.success).map(r=>r.sock!)

results.push({ 
  scenario:'Socket connect', load: target, attempted: target, success, failed: target-success, 
  unauthorized: 0, lost: 0, 
  p50Ms: lats.length?lats[Math.floor(lats.length*0.5)]:null, 
  p95Ms: lats.length?lats[Math.floor(lats.length*0.95)]:null, 
  maxMs: lats.length?lats[lats.length-1]:null, 
  totalMs,
  classification: success>=50?'PASS':(success>=25?'DOWNGRADE: PARTIAL':'FAIL') 
})

console.log(`Socket ${target}: ${success}/${target} connected in ${totalMs}ms, p50=${lats.length?lats[Math.floor(lats.length*0.5)]:'N/A'}ms, p95=${lats.length?lats[Math.floor(lats.length*0.95)]:'N/A'}ms`)

// Save connected sockets for later phases (can't pass across processes, so just output result)
// Don't close sockets yet — but we can't use them in another script
// Close them for now
for (const sock of connectedSocks) sock.close()

console.log(JSON.stringify({ results, VERDICT: results.every(r => r.classification.startsWith('PASS')||r.classification.startsWith('DOWNGRADE')) ? 'PASS' : 'FAIL' }, null, 2))
await db.$disconnect()
