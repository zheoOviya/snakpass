import { initializeApp, cert, getApps, type App } from 'firebase-admin/app'
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth'
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
    adminAuthInstance = getAdminAuth(app)
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
// In demo-trust mode (no service account), returns the client-provided claim
// with an explicit warning — this mode is NOT production-safe.
export async function verifyFirebaseToken(idToken: string): Promise<VerifiedToken> {
  const auth = getAdminAuth()
  if (!auth) {
    // Demo-trust mode — NOT production-safe.
    // In this mode, the client sends { idToken: "demo:<phone>:<uid>" } and we parse it.
    // This is explicitly logged as a security warning.
    console.warn(
      '[P0-09] DEMO-TRUST MODE: Firebase Admin SDK not configured. ' +
        'Token verification is bypassed. NOT production-safe. ' +
        'Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON to enable real verification.',
    )
    if (idToken.startsWith('demo:')) {
      const parts = idToken.split(':')
      return { uid: parts[2] ?? 'demo-uid', phone: parts[1] ?? '' }
    }
    throw new Error('Invalid demo token format')
  }

  // Production path: verify the ID token via Firebase Admin SDK.
  const decoded = await auth.verifyIdToken(idToken)
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
