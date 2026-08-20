import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError } from '@/lib/errors'
import { newTraceId } from '@/lib/logger'
import { FEATURE_FLAGS } from '@/lib/deployment'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — GET /api/admin/feature-flags
// ----------------------------------------------------------------------------
// Read-only enumeration of all feature flags from src/lib/deployment.ts.
//
// Governance (blueprint §50):
//   - This endpoint returns the CURRENT state of each flag. It does NOT
//     provide a toggle (PATCH/POST). Production activation requires
//     separate Orchestrator authorization.
//   - The src/lib/deployment.ts file is NOT modified by this task.
//
// Auth: getSessionUser() required (401 if no session).
// RBAC: ADMIN + SUPER_ADMIN only (403 otherwise).
//
// Response: 200 { flags: [{ key, label, description, enabled }] }
//
// `label` is derived from the catalog key (human-readable Title-Case).
// ----------------------------------------------------------------------------

function labelFromKey(key: string): string {
  // 'realPayments' → 'Real Payments'
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim()
}

export const GET = withErrorHandler(async () => {
  const traceId = newTraceId()

  // -------------------------------------------------------------------------
  // AuthN + RBAC — ADMIN + SUPER_ADMIN only.
  // -------------------------------------------------------------------------
  const session = await getSessionUser()
  if (!session) {
    return apiError(
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      401,
      undefined,
      traceId,
    ) as unknown as NextResponse
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    return apiError(
      'AUTHORIZATION_DENIED',
      'Only admins can view feature flags',
      403,
      { requiredRoles: ['ADMIN', 'SUPER_ADMIN'], actualRole: session.role },
      traceId,
    ) as unknown as NextResponse
  }

  // -------------------------------------------------------------------------
  // Enumerate flags from the deployment catalog (READ-ONLY).
  // -------------------------------------------------------------------------
  const flags = Object.entries(FEATURE_FLAGS).map(([catalogKey, def]) => ({
    catalogKey,
    key: def.key,
    label: labelFromKey(catalogKey),
    description: def.description,
    enabled: def.enabled,
  }))

  return NextResponse.json({ flags })
})
