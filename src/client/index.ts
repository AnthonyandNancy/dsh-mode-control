/**
 * @deepseek-ai/dsh-llm-pi-ai-capabilities — client settings section.
 *
 * This page reads/writes the standard `llm-pi-ai` settings namespace. It does
 * not keep a second runtime config source: every save is a path op against the
 * native namespace, so llm-pi-ai's own resolveModel/stream behavior is what
 * applies the capability.
 *
 * Scope decision: only llm-pi-ai's currently supported vocabulary is used.
 * No custom input modalities, no custom reasoning efforts, no provider-level
 * reasoning set, and no per-model default effort are written.
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

const NS = 'settings.llm-pi-ai-capabilities'
const PI_AI_NS = 'llm-pi-ai'

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
  error?: string
  saved?: string
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

  // Catalog fallback: only the group whose id matches the selected provider.
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

function injectStyles(): void {
  const id = '@deepseek-ai/dsh-llm-pi-ai-capabilities/styles'
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${id}"]`)) return
  const css = `
.dsh-mc-root{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.dsh-mc-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.dsh-mc-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.dsh-mc-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:12px;padding:12px 14px;display:flex}
.dsh-mc-section-title{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.dsh-mc-field{flex-direction:column;gap:6px;display:flex}
.dsh-mc-field-label{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-mc-chips{flex-wrap:wrap;align-items:center;gap:6px;display:flex}
.dsh-mc-chip{box-sizing:border-box;height:28px;cursor:pointer;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:14px;align-items:center;gap:4px;padding:0 12px;font-size:13px;line-height:20px;display:inline-flex}
.dsh-mc-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-chip-active{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-dimmed);color:var(--dsw-alias-label-primary)}
.dsh-mc-input{box-sizing:border-box;height:36px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:0 12px;font-size:14px;line-height:22px}
.dsh-mc-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-mc-dropdown{position:relative;display:inline-block}
.dsh-mc-dropdown-button{box-sizing:border-box;height:36px;min-width:180px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);align-items:center;gap:8px;padding:0 12px;font-size:14px;line-height:22px;display:inline-flex}
.dsh-mc-dropdown-list{position:absolute;z-index:20;top:calc(100% + 4px);left:0;min-width:180px;max-height:280px;overflow:auto;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-shadow-lv3);padding:4px;display:flex;flex-direction:column}
.dsh-mc-dropdown-item{box-sizing:border-box;width:100%;cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;border-radius:8px;padding:6px 10px;font-size:14px;line-height:22px}
.dsh-mc-dropdown-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-button{box-sizing:border-box;height:36px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}
.dsh-mc-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-button-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:none}
.dsh-mc-button-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-mc-button:disabled{opacity:.5;cursor:default}
.dsh-mc-split{flex-direction:row;gap:16px;display:flex}
.dsh-mc-model-list{flex:none;width:220px;flex-direction:column;gap:6px;display:flex}
.dsh-mc-model-item{box-sizing:border-box;width:100%;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;border-radius:10px;padding:8px 10px;font-size:14px;line-height:22px;display:flex;flex-direction:column;gap:2px}
.dsh-mc-model-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-model-item-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-active)}
.dsh-mc-model-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mc-model-item-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mc-model-detail{flex:1;min-width:0;flex-direction:column;gap:12px;display:flex}
.dsh-mc-muted{color:var(--dsw-alias-label-tertiary)}
.dsh-mc-wire-list{flex-direction:column;gap:6px;display:flex}
.dsh-mc-wire-row{box-sizing:border-box;min-height:36px;flex-direction:row;align-items:center;gap:8px;display:flex}
.dsh-mc-wire-label{flex:none;min-width:116px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:nowrap}
.dsh-mc-wire-input{box-sizing:border-box;height:36px;flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:0 12px;font-size:14px;line-height:22px}
.dsh-mc-wire-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-mc-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.dsh-mc-saved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:13px;line-height:20px}
.dsh-mc-empty{color:var(--dsw-alias-label-tertiary);padding:8px 0}
.dsh-mc-mode{margin:0;font-size:13px;line-height:20px}
.dsh-mc-mode-native{color:var(--dsw-alias-label-tertiary)}
.dsh-mc-mode-legacy{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-tertiary))}
.dsh-mc-actions{flex-direction:row;align-items:center;gap:8px;display:flex}
@media (max-width:720px){
.dsh-mc-split{flex-direction:column}
.dsh-mc-model-list{width:100%}
}
`
  const tag = document.createElement('style')
  tag.dataset.plugin = '@deepseek-ai/dsh-llm-pi-ai-capabilities'
  tag.dataset.pluginCss = id
  tag.textContent = css
  document.head.appendChild(tag)
}

function Chip(props: any): any {
  const { label, active, onClick } = props
  return createElement('button', {
    type: 'button',
    className: `dsh-mc-chip${active ? ' dsh-mc-chip-active' : ''}`,
    onClick,
  }, label)
}

function Dropdown(props: any): any {
  const { value, options, onChange, placeholder, ariaLabel } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const selected = options.find((option: any) => option.value === value)
  return createElement('div', { ref, className: 'dsh-mc-dropdown' },
    createElement('button', {
      type: 'button',
      className: 'dsh-mc-dropdown-button',
      'aria-label': ariaLabel,
      'aria-expanded': open,
      onClick: () => setOpen(!open),
    },
      createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected?.label ?? placeholder ?? ''),
      createElement('span', { style: { flex: 'none', opacity: 0.7 } }, '▾'),
    ),
    open ? createElement('div', { className: 'dsh-mc-dropdown-list' },
      options.map((option: any) => createElement('button', {
        key: option.value,
        type: 'button',
        className: 'dsh-mc-dropdown-item',
        style: option.value === value ? { fontWeight: 600 } : undefined,
        onClick: () => {
          onChange(option.value)
          setOpen(false)
        },
      }, option.label)),
    ) : null,
  )
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
    updateModelDraft({ input: [], reasoningMode: 'inherit', efforts: [], wire: {} })
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
  const modelDrafts = state.modelDrafts[provider] ?? {}
  const modelIds = Object.keys(modelDrafts)
  const filteredModelIds = search.trim() === ''
    ? modelIds
    : modelIds.filter(id => id.toLowerCase().includes(search.trim().toLowerCase()))
  const activeModel = selectedModel && filteredModelIds.includes(selectedModel) ? selectedModel : (filteredModelIds[0] ?? '')
  activeModelRef.current = activeModel
  const activeDraft = activeModel ? modelDrafts[activeModel] : undefined

  const resolvedInput = (() => {
    if (activeDraft && activeDraft.input.length > 0) return activeDraft.input
    if (providerDraft && providerDraft.defaultInput.length > 0) return providerDraft.defaultInput
    return ['text']
  })()

  const resolvedReasoning = (() => {
    if (!activeDraft) return []
    if (activeDraft.reasoningMode === 'unsupported') return []
    if (activeDraft.reasoningMode === 'custom') return activeDraft.efforts
    if (providerDraft && providerDraft.defaultReasoning !== '') return [providerDraft.defaultReasoning]
    return []
  })()

  const resolvedSource = (() => {
    if (!activeDraft) return ''
    if (activeDraft.input.length > 0 || activeDraft.reasoningMode !== 'inherit') return t('sourceOverride')
    if (providerDraft && (providerDraft.defaultInput.length > 0 || providerDraft.defaultReasoning !== '')) return t('sourceProvider')
    return t('sourceUnknown')
  })()

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

    providerDraft ? h('div', { className: 'dsh-mc-card' },
      h('h3', { className: 'dsh-mc-section-title' }, t('providerDefaults')),
      h(ModeStatus, { mode: state.dshMode, t }),
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
    ) : null,

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
              h('h3', { className: 'dsh-mc-section-title' }, activeModel),
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
                    onClick: () => updateModelDraft({ reasoningMode: 'custom', efforts: activeDraft.efforts.length > 0 ? activeDraft.efforts : ['low'] }),
                  }),
                ),
              ),
              activeDraft.reasoningMode === 'custom'
                ? h('div', { className: 'dsh-mc-field' },
                    h('span', { className: 'dsh-mc-field-label' }, t('reasoningLevels')),
                    h('div', { className: 'dsh-mc-chips' },
                      LEVELS.map(level => h(Chip, {
                        key: level,
                        label: levelLabel(level),
                        active: activeDraft.efforts.includes(level),
                        onClick: () => toggleReasoningLevel(level),
                      })),
                    ),
                  )
                : null,
              activeDraft.reasoningMode === 'inherit'
                ? h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('inheritCatalogWire'))
                : null,
              activeDraft.reasoningMode === 'custom'
                ? h('div', { className: 'dsh-mc-field' },
                    h('span', { className: 'dsh-mc-field-label' }, t('reasoningWireValues')),
                    h('div', { className: 'dsh-mc-wire-list' },
                      LEVELS.filter(level => activeDraft.efforts.includes(level)).map(level => h('div', {
                        key: level,
                        className: 'dsh-mc-wire-row',
                      },
                        h('span', { className: 'dsh-mc-wire-label' }, `${levelLabel(level)} →`),
                        h('input', {
                          className: 'dsh-mc-wire-input',
                          value: reasoningWireFor(activeDraft, level as PiAiReasoningLevel, anthropic) ?? '',
                          placeholder: level === 'off' ? 'null' : '',
                          'aria-label': `${levelLabel(level)} wire value`,
                          onChange: (event: any) => updateReasoningWire(level, event.target.value),
                        }),
                      )),
                    ),
                  )
                : null,
              h('div', { className: 'dsh-mc-field' },
                h('span', { className: 'dsh-mc-field-label' }, t('resolvedCapability')),
                h('div', { className: 'dsh-mc-muted' },
                  `${t('inputCapability')}: ${resolvedInput.map(modalityLabel).join(' · ')}`,
                ),
                h('div', { className: 'dsh-mc-muted' },
                  `${t('reasoningCapability')}: ${resolvedReasoning.length > 0 ? resolvedReasoning.map(levelLabel).join(' · ') : (activeDraft.reasoningMode === 'unsupported' ? t('unsupported') : t('unknown'))}`,
                ),
                h('div', { className: 'dsh-mc-muted' }, `${t('source')}: ${resolvedSource}`),
              ),
            ),
            h('div', { className: 'dsh-mc-actions' },
              h('button', { type: 'button', className: 'dsh-mc-button', onClick: resetModel }, t('reset')),
              h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-primary', onClick: save }, t('save')),
            ),
          ) : null,
        ),
  )
}

export const inject = ['slots', 'locale', 'connection', 'remote']

const zh = {
  loading: '加载中…',
  nav: '模型能力增强',
  pageDescription: '配置第三方模型的输入与思考能力。',
  provider: '提供商',
  providerDefaults: '提供商默认能力',
  modeNative: '✓ DSH rc.8 原生支持，无需 Adapter 补丁',
  modeLegacyRc6Title: 'DSH rc.6 兼容模式',
  modeLegacyRc6Detail: '需应用 rc.6 Adapter 补丁后生效',
  modeLegacyRc7Title: 'DSH rc.7 兼容模式',
  modeLegacyRc7Detail: '需应用 rc.7 Adapter 补丁后生效',
  modeLegacyTitle: 'DSH 旧版兼容模式',
  modeLegacyDetail: '需应用对应版本的 Adapter 补丁后生效',
  models: '模型',
  searchModels: '搜索模型',
  inputCapability: '输入能力',
  reasoningCapability: '思考能力',
  reasoningLevels: '思考档位',
  reasoningWireValues: '思考档位 → 上游 wire value',
  inheritCatalogWire: '继承 pi-ai Catalog（wire mapping 由运行时决定）',
  defaultReasoning: '默认思考程度',
  anthropicReasoningEffort: 'Anthropic 思考等级透传',
  anthropicReasoningEffortDescription: '启用后使用 Adaptive Thinking，将当前思考档位通过 output_config.effort 发送到 Anthropic Messages 上游。',
  adaptiveEnabled: '启用',
  adaptiveDisabled: '禁用',
  inherit: '继承',
  custom: '自定义',
  unsupported: '不支持',
  unknown: '未声明',
  reset: '恢复默认设置',
  save: '保存能力配置',
  saved: '已保存，llm-pi-ai 将在下一次请求生效。',
  noProviders: '当前没有已配置的 llm-pi-ai Provider。请先前往“模型”设置添加 Provider。',
  noModels: '当前 Provider 尚未配置模型。请先前往“模型”设置添加模型。',
  loadFailed: '加载失败',
  retry: '重试',
  readOnly: '当前 Settings 为只读。',
  namespaceMissing: 'llm-pi-ai 命名空间未注册。',
  summaryInherit: '继承 Provider 默认能力',
  summaryCustom: '自定义',
  summaryUnsupported: '不支持',
  resolvedCapability: '最终生效能力',
  source: '来源',
  sourceOverride: 'Model Override',
  sourceProvider: 'Provider Default',
  sourceUnknown: '未声明',
}

const en = {
  loading: 'Loading…',
  nav: 'Model Capabilities',
  pageDescription: 'Configure input and reasoning capabilities for third-party models.',
  provider: 'Provider',
  providerDefaults: 'Provider Defaults',
  modeNative: '✓ Native support · DSH rc.8',
  modeLegacyRc6Title: 'Legacy compatibility · DSH rc.6',
  modeLegacyRc6Detail: 'Requires rc.6 adapter patch',
  modeLegacyRc7Title: 'Legacy compatibility · DSH rc.7',
  modeLegacyRc7Detail: 'Requires rc.7 adapter patch',
  modeLegacyTitle: 'Legacy compatibility',
  modeLegacyDetail: 'Requires the matching adapter patch',
  models: 'Models',
  searchModels: 'Search models',
  inputCapability: 'Input',
  reasoningCapability: 'Reasoning',
  reasoningLevels: 'Reasoning Levels',
  reasoningWireValues: 'Reasoning Level → Upstream Wire Value',
  inheritCatalogWire: 'Inherit pi-ai Catalog (wire mapping resolved at runtime)',
  defaultReasoning: 'Default Reasoning',
  anthropicReasoningEffort: 'Anthropic Reasoning Effort',
  anthropicReasoningEffortDescription: 'Use adaptive thinking and send the selected reasoning level through output_config.effort to Anthropic Messages providers.',
  adaptiveEnabled: 'Enabled',
  adaptiveDisabled: 'Disabled',
  inherit: 'Inherit',
  custom: 'Custom',
  unsupported: 'Unsupported',
  unknown: 'Unknown',
  reset: 'Restore defaults',
  save: 'Save capabilities',
  saved: 'Saved; changes apply to the next llm-pi-ai request.',
  noProviders: 'No llm-pi-ai providers are configured. Add one in the Models settings first.',
  noModels: 'This provider has no configured models yet. Add models in the Models settings first.',
  loadFailed: 'Failed to load',
  retry: 'Retry',
  readOnly: 'Settings are read-only in this deployment.',
  namespaceMissing: 'The llm-pi-ai settings namespace is not registered.',
  summaryInherit: 'Inherits provider defaults',
  summaryCustom: 'Custom',
  summaryUnsupported: 'Unsupported',
  resolvedCapability: 'Resolved Capability',
  source: 'Source',
  sourceOverride: 'Model Override',
  sourceProvider: 'Provider Default',
  sourceUnknown: 'Unknown',
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
