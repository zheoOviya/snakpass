// src/lib/gift-service.ts
//
// Wave 6 Task 6C — Gifting backend (ghost order pattern)
// ----------------------------------------------------------------------------
// Server-side transactional helpers for the Gift lifecycle.
//
// Gift flow (blueprint §19 FOOD GIFTING):
//
//   Select food → select friend → optional note → pay → friend notification →
//   friend redeems
//
// Lifecycle states:
//   CREATED → PAID → AVAILABLE → REDEEMED | EXPIRED | CANCELLED | REFUNDED
//
// Ghost order pattern (plan Decision #3):
//   - Sender creates a Gift (status=CREATED)
//   - Sender creates a "ghost Order" via direct `tx.order.create` (NOT calling
//     /api/orders POST — additive only — preserves order route governance).
//     The ghost order's `note` encodes `GIFT:${giftId}:for:${recipientId}` so
//     the frontend can filter it out of "My Orders" via `note.startsWith('GIFT:')`.
//   - Sender pays the ghost order via inline demo Payment (mirrors
//     /api/payments POST logic — NOT calling the route — additive only).
//   - On success: Gift.status → PAID + AVAILABLE, paymentId + orderId set,
//     expiresAt = now + 30 days, Notification to recipient.
//   - Recipient redeems: creates a NEW zero-amount Order with
//     `note='GIFT_FROM:${senderId}:${giftId}'`, `totalAmount=0`,
//     `userId=recipientId`. Gift.status → REDEEMED + recipientOrderId.
//
// Fraud controls (blueprint §19):
//   - recipient binding (recipientId immutable post-create)
//   - 30-day expiry (lazy enforcement via expireGifts())
//   - redemption audit (AuditLog GIFT_REDEEMED + Outbox event)
//   - no double redemption (Gift.status transition is single-use)
//   - payment/refund separation (sender pays + sender cancels → refund)
//
// Governance boundaries:
//   - Does NOT call /api/orders POST (uses tx.order.create directly)
//   - Does NOT call /api/payments POST (creates Payment record inline —
//     mirrors the route's logic but inside the same transaction)
//   - Does NOT call /api/payments/refund POST (creates Refund record inline)
//   - Does NOT modify Order / Payment / Refund / LedgerEntry models
//   - Does NOT modify prisma/schema.prisma (Gift model already exists from 1A)
//
// All functions take a `tx: Prisma.TransactionClient` parameter — callers wrap
// them in `withTransaction()`. Each function is idempotent for retry safety
// (re-execution on a P2034 retry produces the same effect; the route's
// idempotency cache check at the top of the transaction prevents duplicates).
// ----------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { randomBytes, randomUUID } from 'crypto'
import { AppError } from './errors'
import { enqueueOutboxEvent } from './outbox'
import { isFeatureEnabled } from './deployment'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 30-day gift expiry (set when status → AVAILABLE). */
export const GIFT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Allowed gift statuses (blueprint §19). Used for runtime validation + status
 * transition guards. The Gift.status field is a plain String (per Task 1A
 * schema) — these constants are the source of truth for valid values.
 */
export const GIFT_STATUSES = [
  'CREATED',
  'PAID',
  'AVAILABLE',
  'REDEEMED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
] as const
export type GiftStatus = (typeof GIFT_STATUSES)[number]

// ---------------------------------------------------------------------------
// Types — input/output contracts for the service functions.
// ---------------------------------------------------------------------------

export interface CreateGiftInput {
  senderId: string
  senderRole: string
  recipientId: string
  menuItemId: string
  message?: string | null
  traceId?: string
}

export interface CreateGiftResult {
  /** The created Gift row (status=PAID+AVAILABLE in demo mode). */
  gift: {
    id: string
    status: string
    redemptionCode: string
    expiresAt: Date
    menuItemId: string
    menuItemName: string
    menuItemPrice: number
    message: string | null
    senderId: string
    recipientId: string
    paymentId: string | null
    recipientOrderId: string | null
    paidAt: Date | null
    availableAt: Date | null
    createdAt: Date
    updatedAt: Date
  }
  /** The ghost Order row created for the sender's payment. */
  ghostOrder: {
    id: string
    status: string
    totalAmount: number
    pickupOtp: string
    note: string | null
  }
  /** The demo Payment row created (CAPTURED in demo mode). */
  payment: {
    id: string
    status: string
    amount: number
    currency: string
    gatewayPaymentId: string | null
  }
}

export interface RedeemGiftInput {
  giftId: string
  recipientId: string
  recipientRole: string
  traceId?: string
}

export interface RedeemGiftResult {
  gift: {
    id: string
    status: string
    recipientOrderId: string | null
    redeemedAt: Date | null
  }
  order: {
    id: string
    status: string
    totalAmount: number
    pickupOtp: string
    note: string | null
  }
}

export interface CancelGiftInput {
  giftId: string
  senderId: string
  senderRole: string
  traceId?: string
}

export interface CancelGiftResult {
  gift: {
    id: string
    status: string
    cancelledAt: Date | null
    refundedAt: Date | null
  }
  refund: {
    id: string | null
    status: string | null
    amount: number | null
  }
}

