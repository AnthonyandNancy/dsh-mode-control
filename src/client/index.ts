/**
 * @deepseek-ai/dsh-llm-pi-ai-capabilities — client settings section.
 *
 * Page order (spec):
 * Provider Selector → Provider 默认能力 → Provider 推理能力 → 接口兼容性 →
 * 子代理模型 → 模型列表 → 模型详情 → 恢复默认 / 保存能力.
 *
 * Only native settings namespaces are written (`llm-pi-ai`,
 * `dsh-mode-control.subagent`, `subagent-model-selection`); no custom RPC is
 * invented and no second runtime config source is introduced.
 */

import { createElement, useEffect, useRef, useState } from 'react'
import {
  asArray,
  asRecord,
  defaultReasoningWire,
  detectDshMode,
  editableModelIds,
  isAnthropicModel,
  isAnthropicProvider,
  parseModelDraft,
  parseProviderDraft,
  reasoningWireFor,
  LEVELS,
  MODALITIES,
  type AdaptiveThinkingMode,
  type DshMode,
  type ModelDraft,
  type PiAiReasoningLevel,
  type ProviderDraft,
} from './ops.ts'
import {
  parseUnsupportedReasoningEffortError,
  reasoningMismatch,
  resolveRuntimeReasoningCapability,
} from './reasoning-capabilities.ts'
import { COMPAT_FIELDS, isCompatFieldApplicable, type CompatFieldDefinition } from './compat-fields.ts'
import { emptyCompatDrafts, type CompatDrafts } from './compat-state.ts'
import { CompatDisclosure, CompatGroupSection } from './compat-ui.ts'
import { collectEnumOptions, collectRuntimeCapabilities, protocolsForModel, protocolsForProvider, schemaObjectKeys, subagentRuntimeFactsFromValue, type RuntimeCapabilities } from './runtime-capabilities.ts'
import { SubagentSettingsCard } from './subagent-ui.ts'
import { SUBAGENT_MODEL_SELECTION_NAMESPACE, SUBAGENT_NAMESPACE } from '../subagent/constants.ts'
import { CheckIcon, Chip, CompactSelect, DisclosureRow, InlineNumberEditor, Panel, SettingRow, Subsection } from './ui.ts'
import { CAPABILITIES_CSS } from './styles.ts'
import { ModelRoutePicker, buildProviderModelRouteOptions } from './model-picker.ts'
import { collectOpsForAllProviders } from './save-helpers.ts'

const NS = 'settings.llm-pi-ai-capabilities'
const PI_AI_NS = 'llm-pi-ai'

interface SubagentControlState {
  value: { agentOptions?: unknown; modelSelectionSettings?: boolean }
  revision?: number
  writable: boolean
}

interface NativeSubagentState {
  value?: unknown
  revision?: number
  writable: boolean
}

interface CapabilitiesState {
  status: 'loading' | 'ready' | 'error'
  writable: boolean
  revision: number
  providers: Record<string, unknown>
  catalogGroups: unknown[]
  dshMode: DshMode
  selectedProvider: string
  providerDrafts: Record<string, ProviderDraft>
  modelDrafts: Record<string, Record<string, ModelDraft>>
  runtimeCaps: RuntimeCapabilities
  subagentControl: SubagentControlState
  nativeSubagent: NativeSubagentState
  enumOptions: { maxTokensField: string[]; thinkingFormat: string[]; cacheControlFormat: string[] }
  error?: string
}

export type SavePhase = 'idle' | 'saving' | 'success' | 'pending' | 'error'

export interface SaveFeedbackState {
  phase: SavePhase
  message?: string
}

export function saveButtonDisabled(_hasDirty: boolean, phase: SavePhase): boolean {
  return phase === 'saving'
}

const EMPTY_RUNTIME_CAPS: RuntimeCapabilities = {
  compatFields: new Set(),
  modelCompatFields: new Set(),
  providerFields: new Set(),
  modelFields: new Set(),
  subagent: {
    visible: false,
    effectiveVersion: undefined,
    mode: 'unsupported',
    supportsAgentOptions: true,
    supportsReasoningEffort: false,
    supportsNativeSelection: false,
    supportsAllowedModels: false,
    modelSelectionSettings: undefined,
  },
}

const EMPTY_STATE: CapabilitiesState = {
  status: 'loading',
  writable: true,
  revision: 0,
  providers: {},
  catalogGroups: [],
  dshMode: 'unknown',
  selectedProvider: '',
  providerDrafts: {},
  modelDrafts: {},
  runtimeCaps: EMPTY_RUNTIME_CAPS,
  subagentControl: { value: {}, writable: true },
  nativeSubagent: { writable: true },
  enumOptions: { maxTokensField: [], thinkingFormat: [], cacheControlFormat: [] },
}

function modelConfigOf(providerConfig: unknown, model: string): unknown {
  const cfg = asRecord(providerConfig)
  const models = asArray(cfg['models'])
  const found = models.find(entry => asRecord(entry)['id'] === model)
  if (found !== undefined) return found
  const overrides = asRecord(cfg['modelOverrides'])
  return overrides[model]
}

function mutationRevision(response: unknown): number | undefined {
  const result = response as { result?: { revision?: unknown; value?: { revision?: unknown } } } | null
  const candidates = [result?.result?.value?.revision, result?.result?.revision]
  return candidates.find(value => typeof value === 'number' && Number.isFinite(value)) as number | undefined
}

function preserveCompatKeys(next: CompatDrafts | undefined, previous: CompatDrafts | undefined, keys: ReadonlySet<string>): CompatDrafts | undefined {
  if (!next && !previous) return undefined
  const result: CompatDrafts = { ...(next ?? {}) }
  for (const key of keys) if (previous?.[key] !== undefined) result[key] = previous[key]
  return result
}

function preserveProviderDraft(next: ProviderDraft, previous: ProviderDraft, dirty: ReadonlySet<string>): ProviderDraft {
  const result = { ...next }
  const compatKeys = new Set<string>()
  for (const field of dirty) {
    if (field.startsWith('compat:')) compatKeys.add(field.slice('compat:'.length))
    else if (field in result && field in previous) (result as any)[field] = (previous as any)[field]
  }
  if (dirty.has('compat')) result.compat = previous.compat
  else if (compatKeys.size > 0) result.compat = preserveCompatKeys(result.compat, previous.compat, compatKeys)
  return result
}

function preserveModelDraft(next: ModelDraft, previous: ModelDraft, dirty: ReadonlySet<string>): ModelDraft {
  const result = { ...next }
  const compatKeys = new Set<string>()
  for (const field of dirty) {
    if (field.startsWith('compat:')) compatKeys.add(field.slice('compat:'.length))
    else if (field in result && field in previous) (result as any)[field] = (previous as any)[field]
  }
  if (dirty.has('compat')) result.compat = previous.compat
  else if (compatKeys.size > 0) result.compat = preserveCompatKeys(result.compat, previous.compat, compatKeys)
  return result
}

function levelLabel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function modalityLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

function compatFieldsOf(group: string, advancedOnly: boolean): CompatFieldDefinition[] {
  return COMPAT_FIELDS.filter(field => field.group === group && field.advanced === advancedOnly)
}

function compatApplicableMap(
  fields: readonly CompatFieldDefinition[],
  protocols: string[],
  drafts: CompatDrafts,
  runtimeFields?: ReadonlySet<string>,
): { applicable: Record<string, boolean>; existing: Record<string, boolean> } {
  const applicable: Record<string, boolean> = {}
  const existing: Record<string, boolean> = {}
  for (const field of fields) {
    applicable[field.key] = isCompatFieldApplicable(field, protocols) && (runtimeFields === undefined || runtimeFields.has(field.key))
    const draft = drafts[field.key]
    existing[field.key] = draft !== undefined && (
      (draft.kind === 'boolean' && draft.mode !== 'inherit') ||
      (draft.kind === 'enum' && draft.value !== '') ||
      (draft.kind === 'json' && draft.text.trim() !== '')
    )
  }
  return { applicable, existing }
}

function injectStyles(): void {
  const id = '@deepseek-ai/dsh-llm-pi-ai-capabilities/styles'
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${id}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@deepseek-ai/dsh-llm-pi-ai-capabilities'
  tag.dataset.pluginCss = id
  tag.textContent = CAPABILITIES_CSS
  document.head.appendChild(tag)
}

function ModeStatus(props: any): any {
  const { mode, t } = props
  const h = createElement
  switch (mode) {
    case 'rc8':
      return h('span', { className: 'dsh-mc-mode dsh-mc-mode-native', title: t('modeNativeDetail') }, t('modeNative'))
    case 'rc6':
      return h('span', { className: 'dsh-mc-mode dsh-mc-mode-legacy', title: t('modeLegacyRc6Detail') }, t('modeLegacyRc6Title'))
    case 'rc7':
      return h('span', { className: 'dsh-mc-mode dsh-mc-mode-legacy', title: t('modeLegacyRc7Detail') }, t('modeLegacyRc7Title'))
    case 'legacy':
      return h('span', { className: 'dsh-mc-mode dsh-mc-mode-legacy', title: t('modeLegacyDetail') }, t('modeLegacyTitle'))
    default:
      return null
  }
}

