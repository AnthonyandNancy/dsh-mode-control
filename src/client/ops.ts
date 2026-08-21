/**
 * Pure client-side operations for the llm-pi-ai capability settings page.
 *
 * Keeping these functions free of React lets the mutation/UI-decision logic be
 * unit-tested directly. The runtime UI (`src/client/index.ts`) calls these to
 * parse drafts, decide whether the Anthropic Adaptive Thinking control is
 * visible, and build precise settings mutations.
 */

import {
  ANTHROPIC_REASONING_EFFORT_DEFAULTS,
} from '../compile.ts'
import type { PiAiReasoningLevel } from '../types.ts'

export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const MODALITIES = ['text', 'image'] as const

export type ReasoningMode = 'inherit' | 'unsupported' | 'custom'
export type AdaptiveThinkingMode = 'inherit' | 'enabled' | 'disabled'

/**
 * Detected dsh-llm-pi-ai runtime mode.
 *
 * - `rc6` / `rc7`: Legacy Compatibility, requires the matching adapter patch.
 * - `rc8`: Native Mode, no adapter patch.
 * - `legacy`: Legacy but exact rc cannot be determined from the available data.
 * - `unknown`: Not enough information / newer unverified version.
 */
export type DshMode = 'rc6' | 'rc7' | 'rc8' | 'legacy' | 'unknown'

export interface ModelDraft {
  input: string[]
  reasoningMode: ReasoningMode
  efforts: string[]
  /** Saved canonical level → upstream wire value, preserved across unrelated edits. */
  wire: Partial<Record<PiAiReasoningLevel, string | null>>
}

export interface ProviderDraft {
  defaultInput: string[]
  defaultReasoning: string
  adaptiveThinking: AdaptiveThinkingMode
}

export interface SettingsOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function parseInput(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string =>
    typeof item === 'string' && (MODALITIES as readonly string[]).includes(item),
  )
}

export function parseAdaptiveThinking(value: unknown): AdaptiveThinkingMode {
  if (value === true) return 'enabled'
  if (value === false) return 'disabled'
  return 'inherit'
}

/**
 * Detect the dsh-llm-pi-ai runtime mode.
 *
 * Prefers the host version (`api.host.describe().version`) when available,
 * because rc.6 and rc.7 share the same settings schema and cannot be told
 * apart from schema alone. Falls back to the serialized settings schema:
 * rc.8's compat schema contains `forceAdaptiveThinking`, older schemas do not.
 */
function objectHasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some(item => objectHasKey(item, key))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(record, key)) return true
    return Object.values(record).some(item => objectHasKey(item, key))
  }
  return false
}

export function detectDshMode(hostVersion?: string, schema?: unknown): DshMode {
  const version = hostVersion?.trim() ?? ''
  const rcMatch = /(^|[^0-9])rc\.([0-9]+)([^0-9]|$)/i.exec(version)
  if (rcMatch) {
    const rc = Number(rcMatch[2])
    if (rc === 6) return 'rc6'
    if (rc === 7) return 'rc7'
    if (rc === 8) return 'rc8'
    return 'unknown'
  }
  if (schema !== undefined && objectHasKey(schema, 'forceAdaptiveThinking')) return 'rc8'
  if (version) return 'legacy'
  return 'unknown'
}

export function parseProviderDraft(providerConfig: unknown): ProviderDraft {
  const cfg = asRecord(providerConfig)
  const reasoning = cfg['reasoning']
  const compat = asRecord(cfg['compat'])
  return {
    defaultInput: parseInput(cfg['defaultInput']),
    defaultReasoning: typeof reasoning === 'string' && (LEVELS as readonly string[]).includes(reasoning) ? reasoning : '',
    adaptiveThinking: parseAdaptiveThinking(compat['forceAdaptiveThinking']),
  }
}

