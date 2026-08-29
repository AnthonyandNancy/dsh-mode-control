import { createElement, useEffect, useRef, useState } from 'react'
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
import { buildModelRouteOptions, ModelRoutePicker, MultiModelPicker, type ModelRouteOption } from './model-picker.ts'
import { parseUnsupportedReasoningEffortError } from './reasoning-capabilities.ts'
import { CompactSelect, DisclosureRow, InlineNumberEditor, Panel, SettingRow } from './ui.ts'

export interface SubagentSettingsCardProps {
  t: (key: string) => string
  api: any
  capabilities: SubagentRuntimeCapabilities
  controlValue: { agentOptions?: unknown; modelSelectionSettings?: boolean }
  controlRevision?: number
  controlWritable: boolean
  nativeNamespace?: { value?: unknown; revision?: number; writable?: boolean }
  providerNames: string[]
  editableModelsByProvider: Record<string, string[]>
  reasoningEffortsByModel: Record<string, string[]>
  providerSupportsAgentOptions: Record<string, boolean>
  onApplied?: () => void
}

function modelKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

export interface SubagentReasoningOption {
  value: string
  label: string
  unsupported?: boolean
}

/**
 * Build the explicit reasoning options for one fixed subagent route.
 *
 * Only DSH runtime exact-model efforts are offered. A persisted effort that
 * the current runtime does not support is still shown (marked unsupported) so
 * users can see and clear it instead of silently losing it.
 */
export function buildSubagentReasoningOptions(
  runtimeEfforts: string[],
  currentEffort: string,
  unsupportedSuffix = '⚠',
): SubagentReasoningOption[] {
  const options: SubagentReasoningOption[] = []
  const seen = new Set<string>()
  for (const effort of runtimeEfforts) {
    if (seen.has(effort)) continue
    seen.add(effort)
    options.push({ value: effort, label: effort })
  }
  const current = currentEffort.trim()
  if (current !== '' && !seen.has(current)) {
    options.push({ value: current, label: `${current} ${unsupportedSuffix}`.trim(), unsupported: true })
  }
  return options
}

export function isInvalidExplicitReasoningEffort(
  currentEffort: string,
  runtimeEfforts: string[],
): boolean {
  const current = currentEffort.trim()
  return current !== '' && !runtimeEfforts.includes(current)
}

export function isNativeNamespaceWritable(nativeNamespace?: { writable?: boolean }): boolean {
  return nativeNamespace?.writable !== false
}

export function revisionFromMutationResponse(response: unknown): number | undefined {
  const result = response as { result?: { revision?: unknown; value?: { revision?: unknown } } } | null
  const candidates = [result?.result?.value?.revision, result?.result?.revision]
  return candidates.find(value => typeof value === 'number' && Number.isFinite(value)) as number | undefined
}

export function providerAgentOptionsSupported(
  providerSupportsAgentOptions: Record<string, boolean>,
  provider: string,
): boolean | undefined {
  if (!provider) return undefined
  return providerSupportsAgentOptions[provider]
}

/** A fixed route is blocked when its provider is missing from the runtime snapshot. */
export function isLegacyProviderBlocked(
  provider: string,
  providerSupportsAgentOptions: Record<string, boolean>,
): boolean {
  return provider !== '' && providerAgentOptionsSupported(providerSupportsAgentOptions, provider) !== true
}

/**
 * Legacy Apply is allowed only when the control is writable, the runtime
 * globally accepts agentOptions, and the selected provider does not opt out.
 * A missing provider snapshot fails closed for fixed routes; inherit/unset
 * (no current provider) remains allowed so users can always clear an override.
 */
export function shouldPreserveDraftOnParentUpdate(dirty: boolean): boolean {
  return dirty
}

export function revisionForNextApply(knownRevision: number | undefined, responseRevision: number | undefined): number | undefined {
  return responseRevision ?? knownRevision
}

export interface ApplySuccessOutcome {
  clearDirty: boolean
  revision: number | undefined
}

/**
 * Decide what to do after a successful mutation.
 *
 * `clearDirty` is only true when no local edit happened while the mutation was
 * pending (the captured apply edit version still equals the current one). A
 * missing response revision keeps the previously known revision so sequential
 * applies never regress to an older gate.
 */
export function applySuccessOutcome(
  applyEditVersion: number,
  currentEditVersion: number,
  responseRevision: number | undefined,
  previousRevision: number | undefined,
): ApplySuccessOutcome {
  return {
    clearDirty: applyEditVersion === currentEditVersion,
    revision: revisionForNextApply(previousRevision, responseRevision),
  }
}

