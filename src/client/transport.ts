/**
 * Settings transport resolution for the capabilities editor.
 *
 * DSH's client settings domain moved twice:
 *
 * - Hosts up to the 0.1.1 line expose the settings document through
 *   `ctx.get('connection').api` (`.settings.describe/mutate`, `.llm.models`,
 *   `.host.describe`).
 * - 0.1.2-rc.1 removed `.api` from the `connection` service; the document
 *   now lives on the dynamically mounted Remote namespaces
 *   (`ctx.get('remote.settings')` — `describe()` / `mutate(ns, ops, revision)`)
 *   with the adapter catalog on `ctx.get('remote.llm')`.
 *
 * The editor components consume one legacy-shaped `api` object regardless of
 * host era, so this module picks the transport by capability detection and
 * maps the new-era responses back into the legacy envelope
 * (`{ result: { ok, value | error } }`). `exports.inject` in `index.ts`
 * intentionally stays on the service keys every era provides (`slots`,
 * `locale`, `connection`, `remote`): the rc.x-era hosts never registered
 * `remote.settings`/`remote.llm` as ctx services, so declaring them would
 * have stalled activation there. The Remote namespaces are instead acquired
 * lazily through `ctx.get()`, which reads the shared service store without
 * the inject requirement.
 */

/** One field operation in the settings document's serialized write format. */
export interface SettingsOp {
  op: 'set' | 'unset'
  path: Array<string | number>
  value?: unknown
}

/** Namespace row of the settings document view (host-era agnostic). */
export interface SettingsNamespaceView {
  ns: string
  value?: unknown
  schema?: unknown
  revision?: number
  writable?: boolean
}

/** Whole-document settings view. */
export interface SettingsDocumentView {
  writable?: boolean
  namespaces: SettingsNamespaceView[]
}

interface Envelope<T> {
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code?: string; message: string } }
}

/**
 * Legacy-shaped transport surface consumed by the editor components.
 *
 * Every method mirrors the pre-0.1.2 `connection.api` envelope so the
 * components, `mutationRevision()` and the conflict/error copy never need to
 * know which host era produced the answer.
 */
export interface SettingsTransportApi {
  settings: {
    describe(options?: unknown): Promise<Envelope<SettingsDocumentView>>
    mutate(options: {
      ns: string
      ops: SettingsOp[]
      expectedRevision?: number
    }): Promise<Envelope<SettingsNamespaceView>>
  }
  llm: {
    models(options?: unknown): Promise<Envelope<{ groups: unknown[] }>>
  }
  host: {
    describe(options?: unknown): Promise<Envelope<{ version?: string }>>
  }
}

interface RemoteOutcome {
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

/** The `remote.settings` namespace service as mounted by the api gateway. */
interface RemoteSettingsNamespace {
  describe(...args: unknown[]): Promise<RemoteOutcome>
  mutate(...args: unknown[]): Promise<RemoteOutcome>
}

/** The `remote.llm` namespace service as mounted by the api gateway. */
interface RemoteLlmNamespace {
  listProviders(...args: unknown[]): Promise<RemoteOutcome>
  listConfigurableProviders(...args: unknown[]): Promise<RemoteOutcome>
}

/** Legacy `connection.api` when the host still carries it (0.1.1 and older). */
function legacyApiFrom(ctx: any): SettingsTransportApi | undefined {
  const api = ctx.get?.('connection')?.api
  if (api && typeof api?.settings?.describe === 'function' && typeof api?.settings?.mutate === 'function') {
    return api as SettingsTransportApi
  }
  return undefined
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/**
 * Poll until `probe` returns a truthy value.
 *
 * Used for the Remote namespaces the host mounts dynamically: the gateway
 * registers `settings`/`llm` after the host contribution arrives, so a
 * freshly activated plugin can outrun them. Resolves `undefined` when the
 * host never mounts the surface (e.g. legacy hosts without the namespace).
 */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 20_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = probe()
    if (found !== undefined) return found
    if (Date.now() > deadline) return undefined
    await sleep(100)
  }
}