export function parseModelDraft(modelConfig: unknown): ModelDraft {
  const cfg = asRecord(modelConfig)
  const reasoningEfforts = cfg['reasoningEfforts']
  let reasoningMode: ReasoningMode = 'inherit'
  let efforts: string[] = []
  const wire: Partial<Record<PiAiReasoningLevel, string | null>> = {}
  if (reasoningEfforts === false) {
    reasoningMode = 'unsupported'
  } else if (reasoningEfforts !== null && typeof reasoningEfforts === 'object') {
    const entries = Object.entries(reasoningEfforts as Record<string, unknown>)
      .filter(([level]) => (LEVELS as readonly string[]).includes(level))
    for (const [level, value] of entries) {
      if (typeof value === 'string' || value === null) {
        wire[level as PiAiReasoningLevel] = value
      }
    }
    efforts = entries.map(([level]) => level)
    if (efforts.length > 0) {
      reasoningMode = 'custom'
    }
  }
  return {
    input: parseInput(cfg['input']),
    reasoningMode,
    efforts,
    wire,
  }
}

/**
 * Decide whether the Anthropic Adaptive Thinking control should be shown.
 *
 * Priority:
 * 1. Resolved model/provider API from the harness catalog (when available).
 * 2. Provider explicit `api`.
 * 3. Existing `compat.forceAdaptiveThinking` (so users can always clear it).
 *
 * Provider-name heuristics are intentionally forbidden.
 */
export function isAnthropicProvider(
  provider: string,
  providerConfig: unknown,
  catalogGroups: unknown[],
): boolean {
  const cfg = asRecord(providerConfig)

  // 1. Harness resolved metadata. Some rc.8 catalog routes inherit the model
  // API even when the provider does not spell `api` out.
  if (resolvedAnthropicApi(provider, catalogGroups)) return true

  // 2. Explicit provider `api`.
  if (cfg['api'] === 'anthropic-messages') return true

  // 3. Existing field must remain editable / visible.
  const compat = asRecord(cfg['compat'])
  if (Object.prototype.hasOwnProperty.call(compat, 'forceAdaptiveThinking')) return true

  return false
}

function resolvedAnthropicApi(
  provider: string,
  catalogGroups: unknown[],
): boolean {
  for (const group of catalogGroups) {
    const g = asRecord(group)
    if (g['id'] !== provider) continue
    if (g['api'] === 'anthropic-messages') return true
    for (const model of asArray(g['models'])) {
      const m = asRecord(model)
      if (m['api'] === 'anthropic-messages') return true
    }
  }
  return false
}

function inputFor(input: string[]): unknown {
  return input.length > 0 ? [...input] : undefined
}

/**
 * Default wire spelling for a canonical level.
 *
 * `anthropic` uses the Anthropic Messages default mapping (`minimal → low`).
 * Generic mapping defaults to canonical identity.
 */
export function defaultReasoningWire(level: PiAiReasoningLevel, anthropic: boolean): string | null {
  if (anthropic) return ANTHROPIC_REASONING_EFFORT_DEFAULTS[level]
  return level === 'off' ? null : level
}

/**
 * Effective wire spelling for a draft level, preferring the saved mapping.
 */
export function reasoningWireFor(
  draft: ModelDraft,
  level: PiAiReasoningLevel,
  anthropic: boolean,
): string | null {
  const saved = draft.wire[level]
  return saved !== undefined ? saved : defaultReasoningWire(level, anthropic)
}

/**
 * Build the `reasoningEfforts` value for a model draft.
 *
 * Saved wire values are preserved. Newly added levels fall back to the
 * protocol default without rewriting existing mapping entries.
 */
export function reasoningEffortsFor(draft: ModelDraft, anthropic = false): unknown {
  if (draft.reasoningMode === 'unsupported') return false
  if (draft.reasoningMode !== 'custom') return undefined
  const result: Record<string, string | null> = {}
  for (const level of LEVELS) {
    if (!draft.efforts.includes(level)) continue
    const piLevel = level as PiAiReasoningLevel
    if (draft.wire[piLevel] !== undefined) {
      result[level] = draft.wire[piLevel]
    } else {
      result[level] = defaultReasoningWire(piLevel, anthropic)
    }
  }
  if (Object.keys(result).length === 0) return undefined
  return result
}

