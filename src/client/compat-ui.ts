import { createElement } from 'react'
import type { CompatFieldDefinition } from './compat-fields.ts'
import type { CompatDraftValue } from './compat-state.ts'
import { CompactSelect, DisclosureRow, SettingRow, TextArea, type SettingRowDensity, type UiDepth } from './ui.ts'

export interface CompatFieldControlProps {
  field: CompatFieldDefinition
  draft: CompatDraftValue
  applicable: boolean
  existing: boolean
  enumOptions?: string[]
  level: 'provider' | 'model'
  t: (key: string) => string
  onChange: (value: CompatDraftValue) => void
  depth?: UiDepth
  density?: SettingRowDensity
}

function booleanOptions(level: 'provider' | 'model', t: (key: string) => string): Array<{ value: string; label: string }> {
  if (level === 'provider') {
    return [
      { value: 'inherit', label: t('compat.providerAuto') },
      { value: 'enabled', label: t('compat.enabled') },
      { value: 'disabled', label: t('compat.disabled') },
    ]
  }
  return [
    { value: 'inherit', label: t('compat.modelInheritProvider') },
    { value: 'enabled', label: t('compat.enabled') },
    { value: 'disabled', label: t('compat.disabled') },
  ]
}

function developerRoleOptions(level: 'provider' | 'model', t: (key: string) => string): Array<{ value: string; label: string }> {
  return [
    { value: 'inherit', label: level === 'provider' ? t('compat.role.auto') : t('compat.role.inheritProvider') },
    { value: 'enabled', label: t('compat.role.developer') },
    { value: 'disabled', label: t('compat.role.system') },
  ]
}

function enumOptions(
  field: CompatFieldDefinition,
  schemaOptions: string[] | undefined,
  t: (key: string) => string,
): Array<{ value: string; label: string }> {
  return [
    { value: '', label: field.key === 'thinkingFormat' ? t('compat.format.auto') : t('compat.auto') },
    ...(schemaOptions ?? []).map(value => ({ value, label: value })),
  ]
}

function defaultDraft(field: CompatFieldDefinition): CompatDraftValue {
  if (field.kind === 'boolean') return { kind: 'boolean', mode: 'inherit' }
  if (field.kind === 'enum') return { kind: 'enum', value: '' }
  return { kind: 'json', text: '' }
}

export interface CompatSelectState {
  options: Array<{ value: string; label: string }>
  disabled: boolean
}

/**
 * Unsupported boolean/enum compat controls are clear-only: the select is
 * disabled and shows only the current persisted value (or nothing), and a
 * separate clear action produces the exact unset. No new unsupported value can
 * be written.
 */
export function compatSelectState(
  field: CompatFieldDefinition,
  applicable: boolean,
  schemaEnum: string[] | undefined,
  value: string,
  level: 'provider' | 'model',
  t: (key: string) => string,
): CompatSelectState {
  const all = field.kind === 'boolean'
    ? field.optionStyle === 'developer-role'
      ? developerRoleOptions(level, t)
      : booleanOptions(level, t)
    : enumOptions(field, schemaEnum, t)
  if (applicable) return { options: all, disabled: false }
  const current = all.find(option => option.value === value)
  return { options: current ? [current] : [], disabled: true }
}

