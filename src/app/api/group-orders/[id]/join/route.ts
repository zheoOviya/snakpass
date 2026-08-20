import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, AppError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { recordActivity, VERBS } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 7 Task 7A — POST /api/group-orders/[id]/join — friend joins a group order
// ----------------------------------------------------------------------------
// Body: { shareCode?: string }
//
// Behavior:
//   - If `shareCode` is provided in the body, the group order is looked up by
//     shareCode (the URL [id] is ignored — this allows the URL to be a dummy
//     like "join" while the actual lookup is by shareCode). Useful for deep
//     links like /group/[shareCode] → POST /api/group-orders/join.
//   - If `shareCode` is NOT provided, the URL [id] is treated as the
//     groupOrderId (direct join by ID).
//
// Validation:
//   - GroupOrder must exist (404 if not found).
//   - GroupOrder.status must be OPEN (409 if CONFIRMED/CANCELLED).
//   - GroupOrder.closesAt must be > now (410 Gone if expired).
//   - User must not already be a member (200 with existing membership —
//     idempotent join).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: CONSUMER only (vendors/admins have separate identities). Admins may
//   bypass for incident response.
//
// Returns: { groupOrder: { id, status, shareCode, ... } }
//
// Side effects (all inside the same transaction):
//   - GroupOrderMember row created (idempotent — re-join returns existing row).
//   - AuditLog GROUP_ORDER_JOINED.
//   - Outbox event GROUP_ORDER_JOINED.
//   - SocialActivity JOINED_GROUP (records the join in the friend feed).
// ----------------------------------------------------------------------------

interface JoinResult {
  type: 'joined' | 'already_member' | 'cached'
  groupOrderId: string
  status: string
  shareCode: string
  memberId: string
  joinedAt: Date
}

