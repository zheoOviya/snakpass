// src/lib/group-order-service.ts
//
// Wave 7 Task 7A — Group order backend (Model A: host pays entire order)
// ----------------------------------------------------------------------------
// Server-side transactional helpers for the GroupOrder lifecycle.
//
// Group order flow (blueprint §20 GROUP ORDERING — Model A):
//
//   Host creates group order (status=OPEN + 6-char shareCode + closesAt=+24h)
//        ↓
//   Share link/code (POST /api/group-orders → returns shareCode)
//        ↓
//   Friends join (POST /api/group-orders/[id]/join → GroupOrderMember row)
//        ↓
//   Each person selects items (POST /api/group-orders/[id]/items → GroupOrderItem)
//        ↓
//   Host confirms (POST /api/group-orders/[id]/confirm → single merged Order)
//        ↓
//   Single merchant order (created via direct tx.order.create inside withTransaction)
//        ↓
//   Host pays (POST /api/payments on the confirmed Order — NOT touched here)
//
// Concurrency:
//   - Optimistic lock on GroupOrder.version — incremented on confirm via
//     conditional UPDATE (WHERE version = X). Mismatch → 0 rows affected →
//     throw CONFLICT to abort the transaction.
//   - The confirm endpoint is itself idempotent via the GroupOrder.status
//     check: if already CONFIRMED, the existing confirmedOrderId is returned
//     WITHOUT creating a duplicate Order.
//
// Governance (plan §7A):
//   - Does NOT call /api/orders POST (uses tx.order.create directly inside
//     withTransaction — additive only — preserves order route governance).
//   - Does NOT call /api/payments POST (host pays via the existing route on
//     the confirmed Order).
//   - Does NOT touch fulfilment/pickup governance files.
//   - Does NOT touch prisma/schema.prisma (GroupOrder, GroupOrderMember,
//     GroupOrderItem models were created in Task 1A).
//
// Transactional:
//   This module does NOT open its own Prisma transaction. The caller wraps
//   every call in `withTransaction(async (tx) => { ... })` and passes the `tx`
//   (Prisma.TransactionClient) into createGroupOrder() / confirmGroupOrder().
//   This ensures the group order row + member row + audit log + outbox event
//   + social activity are committed atomically with the triggering mutation.

import { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import { AppError } from './errors'
import { enqueueOutboxEvent } from './outbox'
import { recordActivity, VERBS } from './social-activity'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-close window for an OPEN group order (24 hours). */
export const GROUP_ORDER_CLOSES_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Character set for share codes.
 *
 * Excludes ambiguous characters to avoid transcription errors when users
 * read codes off-screen and type them in:
 *   - 0 (zero)  — confused with O (oh)
 *   - O (oh)    — confused with 0 (zero)
 *   - 1 (one)   — confused with I (eye) + l (el)
 *   - I (eye)   — confused with 1 (one) + l (el)
 *   - L (el)    — confused with I (eye) + 1 (one)
 *
 * Remaining: 31 chars (2-9 + A-H + J-N + P-Z + M, etc.).
 */
const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Length of a share code (6 chars — fits comfortably in a URL + is memorable). */
const SHARE_CODE_LENGTH = 6

// ---------------------------------------------------------------------------
// generateShareCode — 6-char human-friendly alphanumeric
// ---------------------------------------------------------------------------

/**
 * Generate a unique-ish 6-character share code.
 *
 * Uses crypto.randomBytes for cryptographic-quality randomness (NOT
 * Math.random — predictable seed = guessable codes = enumeration attacks).
 *
 * The alphabet excludes ambiguous characters (0, O, 1, I, L) so users can
 * read codes off-screen without confusion. The remaining 31-char alphabet
 * gives 31^6 ≈ 887 million combinations — far more than enough for daily
 * SnakZap group orders.
 *
 * Uniqueness: caller MUST retry on Prisma P2002 (unique constraint violation)
 * in the rare case of a collision. The retry is handled inside withTransaction's
 * retry loop (P2002 is in isRetryableConflict's list).
 */
export function generateShareCode(): string {
  const bytes = randomBytes(SHARE_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    // bytes[i] is 0..255 → modulo 31 maps into the alphabet uniformly.
    code += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length]
  }
  return code
}

// ---------------------------------------------------------------------------
// createGroupOrder — host creates a new group order
// ---------------------------------------------------------------------------

