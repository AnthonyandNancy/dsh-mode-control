import {
  createDynamicSubagentProvider,
  type OneShotSubagentProvider,
} from './dynamic-provider.ts'
import { selectCanonicalToolSubagentEntry } from './config-service.ts'
import type { SubAgentModelPolicy } from './modelResolver.ts'

export interface SubagentProviderRegistry {
  getProvider(name: string): OneShotSubagentProvider | undefined
  registerProvider(provider: OneShotSubagentProvider): () => void
}

/**
 * Register a dynamic one-shot wrapper when the original provider is available.
 * An existing provider with the derived name is treated as owned by the host;
 * it is never replaced, which keeps HMR and duplicate registration safe.
 */
export function registerDynamicSubagentProvider(
  subagents: SubagentProviderRegistry | undefined,
  originalName: string,
  policy?: SubAgentModelPolicy,
): (() => void) | undefined {
  if (!subagents) return undefined
  const dynamicName = `dynamic-${originalName}`
  if (subagents.getProvider(dynamicName)) return () => {}
  const original = subagents.getProvider(originalName)
  if (!original) return undefined
  const dynamic = createDynamicSubagentProvider(original, policy)
  return subagents.registerProvider(dynamic)
}

export interface DynamicRoutingHostContext {
  subagents?: SubagentProviderRegistry
  loader?: { entries?: () => any[] }
  logger?: { warn?: (message: string) => void }
}

export interface DynamicRoutingInstallResult {
  installed: boolean
  providerName?: string
  dispose?: () => void
}

/**
 * Install the one-shot wrapper and point the canonical tool entry at it.
 * Entry updates use the official loader API and preserve unrelated config.
 */
export function installDynamicSubagentRouting(
  ctx: DynamicRoutingHostContext,
  policy?: SubAgentModelPolicy,
  originalName = 'spawn',
): DynamicRoutingInstallResult {
  const subagents = ctx.subagents
  if (!subagents) return { installed: false }
  const dynamicName = `dynamic-${originalName}`
  const original = subagents.getProvider(originalName)
  if (!original && !subagents.getProvider(dynamicName)) return { installed: false }

  let dispose: (() => void) | undefined
  if (!subagents.getProvider(dynamicName)) {
    dispose = registerDynamicSubagentProvider(subagents, originalName, policy)
    if (!dispose) return { installed: false }
  }

  const match = selectCanonicalToolSubagentEntry(ctx as any)
  const entry = match?.entry
  if (!entry) return { installed: false, providerName: dynamicName, dispose }

  const currentConfig = { ...(entry.options?.config ?? {}) }
  if (currentConfig.provider !== dynamicName) {
    try {
      const updateResult = entry.update?.({ config: { ...currentConfig, provider: dynamicName } })
      if (updateResult && typeof updateResult.then === 'function') {
        void updateResult.catch((error: unknown) => {
          ctx.logger?.warn?.(`[dsh-mode-control] dynamic subagent entry update failed: ${String(error)}`)
        })
      }
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-mode-control] dynamic subagent entry update failed: ${String(error)}`)
    }
  }
  return { installed: true, providerName: dynamicName, dispose }
}

/**
 * Start lifecycle-aware installation. Missing entries/providers are retried on
 * the same loader events used by the settings bridge; no polling is used.
 */
export function startDynamicSubagentRegistration(
  ctx: DynamicRoutingHostContext & { on?: Function; effect?: Function; logger?: any },
  policy?: SubAgentModelPolicy,
  originalName = 'spawn',
): void {
  let attempting = false
  const attempt = (): void => {
    if (attempting) return
    attempting = true
    try {
      installDynamicSubagentRouting(ctx, policy, originalName)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-mode-control] dynamic subagent registration failed: ${String(error)}`)
    } finally {
      attempting = false
    }
  }
  attempt()
  const retry = (): void => attempt()
  const disposers = [
    ctx.on?.('internal/plugin', retry, { global: true }),
    ctx.on?.('loader/partial-dispose', retry, { global: true }),
  ].filter((value): value is () => void => typeof value === 'function')
  if (disposers.length > 0) {
    ctx.effect?.(() => () => {
      for (const dispose of disposers) dispose()
    }, '@deepseek-ai/dsh-llm-pi-ai-capabilities: dynamic subagent lifecycle')
  }
}
