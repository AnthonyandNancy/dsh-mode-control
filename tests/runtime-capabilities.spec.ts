import { describe, expect, it } from 'vitest'
import {
  collectRuntimeCapabilities,
  protocolsForProvider,
  schemaEnumValues,
  schemaObjectKeys,
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
  const modelNode = ref({
    type: 'object',
    dict: {
      id: { type: 'string' },
      input: { type: 'array' },
      contextWindow: { type: 'number' },
      maxTokens: { type: 'number' },
      reasoningEfforts: { type: 'dict' },
      compat: { uid: compatNode },
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
