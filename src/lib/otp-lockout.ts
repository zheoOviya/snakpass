import { db } from './db'

// P0-11 — OTP retry limits + lockout enforcement
//
// Per-target (phone/email) rate limiting for OTP operations:
//   - Max 3 OTP sends per 10-minute window per target
//   - Max 5 failed verify attempts per 10-minute window per target
//   - 10-minute lockout when either limit is exceeded
//
// This complements the existing per-IP rate limit in middleware.ts (P0-13).
// The per-IP limit prevents distributed brute-force; the per-target limit
// prevents targeted brute-force against a single phone number.

const WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const MAX_SENDS_PER_WINDOW = 3
const MAX_VERIFY_FAILS_PER_WINDOW = 5
const LOCKOUT_MS = 10 * 60 * 1000 // 10 minutes

export interface OtpLockoutState {
  locked: boolean
  lockedUntil: Date | null
  sendCount: number
  verifyFailCount: number
  windowStart: Date
}

/**
 * Get the current lockout state for a target (phone/email).
 * Creates a record if one doesn't exist.
 */
export async function getLockoutState(target: string): Promise<OtpLockoutState> {
  let record = await db.otpLockout.findUnique({ where: { target } })
  if (!record) {
    record = await db.otpLockout.create({ data: { target } })
  }

  const now = new Date()
  const windowStart = new Date(record.updatedAt.getTime() - WINDOW_MS)

  // Check if lockout has expired
  if (record.lockedUntil && record.lockedUntil.getTime() < now.getTime()) {
    // Lockout expired — reset counters
    await db.otpLockout.update({
      where: { target },
      data: {
        sendCount: 0,
        verifyFailCount: 0,
        lockedUntil: null,
      },
    })
    return {
      locked: false,
      lockedUntil: null,
      sendCount: 0,
      verifyFailCount: 0,
      windowStart,
    }
  }

  return {
    locked: record.lockedUntil !== null && record.lockedUntil.getTime() > now.getTime(),
    lockedUntil: record.lockedUntil,
    sendCount: record.sendCount,
    verifyFailCount: record.verifyFailCount,
    windowStart,
  }
}

/**
 * Check if an OTP send is allowed for this target.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 */
export async function checkOtpSendAllowed(target: string): Promise<{
  allowed: boolean
  retryAfter?: number
  reason?: string
  remaining?: number
}> {
  const state = await getLockoutState(target)

  if (state.locked) {
    const retryAfter = Math.ceil((state.lockedUntil!.getTime() - Date.now()) / 1000)
    return {
      allowed: false,
      retryAfter,
      reason: `Target locked due to too many attempts. Retry after ${retryAfter}s.`,
    }
  }

  if (state.sendCount >= MAX_SENDS_PER_WINDOW) {
    // Lock the target
    await lockTarget(target)
    const retryAfter = Math.ceil(LOCKOUT_MS / 1000)
    return {
      allowed: false,
      retryAfter,
      reason: `Too many OTP sends (${MAX_SENDS_PER_WINDOW} per 10 min). Target locked for ${retryAfter}s.`,
    }
  }

  return {
    allowed: true,
    remaining: MAX_SENDS_PER_WINDOW - state.sendCount - 1,
  }
}

/**
 * Record an OTP send (increment the counter).
 */
export async function recordOtpSend(target: string): Promise<void> {
  const state = await getLockoutState(target)
  await db.otpLockout.update({
    where: { target },
    data: {
      sendCount: state.sendCount + 1,
    },
  })
}

/**
 * Check if an OTP verify is allowed for this target.
 */
export async function checkOtpVerifyAllowed(target: string): Promise<{
  allowed: boolean
  retryAfter?: number
  reason?: string
  remaining?: number
}> {
  const state = await getLockoutState(target)

  if (state.locked) {
    const retryAfter = Math.ceil((state.lockedUntil!.getTime() - Date.now()) / 1000)
    return {
      allowed: false,
      retryAfter,
      reason: `Target locked due to too many failed attempts. Retry after ${retryAfter}s.`,
    }
  }

  if (state.verifyFailCount >= MAX_VERIFY_FAILS_PER_WINDOW) {
    await lockTarget(target)
    const retryAfter = Math.ceil(LOCKOUT_MS / 1000)
    return {
      allowed: false,
      retryAfter,
      reason: `Too many failed OTP attempts (${MAX_VERIFY_FAILS_PER_WINDOW} per 10 min). Target locked for ${retryAfter}s.`,
    }
  }

  return {
    allowed: true,
    remaining: MAX_VERIFY_FAILS_PER_WINDOW - state.verifyFailCount - 1,
  }
}

/**
 * Record a failed OTP verify (increment the counter).
 */
export async function recordOtpVerifyFailure(target: string): Promise<void> {
  const state = await getLockoutState(target)
  const newCount = state.verifyFailCount + 1
  await db.otpLockout.update({
    where: { target },
    data: {
      verifyFailCount: newCount,
    },
  })
  // If this failure hits the threshold, lock the target
  if (newCount >= MAX_VERIFY_FAILS_PER_WINDOW) {
    await lockTarget(target)
  }
}

/**
 * Reset counters on successful OTP verify (target is legitimate).
 */
export async function resetOtpCounters(target: string): Promise<void> {
  await db.otpLockout.update({
    where: { target },
    data: {
      sendCount: 0,
      verifyFailCount: 0,
      lockedUntil: null,
    },
  }).catch(() => {
    // Target may not have a lockout record; that's fine
  })
}

/**
 * Lock a target for LOCKOUT_MS.
 */
async function lockTarget(target: string): Promise<void> {
  const lockedUntil = new Date(Date.now() + LOCKOUT_MS)
  await db.otpLockout.update({
    where: { target },
    data: { lockedUntil },
  })
}

// Export constants for testing + smoke tests
export const OTP_LIMITS = {
  MAX_SENDS_PER_WINDOW,
  MAX_VERIFY_FAILS_PER_WINDOW,
  WINDOW_MS,
  LOCKOUT_MS,
} as const
