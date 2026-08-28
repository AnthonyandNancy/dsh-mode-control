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

export interface RuntimeSubagentInput extends SubagentCapabilityInput {
  /** Raw runtime facts from the host service namespace. */
  runtime?: {
    effectiveVersion?: string
    toolSubagentSchemaFields?: string[]
    agentOptionsSchemaFields?: string[]
    modelSelectionSettings?: boolean
    providers?: Array<{ name: string; supportsAgentOptions: boolean }>
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
  const runtime = subagent.runtime
  const subagentCaps = detectSubagentCapabilities({
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
  const resolvedSubagent: SubagentRuntimeCapabilities = runtime?.providers
    ? { ...subagentCaps, providers: runtime.providers }
    : subagentCaps
  return {
    compatFields,
    providerFields,
    modelFields,
    subagent: resolvedSubagent,
  }
}
