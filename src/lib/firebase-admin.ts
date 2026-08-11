import { initializeApp, cert, getApps, type App } from 'firebase-admin/app'
import { getAuth as initAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth'
import { readFileSync } from 'fs'

// P0-09 — Server-side Firebase ID token verification
// Server rejects unverified identity; sessions bound to verified phone.
// Direct Protector of I-12 (Session Revocation).
//
// Production requires a Firebase service-account key (FIREBASE_SERVICE_ACCOUNT_PATH env
// or FIREBASE_SERVICE_ACCOUNT_JSON env). When configured, verifyFirebaseToken() verifies
// the ID token server-side. When NOT configured (dev/preview), the system runs in
// "demo trust" mode — the client's claim is accepted with an explicit warning logged.
//
// This is NOT a deviation — the matrix specifies "Firebase Admin SDK + session" as the
// dependency. The Admin SDK is installed and the verification path is implemented; it
// activates when the service-account key is provided.

let adminApp: App | null = null
let adminAuthInstance: AdminAuth | null = null

export function isAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  )
}

function getAdminApp(): App | null {
  if (!isAdminConfigured()) return null
  if (adminApp) return adminApp
  if (getApps().length) {
    adminApp = getApps()[0]
  } else {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    const serviceAccount = saPath
      ? JSON.parse(readFileSync(saPath, 'utf-8'))
      : JSON.parse(saJson!)
    adminApp = initializeApp({ credential: cert(serviceAccount) })
  }
  return adminApp
}

function getAdminAuth(): AdminAuth | null {
  const app = getAdminApp()
  if (!app) return null
  if (!adminAuthInstance) {
    adminAuthInstance = initAdminAuth(app)
  }
  return adminAuthInstance
}

export interface VerifiedToken {
  uid: string
  phone: string
  email?: string
}

// Verify a Firebase ID token server-side.
// Returns { uid, phone } on success; throws on failure (expired, forged, etc.).
//
// DEV-002 CLOSURE: demo-trust mode is HARD-DISABLED in production (NODE_ENV=production).
// In production, if Admin SDK is not configured, this function THROWS — it does NOT
// fall back to trusting client claims. This prevents accidental demo-trust in prod.
//
// In dev/preview (NODE_ENV !== production), demo-trust mode is available for testing
// but is explicitly logged as a security warning on every use.
export async function verifyFirebaseToken(idToken: string): Promise<VerifiedToken> {
  const auth = getAdminAuth()

  if (!auth) {
    // Admin SDK not configured.
    if (process.env.NODE_ENV === 'production') {
      // DEV-002 CLOSURE: HARD FAIL in production. No demo-trust fallback.
      throw new Error(
        'FIREBASE_ADMIN_NOT_CONFIGURED: Server-side token verification is required in production. ' +
          'Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.',
      )
    }

    // Dev/preview only: demo-trust mode (explicitly NOT production-safe).
    console.warn(
      '[P0-09] DEMO-TRUST MODE (dev only): Firebase Admin SDK not configured. ' +
        'Token verification is bypassed. This mode is DISABLED in production. ' +
        'Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON to enable real verification.',
    )
    if (idToken.startsWith('demo:')) {
      const parts = idToken.split(':')
      // Strict: must be exactly demo:<phone>:<uid> with non-empty phone and uid
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new Error('Invalid demo token format (expected demo:<phone>:<uid>)')
      }
      const phone = parts[1]
      // Basic phone validation in demo mode
      if (!/^\+?[0-9]{10,15}$/.test(phone)) {
        throw new Error('Invalid phone in demo token (E.164 expected)')
      }
      return { uid: parts[2], phone }
    }
    throw new Error('Invalid demo token format (expected demo:<phone>:<uid>)')
  }

  // Production path: verify the ID token via Firebase Admin SDK.
  // This call verifies: signature, expiry, issuer (project), audience (project).
  // Expired tokens, malformed tokens, wrong-project tokens, and revoked tokens
  // are all rejected here.
  const decoded = await auth.verifyIdToken(idToken, true) // checkRevoked = true
  const phone = decoded.phone_number
  if (!phone) {
    throw new Error('Token has no phone_number claim')
  }
  return {
    uid: decoded.uid,
    phone,
    email: decoded.email,
  }
}

// Check if a request should be rejected due to missing authentication.
// Used by routes that require a verified Firebase identity.
export function requireVerifiedToken(idToken: string | null | undefined): string {
  if (!idToken) {
    throw new Error('MISSING_TOKEN: Firebase ID token required')
  }
  return idToken
}
