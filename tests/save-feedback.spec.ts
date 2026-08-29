import { describe, expect, it } from 'vitest'
import { saveButtonDisabled } from '../src/client/index.ts'

describe('save feedback controls', () => {
  it('keeps the save button enabled when dirty and idle', () => {
    expect(saveButtonDisabled(true, 'idle')).toBe(false)
  })

  it('disables save when there are no dirty changes', () => {
    expect(saveButtonDisabled(false, 'idle')).toBe(true)
    expect(saveButtonDisabled(false, 'success')).toBe(true)
    expect(saveButtonDisabled(false, 'error')).toBe(true)
  })

  it('disables save while a save is in flight', () => {
    expect(saveButtonDisabled(true, 'saving')).toBe(true)
  })

  it('allows retry after error and re-save after success/pending', () => {
    expect(saveButtonDisabled(true, 'error')).toBe(false)
    expect(saveButtonDisabled(true, 'success')).toBe(false)
    expect(saveButtonDisabled(true, 'pending')).toBe(false)
  })
})
