import { describe, expect, it } from 'vitest'
import { commitOnce, compactSelectAccessibleLabel, openingOptionIndex, Panel, popupCloseRestoresFocus, SettingRow, shouldCloseTriggerOnKey, Subsection } from '../src/client/ui.ts'
import { emptyCompatDrafts } from '../src/client/compat-state.ts'
import { collectOpsForAllProviders } from '../src/client/save-helpers.ts'
import { collectOpsForProvider, type ModelDraft, type ProviderDraft } from '../src/client/ops.ts'

describe('popup keyboard regression helpers', () => {
  it('opens downward on the first option and upward on the last option', () => {
    expect(openingOptionIndex(3, -1)).toBe(2)
    expect(openingOptionIndex(3, 1)).toBe(0)
  })

  it('does not restore the trigger after outside dismissal', () => {
    expect(() => openingOptionIndex(0, 1)).not.toThrow()
    expect(popupCloseRestoresFocus('outside')).toBe(false)
    expect(popupCloseRestoresFocus('escape')).toBe(true)
    expect(popupCloseRestoresFocus('selection')).toBe(true)
  })

  it('closes an already-open trigger on Enter or Space', () => {
    expect(shouldCloseTriggerOnKey(true)).toBe(true)
    expect(shouldCloseTriggerOnKey(false)).toBe(false)
  })

  it('includes the current selection in the CompactSelect accessible name', () => {
    expect(compactSelectAccessibleLabel('Provider', 'DeepSeek', undefined)).toBe('Provider: DeepSeek')
    expect(compactSelectAccessibleLabel('Provider', undefined, 'Auto')).toBe('Provider: Auto')
    expect(compactSelectAccessibleLabel('Provider', undefined, undefined)).toBe('Provider: ')
  })

  it('commits an inline editor exactly once', () => {
    const first = commitOnce(false)
    expect(first).toEqual({ finished: true, allowed: true })
    const second = commitOnce(first.finished)
    expect(second).toEqual({ finished: true, allowed: false })
  })
})

