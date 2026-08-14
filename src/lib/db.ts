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

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 10

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
    // P2034: Transaction failed due to a write conflict or a deadlock.
    // P2036: Transaction timeout (rare; treat as retryable).
    return error.code === 'P2034' || error.code === 'P2036'
  }
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxRetries?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await db.$transaction(fn)
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
