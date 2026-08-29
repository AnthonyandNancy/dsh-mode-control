/**
 * Pure reasoning capability helpers.
 *
 * This module deliberately contains no JSX and no settings mutation. It owns
 * the boundary between:
 *
 * - authoring capabilities (`ModelDraft.reasoningMode` / `efforts`), and
 * - DSH runtime exact-model truth (`api.llm.models()` → group.model.reasoning).
 *
 * Provider defaults are NEVER treated as model capabilities: a provider-level
 * `reasoning = max` does not mean every model on that route supports max.
 */

import type { ModelDraft } from './ops.ts'

export interface RuntimeReasoningCapability {
  /** Whether the exact model route advertises a reasoning selector. */
  available: boolean
  /** Effort ids in adapter-preferred display order. */
  efforts: string[]
  /** Adapter-configured default effort, when the runtime exposes one. */
  defaultEffort?: string
  /** `runtime` = exact model metadata was found; `unknown` = not found. */
  source: 'runtime' | 'unknown'
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function reasoningEntryId(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  const record = asRecord(entry)
  return typeof record['id'] === 'string' && record['id'] !== ''
    ? record['id'] as string
    : undefined
}

/**
 * Resolve the DSH exact-model runtime reasoning capability.
 *
 * This reads only `catalogGroups[].models[].reasoning` (the `api.llm.models()`
 * shape): `reasoning.efforts[]` + optional `reasoning.defaultEffort`. It never
 * guesses from provider/model names and never uses provider defaults.
 */
export function resolveRuntimeReasoningCapability(
  catalogGroups: unknown[],
  provider: string,
  model: string,
): RuntimeReasoningCapability {
  for (const group of asArray(catalogGroups)) {
    const g = asRecord(group)
    if (g['id'] !== provider) continue
    for (const item of asArray(g['models'])) {
      const m = asRecord(item)
      if (m['id'] !== model) continue
      const reasoning = asRecord(m['reasoning'])
      const rawEfforts = asArray(reasoning['efforts'])
      const efforts: string[] = []
      const seen = new Set<string>()
      for (const entry of rawEfforts) {
        const id = reasoningEntryId(entry)
        if (id === undefined || seen.has(id)) continue
        seen.add(id)
        efforts.push(id)
      }
      return {
        available: efforts.length > 0,
        efforts,
        defaultEffort: typeof reasoning['defaultEffort'] === 'string'
          ? reasoning['defaultEffort'] as string
          : undefined,
        source: 'runtime',
      }
    }
  }
  return { available: false, efforts: [], source: 'unknown' }
}

/**
 * Authoring-side reasoning efforts.
 *
 * - `unsupported` → `[]` (explicitly no reasoning on this model)
 * - `custom` → the authoring draft efforts (may be `[]` while unsaved)
 * - `inherit` → `undefined` (no model-level claim)
 *
 * This is deliberately separate from runtime truth.
 */
export function configuredReasoningEfforts(
  modelDraft: ModelDraft | undefined,
): string[] | undefined {
  if (!modelDraft) return undefined
  if (modelDraft.reasoningMode === 'unsupported') return []
  if (modelDraft.reasoningMode === 'custom') return modelDraft.efforts
  return undefined
}

/** Runtime-only convenience: exact model reasoning efforts, or `[]`. */
export function runtimeReasoningEfforts(
  catalogGroups: unknown[],
  provider: string,
  model: string,
): string[] {
  return resolveRuntimeReasoningCapability(catalogGroups, provider, model).efforts
}

export interface ReasoningMismatch {
  /** True when authoring custom efforts are not fully resolved by DSH. */
  mismatch: boolean
  /** Authoring efforts (custom mode), or `[]`. */
  authoring: string[]
  /** Runtime exact efforts. */
  runtime: string[]
  /** Authoring efforts missing from runtime. */
  missing: string[]
  /** True when the runtime has no exact-model reasoning metadata at all. */
  unresolved: boolean
}

/**
 * Compare authoring custom efforts with DSH runtime exact truth.
 *
 * Provider defaults are never consulted here. `inherit` is always `mismatch
 * = false` because no model-level claim is being made.
 */
export function reasoningMismatch(
  modelDraft: ModelDraft | undefined,
  runtime: RuntimeReasoningCapability,
): ReasoningMismatch {
  if (!modelDraft || modelDraft.reasoningMode !== 'custom') {
    return { mismatch: false, authoring: [], runtime: runtime.efforts, missing: [], unresolved: !runtime.available && runtime.source === 'runtime' }
  }
  const authoring = modelDraft.efforts
  if (!runtime.available) {
    return { mismatch: authoring.length > 0, authoring, runtime: [], missing: authoring, unresolved: true }
  }
  const missing = authoring.filter(effort => !runtime.efforts.includes(effort))
  return { mismatch: missing.length > 0, authoring, runtime: runtime.efforts, missing, unresolved: false }
}

export interface UnsupportedReasoningEffortError {
  provider?: string
  model?: string
  effort?: string
}

const UNSUPPORTED_REASONING_EFFORT_PATTERN =
  /provider\s+"?([^"\s]+)"?\s+model\s+"?([^"\s]+)"?\s+.*?\breasoning effort\s+"?([^"\s]+)"?/i

/**
 * Parse a DSH `UNSUPPORTED_REASONING_EFFORT` style message.
 *
 * Returns `null` when the message does not match, so callers can keep the raw
 * error in debug/details while showing a friendly hint.
 */
export function parseUnsupportedReasoningEffortError(message: string): UnsupportedReasoningEffortError | null {
  const match = UNSUPPORTED_REASONING_EFFORT_PATTERN.exec(message)
  if (!match) return null
  return {
    provider: match[1] || undefined,
    model: match[2] || undefined,
    effort: match[3] || undefined,
  }
}
