/**
 * Subagent model settings card.
 *
 * Version-gated at the page level: this component returns `null` when
 * `capabilities.visible` is false, so low DSH versions see no placeholder at
 * all. Legacy fixed mode and native selection mode are rendered from the
 * detected capabilities, never mixed.
 */

import { createElement, useEffect, useState } from 'react'
import type { SubagentRuntimeCapabilities } from '../subagent/capabilities.ts'
import { SUBAGENT_MODEL_SELECTION_NAMESPACE, SUBAGENT_NAMESPACE } from '../subagent/constants.ts'
import {
  agentOptionsFromLegacyDraft,
  legacyDraftFromAgentOptions,
  nativeSelectionOps,
  validateAllowedModels,
  type AllowedModelRoute,
  type LegacySubagentDraft,
  type NativeSubagentDraft,
} from './subagent-state.ts'
import { Disclosure, Dropdown, Field, NumberInput, TextInput, Chip } from './ui.ts'

export interface SubagentSettingsCardProps {
  t: (key: string) => string
  api: any
  capabilities: SubagentRuntimeCapabilities
  /** Resolved value of `dsh-mode-control.subagent`. */
  controlValue: { agentOptions?: unknown; modelSelectionSettings?: boolean }
  controlRevision?: number
  controlWritable: boolean
  /** Official `subagent-model-selection` namespace view, when present. */
  nativeNamespace?: { value?: unknown; revision?: number; writable?: boolean }
  providerNames: string[]
  modelsByProvider: Record<string, string[]>
  reasoningEffortsByModel: Record<string, string[]>
  providerSupportsAgentOptions: Record<string, boolean>
  onApplied?: () => void
}

function modelKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

