'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Snowflake,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { csrfFetch } from '@/lib/csrf-client'
import { timeAgo } from '@/lib/snack'

// ----------------------------------------------------------------------------
// Wave 8 Task 8 — Fraud/Risk admin module
// ----------------------------------------------------------------------------
// Three sections:
//   1. ExceptionQueue list (GET /api/exceptions — admin-only).
//   2. Resolution workflow — assign + resolve with note (POST /api/exceptions/resolve).
//   3. Suspicious activity flags (placeholder — empty state for MVP).
// ----------------------------------------------------------------------------

interface ExceptionRow {
  id: string
  invariant: string
  entityType: string
  entityId: string
  freezeLevel: number
  description: string
  createdAt: string
}

const FREEZE_LABEL: Record<number, { label: string; tone: string }> = {
  1: { label: 'L1 · Transaction', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  2: { label: 'L2 · Entity', tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
  3: { label: 'L3 · System', tone: 'bg-red-500/15 text-red-700 dark:text-red-300' },
}

export function FraudRiskModule() {
  const { toast } = useToast()
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [resolveTarget, setResolveTarget] = useState<ExceptionRow | null>(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolveAssignInput, setResolveAssignInput] = useState('')
  const [resolving, setResolving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/exceptions', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const d = await res.json()
      setExceptions(d.exceptions ?? [])
    } catch (e) {
      toast({
        title: 'Exceptions load failed',
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

  const openResolve = (ex: ExceptionRow) => {
    setResolveTarget(ex)
    setResolveNote('')
    setResolveAssignInput('')
  }

  const submitResolve = useCallback(async () => {
    if (!resolveTarget) return
    if (!resolveNote.trim()) {
      toast({ title: 'Resolution note required', variant: 'destructive' })
      return
    }
    setResolving(true)
    try {
      const res = await csrfFetch('/api/exceptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          exceptionId: resolveTarget.id,
          resolutionNote: resolveNote.trim(),
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Failed (${res.status}) ${text}`)
      }
      toast({
        title: 'Exception resolved',
        description: `${resolveTarget.invariant} cleared`,
      })
      setResolveTarget(null)
      setResolveNote('')
      await refresh()
    } catch (e) {
      toast({
        title: 'Resolve failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    } finally {
      setResolving(false)
    }
  }, [resolveTarget, resolveNote, toast, refresh])

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------------------- */}
      {/* Header */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-600" />
          <h3 className="text-base font-semibold">Fraud / Risk</h3>
          {exceptions.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {exceptions.length} open
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* ExceptionQueue list */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Snowflake className="h-4 w-4 text-blue-600" /> Exception Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))}
            </div>
          ) : exceptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950/10">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                No open exceptions — system invariants OK.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Exceptions from the P0-28 invariant-checker + reconciliation pipeline will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {exceptions.map((ex) => {
                const freeze = FREEZE_LABEL[ex.freezeLevel] ?? FREEZE_LABEL[1]
                return (
                  <motion.div
                    key={ex.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-red-200 bg-red-50/30 p-3 dark:border-red-900 dark:bg-red-950/10"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <span className="text-sm font-semibold">{ex.invariant}</span>
                          <Badge className={freeze.tone}>{freeze.label}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{ex.description}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>Entity: <code className="font-mono">{ex.entityType} · {ex.entityId.slice(-8)}</code></span>
                          <span>Detected: {timeAgo(ex.createdAt)}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-teal-600 hover:bg-teal-700"
                        onClick={() => openResolve(ex)}
                      >
                        Resolve
                      </Button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Suspicious activity flags (placeholder) */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Suspicious Activity Flags
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
            No suspicious activity detected.
            <p className="mt-1 text-xs">
              Future ML-based anomaly detection (velocity, geo, behavior) will populate this section.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Resolve dialog */}
      {/* ----------------------------------------------------------------- */}
      <Dialog
        open={resolveTarget !== null}
        onOpenChange={(o) => {
          if (!o) setResolveTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Snowflake className="h-4 w-4 text-blue-600" /> Resolve exception
            </DialogTitle>
            <DialogDescription>
              {resolveTarget ? (
                <span>
                  Resolve <span className="font-medium text-foreground">{resolveTarget.invariant}</span>
                  {' '}— clears the applied freeze (Level {resolveTarget.freezeLevel}) and records
                  your note in the audit trail.
                </span>
              ) : (
                'Resolve the selected exception.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="assign-input" className="text-xs text-muted-foreground">
                Assign to (admin user ID — optional)
              </Label>
              <Input
                id="assign-input"
                placeholder="cmt...  (optional, not persisted server-side in MVP)"
                value={resolveAssignInput}
                onChange={(e) => setResolveAssignInput(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Field is informational for MVP. Server stores resolvedBy = current session.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="note-input" className="text-xs text-muted-foreground">
                Resolution note *
              </Label>
              <Input
                id="note-input"
                placeholder="Root cause + remediation"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !resolving) void submitResolve()
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              disabled={resolving || !resolveNote.trim()}
              onClick={() => void submitResolve()}
            >
              {resolving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Confirm resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
