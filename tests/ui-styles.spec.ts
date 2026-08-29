import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CAPABILITIES_CSS } from '../src/client/styles.ts'

const source = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')

describe('DSH settings visual regression', () => {
  it('uses the 0/16/32 depth scale instead of the old 4/10 cascade', () => {
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-depth-0{--dsh-mc-indent:0px}')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-depth-1{--dsh-mc-indent:16px}')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-depth-2{--dsh-mc-indent:32px}')
    expect(CAPABILITIES_CSS).not.toContain('margin-left:4px;padding-left:10px')
  })

  it('keeps subsection bodies free of structural padding so depth is the only indent source', () => {
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-subsection-body{min-width:0;display:flex;flex-direction:column;padding-left:0;gap:4px}')
    expect(CAPABILITIES_CSS).not.toContain('.dsh-mc-subsection-body{min-width:0;display:flex;flex-direction:column;padding-left:12px')
  })

  it('renders one unified DSH settings trigger for CompactSelect and ModelRoutePicker', () => {
    const uiSource = source('ui.ts')
    const pickerSource = source('model-picker.ts')
    expect(uiSource).toContain('SettingsSelectTrigger')
    expect(uiSource).toContain('dsh-mc-settings-trigger')
    expect(pickerSource).toContain('SettingsSelectTrigger')
    expect(uiSource).not.toContain('composer-transparent')
    expect(pickerSource).not.toContain('composer-transparent')
  })

  it('styles the settings trigger as a neutral filled capsule, not a rectangular input', () => {
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-settings-trigger{box-sizing:border-box;height:36px;min-height:36px;')
    expect(CAPABILITIES_CSS).toContain('border:1px solid transparent;')
    expect(CAPABILITIES_CSS).toContain('background:var(--dsw-alias-interactive-bg-hover-solid)')
    expect(CAPABILITIES_CSS).toContain('border-radius:18px')
    expect(CAPABILITIES_CSS).not.toContain('.dsh-mc-compact-trigger,.dsh-mc-picker-trigger{')
  })

  it('styles Save primary and Reset secondary as 36px DSH pills', () => {
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-button-primary')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-button-secondary')
    expect(CAPABILITIES_CSS).toContain('height:36px;padding:0 14px;border-radius:18px')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-button-dense')
  })

  it('removes the plugin card chrome from panels', () => {
    expect(CAPABILITIES_CSS).toMatch(/\.dsh-mc-panel\{[^}]*border:0/)
    expect(CAPABILITIES_CSS).toMatch(/\.dsh-mc-panel\{[^}]*border-radius:0/)
    expect(CAPABILITIES_CSS).toMatch(/\.dsh-mc-panel\{[^}]*background:transparent/)
  })

  it('uses distinct primary save and secondary reset button variants', () => {
    const indexSource = source('index.ts')
    expect(indexSource).toContain("className: 'dsh-mc-button dsh-mc-button-primary'")
    expect(indexSource).toContain("className: 'dsh-mc-button dsh-mc-button-secondary'")
    expect(indexSource).toContain("className: 'dsh-mc-button dsh-mc-button-dense'")
  })

  it('keeps the save button enabled when clean and only disables while saving', () => {
    const indexSource = source('index.ts')
    expect(indexSource).toContain("saveButtonDisabled(dirtyProvidersRef.current.size > 0, saveFeedback.phase)")
    expect(indexSource).not.toContain("!hasDirty || phase === 'saving'")
  })

  it('generates DisclosureRow depth classes from the explicit depth prop', () => {
    const uiSource = source('ui.ts')
    expect(uiSource).toContain('dsh-mc-depth-${depth}')
  })

  it('keeps disclosure variant and depth typography classes distinct', () => {
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-disclosure-row-variant-section')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-disclosure-row-variant-group')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-disclosure-row-variant-field')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-depth-0')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-depth-1')
    expect(CAPABILITIES_CSS).toContain('.dsh-mc-depth-2')
  })
})
