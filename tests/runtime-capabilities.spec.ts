import { describe, expect, it } from 'vitest'
import {
  collectEnumOptions,
  collectRuntimeCapabilities,
  protocolsForModel,
  protocolsForProvider,
  schemaEnumValues,
  schemaObjectKeys,
  subagentRuntimeFactsFromValue,
  type RuntimeCapabilities,
} from '../src/client/runtime-capabilities.ts'

function ref(node: Record<string, unknown>, refs: Record<number, unknown>): number {
  const uid = Object.keys(refs).length + 1
  refs[uid] = node
  return uid
}

function buildSchema(): unknown {
  const refs: Record<number, unknown> = {}
  const compatNode = ref({
    type: 'object',
    dict: {
      supportsStore: { type: 'boolean' },
      supportsDeveloperRole: { type: 'boolean' },
      forceAdaptiveThinking: { type: 'boolean' },
    },
  }, refs)
  const modelCompatNode = ref({
    type: 'object',
    dict: {
      supportsReasoningEffort: { type: 'boolean' },
    },
  }, refs)
  const modelNode = ref({
    type: 'object',
    dict: {
      id: { type: 'string' },
      input: { type: 'array' },
      contextWindow: { type: 'number' },
      maxTokens: { type: 'number' },
      reasoningEfforts: { type: 'dict' },
      compat: { uid: modelCompatNode },
    },
  }, refs)
  const modelsNode = ref({ type: 'array', inner: { uid: modelNode } }, refs)
  const providerNode = ref({
    type: 'object',
    dict: {
      api: { type: 'string' },
      defaultInput: { type: 'array' },
      defaultContextWindow: { type: 'number' },
      defaultMaxTokens: { type: 'number' },
      reasoning: { type: 'string' },
      thinkingBudgets: { type: 'dict' },
      models: { uid: modelsNode },
      modelOverrides: { type: 'dict' },
      compat: { uid: compatNode },
    },
  }, refs)
  const providersNode = ref({ type: 'dict', inner: { uid: providerNode } }, refs)
  const root = ref({ type: 'object', dict: { providers: { uid: providersNode } } }, refs)
  return { uid: root, refs }
}

describe('schema introspection', () => {
  const schema = buildSchema()

  it('collects provider and model fields', () => {
    const caps = collectRuntimeCapabilities(schema, '0.1.1-rc.2', {})
    expect(caps.providerFields.has('defaultContextWindow')).toBe(true)
    expect(caps.providerFields.has('defaultMaxTokens')).toBe(true)
    expect(caps.modelFields.has('contextWindow')).toBe(true)
    expect(caps.modelFields.has('maxTokens')).toBe(true)
    expect(caps.compatFields.has('supportsStore')).toBe(true)
    expect(caps.compatFields.has('forceAdaptiveThinking')).toBe(true)
  })

  it('keeps provider and model compat schemas separate', () => {
    const caps = collectRuntimeCapabilities(buildSchema(), '0.1.1-rc.2', {}) as RuntimeCapabilities & { modelCompatFields?: Set<string> }
    expect(caps.compatFields.has('supportsStore')).toBe(true)
    expect(caps.modelCompatFields?.has('supportsStore')).toBe(false)
  })

  it('collects enum values from union nodes', () => {
    const refs: Record<number, unknown> = {}
    const enumNode = ref({
      type: 'union',
      list: [
        { type: 'const', value: 'max_tokens' },
        { type: 'const', value: 'max_completion_tokens' },
      ],
    }, refs)
    const root = ref({ type: 'object', dict: { field: { uid: enumNode } } }, refs)
    const schema = { uid: root, refs }
    expect(schemaEnumValues(schema, ['field'])).toEqual(['max_tokens', 'max_completion_tokens'])
  })
})

describe('compat enum option extraction', () => {
  it('collects maxTokensField, thinkingFormat, and cacheControlFormat enums', () => {
    const refs: Record<number, unknown> = {}
    const union = (values: string[]): number => ref({
      type: 'union',
      list: values.map(value => ({ type: 'const', value })),
    }, refs)
    const compat = ref({
      type: 'object',
      dict: {
        maxTokensField: { uid: union(['max_tokens', 'max_completion_tokens']) },
        thinkingFormat: { uid: union(['content', 'reasoning_content']) },
        cacheControlFormat: { uid: union(['anthropic', 'openai']) },
      },
    }, refs)
    const provider = ref({ type: 'object', dict: { compat: { uid: compat } } }, refs)
    const providers = ref({ type: 'dict', inner: { uid: provider } }, refs)
    const root = ref({ type: 'object', dict: { providers: { uid: providers } } }, refs)

    expect(collectEnumOptions({ uid: root, refs })).toEqual({
      maxTokensField: ['max_tokens', 'max_completion_tokens'],
      thinkingFormat: ['content', 'reasoning_content'],
      cacheControlFormat: ['anthropic', 'openai'],
    })
  })

  it('returns empty arrays when the schema has no enum nodes', () => {
    expect(collectEnumOptions(buildSchema())).toEqual({
      maxTokensField: [],
      thinkingFormat: [],
      cacheControlFormat: [],
    })
  })
})

describe('protocol resolution', () => {
  it('resolves protocols from explicit provider api and catalog models', () => {
    const providerConfig = { api: 'anthropic-messages' }
    expect(protocolsForProvider('acme', providerConfig, [])).toContain('anthropic-messages')
  })

  it('resolves catalog protocols without provider name heuristics', () => {
    const catalog = [{
      id: 'acme',
      models: [
        { id: 'a', api: 'openai-completions' },
        { id: 'b', api: 'openai-responses' },
      ],
    }]
    const protocols = protocolsForProvider('acme', {}, catalog)
    expect(protocols).toEqual(expect.arrayContaining(['openai-completions', 'openai-responses']))
  })

  it('returns an empty list when nothing resolves', () => {
    expect(protocolsForProvider('acme', {}, [])).toEqual([])
  })
})

