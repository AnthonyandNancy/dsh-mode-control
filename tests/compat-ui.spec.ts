import { describe, expect, it } from 'vitest'
import { COMPAT_FIELDS, type CompatFieldDefinition } from '../src/client/compat-fields.ts'
import { compatSelectState } from '../src/client/compat-ui.ts'

const booleanField: CompatFieldDefinition = COMPAT_FIELDS.find(field => field.key === 'supportsStore')!
const enumField: CompatFieldDefinition = COMPAT_FIELDS.find(field => field.key === 'maxTokensField')!

describe('compat select state for unsupported fields', () => {
  it('keeps the full option list when applicable', () => {
    const state = compatSelectState(booleanField, true, undefined, 'inherit', 'provider', key => key)
    expect(state.disabled).toBe(false)
    expect(state.options.map(option => option.value)).toEqual(['inherit', 'enabled', 'disabled'])
  })

  it('is disabled and shows only the current value when unsupported', () => {
    const state = compatSelectState(booleanField, false, undefined, 'enabled', 'provider', key => key)
    expect(state.disabled).toBe(true)
    expect(state.options).toEqual([{ value: 'enabled', label: 'compat.enabled' }])
  })

  it('is disabled with the inherit option when the unsupported value is already inherit', () => {
    const state = compatSelectState(booleanField, false, undefined, 'inherit', 'provider', key => key)
    expect(state.disabled).toBe(true)
    expect(state.options.map(option => option.value)).toEqual(['inherit'])
  })

  it('is disabled and shows only the persisted enum value when unsupported', () => {
    const state = compatSelectState(enumField, false, ['max_tokens', 'max_completion_tokens'], 'max_tokens', 'provider', key => key)
    expect(state.disabled).toBe(true)
    expect(state.options).toEqual([{ value: 'max_tokens', label: 'max_tokens' }])
  })

  it('is disabled with the inherit/auto option when there is no persisted enum value', () => {
    const state = compatSelectState(enumField, false, ['max_tokens'], '', 'provider', key => key)
    expect(state.disabled).toBe(true)
    expect(state.options).toEqual([{ value: '', label: 'compat.auto' }])
  })
})
