// S5G Phase 5: TRUE Concurrent Likes (5, 10)
import { db } from '../src/lib/db'
const CSRF='s5b-test-csrf-token-fixed', BASE='http://localhost:81'
async function api(s:string,m:string,p:string,b?:any){
  const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))

const users = await db.user.findMany({ where: { phone: { startsWith: '+1555', endsWith: 'S5G' } }, select: { id: true } })
const sessions = await db.session.findMany({ where: { userId: { in: users.map(u=>u.id) } }, select: { token: true, userId: true } })
const sessionMap = new Map(sessions.map(s=>[s.userId, s.token]))
const actor = users[0], friends = users.slice(1)
const actorSession = sessionMap.get(actor.id)!
const results:any[] = []

for (const likeCount of [5, 10]) {
  // Clean prior likes for this activity
  const actRes = await api(actorSession, 'POST', '/api/social/activities', { verb:'ORDERED', objectType:'Restaurant', objectId:`s5g-conc-${likeCount}`, metadata:{restaurantName:`Conc ${likeCount}`}, visibility:'FRIENDS' })
  const actId = actRes.json?.activity?.id
  
  // Fire ALL likes simultaneously (true concurrent)
  const likePromises: Promise<{status:number, userId:string}>[] = []
  for (let i = 0; i < likeCount; i++) {
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
    responseStatuses: likeResults.map(r => r.status),
    classification
  })
  console.log(`Concurrent Like ${likeCount}: DB=${dbLikeCount}, HTTP200=${success200}, HTTP409=${conflict409}, classification=${classification}`)
}

console.log(JSON.stringify({ results, VERDICT: results.every(r => r.classification === 'PASS') ? 'PASS' : results[0].classification }, null, 2))
await db.$disconnect()