export function canApplyLegacyRoute(
  controlWritable: boolean,
  supportsAgentOptions: boolean,
  providerSupportsAgentOptions: boolean | undefined,
  fixedMode = true,
  invalidExplicitReasoning = false,
): boolean {
  if (!controlWritable || !supportsAgentOptions) return false
  if (invalidExplicitReasoning) return false
  if (providerSupportsAgentOptions === false) return false
  if (fixedMode && providerSupportsAgentOptions === undefined) return false
  return true
}

export function updateLegacyRouteDraft(
  previous: LegacySubagentDraft,
  route: { provider: string; model: string } | null,
): LegacySubagentDraft {
  return route === null
    ? { ...previous, mode: 'inherit', provider: '', model: '' }
    : {
        ...previous,
        mode: 'fixed',
        provider: route.provider,
        model: route.model,
      }
}

export function buildSubagentRouteOptions(
  providerNames: string[],
  modelsByProvider: Record<string, string[]>,
  additionalRoutes: Array<{ provider: string; model: string }> = [],
): ModelRouteOption[] {
  return buildModelRouteOptions(providerNames, modelsByProvider, { additionalRoutes })
}

function routeOptions(providerNames: string[], modelsByProvider: Record<string, string[]>, current?: { provider: string; model: string }, additionalRoutes?: Array<{ provider: string; model: string }>): ModelRouteOption[] {
  return buildModelRouteOptions(providerNames, modelsByProvider, {
    ...(current?.provider && current.model ? { current } : {}),
    ...(additionalRoutes && additionalRoutes.length > 0 ? { additionalRoutes } : {}),
  })
}

function draftFromNative(value: unknown): NativeSubagentDraft {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    enabled: raw['enabled'] === true,
    allowedModels: Array.isArray(raw['allowedModels'])
      ? (raw['allowedModels'] as AllowedModelRoute[]).map(route => ({
          provider: typeof route?.provider === 'string' ? route.provider : '',
          model: typeof route?.model === 'string' ? route.model : '',
        }))
      : [],
  }
}

