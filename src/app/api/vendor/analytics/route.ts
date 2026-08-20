import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'

// ----------------------------------------------------------------------------
// Wave 4 Task 4C — GET /api/vendor/analytics
// ----------------------------------------------------------------------------
// Restaurant-scoped vendor analytics for the Vendor Analytics Widget (top of
// the vendor Orders tab). Returns today's metrics for ONE restaurant:
//   - todayOrders         (count of orders created today)
//   - todayRevenue        (sum of totalAmount in paise)
//   - avgPrepTimeMins     (restaurant.prepTimeMins — simplified per task spec;
//                          per-order actual prep time is future scope)
//   - ordersWaiting       (active orders, status NOT in [PICKED_UP, CANCELLED])
//   - lowStockItems[]     (MenuItem rows where availableCount < 5 OR
//                          isAvailable = false — limit 10)
//   - statusBreakdown     (today's orders grouped by status)
//   - revenueByHour[]     (today's revenue bucketed by IST hour 0..23)
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: VENDOR_OWNER / VENDOR_STAFF / ADMIN / SUPER_ADMIN only. CONSUMER → 403.
// Ownership: VENDOR_OWNER / VENDOR_STAFF must own the restaurant
//            (Restaurant.ownerUserId === session.userId — soft FK added by Task
//            1A; ADMIN / SUPER_ADMIN bypass this check, matching the pattern
//            in /api/vendor/orders/[id]/accept/route.ts — Task 3C).
//
// Query params:
//   - restaurantId  (required) — the restaurant to scope analytics to.
//   - date          (optional, default: today IST) — YYYY-MM-DD. The "today"
//                   window is computed in IST (+05:30) and converted to UTC for
//                   the Prisma createdAt gte/lte range.
//
// No caching (real-time for MVP). Queries are run in parallel via Promise.all.
//
// Response shape:
//   {
//     todayOrders, todayRevenue, avgPrepTimeMins, ordersWaiting,
//     lowStockItems: [{ id, name, availableCount, isAvailable }],
//     statusBreakdown: { confirmed, preparing, almostReady,
//                        readyForPickup, pickedUp, cancelled },
//     revenueByHour: [{ hour: 0..23, revenue: number }]
//   }
//
// Governance:
//   - Does NOT touch /api/admin/metrics (separate concerns — vendor analytics
//     is restaurant-scoped; admin is platform-wide).
//   - Does NOT touch /api/orders/*, /api/payments/*, /api/webhooks/*, or
//     /api/reconciliation/* — only READs Order + MenuItem + Restaurant tables
//     (no writes, no state machine mutations, no idempotency keys).
//   - Does NOT touch prisma/schema.prisma (uses existing columns only:
//     Order.createdAt, Order.status, Order.totalAmount, Order.restaurantId;
//     MenuItem.availableCount, MenuItem.isAvailable, MenuItem.name;
//     Restaurant.prepTimeMins, Restaurant.ownerUserId).
// ----------------------------------------------------------------------------

// IST offset = +05:30 = 330 minutes = 19_800_000 ms.
const IST_OFFSET_MS = 330 * 60 * 1000

// Roles permitted to call this endpoint. Matches the accept route's allow-list
// (Task 3C). VENDOR_STAFF is included for forward-compat even though the
// schema's `User.role` comment lists only CONSUMER | VENDOR_OWNER | ADMIN |
// SUPER_ADMIN — the seed/admin tools may mint VENDOR_STAFF accounts in future.
const ALLOWED_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF', 'ADMIN', 'SUPER_ADMIN']

interface IstDayRange {
  /** ISO date string YYYY-MM-DD in IST. */
  istDate: string
  /** UTC start of the IST day (inclusive). */
  startUtc: Date
  /** UTC end of the IST day (inclusive — 23:59:59.999 IST). */
  endUtc: Date
}

/**
 * Compute the UTC bounds for an IST calendar day. Defaults to "today in IST"
 * when no `dateParam` is supplied. Accepts `YYYY-MM-DD` (validated by regex).
 *
 * Implementation note: we build the ISO 8601 string `YYYY-MM-DDT00:00:00+05:30`
 * and let the Date constructor convert to UTC. This avoids relying on the
 * server's local timezone (which may differ from IST in staging/prod).
 */
