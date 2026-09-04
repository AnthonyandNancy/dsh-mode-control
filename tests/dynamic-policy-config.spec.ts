import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('dynamic subagent policy config', () => {
  it('defaults to an empty policy and spawn provider', () => {
    expect(Config({})).toMatchObject({ subAgentModelPolicy: {} })
  })

  it('resolves nested provider/model targets', () => {
    expect(Config({
      subAgentModelPolicy: {
        provider1: { model1: { provider: 'provider2', model: 'model2' } },
      },
    })).toMatchObject({
      subAgentModelPolicy: {
        provider1: { model1: { provider: 'provider2', model: 'model2' } },
      },
    })
  })
})