export function SubagentSettingsCard(props: SubagentSettingsCardProps): any {
  const { t, api, capabilities, controlValue, controlRevision, controlWritable, nativeNamespace, providerNames, modelsByProvider, reasoningEffortsByModel, providerSupportsAgentOptions, onApplied } = props
  const h = createElement
  const [legacyDraft, setLegacyDraft] = useState<LegacySubagentDraft>(() =>
    legacyDraftFromAgentOptions(controlValue?.agentOptions))
  const [nativeDraft, setNativeDraft] = useState<NativeSubagentDraft>(() => {
    const raw = (nativeNamespace?.value ?? {}) as Record<string, unknown>
    return {
      enabled: raw['enabled'] === true,
      allowedModels: Array.isArray(raw['allowedModels'])
        ? (raw['allowedModels'] as AllowedModelRoute[]).map(route => ({
            provider: typeof route?.provider === 'string' ? route.provider : '',
            model: typeof route?.model === 'string' ? route.model : '',
          }))
        : [],
    }
  })
  const [editPool, setEditPool] = useState(false)
  const [poolSearch, setPoolSearch] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setLegacyDraft(legacyDraftFromAgentOptions(controlValue?.agentOptions))
  }, [controlValue?.agentOptions])

  useEffect(() => {
    const raw = (nativeNamespace?.value ?? {}) as Record<string, unknown>
    setNativeDraft({
      enabled: raw['enabled'] === true,
      allowedModels: Array.isArray(raw['allowedModels'])
        ? (raw['allowedModels'] as AllowedModelRoute[]).map(route => ({
            provider: typeof route?.provider === 'string' ? route.provider : '',
            model: typeof route?.model === 'string' ? route.model : '',
          }))
        : [],
    })
  }, [nativeNamespace?.value])

  if (!capabilities.visible) return null

  const isNative = capabilities.mode === 'native-selection'
  const selectedProvider = legacyDraft.provider
  const selectedProviderUnsupported = selectedProvider !== '' && providerSupportsAgentOptions[selectedProvider] === false

  const legacyReasoningOptions = (): Array<{ value: string; label: string }> => {
    const efforts = reasoningEffortsByModel[modelKey(selectedProvider, legacyDraft.model)] ?? []
    return [
      { value: '', label: t('subagent.reasoning.auto') },
      ...efforts.map(effort => ({ value: effort, label: effort })),
    ]
  }

  const applyLegacy = async (): Promise<void> => {
    setError('')
    setStatus('')
    if (!controlWritable) {
      setError(t('subagent.readonly'))
      return
    }
    try {
      const result = agentOptionsFromLegacyDraft(legacyDraft)
      const ops = result.unset
        ? [{ op: 'unset' as const, path: ['agentOptions'] }]
        : [{ op: 'set' as const, path: ['agentOptions'], value: result.value }]
      const response = await api.settings.mutate({
        ns: SUBAGENT_NAMESPACE,
        ops,
        ...controlRevision === undefined ? {} : { expectedRevision: controlRevision },
      })
      if (response?.result?.ok !== true) {
        setError(response?.result?.error?.message ?? t('subagent.applyFailed'))
        return
      }
      setStatus(t('subagent.savedNewSessions'))
      onApplied?.()
    } catch (cause: any) {
      setError(String(cause?.message ?? cause))
    }
  }

  const applyNative = async (): Promise<void> => {
    setError('')
    setStatus('')
    const validation = validateAllowedModels(nativeDraft)
    if (!validation.ok) {
      setError(t(validation.errorKey))
      return
    }
    const response = await api.settings.mutate({
      ns: SUBAGENT_MODEL_SELECTION_NAMESPACE,
      ops: nativeSelectionOps(nativeDraft),
      ...nativeNamespace?.revision === undefined ? {} : { expectedRevision: nativeNamespace.revision },
    })
    if (response?.result?.ok !== true) {
      setError(response?.result?.error?.message ?? t('subagent.applyFailed'))
      return
    }
    setStatus(t('subagent.savedNewSessions'))
    onApplied?.()
  }

  const enableModelSelection = async (): Promise<void> => {
    setError('')
    setStatus('')
    const response = await api.settings.mutate({
      ns: SUBAGENT_NAMESPACE,
      ops: [{ op: 'set', path: ['modelSelectionSettings'], value: true }],
      ...controlRevision === undefined ? {} : { expectedRevision: controlRevision },
    })
    if (response?.result?.ok !== true) {
      setError(response?.result?.error?.message ?? t('subagent.applyFailed'))
      return
    }
    setStatus(t('subagent.savedNewSessions'))
    onApplied?.()
  }

  const toggleRoute = (provider: string, model: string): void => {
    const key = modelKey(provider, model)
    const exists = nativeDraft.allowedModels.some(route => modelKey(route.provider, route.model) === key)
    setNativeDraft(prev => ({
      ...prev,
      allowedModels: exists
        ? prev.allowedModels.filter(route => modelKey(route.provider, route.model) !== key)
        : [...prev.allowedModels, { provider, model }],
    }))
  }

  const selectedRouteKeys = new Set(nativeDraft.allowedModels.map(route => modelKey(route.provider, route.model)))
  const filteredProviders = providerNames.filter(provider => {
    if (poolSearch === '') return true
    const haystack = `${provider} ${(modelsByProvider[provider] ?? []).join(' ')}`.toLowerCase()
    return haystack.includes(poolSearch.toLowerCase())
  })

  const statusText = isNative ? t('subagent.status.native') : t('subagent.status.legacy')
  const modeTitle = h('div', { className: 'dsh-mc-card-header' },
    h('h3', { className: 'dsh-mc-section-title' }, t('subagent.title')),
    h('span', { className: 'dsh-mc-subagent-status' }, statusText),
  )

  return h('div', { className: 'dsh-mc-card' },
    modeTitle,
    h('p', { className: 'dsh-mc-muted', style: { margin: 0 } },
      isNative ? t('subagent.native.description') : t('subagent.legacy.description')),
    isNative ? h(NativeSection, {
      t,
      draft: nativeDraft,
      setNativeDraft,
      editPool,
      setEditPool,
      poolSearch,
      setPoolSearch,
      filteredProviders,
      modelsByProvider,
      selectedRouteKeys,
      toggleRoute,
      applyNative,
      controlValue,
      controlWritable,
      enableModelSelection,
      error,
      status,
      h,
      legacyDraft,
      setLegacyDraft,
      providerNames,
      selectedProviderUnsupported,
      legacyReasoningOptions: legacyReasoningOptions(),
      supportsReasoningEffort: capabilities.supportsReasoningEffort,
      supportsAgentOptions: capabilities.supportsAgentOptions,
      applyLegacy,
    }) : h(LegacySection, {
      t,
      draft: legacyDraft,
      setDraft: setLegacyDraft,
      providerNames,
      modelsByProvider,
      selectedProviderUnsupported,
      reasoningOptions: legacyReasoningOptions(),
      supportsReasoningEffort: capabilities.supportsReasoningEffort,
      supportsAgentOptions: capabilities.supportsAgentOptions,
      applyLegacy,
      error,
      status,
      h,
    }),
  )
}