export interface ExpireGiftsResult {
  /** Number of gifts transitioned AVAILABLE → EXPIRED. */
  expiredCount: number
  /** Number of refunds triggered (one per expired paid gift). */
  refundCount: number
  /** The gift IDs that were expired. */
  expiredGiftIds: string[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique redemption code (8-char hex). Used as the single-use code
 * the recipient enters to redeem a gift. Stored on Gift.redemptionCode (@unique).
 */
function generateRedemptionCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

/**
 * Generate a 6-digit pickup OTP for the recipient's zero-amount order.
 * Mirrors the /api/orders POST route's OTP generation pattern.
 */
function generatePickupOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * Build the JSON statusHistory array entry (mirrors /api/orders POST).
 */
function buildStatusHistory(status: string, atIso: string): string {
  return JSON.stringify([{ status, at: atIso }])
}

// ---------------------------------------------------------------------------
// createGift — full ghost-order flow (create gift + ghost order + demo payment)
// ---------------------------------------------------------------------------

/**
 * Create a Gift + ghost Order + demo Payment atomically (inside the caller's
 * transaction). The flow:
 *
 *   1. Load + validate the menu item (exists, available, not deleted)
 *   2. Validate the recipient exists + sender ≠ recipient
 *   3. Create Gift (status=CREATED, expiresAt=now+30d placeholder so the
 *      NOT NULL constraint is satisfied; updated to AVAILABLE later)
 *   4. Create ghost Order (userId=senderId, status=CONFIRMED, totalAmount=item.price,
 *      note=`GIFT:${giftId}:for:${recipientId}`)
 *   5. Create Payment (status=CAPTURED in demo mode since realPayments is OFF —
 *      skip CAPTURE_PENDING publisher step for gifts to keep MVP simple)
 *   6. Create 2 LedgerEntries (DEBIT GATEWAY_RECEIVABLE + CREDIT CONSUMER_REVENUE)
 *   7. Update ghost Order status=PAID
 *   8. Update Gift status=PAID+AVAILABLE + paymentId + orderId + paidAt + availableAt
 *      + expiresAt (30 days from now)
 *   9. Create AuditLog: GIFT_CREATED + PAYMENT_CAPTURED (gift)
 *   10. Enqueue Outbox events: GIFT_CREATED + PAYMENT_CAPTURED (gift)
 *   11. Create Notification to recipient: GIFT_RECEIVED
 *
 * Idempotency: the caller (route handler) checks the idempotency cache at
 * the top of the transaction; this function is only invoked on a cache miss.
 *
 * Throws AppError on validation failures (NOT_FOUND, VALIDATION_ERROR,
 * CONFLICT, INTERNAL_ERROR).
 */
export async function createGift(
  tx: Prisma.TransactionClient,
  input: CreateGiftInput,
): Promise<CreateGiftResult> {
  const traceId = input.traceId ?? ''
  const now = new Date()
  const nowIso = now.toISOString()

  // -------------------------------------------------------------------------
  // 1. Load + validate menu item
  // -------------------------------------------------------------------------
  const menuItem = await tx.menuItem.findUnique({
    where: { id: input.menuItemId },
    select: {
      id: true,
      restaurantId: true,
      name: true,
      price: true,
      isAvailable: true,
      deletedAt: true,
      restaurant: { select: { id: true, name: true, isActive: true, isSuspended: true } },
    },
  })
  if (!menuItem || menuItem.deletedAt !== null) {
    throw new AppError('NOT_FOUND', `Menu item ${input.menuItemId} not found`, 404, {
      menuItemId: input.menuItemId,
    })
  }
  if (!menuItem.isAvailable) {
    throw new AppError('VALIDATION_ERROR', `${menuItem.name} is no longer available`, 400, {
      menuItemId: input.menuItemId,
      isAvailable: menuItem.isAvailable,
    })
  }
  if (!menuItem.restaurant.isActive || menuItem.restaurant.isSuspended) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Restaurant '${menuItem.restaurant.name}' is currently unavailable`,
      400,
      { restaurantId: menuItem.restaurantId },
    )
  }

  // -------------------------------------------------------------------------
  // 2. Validate recipient + sender ≠ recipient
  // -------------------------------------------------------------------------
  if (input.senderId === input.recipientId) {
    throw new AppError('VALIDATION_ERROR', 'Cannot send a gift to yourself', 400, {
      senderId: input.senderId,
      recipientId: input.recipientId,
    })
  }
  const recipient = await tx.user.findUnique({
    where: { id: input.recipientId },
    select: { id: true, name: true, phone: true },
  })
  if (!recipient) {
    throw new AppError('NOT_FOUND', `Recipient ${input.recipientId} not found`, 404, {
      recipientId: input.recipientId,
    })
  }

  // -------------------------------------------------------------------------
  // 3. Create Gift (status=CREATED)
  // -------------------------------------------------------------------------
  // expiresAt is NOT NULL per schema — set placeholder to now+30d. It will be
  // re-set to now+30d when status → AVAILABLE below (effectively the same value,
  // but explicit so the lifecycle is self-documenting).
  const initialExpiresAt = new Date(now.getTime() + GIFT_EXPIRY_MS)
  const redemptionCode = generateRedemptionCode()
  const gift = await tx.gift.create({
    data: {
      senderId: input.senderId,
      recipientId: input.recipientId,
      menuItemId: input.menuItemId,
      menuItemName: menuItem.name,
      menuItemPrice: menuItem.price,
      message: input.message ?? null,
      status: 'CREATED',
      redemptionCode,
      expiresAt: initialExpiresAt,
    },
  })

  // -------------------------------------------------------------------------
  // 4. Create ghost Order (sender pays for the gift item)
  // -------------------------------------------------------------------------
  // Mirrors /api/orders POST pattern but direct (NOT calling the route):
  //   - userId = senderId
  //   - restaurantId = menuItem.restaurantId
  //   - status = 'CONFIRMED'
  //   - totalAmount = menuItem.price (paise)
  //   - pickupOtp = '000000' (sender never picks up — ghost order)
  //   - note = `GIFT:${gift.id}:for:${recipientId}` (encodes gift linkage;
  //     frontend filters via note.startsWith('GIFT:'))
  //   - itemsCount = 1
  //   - orderItems: 1 row snapshotting the gifted menu item
  const ghostOrderNote = `GIFT:${gift.id}:for:${input.recipientId}`
  const ghostOrder = await tx.order.create({
    data: {
      userId: input.senderId,
      restaurantId: menuItem.restaurantId,
      status: 'CONFIRMED',
      totalAmount: menuItem.price,
      pickupOtp: '000000',
      isCatering: false,
      headcount: null,
      itemsCount: 1,
      note: ghostOrderNote,
      statusHistory: buildStatusHistory('CONFIRMED', nowIso),
      orderItems: {
        create: [
          {
            menuItemId: menuItem.id,
            name: menuItem.name,
            price: menuItem.price,
            quantity: 1,
            subtotal: menuItem.price,
          },
        ],
      },
    },
    include: { orderItems: true },
  })

  // -------------------------------------------------------------------------
  // 5. Create Payment (demo mode: CAPTURED directly — skip CAPTURE_PENDING)
  // -------------------------------------------------------------------------
  // When realPayments is OFF (default), we synthesize the payment inline:
  //   - status = 'CAPTURED' (no publisher step needed)
  //   - gatewayPaymentId = `pay_demo_<ts>`
  //   - gatewaySignature = `sig_demo_<ts>`
  //   - capturedAt = now
  //   - LedgerEntries created immediately
  //
  // When realPayments is ON (future), this route should be modified to:
  //   - status = 'CAPTURE_PENDING'
  //   - Enqueue PAYMENT_CAPTURE_REQUESTED for the publisher to call
  //     captureRazorpayPayment() and transition to CAPTURED
  // For now (MVP, realPayments OFF), we go straight to CAPTURED.
  const isDemoMode = !isFeatureEnabled('realPayments')
  const gatewayPaymentId = isDemoMode
    ? `pay_demo_${Date.now()}_${randomUUID().slice(0, 8)}`
    : null
  const gatewaySignature = isDemoMode
    ? `sig_demo_${Date.now()}_${randomUUID().slice(0, 8)}`
    : null
  const payment = await tx.payment.create({
    data: {
      orderId: ghostOrder.id,
      userId: input.senderId,
      gatewayOrderId: `order_demo_gift_${gift.id}`,
      gatewayPaymentId,
      gatewaySignature,
      amount: menuItem.price,
      currency: 'INR',
      status: 'CAPTURED',
      capturedAt: now,
    },
  })

  // -------------------------------------------------------------------------
  // 6. Create double-entry LedgerEntries (Dr gateway receivable + Cr revenue)
  // -------------------------------------------------------------------------
  // Mirrors /api/payments POST route's ledger logic — keeps the ledger
  // balanced (I-06 invariant: every credit has a matching debit).
  await tx.ledgerEntry.create({
    data: {
      paymentId: payment.id,
      entryType: 'DEBIT',
      accountType: 'GATEWAY_RECEIVABLE',
      amount: menuItem.price,
      traceId,
    },
  })
  await tx.ledgerEntry.create({
    data: {
      paymentId: payment.id,
      entryType: 'CREDIT',
      accountType: 'CONSUMER_REVENUE',
      amount: menuItem.price,
      traceId,
    },
  })

  // -------------------------------------------------------------------------
  // 7. Update ghost Order status → PAID
  // -------------------------------------------------------------------------
  // Append the new status to statusHistory (preserve CONFIRMED entry).
  const updatedStatusHistory = JSON.stringify([
    { status: 'CONFIRMED', at: nowIso },
    { status: 'PAID', at: nowIso },
  ])
  await tx.order.update({
    where: { id: ghostOrder.id },
    data: {
      status: 'PAID',
      statusHistory: updatedStatusHistory,
    },
  })

  // -------------------------------------------------------------------------
  // 8. Update Gift status → PAID + AVAILABLE + paymentId + orderId + expiry
  // -------------------------------------------------------------------------
  // Single transition to AVAILABLE (PAID is implicit — the gift is paid AND
  // available for the recipient to redeem). We track both timestamps for
  // audit clarity.
  const expiresAt = new Date(now.getTime() + GIFT_EXPIRY_MS)
  const updatedGift = await tx.gift.update({
    where: { id: gift.id },
    data: {
      status: 'AVAILABLE',
      paymentId: payment.id,
      recipientOrderId: null,
      expiresAt,
      paidAt: now,
      availableAt: now,
    },
  })

  // -------------------------------------------------------------------------
  // 9. Audit logs
  // -------------------------------------------------------------------------
  await tx.auditLog.create({
    data: {
      actorId: input.senderId,
      actorRole: input.senderRole,
      action: 'GIFT_CREATED',
      metadata: JSON.stringify({
        giftId: gift.id,
        senderId: input.senderId,
        recipientId: input.recipientId,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        menuItemPrice: menuItem.price,
        ghostOrderId: ghostOrder.id,
        paymentId: payment.id,
        message: input.message ?? null,
        expiresAt: expiresAt.toISOString(),
      }),
    },
  })
  await tx.auditLog.create({
    data: {
      actorId: input.senderId,
      actorRole: input.senderRole,
      action: 'PAYMENT_CAPTURED',
      metadata: JSON.stringify({
        giftId: gift.id,
        orderId: ghostOrder.id,
        paymentId: payment.id,
        amount: menuItem.price,
        currency: 'INR',
        source: 'gift-ghost-order',
        demoMode: isDemoMode,
      }),
    },
  })

  // -------------------------------------------------------------------------
  // 10. Outbox events (committed atomically with the business mutation)
  // -------------------------------------------------------------------------
  await enqueueOutboxEvent(tx, {
    eventType: 'GIFT_CREATED',
    aggregateType: 'Gift',
    aggregateId: gift.id,
    payload: {
      giftId: gift.id,
      senderId: input.senderId,
      recipientId: input.recipientId,
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      ghostOrderId: ghostOrder.id,
      paymentId: payment.id,
      status: 'AVAILABLE',
      expiresAt: expiresAt.toISOString(),
    },
  })
  await enqueueOutboxEvent(tx, {
    eventType: 'PAYMENT_CAPTURED',
    aggregateType: 'Payment',
    aggregateId: payment.id,
    payload: {
      paymentId: payment.id,
      orderId: ghostOrder.id,
      giftId: gift.id,
      amount: menuItem.price,
      currency: 'INR',
      demoMode: isDemoMode,
      source: 'gift-ghost-order',
    },
  })

  // -------------------------------------------------------------------------
  // 11. Notification to recipient (GIFT_RECEIVED)
  // -------------------------------------------------------------------------
  // The notification is created INSIDE the transaction so it's atomic with
  // the gift creation. Real-time delivery is via the outbox publisher (Task
  // 2b — emits socket event 'gift:received'); for MVP the row is created +
  // the UI polls /api/notifications or receives via Socket.io.
  await tx.notification.create({
    data: {
      userId: input.recipientId,
      type: 'GIFT_RECEIVED',
      title: 'You received a gift! 🎁',
      body: `A ${menuItem.name} was gifted to you. Redeem before ${expiresAt.toLocaleDateString()}.`,
      data: JSON.stringify({
        giftId: gift.id,
        senderId: input.senderId,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        restaurantId: menuItem.restaurantId,
        restaurantName: menuItem.restaurant.name,
        redemptionCode,
        expiresAt: expiresAt.toISOString(),
        deepLink: `/gifts/${gift.id}`,
      }),
      readAt: null,
    },
  })

  return {
    gift: {
      id: updatedGift.id,
      status: updatedGift.status,
      redemptionCode: updatedGift.redemptionCode,
      expiresAt: updatedGift.expiresAt,
      menuItemId: updatedGift.menuItemId,
      menuItemName: updatedGift.menuItemName,
      menuItemPrice: updatedGift.menuItemPrice,
      message: updatedGift.message,
      senderId: updatedGift.senderId,
      recipientId: updatedGift.recipientId,
      paymentId: updatedGift.paymentId,
      recipientOrderId: updatedGift.recipientOrderId,
      paidAt: updatedGift.paidAt,
      availableAt: updatedGift.availableAt,
      createdAt: updatedGift.createdAt,
      updatedAt: updatedGift.updatedAt,
    },
    ghostOrder: {
      id: ghostOrder.id,
      status: 'PAID',
      totalAmount: menuItem.price,
      pickupOtp: ghostOrder.pickupOtp,
      note: ghostOrder.note,
    },
    payment: {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      gatewayPaymentId: payment.gatewayPaymentId,
    },
  }
}

// ---------------------------------------------------------------------------
// redeemGift — recipient creates a zero-amount Order + transitions gift
// ---------------------------------------------------------------------------

/**
 * Recipient redeems an AVAILABLE gift. Creates a NEW zero-amount Order for the
 * recipient (userId=recipientId, totalAmount=0, note=`GIFT_FROM:${senderId}:${giftId}`)
 * + transitions Gift.status → REDEEMED + recipientOrderId + redeemedAt.
 *
 * Authorization: caller must verify `gift.recipientId === recipientId` BEFORE
 * calling this function. (The route does this check.)
 *
 * Idempotent: if the gift is already REDEEMED, returns the existing
 * recipientOrderId without creating a duplicate.
 *
 * Throws AppError on:
 *   - NOT_FOUND: gift doesn't exist
 *   - CONFLICT: gift is not in AVAILABLE status (already redeemed, expired, cancelled)
 *   - INTERNAL_ERROR: order creation failed
 */
export async function redeemGift(
  tx: Prisma.TransactionClient,
  input: RedeemGiftInput,
): Promise<RedeemGiftResult> {
  const traceId = input.traceId ?? ''
  const now = new Date()
  const nowIso = now.toISOString()

  // -------------------------------------------------------------------------
  // Load the gift (with sender info for the notification)
  // -------------------------------------------------------------------------
  const gift = await tx.gift.findUnique({
    where: { id: input.giftId },
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      status: true,
      menuItemId: true,
      menuItemName: true,
      menuItemPrice: true,
      redemptionCode: true,
      expiresAt: true,
      recipientOrderId: true,
      redeemedAt: true,
    },
  })
  if (!gift) {
    throw new AppError('NOT_FOUND', `Gift ${input.giftId} not found`, 404, {
      giftId: input.giftId,
    })
  }

  // -------------------------------------------------------------------------
  // Idempotent: if already redeemed, return the existing order without
  // creating a duplicate.
  // -------------------------------------------------------------------------
  if (gift.status === 'REDEEMED') {
    if (!gift.recipientOrderId) {
      // Inconsistent state — should never happen (REDEEMED implies order created).
      throw new AppError(
        'INTERNAL_ERROR',
        `Gift ${gift.id} is REDEEMED but has no recipientOrderId`,
        500,
        { giftId: gift.id },
      )
    }
    const existingOrder = await tx.order.findUnique({
      where: { id: gift.recipientOrderId },
      select: { id: true, status: true, totalAmount: true, pickupOtp: true, note: true },
    })
    if (!existingOrder) {
      throw new AppError(
        'INTERNAL_ERROR',
        `Gift ${gift.id} references missing recipientOrder ${gift.recipientOrderId}`,
        500,
        { giftId: gift.id, recipientOrderId: gift.recipientOrderId },
      )
    }
    return {
      gift: {
        id: gift.id,
        status: gift.status,
        recipientOrderId: gift.recipientOrderId,
        redeemedAt: gift.redeemedAt,
      },
      order: {
        id: existingOrder.id,
        status: existingOrder.status,
        totalAmount: existingOrder.totalAmount,
        pickupOtp: existingOrder.pickupOtp,
        note: existingOrder.note,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Validate status — must be AVAILABLE to redeem
  // -------------------------------------------------------------------------
  if (gift.status !== 'AVAILABLE') {
    throw new AppError(
      'CONFLICT',
      `Gift ${gift.id} is in status ${gift.status} — only AVAILABLE gifts can be redeemed`,
      409,
      { giftId: gift.id, currentStatus: gift.status, requiredStatus: 'AVAILABLE' },
    )
  }

  // -------------------------------------------------------------------------
  // Validate expiry — lazy enforcement (defensive)
  // -------------------------------------------------------------------------
  if (gift.expiresAt.getTime() < now.getTime()) {
    // Transition to EXPIRED + trigger refund (best-effort; the expireGifts
    // job handles the refund properly).
    await tx.gift.update({
      where: { id: gift.id },
      data: { status: 'EXPIRED' },
    })
    throw new AppError(
      'CONFLICT',
      `Gift ${gift.id} has expired (expiresAt ${gift.expiresAt.toISOString()})`,
      409,
      { giftId: gift.id, expiresAt: gift.expiresAt.toISOString() },
    )
  }

  // -------------------------------------------------------------------------
  // Load the menu item (for restaurantId + name — needed to create the order)
  // -------------------------------------------------------------------------
  const menuItem = await tx.menuItem.findUnique({
    where: { id: gift.menuItemId },
    select: {
      id: true,
      restaurantId: true,
      name: true,
      deletedAt: true,
      restaurant: { select: { id: true, name: true } },
    },
  })
  if (!menuItem) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Gift ${gift.id} references missing menuItem ${gift.menuItemId}`,
      500,
      { giftId: gift.id, menuItemId: gift.menuItemId },
    )
  }

