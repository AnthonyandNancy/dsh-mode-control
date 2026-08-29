import { describe, expect, it, vi } from 'vitest'
import {
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
  const listeners: Array<(entry: any) => void> = []
  const ctx: any = {
    logger: { warn: vi.fn() },
    on: vi.fn((_name: string, listener: (entry: any) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }),
    effect: vi.fn(),
  }
  return { ctx, listeners }
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

  it('registers later when the tool entry appears after plugin start', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn()
      .mockResolvedValueOnce(snapshot({ entryFound: false, hiddenReason: 'entry-missing' }))
      .mockResolvedValueOnce(snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(resolveRuntime).toHaveBeenCalledTimes(1))
    expect(register).not.toHaveBeenCalled()
    expect(listeners.length).toBe(1)
    listeners[0]!({ id: 'tool-subagent', options: { name: '@deepseek-ai/dsh-tool-subagent' } })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
  })

  it('is idempotent when entry-init fires repeatedly', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn(async () => snapshot())
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    const toolEntry = { id: 'tool-subagent', options: { name: '@deepseek-ai/dsh-tool-subagent' } }
    listeners[0]?.(toolEntry)
    listeners[0]?.(toolEntry)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated loader entries', async () => {
    const { ctx, listeners } = fakeContext()
    const register = vi.fn(async () => {})
    const resolveRuntime = vi.fn(async () => snapshot({ entryFound: false, hiddenReason: 'entry-missing' }))
    startSubagentSettingsRegistration(ctx, { resolveRuntime, register })
    await vi.waitFor(() => expect(resolveRuntime).toHaveBeenCalledTimes(1))
    listeners[0]?.({ id: 'other', options: { name: 'some-other-plugin' } })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(register).not.toHaveBeenCalled()
    expect(resolveRuntime).toHaveBeenCalledTimes(1)
  })
})
