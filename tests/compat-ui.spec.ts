import { describe, expect, it } from 'vitest'
import { COMPAT_FIELDS, type CompatFieldDefinition } from '../src/client/compat-fields.ts'
import { CompatDisclosure, CompatFieldControl, CompatGroupSection, compatSelectState } from '../src/client/compat-ui.ts'
import { DisclosureRow, SettingRow } from '../src/client/ui.ts'

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


describe('compat disclosure hierarchy variants', () => {
  it('renders CompatDisclosure as a group by default', () => {
    const booleanField = COMPAT_FIELDS.find(field => field.key === 'supportsStore')!
    const element = CompatDisclosure({
      summary: 'Advanced',
      fields: [booleanField],
      drafts: {},
      applicable: { supportsStore: true },
      existing: {},
      level: 'model',
      t: key => key,
      onChange: () => undefined,
    })
    expect(element.type).toBe(DisclosureRow)
    expect(element.props.variant).toBe('group')
    expect(element.props.children.props.className).toContain('dsh-mc-compat-group-content')
  })

  it('passes an explicit section variant through CompatDisclosure', () => {
    const booleanField = COMPAT_FIELDS.find(field => field.key === 'supportsStore')!
    const element = CompatDisclosure({
      summary: 'Overrides',
      variant: 'section',
      fields: [booleanField],
      drafts: {},
      applicable: { supportsStore: true },
      existing: {},
      level: 'model',
      t: key => key,
      onChange: () => undefined,
    })
    expect(element.props.variant).toBe('section')
  })

  it('renders JSON compat fields as field-level disclosures', () => {
    const jsonField = COMPAT_FIELDS.find(field => field.kind === 'json')!
    const element = CompatFieldControl({
      field: jsonField,
      draft: { kind: 'json', text: '' },
      applicable: true,
      existing: false,
      level: 'model',
      t: key => key,
      onChange: () => undefined,
    })
    expect(element.type).toBe(DisclosureRow)
    expect(element.props.variant).toBe('field')
  })

  it('keeps ordinary compat descriptions as help tooltips instead of inline text', () => {
    const booleanField = COMPAT_FIELDS.find(field => field.key === 'supportsStore')!
    const element = CompatFieldControl({
      field: booleanField,
      draft: { kind: 'boolean', mode: 'inherit' },
      applicable: true,
      existing: false,
      level: 'model',
      t: key => key,
      onChange: () => undefined,
    })
    expect(element.type).toBe(SettingRow)
    expect(element.props.label).toBe('compat.supportsStore.label')
    expect(element.props.help).toBe('compat.supportsStore.description')
    expect(element.props.description).toBeUndefined()
  })

  it('still shows inline description warning when a not-applicable override exists', () => {
    const booleanField = COMPAT_FIELDS.find(field => field.key === 'supportsStore')!
    const element = CompatFieldControl({
      field: booleanField,
      draft: { kind: 'boolean', mode: 'enabled' },
      applicable: false,
      existing: true,
      level: 'model',
      t: key => key,
      onChange: () => undefined,
    })
    expect(element.props.description).toBe('compat.supportsStore.description')
    expect(element.props.warning).toBe('compat.notApplicableWarning')
  })

  it('uses a 5-level group heading instead of an h3 section-title inside CompatGroupSection', () => {
    const booleanField = COMPAT_FIELDS.find(field => field.key === 'supportsStore')!
    const element = CompatGroupSection({
      title: 'Common group',
      fields: [booleanField],
      drafts: {},
      applicable: { supportsStore: true },
      existing: { supportsStore: false },
      level: 'model',
      t: key => key,
      onChange: () => undefined,
    })
    const titleElement = element.props.children[0]
    expect(titleElement.type).toBe('div')
    expect(titleElement.props.className).toContain('dsh-mc-compat-group-title')
    expect(titleElement.props.className).not.toContain('dsh-mc-section-title')
    expect(titleElement.props.role).toBe('heading')
    expect(titleElement.props['aria-level']).toBe(5)
  })
})
