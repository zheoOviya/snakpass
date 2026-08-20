'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Coins, Gift, Loader2, RefreshCw, Search, ShieldCheck, Sparkles, Ticket } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { csrfFetch } from '@/lib/csrf-client'
import { timeAgo } from '@/lib/snack'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — Rewards admin module
// ----------------------------------------------------------------------------
// Three sections:
//   1. Paginated ledger list (filters: userId, type, date range).
//   2. Redeem-code lookup (input redemption code → return the RewardRedemption).
//   3. Rule management (list rules + toggle isActive via PATCH /api/rewards/rules).
//
// Calls:
//   - GET    /api/admin/rewards/ledger?page=&limit=&userId=&type=&from=&to=
//   - GET    /api/admin/rewards/redemption?code=SNZ-RWD-XXXXXX
//   - GET    /api/rewards/rules                (consumer-readable)
//   - PATCH  /api/rewards/rules                (admin-only — toggle isActive)
// ----------------------------------------------------------------------------

interface LedgerEntry {
  id: string
  userId: string
  type: string
  points: number
  orderId?: string | null
  ruleId?: string | null
  rule: { key: string; name: string } | null
  idempotencyKey: string
  expiresAt: string | null
  createdAt: string
}

interface LedgerResponse {
  entries: LedgerEntry[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

type RuleView =
  | {
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
  | {
      source: 'catalog'
      inDb: false
      key: string
      name: string
      description: string
      pointsFormula: unknown
      isActive: boolean
    }

interface RedemptionLookup {
  redemption: {
    id: string
    userId: string
    ledgerEntryId: string
    rewardType: string
    discountValue: string
    orderId?: string | null
    redemptionCode: string
    redeemedAt: string
  }
  ledgerEntry: {
    id: string
    userId: string
    type: string
    points: number
    orderId?: string | null
    ruleId?: string | null
    rule: { key: string; name: string } | null
    idempotencyKey: string
    expiresAt: string | null
    createdAt: string
  } | null
}

const TYPE_TONE: Record<string, string> = {
  EARN: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  REDEEM: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  EXPIRE: 'bg-red-500/15 text-red-700 dark:text-red-300',
  ADJUST: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
}

const PAGE_SIZE = 20

export function RewardsModule() {
  const { toast } = useToast()

  // -----------------------------------------------------------------------
  // Ledger state + filters.
  // -----------------------------------------------------------------------
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingLedger, setLoadingLedger] = useState(true)
  const [filterUserId, setFilterUserId] = useState('')
  const [filterType, setFilterType] = useState<string>('ALL')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  // -----------------------------------------------------------------------
  // Redemption lookup state.
  // -----------------------------------------------------------------------
  const [codeInput, setCodeInput] = useState('')
  const [lookup, setLookup] = useState<RedemptionLookup | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  // -----------------------------------------------------------------------
  // Rules state.
  // -----------------------------------------------------------------------
  const [rules, setRules] = useState<RuleView[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)

  const refreshLedger = useCallback(
    async (targetPage: number) => {
      setLoadingLedger(true)
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(PAGE_SIZE),
        })
        if (filterUserId.trim()) params.set('userId', filterUserId.trim())
        if (filterType !== 'ALL') params.set('type', filterType)
        if (filterFrom) params.set('from', new Date(filterFrom).toISOString())
        if (filterTo) {
          // End-of-day for the 'to' filter.
          const d = new Date(filterTo)
          d.setHours(23, 59, 59, 999)
          params.set('to', d.toISOString())
        }
        const res = await fetch(`/api/admin/rewards/ledger?${params.toString()}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const d: LedgerResponse = await res.json()
        setEntries(d.entries)
        setTotal(d.total)
        setPage(d.page)
        setHasMore(d.hasMore)
      } catch (e) {
        toast({
          title: 'Ledger load failed',
          description: (e as Error).message,
          variant: 'destructive',
        })
      } finally {
        setLoadingLedger(false)
      }
    },
    [filterUserId, filterType, filterFrom, filterTo, toast],
  )

  const refreshRules = useCallback(async () => {
    setRulesLoading(true)
    try {
      const res = await fetch('/api/rewards/rules', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const d = await res.json()
      setRules(d.rules ?? [])
    } catch (e) {
      toast({
        title: 'Rules load failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setRulesLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refreshLedger(1)
  }, [refreshLedger])

  useEffect(() => {
    void refreshRules()
  }, [refreshRules])

  const applyFilters = () => {
    setPage(1)
    void refreshLedger(1)
  }

  const clearFilters = () => {
    setFilterUserId('')
    setFilterType('ALL')
    setFilterFrom('')
    setFilterTo('')
    // Defer the refresh — setState is async; we'll trigger refresh on next tick.
    setTimeout(() => void refreshLedger(1), 0)
  }

  const lookupCode = useCallback(async () => {
    const code = codeInput.trim()
    if (!code) {
      toast({ title: 'Enter a code', variant: 'destructive' })
      return
    }
    setLookupLoading(true)
    try {
      const res = await fetch(
        `/api/admin/rewards/redemption?code=${encodeURIComponent(code)}`,
        { cache: 'no-store' },
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Failed (${res.status}) ${text}`)
      }
      const d: RedemptionLookup = await res.json()
      setLookup(d)
      toast({
        title: 'Redemption found',
        description: `${d.redemption.rewardType}${d.ledgerEntry ? ` · ${d.ledgerEntry.points} pts` : ''}`,
      })
    } catch (e) {
      setLookup(null)
      toast({
        title: 'Lookup failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setLookupLoading(false)
    }
  }, [codeInput, toast])