function istDayRange(dateParam?: string | null): IstDayRange {
  let istDate: string
  if (dateParam) {
    const trimmed = dateParam.trim()
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
    if (!m) {
      throw new Error(
        `Invalid 'date' query param: '${dateParam}'. Expected format YYYY-MM-DD.`,
      )
    }
    istDate = trimmed
    // Sanity: ensure the date is parseable (catches invalid dates like 2026-13-45).
    const probe = new Date(`${istDate}T00:00:00+05:30`)
    if (Number.isNaN(probe.getTime())) {
      throw new Error(`Invalid 'date' query param: '${dateParam}'.`)
    }
  } else {
    const nowUtcMs = Date.now()
    const nowIstMs = nowUtcMs + IST_OFFSET_MS
    istDate = new Date(nowIstMs).toISOString().slice(0, 10)
  }
  const startUtc = new Date(`${istDate}T00:00:00+05:30`)
  const endUtc = new Date(`${istDate}T23:59:59.999+05:30`)
  return { istDate, startUtc, endUtc }
}

interface LowStockItemDto {
  id: string
  name: string
  availableCount: number | null
  isAvailable: boolean
}

interface StatusBreakdownDto {
  confirmed: number
  preparing: number
  almostReady: number
  readyForPickup: number
  pickedUp: number
  cancelled: number
}

interface RevenueByHourDto {
  hour: number
  revenue: number
}

interface VendorAnalyticsResponse {
  todayOrders: number
  todayRevenue: number
  avgPrepTimeMins: number
  ordersWaiting: number
  lowStockItems: LowStockItemDto[]
  statusBreakdown: StatusBreakdownDto
  revenueByHour: RevenueByHourDto[]
}

