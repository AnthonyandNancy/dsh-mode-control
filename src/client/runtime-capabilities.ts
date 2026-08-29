/**
 * Runtime schema capability detection.
 *
 * The client receives serialized Schemastery schemas through
 * `api.settings.describe()`. This module resolves the `{ uid, refs }` envelope,
 * walks object/dict/array/union nodes, and produces the field sets the UI uses
 * to show/hide/disable controls.
 */

import { detectSubagentCapabilities, type SubagentCapabilityInput, type SubagentRuntimeCapabilities } from '../subagent/capabilities.ts'

export interface RuntimeCapabilities {
  compatFields: Set<string>
  modelCompatFields: Set<string>
  providerFields: Set<string>
  modelFields: Set<string>
  subagent: SubagentRuntimeCapabilities
}

type SchemaNode = Record<string, any> | number | undefined

function deref(node: SchemaNode, refs: Record<number, unknown>): Record<string, any> | undefined {
  if (typeof node === 'number') return refs[node] as Record<string, any> | undefined
  if (node && typeof node === 'object') {
    // Reference stub: `{ uid }` without the node body.
    if (node['type'] === undefined && typeof node['uid'] === 'number' && refs[node['uid']]) {
      return refs[node['uid']] as Record<string, any>
    }
    return node as Record<string, any>
  }
  return undefined
}

function resolveRoot(schema: unknown): { node?: Record<string, any>; refs: Record<number, unknown> } {
  const root = schema as Record<string, any> | undefined
  if (!root || typeof root !== 'object') return { refs: {} }
  const refs = root['refs'] && typeof root['refs'] === 'object' ? root['refs'] as Record<number, unknown> : {}
  const uid = root['uid']
  const node = typeof uid === 'number' ? refs[uid] as Record<string, any> | undefined : root as Record<string, any>
  return { node, refs }
}

function child(node: Record<string, any>, key: string, refs: Record<number, unknown>): SchemaNode {
  if (key === 'inner') {
    return deref(node['inner'], refs)
  }
  if (node['type'] === 'object') {
    const dict = node['dict'] as Record<string, unknown> | undefined
    return dict ? deref(dict[key] as SchemaNode, refs) : undefined
  }
  if (node['type'] === 'dict' || node['type'] === 'array') {
    return deref(node['inner'], refs)
  }
  return undefined
}

export function schemaNodeAtPath(schema: unknown, path: readonly string[]): Record<string, any> | undefined {
  const { node, refs } = resolveRoot(schema)
  if (!node) return undefined
  let current: Record<string, any> = node
  for (const segment of path) {
    const next = child(current, segment, refs)
    if (next === undefined) return undefined
    current = next as Record<string, any>
  }
  return current
}

/** Keys of an object schema node at `path`. */
export function schemaObjectKeys(schema: unknown, path: readonly string[]): Set<string> {
  const node = schemaNodeAtPath(schema, path)
  if (!node || node['type'] !== 'object') return new Set()
  const dict = node['dict']
  if (!dict || typeof dict !== 'object') return new Set()
  return new Set(Object.keys(dict))
}

/** Enum/const values of a union schema node at `path`. */
export function schemaEnumValues(schema: unknown, path: readonly string[]): string[] {
  const node = schemaNodeAtPath(schema, path)
  if (!node) return []
  const list = node['type'] === 'union' || node['type'] === 'enum'
    ? node['list']
    : undefined
  if (!Array.isArray(list)) return []
  const values: string[] = []
  for (const item of list) {
    const entry = deref(item as SchemaNode, (schema as Record<string, any>)?.['refs'] ?? {})
    const value = entry?.['value'] ?? entry?.['const'] ?? (typeof entry === 'string' ? entry : undefined)
    if (typeof value === 'string') values.push(value)
  }
  return values
}

export interface CompatEnumOptions {
  maxTokensField: string[]
  thinkingFormat: string[]
  cacheControlFormat: string[]
}

/** Extract the schema-driven enum options the compat renderer needs. */
export function collectEnumOptions(schema: unknown): CompatEnumOptions {
  return {
    maxTokensField: schemaEnumValues(schema, ['providers', 'inner', 'compat', 'maxTokensField']),
    thinkingFormat: schemaEnumValues(schema, ['providers', 'inner', 'compat', 'thinkingFormat']),
    cacheControlFormat: schemaEnumValues(schema, ['providers', 'inner', 'compat', 'cacheControlFormat']),
  }
}

/**
 * Resolve wire protocols for a provider from explicit `api` and catalog
 * metadata. Provider-name heuristics are intentionally forbidden.
 */
