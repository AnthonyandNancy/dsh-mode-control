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
 * idempotent; the canonical entry's presence is the only registration gate.
 * Version is advisory only (recorded in the runtime snapshot for the UI).
 *
 * Lifecycle note: `loader/entry-init` fires from the `Entry` constructor
 * before `EntryGroup.create()` calls `entry.update(options, true, true)`, so
 * at that moment `entry.options` is still `{}` and `entry.id` is not usable.
 * The reliable late-loading signal is `internal/plugin`, which fires after the
 * entry's options are installed and the fiber is bound to the entry.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  | 'entry-base-package'
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
  /** Canonical tool-subagent loader entry id the service is targeting. */
  targetEntryId?: string
  /** Canonical tool-subagent toolName (config `toolName`) when known. */
  targetToolName?: string
  /** Canonical tool-subagent provider (config `provider`) when known. */
  targetProvider?: string
  /** Canonical tool-subagent loader base URL, for diagnostics. */
  targetBaseUrl?: string
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
  versionSource: z.string().default(undefined as unknown as string),
  hiddenReason: z.string().default(undefined as unknown as string),
  targetEntryId: z.string().default(undefined as unknown as string),
  targetToolName: z.string().default(undefined as unknown as string),
  targetProvider: z.string().default(undefined as unknown as string),
  targetBaseUrl: z.string().default(undefined as unknown as string),
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
  versionSource: string
  hiddenReason: string
  targetEntryId: string
  targetToolName: string
  targetProvider: string
  targetBaseUrl: string
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

const SUBAGENT_PACKAGE = '@deepseek-ai/dsh-tool-subagent'

// ---------------------------------------------------------------------------
// Canonical tool-subagent entry selection
// ---------------------------------------------------------------------------

export interface ToolSubagentEntryMatch {
  entry: any
  id: string
  provider?: string
  toolName?: string
  baseUrl?: string | URL
  packageName?: string
}

/** Resolve the module base URL a loader entry actually resolves from. */
export function entryBaseUrl(entry: any): string | URL | undefined {
  if (!entry) return undefined
  const candidates = [
    entry?.parent?.tree?.ctx?.baseUrl,
    entry?.ctx?.baseUrl,
    entry?.loader?.ctx?.baseUrl,
    entry?.tree?.ctx?.baseUrl,
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate
  }
  return undefined
}

/** Create a `require` rooted at the loader entry's own resolution base. */
export function createRequireForEntry(entry: any): any | undefined {
  const base = entryBaseUrl(entry)
  if (!base) return undefined
  try {
    let basePath: string
    if (base instanceof URL) {
      basePath = fileURLToPath(base)
    } else if (typeof base === 'string' && /^file:/i.test(base)) {
      basePath = fileURLToPath(base)
    } else {
      basePath = base
    }
    const resolverPath = join(basePath, '__dsh_mode_control_resolver__.cjs')
    return createRequire(resolverPath)
  } catch {
    return undefined
  }
}

function matchFromEntry(entry: any): ToolSubagentEntryMatch | undefined {
  if (!entry) return undefined
  let id = ''
  try {
    id = typeof entry?.id === 'string' ? entry.id : (typeof entry?.options?.id === 'string' ? entry.options.id : '')
  } catch {
    id = typeof entry?.options?.id === 'string' ? entry.options.id : ''
  }
  const options = (entry?.options ?? {}) as { name?: unknown; config?: unknown }
  const name = typeof options.name === 'string' ? options.name : ''
  const config = (typeof options.config === 'object' && options.config !== null ? options.config : {}) as Record<string, unknown>
  const provider = typeof config.provider === 'string' ? config.provider : undefined
  const toolName = typeof config.toolName === 'string' ? config.toolName : undefined

  const idMatch = id === TOOL_ENTRY_ID || id.endsWith(`:${TOOL_ENTRY_ID}`)
  if (!idMatch && name !== SUBAGENT_PACKAGE && toolName !== 'subagent' && provider !== 'spawn') return undefined
  return { entry, id, provider, toolName, baseUrl: entryBaseUrl(entry), packageName: name }
}