export function SubagentSettingsCard(props: SubagentSettingsCardProps): any {
  const { t, api, capabilities, controlValue, controlRevision, controlWritable, nativeNamespace, providerNames, editableModelsByProvider, reasoningEffortsByModel, providerSupportsAgentOptions } = props
  const h = createElement
  const [legacyDraft, setLegacyDraftState] = useState<LegacySubagentDraft>(() => legacyDraftFromAgentOptions(controlValue?.agentOptions))
  const [nativeDraft, setNativeDraftState] = useState<NativeSubagentDraft>(() => draftFromNative(nativeNamespace?.value))
  const legacyDirtyRef = useRef(false)
  const nativeDirtyRef = useRef(false)
  const legacyEditVersionRef = useRef(0)
  const nativeEditVersionRef = useRef(0)
  const setLegacyDraft = (value: LegacySubagentDraft | ((previous: LegacySubagentDraft) => LegacySubagentDraft)): void => { legacyDirtyRef.current = true; legacyEditVersionRef.current += 1; setLegacyDraftState(value) }
  const setNativeDraft = (value: NativeSubagentDraft | ((previous: NativeSubagentDraft) => NativeSubagentDraft)): void => { nativeDirtyRef.current = true; nativeEditVersionRef.current += 1; setNativeDraftState(value) }
  const [legacyRevision, setLegacyRevision] = useState(controlRevision)
  const [nativeRevision, setNativeRevision] = useState(nativeNamespace?.revision)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!shouldPreserveDraftOnParentUpdate(legacyDirtyRef.current)) {
      setLegacyDraftState(legacyDraftFromAgentOptions(controlValue?.agentOptions))
    }
  }, [controlValue?.agentOptions])
  useEffect(() => {
    if (!shouldPreserveDraftOnParentUpdate(nativeDirtyRef.current)) {
      setNativeDraftState(draftFromNative(nativeNamespace?.value))
    }
  }, [nativeNamespace?.value])
  useEffect(() => { setLegacyRevision(controlRevision) }, [controlRevision])
  useEffect(() => { setNativeRevision(nativeNamespace?.revision) }, [nativeNamespace?.revision])

  if (!capabilities.visible) return null

  const isNative = capabilities.mode === 'native-selection'
  const nativeWritable = isNativeNamespaceWritable(nativeNamespace)
  const options = routeOptions(providerNames, editableModelsByProvider, legacyDraft.mode === 'fixed' ? { provider: legacyDraft.provider, model: legacyDraft.model } : undefined, isNative ? nativeDraft.allowedModels : undefined)
  const selectedProviderUnsupported = isLegacyProviderBlocked(legacyDraft.provider, providerSupportsAgentOptions)
  const agentOptionsUnsupported = !capabilities.supportsAgentOptions
  const runtimeEfforts = reasoningEffortsByModel[modelKey(legacyDraft.provider, legacyDraft.model)] ?? []
  const invalidExplicitReasoning = capabilities.supportsReasoningEffort
    && legacyDraft.mode === 'fixed'
    && isInvalidExplicitReasoningEffort(legacyDraft.reasoningEffort, runtimeEfforts)
  const legacyApplyBlocked = !canApplyLegacyRoute(
    controlWritable,
    capabilities.supportsAgentOptions,
    providerAgentOptionsSupported(providerSupportsAgentOptions, legacyDraft.provider),
    legacyDraft.mode === 'fixed',
    invalidExplicitReasoning,
  )
  const reasoningOptions = [
    { value: '', label: t('subagent.reasoning.auto') },
    ...buildSubagentReasoningOptions(runtimeEfforts, legacyDraft.reasoningEffort, t('subagent.reasoning.unsupportedSuffix')),
  ]

  const applyLegacy = async (): Promise<void> => {
    setError('')
    setStatus('')
    if (legacyApplyBlocked) {
      setError(invalidExplicitReasoning
        ? t('subagent.reasoning.unsupportedBlocked')
        : agentOptionsUnsupported
          ? t('subagent.agentOptionsUnsupported')
          : selectedProviderUnsupported
            ? t('subagent.backendManagesModel')
            : t('subagent.readonly'))
      return
    }
    try {
      const result = agentOptionsFromLegacyDraft(legacyDraft)
       const applyVersion = legacyEditVersionRef.current
      const response = await api.settings.mutate({
        ns: SUBAGENT_NAMESPACE,
        ops: result.unset ? [{ op: 'unset' as const, path: ['agentOptions'] }] : [{ op: 'set' as const, path: ['agentOptions'], value: result.value }],
        ...legacyRevision === undefined ? {} : { expectedRevision: legacyRevision },
      })
      if (response?.result?.ok !== true) { setError(response?.result?.error?.message ?? t('subagent.applyFailed')); return }
      const outcome = applySuccessOutcome(
        applyVersion,
        legacyEditVersionRef.current,
        revisionFromMutationResponse(response),
        legacyRevision,
      )
      if (outcome.clearDirty) legacyDirtyRef.current = false
      setLegacyRevision(outcome.revision)
      setStatus(t('subagent.savedNewSessions'))
       props.onApplied?.()
    } catch (cause: any) {
      const message = String(cause?.message ?? cause)
      const parsed = parseUnsupportedReasoningEffortError(message)
      setError(parsed
        ? `${t('reasoningEffortUnsupportedTitle')}: ${parsed.effort ?? ''}`
        : message)
    }
  }

  const applyNative = async (): Promise<void> => {
    setError('')
    setStatus('')
    if (!nativeWritable) { setError(t('subagent.readonly')); return }
    try {
      const validation = validateAllowedModels(nativeDraft)
      if (!validation.ok) { setError(t(validation.errorKey)); return }
      const applyVersion = nativeEditVersionRef.current
      const response = await api.settings.mutate({
        ns: SUBAGENT_MODEL_SELECTION_NAMESPACE,
        ops: nativeSelectionOps(nativeDraft),
        ...nativeRevision === undefined ? {} : { expectedRevision: nativeRevision },
      })
      if (response?.result?.ok !== true) { setError(response?.result?.error?.message ?? t('subagent.applyFailed')); return }
      const outcome = applySuccessOutcome(
        applyVersion,
        nativeEditVersionRef.current,
        revisionFromMutationResponse(response),
        nativeRevision,
      )
      if (outcome.clearDirty) nativeDirtyRef.current = false
      setNativeRevision(outcome.revision)
      setStatus(t('subagent.savedNewSessions'))
       props.onApplied?.()
    } catch (cause: any) { setError(String(cause?.message ?? cause)) }
  }

  const enableModelSelection = async (): Promise<void> => {
    setError('')
    setStatus('')
    if (!controlWritable) { setError(t('subagent.readonly')); return }
    try {
      const applyVersion = legacyEditVersionRef.current
      const response = await api.settings.mutate({
        ns: SUBAGENT_NAMESPACE,
        ops: [{ op: 'set', path: ['modelSelectionSettings'], value: true }],
        ...legacyRevision === undefined ? {} : { expectedRevision: legacyRevision },
      })
      if (response?.result?.ok !== true) { setError(response?.result?.error?.message ?? t('subagent.applyFailed')); return }
      const outcome = applySuccessOutcome(
        applyVersion,
        legacyEditVersionRef.current,
        revisionFromMutationResponse(response),
        legacyRevision,
      )
      if (outcome.clearDirty) legacyDirtyRef.current = false
      setLegacyRevision(outcome.revision)
      setStatus(t('subagent.savedNewSessions'))
       props.onApplied?.()
    } catch (cause: any) { setError(String(cause?.message ?? cause)) }
  }

  const updateLegacyRoute = (route: { provider: string; model: string } | null): void => {
    setLegacyDraft(prev => updateLegacyRouteDraft(prev, route))
  }

  const modelSelectionEnabled = controlValue?.modelSelectionSettings === true
  const modeLabel = isNative ? t('subagent.status.native') : t('subagent.status.legacy')
  return h(Panel, {
    title: t('subagent.title'),
    className: 'dsh-mc-subagent-panel',
    caption: h('span', { className: 'dsh-mc-section-caption' }, modeLabel),
  },
    h('p', { className: 'dsh-mc-muted dsh-mc-subagent-description' }, isNative ? t('subagent.native.description') : t('subagent.legacy.description')),
    isNative
      ? h(NativeSection, {
          t, draft: nativeDraft, setDraft: setNativeDraft, setLegacyDraft, options, applyNative, modelSelectionEnabled,
          nativeWritable, controlWritable, enableModelSelection, error, status, legacyDraft, updateLegacyRoute,
          supportsReasoningEffort: capabilities.supportsReasoningEffort, supportsAgentOptions: capabilities.supportsAgentOptions,
          reasoningOptions, selectedProviderUnsupported, applyLegacy, applyDisabled: legacyApplyBlocked, agentOptionsUnsupported,
          invalidReasoning: invalidExplicitReasoning,
        })
      : h(LegacySection, {
          t, draft: legacyDraft, updateRoute: updateLegacyRoute, setDraft: setLegacyDraft, selectedProviderUnsupported,
          reasoningOptions, supportsReasoningEffort: capabilities.supportsReasoningEffort, supportsAgentOptions: capabilities.supportsAgentOptions,
          applyLegacy, applyDisabled: legacyApplyBlocked, agentOptionsUnsupported, error, status, options,
          invalidReasoning: invalidExplicitReasoning,
        }),
  )
}

