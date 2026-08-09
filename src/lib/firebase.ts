'use client'

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics'
import { getAuth, type Auth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult, type User as FbUser } from 'firebase/auth'

// Firebase Authentication — phone OTP.
//
// Configure with NEXT_PUBLIC_FIREBASE_* env vars to enable REAL SMS OTP delivery.
// Firebase Phone Auth also requires:
//   1. Phone Authentication enabled in the Firebase console (Authentication → Sign-in method).
//   2. Project on the Blaze (pay) plan — phone auth requires billing.
//   3. This domain added to Authorized domains.
// When Firebase is unavailable or the phone-auth call is rejected, the login UI
// falls back to the demo OTP service (see src/lib/otp-service.ts + /api/auth/otp/*)
// so the app stays usable.
//
// Analytics is initialized lazily (only in the browser, only if supported) —
// matches the Firebase console snippet the user pasted.

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
)

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let analyticsInstance: Analytics | null = null

function ensureApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as Record<string, string>)
  }
  return app
}

export function getFirebaseAuth(): Auth | null {
  const a = ensureApp()
  if (!a) return null
  if (!authInstance) {
    authInstance = getAuth(a)
    // Use Hindi locale for the SMS OTP if the browser supports it.
    try {
      authInstance.languageCode = 'hi'
    } catch {
      /* ignore */
    }
  }
  return authInstance
}

// Lazy analytics — only initialized in a browser that supports it.
export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  const a = ensureApp()
  if (!a) return null
  if (analyticsInstance) return analyticsInstance
  try {
    const ok = await isSupported()
    if (!ok) return null
    analyticsInstance = getAnalytics(a)
    return analyticsInstance
  } catch {
    return null
  }
}

// Build an invisible reCAPTCHA verifier (required by Firebase phone auth).
// `containerId` is the DOM id where reCAPTCHA may render its badge.
export function makeRecaptcha(containerId: string): RecaptchaVerifier {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase not configured')
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {},
    'expired-callback': () => {},
  })
}

// Send a real OTP via Firebase. Returns a ConfirmationResult the caller later
// calls `.confirm(code)` on.
export async function sendFirebaseOtp(
  phone: string,
  recaptcha: RecaptchaVerifier,
): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase not configured')
  return signInWithPhoneNumber(auth, phone, recaptcha)
}

export type { ConfirmationResult, FbUser }
