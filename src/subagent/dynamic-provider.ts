import {
  resolveSubAgentModel,
  type ChildModelTarget,
  type ParentModelContext,
  type SubAgentModelPolicy,
} from './modelResolver.ts'

/** Minimal parent shape needed by the one-shot routing wrapper. */
export interface ParentAgentLike {
  options?: { provider?: unknown; model?: unknown }
  session?: { requestHeader?: () => { config?: Record<string, unknown> } | undefined }
}

/** Minimal one-shot provider shape used by this adapter. */
export interface SubagentCapabilities {
  agentOptions: boolean
  outputSchema: boolean
  depthLimit: boolean
  toolFilter: boolean
  persona: boolean
}

export const DYNAMIC_PROVIDER_MARKER = Symbol.for('dsh-mode-control.dynamic-provider')
export const DYNAMIC_PROVIDER_DISPOSER = Symbol.for('dsh-mode-control.dynamic-provider-disposer')

export interface OneShotSubagentProvider {
  name: string
  capabilities: SubagentCapabilities
  inheritsParentContext: boolean
  agentRouteDefaults?: Readonly<{ provider: string; model: string }>
  start(request: any): Promise<any> | any
  prepareContinuable?(request: any): Promise<any>
  readonly [DYNAMIC_PROVIDER_MARKER]?: true
  [DYNAMIC_PROVIDER_DISPOSER]?: () => void
  updateDynamicSource?(original: OneShotSubagentProvider | undefined, policy?: SubAgentModelPolicy, options?: DynamicSubagentProviderOptions): void
  disposeDynamicSource?(): void
}

export interface DynamicSubagentProviderOptions {
  validateTarget?: (target: ChildModelTarget) => Promise<void> | void
}

function routeFrom(value: Record<string, unknown> | undefined): ParentModelContext | undefined {
  if (typeof value?.provider !== 'string' || typeof value.model !== 'string') return undefined
  if (value.provider === '' || value.model === '') return undefined
  return { provider: value.provider, model: value.model }
}

/**
 * Read the parent's latest effective route without retaining it.
 *
 * The request header is authoritative after the parent has made a request;
 * Agent options are only the pre-first-request fallback.
 */
export function currentParentModel(parent: ParentAgentLike | undefined): ParentModelContext | undefined {
  const header = parent?.session?.requestHeader?.()
  const current = routeFrom(header?.config)
  if (current) return current
  return routeFrom(parent?.options as Record<string, unknown> | undefined)
}

/**
 * Wrap a one-shot provider with per-start parent-model routing.
 *
 * The wrapper only applies the policy to one-shot `start()` requests. When the
 * source provider supports continuable children, its preparation method is
 * forwarded unchanged so the default tool remains usable; the policy cannot
 * alter the already-resolved continuable options on this DSH runtime.
 */
export function createDynamicSubagentProvider(
  original: OneShotSubagentProvider,
  policy?: SubAgentModelPolicy,
  options: DynamicSubagentProviderOptions = {},
): OneShotSubagentProvider {
  let source: OneShotSubagentProvider | undefined = original
  let currentPolicy = policy
  let validateTarget = options.validateTarget
  const dynamic: OneShotSubagentProvider = {
    name: `dynamic-${original.name}`,
    capabilities: { ...original.capabilities },
    inheritsParentContext: original.inheritsParentContext,
    ...(original.agentRouteDefaults === undefined ? {} : { agentRouteDefaults: original.agentRouteDefaults }),
    ...(original.prepareContinuable === undefined ? {} : {
      prepareContinuable: (request: any): Promise<any> => {
        const activeSource = source
        if (!activeSource?.prepareContinuable) throw new Error(`dynamic subagent provider "${dynamic.name}" has no continuable source`)
        return activeSource.prepareContinuable.call(activeSource, request)
      },
    }),
    [DYNAMIC_PROVIDER_MARKER]: true,
    updateDynamicSource(nextOriginal, nextPolicy, nextOptions = {}) {
      source = nextOriginal
      currentPolicy = nextPolicy
      validateTarget = nextOptions.validateTarget
      dynamic.capabilities = nextOriginal ? { ...nextOriginal.capabilities } : dynamic.capabilities
      if (nextOriginal) {
        dynamic.inheritsParentContext = nextOriginal.inheritsParentContext
        if (nextOriginal.agentRouteDefaults === undefined) delete dynamic.agentRouteDefaults
        else dynamic.agentRouteDefaults = nextOriginal.agentRouteDefaults
        if (nextOriginal.prepareContinuable && !dynamic.prepareContinuable) {
          dynamic.prepareContinuable = (request: any): Promise<any> => {
            const activeSource = source
            if (!activeSource?.prepareContinuable) throw new Error(`dynamic subagent provider "${dynamic.name}" has no continuable source`)
            return activeSource.prepareContinuable.call(activeSource, request)
          }
        }
      } else if (dynamic.prepareContinuable) {
        delete dynamic.prepareContinuable
      }
    },
    disposeDynamicSource() {
      source = undefined
    },
    async start(request: any): Promise<any> {
      const activeSource = source
      if (!activeSource) throw new Error(`dynamic subagent provider "${dynamic.name}" has no source provider`)
      const parentModel = currentParentModel(request?.parent)
      const target = parentModel === undefined ? undefined : resolveSubAgentModel(parentModel, currentPolicy)
      if (target === undefined) return activeSource.start(request)
      await validateTarget?.(target)
      if (source !== activeSource) throw new Error(`dynamic subagent provider "${dynamic.name}" source changed during validation`)
      return activeSource.start({
        ...request,
        agentOptions: {
          ...(request.agentOptions ?? {}),
          provider: target.provider,
          model: target.model,
        },
      })
    },
  }
  return dynamic
}
