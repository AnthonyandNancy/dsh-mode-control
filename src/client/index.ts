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
  collectOpsForModels,
  collectOpsForProvider,
  defaultReasoningWire,
  detectDshMode,
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
import { COMPAT_FIELDS, isCompatFieldApplicable, type CompatFieldDefinition } from './compat-fields.ts'
import type { CompatDrafts } from './compat-state.ts'
import { CompatDisclosure, CompatGroupSection } from './compat-ui.ts'
import { collectRuntimeCapabilities, protocolsForProvider, schemaEnumValues, schemaObjectKeys, type RuntimeCapabilities } from './runtime-capabilities.ts'
import { SubagentSettingsCard } from './subagent-ui.ts'
import { SUBAGENT_MODEL_SELECTION_NAMESPACE, SUBAGENT_NAMESPACE } from '../subagent/constants.ts'
import { Chip, Disclosure, Dropdown, Field, NumberInput, TextInput } from './ui.ts'

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
  enumOptions: { maxTokensField: string[]; thinkingFormat: string[] }
  error?: string
  saved?: string
}

const EMPTY_RUNTIME_CAPS: RuntimeCapabilities = {
  compatFields: new Set(),
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
  enumOptions: { maxTokensField: [], thinkingFormat: [] },
}

function modelListOf(
  provider: string,
  providerConfig: unknown,
  catalogGroups: unknown[],
): string[] {
  const ids = new Set<string>()
  const cfg = asRecord(providerConfig)

  const models = asArray(cfg['models'])
  if (models.length > 0) {
    for (const model of models) {
      const entry = asRecord(model)
      if (typeof entry['id'] === 'string') ids.add(entry['id'] as string)
    }
    return [...ids]
  }

  const overrides = asRecord(cfg['modelOverrides'])
  if (Object.keys(overrides).length > 0) {
    return Object.keys(overrides)
  }

  for (const group of catalogGroups) {
    const g = asRecord(group)
    if (g['id'] !== provider) continue
    for (const model of asArray(g['models'])) {
      const m = asRecord(model)
      if (typeof m['id'] === 'string') ids.add(m['id'] as string)
    }
  }
  return [...ids]
}

function modelConfigOf(providerConfig: unknown, model: string): unknown {
  const cfg = asRecord(providerConfig)
  const models = asArray(cfg['models'])
  const found = models.find(entry => asRecord(entry)['id'] === model)
  if (found !== undefined) return found
  const overrides = asRecord(cfg['modelOverrides'])
  return overrides[model]
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
): { applicable: Record<string, boolean>; existing: Record<string, boolean> } {
  const applicable: Record<string, boolean> = {}
  const existing: Record<string, boolean> = {}
  for (const field of fields) {
    applicable[field.key] = isCompatFieldApplicable(field, protocols)
    const draft = drafts[field.key]
    existing[field.key] = draft !== undefined && (
      (draft.kind === 'boolean' && draft.mode !== 'inherit') ||
      (draft.kind === 'enum' && draft.value !== '') ||
      (draft.kind === 'json' && draft.text.trim() !== '')
    )
  }
  return { applicable, existing }
}

function reasoningEffortsOf(modelDraft: ModelDraft | undefined, providerDraft: ProviderDraft | undefined): string[] {
  if (!modelDraft) return []
  if (modelDraft.reasoningMode === 'unsupported') return []
  if (modelDraft.reasoningMode === 'custom') return modelDraft.efforts
  if (providerDraft?.defaultReasoning) return [providerDraft.defaultReasoning]
  return []
}

