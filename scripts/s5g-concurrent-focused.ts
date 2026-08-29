// S5G Concurrent Like — focused test with 5 friends (isolate correctness from throughput)
import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'

const CSRF='s5b-test-csrf-token-fixed', BASE='http://localhost:81'
async function api(s:string,m:string,p:string,b?:any){
  const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))

// Create 6 focused users (1 actor + 5 friends) — small fanout = fast writes
const PA='+15559001TST', phones = [PA, '+15559002TST', '+15559003TST', '+15559004TST', '+15559005TST', '+15559006TST']
// Clean prior
const existing = await db.user.findMany({ where: { phone: { in: phones } }, select: { id: true } })
if (existing.length) {
  for (const id of existing.map(u=>u.id)) { await db.session.deleteMany({where:{userId:id}}); await db.socialConnection.deleteMany({where:{OR:[{followerId:id},{followeeId:id}]}}); await db.like.deleteMany({where:{userId:id}}); await db.notification.deleteMany({where:{userId:id}}) }
  await db.socialActivity.deleteMany({where:{actorId:{in:existing.map(u=>u.id)}}})
  await db.user.deleteMany({where:{id:{in:existing.map(u=>u.id)}}})
}
const campus = await db.campus.findFirst({ select: { id: true } })
const expiresAt = new Date(Date.now() + 7*24*60*60*1000)
const users:any[] = []
for (const p of phones) {
  const u = await db.user.create({ data: { phone: p, name: 'TST '+p.slice(-3), role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt } })
  users.push({ id: u.id, session: s.token })
}
const actor = users[0], friends = users.slice(1) // 5 friends
for (const f of friends) {
  await db.socialConnection.create({ data: { followerId: actor.id, followeeId: f.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: f.id, followeeId: actor.id, status: 'ACCEPTED', acceptedAt: new Date() } })
}
console.log(`Created ${users.length} users, ${friends.length} friends`)

const results:any[] = []

// === 5 CONCURRENT LIKES ===
const actRes = await api(actor.session, 'POST', '/api/social/activities', { verb:'ORDERED', objectType:'Restaurant', objectId:'tst-conc-5', metadata:{restaurantName:'Conc5'}, visibility:'FRIENDS' })
const actId = actRes.json?.activity?.id
console.log(`Activity: ${actRes.status} ${actId}`)

// Fire 5 likes SIMULTANEOUSLY
const likePromises: Promise<{status:number, userId:string}>[] = []
for (let i = 0; i < 5; i++) {
  likePromises.push(api(friends[i].session, 'POST', `/api/social/activities/${actId}/like`).then(r => ({status:r.status, userId:friends[i].id})))
}
const likeResults = await Promise.all(likePromises)

await wait(1000)
const dbLikeCount = await db.like.count({ where: { activityId: actId } })
const feedRes = await api(actor.session, 'GET', '/api/social/feed?limit=30')
const feedAct = feedRes.json?.activities?.find((a:any) => a.id === actId)
const success200 = likeResults.filter(r => r.status === 200).length
const conflict409 = likeResults.filter(r => r.status === 409).length

let classification = 'PASS'
if (dbLikeCount === 5) classification = 'PASS'
else if (dbLikeCount < 5 && success200 > dbLikeCount) classification = 'CONFIRMED: CONCURRENT_LIKE_LOSS'
else if (dbLikeCount < 5 && conflict409 > 0) classification = 'DOWNGRADE: SQLITE_WRITE_CONTENTION'

results.push({
  scenario: 'Concurrent Like', load: 5, attempted: 5,
  success: dbLikeCount, failed: 5 - dbLikeCount,
  http200: success200, http409: conflict409,
  dbLikeRows: dbLikeCount, feedLikeCount: feedAct?.likeCount,
  responseStatuses: likeResults.map(r => r.status),
  classification
})
console.log(`Concurrent Like 5: DB=${dbLikeCount}, HTTP200=${success200}, HTTP409=${conflict409}, feedCount=${feedAct?.likeCount}, classification=${classification}`)

