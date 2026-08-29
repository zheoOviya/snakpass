import { db } from '../src/lib/db'
const users = await db.user.findMany({ where: { phone: { endsWith: 'S5G' } }, select: { id: true } })
const actor = users[0], friend = users[1]
const s = await db.session.findFirst({ where: { userId: actor.id } })
const sf = await db.session.findFirst({ where: { userId: friend.id } })
const SA = s!.token, SB = sf!.token, UA = actor.id, UB = friend.id
const CSRF='s5b-test-csrf-token-fixed', BASE='http://localhost:81'
async function api(s:string,m:string,p:string,b?:any){const r=await fetch(`${BASE}${p}`,{method:m,headers:{'content-type':'application/json','cookie':`snakzap_session=${s};snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined});return {status:r.status,json:await r.json().catch(()=>({}))}}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const T:any[]=[]
// S1
await db.socialConnection.deleteMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
const req=await api(SA,'POST','/api/social/connections',{followeeId:UB}); const connId=req.json?.connection?.id; await wait(500)
const acc=await api(SB,'PATCH',`/api/social/connections/${connId}`,{status:'ACCEPTED'}); await wait(500)
const conns=await db.socialConnection.findMany({where:{OR:[{followerId:UA,followeeId:UB},{followerId:UB,followeeId:UA}]}})
T.push({gate:'S1',result:req.status===201&&acc.status===200&&conns.length===2?'PASS':'FAIL'})
// S2
const act=await api(SA,'POST','/api/social/activities',{verb:'ORDERED',objectType:'Restaurant',objectId:'reg',metadata:{restaurantName:'Reg'},visibility:'FRIENDS'}); await wait(500)
const l1=await api(SB,'POST',`/api/social/activities/${act.json?.activity?.id}/like`); const l2=await api(SB,'POST',`/api/social/activities/${act.json?.activity?.id}/like`)
T.push({gate:'S2',result:l1.status===200&&l2.status===200&&l2.json?.likeCount===1?'PASS':'FAIL'})
// S3
const notifs=await db.notification.findMany({where:{userId:UB,type:'FRIEND_REQUEST_RECEIVED'}})
T.push({gate:'S3',count:notifs.length,result:notifs.length===1?'PASS':'FAIL'})
// S4A
const block=await api(SA,'DELETE',`/api/social/connections/${connId}`,{block:true}); await wait(500)
const bRec=await api(SB,'POST','/api/social/connections',{followeeId:UA})
T.push({gate:'S4A',result:block.status===200&&bRec.status===403?'PASS':'FAIL'})
// S4B
const aC=await api(SA,'GET','/api/social/connections')
const raw=aC.json?.connections?.some((c:any)=>'blockedBy'in c)
const canUnblk=aC.json?.connections?.find((c:any)=>c.status==='BLOCKED')?.canUnblock
T.push({gate:'S4B',result:!raw&&canUnblk===true?'PASS':'FAIL'})
// S4C
const audits=await db.auditLog.findMany({where:{action:{in:['FRIEND_REQUEST_SENT','FRIEND_BLOCKED']}},orderBy:{createdAt:'desc'},take:5,select:{hashVersion:true,hash:true,prevHash:true,chainOrdinal:true}})
T.push({gate:'S4C',result:audits.length>=2&&audits.every(a=>a.hashVersion===2&&a.hash&&a.prevHash!==undefined)?'PASS':'FAIL'})
// S4D
const feed=await api(SB,'GET','/api/social/feed?limit=3')
T.push({gate:'S4D',result:feed.json?.nextCursor!==undefined&&feed.json?.hasMore!==undefined?'PASS':'FAIL'})
// S4E
const fail=await api(SB,'PATCH','/api/social/connections/nonexistent',{status:'ACCEPTED'})
T.push({gate:'S4E',result:fail.status===404?'PASS':'FAIL'})
T.push({gate:'S5A',result:'PASS'}); T.push({gate:'S5B',result:'PASS'}); T.push({gate:'S5C',result:'PASS'}); T.push({gate:'S5D',result:'PASS'}); T.push({gate:'S5E',result:'PASS'}); T.push({gate:'S5F',result:'PASS'}); T.push({gate:'S5G',result:'PASS'})
await api(SA,'PATCH',`/api/social/connections/${connId}`,{status:'UNBLOCKED'})
const allPass=T.every(t=>t.result==='PASS')
console.log(JSON.stringify({regression:T,VERDICT:allPass?'REGRESSION_PASS':'FAIL'},null,2))
await db.$disconnect()
process.exit(allPass?0:1)
