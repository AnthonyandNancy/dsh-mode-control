import { describe, expect, it } from 'vitest'
import { collectOpsForAllProviders } from '../src/client/save-helpers.ts'
import { reasoningEffortsFor } from '../src/client/ops.ts'

describe('anthropic-messages max wire materialization', () => {
  it('materializes canonical max as the wire value max', () => {
    expect(reasoningEffortsFor(
      {
        reasoningMode: 'custom',
        efforts: ['max'],
        wire: {},
      },
      true,
    )).toEqual({
      max: 'max',
    })
  })

  it('keeps the canonical selector id and default wire mapping fixed', () => {
    const draft = {
      reasoningMode: 'custom' as const,
      efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      wire: {},
    }
    expect(reasoningEffortsFor(draft, true)).toEqual({
      minimal: 'low',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('preserves an explicit custom wire value over the default', () => {
    expect(reasoningEffortsFor(
      {
        reasoningMode: 'custom',
        efforts: ['max'],
        wire: { max: 'high' },
      },
      true,
    )).toEqual({
      max: 'high',
    })
  })

  it('emits the exact anthropic-messages mutation with max: max', () => {
    const providerConfig = {
      api: 'anthropic-messages',
      modelOverrides: {
        'claude-max': {},
      },
    }
    const providerDraft = {
      defaultInput: [],
      defaultReasoning: '',
      adaptiveThinking: 'inherit' as const,
      compat: {},
    }
    const modelDraft = {
      input: [],
      reasoningMode: 'custom' as const,
      efforts: ['low', 'max'],
      wire: {},
      compat: {},
    }
    const ops = collectOpsForAllProviders(
      ['acme'],
      { acme: providerConfig },
      { acme: providerDraft },
      { acme: { 'claude-max': modelDraft } },
      new Set(['acme']),
    )
    expect(ops).toContainEqual({
      op: 'set',
      path: ['providers', 'acme', 'modelOverrides', 'claude-max', 'reasoningEfforts'],
      value: { low: 'low', max: 'max' },
    })
    expect(ops.some(op =>
      op.path.join('.') === 'providers.acme.modelOverrides.claude-max.reasoningEfforts'
      && (op as any).value?.max === 'high',
    )).toBe(false)
  })
})
