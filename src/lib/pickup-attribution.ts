import { Prisma } from '@prisma/client'
import { verifyOtp } from './otp-service'
import { reportInvariantViolation } from './invariant-checker'
import { fireAlert } from './alerting'
import { info as logInfo, warn as logWarn, error as logError } from './logger'

// ----------------------------------------------------------------------------
// P0-07 — Pickup Attribution library (additive-only — P0-07-IMPLEMENT-01)
// ----------------------------------------------------------------------------
// Implements I-13 (Pickup/Handoff Integrity): a completed pickup must be
// attributable to the correct order AND an authorized collector. Both QR
// credential (order binding) AND OTP credential (collector identity) MUST be
// verified before the Fulfilment.status flips to PICKED_UP.
//
// SAFETY CONTRACT (Orchestrator hard boundary):
//   - Additive-only — does NOT modify `src/lib/fulfilment-state.ts` (P0-06
//     state machine — NEXT_FULFILMENT_STATUS is unchanged).
//   - Does NOT modify `prisma/schema.prisma` Fulfilment model block (the
//     pickupOtp/pickupVerifiedAt/pickupVerifiedBy fields already exist from
//     P0-06 — P0-07 only WRITES them).
//   - Reuses `verifyOtp()` from otp-service.ts (no reimplementation).
//   - Reuses `reportInvariantViolation()` from invariant-checker.ts (P0-28
//     ExceptionQueue + freeze pathway).
//   - Reuses `fireAlert('inconsistent-combo', ...)` (additive alert rule).
//   - M22/M23 detection (post-transition invariants) live in
//     `src/lib/state-invariants.ts` (NOT `reconciliation.ts` — Wave-5 5B
//     detection-only boundary preserved).
//
// QR token format: `snakzap:pickup:${orderId}:otp:${pickupOtp}`
//   - orderId    : the Order.id this QR was issued for (from the URL path)
//   - pickupOtp  : the 6-digit OTP stored on Order.pickupOtp (issued when the
//                  Order transitioned to READY_FOR_PICKUP — see status/route.ts:54)
//   - Encoded by `src/components/snak/order-tracking.tsx` and rendered as a QR
//     code via `qrcode.react` (QRCodeSVG).
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// QR token decode
// ----------------------------------------------------------------------------

export interface DecodedQrToken {
  orderId: string
  pickupOtp: string
}

/**
 * Parse a QR token string of the form `snakzap:pickup:${orderId}:otp:${pickupOtp}`.
 *
 * Returns the decoded { orderId, pickupOtp } pair, or `null` if the format
 * does not match. The caller is responsible for verifying that the decoded
 * `orderId` matches the URL path parameter, AND that the decoded `pickupOtp`
 * matches `Order.pickupOtp` (these checks happen in `verifyPickupAttribution()`).
 *
 * Returns null (rather than throwing) on:
 *   - malformed format (wrong prefix, missing segments, non-numeric OTP)
 *   - missing values
 *
 * The QR token is a credential binding artifact, NOT a security boundary on
 * its own — it carries no signature/HMAC. The actual security comes from:
 *   1. Cross-checking orderId against the URL path (prevents swapping QR tokens
 *      between orders)
 *   2. Cross-checking pickupOtp against Order.pickupOtp (prevents forgery)
 *   3. Verifying the OTP via `verifyOtp()` (timing-safe scrypt comparison)
 *   4. Cross-credential check: `otp.target === order.user.phone`
 */
export function decodeQrToken(qrToken: string): DecodedQrToken | null {
  if (!qrToken || typeof qrToken !== 'string') return null
  // Expected format: snakzap:pickup:<orderId>:otp:<pickupOtp>
  const parts = qrToken.split(':')
  if (parts.length !== 5) return null
  const [scheme, kind, orderId, otpLabel, pickupOtp] = parts
  if (scheme !== 'snakzap') return null
  if (kind !== 'pickup') return null
  if (otpLabel !== 'otp') return null
  if (!orderId || orderId.length < 1) return null
  if (!pickupOtp || !/^\d{6}$/.test(pickupOtp)) return null
  return { orderId, pickupOtp }
}

// ----------------------------------------------------------------------------
// Verification result types
// ----------------------------------------------------------------------------

