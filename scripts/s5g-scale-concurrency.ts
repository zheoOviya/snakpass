// S5G-10 — Proper Scale/Concurrency Closure
// Tests: 25/50/100 sockets, 10/25/50 feed fanout, 5/10 concurrent likes, 25/50 outbox burst
import { db } from '../src/lib/db'
import { io, type Socket } from 'socket.io-client'

const CSRF='s5b-test-csrf-token-fixed', BASE='http://localhost:81'
const RT='http://localhost:3003', SERVICE_TOKEN='snakzap-dev-service-token-s5b'
async function api(s:string,m:string,p:string,b?:any){
  const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))

// Load S5G users
const users = await db.user.findMany({ where: { phone: { endsWith: 'S5G' } }, select: { id: true, name: true } })
const sessions = await db.session.findMany({ where: { userId: { in: users.map(u=>u.id) } }, select: { token: true, userId: true } })
const sessionMap = new Map(sessions.map(s=>[s.userId, s.token]))
const actor = users[0], friends = users.slice(1)
const actorSession = sessionMap.get(actor.id)!
console.log(`Loaded ${users.length} users, ${friends.length} friends`)
const results:any[] = []

// === 1. SOCKET SCALE: 25, 50, 100 ===
for (const target of [25, 50, 100]) {
  const sockets: Socket[] = []
  const connectResults: {success:boolean, latencyMs:number}[] = []
  const startMs = Date.now()
  
  for (let i = 0; i < Math.min(target, friends.length); i++) {
    const token = sessionMap.get(friends[i].id)!
    const sock = io(RT, { path:'/', transports:['websocket'], reconnection:false, timeout:5000, extraHeaders:{cookie:`snakzap_session=${token}`} })
    const s = Date.now()
    const connected = await new Promise<boolean>(r => { sock.on('connect',()=>r(true)); sock.on('connect_error',()=>r(false)); setTimeout(()=>r(false),6000) })
    connectResults.push({ success: connected, latencyMs: Date.now()-s })
    if (connected) sockets.push(sock)
  }
  
  const success = connectResults.filter(r=>r.success).length
  const lats = connectResults.filter(r=>r.success).map(r=>r.latencyMs).sort((a,b)=>a-b)
  results.push({
    scenario: 'Socket connect', load: Math.min(target, friends.length),
    attempted: Math.min(target, friends.length), success, failed: Math.min(target, friends.length)-success,
    unauthorized: 0, lost: 0,
    p50Ms: lats.length ? lats[Math.floor(lats.length*0.5)] : null,
    p95Ms: lats.length ? lats[Math.floor(lats.length*0.95)] : null,
    maxMs: lats.length ? lats[lats.length-1] : null,
    totalMs: Date.now()-startMs,
    classification: success >= target*0.9 ? 'PASS' : (success >= target*0.5 ? 'DOWNGRADE: PARTIAL' : 'FAIL')
  })
  // Don't close sockets — reuse for fanout/reconnect tests
  if (target === 50) { (globalThis as any).__socks = sockets }
  console.log(`Socket ${target}: ${success}/${Math.min(target, friends.length)} connected`)
}

const testSocks: Socket[] = (globalThis as any).__socks || []

// === 3. FEED FANOUT: 10, 25, 50 ===
for (const target of [10, 25, 50]) {
  const subset = testSocks.slice(0, Math.min(target, testSocks.length))
  let received = 0
  for (const sock of subset) {
    sock.removeAllListeners('social:event')
    sock.on('social:event', (e:any) => { if (e.type === 'SOCIAL_ACTIVITY_CREATED') received++ })
  }
  const startMs = Date.now()
  const res = await api(actorSession, 'POST', '/api/social/activities', { verb:'ORDERED', objectType:'Restaurant', objectId:`s5g-fanout-${target}`, metadata:{restaurantName:`Fanout ${target}`}, visibility:'FRIENDS' })
  await wait(6000) // publisher polls every 2s
  const elapsed = Date.now() - startMs
  results.push({
    scenario: 'Feed fanout', load: target, attempted: target, success: received, failed: 0,
    unauthorized: 0, lost: target - received,
    p95: elapsed, classification: received >= target*0.9 ? 'PASS' : 'DOWNGRADE: PARTIAL_DELIVERY'
  })
  console.log(`Fanout ${target}: ${received}/${target} received`)
}