export const POST = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: urlId } = await params

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
    // RBAC — CONSUMER only.
    // -------------------------------------------------------------------------
    const isAdmin = session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'
    if (session.role !== 'CONSUMER' && !isAdmin) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only consumers can join group orders',
        403,
        { requiredRoles: ['CONSUMER'], actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse body (optional shareCode).
    // -------------------------------------------------------------------------
    let bodyShareCode: string | undefined
    try {
      const body = await req.json()
      if (body && typeof body === 'object' && 'shareCode' in body) {
        const sc = (body as { shareCode?: unknown }).shareCode
        if (typeof sc === 'string' && sc.length > 0) {
          bodyShareCode = sc
        }
      }
    } catch {
      // No body or invalid JSON — fall through to URL [id] lookup.
    }

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // 1. Resolve the GroupOrder — by shareCode if provided, else by URL [id].
        // -------------------------------------------------------------------
        const lookupWhere = bodyShareCode
          ? { shareCode: bodyShareCode }
          : { id: urlId }

        const groupOrder = await tx.groupOrder.findUnique({
          where: lookupWhere,
          select: {
            id: true,
            hostId: true,
            restaurantId: true,
            status: true,
            shareCode: true,
            closesAt: true,
            name: true,
            restaurant: { select: { id: true, name: true } },
          },
        })

        if (!groupOrder) {
          throw new AppError(
            'NOT_FOUND',
            bodyShareCode
              ? `Group order with share code ${bodyShareCode} not found`
              : `Group order ${urlId} not found`,
            404,
            bodyShareCode ? { shareCode: bodyShareCode } : { groupOrderId: urlId },
          )
        }

        // -------------------------------------------------------------------
        // 2. Validate status=OPEN.
        // -------------------------------------------------------------------
        if (groupOrder.status === 'CONFIRMED') {
          throw new AppError(
            'CONFLICT',
            'This group order has already been confirmed',
            409,
            { groupOrderId: groupOrder.id, status: groupOrder.status },
          )
        }
        if (groupOrder.status === 'CANCELLED') {
          throw new AppError(
            'CONFLICT',
            'This group order has been cancelled',
            409,
            { groupOrderId: groupOrder.id, status: groupOrder.status },
          )
        }
        if (groupOrder.status !== 'OPEN') {
          throw new AppError(
            'CONFLICT',
            `Group order is in status ${groupOrder.status} — only OPEN group orders can be joined`,
            409,
            { groupOrderId: groupOrder.id, status: groupOrder.status },
          )
        }

        // -------------------------------------------------------------------
        // 3. Validate closesAt > now (410 Gone if expired).
        // -------------------------------------------------------------------
        const now = new Date()
        if (groupOrder.closesAt.getTime() <= now.getTime()) {
          throw new AppError(
            'CONFLICT',
            'This group order has expired and is no longer accepting new members',
            410,
            { groupOrderId: groupOrder.id, closesAt: groupOrder.closesAt.toISOString() },
          )
        }

        // -------------------------------------------------------------------
        // 4. Idempotent — if the user is already a member, return success
        //    WITHOUT creating a duplicate row. (Also covers the host joining
        //    their own group — they were added at create time.)
        // -------------------------------------------------------------------
        const existingMember = await tx.groupOrderMember.findUnique({
          where: {
            groupOrderId_userId: {
              groupOrderId: groupOrder.id,
              userId: session.userId,
            },
          },
          select: { id: true, joinedAt: true },
        })

        if (existingMember) {
          return {
            type: 'already_member' as const,
            groupOrderId: groupOrder.id,
            status: groupOrder.status,
            shareCode: groupOrder.shareCode,
            memberId: existingMember.id,
            joinedAt: existingMember.joinedAt,
          }
        }

        // -------------------------------------------------------------------
        // 5. Add the user as a GroupOrderMember.
        // -------------------------------------------------------------------
        const member = await tx.groupOrderMember.create({
          data: {
            groupOrderId: groupOrder.id,
            userId: session.userId,
          },
        })

        // -------------------------------------------------------------------
        // 6. AuditLog GROUP_ORDER_JOINED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'GROUP_ORDER_JOINED',
            metadata: JSON.stringify({
              groupOrderId: groupOrder.id,
              userId: session.userId,
              shareCode: groupOrder.shareCode,
              hostId: groupOrder.hostId,
              restaurantId: groupOrder.restaurantId,
            }),
          },
        })

        // -------------------------------------------------------------------
        // 7. Outbox event GROUP_ORDER_JOINED.
        // -------------------------------------------------------------------
        await enqueueOutboxEvent(tx, {
          eventType: 'GROUP_ORDER_JOINED',
          aggregateType: 'GroupOrder',
          aggregateId: groupOrder.id,
          payload: {
            groupOrderId: groupOrder.id,
            userId: session.userId,
            hostId: groupOrder.hostId,
            restaurantId: groupOrder.restaurantId,
            shareCode: groupOrder.shareCode,
            joinedAt: member.joinedAt.toISOString(),
          },
        })

        // -------------------------------------------------------------------
        // 8. SocialActivity JOINED_GROUP (records the join in the friend feed).
        //    Best-effort — failure does NOT roll back the join.
        // -------------------------------------------------------------------
        try {
          await recordActivity(tx, {
            actorId: session.userId,
            verb: VERBS.JOINED_GROUP,
            objectType: 'GroupOrder',
            objectId: groupOrder.id,
            metadata: {
              restaurantId: groupOrder.restaurantId,
              restaurantName: groupOrder.restaurant?.name ?? null,
              shareCode: groupOrder.shareCode,
              hostId: groupOrder.hostId,
            },
            visibility: 'FRIENDS',
          })
        } catch {
          // Non-critical — swallow so the join succeeds.
        }

        return {
          type: 'joined' as const,
          groupOrderId: groupOrder.id,
          status: groupOrder.status,
          shareCode: groupOrder.shareCode,
          memberId: member.id,
          joinedAt: member.joinedAt,
        }
      })

      // -------------------------------------------------------------------
      // Handle result variants — switch for exhaustiveness.
      // -------------------------------------------------------------------
      switch (result.type) {
        case 'joined': {
          logInfo(
            'group-order-join-success',
            {
              groupOrderId: result.groupOrderId,
              userId: session.userId,
              memberId: result.memberId,
            },
            traceId,
          )
          return buildJoinResponse(result)
        }
        case 'already_member': {
          logInfo(
            'group-order-join-already-member',
            { groupOrderId: result.groupOrderId, userId: session.userId },
            traceId,
          )
          return buildJoinResponse(result)
        }
        default: {
          // Exhaustiveness guard
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      // AppError (NOT_FOUND, CONFLICT) — propagate to withErrorHandler.
      if (error instanceof AppError) {
        throw error
      }
      // Transaction conflict — retry exhausted.
      if (error instanceof TransactionConflictError) {
        logInfo(
          'group-order-join-conflict',
          {
            attempts: error.attempts,
            code: error.code,
            userId: session.userId,
          },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Join conflicted with a concurrent request. Please retry.',
          409,
          { attempts: error.attempts, code: error.code },
          traceId,
        )
      }
      throw error
    }
  })

// ---------------------------------------------------------------------------
// buildJoinResponse — shape the JSON response for both 'joined' + 'already_member'.
// ---------------------------------------------------------------------------
function buildJoinResponse(r: JoinResult): NextResponse {
  return NextResponse.json({
    groupOrder: {
      id: r.groupOrderId,
      status: r.status,
      shareCode: r.shareCode,
      shareUrl: `/group/${r.shareCode}`,
    },
    member: {
      id: r.memberId,
      joinedAt: r.joinedAt.toISOString(),
    },
  })
}