export function protocolsForProvider(
  provider: string,
  providerConfig: unknown,
  catalogGroups: unknown[],
): string[] {
  const protocols = new Set<string>()
  const cfg = providerConfig as Record<string, unknown> | null | undefined
  if (cfg && typeof cfg === 'object' && typeof cfg['api'] === 'string') {
    protocols.add(cfg['api'])
  }
  for (const group of Array.isArray(catalogGroups) ? catalogGroups : []) {
    const g = group as Record<string, unknown> | null | undefined
    if (!g || g['id'] !== provider) continue
    if (typeof g['api'] === 'string') protocols.add(g['api'])
    for (const model of Array.isArray(g['models']) ? g['models'] : []) {
      const m = model as Record<string, unknown> | null | undefined
      if (m && typeof m['api'] === 'string') protocols.add(m['api'])
    }
  }
  return [...protocols]
}

function modelRecordOf(providerConfig: unknown, model: string): Record<string, unknown> | undefined {
  const cfg = recordOf(providerConfig)
  for (const item of Array.isArray(cfg['models']) ? cfg['models'] : []) {
    const entry = recordOf(item)
    if (entry['id'] === model) return entry
  }
  const override = recordOf(cfg['modelOverrides'])[model]
  return override !== null && typeof override === 'object' && !Array.isArray(override)
    ? override as Record<string, unknown>
    : undefined
}

/**
 * Resolve the wire protocol for one selected model.
 *
 * Priority (never provider/model name heuristics):
 * 1. the model's own catalog `api`;
 * 2. the provider explicit `api`;
 * 3. the model entry/override `api`;
 * 4. a catalog group `api` only as a safe fallback.
 *
 * Unlike `protocolsForProvider`, this returns the model's protocol, so a mixed
 * OpenAI/Anthropic catalog never shows one model's fields on another model.
 */
export function protocolsForModel(
  provider: string,
  model: string,
  providerConfig: unknown,
  catalogGroups: unknown[],
): string[] {
  const cfg = recordOf(providerConfig)
  for (const group of Array.isArray(catalogGroups) ? catalogGroups : []) {
    const g = recordOf(group)
    if (g['id'] !== provider) continue
    for (const item of Array.isArray(g['models']) ? g['models'] : []) {
      const m = recordOf(item)
      if (m['id'] === model && typeof m['api'] === 'string') return [m['api'] as string]
    }
  }
  if (typeof cfg['api'] === 'string') return [cfg['api'] as string]
  const modelConfig = modelRecordOf(providerConfig, model)
  if (modelConfig && typeof modelConfig['api'] === 'string') return [modelConfig['api'] as string]
  for (const group of Array.isArray(catalogGroups) ? catalogGroups : []) {
    const g = recordOf(group)
    if (g['id'] === provider && typeof g['api'] === 'string') return [g['api'] as string]
  }
  return []
}