export interface CreateGroupOrderInput {
  hostId: string
  hostRole: string
  restaurantId: string
  /** Optional group name (e.g., "Tuesday lunch"). null = no name. */
  name?: string | null
  /** Trace ID for structured logging. */
  traceId?: string
}

export interface CreateGroupOrderResult {
  /** The created GroupOrder row. */
  groupOrder: {
    id: string
    hostId: string
    restaurantId: string
    status: string
    shareCode: string
    closesAt: Date
    confirmedAt: Date | null
    confirmedOrderId: string | null
    version: number
    name: string | null
    createdAt: Date
    updatedAt: Date
  }
  /** The host's GroupOrderMember row (host is the first member). */
  member: {
    id: string
    groupOrderId: string
    userId: string
    joinedAt: Date
  }
}

/**
 * Create a new GroupOrder (status=OPEN) + add the host as the first
 * GroupOrderMember, atomically inside the caller's transaction.
 *
 * Behavior:
 *   1. Validate the restaurant exists + is active + not suspended.
 *   2. Generate a 6-char shareCode (regenerated on collision — but P2002
 *      retry is handled by withTransaction).
 *   3. Create GroupOrder row (status=OPEN, closesAt=now+24h).
 *   4. Add host as the first GroupOrderMember (so host can also add items).
 *   5. AuditLog GROUP_ORDER_CREATED.
 *   6. Outbox event GROUP_ORDER_CREATED.
 *   7. SocialActivity JOINED_GROUP (host joining their own group is the
 *      first activity in the feed for this group).
 *
 * Throws AppError on validation failures (NOT_FOUND, VALIDATION_ERROR).
 *
 * NOTE: The shareCode is unique at the DB level (schema: `shareCode String @unique`).
 * A collision (extremely rare — 31^6 ≈ 887M codes) will throw Prisma P2002,
 * which is in isRetryableConflict's list — withTransaction will retry the
 * entire body, and a fresh code will be generated on the retry.
 */
