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
  version: number
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
      version: state.version,
    }
  }

  // Bootstrap: find the historical tail (last entry by legacy ordering)
  const tail = await tx.auditLog.findFirst({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, hash: true },
  })

  // S4C Repair-09: PostgreSQL-safe bootstrap.
  //
  // On PostgreSQL, a unique constraint violation (P2002) ABORTS the entire
  // transaction — subsequent statements fail. The previous "catch P2002 and
  // re-read" pattern is NOT portable to PostgreSQL.
  //
  // Fix: Use upsert with `createIfNotExists` semantics. Prisma's upsert is
  // atomic and does NOT abort the transaction on conflict — it either creates
  // the row or returns the existing one. This is portable across SQLite and
  // PostgreSQL.
  //
  // After upsert, we always re-read to get the current state (whether we won
  // the race or lost it). The re-read is in the same transaction, which is
  // safe because upsert did NOT abort it.
  const headAuditId = tail?.id ?? null
  const headHash = tail?.hash ?? 'GENESIS'

  await tx.auditChainState.upsert({
    where: { id: CHAIN_STATE_ID },
    create: {
      id: CHAIN_STATE_ID,
      headAuditId,
      headHash,
      nextOrdinal: 1,
      version: 0,
    },
    update: {}, // No-op if already exists — we just need the row to exist
  })

  // Re-read to get the current state (whether we created it or another writer did)
  state = await tx.auditChainState.findUnique({
    where: { id: CHAIN_STATE_ID },
  })

  if (!state) {
    throw new Error('AuditChainState bootstrap failed: upsert did not create or find the row')
  }

  return {
    headAuditId: state.headAuditId,
    headHash: state.headHash,
    nextOrdinal: state.nextOrdinal,
    version: state.version,
  }
}

// ----------------------------------------------------------------------------
// Canonical append primitive — CAS (compare-and-swap) concurrency-safe
// ----------------------------------------------------------------------------

const MAX_APPEND_RETRIES = 5

/**
 * S4C Repair-08: Internal error for CAS retry signaling.
 * When thrown inside a Prisma transaction, it aborts the transaction.
 * The caller (withTransaction or auditWithTx caller) catches it and retries
 * the entire transaction.
 */
class AuditConcurrencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditConcurrencyError'
  }
}

/**
 * S4C Repair-08: CAS-safe audit append — the transaction-interior operation.
 *
 * This function runs INSIDE a Prisma transaction. It:
 *   1. Reads AuditChainState (head + version for CAS)
 *   2. Creates AuditLog entry pointing to current head
 *   3. CAS update: updateMany WHERE id='GLOBAL' AND version=observed
 *   4. If count=1 → success, return
 *   5. If count=0 → throw AuditConcurrencyError → transaction aborts → caller retries
 *
 * The CAS uses updateMany (not update) because updateMany supports composite
 * WHERE clauses (id + version). This is the portable, DB-independent approach:
 *   - SQLite: updateMany with WHERE version=X is atomic within BEGIN IMMEDIATE
 *   - PostgreSQL: updateMany with WHERE version=X is atomic even under
 *     READ COMMITTED because the UPDATE acquires a row lock
 *
 * If the CAS fails, the AuditLog row created in step 2 is also rolled back
 * because it's in the same transaction. No dangling rows.
 */
async function appendAuditInTx(
  tx: Prisma.TransactionClient,
  action: string,
  metadata: Record<string, unknown>,
  actorId: string | undefined,
  actorRole: string,
): Promise<void> {
  // Step 1: Read current chain state (head + version for CAS)
  const state = await ensureChainState(tx)

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const createdAt = new Date()
  const metadataStr = JSON.stringify(metadata)
  const ordinal = state.nextOrdinal
  const observedVersion = state.version

  // Step 2: Compute hash v2 (includes prevAuditId + chainOrdinal)
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

  // Step 3: Create the audit entry (will roll back if CAS fails)
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

  // Step 4: CAS update — only advances head if version hasn't changed
  // WHERE id = 'GLOBAL' AND version = observedVersion
  // If another writer already advanced the head, version won't match,
  // updateMany returns count=0, and this transaction will abort.
  const casResult = await tx.auditChainState.updateMany({
    where: {
      id: CHAIN_STATE_ID,
      version: observedVersion,
    },
    data: {
      headAuditId: id,
      headHash: hash,
      nextOrdinal: ordinal + 1n,
      version: observedVersion + 1,
    },
  })

  if (casResult.count !== 1) {
    // CAS failed — concurrent writer won. Throw to abort this transaction.
    // The caller's retry loop will re-enter with a fresh transaction.
    throw new AuditConcurrencyError(
      `CAS failed: version ${observedVersion} was already advanced by a concurrent writer`,
    )
  }

  // CAS succeeded — head transition is ours. Transaction will commit.
}

// ----------------------------------------------------------------------------
// Sanctioned audit writers
// ----------------------------------------------------------------------------

/**
 * Non-transactional audit write with CAS retry.
 * Each retry runs in a fresh withTransaction. If CAS fails (concurrent writer
 * won the head), the transaction aborts and we retry after backoff.
 */
export async function audit(
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_APPEND_RETRIES; attempt++) {
    try {
      await withTransaction(async (tx) => {
        await appendAuditInTx(tx, action, metadata, actorId, actorRole)
      })
      return // Success
    } catch (error) {
      if (error instanceof AuditConcurrencyError && attempt < MAX_APPEND_RETRIES) {
        const backoff = 10 * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        continue
      }
      throw error
    }
  }
  throw new Error(`Audit append failed after ${MAX_APPEND_RETRIES} retries (concurrency contention)`)
}

/**
 * Transaction-aware audit write with CAS.
 * Called inside an EXISTING withTransaction. If the CAS fails, throws
 * AuditConcurrencyError. The CALLER's withTransaction should handle this:
 *
 * The social routes that call auditWithTx are already wrapped in
 * withTransaction which retries on conflicts. AuditConcurrencyError will
 * cause the withTransaction to abort and retry the ENTIRE business
 * transaction (including the audit append). This is correct — the business
 * mutation + audit append are atomic.
 *
 * For callers that don't use withTransaction (rare), they should catch
 * AuditConcurrencyError and retry their transaction.
 */
export async function auditWithTx(
  tx: Prisma.TransactionClient,
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  await appendAuditInTx(tx, action, metadata, actorId, actorRole)
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