function LegacySection(props: any): any {
  const { t, draft, updateRoute, setDraft, selectedProviderUnsupported, reasoningOptions, supportsReasoningEffort, supportsAgentOptions, applyLegacy, applyDisabled, agentOptionsUnsupported, error, status, options, invalidReasoning } = props
  const h = createElement
  return h('div', { className: 'dsh-mc-setting-rows' },
    h(SettingRow, {
      label: t('subagent.defaultModel'),
       description: t('subagent.defaultModelNote'),
      control: h(ModelRoutePicker, {
        options,
        value: draft.mode === 'fixed' ? { provider: draft.provider, model: draft.model } : null,
        onChange: updateRoute,
        inheritLabel: t('subagent.inheritMain'),
        ariaLabel: t('subagent.defaultModel'),
        searchPlaceholder: t('subagent.searchPool'),
        searchAriaLabel: t('subagent.searchPool'),
        emptyLabel: t('noModels'),
        allowInherit: true,
      }),
    }),
    !supportsAgentOptions
      ? h('p', { className: 'dsh-mc-muted' }, t('subagent.agentOptionsUnsupported'))
      : selectedProviderUnsupported
        ? h('p', { className: 'dsh-mc-muted' }, t('subagent.backendManagesModel'))
        : draft.mode === 'fixed' ? h('div', { className: 'dsh-mc-setting-rows dsh-mc-subagent-fixed' },
            h(SettingRow, {
              label: t('subagent.maxTokens'),
              control: h(InlineNumberEditor, { value: draft.maxTokens, onChange: (value: string) => setDraft({ ...draft, maxTokens: value }), placeholder: t('subagent.reasoning.auto'), ariaLabel: t('subagent.maxTokens') }),
            }),
            supportsReasoningEffort ? h(SettingRow, {
              label: t('subagent.reasoningEffort'),
              control: h(CompactSelect, { value: draft.reasoningEffort, options: reasoningOptions, onChange: (reasoningEffort: string) => setDraft({ ...draft, reasoningEffort }), placeholder: t('subagent.reasoning.auto'), ariaLabel: t('subagent.reasoningEffort') }),
            }) : null,
            invalidReasoning ? h('p', { className: 'dsh-mc-setting-warning' }, t('subagent.reasoning.unsupportedBlocked')) : null,
          ) : null,
    error ? h('p', { className: 'dsh-mc-error' }, error) : null,
    status ? h('p', { className: 'dsh-mc-muted' }, status) : null,
    h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-secondary', disabled: applyDisabled, onClick: () => void applyLegacy() }, t('subagent.apply')),
  )
}