/** Every loader entry that looks like a `tool-subagent` instance. */
export function findToolSubagentEntries(ctx: HostContext): ToolSubagentEntryMatch[] {
  const loader = (ctx as any)?.loader
  if (!loader?.entries) return []
  const matches: ToolSubagentEntryMatch[] = []
  for (const entry of loader.entries()) {
    const match = matchFromEntry(entry)
    if (match) matches.push(match)
  }
  return matches
}

/**
 * Deterministic canonical-entry score.
 *
 * The canonical `tool-subagent` (plain spawn/subagent tool) must win over
 * `tool-subagent-fork`, `tool-subagent-codex`, `tool-subagent-claude-code`,
 * even though every one of those rows shares the same package name.
 */
export function canonicalToolSubagentScore(match: ToolSubagentEntryMatch): number {
  if (match.id === TOOL_ENTRY_ID) return 5
  if (match.id.endsWith(`:${TOOL_ENTRY_ID}`)) return 4
  if (match.toolName === 'subagent') return 3
  if (match.provider === 'spawn') return 2
  if (match.packageName === SUBAGENT_PACKAGE) return 1
  return 0
}

export function isCanonicalToolSubagentMatch(match: ToolSubagentEntryMatch | undefined): boolean {
  return match !== undefined && canonicalToolSubagentScore(match) >= 2
}

/** Whether a loader entry is the canonical (non-fork) tool-subagent entry. */
export function isCanonicalToolSubagentEntry(entry: any): boolean {
  return isCanonicalToolSubagentMatch(matchFromEntry(entry))
}

/** Whether a fiber belongs to the canonical tool-subagent loader entry. */
export function isCanonicalToolSubagentFiber(fiber: any): boolean {
  const entryKey = Symbol.for('cordis.entry')
  const entry = fiber?.entry
    ?? fiber?.parent?.[entryKey]
    ?? fiber?.parent?.fiber?.[entryKey]
  return entry !== undefined && isCanonicalToolSubagentEntry(entry)
}

/**
 * Select the single deterministic canonical tool-subagent entry.
 *
 * Existing `entryOf()` fallbacks were too wide: matching only the package
 * `name` made `tool-subagent-fork` and `tool-subagent-codex` race with the
 * ordinary `tool-subagent`. This selection scores explicit id first, then
 * `toolName === 'subagent'`, then `provider === 'spawn'`, and only falls back
 * to a package-name match when nothing more specific exists.
 */
