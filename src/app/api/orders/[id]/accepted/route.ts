import { NextRequest, NextResponse } from 'next/server'
import { withTransaction } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 3 Task 3C — GET /api/orders/[id]/accepted
// ----------------------------------------------------------------------------
// Returns the vendor-accept timestamp for an order — the additive nullable
// column `Fulfilment.acceptedAt` (added by Task 1A).
//
// WHY THIS ENDPOINT EXISTS (governance note):
//   The P0-06 GET /api/orders/[id]/fulfilment endpoint predates Task 1A's
//   `acceptedAt` column and does NOT include it in its response. Modifying
//   that protected route would violate the P0-06 boundary. Instead, this
//   small ADDITIVE endpoint exposes ONLY the acceptedAt timestamp — enough
//   for the consumer's order-tracking timeline to render the new
//   "Restaurant Accepted" step. No other state is exposed (no Fulfilment
//   status, no pickup attribution fields).
//
// Auth: getSessionUser() required (401 if no session). NO strict ownership
// check — acceptedAt is a non-sensitive informational timestamp. Mirrors
// the GET /fulfilment endpoint's auth-only-no-ownership pattern.
//
// Lazy-create: if no Fulfilment row exists for the Order, one is created
// with status='PREPARING' + pickupOtp copied from Order.pickupOtp (mirrors
// the /fulfilment GET lazy-create pattern).
//
// Response: 200 { orderId, acceptedAt: string | null, fulfilmentId, accepted: boolean }
//   - acceptedAt: ISO date string when the vendor accepted, or null
//   - accepted: convenience boolean (true iff acceptedAt !== null)
// Errors: 401 (no session) / 404 (order not found)
// ----------------------------------------------------------------------------

export const GET = (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withErrorHandler(async () => {
    const { id: orderId } = await params
    const traceId = newTraceId()

    const session = await getSessionUser()
    if (!session) {
      // Cast to NextResponse<unknown> so the success-path return type unifies
      // (apiError returns NextResponse<ApiError>; without the cast, TS can't
      // infer a single T for withErrorHandler<T>). Matches the pattern in
      // src/app/api/orders/route.ts which uses NextResponse.json directly.
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    const result = await withTransaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, pickupOtp: true },
      })
      if (!order) return null

      // Lazy-create if missing (mirrors /fulfilment GET pattern — needed so
      // the POST /accept endpoint's updateMany WHERE clause always finds a
      // row to update, even if it's the very first call).
      let f = await tx.fulfilment.findUnique({ where: { orderId } })
      if (!f) {
        f = await tx.fulfilment.create({
          data: {
            orderId,
            status: 'PREPARING',
            pickupOtp: order.pickupOtp,
          },
        })
        logInfo('accepted-get-fulfilment-lazy-created', { orderId, fulfilmentId: f.id }, traceId)
      }
      return f
    })

    if (!result) {
      return apiError('NOT_FOUND', 'Order not found', 404, undefined, traceId) as unknown as NextResponse
    }

    const acceptedAtIso = result.acceptedAt?.toISOString() ?? null
    return NextResponse.json({
      orderId,
      fulfilmentId: result.id,
      acceptedAt: acceptedAtIso,
      accepted: acceptedAtIso !== null,
    })
  })
