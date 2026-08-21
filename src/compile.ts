/**
 * Compile authoring capability config into native llm-pi-ai configuration.
 *
 * The compiler is intentionally pure: it does not write settings or touch the
 * runtime. UI and automation can call it to produce path ops / profile patches
 * that are then persisted through `ctx.settings` / `settings.mutate`.
 */

import {
  PI_AI_MODALITIES,
  PI_AI_REASONING_LEVELS,
  type CapabilitiesAuthoringConfig,
  type CompatCapabilityAuthoring,
  type CompiledProviderCapabilities,
  type ModelCapabilityAuthoring,
  type PiAiModality,
  type ProviderCapabilityAuthoring,
  type PiAiReasoningEfforts,
  type PiAiReasoningLevel,
} from './types.ts'

export const ALL_REASONING_LEVELS: readonly PiAiReasoningLevel[] = PI_AI_REASONING_LEVELS

/**
 * Default `reasoningEfforts` wire mapping used only when the UI has confirmed
 * the target protocol is `anthropic-messages` and is auto-generating the
 * mapping. Generic compilation deliberately keeps `minimal → minimal`; this
 * Anthropic-specific default maps `minimal` to `low` so pi-ai does not emit
 * `output_config.effort: "minimal"` when it has a `minimal → low` fallback.
 */
export const ANTHROPIC_REASONING_EFFORT_DEFAULTS: Record<PiAiReasoningLevel, string | null> = {
  off: null,
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

export class CapabilityValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityValidationError'
  }
}

/**
 * Merge compat sources without ever synthesizing a key.
 *
 * `undefined` in a later source does not erase a value from an earlier
 * source, so an unset `forceAdaptiveThinking` cannot turn an inherited
 * `true` into an explicit `false`. Sources are merged in argument order;
 * later sources win per key.
 */
function mergeCompat(
  ...sources: Array<CompatCapabilityAuthoring | undefined>
): CompatCapabilityAuthoring | undefined {
  const result: Record<string, unknown> = {}
  let has = false
  for (const source of sources) {
    if (!source) continue
    has = true
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = value
    }
  }
  return has ? result as CompatCapabilityAuthoring : undefined
}

function assertValidInput(input: readonly PiAiModality[] | undefined, where: string): void {
  if (input === undefined) return
  if (!Array.isArray(input) || input.length === 0) {
    throw new CapabilityValidationError(`${where}: input must be a non-empty array`)
  }
  const seen = new Set<string>()
  for (const modality of input) {
    if (!(PI_AI_MODALITIES as readonly string[]).includes(modality)) {
      throw new CapabilityValidationError(
        `${where}: unknown input modality "${String(modality)}"; expected ${PI_AI_MODALITIES.join(' or ')}`,
      )
    }
    if (seen.has(modality)) {
      throw new CapabilityValidationError(`${where}: input modality "${String(modality)}" is duplicated`)
    }
    seen.add(modality)
  }
}

function assertValidReasoning(
  reasoning: ModelCapabilityAuthoring['reasoning'],
  where: string,
): void {
  if (reasoning === undefined || reasoning === false) return
  const efforts = reasoning.efforts ?? ALL_REASONING_LEVELS
  if (!Array.isArray(efforts) || efforts.length === 0) {
    throw new CapabilityValidationError(`${where}: reasoning.efforts must be a non-empty array`)
  }
  const seen = new Set<string>()
  for (const effort of efforts) {
    if (!(ALL_REASONING_LEVELS as readonly string[]).includes(effort)) {
      throw new CapabilityValidationError(
        `${where}: unknown reasoning effort "${String(effort)}"; expected ${ALL_REASONING_LEVELS.join(', ')}`,
      )
    }
    if (seen.has(effort)) {
      throw new CapabilityValidationError(`${where}: reasoning effort "${String(effort)}" is duplicated`)
    }
    seen.add(effort)
  }
  if (reasoning.defaultEffort !== undefined && !efforts.includes(reasoning.defaultEffort)) {
    throw new CapabilityValidationError(
      `${where}: reasoning.defaultEffort "${String(reasoning.defaultEffort)}" must be one of the declared efforts`,
    )
  }
  if (reasoning.wire !== undefined) {
    for (const [level, wire] of Object.entries(reasoning.wire)) {
      if (!(ALL_REASONING_LEVELS as readonly string[]).includes(level)) {
        throw new CapabilityValidationError(
          `${where}: reasoning.wire names unknown effort "${level}"`,
        )
      }
      if (!efforts.includes(level as PiAiReasoningLevel)) {
        throw new CapabilityValidationError(
          `${where}: reasoning.wire names "${level}" but that effort is not declared in reasoning.efforts`,
        )
      }
      if (wire !== null && typeof wire !== 'string') {
        throw new CapabilityValidationError(`${where}: reasoning.wire.${level} must be a string or null`)
      }
      if (level !== 'off' && wire !== null && wire.length === 0) {
        throw new CapabilityValidationError(
          `${where}: reasoning.wire.${level} must not be an empty string; only "off" may map to null/empty`,
        )
      }
    }
  }
}

/**
 * Convert an authoring reasoning block into the native `reasoningEfforts` dict.
 */
export function toReasoningEfforts(
  reasoning: NonNullable<Exclude<ModelCapabilityAuthoring['reasoning'], false>>,
  where: string,
): PiAiReasoningEfforts {
  assertValidReasoning(reasoning, where)
  const efforts = reasoning.efforts ?? ALL_REASONING_LEVELS
  const result: PiAiReasoningEfforts = {}
  for (const effort of efforts) {
    const wire = reasoning.wire?.[effort]
    if (wire === undefined) {
      result[effort] = effort === 'off' ? null : effort
    } else {
      result[effort] = wire
    }
  }
  return result
}