function injectStyles(): void {
  const id = '@deepseek-ai/dsh-llm-pi-ai-capabilities/styles'
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${id}"]`)) return
  const css = `
.dsh-mc-root{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.dsh-mc-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.dsh-mc-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.dsh-mc-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:12px;padding:12px 14px;display:flex}
.dsh-mc-card-header{display:flex;justify-content:space-between;align-items:center;gap:8px}
.dsh-mc-section-title{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.dsh-mc-field{flex-direction:column;gap:6px;display:flex}
.dsh-mc-field-label{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:18px}
.dsh-mc-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-mc-error{color:var(--dsw-alias-danger-default);font-size:13px;line-height:18px;margin:0}
.dsh-mc-saved{color:var(--dsw-alias-success-default);font-size:13px;line-height:18px;margin:0}
.dsh-mc-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px}
.dsh-mc-chips{flex-wrap:wrap;gap:6px;display:flex}
.dsh-mc-chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:4px 12px;font-size:13px;cursor:pointer}
.dsh-mc-chip-active{border-color:var(--dsw-alias-primary-default);color:var(--dsw-alias-primary-default);font-weight:500}
.dsh-mc-input,.dsh-mc-textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:13px;line-height:18px;box-sizing:border-box}
.dsh-mc-textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;min-height:64px}
.dsh-mc-input:focus,.dsh-mc-textarea:focus{outline:none;border-color:var(--dsw-alias-primary-default)}
.dsh-mc-button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer}
.dsh-mc-button:hover{border-color:var(--dsw-alias-primary-default);color:var(--dsw-alias-primary-default)}
.dsh-mc-link-button{background:none;border:none;color:var(--dsw-alias-primary-default);font-size:13px;cursor:pointer;padding:0}
.dsh-mc-dropdown{position:relative;min-width:0}
.dsh-mc-dropdown-button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:13px;width:100%;display:flex;align-items:center;gap:8px;cursor:pointer}
.dsh-mc-dropdown-list{position:absolute;z-index:10;top:calc(100% + 4px);left:0;right:0;max-height:240px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);border-radius:8px;padding:4px;box-shadow:0 4px 16px rgb(0 0 0 / 12%)}
.dsh-mc-dropdown-item{display:block;width:100%;text-align:left;border:none;background:none;color:var(--dsw-alias-label-primary);padding:6px 8px;border-radius:6px;font-size:13px;cursor:pointer}
.dsh-mc-dropdown-item:hover{background:var(--dsw-alias-fill-hover)}
.dsh-mc-mode{font-size:13px;line-height:20px;margin:0}
.dsh-mc-mode-native{color:var(--dsw-alias-success-default)}
.dsh-mc-mode-legacy{color:var(--dsw-alias-warning-default)}
.dsh-mc-split{display:flex;gap:12px;align-items:flex-start}
.dsh-mc-model-list{flex:0 0 220px;flex-direction:column;gap:4px;display:flex}
.dsh-mc-model-item{border:1px solid transparent;background:none;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:8px 10px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:2px}
.dsh-mc-model-item-active{border-color:var(--dsw-alias-primary-default);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-hover)}
.dsh-mc-model-item-name{font-size:13px;font-weight:500}
.dsh-mc-model-item-desc{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-mc-model-detail{flex:1;min-width:0}
.dsh-mc-disclosure{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}
.dsh-mc-disclosure-summary{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;cursor:pointer}
.dsh-mc-disclosure-body{margin-top:10px;flex-direction:column;gap:10px;display:flex}
.dsh-mc-disclosure-fields{flex-direction:column;gap:10px;display:flex}
.dsh-mc-subagent-status{font-size:12px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px}
.dsh-mc-subagent-body{flex-direction:column;gap:10px;display:flex}
.dsh-mc-tag{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-mc-subagent-selected{flex-wrap:wrap;gap:6px;display:flex;align-items:center}
.dsh-mc-subagent-pool{flex-direction:column;gap:8px;display:flex}
.dsh-mc-pool-list{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;max-height:260px;overflow:auto;padding:8px}
.dsh-mc-pool-provider{flex-direction:column;gap:4px;display:flex;padding:4px 0}
.dsh-mc-pool-provider-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsh-mc-pool-row{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}
`
  const tag = document.createElement('style')
  tag.dataset.plugin = '@deepseek-ai/dsh-llm-pi-ai-capabilities'
  tag.dataset.pluginCss = id
  tag.textContent = css
  document.head.appendChild(tag)
}