export const GET = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
    // -------------------------------------------------------------------------
    const session = await getSessionUser()
    if (!session) {
      // Cast to NextResponse<unknown> so the success-path return type unifies
      // (apiError returns NextResponse<ApiError>; without the cast, TS can't
      // infer a single T for withErrorHandler<T>). Matches the pattern in
      // src/app/api/orders/[id]/accepted/route.ts (Task 3C).
      return apiError(
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        401,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // RBAC — CONSUMER is forbidden (403). Allowed: VENDOR_OWNER /
    // VENDOR_STAFF / ADMIN / SUPER_ADMIN (matches accept endpoint's allow-list).
    // -------------------------------------------------------------------------
    if (!ALLOWED_ROLES.includes(session.role)) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only vendor staff or admins can view analytics',
        403,
        { requiredRoles: ALLOWED_ROLES, actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse query params — restaurantId is required; date is optional.
    // -------------------------------------------------------------------------
    const { searchParams } = new URL(req.url)
    const restaurantId = searchParams.get('restaurantId')
    if (!restaurantId) {
      return apiError(
        'VALIDATION_ERROR',
        "'restaurantId' query param is required",
        400,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }
    const dateParam = searchParams.get('date')

    let range: IstDayRange
    try {
      range = istDayRange(dateParam)
    } catch (e) {
      return apiError(
        'VALIDATION_ERROR',
        (e as Error).message,
        400,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Load the Restaurant — needed for ownership check + prepTimeMins + name.
    // -------------------------------------------------------------------------
    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        id: true,
        name: true,
        prepTimeMins: true,
        ownerUserId: true,
      },
    })
    if (!restaurant) {
      return apiError(
        'NOT_FOUND',
        `Restaurant '${restaurantId}' not found`,
        404,
        undefined,
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Ownership check — VENDOR_OWNER / VENDOR_STAFF must own the restaurant.
    // Restaurant.ownerUserId is a SOFT FK to User.id (added by Task 1A —
    // nullable; if null, no vendor has claimed it → VENDOR roles denied).
    // ADMIN + SUPER_ADMIN bypass the ownership check (matches accept endpoint).
    // -------------------------------------------------------------------------
    if (session.role === 'VENDOR_OWNER' || session.role === 'VENDOR_STAFF') {
      if (!restaurant.ownerUserId || restaurant.ownerUserId !== session.userId) {
        return apiError(
          'AUTHORIZATION_DENIED',
          'You can only view analytics for restaurants you own',
          403,
          {
            restaurantId,
            restaurantOwnerId: restaurant.ownerUserId ?? null,
            requesterId: session.userId,
          },
          traceId,
        ) as unknown as NextResponse
      }
    }

    // -------------------------------------------------------------------------
    // Run all metric queries in parallel — single restaurant, single day, so
    // each query is cheap (selective WHERE on restaurantId + createdAt range).
    //   1. todayAgg       — count + sum for today's orders (single aggregate).
    //   2. waitingAgg     — count of active orders today (status NOT in
    //                       [PICKED_UP, CANCELLED]).
    //   3. statusGroups   — groupBy status for today (status breakdown).
    //   4. todayOrderRows — findMany (createdAt + totalAmount) for hourly
    //                       IST bucketing (SQLite Prisma has no date_trunc).
    //   5. lowStockItems  — findMany where availableCount < 5 OR isAvailable
    //                       = false, limit 10, ordered by ascending
    //                       availableCount so the most-depleted surface first.
    // -------------------------------------------------------------------------
    const todayWhere = {
      restaurantId,
      createdAt: { gte: range.startUtc, lte: range.endUtc },
    }

    const [
      todayAgg,
      waitingAgg,
      statusGroups,
      todayOrderRows,
      lowStockRows,
    ] = await Promise.all([
      db.order.aggregate({
        _count: { _all: true },
        _sum: { totalAmount: true },
        where: todayWhere,
      }),
      db.order.aggregate({
        _count: { _all: true },
        where: {
          restaurantId,
          createdAt: { gte: range.startUtc, lte: range.endUtc },
          status: { notIn: ['PICKED_UP', 'CANCELLED'] },
        },
      }),
      db.order.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: todayWhere,
      }),
      db.order.findMany({
        where: todayWhere,
        select: { createdAt: true, totalAmount: true },
      }),
      db.menuItem.findMany({
        where: {
          restaurantId,
          OR: [
            // P0-25 inventory-race guard: when availableCount is set + low.
            { availableCount: { lt: 5 } },
            // Vendor has explicitly marked the item unavailable.
            { isAvailable: false },
          ],
        },
        select: {
          id: true,
          name: true,
          availableCount: true,
          isAvailable: true,
        },
        take: 10,
        orderBy: { availableCount: 'asc' },
      }),
    ])

    // -------------------------------------------------------------------------
    // Build status breakdown — group raw Order.status values into the six
    // buckets the widget displays. PAID + PAYMENT_PENDING are bucketed as
    // "confirmed" (the consumer-facing confirmation step). Unknown statuses
    // are silently dropped (forward-compat — new statuses won't crash the API).
    // -------------------------------------------------------------------------
    const statusBreakdown: StatusBreakdownDto = {
      confirmed: 0,
      preparing: 0,
      almostReady: 0,
      readyForPickup: 0,
      pickedUp: 0,
      cancelled: 0,
    }
    for (const g of statusGroups) {
      const n = g._count._all
      switch (g.status) {
        case 'CONFIRMED':
        case 'PAID':
        case 'PAYMENT_PENDING':
          statusBreakdown.confirmed += n
          break
        case 'PREPARING':
          statusBreakdown.preparing += n
          break
        case 'ALMOST_READY':
          statusBreakdown.almostReady += n
          break
        case 'READY_FOR_PICKUP':
          statusBreakdown.readyForPickup += n
          break
        case 'PICKED_UP':
          statusBreakdown.pickedUp += n
          break
        case 'CANCELLED':
          statusBreakdown.cancelled += n
          break
        default:
          // Unknown status — ignore (forward-compat).
          break
      }
    }

    // -------------------------------------------------------------------------
    // Build revenue-by-hour (24 buckets, IST hour 0..23). Convert each
    // order's createdAt UTC → IST hour. Buckets with no orders stay at 0
    // revenue (the widget's line chart needs all 24 points for a clean axis).
    // -------------------------------------------------------------------------
    const revenueByHour: RevenueByHourDto[] = Array.from(
      { length: 24 },
      (_, hour) => ({ hour, revenue: 0 }),
    )
    for (const o of todayOrderRows) {
      const istMs = o.createdAt.getTime() + IST_OFFSET_MS
      const istHour = new Date(istMs).getUTCHours()
      revenueByHour[istHour].revenue += o.totalAmount
    }

    // -------------------------------------------------------------------------
    // Low-stock items DTO. `availableCount` is nullable (NULL = unlimited
    // availability per schema comment). For the widget UI, NULL + isAvailable
    // = false means "manually disabled", not "0 left" — the widget uses
    // isAvailable to decide the chip label.
    // -------------------------------------------------------------------------
    const lowStockItems: LowStockItemDto[] = lowStockRows.map((m) => ({
      id: m.id,
      name: m.name,
      availableCount: m.availableCount,
      isAvailable: m.isAvailable,
    }))

    // -------------------------------------------------------------------------
    // Final response — shape exactly matches the task spec.
    // (avgPrepTimeMins = restaurant.prepTimeMins per the task's "simplified"
    // note — per-order actual prep time is future scope.)
    // -------------------------------------------------------------------------
    const response: VendorAnalyticsResponse = {
      todayOrders: todayAgg._count._all,
      todayRevenue: todayAgg._sum.totalAmount ?? 0,
      avgPrepTimeMins: restaurant.prepTimeMins,
      ordersWaiting: waitingAgg._count._all,
      lowStockItems,
      statusBreakdown,
      revenueByHour,
    }

    return NextResponse.json(response)
  })