export type PickupAttributionFailureReason =
  | 'QR_TOKEN_INVALID'
  | 'QR_ORDER_ID_MISMATCH'
  | 'QR_OTP_MISMATCH'
  | 'ORDER_NOT_FOUND'
  | 'DEFAULT_OTP_NOT_ISSUED' // Order.pickupOtp is still '000000' (no READY_FOR_PICKUP ever issued)
  | 'ORDER_INACTIVE_STATE'   // Order.status ∈ {CANCELLED, FROZEN}
  | 'PAYMENT_NOT_CAPTURED'   // Payment.status !== 'CAPTURED'
  | 'FULFILMENT_NOT_READY'   // Fulfilment.status !== 'READY_FOR_PICKUP'
  | 'OTP_VERIFICATION_FAILED' // verifyOtp() returned ok:false
  | 'OTP_TARGET_MISMATCH'      // otp.target !== order.user.phone (cross-credential)
  | 'STALE_VERSION'            // optimistic-lock version mismatch on PICKED_UP flip
  | 'FULFILMENT_MISSING'       // No Fulfilment row exists (defensive — should be lazy-created)

export interface PickupAttributionFailure {
  ok: false
  reason: PickupAttributionFailureReason
  httpStatus: number // 404 (not found), 409 (conflict), 422 (validation)
  description: string
  stateSnapshot: Record<string, unknown>
  // Metadata used by M22/M23 (downstream post-transition detection) — emitted
  // to ExceptionQueue + alert. These mirror the StateInvariantFinding shape but
  // are intentionally lightweight (no forceFreezeLevel — pickup attribution
  // failure blocks the transition; freeze-level escalation happens via the
  // existing invariant-checker pathway).
  invariantViolation?: {
    invariant: string // I-13 (Pickup/Handoff Integrity)
    entityType: 'Fulfilment' | 'Order'
    entityId: string
    description: string
    stateSnapshot: Record<string, unknown>
  }
}

export interface PickupAttributionSuccess {
  ok: true
  orderId: string
  fulfilmentId: string
  // Optimistic-lock field values AFTER the PICKED_UP flip:
  newVersion: number
  pickupVerifiedAt: Date
  pickupVerifiedBy: string // session.userId of the verifier
  // Attribution metadata captured for AuditLog (5 fields):
  attribution: {
    orderId: string
    collectorIdentity: string // session.userId (collector — could be CONSUMER owner, VENDOR_OWNER, or ADMIN)
    collectorRole: string      // session.role
    timestamp: string          // ISO
    verificationMethod: 'QR+OTP' // method enum — always QR+OTP per P0-07 spec
    verificationResult: 'SUCCESS' // result enum — always SUCCESS on the happy path
  }
}

export type PickupAttributionResult = PickupAttributionSuccess | PickupAttributionFailure

// ----------------------------------------------------------------------------
// verifyPickupAttribution — orchestrates the 6-check + cross-credential gate
// ----------------------------------------------------------------------------
// NOTE: This function REUSES `verifyOtp()` from otp-service.ts. The OTP
// verification is performed OUTSIDE the transaction (because `verifyOtp()`
// uses the global `db` client, not the transaction client — otp-service.ts is
// part of the shared auth infrastructure and we do NOT modify it for P0-07).
//
// The transaction is then opened for the Fulfilment.status flip + AuditLog +
// Outbox write. The pre-transition checks (Order.status, Payment.status,
// Fulfilment.status) are re-read INSIDE the transaction (so they reflect the
// latest committed state — defense-in-depth against TOCTOU).
//
// CALLER RESPONSIBILITIES (the route handler):
//   1. AuthN: getSessionUser() (401 if no session)
//   2. RBAC: requireRole([CONSUMER, VENDOR_OWNER, ADMIN, SUPER_ADMIN])
//      + ownership check (CONSUMER → order.userId === session.userId;
//      VENDOR_OWNER → no restaurant ownership check (schema lacks ownerId))
//   3. Idempotency: getCachedResponse() / storeIdempotencyRecord()
//   4. Call verifyPickupAttribution() INSIDE withTransaction
//   5. On success: write AuditLog (PICKUP_VERIFIED, 5 fields) + Outbox event
//   6. On failure: return 409 + call reportAttributionFailure() OUTSIDE txn
// ----------------------------------------------------------------------------

