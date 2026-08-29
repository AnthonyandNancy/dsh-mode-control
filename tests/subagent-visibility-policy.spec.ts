import { describe, expect, it } from 'vitest'
import {
  detectSubagentCapabilities,
  type SubagentCapabilityInput,
} from '../src/subagent/capabilities.ts'

function input(overrides: Partial<SubagentCapabilityInput> = {}): SubagentCapabilityInput {
  return {
    entryFound: true,
    effectiveVersion: '0.1.1-rc.2',
    ...overrides,
  }
}

describe('subagent visibility policy (entry/schema driven, version advisory)', () => {
  it('hides only when the canonical tool-subagent entry is missing', () => {
    const caps = detectSubagentCapabilities(input({ entryFound: false }))
    expect(caps.visible).toBe(false)
    expect(caps.mode).toBe('unsupported')
  })

  it('shows the panel when the entry exists but the version is unknown', () => {
    const caps = detectSubagentCapabilities(input({ effectiveVersion: undefined }))
    expect(caps.visible).toBe(true)
    expect(caps.supportConfidence).toBe('unverified')
    expect(caps.mode).toBe('legacy-static')
  })

  it('shows the panel for known older versions with a legacy warning', () => {
    for (const version of ['0.1.0-rc.6', '0.1.0-rc.8', '0.1.1-rc.1']) {
      const caps = detectSubagentCapabilities(input({ effectiveVersion: version }))
      expect(caps.visible).toBe(true)
      expect(caps.supportConfidence).toBe('legacy')
    }
  })

  it('marks verified versions as confirmed', () => {
    for (const version of ['0.1.1-rc.2', '0.1.1-rc.3', '0.1.1']) {
      const caps = detectSubagentCapabilities(input({ effectiveVersion: version }))
      expect(caps.visible).toBe(true)
      expect(caps.supportConfidence).toBe('confirmed')
    }
  })

  it('keeps mode strictly schema-driven even when visible', () => {
    const caps = detectSubagentCapabilities(input({
      effectiveVersion: undefined,
      agentOptionsSchemaFields: new Set(['provider', 'model', 'maxTokens', 'reasoningEffort']),
      toolSubagentSchemaFields: new Set(['provider']),
    }))
    expect(caps.visible).toBe(true)
    expect(caps.mode).toBe('legacy-static')
    expect(caps.supportsAgentOptions).toBe(true)
    expect(caps.supportsReasoningEffort).toBe(true)
    expect(caps.supportsNativeSelection).toBe(false)
  })

  it('never fabricates writable fields when no schema surface exists', () => {
    const caps = detectSubagentCapabilities(input({ effectiveVersion: undefined }))
    expect(caps.visible).toBe(true)
    expect(caps.supportsAgentOptions).toBe(true)
    expect(caps.supportsReasoningEffort).toBe(false)
    expect(caps.supportsNativeSelection).toBe(false)
    expect(caps.supportsAllowedModels).toBe(false)
  })
})
