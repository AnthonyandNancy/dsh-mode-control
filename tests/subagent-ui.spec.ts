import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/ui.ts', () => ({
  CheckIcon: () => null,
  ChevronDownIcon: () => null,
  CompactSelect: () => null,
  DisclosureRow: () => null,
  InlineNumberEditor: () => null,
  Panel: () => null,
  SettingRow: () => null,
  TextInput: () => null,
}))
import {
  applySuccessOutcome,
  buildSubagentReasoningOptions,
  buildSubagentRouteOptions,
  canApplyLegacyRoute,
  isInvalidExplicitReasoningEffort,
  isLegacyProviderBlocked,
  isNativeNamespaceWritable,
  providerAgentOptionsSupported,
  revisionForNextApply,
  revisionFromMutationResponse,
  shouldPreserveDraftOnParentUpdate,
  updateLegacyRouteDraft,
} from '../src/client/subagent-ui.ts'

describe('subagent UI regression helpers', () => {
  it('reads the returned settings revision from mutation responses', () => {
    expect(revisionFromMutationResponse({ result: { value: { revision: 12 } } })).toBe(12)
    expect(revisionFromMutationResponse({ result: { revision: 13 } })).toBe(13)
    expect(revisionFromMutationResponse({ result: { value: {} } })).toBeUndefined()
  })
  it('blocks legacy apply for providers that do not support agent options', () => {
    expect(canApplyLegacyRoute(true, true, false, true)).toBe(false)
    expect(canApplyLegacyRoute(true, true, true, true)).toBe(true)
    expect(canApplyLegacyRoute(false, true, true, true)).toBe(false)
  })

  it('requires the global supportsAgentOptions capability for legacy apply', () => {
    expect(canApplyLegacyRoute(true, false, true, true)).toBe(false)
    expect(canApplyLegacyRoute(true, false, false, true)).toBe(false)
  })

  it('fails closed when a fixed route provider has no runtime snapshot', () => {
    expect(canApplyLegacyRoute(true, true, undefined, true)).toBe(false)
    // Removing a managed override is still allowed without a provider snapshot.
    expect(canApplyLegacyRoute(true, true, undefined, false)).toBe(true)
  })

  it('treats a missing provider snapshot as blocked for fixed routes', () => {
    expect(isLegacyProviderBlocked('acme', {})).toBe(true)
    expect(isLegacyProviderBlocked('acme', { acme: false })).toBe(true)
    expect(isLegacyProviderBlocked('acme', { acme: true })).toBe(false)
    expect(isLegacyProviderBlocked('', {})).toBe(false)
  })

  it('exposes the provider snapshot support tri-state', () => {
    expect(providerAgentOptionsSupported({ acme: true }, 'acme')).toBe(true)
    expect(providerAgentOptionsSupported({ acme: false }, 'acme')).toBe(false)
    expect(providerAgentOptionsSupported({}, 'acme')).toBeUndefined()
    expect(providerAgentOptionsSupported({}, '')).toBeUndefined()
  })

  it('treats an explicitly read-only native namespace as not writable', () => {
    expect(isNativeNamespaceWritable({ writable: false })).toBe(false)
    expect(isNativeNamespaceWritable({ writable: true })).toBe(true)
    expect(isNativeNamespaceWritable(undefined)).toBe(true)
  })

  it('preserves tuning fields and unknown fields when switching fixed legacy routes', () => {
    const draft = updateLegacyRouteDraft({
      mode: 'fixed',
      provider: 'old-provider',
      model: 'old-model',
      maxTokens: '16000',
      reasoningEffort: 'high',
      extra: { futureField: { keep: true } },
    }, { provider: 'new-provider', model: 'new-model' })

    expect(draft).toEqual({
      mode: 'fixed',
      provider: 'new-provider',
      model: 'new-model',
      maxTokens: '16000',
      reasoningEffort: 'high',
      extra: { futureField: { keep: true } },
    })
  })

  it('preserves legacy tuning while switching back to inherited route', () => {
    expect(updateLegacyRouteDraft({ mode: 'fixed', provider: 'p', model: 'm', maxTokens: '8000', reasoningEffort: 'high' }, null)).toEqual({
      mode: 'inherit', provider: '', model: '', maxTokens: '8000', reasoningEffort: 'high',
    })
  })

  it('clears dirty only when no new edit happened during a pending apply', () => {
    expect(applySuccessOutcome(1, 1, 10, undefined)).toEqual({ clearDirty: true, revision: 10 })
    expect(applySuccessOutcome(1, 2, 10, undefined)).toEqual({ clearDirty: false, revision: 10 })
  })

  it('keeps the latest revision across sequential applies', () => {
    expect(revisionForNextApply(10, undefined)).toBe(10)
    expect(revisionForNextApply(10, 12)).toBe(12)
    expect(applySuccessOutcome(2, 2, undefined, 10)).toEqual({ clearDirty: true, revision: 10 })
  })

  it('does not reset a draft from parent updates while it is dirty', () => {
    expect(shouldPreserveDraftOnParentUpdate(true)).toBe(true)
    expect(shouldPreserveDraftOnParentUpdate(false)).toBe(false)
  })

  it('includes persisted native routes that are missing from the catalog', () => {
    const options = buildSubagentRouteOptions(
      ['catalog-provider'],
      { 'catalog-provider': ['catalog-model'] },
      [{ provider: 'removed-provider', model: 'persisted-model' }],
    )

    expect(options.map(({ provider, model }) => ({ provider, model }))).toEqual([
      { provider: 'catalog-provider', model: 'catalog-model' },
      { provider: 'removed-provider', model: 'persisted-model' },
    ])
  })
})

describe('subagent explicit reasoning options', () => {
  it('offers only runtime exact efforts plus an invalid persisted effort', () => {
    const options = buildSubagentReasoningOptions(['low', 'high'], 'max', '(currently unsupported)')
    expect(options).toEqual([
      { value: 'low', label: 'low' },
      { value: 'high', label: 'high' },
      { value: 'max', label: 'max (currently unsupported)', unsupported: true },
    ])
  })

  it('does not offer local authoring efforts that runtime has not resolved', () => {
    const options = buildSubagentReasoningOptions(['low'], '')
    expect(options).toEqual([
      { value: 'low', label: 'low' },
    ])
  })

  it('detects an explicit effort missing from runtime', () => {
    expect(isInvalidExplicitReasoningEffort('max', ['low', 'high'])).toBe(true)
    expect(isInvalidExplicitReasoningEffort('low', ['low', 'high'])).toBe(false)
    expect(isInvalidExplicitReasoningEffort('', ['low'])).toBe(false)
  })

  it('blocks legacy apply while an explicit reasoning effort is unsupported', () => {
    expect(canApplyLegacyRoute(true, true, true, true, true)).toBe(false)
    expect(canApplyLegacyRoute(true, true, true, true, false)).toBe(true)
  })
})
