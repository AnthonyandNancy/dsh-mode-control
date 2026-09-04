import {
  resolveSubAgentModel,
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

export interface OneShotSubagentProvider {
  name: string
  capabilities: SubagentCapabilities
  inheritsParentContext: boolean
  agentRouteDefaults?: Readonly<{ provider: string; model: string }>
  start(request: any): Promise<any> | any
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
 * This intentionally implements only `start()`. The official continuable
 * manager resolves child options before calling provider preparation, so this
 * wrapper must not advertise continuable support.
 */
export function createDynamicSubagentProvider(
  original: OneShotSubagentProvider,
  policy?: SubAgentModelPolicy,
): OneShotSubagentProvider {
  return {
    name: `dynamic-${original.name}`,
    capabilities: { ...original.capabilities },
    inheritsParentContext: original.inheritsParentContext,
    ...(original.agentRouteDefaults === undefined ? {} : { agentRouteDefaults: original.agentRouteDefaults }),
    async start(request: any): Promise<any> {
      const parentModel = currentParentModel(request?.parent)
      const target = parentModel === undefined ? undefined : resolveSubAgentModel(parentModel, policy)
      if (target === undefined) return original.start(request)
      return original.start({
        ...request,
        agentOptions: {
          ...(request.agentOptions ?? {}),
          provider: target.provider,
          model: target.model,
        },
      })
    },
  }
}
