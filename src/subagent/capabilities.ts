/**
 * Subagent runtime capability detection.
 *
 * Version only decides whether the subagent settings UI may appear at all.
 * Everything else is schema/capability driven: the tool-subagent Config
 * schema, the official `subagent-model-selection` settings namespace, and the
 * agentOptions shape actually loaded at runtime.
 */

import { isSubagentVisible } from './version.ts'

export type SubagentMode = 'unsupported' | 'legacy-static' | 'native-selection'

export interface SubagentRuntimeCapabilities {
  /** Whether the subagent card may be rendered at all (version gate). */
  visible: boolean
  /** Effective `@deepseek-ai/dsh-tool-subagent` version when reliably known. */
  effectiveVersion?: string
  mode: SubagentMode
  /** Whether the runtime reliably accepts `agentOptions` for child routing. */
  supportsAgentOptions: boolean
  /** Whether `agentOptions.reasoningEffort` is a real schema field. */
  supportsReasoningEffort: boolean
  /** Whether the official native selection surfaces are all present. */
  supportsNativeSelection: boolean
  /** Whether `subagent-model-selection.allowedModels` is manageable. */
  supportsAllowedModels: boolean
  /** Current tool-subagent `modelSelectionSettings` flag, when the field exists. */
  modelSelectionSettings?: boolean
  /** Registered subagent backends and whether each accepts agentOptions. */
  providers?: Array<{ name: string; supportsAgentOptions: boolean }>
}

export interface SubagentCapabilityInput {
  /** Effective `@deepseek-ai/dsh-tool-subagent` package version. */
  effectiveVersion?: string
  /** Keys of the tool-subagent `Config` schema (top-level object fields). */
  toolSubagentSchemaFields?: ReadonlySet<string>
  /** Keys of the tool-subagent `agentOptions` schema. */
  agentOptionsSchemaFields?: ReadonlySet<string>
  /** Whether a `subagent-model-selection` settings namespace is registered. */
  modelSelectionNamespacePresent?: boolean
  /** Keys of the `subagent-model-selection` settings namespace schema. */
  modelSelectionNamespaceFields?: ReadonlySet<string>
  /**
   * Whether the selected subagent backend accepts agentOptions. `undefined`
   * means the runtime could not prove either way; legacy mode assumes the
   * rc.2 behavior (agentOptions are forwarded) unless a backend says no.
   */
  supportsAgentOptions?: boolean
  /** Current `modelSelectionSettings` value when the schema field exists. */
  modelSelectionSettings?: boolean
}

/**
 * Detect the subagent runtime mode from actual schema/runtime facts.
 *
 * - `effectiveVersion < 0.1.1-rc.2` or unknown → `unsupported`, fully hidden.
 * - Native selection requires ALL of: tool-subagent `modelSelectionSettings`
 *   schema field, a `subagent-model-selection` settings namespace, and that
 *   namespace's `enabled`/`allowedModels` fields.
 * - Everything else at or above the gate → `legacy-static`.
 */
export function detectSubagentCapabilities(
  input: SubagentCapabilityInput,
): SubagentRuntimeCapabilities {
  if (!isSubagentVisible(input.effectiveVersion)) {
    return {
      visible: false,
      effectiveVersion: input.effectiveVersion,
      mode: 'unsupported',
      supportsAgentOptions: false,
      supportsReasoningEffort: false,
      supportsNativeSelection: false,
      supportsAllowedModels: false,
    }
  }

  const toolFields = input.toolSubagentSchemaFields ?? new Set<string>()
  const agentFields = input.agentOptionsSchemaFields ?? new Set<string>()
  const modelSelectionNamespaceFields = input.modelSelectionNamespaceFields ?? new Set<string>()

  const hasModelSelectionSettings = toolFields.has('modelSelectionSettings')
  const namespacePresent = input.modelSelectionNamespacePresent === true
  const namespaceComplete =
    modelSelectionNamespaceFields.has('enabled') && modelSelectionNamespaceFields.has('allowedModels')
  const supportsNativeSelection = hasModelSelectionSettings && namespacePresent && namespaceComplete

  const supportsAgentOptions = input.supportsAgentOptions !== false
  const supportsReasoningEffort = agentFields.has('reasoningEffort')

  return {
    visible: true,
    effectiveVersion: input.effectiveVersion,
    mode: supportsNativeSelection ? 'native-selection' : 'legacy-static',
    supportsAgentOptions,
    supportsReasoningEffort,
    supportsNativeSelection,
    supportsAllowedModels: supportsNativeSelection,
    modelSelectionSettings: hasModelSelectionSettings ? input.modelSelectionSettings : undefined,
  }
}
