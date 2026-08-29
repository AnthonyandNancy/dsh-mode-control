import { createElement, useEffect, useId, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react'
import { CheckIcon, ChevronDownIcon, SettingsSelectTrigger, TextInput, openingOptionIndex, popupCloseRestoresFocus, shouldCloseTriggerOnKey } from './ui.ts'

export interface ModelRouteOption {
  provider: string
  model: string
  providerLabel?: string
  modelLabel?: string
  custom?: boolean
  reasoningEfforts?: string[]
  contextWindow?: number
}

export interface ModelRoute {
  provider: string
  model: string
}

export interface BuildModelRouteOptionsConfig {
  providerLabels?: Record<string, string>
  modelLabels?: Record<string, string>
  current?: ModelRoute
  additionalRoutes?: ModelRoute[]
}

export function modelRouteKey(route: ModelRoute): string {
  return `${route.provider}\u0000${route.model}`
}

export function modelRouteForEnter(options: ModelRouteOption[]): ModelRoute | null {
  const first = options[0]
  return first ? { provider: first.provider, model: first.model } : null
}

function routeDisplay(
  option: ModelRouteOption | undefined,
  value: ModelRoute | null | undefined,
  fallback: string,
  compactProvider = false,
): string {
  if (!value) return fallback
  if (compactProvider) return option?.modelLabel ?? value.model
  return `${option?.providerLabel ?? value.provider} / ${option?.modelLabel ?? value.model}`
}

type ModelValue = string | {
  id?: string
  name?: string
  label?: string
  reasoningEfforts?: string[]
  contextWindow?: number
}

function asModelValue(value: ModelValue): ModelRouteOption | null {
  if (typeof value === 'string') return { provider: '', model: value }
  if (typeof value?.id !== 'string' || value.id === '') return null
  return {
    provider: '',
    model: value.id,
    modelLabel: value.name ?? value.label,
    reasoningEfforts: value.reasoningEfforts,
    contextWindow: value.contextWindow,
  }
}

export function buildModelRouteOptions(
  providerNames: string[],
  modelsByProvider: Record<string, ModelValue[]>,
  config: BuildModelRouteOptionsConfig = {},
): ModelRouteOption[] {
  const options: ModelRouteOption[] = []
  const seen = new Set<string>()
  const add = (option: ModelRouteOption): void => {
    const key = modelRouteKey(option)
    if (seen.has(key)) return
    seen.add(key)
    options.push(option)
  }

  for (const provider of providerNames) {
    for (const value of modelsByProvider[provider] ?? []) {
      const option = asModelValue(value)
      if (!option) continue
      add({
        ...option,
        provider,
        providerLabel: config.providerLabels?.[provider] ?? provider,
        modelLabel: option.modelLabel ?? config.modelLabels?.[`${provider}\u0000${option.model}`] ?? option.model,
      })
    }
  }

  for (const route of [...(config.current ? [config.current] : []), ...(config.additionalRoutes ?? [])]) {
    if (!route.provider || !route.model || seen.has(modelRouteKey(route))) continue
    add({
      provider: route.provider,
      model: route.model,
      providerLabel: config.providerLabels?.[route.provider] ?? route.provider,
      modelLabel: config.modelLabels?.[modelRouteKey(route)] ?? route.model,
      custom: true,
    })
  }
  return options
}

/**
 * Build a single-provider model directory for the Model Settings picker.
 *
 * Model Settings edits only the currently selected provider; unlike the
 * Subagent picker it must never show models from other providers.
 */
export function buildProviderModelRouteOptions(
  provider: string,
  models: ModelValue[],
  config: BuildModelRouteOptionsConfig = {},
): ModelRouteOption[] {
  return buildModelRouteOptions([provider], { [provider]: models }, config)
}

/** Keep persisted routes visible even when the native catalog has gone stale. */
export function mergeModelRouteOptions(options: ModelRouteOption[], additionalRoutes: ModelRoute[]): ModelRouteOption[] {
  const merged = [...options]
  const seen = new Set(options.map(modelRouteKey))
  for (const route of additionalRoutes) {
    if (!route.provider || !route.model) continue
    const key = modelRouteKey(route)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ provider: route.provider, model: route.model, providerLabel: route.provider, modelLabel: route.model, custom: true })
  }
  return merged
}