export function modelCapabilityFields(draft: ModelDraft, anthropic = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const input = inputFor(draft.input)
  if (input !== undefined) result['input'] = input
  const efforts = reasoningEffortsFor(draft, anthropic)
  if (efforts !== undefined) result['reasoningEfforts'] = efforts
  return result
}

export function collectOpsForAdaptiveThinking(
  provider: string,
  providerConfig: unknown,
  mode: AdaptiveThinkingMode,
): SettingsOp[] {
  const cfg = asRecord(providerConfig)
  const compat = asRecord(cfg['compat'])
  const path = ['providers', provider, 'compat', 'forceAdaptiveThinking']
  if (mode === 'enabled') {
    return [{ op: 'set', path, value: true }]
  }
  if (mode === 'disabled') {
    return [{ op: 'set', path, value: false }]
  }
  // inherit
  if (Object.prototype.hasOwnProperty.call(compat, 'forceAdaptiveThinking')) {
    return [{ op: 'unset', path }]
  }
  return []
}

export function collectOpsForProvider(
  provider: string,
  providerConfig: unknown,
  draft: ProviderDraft,
): SettingsOp[] {
  const ops: SettingsOp[] = []
  const cfg = asRecord(providerConfig)
  const base = ['providers', provider]
  const defaultInput = inputFor(draft.defaultInput)
  if (defaultInput !== undefined) {
    ops.push({ op: 'set', path: [...base, 'defaultInput'], value: defaultInput })
  } else if (cfg['defaultInput'] !== undefined) {
    ops.push({ op: 'unset', path: [...base, 'defaultInput'] })
  }
  if (draft.defaultReasoning !== '') {
    ops.push({ op: 'set', path: [...base, 'reasoning'], value: draft.defaultReasoning })
  } else if (cfg['reasoning'] !== undefined) {
    ops.push({ op: 'unset', path: [...base, 'reasoning'] })
  }
  ops.push(...collectOpsForAdaptiveThinking(provider, providerConfig, draft.adaptiveThinking))
  return ops
}

/**
 * Build precise model mutations.
 *
 * - `models[]` routes: only `input` / `reasoningEfforts` are touched on each
 *   entry; all non-plugin-owned fields survive because entries are cloned and
 *   mutated in place.
 * - `modelOverrides` routes: path-level `set`/`unset` for only
 *   `input` and `reasoningEfforts`; the whole override object is never
 *   replaced and the model key is never deleted.
 */
export function collectOpsForModels(
  provider: string,
  providerConfig: unknown,
  drafts: Record<string, ModelDraft>,
  anthropic = false,
): SettingsOp[] {
  const ops: SettingsOp[] = []
  const cfg = asRecord(providerConfig)
  const usesModelsArray = Array.isArray(cfg['models']) && (cfg['models'] as unknown[]).length > 0
  if (usesModelsArray) {
    const current = asArray(cfg['models']).map(entry => ({ ...asRecord(entry) }))
    for (const [model, draft] of Object.entries(drafts)) {
      const fields = modelCapabilityFields(draft, anthropic)
      let entry = current.find(item => item['id'] === model)
      if (entry === undefined) {
        entry = { id: model }
        current.push(entry)
      }
      for (const key of ['input', 'reasoningEfforts']) {
        if (fields[key] !== undefined) entry[key] = fields[key]
        else delete entry[key]
      }
    }
    ops.push({ op: 'set', path: ['providers', provider, 'models'], value: current })
  } else {
    const overrides = asRecord(cfg['modelOverrides'])
    for (const [model, draft] of Object.entries(drafts)) {
      const fields = modelCapabilityFields(draft, anthropic)
      const base = ['providers', provider, 'modelOverrides', model]
      for (const key of ['input', 'reasoningEfforts'] as const) {
        const path = [...base, key]
        if (fields[key] !== undefined) {
          ops.push({ op: 'set', path, value: fields[key] })
        } else if (Object.prototype.hasOwnProperty.call(overrides, model)) {
          const override = asRecord(overrides[model])
          if (Object.prototype.hasOwnProperty.call(override, key)) {
            ops.push({ op: 'unset', path })
          }
        }
      }
    }
  }
  return ops
}