export interface RuntimeSubagentInput extends SubagentCapabilityInput {
  /** Raw runtime facts from the host service namespace. */
  runtime?: {
    effectiveVersion?: string
    versionSource?: string
    hiddenReason?: string
    targetEntryId?: string
    targetToolName?: string
    targetProvider?: string
    targetBaseUrl?: string
    entryFound?: boolean
    toolSubagentSchemaFields?: string[]
    agentOptionsSchemaFields?: string[]
    modelSelectionSettings?: boolean
    providers?: Array<{ name: string; supportsAgentOptions: boolean }>
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Unpack the subagent runtime facts that the host service stores under
 * `value.runtime`. The namespace root also contains writable fields
 * (`agentOptions`, `modelSelectionSettings`), so the client must read the
 * nested runtime block for capability detection.
 */
export function subagentRuntimeFactsFromValue(value: unknown): RuntimeSubagentInput {
  const runtime = recordOf(recordOf(value)['runtime'])
  const providers: Array<{ name: string; supportsAgentOptions: boolean }> = []
  for (const item of Array.isArray(runtime['providers']) ? runtime['providers'] : []) {
    const provider = recordOf(item)
    if (typeof provider['name'] !== 'string' || provider['name'] === '') continue
    providers.push({
      name: provider['name'],
      supportsAgentOptions: provider['supportsAgentOptions'] !== false,
    })
  }
  return {
    runtime: {
      effectiveVersion: typeof runtime['effectiveVersion'] === 'string'
        ? runtime['effectiveVersion'] as string
        : undefined,
      versionSource: typeof runtime['versionSource'] === 'string'
        ? runtime['versionSource'] as string
        : undefined,
      hiddenReason: typeof runtime['hiddenReason'] === 'string'
        ? runtime['hiddenReason'] as string
        : undefined,
      targetEntryId: typeof runtime['targetEntryId'] === 'string'
        ? runtime['targetEntryId'] as string
        : undefined,
      targetToolName: typeof runtime['targetToolName'] === 'string'
        ? runtime['targetToolName'] as string
        : undefined,
      targetProvider: typeof runtime['targetProvider'] === 'string'
        ? runtime['targetProvider'] as string
        : undefined,
      targetBaseUrl: typeof runtime['targetBaseUrl'] === 'string'
        ? runtime['targetBaseUrl'] as string
        : undefined,
      entryFound: typeof runtime['entryFound'] === 'boolean'
        ? runtime['entryFound'] as boolean
        : undefined,
      toolSubagentSchemaFields: Array.isArray(runtime['toolSubagentSchemaFields'])
        ? (runtime['toolSubagentSchemaFields'] as string[])
        : undefined,
      agentOptionsSchemaFields: Array.isArray(runtime['agentOptionsSchemaFields'])
        ? (runtime['agentOptionsSchemaFields'] as string[])
        : undefined,
      modelSelectionSettings: typeof runtime['modelSelectionSettings'] === 'boolean'
        ? runtime['modelSelectionSettings'] as boolean
        : undefined,
      providers: providers.length > 0 ? providers : undefined,
    },
  }
}

/**
 * Build the full runtime capability set from a serialized settings schema and
 * subagent facts.
 */
export function collectRuntimeCapabilities(
  schema: unknown,
  _hostVersion: string | undefined,
  subagent: RuntimeSubagentInput,
): RuntimeCapabilities {
  const providerFields = schemaObjectKeys(schema, ['providers', 'inner'])
  const modelFields = new Set<string>([
    ...schemaObjectKeys(schema, ['providers', 'inner', 'models', 'inner']),
    ...schemaObjectKeys(schema, ['providers', 'inner', 'modelOverrides', 'inner']),
  ])
  const compatFields = schemaObjectKeys(schema, ['providers', 'inner', 'compat'])
  const modelCompatFields = new Set<string>([
    ...schemaObjectKeys(schema, ['providers', 'inner', 'models', 'inner', 'compat']),
    ...schemaObjectKeys(schema, ['providers', 'inner', 'modelOverrides', 'inner', 'compat']),
  ])
  const runtime = subagent.runtime
  const subagentCaps = detectSubagentCapabilities({
    entryFound: subagent.entryFound ?? runtime?.entryFound,
    effectiveVersion: subagent.effectiveVersion ?? runtime?.effectiveVersion,
    toolSubagentSchemaFields: subagent.toolSubagentSchemaFields ?? (
      runtime?.toolSubagentSchemaFields ? new Set(runtime.toolSubagentSchemaFields) : undefined
    ),
    agentOptionsSchemaFields: subagent.agentOptionsSchemaFields ?? (
      runtime?.agentOptionsSchemaFields ? new Set(runtime.agentOptionsSchemaFields) : undefined
    ),
    modelSelectionNamespacePresent: subagent.modelSelectionNamespacePresent,
    modelSelectionNamespaceFields: subagent.modelSelectionNamespaceFields,
    supportsAgentOptions: subagent.supportsAgentOptions,
    modelSelectionSettings: subagent.modelSelectionSettings ?? runtime?.modelSelectionSettings,
  })
  const resolvedSubagent: SubagentRuntimeCapabilities = {
    ...subagentCaps,
    ...(runtime?.entryFound !== undefined ? { entryFound: runtime.entryFound } : {}),
    ...(runtime?.versionSource ? { versionSource: runtime.versionSource } : {}),
    ...(runtime?.hiddenReason ? { hiddenReason: runtime.hiddenReason } : {}),
    ...(runtime?.targetEntryId ? { targetEntryId: runtime.targetEntryId } : {}),
    ...(runtime?.targetToolName ? { targetToolName: runtime.targetToolName } : {}),
    ...(runtime?.targetProvider ? { targetProvider: runtime.targetProvider } : {}),
    ...(runtime?.targetBaseUrl ? { targetBaseUrl: runtime.targetBaseUrl } : {}),
    ...(runtime?.providers ? { providers: runtime.providers } : {}),
  }
  return {
    compatFields,
    modelCompatFields,
    providerFields,
    modelFields,
    subagent: resolvedSubagent,
  }
}
