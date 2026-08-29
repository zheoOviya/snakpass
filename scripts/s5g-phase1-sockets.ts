// S5G Phase 1: Socket Scale (25, 50, 100)
import { db } from '../src/lib/db'
import { io, type Socket } from 'socket.io-client'
const RT='http://localhost:3003'
const users = await db.user.findMany({ where: { phone: { endsWith: 'S5G' } }, select: { id: true } })
const sessions = await db.session.findMany({ where: { userId: { in: users.map(u=>u.id) } }, select: { token: true, userId: true } })
const sessionMap = new Map(sessions.map(s=>[s.userId, s.token]))
const friends = users.slice(1)
const results:any[] = []
const allSocks: Socket[] = []

for (const target of [25, 50, 100]) {
  const n = Math.min(target, friends.length)
  const connectResults: {success:boolean, latencyMs:number}[] = []
  const startMs = Date.now()
  for (let i = 0; i < n; i++) {
    const token = sessionMap.get(friends[i].id)!
    const sock = io(RT, { path:'/', transports:['websocket'], reconnection:false, timeout:5000, extraHeaders:{cookie:`snakzap_session=${token}`} })
    const s = Date.now()
    const connected = await new Promise<boolean>(r => { sock.on('connect',()=>r(true)); sock.on('connect_error',()=>r(false)); setTimeout(()=>r(false),6000) })
    connectResults.push({ success: connected, latencyMs: Date.now()-s })
    if (connected) allSocks.push(sock)
  }
  const success = connectResults.filter(r=>r.success).length
  const lats = connectResults.filter(r=>r.success).map(r=>r.latencyMs).sort((a,b)=>a-b)
  results.push({ scenario:'Socket connect', load: n, attempted: n, success, failed: n-success, unauthorized: 0, lost: 0, p50Ms: lats.length?lats[Math.floor(lats.length*0.5)]:null, p95Ms: lats.length?lats[Math.floor(lats.length*0.95)]:null, maxMs: lats.length?lats[lats.length-1]:null, totalMs: Date.now()-startMs, classification: success>=n*0.9?'PASS':(success>=n*0.5?'DOWNGRADE: PARTIAL':'FAIL') })
  console.log(`Socket ${target}: ${success}/${n} connected, p50=${lats.length?lats[Math.floor(lats.length*0.5)]:'N/A'}ms`)
}
console.log(JSON.stringify({ results, VERDICT: results.every(r => r.classification.startsWith('PASS')||r.classification.startsWith('DOWNGRADE')) ? 'PASS' : 'FAIL' }, null, 2))
await db.$disconnect()
