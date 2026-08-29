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
 *
 * Registration is lifecycle-aware: the plugin starts by trying immediately,
 * then listens for the tool-subagent loader entry appearing later. It is
 * idempotent and fail-closed for unknown versions.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import z from 'schemastery'
import { SUBAGENT_NAMESPACE, TOOL_ENTRY_ID } from './constants.ts'
import { isSubagentVisible } from './version.ts'

// Host context is intentionally loosely typed here: the loader/settings seams
// are runtime-injected and their exact types come from the DSH host bundle.
type HostContext = any

export { SUBAGENT_NAMESPACE, TOOL_ENTRY_ID }

export type SubagentVersionSource =
  | 'loader'
  | 'module'
  | 'package-export'
  | 'module-path-package'
  | 'unknown'

export type SubagentHiddenReason =
  | 'version-too-old'
  | 'version-unknown'
  | 'entry-missing'

export interface SubagentProviderSnapshot {
  name: string
  supportsAgentOptions: boolean
}

export interface SubagentRuntimeSnapshot {
  /** Effective `@deepseek-ai/dsh-tool-subagent` version when reliably known. */
  effectiveVersion?: string
  /** Which resolver produced `effectiveVersion`, for diagnostics. */
  versionSource?: SubagentVersionSource
  /** Why the subagent UI is hidden, when it is hidden. */
  hiddenReason?: SubagentHiddenReason
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

const SUBAGENT_PACKAGE = '@deepseek-ai/dsh-tool-subagent'

export interface SubagentVersionResult {
  version?: string
  source?: SubagentVersionSource
}

/**
 * Read `package.json` starting from a resolved module path and walking upward.
 *
 * A package.json is accepted only when its `name` matches the tool-subagent
 * package; otherwise the walk continues toward the filesystem root.
 */
export function packageVersionFromResolvedPath(
  modulePath: string,
  expectedName = SUBAGENT_PACKAGE,
): SubagentVersionResult {
  let dir = dirname(modulePath)
  for (;;) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown; version?: unknown }
        if (pkg?.name === expectedName && typeof pkg?.version === 'string' && pkg.version !== '') {
          return { version: pkg.version, source: 'module-path-package' }
        }
      } catch {
        // unreadable/malformed package.json in this directory: keep walking up
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { source: 'unknown' }
}

/**
 * Version resolution through the host's `require` seam.
 *
 * 1. `require('@deepseek-ai/dsh-tool-subagent/package.json')`
 * 2. `require.resolve('@deepseek-ai/dsh-tool-subagent')` → walk up to a
 *    `package.json` whose `name` matches the package.
 */
export function resolveSubagentVersionFromRequire(
  requireFn: (id: string) => unknown,
  resolveFn?: (id: string) => string,
): SubagentVersionResult {
  try {
    const pkg = requireFn(`${SUBAGENT_PACKAGE}/package.json`) as { name?: unknown; version?: unknown } | undefined
    if (typeof pkg?.version === 'string' && pkg.version !== '') {
      if (typeof pkg.name !== 'string' || pkg.name === SUBAGENT_PACKAGE) {
        return { version: pkg.version, source: 'package-export' }
      }
    }
  } catch {
    // fall through to resolve-based lookup
  }
  if (!resolveFn) return { source: 'unknown' }
  try {
    const resolved = resolveFn(SUBAGENT_PACKAGE)
    return packageVersionFromResolvedPath(resolved)
  } catch {
    return { source: 'unknown' }
  }
}

/**
 * Resolve the subagent package version from multiple sources, in priority
 * order: loader entry, loaded module metadata, package export, module path.
 */
