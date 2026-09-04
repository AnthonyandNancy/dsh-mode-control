import { describe, expect, it, vi } from 'vitest'
import {
  createDynamicSubagentProvider,
  currentParentModel,
} from '../src/subagent/dynamic-provider.ts'
import type { SubAgentModelPolicy } from '../src/subagent/modelResolver.ts'

function parent(options: Record<string, unknown>, header?: Record<string, unknown>) {
  return {
    options,
    session: {
      requestHeader: () => header === undefined ? undefined : { config: header },
    },
  }
}

describe('currentParentModel', () => {
  it('prefers the latest request header route over creation options', () => {
    expect(currentParentModel(parent(
      { provider: 'created-provider', model: 'created-model' },
      { provider: 'current-provider', model: 'current-model' },
    ))).toEqual({ provider: 'current-provider', model: 'current-model' })
  })

  it('falls back to creation options before the first request', () => {
    expect(currentParentModel(parent({ provider: 'created-provider', model: 'created-model' })))
      .toEqual({ provider: 'created-provider', model: 'created-model' })
  })

  it('returns undefined when no complete parent route exists', () => {
    expect(currentParentModel(parent({ provider: 'created-provider' }))).toBeUndefined()
  })
})

describe('createDynamicSubagentProvider', () => {
  const policy: SubAgentModelPolicy = {
    provider1: {
      model1: { provider: 'provider1', model: 'child1' },
    },
    provider2: {
      model2: { provider: 'provider2', model: 'child2' },
    },
  }

  it('maps each start request from the parent route and preserves other options', async () => {
    const original = {
      name: 'spawn',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      start: vi.fn(async (request: any) => request),
    }
    const provider = createDynamicSubagentProvider(original, policy)
    const request = {
      parent: parent({ provider: 'created', model: 'created' }, { provider: 'provider1', model: 'model1' }),
      prompt: 'work',
      agentOptions: { maxTokens: 123 },
    }

    await provider.start(request)

    expect(original.start).toHaveBeenCalledWith({
      ...request,
      agentOptions: { maxTokens: 123, provider: 'provider1', model: 'child1' },
    })
    expect(provider.capabilities).toEqual(original.capabilities)
    expect(provider.inheritsParentContext).toBe(original.inheritsParentContext)
  })

  it('re-resolves after the parent request route changes', async () => {
    let header: Record<string, unknown> = { provider: 'provider1', model: 'model1' }
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: vi.fn(async (request: any) => request) }
    const provider = createDynamicSubagentProvider(original, policy)
    const parentAgent = { options: { provider: 'provider1', model: 'model1' }, session: { requestHeader: () => ({ config: header }) } }

    await provider.start({ parent: parentAgent, prompt: 'first' })
    header = { provider: 'provider2', model: 'model2' }
    await provider.start({ parent: parentAgent, prompt: 'second' })

    expect(original.start.mock.calls[0]?.[0].agentOptions).toEqual({ provider: 'provider1', model: 'child1' })
    expect(original.start.mock.calls[1]?.[0].agentOptions).toEqual({ provider: 'provider2', model: 'child2' })
  })

  it('runs optional target validation before delegating', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const validateTarget = vi.fn(() => { throw new Error('unknown model') })
    const provider = createDynamicSubagentProvider(original, policy, { validateTarget })

    await expect(provider.start({ parent: parent({ provider: 'provider1', model: 'model1' }) })).rejects.toThrow('unknown model')
    expect(validateTarget).toHaveBeenCalledWith({ provider: 'provider1', model: 'child1' })
    expect(original.start).not.toHaveBeenCalled()
  })

  it('rejects an in-flight start if the source changes during target validation', async () => {
    let releaseValidation!: () => void
    const validation = new Promise<void>(resolve => { releaseValidation = resolve })
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const replacement = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const provider = createDynamicSubagentProvider(original, policy, { validateTarget: () => validation })
    const pending = provider.start({ parent: parent({ provider: 'provider1', model: 'model1' }) })

    provider.updateDynamicSource?.(replacement, policy)
    releaseValidation()

    await expect(pending).rejects.toThrow('source changed during validation')
    expect(original.start).not.toHaveBeenCalled()
    expect(replacement.start).not.toHaveBeenCalled()
  })

  it('updates the source and policy without recreating the wrapper', async () => {
    const first = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn(async (request: any) => request) }
    const second = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn(async (request: any) => request) }
    const provider = createDynamicSubagentProvider(first, policy)
    provider.updateDynamicSource?.(second, { provider1: { model1: { provider: 'provider2', model: 'child2' } } })

    await provider.start({ parent: parent({ provider: 'provider1', model: 'model1' }) })

    expect(first.start).not.toHaveBeenCalled()
    expect(second.start).toHaveBeenCalledOnce()
    expect(second.start.mock.calls[0]?.[0]).toMatchObject({
      agentOptions: { provider: 'provider2', model: 'child2' },
    })
  })

  it('fails closed when the source provider is removed', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, inheritsParentContext: false, start: vi.fn() }
    const provider = createDynamicSubagentProvider(original, policy)
    provider.disposeDynamicSource?.()

    await expect(provider.start({ parent: parent({ provider: 'provider1', model: 'model1' }) }))
      .rejects.toThrow('has no source provider')
  })

  it('leaves the original request unchanged when policy has no match', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: vi.fn(async (request: any) => request) }
    const provider = createDynamicSubagentProvider(original, policy)
    const request = { parent: parent({ provider: 'other', model: 'other-model' }), prompt: 'work', agentOptions: { maxTokens: 123 } }

    await provider.start(request)

    expect(original.start).toHaveBeenCalledWith(request)
  })
})
