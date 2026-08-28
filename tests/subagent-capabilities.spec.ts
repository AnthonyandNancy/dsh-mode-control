import { describe, expect, it } from 'vitest'
import {
  detectSubagentCapabilities,
  type SubagentCapabilityInput,
} from '../src/subagent/capabilities.ts'

function input(overrides: Partial<SubagentCapabilityInput> = {}): SubagentCapabilityInput {
  return {
    effectiveVersion: '0.1.1-rc.2',
    ...overrides,
  }
}

describe('detectSubagentCapabilities', () => {
  it('hides everything below 0.1.1-rc.2', () => {
    for (const version of ['0.1.0-rc.6', '0.1.0-rc.8', '0.1.1-rc.1']) {
      const caps = detectSubagentCapabilities(input({ effectiveVersion: version }))
      expect(caps.visible).toBe(false)
      expect(caps.mode).toBe('unsupported')
      expect(caps.supportsAgentOptions).toBe(false)
      expect(caps.supportsReasoningEffort).toBe(false)
      expect(caps.supportsNativeSelection).toBe(false)
    }
  })

  it('fails closed when the subagent version is missing', () => {
    const caps = detectSubagentCapabilities(input({ effectiveVersion: undefined }))
    expect(caps.visible).toBe(false)
    expect(caps.mode).toBe('unsupported')
  })

  it('enters legacy-static for rc.2 without native selection', () => {
    const caps = detectSubagentCapabilities(input())
    expect(caps.visible).toBe(true)
    expect(caps.mode).toBe('legacy-static')
    expect(caps.supportsAgentOptions).toBe(true)
    expect(caps.supportsReasoningEffort).toBe(false)
    expect(caps.supportsNativeSelection).toBe(false)
    expect(caps.supportsAllowedModels).toBe(false)
  })

  it('exposes reasoningEffort only when agentOptions schema declares it', () => {
    const caps = detectSubagentCapabilities(input({
      agentOptionsSchemaFields: new Set(['provider', 'model', 'maxTokens', 'reasoningEffort']),
    }))
    expect(caps.mode).toBe('legacy-static')
    expect(caps.supportsReasoningEffort).toBe(true)
  })

  it('enters native-selection only when every official surface exists', () => {
    const caps = detectSubagentCapabilities(input({
      toolSubagentSchemaFields: new Set(['provider', 'agentOptions', 'modelSelectionSettings']),
      modelSelectionNamespacePresent: true,
      modelSelectionNamespaceFields: new Set(['enabled', 'allowedModels']),
    }))
    expect(caps.mode).toBe('native-selection')
    expect(caps.supportsNativeSelection).toBe(true)
    expect(caps.supportsAllowedModels).toBe(true)
  })

  it('stays legacy when modelSelectionSettings is missing even if namespace exists', () => {
    const caps = detectSubagentCapabilities(input({
      toolSubagentSchemaFields: new Set(['provider', 'agentOptions']),
      modelSelectionNamespacePresent: true,
      modelSelectionNamespaceFields: new Set(['enabled', 'allowedModels']),
    }))
    expect(caps.mode).toBe('legacy-static')
    expect(caps.supportsNativeSelection).toBe(false)
  })

  it('stays legacy when the namespace is missing even if tool schema has modelSelectionSettings', () => {
    const caps = detectSubagentCapabilities(input({
      toolSubagentSchemaFields: new Set(['provider', 'modelSelectionSettings']),
      modelSelectionNamespacePresent: false,
    }))
    expect(caps.mode).toBe('legacy-static')
  })

  it('requires both enabled and allowedModels in the namespace schema', () => {
    const caps = detectSubagentCapabilities(input({
      toolSubagentSchemaFields: new Set(['modelSelectionSettings']),
      modelSelectionNamespacePresent: true,
      modelSelectionNamespaceFields: new Set(['enabled']),
    }))
    expect(caps.mode).toBe('legacy-static')
  })

  it('honors a backend that does not accept agentOptions', () => {
    const caps = detectSubagentCapabilities(input({ supportsAgentOptions: false }))
    expect(caps.visible).toBe(true)
    expect(caps.mode).toBe('legacy-static')
    expect(caps.supportsAgentOptions).toBe(false)
  })
})
