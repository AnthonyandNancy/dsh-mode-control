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

  it('marks CompactSelect and ModelRoutePicker triggers as settings controls', () => {
    const uiSource = source('ui.ts')
    const pickerSource = source('model-picker.ts')
    expect(uiSource).toContain('dsh-mc-settings-control')
    expect(pickerSource).toContain('dsh-mc-settings-control')
    expect(uiSource).not.toContain('composer-transparent')
    expect(pickerSource).not.toContain('composer-transparent')
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
