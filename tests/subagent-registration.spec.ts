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
  startDynamicSubagentRegistration,
} from '../src/subagent/registration.ts'
import { DYNAMIC_PROVIDER_MARKER } from '../src/subagent/dynamic-provider.ts'

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

  it('binds the canonical entry to the dynamic provider and preserves config', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const registerProvider = vi.fn(() => () => {})
    const getProvider = vi.fn((name: string) => name === 'spawn' ? original : undefined)
    const subagents = { getProvider, registerProvider }
    const entry = { id: 'tool-subagent', options: { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent', maxDepth: 3 } }, update: vi.fn() }

    const result = await installDynamicSubagentRouting({ subagents, loader: { entries: () => [entry] } }, {})

    expect(result.installed).toBe(true)
    expect(entry.update).toHaveBeenCalledWith({ config: { provider: 'dynamic-spawn', toolName: 'subagent', maxDepth: 3 } })
  })

  it('keeps continuable entries usable without injecting one-shot policy options', async () => {
    const prepareContinuable = vi.fn(async () => ({ seed: 'original' }))
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, prepareContinuable, start: vi.fn() }
    const registerProvider = vi.fn(() => () => {})
    const getProvider = vi.fn((name: string) => name === 'spawn' ? original : undefined)
    const subagents = { getProvider, registerProvider }
    const entry = { id: 'tool-subagent', options: { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable' } }, update: vi.fn() }

    const result = await installDynamicSubagentRouting({ subagents, loader: { entries: () => [entry] } }, {})
    const dynamic = registerProvider.mock.calls[0]?.[0]

    expect(result.installed).toBe(true)
    expect(entry.update).toHaveBeenCalledWith({ config: { provider: 'dynamic-spawn', toolName: 'subagent', backgroundMode: 'continuable' } })
    await expect(dynamic.prepareContinuable({ parent: {} })).resolves.toEqual({ seed: 'original' })
    expect(prepareContinuable).toHaveBeenCalledWith({ parent: {} })
  })

  it('rejects invalid policy targets before registering or rebinding', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const registerProvider = vi.fn(() => () => {})
    const subagents = { getProvider: vi.fn((name: string) => name === 'spawn' ? original : undefined), registerProvider }
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    const resolveCallConfig = vi.fn(async () => { throw new Error('unknown target') })

    const result = await installDynamicSubagentRouting({ subagents, loader: { entries: () => [entry] }, llm: { resolveCallConfig } }, {
      provider1: { model1: { provider: 'provider2', model: 'child2' } },
    })

    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'provider2', model: 'child2' })
    expect(result.installed).toBe(false)
    expect(registerProvider).not.toHaveBeenCalled()
    expect(entry.update).not.toHaveBeenCalled()
  })

  it('shares a wrapper safely across duplicate lifecycles', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const providers = new Map<string, any>([['spawn', original]])
    const disposeProvider = vi.fn(() => { providers.delete('dynamic-spawn') })
    const registerProvider = vi.fn((provider: any) => {
      providers.set(provider.name, provider)
      return disposeProvider
    })
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    entry.update = vi.fn(async ({ config }: any) => { entry.options.config = config })
    const ctx: any = {
      loader: { entries: () => [entry] },
      subagents: { getProvider: (name: string) => providers.get(name), registerProvider },
      on: vi.fn(() => () => {}),
      effect: vi.fn(),
    }
    const policy = { provider1: { model1: { provider: 'provider2', model: 'child2' } } }

    startDynamicSubagentRegistration(ctx, policy)
    await vi.waitFor(() => expect(entry.options.config.provider).toBe('dynamic-spawn'))
    startDynamicSubagentRegistration(ctx, policy)
    await new Promise(resolve => setTimeout(resolve, 0))

    const firstCleanup = ctx.effect.mock.calls[0]?.[0]()
    await firstCleanup()
    expect(disposeProvider).not.toHaveBeenCalled()
    expect(providers.get('dynamic-spawn')).toBeDefined()
    expect(entry.options.config.provider).toBe('dynamic-spawn')

    const secondCleanup = ctx.effect.mock.calls[1]?.[0]()
    await secondCleanup()
    expect(disposeProvider).toHaveBeenCalledOnce()
    expect(providers.get('dynamic-spawn')).toBeUndefined()
    expect(entry.options.config.provider).toBe('spawn')
  })

  it('does not bind a stale wrapper when the original provider disappears during preflight', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const staleDynamic = { name: 'dynamic-spawn', [DYNAMIC_PROVIDER_MARKER]: true, start: vi.fn() }
    const providers = new Map<string, any>([['spawn', original], ['dynamic-spawn', staleDynamic]])
    let release!: () => void
    const preflight = new Promise<void>(resolve => { release = resolve })
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    const registerProvider = vi.fn()
    const ctx = {
      loader: { entries: () => [entry] },
      subagents: { getProvider: (name: string) => providers.get(name), registerProvider },
      llm: { resolveCallConfig: vi.fn(() => preflight) },
    }

    const pending = installDynamicSubagentRouting(ctx, {
      provider1: { model1: { provider: 'provider2', model: 'child2' } },
    })
    providers.delete('spawn')
    release()
    const result = await pending

    expect(result.installed).toBe(false)
    expect(entry.update).not.toHaveBeenCalled()
    expect(registerProvider).not.toHaveBeenCalled()
  })

  it('reports an Entry.update rejection without an unhandled promise', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const registerProvider = vi.fn(() => () => {})
    const getProvider = vi.fn((name: string) => name === 'spawn' ? original : undefined)
    const subagents = { getProvider, registerProvider }
    const warn = vi.fn()
    const entry = { id: 'tool-subagent', options: { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent' } }, update: vi.fn(async () => { throw new Error('update failed') }) }

    const result = await installDynamicSubagentRouting({ subagents, loader: { entries: () => [entry] }, logger: { warn } }, {})

    expect(result.installed).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('update failed'))
  })

  it('retries when the original provider is added after startup', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const providers = new Map<string, any>()
    const registerProvider = vi.fn((provider: any) => {
      providers.set(provider.name, provider)
      return () => { providers.delete(provider.name) }
    })
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    const ctx: any = {
      loader: { entries: () => [entry] },
      subagents: { getProvider: (name: string) => providers.get(name), registerProvider },
      on: vi.fn((name: string, listener: Function) => {
        if (name === 'subagent/provider-added') ctx.providerAdded = listener
        return () => {}
      }),
      effect: vi.fn(),
    }

    startDynamicSubagentRegistration(ctx, { provider1: { model1: { provider: 'provider2', model: 'child2' } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    providers.set('spawn', original)
    expect(ctx.providerAdded).toBeTypeOf('function')
    ctx.providerAdded(original)
    await vi.waitFor(() => expect(registerProvider).toHaveBeenCalled())
    await vi.waitFor(() => expect(ctx.loader.entries()[0].update).toHaveBeenCalledWith({ config: { provider: 'dynamic-spawn', toolName: 'subagent' } }))
  })

  it('does not recreate the wrapper when the dynamic provider is removed during cleanup', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const providers = new Map<string, any>([['spawn', original]])
    const registerProvider = vi.fn((provider: any) => {
      providers.set(provider.name, provider)
      return () => { providers.delete(provider.name) }
    })
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    const listeners = new Map<string, Function>()
    const ctx: any = {
      loader: { entries: () => [entry] },
      subagents: { getProvider: (name: string) => providers.get(name), registerProvider },
      on: vi.fn((name: string, listener: Function) => { listeners.set(name, listener); return () => {} }),
      effect: vi.fn(),
    }

    startDynamicSubagentRegistration(ctx, { provider1: { model1: { provider: 'provider2', model: 'child2' } } })
    await vi.waitFor(() => expect(entry.update).toHaveBeenCalledWith({ config: { provider: 'dynamic-spawn', toolName: 'subagent' } }))
    const beforeRemoval = registerProvider.mock.calls.length
    listeners.get('subagent/provider-removed')?.('dynamic-spawn')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(registerProvider).toHaveBeenCalledTimes(beforeRemoval)
  })

  it('cleans a stale wrapper when a later registration receives an empty policy', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const providers = new Map<string, any>([['spawn', original]])
    const disposeProvider = vi.fn(() => { providers.delete('dynamic-spawn') })
    const registerProvider = vi.fn((provider: any) => {
      providers.set(provider.name, provider)
      return disposeProvider
    })
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    entry.update = vi.fn(async ({ config }: any) => { entry.options.config = config })
    const ctx: any = {
      loader: { entries: () => [entry] },
      subagents: { getProvider: (name: string) => providers.get(name), registerProvider },
      on: vi.fn(() => () => {}),
      effect: vi.fn(),
    }

    startDynamicSubagentRegistration(ctx, { provider1: { model1: { provider: 'provider2', model: 'child2' } } })
    await vi.waitFor(() => expect(entry.options.config.provider).toBe('dynamic-spawn'))
    startDynamicSubagentRegistration(ctx, {})
    await vi.waitFor(() => expect(disposeProvider).toHaveBeenCalledOnce())

    expect(providers.get('dynamic-spawn')).toBeUndefined()
    expect(entry.options.config.provider).toBe('spawn')
  })

  it('restores the canonical entry and disposes the wrapper on lifecycle cleanup', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const providers = new Map<string, any>([['spawn', original]])
    const disposeProvider = vi.fn(() => { providers.delete('dynamic-spawn') })
    const registerProvider = vi.fn((provider: any) => {
      providers.set(provider.name, provider)
      return disposeProvider
    })
    const entry = makeEntry('tool-subagent', { provider: 'spawn', toolName: 'subagent' })
    const ctx: any = {
      loader: { entries: () => [entry] },
      subagents: { getProvider: (name: string) => providers.get(name), registerProvider },
      on: vi.fn(() => () => {}),
      effect: vi.fn(),
    }

    startDynamicSubagentRegistration(ctx, { provider1: { model1: { provider: 'provider2', model: 'child2' } } })
    await vi.waitFor(() => expect(entry.update).toHaveBeenCalledWith({ config: { provider: 'dynamic-spawn', toolName: 'subagent' } }))
    const cleanup = ctx.effect.mock.calls[0]?.[0]()
    await cleanup()

    expect(disposeProvider).toHaveBeenCalledOnce()
    expect(providers.get('dynamic-spawn')).toBeUndefined()
    expect(entry.update).toHaveBeenLastCalledWith({ config: { provider: 'spawn', toolName: 'subagent' } })
  })
})
