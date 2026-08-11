import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// Lightweight password hashing using Node's scrypt (no external bcrypt dep).
// Format: "scrypt:<saltHex>:<hashHex>"

const KEY_LEN = 64
const SCRYPT_N = 16384

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N })
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, saltHex, hashHex] = stored.split(':')
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
    const salt = Buffer.from(saltHex, 'hex')
    const storedHash = Buffer.from(hashHex, 'hex')
    const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N })
    return hash.length === storedHash.length && timingSafeEqual(hash, storedHash)
  } catch {
    return false
  }
}
