import { describe, expect, it, vi } from 'vitest'
import { hasLegacyConnectionApi, settingsTransportFrom, type SettingsTransportApi } from '../src/client/transport.ts'

/** Fake ctx: `get` reads a registry, exactly like the cordis shared store. */
function makeCtx(registry: Record<string, any>): any {
  return {
    get(name: string) {
      return registry[name]
    },
  }
}

function legacyApi(): any {
  return {
    settings: {
      describe: async () => ({ result: { ok: true, value: { namespaces: [] } } }),
      mutate: async () => ({ result: { ok: true, value: { ns: 'llm-pi-ai', revision: 3 } } }),
    },
    llm: { models: async () => ({ result: { ok: true, value: { groups: [{ id: 'openai' }] } } }) },
    host: { describe: async () => ({ result: { ok: true, value: { version: '0.1.1-rc.4' } } }) },
  }
}

describe('settingsTransportFrom era detection', () => {
  it('prefers the legacy connection.api surface when the host still carries it', () => {
    const api = legacyApi()
    const transport = settingsTransportFrom(makeCtx({ connection: { api } }))
    expect(hasLegacyConnectionApi(makeCtx({ connection: { api } }))).toBe(true)
    // Legacy passthrough: the very object the host provided is used unchanged.
    expect(transport).toBe(api)
  })

  it('falls back to the new-era transport when connection.api has no settings surface', () => {
    const ctx = makeCtx({
      connection: { generation: {}, rpc: {} }, // 0.1.2-rc.1 shape: no `.api`
      'remote.settings': {
        describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }),
        mutate: async () => ({ ok: true, value: { ns: 'llm-pi-ai', revision: 4 } }),
      },
    })
    const transport = settingsTransportFrom(ctx, { waitTimeoutMs: 500 })
    expect(hasLegacyConnectionApi(ctx)).toBe(false)
    expect(transport).not.toBe(undefined)
    expect(transport.settings.describe).toBeTypeOf('function')
  })

  it('does not mistake a connection without settings functions for the legacy era', () => {
    const ctx = makeCtx({ connection: { api: { settings: {} } } })
    expect(hasLegacyConnectionApi(ctx)).toBe(false)
  })
})

describe('new-era transport envelope mapping', () => {
  const view = {
    writable: true,
    namespaces: [
      { ns: 'llm-pi-ai', value: { providers: {} }, schema: { uid: 1, refs: {} }, revision: 7 },
      { ns: 'dsh-mode-control.subagent', value: {}, revision: 2 },
    ],
  }

  it('wraps remote.settings.describe into the legacy result envelope', async () => {
    const describe = vi.fn(async () => ({ ok: true, value: view }))
    const mutate = vi.fn(async () => ({ ok: true, value: { ns: 'llm-pi-ai', revision: 8 } }))
    const ctx = makeCtx({ 'remote.settings': { describe, mutate } })
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 500 }) as SettingsTransportApi

    const response = await api.settings.describe({})
    expect(response.result).toMatchObject({ ok: true, value: view })
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('maps mutate to positional (ns, ops, expectedRevision) and passes the view revision through', async () => {
    const mutate = vi.fn(async () => ({ ok: true, value: { ns: 'llm-pi-ai', revision: 9 } }))
    const ctx = makeCtx({
      'remote.settings': {
        describe: async () => ({ ok: true, value: view }),
        mutate,
      },
    })
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 500 }) as SettingsTransportApi

    const ops = [{ op: 'set', path: ['providers'], value: {} }]
    const response = await api.settings.mutate({ ns: 'llm-pi-ai', ops, expectedRevision: 7 })
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', ops, 7)
    expect(response.result).toMatchObject({ ok: true, value: { ns: 'llm-pi-ai', revision: 9 } })
  })

  it('maps a namespace failure into the legacy error envelope', async () => {
    const ctx = makeCtx({
      'remote.settings': {
        describe: async () => ({ ok: false, error: { code: 'settings/conflict', message: 'stale revision' } }),
        mutate: async () => ({ ok: false, error: { message: 'nope' } }),
      },
    })
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 500 }) as SettingsTransportApi

    const describe = await api.settings.describe({})
    expect(describe.result).toMatchObject({ ok: false, error: { code: 'settings/conflict', message: 'stale revision' } })
    const mutated = await api.settings.mutate({ ns: 'llm-pi-ai', ops: [], expectedRevision: 1 })
    expect(mutated.result).toMatchObject({ ok: false, error: { message: 'nope' } })
  })

  it('surfaces a clear error when no era surface exists within the wait budget', async () => {
    const ctx = makeCtx({ connection: {} })
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 60 }) as SettingsTransportApi

    const response = await api.settings.describe({})
    expect(response.result.ok).toBe(false)
    if (response.result.ok === false) {
      expect(response.result.error.message).toContain('settings transport unavailable')
    }
  })

  it('keeps llm.models best-effort when remote.llm is absent', async () => {
    const ctx = makeCtx({
      'remote.settings': {
        describe: async () => ({ ok: true, value: view }),
        mutate: async () => ({ ok: true, value: { ns: 'llm-pi-ai' } }),
      },
    })
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 500 }) as SettingsTransportApi
    const response = await api.llm.models({})
    expect(response.result).toMatchObject({ ok: true, value: { groups: [] } })
  })

  it('maps remote.llm.listProviders rows into the catalog group shape', async () => {
    const ctx = makeCtx({
      'remote.settings': {
        describe: async () => ({ ok: true, value: view }),
        mutate: async () => ({ ok: true, value: { ns: 'llm-pi-ai' } }),
      },
      'remote.llm': {
        listProviders: async () => ({
          ok: true,
          value: [
            { id: 'anthropic', api: 'anthropic-messages' },
            { id: 'deepseek', displayName: 'DeepSeek' },
          ],
        }),
      },
    })
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 500 }) as SettingsTransportApi
    const response = await api.llm.models({})
    expect(response.result).toMatchObject({
      ok: true,
      value: {
        groups: [
          { id: 'anthropic', api: 'anthropic-messages', models: [] },
          { id: 'deepseek', models: [] },
        ],
      },
    })
  })

  it('lazily acquires the namespace when it mounts after activation', async () => {
    const registry: Record<string, any> = {}
    const ctx = makeCtx(registry)
    const api = settingsTransportFrom(ctx, { waitTimeoutMs: 800 }) as SettingsTransportApi

    // The gateway contribution lands after the first polling starts.
    setTimeout(() => {
      registry['remote.settings'] = {
        describe: async () => ({ ok: true, value: view }),
        mutate: async () => ({ ok: true, value: { ns: 'llm-pi-ai', revision: 8 } }),
      }
    }, 60)

    const response = await api.settings.describe({})
    expect(response.result.ok).toBe(true)
    if (response.result.ok === true) {
      expect(response.result.value).toBe(view)
    }
  })
})
