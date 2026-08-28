/**
 * Pure subagent settings draft state.
 *
 * This module has no JSX and no direct settings mutation. It owns the
 * parse → draft → validate → ops pipeline for both the legacy fixed-model
 * (`agentOptions`) surface and the official native
 * (`subagent-model-selection.enabled/allowedModels`) surface.
 */

export interface SettingsOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

export type LegacyDefaultMode = 'inherit' | 'fixed'

export interface LegacySubagentDraft {
  /** `inherit` removes the plugin-managed provider/model override. */
  mode: LegacyDefaultMode
  provider: string
  model: string
  /** Empty string means omit `maxTokens`. */
  maxTokens: string
  /** Empty string means omit `reasoningEffort` (only when supported). */
  reasoningEffort: string
  /** Future/unknown agentOptions keys that must survive unrelated edits. */
  extra: Record<string, unknown>
}

export interface AllowedModelRoute {
  provider: string
  model: string
}

export interface NativeSubagentDraft {
  enabled: boolean
  allowedModels: AllowedModelRoute[]
}

export function legacyDraftFromAgentOptions(value: unknown): LegacySubagentDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { mode: 'inherit', provider: '', model: '', maxTokens: '', reasoningEffort: '', extra: {} }
  }
  const source = value as Record<string, unknown>
  const managed = new Set(['provider', 'model', 'maxTokens', 'reasoningEffort'])
  const extra: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (!managed.has(key)) extra[key] = entry
  }
  return {
    mode: typeof source.provider === 'string' && source.provider.length > 0 ? 'fixed' : 'inherit',
    provider: typeof source.provider === 'string' ? source.provider : '',
    model: typeof source.model === 'string' ? source.model : '',
    maxTokens: typeof source.maxTokens === 'number' && Number.isInteger(source.maxTokens) && source.maxTokens > 0
      ? String(source.maxTokens)
      : '',
    reasoningEffort: typeof source.reasoningEffort === 'string' ? source.reasoningEffort : '',
    extra,
  }
}

export interface AgentOptionsResult {
  value?: Record<string, unknown>
  unset: boolean
}

/**
 * Convert a legacy draft back to the `agentOptions` value to persist.
 *
 * `inherit` returns `unset: true` — the plugin-managed provider/model override
 * is removed entirely, never written as empty strings. Future keys in `extra`
 * always survive.
 */
export function agentOptionsFromLegacyDraft(draft: LegacySubagentDraft): AgentOptionsResult {
  if (draft.mode === 'inherit') {
    return { unset: true }
  }
  const provider = draft.provider.trim()
  const model = draft.model.trim()
  const value: Record<string, unknown> = { ...draft.extra }
  if (provider.length === 0 || model.length === 0) {
    throw new Error('subagent.agentOptions.required')
  }
  value['provider'] = provider
  value['model'] = model
  const maxTokens = Number(draft.maxTokens.trim())
  if (draft.maxTokens.trim() !== '' && Number.isInteger(maxTokens) && maxTokens > 0) {
    value['maxTokens'] = maxTokens
  }
  const effort = draft.reasoningEffort.trim()
  if (effort !== '') value['reasoningEffort'] = effort
  return { value, unset: false }
}

export type AllowedModelsValidation =
  | { ok: true }
  | { ok: false; errorKey: string }

/** Validate the official allowed-models list exactly like the DSH rule. */
export function validateAllowedModels(draft: NativeSubagentDraft): AllowedModelsValidation {
  if (!draft.enabled) return { ok: true }
  if (draft.allowedModels.length === 0) {
    return { ok: false, errorKey: 'subagent.allowedModels.empty' }
  }
  const seen = new Set<string>()
  for (const route of draft.allowedModels) {
    const provider = route.provider.trim()
    const model = route.model.trim()
    if (provider === '' || model === '') {
      return { ok: false, errorKey: 'subagent.allowedModels.incomplete' }
    }
    const key = `${provider}\u0000${model}`
    if (seen.has(key)) {
      return { ok: false, errorKey: 'subagent.allowedModels.duplicate' }
    }
    seen.add(key)
  }
  return { ok: true }
}

/**
 * Ops for the official `subagent-model-selection` namespace.
 * The whole allowlist is replaced — it is the list this plugin manages.
 */
export function nativeSelectionOps(draft: NativeSubagentDraft): SettingsOp[] {
  return [
    { op: 'set', path: ['enabled'], value: draft.enabled },
    {
      op: 'set',
      path: ['allowedModels'],
      value: draft.allowedModels.map(route => ({
        provider: route.provider.trim(),
        model: route.model.trim(),
      })),
    },
  ]
}
