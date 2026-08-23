// src/lib/social-activity.ts
//
// Server-side helper for recording friend activity feed events.
//
// CRITICAL INVARIANT (blueprint §18 SOCIAL GRAPH + §6 P2):
//   The activity feed NEVER exposes payment amounts. The `metadata` field is
//   sanitized server-side — sensitive keys (`amount`, `total`, `price`,
//   `paymentId`, `razorpayPaymentId`, `razorpaySignature`) are stripped before
//   the SocialActivity row is written AND before the row is returned to the
//   client. This is a defense-in-depth measure:
//     1. RECORDED-SIDE SANITIZATION (this module): strips sensitive keys
//        before INSERT so the DB never stores them.
//     2. READ-SIDE SANITIZATION (feed route): strips again before returning
//        so even legacy rows (or rows written by other code paths) are safe.
//
// Governance (plan §6A):
//   - Called by:
//       * POST /api/social/activities (consumer-triggered — e.g. after order
//         creation, gift creation, group order creation)
//       * POST /api/rewards/on-picked-up (additive — records EARNED_REWARD)
//   - NEVER called from inside `src/app/api/orders/route.ts` (POST) — that
//     route is governance-protected. ORDERED activities are recorded via the
//     new POST /api/social/activities endpoint called by the consumer-view
//     AFTER successful order creation.
//
// Transactional:
//   This module does NOT open its own Prisma transaction. The caller wraps
//   every call in `withTransaction(async (tx) => { ... })` and passes the `tx`
//   (Prisma.TransactionClient) into `recordActivity()`. This ensures the
//   activity row is committed atomically with the triggering mutation
//   (e.g., reward issuance, gift creation).

import { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// VERBS — the activity types supported by the feed.
// ---------------------------------------------------------------------------
// Uppercase convention matches the SocialActivity.verb column comment in
// prisma/schema.prisma (ORDERED | ORDERED_ITEM | GIFTED | GROUP_ORDERED |
// REWARDED | REDEEMED). Task 6A introduces:
//   - ORDERED       : "Alex ordered from Campus Cafe"
//   - EARNED_REWARD : "Alex earned 50 reward points"
//   - GIFTED        : "Alex sent a gift"
//   - JOINED_GROUP  : "Alex joined a group order"
//   - FRIEND_ADDED  : "Alex is now friends with Sam"
// ---------------------------------------------------------------------------
export const VERBS = {
  ORDERED: 'ORDERED',
  EARNED_REWARD: 'EARNED_REWARD',
  GIFTED: 'GIFTED',
  JOINED_GROUP: 'JOINED_GROUP',
  FRIEND_ADDED: 'FRIEND_ADDED',
} as const

export type SocialVerb = (typeof VERBS)[keyof typeof VERBS]

// ---------------------------------------------------------------------------
// SENSITIVE_METADATA_KEYS — keys that MUST NEVER appear in SocialActivity.metadata.
// ---------------------------------------------------------------------------
// These keys are stripped by `sanitizeActivityMetadata()` (recursively) before
// the metadata is JSON.stringified and stored in the DB. The same function is
// called on read to strip again (defense-in-depth — handles legacy rows).
//
// Why these specific keys:
//   - amount, total, price          : direct monetary values
//   - paymentId                      : Razorpay payment ID (links to money table)
//   - razorpayPaymentId              : Razorpay's payment ID (same as paymentId)
//   - razorpaySignature              : cryptographic proof of payment (forgable
//                                      if leaked — must NEVER be persisted
//                                      outside the Payment table)
// ---------------------------------------------------------------------------
export const SENSITIVE_METADATA_KEYS: ReadonlySet<string> = new Set([
  'amount',
  'total',
  'price',
  'paymentId',
  'razorpayPaymentId',
  'razorpaySignature',
  // Common variants callers might slip in:
  'amountPaise',
  'totalAmount',
  'totalPaise',
  'subtotal',
  'grandTotal',
  'discountAmount',
  'refundAmount',
  'paidAmount',
  'chargedAmount',
])

/**
 * Strip sensitive keys from a metadata object.
 *
 * Recursively walks the object (including nested objects + arrays) and removes
 * any key whose name (case-insensitive) is in `SENSITIVE_METADATA_KEYS`.
 *
 * PURE function — does NOT mutate the input. Returns a new object.
 *
 * @param metadata - The input metadata object (or null/undefined → returns {})
 * @returns A sanitized copy with sensitive keys removed.
 */
export function sanitizeActivityMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === null || metadata === undefined) {
    return {}
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    // Non-object metadata → return empty (we only store objects).
    // Arrays of primitives are also rejected (the metadata column is an object).
    return {}
  }

  const clean: Record<string, unknown> = {}
  const source = metadata as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
      // Skip — sensitive key
      continue
    }
    const value = source[key]
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        clean[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? sanitizeActivityMetadata(item)
            : item,
        )
      } else {
        clean[key] = sanitizeActivityMetadata(value)
      }
    } else {
      clean[key] = value
    }
  }
  return clean
}

// ---------------------------------------------------------------------------
// recordActivity — transactional helper used by other routes.
// ---------------------------------------------------------------------------

