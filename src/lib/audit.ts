import { createHash } from 'crypto'
import { db } from './db'
import type { Prisma } from '@prisma/client'

// P0-22 — Audit trail integrity (immutable, complete)
// Direct Protector of I-07 (Audit Integrity).
//
// DEV-001 CLOSURE: Hash-chain tamper-evidence implemented.
// Each audit entry includes: prevHash (hash of previous entry) + hash (SHA-256 of own data).
// If any entry is modified or deleted, the chain breaks and integrity check detects it.
//
// This makes tampering DETECTABLE. True PREVENTION (blocking UPDATE/DELETE at storage level)
// still requires production-grade WORM storage (PostgreSQL REVOKE, QLDB, or separate audit DB).
// The hash-chain is the interim tamper-EVIDENCE layer; production WORM is the tamper-PREVENTION layer.

function computeHash(
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

// Create an audit log entry with hash-chain linkage.
// This is the ONLY sanctioned write path to the audit table (non-transactional).
//
// S4C Ordering Repair-05: Uses deterministic total order (createdAt DESC, id DESC)
// for predecessor selection. This ensures writer and checker always agree on
// chain order, even when timestamps collide.
export async function audit(
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  // Get the last entry's hash (for chain linkage)
  // S4C Ordering Repair-05: compound orderBy for deterministic tie-breaking
  const lastEntry = await db.auditLog.findFirst({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { hash: true },
  })

  // S4C Boundary Repair-04: FAIL-CLOSED CONTIGUOUS APPEND.
  // Chain to the immediate predecessor's STORED hash, even if empty.
  // GENESIS only when NO previous row exists (true first entry).
  const prevHash = lastEntry === null ? 'GENESIS' : (lastEntry?.hash ?? '')

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const createdAt = new Date()
  const metadataStr = JSON.stringify(metadata)
  const hash = computeHash(prevHash, id, actorId ?? null, actorRole, action, metadataStr, createdAt)

  await db.auditLog.create({
    data: {
      id,
      actorId: actorId ?? null,
      actorRole,
      action,
      metadata: metadataStr,
      createdAt,
      prevHash,
      hash,
    },
  })
}

// S4C C2 Repair: Transaction-aware audit write.
//
// This is the sanctioned write path for audit entries that MUST participate in
// an existing withTransaction. It uses the same computeHash() logic as audit()
// but reads the last entry's hash via the transaction client (tx), ensuring
// the chain is consistent within the transaction snapshot.
//
// S4C Boundary Repair-04 (FAIL-CLOSED CONTIGUOUS APPEND policy):
// The prevHash MUST chain to the immediate predecessor's STORED hash value,
// even if that hash is empty ("") or malformed. This preserves a contiguous
// append history — new entries do NOT skip or normalize broken predecessors.
//
// GENESIS is used ONLY when there is NO previous audit row (true first entry).
// If a previous row exists but its hash is empty, the new entry's prevHash
// will be "" (the stored predecessor value), NOT "GENESIS".
//
// Historical data note: pre-S4C entries have empty hash + prevHash=GENESIS.
// The global auditIntegrityCheck() will still report historical breakage,
// but NEW entries will have valid hashes and contiguous prevHash linkage.
// Historical rows are NOT modified.
export async function auditWithTx(
  tx: Prisma.TransactionClient,
  action: string,
  metadata: Record<string, unknown> = {},
  actorId?: string,
  actorRole: string = 'SYSTEM',
): Promise<void> {
  // Get the last entry's hash (for chain linkage) — using tx, not db
  // S4C Ordering Repair-05: compound orderBy for deterministic tie-breaking
  const lastEntry = await tx.auditLog.findFirst({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { hash: true },
  })

  // S4C Boundary Repair-04: FAIL-CLOSED CONTIGUOUS APPEND.
  // Chain to the immediate predecessor's STORED hash, even if empty.
  // GENESIS only when NO previous row exists (true first entry).
  const prevHash = lastEntry === null ? 'GENESIS' : (lastEntry?.hash ?? '')

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const createdAt = new Date()
  const metadataStr = JSON.stringify(metadata)
  const hash = computeHash(prevHash, id, actorId ?? null, actorRole, action, metadataStr, createdAt)

  await tx.auditLog.create({
    data: {
      id,
      actorId: actorId ?? null,
      actorRole,
      action,
      metadata: metadataStr,
      createdAt,
      prevHash,
      hash,
    },
  })
}

// Read audit logs (paginated, filterable) — READ ONLY.
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
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
    include: { actor: { select: { name: true, phone: true } } },
  })
}

// Integrity check: verify the hash chain is unbroken.
// Walks all entries in chronological order, recomputes each hash, and verifies:
//   1. Each entry's hash matches recomputed hash (no mutation)
//   2. Each entry's prevHash matches previous entry's hash (no deletion/insertion)
// Returns { ok, brokenCount, totalCount, firstBrokenEntry? }.
export async function auditIntegrityCheck(): Promise<{
  ok: boolean
  brokenCount: number
  totalCount: number
  firstBrokenEntry?: { id: string; action: string; issue: string }
}> {
  // S4C Ordering Repair-05: deterministic total order (createdAt ASC, id ASC)
  // ensures checker walks entries in exactly the same order the writer chained them.
  const entries = await db.auditLog.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, actorId: true, actorRole: true, action: true, metadata: true, createdAt: true, prevHash: true, hash: true },
  })

  let brokenCount = 0
  let prevHash = 'GENESIS'
  let firstBrokenEntry: { id: string; action: string; issue: string } | undefined

  for (const entry of entries) {
    // Check chain linkage
    if (entry.prevHash !== prevHash) {
      brokenCount++
      if (!firstBrokenEntry) {
        firstBrokenEntry = { id: entry.id, action: entry.action, issue: `prevHash mismatch: expected ${prevHash}, got ${entry.prevHash}` }
      }
    }

    // Check hash integrity
    const recomputedHash = computeHash(entry.prevHash, entry.id, entry.actorId, entry.actorRole, entry.action, entry.metadata, entry.createdAt)
    if (entry.hash !== recomputedHash) {
      brokenCount++
      if (!firstBrokenEntry) {
        firstBrokenEntry = { id: entry.id, action: entry.action, issue: 'hash mismatch (entry may have been modified)' }
      }
    }

    prevHash = entry.hash
  }

  return {
    ok: brokenCount === 0,
    brokenCount,
    totalCount: entries.length,
    firstBrokenEntry,
  }
}
