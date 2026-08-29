import { describe, expect, it, vi } from 'vitest'
import {
  isCanonicalToolSubagentEntry,
  isCanonicalToolSubagentFiber,
  startSubagentSettingsRegistration,
  type SubagentRuntimeSnapshot,
} from '../src/subagent/config-service.ts'

function snapshot(overrides: Partial<SubagentRuntimeSnapshot> = {}): SubagentRuntimeSnapshot {
  return {
    effectiveVersion: '0.1.1-rc.2',
    entryFound: true,
    toolSubagentSchemaFields: [],
    agentOptionsSchemaFields: [],
    providers: [],
    ...overrides,
  }
}

function fakeContext() {
  const listeners = new Map<string, Array<(arg: any) => void>>()
  const ctx: any = {
    logger: { warn: vi.fn(), info: vi.fn() },
    on: vi.fn((name: string, listener: (arg: any) => void) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    }),
    effect: vi.fn(),
  }
  return { ctx, listeners }
}

function canonicalEntry(options = { provider: 'spawn', toolName: 'subagent' }) {
  const entry: any = {
    options: {
      id: 'delegation:tool-subagent',
      name: '@deepseek-ai/dsh-tool-subagent',
      config: options,
    },
    parent: { tree: { ctx: { baseUrl: 'file:///profile/' } } },
  }
  Object.defineProperty(entry, 'id', {
    get: () => entry.options.id,
  })
  return entry
}

describe('subagent registration lifecycle', () => {
  it('registers immediately when the tool entry already exists', async () => {
    const { ctx } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn(async () => snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(resolveRuntime).toHaveBeenCalledTimes(1)
  })

  it('registers later via internal/plugin when the tool entry appears after plugin start', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn()
      .mockResolvedValueOnce(snapshot({ entryFound: false, hiddenReason: 'entry-missing' }))
      .mockResolvedValueOnce(snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(resolveRuntime).toHaveBeenCalledTimes(1))
    expect(register).not.toHaveBeenCalled()
    const pluginListeners = listeners.get('internal/plugin') ?? []
    expect(pluginListeners.length).toBe(1)
    const entry = canonicalEntry()
    pluginListeners[0]!({ entry })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
  })

  it('does not use the too-early loader/entry-init options to identify the entry', () => {
    // Real loader order: new Entry() => emit loader/entry-init => entry.update(options).
    // Before update, options are {} and the id getter cannot resolve (no parent).
    const earlyEntry: any = {
      options: {},
      get id() {
        throw new Error('parent not bound yet')
      },
    }
    expect(isCanonicalToolSubagentEntry(earlyEntry)).toBe(false)
    // After options are installed (the internal/plugin signal), it is canonical.
    const entry = canonicalEntry()
    expect(isCanonicalToolSubagentEntry(entry)).toBe(true)
    expect(isCanonicalToolSubagentFiber({ entry })).toBe(true)
  })

  it('is idempotent when internal/plugin fires with multiple canonical fibers', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn(async () => snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    const pluginListeners = listeners.get('internal/plugin') ?? []
    const entry = canonicalEntry()
    pluginListeners[0]?.({
      entry,
      parent: { [Symbol.for('cordis.entry')]: entry },
    })
    pluginListeners[0]?.({ entry: canonicalEntry() })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('retries from loader/partial-dispose when the first scan missed the entry', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn()
      .mockResolvedValueOnce(snapshot({ entryFound: false, hiddenReason: 'entry-missing' }))
      .mockResolvedValueOnce(snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(resolveRuntime).toHaveBeenCalledTimes(1))
    const partialListeners = listeners.get('loader/partial-dispose') ?? []
    expect(partialListeners.length).toBe(1)
    partialListeners[0]?.(canonicalEntry())
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
  })

  it('ignores unrelated loader fibers', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn(async () => snapshot({ entryFound: false, hiddenReason: 'entry-missing' }))
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(resolveRuntime).toHaveBeenCalledTimes(1))
    const pluginListeners = listeners.get('internal/plugin') ?? []
    pluginListeners[0]?.({ entry: { id: 'other', options: { name: 'some-other-plugin' } } })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(register).not.toHaveBeenCalled()
    expect(resolveRuntime).toHaveBeenCalledTimes(1)
  })
})

describe('subagent hidden diagnostics log', () => {
  it('reports entry id, base url, version source and hidden reason', async () => {
    const { ctx } = fakeContext()
    const resolveRuntime = vi.fn(async () => snapshot({
      entryFound: true,
      effectiveVersion: undefined,
      versionSource: 'unknown',
      hiddenReason: 'version-unknown',
      targetEntryId: 'delegation:tool-subagent',
      targetProvider: 'spawn',
      targetToolName: 'subagent',
      targetBaseUrl: 'file:///profile/',
    }))
    const register = vi.fn(async () => {})
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(ctx.logger.warn).toHaveBeenCalled())
    const message = String(ctx.logger.warn.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('entryFound=true')
    expect(message).toContain('targetEntryId=delegation:tool-subagent')
    expect(message).toContain('entryBaseUrl=file:///profile/')
    expect(message).toContain('versionSource=unknown')
    expect(message).toContain('reason=version-unknown')
    expect(register).not.toHaveBeenCalled()
  })
})

  it('retries registration after a canonical entry partial-dispose', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn(async () => snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    const partialListeners = listeners.get('loader/partial-dispose') ?? []
    partialListeners[0]?.(canonicalEntry())
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2))
    expect(resolveRuntime).toHaveBeenCalledTimes(2)
  })
