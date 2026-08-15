import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { enqueueOutboxEvent } from '@/lib/outbox'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// POST /api/test/rollback-injection
//
// P0-24 Sub-Wave 2a — Rollback failure-injection test endpoint.
//
// This endpoint deliberately FAILS inside a transaction AFTER the business
// mutation + outbox INSERT, to prove that BOTH roll back atomically.
//
// Sequence:
//   1. Start transaction
//   2. Create order (business mutation)
//   3. Write outbox event (ORDER_CREATED)
//   4. Throw error (deliberate failure)
//   5. Transaction rolls back → NO order, NO outbox row
//
// The test workflow then verifies via Supabase Management API that:
//   - The order does NOT exist in the Order table
//   - The outbox row does NOT exist in the Outbox table
//
// This is a TEST endpoint — it should be removed or disabled in production.
// It's guarded by NODE_ENV !== 'production' to prevent production access.

export const POST = (req: NextRequest) => withErrorHandler(async () => {
  // Guard: prevent production access
  // Vercel sets VERCEL_ENV=production for production deployments and
  // VERCEL_ENV=preview for preview deployments. We allow this endpoint
  // on preview (staging) but NOT on production.
  // Also allow in development (local).
  const vercelEnv = process.env.VERCEL_ENV ?? 'development'
  if (vercelEnv === 'production') {
    return apiError('FORBIDDEN', 'Test endpoint not available in production', 403)
  }

  const traceId = newTraceId()
  const session = await getSessionUser()
  if (!session) {
    return apiError('AUTHENTICATION_REQUIRED', 'Authentication required', 401)
  }

  // Generate a unique marker for this test run — used to verify rollback
  const testMarker = `rollback-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const restaurantId = 'rest-001' // exists in seed data
  const menuItemId = 'menu-003' // exists in seed data

  let injectedOrderId: string | null = null

  try {
    await withTransaction(async (tx) => {
      // Step 1: Business mutation — create an order with the test marker
      const order = await tx.order.create({
        data: {
          userId: session.userId,
          restaurantId,
          status: 'CONFIRMED',
          totalAmount: 6000,
          pickupOtp: '000000',
          isCatering: false,
          itemsCount: 1,
          note: testMarker, // unique marker for verification
          statusHistory: JSON.stringify([{ status: 'CONFIRMED', at: new Date().toISOString() }]),
          orderItems: {
            create: [{
              menuItemId,
              name: 'Rollback Test Item',
              price: 6000,
              quantity: 1,
              subtotal: 6000,
            }],
          },
        },
        include: { orderItems: true },
      })

      injectedOrderId = order.id

      // Step 2: Outbox INSERT (inside same transaction)
      await enqueueOutboxEvent(tx, {
        eventType: 'ORDER_CREATED',
        aggregateType: 'Order',
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          testMarker, // unique marker for verification
          status: order.status,
        },
      })

      // Step 3: DELIBERATE FAILURE — throw error AFTER both writes
      // This forces the transaction to roll back.
      // If P0-24's transactional integrity is correct, BOTH the order AND
      // the outbox row will be rolled back (neither will exist after this).
      throw new Error('DELIBERATE_ROLLBACK_INJECTION_TEST_FAILURE')
    })
  } catch (error) {
    // Expected: the deliberate failure should cause TransactionConflictError or the raw Error
    const errorMsg = (error as Error).message

    if (errorMsg.includes('DELIBERATE_ROLLBACK_INJECTION_TEST_FAILURE')) {
      // This is the expected failure — the transaction should have rolled back.
      // Return the test marker + orderId so the evidence workflow can verify
      // that neither exists in the DB.
      return NextResponse.json({
        ok: true,
        test: 'rollback-injection',
        description: 'Deliberate failure injected AFTER order.create + outbox INSERT. Transaction should have rolled back both.',
        testMarker,
        injectedOrderId,
        expected: 'Order does NOT exist + Outbox row does NOT exist (both rolled back)',
        traceId,
      })
    }

    // Unexpected error
    return apiError('INTERNAL_ERROR', `Unexpected error: ${errorMsg}`, 500, undefined, traceId)
  }

  // If we reach here, the transaction committed (shouldn't happen because we throw above)
  return apiError('INTERNAL_ERROR', 'Rollback injection did not fire — unexpected success', 500, undefined, traceId)
})
