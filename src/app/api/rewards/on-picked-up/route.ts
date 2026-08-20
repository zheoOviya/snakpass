import { NextRequest, NextResponse } from 'next/server'
import { withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import {
  issueReward,
  type RewardTx,
  type RewardLedgerEntryRow,
  type RewardAccountRow,
} from '@/lib/rewards-engine'
import {
  REWARD_RULES,
  computeOrderPoints,
  type RewardRuleKey,
} from '@/lib/reward-rules'
import { recordActivity } from '@/lib/social-activity'

// ----------------------------------------------------------------------------
// Wave 5 Task 5A — POST /api/rewards/on-picked-up
// ----------------------------------------------------------------------------
// Additive reward-issuance endpoint. Called by the VENDOR VIEW frontend
// (vendor-view.tsx `advance()`) AFTER a successful PATCH /api/orders/[id]/fulfilment
// transition to PICKED_UP. The vendor triggers it; the consumer earns points.
//
// GOVERNANCE (plan §5A — Decision #2):
//   This endpoint is ENTIRELY ADDITIVE — it does NOT modify the fulfilment
//   state machine, the fulfilment route, the event-consumer, or the webhook
//   processor. Reward issuance is triggered by a NEW endpoint called by the
//   frontend (vendor-view) after the existing PATCH /fulfilment succeeds.
//
// Idempotency:
//   1. INHERENT — the per-rule RewardLedgerEntry.idempotencyKey is constructed
//      as `ORDER_PICKED_UP:${orderId}:${ruleKey}`. The unique constraint on
//      idempotencyKey prevents duplicate issuance on retry (the second call's
//      `issueReward` finds the existing entry and returns it deduplicated).
//   2. P0-17 EXPLICIT — `Idempotency-Key` header honored; same key on retry
//      returns the cached response (resourceType='RewardOnPickedUp').
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN (the vendor triggers
//       it after marking picked up). CONSUMER → 403 (consumers cannot self-trigger).
//
// Body: { orderId: string }
//
// Side effects (inside withTransaction):
//   - Load Order (must be status PICKED_UP — if not, 400 ORDER_NOT_PICKED_UP).
//   - INHERENT idempotency: if any RewardLedgerEntry exists with
//     `idempotencyKey` LIKE 'ORDER_PICKED_UP:${orderId}:%' → return 200 with
//     alreadyIssued: true + existing ledger entries.
//   - Compute EARN_BASE points: Math.floor(totalAmount / 1000) (1 pt per ₹10).
//   - Compute bonus rules (FIRST_ORDER, SECOND_ORDER, OFF_PEAK):
//       FIRST_ORDER: this is the user's 1st PICKED_UP order → +50 pts
//       SECOND_ORDER: this is the user's 2nd PICKED_UP order → +25 pts
//       OFF_PEAK: order.createdAt hour ∈ {14..17, 21..23} → +10 pts
//   - For each applicable rule: best-effort lookup RewardRule by key (UPPERCASE
//     catalog keys — seed may have lowercase keys; ruleId left null when not
//     found since RewardLedgerEntry.ruleId is nullable per Task 1A schema).
//     Then call issueReward(tx, { userId, ruleKey, orderId, points,
//     idempotencyKey: `ORDER_PICKED_UP:${orderId}:${ruleKey}`, ruleId }).
//   - Create Notification for the consumer: "You earned X reward points! 🎉".
//   - Audit log: action='REWARD_EARNED', metadata={ orderId, totalPointsIssued,
//     rules: [...] }.
//
// Response: 200 { issued: true, entries: [...], newBalance, alreadyIssued? }
// Errors: 400 (ORDER_NOT_PICKED_UP / VALIDATION_ERROR) /
//         401 (no session) / 403 (RBAC) / 404 (order not found) /
//         409 (transaction conflict) / 422 (Idempotency-Key reuse).
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'RewardOnPickedUp'

/** Idempotency-key prefix used for all per-rule issuance on this order. */
function orderKeyPrefix(orderId: string): string {
  return `ORDER_PICKED_UP:${orderId}:`
}

/** Construct the per-rule idempotency key. */
function ruleIdempotencyKey(orderId: string, ruleKey: string): string {
  return `${orderKeyPrefix(orderId)}${ruleKey}`
}

/**
 * Compute the OFF_PEAK bonus eligibility.
 *
 * Off-peak windows (IST):
 *   - 14:00–17:59 (afternoon lull — 2-5 PM)
 *   - 21:00–23:59 (late-night — 9-11 PM)
 *
 * We use the order's `createdAt` (UTC Date) converted to IST for the hour
 * check (IST = UTC+5:30).
 */
function isOffPeak(createdAt: Date): boolean {
  // IST = UTC + 5:30 → IST hour = (UTC hour + 5 + (UTC minute >= 30 ? 1 : 0)) % 24
  // For the hour-only check, the minute offset doesn't matter much (a few
  // edge minutes around 17:30/23:30 — acceptable MVP precision).
  const istMs = createdAt.getTime() + 5 * 60 * 60 * 1000 + 30 * 60 * 1000
  const istHour = new Date(istMs).getUTCHours()
  return (istHour >= 14 && istHour <= 17) || (istHour >= 21 && istHour <= 23)
}

export const POST = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401, undefined, traceId)
    }

    // -------------------------------------------------------------------------
    // RBAC — CONSUMER is forbidden (consumers cannot self-trigger reward
    // issuance; the vendor triggers it after marking picked up).
    // -------------------------------------------------------------------------
    const allowedRoles = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']
    if (!allowedRoles.includes(session.role)) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only vendor staff or admins can trigger reward issuance',
        403,
        { requiredRoles: allowedRoles, actualRole: session.role },
        traceId,
      )
    }

    // -------------------------------------------------------------------------
    // Parse body — { orderId: string }
    // -------------------------------------------------------------------------
    let body: { orderId?: unknown } = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as { orderId?: unknown }
      }
    } catch {
      // ignore — treated as empty body → fails validation below
    }
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) {
      return apiError(
        'VALIDATION_ERROR',
        'orderId is required',
        400,
        { field: 'orderId' },
        traceId,
      )
    }

    // -------------------------------------------------------------------------
    // Idempotency-Key header (optional). The inherent idempotency via the
    // ledger-entry idempotencyKey is sufficient for safety, but the explicit
    // header allows the gateway / client to dedup at the HTTP layer too.
    // -------------------------------------------------------------------------
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        const rtx = tx as unknown as RewardTx

        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST (inside txn).
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'rewards-on-picked-up-idempotency-dedup-hit',
              { key: idempotencyKey, orderId },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Load the Order — must exist + be PICKED_UP.
        // -------------------------------------------------------------------
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            userId: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            restaurantId: true,
          },
        })
        if (!order) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: { code: 'NOT_FOUND', message: 'Order not found', traceId },
            },
          }
        }
        if (order.status !== 'PICKED_UP') {
          return {
            type: 'error' as const,
            status: 400,
            body: {
              error: {
                code: 'ORDER_NOT_PICKED_UP',
                message: `Order status is ${order.status}, must be PICKED_UP`,
                traceId,
                details: { orderId, currentStatus: order.status },
              },
            },
          }
        }

        // -------------------------------------------------------------------
        // INHERENT IDEMPOTENCY — if any ledger entry already exists for this
        // order (key prefix match), return the existing entries + balance.
        // -------------------------------------------------------------------
        const prefix = orderKeyPrefix(orderId)
        const existingEntries = (await tx.rewardLedgerEntry.findMany({
          where: { idempotencyKey: { startsWith: prefix } },
          orderBy: { createdAt: 'asc' },
        })) as RewardLedgerEntryRow[]

        if (existingEntries.length > 0) {
          const account = (await rtx.rewardAccount.findUnique({
            where: { userId: order.userId },
          })) as RewardAccountRow | null
          const idempotentBody = {
            issued: true,
            alreadyIssued: true,
            orderId,
            entries: existingEntries.map((e) => ({
              id: e.id,
              type: e.type,
              points: e.points,
              ruleId: e.ruleId,
              idempotencyKey: e.idempotencyKey,
              createdAt: e.createdAt.toISOString(),
            })),
            totalPointsIssued: existingEntries
              .filter((e) => e.type === 'EARN')
              .reduce((sum, e) => sum + e.points, 0),
            newBalance: account?.balance ?? 0,
          }
          if (idempotencyKey) {
            await storeIdempotencyRecord(
              tx,
              idempotencyKey,
              IDEMPOTENCY_RESOURCE_TYPE,
              orderId,
              200,
              JSON.stringify(idempotentBody),
              requestHash,
            )
          }
          logInfo(
            'rewards-on-picked-up-already-issued',
            { orderId, entries: existingEntries.length },
            traceId,
          )
          return { type: 'ok' as const, status: 200, body: idempotentBody }
        }

        // -------------------------------------------------------------------
        // Compute which rules apply + their points.
        // -------------------------------------------------------------------
        const basePoints = computeOrderPoints(order.totalAmount, 'EARN_BASE')

        // Count PICKED_UP orders for this user (BEFORE the current one would
        // be counted as "issued" — since the ledger entries don't exist yet,
        // we count by Order.status). The current order IS already PICKED_UP
        // (we just verified above), so the count includes it.
        const pickedUpCount = await tx.order.count({
          where: { userId: order.userId, status: 'PICKED_UP' },
        })

        const applicableRules: Array<{ key: RewardRuleKey; points: number }> = []

        if (basePoints > 0) {
          applicableRules.push({ key: 'EARN_BASE', points: basePoints })
        }
        if (pickedUpCount === 1) {
          applicableRules.push({ key: 'FIRST_ORDER', points: REWARD_RULES.FIRST_ORDER.pointsFormula.points ?? 50 })
        } else if (pickedUpCount === 2) {
          applicableRules.push({ key: 'SECOND_ORDER', points: REWARD_RULES.SECOND_ORDER.pointsFormula.points ?? 25 })
        }
        if (isOffPeak(order.createdAt)) {
          applicableRules.push({ key: 'OFF_PEAK', points: REWARD_RULES.OFF_PEAK.pointsFormula.points ?? 10 })
        }

        // -------------------------------------------------------------------
        // Best-effort lookup RewardRule rows by UPPERCASE catalog key.
        // The dev seed uses lowercase keys (first_order, off_peak_order, etc.)
        // — these won't match, so ruleId stays null (the RewardLedgerEntry
        // column is nullable per Task 1A schema). When the seed is updated
        // to mirror the catalog, ruleId will be populated automatically.
        // -------------------------------------------------------------------
        const ruleKeyToId = new Map<string, string>()
        if (applicableRules.length > 0) {
          const keys = applicableRules.map((r) => r.key)
          const ruleRows = await tx.rewardRule.findMany({
            where: { key: { in: keys } },
            select: { id: true, key: true },
          })
          for (const r of ruleRows) {
            ruleKeyToId.set(r.key, r.id)
          }
        }

        // -------------------------------------------------------------------
        // Issue each applicable rule's points via issueReward (idempotent).
        // -------------------------------------------------------------------
        const issuedEntries: RewardLedgerEntryRow[] = []
        let totalPointsIssued = 0
        let lastBalance = 0
        for (const rule of applicableRules) {
          const result = await issueReward(rtx, {
            userId: order.userId,
            ruleKey: rule.key,
            points: rule.points,
            orderId,
            idempotencyKey: ruleIdempotencyKey(orderId, rule.key),
            ruleId: ruleKeyToId.get(rule.key),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 365-day expiry (MVP)
          })
          issuedEntries.push(result.ledgerEntry)
          if (!result.deduplicated) {
            totalPointsIssued += rule.points
          }
          lastBalance = result.newBalance
        }

        // -------------------------------------------------------------------
        // If no rules applied (e.g., a zero-amount order), still upsert the
        // account so the consumer has a row to read via GET /account.
        // -------------------------------------------------------------------
        if (issuedEntries.length === 0) {
          await rtx.rewardAccount.upsert({
            where: { userId: order.userId },
            create: {
              userId: order.userId,
              balance: 0,
              lifetimeEarned: 0,
              lifetimeRedeemed: 0,
            },
            update: {},
          })
          const acct = (await rtx.rewardAccount.findUnique({
            where: { userId: order.userId },
          })) as RewardAccountRow | null
          lastBalance = acct?.balance ?? 0
        }

        // -------------------------------------------------------------------
        // Notification for the consumer.
        // -------------------------------------------------------------------
        if (totalPointsIssued > 0) {
          await tx.notification.create({
            data: {
              userId: order.userId,
              type: 'REWARD_EARNED',
              title: `You earned ${totalPointsIssued} reward points! 🎉`,
              body: `Your order from ${order.restaurantId} just unlocked reward points. Tap to view your balance.`,
              data: JSON.stringify({
                orderId,
                totalPointsIssued,
                rules: applicableRules.map((r) => ({
                  key: r.key,
                  points: r.points,
                })),
                newBalance: lastBalance,
              }),
            },
          })
        }

        // -------------------------------------------------------------------
        // Audit log — REWARD_EARNED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'REWARD_EARNED',
            metadata: JSON.stringify({
              orderId,
              consumerUserId: order.userId,
              totalPointsIssued,
              rules: applicableRules.map((r) => ({
                key: r.key,
                points: r.points,
              })),
              pickedUpCount,
              orderAmountPaise: order.totalAmount,
              newBalance: lastBalance,
            }),
          },
        })

        // -------------------------------------------------------------------
        // Wave 6 Task 6A — ADDITIVE: record an EARNED_REWARD social activity.
        // (Governance: STRICTLY ADDITIVE — preserves all existing reward
        // logic above. Only fires when totalPointsIssued > 0, to avoid
        // spamming the feed with zero-point entries.)
        //
        // CRITICAL: The metadata includes the EARNED points (not payment
        // amount — that's reward points, not money). The activity feed
        // sanitization (sanitizeActivityMetadata) allows `points` but strips
        // monetary keys (`amount`, `totalAmount`, `price`, etc.). Defense-in-
        // depth: we never include `orderAmountPaise` in the activity metadata.
        // -------------------------------------------------------------------
        if (totalPointsIssued > 0) {
          await recordActivity(tx, {
            actorId: order.userId,
            verb: 'EARNED_REWARD',
            objectType: 'Order',
            objectId: orderId,
            metadata: {
              points: totalPointsIssued,
              rules: applicableRules.map((r) => ({
                key: r.key,
                points: r.points,
              })),
              // Intentionally NO `orderAmount` / `totalAmount` / `price` keys.
              // Reward points are not money.
              newBalance: lastBalance,
            },
            visibility: 'FRIENDS',
            // Idempotency: same key as the reward issuance — so a retry that
            // finds the existing reward ledger entries ALSO finds the existing
            // activity (no duplicate feed posts).
            idempotencyKey: `ORDER_PICKED_UP:${orderId}:EARNED_REWARD`,
          })
        }

        const responseBody = {
          issued: true,
          alreadyIssued: false,
          orderId,
          entries: issuedEntries.map((e) => ({
            id: e.id,
            type: e.type,
            points: e.points,
            ruleId: e.ruleId,
            idempotencyKey: e.idempotencyKey,
            createdAt: e.createdAt.toISOString(),
          })),
          totalPointsIssued,
          newBalance: lastBalance,
        }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            orderId,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
        }

        return { type: 'success' as const, status: 200, body: responseBody }
      })

      // Handle result variants — switch for exhaustiveness.
      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'ok':
        case 'success': {
          logInfo(
            'rewards-on-picked-up-success',
            {
              orderId,
              alreadyIssued: result.body.alreadyIssued === true,
              totalPointsIssued: result.body.totalPointsIssued ?? 0,
            },
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
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'rewards-on-picked-up-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        logInfo(
          'rewards-on-picked-up-conflict',
          { attempts: error.attempts, code: error.code, orderId },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Reward issuance conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
