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
  catalogModelIds,
  defaultReasoningWire,
  declaredModelIds,
  detectDshMode,
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
import { COMPAT_FIELDS, isCompatFieldApplicable, type CompatFieldDefinition } from './compat-fields.ts'
import { emptyCompatDrafts, type CompatDrafts } from './compat-state.ts'
import { CompatDisclosure, CompatGroupSection } from './compat-ui.ts'
import { collectEnumOptions, collectRuntimeCapabilities, protocolsForModel, protocolsForProvider, schemaObjectKeys, subagentRuntimeFactsFromValue, type RuntimeCapabilities } from './runtime-capabilities.ts'
import { SubagentSettingsCard } from './subagent-ui.ts'
import { SUBAGENT_MODEL_SELECTION_NAMESPACE, SUBAGENT_NAMESPACE } from '../subagent/constants.ts'
import { Chip, CompactSelect, DisclosureRow, InlineNumberEditor, SettingRow } from './ui.ts'
import { buildModelRouteOptions, ModelRoutePicker } from './model-picker.ts'
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
  saved?: string
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

function modelListOf(
  _provider: string,
  providerConfig: unknown,
  _catalogGroups: unknown[],
): string[] {
  return declaredModelIds(providerConfig)
}

function catalogModelListOf(provider: string, providerConfig: unknown, catalogGroups: unknown[]): string[] {
  return catalogModelIds(provider, providerConfig, catalogGroups)
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
.dsh-mc-root{width:100%;min-width:0;color:var(--dsw-alias-label-primary);flex-direction:column;gap:18px;display:flex;box-sizing:border-box}
.dsh-mc-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.dsh-mc-intro{color:var(--dsw-alias-label-tertiary);margin:-10px 0 0;font-size:13px;line-height:20px}
.dsh-mc-section{min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-mc-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 0 5px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-mc-section-title{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.dsh-mc-section-caption{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-mc-setting-rows{display:flex;flex-direction:column;min-width:0}
.dsh-mc-setting-row{min-height:40px;padding:4px 0;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px}
.dsh-mc-setting-label-block{min-width:0;display:flex;flex:1;flex-direction:column;gap:1px}
.dsh-mc-setting-label{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dsh-mc-setting-description,.dsh-mc-setting-warning{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
.dsh-mc-setting-warning{color:var(--dsw-alias-state-warn-label)}
.dsh-mc-setting-control{flex:none;display:flex;align-items:center;justify-content:flex-end;min-width:0}
.dsh-mc-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:4px 0}
.dsh-mc-error{color:var(--dsw-alias-danger-default);font-size:13px;line-height:18px;margin:0}.dsh-mc-feedback{display:flex;align-items:center;gap:8px}
.dsh-mc-saved{color:var(--dsw-alias-success-default);font-size:13px;line-height:18px;margin:0}
.dsh-mc-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px}
.dsh-mc-chips{flex-wrap:wrap;gap:6px;display:flex;justify-content:flex-end}
.dsh-mc-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 10px;font-size:13px;cursor:pointer}
.dsh-mc-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-chip-active{border-color:var(--dsw-alias-primary-default);color:var(--dsw-alias-primary-default);font-weight:500}
.dsh-mc-input,.dsh-mc-textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:13px;line-height:18px;box-sizing:border-box}
.dsh-mc-textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;min-height:80px;max-height:160px;width:100%;overflow:auto}
.dsh-mc-input:focus,.dsh-mc-textarea:focus,.dsh-mc-inline-input:focus{outline:none;border-color:var(--dsw-alias-border-l3)}
.dsh-mc-button{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer}
.dsh-mc-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-button-secondary{align-self:flex-start;margin-top:6px}
.dsh-mc-link-button{background:none;border:none;color:var(--dsw-alias-primary-default);font-size:13px;cursor:pointer;padding:0}
.dsh-mc-icon{display:block;flex:none;color:currentColor}
.dsh-mc-icon-open{transform:rotate(180deg)}
.dsh-mc-compact-select{position:relative;min-width:0}
.dsh-mc-compact-trigger,.dsh-mc-picker-trigger{min-width:0;max-width:280px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}
.dsh-mc-compact-trigger:hover,.dsh-mc-picker-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-compact-trigger:focus-visible,.dsh-mc-picker-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mc-compact-trigger-label,.dsh-mc-picker-trigger-label{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;min-width:0}
.dsh-mc-compact-menu,.dsh-mc-picker-menu{z-index:20;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);min-width:min(240px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);border-radius:12px;padding:4px;display:flex;flex-direction:column;position:absolute;top:calc(100% + 8px);right:0;overflow:hidden;box-sizing:border-box}
.dsh-mc-compact-option{width:100%;min-height:38px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;text-align:left}
.dsh-mc-compact-option:hover,.dsh-mc-picker-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-compact-check,.dsh-mc-picker-check{flex:0 0 16px;width:16px;height:16px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center}
.dsh-mc-inline-value{max-width:220px;min-width:44px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:24px;padding:4px 8px;font-size:13px;line-height:20px;cursor:pointer;text-align:right}
.dsh-mc-inline-value:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-inline-input{width:120px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 8px;font-size:13px;line-height:20px;box-sizing:border-box}
.dsh-mc-disclosure-row{min-width:0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-mc-disclosure-trigger{width:100%;min-height:40px;padding:4px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:8px;text-align:left;font-size:13px}
.dsh-mc-disclosure-trigger:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-disclosure-label{min-width:0;flex:1}
.dsh-mc-disclosure-value{color:var(--dsw-alias-label-secondary);font-size:13px}
.dsh-mc-disclosure-chevron{color:var(--dsw-alias-label-caption);display:flex}
.dsh-mc-disclosure-content{padding:2px 0 8px;display:flex;flex-direction:column;gap:2px}
.dsh-mc-disclosure-fields,.dsh-mc-compat-group{display:flex;flex-direction:column;min-width:0}
.dsh-mc-json-editor{width:100%;display:flex;flex-direction:column;gap:4px}
.dsh-mc-compat-control{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-mc-picker-root{position:relative;min-width:0}
.dsh-mc-picker-menu{top:calc(100% + 8px)}
.dsh-mc-picker-menu-up{top:auto;bottom:calc(100% + 8px)}
.dsh-mc-picker-search{width:100%;height:30px;margin-bottom:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 8px;font-size:13px;line-height:20px}
.dsh-mc-picker-listbox{min-width:0;min-height:0;display:flex;flex:1;overflow:hidden}.dsh-mc-picker-groups{min-width:0;min-height:0;flex:1;overflow:auto}
.dsh-mc-picker-group{padding:0 0 4px}
.dsh-mc-picker-group-title{position:sticky;top:0;z-index:1;padding:6px 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;background:var(--dsw-specific-menu)}
.dsh-mc-picker-option{box-sizing:border-box;width:100%;min-height:38px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;text-align:left}
.dsh-mc-picker-option-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.dsh-mc-picker-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mc-picker-detail{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-mc-picker-empty{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:13px}
 .dsh-mc-mode{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:400}
 .dsh-mc-mode-native{color:var(--dsw-alias-success-default)}
 .dsh-mc-mode-legacy{color:var(--dsw-alias-state-warn-label)}
 .dsh-mc-action-row{display:flex;align-items:center;gap:8px;margin-top:6px}
@media (max-width:520px){.dsh-mc-setting-row{align-items:flex-start;gap:8px}.dsh-mc-setting-label-block{padding-top:4px}.dsh-mc-compact-trigger,.dsh-mc-picker-trigger{max-width:200px}.dsh-mc-chips{justify-content:flex-start}}
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
      setState(prev => ({ ...prev, status: 'loading', error: undefined, saved: undefined }))
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
        saved: undefined,
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

  const changeProvider = (provider: string): void => {
    const firstModel = Object.keys(state.modelDrafts[provider] ?? {})[0] ?? ''
    setState(prev => ({ ...prev, selectedProvider: provider, saved: undefined }))
    setSelectedModel(firstModel)
  }

  const changeModelRoute = (route: { provider: string; model: string } | null): void => {
    if (route === null) return
    setState(prev => ({ ...prev, selectedProvider: route.provider, saved: undefined }))
    setSelectedModel(route.model)
  }

  const markProviderDirty = (provider: string, fields: string[] = []): void => {
    if (!provider) return
    dirtyProvidersRef.current.add(provider)
    const dirty = dirtyProviderFieldsRef.current.get(provider) ?? new Set<string>()
    for (const field of fields) dirty.add(field)
    dirtyProviderFieldsRef.current.set(provider, dirty)
    dirtyVersionRef.current += 1
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
    if (state.status !== 'ready' || state.selectedProvider === '' || dirtyProvidersRef.current.size === 0 || saveInFlightRef.current) return
    saveInFlightRef.current = true
    let ops: ReturnType<typeof collectOpsForAllProviders>
    const dirtyProviders = new Set(dirtyProvidersRef.current)
    const saveVersion = dirtyVersionRef.current
    try {
      ops = collectOpsForAllProviders(
        Object.keys(state.providers), state.providers, state.providerDrafts, state.modelDrafts,
        dirtyProviders, state.catalogGroups, state.runtimeCaps.modelCompatFields,
        dirtyProviderFieldsRef.current, dirtyModelFieldsRef.current, state.runtimeCaps.compatFields,
      )
    } catch (error: any) {
      saveInFlightRef.current = false
      setState(prev => ({ ...prev, saved: undefined, error: String(error?.message ?? error) }))
      return
    }
    setState(prev => ({ ...prev, saved: undefined, error: undefined }))
    void Promise.resolve().then(() => api.settings.mutate({ ns: PI_AI_NS, ops, expectedRevision: state.revision })).then((response: any) => {
      if (response?.result?.ok !== true) {
        throw new Error(response?.result?.error?.message ?? 'settings.mutate failed')
      }
      const nextRevision = mutationRevision(response)
       if (dirtyVersionRef.current !== saveVersion) {
        setState(prev => ({ ...prev, revision: nextRevision ?? prev.revision, saved: t('savedWithPending') }))
        return
      }
      for (const provider of dirtyProviders) {
         dirtyProvidersRef.current.delete(provider)
         dirtyProviderFieldsRef.current.delete(provider)
         dirtyModelFieldsRef.current.delete(provider)
       }
      return load().then(() => {
        setState(prev => ({ ...prev, saved: t('saved') }))
      })
    }).catch((error: any) => {
      const message = String(error?.message ?? error)
      setState(prev => ({ ...prev, error: message }))
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

  const resolvedReasoning = reasoningEffortsOf(activeDraft, providerDraft)

  const resolvedSource = (() => {
    if (!activeDraft) return ''
    if (activeDraft.input.length > 0 || activeDraft.reasoningMode !== 'inherit') return t('sourceOverride')
    if (providerDraft && (providerDraft.defaultInput.length > 0 || providerDraft.defaultReasoning !== '')) return t('sourceProvider')
    return t('sourceUnknown')
  })()

  const modelsByProvider: Record<string, string[]> = {}
  const configuredModelsByProvider: Record<string, string[]> = {}
  const reasoningEffortsByModel: Record<string, string[]> = {}
  for (const name of providerNames) {
    const ids = catalogModelListOf(name, state.providers[name], state.catalogGroups)
    modelsByProvider[name] = ids
    configuredModelsByProvider[name] = modelListOf(name, state.providers[name], [])
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
    state.error ? h('div', { className: 'dsh-mc-feedback' }, h('p', { className: 'dsh-mc-error' }, state.error), h('button', { type: 'button', className: 'dsh-mc-link-button', onClick: () => void load(true) }, t('reload'))) : null,
    state.saved ? h('p', { className: 'dsh-mc-saved' }, state.saved) : null,

    h('section', { className: 'dsh-mc-section' },
      h('div', { className: 'dsh-mc-section-heading' }, h('h3', { className: 'dsh-mc-section-title' }, t('modelCapabilities'))),
      h(SettingRow, {
        label: t('provider'),
        control: h(CompactSelect, {
          value: provider,
          options: providerNames.map(name => ({ value: name, label: name })),
          onChange: changeProvider,
          ariaLabel: t('provider'),
        }),
      }),
    ),

    // Provider default capabilities.
    providerDraft ? h('section', { className: 'dsh-mc-section' },
      h('div', { className: 'dsh-mc-section-heading' },
        h('h3', { className: 'dsh-mc-section-title' }, t('providerDefaults')),
        h(ModeStatus, { mode: state.dshMode, t }),
      ),
      h(SettingRow, {
        label: t('inputCapability'),
        control: h('div', { className: 'dsh-mc-chips' }, MODALITIES.map(modality => h(Chip, {
          key: modality,
          label: modalityLabel(modality),
          active: providerDraft.defaultInput.includes(modality),
          onClick: () => updateProviderDraft({ defaultInput: toggleValue(providerDraft.defaultInput, modality) }),
        }))),
      }),
      state.runtimeCaps.providerFields.has('defaultContextWindow') ? h(SettingRow, {
        label: t('defaultContextWindow'),
        control: h(InlineNumberEditor, { value: providerDraft.defaultContextWindow ?? '', onChange: value => updateProviderDraft({ defaultContextWindow: value }), placeholder: t('inherit'), ariaLabel: t('defaultContextWindow') }),
      }) : null,
      state.runtimeCaps.providerFields.has('defaultMaxTokens') ? h(SettingRow, {
        label: t('defaultMaxTokens'),
        control: h(InlineNumberEditor, { value: providerDraft.defaultMaxTokens ?? '', onChange: value => updateProviderDraft({ defaultMaxTokens: value }), placeholder: t('inherit'), ariaLabel: t('defaultMaxTokens') }),
      }) : null,
    ) : null,

    // Provider reasoning.
    providerDraft ? h('section', { className: 'dsh-mc-section' },
      h('div', { className: 'dsh-mc-section-heading' }, h('h3', { className: 'dsh-mc-section-title' }, t('reasoningCapabilities'))),
      h(SettingRow, {
        label: t('defaultReasoning'),
        control: h(CompactSelect, {
          value: providerDraft.defaultReasoning,
          options: [{ value: '', label: t('inherit') }, ...LEVELS.map(level => ({ value: level, label: levelLabel(level) }))],
          onChange: (value: string) => updateProviderDraft({ defaultReasoning: value }),
          placeholder: t('inherit'),
          ariaLabel: t('defaultReasoning'),
        }),
      }),
      anthropic ? h(SettingRow, {
        label: t('anthropicReasoningEffort'),
        control: h(CompactSelect, {
          value: providerDraft.adaptiveThinking,
          options: [{ value: 'inherit', label: t('inherit') }, { value: 'enabled', label: t('adaptiveEnabled') }, { value: 'disabled', label: t('adaptiveDisabled') }],
          onChange: (value: string) => updateProviderDraft({ adaptiveThinking: value as AdaptiveThinkingMode }),
          ariaLabel: t('anthropicReasoningEffort'),
        }),
      }) : null,
      h(DisclosureRow, { summary: t('thinkingBudgets'), value: Object.keys(providerDraft.thinkingBudgets ?? {}).length === 0 ? t('inherit') : t('configured') },
        h('div', { className: 'dsh-mc-setting-rows' }, ['minimal', 'low', 'medium', 'high'].map(level => h(SettingRow, {
          key: level,
          label: levelLabel(level),
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
    ) : null,

    // Interface compatibility (provider level).
    providerDraft ? h('section', { className: 'dsh-mc-section' },
      h('div', { className: 'dsh-mc-section-heading' }, h('h3', { className: 'dsh-mc-section-title' }, t('interfaceCompatibility'))),
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
        summary: t('advancedCompatibility'), fields: providerAdvanced, drafts: providerCompat,
        applicable: providerAdvancedMap.applicable, existing: providerAdvancedMap.existing,
        enumOptions: state.enumOptions, level: 'provider', t, onChange: updateProviderCompat,
      }),
      h(CompatDisclosure, {
        summary: t('anthropicCompatibility'), fields: providerAnthropic, drafts: providerCompat,
        applicable: providerAnthropicMap.applicable, existing: providerAnthropicMap.existing,
        enumOptions: state.enumOptions, level: 'provider', t, onChange: updateProviderCompat,
      }),
    ) : null,

    h(SubagentSettingsCard, {
      t, api, capabilities: state.runtimeCaps.subagent,
      controlValue: state.subagentControl.value, controlRevision: state.subagentControl.revision,
      controlWritable: state.subagentControl.writable, nativeNamespace: state.nativeSubagent,
      providerNames, modelsByProvider, reasoningEffortsByModel, providerSupportsAgentOptions,
       onApplied: () => void load(true),
    }),

    modelIds.length === 0
      ? h('p', { className: 'dsh-mc-empty' }, t('noModels'))
      : activeDraft ? h('section', { className: 'dsh-mc-section' },
          h('div', { className: 'dsh-mc-section-heading' },
            h('h3', { className: 'dsh-mc-section-title' }, t('modelSettings')),
            h('button', { type: 'button', className: 'dsh-mc-link-button', onClick: resetModel }, t('resetModel')),
          ),
          h(SettingRow, {
            label: t('currentModel'),
             description: resolvedSource,
            control: h(ModelRoutePicker, {
              options: buildModelRouteOptions(providerNames, configuredModelsByProvider, { current: { provider, model: activeModel } }),
              value: { provider, model: activeModel },
              onChange: changeModelRoute,
              ariaLabel: t('currentModel'),
              searchPlaceholder: t('searchModels'),
              searchAriaLabel: t('searchModels'),
              emptyLabel: t('noModels'),
            }),
          }),
          h(SettingRow, {
            label: t('inputCapability'),
            control: h('div', { className: 'dsh-mc-chips' }, MODALITIES.map(modality => h(Chip, {
              key: modality,
              label: modalityLabel(modality),
              active: activeDraft.input.includes(modality),
              onClick: () => updateModelDraft({ input: toggleValue(activeDraft.input, modality) }),
            }))),
          }),
          h(SettingRow, {
             label: t('resolvedCapability'),
             description: resolvedSource,
             control: h('span', { className: 'dsh-mc-muted' }, `${resolvedInput.join(', ')}${resolvedReasoning.length > 0 ? ` · ${resolvedReasoning.join(', ')}` : ''}`),
           }),
           state.runtimeCaps.modelFields.has('contextWindow') ? h(SettingRow, {
            label: t('modelContextWindow'),
            control: h(InlineNumberEditor, { value: activeDraft.contextWindow ?? '', onChange: value => updateModelDraft({ contextWindow: value }), placeholder: t('inherit'), ariaLabel: t('modelContextWindow') }),
          }) : null,
          state.runtimeCaps.modelFields.has('maxTokens') ? h(SettingRow, {
            label: t('modelMaxTokens'),
            control: h(InlineNumberEditor, { value: activeDraft.maxTokens ?? '', onChange: value => updateModelDraft({ maxTokens: value }), placeholder: t('inherit'), ariaLabel: t('modelMaxTokens') }),
          }) : null,
          h(DisclosureRow, {
            summary: t('reasoningCapability'),
            value: activeDraft.reasoningMode === 'custom' ? `${activeDraft.efforts.length} ${t('reasoningLevels')}` : activeDraft.reasoningMode === 'unsupported' ? t('unsupported') : t('inherit'),
          },
          h('div', { className: 'dsh-mc-setting-rows' },
            h(SettingRow, {
              label: t('reasoningCapability'),
              control: h(CompactSelect, {
                value: activeDraft.reasoningMode,
                options: [{ value: 'inherit', label: t('inherit') }, { value: 'unsupported', label: t('unsupported') }, { value: 'custom', label: t('custom') }],
                onChange: (value: string) => updateModelDraft(value === 'custom'
                  ? { reasoningMode: 'custom', efforts: activeDraft.efforts.length > 0 ? activeDraft.efforts : ['medium'], wire: activeDraft.wire }
                  : { reasoningMode: value as 'inherit' | 'unsupported', efforts: [], wire: {} }),
                ariaLabel: t('reasoningCapability'),
              }),
            }),
            activeDraft.reasoningMode === 'custom' ? h(SettingRow, {
              label: t('reasoningLevels'),
              control: h('div', { className: 'dsh-mc-chips' }, LEVELS.map(level => h(Chip, {
                key: level, label: levelLabel(level), active: activeDraft.efforts.includes(level), onClick: () => toggleReasoningLevel(level),
              }))),
            }) : null,
            activeDraft.reasoningMode === 'custom' ? h(DisclosureRow, { summary: t('reasoningWire'), value: t('configured') },
              h('div', { className: 'dsh-mc-setting-rows' }, activeDraft.efforts.map(level => h(SettingRow, {
                key: level,
                label: levelLabel(level),
                control: h('input', {
                  className: 'dsh-mc-inline-input',
                  value: reasoningWireFor(activeDraft, level as PiAiReasoningLevel, modelAnthropic) ?? '',
                  onChange: (event: any) => updateReasoningWire(level, event.target.value),
                  'aria-label': level,
                }),
              }))),
            ) : null,
          )),
          h(DisclosureRow, { summary: t('modelCompatDisclosure') },
            h('div', { className: 'dsh-mc-disclosure-fields' },
              h(CompatGroupSection, {
                fields: modelCompatFields.filter(field => field.group === 'common'), drafts: activeCompatDrafts,
                applicable: modelCompatMap.applicable, existing: modelCompatMap.existing,
                enumOptions: state.enumOptions, level: 'model', t, onChange: updateModelCompat,
              }),
              h(CompatDisclosure, {
                summary: t('advancedCompatibility'), fields: modelCompatFields.filter(field => field.group === 'advanced'), drafts: activeCompatDrafts,
                applicable: modelCompatMap.applicable, existing: modelCompatMap.existing,
                enumOptions: state.enumOptions, level: 'model', t, onChange: updateModelCompat,
              }),
              h(CompatDisclosure, {
                summary: t('anthropicCompatibility'), fields: modelCompatFields.filter(field => field.group === 'anthropic'), drafts: activeCompatDrafts,
                applicable: modelCompatMap.applicable, existing: modelCompatMap.existing,
                enumOptions: state.enumOptions, level: 'model', t, onChange: updateModelCompat,
              }),
            ),
          ),
        ) : null,

    h('div', { className: 'dsh-mc-action-row' },
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
  defaultReasoning: '默认推理等级',
  inherit: '继承',
  saved: '已保存',
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
  defaultReasoning: 'Default reasoning',
  inherit: 'Inherit',
  saved: 'Saved',
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
