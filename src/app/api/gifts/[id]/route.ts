import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 6 Task 6C — GET /api/gifts/[id] — gift details
// ----------------------------------------------------------------------------
// Returns full gift details including sender name, recipient name, menu item
// details, payment info.
//
// Auth: getSessionUser() required (401 if no session).
// Authorization: only the sender OR recipient may view the gift (403 otherwise).
//
// Returns:
//   {
//     gift: {
//       id, status, redemptionCode, message,
//       senderId, senderName, senderPhone,
//       recipientId, recipientName, recipientPhone,
//       menuItemId, menuItemName, menuItemPrice, menuItemImage,
//       restaurantId, restaurantName,
//       paymentId, recipientOrderId,
//       expiresAt, paidAt, availableAt, redeemedAt, cancelledAt, refundedAt,
//       createdAt, updatedAt,
//     },
//     payment: { id, status, amount, currency, gatewayPaymentId, capturedAt } | null,
//     recipientOrder: { id, status, totalAmount, pickupOtp, note } | null,
//     ghostOrder: { id, status, totalAmount, pickupOtp, note } | null,
//   }
//
// Governance: read-only — does NOT mutate any state (no lazy expiry mutation;
// the dedicated expireGifts() cron job / endpoint handles that).
// ----------------------------------------------------------------------------

export const GET = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: giftId } = await params

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
    // Load the gift + relations (sender, recipient, menuItem + restaurant)
    // -------------------------------------------------------------------------
    const gift = await db.gift.findUnique({
      where: { id: giftId },
      select: {
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
            description: true,
            spiceLevel: true,
            isVeg: true,
            restaurantId: true,
            restaurant: { select: { id: true, name: true, cuisine: true, address: true } },
          },
        },
      },
    })

    if (!gift) {
      throw new AppError('NOT_FOUND', `Gift ${giftId} not found`, 404, { giftId })
    }

    // -------------------------------------------------------------------------
    // Authorization — only sender or recipient may view
    // -------------------------------------------------------------------------
    const isSender = gift.senderId === session.userId
    const isRecipient = gift.recipientId === session.userId
    // ADMIN + SUPER_ADMIN may view any gift (read-only audit support).
    const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
    if (!isSender && !isRecipient && !isAdmin) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'You can only view gifts you sent or received',
        403,
        { giftId, userId: session.userId },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Resolve sender + recipient names (gift doesn't snapshot them — read at
    // view time from User table).
    // -------------------------------------------------------------------------
    const [sender, recipient] = await Promise.all([
      db.user.findUnique({
        where: { id: gift.senderId },
        select: { id: true, name: true, phone: true },
      }),
      db.user.findUnique({
        where: { id: gift.recipientId },
        select: { id: true, name: true, phone: true },
      }),
    ])

    // -------------------------------------------------------------------------
    // Optionally load the payment (only if the gift has been paid) + the
    // recipient's order (if redeemed) + the ghost order (via payment.orderId).
    // -------------------------------------------------------------------------
    let payment: {
      id: string
      status: string
      amount: number
      currency: string
      gatewayPaymentId: string | null
      capturedAt: Date | null
    } | null = null
    let ghostOrder: {
      id: string
      status: string
      totalAmount: number
      pickupOtp: string
      note: string | null
    } | null = null
    let recipientOrder: {
      id: string
      status: string
      totalAmount: number
      pickupOtp: string
      note: string | null
    } | null = null

    if (gift.paymentId) {
      const paymentRow = await db.payment.findUnique({
        where: { id: gift.paymentId },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          gatewayPaymentId: true,
          capturedAt: true,
          orderId: true,
        },
      })
      if (paymentRow) {
        payment = {
          id: paymentRow.id,
          status: paymentRow.status,
          amount: paymentRow.amount,
          currency: paymentRow.currency,
          gatewayPaymentId: paymentRow.gatewayPaymentId,
          capturedAt: paymentRow.capturedAt,
        }
        // Load the ghost order (the order this payment paid for).
        const ghostOrderRow = await db.order.findUnique({
          where: { id: paymentRow.orderId },
          select: { id: true, status: true, totalAmount: true, pickupOtp: true, note: true },
        })
        if (ghostOrderRow) {
          ghostOrder = ghostOrderRow
        }
      }
    }

    if (gift.recipientOrderId) {
      const recipientOrderRow = await db.order.findUnique({
        where: { id: gift.recipientOrderId },
        select: { id: true, status: true, totalAmount: true, pickupOtp: true, note: true },
      })
      if (recipientOrderRow) {
        recipientOrder = recipientOrderRow
      }
    }

    // -------------------------------------------------------------------------
    // Build response
    // -------------------------------------------------------------------------
    // The redemptionCode is only visible to the recipient (fraud control —
    // sender shouldn't be able to redeem their own gift). If the viewer is
    // the sender (not the recipient), redact the redemptionCode.
    const shouldRedactCode = isSender && !isRecipient

    return NextResponse.json({
      gift: {
        id: gift.id,
        status: gift.status,
        redemptionCode: shouldRedactCode ? null : gift.redemptionCode,
        message: gift.message,
        senderId: gift.senderId,
        senderName: sender?.name ?? null,
        senderPhone: sender?.phone ?? null,
        recipientId: gift.recipientId,
        recipientName: recipient?.name ?? null,
        recipientPhone: recipient?.phone ?? null,
        menuItemId: gift.menuItemId,
        menuItemName: gift.menuItemName,
        menuItemPrice: gift.menuItemPrice,
        menuItemImage: gift.menuItem?.image ?? null,
        menuItemDescription: gift.menuItem?.description ?? null,
        menuItemSpiceLevel: gift.menuItem?.spiceLevel ?? null,
        menuItemIsVeg: gift.menuItem?.isVeg ?? null,
        restaurantId: gift.menuItem?.restaurantId ?? null,
        restaurantName: gift.menuItem?.restaurant?.name ?? null,
        restaurantCuisine: gift.menuItem?.restaurant?.cuisine ?? null,
        restaurantAddress: gift.menuItem?.restaurant?.address ?? null,
        paymentId: gift.paymentId,
        recipientOrderId: gift.recipientOrderId,
        expiresAt: gift.expiresAt.toISOString(),
        paidAt: gift.paidAt?.toISOString() ?? null,
        availableAt: gift.availableAt?.toISOString() ?? null,
        redeemedAt: gift.redeemedAt?.toISOString() ?? null,
        cancelledAt: gift.cancelledAt?.toISOString() ?? null,
        refundedAt: gift.refundedAt?.toISOString() ?? null,
        createdAt: gift.createdAt.toISOString(),
        updatedAt: gift.updatedAt.toISOString(),
      },
      payment,
      ghostOrder,
      recipientOrder,
    })
  })