export async function createGroupOrder(
  tx: Prisma.TransactionClient,
  input: CreateGroupOrderInput,
): Promise<CreateGroupOrderResult> {
  const now = new Date()
  const closesAt = new Date(now.getTime() + GROUP_ORDER_CLOSES_AFTER_MS)

  // -------------------------------------------------------------------------
  // 1. Validate restaurant exists + is active + not suspended.
  // -------------------------------------------------------------------------
  const restaurant = await tx.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: {
      id: true,
      name: true,
      isActive: true,
      isSuspended: true,
    },
  })
  if (!restaurant) {
    throw new AppError(
      'NOT_FOUND',
      `Restaurant ${input.restaurantId} not found`,
      404,
      { restaurantId: input.restaurantId },
    )
  }
  if (!restaurant.isActive) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Restaurant '${restaurant.name}' is not currently accepting orders`,
      400,
      { restaurantId: input.restaurantId, isActive: restaurant.isActive },
    )
  }
  if (restaurant.isSuspended) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Restaurant '${restaurant.name}' is suspended`,
      400,
      { restaurantId: input.restaurantId, isSuspended: true },
    )
  }

  // -------------------------------------------------------------------------
  // 2. Create GroupOrder (status=OPEN + 6-char shareCode + closesAt=now+24h).
  // -------------------------------------------------------------------------
  const shareCode = generateShareCode()
  const groupOrder = await tx.groupOrder.create({
    data: {
      hostId: input.hostId,
      restaurantId: input.restaurantId,
      status: 'OPEN',
      shareCode,
      closesAt,
      confirmedAt: null,
      confirmedOrderId: null,
      version: 0,
      name: input.name ?? null,
    },
  })

  // -------------------------------------------------------------------------
  // 3. Add host as the first GroupOrderMember (host can also add items).
  // -------------------------------------------------------------------------
  const member = await tx.groupOrderMember.create({
    data: {
      groupOrderId: groupOrder.id,
      userId: input.hostId,
    },
  })

  // -------------------------------------------------------------------------
  // 4. AuditLog GROUP_ORDER_CREATED.
  // -------------------------------------------------------------------------
  await tx.auditLog.create({
    data: {
      actorId: input.hostId,
      actorRole: input.hostRole,
      action: 'GROUP_ORDER_CREATED',
      metadata: JSON.stringify({
        groupOrderId: groupOrder.id,
        hostId: input.hostId,
        restaurantId: input.restaurantId,
        restaurantName: restaurant.name,
        shareCode,
        closesAt: closesAt.toISOString(),
        name: input.name ?? null,
      }),
    },
  })

  // -------------------------------------------------------------------------
  // 5. Outbox event GROUP_ORDER_CREATED.
  // -------------------------------------------------------------------------
  await enqueueOutboxEvent(tx, {
    eventType: 'GROUP_ORDER_CREATED',
    aggregateType: 'GroupOrder',
    aggregateId: groupOrder.id,
    payload: {
      groupOrderId: groupOrder.id,
      hostId: input.hostId,
      restaurantId: input.restaurantId,
      restaurantName: restaurant.name,
      shareCode,
      status: 'OPEN',
      closesAt: closesAt.toISOString(),
    },
  })

  // -------------------------------------------------------------------------
  // 6. SocialActivity JOINED_GROUP (host's join is the first feed entry).
  // -------------------------------------------------------------------------
  // Best-effort — failure to record activity does NOT roll back the group
  // order creation (the activity feed is non-critical).
  try {
    await recordActivity(tx, {
      actorId: input.hostId,
      verb: VERBS.JOINED_GROUP,
      objectType: 'GroupOrder',
      objectId: groupOrder.id,
      metadata: {
        restaurantId: input.restaurantId,
        restaurantName: restaurant.name,
        hostName: null, // resolved by the feed at read time
        shareCode,
      },
      visibility: 'FRIENDS',
    })
  } catch {
    // Non-critical — swallow so the group order creation succeeds.
  }

  return {
    groupOrder: {
      id: groupOrder.id,
      hostId: groupOrder.hostId,
      restaurantId: groupOrder.restaurantId,
      status: groupOrder.status,
      shareCode: groupOrder.shareCode,
      closesAt: groupOrder.closesAt,
      confirmedAt: groupOrder.confirmedAt,
      confirmedOrderId: groupOrder.confirmedOrderId,
      version: groupOrder.version,
      name: groupOrder.name,
      createdAt: groupOrder.createdAt,
      updatedAt: groupOrder.updatedAt,
    },
    member: {
      id: member.id,
      groupOrderId: member.groupOrderId,
      userId: member.userId,
      joinedAt: member.joinedAt,
    },
  }
}

// ---------------------------------------------------------------------------
// confirmGroupOrder — host confirms → creates single merged Order
// ---------------------------------------------------------------------------

export interface ConfirmGroupOrderResult {
  /** The created Order (status=CONFIRMED — host pays via /api/payments on this order). */
  order: {
    id: string
    status: string
    totalAmount: number
    pickupOtp: string
    itemsCount: number
    note: string | null
    restaurantId: string
    userId: string
    createdAt: Date
  }
  /** The updated GroupOrder (status=CONFIRMED + confirmedOrderId + confirmedAt). */
  groupOrder: {
    id: string
    status: string
    confirmedOrderId: string | null
    confirmedAt: Date | null
    version: number
  }
  /** Whether the order was created on this call (false = idempotent re-confirm). */
  created: boolean
}