function LegacySection(props: any): any {
  const { t, draft, setDraft, providerNames, modelsByProvider, selectedProviderUnsupported, reasoningOptions, supportsReasoningEffort, supportsAgentOptions, applyLegacy, error, status, h } = props
  const modelOptions = (modelsByProvider[draft.provider] ?? []).map((model: string) => ({ value: model, label: model }))
  return h('div', { className: 'dsh-mc-subagent-body' },
    h(Field, { label: t('subagent.defaultBehavior') },
      h(Dropdown, {
        value: draft.mode,
        options: [
          { value: 'inherit', label: t('subagent.inheritMain') },
          { value: 'fixed', label: t('subagent.fixedModel') },
        ],
        onChange: (mode: string) => setDraft({ ...draft, mode }),
        placeholder: t('subagent.inheritMain'),
      }),
    ),
    !supportsAgentOptions || selectedProviderUnsupported
      ? h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('subagent.backendManagesModel'))
      : draft.mode === 'fixed' ? h('div', { className: 'dsh-mc-subagent-body' },
          h(Field, { label: t('subagent.provider') },
            h(Dropdown, {
              value: draft.provider,
              options: providerNames.map((name: string) => ({ value: name, label: name })),
              onChange: (provider: string) => setDraft({ ...draft, provider, model: (modelsByProvider[provider]?.[0] ?? '') }),
              placeholder: t('subagent.selectProvider'),
            }),
          ),
          h(Field, { label: t('subagent.model') },
            h(Dropdown, {
              value: draft.model,
              options: modelOptions,
              onChange: (model: string) => setDraft({ ...draft, model }),
              placeholder: t('subagent.selectModel'),
            }),
          ),
          h(Field, { label: t('subagent.maxTokens') },
            h(NumberInput, {
              value: draft.maxTokens,
              onChange: (maxTokens: string) => setDraft({ ...draft, maxTokens }),
              placeholder: t('subagent.maxTokensPlaceholder'),
            }),
          ),
          supportsReasoningEffort ? h(Field, { label: t('subagent.reasoningEffort') },
            h(Dropdown, {
              value: draft.reasoningEffort,
              options: reasoningOptions,
              onChange: (reasoningEffort: string) => setDraft({ ...draft, reasoningEffort }),
              placeholder: t('subagent.reasoning.auto'),
            }),
          ) : null,
        )
      : null,
    h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('subagent.effectiveNote')),
    error ? h('p', { className: 'dsh-mc-error' }, error) : null,
    status ? h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, status) : null,
    h('button', { type: 'button', className: 'dsh-mc-button', onClick: () => void applyLegacy() }, t('subagent.apply')),
  )
}

