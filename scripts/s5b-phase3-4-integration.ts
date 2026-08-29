// S5B Phase 3+4 — Transactional Outbox + Recipient Authorization
import { db } from '../src/lib/db'
import { connectSocket } from './s5b-connect-helper'

const SESSION_A = 'e0a2ba5b2955092267e2d908aca3989294cde80244095a5d2f88a35f6119c375'
const SESSION_B = '1ed7c025a237d739225894682166bfb9753250a093a84ca353fda33c2eebbe7d'
const USER_A = 'cmt869z0c0000mbp5anxn5bpf'
const USER_B = 'cmt869z0e0001mbp534g2ca2j'
const CSRF = 's5b-test-csrf-token-fixed'
const BASE = 'http://localhost:3000'

async function apiCall(method: string, path: string, body: any, session: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'cookie': `snakzap_session=${session}; snakzap_csrf=${CSRF}`, 'x-csrf-token': CSRF },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function waitForOutboxPublish(eventType: string, maxWait = 10000): Promise<any> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const row = await db.outbox.findFirst({ where: { eventType }, orderBy: { createdAt: 'desc' } })
    if (row && row.status === 'PUBLISHED') return row
    await wait(400)
  }
  return null
}

async function main() {
  const evidence: any = { phase: '3+4', tests: [] }

  // Clean prior state
  await db.socialConnection.deleteMany({ where: { OR: [{ followerId: USER_A, followeeId: USER_B }, { followerId: USER_B, followeeId: USER_A }] } })
  await db.outbox.deleteMany({ where: { eventType: { startsWith: 'SOCIAL_' } } })

  // Connect sockets (race-free helper)
  const { socket: sockB, connected: bConnP } = connectSocket(SESSION_B)
  const { socket: sockA, connected: aConnP } = connectSocket(SESSION_A)
  const [bConnected, aConnected] = await Promise.all([bConnP, aConnP])
  if (!bConnected || !aConnected) {
    console.log(JSON.stringify({ BLOCKED: 'socket_connect_failed', bConnected, aConnected }, null, 2))
    process.exit(1)
  }

  // --- TEST 1: Friend Request (A → B) ---
  let bEvents: any[] = [], aEvents: any[] = []
  sockB.on('social:event', (e: any) => bEvents.push(e))
  sockA.on('social:event', (e: any) => aEvents.push(e))

  const reqRes = await apiCall('POST', '/api/social/connections', { followeeId: USER_B }, SESSION_A)
  const outboxRow = await waitForOutboxPublish('SOCIAL_FRIEND_REQUEST')
  await wait(800)

  evidence.tests.push({ test: 'T1_friend_request_http', mutation: 'POST /connections', httpStatus: reqRes.status, result: reqRes.status === 201 ? 'PASS' : 'FAIL', detail: reqRes.json })
  evidence.tests.push({ test: 'T1_outbox_row', outbox: outboxRow ? { eventType: outboxRow.eventType, status: outboxRow.status, publishedAt: outboxRow.publishedAt?.toISOString() } : null, result: outboxRow?.status === 'PUBLISHED' ? 'PASS' : 'FAIL' })
  evidence.tests.push({ test: 'T1_recipient_socket (B)', bReceived: bEvents.length, result: bEvents.length === 1 ? 'PASS' : 'FAIL', detail: bEvents })
  evidence.tests.push({ test: 'T1_sender_not_notified (A)', aReceived: aEvents.length, result: aEvents.length === 0 ? 'PASS' : 'FAIL' })

  if (bEvents.length === 1) {
    const env = bEvents[0]; const envStr = JSON.stringify(env)
    const keys = Object.keys(env)
    const forbidden = ['phone', 'blockedBy', 'passwordHash', 'token', 'session', 'cookie', 'email']
    const leaked = forbidden.filter(k => envStr.toLowerCase().includes(`"${k}"`))
    evidence.tests.push({ test: 'T1_payload_pii_audit', payloadKeys: keys, leakedPII: leaked, result: leaked.length === 0 && keys.every(k => ['eventId','type','occurredAt','entityId'].includes(k)) ? 'PASS' : 'FAIL' })
  }
  if (outboxRow) {
    const payload = JSON.parse(outboxRow.payload as string)
    evidence.tests.push({ test: 'T1_target_authorization', outboxTarget: payload.targetUserId, expected: USER_B, envelopeType: payload.envelope?.type, result: payload.targetUserId === USER_B && payload.envelope?.type === 'SOCIAL_FRIEND_REQUEST' ? 'PASS' : 'FAIL' })
  }

  // --- TEST 2: Accept (B accepts A) ---
  bEvents = []; aEvents = []
  sockB.removeAllListeners('social:event'); sockB.on('social:event', (e: any) => bEvents.push(e))
  sockA.removeAllListeners('social:event'); sockA.on('social:event', (e: any) => aEvents.push(e))

  const conn = await db.socialConnection.findFirst({ where: { followerId: USER_A, followeeId: USER_B } })
  const acceptRes = await apiCall('PATCH', `/api/social/connections/${conn!.id}`, { status: 'ACCEPTED' }, SESSION_B)
  const acceptOutbox = await waitForOutboxPublish('SOCIAL_FRIEND_ACCEPTED')
  await wait(800)

  evidence.tests.push({ test: 'T2_accept_http', httpStatus: acceptRes.status, result: acceptRes.status === 200 ? 'PASS' : 'FAIL', detail: acceptRes.json })
  evidence.tests.push({ test: 'T2_accept_outbox', outbox: acceptOutbox ? { status: acceptOutbox.status, target: JSON.parse(acceptOutbox.payload as string).targetUserId } : null, result: acceptOutbox?.status === 'PUBLISHED' && JSON.parse(acceptOutbox.payload as string).targetUserId === USER_A ? 'PASS' : 'FAIL' })
  evidence.tests.push({ test: 'T2_accept_recipient_socket (A)', aReceived: aEvents.length, result: aEvents.length === 1 && aEvents[0].type === 'SOCIAL_FRIEND_ACCEPTED' ? 'PASS' : 'FAIL', detail: aEvents })
  evidence.tests.push({ test: 'T2_accept_B_not_targeted', bReceived: bEvents.length, result: bEvents.length === 0 ? 'PASS' : 'FAIL' })

  // --- TEST 3: Remove (A unfriends B) ---
  aEvents = []; bEvents = []
  sockA.removeAllListeners('social:event'); sockA.on('social:event', (e: any) => aEvents.push(e))
  sockB.removeAllListeners('social:event'); sockB.on('social:event', (e: any) => bEvents.push(e))

  const delRes = await apiCall('DELETE', `/api/social/connections/${conn!.id}`, {}, SESSION_A)
  const removeOutbox = await waitForOutboxPublish('SOCIAL_FRIEND_REMOVED')
  await wait(800)

  evidence.tests.push({ test: 'T3_remove_http', httpStatus: delRes.status, result: delRes.status === 200 ? 'PASS' : 'FAIL', detail: delRes.json })
  evidence.tests.push({ test: 'T3_remove_outbox', outbox: removeOutbox ? { status: removeOutbox.status, target: JSON.parse(removeOutbox.payload as string).targetUserId } : null, result: removeOutbox?.status === 'PUBLISHED' && JSON.parse(removeOutbox.payload as string).targetUserId === USER_B ? 'PASS' : 'FAIL' })
  evidence.tests.push({ test: 'T3_remove_recipient_socket (B)', bReceived: bEvents.length, result: bEvents.length === 1 && bEvents[0].type === 'SOCIAL_FRIEND_REMOVED' ? 'PASS' : 'FAIL', detail: bEvents })

  // --- TEST 4: Validation failure (pre-tx) — no outbox event ---
  const before = await db.outbox.count({ where: { eventType: 'SOCIAL_FRIEND_REQUEST' } })
  const failRes = await apiCall('POST', '/api/social/connections', { followeeId: 'nonexistent-user' }, SESSION_A)
  await wait(3000)
  const after = await db.outbox.count({ where: { eventType: 'SOCIAL_FRIEND_REQUEST' } })
  evidence.tests.push({ test: 'T4_validation_failure_no_event', httpStatus: failRes.status, outboxBefore: before, outboxAfter: after, result: failRes.status === 404 && after === before ? 'PASS' : 'FAIL' })

  // --- TEST 5: TRUE rollback — enqueue event then throw → no phantom ---
  const { withTransaction } = await import('../src/lib/db')
  const { enqueueSocialEvent } = await import('../src/lib/social-realtime')
  const beforeRb = await db.outbox.count({ where: { eventType: 'SOCIAL_USER_BLOCKED' } })
  try {
    await withTransaction(async (tx) => {
      await enqueueSocialEvent(tx, { type: 'SOCIAL_USER_BLOCKED', targetUserId: USER_B, entityId: 'rollback-test' })
      throw new Error('FORCED_ROLLBACK_TEST')
    })
  } catch {}
  await wait(800)
  const afterRb = await db.outbox.count({ where: { eventType: 'SOCIAL_USER_BLOCKED' } })
  evidence.tests.push({ test: 'T5_true_rollback_no_phantom', outboxBefore: beforeRb, outboxAfter: afterRb, result: afterRb === beforeRb ? 'PASS' : 'FAIL', detail: 'commit-before-publish: tx abort → no outbox row' })

  // DB truth snapshot
  const finalConns = await db.socialConnection.findMany({ where: { OR: [{ followerId: USER_A }, { followerId: USER_B }] }, select: { id: true, followerId: true, followeeId: true, status: true } })
  evidence.dbTruth = { connections: finalConns }

  const allPass = evidence.tests.every((t: any) => t.result === 'PASS')
  evidence.VERDICT = allPass ? 'PHASE_3_4_PASS' : 'BLOCKED'
  console.log(JSON.stringify(evidence, null, 2))
  sockA.close(); sockB.close()
  await db.$disconnect()
  process.exit(allPass ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
