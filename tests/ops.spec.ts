import { describe, expect, it } from 'vitest'
import {
  collectOpsForAdaptiveThinking,
  collectOpsForModels,
  collectOpsForProvider,
  detectDshMode,
  isAnthropicProvider,
  parseProviderDraft,
  reasoningEffortsFor,
  type ModelDraft,
  type ProviderDraft,
} from '../src/client/ops.ts'

describe('adaptive thinking tri-state', () => {
  it('maps undefined to inherit, true to enabled, false to disabled', () => {
    expect(parseProviderDraft({}).adaptiveThinking).toBe('inherit')
    expect(parseProviderDraft({ compat: { forceAdaptiveThinking: true } }).adaptiveThinking).toBe('enabled')
    expect(parseProviderDraft({ compat: { forceAdaptiveThinking: false } }).adaptiveThinking).toBe('disabled')
  })
})

describe('dsh mode detection', () => {
  it('detects rc6/rc7/rc8 from host version', () => {
    expect(detectDshMode('0.1.0-rc.6')).toBe('rc6')
    expect(detectDshMode('0.1.0-rc.7')).toBe('rc7')
    expect(detectDshMode('0.1.0-rc.8')).toBe('rc8')
  })

  it('falls back to schema native detection when host version is unavailable', () => {
    expect(detectDshMode(undefined, { compat: { forceAdaptiveThinking: true } })).toBe('rc8')
    expect(detectDshMode(undefined, { compat: {} })).toBe('unknown')
  })

  it('treats a known host version without rc match as legacy and unknown rc as unknown', () => {
    expect(detectDshMode('0.1.0')).toBe('legacy')
    expect(detectDshMode('0.1.0-rc.9')).toBe('unknown')
  })
})

describe('collectOpsForAdaptiveThinking', () => {
  it('enabled sets true at the precise compat path', () => {
    expect(collectOpsForAdaptiveThinking('acme', {}, 'enabled')).toEqual([
      { op: 'set', path: ['providers', 'acme', 'compat', 'forceAdaptiveThinking'], value: true },
    ])
  })

  it('disabled sets false at the precise compat path', () => {
    expect(collectOpsForAdaptiveThinking('acme', {}, 'disabled')).toEqual([
      { op: 'set', path: ['providers', 'acme', 'compat', 'forceAdaptiveThinking'], value: false },
    ])
  })

  it('inherit unsets only when the field already exists', () => {
    expect(collectOpsForAdaptiveThinking('acme', {}, 'inherit')).toEqual([])
    expect(collectOpsForAdaptiveThinking('acme', { compat: { forceAdaptiveThinking: true } }, 'inherit')).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'compat', 'forceAdaptiveThinking'] },
    ])
  })

  it('does not replace the whole compat object', () => {
    const providerConfig = {
      compat: {
        supportsTemperature: false,
        supportsStrictTools: true,
      },
    }
    const ops = collectOpsForAdaptiveThinking('acme', providerConfig, 'enabled')
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'compat', 'forceAdaptiveThinking'], value: true },
    ])
  })
})

describe('collectOpsForProvider', () => {
  it('keeps existing compat fields when enabling adaptive thinking', () => {
    const draft: ProviderDraft = {
      defaultInput: [],
      defaultReasoning: '',
      adaptiveThinking: 'enabled',
    }
    const ops = collectOpsForProvider('acme', {
      compat: { supportsTemperature: false, supportsStrictTools: true },
    }, draft)
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'compat', 'forceAdaptiveThinking'], value: true },
    ])
  })
})

describe('modelOverrides P0 precise mutation', () => {
  const providerConfig = {
    modelOverrides: {
      foo: {
        contextWindow: 128000,
        maxTokens: 64000,
        compat: { forceAdaptiveThinking: true },
        reasoningEfforts: { high: 'high' },
      },
    },
  }

  it('does not replace or delete the whole override when editing input only', () => {
    const drafts: Record<string, ModelDraft> = {
      foo: { input: ['text'], reasoningMode: 'inherit', efforts: [] },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'input'], value: ['text'] },
      { op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'reasoningEfforts'] },
    ])
    expect(ops.some(op => op.path.length === 4 && op.path[3] === undefined)).toBe(false)
    expect(ops.some(op => op.op === 'unset' && op.path.join('.') === 'providers.acme.modelOverrides.foo')).toBe(false)
  })

  it('keeps contextWindow/maxTokens/compat when saving input and reasoningEfforts', () => {
    const drafts: Record<string, ModelDraft> = {
      foo: { input: ['text', 'image'], reasoningMode: 'custom', efforts: ['high'] },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toEqual([
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'input'], value: ['text', 'image'] },
      { op: 'set', path: ['providers', 'acme', 'modelOverrides', 'foo', 'reasoningEfforts'], value: { high: 'high' } },
    ])
  })

  it('restoring reasoning default only removes reasoningEfforts, not the model override', () => {
    const drafts: Record<string, ModelDraft> = {
      foo: { input: [], reasoningMode: 'inherit', efforts: [] },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'modelOverrides', 'foo', 'reasoningEfforts'] },
    ])
    expect(ops.some(op => op.op === 'unset' && op.path.join('.') === 'providers.acme.modelOverrides.foo')).toBe(false)
  })
})

describe('models[] branch preserves non-plugin-owned fields', () => {
  it('keeps contextWindow/compat on entries while updating plugin-owned fields', () => {
    const providerConfig = {
      models: [
        {
          id: 'foo',
          contextWindow: 200000,
          maxTokens: 64000,
          compat: { forceAdaptiveThinking: true },
        },
      ],
    }
    const drafts: Record<string, ModelDraft> = {
      foo: { input: ['text'], reasoningMode: 'inherit', efforts: [] },
    }
    const ops = collectOpsForModels('acme', providerConfig, drafts)
    expect(ops).toHaveLength(1)
    const setModels = ops[0]
    expect(setModels.op).toBe('set')
    expect(setModels.path).toEqual(['providers', 'acme', 'models'])
    const value = setModels.value as Array<Record<string, unknown>>
    expect(value[0]).toMatchObject({
      id: 'foo',
      contextWindow: 200000,
      maxTokens: 64000,
      compat: { forceAdaptiveThinking: true },
      input: ['text'],
    })
  })
})

describe('anthropic protocol detection', () => {
  it('shows for explicit api', () => {
    expect(isAnthropicProvider('acme', { api: 'anthropic-messages' }, [])).toBe(true)
  })

  it('shows for resolved catalog model api even without provider api', () => {
    const groups = [{
      id: 'acme',
      models: [{ id: 'claude-x', api: 'anthropic-messages' }],
    }]
    expect(isAnthropicProvider('acme', {}, groups)).toBe(true)
  })

  it('shows when an existing forceAdaptiveThinking field must remain editable', () => {
    expect(isAnthropicProvider('acme', { compat: { forceAdaptiveThinking: true } }, [])).toBe(true)
  })

  it('does not guess from provider name', () => {
    expect(isAnthropicProvider('anthropic', {}, [])).toBe(false)
    expect(isAnthropicProvider('deepseek', {}, [])).toBe(false)
  })
})

describe('anthropic reasoningEfforts default mapping', () => {
  const draft: ModelDraft = {
    input: [],
    reasoningMode: 'custom',
    efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  }

  it('maps minimal to low for anthropic-messages', () => {
    expect(reasoningEffortsFor(draft, true)).toEqual({
      off: null,
      minimal: 'low',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('keeps generic mapping unchanged (minimal -> minimal)', () => {
    expect(reasoningEffortsFor(draft, false)).toEqual({
      off: null,
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })
})
