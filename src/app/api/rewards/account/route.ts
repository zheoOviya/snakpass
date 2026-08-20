import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 5 Task 5A — GET /api/rewards/account
// ----------------------------------------------------------------------------
// Returns the current user's RewardAccount (balance + lifetime totals).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: any authenticated role (CONSUMER + VENDOR_OWNER + VENDOR_STAFF +
//       ADMIN + SUPER_ADMIN). A vendor viewing their consumer-side account
//       is fine — the account belongs to the user, not to a vendor identity.
//
// Response shape:
//   - Account exists: 200 { account: { userId, balance, lifetimeEarned,
//     lifetimeRedeemed, tier, updatedAt } }
//   - Account missing (user has never earned points): 200 { account: null }
//
// Tier computation (based on lifetimeEarned, not current balance — tiers are
// a status indicator, not a spendable resource):
//   - Bronze    < 500
//   - Silver    500..1999
//   - Gold      2000..4999
//   - Platinum  >= 5000
//
// Errors: 401 (no session) / 500 (internal).
// ----------------------------------------------------------------------------

function tierFor(lifetimeEarned: number): 'Bronze' | 'Silver' | 'Gold' | 'Platinum' {
  if (lifetimeEarned >= 5000) return 'Platinum'
  if (lifetimeEarned >= 2000) return 'Gold'
  if (lifetimeEarned >= 500) return 'Silver'
  return 'Bronze'
}

export const GET = () =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      // Cast to NextResponse<unknown> so the success-path return type unifies
      // (apiError returns NextResponse<ApiError>; without the cast, TS can't
      // infer a single T for withErrorHandler<T>). Same pattern as
      // src/app/api/orders/[id]/accepted/route.ts.
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Read the user's RewardAccount (1:1 by userId, unique constraint).
    // -------------------------------------------------------------------------
    const account = await db.rewardAccount.findUnique({
      where: { userId: session.userId },
      select: {
        id: true,
        userId: true,
        balance: true,
        lifetimeEarned: true,
        lifetimeRedeemed: true,
        updatedAt: true,
      },
    })

    if (!account) {
      // No account yet — the user has never earned any points. Return
      // account: null so the client can render the empty state ("Place your
      // first order to start earning!").
      return NextResponse.json({ account: null })
    }

    return NextResponse.json({
      account: {
        userId: account.userId,
        balance: account.balance,
        lifetimeEarned: account.lifetimeEarned,
        lifetimeRedeemed: account.lifetimeRedeemed,
        tier: tierFor(account.lifetimeEarned),
        updatedAt: account.updatedAt.toISOString(),
      },
    })
  })
