/**
 * Compat field metadata registry.
 *
 * Adding a future pi-ai compat field should primarily mean adding one entry
 * here (plus its i18n strings). The parser, mutation, visibility, Provider
 * JSX and Model JSX all consume this registry instead of re-implementing the
 * field list.
 */

export type CompatFieldKind = 'boolean' | 'enum' | 'json'
export type CompatGroup = 'common' | 'openai' | 'anthropic' | 'advanced'
export type CompatOptionStyle = 'tri-state' | 'developer-role'

export interface CompatFieldDefinition {
  /** Exact `compat.<key>` field name. */
  key: string
  kind: CompatFieldKind
  group: CompatGroup
  /** Wire protocols whose upstream compat type declares this field. */
  protocols: string[]
  /** Locale key for the visible label. */
  labelKey: string
  /** Locale key for the muted description. */
  descriptionKey: string
  /** Advanced fields render inside a disclosure, not in the common list. */
  advanced?: boolean
  /** Special rendering mode for this field, when any. */
  optionStyle?: CompatOptionStyle
}

/**
 * The current pi-ai compat vocabulary plus future fields explicitly requested
 * by the compatibility surface. `protocols` is a metadata hint; runtime schema
 * detection is the authority for whether a field exists, and the existing-value
 * escape hatch keeps configured fields visible even when protocol detection
 * later disagrees.
 */
