import {
  createDynamicSubagentProvider,
  DYNAMIC_PROVIDER_DISPOSER,
  DYNAMIC_PROVIDER_MARKER,
  type DynamicSubagentProviderOptions,
  type OneShotSubagentProvider,
} from './dynamic-provider.ts'
import { selectCanonicalToolSubagentEntry } from './config-service.ts'
import type { SubAgentModelPolicy } from './modelResolver.ts'

export interface SubagentProviderRegistry {
  getProvider(name: string): OneShotSubagentProvider | undefined
  registerProvider(provider: OneShotSubagentProvider): () => void
}


export function registerDynamicSubagentProvider(
  subagents: SubagentProviderRegistry | undefined,
  originalName: string,
  policy?: SubAgentModelPolicy,
  options: DynamicSubagentProviderOptions = {},
): (() => void) | undefined {
  if (!subagents) return undefined
  const dynamicName = `dynamic-${originalName}`
  const existing = subagents.getProvider(dynamicName)
  const original = subagents.getProvider(originalName)
  if (!original) return undefined
  if (existing?.[DYNAMIC_PROVIDER_MARKER]) {
    existing.updateDynamicSource?.(original, policy, options)
    return existing[DYNAMIC_PROVIDER_DISPOSER]
  }
  const dynamic = createDynamicSubagentProvider(original, policy, options)
  const dispose = subagents.registerProvider(dynamic)
  dynamic[DYNAMIC_PROVIDER_DISPOSER] = dispose
  return dispose
}

export interface DynamicRoutingHostContext {
  subagents?: SubagentProviderRegistry
  loader?: { entries?: () => any[] }
  llm?: { resolveCallConfig?: (config: { provider: string; model: string }, signal?: AbortSignal) => Promise<unknown> }
  logger?: { warn?: (message: string) => void }
}

export interface DynamicRoutingInstallResult {
  installed: boolean
  providerName?: string
  dispose?: () => void
  originalConfig?: Record<string, unknown>
}

async function restoreEntry(
  entry: any,
  originalName: string,
  logger?: DynamicRoutingHostContext['logger'],
  originalConfig?: Record<string, unknown>,
): Promise<void> {
  const currentConfig = { ...(entry?.options?.config ?? {}) }
  const dynamicName = `dynamic-${originalName}`
  if (!originalConfig && currentConfig.provider !== dynamicName) return
  try {
    await entry.update?.({ config: { ...(originalConfig ?? currentConfig), provider: originalName } })
  } catch (error) {
    logger?.warn?.(`[dsh-mode-control] dynamic subagent restore failed: ${String(error)}`)
  }
}

