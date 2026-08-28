/**
 * Host-side subagent model control service.
 *
 * The client never talks to the cordis loader directly. Instead this service
 * owns a small, auditable settings namespace (`dsh-mode-control.subagent`)
 * whose only writable surfaces are:
 *
 * - `agentOptions`            → legacy fixed child model (provider/model/maxTokens)
 * - `modelSelectionSettings`  → native tool-instance toggle (when supported)
 *
 * Every write is applied through the official loader `Entry.update()` API,
 * which merges options, restarts the entry as needed, and persists through the
 * parent tree. The service never rewrites `node_modules`, never string-edits
 * `cordis.yml`, and never opens arbitrary files.
 */

import { createRequire } from 'node:module'
import z from 'schemastery'
import { SUBAGENT_NAMESPACE, TOOL_ENTRY_ID } from './constants.ts'
import { isSubagentVisible } from './version.ts'

// Host context is intentionally loosely typed here: the loader/settings seams
// are runtime-injected and their exact types come from the DSH host bundle.
type HostContext = any

export { SUBAGENT_NAMESPACE, TOOL_ENTRY_ID }

export interface SubagentProviderSnapshot {
  name: string
  supportsAgentOptions: boolean
}

export interface SubagentRuntimeSnapshot {
  /** Effective `@deepseek-ai/dsh-tool-subagent` version when reliably known. */
  effectiveVersion?: string
  /** Whether a tool-subagent loader entry exists (even if disabled). */
  entryFound: boolean
  /** Top-level keys of the loaded tool-subagent Config schema. */
  toolSubagentSchemaFields: string[]
  /** Keys of the loaded tool-subagent `agentOptions` schema. */
  agentOptionsSchemaFields: string[]
  /** Current `modelSelectionSettings` value from the tool entry config. */
  modelSelectionSettings?: boolean
  /** Registered subagent backends and whether each accepts agentOptions. */
  providers: SubagentProviderSnapshot[]
}

const AgentOptionsSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(undefined as unknown as number),
  reasoningEffort: z.string().default(undefined as unknown as string),
}).default(undefined as unknown as {
  provider: string
  model: string
  maxTokens: number
  reasoningEffort: string
})

const RuntimeSchema = z.object({
  effectiveVersion: z.string().default(undefined as unknown as string),
  entryFound: z.boolean(),
  toolSubagentSchemaFields: z.array(z.string()).default(undefined as unknown as string[]),
  agentOptionsSchemaFields: z.array(z.string()).default(undefined as unknown as string[]),
  modelSelectionSettings: z.boolean().default(undefined as unknown as boolean),
  providers: z.array(z.object({
    name: z.string(),
    supportsAgentOptions: z.boolean(),
  })).default(undefined as unknown as SubagentProviderSnapshot[]),
}).default(undefined as unknown as SubagentRuntimeSnapshot & {
  effectiveVersion: string
  toolSubagentSchemaFields: string[]
  agentOptionsSchemaFields: string[]
  modelSelectionSettings: boolean
  providers: SubagentProviderSnapshot[]
})

export const SubagentControlSchema = z.object({
  runtime: RuntimeSchema,
  agentOptions: AgentOptionsSchema,
  modelSelectionSettings: z.boolean().default(undefined as unknown as boolean),
})

function entryOf(ctx: HostContext): { entry: any } | undefined {
  const loader = (ctx as any).loader
  if (!loader?.entries) return undefined
  for (const entry of loader.entries()) {
    const id = entry?.id ?? ''
    const name = entry?.options?.name ?? ''
    if (id === TOOL_ENTRY_ID || id.endsWith(`:${TOOL_ENTRY_ID}`) || name === '@deepseek-ai/dsh-tool-subagent') {
      return { entry }
    }
  }
  return undefined
}

function schemaShapeKeys(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return []
  const shape = schema.shape ?? schema.dict
  if (!shape || typeof shape !== 'object') return []
  return Object.keys(shape)
}

function resolvePackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('@deepseek-ai/dsh-tool-subagent/package.json') as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

async function resolveToolModule(ctx: HostContext): Promise<any | undefined> {
  const found = entryOf(ctx)
  try {
    const mod = await import('@deepseek-ai/dsh-tool-subagent')
    if (mod?.Config) return mod
  } catch {
    // fall through to loader import
  }
  if (!found) return undefined
  try {
    const loader = (ctx as any).loader
    const name = found.entry.options?.name || TOOL_ENTRY_ID
    return await loader.import(name)
  } catch {
    return undefined
  }
}

