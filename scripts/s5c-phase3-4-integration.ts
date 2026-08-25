// S5C Phase 3+4 — Backend integration: notification producers → outbox → socket
// Verifies: SOCIAL_NOTIFICATION_CREATED event for all 3 producers, dedup, rollback
import { db } from '../src/lib/db'
import { connectSocket } from './s5b-connect-helper'

const SA = 'c2f4252722fded6b12279fc4147c5cee5cd795c5acb08ae1b222b78ec6f35051'
const SB = 'f78ec31a4ea534134d68b1abd8f48e9703803628ab5f0d351956b1310a8e0c84'
const UA = 'cmt88zbm00000mbwgo6vhssdj'
const UB = 'cmt88zbm20001mbwgbq6qv8ck'
const CSRF = 's5b-test-csrf-token-fixed'
const BASE = 'http://localhost:81'

async function api(s:string,m:string,p:string,b?:any) {
  const r = await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
async function waitForOutbox(eventType:string,maxWait=10000) {
  const start=Date.now()
  while(Date.now()-start<maxWait){const r=await db.outbox.findFirst({where:{eventType},orderBy:{createdAt:'desc'}});if(r&&r.status==='PUBLISHED')return r;await wait(400)}
  return null
}

async function main() {
  const T:any[]=[]
  // Clean
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
  await db.notification.deleteMany({where:{userId:{in:[UA,UB]}}})
  await db.outbox.deleteMany({where:{eventType:{startsWith:'SOCIAL_'}}})
  await db.socialActivity.deleteMany({where:{actorId:UA}})

  // Connect sockets
  const {socket:sockB,connected:bConn}=connectSocket(SB)
  const {socket:sockA,connected:aConn}=connectSocket(SA)
  const [bOk,aOk]=await Promise.all([bConn,aConn])
  if(!bOk||!aOk){console.log(JSON.stringify({BLOCKED:'socket',bOk,aOk}));process.exit(1)}

  // === TEST 1: Friend Request → SOCIAL_NOTIFICATION_CREATED for B ===
  let bEvents:any[]=[],aEvents:any[]=[]
  sockB.on('social:event',(e:any)=>bEvents.push(e))
  sockA.on('social:event',(e:any)=>aEvents.push(e))

  const req=await api(SA,'POST','/api/social/connections',{followeeId:UB})
  await wait(3000)
  const notifB=await db.notification.findFirst({where:{userId:UB,type:'FRIEND_REQUEST_RECEIVED'}})
  const outboxNotif=await waitForOutbox('SOCIAL_NOTIFICATION_CREATED')
  const bNotifEvents=bEvents.filter(e=>e.type==='SOCIAL_NOTIFICATION_CREATED')

  T.push({test:'T1_friend_req_notif_created',httpStatus:req.status,notifExists:!!notifB,result:req.status===201&&!!notifB?'PASS':'FAIL'})
  T.push({test:'T1_outbox_SOCIAL_NOTIFICATION_CREATED',status:outboxNotif?.status,target:outboxNotif?JSON.parse(outboxNotif.payload as string).targetUserId:null,entityId:outboxNotif?JSON.parse(outboxNotif.payload as string).envelope?.entityId:null,matchesNotifId:outboxNotif?JSON.parse(outboxNotif.payload as string).envelope?.entityId===notifB?.id:false,result:outboxNotif?.status==='PUBLISHED'&&JSON.parse(outboxNotif.payload as string).targetUserId===UB&&JSON.parse(outboxNotif.payload as string).envelope?.entityId===notifB?.id?'PASS':'FAIL'})
  T.push({test:'T1_B_received_notification_event',bReceived:bNotifEvents.length,result:bNotifEvents.length===1?'PASS':'FAIL',detail:bNotifEvents})
  // A (sender) must NOT receive notification event (target=B)
  const aNotifEvents=aEvents.filter(e=>e.type==='SOCIAL_NOTIFICATION_CREATED')
  T.push({test:'T1_A_not_targeted',aReceived:aNotifEvents.length,result:aNotifEvents.length===0?'PASS':'FAIL'})

  // PII audit
  if(outboxNotif){
    const p=JSON.parse(outboxNotif.payload as string)
    const envStr=JSON.stringify(p.envelope)
    const leaked=['phone','blockedBy','token','session','title','body','data'].filter(k=>envStr.toLowerCase().includes(k))
    T.push({test:'T1_pii_audit',leaked,result:leaked.length===0?'PASS':'FAIL',envelopeKeys:Object.keys(p.envelope)})
  }

  // === TEST 2: Accept → SOCIAL_NOTIFICATION_CREATED for A ===
  bEvents=[];aEvents=[]
  sockB.removeAllListeners('social:event');sockB.on('social:event',(e:any)=>bEvents.push(e))
  sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))

  const conn=await db.socialConnection.findFirst({where:{followerId:UA,followeeId:UB}})
  const acc=await api(SB,'PATCH',`/api/social/connections/${conn!.id}`,{status:'ACCEPTED'})
  await wait(3000)
  const notifA=await db.notification.findFirst({where:{userId:UA,type:'FRIEND_REQUEST_ACCEPTED'}})
  const aNotifEvents2=aEvents.filter(e=>e.type==='SOCIAL_NOTIFICATION_CREATED')
  T.push({test:'T2_accept_notif_created',httpStatus:acc.status,notifExists:!!notifA,result:acc.status===200&&!!notifA?'PASS':'FAIL'})
  T.push({test:'T2_A_received_notification_event',aReceived:aNotifEvents2.length,result:aNotifEvents2.length===1?'PASS':'FAIL'})

  // === TEST 3: Like → SOCIAL_NOTIFICATION_CREATED for activity owner ===
  // A creates an activity, B likes it → A gets notification
  const activity=await db.socialActivity.create({data:{actorId:UA,verb:'ORDERED',objectType:'Restaurant',objectId:'test-obj-'+Date.now(),visibility:'PUBLIC',metadata:'{}'}})
  aEvents=[]
  sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))

  const likeRes=await api(SB,'POST',`/api/social/activities/${activity.id}/like`)
  await wait(3000)
  const likeNotif=await db.notification.findFirst({where:{userId:UA,type:'SOCIAL_ACTIVITY_LIKED'}})
  const aLikeNotifEvents=aEvents.filter(e=>e.type==='SOCIAL_NOTIFICATION_CREATED')
  T.push({test:'T3_like_notif_created',httpStatus:likeRes.status,notifExists:!!likeNotif,result:likeRes.status===200&&!!likeNotif?'PASS':'FAIL'})
  T.push({test:'T3_A_received_like_notification',aReceived:aLikeNotifEvents.length,result:aLikeNotifEvents.length===1?'PASS':'FAIL'})

  // === TEST 4: Duplicate Like → NO new notification, NO new event (dedup at source) ===
  aEvents=[]
  sockA.removeAllListeners('social:event');sockA.on('social:event',(e:any)=>aEvents.push(e))
  const dupLike=await api(SB,'POST',`/api/social/activities/${activity.id}/like`)
  await wait(2000)
  const likeNotifs=await db.notification.findMany({where:{userId:UA,type:'SOCIAL_ACTIVITY_LIKED'}})
  const aDupEvents=aEvents.filter(e=>e.type==='SOCIAL_NOTIFICATION_CREATED')
  T.push({test:'T4_dup_like_no_new_notif',httpStatus:dupLike.status,notifCount:likeNotifs.length,dupEvents:aDupEvents.length,result:dupLike.status===200&&likeNotifs.length===1&&aDupEvents.length===0?'PASS':'FAIL',detail:'Idempotent Like → no new notification row → no SOCIAL_NOTIFICATION_CREATED event'})

  // === TEST 5: Rollback → no notification, no event ===
  const {withTransaction}=await await import('../src/lib/db')
  const {enqueueSocialEvent}=await await import('../src/lib/social-realtime')
  const beforeRb=await db.outbox.count({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'}})
  try{
    await withTransaction(async(tx)=>{
      const n=await tx.notification.create({data:{userId:UB,type:'SYSTEM',title:'test',body:'rollback',data:'{}',dedupKey:'rb-test-'+Date.now()}})
      await enqueueSocialEvent(tx,{type:'SOCIAL_NOTIFICATION_CREATED',targetUserId:UB,entityId:n.id})
      throw new Error('FORCED_ROLLBACK')
    })
  }catch{}
  await wait(800)
  const afterRb=await db.outbox.count({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'}})
  T.push({test:'T5_rollback_no_phantom',before:beforeRb,after:afterRb,result:afterRb===beforeRb?'PASS':'FAIL'})

  // Cleanup
  await db.socialActivity.deleteMany({where:{actorId:UA}})
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})

  const allPass=T.every(t=>t.result==='PASS')
  console.log(JSON.stringify({phase:'3+4',tests:T,VERDICT:allPass?'PHASE_3_4_PASS':'BLOCKED'},null,2))
  sockA.close();sockB.close()
  await db.$disconnect()
  process.exit(allPass?0:1)
}
main().catch(e=>{console.error(e);process.exit(2)})
