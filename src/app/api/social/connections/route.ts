import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId, info as logInfo } from '@/lib/logger'
import { avatarColorForUserId } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 6 Task 6A — /api/social/connections
// ----------------------------------------------------------------------------
// GET  — list the current user's connections (accepted friends + pending
//        requests in both directions).
// POST — send a friend request (creates a PENDING SocialConnection from the
//        current user → the target followee).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role. (Vendors + admins can have friends too —
//       social graph is not gated by role.)
//
// Schema (Task 1A — prisma/schema.prisma):
//   model SocialConnection {
//     id, followerId, followeeId, status (PENDING|ACCEPTED|REJECTED|BLOCKED),
//     requestedAt, acceptedAt, message, createdAt, updatedAt
//     @@unique([followerId, followeeId])
//   }
//
// Bidirectional friendship = 2 rows per mutual friendship (A→B + B→A).
// (Per plan Decision #7 — stored as 2 rows for clean queries.)
//
// Errors: 400 (validation) / 401 (no session) / 409 (conflict) / 500 (internal).
// ----------------------------------------------------------------------------

// ----------------------------------------
// GET /api/social/connections
// ----------------------------------------
// Returns the current user's connections:
//   - ACCEPTED friends (status='ACCEPTED' in either direction — both rows
//     exist for mutual friendships, so we deduplicate by user).
//   - Pending requests SENT by the user (followerId=self, status='PENDING').
//   - Pending requests RECEIVED by the user (followeeId=self, status='PENDING').
//
// Response shape (per task spec):
//   { connections: [{ id, userId, name, phone, avatarColor, status,
//                     createdAt, direction?, message?, acceptedAt? }] }
//
// `userId` is the OTHER user's id (the friend or request peer). `status` is
// 'ACCEPTED' for friends, 'PENDING_SENT' / 'PENDING_RECEIVED' for pending.
// ----------------------------------------------------------------------------

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

    // Load all SocialConnection rows where the current user is either the
    // follower OR the followee. Single round-trip, then we partition client-side.
    const rows = await db.socialConnection.findMany({
      where: {
        OR: [{ followerId: session.userId }, { followeeId: session.userId }],
      },
      orderBy: { createdAt: 'desc' },
    })

    // Collect the OTHER user's id for each row → fetch their profile in one batch.
    const peerIds = Array.from(
      new Set(
        rows.map((r) => (r.followerId === session.userId ? r.followeeId : r.followerId)),
      ),
    )

    const peerUsers = peerIds.length
      ? await db.user.findMany({
          where: { id: { in: peerIds } },
          select: { id: true, name: true, phone: true },
        })
      : []

    const peerMap = new Map(peerUsers.map((u) => [u.id, u]))

    const connections = rows.map((r) => {
      const isFollower = r.followerId === session.userId
      const peerId = isFollower ? r.followeeId : r.followerId
      const peer = peerMap.get(peerId)

      // Status normalization for the client:
      //   ACCEPTED  → 'ACCEPTED'
      //   PENDING   → 'PENDING_SENT' (I sent it) | 'PENDING_RECEIVED' (they sent it)
      //   REJECTED  → 'REJECTED' (only relevant for sent requests)
      //   BLOCKED   → 'BLOCKED'
      let displayStatus = r.status
      if (r.status === 'PENDING') {
        displayStatus = isFollower ? 'PENDING_SENT' : 'PENDING_RECEIVED'
      }

      return {
        id: r.id,
        userId: peerId,
        name: peer?.name ?? 'Unknown',
        phone: peer?.phone ?? '',
        avatarColor: avatarColorForUserId(peerId),
        status: displayStatus,
        direction: isFollower ? 'sent' : 'received',
        message: r.message ?? null,
        createdAt: r.createdAt.toISOString(),
        acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
        // S4B Privacy/Abuse Repair-03 (P2): Replace raw `blockedBy` userId with
        // a server-derived `canUnblock` boolean. This preserves the S4A UI
        // reachability repair (blocker sees Unblock button) WITHOUT disclosing
        // the blocker's raw userId to the blocked party.
        //
        // canUnblock = true ONLY when:
        //   - row.status === 'BLOCKED'
        //   - row.blockedBy === session.userId (current user is the blocker)
        //
        // Legacy NULL blockedBy → canUnblock = false (fail-closed).
        // The raw `blockedBy` field is NO LONGER exposed in the external API.
        // Backend S4A PATCH/DELETE authorization remains unchanged.
        canUnblock:
          r.status === 'BLOCKED' && r.blockedBy === session.userId,
      }
    })

    return NextResponse.json({ connections })
  })