export function filterModelRouteOptions(options: ModelRouteOption[], query: string): ModelRouteOption[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return options
  return options.filter(option => [
    option.provider,
    option.providerLabel,
    option.model,
    option.modelLabel,
    `${option.provider}/${option.model}`,
    `${option.providerLabel ?? option.provider}/${option.modelLabel ?? option.model}`,
  ].some(value => value?.toLowerCase().includes(normalized)))
}

export function toggleModelRoute(selected: ModelRoute[], route: ModelRoute): ModelRoute[] {
  const key = modelRouteKey(route)
  const deduped = selected.filter((item, index, all) => all.findIndex(candidate => modelRouteKey(candidate) === modelRouteKey(item)) === index)
  return deduped.some(item => modelRouteKey(item) === key)
    ? deduped.filter(item => modelRouteKey(item) !== key)
    : [...deduped, { provider: route.provider, model: route.model }]
}

type PopupCloseReason = 'outside' | 'escape' | 'selection'
type PopupClose = (reason?: PopupCloseReason) => void

export interface PopupPlacement {
  direction: 'down' | 'up'
  maxHeight: number
}

/**
 * Pure geometry decision for a popup anchored below a trigger.
 *
 * The menu opens upward when the viewport bottom would clip it and there is
 * more room above, and its max height is clamped to the available space so it
 * is never cut off by the viewport edge.
 */
export function computePopupPlacement(
  triggerRect: { top: number; bottom: number },
  viewportHeight: number,
  preferredHeight = 360,
  gap = 8,
): PopupPlacement {
  const spaceBelow = viewportHeight - triggerRect.bottom
  const spaceAbove = triggerRect.top
  const direction = spaceBelow < preferredHeight && spaceAbove > spaceBelow ? 'up' : 'down'
  const available = direction === 'up' ? spaceAbove - gap : spaceBelow - gap
  return { direction, maxHeight: Math.max(0, Math.min(preferredHeight, available)) }
}

function usePopup(
  open: boolean,
  onClose: PopupClose,
  triggerRef?: { current: HTMLButtonElement | null },
): { rootRef: { current: HTMLDivElement | null }; placement: PopupPlacement; positionClass: string } {
  const rootRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<PopupPlacement>({ direction: 'down', maxHeight: 360 })
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose('outside')
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose('outside')
    }
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget as Node | null
      if (rootRef.current && (!next || !rootRef.current.contains(next))) onClose('outside')
    }
    const update = (): void => {
      if (typeof window === 'undefined') return
      const element = triggerRef?.current ?? rootRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setPlacement(computePopupPlacement(rect, window.innerHeight))
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    update()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, onClose, triggerRef])
  return {
    rootRef,
    placement,
    positionClass: placement.direction === 'up' ? ' dsh-mc-picker-menu-up' : '',
  }
}

function PickerOption(props: {
  option: ModelRouteOption
  selected: boolean
  multiple: boolean
  onSelect: () => void
  itemRef?: (node: HTMLButtonElement | null) => void
  showProviderDetail?: boolean
}): any {
  const h = createElement
  const { option, selected, onSelect, itemRef, showProviderDetail = true } = props
  const label = `${option.providerLabel ?? option.provider} / ${option.modelLabel ?? option.model}`
  return h('button', {
    ref: itemRef,
    type: 'button',
    role: 'option',
    'aria-selected': selected,
    tabIndex: -1,
    'aria-label': label,
    className: `dsh-mc-picker-option${selected ? ' dsh-mc-picker-option-selected' : ''}`,
    'data-route-key': modelRouteKey(option),
    onClick: onSelect,
  },
    h('span', { className: 'dsh-mc-picker-option-copy' },
      h('span', { className: 'dsh-mc-picker-model' }, option.modelLabel ?? option.model),
      showProviderDetail ? h('span', { className: 'dsh-mc-picker-detail' }, option.providerLabel ?? option.provider) : null,
    ),
    h('span', { className: 'dsh-mc-picker-check', 'aria-hidden': true }, selected ? h(CheckIcon) : null),
  )
}

