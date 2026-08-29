import { describe, expect, it } from 'vitest'
import { COMPAT_FIELDS } from '../src/client/compat-fields.ts'
import { en, zh } from '../src/client/index.ts'

describe('compat locale coverage', () => {
  it('has label and description translations for every COMPAT_FIELDS entry in zh and en', () => {
    for (const field of COMPAT_FIELDS) {
      expect(zh[field.labelKey], field.labelKey).toBeDefined()
      expect(zh[field.descriptionKey], field.descriptionKey).toBeDefined()
      expect(en[field.labelKey], field.labelKey).toBeDefined()
      expect(en[field.descriptionKey], field.descriptionKey).toBeDefined()
      // Never fall back to showing the raw registry key in the UI.
      expect(zh[field.labelKey]).not.toBe(field.labelKey)
      expect(zh[field.descriptionKey]).not.toBe(field.descriptionKey)
      expect(en[field.labelKey]).not.toBe(field.labelKey)
      expect(en[field.descriptionKey]).not.toBe(field.descriptionKey)
    }
  })

  it('uses the registry keys for the three previously-mismatched Anthropic fields', () => {
    expect(zh['compat.supportsEagerToolInputStreaming.label']).toBe('Tool 输入流式预取')
    expect(zh['compat.supportsEagerToolInputStreaming.description']).toBeDefined()
    expect(zh['compat.supportsCacheControlOnTools.label']).toBe('Tool Cache Control')
    expect(zh['compat.supportsCacheControlOnTools.description']).toBeDefined()
    expect(zh['compat.supportsTemperature.label']).toBe('Temperature 参数')
    expect(zh['compat.supportsTemperature.description']).toBeDefined()

    expect(en['compat.supportsEagerToolInputStreaming.label']).toBe('Eager tool input streaming')
    expect(en['compat.supportsEagerToolInputStreaming.description']).toBeDefined()
    expect(en['compat.supportsCacheControlOnTools.label']).toBe('Cache control on tools')
    expect(en['compat.supportsCacheControlOnTools.description']).toBeDefined()
    expect(en['compat.supportsTemperature.label']).toBe('Temperature parameter')
    expect(en['compat.supportsTemperature.description']).toBeDefined()
  })

  it('no longer ships the old misaligned compat keys', () => {
    expect(zh['compat.eagerToolInput.label']).toBeUndefined()
    expect(zh['compat.cacheControlOnTools.label']).toBeUndefined()
    expect(zh['compat.temperature.label']).toBeUndefined()
    expect(en['compat.eagerToolInput.label']).toBeUndefined()
    expect(en['compat.cacheControlOnTools.label']).toBeUndefined()
    expect(en['compat.temperature.label']).toBeUndefined()
  })
})