function ModeStatus(props: any): any {
  const { mode, t } = props
  const h = createElement
  switch (mode) {
    case 'rc8':
      return h('p', { className: 'dsh-mc-mode dsh-mc-mode-native' }, t('modeNative'))
    case 'rc6':
      return h('p', { className: 'dsh-mc-mode dsh-mc-mode-legacy' },
        t('modeLegacyRc6Title'), h('br'), t('modeLegacyRc6Detail'))
    case 'rc7':
      return h('p', { className: 'dsh-mc-mode dsh-mc-mode-legacy' },
        t('modeLegacyRc7Title'), h('br'), t('modeLegacyRc7Detail'))
    case 'legacy':
      return h('p', { className: 'dsh-mc-mode dsh-mc-mode-legacy' },
        t('modeLegacyTitle'), h('br'), t('modeLegacyDetail'))
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
  const [search, setSearch] = useState('')
  const stateRef = useRef(state)
  stateRef.current = state
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const activeModelRef = useRef('')

  const load = async (): Promise<void> => {
    setState(prev => ({ ...prev, status: 'loading', error: undefined, saved: undefined }))
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
        const ids = modelListOf(provider, providerConfig, groups)
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
        runtime: {
          effectiveVersion: typeof subagentValue['effectiveVersion'] === 'string' ? subagentValue['effectiveVersion'] as string : undefined,
          toolSubagentSchemaFields: Array.isArray(subagentValue['toolSubagentSchemaFields'])
            ? (subagentValue['toolSubagentSchemaFields'] as string[])
            : undefined,
          agentOptionsSchemaFields: Array.isArray(subagentValue['agentOptionsSchemaFields'])
            ? (subagentValue['agentOptionsSchemaFields'] as string[])
            : undefined,
          modelSelectionSettings: typeof subagentValue['modelSelectionSettings'] === 'boolean'
            ? subagentValue['modelSelectionSettings'] as boolean
            : undefined,
        },
        modelSelectionNamespacePresent: nativeRecord !== undefined,
        modelSelectionNamespaceFields: nativeRecord ? schemaObjectKeys(nativeRecord['schema'], []) : undefined,
      })

      setState({
        status: 'ready',
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
        enumOptions: {
          maxTokensField: schemaEnumValues(schema, ['providers', 'inner', 'compat', 'maxTokensField']),
          thinkingFormat: schemaEnumValues(schema, ['providers', 'inner', 'compat', 'thinkingFormat']),
        },
      })
      setSelectedModel(nextModel)
    } catch (error: any) {
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

  const changeProvider = (provider: string): void => {
    const firstModel = Object.keys(state.modelDrafts[provider] ?? {})[0] ?? ''
    setState(prev => ({ ...prev, selectedProvider: provider, saved: undefined }))
    setSelectedModel(firstModel)
    setSearch('')
  }

  const updateProviderDraft = (patch: Partial<ProviderDraft>): void => {
    const provider = state.selectedProvider
    if (!provider) return
    setState(prev => ({
      ...prev,
      providerDrafts: { ...prev.providerDrafts, [provider]: { ...prev.providerDrafts[provider], ...patch } },
    }))
  }

  const updateModelDraft = (patch: Partial<ModelDraft>): void => {
    const provider = state.selectedProvider
    const model = activeModelRef.current
    if (!provider || !model) return
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
    updateModelDraft({ input: [], reasoningMode: 'inherit', efforts: [], wire: {}, contextWindow: '', maxTokens: '', compat: {} })
  }

  const resetProvider = (): void => {
    const provider = state.selectedProvider
    if (!provider) return
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
          compat: {},
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
    if (next.length === 0) return
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
        : defaultReasoningWire(piLevel, isAnthropicProvider(provider, state.providers[provider], state.catalogGroups))
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
    updateProviderDraft({ compat: { ...draft.compat, [key]: value } })
  }

  const updateModelCompat = (key: string, value: any): void => {
    const provider = state.selectedProvider
    const model = activeModelRef.current
    const draft = provider ? state.modelDrafts[provider]?.[model] : undefined
    if (!provider || !model || !draft) return
    updateModelDraft({ compat: { ...draft.compat, [key]: value } })
  }

  const save = (): void => {
    if (state.status !== 'ready' || state.selectedProvider === '') return
    const provider = state.selectedProvider
    const anthropic = isAnthropicProvider(provider, state.providers[provider], state.catalogGroups)
    const ops = [
      ...collectOpsForProvider(provider, state.providers[provider], state.providerDrafts[provider]),
      ...collectOpsForModels(provider, state.providers[provider], state.modelDrafts[provider] ?? {}, anthropic),
    ]
    setState(prev => ({ ...prev, saved: undefined, error: undefined }))
    void api.settings.mutate({ ns: PI_AI_NS, ops, expectedRevision: state.revision }).then((response: any) => {
      if (response?.result?.ok !== true) {
        throw new Error(response?.result?.error?.message ?? 'settings.mutate failed')
      }
      return load().then(() => {
        setState(prev => ({ ...prev, saved: t('saved') }))
      })
    }).catch((error: any) => {
      setState(prev => ({ ...prev, error: String(error?.message ?? error) }))
    })
  }

  const h = createElement
  if (state.status === 'loading') {
    return h('div', { className: 'dsh-mc-root' }, t('loading'))
  }
  if (state.status === 'error') {
    return h('div', { className: 'dsh-mc-root' },
      h('p', { className: 'dsh-mc-error' }, `${t('loadFailed')}: ${state.error ?? ''}`),
      h('button', { type: 'button', className: 'dsh-mc-button', onClick: () => void load() }, t('retry')),
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
  const filteredModelIds = search.trim() === ''
    ? modelIds
    : modelIds.filter(id => id.toLowerCase().includes(search.trim().toLowerCase()))
  const activeModel = selectedModel && filteredModelIds.includes(selectedModel) ? selectedModel : (filteredModelIds[0] ?? '')
  activeModelRef.current = activeModel
  const activeDraft = activeModel ? modelDrafts[activeModel] : undefined
  const activeCompatDrafts = activeDraft?.compat ?? {}

  const providerCompat = providerDraft?.compat ?? {}
  const providerCommon = compatFieldsOf('common', false)
  const providerAdvanced = compatFieldsOf('advanced', true)
  const providerAnthropic = compatFieldsOf('anthropic', false)
  const providerCommonMap = compatApplicableMap(providerCommon, protocols, providerCompat)
  const providerAdvancedMap = compatApplicableMap(providerAdvanced, protocols, providerCompat)
  const providerAnthropicMap = compatApplicableMap(providerAnthropic, protocols, providerCompat)
  const modelCompatFields = COMPAT_FIELDS
  const modelCompatMap = compatApplicableMap(modelCompatFields, protocols, activeCompatDrafts)

  const resolvedInput = (() => {
    if (activeDraft && activeDraft.input.length > 0) return activeDraft.input
    if (providerDraft && providerDraft.defaultInput.length > 0) return providerDraft.defaultInput
    return ['text']
  })()

  const resolvedReasoning = reasoningEffortsOf(activeDraft, providerDraft)

  const resolvedSource = (() => {
    if (!activeDraft) return ''
    if (activeDraft.input.length > 0 || activeDraft.reasoningMode !== 'inherit') return t('sourceOverride')
    if (providerDraft && (providerDraft.defaultInput.length > 0 || providerDraft.defaultReasoning !== '')) return t('sourceProvider')
    return t('sourceUnknown')
  })()

  const modelsByProvider: Record<string, string[]> = {}
  const reasoningEffortsByModel: Record<string, string[]> = {}
  for (const name of providerNames) {
    const ids = modelListOf(name, state.providers[name], state.catalogGroups)
    modelsByProvider[name] = ids
    for (const model of ids) {
      const draft = state.modelDrafts[name]?.[model]
      reasoningEffortsByModel[`${name}\u0000${model}`] = draft?.efforts ?? []
    }
  }
  const providerSupportsAgentOptions: Record<string, boolean> = {}
  for (const providerSnapshot of state.runtimeCaps.subagent.providers ?? []) {
    providerSupportsAgentOptions[providerSnapshot.name] = providerSnapshot.supportsAgentOptions
  }

  return h('div', { className: 'dsh-mc-root' },
    h('h2', { className: 'dsh-mc-title' }, t('nav')),
    h('p', { className: 'dsh-mc-intro' }, t('pageDescription')),
    state.error ? h('p', { className: 'dsh-mc-error' }, state.error) : null,
    state.saved ? h('p', { className: 'dsh-mc-saved' }, state.saved) : null,

    h('div', { className: 'dsh-mc-field' },
      h('span', { className: 'dsh-mc-field-label' }, t('provider')),
      h(Dropdown, {
        value: provider,
        options: providerNames.map(name => ({ value: name, label: name })),
        onChange: changeProvider,
        ariaLabel: t('provider'),
      }),
    ),

    // Provider default capabilities.
    providerDraft ? h('div', { className: 'dsh-mc-card' },
      h('div', { className: 'dsh-mc-card-header' },
        h('h3', { className: 'dsh-mc-section-title' }, t('providerDefaults')),
        h(ModeStatus, { mode: state.dshMode, t }),
      ),
      h('div', { className: 'dsh-mc-field' },
        h('span', { className: 'dsh-mc-field-label' }, t('inputCapability')),
        h('div', { className: 'dsh-mc-chips' },
          MODALITIES.map(modality => h(Chip, {
            key: modality,
            label: modalityLabel(modality),
            active: providerDraft.defaultInput.includes(modality),
            onClick: () => updateProviderDraft({ defaultInput: toggleValue(providerDraft.defaultInput, modality) }),
          })),
        ),
      ),
      state.runtimeCaps.providerFields.has('defaultContextWindow') ? h('div', { className: 'dsh-mc-field' },
        h('span', { className: 'dsh-mc-field-label' }, t('defaultContextWindow')),
        h(NumberInput, {
          value: providerDraft.defaultContextWindow ?? '',
          onChange: (value: string) => updateProviderDraft({ defaultContextWindow: value }),
          placeholder: t('inherit'),
          ariaLabel: t('defaultContextWindow'),
        }),
      ) : null,
      state.runtimeCaps.providerFields.has('defaultMaxTokens') ? h('div', { className: 'dsh-mc-field' },
        h('span', { className: 'dsh-mc-field-label' }, t('defaultMaxTokens')),
        h(NumberInput, {
          value: providerDraft.defaultMaxTokens ?? '',
          onChange: (value: string) => updateProviderDraft({ defaultMaxTokens: value }),
          placeholder: t('inherit'),
          ariaLabel: t('defaultMaxTokens'),
        }),
      ) : null,
    ) : null,

    // Provider reasoning.
    providerDraft ? h('div', { className: 'dsh-mc-card' },
      h('h3', { className: 'dsh-mc-section-title' }, t('reasoningCapabilities')),
      h('div', { className: 'dsh-mc-field' },
        h('span', { className: 'dsh-mc-field-label' }, t('defaultReasoning')),
        h(Dropdown, {
          value: providerDraft.defaultReasoning,
          options: [
            { value: '', label: t('inherit') },
            ...LEVELS.map(level => ({ value: level, label: levelLabel(level) })),
          ],
          onChange: (value: string) => updateProviderDraft({ defaultReasoning: value }),
          placeholder: t('inherit'),
          ariaLabel: t('defaultReasoning'),
        }),
      ),
      anthropic ? h('div', { className: 'dsh-mc-field' },
        h('span', { className: 'dsh-mc-field-label' }, t('anthropicReasoningEffort')),
        h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('anthropicReasoningEffortDescription')),
        h(Dropdown, {
          value: providerDraft.adaptiveThinking,
          options: [
            { value: 'inherit', label: t('inherit') },
            { value: 'enabled', label: t('adaptiveEnabled') },
            { value: 'disabled', label: t('adaptiveDisabled') },
          ],
          onChange: (value: AdaptiveThinkingMode) => updateProviderDraft({ adaptiveThinking: value }),
          placeholder: t('inherit'),
          ariaLabel: t('anthropicReasoningEffort'),
        }),
      ) : null,
      h(Disclosure, { summary: t('thinkingBudgets') },
        ['minimal', 'low', 'medium', 'high'].map(level => h('div', { key: level, className: 'dsh-mc-field' },
          h('span', { className: 'dsh-mc-field-label' }, levelLabel(level)),
          h(NumberInput, {
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
        )),
      ),
    ) : null,

    // Interface compatibility (provider level).
    providerDraft ? h('div', { className: 'dsh-mc-card' },
      h('h3', { className: 'dsh-mc-section-title' }, t('interfaceCompatibility')),
      h(CompatGroupSection, {
        fields: providerCommon,
        drafts: providerCompat,
        applicable: providerCommonMap.applicable,
        existing: providerCommonMap.existing,
        enumOptions: state.enumOptions,
        level: 'provider',
        t,
        onChange: updateProviderCompat,
      }),
      h(CompatDisclosure, {
        summary: t('advancedCompatibility'),
        fields: providerAdvanced,
        drafts: providerCompat,
        applicable: providerAdvancedMap.applicable,
        existing: providerAdvancedMap.existing,
        enumOptions: state.enumOptions,
        level: 'provider',
        t,
        onChange: updateProviderCompat,
      }),
      h(CompatDisclosure, {
        summary: t('anthropicCompatibility'),
        fields: providerAnthropic,
        drafts: providerCompat,
        applicable: providerAnthropicMap.applicable,
        existing: providerAnthropicMap.existing,
        enumOptions: state.enumOptions,
        level: 'provider',
        t,
        onChange: updateProviderCompat,
      }),
    ) : null,

    h(SubagentSettingsCard, {
      t,
      api,
      capabilities: state.runtimeCaps.subagent,
      controlValue: state.subagentControl.value,
      controlRevision: state.subagentControl.revision,
      controlWritable: state.subagentControl.writable,
      nativeNamespace: state.nativeSubagent,
      providerNames,
      modelsByProvider,
      reasoningEffortsByModel,
      providerSupportsAgentOptions,
      onApplied: () => void load(),
    }),

    h('div', { className: 'dsh-mc-field' },
      h('span', { className: 'dsh-mc-field-label' }, t('models')),
      createElement('input', {
        className: 'dsh-mc-input',
        value: search,
        placeholder: t('searchModels'),
        onChange: (event: any) => setSearch(event.target.value),
      }),
    ),

    filteredModelIds.length === 0
      ? h('p', { className: 'dsh-mc-empty' }, t('noModels'))
      : h('div', { className: 'dsh-mc-split' },
          h('div', { className: 'dsh-mc-model-list' },
            filteredModelIds.map(model => {
              const draft = modelDrafts[model]
              const summary = draft.reasoningMode === 'custom' || draft.input.length > 0
                ? t('summaryCustom')
                : draft.reasoningMode === 'unsupported'
                  ? t('summaryUnsupported')
                  : t('summaryInherit')
              return h('button', {
                key: model,
                type: 'button',
                className: `dsh-mc-model-item${model === activeModel ? ' dsh-mc-model-item-active' : ''}`,
                onClick: () => setSelectedModel(model),
              },
                h('span', { className: 'dsh-mc-model-item-name' }, model),
                h('span', { className: 'dsh-mc-model-item-desc' }, summary),
              )
            }),
          ),
          activeDraft ? h('div', { className: 'dsh-mc-model-detail' },
            h('div', { className: 'dsh-mc-card' },
              h('div', { className: 'dsh-mc-card-header' },
                h('h3', { className: 'dsh-mc-section-title' }, activeModel),
                h('button', { type: 'button', className: 'dsh-mc-link-button', onClick: resetModel }, t('resetModel')),
              ),
              h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('inputCapability')),
                h('div', { className: 'dsh-mc-chips' },
                  MODALITIES.map(modality => h(Chip, {
                    key: modality,
                    label: modalityLabel(modality),
                    active: activeDraft.input.includes(modality),
                    onClick: () => updateModelDraft({ input: toggleValue(activeDraft.input, modality) }),
                  })),
                ),
              ),
              h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('reasoningCapability')),
                h('div', { className: 'dsh-mc-chips' },
                  h(Chip, {
                    label: t('inherit'),
                    active: activeDraft.reasoningMode === 'inherit',
                    onClick: () => updateModelDraft({ reasoningMode: 'inherit', efforts: [], wire: {} }),
                  }),
                  h(Chip, {
                    label: t('unsupported'),
                    active: activeDraft.reasoningMode === 'unsupported',
                    onClick: () => updateModelDraft({ reasoningMode: 'unsupported', efforts: [], wire: {} }),
                  }),
                  h(Chip, {
                    label: t('custom'),
                    active: activeDraft.reasoningMode === 'custom',
                    onClick: () => updateModelDraft({ reasoningMode: 'custom', efforts: activeDraft.efforts.length > 0 ? activeDraft.efforts : ['medium'], wire: activeDraft.wire }),
                  }),
                ),
              ),
              activeDraft.reasoningMode === 'custom' ? h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('reasoningLevels')),
                h('div', { className: 'dsh-mc-chips' },
                  LEVELS.map(level => h(Chip, {
                    key: level,
                    label: levelLabel(level),
                    active: activeDraft.efforts.includes(level),
                    onClick: () => toggleReasoningLevel(level),
                  })),
                ),
              ) : null,
              activeDraft.reasoningMode === 'custom' ? h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('reasoningWire')),
                activeDraft.efforts.map(level => h('div', { key: level, className: 'dsh-mc-field' },
                  h('span', { className: 'dsh-mc-field-label' }, levelLabel(level)),
                  h(TextInput, {
                    value: reasoningWireFor(activeDraft, level as PiAiReasoningLevel, anthropic) ?? '',
                    onChange: (value: string) => updateReasoningWire(level, value),
                    placeholder: t('inherit'),
                    ariaLabel: level,
                  }),
                )),
              ) : null,
              state.runtimeCaps.modelFields.has('contextWindow') ? h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('modelContextWindow')),
                h(NumberInput, {
                  value: activeDraft.contextWindow ?? '',
                  onChange: (value: string) => updateModelDraft({ contextWindow: value }),
                  placeholder: t('inherit'),
                  ariaLabel: t('modelContextWindow'),
                }),
              ) : null,
              state.runtimeCaps.modelFields.has('maxTokens') ? h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('modelMaxTokens')),
                h(NumberInput, {
                  value: activeDraft.maxTokens ?? '',
                  onChange: (value: string) => updateModelDraft({ maxTokens: value }),
                  placeholder: t('inherit'),
                  ariaLabel: t('modelMaxTokens'),
                }),
              ) : null,
              h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('resolvedCapability')),
                h('p', { className: 'dsh-mc-muted', style: { margin: 0 } },
                  `${t('input')}: ${resolvedInput.join(', ')} · ${t('reasoning')}: ${resolvedReasoning.join(', ') || t('inherit')} · ${t('source')}: ${resolvedSource}`),
              ),
              h(Disclosure, { summary: t('modelCompatDisclosure') },
                h('div', { className: 'dsh-mc-disclosure-fields' },
                  h(CompatGroupSection, {
                    fields: modelCompatFields.filter(field => field.group === 'common'),
                    drafts: activeCompatDrafts,
                    applicable: modelCompatMap.applicable,
                    existing: modelCompatMap.existing,
                    enumOptions: state.enumOptions,
                    level: 'model',
                    t,
                    onChange: updateModelCompat,
                  }),
                  h(CompatDisclosure, {
                    summary: t('advancedCompatibility'),
                    fields: modelCompatFields.filter(field => field.group === 'advanced'),
                    drafts: activeCompatDrafts,
                    applicable: modelCompatMap.applicable,
                    existing: modelCompatMap.existing,
                    enumOptions: state.enumOptions,
                    level: 'model',
                    t,
                    onChange: updateModelCompat,
                  }),
                  h(CompatDisclosure, {
                    summary: t('anthropicCompatibility'),
                    fields: modelCompatFields.filter(field => field.group === 'anthropic'),
                    drafts: activeCompatDrafts,
                    applicable: modelCompatMap.applicable,
                    existing: modelCompatMap.existing,
                    enumOptions: state.enumOptions,
                    level: 'model',
                    t,
                    onChange: updateModelCompat,
                  }),
                ),
              ),
            ),
          ) : null,
        ),

    h('div', { className: 'dsh-mc-field', style: { flexDirection: 'row', gap: 8 } },
      h('button', { type: 'button', className: 'dsh-mc-button', onClick: resetProvider }, t('resetProvider')),
      h('button', { type: 'button', className: 'dsh-mc-button', onClick: save }, t('save')),
    ),
  )
}