function CapabilitiesSection(props: any): any {
  const api = props.api
  const remote = props.remote
  const t = props.t
  const [state, setState] = useState<CapabilitiesState>(EMPTY_STATE)
  const [selectedModel, setSelectedModel] = useState('')
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedbackState>({ phase: 'idle' })
  const dirtyProvidersRef = useRef(new Set<string>())
  const dirtyProviderFieldsRef = useRef(new Map<string, Set<string>>())
  const dirtyModelFieldsRef = useRef(new Map<string, Map<string, Set<string>>>())
  const dirtyVersionRef = useRef(0)
  const saveInFlightRef = useRef(false)
  const loadGenerationRef = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const activeModelRef = useRef('')

  const load = async (preserveDirty = false): Promise<void> => {
    const dirtyProviders = new Set(dirtyProvidersRef.current)
    if (dirtyProviders.size > 0 && !preserveDirty) return
    const startDirtyVersion = dirtyVersionRef.current
    const generation = ++loadGenerationRef.current
    if (stateRef.current.status !== 'ready') {
      setState(prev => ({ ...prev, status: 'loading', error: undefined }))
    }
    try {
      const [settingsResponse, hostVersion] = await Promise.all([
        api.settings.describe({}),
        Promise.resolve()
          .then(() => api.host?.describe?.({}))
          .then((response: any) => response?.result?.value?.version)
          .catch(() => undefined),
      ])
      const result = settingsResponse?.result
      if (result?.ok !== true) throw new Error(result?.error?.message ?? 'settings.describe failed')
      const namespaces = asArray(result.value?.namespaces)
      const ns = namespaces.find((item: any) => asRecord(item)['ns'] === PI_AI_NS)
      if (ns === undefined) {
        if (generation !== loadGenerationRef.current) return
        setState(prev => ({ ...prev, status: 'error', error: t('namespaceMissing') }))
        return
      }
      const view = asRecord(ns)
      const value = asRecord(view['value'])
      const schema = view['schema']
      const providers = asRecord(value['providers'])
      const providerNames = Object.keys(providers)
      const previousProvider = stateRef.current.selectedProvider
      const selectedProvider = providerNames.includes(previousProvider) ? previousProvider : (providerNames[0] ?? '')
      const providerDrafts: Record<string, ProviderDraft> = {}
      const modelDrafts: Record<string, Record<string, ModelDraft>> = {}
      for (const provider of providerNames) {
        const providerConfig = providers[provider]
        providerDrafts[provider] = parseProviderDraft(providerConfig)
        modelDrafts[provider] = {}
      }
      let groups: unknown[] = []
      try {
        const catalogResponse = await api.llm.models({})
        const catalogResult = catalogResponse?.result
        groups = catalogResult?.ok === true ? asArray(catalogResult.value?.groups) : []
      } catch {
        groups = []
      }
      for (const provider of providerNames) {
        const providerConfig = providers[provider]
        const ids = editableModelIds(provider, providerConfig, groups)
        for (const model of ids) {
          const modelConfig = modelConfigOf(providerConfig, model)
          modelDrafts[provider][model] = parseModelDraft(modelConfig)
        }
      }
      const nextModels = Object.keys(modelDrafts[selectedProvider] ?? {})
      const nextModel = nextModels.includes(selectedModelRef.current) ? selectedModelRef.current : (nextModels[0] ?? '')

      const subagentView = namespaces.find((item: any) => asRecord(item)['ns'] === SUBAGENT_NAMESPACE)
      const subagentRecord = subagentView === undefined ? undefined : asRecord(subagentView)
      const subagentValue = subagentRecord ? asRecord(subagentRecord['value']) : {}
      const nativeView = namespaces.find((item: any) => asRecord(item)['ns'] === SUBAGENT_MODEL_SELECTION_NAMESPACE)
      const nativeRecord = nativeView === undefined ? undefined : asRecord(nativeView)

      const runtimeCaps = collectRuntimeCapabilities(schema, hostVersion, {
        ...subagentRuntimeFactsFromValue(subagentValue),
        modelSelectionNamespacePresent: nativeRecord !== undefined,
        modelSelectionNamespaceFields: nativeRecord ? schemaObjectKeys(nativeRecord['schema'], []) : undefined,
      })

      if (generation !== loadGenerationRef.current) return
      const shouldPreserveDrafts = preserveDirty || dirtyVersionRef.current !== startDirtyVersion
      if (shouldPreserveDrafts) {
        const previousState = stateRef.current
        for (const provider of dirtyProvidersRef.current) {
          const providerDirty = dirtyProviderFieldsRef.current.get(provider)
          if (providerDirty && previousState.providerDrafts[provider]) {
            providerDrafts[provider] = preserveProviderDraft(providerDrafts[provider], previousState.providerDrafts[provider], providerDirty)
          }
          const modelDirty = dirtyModelFieldsRef.current.get(provider)
          if (modelDirty && previousState.modelDrafts[provider]) {
            for (const [model, fields] of modelDirty) {
              if (previousState.modelDrafts[provider][model] && modelDrafts[provider]?.[model]) {
                modelDrafts[provider][model] = preserveModelDraft(modelDrafts[provider][model], previousState.modelDrafts[provider][model], fields)
              }
            }
          }
        }
      }
      setState({
        status: 'ready',
        error: undefined,
        writable: result.value?.writable !== false,
        revision: typeof view['revision'] === 'number' ? view['revision'] as number : 0,
        providers,
        catalogGroups: groups,
        selectedProvider,
        providerDrafts,
        modelDrafts,
        dshMode: detectDshMode(hostVersion, schema),
        runtimeCaps,
        subagentControl: {
          value: {
            agentOptions: subagentValue['agentOptions'],
            modelSelectionSettings: typeof subagentValue['modelSelectionSettings'] === 'boolean'
              ? subagentValue['modelSelectionSettings'] as boolean
              : undefined,
          },
          revision: subagentRecord ? subagentRecord['revision'] as number | undefined : undefined,
          writable: subagentRecord ? subagentRecord['writable'] !== false : false,
        },
        nativeSubagent: {
          value: nativeRecord ? nativeRecord['value'] : undefined,
          revision: nativeRecord ? nativeRecord['revision'] as number | undefined : undefined,
          writable: nativeRecord ? nativeRecord['writable'] !== false : false,
        },
        enumOptions: collectEnumOptions(schema),
      })
      setSelectedModel(nextModel)
    } catch (error: any) {
      if (generation !== loadGenerationRef.current) return
      setState(prev => ({ ...prev, status: 'error', error: String(error?.message ?? error) }))
    }
  }

  useEffect(() => {
    injectStyles()
    void load()
    return remote?.$on?.('settings/document-updated', () => {
      if (document.visibilityState === 'visible') void load()
    })
  }, [])

  useEffect(() => {
    if (saveFeedback.phase !== 'success') return
    const timer = setTimeout(() => setSaveFeedback({ phase: 'idle' }), 2600)
    return () => clearTimeout(timer)
  }, [saveFeedback.phase, saveFeedback.message])

  const changeProvider = (provider: string): void => {
    const firstModel = Object.keys(state.modelDrafts[provider] ?? {})[0] ?? ''
    setState(prev => ({ ...prev, selectedProvider: provider }))
    setSelectedModel(firstModel)
    markEdited()
  }

  const changeCurrentModel = (model: string): void => {
    if (!model) return
    setSelectedModel(model)
    markEdited()
  }

  const markEdited = (): void => {
    setSaveFeedback(prev => prev.phase === 'saving' ? prev : { phase: 'idle' })
  }

  const markProviderDirty = (provider: string, fields: string[] = []): void => {
    if (!provider) return
    dirtyProvidersRef.current.add(provider)
    const dirty = dirtyProviderFieldsRef.current.get(provider) ?? new Set<string>()
    for (const field of fields) dirty.add(field)
    dirtyProviderFieldsRef.current.set(provider, dirty)
    dirtyVersionRef.current += 1
    markEdited()
  }

  const markModelDirty = (provider: string, model: string, fields: string[] = []): void => {
    if (!provider || !model) return
    markProviderDirty(provider)
    const providerModels = dirtyModelFieldsRef.current.get(provider) ?? new Map<string, Set<string>>()
    const dirty = providerModels.get(model) ?? new Set<string>()
    for (const field of fields) dirty.add(field)
    providerModels.set(model, dirty)
    dirtyModelFieldsRef.current.set(provider, providerModels)
  }

  const updateProviderDraft = (patch: Partial<ProviderDraft>): void => {
    const provider = state.selectedProvider
    if (!provider) return
    const dirtyFields = Object.keys(patch)
    if (dirtyFields.includes('adaptiveThinking')) dirtyFields.push('compat:forceAdaptiveThinking')
    markProviderDirty(provider, dirtyFields)
    setState(prev => ({
      ...prev,
      providerDrafts: { ...prev.providerDrafts, [provider]: { ...prev.providerDrafts[provider], ...patch } },
    }))
  }

  const updateModelDraft = (patch: Partial<ModelDraft>): void => {
    const provider = state.selectedProvider
    const model = activeModelRef.current
    if (!provider || !model) return
    markModelDirty(provider, model, Object.keys(patch))
    setState(prev => ({
      ...prev,
      modelDrafts: {
        ...prev.modelDrafts,
        [provider]: {
          ...prev.modelDrafts[provider],
          [model]: { ...prev.modelDrafts[provider][model], ...patch },
        },
      },
    }))
  }

  const resetModel = (): void => {
    updateModelDraft({ input: [], reasoningMode: 'inherit', efforts: [], wire: {}, contextWindow: '', maxTokens: '', compat: emptyCompatDrafts() })
  }

  const resetProvider = (): void => {
    const provider = state.selectedProvider
    if (!provider) return
    markProviderDirty(provider, ['defaultInput', 'defaultReasoning', 'adaptiveThinking', 'defaultContextWindow', 'defaultMaxTokens', 'thinkingBudgets', 'compat'])
    setState(prev => ({
      ...prev,
      providerDrafts: {
        ...prev.providerDrafts,
        [provider]: {
          ...prev.providerDrafts[provider],
          defaultInput: [],
          defaultReasoning: '',
          adaptiveThinking: 'inherit',
          defaultContextWindow: '',
          defaultMaxTokens: '',
          thinkingBudgets: {},
          compat: emptyCompatDrafts(),
        },
      },
    }))
  }

  const toggleReasoningLevel = (level: string): void => {
    const model = activeModelRef.current
    if (!model) return
    const draft = state.modelDrafts[state.selectedProvider]?.[model]
    if (!draft) return
    const next = draft.efforts.includes(level)
      ? draft.efforts.filter(item => item !== level)
      : [...draft.efforts, level]
    const wire = { ...draft.wire }
    if (!next.includes(level)) delete wire[level as PiAiReasoningLevel]
    updateModelDraft({ efforts: next, wire })
  }

  const updateReasoningWire = (level: string, value: string): void => {
    const provider = state.selectedProvider
    const model = activeModelRef.current
    if (!provider || !model) return
    const draft = state.modelDrafts[provider]?.[model]
    if (!draft) return
    const trimmed = value.trim()
    const piLevel = level as PiAiReasoningLevel
    const normalized = trimmed === ''
      ? level === 'off'
        ? null
        : defaultReasoningWire(piLevel, isAnthropicModel(provider, model, state.providers[provider], state.catalogGroups))
      : level === 'off' && trimmed === 'null'
        ? null
        : trimmed
    updateModelDraft({
      wire: { ...draft.wire, [level]: normalized },
    })
  }

  const updateProviderCompat = (key: string, value: any): void => {
    const provider = state.selectedProvider
    const draft = state.providerDrafts[provider]
    if (!provider || !draft) return
    markProviderDirty(provider, [`compat:${key}`])
    setState(prev => ({ ...prev, providerDrafts: { ...prev.providerDrafts, [provider]: { ...prev.providerDrafts[provider], compat: { ...prev.providerDrafts[provider].compat, [key]: value } } } }))
  }

  const updateModelCompat = (key: string, value: any): void => {
    const provider = state.selectedProvider
    const model = activeModelRef.current
    const draft = provider ? state.modelDrafts[provider]?.[model] : undefined
    if (!provider || !model || !draft) return
    markModelDirty(provider, model, [`compat:${key}`])
    setState(prev => ({ ...prev, modelDrafts: { ...prev.modelDrafts, [provider]: { ...prev.modelDrafts[provider], [model]: { ...prev.modelDrafts[provider][model], compat: { ...prev.modelDrafts[provider][model].compat, [key]: value } } } } }))
  }

  const save = (): void => {
    if (state.status !== 'ready' || state.selectedProvider === '' || saveInFlightRef.current) return
    if (dirtyProvidersRef.current.size === 0) {
      setSaveFeedback({ phase: 'success', message: t('alreadyUpToDate') })
      return
    }
    saveInFlightRef.current = true
    setSaveFeedback({ phase: 'saving', message: t('saving') })
    let ops: ReturnType<typeof collectOpsForAllProviders>
    const dirtyProviders = new Set(dirtyProvidersRef.current)
    const saveVersion = dirtyVersionRef.current
    for (const provider of dirtyProviders) {
      const dirtyModels = dirtyModelFieldsRef.current.get(provider)
      if (!dirtyModels) continue
      for (const model of dirtyModels.keys()) {
        const draft = state.modelDrafts[provider]?.[model]
        if (draft?.reasoningMode === 'custom' && draft.efforts.length === 0) {
          saveInFlightRef.current = false
          setState(prev => ({ ...prev, error: t('reasoningEmptyError') }))
          setSaveFeedback({ phase: 'error', message: t('saveFailed') })
          return
        }
      }
    }
    try {
      ops = collectOpsForAllProviders(
        Object.keys(state.providers), state.providers, state.providerDrafts, state.modelDrafts,
        dirtyProviders, state.catalogGroups, state.runtimeCaps.modelCompatFields,
        dirtyProviderFieldsRef.current, dirtyModelFieldsRef.current, state.runtimeCaps.compatFields,
      )
    } catch (error: any) {
      saveInFlightRef.current = false
      setState(prev => ({ ...prev, error: String(error?.message ?? error) }))
      setSaveFeedback({ phase: 'error', message: t('saveFailed') })
      return
    }
    setState(prev => ({ ...prev, error: undefined }))
    void Promise.resolve().then(() => api.settings.mutate({ ns: PI_AI_NS, ops, expectedRevision: state.revision })).then((response: any) => {
      if (response?.result?.ok !== true) {
        throw new Error(response?.result?.error?.message ?? 'settings.mutate failed')
      }
      const nextRevision = mutationRevision(response)
      if (dirtyVersionRef.current !== saveVersion) {
        setState(prev => ({ ...prev, revision: nextRevision ?? prev.revision }))
        setSaveFeedback({ phase: 'pending', message: t('savedWithPending') })
        return
      }
      for (const provider of dirtyProviders) {
        dirtyProvidersRef.current.delete(provider)
        dirtyProviderFieldsRef.current.delete(provider)
        dirtyModelFieldsRef.current.delete(provider)
      }
      return load().then(() => {
        setSaveFeedback({ phase: 'success', message: t('saved') })
      })
    }).catch((error: any) => {
      const message = String(error?.message ?? error)
      const parsed = parseUnsupportedReasoningEffortError(message)
      const friendly = parsed
        ? `${t('reasoningEffortUnsupportedTitle')}${parsed.provider && parsed.model ? `\n${parsed.provider} / ${parsed.model}` : ''}${parsed.effort ? `\n${t('reasoningEffortUnsupportedHit')}: ${parsed.effort}` : ''}`
        : undefined
      setState(prev => ({ ...prev, error: friendly ?? message }))
      setSaveFeedback({ phase: 'error', message: t('saveFailed') })
      // Keep the conflict visible so the user can choose when to reload.
    }).finally(() => { saveInFlightRef.current = false })
  }

  const h = createElement
  if (state.status === 'loading') {
    return h('div', { className: 'dsh-mc-root' }, t('loading'))
  }
  if (state.status === 'error') {
    return h('div', { className: 'dsh-mc-root' },
      h('p', { className: 'dsh-mc-error' }, `${t('loadFailed')}: ${state.error ?? ''}`),
      h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-secondary', onClick: () => void load() }, t('retry')),
    )
  }
  if (!state.writable) {
    return h('div', { className: 'dsh-mc-root' }, t('readOnly'))
  }

  const providerNames = Object.keys(state.providers)
  if (providerNames.length === 0) {
    return h('div', { className: 'dsh-mc-root' },
      h('h2', { className: 'dsh-mc-title' }, t('nav')),
      h('p', { className: 'dsh-mc-intro' }, t('pageDescription')),
      h('p', { className: 'dsh-mc-empty' }, t('noProviders')),
    )
  }

  const provider = state.selectedProvider
  const providerDraft = state.providerDrafts[provider]
  const anthropic = isAnthropicProvider(provider, state.providers[provider], state.catalogGroups)
  const protocols = protocolsForProvider(provider, state.providers[provider], state.catalogGroups)
  const modelDrafts = state.modelDrafts[provider] ?? {}
  const modelIds = Object.keys(modelDrafts)
  const activeModel = selectedModel && modelIds.includes(selectedModel) ? selectedModel : (modelIds[0] ?? '')
  activeModelRef.current = activeModel
  const activeDraft = activeModel ? modelDrafts[activeModel] : undefined
  const activeCompatDrafts = activeDraft?.compat ?? {}
  const modelProtocols = activeModel
    ? protocolsForModel(provider, activeModel, state.providers[provider], state.catalogGroups)
    : protocols
  const modelAnthropic = activeModel
    ? isAnthropicModel(provider, activeModel, state.providers[provider], state.catalogGroups)
    : anthropic

  const providerCompat = providerDraft?.compat ?? {}
  const providerCommon = compatFieldsOf('common', false)
  const providerAdvanced = compatFieldsOf('advanced', true)
  const providerAnthropic = compatFieldsOf('anthropic', false)
  const providerCompatFields = state.runtimeCaps.compatFields
  const providerCommonMap = compatApplicableMap(providerCommon, protocols, providerCompat, providerCompatFields)
  const providerAdvancedMap = compatApplicableMap(providerAdvanced, protocols, providerCompat, providerCompatFields)
  const providerAnthropicMap = compatApplicableMap(providerAnthropic, protocols, providerCompat, providerCompatFields)
  const modelCompatFields = COMPAT_FIELDS
  const modelCompatMap = compatApplicableMap(modelCompatFields, modelProtocols, activeCompatDrafts, state.runtimeCaps.modelCompatFields)

  const resolvedInput = (() => {
    if (activeDraft && activeDraft.input.length > 0) return activeDraft.input
    if (providerDraft && providerDraft.defaultInput.length > 0) return providerDraft.defaultInput
    return ['text']
  })()

  const runtimeReasoning = activeModel
    ? resolveRuntimeReasoningCapability(state.catalogGroups, provider, activeModel)
    : { available: false, efforts: [], source: 'unknown' as const }
  const mismatch = activeDraft ? reasoningMismatch(activeDraft, runtimeReasoning) : { mismatch: false, authoring: [], runtime: [], missing: [], unresolved: false }

  const resolvedSource = (() => {
    if (!activeDraft) return ''
    if (activeDraft.input.length > 0 || activeDraft.reasoningMode !== 'inherit') return t('sourceOverride')
    if (providerDraft && (providerDraft.defaultInput.length > 0 || providerDraft.defaultReasoning !== '')) return t('sourceProvider')
    return t('sourceUnknown')
  })()

  const editableModelsByProvider: Record<string, string[]> = {}
  const reasoningEffortsByModel: Record<string, string[]> = {}
  for (const name of providerNames) {
    const ids = editableModelIds(name, state.providers[name], state.catalogGroups)
    editableModelsByProvider[name] = ids
    for (const model of ids) {
      reasoningEffortsByModel[`${name}\u0000${model}`] = resolveRuntimeReasoningCapability(state.catalogGroups, name, model).efforts
    }
  }
  const providerSupportsAgentOptions: Record<string, boolean> = {}
  for (const providerSnapshot of state.runtimeCaps.subagent.providers ?? []) {
    providerSupportsAgentOptions[providerSnapshot.name] = providerSnapshot.supportsAgentOptions
  }

  const providerDefaultMissing = (() => {
    const defaultReasoning = providerDraft?.defaultReasoning ?? ''
    if (defaultReasoning === '') return []
    const missing: string[] = []
    for (const group of asArray(state.catalogGroups)) {
      const g = asRecord(group)
      if (g['id'] !== provider) continue
      for (const item of asArray(g['models'])) {
        const m = asRecord(item)
        const id = typeof m['id'] === 'string' ? m['id'] as string : ''
        if (id === '') continue
        const cap = resolveRuntimeReasoningCapability(state.catalogGroups, provider, id)
        if (cap.available && !cap.efforts.includes(defaultReasoning)) missing.push(id)
      }
    }
    return missing
  })()

  const runtimeLabel = activeDraft?.reasoningMode === 'unsupported'
    ? t('unsupported')
    : runtimeReasoning.available && runtimeReasoning.efforts.length > 0
      ? runtimeReasoning.efforts.map(levelLabel).join(' \u00b7 ')
      : t('reasoningNotDeclared')

  const customEffortsLabel = activeDraft && activeDraft.efforts.length > 0
    ? activeDraft.efforts.map(levelLabel).join(' \u00b7 ')
    : t('notSelected')

  return h('div', { className: 'dsh-mc-root' },
    h('h2', { className: 'dsh-mc-title' }, t('nav')),
    h('p', { className: 'dsh-mc-intro' }, t('pageDescription')),
    state.error ? h('div', { className: 'dsh-mc-feedback' }, h('p', { className: 'dsh-mc-error' }, state.error), h('button', { type: 'button', className: 'dsh-mc-link-button', onClick: () => void load(true) }, t('reload'))) : null,

    providerDraft ? h(Panel, {
        title: t('providerSettings'),
        className: 'dsh-mc-provider-panel',
        caption: h(ModeStatus, { mode: state.dshMode, t }),
        action: h(CompactSelect, {
          value: provider,
          options: providerNames.map(name => ({ value: name, label: name })),
          onChange: changeProvider,
          ariaLabel: t('provider'),
        }),
      },
      h(Subsection, { title: t('defaultCapabilities') },
        h(SettingRow, {
          label: t('inputCapability'),
          depth: 1,
          control: h('div', { className: 'dsh-mc-chips' }, MODALITIES.map(modality => h(Chip, {
            key: modality,
            label: modalityLabel(modality),
            active: providerDraft.defaultInput.includes(modality),
            onClick: () => updateProviderDraft({ defaultInput: toggleValue(providerDraft.defaultInput, modality) }),
          }))),
        }),
        state.runtimeCaps.providerFields.has('defaultContextWindow') ? h(SettingRow, {
          label: t('defaultContextWindow'),
          depth: 1,
          control: h(InlineNumberEditor, { value: providerDraft.defaultContextWindow ?? '', onChange: value => updateProviderDraft({ defaultContextWindow: value }), placeholder: t('inherit'), ariaLabel: t('defaultContextWindow') }),
        }) : null,
        state.runtimeCaps.providerFields.has('defaultMaxTokens') ? h(SettingRow, {
          label: t('defaultMaxTokens'),
          depth: 1,
          control: h(InlineNumberEditor, { value: providerDraft.defaultMaxTokens ?? '', onChange: value => updateProviderDraft({ defaultMaxTokens: value }), placeholder: t('inherit'), ariaLabel: t('defaultMaxTokens') }),
        }) : null,
      ),
      h(Subsection, { title: t('reasoningCapabilities') },
        h(SettingRow, {
          label: t('defaultRequestReasoning'),
          depth: 1,
          title: t('defaultReasoningHint'),
          description: t('defaultReasoningHint'),
          warning: providerDefaultMissing.length > 0 ? t('defaultReasoningPartialWarning') : undefined,
          control: h(CompactSelect, {
            value: providerDraft.defaultReasoning,
            options: [{ value: '', label: t('inherit') }, ...LEVELS.map(level => ({ value: level, label: levelLabel(level) }))],
            onChange: (value: string) => updateProviderDraft({ defaultReasoning: value }),
            placeholder: t('inherit'),
            ariaLabel: t('defaultRequestReasoning'),
          }),
        }),
        anthropic ? h(SettingRow, {
          label: t('anthropicReasoningEffort'),
          depth: 1,
          control: h(CompactSelect, {
            value: providerDraft.adaptiveThinking,
            options: [{ value: 'inherit', label: t('inherit') }, { value: 'enabled', label: t('adaptiveEnabled') }, { value: 'disabled', label: t('adaptiveDisabled') }],
            onChange: (value: string) => updateProviderDraft({ adaptiveThinking: value as AdaptiveThinkingMode }),
            ariaLabel: t('anthropicReasoningEffort'),
          }),
        }) : null,
        h(DisclosureRow, { summary: t('thinkingBudgets'), value: Object.keys(providerDraft.thinkingBudgets ?? {}).length === 0 ? t('inherit') : t('configured'), depth: 1 },
          h('div', { className: 'dsh-mc-setting-rows' }, ['minimal', 'low', 'medium', 'high'].map(level => h(SettingRow, {
            key: level,
            label: levelLabel(level),
            depth: 2,
            density: 'nested',
            control: h(InlineNumberEditor, {
              value: providerDraft.thinkingBudgets?.[level] ?? '',
              onChange: (value: string) => {
                const budgets = { ...providerDraft.thinkingBudgets }
                if (value.trim() === '') delete budgets[level]
                else budgets[level] = value
                updateProviderDraft({ thinkingBudgets: budgets })
              },
              placeholder: t('inherit'),
              ariaLabel: level,
            }),
          }))),
        ),
      ),
      h(Subsection, { title: t('interfaceCompatibility') },
        h(CompatGroupSection, {
          fields: providerCommon,
          drafts: providerCompat,
          applicable: providerCommonMap.applicable,
          existing: providerCommonMap.existing,
          enumOptions: state.enumOptions,
          level: 'provider',
          t,
          onChange: updateProviderCompat,
          depth: 0,
          fieldDepth: 1,
        }),
        h(CompatDisclosure, {
          summary: t('advancedCompatibility'), variant: 'group', depth: 1, fieldDepth: 2, fields: providerAdvanced, drafts: providerCompat,
          applicable: providerAdvancedMap.applicable, existing: providerAdvancedMap.existing,
          enumOptions: state.enumOptions, level: 'provider', t, onChange: updateProviderCompat,
        }),
        h(CompatDisclosure, {
          summary: t('anthropicCompatibility'), variant: 'group', depth: 1, fieldDepth: 2, fields: providerAnthropic, drafts: providerCompat,
          applicable: providerAnthropicMap.applicable, existing: providerAnthropicMap.existing,
          enumOptions: state.enumOptions, level: 'provider', t, onChange: updateProviderCompat,
        }),
      ),
    ) : null,

    h(SubagentSettingsCard, {
      t, api, capabilities: state.runtimeCaps.subagent,
      controlValue: state.subagentControl.value, controlRevision: state.subagentControl.revision,
      controlWritable: state.subagentControl.writable, nativeNamespace: state.nativeSubagent,
      providerNames, editableModelsByProvider, reasoningEffortsByModel, providerSupportsAgentOptions,
      onApplied: () => void load(true),
    }),

    modelIds.length === 0
      ? h('p', { className: 'dsh-mc-empty' }, t('noModels'))
      : activeDraft ? h(Panel, {
          title: t('modelSettings'),
          className: 'dsh-mc-model-panel',
          action: h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-dense', onClick: resetModel }, t('resetModel')),
        },
        h(Subsection, { title: t('basicCapabilities') },
          h(SettingRow, {
            label: t('currentModel'),
            depth: 1,
            control: h(ModelRoutePicker, {
              options: buildProviderModelRouteOptions(provider, editableModelsByProvider[provider] ?? [], { current: { provider, model: activeModel } }),
              value: { provider, model: activeModel },
              onChange: (route: { provider: string; model: string } | null) => { if (route) changeCurrentModel(route.model) },
              ariaLabel: t('currentModel'),
              searchPlaceholder: t('searchModels'),
              searchAriaLabel: t('searchModels'),
              emptyLabel: t('noModels'),
              singleProvider: true,
            }),
          }),
          h(SettingRow, {
            label: t('inputCapability'),
            depth: 1,
            description: `${t('inputEffective')}：${resolvedInput.join(', ')} · ${resolvedSource}`,
            control: h('div', { className: 'dsh-mc-chips' }, MODALITIES.map(modality => h(Chip, {
              key: modality,
              label: modalityLabel(modality),
              active: activeDraft.input.includes(modality),
              onClick: () => updateModelDraft({ input: toggleValue(activeDraft.input, modality) }),
            }))),
          }),
          state.runtimeCaps.modelFields.has('contextWindow') ? h(SettingRow, {
            label: t('modelContextWindow'),
            depth: 1,
            control: h(InlineNumberEditor, { value: activeDraft.contextWindow ?? '', onChange: value => updateModelDraft({ contextWindow: value }), placeholder: t('inherit'), ariaLabel: t('modelContextWindow') }),
          }) : null,
          state.runtimeCaps.modelFields.has('maxTokens') ? h(SettingRow, {
            label: t('modelMaxTokens'),
            depth: 1,
            control: h(InlineNumberEditor, { value: activeDraft.maxTokens ?? '', onChange: value => updateModelDraft({ maxTokens: value }), placeholder: t('inherit'), ariaLabel: t('modelMaxTokens') }),
          }) : null,
        ),
        h(Subsection, { title: t('reasoningConfig') },
          h(SettingRow, {
            label: t('reasoningCapability'),
            depth: 1,
            control: h(CompactSelect, {
              value: activeDraft.reasoningMode,
              options: [{ value: 'inherit', label: t('inherit') }, { value: 'unsupported', label: t('unsupported') }, { value: 'custom', label: t('custom') }],
              onChange: (value: string) => updateModelDraft(value === 'custom'
                ? { reasoningMode: 'custom', efforts: activeDraft.efforts, wire: activeDraft.wire }
                : { reasoningMode: value as 'inherit' | 'unsupported', efforts: [], wire: {} }),
              ariaLabel: t('reasoningCapability'),
            }),
          }),
          h(SettingRow, {
            label: t('dshCurrentReasoning'),
            depth: 1,
            control: h('span', { className: 'dsh-mc-muted' }, runtimeLabel),
          }),
          activeDraft.reasoningMode === 'custom' ? h(DisclosureRow, {
            summary: t('declaredReasoningLevels'),
            value: customEffortsLabel,
            description: activeDraft.efforts.length === 0 ? t('reasoningEmptyHint') : undefined,
            depth: 1,
          },
          h('div', { className: 'dsh-mc-setting-rows dsh-mc-reasoning-levels' },
            h(SettingRow, {
              label: t('declaredReasoningLevels'),
              depth: 2,
              density: 'nested',
              control: h('div', { className: 'dsh-mc-chips' }, LEVELS.map(level => h(Chip, {
                key: level, label: levelLabel(level), active: activeDraft.efforts.includes(level), onClick: () => toggleReasoningLevel(level),
              }))),
            }),
          )) : null,
          activeDraft.reasoningMode === 'custom' ? h(DisclosureRow, { summary: t('reasoningWire'), value: t('configured'), depth: 1 },
            h('div', { className: 'dsh-mc-setting-rows' }, activeDraft.efforts.map(level => h(SettingRow, {
              key: level,
              label: levelLabel(level),
              depth: 2,
              density: 'nested',
              control: h('input', {
                className: 'dsh-mc-inline-input',
                value: reasoningWireFor(activeDraft, level as PiAiReasoningLevel, modelAnthropic) ?? '',
                onChange: (event: any) => updateReasoningWire(level, event.target.value),
                'aria-label': level,
              }),
            }))),
          ) : null,
          activeDraft.reasoningMode === 'custom' && mismatch.mismatch ? h(SettingRow, {
            label: t('declaredReasoningLevels'),
            depth: 1,
            description: t('reasoningMismatchHint'),
            warning: mismatch.unresolved ? t('reasoningUnresolvedWarning') : t('reasoningMismatchWarning'),
            control: h('span', { className: 'dsh-mc-muted' }, mismatch.missing.map(levelLabel).join(' · ')),
          }) : null,
        ),
        h(DisclosureRow, { summary: t('modelCompatDisclosure'), variant: 'section', depth: 0 },
          h('div', { className: 'dsh-mc-disclosure-fields' },
            h(CompatGroupSection, {
              fields: modelCompatFields.filter(field => field.group === 'common'), drafts: activeCompatDrafts,
              applicable: modelCompatMap.applicable, existing: modelCompatMap.existing,
              enumOptions: state.enumOptions, level: 'model', t, onChange: updateModelCompat,
              depth: 0,
              fieldDepth: 1,
            }),
            h(CompatDisclosure, {
              summary: t('advancedCompatibility'), variant: 'group', depth: 1, fieldDepth: 2, fields: modelCompatFields.filter(field => field.group === 'advanced'), drafts: activeCompatDrafts,
              applicable: modelCompatMap.applicable, existing: modelCompatMap.existing,
              enumOptions: state.enumOptions, level: 'model', t, onChange: updateModelCompat,
            }),
            h(CompatDisclosure, {
              summary: t('anthropicCompatibility'), variant: 'group', depth: 1, fieldDepth: 2, fields: modelCompatFields.filter(field => field.group === 'anthropic'), drafts: activeCompatDrafts,
              applicable: modelCompatMap.applicable, existing: modelCompatMap.existing,
              enumOptions: state.enumOptions, level: 'model', t, onChange: updateModelCompat,
            }),
          ),
        ),
        ) : null,

    h('div', { className: 'dsh-mc-action-row' },
      h('div', { className: 'dsh-mc-action-feedback', role: saveFeedback.phase === 'error' ? 'alert' : 'status', 'aria-live': saveFeedback.phase === 'error' ? 'assertive' : 'polite' },
        saveFeedback.phase !== 'idle'
          ? h('span', { className: `dsh-mc-save-feedback dsh-mc-save-feedback-${saveFeedback.phase}` },
              saveFeedback.phase === 'success' ? h('span', { className: 'dsh-mc-save-icon', 'aria-hidden': true }, h(CheckIcon)) : null,
              saveFeedback.message ?? '',
            )
          : null,
      ),
      h('div', { className: 'dsh-mc-action-buttons' },
        h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-secondary', onClick: resetProvider }, t('resetProvider')),
        h('button', {
          type: 'button',
          className: 'dsh-mc-button dsh-mc-button-primary',
          onClick: save,
          disabled: saveButtonDisabled(dirtyProvidersRef.current.size > 0, saveFeedback.phase),
          'aria-busy': saveFeedback.phase === 'saving',
        }, saveFeedback.phase === 'saving' ? t('saving') : t('save')),
      ),
    ),
  )
}

