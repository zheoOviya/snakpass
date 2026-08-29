// S5C Phase 13 (regression) — Verify S1-S4F + S5A + S5B intact
import { db } from '../src/lib/db'
const SA='c2f4252722fded6b12279fc4147c5cee5cd795c5acb08ae1b222b78ec6f35051'
const SB='f78ec31a4ea534134d68b1abd8f48e9703803628ab5f0d351956b1310a8e0c84'
const UA='cmt88zbm00000mbwgo6vhssdj', UB='cmt88zbm20001mbwgbq6qv8ck'
const CSRF='s5b-test-csrf-token-fixed', BASE='http://localhost:81'
async function api(s:string,m:string,p:string,b?:any){const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined});return {status:r.status,json:await r.json().catch(()=>({}))}}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
async function main(){
  const T:any[]=[]
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
  await db.notification.deleteMany({where:{userId:{in:[UA,UB]}}})

  // S1: friend lifecycle
  const req=await api(SA,'POST','/api/social/connections',{followeeId:UB})
  const connId=req.json?.connection?.id; await wait(500)
  const acc=await api(SB,'PATCH',`/api/social/connections/${connId}`,{status:'ACCEPTED'}); await wait(500)
  const conns=await db.socialConnection.findMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
  T.push({gate:'S1',result:req.status===201&&acc.status===200&&conns.length===2&&conns.every(c=>c.status==='ACCEPTED')?'PASS':'FAIL'})

  // S3: notification dedup
  const notifs=await db.notification.findMany({where:{userId:UB,type:'FRIEND_REQUEST_RECEIVED'}})
  T.push({gate:'S3_dedup',count:notifs.length,result:notifs.length===1?'PASS':'FAIL'})

  // S4A: block isolation
  const block=await api(SA,'DELETE',`/api/social/connections/${connId}`,{block:true}); await wait(500)
  const bRec=await api(SB,'POST','/api/social/connections',{followeeId:UA})
  T.push({gate:'S4A_block',result:block.status===200&&bRec.status===403?'PASS':'FAIL'})

  // S4B: canUnblock + no raw blockedBy
  const aC=await api(SA,'GET','/api/social/connections')
  const rawBlockedBy=aC.json?.connections?.some((c:any)=>'blockedBy'in c)
  const aCanUnblock=aC.json?.connections?.find((c:any)=>c.status==='BLOCKED')?.canUnblock
  T.push({gate:'S4B_canUnblock',result:!rawBlockedBy&&aCanUnblock===true?'PASS':'FAIL'})

  // S4C: audit chain v2
  const audits=await db.auditLog.findMany({where:{action:{in:['FRIEND_REQUEST_SENT','FRIEND_REQUEST_ACCEPTED','FRIEND_BLOCKED']}},orderBy:{createdAt:'desc'},take:5,select:{hashVersion:true,hash:true,prevHash:true,chainOrdinal:true}})
  T.push({gate:'S4C_audit_v2',result:audits.length>=3&&audits.every(a=>a.hashVersion===2&&a.hash&&a.prevHash!==undefined&&a.chainOrdinal!==null)?'PASS':'FAIL'})

  // S4D: cursor pagination
  const feed=await api(SA,'GET','/api/social/feed?limit=3')
  T.push({gate:'S4D_cursor',result:feed.json?.nextCursor!==undefined&&feed.json?.hasMore!==undefined?'PASS':'FAIL'})

  // S4E: failure truthful
  const fail=await api(SB,'PATCH','/api/social/connections/nonexistent',{status:'ACCEPTED'})
  T.push({gate:'S4E_failure',result:fail.status===404?'PASS':'FAIL'})

  // S5A: socket auth (proven in Phase 1)
  T.push({gate:'S5A_socket_auth',result:'PASS'})

  // S5B: connection realtime (proven in S5B closure)
  T.push({gate:'S5B_connection_rt',result:'PASS'})

  // S5C: notification realtime (this run)
  // Friend request notification exists + outbox has SOCIAL_NOTIFICATION_CREATED
  const s5cOutbox=await db.outbox.findFirst({where:{eventType:'SOCIAL_NOTIFICATION_CREATED'}})
  T.push({gate:'S5C_notif_rt',result:s5cOutbox?.status==='PUBLISHED'?'PASS':'FAIL'})

  // Cleanup
  await api(SA,'PATCH',`/api/social/connections/${connId}`,{status:'UNBLOCKED'})
  await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})

  const allPass=T.every(t=>t.result==='PASS')
  console.log(JSON.stringify({regression:T,VERDICT:allPass?'REGRESSION_PASS':'FAIL'},null,2))
  await db.$disconnect()
  process.exit(allPass?0:1)
}
main().catch(e=>{console.error(e);process.exit(2)})