function NativeSection(props: any): any {
  const { t, draft, setDraft, setLegacyDraft, options, applyNative, modelSelectionEnabled, nativeWritable, controlWritable, enableModelSelection, error, status, legacyDraft, updateLegacyRoute, supportsReasoningEffort, supportsAgentOptions, reasoningOptions, selectedProviderUnsupported, applyLegacy, applyDisabled, invalidReasoning } = props
  const h = createElement
  if (!modelSelectionEnabled) {
    return h('div', { className: 'dsh-mc-setting-rows' },
      h('p', { className: 'dsh-mc-muted' }, t('subagent.modelSelectionNotEnabled')),
      !nativeWritable ? h('p', { className: 'dsh-mc-muted' }, t('subagent.readonly')) : null,
      controlWritable
        ? h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-secondary', onClick: () => void enableModelSelection() }, t('subagent.enableModelSelection'))
        : h('p', { className: 'dsh-mc-muted' }, t('subagent.modelSelectionConfigRequired')),
    )
  }
  return h('div', { className: 'dsh-mc-setting-rows' },
    !nativeWritable ? h('p', { className: 'dsh-mc-muted' }, t('subagent.readonly')) : null,
    h(SettingRow, {
      label: t('subagent.enableDynamicSelection'),
      control: h(CompactSelect, {
        value: draft.enabled ? 'enabled' : 'disabled',
        options: [{ value: 'enabled', label: t('compat.enabled') }, { value: 'disabled', label: t('compat.disabled') }],
        onChange: (value: string) => setDraft({ ...draft, enabled: value === 'enabled' }),
        ariaLabel: t('subagent.enableDynamicSelection'),
        disabled: !nativeWritable,
      }),
    }),
    h(SettingRow, {
      label: t('subagent.allowedModels'),
       description: t('subagent.allowedModels.description'),
      control: h(MultiModelPicker, {
        options,
        value: draft.allowedModels,
        onChange: (allowedModels: AllowedModelRoute[]) => setDraft({ ...draft, allowedModels }),
        summary: draft.allowedModels.length === 0 ? t('subagent.allowedModels.emptySummary') : `${draft.allowedModels.length} ${t('subagent.allowedModels.selectedSuffix')}`,
        ariaLabel: t('subagent.allowedModels'),
        searchPlaceholder: t('subagent.searchPool'),
        searchAriaLabel: t('subagent.searchPool'),
        emptyLabel: t('noModels'),
        disabled: !nativeWritable,
      }),
    }),
    h(DisclosureRow, { summary: t('subagent.defaultModelDisclosure'), value: legacyDraft.mode === 'fixed' ? `${legacyDraft.provider} / ${legacyDraft.model}` : t('subagent.inheritMain') },
      h(LegacySection, {
        t, draft: legacyDraft, updateRoute: updateLegacyRoute, setDraft: setLegacyDraft,
        selectedProviderUnsupported, reasoningOptions, supportsReasoningEffort, supportsAgentOptions,
        applyLegacy, applyDisabled, options, invalidReasoning,
      }),
    ),
    error ? h('p', { className: 'dsh-mc-error' }, error) : null,
    status ? h('p', { className: 'dsh-mc-muted' }, status) : null,
    h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-secondary', disabled: !nativeWritable, onClick: () => void applyNative() }, t('subagent.apply')),
  )
}