export interface VerifyPickupAttributionParams {
  /** Order.id from the URL path */
  orderId: string
  /** The OTP record ID issued at READY_FOR_PICKUP (createOtp('phone', phone, 'pickup')) */
  otpId: string
  /** The 6-digit OTP code (will be scrypt-compared server-side) */
  code: string
  /** The QR-encoded credential string (decoded via decodeQrToken) */
  qrToken: string
  /** The verifying session (collector) — userId is written to pickupVerifiedBy */
  verifier: {
    userId: string
    role: string
  }
  /** The trace ID for log correlation */
  traceId: string
}

const I_13 = 'I-13' // Pickup/Handoff Integrity (P0-07 additive invariant code)

export async function verifyPickupAttribution(
  tx: Prisma.TransactionClient,
  params: VerifyPickupAttributionParams,
): Promise<PickupAttributionResult> {
  const { orderId, otpId, code, qrToken, verifier, traceId } = params
  const now = new Date()

  // -------------------------------------------------------------------------
  // CHECK 1: QR token decodes + orderId matches URL path + pickupOtp matches
  // -------------------------------------------------------------------------
  const decoded = decodeQrToken(qrToken)
  if (!decoded) {
    logWarn('pickup-attr-qr-token-invalid', { orderId, qrTokenPreview: qrToken.slice(0, 40) }, traceId)
    return failure('QR_TOKEN_INVALID', 422, `QR token format is invalid`, {
      orderId,
      qrTokenPreview: qrToken.slice(0, 40),
      verifierUserId: verifier.userId,
    })
  }
  if (decoded.orderId !== orderId) {
    logWarn(
      'pickup-attr-qr-order-id-mismatch',
      { urlOrderId: orderId, qrOrderId: decoded.orderId },
      traceId,
    )
    return failure(
      'QR_ORDER_ID_MISMATCH',
      409,
      `QR token orderId does not match URL path. QR was issued for order ${decoded.orderId}, but the request targets order ${orderId}.`,
      {
        urlOrderId: orderId,
        qrOrderId: decoded.orderId,
        verifierUserId: verifier.userId,
      },
    )
  }

  // -------------------------------------------------------------------------
  // Read the Order with Fulfilment + Payment relations INSIDE the txn (so the
  // subsequent pre-transition checks reflect the latest committed state).
  // -------------------------------------------------------------------------
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, phone: true } },
      fulfilment: true,
      payment: { select: { id: true, status: true, frozen: true } },
    },
  })

  // -------------------------------------------------------------------------
  // CHECK 2: Order exists
  // -------------------------------------------------------------------------
  if (!order) {
    return failure('ORDER_NOT_FOUND', 404, `Order ${orderId} not found`, {
      orderId,
      verifierUserId: verifier.userId,
    })
  }

  // Now that we have the order, finish CHECK 1: pickupOtp matches Order.pickupOtp
  if (decoded.pickupOtp !== order.pickupOtp) {
    logWarn(
      'pickup-attr-qr-otp-mismatch',
      { orderId, qrOtp: decoded.pickupOtp, orderOtp: order.pickupOtp },
      traceId,
    )
    return failure(
      'QR_OTP_MISMATCH',
      409,
      `QR token pickupOtp does not match Order.pickupOtp. The QR token may be stale or forged.`,
      {
        orderId,
        qrOtp: decoded.pickupOtp,
        orderOtp: order.pickupOtp,
        verifierUserId: verifier.userId,
      },
    )
  }

  // -------------------------------------------------------------------------
  // CHECK 3: Order.pickupOtp is NOT the default '000000' — i.e., a real OTP
  // was issued when the order transitioned to READY_FOR_PICKUP. This catches
  // the case where a caller crafts a QR token for an order that never reached
  // READY_FOR_PICKUP (and thus never had a real OTP issued).
  // -------------------------------------------------------------------------
  if (order.pickupOtp === '000000') {
    logWarn('pickup-attr-default-otp', { orderId, orderStatus: order.status }, traceId)
    return failure(
      'DEFAULT_OTP_NOT_ISSUED',
      409,
      `Order ${orderId} has the default pickup OTP '000000' — no real pickup OTP was ever issued (order may not have reached READY_FOR_PICKUP).`,
      {
        orderId,
        orderStatus: order.status,
        orderPickupOtp: order.pickupOtp,
        verifierUserId: verifier.userId,
      },
    )
  }

  // -------------------------------------------------------------------------
  // CHECK 4: Order.status NOT IN {CANCELLED, FROZEN} — pickup is meaningless
  // for an order that has been cancelled or frozen by the invariant-checker.
  // -------------------------------------------------------------------------
  if (order.status === 'CANCELLED' || order.status === 'FROZEN') {
    logWarn(
      'pickup-attr-order-inactive',
      { orderId, orderStatus: order.status },
      traceId,
    )
    return failure(
      'ORDER_INACTIVE_STATE',
      409,
      `Order ${orderId} is in ${order.status} state — pickup cannot be verified.`,
      {
        orderId,
        orderStatus: order.status,
        verifierUserId: verifier.userId,
      },
      // Mirror M23 (Order CANCELLED + Fulfilment PICKED_UP) — escalate so the
      // invariant-checker + freeze pathway catches this if the order was
      // cancelled AFTER the Fulfilment was already PICKED_UP (rare race).
      {
        invariant: I_13,
        entityType: 'Order',
        entityId: orderId,
        description: `Pickup attempted on order ${orderId} in ${order.status} state.`,
        stateSnapshot: {
          orderId,
          orderStatus: order.status,
          verifierUserId: verifier.userId,
          detectedAt: now.toISOString(),
        },
      },
    )
  }

  // -------------------------------------------------------------------------
  // CHECK 5: Payment.status === 'CAPTURED'
  // -------------------------------------------------------------------------
  const payment = order.payment
  if (!payment || payment.status !== 'CAPTURED') {
    logWarn(
      'pickup-attr-payment-not-captured',
      { orderId, paymentStatus: payment?.status ?? 'MISSING' },
      traceId,
    )
    return failure(
      'PAYMENT_NOT_CAPTURED',
      409,
      payment
        ? `Order ${orderId} Payment is ${payment.status} (not CAPTURED) — pickup is not allowed.`
        : `Order ${orderId} has no Payment — pickup is not allowed.`,
      {
        orderId,
        paymentId: payment?.id ?? null,
        paymentStatus: payment?.status ?? 'MISSING',
        verifierUserId: verifier.userId,
      },
    )
  }

  // -------------------------------------------------------------------------
  // CHECK 6: Fulfilment.status === 'READY_FOR_PICKUP'
  // -------------------------------------------------------------------------
  const fulfilment = order.fulfilment
  if (!fulfilment) {
    logWarn('pickup-attr-fulfilment-missing', { orderId }, traceId)
    return failure(
      'FULFILMENT_MISSING',
      409,
      `Order ${orderId} has no Fulfilment row — kitchen has not started preparing.`,
      {
        orderId,
        verifierUserId: verifier.userId,
      },
    )
  }
  if (fulfilment.status !== 'READY_FOR_PICKUP') {
    logWarn(
      'pickup-attr-fulfilment-not-ready',
      { orderId, fulfilmentStatus: fulfilment.status },
      traceId,
    )
    return failure(
      'FULFILMENT_NOT_READY',
      409,
      `Fulfilment ${fulfilment.id} status is ${fulfilment.status} (not READY_FOR_PICKUP) — pickup cannot be verified yet.`,
      {
        orderId,
        fulfilmentId: fulfilment.id,
        fulfilmentStatus: fulfilment.status,
        verifierUserId: verifier.userId,
      },
    )
  }

  // -------------------------------------------------------------------------
  // CHECK 7: verifyOtp() returns ok AND otp.target === order.user.phone
  // (cross-credential check — prevents a consumer from verifying pickup for
  // ANOTHER consumer's order using their own OTP).
  // -------------------------------------------------------------------------
  // NOTE: verifyOtp() uses the global `db` client (NOT the txn `tx`). This is
  // acceptable because:
  //   - The OTP record is in the OtpRequest table (separate from Order/
  //     Payment/Fulfilment). Its `consumed` flag is independent of the
  //     Fulfilment.status flip — if the txn later rolls back, the OTP remains
  //     consumed (which is the safe direction — a replay would be rejected).
  //   - The cross-credential check (otp.target === order.user.phone) provides
  //     the binding between the OTP credential and the order owner.
  // V2 fix: pass `tx` to verifyOtp so it uses the transaction client (NOT
  // the global `db`). On SQLite, using `db` while a BEGIN IMMEDIATE write
  // lock is held causes "database is locked" errors. Using `tx` ensures the
  // OTP consume + the fulfilment transition are in the SAME transaction.
  const otpResult = await verifyOtp(otpId, code, tx)
  if (!otpResult.ok) {
    logWarn(
      'pickup-attr-otp-verification-failed',
      { orderId, otpId },
      traceId,
    )
    return failure(
      'OTP_VERIFICATION_FAILED',
      409,
      `OTP verification failed (invalid, expired, or already consumed).`,
      {
        orderId,
        otpId,
        verifierUserId: verifier.userId,
      },
    )
  }
  // Cross-credential check: otp.target (phone) MUST match the order owner's phone.
  const orderOwnerPhone = order.user?.phone
  if (!orderOwnerPhone || otpResult.target !== orderOwnerPhone) {
    logWarn(
      'pickup-attr-otp-target-mismatch',
      { orderId, otpTarget: otpResult.target, orderOwnerPhone },
      traceId,
    )
    return failure(
      'OTP_TARGET_MISMATCH',
      409,
      `OTP was issued to ${otpResult.target ?? '<unknown>'} but the order belongs to ${orderOwnerPhone ?? '<unknown>'}. Cross-credential pickup is not allowed.`,
      {
        orderId,
        otpId,
        otpTarget: otpResult.target ?? null,
        orderOwnerPhone: orderOwnerPhone ?? null,
        verifierUserId: verifier.userId,
      },
      // Escalate — cross-credential attempt is a security signal.
      {
        invariant: I_13,
        entityType: 'Fulfilment',
        entityId: fulfilment.id,
        description: `Cross-credential pickup attempt on order ${orderId}: OTP target ${otpResult.target ?? '<null>'} ≠ order owner ${orderOwnerPhone ?? '<null>'}.`,
        stateSnapshot: {
          orderId,
          fulfilmentId: fulfilment.id,
          otpTarget: otpResult.target ?? null,
          orderOwnerPhone: orderOwnerPhone ?? null,
          verifierUserId: verifier.userId,
          detectedAt: now.toISOString(),
        },
      },
    )
  }

  // -------------------------------------------------------------------------
  // ALL CHECKS PASSED — flip Fulfilment.status = PICKED_UP
  // (optimistic-lock conditional updateMany WHERE version = X)
  // -------------------------------------------------------------------------
  const updated = await tx.fulfilment.updateMany({
    where: { id: fulfilment.id, version: fulfilment.version },
    data: {
      status: 'PICKED_UP',
      pickupVerifiedAt: now,
      pickupVerifiedBy: verifier.userId,
      // Bump status history (parallel to Order.statusHistory).
      statusHistory: JSON.stringify([
        ...(JSON.parse(fulfilment.statusHistory || '[]') as { status: string; at: string }[]),
        { status: 'PICKED_UP', at: now.toISOString() },
      ]),
      version: { increment: 1 },
    },
  })

  if (updated.count === 0) {
    // Version mismatch — another request won the race (likely a duplicate
    // pickup-verify with the same Idempotency-Key — which should have been
    // caught by getCachedResponse; or a concurrent PATCH /fulfilment that
    // raced the pickup-verify).
    logWarn(
      'pickup-attr-stale-version',
      { orderId, fulfilmentId: fulfilment.id, expectedVersion: fulfilment.version },
      traceId,
    )
    return failure(
      'STALE_VERSION',
      409,
      `Fulfilment ${fulfilment.id} was modified by another request. Please refresh and retry.`,
      {
        orderId,
        fulfilmentId: fulfilment.id,
        expectedVersion: fulfilment.version,
        verifierUserId: verifier.userId,
      },
    )
  }

  // Fetch the updated Fulfilment to read the new version
  const updatedFulfilment = await tx.fulfilment.findUnique({
    where: { id: fulfilment.id },
    select: { id: true, version: true, pickupVerifiedAt: true, pickupVerifiedBy: true },
  })

  logInfo(
    'pickup-attr-success',
    {
      orderId,
      fulfilmentId: fulfilment.id,
      verifierUserId: verifier.userId,
      verifierRole: verifier.role,
    },
    traceId,
  )

  return {
    ok: true,
    orderId,
    fulfilmentId: fulfilment.id,
    newVersion: updatedFulfilment?.version ?? fulfilment.version + 1,
    pickupVerifiedAt: updatedFulfilment?.pickupVerifiedAt ?? now,
    pickupVerifiedBy: verifier.userId,
    attribution: {
      orderId,
      collectorIdentity: verifier.userId,
      collectorRole: verifier.role,
      timestamp: now.toISOString(),
      verificationMethod: 'QR+OTP' as const,
      verificationResult: 'SUCCESS' as const,
    },
  }

  // -------------------------------------------------------------------------
  // Local failure builder — keeps the call sites above concise.
  // -------------------------------------------------------------------------
  function failure(
    reason: PickupAttributionFailureReason,
    httpStatus: number,
    description: string,
    stateSnapshot: Record<string, unknown>,
    invariantViolation?: {
      invariant: string
      entityType: 'Fulfilment' | 'Order'
      entityId: string
      description: string
      stateSnapshot: Record<string, unknown>
    },
  ): PickupAttributionFailure {
    return {
      ok: false,
      reason,
      httpStatus,
      description,
      stateSnapshot,
      invariantViolation,
    }
  }
}