function ProviderGroups(props: {
  options: ModelRouteOption[]
  selected: Set<string>
  multiple: boolean
  onSelect: (option: ModelRouteOption) => void
  itemRefs: MutableRefObject<Array<HTMLButtonElement | null>>
  itemOffset?: number
  idPrefix: string
  showGroupTitles?: boolean
  showProviderDetail?: boolean
}): any {
  const h = createElement
  const showGroupTitles = props.showGroupTitles !== false
  const showProviderDetail = props.showProviderDetail !== false
  const groups: Array<[string, ModelRouteOption[]]> = []
  for (const option of props.options) {
    const existing = groups.find(group => group[0] === option.provider)
    if (existing) existing[1].push(option)
    else groups.push([option.provider, [option]])
  }
  let index = 0
  return h('div', { className: 'dsh-mc-picker-groups' }, groups.map(([provider, options], groupIndex) => {
    const titleId = `${props.idPrefix}-provider-${groupIndex}`
    return h('section', { key: provider, role: 'group', className: 'dsh-mc-picker-group', 'aria-labelledby': showGroupTitles ? titleId : undefined },
      showGroupTitles ? h('div', { id: titleId, className: 'dsh-mc-picker-group-title' }, options[0]?.providerLabel ?? provider) : null,
      options.map(option => {
        const itemIndex = (props.itemOffset ?? 0) + index++
        return h(PickerOption, {
          key: modelRouteKey(option),
          option,
          selected: props.selected.has(modelRouteKey(option)),
          multiple: props.multiple,
          onSelect: () => props.onSelect(option),
          itemRef: (node: HTMLButtonElement | null): void => { props.itemRefs.current[itemIndex] = node },
          showProviderDetail,
        })
      }),
    )
  }))
}

function createMenuKeyboard(
  open: boolean,
  close: PopupClose,
  itemRefs: MutableRefObject<Array<HTMLButtonElement | null>>,
  onEscape?: () => boolean,
  onEnter?: (active: HTMLButtonElement) => boolean,
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent): void => {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (onEscape?.()) return
      close('escape')
      return
    }
    if (event.key === 'Enter') {
      const active = itemRefs.current.find(item => item === document.activeElement)
      if (active && onEnter?.(active)) event.preventDefault()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
    if (items.length === 0) return
    const current = items.findIndex(item => item === document.activeElement)
    const offset = event.key === 'ArrowDown' ? 1 : -1
    const next = current < 0 ? (offset > 0 ? 0 : items.length - 1) : (current + offset + items.length) % items.length
    items[next]?.focus()
  }
}

export interface ModelRoutePickerProps {
  options: ModelRouteOption[]
  value?: ModelRoute | null
  onChange: (route: ModelRoute | null) => void
  inheritLabel?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  allowInherit?: boolean
  searchPlaceholder?: string
  searchAriaLabel?: string
  emptyLabel?: string
  additionalRoutes?: ModelRoute[]
  /** Single-provider mode: hide group headers/provider prefixes in the menu. */
  singleProvider?: boolean
}