// ----------------------------------------
// POST /api/social/connections
// ----------------------------------------
// Body: { followeeId: string, message?: string }
//
// Backward-compat alias: { targetUserId, message? } (existing social-store.ts
// in Wave 1C uses `targetUserId`; both shapes are accepted — `followeeId`
// takes precedence when both are present).
//
// Validates:
//   - followeeId is a non-empty string
//   - can't friend yourself (followerId === followeeId → 400 SELF_FRIEND)
//   - target user must exist (404 if not)
//   - can't duplicate an existing connection (PENDING/ACCEPTED/REJECTED/BLOCKED
//     already exists in either direction → 409 with details)
//   - if there's a BLOCKED connection initiated by the target → 403 REFUSED
//     (they explicitly blocked you)
//
// Side effects (inside withTransaction):
//   - Creates a PENDING SocialConnection (followerId=session.userId,
//     followeeId=body.followeeId).
//   - Sends a Notification to the followee:
//       type: 'friend_request'
//       title: 'New friend request'
//       body: '{name} wants to be your friend'
//       data: { connectionId, followerId, followerName, message? }
//   - Audit log: action='FRIEND_REQUEST_SENT', metadata={ connectionId,
//     followeeId, message? }.
//
// Response: 201 { connection: { id, userId, name, phone, avatarColor, status,
//                              createdAt } }
// ----------------------------------------------------------------------------

export const POST = (req: NextRequest) =>
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

    // Parse body
    let body: {
      followeeId?: unknown
      targetUserId?: unknown
      message?: unknown
    } = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as typeof body
      }
    } catch {
      // ignore — empty body fails validation below
    }

    const followeeId =
      typeof body.followeeId === 'string'
        ? body.followeeId.trim()
        : typeof body.targetUserId === 'string'
          ? body.targetUserId.trim()
          : ''

    if (!followeeId) {
      return apiError(
        'VALIDATION_ERROR',
        'followeeId is required',
        400,
        { field: 'followeeId' },
        traceId,
      ) as unknown as NextResponse
    }

    if (followeeId === session.userId) {
      return apiError(
        'VALIDATION_ERROR',
        "You can't send a friend request to yourself",
        400,
        { code: 'SELF_FRIEND' },
        traceId,
      ) as unknown as NextResponse
    }

    const message =
      typeof body.message === 'string' && body.message.trim().length > 0
        ? body.message.trim().slice(0, 280) // cap message length
        : null

    try {
      const result = await withTransaction(async (tx) => {
        // 1. Verify the target user exists.
        const followee = await tx.user.findUnique({
          where: { id: followeeId },
          select: { id: true, name: true, phone: true },
        })
        if (!followee) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: 'User not found',
                traceId,
                details: { followeeId },
              },
            },
          }
        }

        // 2. Check for existing connections in EITHER direction (findMany, not findFirst).
        // S4A Fix S-01: inspect ALL pair rows — any BLOCKED row blocks reconnection.
        const existingRows = await tx.socialConnection.findMany({
          where: {
            OR: [
              { followerId: session.userId, followeeId },
              { followerId: followeeId, followeeId: session.userId },
            ],
          },
        })

        // S4A: If ANY row is BLOCKED (in either direction), reject.
        // This prevents the bypass where findFirst returned an arbitrary row.
        const blockedRow = existingRows.find((r) => r.status === 'BLOCKED')
        if (blockedRow) {
          return {
            type: 'error' as const,
            status: 403,
            body: {
              error: {
                code: 'AUTHORIZATION_DENIED',
                message: 'This user is not available for friend requests',
                traceId,
              },
            },
          }
        }

        // If there's already a PENDING/ACCEPTED connection → conflict.
        const pendingOrAccepted = existingRows.find(
          (r) => r.status === 'PENDING' || r.status === 'ACCEPTED',
        )
        if (pendingOrAccepted) {
          return {
            type: 'error' as const,
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: `Connection already exists with status '${pendingOrAccepted.status}'`,
                traceId,
                details: {
                  existingStatus: pendingOrAccepted.status,
                  existingConnectionId: pendingOrAccepted.id,
                },
              },
            },
          }
        }
        // For REJECTED rows → allow re-request by deleting the old row first.
        for (const r of existingRows) {
          if (r.status === 'REJECTED') {
            await tx.socialConnection.delete({ where: { id: r.id } })
          }
        }

        // 3. Create the PENDING connection (current user → target).
        const connection = await tx.socialConnection.create({
          data: {
            followerId: session.userId,
            followeeId,
            status: 'PENDING',
            message,
          },
        })

        // 4. Send a Notification to the followee.
        // S3: deterministic dedupKey + UPPERCASE type + P2002 idempotent
        const followerName = session.name ?? session.phone
        const dedupKey = `FRIEND_REQUEST_RECEIVED:${connection.id}`
        try {
          await tx.notification.create({
            data: {
              userId: followeeId,
              type: 'FRIEND_REQUEST_RECEIVED',
              title: 'New friend request',
              body: `${followerName} wants to be your friend`,
              data: JSON.stringify({
                connectionId: connection.id,
                followerId: session.userId,
                followerName,
                message,
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

        // 5. Audit log.
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'FRIEND_REQUEST_SENT',
            metadata: JSON.stringify({
              connectionId: connection.id,
              followerId: session.userId,
              followeeId,
              message,
            }),
          },
        })

        return {
          type: 'success' as const,
          status: 201,
          body: {
            connection: {
              id: connection.id,
              userId: followeeId,
              name: followee.name ?? 'Unknown',
              phone: followee.phone,
              avatarColor: avatarColorForUserId(followeeId),
              status: 'PENDING_SENT',
              message,
              createdAt: connection.createdAt.toISOString(),
            },
          },
        }
      })

      switch (result.type) {
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'success': {
          logInfo(
            'social-friend-request-sent',
            {
              followeeId,
              connectionId: result.body.connection.id,
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
          'Friend request conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