export const COMPAT_FIELDS: readonly CompatFieldDefinition[] = [
  {
    key: 'supportsStore',
    kind: 'boolean',
    group: 'common',
    protocols: ['openai-completions'],
    labelKey: 'compat.supportsStore.label',
    descriptionKey: 'compat.supportsStore.description',
  },
  {
    key: 'supportsDeveloperRole',
    kind: 'boolean',
    group: 'common',
    protocols: ['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses'],
    labelKey: 'compat.supportsDeveloperRole.label',
    descriptionKey: 'compat.supportsDeveloperRole.description',
    optionStyle: 'developer-role',
  },
  {
    key: 'supportsReasoningEffort',
    kind: 'boolean',
    group: 'common',
    protocols: ['openai-completions'],
    labelKey: 'compat.supportsReasoningEffort.label',
    descriptionKey: 'compat.supportsReasoningEffort.description',
  },
  {
    key: 'supportsUsageInStreaming',
    kind: 'boolean',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.supportsUsageInStreaming.label',
    descriptionKey: 'compat.supportsUsageInStreaming.description',
  },
  {
    key: 'supportsFinishReason',
    kind: 'boolean',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.supportsFinishReason.label',
    descriptionKey: 'compat.supportsFinishReason.description',
  },
  {
    key: 'maxTokensField',
    kind: 'enum',
    group: 'common',
    protocols: ['openai-completions'],
    labelKey: 'compat.maxTokensField.label',
    descriptionKey: 'compat.maxTokensField.description',
  },
  {
    key: 'requiresToolResultName',
    kind: 'boolean',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.requiresToolResultName.label',
    descriptionKey: 'compat.requiresToolResultName.description',
  },
  {
    key: 'requiresAssistantAfterToolResult',
    kind: 'boolean',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.requiresAssistantAfterToolResult.label',
    descriptionKey: 'compat.requiresAssistantAfterToolResult.description',
  },
  {
    key: 'requiresThinkingAsText',
    kind: 'boolean',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.requiresThinkingAsText.label',
    descriptionKey: 'compat.requiresThinkingAsText.description',
  },
  {
    key: 'requiresReasoningContentOnAssistantMessages',
    kind: 'boolean',
    group: 'common',
    protocols: ['openai-completions'],
    labelKey: 'compat.requiresReasoningContentOnAssistantMessages.label',
    descriptionKey: 'compat.requiresReasoningContentOnAssistantMessages.description',
  },
  {
    key: 'thinkingFormat',
    kind: 'enum',
    group: 'common',
    protocols: ['openai-completions'],
    labelKey: 'compat.thinkingFormat.label',
    descriptionKey: 'compat.thinkingFormat.description',
  },
  {
    key: 'chatTemplateKwargs',
    kind: 'json',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.chatTemplateKwargs.label',
    descriptionKey: 'compat.chatTemplateKwargs.description',
  },
  {
    key: 'chatTemplateArgs',
    kind: 'json',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.chatTemplateArgs.label',
    descriptionKey: 'compat.chatTemplateArgs.description',
  },
  {
    key: 'supportsThinkingTokenBudget',
    kind: 'boolean',
    group: 'common',
    protocols: [],
    labelKey: 'compat.supportsThinkingTokenBudget.label',
    descriptionKey: 'compat.supportsThinkingTokenBudget.description',
  },
  {
    key: 'supportsStrictMode',
    kind: 'boolean',
    group: 'common',
    protocols: ['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses', 'bedrock-converse-stream'],
    labelKey: 'compat.supportsStrictMode.label',
    descriptionKey: 'compat.supportsStrictMode.description',
  },
  {
    key: 'cacheControlFormat',
    kind: 'enum',
    group: 'advanced',
    protocols: ['openai-completions'],
    advanced: true,
    labelKey: 'compat.cacheControlFormat.label',
    descriptionKey: 'compat.cacheControlFormat.description',
  },
  {
    key: 'supportsLongCacheRetention',
    kind: 'boolean',
    group: 'advanced',
    protocols: ['openai-completions', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses', 'anthropic-messages'],
    advanced: true,
    labelKey: 'compat.supportsLongCacheRetention.label',
    descriptionKey: 'compat.supportsLongCacheRetention.description',
  },
  {
    key: 'supportsEagerToolInputStreaming',
    kind: 'boolean',
    group: 'anthropic',
    protocols: ['anthropic-messages'],
    labelKey: 'compat.supportsEagerToolInputStreaming.label',
    descriptionKey: 'compat.supportsEagerToolInputStreaming.description',
  },
  {
    key: 'supportsCacheControlOnTools',
    kind: 'boolean',
    group: 'anthropic',
    protocols: ['anthropic-messages'],
    labelKey: 'compat.supportsCacheControlOnTools.label',
    descriptionKey: 'compat.supportsCacheControlOnTools.description',
  },
  {
    key: 'supportsTemperature',
    kind: 'boolean',
    group: 'anthropic',
    protocols: ['anthropic-messages'],
    labelKey: 'compat.supportsTemperature.label',
    descriptionKey: 'compat.supportsTemperature.description',
  },
  {
    key: 'forceAdaptiveThinking',
    kind: 'boolean',
    group: 'anthropic',
    protocols: ['anthropic-messages'],
    labelKey: 'compat.forceAdaptiveThinking.label',
    descriptionKey: 'compat.forceAdaptiveThinking.description',
  },
  {
    key: 'allowEmptySignature',
    kind: 'boolean',
    group: 'anthropic',
    protocols: ['anthropic-messages'],
    labelKey: 'compat.allowEmptySignature.label',
    descriptionKey: 'compat.allowEmptySignature.description',
  },
  {
    key: 'supportsStrictTools',
    kind: 'boolean',
    group: 'anthropic',
    protocols: ['anthropic-messages'],
    labelKey: 'compat.supportsStrictTools.label',
    descriptionKey: 'compat.supportsStrictTools.description',
  },
]

export const COMPAT_FIELD_BY_KEY: ReadonlyMap<string, CompatFieldDefinition> = new Map(
  COMPAT_FIELDS.map(field => [field.key, field]),
)

/**
 * Whether a metadata field is applicable to at least one resolved protocol.
 *
 * Provider/model resolved protocols come from the provider `api`, catalog
 * metadata, and runtime schema — never from provider-name heuristics.
 */
export function isCompatFieldApplicable(
  definition: CompatFieldDefinition,
  protocols: readonly string[],
): boolean {
  return protocols.some(protocol => definition.protocols.includes(protocol))
}