export function resolveSubagentVersion(
  _ctx: HostContext,
  foundEntry?: { entry: any } | undefined,
  loadedModule?: any,
): SubagentVersionResult {
  const entryVersion = foundEntry?.entry?.options?.version ?? foundEntry?.entry?.version
  if (typeof entryVersion === 'string' && entryVersion !== '') {
    return { version: entryVersion, source: 'loader' }
  }
  if (loadedModule && typeof loadedModule.version === 'string' && loadedModule.version !== '') {
    return { version: loadedModule.version, source: 'module' }
  }
  if (loadedModule?.default && typeof loadedModule.default.version === 'string' && loadedModule.default.version !== '') {
    return { version: loadedModule.default.version, source: 'module' }
  }
  const require = createRequire(import.meta.url)
  return resolveSubagentVersionFromRequire(
    (id: string) => require(id),
    (id: string) => require.resolve(id),
  )
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
  const version = resolveSubagentVersion(ctx, found, mod)
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
  const visible = isSubagentVisible(version.version)
  const hiddenReason: SubagentHiddenReason | undefined = !found
    ? 'entry-missing'
    : version.version === undefined
      ? 'version-unknown'
      : !visible
        ? 'version-too-old'
        : undefined
  return {
    effectiveVersion: version.version,
    versionSource: version.source,
    hiddenReason,
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
export async function registerSubagentSettings(
  ctx: HostContext,
  facts?: SubagentRuntimeSnapshot,
): Promise<void> {
  const snapshot = facts ?? await resolveSubagentRuntime(ctx)
  if (!isSubagentVisible(snapshot.effectiveVersion) || !snapshot.entryFound) return

  const found = entryOf(ctx)
  const entryConfig = found ? (found.entry.options?.config ?? {}) : {}
  const base = {
    runtime: snapshot,
    agentOptions: cleanAgentOptions(entryConfig.agentOptions),
    modelSelectionSettings: typeof entryConfig.modelSelectionSettings === 'boolean'
      ? entryConfig.modelSelectionSettings
      : undefined,
  }

  let source: () => unknown = () => base
  let lastApplied = JSON.stringify(base)

  await ctx.inject(['settings'], (sctx: any) => {
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

export interface SubagentRegistrationService {
  /** Inject a runtime resolver for tests; defaults to `resolveSubagentRuntime`. */
  resolveRuntime?: (ctx: HostContext) => Promise<SubagentRuntimeSnapshot>
  /** Inject a registration function for tests; defaults to `registerSubagentSettings`. */
  register?: (ctx: HostContext, facts?: SubagentRuntimeSnapshot) => Promise<void>
}

/**
 * Start lifecycle-aware subagent registration.
 *
 * - Tries immediately when the tool-subagent entry already exists.
 * - Listens for `loader/entry-init` so a later-appearing tool entry registers
 *   the namespace too.
 * - Idempotent: registration runs at most once per host context lifetime.
 * - No polling.
 */
export function startSubagentSettingsRegistration(
  ctx: HostContext,
  service: SubagentRegistrationService = {},
): void {
  let registered = false
  let attempting = false
  let retryQueued = false
  const resolveRuntime = service.resolveRuntime ?? resolveSubagentRuntime
  const register = service.register ?? registerSubagentSettings
  const log = (message: string): void => {
    (ctx as any).logger?.warn?.(`[dsh-mode-control] ${message}`)
  }

  const tryRegister = async (): Promise<void> => {
    if (registered || attempting) return
    attempting = true
    try {
      const facts = await resolveRuntime(ctx)
      if (!isSubagentVisible(facts.effectiveVersion) || !facts.entryFound) {
        log(`subagent hidden: entryFound=${String(facts.entryFound)} version=${String(facts.effectiveVersion)} source=${String(facts.versionSource)}`)
        return
      }
      registered = true
      await register(ctx, facts)
    } catch (error) {
      registered = false
      log(`subagent registration failed: ${String(error)}`)
    } finally {
      attempting = false
      if (retryQueued && !registered) {
        retryQueued = false
        void tryRegister()
      } else {
        retryQueued = false
      }
    }
  }

  void tryRegister()

  const isToolEntry = (entry: any): boolean => {
    const id = entry?.id ?? ''
    const name = entry?.options?.name ?? ''
    return id === TOOL_ENTRY_ID || id.endsWith(`:${TOOL_ENTRY_ID}`) || name === '@deepseek-ai/dsh-tool-subagent'
  }

  const disposeListener = ctx.on?.('loader/entry-init', (entry: any) => {
    if (registered || !isToolEntry(entry)) return
    if (attempting) {
      retryQueued = true
      return
    }
    void tryRegister()
  })
  if (disposeListener) {
    ctx.effect?.(() => {
      disposeListener()
    }, '@deepseek-ai/dsh-llm-pi-ai-capabilities: subagent registration lifecycle')
  }
}
