import { randomUUID } from 'crypto'

// P0-19 — Structured logging
// Every critical path logs a structured event with a trace id.
// Control/Enabler (Architectural Law 6): detects failures, does not enforce invariants.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  traceId?: string
  [key: string]: unknown
}

// Generate or reuse a trace id for request correlation.
export function newTraceId(): string {
  return randomUUID()
}

function emit(entry: LogEntry): void {
  // Structured JSON to stdout — parseable by any log aggregator.
  // In production this would go to a structured log sink (e.g. CloudWatch, Loki).
  const line = JSON.stringify(entry)
  if (entry.level === 'error') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export function log(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {},
  traceId?: string,
): void {
  emit({
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId,
    ...context,
  })
}

export function info(message: string, context: Record<string, unknown> = {}, traceId?: string) {
  log('info', message, context, traceId)
}

export function warn(message: string, context: Record<string, unknown> = {}, traceId?: string) {
  log('warn', message, context, traceId)
}

export function error(message: string, context: Record<string, unknown> = {}, traceId?: string) {
  log('error', message, context, traceId)
}

export function debug(message: string, context: Record<string, unknown> = {}, traceId?: string) {
  if (process.env.LOG_LEVEL === 'debug') {
    log('debug', message, context, traceId)
  }
}

// Domain-specific log helpers for P0-critical events.
export const p0Log = {
  payment: (event: string, context: Record<string, unknown> = {}, traceId?: string) =>
    info(`[P0-PAYMENT] ${event}`, context, traceId),
  order: (event: string, context: Record<string, unknown> = {}, traceId?: string) =>
    info(`[P0-ORDER] ${event}`, context, traceId),
  auth: (event: string, context: Record<string, unknown> = {}, traceId?: string) =>
    info(`[P0-AUTH] ${event}`, context, traceId),
  invariant: (invariantId: string, violation: string, context: Record<string, unknown> = {}, traceId?: string) =>
    error(`[P0-INVARIANT-VIOLATION] ${invariantId}: ${violation}`, context, traceId),
  exception: (event: string, context: Record<string, unknown> = {}, traceId?: string) =>
    error(`[P0-EXCEPTION] ${event}`, context, traceId),
}