export function ModelRoutePicker(props: ModelRoutePickerProps): any {
  const h = createElement
  const { options, value, onChange, inheritLabel = 'Inherit main model', placeholder = 'Select model', ariaLabel = placeholder, disabled, allowInherit = false, searchPlaceholder = 'Search models…', searchAriaLabel = 'Search models', emptyLabel = 'No models found', additionalRoutes = [], singleProvider = false } = props
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const openDirectionRef = useRef<-1 | 0 | 1>(0)
  const focusOptionsRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()
  const allOptions = mergeModelRouteOptions(options, additionalRoutes)
  const filtered = filterModelRouteOptions(allOptions, search)
  const selectedKey = value ? modelRouteKey(value) : ''
  const selected = value ? allOptions.find(option => modelRouteKey(option) === selectedKey) : undefined
  const selectedIndex = allowInherit && !value ? 0 : Math.max(0, filtered.findIndex(option => modelRouteKey(option) === selectedKey) + (allowInherit ? 1 : 0))
  const optionCount = filtered.length + (allowInherit ? 1 : 0)
  const close = (reason: PopupCloseReason = 'selection'): void => {
    setOpen(false)
    setSearch('')
    if (popupCloseRestoresFocus(reason)) queueMicrotask(() => triggerRef.current?.focus())
  }
  const popup = usePopup(open, close, triggerRef)
  useEffect(() => {
    if (!open) return
    const focusOptions = focusOptionsRef.current
    focusOptionsRef.current = false
    const index = openingOptionIndex(optionCount, openDirectionRef.current, selectedIndex)
    openDirectionRef.current = 0
    queueMicrotask(() => {
      if (focusOptions) itemRefs.current[index]?.focus()
      else inputRef.current?.focus()
    })
  }, [open, optionCount, selectedIndex])
  itemRefs.current = []
  const display = routeDisplay(selected, value, allowInherit ? inheritLabel : placeholder, singleProvider)
  const triggerLabel = display
  const select = (route: ModelRoute | null): void => { onChange(route); close('selection') }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && search !== '') { event.preventDefault(); setSearch(''); return }
    if (event.key === 'Enter' && open && document.activeElement === inputRef.current) {
      const route = modelRouteForEnter(filtered)
      if (route) { event.preventDefault(); select(route) }
      return
    }
    if (event.key === 'Enter' && open) {
      const active = itemRefs.current.find(item => item === document.activeElement)
      if (active) {
        event.preventDefault()
        if (active.dataset.inherit === 'true') select(null)
        else {
          const option = filtered.find(candidate => modelRouteKey(candidate) === active.dataset.routeKey)
          if (option) select(option)
        }
        return
      }
    }
    createMenuKeyboard(open, close, itemRefs)(event)
  }
  const openPicker = (direction: -1 | 0 | 1, focusOptions: boolean): void => {
    openDirectionRef.current = direction
    focusOptionsRef.current = focusOptions
    setOpen(true)
  }
  return h('div', { ref: popup.rootRef, className: 'dsh-mc-picker-root', onKeyDown },
    h(SettingsSelectTrigger, {
      triggerRef,
      label: display,
      open,
      disabled,
      ariaLabel: `${ariaLabel}: ${triggerLabel}`,
      title: display,
      'aria-controls': open ? `${id}-listbox` : undefined,
      className: 'dsh-mc-settings-control',
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (shouldCloseTriggerOnKey(open)) { close('escape'); return }
           openPicker(event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0, true)
        }
      },
      onClick: () => open ? close('escape') : openPicker(0, false),
    }),
    open ? h('div', { id: `${id}-menu`, className: `dsh-mc-picker-menu${popup.positionClass}`, style: { maxHeight: `${popup.placement.maxHeight}px` } },
      h(TextInput, { inputRef, value: search, onChange: setSearch, placeholder: searchPlaceholder, ariaLabel: searchAriaLabel, className: 'dsh-mc-picker-search' }),
      h('div', { id: `${id}-listbox`, className: 'dsh-mc-picker-listbox', role: 'listbox', 'aria-label': ariaLabel },
        allowInherit ? h('button', { ref: (node: HTMLButtonElement | null): void => { itemRefs.current[0] = node }, type: 'button', role: 'option', 'aria-selected': value == null, tabIndex: -1, 'aria-label': inheritLabel, className: `dsh-mc-picker-option${value == null ? ' dsh-mc-picker-option-selected' : ''}`, 'data-inherit': 'true', onClick: () => select(null) },
          h('span', { className: 'dsh-mc-picker-option-copy' }, h('span', { className: 'dsh-mc-picker-model' }, inheritLabel)), h('span', { className: 'dsh-mc-picker-check', 'aria-hidden': true }, value == null ? h(CheckIcon) : null)) : null,
        h(ProviderGroups, { options: filtered, selected: new Set(value ? [selectedKey] : []), multiple: false, onSelect: select, itemRefs, itemOffset: allowInherit ? 1 : 0, idPrefix: id, showGroupTitles: !singleProvider, showProviderDetail: !singleProvider }),
        filtered.length === 0 && !allowInherit ? h('div', { className: 'dsh-mc-picker-empty' }, emptyLabel) : null,
      ),
    ) : null,
  )
}

