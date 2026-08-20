import { AppError } from './errors'
import { db, withTransaction } from './db'
import type { SessionUser } from './session'

// ----------------------------------------------------------------------------
// Wave 4 Task 4B — Vendor RBAC helpers (shared across /api/vendor/* routes)
// ----------------------------------------------------------------------------
// resolveVendorRestaurant:
//   Given the authenticated session, find the restaurant the vendor is
//   authorized to manage. Returns { id, name }.
//
//   - ADMIN / SUPER_ADMIN → require an explicit `restaurantId` query param
//     (the vendor they're impersonating). 400 if missing, 404 if not found.
//   - VENDOR_OWNER / VENDOR_STAFF → find Restaurant where ownerUserId ===
//     session.userId (SOFT FK — no Prisma relation declared to avoid touching
//     the User model). If multiple restaurants share an owner (rare), pick
//     the most recently created. 404 if none.
//
// Accepts either the global `db` client or a transaction `tx` so callers can
// re-use this inside withTransaction (snapshot/lock sharing).
// ----------------------------------------------------------------------------

export async function resolveVendorRestaurant(
  client: typeof db | Parameters<Parameters<typeof withTransaction>[0]>[0],
  session: SessionUser,
  restaurantIdQuery?: string,
): Promise<{ id: string; name: string }> {
  if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') {
    if (!restaurantIdQuery) {
      throw new AppError(
        'VALIDATION_ERROR',
        'restaurantId query param is required for admin users',
        400,
        { hint: 'Pass ?restaurantId=X to specify which vendor restaurant to manage' },
      )
    }
    const r = await client.restaurant.findUnique({
      where: { id: restaurantIdQuery },
      select: { id: true, name: true },
    })
    if (!r) {
      throw new AppError('NOT_FOUND', 'Restaurant not found', 404, { restaurantId: restaurantIdQuery })
    }
    return r
  }

  // VENDOR_OWNER / VENDOR_STAFF — find by ownerUserId === session.userId.
  // ownerUserId is a SOFT FK (no Prisma relation declared to avoid touching
  // the User model). Multiple restaurants may share an owner (rare); pick
  // the most recently created.
  const r = await client.restaurant.findFirst({
    where: { ownerUserId: session.userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })
  if (!r) {
    throw new AppError(
      'NOT_FOUND',
      'No restaurant is linked to your vendor account. Ask an admin to link you as the owner.',
      404,
    )
  }
  return r
}
