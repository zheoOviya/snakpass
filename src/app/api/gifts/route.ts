import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { validateBody, giftCreateSchema } from '@/lib/validation'
import { withErrorHandler, apiError, AppError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import { createGift } from '@/lib/gift-service'

// ----------------------------------------------------------------------------
// Wave 6 Task 6C — Gifting backend (ghost order pattern)
//   GET  /api/gifts                — list gifts sent by + received by the
//                                    authenticated user (sender + recipient
//                                    names + menu item details included)
//   POST /api/gifts                — create a new gift + ghost order + demo
//                                    payment (atomic). Returns gift + ghost
//                                    order + payment info.
// ----------------------------------------------------------------------------
//
// Governance:
//   - Does NOT call /api/orders POST (uses tx.order.create directly inside
//     the gift-service.createGift function — additive only).
//   - Does NOT call /api/payments POST (creates Payment inline inside
//     gift-service.createGift — mirrors the route's logic).
//   - Auth: getSessionUser() required (401 if no session).
//   - RBAC: POST is CONSUMER-only (vendors/admins have separate identities).
//           GET is open to any authenticated user (returns only their own
//           sent/received gifts).
//   - Idempotency-Key: supported on POST (resourceType='Gift'). Same key on
//     retry returns the cached response.
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'Gift'

// ---------------------------------------------------------------------------
// Gift row shape returned by the GET endpoint. Includes the related sender /
// recipient / menuItem / restaurant details.
// ---------------------------------------------------------------------------
interface GiftView {
  id: string
  status: string
  redemptionCode: string
  message: string | null
  senderId: string
  senderName: string | null
  senderPhone: string | null
  recipientId: string
  recipientName: string | null
  recipientPhone: string | null
  menuItemId: string
  menuItemName: string
  menuItemPrice: number
  menuItemImage: string | null
  restaurantId: string | null
  restaurantName: string | null
  paymentId: string | null
  recipientOrderId: string | null
  expiresAt: string
  paidAt: string | null
  availableAt: string | null
  redeemedAt: string | null
  cancelledAt: string | null
  refundedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// GET /api/gifts — list sent + received gifts for the current user.
// ---------------------------------------------------------------------------
// Returns: { sent: GiftView[], received: GiftView[] }
//
// Each GiftView includes sender + recipient names + menu item details.
//
// Lazy expiry: AVAILABLE gifts whose expiresAt < now are surfaced as-is
// (their status is still 'AVAILABLE' in the DB; the dedicated expireGifts()
// cron job / endpoint transitions them to EXPIRED. We don't mutate state in
// a GET route to preserve read-only idempotency.)
// ---------------------------------------------------------------------------
export const GET = () =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // Parallel fetches for sent + received (read-only, no transaction needed).
    const selectShape = {
      id: true,
      status: true,
      redemptionCode: true,
      message: true,
      senderId: true,
      recipientId: true,
      menuItemId: true,
      menuItemName: true,
      menuItemPrice: true,
      paymentId: true,
      recipientOrderId: true,
      expiresAt: true,
      paidAt: true,
      availableAt: true,
      redeemedAt: true,
      cancelledAt: true,
      refundedAt: true,
      createdAt: true,
      updatedAt: true,
      menuItem: {
        select: {
          id: true,
          name: true,
          image: true,
          restaurantId: true,
          restaurant: { select: { id: true, name: true } },
        },
      },
    } as const

    const [sentRows, receivedRows] = await Promise.all([
      // Gifts sent BY the current user.
      db.gift.findMany({
        where: { senderId: session.userId },
        orderBy: { createdAt: 'desc' },
        select: selectShape,
      }),
      // Gifts received BY the current user.
      db.gift.findMany({
        where: { recipientId: session.userId },
        orderBy: { createdAt: 'desc' },
        select: selectShape,
      }),
    ])

    // Resolve sender + recipient names in a single batched query.
    // (Gifts don't carry the names as snapshots — we resolve them at read time
    // from the User table.)
    const allUserIds = new Set<string>()
    for (const g of [...sentRows, ...receivedRows]) {
      allUserIds.add(g.senderId)
      allUserIds.add(g.recipientId)
    }
    const users = allUserIds.size > 0
      ? await db.user.findMany({
          where: { id: { in: Array.from(allUserIds) } },
          select: { id: true, name: true, phone: true },
        })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    const mapGift = (g: typeof sentRows[number]): GiftView => {
      const sender = userMap.get(g.senderId)
      const recipient = userMap.get(g.recipientId)
      return {
        id: g.id,
        status: g.status,
        redemptionCode: g.redemptionCode,
        message: g.message,
        senderId: g.senderId,
        senderName: sender?.name ?? null,
        senderPhone: sender?.phone ?? null,
        recipientId: g.recipientId,
        recipientName: recipient?.name ?? null,
        recipientPhone: recipient?.phone ?? null,
        menuItemId: g.menuItemId,
        menuItemName: g.menuItemName,
        menuItemPrice: g.menuItemPrice,
        menuItemImage: g.menuItem?.image ?? null,
        restaurantId: g.menuItem?.restaurantId ?? null,
        restaurantName: g.menuItem?.restaurant?.name ?? null,
        paymentId: g.paymentId,
        recipientOrderId: g.recipientOrderId,
        expiresAt: g.expiresAt.toISOString(),
        paidAt: g.paidAt?.toISOString() ?? null,
        availableAt: g.availableAt?.toISOString() ?? null,
        redeemedAt: g.redeemedAt?.toISOString() ?? null,
        cancelledAt: g.cancelledAt?.toISOString() ?? null,
        refundedAt: g.refundedAt?.toISOString() ?? null,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      }
    }

    return NextResponse.json({
      sent: sentRows.map(mapGift),
      received: receivedRows.map(mapGift),
    })
  })