export async function installDynamicSubagentRouting(
  ctx: DynamicRoutingHostContext,
  policy?: SubAgentModelPolicy,
  originalName = 'spawn',
): Promise<DynamicRoutingInstallResult> {
  const match = selectCanonicalToolSubagentEntry(ctx as any)
  const entry = match?.entry
  if (!entry) return { installed: false }

  const currentConfig = { ...(entry.options?.config ?? {}) }
  const subagents = ctx.subagents
  if (!subagents) return { installed: false }
  const dynamicName = `dynamic-${originalName}`
  const original = subagents.getProvider(originalName)
  if (!original) return { installed: false }

  if (ctx.llm?.resolveCallConfig) {
    const targets = new Map<string, { provider: string; model: string }>()
    for (const models of Object.values(policy ?? {})) {
      for (const target of Object.values(models)) targets.set(`${target.provider}\0${target.model}`, target)
    }
    try {
      for (const target of targets.values()) await ctx.llm.resolveCallConfig(target)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-mode-control] dynamic subagent target validation failed: ${String(error)}`)
      return { installed: false }
    }
    if (subagents.getProvider(originalName) !== original) return { installed: false }
  }

  const existingDynamic = subagents.getProvider(dynamicName)
  const providerOptions: DynamicSubagentProviderOptions = ctx.llm?.resolveCallConfig
    ? { validateTarget: async target => { await ctx.llm!.resolveCallConfig!(target) } }
    : {}
  const dispose = registerDynamicSubagentProvider(subagents, originalName, policy, providerOptions)
  if (!dispose && !existingDynamic && !subagents.getProvider(dynamicName)) return { installed: false }

  if (currentConfig.provider !== dynamicName) {
    try {
      await entry.update?.({ config: { ...currentConfig, provider: dynamicName } })
    } catch (error) {
      dispose?.()
      ctx.logger?.warn?.(`[dsh-mode-control] dynamic subagent entry update failed: ${String(error)}`)
      return { installed: false, providerName: dynamicName }
    }
  }
  return { installed: true, providerName: dynamicName, dispose, originalConfig: currentConfig }
}

export function startDynamicSubagentRegistration(
  ctx: DynamicRoutingHostContext & { on?: Function; effect?: Function; logger?: any },
  policy?: SubAgentModelPolicy,
  originalName = 'spawn',
): void {
  let attempting = false
  let retryPending = false
  let pendingAttempt: Promise<void> | undefined
  let providerDispose: (() => void) | undefined
  let installedEntry: any
  let originalConfig: Record<string, unknown> | undefined
  const dynamicName = `dynamic-${originalName}`

  const cleanup = async (waitForAttempt = true): Promise<void> => {
    if (waitForAttempt && attempting && pendingAttempt) await pendingAttempt
    const entry = installedEntry ?? selectCanonicalToolSubagentEntry(ctx as any)?.entry
    if (entry) await restoreEntry(entry, originalName, ctx.logger, originalConfig)
    const dynamic = ctx.subagents?.getProvider(dynamicName)
    const dispose = providerDispose ?? dynamic?.[DYNAMIC_PROVIDER_DISPOSER]
    providerDispose = undefined
    if (dynamic && dynamic[DYNAMIC_PROVIDER_DISPOSER] === dispose) delete dynamic[DYNAMIC_PROVIDER_DISPOSER]
    dispose?.()
    dynamic?.disposeDynamicSource?.()
    installedEntry = undefined
    originalConfig = undefined
  }

  const attempt = async (): Promise<void> => {
    if (attempting) {
      retryPending = true
      await pendingAttempt
      return
    }
    attempting = true
    const run = (async (): Promise<void> => {
      try {
        if (Object.keys(policy ?? {}).length === 0) {
          await cleanup(false)
          return
        }
        const result = await installDynamicSubagentRouting(ctx, policy, originalName)
        if (result.installed) {
          providerDispose = result.dispose ?? providerDispose
          installedEntry = selectCanonicalToolSubagentEntry(ctx as any)?.entry
          originalConfig ??= result.originalConfig
        } else if (installedEntry && !ctx.subagents?.getProvider(originalName)) {
          await cleanup(false)
        }
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-mode-control] dynamic subagent registration failed: ${String(error)}`)
      } finally {
        attempting = false
        pendingAttempt = undefined
        if (retryPending) {
          retryPending = false
          void attempt()
        }
      }
    })()
    pendingAttempt = run
    await run
  }

  void attempt()
  const retry = (): void => { void attempt() }
  const disposers = [
    ctx.on?.('internal/plugin', retry, { global: true }),
    ctx.on?.('subagent/provider-added', retry, { global: true }),
    ctx.on?.('subagent/provider-removed', retry, { global: true }),
    ctx.on?.('loader/partial-dispose', retry, { global: true }),
  ].filter((value): value is () => void => typeof value === 'function')
  if (disposers.length > 0 || ctx.effect) {
    ctx.effect?.(() => async () => {
      for (const dispose of disposers) dispose()
      await cleanup()
    }, '@deepseek-ai/dsh-llm-pi-ai-capabilities: dynamic subagent lifecycle')
  }
}