/**
 * Build an Anthropic Messages `reasoningEfforts` dict for an automatically
 * generated UI mapping.
 *
 * Explicit user wire mappings take precedence over this helper; this is only
 * the default used when the UI auto-generates the mapping for a provider whose
 * resolved protocol is `anthropic-messages`.
 */
export function toAnthropicReasoningEfforts(
  levels: readonly PiAiReasoningLevel[],
): PiAiReasoningEfforts {
  const result: PiAiReasoningEfforts = {}
  for (const level of levels) {
    result[level] = ANTHROPIC_REASONING_EFFORT_DEFAULTS[level]
  }
  return result
}

function compileModelCapability(
  provider: string,
  model: string,
  capability: ModelCapabilityAuthoring,
  defaults: ProviderCapabilityAuthoring['defaults'],
): {
  input?: PiAiModality[]
  reasoningEfforts?: PiAiReasoningEfforts | false
  compat?: CompatCapabilityAuthoring
} {
  const where = `provider "${provider}" model "${model}"`
  // Provider default input is emitted as the route-level `defaultInput`
  // field, so it must NOT be copied onto every model entry.
  const input = capability.input
  assertValidInput(input, where)
  const reasoning = capability.reasoning ?? defaults?.reasoning
  assertValidReasoning(reasoning, where)

  if (reasoning !== undefined && reasoning !== false && reasoning.defaultEffort !== undefined) {
    const providerDefault = defaults?.reasoning !== undefined && defaults.reasoning !== false
      ? defaults.reasoning.defaultEffort
      : undefined
    if (providerDefault !== reasoning.defaultEffort) {
      throw new CapabilityValidationError(
        `${where}: llm-pi-ai has no per-model default effort; set the same default on the provider `
        + 'defaults (route `reasoning`) or remove the model-level default',
      )
    }
  }

  const reasoningCompat = reasoning !== undefined && reasoning !== false
    ? reasoning.compat
    : undefined
  const compat = mergeCompat(reasoningCompat, capability.compat)

  const result: {
    input?: PiAiModality[]
    reasoningEfforts?: PiAiReasoningEfforts | false
    compat?: CompatCapabilityAuthoring
  } = {}
  if (input !== undefined) result.input = [...input]
  if (reasoning === false) {
    result.reasoningEfforts = false
  } else if (reasoning !== undefined) {
    result.reasoningEfforts = toReasoningEfforts(reasoning, where)
  }
  if (compat !== undefined) result.compat = compat
  return result
}

/**
 * Validate an authoring config.
 */
export function validateCapabilities(config: CapabilitiesAuthoringConfig): void {
  for (const [provider, providerConfig] of Object.entries(config.providers ?? {})) {
    if (provider.length === 0) {
      throw new CapabilityValidationError('provider names must be non-empty')
    }
    if (providerConfig.defaults?.input !== undefined) {
      assertValidInput(providerConfig.defaults.input, `provider "${provider}" defaults`)
    }
    if (providerConfig.defaults?.reasoning !== undefined) {
      assertValidReasoning(providerConfig.defaults.reasoning, `provider "${provider}" defaults`)
    }
    for (const [model, capability] of Object.entries(providerConfig.models ?? {})) {
      if (model.length === 0) {
        throw new CapabilityValidationError(`provider "${provider}" has a model with an empty id`)
      }
      compileModelCapability(provider, model, capability, providerConfig.defaults)
    }
  }
}

/**
 * Compile an authoring config into native llm-pi-ai provider capability
 * patches.
 *
 * @param config - authoring config.
 * @param options.declaredRoutes - provider ids that are hand-declared routes
 *   (spell every model in `models`). Catalog routes compile to `modelOverrides`.
 * @returns provider patches in configuration order.
 */
export function compileCapabilities(
  config: CapabilitiesAuthoringConfig,
  options: { declaredRoutes?: ReadonlySet<string> } = {},
): CompiledProviderCapabilities[] {
  validateCapabilities(config)
  const providers = config.providers ?? {}
  return Object.entries(providers).map(([provider, providerConfig]) => {
    const compiled: CompiledProviderCapabilities = { provider }
    if (providerConfig.defaults?.input !== undefined) {
      compiled.defaultInput = [...providerConfig.defaults.input]
    }
    if (providerConfig.defaults?.reasoning !== undefined && providerConfig.defaults.reasoning !== false) {
      // Route-level `reasoning` is a default effort, not a supported-effort set.
      if (providerConfig.defaults.reasoning.defaultEffort !== undefined) {
        compiled.reasoning = providerConfig.defaults.reasoning.defaultEffort
      }
    }
    const providerCompat = mergeCompat(
      providerConfig.defaults?.reasoning !== undefined && providerConfig.defaults.reasoning !== false
        ? providerConfig.defaults.reasoning.compat
        : undefined,
      providerConfig.defaults?.compat,
      providerConfig.compat,
    )
    if (providerCompat !== undefined) compiled.compat = providerCompat
    const modelEntries = Object.entries(providerConfig.models ?? {})
    const declared = options.declaredRoutes?.has(provider) ?? false
    if (declared) {
      compiled.models = modelEntries.map(([model, capability]) => ({
        id: model,
        ...compileModelCapability(provider, model, capability, providerConfig.defaults),
      }))
    } else {
      compiled.modelOverrides = {}
      for (const [model, capability] of modelEntries) {
        const fields = compileModelCapability(provider, model, capability, providerConfig.defaults)
        if (Object.keys(fields).length > 0) compiled.modelOverrides[model] = fields
      }
    }
    return compiled
  })
}

export { PI_AI_MODALITIES, PI_AI_REASONING_LEVELS }
