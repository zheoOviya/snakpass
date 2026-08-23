import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 6 Task 6A — /api/social/connections/[id]
// ----------------------------------------------------------------------------
// PATCH  — accept (status='ACCEPTED') or block (status='BLOCKED') a friend
//          request. Only the followee (recipient of the request) can accept.
//          On ACCEPT, creates the reverse SocialConnection (B→A, ACCEPTED) in
//          the same transaction → bidirectional friendship.
// DELETE — unfriend (removes both rows) OR block (sets status=BLOCKED instead
//          of deleting, when body `{ block: true }`).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role.
//
// Governance (plan Decision #7 — bidirectional friendship stored as 2 rows):
//   On ACCEPT, the route creates the reverse edge (B→A, ACCEPTED) in addition
//   to flipping the existing edge A→B from PENDING → ACCEPTED. This means:
//     - Both rows exist after accept → easy "give me my accepted friends" query
//       (just SELECT WHERE followerId=me AND status='ACCEPTED').
//     - DELETE removes BOTH rows atomically → no orphan edges.
//
// Errors: 400 (validation) / 401 (no session) / 403 (RBAC: not the followee) /
//         404 (connection not found) / 409 (conflict) / 500 (internal).
// ----------------------------------------------------------------------------

// ----------------------------------------
// PATCH /api/social/connections/[id]
// ----------------------------------------
// Body: { status: 'ACCEPTED' | 'BLOCKED' | 'REJECTED' }
//
// Backward-compat alias: { action: 'ACCEPT' | 'REJECT' | 'BLOCK' }
// (Wave 1C social-store.ts uses `action`. Both shapes are accepted; `status`
// takes precedence when both are present.)
//
// Authorization:
//   - ACCEPTED / REJECTED: only the followee (recipient of the request) can
//     transition. The follower (sender) cannot self-accept their own request.
//   - BLOCKED: either party can block — symmetric.
//
// On ACCEPT (the primary path):
//   1. Update the existing row: status='ACCEPTED', acceptedAt=now.
//   2. Upsert the reverse edge (B→A, ACCEPTED) — if a row already exists,
//      flip it to ACCEPTED (idempotent — covers the rare race where the same
//      pair is processed twice via different paths).
//   3. Send a Notification to the follower: "X accepted your friend request!".
//   4. Audit log: action='FRIEND_REQUEST_ACCEPTED'.
//
// On BLOCKED:
//   1. Update the existing row: status='BLOCKED'.
//   2. If a reverse edge exists, set it to BLOCKED too (or delete it — we
//      choose BLOCKED for audit trail clarity).
//   3. Audit log: action='FRIEND_BLOCKED'.
//
// On REJECTED:
//   1. Delete the existing row (REJECTED has no future value — the follower
//      can re-request if they want).
//   2. Audit log: action='FRIEND_REQUEST_REJECTED'.
// ----------------------------------------------------------------------------

type PatchStatus = 'ACCEPTED' | 'BLOCKED' | 'REJECTED'

function parsePatchStatus(body: unknown): PatchStatus | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as { status?: unknown; action?: unknown }
  if (typeof b.status === 'string') {
    const s = b.status.toUpperCase()
    if (s === 'ACCEPTED' || s === 'BLOCKED' || s === 'REJECTED') return s
  }
  if (typeof b.action === 'string') {
    const a = b.action.toUpperCase()
    if (a === 'ACCEPT') return 'ACCEPTED'
    if (a === 'REJECT') return 'REJECTED'
    if (a === 'BLOCK') return 'BLOCKED'
  }
  return null
}

