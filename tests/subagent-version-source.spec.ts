import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  packageVersionFromResolvedPath,
  resolveSubagentVersion,
  resolveSubagentVersionFromRequire,
  type SubagentVersionResult,
} from '../src/subagent/config-service.ts'

const tempDirs: string[] = []

function tempPackage(): { dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mc-subagent-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-tool-subagent',
    version: '0.1.1-rc.2',
  }))
  const libDir = join(dir, 'lib')
  mkdirSync(libDir)
  const entry = join(libDir, 'index.js')
  writeFileSync(entry, 'export {}')
  tempDirs.push(dir)
  return { dir, entry }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe('subagent version fallback from module path', () => {
  it('walks up from a resolved module path to the matching package.json', () => {
    const { entry } = tempPackage()
    expect(packageVersionFromResolvedPath(entry)).toEqual<SubagentVersionResult>({
      version: '0.1.1-rc.2',
      source: 'module-path-package',
    })
  })

  it('skips package.json files with a different name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mc-subagent-wrong-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-other-package', version: '9.9.9' }))
    const { entry } = tempPackage()
    expect(packageVersionFromResolvedPath(entry)).toEqual<SubagentVersionResult>({
      version: '0.1.1-rc.2',
      source: 'module-path-package',
    })
  })

  it('uses the package.json export when available', () => {
    const result = resolveSubagentVersionFromRequire(() => ({
      name: '@deepseek-ai/dsh-tool-subagent',
      version: '0.1.2-alpha.1',
    }))
    expect(result).toEqual<SubagentVersionResult>({
      version: '0.1.2-alpha.1',
      source: 'package-export',
    })
  })

  it('falls back to require.resolve walk when the export throws', () => {
    const { entry } = tempPackage()
    const result = resolveSubagentVersionFromRequire(
      () => { throw new Error('exports unavailable') },
      () => entry,
    )
    expect(result).toEqual<SubagentVersionResult>({
      version: '0.1.1-rc.2',
      source: 'module-path-package',
    })
  })

  it('fails closed when neither source resolves', () => {
    const result = resolveSubagentVersionFromRequire(
      () => { throw new Error('no export') },
      () => { throw new Error('no resolve') },
    )
    expect(result).toEqual<SubagentVersionResult>({ source: 'unknown' })
  })
})

describe('subagent version source priority', () => {
  it('prefers a loader entry version', () => {
    expect(resolveSubagentVersion({}, { entry: { options: { version: '0.1.1-rc.2' } } })).toEqual<SubagentVersionResult>({
      version: '0.1.1-rc.2',
      source: 'loader',
    })
  })

  it('prefers loaded module metadata before package exports', () => {
    expect(resolveSubagentVersion({}, undefined, { version: '0.1.1-rc.2' })).toEqual<SubagentVersionResult>({
      version: '0.1.1-rc.2',
      source: 'module',
    })
  })
})
