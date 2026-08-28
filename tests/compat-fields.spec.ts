import { describe, expect, it } from 'vitest'
import {
  COMPAT_FIELDS,
  COMPAT_FIELD_BY_KEY,
  isCompatFieldApplicable,
  type CompatFieldDefinition,
} from '../src/client/compat-fields.ts'

describe('compat metadata registry', () => {
  it('covers every current pi-ai compat field', () => {
    const keys = COMPAT_FIELDS.map(field => field.key)
    for (const key of [
      'supportsStore',
      'supportsDeveloperRole',
      'supportsReasoningEffort',
      'supportsUsageInStreaming',
      'supportsFinishReason',
      'maxTokensField',
      'requiresToolResultName',
      'requiresAssistantAfterToolResult',
      'requiresThinkingAsText',
      'requiresReasoningContentOnAssistantMessages',
      'thinkingFormat',
      'chatTemplateKwargs',
      'chatTemplateArgs',
      'supportsThinkingTokenBudget',
      'supportsStrictMode',
      'cacheControlFormat',
      'supportsLongCacheRetention',
      'supportsEagerToolInputStreaming',
      'supportsCacheControlOnTools',
      'supportsTemperature',
      'forceAdaptiveThinking',
      'allowEmptySignature',
      'supportsStrictTools',
    ]) {
      expect(keys).toContain(key)
    }
  })

  it('has unique keys and stable label/description keys', () => {
    const seen = new Set<string>()
    for (const field of COMPAT_FIELDS) {
      expect(seen.has(field.key)).toBe(false)
      seen.add(field.key)
      expect(field.labelKey.length).toBeGreaterThan(0)
      expect(field.descriptionKey.length).toBeGreaterThan(0)
      expect(['boolean', 'enum', 'json']).toContain(field.kind)
      expect(['common', 'openai', 'anthropic', 'advanced']).toContain(field.group)
    }
    expect(COMPAT_FIELD_BY_KEY.size).toBe(COMPAT_FIELDS.length)
  })

  it('keeps the developer-role special UI marker', () => {
    const developerRole = COMPAT_FIELD_BY_KEY.get('supportsDeveloperRole')
    expect(developerRole?.optionStyle).toBe('developer-role')
  })

  it('marks advanced fields with the advanced flag', () => {
    const advanced = COMPAT_FIELDS.filter(field => field.advanced)
    expect(advanced.length).toBeGreaterThan(0)
    expect(advanced.map(field => field.key)).toEqual(expect.arrayContaining([
      'supportsUsageInStreaming',
      'requiresToolResultName',
      'requiresAssistantAfterToolResult',
      'requiresThinkingAsText',
      'chatTemplateKwargs',
      'chatTemplateArgs',
      'cacheControlFormat',
      'supportsLongCacheRetention',
    ]))
  })
})

describe('protocol applicability', () => {
  it('applies OpenAI completions fields only to that protocol', () => {
    expect(isCompatFieldApplicable(
      COMPAT_FIELD_BY_KEY.get('supportsStore')!,
      ['openai-completions'],
    )).toBe(true)
    expect(isCompatFieldApplicable(
      COMPAT_FIELD_BY_KEY.get('supportsStore')!,
      ['anthropic-messages'],
    )).toBe(false)
  })

  it('applies developer role to completions and all three responses protocols', () => {
    const def = COMPAT_FIELD_BY_KEY.get('supportsDeveloperRole')!
    for (const protocol of ['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses']) {
      expect(isCompatFieldApplicable(def, [protocol])).toBe(true)
    }
    expect(isCompatFieldApplicable(def, ['anthropic-messages'])).toBe(false)
  })

  it('applies Anthropic fields to anthropic-messages', () => {
    const def = COMPAT_FIELD_BY_KEY.get('forceAdaptiveThinking')!
    expect(isCompatFieldApplicable(def, ['anthropic-messages'])).toBe(true)
    expect(isCompatFieldApplicable(def, ['openai-completions'])).toBe(false)
  })

  it('applies strict mode to completions, responses, and bedrock', () => {
    const def = COMPAT_FIELD_BY_KEY.get('supportsStrictMode')!
    for (const protocol of ['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses', 'bedrock-converse-stream']) {
      expect(isCompatFieldApplicable(def, [protocol])).toBe(true)
    }
    expect(isCompatFieldApplicable(def, ['anthropic-messages'])).toBe(false)
  })

  it('applies long cache retention to completions, responses, and anthropic', () => {
    const def = COMPAT_FIELD_BY_KEY.get('supportsLongCacheRetention')!
    expect(isCompatFieldApplicable(def, ['openai-completions'])).toBe(true)
    expect(isCompatFieldApplicable(def, ['openai-responses'])).toBe(true)
    expect(isCompatFieldApplicable(def, ['anthropic-messages'])).toBe(true)
    expect(isCompatFieldApplicable(def, ['bedrock-converse-stream'])).toBe(false)
  })

  it('returns false for fields with no protocol metadata (future-only fields)', () => {
    const def = COMPAT_FIELD_BY_KEY.get('supportsThinkingTokenBudget')!
    expect(isCompatFieldApplicable(def, ['openai-completions'])).toBe(false)
  })
})

describe('registry typing', () => {
  it('every definition satisfies the interface', () => {
    const fields: CompatFieldDefinition[] = COMPAT_FIELDS
    expect(fields.every(field => field.key.length > 0)).toBe(true)
  })
})
