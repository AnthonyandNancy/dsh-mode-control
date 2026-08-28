import { describe, expect, it } from 'vitest'
import {
  collectOpsForModels,
  collectOpsForProvider,
  parseModelDraft,
  parseProviderDraft,
} from '../src/client/ops.ts'

describe('provider extended draft', () => {
  it('parses capacities, thinking budgets, and compat', () => {
    const draft = parseProviderDraft({
      defaultContextWindow: 262144,
      defaultMaxTokens: 32768,
      thinkingBudgets: { low: 16000, high: 64000 },
      compat: {
        supportsStore: false,
        maxTokensField: 'max_completion_tokens',
        chatTemplateKwargs: { system: '<|system|>' },
      },
    })
    expect(draft.defaultContextWindow).toBe('262144')
    expect(draft.defaultMaxTokens).toBe('32768')
    expect(draft.thinkingBudgets?.low).toBe('16000')
    expect(draft.thinkingBudgets?.high).toBe('64000')
    expect(draft.compat?.supportsStore).toEqual({ kind: 'boolean', mode: 'disabled' })
    expect(draft.compat?.maxTokensField).toEqual({ kind: 'enum', value: 'max_completion_tokens' })
  })
})

describe('provider extended ops', () => {
  it('sets/unset capacities and thinking budgets precisely', () => {
    const ops = collectOpsForProvider('acme', {
      defaultContextWindow: 100000,
      defaultMaxTokens: 50000,
      thinkingBudgets: { low: 1000 },
      compat: { supportsStore: true },
    }, {
      defaultInput: [],
      defaultReasoning: '',
      adaptiveThinking: 'inherit',
      defaultContextWindow: '200000',
      defaultMaxTokens: '',
      thinkingBudgets: { low: '', medium: '32000' },
      compat: {
        supportsStore: { kind: 'boolean', mode: 'inherit' },
      },
    })
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'defaultContextWindow'], value: 200000 },
      { op: 'unset', path: ['providers', 'acme', 'defaultMaxTokens'] },
      { op: 'set', path: ['providers', 'acme', 'thinkingBudgets'], value: { medium: 32000 } },
      { op: 'unset', path: ['providers', 'acme', 'compat', 'supportsStore'] },
    ])
  })

  it('keeps existing compat fields untouched when only a capacity changes', () => {
    const ops = collectOpsForProvider('acme', {
      compat: { supportsStore: false, someFutureCompat: 'keep' },
    }, {
      defaultInput: [],
      defaultReasoning: '',
      adaptiveThinking: 'inherit',
      defaultContextWindow: '128000',
      compat: {
        supportsStore: { kind: 'boolean', mode: 'disabled' },
        forceAdaptiveThinking: { kind: 'boolean', mode: 'inherit' },
      },
    })
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'defaultContextWindow'], value: 128000 },
    ])
  })
})

describe('model extended draft', () => {
  it('parses contextWindow, maxTokens, and compat', () => {
    const draft = parseModelDraft({
      contextWindow: 200000,
      maxTokens: 64000,
      compat: { forceAdaptiveThinking: true, supportsStrictTools: false },
    })
    expect(draft.contextWindow).toBe('200000')
    expect(draft.maxTokens).toBe('64000')
    expect(draft.compat?.forceAdaptiveThinking).toEqual({ kind: 'boolean', mode: 'enabled' })
    expect(draft.compat?.supportsStrictTools).toEqual({ kind: 'boolean', mode: 'disabled' })
  })
})

describe('modelOverrides extended ops', () => {
  const providerConfig = {
    modelOverrides: {
      foo: {
        contextWindow: 128000,
        maxTokens: 64000,
        reasoningEfforts: { high: 'high' },
        compat: {
          supportsStore: false,
          someFutureCompat: 'keep',
          forceAdaptiveThinking: true,
        },
      },
    },
  }

  it('keeps capacities/compat when editing input only', () => {
    const drafts = {
      foo: {
        input: ['text'],
        reasoningMode: 'inherit' as const,
        efforts: [],
        wire: {},
        contextWindow: '128000',
        maxTokens: '64000',
        compat: {
          supportsStore: { kind: 'boolean' as const, mode: 'disabled' as const },
          forceAdaptiveThinking: { kind: 'boolean' as const, mode: 'enabled' as const },
        },
      },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'input'], value: ['text'] },
      { op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'reasoningEfforts'] },
    ])
  })

  it('unsets capacities when the draft explicitly inherits them', () => {
    const drafts = {
      foo: {
        input: [],
        reasoningMode: 'inherit' as const,
        efforts: [],
        wire: {},
        contextWindow: '',
        maxTokens: '',
      },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toContainEqual(
      { op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'contextWindow'] },
    )
    expect(ops).toContainEqual(
      { op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'maxTokens'] },
    )
  })

  it('writes contextWindow/maxTokens and compat path ops', () => {
    const drafts = {
      foo: {
        input: [],
        reasoningMode: 'inherit' as const,
        efforts: [],
        wire: {},
        contextWindow: '200000',
        maxTokens: '32000',
        compat: {
          forceAdaptiveThinking: { kind: 'boolean' as const, mode: 'disabled' as const },
          supportsStrictTools: { kind: 'boolean' as const, mode: 'enabled' as const },
        },
      },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'contextWindow'], value: 200000 },
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'maxTokens'], value: 32000 },
      { op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'reasoningEfforts'] },
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'compat', 'forceAdaptiveThinking'], value: false },
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'compat', 'supportsStrictTools'], value: true },
    ])
  })
})

describe('models[] extended ops', () => {
  it('preserves unknown fields and unknown compat when saving model fields', () => {
    const providerConfig = {
      models: [
        {
          id: 'foo',
          contextWindow: 200000,
          maxTokens: 64000,
          name: 'Foo',
          futureField: 'keep',
          compat: { someFutureCompat: 'keep', supportsStore: true },
        },
      ],
    }
    const drafts = {
      foo: {
        input: ['text'],
        reasoningMode: 'inherit' as const,
        efforts: [],
        wire: {},
        contextWindow: '128000',
        maxTokens: '',
        compat: {
          supportsStore: { kind: 'boolean' as const, mode: 'inherit' as const },
        },
      },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toHaveLength(1)
    const setModels = ops[0]
    expect(setModels.op).toBe('set')
    const value = setModels.value as Array<Record<string, unknown>>
    expect(value[0]).toMatchObject({
      id: 'foo',
      name: 'Foo',
      futureField: 'keep',
      contextWindow: 128000,
      compat: { someFutureCompat: 'keep' },
    })
    expect(value[0]).not.toHaveProperty('maxTokens')
    expect(value[0]).not.toHaveProperty('reasoningEfforts')
  })
})