// === 10 CONCURRENT LIKES (need 10 friends — reuse 5 + create 5 more) ===
const moreUsers:any[] = []
for (let i = 0; i < 5; i++) {
  const p = `+1555900${7+i}TST`
  const u = await db.user.create({ data: { phone: p, name: 'TST ' + p.slice(-3), role: 'CONSUMER', campusId: campus?.id } })
  const s = await db.session.create({ data: { token: randomBytes(32).toString('hex'), userId: u.id, role: 'CONSUMER', expiresAt } })
  await db.socialConnection.create({ data: { followerId: actor.id, followeeId: u.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  await db.socialConnection.create({ data: { followerId: u.id, followeeId: actor.id, status: 'ACCEPTED', acceptedAt: new Date() } })
  moreUsers.push({ id: u.id, session: s.token })
}
const all10Friends = [...friends, ...moreUsers] // 10 friends total

const act2Res = await api(actor.session, 'POST', '/api/social/activities', { verb:'ORDERED', objectType:'Restaurant', objectId:'tst-conc-10', metadata:{restaurantName:'Conc10'}, visibility:'FRIENDS' })
const act2Id = act2Res.json?.activity?.id
console.log(`Activity2: ${act2Res.status} ${act2Id}`)

const like10Promises: Promise<{status:number}>[] = []
for (let i = 0; i < 10; i++) {
  like10Promises.push(api(all10Friends[i].session, 'POST', `/api/social/activities/${act2Id}/like`).then(r => ({status:r.status})))
}
const like10Results = await Promise.all(like10Promises)

await wait(1000)
const dbLike10Count = await db.like.count({ where: { activityId: act2Id } })
const feed2Res = await api(actor.session, 'GET', '/api/social/feed?limit=30')
const feed2Act = feed2Res.json?.activities?.find((a:any) => a.id === act2Id)
const success200_10 = like10Results.filter(r => r.status === 200).length
const conflict409_10 = like10Results.filter(r => r.status === 409).length

let classification10 = 'PASS'
if (dbLike10Count === 10) classification10 = 'PASS'
else if (dbLike10Count < 10 && success200_10 > dbLike10Count) classification10 = 'CONFIRMED: CONCURRENT_LIKE_LOSS'
else if (dbLike10Count < 10 && conflict409_10 > 0) classification10 = 'DOWNGRADE: SQLITE_WRITE_CONTENTION'

results.push({
  scenario: 'Concurrent Like', load: 10, attempted: 10,
  success: dbLike10Count, failed: 10 - dbLike10Count,
  http200: success200_10, http409: conflict409_10,
  dbLikeRows: dbLike10Count, feedLikeCount: feed2Act?.likeCount,
  responseStatuses: like10Results.map(r => r.status),
  classification: classification10
})
console.log(`Concurrent Like 10: DB=${dbLike10Count}, HTTP200=${success200_10}, HTTP409=${conflict409_10}, feedCount=${feed2Act?.likeCount}, classification=${classification10}`)

// Cleanup
for (const u of [...users, ...moreUsers]) {
  await db.session.deleteMany({where:{userId:u.id}})
  await db.socialConnection.deleteMany({where:{OR:[{followerId:u.id},{followeeId:u.id}]}})
  await db.like.deleteMany({where:{userId:u.id}})
  await db.notification.deleteMany({where:{userId:u.id}})
}
await db.socialActivity.deleteMany({where:{actorId:actor.id}})
await db.user.deleteMany({where:{id:{in:[...users, ...moreUsers].map(u=>u.id)}}})

const verdict = results.every(r => r.classification === 'PASS') ? 'PASS' : results[0].classification
console.log(JSON.stringify({ results, VERDICT: verdict }, null, 2))
await db.$disconnect()