export const inject = ['slots', 'locale', 'connection', 'remote']

const zh: Record<string, string> = {
  nav: '模型能力',
  pageDescription: '管理 DSH 模型能力、推理能力与接口兼容性。所有修改仅写入原生配置，不修改适配器源码。',
  loading: '加载中…',
  loadFailed: '加载失败',
  retry: '重试',
  readOnly: '当前部署为只读模式。',
  namespaceMissing: 'llm-pi-ai 设置命名空间未注册。',
  provider: '提供方',
  providerDefaults: '提供方默认能力',
  reasoningCapabilities: '推理能力',
  interfaceCompatibility: '接口兼容性',
  advancedCompatibility: '高级兼容性',
  anthropicCompatibility: 'Anthropic 兼容性',
  modelCompatDisclosure: '兼容性覆盖',
  inputCapability: '输入能力',
  defaultReasoning: '默认推理等级',
  inherit: '继承',
  saved: '已保存',
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
  modeNative: '原生模式 (rc.8) — 无需适配器补丁。',
  modeLegacyRc6Title: '旧版兼容模式 (rc.6)',
  modeLegacyRc6Detail: '需配套适配器补丁：不支持原生 settings 语义，能力配置只起提示作用。',
  modeLegacyRc7Title: '旧版兼容模式 (rc.7)',
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
  modelContextWindow: '上下文窗口覆盖',
  modelMaxTokens: '最大输出覆盖',
  reasoningLevels: '推理等级',
  reasoningWire: '推理等级线值',
  resolvedCapability: '解析后能力',
  'subagent.title': '子代理模型',
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
  'compat.eagerToolInput.label': '预填充工具输入',
  'compat.eagerToolInput.description': '工具输入在请求中预填充。',
  'compat.cacheControlOnTools.label': '工具使用缓存控制',
  'compat.cacheControlOnTools.description': '工具定义支持缓存控制。',
  'compat.temperature.label': 'temperature 参数',
  'compat.temperature.description': 'Anthropic 兼容接口的温度参数。',
  'compat.forceAdaptiveThinking.label': '强制自适应思考',
  'compat.forceAdaptiveThinking.description': '强制启用 adaptive thinking。',
  'compat.allowEmptySignature.label': '允许空签名',
  'compat.allowEmptySignature.description': '允许空工具签名。',
  'compat.supportsStrictTools.label': '支持严格工具模式',
  'compat.supportsStrictTools.description': '兼容严格工具模式。',
  'compat.requiresExactFormatting.label': '要求精确格式化',
  'compat.requiresExactFormatting.description': '要求消息精确格式化。',
  'compat.supportsStreaming.label': '支持流式',
  'compat.supportsStreaming.description': '兼容流式响应。',
}

