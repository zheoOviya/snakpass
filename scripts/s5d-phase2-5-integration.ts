// S5D Phase 2-5 — Activity feed fanout integration test
// Verifies: SOCIAL_ACTIVITY_CREATED fanout to accepted friends only,
// PRIVATE=no fanout, blocked/non-friend=no event, rollback=no phantom, PII audit.
import { db } from '../src/lib/db'
import { connectSocket } from './s5b-connect-helper'

const SA='fa75f8007dbf5e2197d46641dad2067676ec4bfb7e5e6f384a56e1ecfc8ebddc'
const SB='5e77d5e96f9ba34c1690e3d1857b6b4a814ff00ec24106c219d6092769877c48'
const SC='9a8ea9626449e092f65801ccb574b80ff40f9001590a42fe852a88a8f937ed12'
const UA='cmt8chgkn0001mbkaszteayf3'
const UB='cmt8chgkp0003mbka1kix5p44'
const UC='cmt8chgkq0005mbka7gjzogil'
const CSRF='s5b-test-csrf-token-fixed'
const BASE='http://localhost:81'

async function api(s:string,m:string,p:string,b?:any){
  const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined})
  return {status:r.status,json:await r.json().catch(()=>({}))}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
async function waitForOutbox(et:string,mw=10000){const s=Date.now();while(Date.now()-s<mw){const r=await db.outbox.findFirst({where:{eventType:et},orderBy:{createdAt:'desc'}});if(r&&r.status==='PUBLISHED')return r;await wait(400)}return null}