describe('model protocol resolution', () => {
  it('resolves each model from its own catalog api in a mixed catalog', () => {
    const catalog = [{
      id: 'acme',
      models: [
        { id: 'model-a', api: 'openai-completions' },
        { id: 'model-b', api: 'anthropic-messages' },
      ],
    }]
    expect(protocolsForModel('acme', 'model-a', {}, catalog)).toEqual(['openai-completions'])
    expect(protocolsForModel('acme', 'model-b', {}, catalog)).toEqual(['anthropic-messages'])
  })

  it('falls back to the provider explicit api when the model has no api', () => {
    expect(protocolsForModel('acme', 'model-a', { api: 'openai-responses' }, [])).toEqual(['openai-responses'])
  })

  it('uses the model entry/override api when catalog metadata is unavailable', () => {
    const providerConfig = {
      modelOverrides: {
        'model-a': { api: 'anthropic-messages' },
      },
    }
    expect(protocolsForModel('acme', 'model-a', providerConfig, [])).toEqual(['anthropic-messages'])
  })

  it('falls back to the catalog group api only when nothing more specific resolves', () => {
    const catalog = [{
      id: 'acme',
      api: 'openai-completions',
      models: [{ id: 'model-a' }],
    }]
    expect(protocolsForModel('acme', 'model-a', {}, catalog)).toEqual(['openai-completions'])
  })

  it('does not infer protocols from provider or model names', () => {
    expect(protocolsForModel('anthropic', 'claude-3', {}, [])).toEqual([])
  })
})

describe('runtime capabilities shape', () => {
  it('exposes subagent capabilities', () => {
    const caps = collectRuntimeCapabilities(buildSchema(), '0.1.1-rc.2', {
      effectiveVersion: '0.1.1-rc.2',
      toolSubagentSchemaFields: new Set(['provider']),
    })
    const runtime: RuntimeCapabilities = caps
    expect(runtime.subagent.visible).toBe(true)
    expect(runtime.subagent.mode).toBe('legacy-static')
  })
})

describe('nested subagent runtime facts', () => {
  it('unpacks runtime facts from value.runtime instead of the namespace root', () => {
    const facts = subagentRuntimeFactsFromValue({
      agentOptions: { provider: 'p', model: 'm' },
      runtime: {
        effectiveVersion: '0.1.1-rc.2',
        toolSubagentSchemaFields: ['modelSelectionSettings'],
        agentOptionsSchemaFields: ['provider', 'model'],
        modelSelectionSettings: true,
        providers: [
          { name: 'acme', supportsAgentOptions: true },
          { name: 'beta', supportsAgentOptions: false },
        ],
      },
    })

    expect(facts.runtime?.effectiveVersion).toBe('0.1.1-rc.2')
    expect(facts.runtime?.toolSubagentSchemaFields).toEqual(['modelSelectionSettings'])
    expect(facts.runtime?.agentOptionsSchemaFields).toEqual(['provider', 'model'])
    expect(facts.runtime?.modelSelectionSettings).toBe(true)
    expect(facts.runtime?.providers).toEqual([
      { name: 'acme', supportsAgentOptions: true },
      { name: 'beta', supportsAgentOptions: false },
    ])
  })

  it('makes the subagent UI visible from a nested effectiveVersion', () => {
    const facts = subagentRuntimeFactsFromValue({
      runtime: { effectiveVersion: '0.1.1-rc.2' },
    })
    const caps = collectRuntimeCapabilities(buildSchema(), undefined, facts)
    expect(caps.subagent.visible).toBe(true)
    expect(caps.subagent.mode).toBe('legacy-static')
  })

  it('detects native-selection from nested toolSubagentSchemaFields', () => {
    const facts = subagentRuntimeFactsFromValue({
      runtime: {
        effectiveVersion: '0.1.1-rc.2',
        toolSubagentSchemaFields: ['modelSelectionSettings'],
        agentOptionsSchemaFields: ['provider', 'model'],
      },
    })
    const caps = collectRuntimeCapabilities(buildSchema(), undefined, {
      ...facts,
      modelSelectionNamespacePresent: true,
      modelSelectionNamespaceFields: new Set(['enabled', 'allowedModels']),
    })
    expect(caps.subagent.mode).toBe('native-selection')
  })

  it('preserves nested provider supportsAgentOptions through capability detection', () => {
    const facts = subagentRuntimeFactsFromValue({
      runtime: {
        effectiveVersion: '0.1.1-rc.2',
        providers: [
          { name: 'acme', supportsAgentOptions: true },
          { name: 'beta', supportsAgentOptions: false },
        ],
      },
    })
    const caps = collectRuntimeCapabilities(buildSchema(), undefined, facts)
    expect(caps.subagent.providers).toEqual([
      { name: 'acme', supportsAgentOptions: true },
      { name: 'beta', supportsAgentOptions: false },
    ])
  })

  it('fails closed when the runtime block is missing', () => {
    const facts = subagentRuntimeFactsFromValue({})
    expect(facts.runtime?.effectiveVersion).toBeUndefined()
    expect(facts.runtime?.providers).toBeUndefined()
    const caps = collectRuntimeCapabilities(buildSchema(), undefined, facts)
    expect(caps.subagent.visible).toBe(false)
    expect(caps.subagent.providers).toBeUndefined()
  })
})