  const toggleRule = useCallback(
    async (rule: RuleView) => {
      if (rule.source !== 'db') {
        toast({
          title: 'Cannot toggle catalog rule',
          description: 'Catalog rules are read-only — seed into DB to enable toggling.',
          variant: 'destructive',
        })
        return
      }
      const next = !rule.isActive
      setTogglingKey(rule.key)
      // Optimistic update.
      setRules((rs) =>
        rs.map((r) =>
          r.source === 'db' && r.key === rule.key ? { ...r, isActive: next } : r,
        ),
      )
      try {
        const res = await csrfFetch('/api/rewards/rules', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: rule.key, isActive: next }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`Failed (${res.status}) ${text}`)
        }
        toast({
          title: `${rule.name} ${next ? 'enabled' : 'disabled'}`,
          variant: next ? 'default' : 'destructive',
        })
      } catch (e) {
        // Rollback.
        setRules((rs) =>
          rs.map((r) =>
            r.source === 'db' && r.key === rule.key ? { ...r, isActive: !next } : r,
          ),
        )
        toast({
          title: 'Toggle failed',
          description: (e as Error).message,
          variant: 'destructive',
        })
      } finally {
        setTogglingKey(null)
      }
    },
    [toast],
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------------------- */}
      {/* Header */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-amber-600" />
          <h3 className="text-base font-semibold">Rewards Admin</h3>
          <Badge variant="secondary" className="text-[10px]">{total} ledger rows</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void refreshLedger(page); void refreshRules() }}
        >
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Ledger section */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-amber-600" /> Reward Ledger
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="filter-userId">
                User ID
              </Label>
              <Input
                id="filter-userId"
                placeholder="cmt1..."
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="EARN">EARN</SelectItem>
                  <SelectItem value="REDEEM">REDEEM</SelectItem>
                  <SelectItem value="EXPIRE">EXPIRE</SelectItem>
                  <SelectItem value="ADJUST">ADJUST</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="filter-from">
                From
              </Label>
              <Input
                id="filter-from"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="filter-to">
                To
              </Label>
              <Input
                id="filter-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" className="h-9 bg-teal-600 hover:bg-teal-700" onClick={applyFilters}>
                <Search className="mr-1 h-3.5 w-3.5" /> Apply
              </Button>
              <Button size="sm" variant="outline" className="h-9" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>

          {/* Ledger table */}
          {loadingLedger ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No ledger entries match these filters.
            </div>
          ) : (
            <div className="max-h-96 overflow-auto snak-scroll">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Type</th>
                    <th className="py-2 pr-2 font-medium">Points</th>
                    <th className="py-2 pr-2 font-medium">User</th>
                    <th className="py-2 pr-2 font-medium">Rule</th>
                    <th className="py-2 pr-2 font-medium">Order</th>
                    <th className="py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <motion.tr
                      key={e.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b last:border-0"
                    >
                      <td className="py-2 pr-2">
                        <Badge className={TYPE_TONE[e.type] ?? 'bg-gray-500/15 text-gray-700'}>
                          {e.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2 font-medium">
                        <span className={e.points >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                          {e.points >= 0 ? '+' : ''}{e.points}
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
                        {e.userId.slice(-8)}
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        {e.rule ? (
                          <span><span className="font-medium">{e.rule.name}</span>{' '}<span className="text-muted-foreground">({e.rule.key})</span></span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs">
                        {e.orderId ? e.orderId.slice(-8) : '—'}
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {timeAgo(e.createdAt)}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loadingLedger && total > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} · {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={page <= 1}
                  onClick={() => void refreshLedger(page - 1)}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!hasMore}
                  onClick={() => void refreshLedger(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Redemption code lookup */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Ticket className="h-4 w-4 text-teal-600" /> Redeem Code Lookup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="SNZ-RWD-XXXXXX"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookupCode()
              }}
              className="font-mono uppercase"
            />
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              disabled={lookupLoading}
              onClick={() => void lookupCode()}
            >
              {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Lookup
            </Button>
          </div>

          {lookup && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-lg border border-teal-200 bg-teal-50/50 p-4 dark:border-teal-900 dark:bg-teal-950/20"
            >
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-teal-600" />
                <span className="font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">
                  {lookup.redemption.redemptionCode}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                <div><dt className="text-muted-foreground">User</dt><dd className="font-mono">{lookup.redemption.userId.slice(-8)}</dd></div>
                <div><dt className="text-muted-foreground">Type</dt><dd>{lookup.redemption.rewardType}</dd></div>
                <div><dt className="text-muted-foreground">Discount</dt><dd className="font-mono">{lookup.redemption.discountValue}</dd></div>
                <div><dt className="text-muted-foreground">Order</dt><dd className="font-mono">{lookup.redemption.orderId ? lookup.redemption.orderId.slice(-8) : '—'}</dd></div>
                <div><dt className="text-muted-foreground">Points</dt><dd>{lookup.ledgerEntry?.points ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">Redeemed</dt><dd>{timeAgo(lookup.redemption.redeemedAt)}</dd></div>
              </dl>
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Rule management */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gift className="h-4 w-4 text-purple-600" /> Reward Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rulesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No reward rules configured.
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => {
                const isDb = r.source === 'db'
                const isToggling = togglingKey === (r.source === 'db' ? r.key : null)
                return (
                  <div
                    key={`${r.source}-${r.key}`}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{r.name}</span>
                        <Badge
                          variant={isDb ? 'secondary' : 'outline'}
                          className="text-[10px] uppercase"
                        >
                          {isDb ? 'DB' : 'catalog'}
                        </Badge>
                        <code className="text-xs text-muted-foreground">{r.key}</code>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.description ?? 'No description.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${r.isActive ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {isDb ? (
                        isToggling ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Switch
                            checked={r.isActive}
                            onCheckedChange={() => void toggleRule(r)}
                            aria-label={`Toggle rule ${r.key}`}
                          />
                        )
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Read-only</Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
