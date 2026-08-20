import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { avatarColorForUserId } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 7 Task 7A — GET /api/group-orders/[id] — group order details
// ----------------------------------------------------------------------------
// Returns full group order details including the host name, restaurant
// details, all members (with names + avatar colors), the current user's items
// (myItems), and all items across all members (allItems — useful for the host
// to review before confirming).
//
// Auth: getSessionUser() required (401 if no session).
// Authorization: caller must be the host OR a member (403 otherwise).
//   ADMIN/SUPER_ADMIN bypass for audit support.
//
// Returns:
//   {
//     groupOrder: {
//       id, hostId, hostName, restaurantId, restaurantName, restaurantImageUrl,
//       status, shareCode, name, closesAt, confirmedAt, confirmedOrderId,
//       createdAt, updatedAt, isHost,
//     },
//     members: [{
//       id, userId, userName, userAvatarColor, joinedAt,
//       itemCount, subtotalPaise, isHost, isMe,
//     }],
//     myItems: [{ id, menuItemId, name, pricePaise, quantity, subtotalPaise, addedAt, updatedAt }],
//     allItems: [{ id, userId, userName, menuItemId, name, pricePaise, quantity, subtotalPaise, addedAt, updatedAt }],
//     totals: {
//       memberCount, mySubtotalPaise, totalPaise, totalItems,
//     },
//   }
//
// Governance: read-only — does NOT mutate any state.
// ----------------------------------------------------------------------------

export const GET = (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: groupOrderId } = await params

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
    // Load the group order + restaurant + members + items.
    // -------------------------------------------------------------------------
    const groupOrder = await db.groupOrder.findUnique({
      where: { id: groupOrderId },
      select: {
        id: true,
        hostId: true,
        restaurantId: true,
        status: true,
        shareCode: true,
        name: true,
        closesAt: true,
        confirmedAt: true,
        confirmedOrderId: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        restaurant: {
          select: {
            id: true,
            name: true,
            image: true,
            cuisine: true,
            address: true,
            prepTimeMins: true,
            isActive: true,
            isSuspended: true,
          },
        },
        members: {
          select: {
            id: true,
            userId: true,
            joinedAt: true,
          },
        },
        items: {
          select: {
            id: true,
            userId: true,
            menuItemId: true,
            name: true,
            price: true,
            quantity: true,
            addedAt: true,
            updatedAt: true,
          },
          orderBy: { addedAt: 'asc' },
        },
      },
    })

    if (!groupOrder) {
      throw new AppError('NOT_FOUND', `Group order ${groupOrderId} not found`, 404, {
        groupOrderId,
      })
    }

    // -------------------------------------------------------------------------
    // Authorization — only host or member may view.
    // ADMIN/SUPER_ADMIN bypass for audit support.
    // -------------------------------------------------------------------------
    const isHost = groupOrder.hostId === session.userId
    const isMember = groupOrder.members.some((m) => m.userId === session.userId)
    const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
    if (!isHost && !isMember && !isAdmin) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'You can only view group orders you are part of',
        403,
        { groupOrderId, userId: session.userId },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Resolve user names (host + all members + all item owners) in a single
    // batched query — GroupOrder doesn't snapshot names.
    // -------------------------------------------------------------------------
    const userIds = new Set<string>()
    userIds.add(groupOrder.hostId)
    for (const m of groupOrder.members) userIds.add(m.userId)
    for (const i of groupOrder.items) userIds.add(i.userId)

    const users = userIds.size > 0
      ? await db.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, name: true, phone: true },
        })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    // -------------------------------------------------------------------------
    // Compute per-member totals (itemCount + subtotalPaise).
    // -------------------------------------------------------------------------
    const memberTotalsMap = new Map<
      string,
      { itemCount: number; subtotalPaise: number }
    >()
    for (const item of groupOrder.items) {
      const existing = memberTotalsMap.get(item.userId) ?? {
        itemCount: 0,
        subtotalPaise: 0,
      }
      existing.itemCount += item.quantity
      existing.subtotalPaise += item.price * item.quantity
      memberTotalsMap.set(item.userId, existing)
    }

    // -------------------------------------------------------------------------
    // Build the response shape.
    // -------------------------------------------------------------------------
    const hostName = userMap.get(groupOrder.hostId)?.name ?? null

    const members = groupOrder.members.map((m) => {
      const userName = userMap.get(m.userId)?.name ?? null
      const totals = memberTotalsMap.get(m.userId) ?? {
        itemCount: 0,
        subtotalPaise: 0,
      }
      return {
        id: m.id,
        userId: m.userId,
        userName,
        userAvatarColor: avatarColorForUserId(m.userId),
        joinedAt: m.joinedAt.toISOString(),
        itemCount: totals.itemCount,
        subtotalPaise: totals.subtotalPaise,
        isHost: m.userId === groupOrder.hostId,
        isMe: m.userId === session.userId,
      }
    })

    const myItems = groupOrder.items
      .filter((i) => i.userId === session.userId)
      .map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.name,
        pricePaise: i.price,
        quantity: i.quantity,
        subtotalPaise: i.price * i.quantity,
        addedAt: i.addedAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      }))

    const allItems = groupOrder.items.map((i) => ({
      id: i.id,
      userId: i.userId,
      userName: userMap.get(i.userId)?.name ?? null,
      menuItemId: i.menuItemId,
      name: i.name,
      pricePaise: i.price,
      quantity: i.quantity,
      subtotalPaise: i.price * i.quantity,
      addedAt: i.addedAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    }))

    const mySubtotalPaise = myItems.reduce(
      (s, i) => s + i.subtotalPaise,
      0,
    )
    const totalPaise = allItems.reduce((s, i) => s + i.subtotalPaise, 0)
    const totalItems = allItems.reduce((s, i) => s + i.quantity, 0)

    return NextResponse.json({
      groupOrder: {
        id: groupOrder.id,
        hostId: groupOrder.hostId,
        hostName,
        restaurantId: groupOrder.restaurantId,
        restaurantName: groupOrder.restaurant?.name ?? null,
        restaurantImageUrl: groupOrder.restaurant?.image ?? null,
        restaurantCuisine: groupOrder.restaurant?.cuisine ?? null,
        restaurantAddress: groupOrder.restaurant?.address ?? null,
        restaurantPrepTimeMins: groupOrder.restaurant?.prepTimeMins ?? null,
        restaurantIsActive: groupOrder.restaurant?.isActive ?? null,
        status: groupOrder.status,
        shareCode: groupOrder.shareCode,
        shareUrl: `/group/${groupOrder.shareCode}`,
        name: groupOrder.name,
        closesAt: groupOrder.closesAt.toISOString(),
        confirmedAt: groupOrder.confirmedAt?.toISOString() ?? null,
        confirmedOrderId: groupOrder.confirmedOrderId,
        version: groupOrder.version,
        createdAt: groupOrder.createdAt.toISOString(),
        updatedAt: groupOrder.updatedAt.toISOString(),
        isHost,
        isMember,
      },
      members,
      myItems,
      allItems,
      totals: {
        memberCount: members.length,
        mySubtotalPaise,
        totalPaise,
        totalItems,
      },
    })
  })
