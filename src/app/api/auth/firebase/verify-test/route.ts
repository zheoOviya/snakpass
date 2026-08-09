import { NextResponse } from 'next/server'
import { verifyFirebaseToken, isAdminConfigured } from '@/lib/firebase-admin'
import { withErrorHandler } from '@/lib/errors'

// GET /api/auth/firebase/verify-test
//
// DEV-002 CLOSURE: Verification test harness.
// Exercises all token verification paths and reports results.
// This endpoint is for testing only — it should be removed or gated in production.

interface TestResult {
  name: string
  input: string
  expected: 'accept' | 'reject'
  actual: 'accept' | 'reject'
  passed: boolean
  detail?: string
}

async function runTest(name: string, input: string, expected: 'accept' | 'reject'): Promise<TestResult> {
  try {
    await verifyFirebaseToken(input)
    const actual: 'accept' | 'reject' = 'accept'
    return {
      name,
      input,
      expected,
      actual,
      passed: actual === expected,
      detail: 'Token accepted',
    }
  } catch (e) {
    const actual: 'accept' | 'reject' = 'reject'
    return {
      name,
      input,
      expected,
      actual,
      passed: actual === expected,
      detail: (e as Error).message,
    }
  }
}

export const GET = () => withErrorHandler(async () => {
  const adminConfigured = isAdminConfigured()
  const isProd = process.env.NODE_ENV === 'production'

  const results: TestResult[] = []

  // Test 1: Missing/empty token → reject
  results.push(await runTest('missing-token', '', 'reject'))

  // Test 2: Malformed token (random string) → reject
  results.push(await runTest('malformed-token', 'not-a-valid-token-at-all', 'reject'))

  // Test 3: Malformed demo token (wrong format) → reject
  results.push(await runTest('malformed-demo-format', 'demo:onlyonepart', 'reject'))

  if (!adminConfigured && !isProd) {
    // Dev demo-trust mode tests
    results.push(await runTest('valid-demo-token', 'demo:+919876500001:test-uid-123', 'accept'))
    results.push(await runTest('demo-token-no-phone', 'demo::test-uid', 'reject'))
  }

  if (adminConfigured) {
    // Production verification tests (require real Firebase tokens)
    results.push({
      name: 'valid-production-token',
      input: '(requires real Firebase ID token — test manually)',
      expected: 'accept',
      actual: 'not-tested',
      passed: false,
      detail: 'Manual test required: POST a real Firebase ID token to /api/auth/firebase/session',
    })
    results.push({
      name: 'expired-token',
      input: '(requires expired Firebase ID token — test manually)',
      expected: 'reject',
      actual: 'not-tested',
      passed: false,
      detail: 'Manual test required: use an expired token',
    })
    results.push({
      name: 'wrong-project-token',
      input: '(requires token from different Firebase project — test manually)',
      expected: 'reject',
      actual: 'not-tested',
      passed: false,
      detail: 'Manual test required: use a token from a different project',
    })
    results.push({
      name: 'revoked-token',
      input: '(requires revoked Firebase user — test manually)',
      expected: 'reject',
      actual: 'not-tested',
      passed: false,
      detail: 'Manual test required: revoke user in Firebase, then use their token',
    })
  }

  if (isProd && !adminConfigured) {
    // Production without Admin SDK — should HARD FAIL
    results.push(await runTest('prod-no-admin-sdk-hard-fail', 'demo:+919876500001:test-uid', 'reject'))
  }

  const allPassed = results.every((r) => r.passed)

  return NextResponse.json({
    adminConfigured,
    environment: process.env.NODE_ENV,
    demoTrustAvailable: !adminConfigured && !isProd,
    allPassed,
    results,
  })
})