describe('UI draft regression helpers', () => {
  it('creates inherited compat drafts so reset can emit unsets', () => {
    const drafts = emptyCompatDrafts()
    expect(drafts.supportsStore).toEqual({ kind: 'boolean', mode: 'inherit' })
    expect(drafts.maxTokensField).toEqual({ kind: 'enum', value: '' })
    expect(drafts.chatTemplateKwargs).toEqual({ kind: 'json', text: '' })
  })

  it('emits compat unsets from an inherited reset draft', () => {
    const ops = collectOpsForProvider('alpha', { compat: { supportsStore: true, chatTemplateKwargs: { x: 1 } } }, {
      defaultInput: [], defaultReasoning: '', adaptiveThinking: 'inherit', compat: emptyCompatDrafts(),
    })
    expect(ops).toEqual(expect.arrayContaining([
      { op: 'unset', path: ['providers', 'alpha', 'compat', 'supportsStore'] },
      { op: 'unset', path: ['providers', 'alpha', 'compat', 'chatTemplateKwargs'] },
    ]))
  })

  it('blocks unsupported provider compat writes and still emits exact unsets on clear', () => {
    const unsupportedDraft: ProviderDraft = {
      defaultInput: [], defaultReasoning: '', adaptiveThinking: 'inherit',
      defaultContextWindow: '', defaultMaxTokens: '', thinkingBudgets: {}, compat: {
        supportsStore: { kind: 'boolean', mode: 'disabled' },
        maxTokensField: { kind: 'enum', value: 'max_tokens' },
        chatTemplateKwargs: { kind: 'json', text: '{"a":1}' },
      },
    }
    const providerConfig = {
      compat: {
        supportsStore: true,
        maxTokensField: 'max_tokens',
        chatTemplateKwargs: { a: 1 },
      },
    }
    const runtimeProviderCompat = new Set<string>(['supportsDeveloperRole'])
    const blocked = collectOpsForAllProviders(
      ['acme'], { acme: providerConfig }, { acme: unsupportedDraft }, {},
      new Set(['acme']), [], undefined,
      new Map([['acme', new Set(['compat'])]]), undefined, runtimeProviderCompat,
    )
    expect(blocked).toEqual([])

    const clearedDraft: ProviderDraft = {
      ...unsupportedDraft,
      compat: {
        supportsStore: { kind: 'boolean', mode: 'inherit' },
        maxTokensField: { kind: 'enum', value: '' },
        chatTemplateKwargs: { kind: 'json', text: '' },
      },
    }
    const cleared = collectOpsForAllProviders(
      ['acme'], { acme: providerConfig }, { acme: clearedDraft }, {},
      new Set(['acme']), [], undefined,
      new Map([['acme', new Set(['compat'])]]), undefined, runtimeProviderCompat,
    )
    expect(cleared).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'compat', 'supportsStore'] },
      { op: 'unset', path: ['providers', 'acme', 'compat', 'maxTokensField'] },
      { op: 'unset', path: ['providers', 'acme', 'compat', 'chatTemplateKwargs'] },
    ])
  })

  it('collects save operations for every provider, not only the visible provider', () => {
    const providerDraft: ProviderDraft = {
      defaultInput: ['text'], defaultReasoning: '', adaptiveThinking: 'inherit',
      defaultContextWindow: '', defaultMaxTokens: '', thinkingBudgets: {}, compat: {},
    }
    const modelDraft: ModelDraft = {
      input: ['image'], reasoningMode: 'inherit', efforts: [], wire: {},
      contextWindow: '', maxTokens: '', compat: {},
    }
    const ops = collectOpsForAllProviders(
      ['alpha', 'beta'],
      { alpha: {}, beta: {} },
      { alpha: providerDraft, beta: providerDraft },
      { alpha: { 'alpha-model': modelDraft }, beta: { 'beta-model': modelDraft } },
      new Set(['alpha', 'beta']),
    )

    expect(ops).toEqual(expect.arrayContaining([
      { op: 'set', path: ['providers', 'alpha', 'defaultInput'], value: ['text'] },
      { op: 'set', path: ['providers', 'beta', 'defaultInput'], value: ['text'] },
      { op: 'set', path: ['providers', 'alpha', 'modelOverrides', 'alpha-model', 'input'], value: ['image'] },
      { op: 'set', path: ['providers', 'beta', 'modelOverrides', 'beta-model', 'input'], value: ['image'] },
    ]))
  })
})

describe('Panel / Subsection hierarchy components', () => {
  it('exports lightweight panel and subsection renderers', () => {
    expect(typeof Panel).toBe('function')
    expect(typeof Subsection).toBe('function')
  })

  it('keeps L2/L3 heading semantics (h3 panel, h4 subsection)', () => {
    const panel = Panel({ title: 'Provider' })
    const panelBody = panel.props.children
    expect(panel.type).toBe('section')
    expect(panelBody[0].props.children[0].type).toBe('h3')
    expect(panelBody[0].props.children[0].props.className).toContain('dsh-mc-panel-title')

    const subsection = Subsection({ title: 'Defaults' })
    expect(subsection.type).toBe('div')
    expect(subsection.props.children[0].type).toBe('h4')
    expect(subsection.props.children[0].props.className).toContain('dsh-mc-subsection-title')
  })

  it('renders SettingRow help as a tooltip icon without inline description', () => {
    const row = SettingRow({ label: 'Field', help: 'Help text', control: 'x' })
    const labelBlock = row.props.children[0]
    const labelLine = labelBlock.props.children[0]
    expect(labelLine.props.children[0].props.className).toContain('dsh-mc-setting-label')
    expect(labelLine.props.children[1].props.className).toContain('dsh-mc-setting-help')
    expect(labelLine.props.children[1].props.title).toBe('Help text')
    expect(labelBlock.props.children[1]).toBeNull()
  })
})
