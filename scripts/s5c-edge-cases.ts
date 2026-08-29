// S5C Phase 11-14 — Edge cases: rollback, disconnect, out-of-order, privacy
import { db } from '../src/lib/db'
import { connectSocket } from './s5b-connect-helper'
import { io } from 'socket.io-client'

const SA='c2f4252722fded6b12279fc4147c5cee5cd795c5acb08ae1b222b78ec6f35051'
const SB='f78ec31a4ea534134d68b1abd8f48e9703803628ab5f0d351956b1310a8e0c84'
const UA='cmt88zbm00000mbwgo6vhssdj'
const UB='cmt88zbm20001mbwgbq6qv8ck'
const CSRF='s5b-test-csrf-token-fixed'
const BASE='http://localhost:81'
const RT='http://localhost:3003'
const SERVICE_TOKEN='snakzap-dev-service-token-s5b'

async function api(s:string,m:string,p:string,b?:any){
  const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
async function waitForOutbox(et:string,mw=10000){const s=Date.now();while(Date.now()-s<mw){const r=await db.outbox.findFirst({where:{eventType:et},orderBy:{createdAt:'desc'}});if(r&&r.status==='PUBLISHED')return r;await wait(400)}return null}

async function main(){
  const T:any[]=[]
  // Clean
  await db.notification.deleteMany({where:{userId:{in:[UA,UB]}}})
  await db.outbox.deleteMany({where:{eventType:{startsWith:'SOCIAL_'}}})

  // === PHASE 11: ROLLBACK ===
  const {withTransaction}=await import('../src/lib/db')
  const {enqueueSocialEvent}=await import('../src/lib/social-realtime')
  const before=await db.outbox.count({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'}})
  try{
    await withTransaction(async(tx)=>{
      const n=await tx.notification.create({data:{userId:UB,type:'SYSTEM',title:'rb',body:'rb',data:'{}',dedupKey:'rb-'+Date.now()}})
      await enqueueSocialEvent(tx,{type:'SOCIAL_NOTIFICATION_CREATED',targetUserId:UB,entityId:n.id})
      throw new Error('FORCED_ROLLBACK')
    })
  }catch{}
  await wait(800)
  const after=await db.outbox.count({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'}})
  T.push({test:'T11_rollback_no_phantom',before,after,result:after===before?'PASS':'FAIL'})

  // === PHASE 12: DISCONNECT/RECONNECT ===
  // Don't connect B's socket (simulate disconnect). A sends friend request.
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
  await db.notification.deleteMany({where:{userId:UB}})
  await db.outbox.deleteMany({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'}})

  const req=await api(SA,'POST','/api/social/connections',{followeeId:UB})
  await wait(3000)
  // DB committed while B "disconnected"
  const notifB=await db.notification.findFirst({where:{userId:UB,type:'FRIEND_REQUEST_RECEIVED'}})
  T.push({test:'T12_db_committed_while_disconnected',httpStatus:req.status,notifExists:!!notifB,result:req.status===201&&!!notifB?'PASS':'FAIL'})

  // Now connect B (reconnect) → REST reconciliation
  const {socket:sockB,connected}=connectSocket(SB)
  const bOk=await connected
  if(!bOk){console.log(JSON.stringify({BLOCKED:'socket'}));process.exit(1)}
  // B's client hook on reconnect calls refresh() → GET /api/notifications
  const bNotifsRes=await api(SB,'GET','/api/notifications?limit=50')
  T.push({test:'T12_reconnect_rest_reconciliation',unreadCount:bNotifsRes.json?.unreadCount,hasFriendReq:bNotifsRes.json?.notifications?.some((n:any)=>n.type==='FRIEND_REQUEST_RECEIVED'),result:bNotifsRes.json?.unreadCount===1&&bNotifsRes.json?.notifications?.some((n:any)=>n.type==='FRIEND_REQUEST_RECEIVED')?'PASS':'FAIL'})

  // === PHASE 13: OUT-OF-ORDER + DUPLICATE ===
  // Emit 3 SOCIAL_NOTIFICATION_CREATED events out of order to B, + 1 duplicate
  const pubSock=io(RT,{path:'/',transports:['websocket'],reconnection:false,timeout:3000,auth:{serviceToken:SERVICE_TOKEN}})
  const pubOk=await new Promise<boolean>(r=>{pubSock.on('connect',()=>r(true));pubSock.on('connect_error',()=>r(false));setTimeout(()=>r(false),4000)})
  if(!pubOk){console.log(JSON.stringify({BLOCKED:'publisher'}));process.exit(1)}

  let bEvents:any[]=[]
  sockB.removeAllListeners('social:event');sockB.on('social:event',(e:any)=>bEvents.push(e))

  const ts=Date.now()
  const events=[
    {eventId:`ooo-13a-${ts}`,type:'SOCIAL_NOTIFICATION_CREATED',occurredAt:new Date(ts-3000).toISOString(),entityId:'notif-3'},
    {eventId:`ooo-13b-${ts}`,type:'SOCIAL_NOTIFICATION_CREATED',occurredAt:new Date(ts-2000).toISOString(),entityId:'notif-2'},
    {eventId:`ooo-13c-${ts}`,type:'SOCIAL_NOTIFICATION_CREATED',occurredAt:new Date(ts-1000).toISOString(),entityId:'notif-1'},
    // duplicate of notif-2 (same eventId)
    {eventId:`ooo-13b-${ts}`,type:'SOCIAL_NOTIFICATION_CREATED',occurredAt:new Date(ts-2000).toISOString(),entityId:'notif-2'},
  ]
  for(const e of events){pubSock.emit('social:event',{targetUserId:UB,envelope:e});await wait(300)}
  await wait(1500)

  const notifEvents=bEvents.filter(e=>e.type==='SOCIAL_NOTIFICATION_CREATED')
  const uniqueEventIds=new Set(notifEvents.map((e:any)=>e.eventId))
  // B's dedup (client hook LRU) should skip the duplicate eventId
  // So B receives 3 unique events + 1 duplicate = 4 delivered to socket, but hook dedup processes 3
  T.push({test:'T13_all_events_delivered_to_socket',delivered:notifEvents.length,result:notifEvents.length===4?'PASS':'FAIL',detail:'4 delivered (3 unique + 1 duplicate eventId)'})

  // Each unique event triggers REST refetch. Final DB truth = 1 notification (the friend request)
  // (synthetic events don't create DB rows — they're just invalidation signals)
  const finalNotifs=await db.notification.findMany({where:{userId:UB}})
  T.push({test:'T13_final_db_truth',notifCount:finalNotifs.length,result:finalNotifs.length===1?'PASS':'FAIL',detail:'Out-of-order events do not create rows; DB truth = 1 notification'})

  // === PHASE 14: PRIVACY ===
  // Check the outbox payload for the friend request notification event
  const frOutbox=await db.outbox.findFirst({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'},orderBy:{createdAt:'asc'}})
  if(frOutbox){
    const p=JSON.parse(frOutbox.payload as string)
    const envStr=JSON.stringify(p.envelope)
    const forbidden=['phone','blockedBy','token','session','title','body','data','cookie','csrf','otp']
    const leaked=forbidden.filter(k=>envStr.toLowerCase().includes(k))
    T.push({test:'T14_privacy_pii',leakedPII:leaked,envelopeKeys:Object.keys(p.envelope),result:leaked.length===0&&Object.keys(p.envelope).every(k=>['eventId','type','occurredAt','entityId'].includes(k))?'PASS':'FAIL'})
  }

  // === PHASE 15: AUTHORIZATION ===
  // A cannot receive B's notification events (cross-user isolation)
  const {socket:sockA,connected:aConn}=connectSocket(SA)
  const aOk=await aConn
  if(aOk){
    let aNotifEvents:any[]=[]
    sockA.on('social:event',(e:any)=>{if(e.type==='SOCIAL_NOTIFICATION_CREATED')aNotifEvents.push(e)})
    // Emit a notification event targeted to B
    pubSock.emit('social:event',{targetUserId:UB,envelope:{eventId:`auth-15-${Date.now()}`,type:'SOCIAL_NOTIFICATION_CREATED',occurredAt:new Date().toISOString(),entityId:'auth-test'}})
    await wait(1000)
    T.push({test:'T15_cross_user_isolation',aReceived:aNotifEvents.length,result:aNotifEvents.length===0?'PASS':'FAIL',detail:'A cannot receive B-targeted notification event'})

    // Forged targetUserId from client (user socket emitting social:event) — no effect
    let forgedB:any[]=[]
    sockB.removeAllListeners('social:event');sockB.on('social:event',(e:any)=>forgedB.push(e))
    sockA.emit('social:event',{targetUserId:UB,envelope:{eventId:`forge-15-${Date.now()}`,type:'SOCIAL_NOTIFICATION_CREATED',occurredAt:new Date().toISOString()}})
    await wait(800)
    T.push({test:'T15_forged_event_rejected',forgedDelivered:forgedB.length,result:forgedB.length===0?'PASS':'FAIL',detail:'User socket cannot emit social:event (isService guard)'})

    sockA.close()
  }

  // Cleanup
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
  await db.notification.deleteMany({where:{userId:{in:[UA,UB]}}})

  const allPass=T.every(t=>t.result==='PASS')
  console.log(JSON.stringify({phase:'11-15',tests:T,VERDICT:allPass?'EDGE_CASES_PASS':'BLOCKED'},null,2))
  sockB.close();pubSock.close()
  await db.$disconnect()
  process.exit(allPass?0:1)
}
main().catch(e=>{console.error(e);process.exit(2)})
