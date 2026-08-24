import { createHash } from 'crypto'
import { db, withTransaction } from './db'
import type { Prisma } from '@prisma/client'

// P0-22 — Audit trail integrity (immutable, complete)
// Direct Protector of I-07 (Audit Integrity).
//
// S4C Repair-07: Explicit predecessor-linked serialized append chain.
//
// ARCHITECTURE:
//   AuditLog entries no longer rely on inferred ordering (createdAt + id sorting).
//   Each entry explicitly names its predecessor via prevAuditId + prevHash.
//   A singleton AuditChainState tracks the current chain head.
//   Writers read the head, create a new entry pointing to it, then advance the head
//   — all within the SAME transaction. This eliminates:
//     - Race conditions (two writers picking the same predecessor)
//     - Non-monotonic ordering (random ID suffixes don't affect chain position)
//     - Timestamp collision ambiguity
//
// HISTORICAL DATA:
//   Pre-cutover entries have prevAuditId=NULL, chainOrdinal=NULL, hashVersion=1.
//   They are NOT modified. The cutover anchors to the historical tail's stored
//   id + hash (even if empty).
//
// HASH VERSIONING:
//   hashVersion=1: Legacy hash (prevHash|id|actorId|actorRole|action|metadata|createdAt)
//   hashVersion=2: Explicit-chain hash (prevHash|prevAuditId|chainOrdinal|id|actorId|actorRole|action|metadata|createdAt)
//   Historical entries retain hashVersion=1. New entries use hashVersion=2.

// ----------------------------------------------------------------------------
// Hash computation
// ----------------------------------------------------------------------------

function computeHashV1(
  prevHash: string,
  id: string,
  actorId: string | null,
  actorRole: string,
  action: string,
  metadata: string,
  createdAt: Date,
): string {
  const data = `${prevHash}|${id}|${actorId ?? 'null'}|${actorRole}|${action}|${metadata}|${createdAt.toISOString()}`
  return createHash('sha256').update(data).digest('hex')
}

function computeHashV2(
  prevHash: string,
  prevAuditId: string | null,
  chainOrdinal: bigint,
  id: string,
  actorId: string | null,
  actorRole: string,
  action: string,
  metadata: string,
  createdAt: Date,
): string {
  const data = `${prevHash}|${prevAuditId ?? 'null'}|${chainOrdinal.toString()}|${id}|${actorId ?? 'null'}|${actorRole}|${action}|${metadata}|${createdAt.toISOString()}`
  return createHash('sha256').update(data).digest('hex')
}

// ----------------------------------------------------------------------------
// Chain state bootstrap (idempotent, non-destructive)
// ----------------------------------------------------------------------------

const CHAIN_STATE_ID = 'GLOBAL'

async function ensureChainState(tx: Prisma.TransactionClient | typeof db): Promise<{
  headAuditId: string | null
  headHash: string
  nextOrdinal: bigint
}> {
  // Try to find existing chain state
  let state = await tx.auditChainState.findUnique({
    where: { id: CHAIN_STATE_ID },
  })

  if (state) {
    return {
      headAuditId: state.headAuditId,
      headHash: state.headHash,
      nextOrdinal: state.nextOrdinal,
    }
  }

  // Bootstrap: find the historical tail (last entry by legacy ordering)
  const tail = await tx.auditLog.findFirst({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, hash: true },
  })

  if (tail) {
    // Anchor to historical tail — even if its hash is empty
    state = await tx.auditChainState.create({
      data: {
        id: CHAIN_STATE_ID,
        headAuditId: tail.id,
        headHash: tail.hash ?? '',
        nextOrdinal: 1,
        version: 0,
      },
    })
  } else {
    // No audit rows at all — GENESIS state
    state = await tx.auditChainState.create({
      data: {
        id: CHAIN_STATE_ID,
        headAuditId: null,
        headHash: 'GENESIS',
        nextOrdinal: 1,
        version: 0,
      },
    })
  }

  return {
    headAuditId: state.headAuditId,
    headHash: state.headHash,
    nextOrdinal: state.nextOrdinal,
  }
}

// ----------------------------------------------------------------------------
// Canonical append primitive
// ----------------------------------------------------------------------------

