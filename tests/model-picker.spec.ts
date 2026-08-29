import { describe, expect, it } from 'vitest'
import {
  buildModelRouteOptions,
  buildProviderModelRouteOptions,
  computePopupPlacement,
  filterModelRouteOptions,
  modelRouteForEnter,
  modelRouteKey,
  toggleModelRoute,
} from '../src/client/model-picker.ts'

describe('model route directory', () => {
  const options = buildModelRouteOptions(
    ['deepseek', 'openai'],
    {
      deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      openai: ['gpt-5-mini'],
    },
    {
      providerLabels: { deepseek: 'DeepSeek', openai: 'OpenAI' },
      current: { provider: 'custom', model: 'catalog-external' },
      additionalRoutes: [{ provider: 'legacy', model: 'persisted-model' }],
    },
  )

  it('preserves provider groups and appends a current route outside the catalog', () => {
    expect(options.map(option => [option.provider, option.model, option.providerLabel])).toEqual([
      ['deepseek', 'deepseek-v4-flash', 'DeepSeek'],
      ['deepseek', 'deepseek-v4-pro', 'DeepSeek'],
      ['openai', 'gpt-5-mini', 'OpenAI'],
      ['custom', 'catalog-external', 'custom'],
      ['legacy', 'persisted-model', 'legacy'],
    ])
  })

  it('matches a model id, provider id, provider label, and combined route case-insensitively', () => {
    expect(filterModelRouteOptions(options, 'V4-PRO')).toEqual([
      expect.objectContaining({ provider: 'deepseek', model: 'deepseek-v4-pro' }),
    ])
    expect(filterModelRouteOptions(options, 'OPENAI')).toEqual([
      expect.objectContaining({ provider: 'openai', model: 'gpt-5-mini' }),
    ])
    expect(filterModelRouteOptions(options, 'deepseek/deepseek-v4-flash')).toEqual([
      expect.objectContaining({ provider: 'deepseek', model: 'deepseek-v4-flash' }),
    ])
  })

  it('marks persisted/current routes as custom metadata', () => {
    const options = buildModelRouteOptions(
      ['p'],
      { p: ['m'] },
      { current: { provider: 'x', model: 'y' }, additionalRoutes: [{ provider: 'z', model: 'w' }] },
    )
    expect(options.find(option => option.model === 'y')?.custom).toBe(true)
    expect(options.find(option => option.model === 'w')?.custom).toBe(true)
    expect(options.find(option => option.model === 'm')?.custom).toBeUndefined()
  })

  it('deduplicates provider/model routes in the directory', () => {
    const duplicates = buildModelRouteOptions(
      ['deepseek', 'deepseek'],
      { deepseek: ['deepseek-v4-flash', 'deepseek-v4-flash'] },
    )

    expect(duplicates).toEqual([
      expect.objectContaining({ provider: 'deepseek', model: 'deepseek-v4-flash' }),
    ])
  })

  it('selects the first filtered route when Enter is pressed from search', () => {
    expect(modelRouteForEnter(filterModelRouteOptions(options, 'gpt'))).toEqual({ provider: 'openai', model: 'gpt-5-mini' })
    expect(modelRouteForEnter([])).toBeNull()
  })

  it('toggles selected routes without creating duplicates', () => {
    const flash = { provider: 'deepseek', model: 'deepseek-v4-flash' }
    const pro = { provider: 'deepseek', model: 'deepseek-v4-pro' }

    expect(toggleModelRoute([flash, flash], pro)).toEqual([flash, pro])
    expect(toggleModelRoute([flash, pro], flash)).toEqual([pro])
    expect(modelRouteKey(flash)).toBe('deepseek\u0000deepseek-v4-flash')
  })
})

describe('popup viewport placement', () => {
  it('opens downward when there is enough space below', () => {
    expect(computePopupPlacement({ top: 50, bottom: 100 }, 800, 360)).toEqual({
      direction: 'down',
      maxHeight: 360,
    })
  })

  it('opens upward when the viewport bottom would clip the menu', () => {
    expect(computePopupPlacement({ top: 700, bottom: 750 }, 800, 360)).toEqual({
      direction: 'up',
      maxHeight: 360,
    })
  })

  it('clamps the max height to the available space', () => {
    expect(computePopupPlacement({ top: 50, bottom: 100 }, 200, 360)).toEqual({
      direction: 'down',
      maxHeight: 92,
    })
  })

  it('never returns a negative max height', () => {
    const placement = computePopupPlacement({ top: 0, bottom: 10 }, 0, 360)
    expect(placement.maxHeight).toBeGreaterThanOrEqual(0)
  })
})

describe('provider-scoped model directory', () => {
  it('builds options for only the selected provider', () => {
    const options = buildProviderModelRouteOptions('location', ['grok-4.6', 'deepseek-v4-flash'], {
      providerLabels: { location: 'location' },
      current: { provider: 'location', model: 'grok-4.6' },
    })
    expect(options.map(option => option.provider)).toEqual(['location', 'location'])
    expect(options.map(option => option.model)).toEqual(['grok-4.6', 'deepseek-v4-flash'])
  })

  it('never leaks other providers into a provider-scoped directory', () => {
    const options = buildProviderModelRouteOptions(
      'location',
      ['grok-4.6'],
      { current: { provider: 'location', model: 'grok-4.6' } },
    )
    expect(options).toEqual([
      expect.objectContaining({ provider: 'location', model: 'grok-4.6' }),
    ])
  })
})
