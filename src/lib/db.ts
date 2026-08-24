import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// ----------------------------------------------------------------------------
// P0-25 / P0-17 — Shared transaction primitive
// ----------------------------------------------------------------------------
// `withTransaction()` wraps a function in `prisma.$transaction(fn)` and adds
// automatic retry-on-conflict for optimistic-lock / serialization failures.
//
// Prisma throws `PrismaClientKnownRequestError` with code `P2034`
// (transaction failed due to a write conflict or a deadlock) when two
// concurrent transactions touch the same row. Postgres may also throw
// serialization failures under certain isolation levels. We retry the whole
// transaction body up to `maxRetries` times (default 3) with exponential
// backoff before surfacing the conflict as a 409 to the caller.
//
// Usage:
//   const result = await withTransaction(async (tx) => {
//     const order = await tx.order.findUnique({ where: { id } })
//     // ... business logic using `tx` (the transaction client) ...
//     return updatedOrder
//   })
//
// The callback receives a `Prisma.TransactionClient` — use it for ALL reads
// and writes inside the transaction so they share the same snapshot + locks.
// ----------------------------------------------------------------------------

const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 50
// Default transaction timeout. On SQLite, concurrent write transactions
// serialize via a database-level lock, so they need more time. On PostgreSQL,
// row-level locks make this less of an issue.
const DEFAULT_TX_TIMEOUT_MS = 30000
const DEFAULT_MAX_WAIT_MS = 10000

/**
 * Error thrown when a transaction conflicts after exhausting all retries.
 * Callers should translate this to an HTTP 409 Conflict response.
 */
export class TransactionConflictError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly attempts: number,
  ) {
    super(message)
    this.name = 'TransactionConflictError'
  }
}

function isRetryableConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: Transaction failed due to a write conflict or a deadlock (PostgreSQL).
    // P2036: Transaction timeout (rare; treat as retryable).
    // P1008: Socket timeout — database failed to respond within the configured
    //        timeout. On SQLite with concurrent write transactions, this happens
    //        when transactions queue for the write lock. Retrying is safe: the
    //        retry re-runs the entire transaction body, and the early
    //        idempotency-cache check (getCachedResponse) will return the cached
    //        response if another transaction committed first.
    // P2002: Unique constraint violation. For idempotency-keyed writes, this
    //        means another concurrent transaction committed the same key first.
    //        Retrying will find the cached response via getCachedResponse.
    //        This is ONLY safe for routes that check the idempotency cache at
    //        the start of the transaction body (the standard pattern).
    // P2024: Timed out fetching a connection from the pool (transient).
    return error.code === 'P2034' || error.code === 'P2036' ||
           error.code === 'P1008' || error.code === 'P2002' ||
           error.code === 'P2024'
  }
  // S4C Repair-08: AuditConcurrencyError is retryable.
  // When auditWithTx's CAS fails (concurrent writer won the chain head),
  // the entire business transaction should retry — including the audit append.
  // This ensures the business mutation + audit append remain atomic.
  if (error instanceof Error && error.name === 'AuditConcurrencyError') {
    return true
  }
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface WithTransactionOptions {
  maxRetries?: number
  timeout?: number
  maxWait?: number
}

export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: WithTransactionOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES
  const timeout = options?.timeout ?? DEFAULT_TX_TIMEOUT_MS
  const maxWait = options?.maxWait ?? DEFAULT_MAX_WAIT_MS
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await db.$transaction(fn, {
        timeout,
        maxWait,
      })
    } catch (error) {
      lastError = error
      if (isRetryableConflict(error) && attempt < maxRetries) {
        // Exponential backoff: 10ms, 20ms, 40ms...
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)
        await sleep(backoff)
        continue
      }
      // Not retryable, or out of retries
      if (isRetryableConflict(error)) {
        const code = (error as Prisma.PrismaClientKnownRequestError).code
        throw new TransactionConflictError(
          `Transaction conflicted after ${attempt} attempts (Prisma code ${code}). Retry the request.`,
          code,
          attempt,
        )
      }
      // Non-conflict error — rethrow as-is
      throw error
    }
  }

  // Should be unreachable, but satisfies the type checker
  throw new TransactionConflictError(
    `Transaction failed after ${maxRetries} attempts without a specific conflict code.`,
    'UNKNOWN',
    maxRetries,
  )
}

/**
 * Optimistic-lock conditional update helper.
 *
 * Returns the updated row if `version` matched (success), or `null` if the
 * row was modified by another transaction (conflict — caller should 409).
 *
 * Usage:
 *   const updated = await optimisticUpdate(tx.order, id, expectedVersion, data)
 *   if (!updated) return apiError('CONFLICT', 'Stale state', 409)
 *
 * NOTE: This is a pattern helper, not a full optimistic-lock implementation.
 * For full atomicity, wrap the read + this update in `withTransaction()`.
 */
export async function optimisticUpdate<T extends { id: string; version: number }, A>(
  model: {
    update: (args: {
      where: { id: string; version: number }
      data: A
    }) => Promise<T | null>
  },
  id: string,
  expectedVersion: number,
  data: A,
): Promise<T | null> {
  try {
    const result = await model.update({
      where: { id, version: expectedVersion },
      data,
    })
    return result
  } catch {
    // Prisma throws P2025 (record not found) when the version doesn't match.
    // Translate to null so callers can return 409.
    return null
  }
}
