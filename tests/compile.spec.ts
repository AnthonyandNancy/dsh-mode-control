import { describe, expect, it } from 'vitest'
import {
  CapabilityValidationError,
  compileCapabilities,
  toAnthropicReasoningEfforts,
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

  it('preserves forceAdaptiveThinking true through provider and model compile', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          defaults: {
            reasoning: {
              efforts: ['low', 'high'],
              defaultEffort: 'high',
              compat: { forceAdaptiveThinking: true },
            },
          },
          models: {
            foo: {
              reasoning: {
                efforts: ['low', 'high'],
                defaultEffort: 'high',
                compat: { supportsStrictTools: true, forceAdaptiveThinking: true },
              },
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.compat).toEqual({ forceAdaptiveThinking: true })
    expect(compiled.modelOverrides?.foo?.compat).toEqual({
      supportsStrictTools: true,
      forceAdaptiveThinking: true,
    })
  })

  it('preserves forceAdaptiveThinking false through provider and model compile', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          defaults: {
            reasoning: {
              efforts: ['low', 'high'],
              defaultEffort: 'high',
              compat: { forceAdaptiveThinking: false },
            },
          },
          models: {
            foo: {
              reasoning: {
                efforts: ['low', 'high'],
                defaultEffort: 'high',
                compat: { forceAdaptiveThinking: false },
              },
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.compat).toEqual({ forceAdaptiveThinking: false })
    expect(compiled.modelOverrides?.foo?.compat).toEqual({ forceAdaptiveThinking: false })
  })

  it('does not synthesize forceAdaptiveThinking when it is unset', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          defaults: {
            reasoning: {
              efforts: ['low', 'high'],
              defaultEffort: 'high',
              compat: { supportsTemperature: false },
            },
          },
          models: {
            foo: {
              reasoning: {
                efforts: ['low', 'high'],
                defaultEffort: 'high',
                compat: { supportsStrictTools: true },
              },
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.compat).toEqual({ supportsTemperature: false })
    expect(compiled.modelOverrides?.foo?.compat).toEqual({ supportsStrictTools: true })
    expect('forceAdaptiveThinking' in (compiled.compat ?? {})).toBe(false)
    expect('forceAdaptiveThinking' in (compiled.modelOverrides?.foo?.compat ?? {})).toBe(false)
  })

  it('keeps other compat fields when forceAdaptiveThinking is present', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          models: {
            foo: {
              reasoning: {
                efforts: ['low'],
                compat: {
                  supportsTemperature: false,
                  supportsStrictTools: true,
                  forceAdaptiveThinking: true,
                },
              },
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.modelOverrides?.foo?.compat).toEqual({
      supportsTemperature: false,
      supportsStrictTools: true,
      forceAdaptiveThinking: true,
    })
  })
})

describe('compat source coverage', () => {
  it('preserves provider top-level compat', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          compat: { forceAdaptiveThinking: false },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.compat).toEqual({ forceAdaptiveThinking: false })
  })

  it('preserves provider defaults compat', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          defaults: {
            compat: { supportsStrictTools: true, forceAdaptiveThinking: true },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.compat).toEqual({ supportsStrictTools: true, forceAdaptiveThinking: true })
  })

  it('preserves model top-level compat alongside reasoning compat', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          models: {
            foo: {
              compat: { forceAdaptiveThinking: true },
              reasoning: {
                efforts: ['low'],
                compat: { supportsStrictTools: true },
              },
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.modelOverrides?.foo?.compat).toEqual({
      supportsStrictTools: true,
      forceAdaptiveThinking: true,
    })
  })

  it('does not synthesize forceAdaptiveThinking from absent top-level compat', () => {
    const config: CapabilitiesAuthoringConfig = {
      providers: {
        acme: {
          compat: { supportsTemperature: false },
          models: {
            foo: {
              compat: { supportsStrictTools: true },
            },
          },
        },
      },
    }
    const [compiled] = compileCapabilities(config)
    expect(compiled.compat).toEqual({ supportsTemperature: false })
    expect(compiled.modelOverrides?.foo?.compat).toEqual({ supportsStrictTools: true })
    expect('forceAdaptiveThinking' in (compiled.compat ?? {})).toBe(false)
    expect('forceAdaptiveThinking' in (compiled.modelOverrides?.foo?.compat ?? {})).toBe(false)
  })
})

describe('toAnthropicReasoningEfforts', () => {
  it('maps minimal to low and keeps other levels', () => {
    expect(toAnthropicReasoningEfforts(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])).toEqual({
      off: null,
      minimal: 'low',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })
})