/** Collect the current tool-subagent config facts synchronously where possible. */
export async function resolveSubagentRuntime(ctx: HostContext): Promise<SubagentRuntimeSnapshot> {
  const found = entryOf(ctx)
  const entryConfig = found ? (found.entry.options?.config ?? {}) : {}
  const mod = await resolveToolModule(ctx)
  const configSchema = mod?.Config
  const agentOptionsSchema = configSchema?.shape?.agentOptions
  const providerCapabilities: SubagentProviderSnapshot[] = []
  try {
    const subagents = (ctx as any).get?.('subagents')
    if (subagents?.list) {
      for (const name of subagents.list()) {
        const provider = subagents.getProvider?.(name)
        const caps = provider?.capabilities
        const supportsAgentOptions = caps === undefined || caps.agentOptions !== false
        providerCapabilities.push({ name, supportsAgentOptions })
      }
    }
  } catch {
    // subagents seam absent — leave the list empty
  }
  return {
    effectiveVersion: resolvePackageVersion(),
    entryFound: found !== undefined,
    toolSubagentSchemaFields: schemaShapeKeys(configSchema),
    agentOptionsSchemaFields: schemaShapeKeys(agentOptionsSchema),
    modelSelectionSettings: typeof entryConfig.modelSelectionSettings === 'boolean'
      ? entryConfig.modelSelectionSettings
      : undefined,
    providers: providerCapabilities,
  }
}

function cleanAgentOptions(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined || entry === null || entry === '') continue
    result[key] = entry
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Apply a resolved subagent control value to the tool-subagent loader entry. */
export async function applySubagentControl(
  ctx: HostContext,
  value: { agentOptions?: unknown; modelSelectionSettings?: boolean },
): Promise<{ applied: boolean; message?: string }> {
  const found = entryOf(ctx)
  if (!found) {
    return { applied: false, message: 'tool-subagent entry not found' }
  }
  const entry = found.entry
  const currentConfig: Record<string, unknown> = { ...(entry.options?.config ?? {}) }
  const next = { ...currentConfig }

  const agentOptions = cleanAgentOptions(value.agentOptions)
  if (agentOptions !== undefined) next['agentOptions'] = agentOptions
  else delete next['agentOptions']

  if (value.modelSelectionSettings === undefined) delete next['modelSelectionSettings']
  else next['modelSelectionSettings'] = value.modelSelectionSettings

  if (JSON.stringify(next) === JSON.stringify(currentConfig)) {
    return { applied: false, message: 'no change' }
  }
  try {
    await entry.update({ config: next })
    return { applied: true }
  } catch (error) {
    return {
      applied: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Register the auditable subagent settings namespace when the version gate
 * passes. Below `0.1.1-rc.2` no namespace is created, so the client has
 * nothing to render — the subagent area is completely hidden.
 */
export async function registerSubagentSettings(ctx: HostContext): Promise<void> {
  const facts = await resolveSubagentRuntime(ctx)
  if (!isSubagentVisible(facts.effectiveVersion) || !facts.entryFound) return

  const found = entryOf(ctx)
  const entryConfig = found ? (found.entry.options?.config ?? {}) : {}
  const base = {
    runtime: facts,
    agentOptions: cleanAgentOptions(entryConfig.agentOptions),
    modelSelectionSettings: typeof entryConfig.modelSelectionSettings === 'boolean'
      ? entryConfig.modelSelectionSettings
      : undefined,
  }

  let source: () => unknown = () => base
  let lastApplied = JSON.stringify(base)

  ctx.inject(['settings'], (sctx: any) => {
    const scope = sctx.settings.register(SUBAGENT_NAMESPACE, SubagentControlSchema, {
      base,
      validate: (value: unknown) => {
        // No extra validation: the schema already covers the writable fields.
        void value
      },
    })
    source = () => scope.get()
    sctx.effect(() => () => {
      // On detach, stop applying further changes.
      source = () => base
    })
    scope.watch(() => {
      const next = source()
      const nextJson = JSON.stringify(next)
      if (nextJson === lastApplied) return
      lastApplied = nextJson
      const value = (next ?? {}) as { agentOptions?: unknown; modelSelectionSettings?: boolean }
      void applySubagentControl(ctx, value).then(result => {
        if (!result.applied && result.message && result.message !== 'no change') {
          ctx.logger.warn(`[dsh-mode-control] subagent config apply failed: ${result.message}`)
        }
      })
    })
  })
}