export const inject = ['slots', 'locale', 'connection', 'remote']

export const zh: Record<string, string> = {
  nav: '模型能力',
  pageDescription: '管理 DSH 模型能力、推理能力与接口兼容性。所有修改仅写入原生配置，不修改适配器源码。',
  loading: '加载中…',
  loadFailed: '加载失败',
  retry: '重试',
   reload: '重新加载',
  readOnly: '当前部署为只读模式。',
  namespaceMissing: 'llm-pi-ai 设置命名空间未注册。',
  provider: '提供方',
  providerDefaults: '提供方默认能力',
  reasoningCapabilities: '推理能力',
  interfaceCompatibility: '接口兼容性',
  advancedCompatibility: '高级兼容性',
  anthropicCompatibility: 'Anthropic 兼容性',
  modelCompatDisclosure: '兼容性覆盖',
  modelCapabilities: '模型能力',
  modelSettings: '模型设置',
  currentModel: '当前模型',
  configured: '已配置',
  'subagent.defaultModel': '默认模型',
  'subagent.allowedModels.selectedSuffix': '个已选择模型',
  'compat.notConfigured': '未配置',
  'compat.configured': '已配置',
  inputCapability: '输入能力',
  inputEffective: '当前生效',
  defaultReasoning: '默认推理等级',
  inherit: '继承',
  saving: '保存中…',
  saved: '已保存',
  alreadyUpToDate: '已是最新',
  saveFailed: '保存失败',
   savedWithPending: '本批次已保存，仍有未保存修改',
   'compat.clearOverride': '清除覆盖',
  save: '保存能力',
  resetProvider: '恢复提供方默认',
  resetModel: '恢复默认',
  models: '模型',
  searchModels: '搜索模型…',
  noModels: '没有可用模型',
  noProviders: '没有配置提供方',
  input: '输入',
  reasoning: '推理',
  source: '来源',
  sourceOverride: '模型覆盖',
  sourceProvider: '提供方默认',
  sourceUnknown: '未知',
  summaryInherit: '继承提供方',
  summaryCustom: '自定义',
  summaryUnsupported: '不支持推理',
  modeNative: '原生模式 · rc.8',
  modeLegacyRc6Title: '旧版兼容模式 · rc.6',
  modeLegacyRc6Detail: '需配套适配器补丁：不支持原生 settings 语义，能力配置只起提示作用。',
  modeLegacyRc7Title: '旧版兼容模式 · rc.7',
  modeLegacyRc7Detail: '需配套适配器补丁：已支持原生 settings，但缺少部分 rc.8 字段。',
  modeLegacyTitle: '旧版兼容模式',
  modeLegacyDetail: '无法精确判定 rc 版本，请按文档确认适配器补丁。',
  adaptiveEnabled: '启用',
  adaptiveDisabled: '禁用',
  anthropicReasoningEffort: 'Anthropic 自适应推理',
  anthropicReasoningEffortDescription: '写入 compat.forceAdaptiveThinking。',
  thinkingBudgets: '推理预算',
  defaultContextWindow: '默认上下文窗口',
  defaultMaxTokens: '默认最大输出',
  modelContextWindow: '上下文窗口',
  modelMaxTokens: '最大输出',
  reasoningLevels: '推理等级',
  reasoningWire: 'Wire 映射',
  resolvedCapability: '解析后能力',
  'subagent.title': '子代理',
  'subagent.warning.unverified': '子代理版本无法确认，以下设置按当前检测到的 Schema 显示；低版本可能不生效。',
  'subagent.warning.legacy': '当前子代理版本低于已验证范围，部分设置可能不生效。',
  'subagent.legacy.description': '固定模型模式：为新子代理实例写入 provider/model/maxTokens。',
  'subagent.native.description': '动态模型选择：使用官方 subagent-model-selection 命名空间。',
  'subagent.status.legacy': '固定模型',
  'subagent.status.native': '动态选择',
  'subagent.defaultBehavior': '默认行为',
  'subagent.inheritMain': '继承主模型',
  'subagent.fixedModel': '固定子代理模型',
  'subagent.provider': '子代理提供方',
  'subagent.model': '子代理模型',
  'subagent.maxTokens': '最大输出 tokens',
  'subagent.maxTokensPlaceholder': '留空继承',
  'subagent.reasoningEffort': '推理等级',
  'subagent.reasoning.auto': '自动',
  'subagent.effectiveNote': '保存后对新建子代理会话生效。',
  'subagent.backendManagesModel': '该子代理后端由其运行时自身管理模型配置。',
  'subagent.agentOptionsUnsupported': '当前子代理运行时不支持 agentOptions 固定模型配置。',
  'subagent.apply': '应用子代理设置',
  'subagent.savedNewSessions': '已保存，对新的子代理会话生效。',
  'subagent.applyFailed': '保存失败',
  'subagent.readonly': '子代理设置当前为只读。',
  'subagent.modelSelectionNotEnabled': '动态模型选择尚未启用。',
  'subagent.enableModelSelection': '启用动态模型选择',
  'subagent.modelSelectionConfigRequired': '需要 DSH 配置启用子代理模型选择功能。',
  'subagent.enableDynamicSelection': '启用动态选择',
  'subagent.allowedModels': '允许的模型池',
  'subagent.allowedModels.description': '子代理可在此池中自行选择模型。',
  'subagent.allowedModels.emptySummary': '尚未选择模型',
  'subagent.allowedModels.empty': '启用动态选择时至少需要一个模型。',
  'subagent.allowedModels.duplicate': '模型池中存在重复的 提供方/模型 组合。',
  'subagent.allowedModels.incomplete': '模型池中存在未填完整的条目。',
  'subagent.editPool': '编辑模型池',
  'subagent.doneEditingPool': '完成',
  'subagent.searchPool': '搜索模型…',
  'subagent.defaultModelDisclosure': '默认模型（高级）',
  'subagent.defaultModelNote': '动态选择启用后，可通过上方固定模型设置指定默认模型；留空继承主模型。',
  'subagent.selectProvider': '选择提供方',
  'subagent.selectModel': '选择模型',
  'compat.providerAuto': '自动',
  'compat.modelInheritProvider': '继承提供方',
  'compat.auto': '自动',
  'compat.enabled': '开启',
  'compat.disabled': '关闭',
  'compat.notApplicableWarning': '当前协议未使用此配置；已有值已保留，可在此清除。',
  'compat.format.auto': '自动',
  'compat.role.auto': '自动',
  'compat.role.inheritProvider': '继承提供方',
  'compat.role.developer': 'Developer',
  'compat.role.system': 'System',
  'compat.supportsStore.label': '支持 Store',
  'compat.supportsStore.description': '兼容 OpenAI Store 能力标记。',
  'compat.supportsDeveloperRole.label': '开发者角色',
  'compat.supportsDeveloperRole.description': 'OpenAI 兼容接口的角色取值：自动 / Developer / System。',
  'compat.supportsReasoningEffort.label': '支持 reasoning_effort',
  'compat.supportsReasoningEffort.description': '兼容 OpenAI reasoning_effort 参数。',
  'compat.supportsUsageInStreaming.label': '流式返回 usage',
  'compat.supportsUsageInStreaming.description': '流式响应中返回 usage 数据。',
  'compat.supportsFinishReason.label': '支持 finish_reason',
  'compat.supportsFinishReason.description': '流式响应中返回 finish_reason。',
  'compat.maxTokensField.label': 'max_tokens 字段',
  'compat.maxTokensField.description': '请求使用的 token 参数字段名。',
  'compat.requiresToolResultName.label': '工具结果需名称',
  'compat.requiresToolResultName.description': '工具结果消息要求 name 字段。',
  'compat.requiresAssistantAfterToolResult.label': '工具结果后需 assistant',
  'compat.requiresAssistantAfterToolResult.description': '工具结果后要求 assistant 消息。',
  'compat.requiresThinkingAsText.label': '思考以文本返回',
  'compat.requiresThinkingAsText.description': '思考内容以文本消息返回。',
  'compat.requiresReasoningContentOnAssistantMessages.label': 'assistant 消息需 reasoning_content',
  'compat.requiresReasoningContentOnAssistantMessages.description': 'assistant 消息要求 reasoning_content 字段。',
  'compat.thinkingFormat.label': '思考格式',
  'compat.thinkingFormat.description': '思考内容的返回格式。',
  'compat.supportsThinkingTokenBudget.label': '支持 thinking token 预算',
  'compat.supportsThinkingTokenBudget.description': '兼容 thinking token 预算参数。',
  'compat.supportsStrictMode.label': '支持 strict mode',
  'compat.supportsStrictMode.description': '兼容严格模式开关。',
  'compat.supportsLongCacheRetention.label': '支持长缓存保留',
  'compat.supportsLongCacheRetention.description': '兼容长缓存保留策略。',
  'compat.chatTemplateKwargs.label': 'chatTemplate 参数',
  'compat.chatTemplateKwargs.description': 'JSON 对象，合并到 chat template 关键字参数。',
  'compat.chatTemplateArgs.label': 'chatTemplate 位置参数',
  'compat.chatTemplateArgs.description': 'JSON 对象，合并到 chat template 位置参数。',
  'compat.cacheControlFormat.label': '缓存控制格式',
  'compat.cacheControlFormat.description': 'Anthropic 缓存控制字段格式。',
  'compat.supportsEagerToolInputStreaming.label': 'Tool 输入流式预取',
  'compat.supportsEagerToolInputStreaming.description': '控制 Anthropic 兼容接口是否支持提前流式返回 Tool 输入。',
  'compat.supportsCacheControlOnTools.label': 'Tool Cache Control',
  'compat.supportsCacheControlOnTools.description': '控制 Tool 定义是否支持 cache_control。',
  'compat.supportsTemperature.label': 'Temperature 参数',
  'compat.supportsTemperature.description': '控制 Anthropic 兼容接口是否发送 temperature 参数。',
  'compat.forceAdaptiveThinking.label': '强制自适应思考',
  'compat.forceAdaptiveThinking.description': '强制启用 adaptive thinking。',
  'compat.allowEmptySignature.label': '允许空签名',
  'compat.allowEmptySignature.description': '允许空工具签名。',
  'compat.supportsStrictTools.label': '支持严格工具模式',
  'compat.supportsStrictTools.description': '兼容严格工具模式。',
  'compat.requiresExactFormatting.label': '要求精确格式化',
  'compat.requiresExactFormatting.description': '要求消息精确格式化。',

  providerSettings: '提供方设置',
  defaultCapabilities: '默认能力',
  basicCapabilities: '基础能力',
  reasoningConfig: '推理配置',
  reasoningCapability: '推理能力',
  custom: '自定义',
  unsupported: '不支持推理',
  defaultRequestReasoning: '默认请求推理等级',
  defaultReasoningHint: '提供方级请求默认值。它不会声明所有模型都支持该推理等级。',
  defaultReasoningPartialWarning: 'ⓘ 当前 Provider 中部分模型没有声明该默认等级。',
  dshCurrentReasoning: '运行时支持',
  declaredReasoningLevels: '声明等级',
  reasoningEmptyHint: '请至少选择一个推理等级。',
  reasoningNotDeclared: '未声明',
  reasoningEmptyError: '当前模型处于“自定义推理能力”模式，请至少选择一个推理等级。',
  reasoningMismatchHint: '保存后 DSH 可能尚未重新解析。',
  reasoningMismatchWarning: '推理能力配置已保存，但 DSH 当前 exact model 尚未解析出全部声明等级。请检查 provider/model 路由及 modelOverride。如果当前会话仍报 Max 不支持，请在 DSH 原生模型选择器中将推理等级改为 Provider Default 或当前模型支持的档位。',
  reasoningUnresolvedWarning: '推理能力配置已保存，但 DSH 当前 exact model 尚未解析出推理能力。请检查 provider/model 路由及 modelOverride。如果当前会话仍报 Max 不支持，请在 DSH 原生模型选择器中将推理等级改为 Provider Default 或当前模型支持的档位。',
  resolvedInput: '解析输入',
  reasoningEffortUnsupportedTitle: '推理等级不兼容',
  reasoningEffortUnsupportedHit: '当前 DSH 没有声明支持',
  modeNativeDetail: '无需适配器补丁。',
  'subagent.reasoning.unsupportedSuffix': '（当前不支持）',
  'subagent.reasoning.unsupportedBlocked': '当前模型不支持所选推理等级，请先切换到支持的档位。',
  'compat.supportsStreaming.label': '支持流式',
  'compat.supportsStreaming.description': '兼容流式响应。',
}

