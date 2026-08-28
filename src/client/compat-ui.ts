/**
 * Generic compat field UI built from the metadata registry.
 *
 * Provider JSX and Model JSX both render through these components, so a new
 * compat field only needs a metadata entry + i18n strings — not a second UI
 * implementation.
 */

import { createElement } from 'react'
import type { CompatFieldDefinition } from './compat-fields.ts'
import type { CompatDraftValue } from './compat-state.ts'
import { Dropdown, Field, TextArea, Disclosure } from './ui.ts'

export interface CompatFieldControlProps {
  field: CompatFieldDefinition
  draft: CompatDraftValue
  applicable: boolean
  existing: boolean
  enumOptions?: string[]
  /** `provider` or `model` changes the inherit label (auto / inherit provider). */
  level: 'provider' | 'model'
  t: (key: string) => string
  onChange: (value: CompatDraftValue) => void
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
  const options: Array<{ value: string; label: string }> = [
    { value: '', label: field.key === 'thinkingFormat' ? t('compat.format.auto') : t('compat.auto') },
  ]
  for (const value of schemaOptions ?? []) {
    options.push({ value, label: value })
  }
  return options
}

export function CompatFieldControl(props: CompatFieldControlProps): any {
  const { field, draft, applicable, existing, enumOptions: schemaEnum, level, t, onChange } = props
  const h = createElement
  const description = t(field.descriptionKey)
  const warning = !applicable && existing
    ? h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, t('compat.notApplicableWarning'))
    : null

  let control: any
  if (field.kind === 'boolean') {
    const options = field.optionStyle === 'developer-role'
      ? developerRoleOptions(level, t)
      : booleanOptions(level, t)
    control = h(Dropdown, {
      value: draft.kind === 'boolean' ? draft.mode : 'inherit',
      options,
      onChange: (mode: string) => onChange({ kind: 'boolean', mode: mode as any }),
      placeholder: t('compat.auto'),
      ariaLabel: t(field.labelKey),
    })
  } else if (field.kind === 'enum') {
    control = h(Dropdown, {
      value: draft.kind === 'enum' ? draft.value : '',
      options: enumOptions(field, schemaEnum, t),
      onChange: (value: string) => onChange({ kind: 'enum', value }),
      placeholder: t('compat.auto'),
      ariaLabel: t(field.labelKey),
    })
  } else {
    control = h(TextArea, {
      value: draft.kind === 'json' ? draft.text : '',
      placeholder: '{}',
      ariaLabel: t(field.labelKey),
      onChange: (text: string) => onChange({ kind: 'json', text }),
    })
  }

  return h(Field, { label: t(field.labelKey), description },
    control,
    warning,
  )
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
}

export function CompatGroupSection(props: CompatGroupSectionProps): any {
  const { title, fields, drafts, applicable, existing, enumOptions, level, t, onChange } = props
  const h = createElement
  const visible = fields.filter(field => applicable[field.key] || existing[field.key])
  if (visible.length === 0) return null
  return h('div', { className: 'dsh-mc-card' },
    title ? h('h3', { className: 'dsh-mc-section-title' }, title) : null,
    visible.map(field => h(CompatFieldControl, {
      key: field.key,
      field,
      draft: drafts[field.key] ?? (field.kind === 'boolean'
        ? { kind: 'boolean', mode: 'inherit' }
        : field.kind === 'enum'
          ? { kind: 'enum', value: '' }
          : { kind: 'json', text: '' }),
      applicable: applicable[field.key] ?? false,
      existing: existing[field.key] ?? false,
      enumOptions: enumOptions?.[field.key],
      level,
      t,
      onChange: (value: CompatDraftValue) => onChange(field.key, value),
    })),
  )
}

export interface CompatDisclosureProps {
  summary: string
  fields: CompatFieldDefinition[]
  drafts: Record<string, CompatDraftValue>
  applicable: Record<string, boolean>
  existing: Record<string, boolean>
  enumOptions?: Record<string, string[]>
  level: 'provider' | 'model'
  t: (key: string) => string
  onChange: (key: string, value: CompatDraftValue) => void
}

export function CompatDisclosure(props: CompatDisclosureProps): any {
  const { summary, fields, drafts, applicable, existing, enumOptions, level, t, onChange } = props
  const h = createElement
  const visible = fields.filter(field => applicable[field.key] || existing[field.key])
  if (visible.length === 0) return null
  return h(Disclosure, { summary },
    h('div', { className: 'dsh-mc-disclosure-fields' },
      visible.map(field => h(CompatFieldControl, {
        key: field.key,
        field,
        draft: drafts[field.key] ?? (field.kind === 'boolean'
          ? { kind: 'boolean', mode: 'inherit' }
          : field.kind === 'enum'
            ? { kind: 'enum', value: '' }
            : { kind: 'json', text: '' }),
        applicable: applicable[field.key] ?? false,
        existing: existing[field.key] ?? false,
        enumOptions: enumOptions?.[field.key],
        level,
        t,
        onChange: (value: CompatDraftValue) => onChange(field.key, value),
      })),
    ),
  )
}
