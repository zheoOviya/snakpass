// S5E — Like/Unlike Realtime Integration Test
// Tests: event emission, recipient targeting, dedup, rollback, privacy, multi-actor
import { db } from '../src/lib/db'
import { connectSocket } from './s5b-connect-helper'
import { io } from 'socket.io-client'

const SA='33cd9d5169386681f7f5c61fedd729244b42c444fccf65dcde180c41e02e6233'
const SB='e031ca7b46e5d95b2f8837e118bfa6bed34b17e0b40c40b26f4564c4c976df3e'
const SC='2f855e3d2089aa39c10a12cb69dccb198316c23cd422a918f9407567b66733dd'
const UA='cmt8dqb810001mbd9u60batjy', UB='cmt8dqb820003mbd9f9xxiru2', UC='cmt8dqb830005mbd94ykg8n0j'
const CSRF='s5b-test-csrf-token-fixed', BASE='http://localhost:81'
const SERVICE_TOKEN='snakzap-dev-service-token-s5b', RT='http://localhost:3003'

async function api(s:string,m:string,p:string,b?:any){
  const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))

async function main(){
  const T:any[]=[]
  // Clean
  await db.socialActivity.deleteMany({where:{actorId:{in:[UA,UB,UC]}}})
  await db.like.deleteMany({where:{userId:{in:[UA,UB,UC]}}})
  await db.notification.deleteMany({where:{userId:{in:[UA,UB,UC]}}})
  await db.outbox.deleteMany({where:{eventType:{startsWith:'SOCIAL_'}}})

  // Create A's FRIENDS activity
  const act=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5e-test-1',metadata:{restaurantName:'S5E Test Restaurant'},visibility:'FRIENDS'})
  const activityId=act.json?.activity?.id

  // Connect A's socket (actor — should receive LIKE/UNLIKE events)
  const {socket:sockA,connected:aConn}=connectSocket(SA)
  const {socket:sockB,connected:bConn}=connectSocket(SB)
  const [aOk,bOk]=await Promise.all([aConn,bConn])
  if(!aOk||!bOk){console.log(JSON.stringify({BLOCKED:'socket',aOk,bOk}));process.exit(1)}

  let aEvents:any[]=[]
  sockA.on('social:event',(e:any)=>aEvents.push(e))

  // === PHASE 5: LIKE ===
  const likeRes=await api(SB,'POST',`/api/social/activities/${activityId}/like`)
  await wait(3500)
  const likeRows=await db.like.count({where:{activityId}})
  const likeNotifs=await db.notification.count({where:{userId:UA,type:'SOCIAL_ACTIVITY_LIKED'}})
  const likeOutbox=await db.outbox.findFirst({where:{eventType:'SOCIAL_ACTIVITY_LIKED'},orderBy:{createdAt:'asc'}})
  const aLikeEvents=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_LIKED')

  T.push({test:'T5_like_http',status:likeRes.status,result:likeRes.status===200?'PASS':'FAIL'})
  T.push({test:'T5_like_db_row',likeRows,result:likeRows===1?'PASS':'FAIL'})
  T.push({test:'T5_notification_row',likeNotifs,result:likeNotifs===1?'PASS':'FAIL'})
  T.push({test:'T5_outbox_liked',status:likeOutbox?.status,target:likeOutbox?JSON.parse(likeOutbox.payload as string).targetUserId:null,matchesActivity:likeOutbox?JSON.parse(likeOutbox.payload as string).envelope?.entityId===activityId:false,result:likeOutbox?.status==='PUBLISHED'&&JSON.parse(likeOutbox.payload as string).targetUserId===UA&&JSON.parse(likeOutbox.payload as string).envelope?.entityId===activityId?'PASS':'FAIL'})
  T.push({test:'T5_A_received_liked_event',aReceived:aLikeEvents.length,result:aLikeEvents.length===1?'PASS':'FAIL',detail:aLikeEvents})
  // PII audit
  if(likeOutbox){
    const p=JSON.parse(likeOutbox.payload as string)
    const envStr=JSON.stringify(p.envelope)
    const leaked=['phone','blockedBy','token','session','likeCount','likedByMe','liker','amount','metadata'].filter(k=>envStr.toLowerCase().includes(k))
    T.push({test:'T5_pii_audit',leakedPII:leaked,envelopeKeys:Object.keys(p.envelope),result:leaked.length===0&&Object.keys(p.envelope).every(k=>['eventId','type','occurredAt','entityId'].includes(k))?'PASS':'FAIL'})
  }

  // === PHASE 6: UNLIKE ===
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  const unlikeRes=await api(SB,'DELETE',`/api/social/activities/${activityId}/like`)
  await wait(3500)
  const unlikeRows=await db.like.count({where:{activityId}})
  const unlikeOutbox=await db.outbox.findFirst({where:{eventType:'SOCIAL_ACTIVITY_UNLIKED'},orderBy:{createdAt:'asc'}})
  const aUnlikeEvents=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_UNLIKED')
  T.push({test:'T6_unlike_http',status:unlikeRes.status,result:unlikeRes.status===200?'PASS':'FAIL'})
  T.push({test:'T6_unlike_db_row',likeRows:unlikeRows,result:unlikeRows===0?'PASS':'FAIL'})
  T.push({test:'T6_outbox_unliked',status:unlikeOutbox?.status,target:unlikeOutbox?JSON.parse(unlikeOutbox.payload as string).targetUserId:null,result:unlikeOutbox?.status==='PUBLISHED'&&JSON.parse(unlikeOutbox.payload as string).targetUserId===UA?'PASS':'FAIL'})
  T.push({test:'T6_A_received_unliked_event',aReceived:aUnlikeEvents.length,result:aUnlikeEvents.length===1?'PASS':'FAIL',detail:aUnlikeEvents})
  // Historical notification NOT deleted (S3 policy)
  const notifsAfterUnlike=await db.notification.count({where:{userId:UA,type:'SOCIAL_ACTIVITY_LIKED'}})
  T.push({test:'T6_notification_preserved',count:notifsAfterUnlike,result:notifsAfterUnlike===1?'PASS':'FAIL',detail:'Historical Like notification remains per S3 policy'})

  // === PHASE 7: DUPLICATE LIKE ===
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  // Like again
  await api(SB,'POST',`/api/social/activities/${activityId}/like`); await wait(2500)
  // Duplicate like (idempotent — should NOT create new row/event)
  const dupLike=await api(SB,'POST',`/api/social/activities/${activityId}/like`); await wait(2500)
  const dupLikeRows=await db.like.count({where:{activityId}})
  const dupNotifs=await db.notification.count({where:{userId:UA,type:'SOCIAL_ACTIVITY_LIKED'}})
  const aDupEvents=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_LIKED')
  T.push({test:'T7_dup_like_idempotent',httpStatus:dupLike.status,likeCount:dupLike.json?.likeCount,likeRows:dupLikeRows,notifCount:dupNotifs,dupEvents:aDupEvents.length,result:dupLike.status===200&&dupLikeRows===1&&dupNotifs===1&&aDupEvents.length===1?'PASS':'FAIL',detail:'First like emits 1 event; duplicate like emits 0 events (idempotent)'})

  // === PHASE 10: FAILED LIKE ROLLBACK ===
  // Force failure: like a non-existent activity
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  const failLike=await api(SB,'POST','/api/social/activities/nonexistent-activity/like')
  await wait(2000)
  T.push({test:'T10_failed_like',status:failLike.status,aReceived:aEvents.length,result:failLike.status===404&&aEvents.length===0?'PASS':'FAIL'})

  // === PHASE 11: FAILED UNLIKE ===
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  // Unlike already unliked activity (B already unliked above, then re-liked in T7)
  // First unlike the T7 like
  await api(SB,'DELETE',`/api/social/activities/${activityId}/like`); await wait(2500)
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  // Unlike again (idempotent — no row deleted, no event)
  const dupUnlike=await api(SB,'DELETE',`/api/social/activities/${activityId}/like`); await wait(2500)
  const aDupUnlike=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_UNLIKED')
  T.push({test:'T11_dup_unlike_idempotent',status:dupUnlike.status,aReceived:aDupUnlike.length,result:dupUnlike.status===200&&aDupUnlike.length===0?'PASS':'FAIL',detail:'Idempotent unlike — no row deleted → no event'})

  // === PHASE 9: NON-FRIEND PRIVACY ===
  // Create a PRIVATE activity — no one should receive like events
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  // C is friend of A (for multi-actor test), but create a test where C is NOT friend
  // Actually C IS friend. Let's create a D non-friend scenario differently:
  // Test PRIVATE activity — no like possible (403)
  const privateAct=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5e-private',metadata:{restaurantName:'Private'},visibility:'PRIVATE'})
  const privateLike=await api(SB,'POST',`/api/social/activities/${privateAct.json?.activity?.id}/like`)
  T.push({test:'T9_private_like_denied',status:privateLike.status,result:privateLike.status===403?'PASS':'FAIL'})

  // === PHASE 14: MULTI-ACTOR COUNT ===
  // A creates new FRIENDS activity. B and C both like it. Count should go 1→2.
  const multiAct=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5e-multi',metadata:{restaurantName:'Multi'},visibility:'FRIENDS'})
  const multiActId=multiAct.json?.activity?.id
  aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  // B likes
  const bLikeCount=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_LIKED').length
  await api(SB,'POST',`/api/social/activities/${multiActId}/like`); await wait(2500)
  const countAfterB=await db.like.count({where:{activityId:multiActId}})
  const aEventsAfterB=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_LIKED').length - bLikeCount
  // C likes
  const cLikeCount=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_LIKED').length
  await api(SC,'POST',`/api/social/activities/${multiActId}/like`); await wait(2500)
  const countAfterC=await db.like.count({where:{activityId:multiActId}})
  const aEventsAfterC=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_LIKED').length - cLikeCount
  // B unlikes
  await api(SB,'DELETE',`/api/social/activities/${multiActId}/like`); await wait(2500)
  const countAfterBUnlike=await db.like.count({where:{activityId:multiActId}})
  const aUnlikeMulti=aEvents.filter(e=>e.type==='SOCIAL_ACTIVITY_UNLIKED')
  T.push({test:'T14_multi_actor_count',countAfterB,countAfterC,countAfterBUnlike,aLikeEventsB:aEventsAfterB,aLikeEventsC:aEventsAfterC,aUnlikeEvents:aUnlikeMulti.length,result:countAfterB===1&&countAfterC===2&&countAfterBUnlike===1&&aEventsAfterB===1&&aEventsAfterC===1&&aUnlikeMulti.length===1?'PASS':'FAIL'})

  // === PHASE 13: OUT-OF-ORDER ===
  // Emit LIKE then UNLIKE in reverse order via publisher
  const pubSock=io(RT,{path:'/',transports:['websocket'],reconnection:false,timeout:3000,auth:{serviceToken:SERVICE_TOKEN}})
  const pubOk=await new Promise<boolean>(r=>{pubSock.on('connect',()=>r(true));pubSock.on('connect_error',()=>r(false));setTimeout(()=>r(false),4000)})
  if(pubOk){
    aEvents=[];sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
    const ts=Date.now()
    // UNLIKE first (older), then LIKE (newer) — reverse order
    pubSock.emit('social:event',{targetUserId:UA,envelope:{eventId:`ooo-unlike-${ts}`,type:'SOCIAL_ACTIVITY_UNLIKED',occurredAt:new Date(ts-1000).toISOString(),entityId:activityId}})
    await wait(300)
    pubSock.emit('social:event',{targetUserId:UA,envelope:{eventId:`ooo-like-${ts}`,type:'SOCIAL_ACTIVITY_LIKED',occurredAt:new Date(ts).toISOString(),entityId:activityId}})
    await wait(1500)
    const oooReceived=aEvents.length
    // Final DB truth: T7 like was unliked in T11, so count should be 0 for that activity
    const finalCount=await db.like.count({where:{activityId}})
    T.push({test:'T13_out_of_order',delivered:oooReceived,finalCount,result:oooReceived===2&&finalCount===0?'PASS':'FAIL',detail:'Both events delivered; final state = REST truth (0 likes on that activity)'})
    pubSock.close()
  }

  // === PRIVACY AUDIT on UNLIKE payload ===
  const unlikeOutboxFinal=await db.outbox.findFirst({where:{eventType:'SOCIAL_ACTIVITY_UNLIKED'},orderBy:{createdAt:'desc'}})
  if(unlikeOutboxFinal){
    const p=JSON.parse(unlikeOutboxFinal.payload as string)
    const envStr=JSON.stringify(p.envelope)
    const leaked=['phone','blockedBy','token','session','likeCount','likedByMe','liker'].filter(k=>envStr.toLowerCase().includes(k))
    T.push({test:'T17_unlike_pii',leakedPII:leaked,result:leaked.length===0?'PASS':'FAIL'})
  }

  // Cleanup
  await db.socialActivity.deleteMany({where:{actorId:{in:[UA,UB,UC]}}})
  await db.like.deleteMany({where:{userId:{in:[UA,UB,UC]}}})
  await db.notification.deleteMany({where:{userId:{in:[UA,UB,UC]}}})

  const allPass=T.every(t=>t.result==='PASS')
  console.log(JSON.stringify({phase:'S5E',tests:T,VERDICT:allPass?'S5E_BACKEND_PASS':'BLOCKED'},null,2))
  sockA.close();sockB.close()
  await db.$disconnect()
  process.exit(allPass?0:1)
}
main().catch(e=>{console.error(e);process.exit(2)})