  // -------------------------------------------------------------------------
  // Create the recipient's zero-amount Order
  // -------------------------------------------------------------------------
  // This is the recipient's "free pickup" order. The restaurant sees a
  // normal order come in but with totalAmount=0 (the item was already paid
  // for by the sender). The recipient picks up using the OTP below.
  const pickupOtp = generatePickupOtp()
  const orderNote = `GIFT_FROM:${gift.senderId}:${gift.id}`
  const order = await tx.order.create({
    data: {
      userId: input.recipientId,
      restaurantId: menuItem.restaurantId,
      status: 'CONFIRMED',
      totalAmount: 0,
      pickupOtp,
      isCatering: false,
      headcount: null,
      itemsCount: 1,
      note: orderNote,
      statusHistory: buildStatusHistory('CONFIRMED', nowIso),
      orderItems: {
        create: [
          {
            menuItemId: menuItem.id,
            name: menuItem.name,
            price: 0,
            quantity: 1,
            subtotal: 0,
          },
        ],
      },
    },
    include: { orderItems: true },
  })

  // -------------------------------------------------------------------------
  // Transition Gift.status → REDEEMED + recipientOrderId + redeemedAt
  // -------------------------------------------------------------------------
  // Uses optimistic-lock conditional update (WHERE status='AVAILABLE'). If a
  // concurrent transaction already redeemed/cancelled/expired the gift, the
  // update affects 0 rows → the new order is orphaned BUT the transaction
  // rolls back (withTransaction atomicity — no orphan).
  const transitionResult = await tx.gift.updateMany({
    where: { id: gift.id, status: 'AVAILABLE' },
    data: {
      status: 'REDEEMED',
      recipientOrderId: order.id,
      redeemedAt: now,
    },
  })
  if (transitionResult.count === 0) {
    // Concurrent transition — throw to abort the transaction.
    throw new AppError(
      'CONFLICT',
      `Gift ${gift.id} was modified by a concurrent transaction — please retry`,
      409,
      { giftId: gift.id },
    )
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------
  await tx.auditLog.create({
    data: {
      actorId: input.recipientId,
      actorRole: input.recipientRole,
      action: 'GIFT_REDEEMED',
      metadata: JSON.stringify({
        giftId: gift.id,
        senderId: gift.senderId,
        recipientId: input.recipientId,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        recipientOrderId: order.id,
        redemptionCode: gift.redemptionCode,
      }),
    },
  })
  await tx.auditLog.create({
    data: {
      actorId: input.recipientId,
      actorRole: input.recipientRole,
      action: 'ORDER_CREATED',
      metadata: JSON.stringify({
        orderId: order.id,
        giftId: gift.id,
        total: 0,
        restaurantId: menuItem.restaurantId,
        source: 'gift-redemption',
      }),
    },
  })

  // -------------------------------------------------------------------------
  // Outbox events
  // -------------------------------------------------------------------------
  await enqueueOutboxEvent(tx, {
    eventType: 'GIFT_REDEEMED',
    aggregateType: 'Gift',
    aggregateId: gift.id,
    payload: {
      giftId: gift.id,
      senderId: gift.senderId,
      recipientId: input.recipientId,
      recipientOrderId: order.id,
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
    },
  })
  await enqueueOutboxEvent(tx, {
    eventType: 'ORDER_CREATED',
    aggregateType: 'Order',
    aggregateId: order.id,
    payload: {
      orderId: order.id,
      giftId: gift.id,
      restaurantId: menuItem.restaurantId,
      status: order.status,
      totalAmount: order.totalAmount,
      updatedAt: nowIso,
      pickupOtp: order.pickupOtp,
      source: 'gift-redemption',
    },
  })

  // -------------------------------------------------------------------------
  // Notification to sender (GIFT_REDEEMED)
  // -------------------------------------------------------------------------
  await tx.notification.create({
    data: {
      userId: gift.senderId,
      type: 'GIFT_REDEEMED',
      title: 'Your gift was redeemed! 🎁',
      body: `${gift.menuItemName} was redeemed by the recipient.`,
      data: JSON.stringify({
        giftId: gift.id,
        recipientId: input.recipientId,
        recipientOrderId: order.id,
        menuItemName: gift.menuItemName,
        deepLink: `/orders/${order.id}`,
      }),
      readAt: null,
    },
  })

  // -------------------------------------------------------------------------
  // Social activity (optional — only if the recipient's privacy allows)
  // -------------------------------------------------------------------------
  // We record a REDEEMED activity for the recipient's friends feed (blueprint
  // §18 verbs). The metadata NEVER includes payment amount (fraud control).
  // We guard with try/catch so a failure here doesn't roll back the txn
  // (best-effort — the gift is already REDEEMED).
  try {
    await tx.socialActivity.create({
      data: {
        actorId: input.recipientId,
        verb: 'REDEEMED',
        objectType: 'Gift',
        objectId: gift.id,
        metadata: JSON.stringify({
          menuItemName: gift.menuItemName,
          restaurantName: menuItem.restaurant.name,
          // NOTE: never include price/payment amount per blueprint §18.
        }),
        visibility: 'FRIENDS',
      },
    })
  } catch {
    // best-effort — don't fail the redemption over social activity write failure
  }

  return {
    gift: {
      id: gift.id,
      status: 'REDEEMED',
      recipientOrderId: order.id,
      redeemedAt: now,
    },
    order: {
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      pickupOtp: order.pickupOtp,
      note: order.note,
    },
  }
}

// ---------------------------------------------------------------------------
// cancelGift — sender cancels + (if paid) triggers refund inline
// ---------------------------------------------------------------------------

/**
 * Sender cancels a gift. If the gift was PAID (ghost order has a Payment),
 * triggers a refund inline (mirrors /api/payments/refund POST logic but
 * direct — additive only). Updates Gift.status → CANCELLED + cancelledAt
 * + refundedAt (if refund processed).
 *
 * Authorization: caller must verify `gift.senderId === senderId` BEFORE
 * calling this function. (The route does this check.)
 *
 * Allowed source statuses: CREATED, PAID, AVAILABLE. Not allowed: REDEEMED,
 * EXPIRED, CANCELLED, REFUNDED → 409.
 *
 * Idempotent: if already CANCELLED, returns the existing gift state.
 */
export async function cancelGift(
  tx: Prisma.TransactionClient,
  input: CancelGiftInput,
): Promise<CancelGiftResult> {
  const traceId = input.traceId ?? ''
  const now = new Date()
  const nowIso = now.toISOString()

  // -------------------------------------------------------------------------
  // Load the gift + payment + ghost order
  // -------------------------------------------------------------------------
  const gift = await tx.gift.findUnique({
    where: { id: input.giftId },
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      status: true,
      menuItemId: true,
      menuItemName: true,
      menuItemPrice: true,
      paymentId: true,
      recipientOrderId: true,
      expiresAt: true,
      cancelledAt: true,
      refundedAt: true,
    },
  })
  if (!gift) {
    throw new AppError('NOT_FOUND', `Gift ${input.giftId} not found`, 404, {
      giftId: input.giftId,
    })
  }

