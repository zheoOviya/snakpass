// S5B Phase 7+8 — Block Isolation + Unblock with browser screenshot capture
import { db } from '../src/lib/db'
const SESSION_A = 'e0a2ba5b2955092267e2d908aca3989294cde80244095a5d2f88a35f6119c375'
const SESSION_B = '1ed7c025a237d739225894682166bfb9753250a093a84ca353fda33c2eebbe7d'
const USER_A = 'cmt869z0c0000mbp5anxn5bpf'
const USER_B = 'cmt869z0e0001mbp534g2ca2j'
const CSRF = 's5b-test-csrf-token-fixed'
const BASE = 'http://localhost:81'
async function api(s: string, m: string, p: string, b?: any) {
  const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'content-type':'application/json','cookie':`snakzap_session=${s}; snakzap_csrf=${CSRF}`,'x-csrf-token':CSRF }, body: b?JSON.stringify(b):undefined })
  return { status: r.status, json: await r.json().catch(()=>({})) }
}
const wait = (ms:number)=>new Promise(r=>setTimeout(r,ms))
async function main() {
  const T: any[] = []
  const pass = (t:any) => { t.result = t.result || (Object.values(t).every(v=>v===true||v==='PASS'||typeof v!=='boolean'&&v!==false)?'PASS':'FAIL'); T.push(t) }
  // Clean
  await db.socialConnection.deleteMany({ where: { OR: [{followerId:USER_A,followeeId:USER_B},{followerId:USER_B,followeeId:USER_A}] }})
  await db.outbox.deleteMany({ where: { eventType: { startsWith:'SOCIAL_' } } })
  // Establish friendship
  const req = await api(SESSION_A,'POST','/api/social/connections',{followeeId:USER_B})
  const connId = req.json?.connection?.id
  await wait(2500)
  const acc = await api(SESSION_B,'PATCH',`/api/social/connections/${connId}`,{status:'ACCEPTED'})
  await wait(2500)
  const conns = await db.socialConnection.findMany({ where: { OR: [{followerId:USER_A,followeeId:USER_B},{followerId:USER_B,followeeId:USER_A}] }})
  pass({ test:'T0_friendship', result: req.status===201&&acc.status===200&&conns.length===2&&conns.every(c=>c.status==='ACCEPTED')?'PASS':'FAIL' })
  // BLOCK
  const block = await api(SESSION_A,'DELETE',`/api/social/connections/${connId}`,{block:true})
  await wait(3500) // realtime delivery to B
  // Screenshot B showing BLOCKED (without reload)
  // (browser screenshots captured separately via agent-browser)
  const blockedRows = await db.socialConnection.findMany({ where: { OR: [{followerId:USER_A,followeeId:USER_B},{followerId:USER_B,followeeId:USER_A}] }})
  pass({ test:'T7_block_db', httpStatus:block.status, allBlocked: blockedRows.length===2&&blockedRows.every(r=>r.status==='BLOCKED'&&r.blockedBy===USER_A), result: block.status===200&&blockedRows.length===2&&blockedRows.every(r=>r.status==='BLOCKED'&&r.blockedBy===USER_A)?'PASS':'FAIL' })
  const blockOutbox = await db.outbox.findFirst({ where:{eventType:'SOCIAL_USER_BLOCKED'},orderBy:{createdAt:'desc'} })
  const blockPayload = blockOutbox?JSON.parse(blockOutbox.payload as string):null
  pass({ test:'T7_block_outbox', status:blockOutbox?.status, target:blockPayload?.targetUserId?.substring(0,8), result: blockOutbox?.status==='PUBLISHED'&&blockPayload?.targetUserId===USER_B?'PASS':'FAIL' })
  const blockPayloadStr = blockPayload?JSON.stringify(blockPayload):''
  pass({ test:'T7_block_pii', leaked:['blockedBy','phone','token'].filter(k=>blockPayloadStr.toLowerCase().includes(k)), result: ['blockedBy','phone','token'].every(k=>!blockPayloadStr.toLowerCase().includes(k))?'PASS':'FAIL' })
  // B cannot reconnect
  const bRec = await api(SESSION_B,'POST','/api/social/connections',{followeeId:USER_A})
  pass({ test:'T7_b_cannot_reconnect', httpStatus:bRec.status, result: bRec.status===403?'PASS':'FAIL' })
  // B cannot unblock
  const bRow = blockedRows.find(r=>r.followerId===USER_B)
  const bUnblk = bRow?await api(SESSION_B,'PATCH',`/api/social/connections/${bRow.id}`,{status:'UNBLOCKED'}):{status:0}
  pass({ test:'T7_b_cannot_unblock', httpStatus:bUnblk.status, result: bUnblk.status===403?'PASS':'FAIL' })
  // canUnblock projection
  const aC = await api(SESSION_A,'GET','/api/social/connections')
  const bC = await api(SESSION_B,'GET','/api/social/connections')
  const aBlk = aC.json?.connections?.find((c:any)=>c.status==='BLOCKED')
  const bBlk = bC.json?.connections?.find((c:any)=>c.status==='BLOCKED')
  const rawExposed = aC.json?.connections?.some((c:any)=>'blockedBy'in c) || bC.json?.connections?.some((c:any)=>'blockedBy'in c)
  pass({ test:'T7_canUnblock', aCanUnblock:aBlk?.canUnblock, bCanUnblock:bBlk?.canUnblock, rawBlockedByExposed:rawExposed, result: aBlk?.canUnblock===true&&bBlk?.canUnblock===false&&!rawExposed?'PASS':'FAIL' })
  // UNBLOCK
  const unblk = await api(SESSION_A,'PATCH',`/api/social/connections/${connId}`,{status:'UNBLOCKED'})
  await wait(3500)
  const afterUnblk = await db.socialConnection.findMany({ where: { OR: [{followerId:USER_A,followeeId:USER_B},{followerId:USER_B,followeeId:USER_A}] }})
  pass({ test:'T8_unblock_db', httpStatus:unblk.status, rowsAfter:afterUnblk.length, result: unblk.status===200&&afterUnblk.length===0?'PASS':'FAIL' })
  const unblkOutbox = await db.outbox.findFirst({ where:{eventType:'SOCIAL_USER_UNBLOCKED'},orderBy:{createdAt:'desc'} })
  const unblkPayload = unblkOutbox?JSON.parse(unblkOutbox.payload as string):null
  pass({ test:'T8_unblock_outbox', status:unblkOutbox?.status, target:unblkPayload?.targetUserId?.substring(0,8), result: unblkOutbox?.status==='PUBLISHED'&&unblkPayload?.targetUserId===USER_B?'PASS':'FAIL' })
  // B can reconnect after unblock
  const bRecAfter = await api(SESSION_B,'POST','/api/social/connections',{followeeId:USER_A})
  pass({ test:'T8_b_can_reconnect', httpStatus:bRecAfter.status, result: bRecAfter.status===201?'PASS':'FAIL' })
  // Cleanup
  await db.socialConnection.deleteMany({ where: { OR: [{followerId:USER_A,followeeId:USER_B},{followerId:USER_B,followeeId:USER_A}] }})
  const allPass = T.every(t=>t.result==='PASS')
  console.log(JSON.stringify({ phase:'7+8', tests:T, VERDICT: allPass?'PHASE_7_8_PASS':'BLOCKED' }, null, 2))
  await db.$disconnect()
  process.exit(allPass?0:1)
}
main().catch(e=>{console.error(e);process.exit(2)})
