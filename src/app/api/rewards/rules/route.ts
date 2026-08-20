import { NextRequest, NextResponse } from 'next/server'
import { db, withTransaction, TransactionConflictError } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { withErrorHandler, apiError, IdempotencyKeyReuseError } from '@/lib/errors'
import { info as logInfo, newTraceId } from '@/lib/logger'
import {
  getIdempotencyKey,
  getCachedResponse,
  storeIdempotencyRecord,
  parseCachedResponse,
  computeRequestHash,
} from '@/lib/idempotency'
import { REWARD_RULES, REWARD_RULE_KEYS, type RewardRuleKey } from '@/lib/reward-rules'

// ----------------------------------------------------------------------------
// Wave 5 Task 5A — GET + PATCH /api/rewards/rules
// ----------------------------------------------------------------------------
// GET  — list all reward rules (DB rows + static-catalog fallback), active
//         first. Any authenticated role can read (used by the Rewards tab UI
//         to show "How to earn" section).
// PATCH — admin-only: toggle a rule's isActive flag (DB rows only).
//
// Auth: getSessionUser() required (401 if no session).
// RBAC:
//   - GET:   any authenticated role.
//   - PATCH: ADMIN + SUPER_ADMIN only.
//
// Catalog vs DB rules:
//   The static catalog in src/lib/reward-rules.ts (REWARD_RULES map) is the
//   single source of truth for points-formula computation. The DB
//   RewardRule rows (seeded in prisma/seed.ts) mirror the catalog for
//   runtime configurability — admins can toggle isActive to disable a rule.
//
//   The dev seed uses LOWERCASE rule keys (first_order, off_peak_order, etc.)
//   while the static catalog uses UPPERCASE (FIRST_ORDER, OFF_PEAK, etc.).
//   The GET endpoint returns BOTH — DB rows + catalog entries — so the UI
//   can show a unified view. Each entry carries:
//     - source: 'db' | 'catalog' — where the rule lives
//     - inDb: boolean — whether the catalog entry also exists as a DB row
//   The PATCH endpoint only affects DB rows (the catalog is read-only at
//   runtime — admins can't disable EARN_BASE without a code change).
//
// Idempotency-Key (PATCH only):
//   - Supported via P0-17. resourceType='RewardRule'.
//
// GET Response: 200 { rules: [...] }
// PATCH Response: 200 { rule: { id, key, name, isActive, updatedAt } }
// Errors: 400 (VALIDATION_ERROR) / 401 (no session) / 403 (RBAC) /
//         404 (rule not found in DB) / 409 (conflict) / 422 (key reuse).
// ----------------------------------------------------------------------------

interface CatalogRuleView {
  source: 'catalog'
  inDb: boolean
  key: RewardRuleKey
  name: string
  description: string
  pointsFormula: unknown
  isActive: boolean
}

interface DbRuleView {
  source: 'db'
  inDb: true
  id: string
  key: string
  name: string
  description: string | null
  pointsFormula: string
  isActive: boolean
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
}

type RuleView = CatalogRuleView | DbRuleView

export const GET = () =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN — any authenticated role.
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

    // -------------------------------------------------------------------------
    // Load all DB rows.
    // -------------------------------------------------------------------------
    const dbRules = await db.rewardRule.findMany({
      orderBy: [{ isActive: 'desc' }, { key: 'asc' }],
    })

    const dbKeys = new Set(dbRules.map((r) => r.key))

    // -------------------------------------------------------------------------
    // Build the unified view: DB rows first (active first), then catalog
    // entries that aren't in the DB.
    // -------------------------------------------------------------------------
    const rules: RuleView[] = []

    for (const r of dbRules) {
      rules.push({
        source: 'db' as const,
        inDb: true,
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        pointsFormula: r.pointsFormula,
        isActive: r.isActive,
        startsAt: r.startsAt ? r.startsAt.toISOString() : null,
        endsAt: r.endsAt ? r.endsAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })
    }

    for (const key of REWARD_RULE_KEYS) {
      // Skip catalog entries already covered by a DB row with the same key.
      if (dbKeys.has(key)) continue
      const def = REWARD_RULES[key]
      rules.push({
        source: 'catalog' as const,
        inDb: false,
        key,
        name: def.name,
        description: def.description,
        pointsFormula: def.pointsFormula,
        isActive: true, // catalog rules are always "active" (read-only)
      })
    }

    // Active first (DB isActive desc), then by key (already sorted above for
    // DB rules; catalog entries are appended after but their order is stable).
    return NextResponse.json({ rules })
  })

// ----------------------------------------------------------------------------
// PATCH /api/rewards/rules — admin-only: toggle isActive by key.
// Body: { key: string, isActive: boolean }
// ----------------------------------------------------------------------------

const IDEMPOTENCY_RESOURCE_TYPE = 'RewardRule'

interface PatchBody {
  key?: unknown
  isActive?: unknown
}

