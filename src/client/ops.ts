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
import { protocolsForModel } from './runtime-capabilities.ts'
export type { PiAiReasoningLevel } from '../types.ts'
import {
  collectOpsForCompat,
  mergeCompatDrafts,
  parseCompatDrafts,
  type CompatDrafts,
} from './compat-state.ts'

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
  /** Model context window override; empty string means inherit. */
  contextWindow?: string
  /** Model maximum output tokens override; empty string means inherit. */
  maxTokens?: string
  /** Managed per-model compat drafts. */
  compat?: CompatDrafts
}

export interface ProviderDraft {
  defaultInput: string[]
  defaultReasoning: string
  adaptiveThinking: AdaptiveThinkingMode
  /** Provider default context window; empty string means inherit. */
  defaultContextWindow?: string
  /** Provider default maximum output tokens; empty string means inherit. */
  defaultMaxTokens?: string
  /** Per-level thinking budgets; empty string per level means inherit. */
  thinkingBudgets?: Partial<Record<string, string>>
  /** Managed provider compat drafts. */
  compat?: CompatDrafts
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

/**
 * Explicitly declared model ids: `models[]` entries plus `modelOverrides`
 * keys.
 *
 * This is an authoring/directory helper, not the "what may be edited" answer:
 * a catalog-only route is still editable through a precise
 * `modelOverrides.<model>.*` mutation once the user makes a first change.
 */
export function declaredModelIds(providerConfig: unknown): string[] {
  const cfg = asRecord(providerConfig)
  const ids = new Set<string>()
  for (const model of asArray(cfg['models'])) {
    const entry = asRecord(model)
    if (typeof entry['id'] === 'string' && entry['id'] !== '') ids.add(entry['id'] as string)
  }
  for (const model of Object.keys(asRecord(cfg['modelOverrides']))) ids.add(model)
  return [...ids]
}

/** Model ids visible to pickers that may legitimately include catalog routes. */
export function catalogModelIds(provider: string, providerConfig: unknown, catalogGroups: unknown[]): string[] {
  const ids = new Set(declaredModelIds(providerConfig))
  for (const group of catalogGroups) {
    const g = asRecord(group)
    if (g['id'] !== provider) continue
    for (const model of asArray(g['models'])) {
      const m = asRecord(model)
      if (typeof m['id'] === 'string' && m['id'] !== '') ids.add(m['id'] as string)
    }
  }
  return [...ids]
}

/**
 * Model ids the Model Settings page may edit.
 *
 * - When the provider configures a non-empty `models[]`, that list replaces
 *   the installed catalog. Only `models[].id` plus existing `modelOverrides`
 *   keys (the DSH schema permits these alongside `models[]` for a subset of
 *   targets) are editable; the replaced catalog is not mixed back in.
 * - When no `models[]` is present the route still serves the installed
 *   catalog. The editable set is catalog ids plus existing override keys, so
 *   a catalog-only model becomes editable on its first precise override
 *   mutation.
 */
export function editableModelIds(provider: string, providerConfig: unknown, catalogGroups: unknown[]): string[] {
  const cfg = asRecord(providerConfig)
  const models = asArray(cfg['models'])
  if (models.length > 0) return declaredModelIds(providerConfig)
  return catalogModelIds(provider, providerConfig, catalogGroups)
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

function parseCapacity(value: unknown): string {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : ''
}

function parseThinkingBudgets(value: unknown): Partial<Record<string, string>> {
  const source = asRecord(value)
  const result: Partial<Record<string, string>> = {}
  for (const level of ['minimal', 'low', 'medium', 'high'] as const) {
    const entry = source[level]
    if (typeof entry === 'number' && Number.isFinite(entry)) result[level] = String(entry)
  }
  return result
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
    defaultContextWindow: parseCapacity(cfg['defaultContextWindow']),
    defaultMaxTokens: parseCapacity(cfg['defaultMaxTokens']),
    thinkingBudgets: parseThinkingBudgets(cfg['thinkingBudgets']),
    compat: parseCompatDrafts(cfg['compat']),
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
    contextWindow: parseCapacity(cfg['contextWindow']),
    maxTokens: parseCapacity(cfg['maxTokens']),
    compat: parseCompatDrafts(cfg['compat']),
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

/**
 * Whether a specific selected model speaks Anthropic Messages.
 *
 * Model-level reasoning defaults and model compat visibility must follow the
 * selected model's resolved protocol, not the provider-wide union.
 */
export function isAnthropicModel(
  provider: string,
  model: string,
  providerConfig: unknown,
  catalogGroups: unknown[],
): boolean {
  return protocolsForModel(provider, model, providerConfig, catalogGroups).includes('anthropic-messages')
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
 * Canonical Anthropic Messages wire spelling for an authoring level.
 *
 * `max` stays `max` on the wire; `minimal` collapses to `low` because pi-ai
 * has no `minimal` output effort. This is the single source for the default
 * Anthropic mapping.
 */
export function defaultAnthropicReasoningWire(level: PiAiReasoningLevel): string | null {
  return ANTHROPIC_REASONING_EFFORT_DEFAULTS[level]
}

/**
 * Default wire spelling for a canonical level.
 *
 * `anthropic` uses the Anthropic Messages default mapping (`minimal → low`).
 * Generic mapping defaults to canonical identity.
 */
export function defaultReasoningWire(level: PiAiReasoningLevel, anthropic: boolean): string | null {
  if (anthropic) return defaultAnthropicReasoningWire(level)
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

function capacityValue(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`capacity must be a positive integer, got "${trimmed}"`)
  }
  return value
}

function thinkingBudgetsValue(
  budgets: Partial<Record<string, string>> | undefined,
): Record<string, number> | undefined {
  if (budgets === undefined) return undefined
  const result: Record<string, number> = {}
  for (const [level, text] of Object.entries(budgets)) {
    const trimmed = (text ?? '').trim()
    if (trimmed === '') continue
    const value = Number(trimmed)
    if (!Number.isFinite(value)) {
      throw new Error(`thinkingBudgets.${level} must be a finite number`)
    }
    result[level] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export function modelCapabilityFields(draft: ModelDraft, anthropic = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  // `input` and `reasoningEfforts` are always managed by the model draft:
  // `undefined` means "explicitly inherit / unset". `contextWindow` and
  // `maxTokens` are only managed when the draft carries the field at all.
  result['input'] = inputFor(draft.input)
  if (draft.contextWindow !== undefined) result['contextWindow'] = capacityValue(draft.contextWindow)
  if (draft.maxTokens !== undefined) result['maxTokens'] = capacityValue(draft.maxTokens)
  result['reasoningEfforts'] = reasoningEffortsFor(draft, anthropic)
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
  dirtyFields?: ReadonlySet<string>,
  dirtyCompatFields?: ReadonlySet<string>,
): SettingsOp[] {
  const ops: SettingsOp[] = []
  const cfg = asRecord(providerConfig)
  const base = ['providers', provider]
  const manages = (field: string): boolean => dirtyFields === undefined || dirtyFields.has(field)

  if (manages('defaultInput')) {
    const value = inputFor(draft.defaultInput)
    if (value !== undefined) ops.push({ op: 'set', path: [...base, 'defaultInput'], value })
    else if (cfg['defaultInput'] !== undefined) ops.push({ op: 'unset', path: [...base, 'defaultInput'] })
  }
  if (manages('defaultContextWindow')) {
    const value = capacityValue(draft.defaultContextWindow)
    if (value !== undefined) ops.push({ op: 'set', path: [...base, 'defaultContextWindow'], value })
    else if (cfg['defaultContextWindow'] !== undefined) ops.push({ op: 'unset', path: [...base, 'defaultContextWindow'] })
  }
  if (manages('defaultMaxTokens')) {
    const value = capacityValue(draft.defaultMaxTokens)
    if (value !== undefined) ops.push({ op: 'set', path: [...base, 'defaultMaxTokens'], value })
    else if (cfg['defaultMaxTokens'] !== undefined) ops.push({ op: 'unset', path: [...base, 'defaultMaxTokens'] })
  }
  if (manages('defaultReasoning')) {
    if (draft.defaultReasoning !== '') ops.push({ op: 'set', path: [...base, 'reasoning'], value: draft.defaultReasoning })
    else if (cfg['reasoning'] !== undefined) ops.push({ op: 'unset', path: [...base, 'reasoning'] })
  }
  if (manages('thinkingBudgets')) {
    const value = thinkingBudgetsValue(draft.thinkingBudgets)
    if (value !== undefined) ops.push({ op: 'set', path: [...base, 'thinkingBudgets'], value })
    else if (cfg['thinkingBudgets'] !== undefined) ops.push({ op: 'unset', path: [...base, 'thinkingBudgets'] })
  }

  const compatDrafts = draft.adaptiveThinking !== undefined
    ? { ...(draft.compat ?? {}), forceAdaptiveThinking: { kind: 'boolean' as const, mode: draft.adaptiveThinking } }
    : draft.compat
  if (compatDrafts !== undefined && (manages('compat') || dirtyCompatFields !== undefined)) {
    ops.push(...collectOpsForCompat([...base, 'compat'], cfg['compat'], compatDrafts, dirtyCompatFields))
  }
  return ops
}

/**
 * Build precise model mutations.
 *
 * - `models[]` routes: only plugin-owned fields are touched on each entry;
 *   all non-plugin-owned fields survive because entries are cloned and
 *   mutated in place.
 * - `modelOverrides` routes: path-level `set`/`unset` for only plugin-owned
 *   fields; the whole override object is never replaced and the model key is
 *   never deleted.
 */
function modelFieldIsDirty(dirtyFields: ReadonlySet<string> | undefined, field: string): boolean {
  if (dirtyFields === undefined) return true
  if (field === 'reasoningEfforts') return dirtyFields.has(field) || dirtyFields.has('reasoningMode') || dirtyFields.has('efforts') || dirtyFields.has('wire')
  return dirtyFields.has(field)
}

function compatFieldsForDirty(dirtyFields: ReadonlySet<string> | undefined, allowedFields?: ReadonlySet<string>): ReadonlySet<string> | undefined {
  if (dirtyFields === undefined || dirtyFields.has('compat')) return allowedFields
  const fields = new Set<string>()
  for (const field of dirtyFields) if (field.startsWith('compat:')) fields.add(field.slice('compat:'.length))
  if (allowedFields === undefined) return fields
  return new Set([...fields].filter(field => allowedFields.has(field)))
}

function collectOpsForModelOverride(
  provider: string,
  model: string,
  overrides: Record<string, unknown>,
  draft: ModelDraft,
  anthropic: boolean,
  allowedCompatFields?: ReadonlySet<string>,
  allowedFields?: ReadonlySet<string>,
): SettingsOp[] {
  const ops: SettingsOp[] = []
  const fields = modelCapabilityFields(draft, anthropic)
  const base = ['providers', provider, 'modelOverrides', model]
  for (const key of ['input', 'contextWindow', 'maxTokens', 'reasoningEfforts'] as const) {
    if (allowedFields && !modelFieldIsDirty(allowedFields, key)) continue
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
    const path = [...base, key]
    if (fields[key] !== undefined) {
      const override = Object.prototype.hasOwnProperty.call(overrides, model) ? asRecord(overrides[model]) : {}
      const equal = (key === 'contextWindow' || key === 'maxTokens')
        && JSON.stringify(override[key]) === JSON.stringify(fields[key])
      if (!equal) ops.push({ op: 'set', path, value: fields[key] })
    } else if (Object.prototype.hasOwnProperty.call(overrides, model)) {
      const override = asRecord(overrides[model])
      if (Object.prototype.hasOwnProperty.call(override, key)) ops.push({ op: 'unset', path })
    }
  }
  if (draft.compat !== undefined) {
    const override = Object.prototype.hasOwnProperty.call(overrides, model) ? asRecord(overrides[model]) : {}
    const compatFields = compatFieldsForDirty(allowedFields, allowedCompatFields)
    if (allowedFields === undefined || allowedFields.has('compat') || compatFields !== undefined) {
      ops.push(...collectOpsForCompat([...base, 'compat'], override['compat'], draft.compat, compatFields))
    }
  }
  return ops
}

export function collectOpsForModels(
  provider: string,
  providerConfig: unknown,
  drafts: Record<string, ModelDraft>,
  anthropic: boolean | ((model: string) => boolean) = false,
  allowedCompatFields?: ReadonlySet<string>,
  dirtyModelFields?: ReadonlyMap<string, ReadonlySet<string>>,
): SettingsOp[] {
  const ops: SettingsOp[] = []
  const anthropicFor = (model: string): boolean => typeof anthropic === 'function' ? anthropic(model) : anthropic
  const cfg = asRecord(providerConfig)
  const usesModelsArray = Array.isArray(cfg['models']) && (cfg['models'] as unknown[]).length > 0
  if (usesModelsArray) {
    const current = asArray(cfg['models']).map(entry => ({ ...asRecord(entry) }))
    const original = JSON.stringify(current)
    const overrides = asRecord(cfg['modelOverrides'])
    for (const [model, draft] of Object.entries(drafts)) {
      const dirtyFields = dirtyModelFields?.get(model)
      if (dirtyModelFields && !dirtyFields) continue
      const fields = modelCapabilityFields(draft, anthropicFor(model))
      const entry = current.find(item => item['id'] === model)
      if (entry === undefined) {
        if (Object.prototype.hasOwnProperty.call(overrides, model)) ops.push(...collectOpsForModelOverride(provider, model, overrides, draft, anthropicFor(model), allowedCompatFields, dirtyFields))
        continue
      }
      for (const key of ['input', 'contextWindow', 'maxTokens', 'reasoningEfforts']) {
        if (!modelFieldIsDirty(dirtyFields, key)) continue
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
        if (fields[key] !== undefined) entry[key] = fields[key]
        else delete entry[key]
      }
      if (draft.compat !== undefined) {
        const compatFields = compatFieldsForDirty(dirtyFields, allowedCompatFields)
        if (dirtyFields === undefined || dirtyFields.has('compat') || compatFields !== undefined) {
          const merged = mergeCompatDrafts(entry['compat'], draft.compat, compatFields)
          if (merged.changed) {
            if (merged.value === undefined) delete entry['compat']
            else entry['compat'] = merged.value
          }
        }
      }
    }
    if (dirtyModelFields === undefined || JSON.stringify(current) !== original) ops.push({ op: 'set', path: ['providers', provider, 'models'], value: current })
  } else {
    const overrides = asRecord(cfg['modelOverrides'])
    for (const [model, draft] of Object.entries(drafts)) {
      const dirtyFields = dirtyModelFields?.get(model)
      if (dirtyModelFields && !dirtyFields) continue
      const fields = modelCapabilityFields(draft, anthropicFor(model))
      const base = ['providers', provider, 'modelOverrides', model]
      for (const key of ['input', 'contextWindow', 'maxTokens', 'reasoningEfforts'] as const) {
        if (!modelFieldIsDirty(dirtyFields, key)) continue
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
        const path = [...base, key]
        if (fields[key] !== undefined) {
          const override = Object.prototype.hasOwnProperty.call(overrides, model)
            ? asRecord(overrides[model])
            : {}
          // Capacity overrides are the fields most likely to be touched by a
          // "resolved value" placeholder; never rewrite an equal value.
          const equal = (key === 'contextWindow' || key === 'maxTokens')
            && JSON.stringify(override[key]) === JSON.stringify(fields[key])
          if (!equal) ops.push({ op: 'set', path, value: fields[key] })
        } else if (Object.prototype.hasOwnProperty.call(overrides, model)) {
          const override = asRecord(overrides[model])
          if (Object.prototype.hasOwnProperty.call(override, key)) {
            ops.push({ op: 'unset', path })
          }
        }
      }
      if (draft.compat !== undefined) {
        const override = Object.prototype.hasOwnProperty.call(overrides, model)
          ? asRecord(overrides[model])
          : {}
        const compatFields = compatFieldsForDirty(dirtyFields, allowedCompatFields)
        if (dirtyFields === undefined || dirtyFields.has('compat') || compatFields !== undefined) {
          ops.push(...collectOpsForCompat([...base, 'compat'], override['compat'], draft.compat, compatFields))
        }
      }
    }
  }
  return ops
}
