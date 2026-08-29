import { describe, expect, it } from 'vitest'
import {
  configuredReasoningEfforts,
  parseUnsupportedReasoningEffortError,
  reasoningMismatch,
  resolveRuntimeReasoningCapability,
  runtimeReasoningEfforts,
  type RuntimeReasoningCapability,
} from '../src/client/reasoning-capabilities.ts'
import type { ModelDraft } from '../src/client/ops.ts'

function draft(overrides: Partial<ModelDraft> = {}): ModelDraft {
  return {
    input: [],
    reasoningMode: 'inherit',
    efforts: [],
    wire: {},
    ...overrides,
  }
}

describe('runtime reasoning capability resolver', () => {
  it('reads exact model reasoning from api.llm.models() groups', () => {
    const groups = [{
      id: 'location',
      models: [{
        id: 'DeepSeek-V4-Flash-0731',
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
          ],
          defaultEffort: 'high',
        },
      }],
    }]
    expect(resolveRuntimeReasoningCapability(groups, 'location', 'DeepSeek-V4-Flash-0731')).toEqual({
      available: true,
      efforts: ['low', 'high'],
      defaultEffort: 'high',
      source: 'runtime',
    })
    expect(runtimeReasoningEfforts(groups, 'location', 'DeepSeek-V4-Flash-0731')).toEqual(['low', 'high'])
  })

  it('never uses provider defaults or model-name heuristics', () => {
    const groups = [{
      id: 'location',
      models: [{ id: 'DeepSeek-V4-Flash-0731', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }],
    }]
    const cap = resolveRuntimeReasoningCapability(groups, 'location', 'DeepSeek-V4-Flash-0731')
    expect(cap.efforts).toEqual(['low'])
    expect(cap.efforts).not.toContain('max')
    expect(cap.efforts).not.toContain('medium')
  })

  it('returns available=false for a found model with no reasoning metadata', () => {
    const groups = [{ id: 'location', models: [{ id: 'plain' }] }]
    expect(resolveRuntimeReasoningCapability(groups, 'location', 'plain')).toEqual<RuntimeReasoningCapability>({
      available: false,
      efforts: [],
      source: 'runtime',
    })
  })

  it('returns unknown for a model missing from the runtime catalog', () => {
    expect(resolveRuntimeReasoningCapability([], 'location', 'nope')).toEqual({
      available: false,
      efforts: [],
      source: 'unknown',
    })
  })

  it('deduplicates effort ids and preserves order', () => {
    const groups = [{
      id: 'p',
      models: [{
        id: 'm',
        reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
      }],
    }]
    expect(resolveRuntimeReasoningCapability(groups, 'p', 'm').efforts).toEqual(['high', 'low'])
  })
})

describe('configured authoring reasoning efforts', () => {
  it('returns undefined for inherit, [] for unsupported, draft efforts for custom', () => {
    expect(configuredReasoningEfforts(draft({ reasoningMode: 'inherit' }))).toBeUndefined()
    expect(configuredReasoningEfforts(draft({ reasoningMode: 'unsupported' }))).toEqual([])
    expect(configuredReasoningEfforts(draft({ reasoningMode: 'custom', efforts: ['low', 'max'] }))).toEqual(['low', 'max'])
  })

  it('allows an empty custom draft as a transient authoring state', () => {
    expect(configuredReasoningEfforts(draft({ reasoningMode: 'custom', efforts: [] }))).toEqual([])
  })
})

describe('authoring vs runtime mismatch', () => {
  it('treats inherit as no mismatch', () => {
    const mismatch = reasoningMismatch(
      draft({ reasoningMode: 'inherit' }),
      { available: true, efforts: ['low'], source: 'runtime' },
    )
    expect(mismatch.mismatch).toBe(false)
  })

  it('reports authoring levels missing from runtime', () => {
    const mismatch = reasoningMismatch(
      draft({ reasoningMode: 'custom', efforts: ['low', 'max'] }),
      { available: true, efforts: ['low'], source: 'runtime' },
    )
    expect(mismatch).toMatchObject({
      mismatch: true,
      authoring: ['low', 'max'],
      runtime: ['low'],
      missing: ['max'],
      unresolved: false,
    })
  })

  it('marks unresolved when the runtime knows the model but exposes no reasoning', () => {
    const mismatch = reasoningMismatch(
      draft({ reasoningMode: 'custom', efforts: ['max'] }),
      { available: false, efforts: [], source: 'runtime' },
    )
    expect(mismatch.mismatch).toBe(true)
    expect(mismatch.unresolved).toBe(true)
    expect(mismatch.missing).toEqual(['max'])
  })
})

describe('unsupported reasoning effort error parsing', () => {
  it('parses the DSH error shape', () => {
    const parsed = parseUnsupportedReasoningEffortError(
      'provider "location" model "DeepSeek-V4-Flash-0731" does not support reasoning effort "max"',
    )
    expect(parsed).toEqual({
      provider: 'location',
      model: 'DeepSeek-V4-Flash-0731',
      effort: 'max',
    })
  })

  it('returns null for unrelated messages', () => {
    expect(parseUnsupportedReasoningEffortError('some other error')).toBeNull()
  })
})
