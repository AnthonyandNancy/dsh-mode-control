/**
 * Small shared UI primitives for the capability editor.
 *
 * Everything uses DSH semantic tokens and the same heights/radii as the
 * existing plugin UI — no second component system, no hard-coded palette.
 */

import { createElement, useEffect, useRef, useState } from 'react'

export function Chip(props: any): any {
  const { label, active, onClick } = props
  return createElement('button', {
    type: 'button',
    className: `dsh-mc-chip${active ? ' dsh-mc-chip-active' : ''}`,
    onClick,
  }, label)
}

export function Dropdown(props: any): any {
  const { value, options, onChange, placeholder, ariaLabel, disabled } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const selected = options.find((option: any) => option.value === value)
  return createElement('div', { ref, className: 'dsh-mc-dropdown' },
    createElement('button', {
      type: 'button',
      className: 'dsh-mc-dropdown-button',
      'aria-label': ariaLabel,
      'aria-expanded': open,
      disabled,
      onClick: () => setOpen(!open),
    },
      createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected?.label ?? placeholder ?? ''),
      createElement('span', { style: { flex: 'none', opacity: 0.7 } }, '▾'),
    ),
    open ? createElement('div', { className: 'dsh-mc-dropdown-list' },
      options.map((option: any) => createElement('button', {
        key: option.value,
        type: 'button',
        className: 'dsh-mc-dropdown-item',
        style: option.value === value ? { fontWeight: 600 } : undefined,
        onClick: () => {
          onChange(option.value)
          setOpen(false)
        },
      }, option.label)),
    ) : null,
  )
}

export function TextInput(props: any): any {
  const { value, onChange, placeholder, ariaLabel, className } = props
  return createElement('input', {
    className: className ?? 'dsh-mc-input',
    value,
    placeholder,
    'aria-label': ariaLabel,
    onChange: (event: any) => onChange(event.target.value),
  })
}

export function NumberInput(props: any): any {
  const { value, onChange, placeholder, ariaLabel } = props
  return createElement('input', {
    className: 'dsh-mc-input',
    type: 'number',
    value,
    placeholder,
    'aria-label': ariaLabel,
    onChange: (event: any) => onChange(event.target.value),
  })
}

export function TextArea(props: any): any {
  const { value, onChange, placeholder, ariaLabel, rows } = props
  return createElement('textarea', {
    className: 'dsh-mc-textarea',
    rows: rows ?? 4,
    value,
    placeholder,
    'aria-label': ariaLabel,
    spellCheck: false,
    onChange: (event: any) => onChange(event.target.value),
  })
}

export function Field(props: any): any {
  const { label, description, children } = props
  const h = createElement
  return h('div', { className: 'dsh-mc-field' },
    label ? h('span', { className: 'dsh-mc-field-label' }, label) : null,
    children,
    description ? h('p', { className: 'dsh-mc-muted', style: { margin: 0 } }, description) : null,
  )
}

export function Disclosure(props: any): any {
  const { summary, children, defaultOpen } = props
  return createElement('details', { className: 'dsh-mc-disclosure', open: defaultOpen ? true : undefined },
    createElement('summary', { className: 'dsh-mc-disclosure-summary' }, summary),
    createElement('div', { className: 'dsh-mc-disclosure-body' }, children),
  )
}
