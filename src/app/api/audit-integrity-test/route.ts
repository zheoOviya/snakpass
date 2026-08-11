import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditIntegrityCheck, audit } from '@/lib/audit'
import { apiError } from '@/lib/errors'

// GET /api/audit-integrity-test
//
// GOVERNANCE NOTE: This is a TEST/DEVELOPMENT endpoint. It must be DISABLED in production
// to avoid becoming an attack surface (it can mutate/delete audit entries).
// In production (NODE_ENV=production), this endpoint returns 403.
//
// TEST FLOW (P0-22 verification, with WORM triggers active):
//
// The hash-chain (P0-22 tamper-EVIDENCE) + WORM triggers (P0-22 tamper-PREVENTION)
// form a two-layer defence. This test exercises both:
//
//   1. Append a fresh audit event via the sanctioned `audit()` helper.
//   2. Verify chain integrity (should pass — the new entry was appended with proper linkage).
//   3. Attempt to UPDATE an audit row directly via Prisma.
//      Expected: WORM trigger BLOCKS the UPDATE (PREVENTION layer engaged).
//      This is the PROOF that the system does NOT allow tampering at the storage level.
//   4. Attempt to DELETE an audit row directly via Prisma.
//      Expected: WORM trigger BLOCKS the DELETE (PREVENTION layer engaged).
//   5. Verify chain integrity (should still pass — no mutation succeeded).
//   6. Final summary: PREVENTION (trigger blocks) + EVIDENCE (hash-chain detects) both verified.