export function selectCanonicalToolSubagentEntry(ctx: HostContext): ToolSubagentEntryMatch | undefined {
  let best: ToolSubagentEntryMatch | undefined
  let bestScore = -1
  for (const match of findToolSubagentEntries(ctx)) {
    const score = canonicalToolSubagentScore(match)
    if (score > bestScore) {
      best = match
      bestScore = score
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Schema facts + version resolution
// ---------------------------------------------------------------------------

function schemaShapeKeys(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return []
  const shape = schema.shape ?? schema.dict
  if (!shape || typeof shape !== 'object') return []
  return Object.keys(shape)
}

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
 * order:
 *
 * 1. Tool Entry itself has reliable version metadata.
 * 2. Tool loaded module explicitly exports version.
 * 3. A `createRequire` rooted at the Tool Entry's own loader base URL
 *    (the resolution context DSH actually loaded the package from).
 * 4. The plugin's own `createRequire(import.meta.url)` as a last fallback.
 *
 * The plugin's own node_modules tree is deliberately *never* preferred over
 * the entry's resolution context: in isolated/pnpm/desktop-packaged profiles
 * the loader can resolve the tool while `dsh-mode-control`'s own import.meta
 * cannot.
 */
export function resolveSubagentVersion(
  _ctx: HostContext,
  foundEntry?: ToolSubagentEntryMatch | { entry: any } | undefined,
  loadedModule?: any,
): SubagentVersionResult {
  const entry = 'entry' in (foundEntry ?? {}) ? (foundEntry as any)?.entry : foundEntry
  const entryVersion = entry?.options?.version ?? entry?.version
  if (typeof entryVersion === 'string' && entryVersion !== '') {
    return { version: entryVersion, source: 'loader' }
  }
  if (loadedModule && typeof loadedModule.version === 'string' && loadedModule.version !== '') {
    return { version: loadedModule.version, source: 'module' }
  }
  if (loadedModule?.default && typeof loadedModule.default.version === 'string' && loadedModule.default.version !== '') {
    return { version: loadedModule.default.version, source: 'module' }
  }

  const entryRequire = createRequireForEntry(entry)
  if (entryRequire) {
    const fromEntry = resolveSubagentVersionFromRequire(
      (id: string) => entryRequire(id),
      (id: string) => entryRequire.resolve(id),
    )
    if (fromEntry.version) {
      return {
        version: fromEntry.version,
        source: fromEntry.source === 'package-export' || fromEntry.source === 'module-path-package'
          ? 'entry-base-package'
          : fromEntry.source,
      }
    }
  }

  const require = createRequire(import.meta.url)
  return resolveSubagentVersionFromRequire(
    (id: string) => require(id),
    (id: string) => require.resolve(id),
  )
}

async function resolveToolModule(ctx: HostContext): Promise<any | undefined> {
  const match = selectCanonicalToolSubagentEntry(ctx)
  try {
    const mod = await import('@deepseek-ai/dsh-tool-subagent')
    if (mod?.Config) return mod
  } catch {
    // fall through to loader import
  }
  if (!match) return undefined
  try {
    const loader = (ctx as any).loader
    const name = match.entry.options?.name || TOOL_ENTRY_ID
    return await loader.import(name)
  } catch {
    return undefined
  }
}

/** Collect the current tool-subagent config facts synchronously where possible. */
export async function resolveSubagentRuntime(ctx: HostContext): Promise<SubagentRuntimeSnapshot> {
  const match = selectCanonicalToolSubagentEntry(ctx)
  const entryConfig = match ? (match.entry.options?.config ?? {}) : {}
  const mod = await resolveToolModule(ctx)
  const configSchema = mod?.Config
  const agentOptionsSchema = configSchema?.shape?.agentOptions
  const version = resolveSubagentVersion(ctx, match, mod)
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
  const hiddenReason: SubagentHiddenReason | undefined = !match
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
    entryFound: match !== undefined,
    targetEntryId: match?.id,
    targetToolName: match?.toolName,
    targetProvider: match?.provider,
    targetBaseUrl: match?.baseUrl ? String(match.baseUrl) : undefined,
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

/**
 * Apply a resolved subagent control value to the canonical tool-subagent
 * loader entry. The same deterministic selection used for detection is reused
 * here, so detection and mutation can never target different instances.
 */
export async function applySubagentControl(
  ctx: HostContext,
  value: { agentOptions?: unknown; modelSelectionSettings?: boolean; runtime?: { targetEntryId?: string } },
): Promise<{ applied: boolean; message?: string }> {
  const match = selectCanonicalToolSubagentEntry(ctx)
  if (!match) {
    return { applied: false, message: 'tool-subagent entry not found' }
  }
  const storedTargetId = value?.runtime?.targetEntryId
  if (storedTargetId && storedTargetId !== match.id) {
    ;(ctx as any).logger?.warn?.(
      `[dsh-mode-control] subagent target changed: stored=${storedTargetId} current=${match.id}; using current canonical entry`,
    )
  }
  const entry = match.entry
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

// Keep registering the same namespace idempotent even when lifecycle retries
// after a tool-subagent entry is replaced. The key is the host plugin context;
// the value tracks the settings-service contexts where the namespace is
// currently mounted, so re-registration after a settings detach is allowed.
const registeredSettingsByHost = new WeakMap<object, Set<object>>()

function settingsRegistrations(ctx: HostContext): Set<object> {
  let set = registeredSettingsByHost.get(ctx)
  if (!set) {
    set = new Set()
    registeredSettingsByHost.set(ctx, set)
  }
  return set
}

/**
 * Register the auditable subagent settings namespace whenever a canonical
 * tool-subagent entry exists. The version is recorded for advisory warnings
 * but never hides the namespace.
 */
export async function registerSubagentSettings(
  ctx: HostContext,
  facts?: SubagentRuntimeSnapshot,
): Promise<void> {
  const snapshot = facts ?? await resolveSubagentRuntime(ctx)
  if (!snapshot.entryFound) return

  const match = selectCanonicalToolSubagentEntry(ctx)
  const entryConfig = match ? (match.entry.options?.config ?? {}) : {}
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
    const registrations = settingsRegistrations(ctx)
    // Already mounted in this host context (possibly under an earlier
    // settings-service instance that has not detached yet).
    if (registrations.size > 0 || registrations.has(sctx)) return
    registrations.add(sctx)
    try {
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
        registrations.delete(sctx)
      })
      scope.watch(() => {
        const next = source()
        const nextJson = JSON.stringify(next)
        if (nextJson === lastApplied) return
        lastApplied = nextJson
        const value = (next ?? {}) as { agentOptions?: unknown; modelSelectionSettings?: boolean; runtime?: { targetEntryId?: string } }
        void applySubagentControl(ctx, value).then(result => {
          if (!result.applied && result.message && result.message !== 'no change') {
            ctx.logger.warn(`[dsh-mode-control] subagent config apply failed: ${result.message}`)
          }
        })
      })
    } catch (error) {
      registrations.delete(sctx)
      throw error
    }
  })
}

export interface SubagentRegistrationService {
  /** Inject a runtime resolver for tests; defaults to `resolveSubagentRuntime`. */
  resolveRuntime?: (ctx: HostContext) => Promise<SubagentRuntimeSnapshot>
  /** Inject a registration function for tests; defaults to `registerSubagentSettings`. */
  register?: (ctx: HostContext, facts?: SubagentRuntimeSnapshot) => Promise<void>
}

function describeFacts(facts: SubagentRuntimeSnapshot): string {
  return [
    `entryFound=${String(facts.entryFound)}`,
    `targetEntryId=${String(facts.targetEntryId)}`,
    `entryBaseUrl=${String(facts.targetBaseUrl)}`,
    `toolName=${String(facts.targetToolName)}`,
    `provider=${String(facts.targetProvider)}`,
    `version=${String(facts.effectiveVersion)}`,
    `versionSource=${String(facts.versionSource)}`,
    `reason=${String(facts.hiddenReason ?? 'visible')}`,
  ].join(' ')
}

/**
 * Start lifecycle-aware subagent registration.
 *
 * - Tries immediately when the canonical tool-subagent entry already exists.
 * - Listens for `internal/plugin` so a later-appearing tool entry registers
 *   the namespace too. `internal/plugin` fires after entry options are set
 *   (the loader binds `fiber.entry` then), unlike `loader/entry-init` which
 *   fires from the `Entry` constructor before `entry.update()`.
 * - Listens for `loader/partial-dispose` so a canonical entry that is removed
 *   or replaced before registration gets another chance.
 * - Idempotent: registration runs at most once per settings service context.
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
  const warn = (message: string): void => {
    (ctx as any).logger?.warn?.(`[dsh-mode-control] ${message}`)
  }
  const info = (message: string): void => {
    (ctx as any).logger?.info?.(`[dsh-mode-control] ${message}`)
  }

  const tryRegister = async (): Promise<void> => {
    if (registered || attempting) return
    attempting = true
    try {
      const facts = await resolveRuntime(ctx)
      if (!facts.entryFound) {
        warn(`subagent not registered (entry missing): ${describeFacts(facts)}`)
        return
      }
      await register(ctx, facts)
      registered = true
      info(`subagent detection: ${describeFacts(facts)} visible=true`)
    } catch (error) {
      registered = false
      warn(`subagent registration failed: ${String(error)}`)
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

  const queueOrRun = (): void => {
    if (attempting) {
      retryQueued = true
      return
    }
    void tryRegister()
  }

  const disposePlugin = ctx.on?.('internal/plugin', (fiber: any) => {
    if (registered || !isCanonicalToolSubagentFiber(fiber)) return
    queueOrRun()
  }, { global: true })
  if (disposePlugin) {
    ctx.effect?.(() => {
      disposePlugin()
    }, '@deepseek-ai/dsh-llm-pi-ai-capabilities: subagent plugin lifecycle')
  }

  const disposePartial = ctx.on?.('loader/partial-dispose', (entry: any) => {
    if (!isCanonicalToolSubagentEntry(entry)) return
    // A canonical entry was replaced/removed. Registration is idempotent at
    // the settings layer, so it is safe to retry; if the namespace is still
    // mounted the real registration is a no-op.
    registered = false
    queueOrRun()
  }, { global: true })
  if (disposePartial) {
    ctx.effect?.(() => {
      disposePartial()
    }, '@deepseek-ai/dsh-llm-pi-ai-capabilities: subagent partial-dispose lifecycle')
  }
}
