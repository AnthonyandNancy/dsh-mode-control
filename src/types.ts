/**
 * Authoring types for the llm-pi-ai capability editor.
 *
 * These are deliberately a thin, user-friendly layer over the native
 * llm-pi-ai configuration vocabulary. They are NOT a second runtime
 * configuration source: callers compile them into the standard
 * `llm-pi-ai` settings namespace (`providers.*.models` /
 * `providers.*.modelOverrides`).
 */

export const PI_AI_MODALITIES = ['text', 'image'] as const
export type PiAiModality = (typeof PI_AI_MODALITIES)[number]

export const PI_AI_REASONING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type PiAiReasoningLevel = (typeof PI_AI_REASONING_LEVELS)[number]

/**
 * Three-state authoring mode for Anthropic adaptive thinking:
 *
 * - `inherit`   → field is absent / not configured (not the same as disabled)
 * - `enabled`   → `forceAdaptiveThinking: true`
 * - `disabled`  → `forceAdaptiveThinking: false`
 */
export type AdaptiveThinkingMode = 'inherit' | 'enabled' | 'disabled'

/**
 * Compat switches the capability editor may carry.
 *
 * `forceAdaptiveThinking` is the single source of truth for Anthropic
 * Messages adaptive thinking. It is tri-state at the settings layer: absent
 * means inherit, `true` means enabled, and `false` means explicitly disabled.
 */
export interface CompatCapabilityAuthoring {
  thinkingFormat?: string
  supportsReasoningEffort?: boolean
  forceAdaptiveThinking?: boolean
}

/**
 * One model's authoring capability.
 *
 * - `input` absent  = inherit the native llm-pi-ai model/catalog/route answer
 *   (no behavioral change).
 * - `input: ['text']` = explicitly text-only.
 * - `input: ['text', 'image']` = explicitly multimodal.
 *
 * - `reasoning` absent = inherit / unknown (no behavioral change).
 * - `reasoning: false` = explicitly not a reasoning model.
 * - `reasoning: { ... }` = explicitly supported with the offered levels.
 *
 * The settings UI only edits the fields llm-pi-ai actually supports
 * (`input`, `reasoningEfforts`, `defaultInput`, route `reasoning`).
 * `defaultEffort` / `wire` below remain available for automation/imports but
 * are intentionally not exposed in the UI.
 */
export interface ModelCapabilityAuthoring {
  input?: readonly PiAiModality[]
  /**
   * Optional pass-through compat switches.
   * Writes into the model's `compat` block. This is the canonical model-level
   * location; `reasoning.compat` is kept for compatibility and merged under
   * this field.
   */
  compat?: CompatCapabilityAuthoring
  reasoning?:
    | false
    | {
        /** Levels the UI exposes; absent keeps every known level. */
        efforts?: readonly PiAiReasoningLevel[]
        /**
         * Must be one of `efforts` when both are present.
         *
         * Current limitation: llm-pi-ai only has a provider-level default
         * effort (`providers.*.reasoning`), not a per-model default. A model
         * default is accepted only when it equals the provider default; the
         * compiler rejects other cases until an upstream overlay seam exists.
         */
        defaultEffort?: PiAiReasoningLevel
        /**
         * Harness/pi-ai level → provider wire value.
         * `off` may map to `null` (send no reasoning field).
         */
        wire?: Partial<Record<PiAiReasoningLevel, string | null>>
        /**
         * Optional pass-through compat switches carried inside the reasoning
         * block for backward compatibility. `ModelCapabilityAuthoring.compat`
         * is the canonical field; when both are present they are merged with
         * the top-level field winning per key.
         */
        compat?: CompatCapabilityAuthoring
      }
}

export interface ProviderCapabilityAuthoring {
  /**
   * Optional route-level compat switches, written to `providers.<id>.compat`.
   * `defaults.compat` and `defaults.reasoning.compat` are merged under this
   * field when present.
   */
  compat?: CompatCapabilityAuthoring
  /** Provider-wide defaults; model fields override them. */
  defaults?: {
    input?: readonly PiAiModality[]
    reasoning?: ModelCapabilityAuthoring['reasoning']
    /** Optional route-level compat switches carried on the defaults block. */
    compat?: CompatCapabilityAuthoring
  }
  /** Keyed by model id. */
  models?: Record<string, ModelCapabilityAuthoring>
}

export interface CapabilitiesAuthoringConfig {
  /** Keyed by llm-pi-ai provider route. */
  providers?: Record<string, ProviderCapabilityAuthoring>
}

/** The native llm-pi-ai `reasoningEfforts` dict shape. */
export type PiAiReasoningEfforts = Partial<Record<PiAiReasoningLevel, string | null>>

/** One compiled provider patch, ready to be merged into the llm-pi-ai namespace. */
export interface CompiledProviderCapabilities {
  provider: string
  defaultInput?: PiAiModality[]
  reasoning?: PiAiReasoningLevel
  compat?: CompatCapabilityAuthoring
  /**
   * For catalog routes: keyed model overrides.
   * For declared routes: use `models` instead.
   */
  modelOverrides?: Record<string, {
    input?: PiAiModality[]
    reasoningEfforts?: PiAiReasoningEfforts | false
    compat?: CompatCapabilityAuthoring
  }>
  /**
   * For declared routes: the full model list with capability fields
   * materialized onto the matching entries.
   */
  models?: {
    id: string
    input?: PiAiModality[]
    reasoningEfforts?: PiAiReasoningEfforts | false
    compat?: CompatCapabilityAuthoring
  }[]
}
