'use client'

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth'

// Firebase Authentication — phone OTP.
//
// Configure with NEXT_PUBLIC_FIREBASE_* env vars to enable REAL SMS OTP delivery.
// When these are absent (e.g. this sandbox) we fall back to a server-side demo
// OTP service (see src/lib/otp-service.ts + /api/auth/otp/*). The verify flow
// is identical either way: the caller posts { otpId, code } to /api/auth/otp/verify.
//
// To enable real Firebase:
//   NEXT_PUBLIC_FIREBASE_API_KEY=...
//   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
//   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
//   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
//   NEXT_PUBLIC_FIREBASE_APP_ID=...

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

let app: FirebaseApp | null = null
let authInstance: Auth | null = null

export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured) return null
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as Record<string, string>)
    authInstance = getAuth(app)
  }
  return authInstance
}

// Build an invisible reCAPTCHA verifier (required by Firebase phone auth).
export function makeRecaptcha(containerId: string): RecaptchaVerifier {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase not configured')
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {},
  })
}

// Send a real OTP via Firebase. Returns a ConfirmationResult the caller later
// calls `.confirm(code)` on. NOT used in demo mode.
export async function sendFirebaseOtp(
  phone: string,
  recaptcha: RecaptchaVerifier,
): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase not configured')
  return signInWithPhoneNumber(auth, phone, recaptcha)
}
