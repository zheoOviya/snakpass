import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { IdempotencyKeyReuseError } from './errors'
import { isFeatureEnabled } from './deployment'

// P0-17 — Idempotency library
// Critical writes (orders, payments, refunds, status updates) accept an
// `Idempotency-Key` header. Retries with the same key return the cached
// response instead of creating a duplicate resource.
//
// Sub-Wave 3c (C1 requestHash):
//   When the `requestHashEnforcement` feature flag is ON, the request body is
//   canonicalized + hashed (SHA-256). If the same idempotency key is reused
//   with a materially different request body (hash mismatch), an
//   IdempotencyKeyReuseError (HTTP 422) is thrown.
//
// Design:
//   1. Client sends `Idempotency-Key: <uuid>` header on POST /api/orders.
//   2. Server checks `IdempotencyKey` table inside the SAME transaction as
//      the business write.
//   3. If key exists → return cached response (status + body).
//      (If requestHashEnforcement is ON and stored requestHash is non-null,
//       compare with incoming hash → throw IdempotencyKeyReuseError on mismatch.)
//   4. Else → execute business write, store key + response + hash, commit.
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

// ----------------------------------------------------------------------------
// Sub-Wave 3c: Request body canonicalization + hashing
// ----------------------------------------------------------------------------

/**
 * Canonicalize a request body object for deterministic hashing.
 *
 * Uses a simplified JSON Canonicalization Scheme (RFC 8785):
 *   - Sort object keys alphabetically (recursively)
 *   - Preserve array order (arrays are ordered sequences)
 *   - Compact JSON string (no whitespace)
 *   - UTF-8 encoding
 *
 * This ensures that two semantically-equivalent request bodies produce the
 * same hash, even if the client sent them with different key ordering or
 * whitespace.
 *
 * Example:
 *   { b: 2, a: 1 } → '{"a":1,"b":2}'
 *   { a: 1, b: 2 } → '{"a":1,"b":2}'  (same canonical form)
 *
 * @param body - The request body object (already parsed from JSON)
 * @returns The canonical JSON string
 */
export function canonicalizeRequestBody(body: unknown): string {
  return JSON.stringify(canonicalizeValue(body))
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null) return null
  if (Array.isArray(value)) {
    // Arrays: preserve order, canonicalize each element
    return value.map(canonicalizeValue)
  }
  if (typeof value === 'object' && value !== undefined) {
    // Objects: sort keys alphabetically, canonicalize each value
    const sorted: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()
    for (const k of keys) {
      sorted[k] = canonicalizeValue((value as Record<string, unknown>)[k])
    }
    return sorted
  }
  // Primitives: return as-is (string, number, boolean, undefined)
  return value
}

/**
 * Compute the SHA-256 hash of a canonicalized request body.
 *
 * @param body - The request body object (already parsed from JSON)
 * @returns The hex-encoded SHA-256 hash (64 characters)
 */
export function computeRequestHash(body: unknown): string {
  const canonical = canonicalizeRequestBody(body)
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

// ----------------------------------------------------------------------------
// Cached response retrieval (with optional hash enforcement)
// ----------------------------------------------------------------------------

/**
 * Check if an idempotency key already has a cached response.
 * MUST be called inside a transaction (pass the `tx` client from withTransaction).
 *
 * Sub-Wave 3c: If the `requestHashEnforcement` feature flag is ON and the
 * stored `requestHash` is non-null, this function compares the stored hash
 * with the incoming `incomingRequestHash`. On mismatch, it throws
 * IdempotencyKeyReuseError (HTTP 422).
 *
 * @param tx - The Prisma transaction client
 * @param key - The idempotency key
 * @param incomingRequestHash - The SHA-256 hash of the incoming request body (or null if not computed)
 * @returns The cached response if found + not expired + hash matches, else null
 * @throws IdempotencyKeyReuseError if hash mismatch (only when flag ON + stored hash non-null)
 */
export async function getCachedResponse(
  tx: Prisma.TransactionClient,
  key: string,
  incomingRequestHash: string | null = null,
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

  // Sub-Wave 3c: Request hash enforcement
  // Only enforce if ALL of:
  //   1. requestHashEnforcement flag is ON
  //   2. stored requestHash is non-null (post-3c records)
  //   3. incomingRequestHash is non-null (caller computed it)
  // If any condition is false, skip the hash check (backward-compatible).
  if (
    isFeatureEnabled('requestHashEnforcement') &&
    record.requestHash !== null &&
    incomingRequestHash !== null &&
    record.requestHash !== incomingRequestHash
  ) {
    // Hash mismatch — same key used for materially different request
    throw new IdempotencyKeyReuseError(
      key,
      record.requestHash,
      incomingRequestHash,
      record.resourceType,
      record.resourceId,
    )
  }

  return { status: record.responseStatus, body: record.responseBody }
}

// ----------------------------------------------------------------------------
// Idempotency record storage (with optional hash storage)
// ----------------------------------------------------------------------------

/**
 * Store an idempotency key + cached response + request hash.
 * MUST be called inside the SAME transaction as the business write.
 *
 * Sub-Wave 3c: If `requestHash` is non-null, it is stored alongside the
 * cached response. This enables future hash enforcement (when the
 * requestHashEnforcement flag is ON).
 *
 * Returns void; throws if the key already exists (should have been caught by
 * getCachedResponse earlier in the transaction).
 *
 * @param tx - The Prisma transaction client
 * @param key - The idempotency key
 * @param resourceType - The resource type (e.g. "Order", "Payment")
 * @param resourceId - The created resource ID
 * @param responseStatus - The HTTP status code to cache
 * @param responseBody - The JSON-serialized response body to cache
 * @param requestHash - The SHA-256 hash of the request body (or null if not computed)
 */
export async function storeIdempotencyRecord(
  tx: Prisma.TransactionClient,
  key: string,
  resourceType: string,
  resourceId: string,
  responseStatus: number,
  responseBody: string,
  requestHash: string | null = null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_KEY_TTL_HOURS * 60 * 60 * 1000)
  await tx.idempotencyKey.create({
    data: {
      key,
      resourceType,
      resourceId,
      responseStatus,
      responseBody,
      requestHash,
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