/**
 * Host confirms a group order → creates a single merged Order with all
 * members' items merged by menuItemId (sum quantities), atomically inside
 * the caller's transaction.
 *
 * Behavior:
 *   1. Load the GroupOrder (404 if not found).
 *   2. Authorization: caller must be the host (403 otherwise — checked by
 *      the route, but this function re-validates defensively).
 *   3. Idempotent: if already CONFIRMED, return the existing confirmed Order
 *      (created=false) WITHOUT creating a duplicate.
 *   4. Validate status=OPEN (409 if CANCELLED — can't confirm a cancelled
 *      group order).
 *   5. Load all GroupOrderItems across all members. If empty, 400 — host
 *      must add at least one item first.
 *   6. Merge items by menuItemId (sum quantities). For each merged item,
 *      compute subtotal = price × quantity (uses the per-item snapshot price
 *      from GroupOrderItem — if multiple members added the same menuItem at
 *      different prices, the snapshot prices are summed, NOT averaged).
 *   7. Compute total = sum of all subtotals. Compute itemsCount = sum of all
 *      quantities.
 *   8. Generate a 6-digit pickupOtp.
 *   9. Create a single Order: userId=hostId, restaurantId=groupOrder.restaurantId,
 *      status=CONFIRMED, totalAmount, pickupOtp, itemsCount,
 *      note=`GROUP_ORDER:${groupOrder.id}` (so frontend can filter), orderItems
 *      created from the merged list.
 *   10. Optimistic-lock transition GroupOrder → CONFIRMED via conditional
 *       updateMany (WHERE id=X AND version=Y AND status='OPEN'). 0 rows
 *       affected = race — throw CONFLICT to abort (the retry will hit the
 *       idempotent branch on the second attempt IF the first txn committed,
 *       OR re-attempt the confirm if the first rolled back).
 *   11. AuditLog GROUP_ORDER_CONFIRMED + ORDER_CREATED.
 *   12. Outbox events GROUP_ORDER_CONFIRMED + ORDER_CREATED.
 *   13. Notification to all members: "Group order confirmed by {hostName}! 🎉".
 *
 * Idempotency:
 *   The route handler's idempotency is via the GroupOrder.status check at
 *   the top — if status=CONFIRMED, return the existing confirmed Order.
 *   This makes the confirm endpoint idempotent WITHOUT requiring an
 *   Idempotency-Key header (per plan Decision #4). The route still supports
 *   an Idempotency-Key header for client-side retry-safety.
 *
 * Throws AppError on validation/business failures (NOT_FOUND, AUTHORIZATION_DENIED,
 * VALIDATION_ERROR, CONFLICT).
 */