const en: Record<string, string> = {
  nav: 'Model Capabilities',
  pageDescription: 'Manage DSH model capabilities, reasoning and wire compatibility. Writes native settings only — never patches adapter sources.',
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  retry: 'Retry',
  readOnly: 'Settings are read-only in this deployment.',
  namespaceMissing: 'The llm-pi-ai settings namespace is not registered.',
  provider: 'Provider',
  providerDefaults: 'Provider Defaults',
  reasoningCapabilities: 'Reasoning',
  interfaceCompatibility: 'Interface Compatibility',
  advancedCompatibility: 'Advanced Compatibility',
  anthropicCompatibility: 'Anthropic Compatibility',
  modelCompatDisclosure: 'Compatibility Overrides',
  inputCapability: 'Input capability',
  defaultReasoning: 'Default reasoning',
  inherit: 'Inherit',
  saved: 'Saved',
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
  modeNative: 'Native mode (rc.8) — no adapter patch required.',
  modeLegacyRc6Title: 'Legacy compatibility (rc.6)',
  modeLegacyRc6Detail: 'Requires the matching adapter patch; native settings semantics are unavailable.',
  modeLegacyRc7Title: 'Legacy compatibility (rc.7)',
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
  modelContextWindow: 'Context window override',
  modelMaxTokens: 'Max output tokens override',
  reasoningLevels: 'Reasoning levels',
  reasoningWire: 'Reasoning wire values',
  resolvedCapability: 'Resolved capability',
  'subagent.title': 'Subagent Models',
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
  'compat.eagerToolInput.label': 'Eager tool input',
  'compat.eagerToolInput.description': 'Tool inputs are pre-filled in the request.',
  'compat.cacheControlOnTools.label': 'Cache control on tools',
  'compat.cacheControlOnTools.description': 'Tool definitions support cache control.',
  'compat.temperature.label': 'temperature parameter',
  'compat.temperature.description': 'Temperature for Anthropic-compatible APIs.',
  'compat.forceAdaptiveThinking.label': 'Force adaptive thinking',
  'compat.forceAdaptiveThinking.description': 'Force adaptive thinking on.',
  'compat.allowEmptySignature.label': 'Allow empty signature',
  'compat.allowEmptySignature.description': 'Allow empty tool signatures.',
  'compat.supportsStrictTools.label': 'Supports strict tools',
  'compat.supportsStrictTools.description': 'Accepts strict tool mode.',
  'compat.requiresExactFormatting.label': 'Requires exact formatting',
  'compat.requiresExactFormatting.description': 'Requires exact message formatting.',
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