export const PATCH = (req: NextRequest) =>
  withErrorHandler(async () => {
    const traceId = newTraceId()

    // -------------------------------------------------------------------------
    // AuthN
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

    // -------------------------------------------------------------------------
    // RBAC — ADMIN + SUPER_ADMIN only.
    // -------------------------------------------------------------------------
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN']
    if (!allowedRoles.includes(session.role)) {
      return apiError(
        'AUTHORIZATION_DENIED',
        'Only admins can toggle reward rules',
        403,
        { requiredRoles: allowedRoles, actualRole: session.role },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Parse + validate body.
    // -------------------------------------------------------------------------
    let body: PatchBody = {}
    try {
      const text = await req.text()
      if (text.trim().length > 0) {
        body = JSON.parse(text) as PatchBody
      }
    } catch {
      // ignore — falls through to validation
    }
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    const isActive = body.isActive
    if (!key) {
      return apiError(
        'VALIDATION_ERROR',
        'key is required',
        400,
        { field: 'key' },
        traceId,
      ) as unknown as NextResponse
    }
    if (typeof isActive !== 'boolean') {
      return apiError(
        'VALIDATION_ERROR',
        'isActive must be a boolean',
        400,
        { field: 'isActive', received: String(isActive) },
        traceId,
      ) as unknown as NextResponse
    }

    // -------------------------------------------------------------------------
    // Idempotency-Key header (optional but recommended).
    // -------------------------------------------------------------------------
    const idempotencyKey = getIdempotencyKey(req)
    const requestHash = idempotencyKey ? computeRequestHash(body) : null

    try {
      const result = await withTransaction(async (tx) => {
        // -------------------------------------------------------------------
        // P0-17: Check idempotency cache FIRST.
        // -------------------------------------------------------------------
        if (idempotencyKey) {
          const cached = await getCachedResponse(tx, idempotencyKey, requestHash)
          if (cached) {
            logInfo(
              'rewards-rules-patch-idempotency-dedup-hit',
              { key: idempotencyKey, ruleKey: key },
              traceId,
            )
            return { type: 'cached' as const, status: cached.status, body: cached.body }
          }
        }

        // -------------------------------------------------------------------
        // Load the DB row — must exist (PATCH can only toggle DB rows, not
        // catalog entries).
        // -------------------------------------------------------------------
        const existing = await tx.rewardRule.findUnique({ where: { key } })
        if (!existing) {
          return {
            type: 'error' as const,
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: `RewardRule '${key}' not found in DB. Catalog-only rules cannot be toggled.`,
                traceId,
                details: { key, hint: 'Seed this rule into the DB before toggling.' },
              },
            },
          }
        }

        // No-op if the isActive is already the requested value.
        if (existing.isActive === isActive) {
          const idempotentBody = {
            rule: {
              id: existing.id,
              key: existing.key,
              name: existing.name,
              isActive: existing.isActive,
              updatedAt: existing.updatedAt.toISOString(),
            },
            unchanged: true,
          }
          if (idempotencyKey) {
            await storeIdempotencyRecord(
              tx,
              idempotencyKey,
              IDEMPOTENCY_RESOURCE_TYPE,
              existing.id,
              200,
              JSON.stringify(idempotentBody),
              requestHash,
            )
          }
          return { type: 'ok' as const, status: 200, body: idempotentBody }
        }

        // -------------------------------------------------------------------
        // Update the rule's isActive flag.
        // -------------------------------------------------------------------
        const updated = await tx.rewardRule.update({
          where: { key },
          data: { isActive },
        })

        // -------------------------------------------------------------------
        // Audit log — REWARD_RULE_TOGGLED.
        // -------------------------------------------------------------------
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            actorRole: session.role,
            action: 'REWARD_RULE_TOGGLED',
            metadata: JSON.stringify({
              ruleId: updated.id,
              ruleKey: updated.key,
              previousIsActive: existing.isActive,
              newIsActive: updated.isActive,
            }),
          },
        })

        const responseBody = {
          rule: {
            id: updated.id,
            key: updated.key,
            name: updated.name,
            isActive: updated.isActive,
            updatedAt: updated.updatedAt.toISOString(),
          },
          unchanged: false,
        }

        if (idempotencyKey) {
          await storeIdempotencyRecord(
            tx,
            idempotencyKey,
            IDEMPOTENCY_RESOURCE_TYPE,
            updated.id,
            200,
            JSON.stringify(responseBody),
            requestHash,
          )
        }

        return { type: 'success' as const, status: 200, body: responseBody }
      })

      switch (result.type) {
        case 'cached': {
          const parsed = parseCachedResponse({ status: result.status, body: result.body })
          return NextResponse.json(parsed.body, { status: parsed.status })
        }
        case 'error': {
          return NextResponse.json(result.body, { status: result.status })
        }
        case 'ok':
        case 'success': {
          logInfo(
            'rewards-rules-patch-success',
            {
              ruleKey: key,
              isActive,
              unchanged: result.body.unchanged === true,
            },
            traceId,
          )
          return NextResponse.json(result.body, { status: result.status })
        }
        default: {
          // Exhaustiveness guard
          const _exhaustive: never = result
          return NextResponse.json(_exhaustive, { status: 500 })
        }
      }
    } catch (error) {
      if (error instanceof IdempotencyKeyReuseError) {
        logInfo(
          'rewards-rules-patch-idempotency-key-reuse',
          { key: idempotencyKey, code: error.code },
          traceId,
        )
        throw error
      }
      if (error instanceof TransactionConflictError) {
        logInfo(
          'rewards-rules-patch-conflict',
          { attempts: error.attempts, code: error.code, ruleKey: key },
          traceId,
        )
        return apiError(
          'CONFLICT',
          'Reward rule update conflicted with a concurrent request. Please retry.',
          409,
          undefined,
          traceId,
        )
      }
      throw error
    }
  })