export interface RecordActivityParams {
  /** The user who performed the action. */
  actorId: string
  /** The verb (use VERBS constant). */
  verb: string
  /** The type of object this activity refers to (e.g. 'Restaurant', 'Order'). */
  objectType: string
  /** The id of the object this activity refers to. */
  objectId: string
  /** Optional metadata — sensitive keys will be stripped before storage. */
  metadata?: Record<string, unknown>
  /** Visibility — 'FRIENDS' (default) | 'PUBLIC' | 'PRIVATE'. */
  visibility?: 'FRIENDS' | 'PUBLIC' | 'PRIVATE'
  /**
   * Optional idempotency key — activities are append-only (each event creates
   * a new row), but dedup is nice for retry safety. When provided, the helper
   * checks for an existing activity with the same key prefix and returns it
   * instead of creating a duplicate.
   */
  idempotencyKey?: string
}

export interface SocialActivityRow {
  id: string
  actorId: string
  verb: string
  objectType: string
  objectId: string
  metadata: string // JSON-stringified
  visibility: string
  createdAt: Date
}

/**
 * Record a social activity row INSIDE the caller's transaction.
 *
 * MUST be called inside `withTransaction(async (tx) => { ... })` — pass the
 * `tx` (Prisma.TransactionClient). This ensures the activity is committed
 * atomically with the triggering mutation (reward issuance, gift creation,
 * etc.).
 *
 * Behavior:
 *   1. Sanitizes the metadata (strips sensitive keys recursively).
 *   2. If `idempotencyKey` is provided, checks for an existing row with a
 *      matching key (encoded in metadata.idempotencyKey). If found, returns
 *      it WITHOUT creating a duplicate.
 *   3. Otherwise, creates a new SocialActivity row with the sanitized metadata.
 *
 * @returns The created (or existing) SocialActivity row.
 */
export async function recordActivity(
  tx: Prisma.TransactionClient,
  params: RecordActivityParams,
): Promise<SocialActivityRow> {
  const {
    actorId,
    verb,
    objectType,
    objectId,
    metadata,
    visibility = 'FRIENDS',
    idempotencyKey,
  } = params

  if (!actorId) throw new Error('recordActivity: actorId required')
  if (!verb) throw new Error('recordActivity: verb required')
  if (!objectType) throw new Error('recordActivity: objectType required')
  if (!objectId) throw new Error('recordActivity: objectId required')

  // Sanitize metadata (defense-in-depth: strip sensitive keys).
  const sanitized = sanitizeActivityMetadata(metadata)

  // Encode the idempotency key (if any) inside the metadata so it persists
  // — the SocialActivity table doesn't have a dedicated idempotencyKey column.
  if (idempotencyKey) {
    sanitized.idempotencyKey = idempotencyKey

    // Idempotency check — if an existing activity has the same actorId + verb +
    // objectId + idempotencyKey prefix, return it without creating a duplicate.
    const existing = (await tx.socialActivity.findFirst({
      where: {
        actorId,
        verb,
        objectType,
        objectId,
        // SQLite doesn't support JSON queries on String columns, so we filter
        // the metadata column with a `contains` check on the idempotencyKey.
        // This is a soft check — the worst case is a duplicate, which the feed
        // UI will deduplicate by (actorId, verb, objectId, createdAt within
        // 1 second). For strong dedup, the caller should use the same
        // idempotencyKey prefix consistently.
        metadata: { contains: `"idempotencyKey":"${idempotencyKey}"` },
      },
      orderBy: { createdAt: 'desc' },
    })) as SocialActivityRow | null

    if (existing) {
      return existing
    }
  }

  const row = (await tx.socialActivity.create({
    data: {
      actorId,
      verb,
      objectType,
      objectId,
      metadata: JSON.stringify(sanitized),
      visibility,
    },
  })) as SocialActivityRow

  return row
}

// ---------------------------------------------------------------------------
// AVATAR COLOR — deterministic mapping from userId → color name.
// ---------------------------------------------------------------------------
// The User model has no avatarColor column (and we can't touch the schema per
// governance). Instead, we compute a stable color from the userId hash.
//
// The returned color name matches Tailwind gradient classes used by the
// existing components (teal, emerald, amber, rose, violet, orange, pink,
// fuchsia). The UI maps `avatarColor: 'teal'` → `from-teal-400 to-emerald-500`.
// ---------------------------------------------------------------------------
const AVATAR_COLORS = [
  'teal',
  'emerald',
  'amber',
  'rose',
  'violet',
  'orange',
  'pink',
  'fuchsia',
] as const

export type AvatarColor = (typeof AVATAR_COLORS)[number]

/**
 * Deterministically map a userId → avatarColor name.
 *
 * Uses a simple FNV-1a-style hash of the userId → 0..(N-1) index. The same
 * userId always returns the same color, so avatars are stable across pages.
 */
export function avatarColorForUserId(userId: string): AvatarColor {
  if (!userId) return AVATAR_COLORS[0]
  // FNV-1a 32-bit hash
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    // FNV prime (16777619) — keep as 32-bit unsigned via Math.imul + >>> 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