async function main(){
  const T:any[]=[]
  // Clean
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA},{followeeId:UA},{followerId:UB},{followeeId:UB},{followerId:UC},{followeeId:UC}]}})
  await db.socialActivity.deleteMany({where:{actorId:UA}})
  await db.outbox.deleteMany({where:{eventType:{startsWith:'SOCIAL_'}}})

  // Establish A↔B friendship (both directions ACCEPTED)
  await db.socialConnection.create({data:{followerId:UA,followeeId:UB,status:'ACCEPTED',acceptedAt:new Date()}})
  await db.socialConnection.create({data:{followerId:UB,followeeId:UA,status:'ACCEPTED',acceptedAt:new Date()}})
  // C is NOT a friend of A

  // Connect sockets
  const {socket:sockB,connected:bConn}=connectSocket(SB)
  const {socket:sockC,connected:cConn}=connectSocket(SC)
  const [bOk,cOk]=await Promise.all([bConn,cConn])
  if(!bOk||!cOk){console.log(JSON.stringify({BLOCKED:'socket',bOk,cOk}));process.exit(1)}

  // === TEST 1: FRIENDS activity → B (friend) receives, C (non-friend) does NOT ===
  let bEvents:any[]=[],cEvents:any[]=[]
  sockB.on('social:event',(e:any)=>{if(e.type==='SOCIAL_ACTIVITY_CREATED')bEvents.push(e)})
  sockC.on('social:event',(e:any)=>{if(e.type==='SOCIAL_ACTIVITY_CREATED')cEvents.push(e)})

  const actRes=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5d-test-1',metadata:{restaurantName:'Test Cafe'},visibility:'FRIENDS'})
  await wait(3000)

  const activity1=await db.socialActivity.findFirst({where:{actorId:UA,objectId:'s5d-test-1'},orderBy:{createdAt:'desc'}})
  const outboxAct=await waitForOutbox('SOCIAL_ACTIVITY_CREATED')
  T.push({test:'T1_activity_created',httpStatus:actRes.status,activityExists:!!activity1,result:actRes.status===201&&!!activity1?'PASS':'FAIL'})
  T.push({test:'T1_outbox_published',status:outboxAct?.status,targetUser:outboxAct?JSON.parse(outboxAct.payload as string).targetUserId:null,matchesActivityId:outboxAct?JSON.parse(outboxAct.payload as string).envelope?.entityId===activity1?.id:false,result:outboxAct?.status==='PUBLISHED'&&JSON.parse(outboxAct.payload as string).envelope?.entityId===activity1?.id?'PASS':'FAIL'})
  T.push({test:'T1_friend_B_receives_event',bReceived:bEvents.length,result:bEvents.length===1?'PASS':'FAIL'})
  T.push({test:'T1_non_friend_C_no_event',cReceived:cEvents.length,result:cEvents.length===0?'PASS':'FAIL',detail:'Non-friend C must not receive FRIENDS activity event'})

  // PII audit
  if(outboxAct){
    const p=JSON.parse(outboxAct.payload as string)
    const envStr=JSON.stringify(p.envelope)
    const leaked=['phone','blockedBy','token','session','title','body','data','metadata','restaurantName','amount'].filter(k=>envStr.toLowerCase().includes(k))
    T.push({test:'T1_pii_audit',leakedPII:leaked,envelopeKeys:Object.keys(p.envelope),result:leaked.length===0&&Object.keys(p.envelope).every(k=>['eventId','type','occurredAt','entityId'].includes(k))?'PASS':'FAIL'})
  }

  // === TEST 2: PRIVATE activity → NO fanout ===
  bEvents=[];cEvents=[]
  sockB.removeAllListeners('social:event');sockB.on('social:event',(e:any)=>{if(e.type==='SOCIAL_ACTIVITY_CREATED')bEvents.push(e)})
  const privRes=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5d-test-2',metadata:{},visibility:'PRIVATE'})
  await wait(3000)
  const privActivity=await db.socialActivity.findFirst({where:{actorId:UA,objectId:'s5d-test-2'},select:{id:true,visibility:true}})
  // Count SOCIAL_ACTIVITY_CREATED outbox events for this activity
  const privOutbox=await db.outbox.findMany({where:{eventType:'SOCIAL_ACTIVITY_CREATED'},orderBy:{createdAt:'desc'},take:5})
  T.push({test:'T2_private_activity_created',httpStatus:privRes.status,visibility:privActivity?.visibility,result:privRes.status===201&&privActivity?.visibility==='PRIVATE'?'PASS':'FAIL'})
  T.push({test:'T2_private_no_fanout',friendBReceived:bEvents.length,result:bEvents.length===0?'PASS':'FAIL',detail:'PRIVATE activity must not fanout to friends'})

  // === TEST 3: PUBLIC activity → fanout to friends (same as FRIENDS per Phase 11 trace) ===
  bEvents=[]
  sockB.removeAllListeners('social:event');sockB.on('social:event',(e:any)=>{if(e.type==='SOCIAL_ACTIVITY_CREATED')bEvents.push(e)})
  const pubRes=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5d-test-3',metadata:{},visibility:'PUBLIC'})
  await wait(3000)
  T.push({test:'T3_public_fanout_to_friends',httpStatus:pubRes.status,bReceived:bEvents.length,result:pubRes.status===201&&bEvents.length===1?'PASS':'FAIL',detail:'PUBLIC fanouts to accepted friends (no global broadcast)'})

  // === TEST 4: Rollback → no activity, no event ===
  const {withTransaction}=await import('../src/lib/db')
  const {enqueueActivityFeedFanout}=await import('../src/lib/social-realtime')
  const beforeAct=await db.socialActivity.count({where:{actorId:UA}})
  const beforeOutbox=await db.outbox.count({where:{eventType:'SOCIAL_ACTIVITY_CREATED'}})
  try{
    await withTransaction(async(tx)=>{
      const act=await tx.socialActivity.create({data:{actorId:UA,verb:'ORDERED',objectType:'Restaurant',objectId:'rb-test',metadata:'{}',visibility:'FRIENDS'}})
      await enqueueActivityFeedFanout(tx,{actorId:UA,activityId:act.id,visibility:'FRIENDS'})
      throw new Error('FORCED_ROLLBACK')
    })
  }catch{}
  await wait(800)
  const afterAct=await db.socialActivity.count({where:{actorId:UA}})
  const afterOutbox=await db.outbox.count({where:{eventType:'SOCIAL_ACTIVITY_CREATED'}})
  T.push({test:'T4_rollback_no_phantom',actBefore:beforeAct,actAfter:afterAct,outboxBefore:beforeOutbox,outboxAfter:afterOutbox,result:afterAct===beforeAct&&afterOutbox===beforeOutbox?'PASS':'FAIL'})

  // === TEST 5: Block privacy ===
  // A blocks B, then A creates FRIENDS activity → B must NOT receive event
  bEvents=[]
  sockB.removeAllListeners('social:event');sockB.on('social:event',(e:any)=>{if(e.type==='SOCIAL_ACTIVITY_CREATED')bEvents.push(e)})
  // Block B (via A's connection row)
  const connAB=await db.socialConnection.findFirst({where:{followerId:UA,followeeId:UB}})
  if(connAB){
    await db.socialConnection.update({where:{id:connAB.id},data:{status:'BLOCKED',blockedBy:UA}})
    await db.socialConnection.updateMany({where:{followerId:UB,followeeId:UA},data:{status:'BLOCKED',blockedBy:UA}})
  }
  await wait(500)
  const blockActRes=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'s5d-test-block',metadata:{},visibility:'FRIENDS'})
  await wait(3000)
  T.push({test:'T5_block_isolation',httpStatus:blockActRes.status,bReceived:bEvents.length,feedHasBlockedAct:!!(await db.socialActivity.findFirst({where:{actorId:UA,objectId:'s5d-test-block'}})),result:blockActRes.status===201&&bEvents.length===0?'PASS':'FAIL',detail:'Blocked B must not receive activity event (no ACCEPTED friend edge)'})

  // Restore: unblock + re-friend for cleanup
  if(connAB){
    await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
  }

  // Cleanup
  await db.socialActivity.deleteMany({where:{actorId:UA}})

  const allPass=T.every(t=>t.result==='PASS')
  console.log(JSON.stringify({phase:'2-5',tests:T,VERDICT:allPass?'PHASE_2_5_PASS':'BLOCKED'},null,2))
  sockB.close();sockC.close()
  await db.$disconnect()
  process.exit(allPass?0:1)
}
main().catch(e=>{console.error(e);process.exit(2)})
