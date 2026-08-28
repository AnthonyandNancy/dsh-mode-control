import { describe, expect, it } from 'vitest'
import {
  agentOptionsFromLegacyDraft,
  legacyDraftFromAgentOptions,
  validateAllowedModels,
  type LegacySubagentDraft,
  type NativeSubagentDraft,
  type SettingsOp,
} from '../src/client/subagent-state.ts'

describe('legacy agentOptions drafts', () => {
  it('parses existing agentOptions and preserves future fields', () => {
    const draft = legacyDraftFromAgentOptions({
      provider: 'a',
      model: 'b',
      maxTokens: 10000,
      someFutureField: true,
    })
    expect(draft).toEqual({
      mode: 'fixed',
      provider: 'a',
      model: 'b',
      maxTokens: '10000',
      reasoningEffort: '',
      extra: { someFutureField: true },
    })
  })

  it('parses inherit when agentOptions is absent', () => {
    const draft = legacyDraftFromAgentOptions(undefined)
    expect(draft.mode).toBe('inherit')
  })

  it('writes fixed model with preserved future fields', () => {
    const draft: LegacySubagentDraft = {
      mode: 'fixed',
      provider: 'a',
      model: 'c',
      maxTokens: '16000',
      reasoningEffort: '',
      extra: { someFutureField: true },
    }
    expect(agentOptionsFromLegacyDraft(draft)).toEqual({
      unset: false,
      value: { provider: 'a', model: 'c', maxTokens: 16000, someFutureField: true },
    })
  })

  it('inherits by unsetting the managed agentOptions', () => {
    const draft: LegacySubagentDraft = {
      mode: 'inherit',
      provider: 'a',
      model: 'b',
      maxTokens: '',
      reasoningEffort: '',
      extra: { someFutureField: true },
    }
    const result = agentOptionsFromLegacyDraft(draft)
    expect(result.unset).toBe(true)
  })

  it('omits empty maxTokens and reasoningEffort', () => {
    const draft: LegacySubagentDraft = {
      mode: 'fixed',
      provider: 'a',
      model: 'b',
      maxTokens: '',
      reasoningEffort: '',
      extra: {},
    }
    expect(agentOptionsFromLegacyDraft(draft)).toEqual({
      unset: false,
      value: { provider: 'a', model: 'b' },
    })
  })
})

describe('allowed model validation', () => {
  it('allows disabled with an empty pool', () => {
    const draft: NativeSubagentDraft = { enabled: false, allowedModels: [] }
    expect(validateAllowedModels(draft)).toEqual({ ok: true })
  })

  it('rejects enabled with an empty pool', () => {
    const draft: NativeSubagentDraft = { enabled: true, allowedModels: [] }
    const result = validateAllowedModels(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorKey).toBe('subagent.allowedModels.empty')
  })

  it('allows enabled with one route', () => {
    const draft: NativeSubagentDraft = { enabled: true, allowedModels: [{ provider: 'a', model: 'm' }] }
    expect(validateAllowedModels(draft)).toEqual({ ok: true })
  })

  it('rejects duplicate provider/model routes', () => {
    const draft: NativeSubagentDraft = {
      enabled: true,
      allowedModels: [
        { provider: 'a', model: 'm' },
        { provider: 'a', model: 'm' },
      ],
    }
    const result = validateAllowedModels(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorKey).toBe('subagent.allowedModels.duplicate')
  })

  it('rejects empty provider or model', () => {
    expect(validateAllowedModels({
      enabled: true,
      allowedModels: [{ provider: '', model: 'm' }],
    }).ok).toBe(false)
    expect(validateAllowedModels({
      enabled: true,
      allowedModels: [{ provider: 'a', model: '' }],
    }).ok).toBe(false)
  })
})

describe('legacy ops', () => {
  it('builds set/unset ops for the managed namespace', () => {
    const fixed: LegacySubagentDraft = {
      mode: 'fixed',
      provider: 'a',
      model: 'b',
      maxTokens: '16000',
      reasoningEffort: 'high',
      extra: {},
    }
    expect(agentOptionsOps(fixed)).toEqual<SettingsOp[]>([
      { op: 'set', path: ['agentOptions'], value: { provider: 'a', model: 'b', maxTokens: 16000, reasoningEffort: 'high' } },
    ])
    const inherit: LegacySubagentDraft = { ...fixed, mode: 'inherit' }
    expect(agentOptionsOps(inherit)).toEqual<SettingsOp[]>([
      { op: 'unset', path: ['agentOptions'] },
    ])
  })
})

function agentOptionsOps(draft: LegacySubagentDraft): SettingsOp[] {
  const result = agentOptionsFromLegacyDraft(draft)
  return result.unset
    ? [{ op: 'unset' as const, path: ['agentOptions'] }]
    : [{ op: 'set' as const, path: ['agentOptions'], value: result.value }]
}