export interface MultiModelPickerProps {
  options: ModelRouteOption[]
  value: ModelRoute[]
  additionalRoutes?: ModelRoute[]
  onChange: (routes: ModelRoute[]) => void
  summary?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  searchPlaceholder?: string
  searchAriaLabel?: string
  emptyLabel?: string
}

export function MultiModelPicker(props: MultiModelPickerProps): any {
  const h = createElement
  const { options, value, additionalRoutes = [], onChange, summary, placeholder = 'Select models', ariaLabel = placeholder, disabled, searchPlaceholder = 'Search models…', searchAriaLabel = 'Search models', emptyLabel = 'No models found' } = props
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const openDirectionRef = useRef<-1 | 0 | 1>(0)
  const focusOptionsRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()
  const allOptions = mergeModelRouteOptions(options, additionalRoutes)
  const filtered = filterModelRouteOptions(allOptions, search)
  const selected = new Set(value.map(modelRouteKey))
  const close = (reason: PopupCloseReason = 'selection'): void => {
    setOpen(false)
    setSearch('')
    if (popupCloseRestoresFocus(reason)) queueMicrotask(() => triggerRef.current?.focus())
  }
  const popup = usePopup(open, close, triggerRef)
  useEffect(() => {
    if (!open) return
    const focusOptions = focusOptionsRef.current
    focusOptionsRef.current = false
    const index = openingOptionIndex(filtered.length, openDirectionRef.current)
    openDirectionRef.current = 0
    queueMicrotask(() => {
      if (focusOptions) itemRefs.current[index]?.focus()
      else inputRef.current?.focus()
    })
  }, [open, filtered.length])
  itemRefs.current = []
  const toggle = (route: ModelRoute): void => { onChange(toggleModelRoute(value, route)) }
  const triggerLabel = summary ?? `${value.length}`
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && search !== '') { event.preventDefault(); setSearch(''); return }
    if (event.key === 'Enter' && open && document.activeElement === inputRef.current) {
      const route = modelRouteForEnter(filtered)
      if (route) { event.preventDefault(); toggle(route) }
      return
    }
    createMenuKeyboard(open, close, itemRefs, () => {
      if (search !== '') { setSearch(''); return true }
      return false
    }, active => {
      const option = filtered.find(candidate => modelRouteKey(candidate) === active.dataset.routeKey)
      if (!option) return false
      toggle(option)
      return true
    })(event)
  }
  const openPicker = (direction: -1 | 0 | 1, focusOptions: boolean): void => {
    openDirectionRef.current = direction
    focusOptionsRef.current = focusOptions
    setOpen(true)
  }
  return h('div', { ref: popup.rootRef, className: 'dsh-mc-picker-root', onKeyDown },
    h(SettingsSelectTrigger, {
      triggerRef,
      label: summary ?? `${value.length}`,
      open,
      disabled,
      ariaLabel: `${ariaLabel}: ${triggerLabel}`,
      'aria-controls': open ? `${id}-listbox` : undefined,
      className: 'dsh-mc-settings-control',
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (shouldCloseTriggerOnKey(open)) { close('escape'); return }
           openPicker(event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0, true)
        }
      },
      onClick: () => open ? close('escape') : openPicker(0, false),
    }),
    open ? h('div', { id: `${id}-menu`, className: `dsh-mc-picker-menu${popup.positionClass}`, style: { maxHeight: `${popup.placement.maxHeight}px` } },
      h(TextInput, { inputRef, value: search, onChange: setSearch, placeholder: searchPlaceholder, ariaLabel: searchAriaLabel, className: 'dsh-mc-picker-search' }),
      h('div', { id: `${id}-listbox`, className: 'dsh-mc-picker-listbox', role: 'listbox', 'aria-label': ariaLabel, 'aria-multiselectable': true },
        h(ProviderGroups, { options: filtered, selected, multiple: true, onSelect: toggle, itemRefs, idPrefix: id }),
        filtered.length === 0 ? h('div', { className: 'dsh-mc-picker-empty' }, emptyLabel) : null,
      ),
    ) : null,
  )
}