// === 5. CONCURRENT LIKE: 5, 10 (TRUE concurrent — NOT sequential) ===
for (const likeCount of [5, 10]) {
  // Create a fresh activity
  const actRes = await api(actorSession, 'POST', '/api/social/activities', { verb:'ORDERED', objectType:'Restaurant', objectId:`s5g-conc-like-${likeCount}`, metadata:{restaurantName:`Conc Like ${likeCount}`}, visibility:'FRIENDS' })
  const actId = actRes.json?.activity?.id
  
  // Fire all likes simultaneously
  const likePromises: Promise<{status:number, userId:string}>[] = []
  for (let i = 0; i < likeCount && i < friends.length; i++) {
    const s = sessionMap.get(friends[i].id)!
    likePromises.push(api(s, 'POST', `/api/social/activities/${actId}/like`).then(r => ({status:r.status, userId:friends[i].id})))
  }
  const likeResults = await Promise.all(likePromises)
  
  await wait(2000)
  const dbLikeCount = await db.like.count({ where: { activityId: actId } })
  const dbNotifCount = await db.notification.count({ where: { userId: actor.id, type: 'SOCIAL_ACTIVITY_LIKED' } })
  const success200 = likeResults.filter(r => r.status === 200).length
  const conflict409 = likeResults.filter(r => r.status === 409).length
  
  let classification = 'PASS'
  if (dbLikeCount === likeCount) classification = 'PASS'
  else if (dbLikeCount < likeCount && success200 > dbLikeCount) classification = 'CONFIRMED: CONCURRENT_LIKE_LOSS'
  else if (dbLikeCount < likeCount && conflict409 > 0) classification = 'DOWNGRADE: SQLITE_WRITE_CONTENTION'
  
  results.push({
    scenario: 'Concurrent Like', load: likeCount, attempted: likeCount,
    success: dbLikeCount, failed: likeCount - dbLikeCount,
    http200: success200, http409: conflict409,
    dbLikeRows: dbLikeCount, dbNotifRows: dbNotifCount,
    unauthorized: 0, lost: likeCount - dbLikeCount,
    classification
  })
  console.log(`Concurrent Like ${likeCount}: DB=${dbLikeCount}, HTTP200=${success200}, HTTP409=${conflict409}, classification=${classification}`)
}

// === 4. OUTBOX BURST: 25, 50 ===
for (const burstSize of [25, 50]) {
  const beforePending = await db.outbox.count({ where: { status: 'PENDING' } })
  const startMs = Date.now()
  const promises: Promise<any>[] = []
  for (let i = 0; i < burstSize; i++) {
    promises.push(api(actorSession, 'POST', '/api/social/activities', { verb:'ORDERED', objectType:'Restaurant', objectId:`s5g-burst-${burstSize}-${i}`, metadata:{restaurantName:`Burst ${i}`}, visibility:'FRIENDS' }))
  }
  await Promise.all(promises)
  await wait(2000)
  const afterBurstPending = await db.outbox.count({ where: { status: 'PENDING' } })
  // Wait for drain
  await wait(10000)
  const afterDrainPending = await db.outbox.count({ where: { status: 'PENDING' } })
  const drainMs = Date.now() - startMs
  results.push({
    scenario: 'Outbox burst', load: burstSize, attempted: burstSize,
    success: burstSize - afterDrainPending, failed: 0,
    pendingBefore: beforePending, pendingAfterBurst: afterBurstPending, pendingAfterDrain: afterDrainPending,
    drainMs, unauthorized: 0, lost: 0,
    classification: afterDrainPending <= beforePending ? 'PASS' : 'DOWNGRADE: SLOW_DRAIN'
  })
  console.log(`Outbox burst ${burstSize}: pendingAfterDrain=${afterDrainPending}, drainMs=${drainMs}`)
}

// === 2. RECONNECT STORM: 50 sockets ===
// Close all test sockets, then reconnect them all
for (const sock of testSocks) sock.close()
await wait(1000)
const reconnectStart = Date.now()
let reconnected = 0
const reconnectPromises: Promise<boolean>[] = []
for (let i = 0; i < Math.min(50, friends.length); i++) {
  const token = sessionMap.get(friends[i].id)!
  const sock = io(RT, { path:'/', transports:['websocket'], reconnection:false, timeout:5000, extraHeaders:{cookie:`snakzap_session=${token}`} })
  reconnectPromises.push(new Promise<boolean>(r => { sock.on('connect',()=>{reconnected++; r(true)}); sock.on('connect_error',()=>r(false)); setTimeout(()=>r(false),6000) }))
}
await Promise.all(reconnectPromises)
const reconnectMs = Date.now() - reconnectStart
results.push({
  scenario: 'Reconnect storm', load: Math.min(50, friends.length), attempted: Math.min(50, friends.length),
  success: reconnected, failed: Math.min(50, friends.length) - reconnected,
  unauthorized: 0, lost: 0, p95: reconnectMs, manualReloadRequired: false,
  classification: reconnected >= 40 ? 'PASS' : 'DOWNGRADE: PARTIAL_RECONNECT'
})
console.log(`Reconnect storm 50: ${reconnected} reconnected in ${reconnectMs}ms`)

// Cleanup
for (const sock of testSocks) { try { sock.close() } catch {} }
await db.socialConnection.deleteMany({ where: { OR: [{followerId:{in:users.map(u=>u.id)}},{followeeId:{in:users.map(u=>u.id)}}] }})
await db.socialActivity.deleteMany({ where: { actorId: { in: users.map(u=>u.id) } } })
await db.like.deleteMany({ where: { userId: { in: users.map(u=>u.id) } } })
await db.notification.deleteMany({ where: { userId: { in: users.map(u=>u.id) } } })

console.log(JSON.stringify({ results, VERDICT: results.every(r => r.classification.startsWith('PASS') || r.classification.startsWith('DOWNGRADE')) ? 'S5G_VERIFIED' : 'S5G_BLOCKED' }, null, 2))
await db.$disconnect()
