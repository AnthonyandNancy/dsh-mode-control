/**
 * Subagent runtime capability detection.
 *
 * Visibility is entry/schema driven: the canonical tool-subagent loader entry
 * decides whether the settings surface may appear at all. The package version
 * is advisory only — unknown or older versions stay visible with a
 * `supportConfidence` warning instead of hiding the whole panel.
 */

import { compareSemver, parseVersion } from './version.ts'
import { SUBAGENT_VISIBLE_MIN } from './version.ts'

export type SubagentMode = 'unsupported' | 'legacy-static' | 'native-selection'
export type SubagentSupportConfidence = 'confirmed' | 'legacy' | 'unverified'

export interface SubagentRuntimeCapabilities {
  /** Whether the subagent card may be rendered (canonical entry exists). */
  visible: boolean
  /** Effective `@deepseek-ai/dsh-tool-subagent` version when reliably known. */
  effectiveVersion?: string
  /**
   * Version advisory: `confirmed` when >= the verified minimum, `legacy` for
   * a known older version, `unverified` when the version cannot be resolved.
   * Never gates visibility.
   */
  supportConfidence?: SubagentSupportConfidence
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
  /** Host-side diagnostics: whether a canonical tool-subagent entry exists. */
  entryFound?: boolean
  /** Host-side diagnostics: which resolver produced the effective version. */
  versionSource?: string
  /** Host-side diagnostics: legacy reason string (advisory only). */
  hiddenReason?: string
  /** Host-side diagnostics: canonical loader entry id being targeted. */
  targetEntryId?: string
  /** Host-side diagnostics: canonical config `toolName`. */
  targetToolName?: string
  /** Host-side diagnostics: canonical config `provider`. */
  targetProvider?: string
  /** Host-side diagnostics: canonical loader entry base URL. */
  targetBaseUrl?: string
}

export interface SubagentCapabilityInput {
  /** Whether a canonical tool-subagent loader entry exists. */
  entryFound?: boolean
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

function supportConfidenceFor(version: string | undefined): SubagentSupportConfidence {
  if (version === undefined || parseVersion(version) === undefined) return 'unverified'
  return compareSemver(version, SUBAGENT_VISIBLE_MIN) >= 0 ? 'confirmed' : 'legacy'
}

/**
 * Detect the subagent runtime mode from actual schema/runtime facts.
 *
 * - No canonical entry → `unsupported`, fully hidden.
 * - Entry exists → visible regardless of version. `supportConfidence` carries
 *   the version advisory (`confirmed` / `legacy` / `unverified`).
 * - Native selection requires ALL of: tool-subagent `modelSelectionSettings`
 *   schema field, a `subagent-model-selection` settings namespace, and that
 *   namespace's `enabled`/`allowedModels` fields.
 * - Everything else → `legacy-static`; writable controls still depend on the
 *   schema fields actually present.
 */
export function detectSubagentCapabilities(
  input: SubagentCapabilityInput,
): SubagentRuntimeCapabilities {
  if (input.entryFound !== true) {
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
    supportConfidence: supportConfidenceFor(input.effectiveVersion),
    mode: supportsNativeSelection ? 'native-selection' : 'legacy-static',
    supportsAgentOptions,
    supportsReasoningEffort,
    supportsNativeSelection,
    supportsAllowedModels: supportsNativeSelection,
    modelSelectionSettings: hasModelSelectionSettings ? input.modelSelectionSettings : undefined,
  }
}
