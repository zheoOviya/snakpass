// S5B Phase 7+8 — Block Isolation + Unblock (browser-driven via fetch, realtime-proven)
// Uses the browser's authenticated session cookies, but drives mutations via fetch
// so the realtime hook on the open Social→Friends screen proves the update-without-reload.
import { db } from '../src/lib/db'

const SESSION_A = 'e0a2ba5b2955092267e2d908aca3989294cde80244095a5d2f88a35f6119c375'
const SESSION_B = '1ed7c025a237d739225894682166bfb9753250a093a84ca353fda33c2eebbe7d'
const USER_A = 'cmt869z0c0000mbp5anxn5bpf'
const USER_B = 'cmt869z0e0001mbp534g2ca2j'
const CSRF = 's5b-test-csrf-token-fixed'
const BASE = 'http://localhost:81' // via gateway so cookies apply

async function api(session: string, method: string, path: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'cookie': `snakzap_session=${session}; snakzap_csrf=${CSRF}`, 'x-csrf-token': CSRF },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const evidence: any = { phase: '7+8', tests: [] }

  // Clean + re-establish friendship
  await db.socialConnection.deleteMany({ where: { OR: [{ followerId: USER_A, followeeId: USER_B }, { followerId: USER_B, followeeId: USER_A }] } })
  await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })

  // A → B friend request
  const reqRes = await api(SESSION_A, 'POST', '/api/social/connections', { followeeId: USER_B })
  const connId = reqRes.json?.connection?.id
  await wait(2500) // publisher delivers SOCIAL_FRIEND_REQUEST to B

  // B accepts
  const accRes = await api(SESSION_B, 'PATCH', `/api/social/connections/${connId}`, { status: 'ACCEPTED' })
  await wait(2500) // publisher delivers SOCIAL_FRIEND_ACCEPTED to A

  evidence.tests.push({ test: 'friendship_re_established', httpReq: reqRes.status, httpAcc: accRes.status, connId })

  // Verify DB: both ACCEPTED rows exist
  const conns = await db.socialConnection.findMany({ where: { OR: [{ followerId: USER_A, followeeId: USER_B }, { followerId: USER_B, followeeId: USER_A }] } })
  evidence.tests.push({ test: 'T0_friendship_exists', bothAccepted: conns.length === 2 && conns.every(c => c.status === 'ACCEPTED'), result: conns.length === 2 ? 'PASS' : 'FAIL' })

  // === PHASE 7: BLOCK ===
  // A blocks B (via DELETE with block=true)
  const blockRes = await api(SESSION_A, 'DELETE', `/api/social/connections/${connId}`, { block: true })
  await wait(2500) // publisher delivers SOCIAL_USER_BLOCKED to B

  // Verify DB: BLOCKED + blockedBy=A on both rows
  const blockedRows = await db.socialConnection.findMany({ where: { OR: [{ followerId: USER_A, followeeId: USER_B }, { followerId: USER_B, followeeId: USER_A }] } })
  const allBlocked = blockedRows.length === 2 && blockedRows.every(r => r.status === 'BLOCKED' && r.blockedBy === USER_A)
  evidence.tests.push({ test: 'T7_block_db', httpStatus: blockRes.status, dbRows: blockedRows.map(r => ({ status: r.status, blockedBy: r.blockedBy?.substring(0,8) })), result: blockRes.status === 200 && allBlocked ? 'PASS' : 'FAIL' })

  // Outbox: SOCIAL_USER_BLOCKED published, target=B
  const blockOutbox = await db.outbox.findFirst({ where: { eventType: 'SOCIAL_USER_BLOCKED' }, orderBy: { createdAt: 'desc' } })
  const blockPayload = blockOutbox ? JSON.parse(blockOutbox.payload as string) : null
  evidence.tests.push({ test: 'T7_block_outbox', status: blockOutbox?.status, target: blockPayload?.targetUserId?.substring(0,8), expected: USER_B.substring(0,8), result: blockOutbox?.status === 'PUBLISHED' && blockPayload?.targetUserId === USER_B ? 'PASS' : 'FAIL' })

  // PII audit: outbox payload has NO blockedBy
  if (blockPayload) {
    const payloadStr = JSON.stringify(blockPayload)
    const leaked = ['blockedBy', 'phone', 'token', 'session'].filter(k => payloadStr.toLowerCase().includes(k))
    evidence.tests.push({ test: 'T7_block_pii_audit', leakedPII: leaked, result: leaked.length === 0 ? 'PASS' : 'FAIL' })
  }

  // === PHASE 7: BLOCK ISOLATION — B cannot reconnect ===
  const bReconnect = await api(SESSION_B, 'POST', '/api/social/connections', { followeeId: USER_A })
  evidence.tests.push({ test: 'T7_b_cannot_reconnect', httpStatus: bReconnect.status, result: bReconnect.status === 403 ? 'PASS' : 'FAIL', detail: bReconnect.json })

  // === PHASE 7: BLOCK ISOLATION — B cannot unblock (only blocker can) ===
  // Find B's view of the connection (B's row where B is follower, A is followee)
  const bRow = blockedRows.find(r => r.followerId === USER_B)
  let bUnblockRes = { status: 0, json: {} }
  if (bRow) {
    bUnblockRes = await api(SESSION_B, 'PATCH', `/api/social/connections/${bRow.id}`, { status: 'UNBLOCKED' })
  }
  evidence.tests.push({ test: 'T7_b_cannot_unblock', httpStatus: bUnblockRes.status, result: bUnblockRes.status === 403 ? 'PASS' : 'FAIL', detail: bUnblockRes.json })

  // === PHASE 7: canUnblock projection — A sees canUnblock=true, B sees canUnblock=false ===
  const aConns = await api(SESSION_A, 'GET', '/api/social/connections')
  const bConns = await api(SESSION_B, 'GET', '/api/social/connections')
  const aBlockedRow = aConns.json?.connections?.find((c: any) => c.status === 'BLOCKED')
  const bBlockedRow = bConns.json?.connections?.find((c: any) => c.status === 'BLOCKED')
  // Verify raw blockedBy is NOT exposed
  const aHasRawBlockedBy = aConns.json?.connections?.some((c: any) => 'blockedBy' in c)
  const bHasRawBlockedBy = bConns.json?.connections?.some((c: any) => 'blockedBy' in c)
  evidence.tests.push({
    test: 'T7_canUnblock_projection',
    aCanUnblock: aBlockedRow?.canUnblock,
    bCanUnblock: bBlockedRow?.canUnblock,
    rawBlockedByExposedA: aHasRawBlockedBy,
    rawBlockedByExposedB: bHasRawBlockedBy,
    result: aBlockedRow?.canUnblock === true && bBlockedRow?.canUnblock === false && !aHasRawBlockedBy && !bHasRawBlockedBy ? 'PASS' : 'FAIL',
  })

  // === PHASE 8: UNBLOCK ===
  // A unblocks B
  const unblockRes = await api(SESSION_A, 'PATCH', `/api/social/connections/${connId}`, { status: 'UNBLOCKED' })
  await wait(2500) // publisher delivers SOCIAL_USER_UNBLOCKED to B

  // Verify DB: no BLOCKED rows (unblock deletes all rows for the pair)
  const afterUnblock = await db.socialConnection.findMany({ where: { OR: [{ followerId: USER_A, followeeId: USER_B }, { followerId: USER_B, followeeId: USER_A }] } })
  evidence.tests.push({ test: 'T8_unblock_db', httpStatus: unblockRes.status, rowsAfter: afterUnblock.length, result: unblockRes.status === 200 && afterUnblock.length === 0 ? 'PASS' : 'FAIL' })

  // Outbox: SOCIAL_USER_UNBLOCKED published, target=B
  const unblockOutbox = await db.outbox.findFirst({ where: { eventType: 'SOCIAL_USER_UNBLOCKED' }, orderBy: { createdAt: 'desc' } })
  const unblockPayload = unblockOutbox ? JSON.parse(unblockOutbox.payload as string) : null
  evidence.tests.push({ test: 'T8_unblock_outbox', status: unblockOutbox?.status, target: unblockPayload?.targetUserId?.substring(0,8), result: unblockOutbox?.status === 'PUBLISHED' && unblockPayload?.targetUserId === USER_B ? 'PASS' : 'FAIL' })

  // After unblock: B CAN reconnect (no more BLOCKED)
  const bReconnectAfter = await api(SESSION_B, 'POST', '/api/social/connections', { followeeId: USER_A })
  evidence.tests.push({ test: 'T8_b_can_reconnect_after_unblock', httpStatus: bReconnectAfter.status, result: bReconnectAfter.status === 201 ? 'PASS' : 'FAIL' })

  // Clean up
  await db.socialConnection.deleteMany({ where: { OR: [{ followerId: USER_A, followeeId: USER_B }, { followerId: USER_B, followeeId: USER_A }] } })

  const allPass = evidence.tests.every((t: any) => t.result === 'PASS')
  evidence.VERDICT = allPass ? 'PHASE_7_8_PASS' : 'BLOCKED'
  console.log(JSON.stringify(evidence, null, 2))
  await db.$disconnect()
  process.exit(allPass ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