export const en: Record<string, string> = {
  nav: 'Model Capabilities',
  pageDescription: 'Manage DSH model capabilities, reasoning and wire compatibility. Writes native settings only — never patches adapter sources.',
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  retry: 'Retry',
  reload: 'Reload',
  readOnly: 'Settings are read-only in this deployment.',
  namespaceMissing: 'The llm-pi-ai settings namespace is not registered.',
  provider: 'Provider',
  providerDefaults: 'Provider Defaults',
  reasoningCapabilities: 'Reasoning',
  interfaceCompatibility: 'Interface Compatibility',
  advancedCompatibility: 'Advanced Compatibility',
  anthropicCompatibility: 'Anthropic Compatibility',
  modelCompatDisclosure: 'Compatibility Overrides',
  modelCapabilities: 'Model capabilities',
  modelSettings: 'Model settings',
  currentModel: 'Current model',
  configured: 'Configured',
  'subagent.defaultModel': 'Default model',
  'subagent.allowedModels.selectedSuffix': 'selected models',
  'compat.notConfigured': 'Not configured',
  'compat.configured': 'Configured',
  inputCapability: 'Input capability',
  inputEffective: 'Effective',
  defaultReasoning: 'Default reasoning',
  inherit: 'Inherit',
  saving: 'Saving…',
  saved: 'Saved',
  alreadyUpToDate: 'Already up to date',
  saveFailed: 'Save failed',
  savedWithPending: 'Batch saved; unsaved changes remain',
  'compat.clearOverride': 'Clear override',
  save: 'Save capabilities',
  resetProvider: 'Reset provider',
  resetModel: 'Reset model',
  models: 'Models',
  searchModels: 'Search models…',
  noModels: 'No models available',
  noProviders: 'No providers configured',
  input: 'Input',
  reasoning: 'Reasoning',
  source: 'Source',
  sourceOverride: 'Model Override',
  sourceProvider: 'Provider Default',
  sourceUnknown: 'Unknown',
  summaryInherit: 'Inherits provider defaults',
  summaryCustom: 'Custom',
  summaryUnsupported: 'Unsupported',
  modeNative: 'Native mode · rc.8',
  modeLegacyRc6Title: 'Legacy compatibility · rc.6',
  modeLegacyRc6Detail: 'Requires the matching adapter patch; native settings semantics are unavailable.',
  modeLegacyRc7Title: 'Legacy compatibility · rc.7',
  modeLegacyRc7Detail: 'Requires the matching adapter patch; some rc.8 fields are missing.',
  modeLegacyTitle: 'Legacy compatibility',
  modeLegacyDetail: 'Exact rc could not be determined; confirm the adapter patch version.',
  adaptiveEnabled: 'Enabled',
  adaptiveDisabled: 'Disabled',
  anthropicReasoningEffort: 'Anthropic adaptive thinking',
  anthropicReasoningEffortDescription: 'Writes compat.forceAdaptiveThinking.',
  thinkingBudgets: 'Thinking budgets',
  defaultContextWindow: 'Default context window',
  defaultMaxTokens: 'Default max output tokens',
  modelContextWindow: 'Context window',
  modelMaxTokens: 'Max output tokens',
  reasoningLevels: 'Reasoning levels',
  reasoningWire: 'Wire mapping',
  resolvedCapability: 'Resolved capability',
  'subagent.title': 'Subagents',
  'subagent.warning.unverified': 'Subagent version could not be confirmed. Settings below follow the detected Schema; older versions may not apply them.',
  'subagent.warning.legacy': 'The subagent version is below the verified range; some settings may not apply.',
  'subagent.legacy.description': 'Fixed model mode: writes provider/model/maxTokens for new subagent instances.',
  'subagent.native.description': 'Dynamic selection: uses the official subagent-model-selection namespace.',
  'subagent.status.legacy': 'Fixed model',
  'subagent.status.native': 'Dynamic selection',
  'subagent.defaultBehavior': 'Default behavior',
  'subagent.inheritMain': 'Inherit main model',
  'subagent.fixedModel': 'Fixed subagent model',
  'subagent.provider': 'Subagent provider',
  'subagent.model': 'Subagent model',
  'subagent.maxTokens': 'Max output tokens',
  'subagent.maxTokensPlaceholder': 'Leave empty to inherit',
  'subagent.reasoningEffort': 'Reasoning effort',
  'subagent.reasoning.auto': 'Auto',
  'subagent.effectiveNote': 'Applies to newly created subagent sessions.',
  'subagent.backendManagesModel': 'This subagent backend manages model configuration in its own runtime.',
  'subagent.agentOptionsUnsupported': 'The subagent runtime does not support fixed agentOptions model configuration.',
  'subagent.apply': 'Apply subagent settings',
  'subagent.savedNewSessions': 'Saved — applies to new subagent sessions.',
  'subagent.applyFailed': 'Failed to save',
  'subagent.readonly': 'Subagent settings are read-only.',
  'subagent.modelSelectionNotEnabled': 'Dynamic model selection is not enabled yet.',
  'subagent.enableModelSelection': 'Enable dynamic model selection',
  'subagent.modelSelectionConfigRequired': 'DSH configuration must enable subagent model selection.',
  'subagent.enableDynamicSelection': 'Enable dynamic selection',
  'subagent.allowedModels': 'Allowed model pool',
  'subagent.allowedModels.description': 'Subagents may choose models from this pool.',
  'subagent.allowedModels.emptySummary': 'No models selected yet',
  'subagent.allowedModels.empty': 'Dynamic selection needs at least one model.',
  'subagent.allowedModels.duplicate': 'Duplicate provider/model entries in the pool.',
  'subagent.allowedModels.incomplete': 'Incomplete provider/model entries in the pool.',
  'subagent.editPool': 'Edit pool',
  'subagent.doneEditingPool': 'Done',
  'subagent.searchPool': 'Search models…',
  'subagent.defaultModelDisclosure': 'Default model (advanced)',
  'subagent.defaultModelNote': 'When dynamic selection is enabled, the fixed-model settings above can define a default; leave empty to inherit the main model.',
  'subagent.selectProvider': 'Select provider',
  'subagent.selectModel': 'Select model',
  'compat.providerAuto': 'Auto',
  'compat.modelInheritProvider': 'Inherit provider',
  'compat.auto': 'Auto',
  'compat.enabled': 'Enabled',
  'compat.disabled': 'Disabled',
  'compat.notApplicableWarning': 'This field is not used by the current protocol; the existing value is kept and can be cleared here.',
  'compat.format.auto': 'Auto',
  'compat.role.auto': 'Auto',
  'compat.role.inheritProvider': 'Inherit provider',
  'compat.role.developer': 'Developer',
  'compat.role.system': 'System',
  'compat.supportsStore.label': 'Supports store',
  'compat.supportsStore.description': 'OpenAI store capability flag.',
  'compat.supportsDeveloperRole.label': 'Developer role',
  'compat.supportsDeveloperRole.description': 'Role value for OpenAI-compatible APIs: auto / developer / system.',
  'compat.supportsReasoningEffort.label': 'Supports reasoning_effort',
  'compat.supportsReasoningEffort.description': 'Accepts the OpenAI reasoning_effort parameter.',
  'compat.supportsUsageInStreaming.label': 'Streaming usage',
  'compat.supportsUsageInStreaming.description': 'Includes usage data in streaming responses.',
  'compat.supportsFinishReason.label': 'Supports finish_reason',
  'compat.supportsFinishReason.description': 'Includes finish_reason in streaming responses.',
  'compat.maxTokensField.label': 'max_tokens field',
  'compat.maxTokensField.description': 'Token parameter name used in requests.',
  'compat.requiresToolResultName.label': 'Tool result requires name',
  'compat.requiresToolResultName.description': 'Tool result messages must include a name.',
  'compat.requiresAssistantAfterToolResult.label': 'Assistant after tool result',
  'compat.requiresAssistantAfterToolResult.description': 'Assistant message required after tool results.',
  'compat.requiresThinkingAsText.label': 'Thinking as text',
  'compat.requiresThinkingAsText.description': 'Thinking content is returned as a text message.',
  'compat.requiresReasoningContentOnAssistantMessages.label': 'Reasoning content on assistant messages',
  'compat.requiresReasoningContentOnAssistantMessages.description': 'Assistant messages require reasoning_content.',
  'compat.thinkingFormat.label': 'Thinking format',
  'compat.thinkingFormat.description': 'Format used for thinking content.',
  'compat.supportsThinkingTokenBudget.label': 'Supports thinking token budget',
  'compat.supportsThinkingTokenBudget.description': 'Accepts thinking token budget parameters.',
  'compat.supportsStrictMode.label': 'Supports strict mode',
  'compat.supportsStrictMode.description': 'Accepts strict mode toggles.',
  'compat.supportsLongCacheRetention.label': 'Supports long cache retention',
  'compat.supportsLongCacheRetention.description': 'Accepts long cache retention policies.',
  'compat.chatTemplateKwargs.label': 'chatTemplate kwargs',
  'compat.chatTemplateKwargs.description': 'JSON object merged into chat template keyword arguments.',
  'compat.chatTemplateArgs.label': 'chatTemplate args',
  'compat.chatTemplateArgs.description': 'JSON object merged into chat template positional arguments.',
  'compat.cacheControlFormat.label': 'Cache control format',
  'compat.cacheControlFormat.description': 'Anthropic cache control field format.',
  'compat.supportsEagerToolInputStreaming.label': 'Eager tool input streaming',
  'compat.supportsEagerToolInputStreaming.description': 'Controls whether the Anthropic-compatible API streams tool input eagerly.',
  'compat.supportsCacheControlOnTools.label': 'Cache control on tools',
  'compat.supportsCacheControlOnTools.description': 'Controls whether tool definitions support cache_control.',
  'compat.supportsTemperature.label': 'Temperature parameter',
  'compat.supportsTemperature.description': 'Controls whether the Anthropic-compatible API sends the temperature parameter.',
  'compat.forceAdaptiveThinking.label': 'Force adaptive thinking',
  'compat.forceAdaptiveThinking.description': 'Force adaptive thinking on.',
  'compat.allowEmptySignature.label': 'Allow empty signature',
  'compat.allowEmptySignature.description': 'Allow empty tool signatures.',
  'compat.supportsStrictTools.label': 'Supports strict tools',
  'compat.supportsStrictTools.description': 'Accepts strict tool mode.',
  'compat.requiresExactFormatting.label': 'Requires exact formatting',
  'compat.requiresExactFormatting.description': 'Requires exact message formatting.',

  providerSettings: 'Provider settings',
  defaultCapabilities: 'Default capabilities',
  basicCapabilities: 'Basic capabilities',
  reasoningConfig: 'Reasoning',
  reasoningCapability: 'Reasoning capability',
  custom: 'Custom',
  unsupported: 'Unsupported',
  defaultRequestReasoning: 'Default request reasoning',
  defaultReasoningHint: 'Provider-level request default. It does not declare that every model supports this effort.',
  defaultReasoningPartialWarning: 'ⓘ Some models on this provider do not declare the default effort.',
  dshCurrentReasoning: 'Runtime support',
  declaredReasoningLevels: 'Declared levels',
  reasoningEmptyHint: 'Select at least one reasoning level.',
  reasoningNotDeclared: 'Not declared',
  reasoningEmptyError: 'The current model is in "custom reasoning" mode; select at least one reasoning level.',
  reasoningMismatchHint: 'DSH may not have re-resolved after save.',
  reasoningMismatchWarning: 'Saved, but DSH has not resolved all declared levels for the exact model. Check the provider/model route and modelOverride. If the current session still reports Max unsupported, switch the reasoning level to Provider Default or a supported level in the native model selector.',
  reasoningUnresolvedWarning: 'Saved, but DSH has not resolved reasoning for the exact model yet. Check the provider/model route and modelOverride. If the current session still reports Max unsupported, switch the reasoning level to Provider Default or a supported level in the native model selector.',
  resolvedInput: 'Resolved input',
  reasoningEffortUnsupportedTitle: 'Reasoning effort not supported',
  reasoningEffortUnsupportedHit: 'DSH currently does not declare support for',
  modeNativeDetail: 'No adapter patch required.',
  'subagent.reasoning.unsupportedSuffix': '(currently unsupported)',
  'subagent.reasoning.unsupportedBlocked': 'The current model does not support the selected reasoning level; switch to a supported level first.',
  'compat.supportsStreaming.label': 'Supports streaming',
  'compat.supportsStreaming.description': 'Accepts streaming responses.',
}

export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), '@deepseek-ai/dsh-llm-pi-ai-capabilities: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'llm-pi-ai-capabilities',
      order: 30,
      label: () => t('nav'),
      inject: () => ({
        api: ctx.get('connection').api,
        remote: ctx.get('remote'),
        t,
      }),
    }, CapabilitiesSection),
  ), '@deepseek-ai/dsh-llm-pi-ai-capabilities: settings section')
}
