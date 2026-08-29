import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRequireForEntry,
  resolveSubagentVersion,
  type SubagentVersionResult,
} from '../src/subagent/config-service.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

function makeProfileWithTool(): { profileDir: string; entry: any } {
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-mc-entry-base-'))
  tempDirs.push(profileDir)
  const pkgDir = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-tool-subagent')
  mkdirSync(join(pkgDir, 'lib'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-tool-subagent',
    version: '0.1.1-rc.2',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './package.json': './package.json',
    },
  }))
  writeFileSync(join(pkgDir, 'lib', 'index.js'), 'export const Config = {}')
  const entry: any = {
    options: {
      id: 'delegation:tool-subagent',
      name: '@deepseek-ai/dsh-tool-subagent',
    },
    parent: { tree: { ctx: { baseUrl: pathToFileURL(profileDir).href } } },
  }
  Object.defineProperty(entry, 'id', { get: () => entry.options.id })
  return { profileDir, entry }
}

describe('entry-context version resolution', () => {
  it('creates a require rooted at the loader entry base URL', () => {
    const { entry } = makeProfileWithTool()
    const entryRequire = createRequireForEntry(entry)
    expect(entryRequire).toBeDefined()
    const pkg = entryRequire('@deepseek-ai/dsh-tool-subagent/package.json')
    expect(pkg.version).toBe('0.1.1-rc.2')
  })

  it('resolves the version from the entry base even when the plugin node_modules cannot', () => {
    const { entry } = makeProfileWithTool()
    const result = resolveSubagentVersion({}, {
      entry,
      id: 'delegation:tool-subagent',
      provider: 'spawn',
      toolName: 'subagent',
    })
    expect(result).toEqual<SubagentVersionResult>({
      version: '0.1.1-rc.2',
      source: 'entry-base-package',
    })
  })

  it('still prefers explicit entry/loader metadata when present', () => {
    const { entry } = makeProfileWithTool()
    expect(resolveSubagentVersion({}, {
      entry,
      id: 'delegation:tool-subagent',
      provider: 'spawn',
      toolName: 'subagent',
    }, { version: '0.1.2-alpha.1' })).toEqual<SubagentVersionResult>({
      version: '0.1.2-alpha.1',
      source: 'module',
    })
  })
})
