import { Prisma } from '@prisma/client'

// P0-17 — Idempotency library
// Critical writes (orders, payments, refunds, status updates) accept an
// `Idempotency-Key` header. Retries with the same key return the cached
// response instead of creating a duplicate resource.
//
// Design:
//   1. Client sends `Idempotency-Key: <uuid>` header on POST /api/orders.
//   2. Server checks `IdempotencyKey` table inside the SAME transaction as
//      the business write.
//   3. If key exists → return cached response (status + body).
//   4. Else → execute business write, store key + response, commit.
//
// The check + write MUST be in the same transaction (via `withTransaction`)
// to prevent phantom-block (key consumed but write failed → user cannot retry).

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
const IDEMPOTENCY_KEY_TTL_HOURS = 24

/**
 * Extract the idempotency key from a request header.
 * Returns null if not present or invalid (must be 8-128 chars, alphanumeric + dash).
 */
export function getIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get(IDEMPOTENCY_KEY_HEADER)
  if (!raw) return null
  // Validate format: 8-128 chars, alphanumeric + dash + underscore.
  // This prevents SQL injection + ensures the key is usable as a unique identifier.
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(raw)) return null
  return raw
}

/**
 * Check if an idempotency key already has a cached response.
 * MUST be called inside a transaction (pass the `tx` client from withTransaction).
 *
 * Returns the cached response if found + not expired, else null.
 */
export async function getCachedResponse(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<{ status: number; body: string } | null> {
  const record = await tx.idempotencyKey.findUnique({
    where: { key },
  })
  if (!record) return null
  // Check TTL
  if (record.expiresAt.getTime() < Date.now()) {
    // Expired — treat as not found (caller will create a new entry)
    return null
  }
  return { status: record.responseStatus, body: record.responseBody }
}

/**
 * Store an idempotency key + cached response.
 * MUST be called inside the SAME transaction as the business write.
 *
 * Returns void; throws if the key already exists (should have been caught by
 * getCachedResponse earlier in the transaction).
 */
export async function storeIdempotencyRecord(
  tx: Prisma.TransactionClient,
  key: string,
  resourceType: string,
  resourceId: string,
  responseStatus: number,
  responseBody: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000)
  await tx.idempotencyKey.create({
    data: {
      key,
      resourceType,
      resourceId,
      responseStatus,
      responseBody,
      expiresAt,
    },
  })
}

/**
 * Helper: parse a cached response body and return it + the status code.
 * Used by route handlers to return the cached response to the client.
 */
export function parseCachedResponse(cached: { status: number; body: string }): {
  status: number
  body: unknown
} {
  try {
    return { status: cached.status, body: JSON.parse(cached.body) }
  } catch {
    // Body wasn't valid JSON (shouldn't happen, but be defensive)
    return { status: cached.status, body: { raw: cached.body } }
  }
}