export async function confirmGroupOrder(
  tx: Prisma.TransactionClient,
  input: {
    groupOrderId: string
    hostId: string
    hostRole: string
    hostName?: string | null
    traceId?: string
  },
): Promise<ConfirmGroupOrderResult> {
  const now = new Date()
  const nowIso = now.toISOString()

  // -------------------------------------------------------------------------
  // 1. Load the GroupOrder.
  // -------------------------------------------------------------------------
  const groupOrder = await tx.groupOrder.findUnique({
    where: { id: input.groupOrderId },
    select: {
      id: true,
      hostId: true,
      restaurantId: true,
      status: true,
      shareCode: true,
      version: true,
      confirmedOrderId: true,
      confirmedAt: true,
      name: true,
    },
  })
  if (!groupOrder) {
    throw new AppError(
      'NOT_FOUND',
      `Group order ${input.groupOrderId} not found`,
      404,
      { groupOrderId: input.groupOrderId },
    )
  }

  // -------------------------------------------------------------------------
  // 2. Authorization — only the host can confirm (defensive — route checks too).
  // -------------------------------------------------------------------------
  if (groupOrder.hostId !== input.hostId) {
    throw new AppError(
      'AUTHORIZATION_DENIED',
      'Only the group order host can confirm this order',
      403,
      { groupOrderId: groupOrder.id, hostId: groupOrder.hostId, callerId: input.hostId },
    )
  }

  // -------------------------------------------------------------------------
  // 3. Idempotent — already CONFIRMED? Return the existing Order.
  // -------------------------------------------------------------------------
  if (groupOrder.status === 'CONFIRMED' && groupOrder.confirmedOrderId) {
    const existingOrder = await tx.order.findUnique({
      where: { id: groupOrder.confirmedOrderId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        pickupOtp: true,
        itemsCount: true,
        note: true,
        restaurantId: true,
        userId: true,
        createdAt: true,
      },
    })
    if (existingOrder) {
      return {
        order: existingOrder,
        groupOrder: {
          id: groupOrder.id,
          status: groupOrder.status,
          confirmedOrderId: groupOrder.confirmedOrderId,
          confirmedAt: groupOrder.confirmedAt,
          version: groupOrder.version,
        },
        created: false,
      }
    }
    // Fall through — confirmedOrderId was set but Order is gone (data corruption).
    // This should never happen; throw to surface the inconsistency.
    throw new AppError(
      'UNKNOWN_STATE',
      `Group order ${groupOrder.id} is CONFIRMED but its confirmed Order ${groupOrder.confirmedOrderId} is missing`,
      500,
      { groupOrderId: groupOrder.id, confirmedOrderId: groupOrder.confirmedOrderId },
    )
  }

  // -------------------------------------------------------------------------
  // 4. Validate status=OPEN (409 if CANCELLED).
  // -------------------------------------------------------------------------
  if (groupOrder.status === 'CANCELLED') {
    throw new AppError(
      'CONFLICT',
      `Group order ${groupOrder.id} is CANCELLED — cannot confirm`,
      409,
      { groupOrderId: groupOrder.id, status: groupOrder.status },
    )
  }
  if (groupOrder.status !== 'OPEN') {
    throw new AppError(
      'CONFLICT',
      `Group order ${groupOrder.id} is in status ${groupOrder.status} — only OPEN group orders can be confirmed`,
      409,
      { groupOrderId: groupOrder.id, status: groupOrder.status },
    )
  }

  // -------------------------------------------------------------------------
  // 5. Load all GroupOrderItems across all members.
  // -------------------------------------------------------------------------
  const items = await tx.groupOrderItem.findMany({
    where: { groupOrderId: input.groupOrderId },
    select: {
      id: true,
      userId: true,
      menuItemId: true,
      name: true,
      price: true,
      quantity: true,
    },
  })

  if (items.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Cannot confirm an empty group order — add at least one item first',
      400,
      { groupOrderId: input.groupOrderId },
    )
  }

  // -------------------------------------------------------------------------
  // 6. Merge items by menuItemId (sum quantities; for each merged line,
  //    subtotal = sum of (price × quantity) across all member rows for that
  //    menuItemId — preserves per-row snapshot prices).
  // -------------------------------------------------------------------------
  interface MergedLine {
    menuItemId: string
    name: string
    price: number // representative snapshot price (first row's price)
    quantity: number
    subtotal: number
  }
  const mergedMap = new Map<string, MergedLine>()
  for (const item of items) {
    const existing = mergedMap.get(item.menuItemId)
    if (existing) {
      existing.quantity += item.quantity
      existing.subtotal += item.price * item.quantity
    } else {
      mergedMap.set(item.menuItemId, {
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
      })
    }
  }
  const mergedLines = Array.from(mergedMap.values())
  const totalAmount = mergedLines.reduce((s, l) => s + l.subtotal, 0)
  const itemsCount = mergedLines.reduce((s, l) => s + l.quantity, 0)

  // -------------------------------------------------------------------------
  // 7. Generate 6-digit pickup OTP (mirrors /api/orders POST pattern).
  // -------------------------------------------------------------------------
  const pickupOtp = String(Math.floor(100000 + Math.random() * 900000))

  // -------------------------------------------------------------------------
  // 8. Create a single merged Order (userId=hostId, restaurantId=group's
  //    restaurant, status=CONFIRMED, note=GROUP_ORDER:<id> so the frontend
  //    can filter it). orderItems created from the merged list.
  // -------------------------------------------------------------------------
  const note = `GROUP_ORDER:${groupOrder.id}`
  const order = await tx.order.create({
    data: {
      userId: input.hostId,
      restaurantId: groupOrder.restaurantId,
      status: 'CONFIRMED',
      totalAmount,
      pickupOtp,
      isCatering: false,
      headcount: null,
      itemsCount,
      note,
      statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: nowIso }]),
      orderItems: {
        create: mergedLines.map((l) => ({
          menuItemId: l.menuItemId,
          name: l.name,
          price: l.price,
          quantity: l.quantity,
          subtotal: l.subtotal,
        })),
      },
    },
    include: { orderItems: true },
  })

  // -------------------------------------------------------------------------
  // 9. Optimistic-lock transition GroupOrder → CONFIRMED.
  //    Conditional updateMany: WHERE id=X AND version=Y AND status='OPEN'.
  //    0 rows affected = concurrent confirm race — throw CONFLICT.
  //    NOTE: we use updateMany (NOT update) so a version mismatch doesn't
  //    throw P2025 (record not found) — it just affects 0 rows, which we
  //    translate to a clean CONFLICT error.
  // -------------------------------------------------------------------------
  const updated = await tx.groupOrder.updateMany({
    where: {
      id: input.groupOrderId,
      version: groupOrder.version,
      status: 'OPEN',
    },
    data: {
      status: 'CONFIRMED',
      confirmedOrderId: order.id,
      confirmedAt: now,
      version: { increment: 1 },
    },
  })
  if (updated.count === 0) {
    // Race — another transaction already transitioned the group order.
    // Throw CONFLICT to abort; the route's retry will hit the idempotent
    // branch on the second attempt (if the first committed) or re-attempt
    // (if the first rolled back).
    throw new AppError(
      'CONFLICT',
      `Group order ${input.groupOrderId} could not be confirmed due to a concurrent modification. Please retry.`,
      409,
      {
        groupOrderId: input.groupOrderId,
        expectedVersion: groupOrder.version,
        retryStrategy: 'retry',
      },
    )
  }

  // -------------------------------------------------------------------------
  // 10. AuditLog GROUP_ORDER_CONFIRMED + ORDER_CREATED.
  // -------------------------------------------------------------------------
  await tx.auditLog.create({
    data: {
      actorId: input.hostId,
      actorRole: input.hostRole,
      action: 'GROUP_ORDER_CONFIRMED',
      metadata: JSON.stringify({
        groupOrderId: groupOrder.id,
        orderId: order.id,
        hostId: input.hostId,
        restaurantId: groupOrder.restaurantId,
        totalAmount,
        itemsCount,
        members: items.length > 0 ? Array.from(new Set(items.map((i) => i.userId))) : [],
        mergedItemsCount: mergedLines.length,
      }),
    },
  })
  await tx.auditLog.create({
    data: {
      actorId: input.hostId,
      actorRole: input.hostRole,
      action: 'ORDER_CREATED',
      metadata: JSON.stringify({
        orderId: order.id,
        source: 'group-order-confirm',
        groupOrderId: groupOrder.id,
        totalAmount,
        restaurantId: groupOrder.restaurantId,
      }),
    },
  })

  // -------------------------------------------------------------------------
  // 11. Outbox events GROUP_ORDER_CONFIRMED + ORDER_CREATED.
  // -------------------------------------------------------------------------
  await enqueueOutboxEvent(tx, {
    eventType: 'GROUP_ORDER_CONFIRMED',
    aggregateType: 'GroupOrder',
    aggregateId: groupOrder.id,
    payload: {
      groupOrderId: groupOrder.id,
      orderId: order.id,
      hostId: input.hostId,
      status: 'CONFIRMED',
      totalAmount,
      itemsCount,
      confirmedAt: now.toISOString(),
    },
  })
  await enqueueOutboxEvent(tx, {
    eventType: 'ORDER_CREATED',
    aggregateType: 'Order',
    aggregateId: order.id,
    payload: {
      orderId: order.id,
      restaurantId: order.restaurantId,
      status: order.status,
      totalAmount: order.totalAmount,
      updatedAt: order.updatedAt.toISOString(),
      pickupOtp: order.pickupOtp,
      source: 'group-order-confirm',
      groupOrderId: groupOrder.id,
    },
  })

  // -------------------------------------------------------------------------
  // 12. Notification to all members: "Group order confirmed by {hostName}! 🎉"
  // -------------------------------------------------------------------------
  const members = await tx.groupOrderMember.findMany({
    where: { groupOrderId: input.groupOrderId },
    select: { userId: true },
  })
  const hostDisplayName = input.hostName ?? 'the host'
  const notificationTitle = 'Group order confirmed! 🎉'
  const notificationBody = `Group order confirmed by ${hostDisplayName}! 🎉`
  const notificationData = JSON.stringify({
    groupOrderId: groupOrder.id,
    orderId: order.id,
    hostId: input.hostId,
    hostName: input.hostName ?? null,
    shareCode: groupOrder.shareCode,
    deepLink: `/group/${groupOrder.shareCode}`,
    totalAmount,
    itemsCount,
  })

  // Bulk-create a notification for each member (including the host).
  // Skip the host? No — the host should also get the confirmation notification
  // so they know the system processed their action.
  if (members.length > 0) {
    await tx.notification.createMany({
      data: members.map((m) => ({
        userId: m.userId,
        type: 'GROUP_ORDER_CONFIRMED',
        title: notificationTitle,
        body: notificationBody,
        data: notificationData,
        readAt: null,
      })),
    })
  }

  return {
    order: {
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      pickupOtp: order.pickupOtp,
      itemsCount: order.itemsCount,
      note: order.note,
      restaurantId: order.restaurantId,
      userId: order.userId,
      createdAt: order.createdAt,
    },
    groupOrder: {
      id: input.groupOrderId,
      status: 'CONFIRMED',
      confirmedOrderId: order.id,
      confirmedAt: now,
      version: groupOrder.version + 1,
    },
    created: true,
  }
}
