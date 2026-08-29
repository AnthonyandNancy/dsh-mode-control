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
  it('does not set unsupported model compat fields but still allows clearing them', () => {
    const providerConfig = { modelOverrides: { foo: { compat: { supportsStore: true } } } }
    const draft = {
      input: [], reasoningMode: 'inherit' as const, efforts: [], wire: {},
      compat: {
        supportsStore: { kind: 'boolean' as const, mode: 'disabled' as const },
      },
    }
    const blocked = collectOpsForModels('acme', providerConfig, { foo: draft }, false, new Set())
    expect(blocked).toEqual([])
    const clearable = collectOpsForModels('acme', providerConfig, {
      foo: { ...draft, compat: { supportsStore: { kind: 'boolean' as const, mode: 'inherit' as const } } },
    }, false, new Set())
    expect(clearable).toContainEqual({ op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'compat', 'supportsStore'] })
  })
  it('preserves mixed model array and override route ownership', () => {
    const providerConfig = {
      models: [{ id: 'declared', name: 'Declared' }],
      modelOverrides: { 'override-only': { maxTokens: 4000, future: true } },
    }
    const drafts = {
      declared: { input: [], reasoningMode: 'inherit' as const, efforts: [], wire: {} },
      'override-only': { input: ['image'], reasoningMode: 'inherit' as const, efforts: [], wire: {}, maxTokens: '8000' },
      'catalog-only': { input: ['image'], reasoningMode: 'inherit' as const, efforts: [], wire: {} },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'acme', 'modelOverrides', 'override-only', 'input'], value: ['image'] })
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'acme', 'modelOverrides', 'override-only', 'maxTokens'], value: 8000 })
    expect((ops.find(op => op.path.at(-1) === 'models')?.value as Array<Record<string, unknown>>).map(entry => entry.id)).toEqual(['declared'])
  })

  it('does not write unsupported compat fields in a declared model entry', () => {
    const providerConfig = { models: [{ id: 'foo', compat: { supportsStore: true } }] }
    const draft = {
      input: [], reasoningMode: 'inherit' as const, efforts: [], wire: {},
      compat: { supportsStore: { kind: 'boolean' as const, mode: 'disabled' as const } },
    }
    expect(collectOpsForModels('acme', providerConfig, { foo: draft }, false, new Set())).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models'], value: [{ id: 'foo', compat: { supportsStore: true } }] },
    ])
  })

  it('applies per-model anthropic wire defaults when given a model resolver', () => {
    const providerConfig = {
      modelOverrides: { a: {}, b: {} },
    }
    const drafts = {
      a: { input: [], reasoningMode: 'custom' as const, efforts: ['minimal'], wire: {} },
      b: { input: [], reasoningMode: 'custom' as const, efforts: ['minimal'], wire: {} },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts, (model: string) => model === 'b')
    expect(ops).toContainEqual({
      op: 'set', path: ['providers', 'acme', 'modelOverrides', 'a', 'reasoningEfforts'], value: { minimal: 'minimal' },
    })
    expect(ops).toContainEqual({
      op: 'set', path: ['providers', 'acme', 'modelOverrides', 'b', 'reasoningEfforts'], value: { minimal: 'low' },
    })
  })

  it('maps reasoning draft changes to the persisted reasoningEfforts field', () => {
    const ops = collectOpsForModels('acme', { models: [{ id: 'declared', reasoningEfforts: { low: 'low' } }] }, {
      declared: { input: [], reasoningMode: 'custom', efforts: ['high'], wire: { high: 'high' }, contextWindow: '', maxTokens: '', compat: {} },
    }, false, undefined, new Map([['declared', new Set(['efforts', 'wire', 'reasoningMode'])]]))
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'acme', 'models'], value: [{ id: 'declared', reasoningEfforts: { high: 'high' } }] })
  })

  it('does not collect model arrays when only provider fields are dirty', () => {
    expect(collectOpsForModels('acme', { models: [{ id: 'declared', input: ['text'] }] }, {
      declared: { input: ['image'], reasoningMode: 'inherit', efforts: [], wire: {}, contextWindow: '', maxTokens: '', compat: {} },
    }, false, undefined, new Map())).toEqual([])
  })

  it('preserves untouched model entries during a rebased save', () => {
    const ops = collectOpsForModels('acme', {
      models: [
        { id: 'declared', input: ['text'], remoteOnly: 'new' },
        { id: 'untouched', input: ['text'], remoteOnly: 'fresh' },
      ],
    }, {
      declared: { input: ['image'], reasoningMode: 'inherit' as const, efforts: [], wire: {}, contextWindow: '', maxTokens: '', compat: {} },
      untouched: { input: ['audio'], reasoningMode: 'inherit' as const, efforts: [], wire: {}, contextWindow: '', maxTokens: '', compat: {} },
    }, false, undefined, new Map([['declared', new Set(['input'])]]))
    expect(ops).toEqual([{ op: 'set', path: ['providers', 'acme', 'models'], value: [
      { id: 'declared', input: ['image'], remoteOnly: 'new' },
      { id: 'untouched', input: ['text'], remoteOnly: 'fresh' },
    ] }])
  })

  it('does not materialize catalog-only draft models into models[]', () => {
    const providerConfig = { models: [{ id: 'declared', name: 'Declared' }] }
    const drafts = {
      declared: { input: [], reasoningMode: 'inherit' as const, efforts: [], wire: {} },
      'catalog-only': { input: ['image'], reasoningMode: 'inherit' as const, efforts: [], wire: {} },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toHaveLength(1)
    expect((ops[0].value as Array<Record<string, unknown>>).map(entry => entry.id)).toEqual(['declared'])
  })

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