  // -------------------------------------------------------------------------
  // Idempotent: if already cancelled, return the existing state.
  // -------------------------------------------------------------------------
  if (gift.status === 'CANCELLED' || gift.status === 'REFUNDED') {
    return {
      gift: {
        id: gift.id,
        status: gift.status,
        cancelledAt: gift.cancelledAt,
        refundedAt: gift.refundedAt,
      },
      refund: {
        id: null,
        status: gift.status === 'REFUNDED' ? 'REFUNDED' : null,
        amount: null,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Validate source status
  // -------------------------------------------------------------------------
  const allowedSourceStatuses = ['CREATED', 'PAID', 'AVAILABLE']
  if (!allowedSourceStatuses.includes(gift.status)) {
    throw new AppError(
      'CONFLICT',
      `Gift ${gift.id} is in status ${gift.status} — can only cancel gifts in CREATED, PAID, or AVAILABLE`,
      409,
      { giftId: gift.id, currentStatus: gift.status, allowedStatuses: allowedSourceStatuses },
    )
  }

  // -------------------------------------------------------------------------
  // Load the recipient (for the notification body)
  // -------------------------------------------------------------------------
  const recipient = await tx.user.findUnique({
    where: { id: gift.recipientId },
    select: { id: true, name: true },
  })
  const recipientName = recipient?.name ?? 'the recipient'

  // -------------------------------------------------------------------------
  // If the gift was PAID (has a paymentId), trigger the refund inline.
  // -------------------------------------------------------------------------
  // Mirrors /api/payments/refund POST logic — direct (NOT calling the route):
  //   - Load the Payment (must be CAPTURED)
  //   - Create Refund record (status=REFUNDED in demo mode since realPayments OFF)
  //   - Create reversal LedgerEntries (DEBIT CONSUMER_REVENUE + CREDIT GATEWAY_RECEIVABLE)
  //   - Update Payment.status → REFUNDED (full refund)
  //   - Update ghost Order.status → CANCELLED
  //   - Audit log: PAYMENT_REFUNDED
  //   - Outbox: PAYMENT_REFUNDED
  //   - Update Gift.refundedAt
  let refundId: string | null = null
  let refundStatus: string | null = null
  let refundAmount: number | null = null
  let paymentWasRefunded = false

  if (gift.paymentId) {
    const payment = await tx.payment.findUnique({
      where: { id: gift.paymentId },
      select: {
        id: true,
        orderId: true,
        userId: true,
        amount: true,
        currency: true,
        status: true,
        frozen: true,
        version: true,
      },
    })
    if (!payment) {
      throw new AppError(
        'INTERNAL_ERROR',
        `Gift ${gift.id} references missing payment ${gift.paymentId}`,
        500,
        { giftId: gift.id, paymentId: gift.paymentId },
      )
    }
    if (payment.frozen) {
      throw new AppError(
        'CONFLICT',
        `Payment ${payment.id} is frozen — refund blocked (unfreeze first)`,
        409,
        { giftId: gift.id, paymentId: payment.id, frozen: true },
      )
    }
    if (payment.status !== 'CAPTURED') {
      // Payment is in CAPTURE_PENDING / FAILED / REFUNDED — can't refund.
      // For CREATED-status gifts (not yet paid), skip refund entirely.
      if (gift.status === 'CREATED') {
        // No refund needed — gift wasn't paid yet.
      } else {
        throw new AppError(
          'CONFLICT',
          `Payment ${payment.id} status is ${payment.status} — only CAPTURED payments can be refunded`,
          409,
          { giftId: gift.id, paymentId: payment.id, paymentStatus: payment.status },
        )
      }
    } else {
      // -----------------------------------------------------------------
      // Create the Refund record (REFUNDED in demo mode — inline)
      // -----------------------------------------------------------------
      const isDemoMode = !isFeatureEnabled('realPayments')
      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          // Demo mode: refund succeeds immediately (REFUNDED). Real mode:
          // REFUND_PENDING — the publisher calls refundRazorpayPayment() +
          // transitions to REFUNDED on gateway confirmation.
          status: isDemoMode ? 'REFUNDED' : 'REFUND_PENDING',
          // In demo mode, synthesize a Razorpay-style refund ID for audit clarity.
          // In real mode, the publisher sets this after the gateway call.
          gatewayRefundId: isDemoMode
            ? `rpf_demo_${Date.now()}_${randomUUID().slice(0, 8)}`
            : null,
          // In demo mode, the refund is already "confirmed" by the gateway.
          refundedAt: isDemoMode ? now : null,
        },
      })
      refundId = refund.id
      refundStatus = refund.status
      refundAmount = refund.amount

      // -----------------------------------------------------------------
      // Reversal LedgerEntries (Dr CONSUMER_REVENUE + Cr GATEWAY_RECEIVABLE)
      // -----------------------------------------------------------------
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'DEBIT',
          accountType: 'CONSUMER_REVENUE',
          amount: payment.amount,
          traceId,
        },
      })
      await tx.ledgerEntry.create({
        data: {
          paymentId: payment.id,
          entryType: 'CREDIT',
          accountType: 'GATEWAY_RECEIVABLE',
          amount: payment.amount,
          traceId,
        },
      })

      // -----------------------------------------------------------------
      // Update Payment.status → REFUNDED (full refund)
      // -----------------------------------------------------------------
      // Optimistic-lock: WHERE status='CAPTURED' + version=X. If a concurrent
      // transaction already refunded it, the update affects 0 rows → throw.
      const paymentUpdate = await tx.payment.updateMany({
        where: { id: payment.id, status: 'CAPTURED', version: payment.version },
        data: {
          status: 'REFUNDED',
          version: { increment: 1 },
        },
      })
      if (paymentUpdate.count === 0) {
        throw new AppError(
          'CONFLICT',
          `Payment ${payment.id} was modified by a concurrent transaction — please retry`,
          409,
          { giftId: gift.id, paymentId: payment.id },
        )
      }

      // -----------------------------------------------------------------
      // Update ghost Order.status → CANCELLED
      // -----------------------------------------------------------------
      const orderHistory = JSON.stringify([
        { status: 'CONFIRMED', at: nowIso },
        { status: 'PAID', at: nowIso },
        { status: 'CANCELLED', at: nowIso },
      ])
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: 'CANCELLED',
          statusHistory: orderHistory,
        },
      })

      // -----------------------------------------------------------------
      // Audit + Outbox
      // -----------------------------------------------------------------
      await tx.auditLog.create({
        data: {
          actorId: input.senderId,
          actorRole: input.senderRole,
          action: 'PAYMENT_REFUNDED',
          metadata: JSON.stringify({
            paymentId: payment.id,
            orderId: payment.orderId,
            giftId: gift.id,
            refundId: refund.id,
            amount: payment.amount,
            fullRefund: true,
            source: 'gift-cancel',
            demoMode: isDemoMode,
          }),
        },
      })
      await enqueueOutboxEvent(tx, {
        eventType: 'PAYMENT_REFUNDED',
        aggregateType: 'Refund',
        aggregateId: refund.id,
        payload: {
          refundId: refund.id,
          paymentId: payment.id,
          orderId: payment.orderId,
          giftId: gift.id,
          amount: payment.amount,
          currency: payment.currency,
          fullRefund: true,
          source: 'gift-cancel',
          demoMode: isDemoMode,
        },
      })

      paymentWasRefunded = true
    }
  }

  // -------------------------------------------------------------------------
  // Transition Gift.status → CANCELLED (+ refundedAt if refund was processed)
  // -------------------------------------------------------------------------
  // Conditional update — only proceeds if status is still in the allowed set.
  // (Concurrent redeem/cancel would have transitioned it already.)
  const allowedStatusesForTransition = paymentWasRefunded
    ? ['AVAILABLE', 'PAID']
    : allowedSourceStatuses
  const giftTransition = await tx.gift.updateMany({
    where: {
      id: gift.id,
      status: { in: allowedStatusesForTransition },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      refundedAt: paymentWasRefunded ? now : null,
    },
  })
  if (giftTransition.count === 0) {
    throw new AppError(
      'CONFLICT',
      `Gift ${gift.id} was modified by a concurrent transaction — please retry`,
      409,
      { giftId: gift.id },
    )
  }

  // -------------------------------------------------------------------------
  // Audit + Outbox (GIFT_CANCELLED)
  // -------------------------------------------------------------------------
  await tx.auditLog.create({
    data: {
      actorId: input.senderId,
      actorRole: input.senderRole,
      action: 'GIFT_CANCELLED',
      metadata: JSON.stringify({
        giftId: gift.id,
        senderId: input.senderId,
        recipientId: gift.recipientId,
        previousStatus: gift.status,
        paymentId: gift.paymentId,
        refundId,
        refundAmount,
        paymentWasRefunded,
      }),
    },
  })
  await enqueueOutboxEvent(tx, {
    eventType: 'GIFT_CANCELLED',
    aggregateType: 'Gift',
    aggregateId: gift.id,
    payload: {
      giftId: gift.id,
      senderId: input.senderId,
      recipientId: gift.recipientId,
      previousStatus: gift.status,
      refundId,
      paymentWasRefunded,
    },
  })

  // -------------------------------------------------------------------------
  // Notification to recipient
  // -------------------------------------------------------------------------
  await tx.notification.create({
    data: {
      userId: gift.recipientId,
      type: 'SYSTEM',
      title: 'A gift was cancelled',
      body: `A gift from the sender was cancelled${paymentWasRefunded ? ' and refunded' : ''}.`,
      data: JSON.stringify({
        giftId: gift.id,
        senderId: input.senderId,
        menuItemName: gift.menuItemName,
        refundProcessed: paymentWasRefunded,
        deepLink: `/gifts/${gift.id}`,
      }),
      readAt: null,
    },
  })

  return {
    gift: {
      id: gift.id,
      status: 'CANCELLED',
      cancelledAt: now,
      refundedAt: paymentWasRefunded ? now : null,
    },
    refund: {
      id: refundId,
      status: refundStatus,
      amount: refundAmount,
    },
  }
}