function failure(message: string, code?: string): Envelope<never> {
  return { result: { ok: false, error: { message, ...(code === undefined ? {} : { code }) } } }
}

/**
 * New-era transport over the dynamically mounted Remote namespaces.
 *
 * Services are resolved lazily on first use and memoized: activation must not
 * block on the gateway contribution, but the editor's first load happens well
 * after the document is mounted.
 */
function newEraTransport(ctx: any, waitTimeoutMs = 20_000): SettingsTransportApi {
  let settingsPromise: Promise<RemoteSettingsNamespace | undefined> | undefined

  const settings = (): Promise<RemoteSettingsNamespace | undefined> => {
    settingsPromise ??= waitFor(() => {
      const namespace = ctx.get?.('remote.settings') as RemoteSettingsNamespace | undefined
      if (namespace === undefined) return undefined
      if (typeof namespace.describe !== 'function' || typeof namespace.mutate !== 'function') return undefined
      return namespace
    }, waitTimeoutMs)
    return settingsPromise
  }

  const llmModels = async (): Promise<{ groups: unknown[] }> => {
    const llm = ctx.get?.('remote.llm') as RemoteLlmNamespace | undefined
    if (llm === undefined || typeof llm.listProviders !== 'function') return { groups: [] }
    try {
      const response = await llm.listProviders()
      const rows = response?.ok === true && Array.isArray(response?.value) ? response.value as unknown[] : []
      // Registered adapter routes carry the resolved provider metadata
      // (id/api); the model-level catalog rows now live in the settings
      // document itself, so no models are synthesized here.
      const groups = rows.map(row => {
        const record = row !== null && typeof row === 'object' && !Array.isArray(row)
          ? row as Record<string, unknown>
          : {}
        return {
          id: record['id'],
          ...(typeof record['api'] === 'string' ? { api: record['api'] } : {}),
          models: Array.isArray(record['models']) ? record['models'] : [],
        }
      })
      return { groups }
    } catch {
      return { groups: [] }
    }
  }

  const unavailable = 'settings transport unavailable: connection.api and remote.settings are both missing'

  return {
    settings: {
      async describe() {
        const namespace = await settings()
        if (namespace === undefined) return failure(unavailable)
        try {
          const response = await namespace.describe()
          if (response?.ok !== true) {
            return failure(response?.error?.message ?? 'settings.describe failed', response?.error?.code)
          }
          return { result: { ok: true as const, value: response.value as SettingsDocumentView } }
        } catch (cause: any) {
          return failure(String(cause?.message ?? cause))
        }
      },
      async mutate(options) {
        const namespace = await settings()
        if (namespace === undefined) return failure(unavailable)
        try {
          const response = await namespace.mutate(options.ns, options.ops, options.expectedRevision)
          if (response?.ok !== true) {
            return failure(response?.error?.message ?? 'settings.mutate failed', response?.error?.code)
          }
          return { result: { ok: true as const, value: response.value as SettingsNamespaceView } }
        } catch (cause: any) {
          return failure(String(cause?.message ?? cause))
        }
      },
    },
    llm: {
      async models() {
        return { result: { ok: true as const, value: await llmModels() } }
      },
    },
    host: {
      // 0.1.2-rc.1 no longer exposes the host version through the client
      // transport; mode detection falls back to the serialized schema.
      async describe() {
        return { result: { ok: true as const, value: {} } }
      },
    },
  }
}

/**
 * Resolve the legacy-shaped settings transport for the running host.
 *
 * Capability detection, never version strings: whichever surface actually
 * answers `settings.describe` wins.
 */
export function settingsTransportFrom(ctx: any, options?: { waitTimeoutMs?: number }): SettingsTransportApi {
  const legacy = legacyApiFrom(ctx)
  if (legacy !== undefined) return legacy
  return newEraTransport(ctx, options?.waitTimeoutMs ?? 20_000)
}

/** Legacy passthrough detection, exported for diagnostics/tests. */
export function hasLegacyConnectionApi(ctx: any): boolean {
  return legacyApiFrom(ctx) !== undefined
}