function NativeSection(props: any): any {
  const { t, draft, setNativeDraft, editPool, setEditPool, poolSearch, setPoolSearch, filteredProviders, modelsByProvider, selectedRouteKeys, toggleRoute, applyNative, controlValue, controlWritable, enableModelSelection, error, status, h, legacyDraft, setLegacyDraft, providerNames, selectedProviderUnsupported, legacyReasoningOptions, supportsReasoningEffort, supportsAgentOptions, applyLegacy } = props
  const modelSelectionEnabled = controlValue?.modelSelectionSettings === true
  return h('div', { className: 'dsh-mc-subagent-body' },
    !modelSelectionEnabled
      ? h('div', { className: 'dsh-mc-subagent-body' },
          h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('subagent.modelSelectionNotEnabled')),
          controlWritable
            ? h('button', { type: 'button', className: 'dsh-mc-button', onClick: () => void enableModelSelection() }, t('subagent.enableModelSelection'))
            : h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('subagent.modelSelectionConfigRequired')),
        )
      : h('div', { className: 'dsh-mc-subagent-body' },
          h('div', { className: 'dsh-mc-field' },
            h('span', { className: 'dsh-mc-field-label' }, t('subagent.enableDynamicSelection')),
            h(Chip, {
              label: draft.enabled ? t('compat.enabled') : t('compat.disabled'),
              active: draft.enabled,
              onClick: () => {
                setNativeDraft({ ...draft, enabled: !draft.enabled })
              },
            }),
          ),
          h('div', { className: 'dsh-mc-field' },
            h('span', { className: 'dsh-mc-field-label' }, t('subagent.allowedModels')),
            h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('subagent.allowedModels.description')),
            !editPool
              ? h('div', { className: 'dsh-mc-subagent-selected' },
                  draft.allowedModels.length === 0
                    ? h('span', { className: 'dsh-mc-muted' }, t('subagent.allowedModels.emptySummary'))
                    : draft.allowedModels.map((route: AllowedModelRoute) => h('span', { key: modelKey(route.provider, route.model), className: 'dsh-mc-tag' }, `${route.provider} / ${route.model}`)),
                  h('button', { type: 'button', className: 'dsh-mc-link-button', onClick: () => setEditPool(true) }, t('subagent.editPool')),
                )
              : h('div', { className: 'dsh-mc-subagent-pool' },
                  h(TextInput, {
                    value: poolSearch,
                    onChange: setPoolSearch,
                    placeholder: t('subagent.searchPool'),
                  }),
                  h('div', { className: 'dsh-mc-pool-list' },
                    filteredProviders.map((provider: string) => h('div', { key: provider, className: 'dsh-mc-pool-provider' },
                      h('span', { className: 'dsh-mc-pool-provider-name' }, provider),
                      (modelsByProvider[provider] ?? []).map((model: string) => {
                        const key = modelKey(provider, model)
                        return h('label', { key, className: 'dsh-mc-pool-row' },
                          h('input', {
                            type: 'checkbox',
                            checked: selectedRouteKeys.has(key),
                            onChange: () => toggleRoute(provider, model),
                          }),
                          h('span', null, model),
                        )
                      }),
                    )),
                  ),
                  h('button', { type: 'button', className: 'dsh-mc-link-button', onClick: () => setEditPool(false) }, t('subagent.doneEditingPool')),
                ),
          ),
          h(Disclosure, { summary: t('subagent.defaultModelDisclosure') },
            h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('subagent.defaultModelNote')),
            h(LegacySection, {
              t,
              draft: legacyDraft,
              setDraft: setLegacyDraft,
              providerNames,
              modelsByProvider,
              selectedProviderUnsupported,
              reasoningOptions: legacyReasoningOptions,
              supportsReasoningEffort,
              supportsAgentOptions,
              applyLegacy,
              error,
              status,
              h,
            }),
          ),
          error ? h('p', { className: 'dsh-mc-error' }, error) : null,
          status ? h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, status) : null,
          h('button', { type: 'button', className: 'dsh-mc-button', onClick: () => void applyNative() }, t('subagent.apply')),
        ),
  )
}
