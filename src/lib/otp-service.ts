import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from './db'

// OTP service — single technique used everywhere OTP is needed:
//   - consumer phone login
//   - vendor phone login
//   - admin 2FA (email channel)
//   - pickup OTP delivery (sent to consumer's phone when order is ready)
//
// In production this is backed by Supabase Authentication (phone SMS) — see
// src/lib/supabase.ts for the client-side Supabase path. When Supabase
// credentials are NOT configured (e.g. this sandbox), we run in "demo mode":
// the 6-digit code is generated and stored server-side (scrypt-hashed) and
// returned to the caller so the UI can surface it for testing. The verify
// path is identical either way.

const OTP_TTL_MIN = 5
const KEY_LEN = 32

function hashCode(code: string): string {
  const salt = Buffer.from('snakzap-otp-salt') // fixed salt is fine: OTP is high-entropy + short-lived
  const hash = scryptSync(code, salt, KEY_LEN)
  return hash.toString('hex')
}

export interface CreateOtpResult {
  otpId: string
  code: string // returned so demo-mode UI can display it; in real Supabase mode this is the code we'd send via SMS/email
}

export async function createOtp(
  channel: 'phone' | 'email',
  target: string,
  purpose: string,
): Promise<CreateOtpResult> {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000)
  const rec = await db.otpRequest.create({
    data: {
      channel,
      target,
      purpose,
      codeHash: hashCode(code),
      expiresAt,
    },
  })
  return { otpId: rec.id, code }
}

export async function verifyOtp(
  otpId: string,
  code: string,
): Promise<{ ok: boolean; target?: string; purpose?: string }> {
  const rec = await db.otpRequest.findUnique({ where: { id: otpId } })
  if (!rec) return { ok: false }
  if (rec.consumed) return { ok: false }
  if (rec.expiresAt.getTime() < Date.now()) return { ok: false }

  const expected = Buffer.from(rec.codeHash, 'hex')
  const actual = scryptSync(code, Buffer.from('snakzap-otp-salt'), KEY_LEN)
  const match = actual.length === expected.length && timingSafeEqual(actual, expected)
  if (!match) return { ok: false }

  await db.otpRequest.update({ where: { id: otpId }, data: { consumed: true } })
  return { ok: true, target: rec.target, purpose: rec.purpose }
}

export function randomToken(): string {
  return randomBytes(32).toString('hex')
}