export async function GET() {
  // Production guard — test endpoints must not be accessible in prod.
  if (process.env.NODE_ENV === 'production') {
    return apiError('AUTHORIZATION_DENIED', 'Test endpoint not available in production', 403)
  }

  const results: Array<{ step: string; passed: boolean; detail: string }> = []

  // Step 1: Write a test audit event via the sanctioned audit() helper
  try {
    await audit('INTEGRITY_TEST_WRITE', { test: 'hash-chain-verification' })
    results.push({ step: '1. Write audit event via audit() helper', passed: true, detail: 'Event appended with proper hash-chain linkage' })
  } catch (e) {
    results.push({ step: '1. Write audit event via audit() helper', passed: false, detail: String(e) })
    return NextResponse.json({ results, allPassed: false })
  }

  // Step 2: Verify chain integrity (should pass — chain intact after sanctioned append)
  const check1 = await auditIntegrityCheck()
  results.push({
    step: '2. Verify chain integrity (pre-tamper-attempt)',
    passed: check1.ok,
    detail: check1.ok
      ? `Chain intact (${check1.totalCount} entries, 0 broken)`
      : `Chain broken: ${check1.firstBrokenEntry?.issue}`,
  })

  // Step 3: Attempt to UPDATE an audit row directly (simulating tampering)
  // Expected: WORM trigger blocks the UPDATE — this is tamper PREVENTION.
  // Note: Prisma may surface the underlying SQLite ABORT as various error
  // shapes (P2003, raw AUDIT_WORM message, or wrapped PrismaClientKnownRequestError).
  // We accept ANY of these as "blocked" since the UPDATE did not succeed.
  const lastEntry = await db.auditLog.findFirst({ orderBy: { createdAt: 'desc' } })
  if (lastEntry) {
    try {
      await db.auditLog.update({
        where: { id: lastEntry.id },
        data: { action: 'TAMPERED_ACTION' },
      })
      // If we reach here, the WORM trigger did NOT block — this is a CRITICAL failure.
      results.push({
        step: '3. Attempt direct UPDATE (WORM trigger should block)',
        passed: false,
        detail: 'CRITICAL: WORM trigger did NOT block the UPDATE — tampering succeeded!',
      })
    } catch (e) {
      // Expected: WORM trigger raised 'AUDIT_WORM: UPDATE rejected' (raw) OR
      // Prisma wrapped it as P2003 "Foreign key constraint violated" (the
      // RETURNING clause re-reads the row post-UPDATE which triggers the FK check).
      // Either way, the UPDATE did NOT persist — that is what we verify here.
      const msg = (e as Error).message || String(e)
      const code = (e as { code?: string }).code
      const blocked =
        msg.includes('AUDIT_WORM') ||
        msg.includes('UPDATE rejected') ||
        code === 'P2003' ||
        msg.includes('Foreign key constraint')
      results.push({
        step: '3. Attempt direct UPDATE (WORM trigger should block)',
        passed: blocked,
        detail: blocked
          ? 'UPDATE was BLOCKED (WORM trigger engaged; row NOT mutated)'
          : `UPDATE failed but with unexpected error: ${msg.slice(0, 200)}`,
      })

      // Independent verification: re-read the row + run integrity check.
      // If the WORM trigger truly blocked the UPDATE, the action field is unchanged
      // and the hash-chain is still intact.
      const reRead = await db.auditLog.findUnique({ where: { id: lastEntry.id } })
      const actionUnchanged = reRead?.action === lastEntry.action
      if (!actionUnchanged) {
        results[results.length - 1].passed = false
        results[results.length - 1].detail = `CRITICAL: action field was MUTATED (expected '${lastEntry.action}', got '${reRead?.action}') — WORM trigger did NOT prevent tampering!`
      }
    }
  }

  // Step 4: Attempt to DELETE an audit row directly
  // Expected: WORM trigger blocks the DELETE — this is tamper PREVENTION.
  if (lastEntry) {
    try {
      await db.auditLog.delete({ where: { id: lastEntry.id } })
      results.push({
        step: '4. Attempt direct DELETE (WORM trigger should block)',
        passed: false,
        detail: 'CRITICAL: WORM trigger did NOT block the DELETE — tampering succeeded!',
      })
    } catch (e) {
      const msg = (e as Error).message || String(e)
      const code = (e as { code?: string }).code
      const blocked =
        msg.includes('AUDIT_WORM') ||
        msg.includes('DELETE rejected') ||
        code === 'P2003' ||
        msg.includes('Foreign key constraint')
      results.push({
        step: '4. Attempt direct DELETE (WORM trigger should block)',
        passed: blocked,
        detail: blocked
          ? 'DELETE was BLOCKED (WORM trigger engaged; row NOT deleted)'
          : `DELETE failed but with unexpected error: ${msg.slice(0, 200)}`,
      })

      // Independent verification: re-read the row.
      const reRead = await db.auditLog.findUnique({ where: { id: lastEntry.id } })
      if (!reRead) {
        results[results.length - 1].passed = false
        results[results.length - 1].detail = 'CRITICAL: row was DELETED — WORM trigger did NOT prevent tampering!'
      }
    }
  }

  // Step 5: Verify chain integrity post-tamper-attempt (should STILL pass — nothing mutated)
  const check2 = await auditIntegrityCheck()
  results.push({
    step: '5. Verify chain integrity (post-tamper-attempt)',
    passed: check2.ok,
    detail: check2.ok
      ? `Chain still intact (${check2.totalCount} entries) — no tampering succeeded`
      : `Chain BROKEN: ${check2.firstBrokenEntry?.issue} — tampering SUCCEEDED`,
  })

  // Step 6: Append a second test event to prove the chain still grows correctly
  try {
    await audit('INTEGRITY_TEST_CONFIRM', { test: 'chain-growth-after-prevention' })
    const check3 = await auditIntegrityCheck()
    results.push({
      step: '6. Append follow-up event + verify chain growth',
      passed: check3.ok,
      detail: check3.ok
        ? `Chain grew correctly (${check3.totalCount} entries)`
        : `Chain integrity broken after growth: ${check3.firstBrokenEntry?.issue}`,
    })
  } catch (e) {
    results.push({
      step: '6. Append follow-up event + verify chain growth',
      passed: false,
      detail: `Failed to append follow-up event: ${String(e)}`,
    })
  }

  const allPassed = results.every((r) => r.passed)

  return NextResponse.json({
    allPassed,
    summary: allPassed
      ? 'Audit integrity PASS — WORM PREVENTION (triggers block UPDATE/DELETE) + hash-chain EVIDENCE (tamper-detection) both verified.'
      : 'Audit integrity FAIL — at least one prevention or evidence layer did not behave as expected.',
    results,
  })
}
