import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  isSubagentVisible,
  parseVersion,
  type ParsedVersion,
} from '../src/subagent/version.ts'

describe('semver compare', () => {
  it('parses major/minor/patch/prerelease', () => {
    expect(parseVersion('0.1.1-rc.2')).toEqual<ParsedVersion>({
      major: 0,
      minor: 1,
      patch: 1,
      prerelease: ['rc', '2'],
    })
    expect(parseVersion('0.1.2-alpha.1')).toEqual<ParsedVersion>({
      major: 0,
      minor: 1,
      patch: 2,
      prerelease: ['alpha', '1'],
    })
    expect(parseVersion('0.1.1')).toEqual<ParsedVersion>({
      major: 0,
      minor: 1,
      patch: 1,
      prerelease: [],
    })
  })

  it('orders the spec examples correctly', () => {
    const ordered = [
      '0.1.0-rc.8',
      '0.1.1-rc.1',
      '0.1.1-rc.2',
      '0.1.1',
      '0.1.2-alpha.1',
      '0.1.2',
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i]!, ordered[i + 1]!)).toBeLessThan(0)
    }
  })

  it('compares numeric prerelease identifiers numerically', () => {
    expect(compareSemver('0.1.1-rc.9', '0.1.1-rc.10')).toBeLessThan(0)
    expect(compareSemver('0.1.1-rc.10', '0.1.1-rc.2')).toBeGreaterThan(0)
  })

  it('treats a release as newer than its prerelease', () => {
    expect(compareSemver('0.1.1', '0.1.1-rc.2')).toBeGreaterThan(0)
    expect(compareSemver('0.1.2-alpha.1', '0.1.1')).toBeGreaterThan(0)
  })

  it('returns 0 for equal versions', () => {
    expect(compareSemver('0.1.1-rc.2', '0.1.1-rc.2')).toBe(0)
  })
})

describe('subagent visibility gate', () => {
  it('hides versions below 0.1.1-rc.2', () => {
    expect(isSubagentVisible('0.1.0-rc.6')).toBe(false)
    expect(isSubagentVisible('0.1.0-rc.7')).toBe(false)
    expect(isSubagentVisible('0.1.0-rc.8')).toBe(false)
    expect(isSubagentVisible('0.1.1-rc.1')).toBe(false)
  })

  it('shows 0.1.1-rc.2 and everything newer', () => {
    expect(isSubagentVisible('0.1.1-rc.2')).toBe(true)
    expect(isSubagentVisible('0.1.1-rc.3')).toBe(true)
    expect(isSubagentVisible('0.1.1')).toBe(true)
    expect(isSubagentVisible('0.1.2-alpha.1')).toBe(true)
    expect(isSubagentVisible('0.1.2')).toBe(true)
  })

  it('fails closed on unparseable or missing versions', () => {
    expect(isSubagentVisible(undefined)).toBe(false)
    expect(isSubagentVisible('not-a-version')).toBe(false)
    expect(isSubagentVisible('')).toBe(false)
  })
})