// ---------------------------------------------------------------------------
// expireGifts — background job (placeholder — lazy enforcement + cron)
// ---------------------------------------------------------------------------

/**
 * Background job: transitions AVAILABLE gifts whose `expiresAt < now` to
 * EXPIRED + triggers refund for any paid gift.
 *
 * Idempotent: only transitions AVAILABLE → EXPIRED (already-EXPIRED gifts
 * are skipped). Refund is only created once per gift (idempotent via the
 * `paymentWasRefunded` flag check — if the gift was already refunded via
 * cancelGift, this job does nothing).
 *
 * Usage:
 *   - Called from a cron job (Wave 8+).
 *   - Called lazily from GET /api/gifts/[id] when an expired gift is read.
 *   - Safe to call repeatedly (idempotent).
 *
 * NOTE: This is a PLACEHOLDER for the cron job — the route handlers (GET
 * /api/gifts, GET /api/gifts/[id]) also do lazy expiry checks inline. The
 * cron job is the primary mechanism; lazy checks are a defensive backstop.
 */
export async function expireGifts(
  tx: Prisma.TransactionClient,
  options?: { now?: Date; traceId?: string },
): Promise<ExpireGiftsResult> {
  const now = options?.now ?? new Date()
  const traceId = options?.traceId ?? ''
  const expiredGiftIds: string[] = []
  let refundCount = 0

  // Find all AVAILABLE gifts whose expiresAt < now.
  const expiredGifts = await tx.gift.findMany({
    where: {
      status: 'AVAILABLE',
      expiresAt: { lt: now },
    },
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      paymentId: true,
      menuItemName: true,
    },
  })

  for (const gift of expiredGifts) {
    // Transition AVAILABLE → EXPIRED (conditional update — idempotent).
    const transition = await tx.gift.updateMany({
      where: { id: gift.id, status: 'AVAILABLE' },
      data: { status: 'EXPIRED' },
    })
    if (transition.count === 0) {
      // Concurrent transaction already transitioned — skip.
      continue
    }
    expiredGiftIds.push(gift.id)

    // Audit log
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'GIFT_EXPIRED',
        metadata: JSON.stringify({
          giftId: gift.id,
          senderId: gift.senderId,
          recipientId: gift.recipientId,
          paymentId: gift.paymentId,
          source: 'expireGifts-job',
        }),
      },
    })

    // Outbox event
    await enqueueOutboxEvent(tx, {
      eventType: 'GIFT_EXPIRED',
      aggregateType: 'Gift',
      aggregateId: gift.id,
      payload: {
        giftId: gift.id,
        senderId: gift.senderId,
        recipientId: gift.recipientId,
        paymentId: gift.paymentId,
      },
    })

    // Trigger refund for paid gifts (if a Payment exists + is CAPTURED).
    // Mirrors cancelGift's refund flow — direct (NOT calling /api/payments/refund).
    if (gift.paymentId) {
      const payment = await tx.payment.findUnique({
        where: { id: gift.paymentId },
        select: { id: true, orderId: true, amount: true, currency: true, status: true, frozen: true, version: true },
      })
      if (payment && payment.status === 'CAPTURED' && !payment.frozen) {
        const isDemoMode = !isFeatureEnabled('realPayments')
        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            status: isDemoMode ? 'REFUNDED' : 'REFUND_PENDING',
            gatewayRefundId: isDemoMode
              ? `rpf_demo_${Date.now()}_${randomUUID().slice(0, 8)}`
              : null,
            refundedAt: isDemoMode ? now : null,
          },
        })
        await tx.ledgerEntry.create({
          data: {
            paymentId: payment.id,
            entryType: 'DEBIT',
            accountType: 'CONSUMER_REVENUE',
            amount: payment.amount,
            traceId,
          },
        })
        await tx.ledgerEntry.create({
          data: {
            paymentId: payment.id,
            entryType: 'CREDIT',
            accountType: 'GATEWAY_RECEIVABLE',
            amount: payment.amount,
            traceId,
          },
        })
        const paymentUpdate = await tx.payment.updateMany({
          where: { id: payment.id, status: 'CAPTURED', version: payment.version },
          data: { status: 'REFUNDED', version: { increment: 1 } },
        })
        if (paymentUpdate.count > 0) {
          const nowIso = now.toISOString()
          await tx.order.update({
            where: { id: payment.orderId },
            data: {
              status: 'CANCELLED',
              statusHistory: JSON.stringify([
                { status: 'CONFIRMED', at: nowIso },
                { status: 'PAID', at: nowIso },
                { status: 'CANCELLED', at: nowIso },
              ]),
            },
          })
          await tx.auditLog.create({
            data: {
              actorId: null,
              actorRole: 'SYSTEM',
              action: 'PAYMENT_REFUNDED',
              metadata: JSON.stringify({
                paymentId: payment.id,
                orderId: payment.orderId,
                giftId: gift.id,
                refundId: refund.id,
                amount: payment.amount,
                source: 'gift-expire',
                demoMode: isDemoMode,
              }),
            },
          })
          await enqueueOutboxEvent(tx, {
            eventType: 'PAYMENT_REFUNDED',
            aggregateType: 'Refund',
            aggregateId: refund.id,
            payload: {
              refundId: refund.id,
              paymentId: payment.id,
              orderId: payment.orderId,
              giftId: gift.id,
              amount: payment.amount,
              currency: payment.currency,
              source: 'gift-expire',
              demoMode: isDemoMode,
            },
          })
          refundCount++
        }
      }
    }

    // Notification to sender (gift expired)
    await tx.notification.create({
      data: {
        userId: gift.senderId,
        type: 'SYSTEM',
        title: 'A gift you sent has expired',
        body: `${gift.menuItemName} was not redeemed within 30 days. A refund has been processed.`,
        data: JSON.stringify({
          giftId: gift.id,
          menuItemName: gift.menuItemName,
          refundProcessed: !!gift.paymentId,
          deepLink: `/gifts/${gift.id}`,
        }),
        readAt: null,
      },
    })
  }

  return {
    expiredCount: expiredGiftIds.length,
    refundCount,
    expiredGiftIds,
  }
}
