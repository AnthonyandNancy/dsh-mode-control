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
         * Optional pass-through for OpenAI-compatible providers.
         * Writes into the model's `compat` block.
         */
        compat?: {
          thinkingFormat?: string
          supportsReasoningEffort?: boolean
        }
      }
}

export interface ProviderCapabilityAuthoring {
  /** Provider-wide defaults; model fields override them. */
  defaults?: {
    input?: readonly PiAiModality[]
    reasoning?: ModelCapabilityAuthoring['reasoning']
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
  compat?: {
    thinkingFormat?: string
    supportsReasoningEffort?: boolean
  }
  /**
   * For catalog routes: keyed model overrides.
   * For declared routes: use `models` instead.
   */
  modelOverrides?: Record<string, {
    input?: PiAiModality[]
    reasoningEfforts?: PiAiReasoningEfforts | false
    compat?: {
      thinkingFormat?: string
      supportsReasoningEffort?: boolean
    }
  }>
  /**
   * For declared routes: the full model list with capability fields
   * materialized onto the matching entries.
   */
  models?: {
    id: string
    input?: PiAiModality[]
    reasoningEfforts?: PiAiReasoningEfforts | false
    compat?: {
      thinkingFormat?: string
      supportsReasoningEffort?: boolean
    }
  }[]
}
