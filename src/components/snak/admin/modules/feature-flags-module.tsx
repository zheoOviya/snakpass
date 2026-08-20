'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Flag, Loader2, Lock, RefreshCw, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — Feature Flags admin module (READ-ONLY)
// ----------------------------------------------------------------------------
// Governance (blueprint §50):
//   - This module DISPLAYS the current state of each feature flag from
//     src/lib/deployment.ts. It does NOT provide a toggle UI.
//   - Production activation requires separate Orchestrator authorization.
//   - The src/lib/deployment.ts file is NOT modified by this task.
//
// Calls:
//   - GET /api/admin/feature-flags (admin-only — returns the flag catalog).
// ----------------------------------------------------------------------------

interface FeatureFlagView {
  catalogKey: string
  key: string
  label: string
  description: string
  enabled: boolean
}

export function FeatureFlagsModule() {
  const { toast } = useToast()
  const [flags, setFlags] = useState<FeatureFlagView[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/feature-flags', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const d = await res.json()
      setFlags(d.flags ?? [])
    } catch (e) {
      toast({
        title: 'Feature flags load failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeCount = flags.filter((f) => f.enabled).length
  const totalCount = flags.length

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------------------- */}
      {/* Header */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-purple-600" />
          <h3 className="text-base font-semibold">Feature Flags</h3>
          <Badge variant="outline" className="text-[10px]">
            {activeCount}/{totalCount} active
          </Badge>
          <Badge variant="secondary" className="text-[10px]">Read-only</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Governance notice */}
      {/* ----------------------------------------------------------------- */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20"
      >
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            Toggle requires Orchestrator authorization
          </p>
          <p className="mt-0.5 text-amber-700/80 dark:text-amber-400/80">
            Feature flags are environment-based (blueprint §50). Production activation requires
            separate sign-off from the Orchestrator role — this admin view is informational only.
          </p>
        </div>
      </motion.div>

      {/* ----------------------------------------------------------------- */}
      {/* Flag list */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-teal-600" /> Flag catalog ({totalCount})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : flags.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No feature flags defined in the catalog.
            </div>
          ) : (
            <div className="space-y-2">
              {flags.map((f) => (
                <motion.div
                  key={f.catalogKey}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                    f.enabled
                      ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/15'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{f.label}</span>
                      <Badge
                        variant={f.enabled ? 'default' : 'outline'}
                        className={
                          f.enabled
                            ? 'bg-emerald-600 text-white text-[10px]'
                            : 'text-[10px] text-muted-foreground'
                        }
                      >
                        {f.enabled ? 'ON' : 'OFF'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>catalog key: <code className="font-mono">{f.catalogKey}</code></span>
                      <span>flag key: <code className="font-mono">{f.key}</code></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span>Locked</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
          {loading && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading flag catalog…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