/**
 * S4C Repair-07: The ONE canonical audit append primitive.
 *
 * Both audit() and auditWithTx() delegate to this. It:
 *   1. Reads the current chain head from AuditChainState (singleton)
 *   2. Creates a new AuditLog entry with explicit prevAuditId + prevHash + chainOrdinal
 *   3. Advances the chain head to the new entry
 *   All within the SAME transaction — no race conditions.
 *
 * The hash (version 2) includes prevAuditId + chainOrdinal to bind the entry
 * to its exact chain position, preventing any ambiguity.
 */
async function appendAudit(
  tx: Prisma.TransactionClient,
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  const state = await ensureChainState(tx)

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const createdAt = new Date()
  const metadataStr = JSON.stringify(metadata)
  const ordinal = state.nextOrdinal

  // Compute hash version 2 (explicit-chain)
  const hash = computeHashV2(
    state.headHash,
    state.headAuditId,
    ordinal,
    id,
    actorId ?? null,
    actorRole,
    action,
    metadataStr,
    createdAt,
  )

  // Create the audit entry with explicit predecessor linkage
  await tx.auditLog.create({
    data: {
      id,
      actorId: actorId ?? null,
      actorRole,
      action,
      metadata: metadataStr,
      createdAt,
      prevHash: state.headHash,
      hash,
      prevAuditId: state.headAuditId,
      chainOrdinal: ordinal,
      hashVersion: 2,
    },
  })

  // Advance the chain head to this new entry
  await tx.auditChainState.update({
    where: { id: CHAIN_STATE_ID },
    data: {
      headAuditId: id,
      headHash: hash,
      nextOrdinal: { increment: 1 },
      version: { increment: 1 },
    },
  })
}

// ----------------------------------------------------------------------------
// Sanctioned audit writers
// ----------------------------------------------------------------------------

/**
 * Non-transactional audit write. Delegates to appendAudit inside a transaction.
 * Use this when the audit write is NOT part of a larger business transaction.
 */
export async function audit(
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  await withTransaction(async (tx) => {
    await appendAudit(tx, action, metadata, actorId, actorRole)
  })
}

/**
 * Transaction-aware audit write. Use this when the audit write IS part of a
 * larger business transaction (pass the tx client). The caller's transaction
 * will include the audit append + head advancement atomically.
 */
export async function auditWithTx(
  tx: Prisma.TransactionClient,
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  await appendAudit(tx, action, metadata, actorId, actorRole)
}

// ----------------------------------------------------------------------------
// Read API (unchanged)
// ----------------------------------------------------------------------------

