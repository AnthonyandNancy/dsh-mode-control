import { describe, expect, it } from 'vitest'
import { mergeCompatDrafts } from '../src/client/compat-state.ts'

describe('mergeCompatDrafts', () => {
  it('preserves unknown keys while applying managed changes', () => {
    const result = mergeCompatDrafts(
      { supportsStore: false, someFutureCompat: 'keep' },
      { supportsStore: { kind: 'boolean', mode: 'inherit' } },
    )
    expect(result).toEqual({
      value: { someFutureCompat: 'keep' },
      changed: true,
    })
  })

  it('returns undefined when the last managed field is removed and no unknown remains', () => {
    const result = mergeCompatDrafts(
      { supportsStore: true },
      { supportsStore: { kind: 'boolean', mode: 'inherit' } },
    )
    expect(result).toEqual({ value: undefined, changed: true })
  })

  it('sets enabled/disabled booleans', () => {
    const result = mergeCompatDrafts(
      {},
      { supportsStore: { kind: 'boolean', mode: 'disabled' } },
    )
    expect(result).toEqual({ value: { supportsStore: false }, changed: true })
  })

  it('keeps an empty compat object unchanged when no field changes', () => {
    const result = mergeCompatDrafts(
      { supportsStore: true },
      { supportsStore: { kind: 'boolean', mode: 'enabled' } },
    )
    expect(result).toEqual({ value: { supportsStore: true }, changed: false })
  })
})