// ----------------------------------------------------------------------------
// reportAttributionFailure — OUTSIDE the transaction
// ----------------------------------------------------------------------------
// Called by the pickup-verify route handler AFTER the txn has rolled back (or
// after a pre-txn check failed). Routes the failure to:
//   1. reportInvariantViolation() — ExceptionQueue entry + freeze pathway
//   2. fireAlert('inconsistent-combo') — alerting pathway
//
// MUST be called OUTSIDE the txn — both reportInvariantViolation and
// fireAlert may perform their own writes (ExceptionQueue insert, freeze
// mutation) which we do NOT want tied to the pickup-verify txn (if that txn
// rolled back, we'd lose the exception entry — defeating the purpose).
// ----------------------------------------------------------------------------
export async function reportAttributionFailure(
  failure: PickupAttributionFailure,
  orderId: string,
  traceId: string,
): Promise<void> {
  // If the failure has no invariant-violation metadata, it's a routine
  // rejection (e.g., QR_TOKEN_INVALID, ORDER_NOT_FOUND, OTP_VERIFICATION_FAILED)
  // — log only, do NOT escalate to ExceptionQueue (those are user errors, not
  // system-state corruption).
  if (!failure.invariantViolation) {
    logWarn(
      'pickup-attr-failure-no-escalation',
      {
        orderId,
        reason: failure.reason,
        httpStatus: failure.httpStatus,
        description: failure.description,
      },
      traceId,
    )
    return
  }

  const { invariant, entityType, entityId, description, stateSnapshot } =
    failure.invariantViolation

  // Route to ExceptionQueue + freeze via the EXISTING reportInvariantViolation
  // pathway (P0-28). Level 1 freeze (transaction-level) — pickup attribution
  // failure is a per-order signal, not a money-state violation (no Level 3).
  try {
    await reportInvariantViolation({
      invariant,
      entityType,
      entityId,
      description,
      stateSnapshot,
      traceId,
    })
  } catch (err) {
    // reportInvariantViolation may throw if the DB write fails. Log + continue
    // (we still want to fire the alert below — the alert is independent).
    logError(
      'pickup-attr-report-invariant-violation-failed',
      { orderId, reason: failure.reason, error: (err as Error).message },
      traceId,
    )
  }

  // Fire the EXISTING alert rule (additive 'inconsistent-combo' rule added by
  // P0-06 Wave-6 in alerting.ts — reused as-is).
  fireAlert('inconsistent-combo', {
    mismatchClass: `PICKUP_ATTRIBUTION_${failure.reason}`,
    severity: 'CRITICAL',
    invariant,
    orderId,
    entityType,
    entityId,
    reason: failure.reason,
    description: failure.description,
    traceId,
  })

  logWarn(
    'pickup-attr-failure-escalated',
    {
      orderId,
      reason: failure.reason,
      invariant,
      entityType,
      entityId,
    },
    traceId,
  )
}