// ---------------------------------------------------------------------------
// POST /api/gifts — create a gift + ghost order + demo payment (atomic)
// ---------------------------------------------------------------------------
// Body: { recipientId, menuItemId, message? }
//
// Returns: { gift: { id, status, ... }, order: { id, status, pickupOtp, ... },
//            payment: { id, status, amount, ... } }
//
// The route delegates the core mutation logic to gift-service.createGift,
// which performs all writes inside a single transaction:
//   1. Create Gift (status=CREATED)
//   2. Create ghost Order (note encodes `GIFT:${giftId}:for:${recipientId}`)
//   3. Create demo Payment (status=CAPTURED — skips CAPTURE_PENDING publisher
//      step for gifts per plan Decision #3 MVP scope)
//   4. Create LedgerEntries (Dr GATEWAY_RECEIVABLE + Cr CONSUMER_REVENUE)
//   5. Update ghost Order status=PAID
//   6. Update Gift status=AVAILABLE + paymentId + orderId + expiresAt (30d)
//   7. AuditLog GIFT_CREATED + PAYMENT_CAPTURED
//   8. Outbox events GIFT_CREATED + PAYMENT_CAPTURED
//   9. Notification to recipient (GIFT_RECEIVED)
//
// Idempotency-Key header (recommended) — same key on retry returns the cached
// response. Without it, a retry would create a duplicate gift (gift-service
// generates a new redemptionCode on each call).
// ---------------------------------------------------------------------------
export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // RBAC — CONSUMER only (vendors + admins have separate identities).
    // -------------------------------------------------------------------------
    if (session.role !== 'CONSUMER') {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only consumers can send gifts',
        403,
        { requiredRoles: ['CONSUMER'], actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Validate body
    // -------------------------------------------------------------------------
    const body = await validateBody(req, giftCreateSchema)
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'gift-create-idempotency-dedup-hit',
              { key: idempotencyKey, userId: session.userId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Delegate to gift-service.createGift for the atomic mutation.
        // Throws AppError on validation/business failures (NOT_FOUND,
        // VALIDATION_ERROR, CONFLICT) — the route's catch block maps these to
        // appropriate HTTP responses.
        // -------------------------------------------------------------------
        const created = await createGift(tx, {
          senderId: session.userId,
          senderRole: session.role,
          recipientId: body.recipientId,
          menuItemId: body.menuItemId,
          message: body.message ?? null,
          traceId,
        })

        const responseBody = {
          gift: {
            id: created.gift.id,
            status: created.gift.status,
            redemptionCode: created.gift.redemptionCode,
            message: created.gift.message,
            senderId: created.gift.senderId,
            recipientId: created.gift.recipientId,
            menuItemId: created.gift.menuItemId,
            menuItemName: created.gift.menuItemName,
            menuItemPrice: created.gift.menuItemPrice,
            paymentId: created.gift.paymentId,
            recipientOrderId: created.gift.recipientOrderId,
            expiresAt: created.gift.expiresAt.toISOString(),
            paidAt: created.gift.paidAt?.toISOString() ?? null,
            availableAt: created.gift.availableAt?.toISOString() ?? null,
            createdAt: created.gift.createdAt.toISOString(),
            updatedAt: created.gift.updatedAt.toISOString(),
          },
          order: {
            id: created.ghostOrder.id,
            status: created.ghostOrder.status,
            totalAmount: created.ghostOrder.totalAmount,
            pickupOtp: created.ghostOrder.pickupOtp,
            note: created.ghostOrder.note,
          },
          payment: {
            id: created.payment.id,
            status: created.payment.status,
            amount: created.payment.amount,
            currency: created.payment.currency,
            gatewayPaymentId: created.payment.gatewayPaymentId,
          },
        }

        // -------------------------------------------------------------------
        // Store idempotency record (inside the same txn — atomic).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            created.gift.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
          logInfo(
            'gift-create-idempotency-key-stored',
            { key: idempotencyKey, giftId: created.gift.id, requestHashStored: requestHash !== null },
            traceId,
          )
        }

        return { type: 'created' as const, status: 200, body: responseBody, giftId: created.gift.id }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'created': {
          logInfo(
            'gift-create-success',
            { giftId: result.giftId, senderId: session.userId, recipientId: body.recipientId },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          // Exhaustiveness guard
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      // Sub-Wave 3c: IdempotencyKeyReuseError — same key + different body.
      // NON-retryable — propagate to client (withErrorHandler converts to 422).
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'gift-create-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      // AppError from gift-service (NOT_FOUND, VALIDATION_ERROR, CONFLICT) —
      // propagate to withErrorHandler for status mapping.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'gift-create-conflict',
          { attempts: error.attempts, code: error.code, userId: session.userId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Gift creation conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })
