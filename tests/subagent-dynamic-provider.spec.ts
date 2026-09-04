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

  it('leaves the original request unchanged when policy has no match', async () => {
    const original = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: vi.fn(async (request: any) => request) }
    const provider = createDynamicSubagentProvider(original, policy)
    const request = { parent: parent({ provider: 'other', model: 'other-model' }), prompt: 'work', agentOptions: { maxTokens: 123 } }

    await provider.start(request)

    expect(original.start).toHaveBeenCalledWith(request)
  })
})
