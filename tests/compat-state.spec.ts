import { describe, expect, it } from 'vitest'
import {
  collectOpsForCompat,
  collectOptionalBooleanOp,
  parseCompatDrafts,
  parseInheritBoolean,
  parseJsonCompat,
  type CompatDraftValue,
  type SettingsOp,
} from '../src/client/compat-state.ts'

describe('inherit boolean helpers', () => {
  it('maps undefined/true/false to inherit/enabled/disabled', () => {
    expect(parseInheritBoolean(undefined)).toBe('inherit')
    expect(parseInheritBoolean(true)).toBe('enabled')
    expect(parseInheritBoolean(false)).toBe('disabled')
  })

  it('collects precise boolean ops without touching the whole compat object', () => {
    expect(collectOptionalBooleanOp(['compat', 'flag'], true, 'inherit')).toEqual<SettingsOp[]>([
      { op: 'unset', path: ['compat', 'flag'] },
    ])
    expect(collectOptionalBooleanOp(['compat', 'flag'], false, 'inherit')).toEqual<SettingsOp[]>([])
    expect(collectOptionalBooleanOp(['compat', 'flag'], false, 'enabled')).toEqual<SettingsOp[]>([
      { op: 'set', path: ['compat', 'flag'], value: true },
    ])
    expect(collectOptionalBooleanOp(['compat', 'flag'], false, 'disabled')).toEqual<SettingsOp[]>([
      { op: 'set', path: ['compat', 'flag'], value: false },
    ])
  })
})

describe('parseJsonCompat', () => {
  it('accepts empty text and nested objects', () => {
    expect(parseJsonCompat('')).toEqual({ ok: true, value: undefined })
    expect(parseJsonCompat('{}')).toEqual({ ok: true, value: {} })
    expect(parseJsonCompat('{"a":{"b":1}}')).toEqual({ ok: true, value: { a: { b: 1 } } })
  })

  it('rejects invalid JSON', () => {
    expect(parseJsonCompat('{oops')).ok === false
    const result = parseJsonCompat('{oops')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })

  it('rejects arrays and scalars for object-only fields', () => {
    expect(parseJsonCompat('[1,2]').ok).toBe(false)
    expect(parseJsonCompat('"str"').ok).toBe(false)
    expect(parseJsonCompat('42').ok).toBe(false)
    expect(parseJsonCompat('null').ok).toBe(false)
  })
})

describe('compat drafts', () => {
  it('parses boolean/enum/json existing values', () => {
    const drafts = parseCompatDrafts({
      supportsStore: false,
      maxTokensField: 'max_completion_tokens',
      chatTemplateKwargs: { system: '<|system|>' },
      someFutureCompat: 'keep',
    })
    expect(drafts['supportsStore']).toEqual<CompatDraftValue>({ kind: 'boolean', mode: 'disabled' })
    expect(drafts['maxTokensField']).toEqual<CompatDraftValue>({ kind: 'enum', value: 'max_completion_tokens' })
    expect(drafts['chatTemplateKwargs']).toMatchObject({ kind: 'json' })
    expect((drafts['chatTemplateKwargs'] as { text: string }).text).toContain('system')
    // Unknown keys are not managed by the draft; they stay untouched in settings.
    expect(drafts['someFutureCompat']).toBeUndefined()
  })

  it('defaults missing fields to inherit/empty', () => {
    const drafts = parseCompatDrafts({})
    expect(drafts['supportsStore']).toEqual<CompatDraftValue>({ kind: 'boolean', mode: 'inherit' })
    expect(drafts['maxTokensField']).toEqual<CompatDraftValue>({ kind: 'enum', value: '' })
  })
})

describe('collectOpsForCompat', () => {
  it('emits only the changed fields and preserves others', () => {
    const ops = collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      { supportsStore: false, someFutureCompat: 'keep' },
      {
        supportsStore: { kind: 'boolean', mode: 'inherit' },
        supportsDeveloperRole: { kind: 'boolean', mode: 'enabled' },
      },
    )
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'compat', 'supportsStore'] },
      { op: 'set', path: ['providers', 'acme', 'compat', 'supportsDeveloperRole'], value: true },
    ])
  })

  it('sets enum values and unsets empty enum', () => {
    const ops = collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      { maxTokensField: 'max_tokens' },
      { maxTokensField: { kind: 'enum', value: '' } },
    )
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'compat', 'maxTokensField'] },
    ])
    const setOps = collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      {},
      { maxTokensField: { kind: 'enum', value: 'max_completion_tokens' } },
    )
    expect(setOps).toEqual([
      { op: 'set', path: ['providers', 'acme', 'compat', 'maxTokensField'], value: 'max_completion_tokens' },
    ])
  })

  it('sets valid JSON and unsets empty JSON', () => {
    const ops = collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      { chatTemplateKwargs: { old: 1 } },
      { chatTemplateKwargs: { kind: 'json', text: '' } },
    )
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'compat', 'chatTemplateKwargs'] },
    ])
    const setOps = collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      {},
      { chatTemplateKwargs: { kind: 'json', text: '{"system":"<|system|>"}' } },
    )
    expect(setOps).toEqual([
      { op: 'set', path: ['providers', 'acme', 'compat', 'chatTemplateKwargs'], value: { system: '<|system|>' } },
    ])
  })

  it('throws on invalid JSON instead of saving', () => {
    expect(() => collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      {},
      { chatTemplateKwargs: { kind: 'json', text: '{bad' } },
    )).toThrow(/JSON/)
  })

  it('throws when JSON is not an object', () => {
    expect(() => collectOpsForCompat(
      ['providers', 'acme', 'compat'],
      {},
      { chatTemplateKwargs: { kind: 'json', text: '[1,2]' } },
    )).toThrow(/object/)
  })
})
