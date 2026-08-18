import { describe, expect, it } from 'vitest'
import {
  CapabilityValidationError,
  compileCapabilities,
  toReasoningEfforts,
  validateCapabilities,
  type CapabilitiesAuthoringConfig,
} from '../src/compile.ts'

describe('validateCapabilities', () => {
  it('accepts a minimal config', () => {
    expect(() => validateCapabilities({ providers: { acme: { models: { a: {} } } } })).not.toThrow()
  })

  it('rejects invalid input modalities', () => {
    expect(() => validateCapabilities({
      providers: {
        acme: {
          models: {
            a: { input: ['audio'] as never },
          },
        },
      },
    })).toThrow(CapabilityValidationError)
  })

  it('rejects duplicate input modalities', () => {
    expect(() => validateCapabilities({
      providers: {
        acme: {
          models: {
            a: { input: ['text', 'text'] },
          },
        },
      },
    })).toThrow(/duplicated/)
  })

  it('rejects empty reasoning efforts', () => {
    expect(() => validateCapabilities({
      providers: {
        acme: {
          models: {
            a: { reasoning: { efforts: [] } },
          },
        },
      },
    })).toThrow(/non-empty/)
  })

  it('rejects default effort outside declared efforts', () => {
    expect(() => validateCapabilities({
      providers: {
        acme: {
          models: {
            a: { reasoning: { efforts: ['low', 'high'], defaultEffort: 'max' } },
          },
        },
      },
    })).toThrow(/must be one of the declared efforts/)
  })

  it('rejects wire mapping for an undeclared effort', () => {
    expect(() => validateCapabilities({
      providers: {
        acme: {
          models: {
            a: { reasoning: { efforts: ['low'], wire: { max: 'ultra' } } },
          },
        },
      },
    })).toThrow(/not declared/)
  })

  it('rejects per-model default effort that differs from provider default', () => {
    expect(() => validateCapabilities({
      providers: {
        acme: {
          defaults: { reasoning: { efforts: ['low', 'high'], defaultEffort: 'low' } },
          models: {
            a: { reasoning: { efforts: ['low', 'high'], defaultEffort: 'high' } },
          },
        },
      },
    })).toThrow(/no per-model default effort/)
  })
})

describe('toReasoningEfforts', () => {
  it('defaults off to null and other levels to their own id', () => {
    const result = toReasoningEfforts(
      { efforts: ['off', 'low', 'high'] },
      'test',
    )
    expect(result).toEqual({ off: null, low: 'low', high: 'high' })
  })

  it('applies custom wire mapping', () => {
    const result = toReasoningEfforts(
      { efforts: ['off', 'max'], wire: { off: null, max: 'ultra' } },
      'test',
    )
    expect(result).toEqual({ off: null, max: 'ultra' })
  })
})

describe('compileCapabilities', () => {
  it('compiles catalog-route capabilities into modelOverrides', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        openai: {
          defaults: {
            input: ['text'],
            reasoning: { efforts: ['off', 'low', 'medium', 'high'], defaultEffort: 'medium' },
          },
          models: {
            'gpt-5': {
              input: ['text', 'image'],
              reasoning: {
                efforts: ['off', 'low', 'medium', 'high'],
                defaultEffort: 'medium',
                wire: { off: null, low: 'low', medium: 'medium', high: 'high' },
              },
            },
            'gpt-5-mini': {
              reasoning: false,
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.provider).toBe('openai')
    expect(compiled.defaultInput).toEqual(['text'])
    expect(compiled.reasoning).toBe('medium')
    expect(compiled.modelOverrides?.['gpt-5']).toEqual({
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    })
    expect(compiled.modelOverrides?.['gpt-5-mini']).toEqual({
      reasoningEfforts: false,
    })
  })

  it('compiles declared routes into models array', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          models: {
            vision: { input: ['text', 'image'] },
            text: { input: ['text'], reasoning: false },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config, { declaredRoutes: new Set(['acme']) })
    expect(compiled.models).toEqual([
      { id: 'vision', input: ['text', 'image'] },
      { id: 'text', input: ['text'], reasoningEfforts: false },
    ])
    expect(compiled.modelOverrides).toBeUndefined()
  })

  it('keeps no-config behavior unchanged', () => {
    const compiled = compileCapabilities({ providers: { acme: { models: { a: {} } } } })
    expect(compiled[0].modelOverrides?.['a']).toBeUndefined()
  })
})
