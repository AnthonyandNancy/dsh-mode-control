import { createElement, useEffect, useId, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react'

export function ChevronDownIcon(props: { open?: boolean }): any {
  return createElement('svg', { className: `dsh-mc-icon${props.open ? ' dsh-mc-icon-open' : ''}`, width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true },
    createElement('path', { d: 'M3 5.25 7 9l4-3.75', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

export function ChevronRightIcon(): any {
  return createElement('svg', { className: 'dsh-mc-icon', width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true },
    createElement('path', { d: 'm5.25 3 3.75 4-3.75 4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

export function CheckIcon(): any {
  return createElement('svg', { className: 'dsh-mc-icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    createElement('path', { d: 'm3.25 8.25 3 3 6.5-6.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

export function Chip(props: any): any {
  const { label, active, onClick } = props
  return createElement('button', {
    type: 'button',
    className: `dsh-mc-chip${active ? ' dsh-mc-chip-active' : ''}`,
    'aria-pressed': active,
    onClick,
  }, label)
}

export interface SettingRowProps {
  label: string
  description?: string
  control: any
  warning?: any
  title?: string
  className?: string
}

export function SettingRow(props: SettingRowProps): any {
  const h = createElement
  return h('div', { className: `dsh-mc-setting-row${props.className ? ` ${props.className}` : ''}`, title: props.title },
    h('div', { className: 'dsh-mc-setting-label-block' },
      h('span', { className: 'dsh-mc-setting-label' }, props.label),
      props.description ? h('span', { className: 'dsh-mc-setting-description' }, props.description) : null,
      props.warning ? h('span', { className: 'dsh-mc-setting-warning' }, props.warning) : null,
    ),
    h('div', { className: 'dsh-mc-setting-control' }, props.control),
  )
}

export interface PanelProps {
  title: string
  action?: any
  caption?: any
  children?: any
  className?: string
}

/** Lightweight top-level surface: one Panel per main module. */
export function Panel(props: PanelProps): any {
  const h = createElement
  return h('section', { className: `dsh-mc-panel${props.className ? ` ${props.className}` : ''}` },
    h('div', { className: 'dsh-mc-panel-heading' },
      h('h3', { className: 'dsh-mc-panel-title' }, props.title),
      props.action ? h('div', { className: 'dsh-mc-panel-action' }, props.action) : null,
    ),
    props.caption ? h('div', { className: 'dsh-mc-panel-caption' }, props.caption) : null,
    h('div', { className: 'dsh-mc-panel-body' }, props.children),
  )
}

export interface SubsectionProps {
  title: string
  children?: any
  className?: string
}

/** Lightweight grouping inside a Panel; no extra border/card. */
export function Subsection(props: SubsectionProps): any {
  const h = createElement
  return h('div', { className: `dsh-mc-subsection${props.className ? ` ${props.className}` : ''}` },
    h('h4', { className: 'dsh-mc-subsection-title' }, props.title),
    h('div', { className: 'dsh-mc-subsection-body' }, props.children),
  )
}

export interface CompactSelectOption {
  value: string
  label: string
}

/** Return the option that should receive focus when a closed popup opens. */
export function openingOptionIndex(length: number, direction: -1 | 0 | 1, selectedIndex = -1): number {
  if (length <= 0) return -1
  if (direction < 0) return length - 1
  if (direction > 0) return 0
  return selectedIndex >= 0 && selectedIndex < length ? selectedIndex : 0
}

/** Whether an activation key should close an already-open composite trigger. */
export function shouldCloseTriggerOnKey(open: boolean): boolean {
  return open
}

/** Accessible trigger name includes the currently selected option label. */
export function compactSelectAccessibleLabel(
  ariaLabel: string | undefined,
  selectedLabel: string | undefined,
  placeholder: string | undefined,
): string {
  return `${ariaLabel ?? ''}: ${selectedLabel ?? placeholder ?? ''}`
}

/**
 * Exactly-once commit guard for the inline number editor. The first call after
 * `begin()` is allowed; every later call is a no-op until the next begin.
 */
export function commitOnce(finished: boolean): { finished: boolean; allowed: boolean } {
  if (finished) return { finished: true, allowed: false }
  return { finished: true, allowed: true }
}

/** Only keyboard cancellation and an explicit choice return focus to a trigger. */
export function popupCloseRestoresFocus(reason: 'outside' | 'escape' | 'selection'): boolean {
  return reason !== 'outside'
}

export interface CompactSelectProps {
  value: string
  options: CompactSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}

export function CompactSelect(props: CompactSelectProps): any {
  const h = createElement
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const openDirectionRef = useRef<-1 | 0 | 1>(0)
  const id = useId()
  const selected = props.options.find(option => option.value === props.value)
  const selectedIndex = props.options.findIndex(option => option.value === props.value)
  const close = (reason: 'outside' | 'escape' | 'selection' = 'selection'): void => {
    setOpen(false)
    if (popupCloseRestoresFocus(reason)) queueMicrotask(() => triggerRef.current?.focus())
  }
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close('outside')
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close('outside')
    }
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget as Node | null
      if (rootRef.current && (!next || !rootRef.current.contains(next))) close('outside')
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const direction = openDirectionRef.current
    openDirectionRef.current = 0
    queueMicrotask(() => {
      const index = openingOptionIndex(props.options.length, direction, selectedIndex)
      if (index >= 0) itemRefs.current[index]?.focus()
    })
  }, [open, props.options.length, selectedIndex])
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close('escape')
      return
    }
    if (event.key === 'Enter') {
      const active = itemRefs.current.find(item => item === document.activeElement)
      const value = active?.dataset.value
      if (value !== undefined) {
        event.preventDefault()
        props.onChange(value)
        close()
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
    if (items.length === 0) return
    const index = items.findIndex(item => item === document.activeElement)
    const offset = event.key === 'ArrowDown' ? 1 : -1
    const next = index < 0
      ? offset > 0 ? 0 : items.length - 1
      : (index + offset + items.length) % items.length
    items[next]?.focus()
  }
  return h('div', { ref: rootRef, className: 'dsh-mc-compact-select', onKeyDown },
    h('button', {
      ref: triggerRef,
      type: 'button',
      className: 'dsh-mc-compact-trigger',
      'aria-label': compactSelectAccessibleLabel(props.ariaLabel, selected?.label, props.placeholder),
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      'aria-controls': open ? `${id}-listbox` : undefined,
      disabled: props.disabled,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (shouldCloseTriggerOnKey(open)) { close('escape'); return }
          openDirectionRef.current = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
          setOpen(true)
        }
      },
      onClick: () => setOpen(previous => !previous),
    }, h('span', { className: 'dsh-mc-compact-trigger-label' }, selected?.label ?? props.placeholder ?? ''), h(ChevronDownIcon, { open })),
    open ? h('div', { id: `${id}-listbox`, className: 'dsh-mc-compact-menu', role: 'listbox', 'aria-label': props.ariaLabel }, props.options.map((option, index) => h('button', {
      key: option.value,
      ref: (node: HTMLButtonElement | null): void => { itemRefs.current[index] = node },
      type: 'button',
      role: 'option',
      'aria-selected': option.value === props.value,
      tabIndex: -1,
       'data-value': option.value,
      className: `dsh-mc-compact-option${option.value === props.value ? ' dsh-mc-compact-option-selected' : ''}`,
      onClick: () => { props.onChange(option.value); close() },
    }, h('span', null, option.label), h('span', { className: 'dsh-mc-compact-check', 'aria-hidden': true }, option.value === props.value ? h(CheckIcon) : null)))) : null,
  )
}

export function Dropdown(props: any): any {
  return createElement(CompactSelect, props)
}

export interface TextInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  inputRef?: MutableRefObject<HTMLInputElement | null>
}

export function TextInput(props: TextInputProps): any {
  return createElement('input', {
    ref: props.inputRef,
    className: props.className ?? 'dsh-mc-input',
    value: props.value,
    placeholder: props.placeholder,
    'aria-label': props.ariaLabel,
    onChange: (event: any) => props.onChange(event.target.value),
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

export function InlineNumberEditor(props: { value: string; onChange: (value: string) => void; placeholder?: string; ariaLabel?: string }): any {
  const h = createElement
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) setDraft(props.value)
  }, [props.value, editing])
  useEffect(() => {
    if (editing) queueMicrotask(() => inputRef.current?.focus())
  }, [editing])
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const finishedRef = useRef(false)
  const finish = (commitValue: boolean, restoreFocus: boolean): void => {
    const guard = commitOnce(finishedRef.current)
    finishedRef.current = guard.finished
    if (!guard.allowed) return
    if (commitValue) props.onChange(draft.trim())
    else setDraft(props.value)
    setEditing(false)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }
  const begin = (): void => {
    finishedRef.current = false
    setDraft(props.value)
    setEditing(true)
  }
  const commit = (restoreFocus = false): void => finish(true, restoreFocus)
  const cancel = (): void => finish(false, true)
  if (!editing) {
    return h('button', { ref: triggerRef, type: 'button', className: 'dsh-mc-inline-value', onClick: begin, 'aria-label': props.ariaLabel }, props.value.trim() === '' ? props.placeholder ?? 'Auto' : props.value)
  }
  return h('input', {
    ref: inputRef,
    className: 'dsh-mc-inline-input',
    type: 'number',
    value: draft,
    'aria-label': props.ariaLabel,
    onChange: (event: any) => setDraft(event.target.value),
    onBlur: () => commit(false),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(true) }
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
    },
  })
}

export function TextArea(props: any): any {
  const { value, onChange, placeholder, ariaLabel, rows, disabled } = props
  return createElement('textarea', {
    className: 'dsh-mc-textarea',
    rows: rows ?? 4,
    value,
    placeholder,
    'aria-label': ariaLabel,
    disabled,
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
    description ? h('p', { className: 'dsh-mc-muted' }, description) : null,
  )
}

export function DisclosureRow(props: { summary: string; value?: string; children?: any; defaultOpen?: boolean; title?: string; description?: string }): any {
  const h = createElement
  const [open, setOpen] = useState(Boolean(props.defaultOpen))
  return h('div', { className: `dsh-mc-disclosure-row${open ? ' dsh-mc-disclosure-row-open' : ''}`, title: props.title },
    h('button', {
      type: 'button',
      className: 'dsh-mc-disclosure-trigger',
      'aria-expanded': open,
      onClick: () => setOpen(previous => !previous),
    }, h('span', { className: 'dsh-mc-disclosure-label' }, props.summary), props.value ? h('span', { className: 'dsh-mc-disclosure-value' }, props.value) : null, h('span', { className: 'dsh-mc-disclosure-chevron' }, open ? h(ChevronDownIcon, { open: true }) : h(ChevronRightIcon))),
    props.description ? h('p', { className: 'dsh-mc-setting-description dsh-mc-disclosure-description' }, props.description) : null,
     open ? h('div', { className: 'dsh-mc-disclosure-content' }, props.children) : null,
  )
}

export function Disclosure(props: any): any {
  return createElement(DisclosureRow, { summary: props.summary, defaultOpen: props.defaultOpen }, props.children)
}
