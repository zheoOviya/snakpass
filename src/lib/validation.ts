import { z } from 'zod'
import { NextRequest } from 'next/server'
import { AppError } from './errors'

// P0-12 — Zod input validation on every API
// No API accepts unvalidated input; 400 on schema mismatch.
// Control/Enabler (Architectural Law 6): validates inputs, does not enforce a business truth.

// Parse and validate a JSON request body against a Zod schema.
// Throws AppError(VALIDATION_ERROR) on mismatch — caught by withErrorHandler.
export async function validateBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON body', 400)
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    const details: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_'
      details[path] = issue.message
    }
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400, details)
  }
  return result.data
}

// Validate query params against a Zod schema.
export function validateQuery<T>(req: NextRequest, schema: z.ZodType<T>): T {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries())
  const result = schema.safeParse(params)
  if (!result.success) {
    const details: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_'
      details[path] = issue.message
    }
    throw new AppError('VALIDATION_ERROR', 'Query validation failed', 400, details)
  }
  return result.data
}

// --- Shared schemas ---

export const phoneSchema = z.string().regex(/^\+?[0-9]{10,15}$/, 'Invalid phone number (E.164 expected)')
export const otpSchema = z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric')
export const otpPurposeSchema = z.enum(['consumer_login', 'vendor_login', 'admin_2fa', 'pickup'])
export const emailSchema = z.string().email('Invalid email')
export const uuidSchema = z.string().min(1, 'ID required')
export const orderStatusSchema = z.enum([
  'CONFIRMED', 'PREPARING', 'ALMOST_READY', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED',
])
export const killSwitchKeySchema = z.enum(['ordering', 'payments', 'catering', 'new_vendors', 'wallet_cashback'])

// Order creation body
export const createOrderBodySchema = z.object({
  restaurantId: uuidSchema,
  items: z.array(z.object({
    menuItemId: uuidSchema,
    name: z.string().min(1).max(200),
    price: z.number().int().nonnegative(),
    quantity: z.number().int().positive(),
  })).min(1, 'At least one item required'),
  isCatering: z.boolean().optional().default(false),
  headcount: z.number().int().positive().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
})

// OTP send body
export const otpSendBodySchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['consumer_login', 'vendor_login']),
})

// OTP verify body
// P0-07: `purpose` enum extended to include 'pickup' so the same OTP verification
// service can be reused for pickup attribution (P0-07 pickup-verify endpoint).
export const otpVerifyBodySchema = z.object({
  otpId: uuidSchema,
  code: otpSchema,
  phone: phoneSchema,
  purpose: otpPurposeSchema,
})

// P0-07 — Pickup attribution verify body
// POST /api/orders/[id]/pickup/verify  { otpId, code, qrToken }
//   - otpId    : the OTP record ID issued when the order transitioned to READY_FOR_PICKUP
//                (see status/route.ts → createOtp('phone', phone, 'pickup'))
//   - code     : the 6-digit OTP code (scrypt-hashed server-side)
//   - qrToken  : the QR-encoded credential string `snakzap:pickup:${orderId}:otp:${pickupOtp}`
//                (see src/components/snak/order-tracking.tsx)
// The server cross-checks otpId/code (verifyOtp), qrToken (decodeQrToken), and
// otp.target === order.user.phone (cross-credential check) — all three MUST match.
export const pickupVerifyBodySchema = z.object({
  otpId: uuidSchema,
  code: otpSchema,
  qrToken: z.string().min(1, 'qrToken required'),
})

// Admin login body
export const adminLoginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password required'),
})

// Admin 2FA verify body
export const adminVerifyBodySchema = z.object({
  otpId: uuidSchema,
  code: otpSchema,
})

// Status update body
export const statusUpdateBodySchema = z.object({
  status: orderStatusSchema,
  actorRole: z.string().optional(),
})

// Menu availability body
export const menuAvailabilityBodySchema = z.object({
  isAvailable: z.boolean(),
})

// Kill switch toggle body
export const killSwitchToggleBodySchema = z.object({
  enabled: z.boolean(),
})

// ============================================================================
// PRODUCT FOUNDATION — ADDITIVE SCHEMAS (Task 1C)
// ============================================================================
// All schemas below are NEW and ADDITIVE. No existing schema is modified.
// Used by the new Wave 2+ API routes (campuses, rewards, gifts, group-orders,
// social, notifications). Existing routes are unaffected.
// ============================================================================

// Campus — campusId is just a UUID-shaped string (mirrors uuidSchema).
export const campusIdSchema = uuidSchema

// Rewards — redeem points for a single-use discount code.
// Points must be a positive integer (negative or fractional redemption is
// rejected). orderId is optional — if present, the redemption is scoped to
// that order (single-use code recorded against the order).
export const rewardRedeemSchema = z.object({
  points: z.number().int().positive('Points must be a positive integer'),
  orderId: uuidSchema.optional(),
})

// Gifts — create a new gift (sender → recipient).
// recipientId + menuItemId are required; message is optional (max 500 chars).
export const giftCreateSchema = z.object({
  recipientId: uuidSchema,
  menuItemId: uuidSchema,
  message: z.string().max(500, 'Message too long (max 500 chars)').optional(),
})

// Gifts — recipient redeems via the single-use code.
export const giftRedeemSchema = z.object({
  redemptionCode: z.string().min(1, 'Redemption code required'),
})

// Group orders — host creates a new group order scoped to a restaurant.
export const groupOrderCreateSchema = z.object({
  restaurantId: uuidSchema,
})

// Group orders — friend joins via the human-readable share code.
export const groupOrderJoinSchema = z.object({
  shareCode: z.string().min(1, 'Share code required'),
})

// Group orders — member adds an item to their cart (snapshot fields).
// Price is in PAISE (1 ₹ = 100 paise) — non-negative integer.
// Quantity is a positive integer (min 1).
export const groupOrderItemSchema = z.object({
  menuItemId: uuidSchema,
  name: z.string().min(1).max(200),
  price: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
})

// Social — send a friend request to a target user.
export const socialRequestSchema = z.object({
  targetUserId: uuidSchema,
  message: z.string().max(500).optional(),
})

// Social — accept or decline a pending friend request (action + requestId).
export const socialActionSchema = z.object({
  requestId: uuidSchema,
  action: z.enum(['ACCEPT', 'REJECT']),
})

// Notifications — mark a single notification as read by ID.
export const notificationMarkReadSchema = z.object({
  id: uuidSchema,
  read: z.boolean().optional().default(true),
})
