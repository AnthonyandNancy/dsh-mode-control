export interface ParentModelContext {
  provider: string
  model: string
}

export interface ChildModelTarget {
  provider: string
  model: string
}

export interface SubAgentModelPolicy {
  [provider: string]: {
    [model: string]: ChildModelTarget
  }
}

/** Resolve the child model target configured for the parent's current model. */
export function resolveSubAgentModel(
  parent: ParentModelContext,
  policy?: SubAgentModelPolicy,
): ChildModelTarget | undefined {
  const target = policy?.[parent.provider]?.[parent.model]
  return target === undefined ? undefined : { ...target }
}