export function CompatFieldControl(props: CompatFieldControlProps): any {
  const { field, draft, applicable, existing, enumOptions: schemaEnum, level, t, onChange } = props
  const h = createElement
  const warning = !applicable && existing ? t('compat.notApplicableWarning') : undefined
  const label = t(field.labelKey)
  const description = t(field.descriptionKey)
  const depth = props.depth ?? 0
  const density = props.density ?? 'nested'

  if (field.kind === 'json') {
    const text = draft.kind === 'json' ? draft.text : ''
    return h(DisclosureRow, {
      summary: label,
      value: text.trim() === '' ? t('compat.notConfigured') : t('compat.configured'),
      title: description,
      description,
      variant: 'field',
      depth,
    }, h('div', { className: 'dsh-mc-json-editor' },
      warning ? h('p', { className: 'dsh-mc-setting-warning' }, warning) : null,
      h(TextArea, {
        value: text,
        placeholder: '{}',
        ariaLabel: label,
        onChange: (next: string) => onChange({ kind: 'json', text: next }),
         disabled: !applicable,
       }),
       !applicable ? h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-dense', onClick: () => onChange({ kind: 'json', text: '' }) }, t('compat.clearOverride')) : null,
    ))
  }

  const value = field.kind === 'boolean'
    ? draft.kind === 'boolean' ? draft.mode : 'inherit'
    : draft.kind === 'enum' ? draft.value : ''
  const selectState = compatSelectState(field, applicable, schemaEnum, value, level, t)
  return h(SettingRow, {
    label,
    help: description,
    description: warning ? description : undefined,
    warning,
    depth,
    density,
    control: h('div', { className: 'dsh-mc-compat-control' },
      h(CompactSelect, {
        value,
        options: selectState.options,
        disabled: selectState.disabled,
        onChange: (next: string) => onChange(field.kind === 'boolean'
          ? { kind: 'boolean', mode: next as 'inherit' | 'enabled' | 'disabled' }
          : { kind: 'enum', value: next }),
        placeholder: t('compat.auto'),
        ariaLabel: label,
      }),
      !applicable && existing
        ? h('button', { type: 'button', className: 'dsh-mc-button dsh-mc-button-dense', onClick: () => onChange(field.kind === 'boolean'
            ? { kind: 'boolean', mode: 'inherit' }
            : { kind: 'enum', value: '' }) }, t('compat.clearOverride'))
        : null,
    ),
  })
}

export interface CompatGroupSectionProps {
  title?: string
  fields: CompatFieldDefinition[]
  drafts: Record<string, CompatDraftValue>
  applicable: Record<string, boolean>
  existing: Record<string, boolean>
  enumOptions?: Record<string, string[]>
  level: 'provider' | 'model'
  t: (key: string) => string
  onChange: (key: string, value: CompatDraftValue) => void
  depth?: UiDepth
  fieldDepth?: UiDepth
}

export function CompatGroupSection(props: CompatGroupSectionProps): any {
  const { title, fields, drafts, applicable, existing, enumOptions: enumValues, level, t, onChange } = props
  const h = createElement
  const depth = props.depth ?? 0
  const fieldDepth = props.fieldDepth ?? 0
  const visible = fields.filter(field => applicable[field.key] || existing[field.key])
  if (visible.length === 0) return null
  return h('div', { className: `dsh-mc-compat-group dsh-mc-depth-${depth}` },
    title ? h('div', { className: `dsh-mc-compat-group-title dsh-mc-depth-${depth}`, role: 'heading', 'aria-level': 5 }, title) : null,
    visible.map(field => h(CompatFieldControl, {
      key: field.key,
      field,
      draft: drafts[field.key] ?? defaultDraft(field),
      applicable: applicable[field.key] ?? false,
      existing: existing[field.key] ?? false,
      enumOptions: enumValues?.[field.key],
      level,
      t,
      onChange: (value: CompatDraftValue) => onChange(field.key, value),
      depth: fieldDepth,
      density: 'nested',
    })),
  )
}

export interface CompatDisclosureProps extends CompatGroupSectionProps {
  summary: string
  variant?: 'section' | 'group'
}

export function CompatDisclosure(props: CompatDisclosureProps): any {
  const { summary, fields, drafts, applicable, existing, enumOptions: enumValues, level, t, onChange, variant } = props
  const h = createElement
  const depth = props.depth ?? 0
  const fieldDepth = props.fieldDepth ?? 0
  const visible = fields.filter(field => applicable[field.key] || existing[field.key])
  if (visible.length === 0) return null
  return h(DisclosureRow, { summary, variant: variant ?? 'group', depth },
    h('div', { className: 'dsh-mc-disclosure-fields dsh-mc-compat-group-content' },
      visible.map(field => h(CompatFieldControl, {
        key: field.key,
        field,
        draft: drafts[field.key] ?? defaultDraft(field),
        applicable: applicable[field.key] ?? false,
        existing: existing[field.key] ?? false,
        enumOptions: enumValues?.[field.key],
        level,
        t,
        onChange: (value: CompatDraftValue) => onChange(field.key, value),
        depth: fieldDepth,
        density: 'nested',
      })),
    ),
  )
}