export async function readAuditLogs(opts: {
  limit?: number
  offset?: number
  action?: string
  actorId?: string
} = {}) {
  const { limit = 30, offset = 0, action, actorId } = opts
  return db.auditLog.findMany({
    where: {
      ...(action ? { action: { contains: action } } : {}),
      ...(actorId ? { actorId } : {}),
    },
    orderBy: [{ chainOrdinal: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(limit, 100),
    skip: offset,
    include: { actor: { select: { name: true, phone: true } } },
  })
}

// ----------------------------------------------------------------------------
// Integrity checker — split into legacy + post-cutover
// ----------------------------------------------------------------------------

export async function auditIntegrityCheck(): Promise<{
  ok: boolean
  brokenCount: number
  totalCount: number
  firstBrokenEntry?: { id: string; action: string; issue: string }

  // S4C Repair-07: split results
  legacyCount: number
  legacyBrokenCount: number
  postCutoverCount: number
  postCutoverBrokenCount: number

  // Post-cutover specific checks
  postCutoverForks: number         // entries with same prevAuditId
  postCutoverOrdinalGaps: number   // missing ordinals in sequence
  postCutoverHashFailures: number  // hash mismatch
  postCutoverPrevIdFailures: number   // prevAuditId doesn't match actual predecessor
  postCutoverPrevHashFailures: number // prevHash doesn't match predecessor's hash
}> {
  const entries = await db.auditLog.findMany({
    orderBy: [{ chainOrdinal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, actorId: true, actorRole: true, action: true, metadata: true,
      createdAt: true, prevHash: true, hash: true,
      prevAuditId: true, chainOrdinal: true, hashVersion: true,
    },
  })

  let brokenCount = 0
  let legacyBrokenCount = 0
  let postCutoverBrokenCount = 0
  let firstBrokenEntry: { id: string; action: string; issue: string } | undefined

  // Legacy section: walk with running prevHash (timestamp-ordered, as before)
  const legacyEntries = entries.filter(e => e.hashVersion === 1)
  let runningPrevHash = 'GENESIS'
  for (const entry of legacyEntries) {
    if (entry.prevHash !== runningPrevHash) {
      brokenCount++; legacyBrokenCount++
      if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: `prevHash mismatch: expected ${runningPrevHash}, got ${entry.prevHash}` }
    }
    const recomputed = computeHashV1(entry.prevHash, entry.id, entry.actorId, entry.actorRole, entry.action, entry.metadata, entry.createdAt)
    if (entry.hash !== recomputed) {
      brokenCount++; legacyBrokenCount++
      if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: 'hash mismatch' }
    }
    runningPrevHash = entry.hash
  }

  // Post-cutover section: verify via explicit prevAuditId chain
  const postEntries = entries.filter(e => e.hashVersion === 2)
  let postCutoverForks = 0
  let postCutoverOrdinalGaps = 0
  let postCutoverHashFailures = 0
  let postCutoverPrevIdFailures = 0
  let postCutoverPrevHashFailures = 0

  // Build a map of id → entry for lookup
  const entryMap = new Map(postEntries.map(e => [e.id, e]))

  // Track seen prevAuditIds to detect forks
  const seenPrevAuditIds = new Map<string, number>()

  // Track expected ordinal sequence
  let expectedOrdinal: bigint | null = null

  for (const entry of postEntries) {
    // 1. Check hash (version 2)
    const ordinal = entry.chainOrdinal!
    const recomputed = computeHashV2(
      entry.prevHash, entry.prevAuditId, ordinal,
      entry.id, entry.actorId, entry.actorRole, entry.action, entry.metadata, entry.createdAt,
    )
    if (entry.hash !== recomputed) {
      postCutoverHashFailures++; brokenCount++; postCutoverBrokenCount++
      if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: 'post-cutover hash mismatch' }
    }

    // 2. Check fork: has this prevAuditId been used by another entry?
    const prevId = entry.prevAuditId ?? 'GENESIS'
    const seenCount = seenPrevAuditIds.get(prevId) ?? 0
    if (seenCount > 0) {
      postCutoverForks++; brokenCount++; postCutoverBrokenCount++
      if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: `fork: prevAuditId ${prevId} already used` }
    }
    seenPrevAuditIds.set(prevId, seenCount + 1)

    // 3. Check prevAuditId points to a real entry (or GENESIS/null)
    if (entry.prevAuditId !== null) {
      const predecessor = entryMap.get(entry.prevAuditId)
      if (!predecessor) {
        // Could be a legacy entry (predecessor is historical)
        // Check if it exists in the full entry set
        const fullLookup = entries.find(e => e.id === entry.prevAuditId)
        if (!fullLookup) {
          postCutoverPrevIdFailures++; brokenCount++; postCutoverBrokenCount++
          if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: `prevAuditId ${entry.prevAuditId} not found` }
        }
      }

      // 4. Check prevHash matches predecessor's hash
      if (predecessor || entries.find(e => e.id === entry.prevAuditId)) {
        const pred = predecessor ?? entries.find(e => e.id === entry.prevAuditId)!
        if (entry.prevHash !== pred.hash) {
          postCutoverPrevHashFailures++; brokenCount++; postCutoverBrokenCount++
          if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: 'prevHash does not match predecessor hash' }
        }
      }
    }

    // 5. Check ordinal sequence (gaps)
    if (expectedOrdinal !== null && ordinal !== expectedOrdinal) {
      postCutoverOrdinalGaps++; brokenCount++; postCutoverBrokenCount++
      if (!firstBrokenEntry) firstBrokenEntry = { id: entry.id, action: entry.action, issue: `ordinal gap: expected ${expectedOrdinal}, got ${ordinal}` }
    }
    expectedOrdinal = ordinal + 1n
  }

  return {
    ok: brokenCount === 0,
    brokenCount,
    totalCount: entries.length,
    firstBrokenEntry,
    legacyCount: legacyEntries.length,
    legacyBrokenCount,
    postCutoverCount: postEntries.length,
    postCutoverBrokenCount,
    postCutoverForks,
    postCutoverOrdinalGaps,
    postCutoverHashFailures,
    postCutoverPrevIdFailures,
    postCutoverPrevHashFailures,
  }
}
