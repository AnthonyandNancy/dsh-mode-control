import { describe, expect, it } from 'vitest'
import {
  resolveSubAgentModel,
  type ChildModelTarget,
  type ParentModelContext,
  type SubAgentModelPolicy,
} from '../src/subagent/modelResolver.ts'

describe('resolveSubAgentModel', () => {
  const policy: SubAgentModelPolicy = {
    provider1: {
      'mode1-1': { provider: 'provider1', model: 'mode1-2' },
    },
    provider2: {
      'mode2-1': { provider: 'provider2', model: 'mode2-2' },
    },
  }

  it('maps provider and parent model to the configured child target', () => {
    const parent: ParentModelContext = { provider: 'provider1', model: 'mode1-1' }

    expect(resolveSubAgentModel(parent, policy)).toEqual<ChildModelTarget>({
      provider: 'provider1',
      model: 'mode1-2',
    })
  })

  it('supports mappings for multiple providers', () => {
    const parent: ParentModelContext = { provider: 'provider2', model: 'mode2-1' }

    expect(resolveSubAgentModel(parent, policy)).toEqual({
      provider: 'provider2',
      model: 'mode2-2',
    })
  })

  it('returns undefined for an empty or missing policy', () => {
    const parent: ParentModelContext = { provider: 'provider1', model: 'mode1-1' }

    expect(resolveSubAgentModel(parent, {})).toBeUndefined()
    expect(resolveSubAgentModel(parent)).toBeUndefined()
  })

  it('returns undefined when provider or parent model is not matched', () => {
    expect(resolveSubAgentModel({ provider: 'unknown', model: 'mode1-1' }, policy)).toBeUndefined()
    expect(resolveSubAgentModel({ provider: 'provider1', model: 'unknown' }, policy)).toBeUndefined()
  })

  it('resolves each parent context at call time without retaining a child target', () => {
    const firstParent: ParentModelContext = { provider: 'provider1', model: 'mode1-1' }
    const secondParent: ParentModelContext = { provider: 'provider2', model: 'mode2-1' }

    expect(resolveSubAgentModel(firstParent, policy)).toEqual({ provider: 'provider1', model: 'mode1-2' })
    expect(resolveSubAgentModel(secondParent, policy)).toEqual({ provider: 'provider2', model: 'mode2-2' })
  })

  it('does not mutate the policy or expose its nested target by reference', () => {
    const localPolicy: SubAgentModelPolicy = {
      provider1: {
        'mode1-1': { provider: 'provider1', model: 'mode1-2' },
      },
    }
    const originalPolicy = structuredClone(localPolicy)
    const result = resolveSubAgentModel({ provider: 'provider1', model: 'mode1-1' }, localPolicy)

    expect(result).not.toBe(localPolicy.provider1['mode1-1'])
    if (result) result.model = 'changed'
    expect(localPolicy).toEqual(originalPolicy)
  })

  it('reads the current mapping on every call instead of caching a previous target', () => {
    const localPolicy: SubAgentModelPolicy = {
      provider1: {
        'mode1-1': { provider: 'provider1', model: 'mode1-2' },
      },
    }
    const parent: ParentModelContext = { provider: 'provider1', model: 'mode1-1' }

    expect(resolveSubAgentModel(parent, localPolicy)).toEqual({ provider: 'provider1', model: 'mode1-2' })
    localPolicy.provider1['mode1-1'] = { provider: 'provider1', model: 'mode1-3' }
    expect(resolveSubAgentModel(parent, localPolicy)).toEqual({ provider: 'provider1', model: 'mode1-3' })
  })

  it('preserves exact provider and model strings', () => {
    const parent = { provider: ' Provider ', model: 'model with spaces ' }
    const exactPolicy: SubAgentModelPolicy = {
      ' Provider ': {
        'model with spaces ': { provider: ' Child Provider ', model: 'child model ' },
      },
    }

    expect(resolveSubAgentModel(parent, exactPolicy)).toEqual({
      provider: ' Child Provider ',
      model: 'child model ',
    })
  })
})
