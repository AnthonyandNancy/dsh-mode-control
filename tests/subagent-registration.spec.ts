import { describe, expect, it, vi } from 'vitest'
import {
  SubagentControlSchema,
  applySubagentControl,
  findToolSubagentEntries,
  resolveSubagentRuntime,
  selectCanonicalToolSubagentEntry,
  type ToolSubagentEntryMatch,
} from '../src/subagent/config-service.ts'
import {
  installDynamicSubagentRouting,
  registerDynamicSubagentProvider,
} from '../src/subagent/registration.ts'

function makeEntry(entryId: string, config: Record<string, unknown>) {
  const entry: any = {
    options: {
      id: entryId,
      name: '@deepseek-ai/dsh-tool-subagent',
      version: '0.1.1-rc.2',
      config,
    },
    parent: { tree: { ctx: { baseUrl: 'file:///profile/' } } },
    update: vi.fn(async () => {}),
  }
  Object.defineProperty(entry, 'id', { get: () => entry.options.id })
  return entry
}

function ctxWithEntries(entries: any[]) {
  return {
    loader: {
      entries: () => entries,
      import: vi.fn(async () => ({ Config: {} })),
    },
    logger: { warn: vi.fn() },
  }
}

describe('canonical tool-subagent entry selection', () => {
  const fork = makeEntry('delegation:tool-subagent-fork', { provider: 'fork', toolName: 'subagent_fork' })
  const canonical = makeEntry('delegation:tool-subagent', { provider: 'spawn', toolName: 'subagent' })
  const codex = makeEntry('tool-subagent-codex', { provider: 'codex', toolName: 'subagent_codex' })

  it('finds every package-name match but selects the plain subagent instance', () => {
    const ctx = ctxWithEntries([fork, canonical, codex])
    const matches = findToolSubagentEntries(ctx)
    expect(matches.map(match => match.id)).toEqual([
      'delegation:tool-subagent-fork',
      'delegation:tool-subagent',
      'tool-subagent-codex',
    ])
    const selected = selectCanonicalToolSubagentEntry(ctx)
    expect(selected?.id).toBe('delegation:tool-subagent')
    expect(selected?.provider).toBe('spawn')
    expect(selected?.toolName).toBe('subagent')
  })

  it('prefers an exact root id over nested/fallback entries', () => {
    const ctx = ctxWithEntries([
      makeEntry('tool-subagent-codex', { provider: 'codex', toolName: 'subagent_codex' }),
      makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' }),
    ])
    expect(selectCanonicalToolSubagentEntry(ctx)?.id).toBe('tool-subagent')
  })

  it('records the target identity in the runtime snapshot', async () => {
    const ctx = ctxWithEntries([fork, canonical, codex])
    const snapshot = await resolveSubagentRuntime(ctx)
    expect(snapshot.entryFound).toBe(true)
    expect(snapshot.effectiveVersion).toBe('0.1.1-rc.2')
    expect(snapshot.targetEntryId).toBe('delegation:tool-subagent')
    expect(snapshot.targetToolName).toBe('subagent')
    expect(snapshot.targetProvider).toBe('spawn')
    expect(snapshot.versionSource).toBe('loader')
    expect(snapshot.hiddenReason).toBeUndefined()
  })

  it('applies control through the same canonical entry, never the fork', async () => {
    const ctx = ctxWithEntries([fork, canonical, codex])
    const result = await applySubagentControl(ctx, {
      agentOptions: { provider: 'location', model: 'grok-4.6', maxTokens: 8192 },
    })
    expect(result.applied).toBe(true)
    expect(canonical.update).toHaveBeenCalledWith({ config: expect.objectContaining({
      agentOptions: expect.objectContaining({ provider: 'location', model: 'grok-4.6' }),
    }) })
    expect(fork.update).not.toHaveBeenCalled()
    expect(codex.update).not.toHaveBeenCalled()
  })
})

describe('runtime schema diagnostics fields', () => {
  it('declares every host diagnostic field on the runtime schema', () => {
    const runtimeShape = (SubagentControlSchema as any).dict.runtime.dict
    for (const key of ['effectiveVersion', 'versionSource', 'hiddenReason', 'targetEntryId', 'targetToolName', 'targetProvider', 'targetBaseUrl']) {
      expect(Object.keys(runtimeShape)).toContain(key)
    }
  })

  it('keeps diagnostics through schemastery simplification', () => {
    const serialized: any = (SubagentControlSchema as any).simplify({
      runtime: {
        effectiveVersion: '0.1.1-rc.2',
        versionSource: 'entry-base-package',
        hiddenReason: 'version-unknown',
        targetEntryId: 'delegation:tool-subagent',
        targetToolName: 'subagent',
        targetProvider: 'spawn',
        targetBaseUrl: 'file:///profile/',
        entryFound: true,
        toolSubagentSchemaFields: [],
        agentOptionsSchemaFields: [],
        providers: [],
      },
      agentOptions: { provider: 'p', model: 'm' },
      modelSelectionSettings: false,
    })
    expect(serialized.runtime.versionSource).toBe('entry-base-package')
    expect(serialized.runtime.hiddenReason).toBe('version-unknown')
    expect(serialized.runtime.targetEntryId).toBe('delegation:tool-subagent')
    expect(serialized.runtime.targetToolName).toBe('subagent')
    expect(serialized.runtime.targetProvider).toBe('spawn')
    expect(serialized.runtime.targetBaseUrl).toBe('file:///profile/')
  })
})

describe('registerDynamicSubagentProvider', () => {
  it('wraps the named original provider and registers it', () => {
    const original = {
      name: 'spawn',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: vi.fn(),
    }
    const registerProvider = vi.fn(() => () => {})
    const getProvider = vi.fn((name: string) => name === 'spawn' ? original : undefined)
    const subagents = { getProvider, registerProvider }
    const policy = { p: { m: { provider: 'p', model: 'child' } } }

    const dispose = registerDynamicSubagentProvider(subagents, 'spawn', policy)

    expect(registerProvider).toHaveBeenCalledOnce()
    expect(registerProvider.mock.calls[0]?.[0].name).toBe('dynamic-spawn')
    expect(dispose).toBeTypeOf('function')
  })

  it('does not register when the original provider is absent', () => {
    const registerProvider = vi.fn()
    const subagents = { getProvider: vi.fn(() => undefined), registerProvider }

    expect(registerDynamicSubagentProvider(subagents, 'spawn', {})).toBeUndefined()
    expect(registerProvider).not.toHaveBeenCalled()
  })

  it('binds the canonical entry to the dynamic provider and preserves config', () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const registerProvider = vi.fn(() => () => {})
    const getProvider = vi.fn((name: string) => name === 'spawn' ? original : undefined)
    const subagents = { getProvider, registerProvider }
    const entry = { id: 'tool-subagent', options: { config: { provider: 'spawn', toolName: 'subagent', maxDepth: 3 } }, update: vi.fn() }

    const result = installDynamicSubagentRouting({ subagents, loader: { entries: () => [entry] } }, {})

    expect(result.installed).toBe(true)
    expect(entry.update).toHaveBeenCalledWith({ config: { provider: 'dynamic-spawn', toolName: 'subagent', maxDepth: 3 } })
  })
})