export const PATCH = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: connectionId } = await params

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

    // Parse body
    let parsed: unknown = null
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        parsed = JSON.parse(text)
      }
    } catch {
      // ignore — fails validation below
    }

    const status = parsePatchStatus(parsed)
    if (!status) {
      return apiError(
        'VALIDATION_ERROR',
        "status must be 'ACCEPTED' | 'BLOCKED' | 'REJECTED'",
        400,
        { field: 'status', allowed: ['ACCEPTED', 'BLOCKED', 'REJECTED'] },
        traceId,
      ) as unknown as NextResponse
    }

    try {
      const result = await withTransaction(async (tx) => {
        // 1. Load the connection.
        const conn = await tx.socialConnection.findUnique({
          where: { id: connectionId },
        })
        if (!conn) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: 'Connection not found',
                traceId,
                details: { connectionId },
              },
            },
          }
        }

        // 2. Authorization.
        // ACCEPTED + REJECTED → only the followee can transition.
        // BLOCKED → either party can block.
        const isFollowee = conn.followeeId === session.userId
        const isFollower = conn.followerId === session.userId

        if (!isFollowee && !isFollower) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: "You are not a party to this connection",
                traceId,
              },
            },
          }
        }
        if (status === 'ACCEPTED' || status === 'REJECTED') {
          if (!isFollowee) {
            return {
              type: 'error' as const,
              status: 403,
              body: {
                error: {
                  code: 'AUTHORIZATION_DENIED',
                  message:
                    'Only the recipient of a friend request can accept or reject it',
                  traceId,
                  details: { code: 'NOT_FOLLOWEE' },
                },
              },
            }
          }
        }

        // 3. State machine validation.
        // ACCEPTED requires PENDING → ACCEPTED.
        // BLOCKED can be applied from any state.
        // REJECTED requires PENDING → REJECTED (only pending requests can be rejected).
        if (status === 'ACCEPTED' && conn.status !== 'PENDING') {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: `Cannot accept a connection with status '${conn.status}'`,
                traceId,
                details: { currentStatus: conn.status },
              },
            },
          }
        }
        if (status === 'REJECTED' && conn.status !== 'PENDING') {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: `Cannot reject a connection with status '${conn.status}'`,
                traceId,
                details: { currentStatus: conn.status },
              },
            },
          }
        }

        const now = new Date()

        // -----------------------------------------------------------------
        // REJECTED → delete the row (no future value; the follower can
        // re-request if they want).
        // -----------------------------------------------------------------
        if (status === 'REJECTED') {
          await tx.socialConnection.delete({ where: { id: connectionId } })
          // Also remove any reverse edge (defensive — shouldn't exist).
          await tx.socialConnection.deleteMany({
            where: {
              followerId: conn.followeeId,
              followeeId: conn.followerId,
            },
          })

          await tx.auditLog.create({
            data: {
              actorId: session.userId,
              actorRole: session.role,
              action: 'FRIEND_REQUEST_REJECTED',
              metadata: JSON.stringify({
                connectionId,
                followerId: conn.followerId,
                followeeId: conn.followeeId,
              }),
            },
          })

          return {
            type: 'success' as const,
            status: 200,
            body: {
              connectionId,
              status: 'REJECTED',
              deleted: true,
            },
          }
        }

        // -----------------------------------------------------------------
        // BLOCKED → set status='BLOCKED' on the existing row + any reverse
        // edge (so neither party can re-request without an explicit unblock).
        // -----------------------------------------------------------------
        if (status === 'BLOCKED') {
          await tx.socialConnection.update({
            where: { id: connectionId },
            data: { status: 'BLOCKED' },
          })
          // Flip the reverse edge to BLOCKED if it exists.
          await tx.socialConnection.updateMany({
            where: {
              followerId: conn.followeeId,
              followeeId: conn.followerId,
            },
            data: { status: 'BLOCKED' },
          })

          await tx.auditLog.create({
            data: {
              actorId: session.userId,
              actorRole: session.role,
              action: 'FRIEND_BLOCKED',
              metadata: JSON.stringify({
                connectionId,
                blockedBy: session.userId,
                followerId: conn.followerId,
                followeeId: conn.followeeId,
              }),
            },
          })

          return {
            type: 'success' as const,
            status: 200,
            body: {
              connectionId,
              status: 'BLOCKED',
              blockedBy: session.userId,
            },
          }
        }

        // -----------------------------------------------------------------
        // ACCEPTED → flip the existing row + create the reverse edge.
        // -----------------------------------------------------------------
        await tx.socialConnection.update({
          where: { id: connectionId },
          data: {
            status: 'ACCEPTED',
            acceptedAt: now,
          },
        })

        // Upsert the reverse edge (B→A, ACCEPTED). If a row already exists
        // (e.g., a prior REJECTED request from B → A), update it. Use
        // upsert to handle both cases idempotently.
        await tx.socialConnection.upsert({
          where: {
            followerId_followeeId: {
              followerId: conn.followeeId,
              followeeId: conn.followerId,
            },
          },
          create: {
            followerId: conn.followeeId,
            followeeId: conn.followerId,
            status: 'ACCEPTED',
            acceptedAt: now,
          },
          update: {
            status: 'ACCEPTED',
            acceptedAt: now,
          },
        })

        // Send a Notification to the follower: "X accepted your friend request!".
        // S3: deterministic dedupKey + UPPERCASE type + P2002 idempotent
        const followeeName = session.name ?? session.phone
        const dedupKey = `FRIEND_REQUEST_ACCEPTED:${connectionId}`
        try {
          await tx.notification.create({
            data: {
              userId: conn.followerId,
              type: 'FRIEND_REQUEST_ACCEPTED',
              title: 'Friend request accepted! 🎉',
              body: `${followeeName} accepted your friend request!`,
              data: JSON.stringify({
                connectionId,
                followeeId: session.userId,
                followeeName,
                followerId: conn.followerId,
              }),
              dedupKey,
            },
          })
        } catch (e: unknown) {
          if (e !== null && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
            // idempotent — notification already exists
          } else {
            throw e
          }
        }

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'FRIEND_REQUEST_ACCEPTED',
            metadata: JSON.stringify({
              connectionId,
              followerId: conn.followerId,
              followeeId: conn.followeeId,
              acceptedAt: now.toISOString(),
            }),
          },
        })

        return {
          type: 'success' as const,
          status: 200,
          body: {
            connectionId,
            status: 'ACCEPTED',
            acceptedAt: now.toISOString(),
          },
        }
      })

      switch (result.type) {
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'success': {
          logInfo(
            'social-connection-patched',
            {
              connectionId,
              status: result.body.status,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Connection update conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })

// ----------------------------------------
// DELETE /api/social/connections/[id]
// ----------------------------------------
// Body (optional): { block: true }
//
// Behavior:
//   - If body.block === true → set status='BLOCKED' on both rows (unfriend +
//     block). The opposite party cannot re-request without an explicit unblock.
//   - Otherwise → delete both rows (unfriend).
//
// Authorization:
//   - Either party (follower OR followee) can unfriend.
//   - Either party can block.
//
// Audit log:
//   - FRIEND_REMOVED (delete)
//   - FRIEND_BLOCKED (block)
//
// Response: 200 { connectionId, action: 'unfriended' | 'blocked' }
// ----------------------------------------------------------------------------

export const DELETE = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()
    const { id: connectionId } = await params

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

    // Parse body (optional)
    let body: { block?: unknown } = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as { block?: unknown }
      }
    } catch {
      // ignore — treated as no body
    }
    const block = body.block === true

    try {
      const result = await withTransaction(async (tx) => {
        const conn = await tx.socialConnection.findUnique({
          where: { id: connectionId },
        })
        if (!conn) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: 'Connection not found',
                traceId,
                details: { connectionId },
              },
            },
          }
        }

        const isFollower = conn.followerId === session.userId
        const isFollowee = conn.followeeId === session.userId
        if (!isFollower && !isFollowee) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'You are not a party to this connection',
                traceId,
              },
            },
          }
        }

        if (block) {
          // BLOCK: set status='BLOCKED' on both rows.
          await tx.socialConnection.update({
            where: { id: connectionId },
            data: { status: 'BLOCKED' },
          })
          await tx.socialConnection.updateMany({
            where: {
              followerId: conn.followeeId,
              followeeId: conn.followerId,
            },
            data: { status: 'BLOCKED' },
          })

          await tx.auditLog.create({
            data: {
              actorId: session.userId,
              actorRole: session.role,
              action: 'FRIEND_BLOCKED',
              metadata: JSON.stringify({
                connectionId,
                blockedBy: session.userId,
                followerId: conn.followerId,
                followeeId: conn.followeeId,
              }),
            },
          })

          return {
            type: 'success' as const,
            status: 200,
            body: {
              connectionId,
              action: 'blocked' as const,
              blockedBy: session.userId,
            },
          }
        }

        // UNFRIEND: delete both rows.
        await tx.socialConnection.delete({ where: { id: connectionId } })
        // Defensive: also delete the reverse edge if it exists (it should for
        // ACCEPTED friendships; PENDING/REJECTED don't have a reverse edge).
        await tx.socialConnection.deleteMany({
          where: {
            followerId: conn.followeeId,
            followeeId: conn.followerId,
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'FRIEND_REMOVED',
            metadata: JSON.stringify({
              connectionId,
              removedBy: session.userId,
              followerId: conn.followerId,
              followeeId: conn.followeeId,
            }),
          },
        })

        return {
          type: 'success' as const,
          status: 200,
          body: {
            connectionId,
            action: 'unfriended' as const,
            removedBy: session.userId,
          },
        }
      })

      switch (result.type) {
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'success': {
          logInfo(
            'social-connection-deleted',
            {
              connectionId,
              action: result.body.action,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof TransactionConflictError) {
        return apiError(
          'CONFLICT',
          'Connection removal conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
